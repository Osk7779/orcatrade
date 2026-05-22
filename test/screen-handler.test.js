const test = require('node:test');
const assert = require('node:assert/strict');

const kv = require('../lib/intelligence/kv-store');
const screen = require('../lib/handlers/screen');

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    end() { return this; },
  };
}
function call(method, body) {
  const res = mockRes();
  return screen({ method, headers: {}, body }, res).then(() => res);
}

test('GET returns the advisory + list status (so the UI can show what it screens against)', async () => {
  kv._resetMemoryStore();
  const res = await call('GET');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.authoritative, false); // no DB in tests → sample
  assert.match(res.body.advisory, /authoritative consolidated lists/);
  assert.ok(res.body.list);
  assert.equal(res.body.list.source, 'ILLUSTRATIVE-SAMPLE');
  assert.ok(res.body.list.totalCount >= 1);
});

test('POST a known sample name → potential_match', async () => {
  kv._resetMemoryStore();
  const res = await call('POST', { name: 'Volcano Trading Company' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'potential_match');
  assert.ok(res.body.matches.length >= 1);
});

test('POST an unrelated name → no_sample_match (never "clear")', async () => {
  kv._resetMemoryStore();
  const res = await call('POST', { name: 'Totally Unrelated Imports' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'no_sample_match');
  assert.notEqual(res.body.status, 'clear');
  assert.ok(res.body.advisory);
});

test('POST without a name → 400', async () => {
  kv._resetMemoryStore();
  const res = await call('POST', {});
  assert.equal(res.statusCode, 400);
});

test('PUT → 405', async () => {
  kv._resetMemoryStore();
  const res = await call('PUT', { name: 'x' });
  assert.equal(res.statusCode, 405);
});
