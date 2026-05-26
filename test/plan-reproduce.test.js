// /api/plans/<id>/reproduce — reproducibility / drift check
// (Sprint reproducibility-v2, slice 2 / apex III3).

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const kv = require('../lib/intelligence/kv-store');
const auth = require('../lib/auth');
const savedPlans = require('../lib/saved-plans');
const snapshotStore = require('../lib/snapshot-store');
const ds = require('../lib/intelligence/data-snapshot');
const plansHandler = require('../lib/handlers/plans');

const USER = 'repro-user@example.com';
const BASE_INPUTS = {
  productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL',
  customsValueEur: 25000, weightKg: 800,
};

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}
function authedReq(method, body, queryPath, url) {
  const cookie = auth.buildSessionCookie(USER);
  return { method, body, url, query: { path: queryPath }, headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` } };
}
async function savePlan() {
  const rec = await savedPlans.savePlan({ email: USER, inputs: BASE_INPUTS, label: 'repro' });
  return rec;
}

test('save binds a data snapshot id to the plan', async () => {
  kv._resetMemoryStore();
  const rec = await savePlan();
  assert.match(rec.dataSnapshotId, /^ds_[0-9a-f]{16}$/);
  // …and the snapshot is retrievable from the store.
  const snap = await snapshotStore.getSnapshot(rec.dataSnapshotId);
  assert.ok(snap, 'bound snapshot persisted to the store');
});

test('reproduce: data unchanged since save → reproducible', async () => {
  kv._resetMemoryStore();
  const rec = await savePlan();
  const req = authedReq('GET', null, ['plans', rec.id, 'reproduce'], `/api/plans/${rec.id}/reproduce`);
  const res = mockRes();
  await plansHandler(req, res);
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.reproducible, true);
  assert.equal(json.status, 'data-unchanged');
  assert.equal(json.storedSnapshotId, json.currentSnapshotId);
  assert.ok(json.recomputed && json.recomputed.perShipmentLandedTotal > 0, 'current numbers recomputed');
});

test('reproduce: drift → itemises exactly what moved', async () => {
  kv._resetMemoryStore();
  const rec = await savePlan();

  // Simulate the world moving on: stash an OLD snapshot (different FX rate) in
  // the store and repoint the plan at it, as if it had been saved months ago.
  const old = ds.currentDataSnapshot();
  old.snapshot.fx.rates.USD = old.snapshot.fx.rates.USD + 0.5;
  old.id = ds.dataSnapshotId(old.snapshot);
  await snapshotStore.putSnapshot(old);

  const planRec = await kv.get(savedPlans.PLAN_KEY_PREFIX + rec.id);
  planRec.dataSnapshotId = old.id;
  await kv.set(savedPlans.PLAN_KEY_PREFIX + rec.id, planRec);

  const req = authedReq('GET', null, ['plans', rec.id, 'reproduce'], `/api/plans/${rec.id}/reproduce`);
  const res = mockRes();
  await plansHandler(req, res);
  const json = JSON.parse(res.body);
  assert.equal(json.reproducible, false);
  assert.equal(json.status, 'data-drifted');
  assert.notEqual(json.storedSnapshotId, json.currentSnapshotId);
  const usd = json.drift.find((c) => c.field === 'fx.rates.USD');
  assert.ok(usd, 'the moved FX rate is reported in the drift');

  // Slice 3a+3b: the original landed total is recomputed from the stored snapshot.
  assert.ok(json.landedReproduction, 'landed reproduction present');
  assert.ok(json.landedReproduction.original.perShipmentLandedTotal > 0);
});

test('reproduce: drift on a USD plan reproduces the ORIGINAL FX numbers', async () => {
  kv._resetMemoryStore();
  const rec = await savedPlans.savePlan({
    email: USER,
    inputs: { ...BASE_INPUTS, quoteCurrency: 'USD', paymentTermsDays: 60 },
    label: 'usd',
  });

  // Stash an OLD snapshot with a very different USD rate and repoint the plan.
  const old = ds.currentDataSnapshot();
  old.snapshot.fx.rates.USD = 1.40;
  old.snapshot.fx.asOf = '2024-01-01';
  old.id = ds.dataSnapshotId(old.snapshot);
  await snapshotStore.putSnapshot(old);
  const key = savedPlans.PLAN_KEY_PREFIX + rec.id;
  const planRec = await kv.get(key);
  planRec.dataSnapshotId = old.id;
  await kv.set(key, planRec);

  const req = authedReq('GET', null, ['plans', rec.id, 'reproduce'], `/api/plans/${rec.id}/reproduce`);
  const res = mockRes();
  await plansHandler(req, res);
  const json = JSON.parse(res.body);

  assert.equal(json.status, 'data-drifted');
  assert.ok(json.fxReproduction, 'fx reproduction block present for a non-EUR plan');
  assert.equal(json.fxReproduction.currency, 'USD');
  // The ORIGINAL spot rate is recovered from the stored snapshot…
  assert.equal(json.fxReproduction.original.spotRateForeignPerEur, 1.40);
  assert.equal(json.fxReproduction.original.asOf, '2024-01-01');
  // …and differs from today's recompute.
  assert.notEqual(
    json.fxReproduction.original.spotRateForeignPerEur,
    json.fxReproduction.current.spotRateForeignPerEur,
  );
});

test('reproduce: unknown plan → 404', async () => {
  kv._resetMemoryStore();
  const req = authedReq('GET', null, ['plans', 'pl_deadbeefdeadbeef', 'reproduce'], '/api/plans/pl_deadbeefdeadbeef/reproduce');
  const res = mockRes();
  await plansHandler(req, res);
  assert.equal(res.statusCode, 404);
});
