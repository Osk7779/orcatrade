// Saved-plans tests (Sprint 39).

const test = require('node:test');
const assert = require('node:assert/strict');

// Pin secret + run KV in memory mode
process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const kv = require('../lib/intelligence/kv-store');
const auth = require('../lib/auth');
const savedPlans = require('../lib/saved-plans');
const plansHandler = require('../lib/handlers/plans');

const BASE_INPUTS = {
  productCategory: 'apparel',
  originCountry: 'CN',
  destinationCountry: 'PL',
  customsValueEur: 25000,
  weightKg: 800,
};

// ── lib/saved-plans.js primitives ─────────────────────

test('generatePlanId: starts with pl_ + 16 hex chars', () => {
  const id = savedPlans.generatePlanId();
  assert.match(id, /^pl_[a-f0-9]{16}$/);
});

test('generatePlanId: produces unique ids', () => {
  const a = savedPlans.generatePlanId();
  const b = savedPlans.generatePlanId();
  assert.notEqual(a, b);
});

test('sanitiseInputs: strips fields outside the allow-list', () => {
  const out = savedPlans.sanitiseInputs({
    ...BASE_INPUTS,
    email: 'pwned@example.com',
    arbitrary: 'x',
    __proto__: { polluted: true },
  });
  assert.equal(out.email, undefined);
  assert.equal(out.arbitrary, undefined);
  assert.equal(out.productCategory, 'apparel');
});

test('sanitiseInputs: skips empty/null/undefined values', () => {
  const out = savedPlans.sanitiseInputs({
    productCategory: 'apparel',
    originCountry: '',
    destinationCountry: null,
    weightKg: undefined,
  });
  assert.equal(out.productCategory, 'apparel');
  assert.equal(out.originCountry, undefined);
});

test('sanitiseLabel: trims and caps to 100 chars', () => {
  assert.equal(savedPlans.sanitiseLabel('  hello  '), 'hello');
  assert.equal(savedPlans.sanitiseLabel('x'.repeat(120)).length, 100);
  assert.equal(savedPlans.sanitiseLabel(null), '');
});

test('autoLabel: produces a category + route summary', () => {
  const label = savedPlans.autoLabel(BASE_INPUTS);
  assert.match(label, /apparel/);
  assert.match(label, /CN→PL/);
  assert.match(label, /€25,000/);
});

// ── savePlan + listPlans + getPlan + deletePlan ───────

test('savePlan: stores plan + adds to user list', async () => {
  kv._resetMemoryStore();
  const r = await savedPlans.savePlan({ email: 'user@example.com', inputs: BASE_INPUTS });
  assert.match(r.id, /^pl_[a-f0-9]{16}$/);
  assert.equal(r.email, 'user@example.com');
  assert.deepEqual(r.inputs, savedPlans.sanitiseInputs(BASE_INPUTS));
  assert.ok(r.label);
  assert.ok(r.savedAt);

  // Verify it's in the user list
  const list = await savedPlans.listPlans('user@example.com');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, r.id);
});

test('savePlan: rejects when minimum inputs missing', async () => {
  kv._resetMemoryStore();
  await assert.rejects(
    () => savedPlans.savePlan({ email: 'a@b.com', inputs: { weightKg: 100 } }),
    /minimum required inputs missing/,
  );
});

test('savePlan: lowercases email', async () => {
  kv._resetMemoryStore();
  const r = await savedPlans.savePlan({ email: 'UPPER@EXAMPLE.COM', inputs: BASE_INPUTS });
  assert.equal(r.email, 'upper@example.com');
});

test('listPlans: returns most-recent first', async () => {
  kv._resetMemoryStore();
  const a = await savedPlans.savePlan({ email: 'order@example.com', inputs: BASE_INPUTS });
  await new Promise(r => setTimeout(r, 5));
  const b = await savedPlans.savePlan({ email: 'order@example.com', inputs: { ...BASE_INPUTS, originCountry: 'VN' } });
  await new Promise(r => setTimeout(r, 5));
  const c = await savedPlans.savePlan({ email: 'order@example.com', inputs: { ...BASE_INPUTS, originCountry: 'IN' } });
  const list = await savedPlans.listPlans('order@example.com');
  assert.deepEqual(list.map(r => r.id), [c.id, b.id, a.id]);
});

test('listPlans: empty for unknown user', async () => {
  kv._resetMemoryStore();
  const list = await savedPlans.listPlans('never-existed@example.com');
  assert.deepEqual(list, []);
});

test('listPlans: scoped to email (does not leak across users)', async () => {
  kv._resetMemoryStore();
  await savedPlans.savePlan({ email: 'alice@example.com', inputs: BASE_INPUTS });
  await savedPlans.savePlan({ email: 'bob@example.com', inputs: BASE_INPUTS });
  const aliceList = await savedPlans.listPlans('alice@example.com');
  const bobList = await savedPlans.listPlans('bob@example.com');
  assert.equal(aliceList.length, 1);
  assert.equal(bobList.length, 1);
  assert.notEqual(aliceList[0].id, bobList[0].id);
});

test('getPlan: ownership check — wrong email returns null', async () => {
  kv._resetMemoryStore();
  const r = await savedPlans.savePlan({ email: 'owner@example.com', inputs: BASE_INPUTS });
  // Wrong requester
  const got = await savedPlans.getPlan(r.id, 'thief@example.com');
  assert.equal(got, null);
  // Right requester
  const got2 = await savedPlans.getPlan(r.id, 'owner@example.com');
  assert.equal(got2.id, r.id);
});

test('deletePlan: removes plan + updates user list', async () => {
  kv._resetMemoryStore();
  const r = await savedPlans.savePlan({ email: 'del@example.com', inputs: BASE_INPUTS });
  const ok = await savedPlans.deletePlan(r.id, 'del@example.com');
  assert.equal(ok, true);
  const list = await savedPlans.listPlans('del@example.com');
  assert.deepEqual(list, []);
});

test('deletePlan: ownership check — wrong email returns false, plan persists', async () => {
  kv._resetMemoryStore();
  const r = await savedPlans.savePlan({ email: 'owner@example.com', inputs: BASE_INPUTS });
  const ok = await savedPlans.deletePlan(r.id, 'thief@example.com');
  assert.equal(ok, false);
  // Plan still there
  const got = await savedPlans.getPlan(r.id, 'owner@example.com');
  assert.equal(got.id, r.id);
});

test('savePlan: persists optional snapshot when provided', async () => {
  kv._resetMemoryStore();
  const snapshot = {
    asOf: '2026-05-08',
    perShipmentLandedTotal: 28425,
    dutyEur: 3000, vatEur: 5500, transportEur: 4500, brokerageEur: 425,
    dutyRatePct: 12,
  };
  const r = await savedPlans.savePlan({ email: 'snap@example.com', inputs: BASE_INPUTS, snapshot });
  assert.equal(r.snapshot.perShipmentLandedTotal, 28425);
  assert.equal(r.snapshot.dutyRatePct, 12);
  // Round-trips through KV
  const got = await savedPlans.getPlan(r.id, 'snap@example.com');
  assert.equal(got.snapshot.perShipmentLandedTotal, 28425);
});

test('savePlan: snapshot is null when not provided (legacy plans)', async () => {
  kv._resetMemoryStore();
  const r = await savedPlans.savePlan({ email: 'nosnap@example.com', inputs: BASE_INPUTS });
  assert.equal(r.snapshot, null);
});

test('savePlan: snapshot strips arbitrary fields (defence in depth)', async () => {
  kv._resetMemoryStore();
  const r = await savedPlans.savePlan({
    email: 'safe@example.com',
    inputs: BASE_INPUTS,
    snapshot: { perShipmentLandedTotal: 100, attacker: 'pwn', __proto__: { polluted: true } },
  });
  assert.equal(r.snapshot.attacker, undefined);
  assert.equal(r.snapshot.polluted, undefined);
  assert.equal(r.snapshot.perShipmentLandedTotal, 100);
});

test('savePlan: caps user list at MAX_PLANS_PER_USER', async () => {
  kv._resetMemoryStore();
  for (let i = 0; i < savedPlans.MAX_PLANS_PER_USER + 5; i++) {
    await savedPlans.savePlan({ email: 'spam@example.com', inputs: BASE_INPUTS });
  }
  const list = await savedPlans.listPlans('spam@example.com');
  assert.equal(list.length, savedPlans.MAX_PLANS_PER_USER);
});

// ── /api/plans handler ────────────────────────────────

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}

function authedReq(method, body = {}, queryPath = ['plans'], url = '/api/plans') {
  const cookie = auth.buildSessionCookie('plans-user@example.com');
  return {
    method, body, url,
    query: { path: queryPath },
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
  };
}

test('handler: 401 when no auth cookie', async () => {
  const req = { method: 'GET', headers: {}, query: { path: ['plans'] }, url: '/api/plans' };
  const res = mockRes();
  await plansHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test('handler: POST without inputs → 400', async () => {
  kv._resetMemoryStore();
  const req = authedReq('POST', {});
  const res = mockRes();
  await plansHandler(req, res);
  assert.equal(res.statusCode, 400);
});

test('handler: POST + GET round-trip', async () => {
  kv._resetMemoryStore();
  // Save
  const saveReq = authedReq('POST', { inputs: BASE_INPUTS, label: 'My test plan' });
  const saveRes = mockRes();
  await plansHandler(saveReq, saveRes);
  assert.equal(saveRes.statusCode, 200);
  const saveJson = JSON.parse(saveRes.body);
  assert.equal(saveJson.plan.label, 'My test plan');

  // List
  const listReq = authedReq('GET');
  const listRes = mockRes();
  await plansHandler(listReq, listRes);
  assert.equal(listRes.statusCode, 200);
  const listJson = JSON.parse(listRes.body);
  assert.equal(listJson.plans.length, 1);
  assert.equal(listJson.plans[0].id, saveJson.plan.id);
});

test('handler: POST snapshots landed total + GET enriches with current + delta', async () => {
  kv._resetMemoryStore();
  const saveReq = authedReq('POST', { inputs: BASE_INPUTS });
  const saveRes = mockRes();
  await plansHandler(saveReq, saveRes);
  const saveJson = JSON.parse(saveRes.body);
  // Snapshot was computed and stored
  assert.ok(saveJson.plan.snapshot, 'snapshot persisted on save');
  assert.ok(saveJson.plan.snapshot.perShipmentLandedTotal > 0);

  // GET single plan returns the record + current + delta
  const planId = saveJson.plan.id;
  const getReq = authedReq('GET', null, ['plans', planId], `/api/plans/${planId}`);
  const getRes = mockRes();
  await plansHandler(getReq, getRes);
  const getJson = JSON.parse(getRes.body);
  assert.ok(getJson.plan.current, 'current snapshot attached');
  assert.ok(getJson.plan.delta, 'delta attached');
  // Same calculator → no change at zero days
  assert.equal(getJson.plan.delta.landedDeltaEur, 0);
  assert.equal(getJson.plan.delta.significant, false);

  // GET list also enriches each record
  const listReq = authedReq('GET');
  const listRes = mockRes();
  await plansHandler(listReq, listRes);
  const listJson = JSON.parse(listRes.body);
  assert.ok(listJson.plans[0].current);
  assert.ok(listJson.plans[0].delta);
});

test('handler: GET /api/plans/<id> with ownership', async () => {
  kv._resetMemoryStore();
  const saveReq = authedReq('POST', { inputs: BASE_INPUTS });
  const saveRes = mockRes();
  await plansHandler(saveReq, saveRes);
  const planId = JSON.parse(saveRes.body).plan.id;

  const getReq = authedReq('GET', null, ['plans', planId], `/api/plans/${planId}`);
  const getRes = mockRes();
  await plansHandler(getReq, getRes);
  assert.equal(getRes.statusCode, 200);
  const json = JSON.parse(getRes.body);
  assert.equal(json.plan.id, planId);
});

test('handler: GET /api/plans/<unknown-id> → 404', async () => {
  kv._resetMemoryStore();
  const req = authedReq('GET', null, ['plans', 'pl_unknown'], '/api/plans/pl_unknown');
  const res = mockRes();
  await plansHandler(req, res);
  assert.equal(res.statusCode, 404);
});

test('handler: DELETE /api/plans/<id> with ownership', async () => {
  kv._resetMemoryStore();
  const saveReq = authedReq('POST', { inputs: BASE_INPUTS });
  const saveRes = mockRes();
  await plansHandler(saveReq, saveRes);
  const planId = JSON.parse(saveRes.body).plan.id;

  const delReq = authedReq('DELETE', null, ['plans', planId], `/api/plans/${planId}`);
  const delRes = mockRes();
  await plansHandler(delReq, delRes);
  assert.equal(delRes.statusCode, 200);

  // Verify gone
  const list = await savedPlans.listPlans('plans-user@example.com');
  assert.equal(list.length, 0);
});

// ── Static file presence ──────────────────────────────

test('/account/plans/ page exists', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'account/plans/index.html'), 'utf8');
  assert.match(html, /Saved plans/);
  assert.match(html, /id="plans-list"/);
  assert.match(html, /id="plans-empty"/);
  assert.match(html, /id="plans-signin"/);
});

test('/account/plans/app.js fetches /api/plans', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', 'account/plans/app.js'), 'utf8');
  assert.match(js, /fetch\('\/api\/plans'/);
  assert.match(js, /encodeShareInputs/);
});

test('api/[...path].js dispatcher registers plans handler', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dispatcher = fs.readFileSync(path.join(__dirname, '..', 'api/[...path].js'), 'utf8');
  assert.match(dispatcher, /plans: require\('\.\.\/lib\/handlers\/plans'\)/);
});

test('start/app.js wires Save plan button via /api/plans', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', 'start/app.js'), 'utf8');
  assert.match(js, /id="savePlanBtn"/);
  assert.match(js, /\/api\/plans/);
  assert.match(js, /\/api\/auth\/me/);
});
