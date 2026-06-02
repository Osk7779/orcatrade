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

// ── Slice 3c: CBAM ETS pinning ──────────────────────────────────────
//
// When the saved plan's inputs match a CBAM Annex I category AND the
// origin is non-EU AND tonnage is known, the reproduce verdict carries
// a `cbamReproduction` block that recomputes the certificate-cost
// exposure twice — at the snapshot's pinned ETS price, and at the
// current ETS price. composePlan doesn't surface CBAM today (CBAM
// lives on the analysis path); the reproduce endpoint computes
// CBAM on-the-fly from the saved inputs.

const CBAM_INPUTS_STEEL_CN = {
  productCategory: 'steel', originCountry: 'CN', destinationCountry: 'PL',
  customsValueEur: 100000, weightKg: 50000,   // 50 tonnes of CN steel
};

test('reproduce slice 3c: CBAM-applicable plan + drifted ETS → cbamReproduction populated', async () => {
  kv._resetMemoryStore();
  const rec = await savedPlans.savePlan({
    email: USER, inputs: CBAM_INPUTS_STEEL_CN, label: 'cbam-steel',
  });

  // Stash an OLD snapshot with a different ETS price and repoint the plan.
  const old = ds.currentDataSnapshot();
  // Set a clearly different pinned ETS price so the drift is unambiguous.
  old.snapshot.cbamEts = { ...(old.snapshot.cbamEts || {}), priceEurPerTonne: 50, asOf: '2024-01-01' };
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
  assert.ok(json.cbamReproduction, 'cbamReproduction block must be present for a CBAM-applicable drifted plan');
  assert.equal(json.cbamReproduction.categoryKey, 'iron_and_steel');
  assert.equal(json.cbamReproduction.tonnesGoods, 50);
  assert.equal(json.cbamReproduction.original.etsPriceEurPerTonne, 50);
  assert.equal(json.cbamReproduction.original.asOf, '2024-01-01');
  // The recomputed certificate cost at the pinned ETS price differs from
  // the current ETS price — the load-bearing proof that pinning works.
  assert.notEqual(
    json.cbamReproduction.original.certificateCostEurCentral,
    json.cbamReproduction.current.certificateCostEurCentral,
    'pinned and current certificate costs must differ when the ETS price drifted',
  );
  assert.ok(json.cbamReproduction.original.certificateCostEurCentral > 0);
  assert.ok(json.cbamReproduction.current.certificateCostEurCentral > 0);
});

test('reproduce slice 3c: non-CBAM-applicable plan → cbamReproduction is null', async () => {
  kv._resetMemoryStore();
  // apparel + CN + non-EU origin = NOT a CBAM category
  const rec = await savePlan();

  // Force a drift so the endpoint reaches the cbamReproduction code path.
  const old = ds.currentDataSnapshot();
  old.snapshot.fx.rates.USD = old.snapshot.fx.rates.USD + 0.5;
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
  assert.equal(json.cbamReproduction, null, 'apparel plan must not carry a cbamReproduction block');
});

test('reproduce slice 3c: CBAM-applicable plan with no weight → cbamReproduction is null', async () => {
  kv._resetMemoryStore();
  // Steel from CN but no weightKg — without tonnage we cannot compute exposure.
  const noWeight = { ...CBAM_INPUTS_STEEL_CN };
  delete noWeight.weightKg;
  const rec = await savedPlans.savePlan({ email: USER, inputs: noWeight, label: 'no-weight' });

  const old = ds.currentDataSnapshot();
  old.snapshot.cbamEts = { ...(old.snapshot.cbamEts || {}), priceEurPerTonne: 50, asOf: '2024-01-01' };
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

  assert.equal(json.cbamReproduction, null, 'no tonnage = no CBAM reproduction (cannot compute exposure)');
});

test('reproduce slice 3c: CBAM plan with EEA EFTA origin → cbamReproduction is null (Art 2(3) exclusion)', async () => {
  kv._resetMemoryStore();
  // Steel from Iceland — Regulation (EU) 2023/956, Art 2(3) excludes
  // goods originating in EEA EFTA states (IS, LI, NO) and Switzerland
  // because their ETS is integrated with the EU's. Note: the
  // calculator does NOT currently model intra-EU origin (e.g. DE→PL)
  // as a CBAM exclusion — that's a separate gap in
  // determineCbamApplicability (logged for a follow-up PR; out of
  // scope for slice 3c which is about pinning the ETS price, not
  // tightening the applicability check).
  const eeaEfta = { ...CBAM_INPUTS_STEEL_CN, originCountry: 'IS' };
  const rec = await savedPlans.savePlan({ email: USER, inputs: eeaEfta, label: 'eea-efta' });

  const old = ds.currentDataSnapshot();
  old.snapshot.cbamEts = { ...(old.snapshot.cbamEts || {}), priceEurPerTonne: 50, asOf: '2024-01-01' };
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

  assert.equal(json.cbamReproduction, null, 'intra-EU origin = CBAM does not apply = no reproduction block');
});

test('GET /plans list stamps reproducible:true on a freshly-saved plan', async () => {
  kv._resetMemoryStore();
  await savePlan();
  const req = authedReq('GET', null, ['plans'], '/api/plans');
  const res = mockRes();
  await plansHandler(req, res);
  const list = JSON.parse(res.body);
  assert.equal(list.plans.length, 1);
  assert.equal(list.plans[0].reproducible, true);
  assert.equal(list.plans[0].dataDrifted, false);
  assert.match(list.plans[0].currentDataSnapshotId, /^ds_[0-9a-f]{16}$/);
});
