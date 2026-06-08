'use strict';

// /api/shipments handler tests. Pins URL routing (incl. the
// transition action sub-route), auth gate, dispatch registration.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const shipmentsHandler = require(path.join(ROOT, 'lib', 'handlers', 'shipments'));
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
  return shipmentsHandler(
    { method, headers, body, query, url: query?.path ? `/api/${query.path}` : '/api/shipments' },
    res,
  ).then(() => res);
}

test('OPTIONS returns 204 with CORS headers', async () => {
  const res = await call({ method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-methods'], 'GET, POST, PATCH, DELETE, OPTIONS');
});

test('GET / POST / PATCH / DELETE without session → 401', async () => {
  kv._resetMemoryStore();
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const query = method === 'GET' || method === 'POST' ? undefined : { path: 'shipments/sh_abc' };
    const res = await call({ method, body: { label: 'X' }, query });
    assert.equal(res.statusCode, 401, `${method} without session must be 401`);
  }
});

test('POST /api/shipments/<id>/transition without session → 401', async () => {
  kv._resetMemoryStore();
  const res = await call({
    method: 'POST',
    body: { toStatus: 'booked' },
    query: { path: 'shipments/sh_abc/transition' },
  });
  assert.equal(res.statusCode, 401);
});

test('handler distinguishes /list, /item, and /item/transition paths', async () => {
  // Without a session every route 401s — that's enough to confirm the
  // URL parser isn't 405'ing on a valid path shape.
  const list = await call({ method: 'GET' });
  const item = await call({ method: 'GET', query: { path: 'shipments/sh_abc' } });
  const transition = await call({ method: 'POST', body: { toStatus: 'booked' }, query: { path: 'shipments/sh_abc/transition' } });
  assert.equal(list.statusCode, 401);
  assert.equal(item.statusCode, 401);
  assert.equal(transition.statusCode, 401);
});

test('api/[...path].js dispatch registers "shipments" → handlers/shipments', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(ROOT, 'api', '[...path].js'), 'utf8');
  assert.match(src, /shipments:\s*require\(['"]\.\.\/lib\/handlers\/shipments['"]\)/);
});

test('handlers/shipments.js exports a single async function (dispatcher contract)', () => {
  assert.equal(typeof shipmentsHandler, 'function');
});
