'use strict';

// Sprint 66 — SAP-GTS-style optional change reason on operator-config
// PATCH. Rides along on the same PATCH endpoint as the sprint-42/43/
// 60/64 knob dials; extracted BEFORE knob validation so a malformed
// reason 400s without touching KV. Lands in the audit event's
// detail.reason (never in detail.patched — patched is typed as
// knob=value only). The sprint-65 history projection surfaces it;
// the OperatorConfigPanel captures it via an input; the
// OperatorConfigHistoryList renders it under the change line when
// present.
//
// Tests cover five layers:
//   1. Handler PATCH — sanitiseReason semantics: missing / empty
//      resolves to null; non-string 400s; over-length 400s; trimmed
//      valid string flows through.
//   2. Handler PATCH — reason NEVER pollutes detail.patched;
//      audit event's detail.reason is conditional-spread (absent
//      key when null).
//   3. events.listOperatorConfigHistory projection includes
//      reason field; null for legacy / empty events; string for
//      populated events.
//   4. TS — OperatorConfigHistoryEntry extended with reason.
//   5. UI — Panel state + input; PATCH payload includes reason
//      only when non-empty; HistoryList renders quoted italic
//      reason when non-null, hides when null.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');
const HANDLER_SRC = fs.readFileSync(
  path.join(ROOT, 'lib', 'handlers', 'operator-config.js'),
  'utf8',
);
const EVENTS_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'events.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// ── Layer 1: sanitiseReason semantics ────────────────────────────

test('handler defines sanitiseReason with 200-char cap constant', () => {
  assert.match(HANDLER_SRC, /const REASON_MAX = 200;/);
  assert.match(HANDLER_SRC, /function sanitiseReason\(raw\) \{/);
});

test('sanitiseReason source: undefined + null resolve to { ok: true, value: null }', () => {
  const fn = HANDLER_SRC.match(/function sanitiseReason\([\s\S]*?\n\}/);
  assert.ok(fn, 'sanitiseReason body not located');
  assert.match(
    fn[0],
    /if \(raw === undefined \|\| raw === null\) return \{ ok: true, value: null \}/,
  );
});

test('sanitiseReason source: non-string 400s (defence against JSON obj/number sneaking in)', () => {
  const fn = HANDLER_SRC.match(/function sanitiseReason\([\s\S]*?\n\}/)[0];
  assert.match(
    fn,
    /if \(typeof raw !== 'string'\)[\s\S]*?ok: false[\s\S]*?reason must be a string/,
  );
});

test('sanitiseReason source: empty-after-trim resolves to null (whitespace-only NOT a reason)', () => {
  const fn = HANDLER_SRC.match(/function sanitiseReason\([\s\S]*?\n\}/)[0];
  assert.match(fn, /const trimmed = raw\.trim\(\)/);
  assert.match(fn, /if \(trimmed\.length === 0\) return \{ ok: true, value: null \}/);
});

test('sanitiseReason source: over-length 400s (200-char cap enforced)', () => {
  const fn = HANDLER_SRC.match(/function sanitiseReason\([\s\S]*?\n\}/)[0];
  assert.match(
    fn,
    /if \(trimmed\.length > REASON_MAX\)[\s\S]*?ok: false[\s\S]*?at most \$\{REASON_MAX\} characters/,
  );
});

test('sanitiseReason source: valid string returns TRIMMED value (not raw)', () => {
  // A raw input of "  foo  " must return "foo" — the audit trail
  // should not carry incidental leading/trailing whitespace.
  const fn = HANDLER_SRC.match(/function sanitiseReason\([\s\S]*?\n\}/)[0];
  assert.match(fn, /return \{ ok: true, value: trimmed \}/);
});

// ── Layer 2: handler PATCH threading ─────────────────────────────

test('handlePatch calls sanitiseReason BEFORE knob validation (400s cheap; no KV mutation on invalid reason)', () => {
  const block = HANDLER_SRC.match(/async function handlePatch\([\s\S]*?\n\}/);
  assert.ok(block, 'handlePatch body not located');
  const body = block[0];
  // Positional: reasonResult MUST come before setOperatorConfig.
  const reasonIdx = body.indexOf('sanitiseReason(body.reason)');
  const setIdx = body.indexOf('operatorConfig.setOperatorConfig(');
  assert.ok(reasonIdx > 0, 'sanitiseReason call not found');
  assert.ok(setIdx > 0, 'setOperatorConfig call not found');
  assert.ok(
    reasonIdx < setIdx,
    'reason sanitisation MUST run before setOperatorConfig — invalid reason must 400 without touching KV',
  );
});

test('handlePatch strips reason from the knob payload passed to setOperatorConfig', () => {
  // Otherwise setOperatorConfig would see an unknown key. Even though
  // validatePartial silently ignores it, the discipline is: knobPatch
  // stays typed as knob-only.
  const body = HANDLER_SRC.match(/async function handlePatch\([\s\S]*?\n\}/)[0];
  assert.match(body, /const knobPatch = \{ \.\.\.body \}/);
  assert.match(body, /delete knobPatch\.reason/);
  assert.match(body, /setOperatorConfig\(ctx\.orgIdNumeric, knobPatch\)/);
});

test('handlePatch audit event: patched=knobPatch + reason conditionally spread (no `reason: null` in JSON)', () => {
  const body = HANDLER_SRC.match(/async function handlePatch\([\s\S]*?\n\}/)[0];
  // patched carries the sanitised knob payload, NEVER the raw body.
  assert.match(body, /patched: knobPatch/);
  // Conditional spread keeps the audit JSON minimal.
  assert.match(
    body,
    /\.\.\.\(reasonResult\.value !== null \? \{ reason: reasonResult\.value \} : \{\}\)/,
  );
});

// ── Layer 3: events projection ───────────────────────────────────

test('listOperatorConfigHistory projection surfaces reason (null for missing/empty, string for populated)', () => {
  const block = EVENTS_SRC.match(
    /async function listOperatorConfigHistory\([\s\S]*?\n\}/,
  );
  assert.ok(block, 'listOperatorConfigHistory body not located');
  const body = block[0];
  // Field present in the projection.
  assert.match(body, /\breason:/);
  // Guard shape: only populated for string reasons with content
  // after trim (defence against a stored empty-string sneaking
  // through — the handler already blocks it, but the reader
  // shouldn't trust upstream discipline blindly).
  assert.match(
    body,
    /typeof e\.detail\.reason === 'string' && e\.detail\.reason\.trim\(\)\.length > 0/,
  );
  // Fall-through is null (matches TS type).
  assert.match(body, /: null,?\s*$/m);
});

test('listOperatorConfigHistory reason projection returns runtime string when detail.reason is populated', async () => {
  // Positive path smoke — the projection MUST return the string
  // unchanged (past the guards) for a populated event. Runtime
  // check for behavioural drift. Under ORCATRADE_DISABLE_LIVE_
  // TARIC the KV store is in-memory so events.record works.
  const orgId = 999_999_666;
  await events.record('operator_config_updated', {
    orgId,
    entityType: 'operator_config',
    entityId: 'sprint66-smoke',
    actorEmailHash: 'abc123def456ghi7',
    detail: { patched: { stallThresholdDays: 7 }, reason: 'sprint-66 smoke' },
  });
  const list = await events.listOperatorConfigHistory({ orgId, limit: 5 });
  assert.equal(list.length, 1);
  assert.equal(list[0].reason, 'sprint-66 smoke');
  assert.deepEqual(list[0].patched, { stallThresholdDays: 7 });
  assert.equal(list[0].actorEmailHash, 'abc123def456ghi7');
});

test('listOperatorConfigHistory reason projection returns null when detail.reason absent (legacy events)', async () => {
  const orgId = 999_999_667;
  await events.record('operator_config_updated', {
    orgId,
    entityType: 'operator_config',
    entityId: 'sprint66-legacy',
    actorEmailHash: 'abc123def456ghi7',
    // Legacy shape — no reason field. Predates sprint 66.
    detail: { patched: { stallThresholdDays: 5 } },
  });
  const list = await events.listOperatorConfigHistory({ orgId, limit: 5 });
  assert.equal(list.length, 1);
  assert.equal(list[0].reason, null);
});

test('listOperatorConfigHistory reason projection returns null when detail.reason is empty/whitespace-only', async () => {
  const orgId = 999_999_668;
  await events.record('operator_config_updated', {
    orgId,
    entityType: 'operator_config',
    entityId: 'sprint66-whitespace',
    actorEmailHash: 'abc123def456ghi7',
    detail: { patched: { stallThresholdDays: 4 }, reason: '   ' },
  });
  const list = await events.listOperatorConfigHistory({ orgId, limit: 5 });
  assert.equal(list.length, 1);
  assert.equal(list[0].reason, null);
});

// ── Layer 4: TS mirror ───────────────────────────────────────────

test('OperatorConfigHistoryEntry TS extends with reason: string | null', () => {
  assert.match(
    API_TS,
    /export interface OperatorConfigHistoryEntry \{[\s\S]*?patched: Partial<OperatorConfig>;[\s\S]*?reason: string \| null;[\s\S]*?\}/,
  );
});

// ── Layer 5: UI wiring ───────────────────────────────────────────

test('OperatorConfigPanel state includes pendingReason (string, default empty)', () => {
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block, 'OperatorConfigPanel body not located');
  const body = block[0];
  assert.match(body, /const \[pendingReason, setPendingReason\] = useState<string>\(''\)/);
});

test('OperatorConfigPanel renders the reason input with maxLength=200 + placeholder + counter', () => {
  const body = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /)[0];
  assert.match(body, /id="operatorConfigReason"/);
  assert.match(body, /Change reason \(optional\)/);
  assert.match(body, /maxLength=\{200\}/);
  assert.match(body, /pendingReason\.length\}\/200 characters/);
});

test('OperatorConfigPanel onSave includes reason in PATCH payload ONLY when non-empty (post-trim)', () => {
  const body = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /)[0];
  assert.match(body, /const trimmedReason = pendingReason\.trim\(\)/);
  assert.match(body, /if \(trimmedReason\.length > 0\) patch\.reason = trimmedReason/);
});

test('OperatorConfigHistoryList renders the reason as quoted italic line when non-null (hides when null)', () => {
  const block = INSIGHTS_TSX.match(
    /function OperatorConfigHistoryList\([\s\S]*?\n\}\n/,
  );
  assert.ok(block, 'OperatorConfigHistoryList body not located');
  const body = block[0];
  // Truthy-gate: null AND empty-string both hide the line.
  assert.match(body, /\{entry\.reason && \(/);
  // Quoted-italic style pins.
  assert.match(body, /italic/);
  // Curly quotes around the reason so it reads as prose.
  assert.match(body, /“\{entry\.reason\}”/);
});
