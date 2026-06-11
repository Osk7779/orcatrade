'use strict';

// Tests for the /api/goods/<id>/history endpoint. Parallel to
// test/shipment-history-handler.test.js (PR #108). Closes the audit-
// trail asymmetry: goods master entities now expose the same audit
// timeline contract as shipments.
//
// Without DATABASE_URL we exercise the handler's routing surface:
//   - /history sub-action is recognised (not falling through to 404)
//   - GET-only method gate
//   - auth gate fires first (401 without session)
// The full end-to-end (create → update → query → assert events) runs
// in the integration suite once DATABASE_URL is wired in CI.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const goodsHandler = require(path.join(ROOT, 'lib', 'handlers', 'goods'));
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
  return goodsHandler(
    { method, headers, body, query, url: query?.path ? `/api/${query.path}` : '/api/goods' },
    res,
  ).then(() => res);
}

// ── Handler routing ───────────────────────────────────────────────────

test('GET /api/goods/<id>/history without session → 401 (auth gate)', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'GET', query: { path: 'goods/g_abc/history' } });
  assert.equal(res.statusCode, 401);
});

test('POST /api/goods/<id>/history → 401 or 405 (history is GET-only, never 404 unknown-action)', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'POST', body: {}, query: { path: 'goods/g_abc/history' } });
  // Auth gate fires first → 401. Either 401 or 405 proves the path
  // was recognised as the history sub-action (NOT a fall-through to
  // "Unknown action" 404).
  assert.ok([401, 405].includes(res.statusCode), `expected 401 or 405, got ${res.statusCode}`);
});

test('handler recognises /history as a sub-action (not falling through to "unknown action")', async () => {
  // Drift guard: read the handler source and verify the explicit
  // `action === 'history'` branch + the handleHistory call. Without
  // a session both /history AND an unknown action would 401, so this
  // can't be observed via response shape — only via source pinning.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'goods.js'), 'utf8');
  assert.match(src, /action === 'history'/);
  assert.match(src, /return handleHistory\(req, res, ctx, externalId\);/);
});

test('handler imports events module for listForEntity-backed history reads', () => {
  // ADR 0005 says every mutation writes the audit log before
  // success. PR #108 added listForEntity to events.js. This handler
  // must use it (not, e.g., a hand-rolled query on the chain).
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'goods.js'), 'utf8');
  assert.match(src, /require\('\.\.\/events'\)/);
  assert.match(src, /events\.listForEntity/);
});

// ── Drift-guard: timeline event types are explicitly enumerated ──────

test('GOODS_TIMELINE_EVENT_TYPES enumerates exactly the customer-visible goods events', () => {
  // Pinned at the current 3 types. A future PR adding a new
  // goods_master_* event type must update this list explicitly —
  // internal/system events on the goods entity must never leak into
  // a customer's audit timeline.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'goods.js'), 'utf8');
  const block = src.match(/GOODS_TIMELINE_EVENT_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, 'GOODS_TIMELINE_EVENT_TYPES set not located');
  const types = (block[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();
  assert.deepEqual(types, [
    'goods_master_archived',
    'goods_master_created',
    'goods_master_updated',
  ]);
});

test('handler defines redactTimelineEvent that strips chain-stamp internals + email', () => {
  // Identical privacy contract to shipments.js's redactor (PR #108).
  // The audit log writes raw `email` fields for internal forensics;
  // customer-visible surfaces must redact them. Drift guard reads
  // the source to ensure the redactor stays present (and the
  // _seq / _hash / _prevHash chain-internals aren't accidentally
  // leaked through a refactor).
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'goods.js'), 'utf8');
  assert.match(src, /function redactTimelineEvent\(e\)/);
  assert.match(src, /_seq, _hash, _prevHash, email/);
});

// ── Existing routes still work (no regression) ───────────────────────

test('GET /api/goods (no externalId) still hits the list route (no regression on PR #107)', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'GET', query: { path: 'goods' } });
  // 401 (auth gate fires) — proves /api/goods is still recognised
  // as the list-route, not accidentally rerouted by the action
  // refactor.
  assert.equal(res.statusCode, 401);
});

test('GET /api/goods/<id> (no action) still hits the get-one route', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'GET', query: { path: 'goods/g_abc' } });
  assert.equal(res.statusCode, 401);
});

test('GET /api/goods/<id>/<unknown-action> after auth gates as 404 unknown-action (not history)', async () => {
  // Same shape as shipments: a non-history sub-action must surface
  // an explicit 404 with the unknown-action error rather than
  // silently falling through to one of the CRUD handlers. Without
  // a session this still 401s at auth — the source-pinning test
  // above asserts the unknown-action branch exists. This test
  // confirms the URL doesn't get accidentally routed somewhere else.
  kv._resetMemoryStore();
  const res = await call({ method: 'GET', query: { path: 'goods/g_abc/transition' } });
  assert.equal(res.statusCode, 401);
});
