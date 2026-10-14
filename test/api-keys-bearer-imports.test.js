'use strict';

// Sprint 45 — wire the sprint-44 bearer-token resolver into the
// imports handler GET endpoints.
//
// Sprint 44 shipped the API key management surface (create / list /
// revoke) but the keys couldn't do anything yet. Sprint 45 makes
// them usable: any GET on /api/imports/* with
// `Authorization: Bearer ot_…` resolves the key → org context and
// proceeds. POST / PATCH / DELETE on bearer-authed requests 401
// (read-only v1).
//
// Tests cover four layers via source-pin (the in-handler auth code
// can't easily be exercised in unit-test land without a heavy
// auth/orgs/db stub):
//   1. ensureAuthedOrg: bearer takes precedence over session; the
//      lookupByBearer call runs BEFORE the session fallback; invalid
//      bearer 401s without trying the session; ctx is flagged
//      isApiKey: true
//   2. ctx synthesises a per-key actor identifier (apikey:<keyId-12>)
//      so the existing audit-log writes still have an actor field
//      without leaking the raw key or the keyId's full hash
//   3. Dispatcher GET-only gate: any non-GET method on a bearer
//      request returns 401 with a "use a session" hint, BEFORE the
//      per-action handler runs (drift-guard against a refactor that
//      moves the gate into individual actions and forgets one)
//   4. requireOpsRole: bearer ctx passes the gate as 'api_key' role
//      (the sprint-44 key creation was admin-only, so a held key
//      carries ops-equivalent read authority). The dispatcher's
//      write-gate stops bearer writes independently.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');

// ── ensureAuthedOrg: bearer-first auth ─────────────────────────────

test('ensureAuthedOrg tries bearer-token auth BEFORE the session cookie', () => {
  // Bearer is the explicit "I am a programmatic client" signal — it
  // MUST take precedence so a stale session cookie on the same
  // machine can't shadow a deliberate API key. Pin the bearer branch
  // appearing before the auth.getCurrentUser call.
  const block = HANDLER_SRC.match(/async function ensureAuthedOrg\([\s\S]*?\n\}/);
  assert.ok(block, 'ensureAuthedOrg body not located');
  const body = block[0];
  const bearerIdx = body.indexOf('lookupByBearer');
  const sessionIdx = body.indexOf('auth.getCurrentUser');
  assert.ok(bearerIdx >= 0, 'lookupByBearer not called');
  assert.ok(sessionIdx >= 0, 'auth.getCurrentUser not called');
  assert.ok(bearerIdx < sessionIdx, 'bearer auth must precede session auth');
});

test('ensureAuthedOrg only attempts bearer lookup when the header looks like Bearer', () => {
  // A missing/empty Authorization header MUST fall straight through
  // to the session path — no wasted KV lookup on every page-load
  // request from a logged-in browser tab.
  const block = HANDLER_SRC.match(/async function ensureAuthedOrg\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  // The bearer block is gated by an `if (... /^bearer\s+/i.test(...))`
  // check before the lookupByBearer call.
  assert.match(body, /req\.headers && req\.headers\.authorization/);
  assert.match(body, /\/\^bearer\\s\+\/i\.test\(authHeader\.trim\(\)\)/);
});

test('ensureAuthedOrg 401s on an INVALID or REVOKED bearer (does NOT fall through to session)', () => {
  // A bearer that was sent + failed is a deliberate signal; falling
  // through to session auth would surface the wrong error ("Sign in
  // required" instead of "Invalid or revoked API key"). Pin the
  // explicit 401 + early return.
  const block = HANDLER_SRC.match(/async function ensureAuthedOrg\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /if \(!bearer\) \{[\s\S]*?Invalid or revoked API key/);
});

test('ensureAuthedOrg 503s when bearer resolves but the org has no numeric id', () => {
  // Same 503 shape as the session path — distinguishes
  // "configuration drift" from auth failures.
  const block = HANDLER_SRC.match(/async function ensureAuthedOrg\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(
    body,
    /if \(!Number\.isInteger\(bearer\.orgIdNumeric\)\)[\s\S]*?Organisation not yet mirrored/,
  );
});

test('Bearer ctx is flagged isApiKey: true AND carries the keyId + label', () => {
  // The flag drives the dispatcher's method gate + the
  // requireOpsRole ops-equivalent. The keyId + label are for the
  // audit-log writes. Pin all three fields.
  const block = HANDLER_SRC.match(/async function ensureAuthedOrg\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /isApiKey: true/);
  assert.match(body, /apiKeyId: bearer\.keyId/);
  assert.match(body, /apiKeyLabel: bearer\.label/);
});

test('Bearer ctx synthesises an actor identifier apikey:<keyId-prefix> for audit logging', () => {
  // The existing handlers write actorEmailHash on every audit
  // entry. For bearer requests, there's no email — but there IS a
  // stable per-key identifier. Pin the synthetic actorTag so a
  // future audit reader can distinguish human vs key actors.
  const block = HANDLER_SRC.match(/async function ensureAuthedOrg\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /apikey:\$\{String\(bearer\.keyId\)\.slice\(0, 12\)\}/);
  assert.match(body, /emailHash: actorTag/);
});

test('Session ctx is flagged isApiKey: false (cross-layer parity with bearer ctx)', () => {
  // Both shapes carry the same field so downstream code can
  // do `ctx.isApiKey ? … : …` without nullish checks.
  const block = HANDLER_SRC.match(/async function ensureAuthedOrg\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  // The session return statement explicitly sets isApiKey: false.
  assert.match(body, /isApiKey: false/);
});

// ── Dispatcher method gate ────────────────────────────────────────

test('Dispatcher 401s any non-GET method on a bearer-authed request', () => {
  // The single load-bearing gate. Without it, every per-action
  // handler would need to repeat the check; one missed action
  // means a bearer holder can write. Drift-guard pins the gate
  // location AND the "use a session" hint.
  assert.match(
    HANDLER_SRC,
    /if \(ctx\.isApiKey && req\.method !== ['"]GET['"]\) \{[\s\S]*?API keys are read-only/,
  );
  assert.match(HANDLER_SRC, /this method requires a signed-in session/);
});

test('Method gate runs IMMEDIATELY after ensureAuthedOrg (before any per-action dispatch)', () => {
  // A regression that moves the gate into per-action blocks could
  // miss a future action and silently widen the bearer write
  // surface. Pin the gate location.
  const ctxAssignIdx = HANDLER_SRC.indexOf('const ctx = await ensureAuthedOrg(req, res)');
  const gateIdx = HANDLER_SRC.indexOf("ctx.isApiKey && req.method !== 'GET'");
  const segmentsIdx = HANDLER_SRC.indexOf('const segments = pathSegments(req)');
  assert.ok(ctxAssignIdx >= 0, 'ensureAuthedOrg call site not located');
  assert.ok(gateIdx >= 0, 'method gate not located');
  assert.ok(segmentsIdx >= 0, 'pathSegments call not located');
  assert.ok(ctxAssignIdx < gateIdx, 'method gate must run AFTER ensureAuthedOrg');
  assert.ok(gateIdx < segmentsIdx, 'method gate must run BEFORE per-action dispatch');
});

// ── requireOpsRole: bearer = ops-equivalent ────────────────────────

test('requireOpsRole grants ops-equivalent access when ctx.isApiKey === true', () => {
  // Bearer keys were created admin-only (sprint 44). A held key
  // carries the creator's read authority. Without this branch,
  // sprint-17 insights + sprint-36 org-wide audit CSV would 403
  // for bearer requests, making the whole bearer surface useless.
  const block = HANDLER_SRC.match(/async function requireOpsRole\([\s\S]*?\n\}/);
  assert.ok(block, 'requireOpsRole body not located');
  const body = block[0];
  assert.match(body, /if \(ctx && ctx\.isApiKey\) return \{ ok: true, role: 'api_key' \}/);
});

test('requireOpsRole bearer-shortcut runs BEFORE the lookupCtxRole DB call (cheap-fail-first)', () => {
  // The DB lookup has a KV → PG fallback chain; a bearer-authed
  // request should never pay that cost. Pin the ordering.
  const block = HANDLER_SRC.match(/async function requireOpsRole\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  const bearerIdx = body.indexOf('ctx.isApiKey');
  const lookupIdx = body.indexOf('lookupCtxRole');
  assert.ok(bearerIdx >= 0 && lookupIdx >= 0);
  assert.ok(bearerIdx < lookupIdx, 'bearer shortcut must precede lookupCtxRole');
});
