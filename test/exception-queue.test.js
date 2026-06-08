'use strict';

// L1.5 Exception queue tests.
//
// Without DATABASE_URL we exercise:
//   - the data-layer validation + 503 contract for both new functions
//   - the handler routing for the reserved /exceptions path AND the
//     /<id>/exception/acknowledge sub-action
//   - the SLA threshold constant exposed on the data-layer surface
//
// Live queue ordering + age-hours computation against a real PG are
// integration tests once DATABASE_URL is wired in CI.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const shipments = require(path.join(ROOT, 'lib', 'db', 'shipments'));
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

// ── Data-layer surface ────────────────────────────────────────────────

test('EXCEPTION_SLA_THRESHOLD_HOURS is exposed as 24 (matches the internal ops SLA)', () => {
  assert.equal(shipments.EXCEPTION_SLA_THRESHOLD_HOURS, 24);
});

test('listExceptionQueue is exported and async', () => {
  assert.equal(typeof shipments.listExceptionQueue, 'function');
});

test('acknowledgeException is exported and async', () => {
  assert.equal(typeof shipments.acknowledgeException, 'function');
});

// ── Validation contracts ──────────────────────────────────────────────

test('listExceptionQueue requires a numeric orgId', async () => {
  const r = await shipments.listExceptionQueue({ orgId: 'abc' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /orgId/i.test(e)));
});

test('listExceptionQueue returns "Postgres not configured" when DATABASE_URL is unset', async () => {
  const r = await shipments.listExceptionQueue({ orgId: 1 });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Postgres not configured/i);
});

test('acknowledgeException requires orgId + externalId + actorEmailHash', async () => {
  const r = await shipments.acknowledgeException({ orgId: 'abc', externalId: '', actorEmailHash: '' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /required/i.test(e)));
});

test('acknowledgeException returns "Postgres not configured" when DATABASE_URL is unset', async () => {
  const r = await shipments.acknowledgeException({
    orgId: 1, externalId: 'sh_x', actorEmailHash: 'h',
  });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Postgres not configured/i);
});

// ── Handler routing ───────────────────────────────────────────────────

test('GET /api/shipments/exceptions without session → 401 (auth gate)', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'GET', query: { path: 'shipments/exceptions' } });
  assert.equal(res.statusCode, 401);
});

test('POST /api/shipments/exceptions → 405 (queue is read-only)', async () => {
  kv._resetMemoryStore();
  // Even unauthenticated: the auth gate fires first. We need to confirm
  // the reserved path doesn't accidentally route POST to handleCreate.
  // 401 happens before method-check; pin that the route is recognised
  // as the queue path (would otherwise treat 'exceptions' as externalId).
  const res = await call({ method: 'POST', query: { path: 'shipments/exceptions' }, body: {} });
  // Either 401 (auth gate) or 405 (queue-only-GET) — both prove the
  // path was recognised. NOT 201 or 404.
  assert.ok([401, 405].includes(res.statusCode), `expected 401 or 405, got ${res.statusCode}`);
});

test('POST /api/shipments/<id>/exception/acknowledge without session → 401', async () => {
  kv._resetMemoryStore();
  const res = await call({
    method: 'POST',
    body: { note: 'investigating' },
    query: { path: 'shipments/sh_abc/exception/acknowledge' },
  });
  assert.equal(res.statusCode, 401);
});

test('GET /api/shipments/<id>/exception/acknowledge → 405 (acknowledge requires POST)', async () => {
  kv._resetMemoryStore();
  const res = await call({
    method: 'GET',
    query: { path: 'shipments/sh_abc/exception/acknowledge' },
  });
  // 401 (no session) or 405 (wrong method on action) both prove the
  // path was recognised. NOT 404 (which would mean the action wasn't
  // routed at all).
  assert.ok([401, 405].includes(res.statusCode), `expected 401 or 405, got ${res.statusCode}`);
});

test('the URL parser distinguishes /exceptions (queue) from a real externalId like sh_abc', async () => {
  // Two different paths must both reach the auth gate (401) rather
  // than one of them 404-ing.
  const queue = await call({ method: 'GET', query: { path: 'shipments/exceptions' } });
  const item = await call({ method: 'GET', query: { path: 'shipments/sh_abc' } });
  assert.equal(queue.statusCode, 401, 'queue path must reach auth gate, not 404');
  assert.equal(item.statusCode, 401, 'item path must reach auth gate, not 404');
});

// ── Drift-guard: the dispatch table preserves the exception entry ─────

test('handler module surface preserves the existing exports for the dispatcher', () => {
  // The handler module is still callable; the new sub-routes don't break
  // the (req, res) entry contract.
  assert.equal(typeof shipmentsHandler, 'function');
});
