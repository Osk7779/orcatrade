'use strict';

// Tests for the /api/suppliers/<id>/history endpoint. Parallel to
// test/goods-history-handler.test.js and test/shipment-history-
// handler.test.js (PR #108). Closes the audit-trail asymmetry
// across all three system-of-record entities.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const suppliersHandler = require(path.join(ROOT, 'lib', 'handlers', 'suppliers'));
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
  return suppliersHandler(
    { method, headers, body, query, url: query?.path ? `/api/${query.path}` : '/api/suppliers' },
    res,
  ).then(() => res);
}

// ── Handler routing ───────────────────────────────────────────────────

test('GET /api/suppliers/<id>/history without session → 401 (auth gate)', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'GET', query: { path: 'suppliers/sup_abc/history' } });
  assert.equal(res.statusCode, 401);
});

test('POST /api/suppliers/<id>/history → 401 or 405 (history is GET-only, never 404 unknown-action)', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'POST', body: {}, query: { path: 'suppliers/sup_abc/history' } });
  assert.ok([401, 405].includes(res.statusCode), `expected 401 or 405, got ${res.statusCode}`);
});

test('handler recognises /history as a sub-action (not falling through to "unknown action")', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'suppliers.js'), 'utf8');
  assert.match(src, /action === 'history'/);
  assert.match(src, /return handleHistory\(req, res, ctx, externalId\);/);
});

test('handler imports events module for listForEntity-backed history reads', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'suppliers.js'), 'utf8');
  assert.match(src, /require\('\.\.\/events'\)/);
  assert.match(src, /events\.listForEntity/);
});

// ── Drift-guard: timeline event types are explicitly enumerated ──────

test('SUPPLIER_TIMELINE_EVENT_TYPES enumerates exactly the customer-visible supplier events', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'suppliers.js'), 'utf8');
  const block = src.match(/SUPPLIER_TIMELINE_EVENT_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, 'SUPPLIER_TIMELINE_EVENT_TYPES set not located');
  const types = (block[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();
  assert.deepEqual(types, [
    'supplier_master_archived',
    'supplier_master_created',
    'supplier_master_updated',
  ]);
});

test('handler defines redactTimelineEvent that strips chain-stamp internals + email', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'suppliers.js'), 'utf8');
  assert.match(src, /function redactTimelineEvent\(e\)/);
  assert.match(src, /_seq, _hash, _prevHash, email/);
});

// ── Existing routes still work (no regression) ───────────────────────

test('GET /api/suppliers (no externalId) still hits the list route', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'GET', query: { path: 'suppliers' } });
  assert.equal(res.statusCode, 401);
});

test('GET /api/suppliers/<id> (no action) still hits the get-one route', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'GET', query: { path: 'suppliers/sup_abc' } });
  assert.equal(res.statusCode, 401);
});

test('GET /api/suppliers/<id>/<unknown-action> after auth still gates at 401', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'GET', query: { path: 'suppliers/sup_abc/screen' } });
  assert.equal(res.statusCode, 401);
});

// ── Audit-trail completeness assertion: all three SoR entities
//     now expose the same timeline contract ─────────────────────────

test('all three system-of-record entities expose a /history sub-action (audit-trail symmetry)', () => {
  // PR #108 added shipments timeline. This PR adds goods + suppliers.
  // Read all three handler sources and assert each declares the
  // same /history sub-action. Big-corp SoR bar: every audit-loggable
  // entity exposes its timeline.
  const handlers = {
    shipments: path.join(ROOT, 'lib', 'handlers', 'shipments.js'),
    goods: path.join(ROOT, 'lib', 'handlers', 'goods.js'),
    suppliers: path.join(ROOT, 'lib', 'handlers', 'suppliers.js'),
  };
  for (const [name, p] of Object.entries(handlers)) {
    const src = fs.readFileSync(p, 'utf8');
    assert.match(src, /action === 'history'/, `${name} handler must expose a /history sub-action`);
    assert.match(src, /events\.listForEntity/, `${name} handler must use events.listForEntity to back the timeline`);
  }
});
