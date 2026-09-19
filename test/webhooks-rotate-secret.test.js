'use strict';

// Sprint 59 — webhook signing-secret rotation.
//
// Sprint 47 minted the secret at create time + made it
// one-time-reveal; if leaked, delete+recreate was the only path.
// Sprint 59 adds POST /api/webhooks/<id>/rotate so a leaked
// secret can be rotated without re-creating the subscription
// (which would force the customer to re-register the URL +
// re-enrol against the same event types).
//
// CRITICAL discipline — pinned at four layers:
//   1. Helper: cross-org isolated (notFound shape on mismatch),
//      mints a fresh whsec_<64 hex>, stamps secretRotatedAt
//   2. Handler: admin-only RBAC, audit-log BEFORE returning 200
//      (ADR-0005), reveal-once flow (secret returned in the
//      response ONCE — same posture as sprint 47 create)
//   3. Audit allowlist: webhook_subscription_secret_rotated
//      registered; audit detail OMITS the raw secret
//   4. UI: Rotate button per row; confirm() before firing;
//      reveals new secret in the same banner as create

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const webhooks = require('../lib/webhooks');
const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');
const HELPER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'webhooks.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'webhooks.js'), 'utf8');
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

// ── Helper round-trip ─────────────────────────────────────────────

test('rotateSecret is cross-org isolated (notFound shape on foreign-org id)', () => {
  return withInMemoryKv(async () => {
    const c = await webhooks.createWebhook({
      orgIdNumeric: 42, label: 'k',
      url: 'https://example.com/hook',
      eventTypes: ['import_request_created'],
    });
    const r = await webhooks.rotateSecret({
      orgIdNumeric: 999, id: c.subscription.id,
    });
    assert.equal(r.ok, false);
    assert.equal(r.notFound, true);
  });
});

test('rotateSecret returns notFound on unknown id (defensive)', () => {
  return withInMemoryKv(async () => {
    const r = await webhooks.rotateSecret({
      orgIdNumeric: 42, id: 'whk_nonexistent',
    });
    assert.equal(r.ok, false);
    assert.equal(r.notFound, true);
  });
});

test('rotateSecret requires orgIdNumeric + id', async () => {
  const noOrg = await webhooks.rotateSecret({ id: 'whk_x' });
  assert.equal(noOrg.ok, false);
  assert.match(noOrg.errors[0], /orgIdNumeric required/);
  const noId = await webhooks.rotateSecret({ orgIdNumeric: 42 });
  assert.equal(noId.ok, false);
  assert.match(noId.errors[0], /id required/);
});

test('rotateSecret mints a fresh whsec_<64 hex> + replaces the stored secret', () => {
  return withInMemoryKv(async (store) => {
    const c = await webhooks.createWebhook({
      orgIdNumeric: 42, label: 'k',
      url: 'https://example.com/hook',
      eventTypes: ['import_request_created'],
    });
    const originalSecret = c.subscription.secret;
    const r = await webhooks.rotateSecret({
      orgIdNumeric: 42, id: c.subscription.id, actorEmailHash: 'admin_hash',
    });
    assert.equal(r.ok, true);
    // New secret matches the documented format + is DIFFERENT
    // from the original. A refactor that returned the same
    // value would break the rotation guarantee silently.
    assert.match(r.secret, /^whsec_[a-f0-9]{64}$/);
    assert.notEqual(r.secret, originalSecret);
    // KV reflects the new secret + rotation stamps.
    const stored = store.get(`webhook:sub:${c.subscription.id}`);
    assert.equal(stored.secret, r.secret);
    assert.ok(stored.secretRotatedAt);
    assert.equal(stored.rotatedByEmailHash, 'admin_hash');
  });
});

test('rotateSecret preserves the rest of the subscription metadata (url + eventTypes + active)', () => {
  // Rotation MUST be a surgical secret-only change. A refactor
  // that re-derived other fields could silently corrupt the
  // event-type filter or the URL.
  return withInMemoryKv(async (store) => {
    const c = await webhooks.createWebhook({
      orgIdNumeric: 42, label: 'preserved',
      url: 'https://example.com/hook',
      eventTypes: ['import_request_created', 'import_request_rated'],
    });
    await webhooks.rotateSecret({ orgIdNumeric: 42, id: c.subscription.id });
    const stored = store.get(`webhook:sub:${c.subscription.id}`);
    assert.equal(stored.url, 'https://example.com/hook');
    assert.deepEqual(stored.eventTypes, ['import_request_created', 'import_request_rated']);
    assert.equal(stored.active, true);
    assert.equal(stored.label, 'preserved');
  });
});

// ── Audit allowlist ──────────────────────────────────────────────

test('events.ALLOWED_TYPES includes webhook_subscription_secret_rotated (silent-drop guard)', () => {
  // Sprint 14 lesson — types not in ALLOWED_TYPES are silently
  // dropped, which would break the handler's
  // audit-log-before-success contract.
  assert.ok(events.ALLOWED_TYPES.has('webhook_subscription_secret_rotated'));
});

// ── Handler ──────────────────────────────────────────────────────

test('Handler routes POST /api/webhooks/<id>/rotate → handleRotateSecret (POST-only)', () => {
  assert.match(HANDLER_SRC, /second === ['"]rotate['"]/);
  assert.match(HANDLER_SRC, /handleRotateSecret\(req, res, ctx, first\)/);
  assert.match(HANDLER_SRC, /rotate requires POST/);
});

test('Handler handleRotateSecret writes webhook_subscription_secret_rotated audit BEFORE 200 (ADR-0005)', () => {
  const block = HANDLER_SRC.match(/async function handleRotateSecret\([\s\S]*?\n\}/);
  assert.ok(block, 'handleRotateSecret body not located');
  const body = block[0];
  assert.match(body, /events\.record\(['"]webhook_subscription_secret_rotated['"]/);
  // Audit failure → 500, NEVER silent success.
  assert.match(body, /Could not record audit event for webhook secret rotate/);
  assert.match(body, /jsonResponse\(res, 500/);
});

test('Handler audit detail OMITS the raw secret (signing material NEVER in audit chain)', () => {
  // Same one-time-reveal discipline as sprint 44 api-keys +
  // sprint 47 webhooks create. Drift-guard against a refactor
  // that widened the detail projection.
  const block = HANDLER_SRC.match(/async function handleRotateSecret\([\s\S]*?\n\}/);
  assert.ok(block);
  const recordCall = block[0].match(/events\.record\(['"]webhook_subscription_secret_rotated['"][\s\S]*?\}\);/);
  assert.ok(recordCall, 'events.record call not located');
  // The audit detail references the label (so the audit reader
  // can correlate); it MUST NOT contain a `secret:` field.
  assert.match(recordCall[0], /label: result\.subscription\.label/);
  assert.ok(!/secret:/.test(recordCall[0]), 'secret leaked into audit detail');
});

test('Handler response surface: subscription stripped of secret + top-level reveal-once secret', () => {
  // The response shape is the contract the UI binds to. The
  // subscription projection MUST NOT carry the secret (it
  // would surface in the list view via the cached projection);
  // the top-level secret IS the one-time-reveal field.
  const block = HANDLER_SRC.match(/async function handleRotateSecret\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /const \{ secret: _omit, \.\.\.safeSub \} = result\.subscription/);
  assert.match(body, /subscription: safeSub/);
  assert.match(body, /secret: result\.secret/);
});

test('Handler 404s on cross-org id mismatch (defence consistency with delete + reactivate + test)', () => {
  // The data-layer returns notFound shape; the handler maps it
  // to 404 (NOT 403 — sprint 18 lesson: never "this exists but
  // isn't yours"). Drift-guard pins the surface.
  const block = HANDLER_SRC.match(/async function handleRotateSecret\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /if \(result\.notFound\) return jsonResponse\(res, 404/);
});

// ── TS mirror ────────────────────────────────────────────────────

test('TS WebhookSubscription extends with secretRotatedAt?: string | null', () => {
  // Optional + nullable for back-compat with sprint-47
  // subscriptions that pre-date the rotation feature.
  assert.match(API_TS, /secretRotatedAt\?: string \| null;/);
});

test('TS WebhookSecretRotateResponse interface defined (subscription + reveal-once secret)', () => {
  assert.match(
    API_TS,
    /export interface WebhookSecretRotateResponse \{[\s\S]*?subscription: WebhookSubscription;[\s\S]*?secret: string;[\s\S]*?\}/,
  );
});

// ── UI ───────────────────────────────────────────────────────────

test('WebhooksPanel renders a Rotate button per subscription row', () => {
  // The button appears alongside Test + Delete in the per-row
  // action group. Pin the button label + the onRotate call.
  const block = INSIGHTS_TSX.match(/function WebhooksPanel\(\)[\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block, 'WebhooksPanel body not located');
  const body = block[0];
  assert.match(body, /onClick=\{\(\) => onRotate\(s\.id, s\.label\)\}/);
  assert.match(body, />\s*Rotate\s*</);
});

test('WebhooksPanel onRotate confirms with a warning explaining the receiver-side impact', () => {
  // Rotation is destructive on the receiver side — old
  // signatures start failing the moment we ship the new key.
  // The confirm() spells that out so an ops admin can't fire
  // it by accident.
  const block = INSIGHTS_TSX.match(/function WebhooksPanel\(\)[\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /confirm\(\s*[\s\S]*?Rotate signing secret/);
  assert.match(body, /receiver must be updated/);
});

test('WebhooksPanel onRotate POSTs to /api/webhooks/<id>/rotate + surfaces the new secret in the reveal-once banner', () => {
  const block = INSIGHTS_TSX.match(/function WebhooksPanel\(\)[\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(
    body,
    /apiPost<WebhookSecretRotateResponse>\(\s*`\/api\/webhooks\/\$\{encodeURIComponent\(id\)\}\/rotate`/,
  );
  // The reveal-once banner is shared with create — drift-guard
  // pins the reuse so a refactor that introduced a separate
  // rotation banner would surface here.
  assert.match(body, /setRevealedSecret\(\{ label: data\.subscription\.label, secret: data\.secret \}\)/);
});
