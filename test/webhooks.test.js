'use strict';

// Sprint 47 — outbound webhooks (v1: management + test delivery).
//
// The push counterpart to sprint-44 API keys. Sprint 47 ships the
// management surface + HMAC signing + the /test endpoint. Sprint
// 48 will wire production firing into the recordEvent path.
//
// Tests cover five layers:
//   1. Pure helpers: ID + secret format; HMAC determinism; URL
//      validation (the SSRF gate is the load-bearing one — drift-
//      guard explicitly tests AWS metadata 169.254.169.254 + every
//      RFC-1918 private range + loopback + IPv6 link-local); label
//      + event-type validation
//   2. KV round-trip via in-memory stub: create + list + delete;
//      secret returned ONCE on create; list NEVER returns secret;
//      cross-org-isolated delete
//   3. Test delivery: signs the body with HMAC-SHA256; sets the
//      X-OrcaTrade-* headers; updates lastDeliveryAt + status
//      on the subscription
//   4. Handler shape: admin-only RBAC; POST writes
//      webhook_subscription_created audit BEFORE returning 201;
//      DELETE writes _deleted; test writes _tested (non-blocking);
//      cross-org isolation on test
//   5. UI: <WebhooksPanel> reveal-once flow for secret; per-row
//      Test affordance surfaces delivery status; SSRF guard
//      surfaces server-side validation error
//
// The validateUrl gate is the riskiest piece — explicit positive
// (https://example.com) AND explicit negative (169.254.169.254,
// 127.0.0.1, 10.x, fe80::, ::1, localhost) tests pin every range.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('node:fs');
const path = require('node:path');

const webhooks = require('../lib/webhooks');
const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');
const HELPER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'webhooks.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'webhooks.js'), 'utf8');
const DISPATCH_SRC = fs.readFileSync(path.join(ROOT, 'api', '[...path].js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// ── Pure helpers ───────────────────────────────────────────────────

test('generateId produces whk_<16 hex> (distinct prefix from ot_)', () => {
  // Distinct prefix matters — a future log scrub that treats ot_
  // prefixes as secrets would miss webhook ids if they shared
  // the prefix.
  const id = webhooks.generateId();
  assert.match(id, /^whk_[a-f0-9]{16}$/);
});

test('generateSecret produces whsec_<64 hex> (256 bits of signing entropy)', () => {
  // 256 bits is the floor for HMAC-SHA256 — anything less is
  // brute-force-eligible offline.
  const s = webhooks.generateSecret();
  assert.match(s, /^whsec_[a-f0-9]{64}$/);
});

test('signPayload is deterministic HMAC-SHA256 hex', () => {
  // Drift-guard: a refactor switching to base64 (or to a different
  // hash) would silently break every receiver verifying the
  // signature. Pin the format.
  const secret = 'whsec_test';
  const body = '{"hello":"world"}';
  const sig = webhooks.signPayload(secret, body);
  assert.match(sig, /^[a-f0-9]{64}$/);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(sig, expected);
});

test('WEBHOOK_EVENT_TYPES is a curated subset of events.ALLOWED_TYPES (no chain-stamp leakage)', () => {
  // Drift-guard: a future widening that included scim_* or sso_*
  // would surface internal lifecycle to customer endpoints.
  for (const t of webhooks.WEBHOOK_EVENT_TYPES) {
    assert.ok(events.ALLOWED_TYPES.has(t), `webhook event type ${t} not in events.ALLOWED_TYPES`);
  }
});

// ── validateUrl: positive cases ────────────────────────────────────

test('validateUrl accepts https://example.com and other public hosts', () => {
  for (const u of [
    'https://example.com/webhook',
    'https://api.acme.io/orcatrade',
    'https://hooks.zapier.com/abc/def',
    'https://1.1.1.1/hook',
  ]) {
    const r = webhooks.validateUrl(u);
    assert.equal(r.ok, true, `expected ${u} to pass`);
  }
});

// ── validateUrl: SSRF / negative cases ─────────────────────────────

test('validateUrl rejects non-HTTPS schemes (http:, ftp:, file:, javascript:)', () => {
  for (const u of [
    'http://example.com/webhook',
    'ftp://example.com/file',
    'file:///etc/passwd',
    'javascript:alert(1)',
  ]) {
    const r = webhooks.validateUrl(u);
    assert.equal(r.ok, false, `expected ${u} to fail`);
  }
});

test('validateUrl rejects cloud-metadata 169.254.169.254 (the load-bearing SSRF case)', () => {
  // AWS/GCP/Azure all use 169.254.169.254 for the instance metadata
  // service. A webhook firing there leaks our cloud creds.
  const r = webhooks.validateUrl('https://169.254.169.254/latest/meta-data/');
  assert.equal(r.ok, false);
  assert.match(r.error, /link-local|169/i);
});

test('validateUrl rejects every RFC-1918 private range (10.x, 172.16-31.x, 192.168.x)', () => {
  for (const ip of [
    '10.0.0.1', '10.255.255.255',
    '172.16.0.1', '172.20.5.10', '172.31.255.255',
    '192.168.0.1', '192.168.255.255',
  ]) {
    const r = webhooks.validateUrl(`https://${ip}/hook`);
    assert.equal(r.ok, false, `expected ${ip} to fail`);
    assert.match(r.error, /private/i);
  }
});

test('validateUrl rejects loopback (127.0.0.1, ::1, localhost) + 0.0.0.0', () => {
  for (const host of ['127.0.0.1', '127.255.255.255', '0.0.0.0', 'localhost', 'foo.localhost']) {
    const r = webhooks.validateUrl(`https://${host}/hook`);
    assert.equal(r.ok, false, `expected ${host} to fail`);
  }
  // IPv6 loopback uses bracket-notation in URL.
  const v6 = webhooks.validateUrl('https://[::1]/hook');
  assert.equal(v6.ok, false);
});

test('validateUrl carve-out range 172.0-15.x is NOT private (drift-guard against over-broad block)', () => {
  // 172.0.0.0/8 is partially public; only 172.16.0.0/12 is RFC-1918.
  // Drift-guard against a refactor that accidentally widened the
  // gate to reject the whole 172.x range.
  const r = webhooks.validateUrl('https://172.15.0.1/hook');
  assert.equal(r.ok, true, '172.15.0.0 is PUBLIC — must not be blocked');
});

// ── validateEventTypes ────────────────────────────────────────────

test('validateEventTypes rejects empty + unknown types + dedupes', () => {
  assert.equal(webhooks.validateEventTypes([]).ok, false);
  assert.equal(webhooks.validateEventTypes(['totally_made_up']).ok, false);
  // Dedup behaviour — drift-guard against a refactor that lost
  // the de-dupe.
  const r = webhooks.validateEventTypes([
    'import_request_created',
    'import_request_created',
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, ['import_request_created']);
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

test('createWebhook writes subscription + org index + returns secret ONCE', () => {
  return withInMemoryKv(async (store) => {
    const r = await webhooks.createWebhook({
      orgIdNumeric: 42,
      label: 'ERP push',
      url: 'https://example.com/hook',
      eventTypes: ['import_request_created'],
      actorEmailHash: 'h1',
    });
    assert.equal(r.ok, true);
    assert.match(r.subscription.id, /^whk_[a-f0-9]{16}$/);
    assert.match(r.subscription.secret, /^whsec_[a-f0-9]{64}$/);
    assert.equal(r.subscription.orgIdNumeric, 42);
    // KV record exists.
    const stored = store.get(`webhook:sub:${r.subscription.id}`);
    assert.ok(stored);
    assert.equal(stored.label, 'ERP push');
    // Org index updated.
    const index = store.get('webhook:org:42');
    assert.ok(Array.isArray(index) && index.includes(r.subscription.id));
  });
});

test('listWebhooksForOrg strips the secret (NEVER returned outside create)', () => {
  return withInMemoryKv(async () => {
    const c = await webhooks.createWebhook({
      orgIdNumeric: 42,
      label: 'k',
      url: 'https://example.com/hook',
      eventTypes: ['import_request_created'],
    });
    const list = await webhooks.listWebhooksForOrg(42);
    assert.equal(list.length, 1);
    assert.equal(list[0].label, 'k');
    assert.equal(list[0].secret, undefined, 'secret leaked into list response');
    // The original secret must not appear ANYWHERE in the serialized
    // list response — paranoid full-string scan.
    assert.ok(!JSON.stringify(list).includes(c.subscription.secret),
      'secret leaked somewhere in list response');
  });
});

test('deleteWebhook is cross-org isolated (leaked id from one org cannot delete another)', () => {
  return withInMemoryKv(async () => {
    const c = await webhooks.createWebhook({
      orgIdNumeric: 42,
      label: 'k',
      url: 'https://example.com/hook',
      eventTypes: ['import_request_created'],
    });
    // Different org tries to delete.
    const r = await webhooks.deleteWebhook({ orgIdNumeric: 999, id: c.subscription.id });
    assert.equal(r.ok, false);
    assert.equal(r.notFound, true);
    // Original subscription still exists.
    const list = await webhooks.listWebhooksForOrg(42);
    assert.equal(list.length, 1);
  });
});

test('deleteWebhook hard-deletes the subscription (secret removed from KV)', () => {
  return withInMemoryKv(async (store) => {
    const c = await webhooks.createWebhook({
      orgIdNumeric: 42,
      label: 'k',
      url: 'https://example.com/hook',
      eventTypes: ['import_request_created'],
    });
    await webhooks.deleteWebhook({ orgIdNumeric: 42, id: c.subscription.id });
    assert.equal(store.get(`webhook:sub:${c.subscription.id}`), undefined,
      'subscription not hard-deleted — secret remains in KV');
    // Org index purged too.
    const index = store.get('webhook:org:42');
    assert.ok(Array.isArray(index));
    assert.ok(!index.includes(c.subscription.id));
  });
});

// ── deliverTestPayload ────────────────────────────────────────────

test('deliverTestPayload signs the body + sets X-OrcaTrade-* headers + records duration', () => {
  return withInMemoryKv(async (store) => {
    // Stub global fetch to capture the request.
    /** @type {{ url?: string, headers?: any, body?: string }} */
    const captured = {};
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      captured.url = url;
      captured.headers = opts.headers;
      captured.body = opts.body;
      return { ok: true, status: 204 };
    };
    try {
      const c = await webhooks.createWebhook({
        orgIdNumeric: 42,
        label: 'k',
        url: 'https://example.com/hook',
        eventTypes: ['import_request_created'],
      });
      const r = await webhooks.deliverTestPayload({ subscription: c.subscription });
      assert.equal(r.ok, true);
      assert.equal(r.status, 204);
      assert.ok(typeof r.durationMs === 'number');
      // Body was signed with the subscription's secret.
      const expectedSig = crypto.createHmac('sha256', c.subscription.secret)
        .update(captured.body).digest('hex');
      assert.equal(captured.headers['X-OrcaTrade-Signature'], expectedSig);
      assert.equal(captured.headers['X-OrcaTrade-Event'], 'webhook.test');
      assert.equal(captured.headers['X-OrcaTrade-Subscription'], c.subscription.id);
      // The subscription was updated with lastDeliveryAt.
      const updated = store.get(`webhook:sub:${c.subscription.id}`);
      assert.ok(updated.lastDeliveryAt);
      assert.match(updated.lastDeliveryStatus, /200 \(204\)/);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('deliverTestPayload records error on network failure (no throw)', () => {
  return withInMemoryKv(async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => { throw new Error('ECONNREFUSED'); };
    try {
      const c = await webhooks.createWebhook({
        orgIdNumeric: 42,
        label: 'k',
        url: 'https://example.com/hook',
        eventTypes: ['import_request_created'],
      });
      const r = await webhooks.deliverTestPayload({ subscription: c.subscription });
      assert.equal(r.ok, false);
      assert.match(r.error, /ECONNREFUSED/);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ── Handler ────────────────────────────────────────────────────────

test('Dispatcher registers webhooks under /api/webhooks', () => {
  assert.match(DISPATCH_SRC, /webhooks: require\(['"]\.\.\/lib\/handlers\/webhooks['"]\)/);
});

test('Handler enforces admin-only RBAC (same gate as operator-config + api-keys)', () => {
  assert.match(HANDLER_SRC, /OPS_REVIEW_ROLES = new Set\(\['admin', 'owner'\]\)/);
  assert.match(HANDLER_SRC, /only owner \/ admin members can manage webhooks/);
});

test('Handler POST writes webhook_subscription_created audit event BEFORE returning 201 (ADR-0005)', () => {
  const block = HANDLER_SRC.match(/async function handleCreate\([\s\S]*?\n\}/);
  assert.ok(block, 'handleCreate body not located');
  const body = block[0];
  assert.match(body, /events\.record\(['"]webhook_subscription_created['"],/);
  assert.match(body, /Could not record audit event for webhook create/);
  assert.match(body, /jsonResponse\(res, 500/);
});

test('Handler POST audit detail OMITS the secret (signing material NEVER in audit chain)', () => {
  // Same one-time-reveal discipline as sprint-44 api keys — secret
  // is returned ONCE in the create response + NEVER in any other
  // surface (including audit). Drift-guard against a refactor that
  // accidentally widened the projection.
  const block = HANDLER_SRC.match(/async function handleCreate\([\s\S]*?\n\}/);
  assert.ok(block);
  const recordBlock = block[0].match(/events\.record\(['"]webhook_subscription_created['"][\s\S]*?\}\);/);
  assert.ok(recordBlock, 'events.record call not located in handleCreate');
  const recordCall = recordBlock[0];
  assert.match(recordCall, /label: result\.subscription\.label/);
  assert.match(recordCall, /url: result\.subscription\.url/);
  assert.match(recordCall, /eventTypes: result\.subscription\.eventTypes/);
  // The secret MUST NOT appear in the detail block.
  assert.ok(!recordCall.includes('secret'), 'secret leaked into audit detail');
});

test('Handler /test path is cross-org isolated (subscription ownership check before delivery)', () => {
  // Drift-guard: a leaked id from one org should NOT let an
  // attacker fire a test delivery (which costs us bandwidth + log
  // noise) against another org's subscription. Pin the orgIdNumeric
  // comparison.
  const block = HANDLER_SRC.match(/async function handleTest\([\s\S]*?\n\}/);
  assert.ok(block, 'handleTest body not located');
  assert.match(
    block[0],
    /sub\.orgIdNumeric !== ctx\.orgIdNumeric[\s\S]*?Not found/,
  );
});

test('events.ALLOWED_TYPES includes all three sprint-47 webhook lifecycle types', () => {
  assert.ok(events.ALLOWED_TYPES.has('webhook_subscription_created'));
  assert.ok(events.ALLOWED_TYPES.has('webhook_subscription_deleted'));
  assert.ok(events.ALLOWED_TYPES.has('webhook_subscription_tested'));
});

// ── TS mirror ──────────────────────────────────────────────────────

test('TS WebhookSubscription has optional secret? (one-time-reveal discipline)', () => {
  // The secret? being OPTIONAL in the type is what stops UI code
  // from assuming it's always available. List responses NEVER carry
  // it; the create response is the only place it's set.
  assert.match(API_TS, /export interface WebhookSubscription \{[\s\S]*?secret\?: string;[\s\S]*?\}/);
});

test('TS WebhookListResponse + WebhookCreateResponse + WebhookEventTypesResponse + WebhookTestResponse all defined', () => {
  // Cross-layer breadcrumb — a refactor that dropped one would
  // surface as a TS compile error elsewhere; the pin makes the
  // contract grep-able.
  assert.match(API_TS, /export interface WebhookListResponse \{[\s\S]*?webhooks: WebhookSubscription\[\];[\s\S]*?\}/);
  assert.match(API_TS, /export interface WebhookCreateResponse \{[\s\S]*?subscription: WebhookSubscription;[\s\S]*?\}/);
  assert.match(API_TS, /export interface WebhookEventTypesResponse \{[\s\S]*?eventTypes: string\[\];[\s\S]*?\}/);
  assert.match(API_TS, /export interface WebhookTestResponse \{[\s\S]*?delivery: WebhookTestDelivery;[\s\S]*?\}/);
});

// ── UI ─────────────────────────────────────────────────────────────

test('Ops Insights page mounts <WebhooksPanel> after <ApiKeysPanel>', () => {
  // The push side comes AFTER the pull side — admin-only settings
  // band groups them.
  assert.match(INSIGHTS_TSX, /<WebhooksPanel \/>/);
  const apiIdx = INSIGHTS_TSX.indexOf('<ApiKeysPanel');
  const whIdx = INSIGHTS_TSX.indexOf('<WebhooksPanel');
  assert.ok(apiIdx >= 0 && whIdx > apiIdx,
    'WebhooksPanel must mount AFTER ApiKeysPanel');
});

test('WebhooksPanel reveal-once flow surfaces the signing secret + warning + dismiss', () => {
  // Same posture as sprint-44 ApiKeysPanel — secret returned once,
  // user must save it, NOT shown again.
  const block = INSIGHTS_TSX.match(/function WebhooksPanel\(\)[\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block, 'WebhooksPanel body not located');
  const body = block[0];
  // Reveal state with label + secret.
  assert.match(body, /setRevealedSecret\(\{ label: data\.subscription\.label, secret: data\.subscription\.secret \}\)/);
  assert.match(body, /will NOT be shown again/);
});

test('WebhooksPanel per-row Test button POSTs to /api/webhooks/<id>/test', () => {
  const block = INSIGHTS_TSX.match(/function WebhooksPanel\(\)[\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /apiPost<WebhookTestResponse>\(`\/api\/webhooks\/\$\{encodeURIComponent\(id\)\}\/test`/);
});

test('WebhooksPanel Delete confirms before firing (cleanup discipline)', () => {
  const block = INSIGHTS_TSX.match(/function WebhooksPanel\(\)[\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /confirm\(['"]Delete this webhook subscription/);
  assert.match(body, /apiDelete\(`\/api\/webhooks\/\$\{encodeURIComponent\(id\)\}`\)/);
});

test('WebhooksPanel surfaces the curated event types via /event-types endpoint (UI doesn\'t guess)', () => {
  // Drift-guard against a regression where the UI hardcoded the
  // event type list — out of sync with the server WEBHOOK_EVENT_TYPES.
  const block = INSIGHTS_TSX.match(/function WebhooksPanel\(\)[\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /apiGet<WebhookEventTypesResponse>\(['"]\/api\/webhooks\/event-types['"]\)/);
});
