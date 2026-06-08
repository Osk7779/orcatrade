'use strict';

// /api/suppliers handler tests — mirrors test/handler-goods.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const suppliersHandler = require(path.join(ROOT, 'lib', 'handlers', 'suppliers'));
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
  return suppliersHandler(
    { method, headers, body, query, url: query?.path ? `/api/${query.path}` : '/api/suppliers' },
    res,
  ).then(() => res);
}

test('OPTIONS returns 204 with CORS headers', async () => {
  const res = await call({ method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-methods'], 'GET, POST, PATCH, DELETE, OPTIONS');
  assert.ok(/x-orcatrade-org/i.test(res.headers['access-control-allow-headers']));
});

test('GET without session cookie returns 401', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'GET' });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Sign in required');
});

test('POST without session cookie returns 401', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'POST', body: { entityName: 'X', hqCountry: 'CN' } });
  assert.equal(res.statusCode, 401);
});

test('PATCH /api/suppliers/<id> without session returns 401', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'PATCH', body: { entityName: 'new' }, query: { path: 'suppliers/sp_abc' } });
  assert.equal(res.statusCode, 401);
});

test('DELETE /api/suppliers/<id> without session returns 401', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'DELETE', query: { path: 'suppliers/sp_abc' } });
  assert.equal(res.statusCode, 401);
});

test('handler distinguishes /api/suppliers from /api/suppliers/<id>', async () => {
  const list = await call({ method: 'GET' });
  const item = await call({ method: 'GET', query: { path: 'suppliers/sp_abc' } });
  assert.equal(list.statusCode, 401, 'list path must reach auth gate, not 405');
  assert.equal(item.statusCode, 401, 'item path must reach auth gate, not 405');
});

test('api/[...path].js dispatch registers "suppliers" → handlers/suppliers', () => {
  const fs = require('node:fs');
  const dispatch = fs.readFileSync(path.join(ROOT, 'api', '[...path].js'), 'utf8');
  assert.match(dispatch, /suppliers:\s*require\(['"]\.\.\/lib\/handlers\/suppliers['"]\)/);
});

test('handlers/suppliers.js exports a single async function (dispatcher contract)', () => {
  assert.equal(typeof suppliersHandler, 'function');
});
