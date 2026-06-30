'use strict';

// Sprint 48 — production webhook firing.
//
// Sprint 47 shipped the subscription management surface + /test
// endpoint; sprint 48 wires those subscriptions into the live event
// stream. When events.record(type, payload) fires for a
// WEBHOOK_EVENT_TYPES entry, dispatchEvent fans out to every
// subscriber that asked for it.
//
// Tests cover four layers:
//   1. projectEvent + buildEnvelope pure functions: strip chain-
//      stamp metadata (_seq/_hash/_prevHash) + raw email; carry the
//      v:1 envelope contract; include deliveryId for receiver
//      idempotency
//   2. deliverEvent: signs body with subscription secret; sets
//      X-OrcaTrade-* headers (including X-OrcaTrade-Delivery for
//      idempotency); 5s hard timeout via AbortController; captures
//      network failure without throwing
//   3. dispatchEvent: filters by orgId + event type whitelist;
//      reads full sub records (with secret) parallel; only delivers
//      to active subs whose eventTypes include the type;
//      per-subscription failure isolation; writes per-delivery
//      KV log + updates subscription lastDelivery*
//   4. events.record wiring: fires dispatch fire-and-forget AFTER
//      KV write succeeds; require is deferred (circular-dep guard);
//      dispatch failures NEVER propagate to the caller

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('node:fs');
const path = require('node:path');

const dispatch = require('../lib/webhooks-dispatch');
const webhooks = require('../lib/webhooks');

const ROOT = path.resolve(__dirname, '..');
const DISPATCH_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'webhooks-dispatch.js'), 'utf8');
const EVENTS_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'events.js'), 'utf8');

// ── projectEvent + buildEnvelope ──────────────────────────────────

test('projectEvent strips chain-stamp internals (_seq, _hash, _prevHash)', () => {
  // The chain stamps are tamper-detection metadata, NOT customer
  // content. Same posture as sprint-35 redactTimelineEvent in
  // the audit CSV export.
  const e = {
    type: 'import_request_created',
    at: '2026-01-01T00:00:00Z',
    _seq: 42, _hash: 'abc', _prevHash: 'def',
    detail: { label: 'hi' },
  };
  const projected = dispatch.projectEvent(e);
  assert.equal(projected._seq, undefined);
  assert.equal(projected._hash, undefined);
  assert.equal(projected._prevHash, undefined);
  assert.equal(projected.type, 'import_request_created');
  assert.deepEqual(projected.detail, { label: 'hi' });
});

test('projectEvent strips raw email if present (PII guard)', () => {
  // No internal callsite passes raw email today, but a future
  // payload could. Same defensive strip as the audit redactor.
  const projected = dispatch.projectEvent({
    type: 'import_request_message_posted',
    email: 'someone@example.com',
    actorEmailHash: 'abc123',
  });
  assert.equal(projected.email, undefined);
  assert.equal(projected.actorEmailHash, 'abc123');
});

test('buildEnvelope produces the v:1 contract shape', () => {
  // The envelope contract subscribers verify against. v:1 is
  // load-bearing — a future contract change MUST bump the version
  // so receivers pinning to v:1 keep working.
  const env = dispatch.buildEnvelope({
    event: { type: 'import_request_created', at: '2026-01-01T00:00:00Z', orgId: 42 },
    subscription: { id: 'whk_test1234' },
    deliveryId: 'del_test',
    nowIso: '2026-01-02T00:00:00Z',
  });
  assert.equal(env.v, 1);
  assert.equal(env.type, 'import_request_created');
  assert.equal(env.deliveryId, 'del_test');
  assert.equal(env.deliveredAt, '2026-01-02T00:00:00Z');
  assert.equal(env.subscriptionId, 'whk_test1234');
  assert.equal(env.event.type, 'import_request_created');
});

test('generateDeliveryId produces del_<16 hex> (distinct from whk_/ot_)', () => {
  const id = dispatch.generateDeliveryId();
  assert.match(id, /^del_[a-f0-9]{16}$/);
});

// ── deliverEvent — fetch stub ──────────────────────────────────────

test('deliverEvent signs body with subscription secret + sets X-OrcaTrade-* headers (incl X-OrcaTrade-Delivery)', async () => {
  /** @type {any} */
  const captured = {};
  const fakeFetch = async (url, opts) => {
    captured.url = url;
    captured.headers = opts.headers;
    captured.body = opts.body;
    return { ok: true, status: 204 };
  };
  const sub = {
    id: 'whk_abcdef1234567890',
    secret: 'whsec_' + 'a'.repeat(64),
    url: 'https://example.com/hook',
  };
  const event = {
    type: 'import_request_created',
    at: '2026-01-01T00:00:00Z',
    orgId: 42,
    entityId: 'ir_test',
  };
  const r = await dispatch.deliverEvent({ subscription: sub, event, fetchImpl: fakeFetch });
  assert.equal(r.ok, true);
  assert.equal(r.status, 204);
  // Signature is HMAC-SHA256 over the body using the secret.
  const expected = crypto.createHmac('sha256', sub.secret).update(captured.body).digest('hex');
  assert.equal(captured.headers['X-OrcaTrade-Signature'], expected);
  assert.equal(captured.headers['X-OrcaTrade-Event'], 'import_request_created');
  assert.equal(captured.headers['X-OrcaTrade-Subscription'], sub.id);
  // X-OrcaTrade-Delivery is what receivers use for idempotency keys.
  assert.match(captured.headers['X-OrcaTrade-Delivery'], /^del_[a-f0-9]{16}$/);
});

test('deliverEvent captures network failure as { ok:false, error } — no throw', async () => {
  const fakeFetch = async () => { throw new Error('ECONNREFUSED'); };
  const sub = {
    id: 'whk_abcdef1234567890',
    secret: 'whsec_' + 'b'.repeat(64),
    url: 'https://example.com/hook',
  };
  const r = await dispatch.deliverEvent({
    subscription: sub,
    event: { type: 'import_request_created', orgId: 42 },
    fetchImpl: fakeFetch,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /ECONNREFUSED/);
});

test('deliverEvent timeout surfaces as { timedOut: true } with 5s window', async () => {
  // The DELIVERY_TIMEOUT_MS constant is the rate-limit — pin both
  // the value (5000) AND the timedOut flag surfaced from
  // AbortController.
  assert.equal(dispatch.DELIVERY_TIMEOUT_MS, 5000);
  // We can't realistically test the 5-second wait in a unit test;
  // instead the timeout-handling source path is pinned.
  assert.match(DISPATCH_SRC, /controller\.abort\(\)/);
  assert.match(DISPATCH_SRC, /timedOut = true/);
});

// ── dispatchEvent — KV stub fan-out ───────────────────────────────

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

test('dispatchEvent short-circuits when type is NOT in WEBHOOK_EVENT_TYPES', async () => {
  // Internal lifecycle types (auth_*, scim_*, sso_*) MUST NOT leak
  // to customer endpoints. Drift-guard against a refactor that
  // dropped the whitelist filter.
  const r = await dispatch.dispatchEvent({
    event: { type: 'auth_signin_succeeded', orgId: 42 },
  });
  assert.equal(r.attempted, 0);
  assert.equal(r.reason, 'type-not-dispatched');
});

test('dispatchEvent short-circuits when event has no orgId (defensive)', async () => {
  const r = await dispatch.dispatchEvent({
    event: { type: 'import_request_created' },
  });
  assert.equal(r.attempted, 0);
  assert.equal(r.reason, 'no-org');
});

test('dispatchEvent fans out to ONLY active subs whose eventTypes include this type', () => {
  return withInMemoryKv(async (store) => {
    /** @type {Array<{url: string, headers: any, body: string}>} */
    const calls = [];
    const fakeFetch = async (url, opts) => {
      calls.push({ url, headers: opts.headers, body: opts.body });
      return { ok: true, status: 200 };
    };
    // Seed two subs — one subscribed to created, one to rated.
    await webhooks.createWebhook({
      orgIdNumeric: 42, label: 'Created sub',
      url: 'https://example.com/created',
      eventTypes: ['import_request_created'],
    });
    await webhooks.createWebhook({
      orgIdNumeric: 42, label: 'Rated sub',
      url: 'https://example.com/rated',
      eventTypes: ['import_request_rated'],
    });
    const r = await dispatch.dispatchEvent({
      event: { type: 'import_request_created', orgId: 42, at: '2026-01-01T00:00:00Z' },
      fetchImpl: fakeFetch,
    });
    assert.equal(r.attempted, 1, 'only the created sub should be hit');
    assert.equal(r.succeeded, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://example.com/created');
    // The KV delivery log entry exists.
    const deliveryKeys = [...store.keys()].filter((k) => k.startsWith('webhook:delivery:'));
    assert.equal(deliveryKeys.length, 1);
    // The subscription's lastDeliveryStatus updated.
    const subKeys = [...store.keys()].filter((k) => k.startsWith('webhook:sub:'));
    const createdSub = [...store.values()].find((v) => v && v.label === 'Created sub');
    assert.match(createdSub.lastDeliveryStatus, /^delivered \(200\)$/);
    void subKeys; // referenced for clarity
  });
});

test('dispatchEvent per-subscription failure isolation (one slow customer does NOT block another)', () => {
  return withInMemoryKv(async () => {
    const fakeFetch = async (url) => {
      if (url.includes('bad')) throw new Error('ECONNREFUSED');
      return { ok: true, status: 204 };
    };
    await webhooks.createWebhook({
      orgIdNumeric: 42, label: 'Good sub',
      url: 'https://example.com/good',
      eventTypes: ['import_request_created'],
    });
    await webhooks.createWebhook({
      orgIdNumeric: 42, label: 'Bad sub',
      url: 'https://example.com/bad',
      eventTypes: ['import_request_created'],
    });
    const r = await dispatch.dispatchEvent({
      event: { type: 'import_request_created', orgId: 42 },
      fetchImpl: fakeFetch,
    });
    assert.equal(r.attempted, 2);
    assert.equal(r.succeeded, 1, 'good sub should succeed; bad sub should fail without blocking');
  });
});

test('dispatchEvent does NOT deliver to subs in a DIFFERENT org (cross-org isolation)', () => {
  return withInMemoryKv(async () => {
    const calls = [];
    const fakeFetch = async (url) => {
      calls.push(url);
      return { ok: true, status: 200 };
    };
    await webhooks.createWebhook({
      orgIdNumeric: 42, label: 'Our sub',
      url: 'https://example.com/our',
      eventTypes: ['import_request_created'],
    });
    await webhooks.createWebhook({
      orgIdNumeric: 999, label: 'Other org sub',
      url: 'https://example.com/other',
      eventTypes: ['import_request_created'],
    });
    const r = await dispatch.dispatchEvent({
      event: { type: 'import_request_created', orgId: 42 },
      fetchImpl: fakeFetch,
    });
    assert.equal(r.attempted, 1);
    assert.deepEqual(calls, ['https://example.com/our']);
  });
});

test('dispatchEvent records per-delivery KV log entries with 7-day TTL', () => {
  // Per-delivery log is observability for ops + future
  // /api/webhooks/<id>/deliveries surface. TTL constant pinned so
  // a refactor can't silently widen retention (KV cost) or shorten
  // it (lost visibility).
  assert.equal(dispatch.DELIVERY_TTL_SECONDS, 7 * 24 * 60 * 60);
  // Source-pin the kv.set TTL passthrough.
  assert.match(DISPATCH_SRC, /ttlSeconds: DELIVERY_TTL_SECONDS/);
});

// ── events.record → dispatch wiring ────────────────────────────────

test('events.record fires dispatchEvent fire-and-forget AFTER the KV write', () => {
  // Critical wiring: dispatch MUST run AFTER the durable KV write
  // (so a failed dispatch doesn't lose the audit row). Drift-guard
  // pins both the existence + ordering.
  const recordBody = EVENTS_SRC.match(/async function record\(type, payload[\s\S]*?\nasync function /);
  assert.ok(recordBody, 'record() body not located');
  const body = recordBody[0];
  // KV write block.
  const kvSetIdx = body.indexOf('kv.set(EVENT_LOG_KEY');
  const dispatchIdx = body.indexOf('webhooks-dispatch');
  assert.ok(kvSetIdx >= 0, 'EVENT_LOG_KEY write not located');
  assert.ok(dispatchIdx >= 0, 'webhooks-dispatch wiring not located');
  assert.ok(kvSetIdx < dispatchIdx, 'dispatch must run AFTER the KV write');
});

test('events.record dispatch is fire-and-forget (Promise.resolve().then().catch() pattern)', () => {
  // The dispatch HTTP calls can each take up to 5s; the caller
  // (handler that recorded the event) MUST NOT wait on them.
  // Drift-guard against a refactor that accidentally awaited the
  // dispatch.
  const recordBody = EVENTS_SRC.match(/async function record\(type, payload[\s\S]*?\nasync function /);
  assert.ok(recordBody);
  const body = recordBody[0];
  assert.match(body, /Promise\.resolve\(\)\.then\(\(\) => \{[\s\S]*?dispatchEvent\(\{ event \}\)/);
  // The .catch swallows so dispatch errors NEVER propagate.
  assert.match(body, /\.catch\(\(\) => \{ \/\* never propagate to caller \*\/ \}\)/);
});

test('events.record uses deferred require for webhooks-dispatch (circular-dep guard)', () => {
  // webhooks-dispatch reads events.ALLOWED_TYPES at boot; if events.js
  // required webhooks-dispatch at the top, we'd have a circular dep
  // initialised in an undefined order. Deferred require inside the
  // .then() callback runs only when the event fires + by then both
  // modules are fully loaded.
  const recordBody = EVENTS_SRC.match(/async function record\(type, payload[\s\S]*?\nasync function /);
  assert.ok(recordBody);
  const body = recordBody[0];
  assert.match(body, /const \{ dispatchEvent \} = require\(['"]\.\/webhooks-dispatch['"]\)/);
});

test('Module re-exports the public dispatchEvent + deliverEvent + helpers', () => {
  assert.equal(typeof dispatch.dispatchEvent, 'function');
  assert.equal(typeof dispatch.deliverEvent, 'function');
  assert.equal(typeof dispatch.projectEvent, 'function');
  assert.equal(typeof dispatch.buildEnvelope, 'function');
  assert.equal(typeof dispatch.generateDeliveryId, 'function');
});
