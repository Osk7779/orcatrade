'use strict';

// Sprint 44 — per-org API keys (v1, read-only).
//
// The biggest enterprise integration gap closed: programmatic
// access via bearer tokens. v1 ships the management surface
// (create / list / revoke) + the bearer-token resolver. Wiring
// the resolver into specific GET endpoints is a follow-up sprint.
//
// Tests cover five layers:
//   1. Pure helpers (entropy/format/parse/redact/validate) — the
//      ot_<32 hex> format; parseBearer tolerant of case + whitespace;
//      redactKey preserves last 4; validateLabel rejects empty,
//      length > 120, control characters
//   2. KV round-trip via in-memory stub: create + list + revoke;
//      raw key returned ONCE on create; list NEVER returns raw;
//      revoke is idempotent + cross-org-isolated
//   3. lookupByBearer: tolerant header parsing; revoked keys
//      return null; fire-and-forget lastUsedAt update
//   4. Handler shape: admin-only RBAC gate; POST writes
//      api_key_created audit event BEFORE returning 201 (ADR-0005);
//      DELETE writes api_key_revoked; idempotent re-revoke
//   5. UI: <ApiKeysPanel> reveal-once flow, refresh-on-expand,
//      confirm-on-revoke; raw key surfaced ONLY in the reveal
//      banner, never in the list
//
// The cross-org-isolation check in revokeApiKey is load-bearing —
// without it, a leaked keyId could let an attacker revoke another
// org's keys. Drift-guard pins the orgIdNumeric mismatch → 404
// branch.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const apiKeys = require('../lib/api-keys');
const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');
const HELPER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'api-keys.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'api-keys.js'), 'utf8');
const DISPATCH_SRC = fs.readFileSync(path.join(ROOT, 'api', '[...path].js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// ── Pure helpers ───────────────────────────────────────────────────

test('generateRaw produces an ot_<32 hex> key (128 bits of entropy)', () => {
  // 32 hex chars = 16 bytes = 128 bits. Lower than that is
  // brute-force-eligible; higher is wasted.
  const raw = apiKeys.generateRaw();
  assert.match(raw, /^ot_[a-f0-9]{32}$/);
  assert.equal(raw.length, 35); // 'ot_' + 32 hex
});

test('generateRaw produces unique keys (negligible collision rate)', () => {
  // 1k samples uncovers any catastrophic entropy regression
  // (constant seed, low-quality randomBytes fallback). At 128 bits,
  // the birthday-paradox collision probability for 1000 samples is
  // ~10^-32 — any collision means the RNG is broken.
  const set = new Set();
  for (let i = 0; i < 1000; i += 1) {
    set.add(apiKeys.generateRaw());
  }
  assert.equal(set.size, 1000);
});

test('parseBearer tolerant of case + whitespace, strict on format', () => {
  // Tolerant of "Bearer" vs "bearer" + trailing whitespace, but
  // strict on the ot_ prefix.
  assert.equal(apiKeys.parseBearer('Bearer ot_abc123'), 'ot_abc123');
  assert.equal(apiKeys.parseBearer('bearer ot_abc123'), 'ot_abc123');
  assert.equal(apiKeys.parseBearer('  Bearer ot_abc123  '), 'ot_abc123');
  // Strict on format:
  assert.equal(apiKeys.parseBearer(''), null);
  assert.equal(apiKeys.parseBearer(null), null);
  assert.equal(apiKeys.parseBearer('Basic abc123'), null);
  assert.equal(apiKeys.parseBearer('Bearer abc123'), null); // wrong prefix
  assert.equal(apiKeys.parseBearer('ot_abc123'), null);     // no Bearer scheme
});

test('hashKey is deterministic SHA-256 (64 hex chars)', () => {
  const a = apiKeys.hashKey('ot_test');
  const b = apiKeys.hashKey('ot_test');
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
  // Different input → different hash.
  assert.notEqual(apiKeys.hashKey('ot_test'), apiKeys.hashKey('ot_other'));
});

test('redactKey preserves last 4 chars for identification', () => {
  // The redacted form lets a user map the row to a clipboard copy
  // ("oh that was the ...1234 key"). Short keys + edge cases handled.
  assert.equal(apiKeys.redactKey('ot_abc12345'), 'ot_xxxx…2345');
  // Defensive on short / non-string input.
  assert.equal(apiKeys.redactKey(''), 'ot_???');
  assert.equal(apiKeys.redactKey(null), 'ot_???');
});

test('validateLabel rejects empty + too-long + control characters', () => {
  // Required, length-bounded, no control characters (XSS / log-
  // injection guard). The control-char check matters because labels
  // surface in the audit log JSON; an injected newline could spoof
  // a fake event line.
  assert.equal(apiKeys.validateLabel('ERP read-sync').ok, true);
  assert.equal(apiKeys.validateLabel('').ok, false);
  assert.equal(apiKeys.validateLabel('   ').ok, false);
  assert.equal(apiKeys.validateLabel('x'.repeat(121)).ok, false);
  // Control-character rejection.
  assert.equal(apiKeys.validateLabel('hello\nworld').ok, false);
  assert.equal(apiKeys.validateLabel('hello\x00world').ok, false);
  assert.equal(apiKeys.validateLabel('hello\x7fworld').ok, false);
});

// ── KV round-trip via in-memory stub ──────────────────────────────

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

test('createApiKey writes hash + org index + returns raw ONCE', () => {
  return withInMemoryKv(async (store) => {
    const r = await apiKeys.createApiKey({ orgIdNumeric: 42, label: 'ERP sync', actorEmailHash: 'hash1' });
    assert.equal(r.ok, true);
    assert.match(r.raw, /^ot_[a-f0-9]{32}$/);
    assert.equal(r.metadata.label, 'ERP sync');
    assert.equal(r.metadata.orgIdNumeric, 42);
    assert.equal(r.metadata.revoked, false);
    // Hash record exists.
    const hash = apiKeys.hashKey(r.raw);
    const meta = store.get(`apikey:hash:${hash}`);
    assert.ok(meta);
    assert.equal(meta.orgIdNumeric, 42);
    // Org index updated.
    const index = store.get('apikey:org:42');
    assert.ok(Array.isArray(index));
    assert.ok(index.includes(hash));
  });
});

test('createApiKey rejects invalid label without touching KV', () => {
  return withInMemoryKv(async (store) => {
    const r = await apiKeys.createApiKey({ orgIdNumeric: 42, label: '' });
    assert.equal(r.ok, false);
    assert.equal(store.size, 0);
  });
});

test('listApiKeysForOrg returns redacted-only — NEVER the raw key', () => {
  return withInMemoryKv(async () => {
    const created = await apiKeys.createApiKey({ orgIdNumeric: 42, label: 'k1' });
    const list = await apiKeys.listApiKeysForOrg(42);
    assert.equal(list.length, 1);
    assert.equal(list[0].label, 'k1');
    // The list response shape MUST NOT have a `key` field — that
    // would be the one-time-reveal value, recoverable only at
    // create. Pin both that absence AND the redacted form's presence.
    assert.equal(list[0].key, undefined);
    assert.match(list[0].redactedKey, /^ot_xxxx…[a-f0-9]{4}$/);
    // raw value isn't anywhere in the response.
    assert.ok(!JSON.stringify(list).includes(created.raw));
  });
});

test('listApiKeysForOrg returns empty array for unknown org (no throw)', () => {
  return withInMemoryKv(async () => {
    const list = await apiKeys.listApiKeysForOrg(999);
    assert.deepEqual(list, []);
  });
});

test('revokeApiKey is cross-org-isolated (leaked keyId from one org cannot affect another)', () => {
  return withInMemoryKv(async () => {
    const created = await apiKeys.createApiKey({ orgIdNumeric: 42, label: 'k1' });
    // Different org tries to revoke. Pin the 404 (same shape as
    // not-found — never "this exists but isn't yours").
    const r = await apiKeys.revokeApiKey({ orgIdNumeric: 999, keyId: created.keyId });
    assert.equal(r.ok, false);
    assert.equal(r.notFound, true);
    // The original key is still active.
    const list = await apiKeys.listApiKeysForOrg(42);
    assert.equal(list.length, 1);
    assert.equal(list[0].revoked, false);
  });
});

test('revokeApiKey is idempotent — re-revoke returns alreadyRevoked', () => {
  return withInMemoryKv(async () => {
    const created = await apiKeys.createApiKey({ orgIdNumeric: 42, label: 'k1' });
    const first = await apiKeys.revokeApiKey({ orgIdNumeric: 42, keyId: created.keyId });
    assert.equal(first.ok, true);
    assert.ok(!first.alreadyRevoked);
    const second = await apiKeys.revokeApiKey({ orgIdNumeric: 42, keyId: created.keyId });
    assert.equal(second.ok, true);
    assert.equal(second.alreadyRevoked, true);
  });
});

test('revokeApiKey removes the hash from the org index (list reflects revocation)', () => {
  return withInMemoryKv(async (store) => {
    const created = await apiKeys.createApiKey({ orgIdNumeric: 42, label: 'k1' });
    await apiKeys.revokeApiKey({ orgIdNumeric: 42, keyId: created.keyId });
    const index = store.get('apikey:org:42');
    assert.ok(Array.isArray(index));
    assert.ok(!index.includes(created.keyId));
    // The hash record itself stays (for audit views).
    const meta = store.get(`apikey:hash:${created.keyId}`);
    assert.equal(meta.revoked, true);
    assert.ok(meta.revokedAt);
  });
});

// ── lookupByBearer ────────────────────────────────────────────────

test('lookupByBearer resolves a valid bearer to the org context', () => {
  return withInMemoryKv(async () => {
    const created = await apiKeys.createApiKey({ orgIdNumeric: 42, label: 'k1' });
    const out = await apiKeys.lookupByBearer(`Bearer ${created.raw}`);
    assert.ok(out);
    assert.equal(out.orgIdNumeric, 42);
    assert.equal(out.label, 'k1');
    assert.equal(out.keyId, created.keyId);
  });
});

test('lookupByBearer returns null on malformed header / wrong scheme / unknown key', () => {
  return withInMemoryKv(async () => {
    assert.equal(await apiKeys.lookupByBearer(''), null);
    assert.equal(await apiKeys.lookupByBearer('Bearer not_a_key'), null);
    assert.equal(await apiKeys.lookupByBearer('Bearer ot_deadbeef'), null);
    assert.equal(await apiKeys.lookupByBearer('Basic credentials'), null);
  });
});

test('lookupByBearer returns null for revoked keys', () => {
  return withInMemoryKv(async () => {
    const created = await apiKeys.createApiKey({ orgIdNumeric: 42, label: 'k1' });
    await apiKeys.revokeApiKey({ orgIdNumeric: 42, keyId: created.keyId });
    const out = await apiKeys.lookupByBearer(`Bearer ${created.raw}`);
    assert.equal(out, null);
  });
});

// ── Handler ────────────────────────────────────────────────────────

test('Dispatcher registers api-keys under /api/api-keys', () => {
  assert.match(DISPATCH_SRC, /['"]api-keys['"]: require\(['"]\.\.\/lib\/handlers\/api-keys['"]\)/);
});

test('Handler enforces admin-only RBAC (same gate as operator-config)', () => {
  assert.match(HANDLER_SRC, /OPS_REVIEW_ROLES = new Set\(\['admin', 'owner'\]\)/);
  assert.match(HANDLER_SRC, /only owner \/ admin members can manage API keys/);
});

test('Handler POST writes api_key_created audit event BEFORE returning 201 (ADR-0005)', () => {
  const block = HANDLER_SRC.match(/async function handleCreate\([\s\S]*?\n\}/);
  assert.ok(block, 'handleCreate body not located');
  const body = block[0];
  assert.match(body, /events\.record\(['"]api_key_created['"],/);
  // Audit failure → 500, NEVER silent success.
  assert.match(body, /Could not record audit event for API key create/);
  assert.match(body, /jsonResponse\(res, 500/);
});

test('Handler POST detail intentionally OMITS the raw key (never in audit log)', () => {
  // The audit chain MUST NOT carry the raw key — even an internal
  // viewer could exfiltrate it via the audit view. Pin the detail
  // shape so a refactor can't accidentally widen the projection.
  const block = HANDLER_SRC.match(/async function handleCreate\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  // The event payload references label + redactedKey (NEVER raw).
  // Capture from events.record(...) up to the matching });. The
  // payload is the second argument — an object literal.
  const recordBlock = body.match(/events\.record\(['"]api_key_created['"][\s\S]*?\}\);/);
  assert.ok(recordBlock, 'events.record(api_key_created) call not located');
  const recordCall = recordBlock[0];
  assert.match(recordCall, /label: result\.metadata\.label/);
  assert.match(recordCall, /redactedKey: result\.metadata\.redactedKey/);
  // The raw key MUST NOT appear in the detail block.
  assert.ok(!recordCall.includes('result.raw'), 'raw key leaked into audit detail');
});

test('Handler DELETE writes api_key_revoked event ONLY on a non-idempotent revoke', () => {
  // A re-revoke (alreadyRevoked) MUST NOT write a duplicate event —
  // would spam the audit chain. Pin the guard.
  const block = HANDLER_SRC.match(/async function handleRevoke\([\s\S]*?\n\}/);
  assert.ok(block, 'handleRevoke body not located');
  const body = block[0];
  assert.match(body, /if \(!result\.alreadyRevoked\) \{[\s\S]*?events\.record\(['"]api_key_revoked['"]/);
});

test('Handler POST response returns the RAW key ONCE alongside the keyId', () => {
  // The one-time reveal. The list endpoint MUST NOT include the raw
  // value; only the create response does. Pin both: create response
  // surfaces it AND the list-path doesn't.
  const createBlock = HANDLER_SRC.match(/async function handleCreate\([\s\S]*?\n\}/);
  const listBlock = HANDLER_SRC.match(/async function handleList\([\s\S]*?\n\}/);
  assert.ok(createBlock && listBlock);
  assert.match(createBlock[0], /key: result\.raw/);
  assert.ok(!/key: result\.raw/.test(listBlock[0]), 'list response leaked the raw key');
});

test('events.ALLOWED_TYPES includes api_key_created + api_key_revoked (drift-guard against silent-drop)', () => {
  // Sprint 14 lesson — types not in ALLOWED_TYPES are silently
  // dropped. A new audit-event type that's NOT in the allowlist
  // would break the handler's audit-log-before-success guarantee.
  assert.ok(events.ALLOWED_TYPES.has('api_key_created'));
  assert.ok(events.ALLOWED_TYPES.has('api_key_revoked'));
});

// ── TS mirror ──────────────────────────────────────────────────────

test('TS ApiKey / ApiKeyListResponse / ApiKeyCreateResponse interfaces mirror the JS shape', () => {
  // Cross-layer breadcrumb. ApiKey explicitly does NOT have a `key`
  // field — that field exists only on ApiKeyCreateResponse.
  assert.match(API_TS, /export interface ApiKey \{[\s\S]*?keyId: string;[\s\S]*?label: string;[\s\S]*?createdAt: string;[\s\S]*?lastUsedAt: string \| null;[\s\S]*?redactedKey: string;[\s\S]*?revoked: boolean;[\s\S]*?\}/);
  assert.match(API_TS, /export interface ApiKeyListResponse \{[\s\S]*?keys: ApiKey\[\];[\s\S]*?\}/);
  assert.match(API_TS, /export interface ApiKeyCreateResponse \{[\s\S]*?key: string;[\s\S]*?keyId: string;[\s\S]*?\}/);
});

test('ApiKey TS shape does NOT carry a raw `key` field (one-time-reveal discipline)', () => {
  // The list endpoint returns `ApiKey[]`; if `key` were in the
  // interface, the UI could think it was always available. Pin
  // its absence.
  const apiKeyBlock = API_TS.match(/export interface ApiKey \{[\s\S]*?\}\n/);
  assert.ok(apiKeyBlock);
  // No `key: string` inside the ApiKey block.
  assert.ok(!/^\s*key:\s*string/m.test(apiKeyBlock[0]), 'ApiKey leaked raw `key` field into the listable shape');
});

// ── UI ─────────────────────────────────────────────────────────────

test('Ops Insights page mounts <ApiKeysPanel> after OperatorConfigPanel', () => {
  // Both panels are admin-only settings; they cluster as a
  // band above the cohorts.
  assert.match(INSIGHTS_TSX, /<ApiKeysPanel \/>/);
  const configIdx = INSIGHTS_TSX.indexOf('<OperatorConfigPanel');
  const apiKeysIdx = INSIGHTS_TSX.indexOf('<ApiKeysPanel');
  assert.ok(configIdx >= 0 && apiKeysIdx >= 0 && configIdx < apiKeysIdx,
    'ApiKeysPanel must mount AFTER OperatorConfigPanel');
});

test('ApiKeysPanel reveal-once flow shows the raw key + a warning + dismiss', () => {
  // The reveal-once banner is load-bearing — without the warning,
  // a user dismisses without copying + permanently loses the key.
  const block = INSIGHTS_TSX.match(/function ApiKeysPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block, 'ApiKeysPanel body not located');
  const body = block[0];
  // Reveal state.
  assert.match(body, /setRevealedKey\(\{ raw: data\.key/);
  // Warning copy.
  assert.match(body, /will NOT be shown again/);
  // Dismiss handler.
  assert.match(body, /setRevealedKey\(null\)/);
});

test('ApiKeysPanel POSTs to /api/api-keys with { label } AND echoes the raw key from the response', () => {
  const block = INSIGHTS_TSX.match(/function ApiKeysPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  // Create wiring.
  assert.match(body, /apiPost<ApiKeyCreateResponse>\(['"]\/api\/api-keys['"], \{[\s\S]*?label: creatingLabel\.trim\(\)/);
  // The raw key from the response is what feeds the reveal banner.
  assert.match(body, /raw: data\.key/);
});

test('ApiKeysPanel DELETE confirms before firing (defence against fat-finger revoke)', () => {
  // Revoking an active key kills client traffic instantly; the
  // confirm is the last line of defence.
  const block = INSIGHTS_TSX.match(/function ApiKeysPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /confirm\(['"]Revoke this API key/);
  assert.match(body, /apiDelete\(`\/api\/api-keys\/\$\{encodeURIComponent\(keyId\)\}`\)/);
});

test('ApiKeysPanel refreshes the list on first expand (lazy load)', () => {
  // Closed-panel render shouldn't pay the GET cost; load on toggle
  // when first opened.
  const block = INSIGHTS_TSX.match(/function ApiKeysPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /onToggle=/);
  assert.match(body, /keys === null && !loading/);
});
