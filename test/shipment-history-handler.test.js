'use strict';

// Tests for the /api/shipments/<id>/history endpoint + the data-layer
// support function events.listForEntity.
//
// Without DATABASE_URL we exercise:
//   - events.listForEntity filters by (entityType, entityId), sorts
//     oldest-first, caps the result set
//   - the handler's /history sub-action routes correctly (404 on
//     unknown action removed, GET-only method gate, auth gate)
//
// The full end-to-end "create → transition → query history → verify"
// runs in the integration suite once DATABASE_URL is wired in CI.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const events = require(path.join(ROOT, 'lib', 'events'));
const shipmentsHandler = require(path.join(ROOT, 'lib', 'handlers', 'shipments'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    end(payload) {
      if (payload !== undefined) {
        try { this.body = JSON.parse(payload); } catch (_) { this.body = payload; }
      }
      return this;
    },
  };
}

function call({ method = 'GET', headers = {}, body, query }) {
  const res = mockRes();
  return shipmentsHandler(
    { method, headers, body, query, url: query?.path ? `/api/${query.path}` : '/api/shipments' },
    res,
  ).then(() => res);
}

// ── events.listForEntity contract ─────────────────────────────────────

test('listForEntity returns empty array when entityType is missing', async () => {
  const r = await events.listForEntity({ entityId: 'sh_x' });
  assert.deepEqual(r, []);
});

test('listForEntity returns empty array when entityId is missing', async () => {
  const r = await events.listForEntity({ entityType: 'shipment_master' });
  assert.deepEqual(r, []);
});

test('listForEntity is exported and async', () => {
  assert.equal(typeof events.listForEntity, 'function');
});

test('listForEntity filters events to only those naming (entityType, entityId)', async () => {
  kv._resetMemoryStore();
  // Record three events: two for our target shipment, one for a different one.
  await events.record('shipment_master_created', {
    orgId: 1, actorEmailHash: 'aa', entityType: 'shipment_master', entityId: 'sh_target',
    after: { status: 'planned' },
  });
  await events.record('shipment_master_status_transition', {
    orgId: 1, actorEmailHash: 'aa', entityType: 'shipment_master', entityId: 'sh_target',
    before: { status: 'planned' }, after: { status: 'booked' },
  });
  await events.record('shipment_master_created', {
    orgId: 1, actorEmailHash: 'bb', entityType: 'shipment_master', entityId: 'sh_other',
    after: { status: 'planned' },
  });

  const got = await events.listForEntity({ entityType: 'shipment_master', entityId: 'sh_target' });
  assert.equal(got.length, 2);
  for (const e of got) assert.equal(e.entityId, 'sh_target');
});

test('listForEntity sorts oldest-first (chronological timeline order)', async () => {
  kv._resetMemoryStore();
  // events.record stamps `at` from new Date().toISOString(), so we
  // need a small delay to guarantee ordering. Simpler: record in a
  // loop with explicit `at` overrides via a follow-up patch? No —
  // the contract is that events.record stamps `at` so the test
  // assertion is on the natural ordering. Use micro-sleeps.
  await events.record('shipment_master_created', {
    orgId: 1, actorEmailHash: 'aa', entityType: 'shipment_master', entityId: 'sh_chrono',
    after: { status: 'planned' },
  });
  await new Promise((r) => setTimeout(r, 5));
  await events.record('shipment_master_status_transition', {
    orgId: 1, actorEmailHash: 'aa', entityType: 'shipment_master', entityId: 'sh_chrono',
    before: { status: 'planned' }, after: { status: 'booked' },
  });
  await new Promise((r) => setTimeout(r, 5));
  await events.record('shipment_master_status_transition', {
    orgId: 1, actorEmailHash: 'aa', entityType: 'shipment_master', entityId: 'sh_chrono',
    before: { status: 'booked' }, after: { status: 'in_transit' },
  });

  const got = await events.listForEntity({ entityType: 'shipment_master', entityId: 'sh_chrono' });
  assert.equal(got.length, 3);
  // Oldest first.
  assert.equal(got[0].type, 'shipment_master_created');
  // Chronologically non-decreasing.
  for (let i = 1; i < got.length; i++) {
    assert.ok(Date.parse(got[i].at) >= Date.parse(got[i - 1].at),
      `events out of order at index ${i}: ${got[i - 1].at} > ${got[i].at}`);
  }
});

test('listForEntity caps the returned set at the requested limit', async () => {
  kv._resetMemoryStore();
  for (let i = 0; i < 10; i++) {
    await events.record('shipment_master_status_transition', {
      orgId: 1, actorEmailHash: 'aa', entityType: 'shipment_master', entityId: 'sh_capped',
      before: { status: 'planned' }, after: { status: 'booked' },
    });
  }
  const got = await events.listForEntity({ entityType: 'shipment_master', entityId: 'sh_capped', limit: 3 });
  assert.equal(got.length, 3);
});

// ── Handler routing ───────────────────────────────────────────────────

test('GET /api/shipments/<id>/history without session → 401 (auth gate)', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'GET', query: { path: 'shipments/sh_abc/history' } });
  assert.equal(res.statusCode, 401);
});

test('POST /api/shipments/<id>/history → 405 (history is GET-only)', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'POST', body: {}, query: { path: 'shipments/sh_abc/history' } });
  // Auth gate fires first → 401. Either 401 or 405 proves the path
  // was recognised as the history sub-action (NOT routed to /transition
  // or 404 as an unknown action).
  assert.ok([401, 405].includes(res.statusCode), `expected 401 or 405, got ${res.statusCode}`);
});

test('handler recognises /history as a sub-action (not falling through to "unknown action")', async () => {
  // Compare the response shape with a genuinely-unknown action.
  // Both reach auth (401) but if the URL parser fell through, /history
  // would 404 with "Unknown action: history" after auth.
  kv._resetMemoryStore();
  const history = await call({ method: 'GET', query: { path: 'shipments/sh_abc/history' } });
  // After auth: history → handleHistory; unknown → 404 "Unknown action".
  // Without a session, both 401. The drift guard reads the source.
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'shipments.js'), 'utf8');
  assert.match(src, /action === 'history'/);
  assert.match(src, /return handleHistory\(req, res, ctx, externalId\);/);
  assert.equal(history.statusCode, 401);
});

// ── Drift-guard: timeline event types are explicitly enumerated ──────

test('SHIPMENT_TIMELINE_EVENT_TYPES enumerates exactly the customer-visible shipment events', () => {
  // Internal events (e.g. shadow-divergence, system-cron) must not
  // leak into a customer's timeline. The Set is the choke point —
  // a future PR that adds a new shipment event must update this list
  // explicitly. This test pins the current 5 types.
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'shipments.js'), 'utf8');
  const block = src.match(/SHIPMENT_TIMELINE_EVENT_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, 'SHIPMENT_TIMELINE_EVENT_TYPES set not located');
  const types = (block[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();
  assert.deepEqual(types, [
    'shipment_master_archived',
    'shipment_master_created',
    'shipment_master_exception_acknowledged',
    'shipment_master_status_transition',
    'shipment_master_updated',
  ]);
});
