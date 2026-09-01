'use strict';

// Sprint 56 — per-API-key scopes.
//
// Sprint 44 keys were admin-equivalent (full read access to every
// endpoint); sprint 56 lets the key creator narrow that to a
// subset like ['imports:read', 'audit:read'] so a leaked key has
// a bounded blast radius. Sprint 45 already shipped GET-only
// gating; sprint 56 adds the ORTHOGONAL narrowing axis.
//
// Tests cover five layers:
//   1. API_KEY_SCOPES whitelist exported + validateScopes (strict
//      against whitelist + array-only + de-dupes)
//   2. createApiKey + listApiKeysForOrg + lookupByBearer all
//      thread the scopes field; legacy KV records without the
//      field default to [] (admin-equivalent — back-compat)
//   3. Handler create accepts scopes from POST body + audits them;
//      list responses surface scopes; GET /api/api-keys/scopes
//      exposes the whitelist for the UI
//   4. CRITICAL: imports dispatcher action→scope gate:
//      - Empty scopes (legacy / sprint-44 keys) = unscoped
//        (admin-equivalent, no gate fires)
//      - Non-empty scopes = 403 with `requiredScope` + `grantedScopes`
//        when the action isn't covered
//      - The action→scope map covers every reserved-keyword
//        externalId (insights / export.csv / audit.csv) AND
//        the explicit per-id actions (audit.csv / dossier / quote
//        / history)
//   5. TS mirror + UI: ApiKeyScope literal union + scope chips on
//      the list + checkboxes on the create form (hydrated from
//      /api/api-keys/scopes, NOT hardcoded)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const apiKeys = require('../lib/api-keys');

const ROOT = path.resolve(__dirname, '..');
const HELPER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'api-keys.js'), 'utf8');
const KEYS_HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'api-keys.js'), 'utf8');
const IMPORTS_HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

function withInMemoryKv(fn) {
  const kv = require('../lib/intelligence/kv-store');
  const store = new Map();
  const originalGet = kv.get;
  const originalSet = kv.set;
  const originalDel = kv.del;
  kv.get = async (k) => store.get(k);
  kv.set = async (k, v) => { store.set(k, v); };
  kv.del = async (k) => { store.delete(k); };
  return Promise.resolve()
    .then(() => fn(store))
    .finally(() => {
      kv.get = originalGet;
      kv.set = originalSet;
      kv.del = originalDel;
    });
}

// ── Scope whitelist + validateScopes ──────────────────────────────

test('API_KEY_SCOPES exports the four documented v1 scopes', () => {
  // Drift-guard pins the exact list. A new server-side endpoint
  // category should be an explicit addition, not a silent one
  // (the existing keys would otherwise pass through unnoticed).
  assert.deepEqual(
    Array.from(apiKeys.API_KEY_SCOPES),
    ['imports:read', 'insights:read', 'audit:read', 'exports:read'],
  );
});

test('validateScopes accepts empty array (legacy admin-equivalent)', () => {
  // The critical back-compat path: a sprint-44 caller (or a
  // sprint-56+ user who wants a quick unscoped key) passes []
  // and gets the unscoped treatment.
  const r = apiKeys.validateScopes([]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, []);
});

test('validateScopes rejects unknown strings + non-strings + non-arrays', () => {
  // Strict: a typo'd scope should fail loudly at create time, not
  // silently downgrade to unscoped.
  assert.equal(apiKeys.validateScopes('imports:read').ok, false);
  assert.equal(apiKeys.validateScopes({ scopes: ['imports:read'] }).ok, false);
  assert.equal(apiKeys.validateScopes(['imports:writez']).ok, false);
  assert.equal(apiKeys.validateScopes(['imports:read', 42]).ok, false);
});

test('validateScopes silently de-dupes (UI may pass duplicates from checkbox toggles)', () => {
  const r = apiKeys.validateScopes(['imports:read', 'imports:read', 'audit:read']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, ['imports:read', 'audit:read']);
});

// ── createApiKey / listApiKeysForOrg / lookupByBearer threading ───

test('createApiKey writes scopes to the stored metadata; empty when omitted', () => {
  return withInMemoryKv(async (store) => {
    // Omitted scopes → empty array (back-compat).
    const r1 = await apiKeys.createApiKey({
      orgIdNumeric: 42, label: 'legacy-shaped',
    });
    assert.equal(r1.ok, true);
    assert.deepEqual(r1.metadata.scopes, []);
    // Explicit scopes → narrowed.
    const r2 = await apiKeys.createApiKey({
      orgIdNumeric: 42, label: 'narrow',
      scopes: ['imports:read', 'audit:read'],
    });
    assert.equal(r2.ok, true);
    assert.deepEqual(r2.metadata.scopes, ['imports:read', 'audit:read']);
    // KV reflects.
    const stored2 = store.get(`apikey:hash:${r2.keyId}`);
    assert.deepEqual(stored2.scopes, ['imports:read', 'audit:read']);
  });
});

test('createApiKey rejects invalid scopes without touching KV', () => {
  return withInMemoryKv(async (store) => {
    const before = store.size;
    const r = await apiKeys.createApiKey({
      orgIdNumeric: 42, label: 'x', scopes: ['notarealscope:read'],
    });
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /unsupported value: notarealscope:read/);
    assert.equal(store.size, before);
  });
});

test('listApiKeysForOrg surfaces scopes (NEVER the raw key)', () => {
  return withInMemoryKv(async () => {
    await apiKeys.createApiKey({
      orgIdNumeric: 42, label: 'narrow', scopes: ['imports:read'],
    });
    const list = await apiKeys.listApiKeysForOrg(42);
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].scopes, ['imports:read']);
    assert.equal(list[0].key, undefined);
    assert.equal(list[0].secret, undefined);
  });
});

test('listApiKeysForOrg defaults scopes to [] for a legacy KV record (sprint-44 back-compat)', () => {
  return withInMemoryKv(async (store) => {
    // Simulate a sprint-44 KV record without the field.
    store.set('apikey:hash:legacyhash', {
      orgIdNumeric: 42, label: 'pre-sprint-56',
      createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null,
      revoked: false, redactedKey: 'ot_xxxx…1234',
      // No scopes field — sprint-44 record shape.
    });
    store.set('apikey:org:42', ['legacyhash']);
    const list = await apiKeys.listApiKeysForOrg(42);
    assert.equal(list.length, 1);
    // Defensive normalize: [] (admin-equivalent) is what the UI
    // needs to see.
    assert.deepEqual(list[0].scopes, []);
  });
});

test('lookupByBearer returns scopes alongside the org context', () => {
  return withInMemoryKv(async () => {
    const created = await apiKeys.createApiKey({
      orgIdNumeric: 42, label: 'scoped',
      scopes: ['imports:read', 'audit:read'],
    });
    const result = await apiKeys.lookupByBearer(`Bearer ${created.raw}`);
    assert.ok(result);
    assert.equal(result.orgIdNumeric, 42);
    assert.deepEqual(result.scopes, ['imports:read', 'audit:read']);
  });
});

test('lookupByBearer normalizes scopes to [] for a legacy KV record', () => {
  return withInMemoryKv(async (store) => {
    // Create a key the normal way, then strip scopes from KV to
    // simulate the sprint-44 shape.
    const created = await apiKeys.createApiKey({
      orgIdNumeric: 42, label: 'will-be-stripped',
    });
    const k = `apikey:hash:${created.keyId}`;
    const meta = store.get(k);
    delete meta.scopes;
    store.set(k, meta);
    const result = await apiKeys.lookupByBearer(`Bearer ${created.raw}`);
    assert.ok(result);
    assert.deepEqual(result.scopes, []);
  });
});

// ── api-keys handler create + scopes endpoint ─────────────────────

test('Handler create accepts scopes from body + audits them', () => {
  // Source-pin: the handler passes body.scopes through to
  // createApiKey AND records them in the audit detail (so a
  // chain reader can see which scopes were granted).
  const block = KEYS_HANDLER_SRC.match(/async function handleCreate\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /scopes: Array\.isArray\(body\.scopes\) \? body\.scopes : \[\]/);
  assert.match(body, /scopes: result\.metadata\.scopes/);
});

test('Handler exposes GET /api/api-keys/scopes returning the whitelist', () => {
  // Drift-guard: the UI's create-form checkboxes hydrate from
  // this endpoint instead of hardcoding the list. A server-side
  // add lands without a UI PR.
  assert.match(KEYS_HANDLER_SRC, /if \(keyId === ['"]scopes['"]\)/);
  assert.match(KEYS_HANDLER_SRC, /scopes: apiKeys\.API_KEY_SCOPES/);
});

// ── CRITICAL: imports dispatcher scope gate ───────────────────────

test('imports dispatcher threads apiKeyScopes through ensureAuthedOrg bearer ctx', () => {
  // The ctx field is what the dispatcher reads. Without it, the
  // gate would always read undefined and silently allow
  // everything.
  const block = IMPORTS_HANDLER_SRC.match(/async function ensureAuthedOrg\([\s\S]*?(?=\nasync function )/);
  assert.ok(block);
  assert.match(block[0], /apiKeyScopes: Array\.isArray\(bearer\.scopes\) \? bearer\.scopes : \[\]/);
});

test('Empty apiKeyScopes (legacy) = no gate fires (back-compat with sprint-44 keys)', () => {
  // Drift-guard pins the conditional: the gate ONLY fires when
  // ctx.apiKeyScopes is non-empty. An unscoped legacy key
  // continues to work exactly as before.
  assert.match(
    IMPORTS_HANDLER_SRC,
    /if \(ctx\.isApiKey && Array\.isArray\(ctx\.apiKeyScopes\) && ctx\.apiKeyScopes\.length > 0\) \{/,
  );
});

test('CRITICAL: Action→scope map covers every reserved-keyword + per-id action', () => {
  // Drift-guard: every protected endpoint name must appear in
  // the map. A missing branch falls through to the
  // 'imports:read' safe default, which is correct for catch-all
  // but would mistakenly grant audit access to a key that ONLY
  // had 'imports:read' if 'audit.csv' wasn't in the map.
  // Source-pin each mapping.
  const block = IMPORTS_HANDLER_SRC.match(
    /if \(ctx\.isApiKey && Array\.isArray\(ctx\.apiKeyScopes\) && ctx\.apiKeyScopes\.length > 0\)[\s\S]*?\n  \}/,
  );
  assert.ok(block);
  const body = block[0];
  // Reserved-keyword externalIds:
  assert.match(body, /externalId === ['"]insights['"]\) requiredScope = ['"]insights:read['"]/);
  assert.match(body, /externalId === ['"]export\.csv['"]\) requiredScope = ['"]exports:read['"]/);
  assert.match(body, /externalId === ['"]audit\.csv['"]\) requiredScope = ['"]audit:read['"]/);
  // Per-id actions:
  assert.match(body, /action === ['"]audit\.csv['"]\) requiredScope = ['"]audit:read['"]/);
  assert.match(body, /action === ['"]dossier['"]\) requiredScope = ['"]imports:read['"]/);
  assert.match(body, /action === ['"]quote['"]\) requiredScope = ['"]imports:read['"]/);
  assert.match(body, /action === ['"]history['"]\) requiredScope = ['"]imports:read['"]/);
});

test('Scope gate 403s with requiredScope + grantedScopes in the body (actionable error)', () => {
  // The error must surface BOTH the missing scope and what the
  // key DID have so the user can self-diagnose. Drift-guard pins
  // both fields.
  const block = IMPORTS_HANDLER_SRC.match(
    /if \(!ctx\.apiKeyScopes\.includes\(requiredScope\)\)[\s\S]*?\}\);/,
  );
  assert.ok(block);
  const body = block[0];
  assert.match(body, /jsonResponse\(res, 403/);
  assert.match(body, /requiredScope,/);
  assert.match(body, /grantedScopes: ctx\.apiKeyScopes/);
});

// ── TS mirror ──────────────────────────────────────────────────────

test('TS ApiKeyScope literal union covers the 4 documented v1 scopes', () => {
  // A future server-side add must surface here as a TS compile
  // error. Pin the exact union members.
  assert.match(API_TS, /export type ApiKeyScope =[\s\S]*?\| ['"]imports:read['"][\s\S]*?\| ['"]insights:read['"][\s\S]*?\| ['"]audit:read['"][\s\S]*?\| ['"]exports:read['"]/);
});

test('TS ApiKey gets optional scopes?: ApiKeyScope[] (back-compat with legacy list responses)', () => {
  // Optional so a sprint-44 list response without the field
  // doesn't fail typecheck. The UI's render gates on
  // (k.scopes || []).length === 0 explicitly.
  assert.match(API_TS, /scopes\?: ApiKeyScope\[\];/);
});

test('TS ApiKeyScopesResponse interface defined', () => {
  assert.match(API_TS, /export interface ApiKeyScopesResponse \{[\s\S]*?scopes: ApiKeyScope\[\];[\s\S]*?\}/);
});

// ── UI ────────────────────────────────────────────────────────────

test('ApiKeysPanel fetches /api/api-keys/scopes (NOT hardcoded) on refresh', () => {
  // Drift-guard against the UI hardcoding the whitelist + going
  // out of sync with the server.
  assert.match(INSIGHTS_TSX, /apiGet<ApiKeyScopesResponse>\(['"]\/api\/api-keys\/scopes['"]\)/);
});

test('ApiKeysPanel POSTs selected scopes alongside the label', () => {
  // The wire shape — drift-guard against a refactor that dropped
  // the scopes pass-through.
  const block = INSIGHTS_TSX.match(/function ApiKeysPanel\(\)[\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /scopes: selectedScopes/);
});

test('ApiKeysPanel surfaces an "all read access" chip for keys with empty scopes (legacy)', () => {
  // The UI distinguishes legacy unscoped (admin-equivalent) keys
  // from narrowed keys. Without the chip a user might wonder why
  // their old key is showing no scope chips.
  const block = INSIGHTS_TSX.match(/function ApiKeysPanel\(\)[\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /\(!k\.scopes \|\| k\.scopes\.length === 0\) && \(/);
  assert.match(body, /all read access/);
});

test('ApiKeysPanel renders one chip per granted scope in aqua', () => {
  const block = INSIGHTS_TSX.match(/function ApiKeysPanel\(\)[\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /k\.scopes && k\.scopes\.map\(\(s\) => \(/);
  // Aqua chip styling pinned so a future widening that re-styled
  // surfaces clearly.
  assert.match(body, /bg-\[var\(--color-aqua\)\]\/15 text-\[var\(--color-aqua\)\]/);
});
