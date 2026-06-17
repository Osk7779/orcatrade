'use strict';

// Sprint 49 — webhook deliveries log surface.
//
// Sprint 48 wrote per-delivery log entries to KV
// (webhook:delivery:<id>) but no way to read them back without a
// SCAN. Sprint 49 adds the per-subscription delivery INDEX (a
// capped, newest-first list of delivery ids) + a GET endpoint +
// inline UI panel. Completes the webhook story: manage → fire →
// observe.
//
// Tests cover four layers:
//   1. Constants + helper: DELIVERY_INDEX_PREFIX + DELIVERY_INDEX_CAP
//      = 100; recordDeliveryLog pushes to the index newest-first +
//      caps the list; listDeliveriesForSubscription reads the index
//      + fetches in parallel + filters TTL-aged-out nulls
//   2. KV round-trip via in-memory stub: dispatchEvent through
//      multiple events writes both the log entries AND the index;
//      the index is per-subscription (not per-org); cap holds at
//      100 even after 101+ deliveries
//   3. Handler /deliveries endpoint: cross-org isolation (404 on
//      foreign org); GET-only (other methods 405); ?limit clamped
//      to the helper's cap; reads the dispatch's list helper
//   4. UI: <WebhooksPanel> Deliveries toggle per row; lazy load
//      on expand; renders ✓/✗ + event type + status + ms;
//      caches per-id so a re-expand is instant

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dispatch = require('../lib/webhooks-dispatch');
const webhooks = require('../lib/webhooks');

const ROOT = path.resolve(__dirname, '..');
const DISPATCH_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'webhooks-dispatch.js'), 'utf8');
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

// ── Constants ──────────────────────────────────────────────────────

test('DELIVERY_INDEX_PREFIX exported as webhook:delivery-index:', () => {
  // Distinct prefix from webhook:delivery: so the lint test +
  // KV scans can tell entries from indexes apart.
  assert.equal(dispatch.DELIVERY_INDEX_PREFIX, 'webhook:delivery-index:');
});

test('DELIVERY_INDEX_CAP exported as 100 (newest-first, oldest dropped)', () => {
  // A high-volume subscription doesn't grow the index unbounded.
  // 100 keeps the UI scannable + the read latency bounded.
  assert.equal(dispatch.DELIVERY_INDEX_CAP, 100);
});

// ── recordDeliveryLog → index push ─────────────────────────────────

test('recordDeliveryLog pushes the delivery ID to the per-subscription index (newest-first)', () => {
  return withInMemoryKv(async (store) => {
    await dispatch.recordDeliveryLog(
      { deliveryId: 'del_a', subId: 'whk_test', deliveredAt: '2026-01-01T00:00:00Z',
        ok: true, status: 200, error: null, timedOut: false, durationMs: 5 },
      'import_request_created',
    );
    await dispatch.recordDeliveryLog(
      { deliveryId: 'del_b', subId: 'whk_test', deliveredAt: '2026-01-02T00:00:00Z',
        ok: true, status: 200, error: null, timedOut: false, durationMs: 7 },
      'import_request_rated',
    );
    const index = store.get('webhook:delivery-index:whk_test');
    assert.ok(Array.isArray(index));
    // Newest-first — del_b was last recorded, must be FIRST.
    assert.deepEqual(index, ['del_b', 'del_a']);
  });
});

test('recordDeliveryLog caps the index at 100 entries (oldest dropped)', () => {
  return withInMemoryKv(async (store) => {
    // Push 105 entries. The 5 oldest should be evicted.
    for (let i = 0; i < 105; i += 1) {
      await dispatch.recordDeliveryLog(
        { deliveryId: `del_${i}`, subId: 'whk_test', deliveredAt: `2026-01-${i}T00:00:00Z`,
          ok: true, status: 200, error: null, timedOut: false, durationMs: 1 },
        'import_request_created',
      );
    }
    const index = store.get('webhook:delivery-index:whk_test');
    assert.equal(index.length, 100);
    // Newest (del_104) at the top; oldest 5 (del_0 through del_4) dropped.
    assert.equal(index[0], 'del_104');
    assert.ok(!index.includes('del_0'));
    assert.ok(!index.includes('del_4'));
    assert.ok(index.includes('del_5'));
  });
});

test('recordDeliveryLog index write passes ttlSeconds (apex P1.14 TTL hygiene)', () => {
  // Drift-guard against the repo-wide TTL-hygiene lint test.
  // Apex P1.14: every kv.set on an ephemeral key passes
  // ttlSeconds. The index is ephemeral; a permanently-stored
  // index would grow forever after a TTL'd entry vanished.
  assert.match(DISPATCH_SRC, /DELIVERY_INDEX_PREFIX[\s\S]*?ttlSeconds: DELIVERY_TTL_SECONDS/);
});

// ── listDeliveriesForSubscription ──────────────────────────────────

test('listDeliveriesForSubscription returns entries newest-first', () => {
  return withInMemoryKv(async () => {
    for (let i = 0; i < 3; i += 1) {
      await dispatch.recordDeliveryLog(
        { deliveryId: `del_${i}`, subId: 'whk_a', deliveredAt: `2026-01-0${i + 1}T00:00:00Z`,
          ok: true, status: 200, error: null, timedOut: false, durationMs: 10 + i },
        'import_request_created',
      );
    }
    const list = await dispatch.listDeliveriesForSubscription({ subscriptionId: 'whk_a' });
    assert.equal(list.length, 3);
    assert.equal(list[0].deliveryId, 'del_2'); // newest
    assert.equal(list[2].deliveryId, 'del_0'); // oldest
  });
});

test('listDeliveriesForSubscription filters TTL-aged-out nulls (entry in index but no body)', () => {
  return withInMemoryKv(async (store) => {
    // Seed the index with two ids; only one has a body entry.
    store.set('webhook:delivery-index:whk_test', ['del_alive', 'del_aged_out']);
    store.set('webhook:delivery:del_alive', {
      deliveryId: 'del_alive', subscriptionId: 'whk_test',
      eventType: 'import_request_created',
      deliveredAt: '2026-01-01T00:00:00Z',
      ok: true, status: 200, error: null, timedOut: false, durationMs: 5,
    });
    // del_aged_out has no body entry — simulates TTL eviction.
    const list = await dispatch.listDeliveriesForSubscription({ subscriptionId: 'whk_test' });
    assert.equal(list.length, 1);
    assert.equal(list[0].deliveryId, 'del_alive');
  });
});

test('listDeliveriesForSubscription clamps limit to [1, DELIVERY_INDEX_CAP]', () => {
  return withInMemoryKv(async (store) => {
    // Seed 50 entries.
    const ids = Array.from({ length: 50 }, (_, i) => `del_${i}`);
    store.set('webhook:delivery-index:whk_t', ids);
    for (const id of ids) {
      store.set(`webhook:delivery:${id}`, {
        deliveryId: id, subscriptionId: 'whk_t', eventType: 'import_request_created',
        deliveredAt: '2026-01-01T00:00:00Z',
        ok: true, status: 200, error: null, timedOut: false, durationMs: 1,
      });
    }
    // Request more than DELIVERY_INDEX_CAP — clamped to 100 but
    // only 50 entries exist.
    const big = await dispatch.listDeliveriesForSubscription({ subscriptionId: 'whk_t', limit: 999 });
    assert.equal(big.length, 50);
    // Request 0 or negative — coerced to 1 minimum (then the slice
    // returns 1 entry from the 50-entry index).
    const tiny = await dispatch.listDeliveriesForSubscription({ subscriptionId: 'whk_t', limit: 0 });
    assert.ok(tiny.length >= 1, 'limit=0 should be coerced to >=1');
  });
});

test('listDeliveriesForSubscription returns [] on missing subscription / KV blip', () => {
  return withInMemoryKv(async () => {
    const r = await dispatch.listDeliveriesForSubscription({ subscriptionId: 'whk_nonexistent' });
    assert.deepEqual(r, []);
    // Empty/invalid subscriptionId guard.
    assert.deepEqual(await dispatch.listDeliveriesForSubscription({ subscriptionId: '' }), []);
  });
});

// ── End-to-end via dispatchEvent ───────────────────────────────────

test('dispatchEvent + listDeliveriesForSubscription end-to-end (index is hydrated by real dispatch)', () => {
  return withInMemoryKv(async () => {
    const fakeFetch = async () => ({ ok: true, status: 200 });
    const sub = await webhooks.createWebhook({
      orgIdNumeric: 42, label: 'e2e',
      url: 'https://example.com/hook',
      eventTypes: ['import_request_created'],
    });
    await dispatch.dispatchEvent({
      event: { type: 'import_request_created', orgId: 42, at: '2026-01-01T00:00:00Z' },
      fetchImpl: fakeFetch,
    });
    await dispatch.dispatchEvent({
      event: { type: 'import_request_created', orgId: 42, at: '2026-01-02T00:00:00Z' },
      fetchImpl: fakeFetch,
    });
    const list = await dispatch.listDeliveriesForSubscription({ subscriptionId: sub.subscription.id });
    assert.equal(list.length, 2);
    assert.equal(list[0].eventType, 'import_request_created');
    assert.equal(list[0].ok, true);
    assert.equal(list[0].status, 200);
  });
});

// ── Handler ────────────────────────────────────────────────────────

test('Handler routes GET /api/webhooks/<id>/deliveries → handleDeliveries (GET-only)', () => {
  assert.match(HANDLER_SRC, /if \(second === ['"]deliveries['"]\)/);
  assert.match(HANDLER_SRC, /deliveries requires GET/);
  assert.match(HANDLER_SRC, /async function handleDeliveries\(/);
});

test('Handler handleDeliveries is cross-org isolated (404 on foreign-org subscription id)', () => {
  // Drift-guard: a leaked id from one org MUST NOT expose another
  // org's delivery history. Same fetch-first pattern as
  // handleTest + handleDelete.
  const block = HANDLER_SRC.match(/async function handleDeliveries\([\s\S]*?\n\}/);
  assert.ok(block, 'handleDeliveries body not located');
  assert.match(
    block[0],
    /sub\.orgIdNumeric !== ctx\.orgIdNumeric[\s\S]*?Not found/,
  );
});

test('Handler handleDeliveries reads ?limit from query string (passed through to helper)', () => {
  // The UI passes ?limit=25; the helper clamps. Pin both the
  // url.searchParams.get + the limit pass-through.
  const block = HANDLER_SRC.match(/async function handleDeliveries\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /url\.searchParams\.get\(['"]limit['"]\)/);
  assert.match(body, /listDeliveriesForSubscription\(\{[\s\S]*?limit/);
});

// ── TS mirror ──────────────────────────────────────────────────────

test('TS WebhookDeliveryLogEntry + WebhookDeliveriesResponse interfaces mirror the JS shape', () => {
  assert.match(API_TS, /export interface WebhookDeliveryLogEntry \{[\s\S]*?deliveryId: string;[\s\S]*?subscriptionId: string;[\s\S]*?eventType: string;[\s\S]*?deliveredAt: string;[\s\S]*?ok: boolean;[\s\S]*?status: number;[\s\S]*?error: string \| null;[\s\S]*?timedOut: boolean;[\s\S]*?durationMs: number;[\s\S]*?\}/);
  assert.match(API_TS, /export interface WebhookDeliveriesResponse \{[\s\S]*?deliveries: WebhookDeliveryLogEntry\[\];[\s\S]*?\}/);
});

// ── UI ─────────────────────────────────────────────────────────────

test('WebhooksPanel renders a per-row Deliveries toggle that fetches GET /api/webhooks/<id>/deliveries', () => {
  // The button + the apiGet wiring. Pin both.
  const block = INSIGHTS_TSX.match(/function WebhooksPanel\(\)[\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block, 'WebhooksPanel body not located');
  const body = block[0];
  assert.match(body, /toggleDeliveries\(s\.id\)/);
  assert.match(body, /Hide deliveries|Deliveries/);
  assert.match(body, /apiGet<WebhookDeliveriesResponse>\(\s*`\/api\/webhooks\/\$\{encodeURIComponent\(id\)\}\/deliveries\?limit=25`/);
});

test('WebhooksPanel deliveries cache prevents refetch on re-expand (toggle hides, next expand uses cache)', () => {
  // Without the cache check, every toggle would fire a fresh
  // GET — slow + wasteful. Drift-guard pins the
  // `deliveries[id]` cache check.
  const block = INSIGHTS_TSX.match(/function WebhooksPanel\(\)[\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /if \(deliveries\[id\]\) return;/);
});

test('WebhooksPanel deliveries list shows ✓/✗ + event type + status + duration per entry', () => {
  // The contract for the row contents — ops needs the success
  // marker, the event type, and either the status code or the
  // failure reason at a glance.
  const block = INSIGHTS_TSX.match(/function WebhooksPanel\(\)[\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  // Success/failure glyph.
  assert.match(body, /d\.ok \? ['"]✓['"] : ['"]✗['"]/);
  // Event type field.
  assert.match(body, /\{d\.eventType\}/);
  // Status / timeout / error branching for the third column.
  assert.match(body, /d\.timedOut[\s\S]*?d\.error[\s\S]*?d\.status/);
  // Duration tail.
  assert.match(body, /\{d\.durationMs\}ms/);
});
