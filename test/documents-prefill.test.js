const test = require('node:test');
const assert = require('node:assert/strict');

const kv = require('../lib/intelligence/kv-store');
const documents = require('../lib/handlers/documents');
const auth = require('../lib/auth');
const savedPlans = require('../lib/saved-plans');

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

// ── fromPlanId: draft from the signed-in user's own saved plan ──

function authedPost(email, body) {
  const res = mockRes();
  const req = {
    method: 'POST',
    headers: { cookie: 'orcatrade_session=' + encodeURIComponent(auth.buildSessionCookie(email)) },
    body,
  };
  return documents(req, res).then(() => res);
}

test('fromPlanId drafts from the owner\'s saved plan', async () => {
  kv._resetMemoryStore();
  const saved = await savedPlans.savePlan({ email: 'me@example.com', inputs: PLAN, label: 'My apparel' });
  const planId = saved.plan ? saved.plan.id : saved.id;
  const res = await authedPost('me@example.com', { type: 'commercial_invoice', fromPlanId: planId });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.body), /Commercial Invoice/);
  assert.match(String(res.body), /610910/); // HS code from the plan
});

test('fromPlanId without a session → 401', async () => {
  kv._resetMemoryStore();
  const res = await post({ type: 'commercial_invoice', fromPlanId: 'pl_whatever' });
  assert.equal(res.statusCode, 401);
});

test('fromPlanId for a non-existent / other-user plan → 404', async () => {
  kv._resetMemoryStore();
  const saved = await savedPlans.savePlan({ email: 'owner@example.com', inputs: PLAN });
  const planId = saved.plan ? saved.plan.id : saved.id;
  // A different signed-in user cannot draft from owner@example.com's plan.
  const res = await authedPost('intruder@example.com', { type: 'commercial_invoice', fromPlanId: planId });
  assert.equal(res.statusCode, 404);
});
