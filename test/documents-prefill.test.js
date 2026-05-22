const test = require('node:test');
const assert = require('node:assert/strict');

const kv = require('../lib/intelligence/kv-store');
const documents = require('../lib/handlers/documents');

// Minimal Express-style res capturing status + body.
function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    send(b) { this.body = b; return this; },
    end() { return this; },
  };
}

function post(body) {
  const res = mockRes();
  return documents({ method: 'POST', headers: {}, body }, res).then(() => res);
}

const PLAN = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'DE', customsValueEur: 50000, hsCode: '610910', moq: 1000 };

test('POST fromPlan pre-fills and renders a draft document', async () => {
  kv._resetMemoryStore();
  const res = await post({ type: 'commercial_invoice', fromPlan: PLAN });
  assert.equal(res.statusCode, 200);
  const html = String(res.body);
  assert.match(html, /Commercial Invoice/);
  assert.match(html, /complete before use/); // placeholder party rendered
  assert.match(html, /610910/); // HS code from the plan
});

test('POST with neither data nor fromPlan → 400', async () => {
  kv._resetMemoryStore();
  const res = await post({ type: 'commercial_invoice' });
  assert.equal(res.statusCode, 400);
});

test('POST without type → 400', async () => {
  kv._resetMemoryStore();
  const res = await post({ fromPlan: PLAN });
  assert.equal(res.statusCode, 400);
});

test('explicit data overrides the drafted placeholder party', async () => {
  kv._resetMemoryStore();
  const res = await post({
    type: 'commercial_invoice',
    fromPlan: PLAN,
    data: { exporter: { companyName: 'Acme Exports Ltd' } },
  });
  assert.equal(res.statusCode, 200);
  const html = String(res.body);
  assert.match(html, /Acme Exports Ltd/);
  assert.doesNotMatch(html, /Exporter \/ Seller — complete before use/);
});
