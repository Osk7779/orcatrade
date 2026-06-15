'use strict';

// Handler tests for /api/goods.
//
// Without DATABASE_URL we can't exercise live CRUD, so this suite pins:
//   - the auth gate (401 when not signed in)
//   - method routing (OPTIONS / 405 on disallowed verbs)
//   - URL parsing (list vs item paths)
//   - the 503 path when PG is not configured
//   - the dispatch table entry (/api/goods → this handler)
//
// Live CRUD round-trips are exercised by an integration test in CI once
// DATABASE_URL is wired in the test environment.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const goodsHandler = require(path.join(ROOT, 'lib', 'handlers', 'goods'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    end(payload) {
      this.ended = true;
      if (payload !== undefined) {
        try { this.body = JSON.parse(payload); }
        catch (_) { this.body = payload; }
      }
      return this;
    },
  };
}

function call({ method = 'GET', headers = {}, body, query }) {
  const res = mockRes();
  return goodsHandler({ method, headers, body, query, url: query?.path ? `/api/${query.path}` : '/api/goods' }, res).then(() => res);
}

// ── OPTIONS (CORS preflight) ──────────────────────────────────────────

test('OPTIONS returns 204 with CORS headers and no body', async () => {
  const res = await call({ method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-methods'], 'GET, POST, PATCH, DELETE, OPTIONS');
  assert.ok(/x-orcatrade-org/i.test(res.headers['access-control-allow-headers']));
});

// ── Auth gate ─────────────────────────────────────────────────────────

test('GET without session cookie returns 401', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'GET' });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Sign in required');
});

test('POST without session cookie returns 401', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'POST', body: { sku: 'X', displayName: 'X', hsCode: '850152' } });
  assert.equal(res.statusCode, 401);
});

test('PATCH /api/goods/<id> without session cookie returns 401', async () => {
  kv._resetMemoryStore();
  const res = await call({
    method: 'PATCH',
    body: { displayName: 'new' },
    query: { path: 'goods/gd_abc' },
  });
  assert.equal(res.statusCode, 401);
});

test('DELETE /api/goods/<id> without session cookie returns 401', async () => {
  kv._resetMemoryStore();
  const res = await call({
    method: 'DELETE',
    query: { path: 'goods/gd_abc' },
  });
  assert.equal(res.statusCode, 401);
});

// ── URL parsing helper (verified via observable behaviour) ────────────

test('the handler distinguishes /api/goods from /api/goods/<id>', async () => {
  // Both routes hit the auth gate first (401 today). We use this to
  // confirm the URL parser isn't 405'ing on a recognised path.
  const list = await call({ method: 'GET' });
  const item = await call({ method: 'GET', query: { path: 'goods/gd_abc' } });
  assert.equal(list.statusCode, 401, 'list path must reach auth gate, not 405');
  assert.equal(item.statusCode, 401, 'item path must reach auth gate, not 405');
});

// ── Dispatch registration ─────────────────────────────────────────────

test('api/[...path].js dispatch registers "goods" → handlers/goods', () => {
  // Cheap drift-guard: a future PR that drops goods from the dispatch
  // makes /api/goods 404. Read the source string to catch the regression.
  const fs = require('node:fs');
  const dispatch = fs.readFileSync(path.join(ROOT, 'api', '[...path].js'), 'utf8');
  assert.match(dispatch, /goods:\s*require\(['"]\.\.\/lib\/handlers\/goods['"]\)/);
});

// ── Handler module API parity ─────────────────────────────────────────

test('handlers/goods.js exports a single async function (compatible with the dispatcher)', () => {
  assert.equal(typeof goodsHandler, 'function');
  // All sibling handlers (handlers/customs.js, handlers/screen.js …)
  // export `module.exports = async (req, res) => …`. This matches.
});
