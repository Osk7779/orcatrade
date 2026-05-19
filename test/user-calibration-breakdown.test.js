// Sprint user-calibration-breakdown-v1 — tests for the per-user
// dimensional calibration breakdown.
//
// Covers:
//   - actuals.rowsFromPlans: filter out plans without .actual / .inputs
//     / .snapshot or with malformed landedCents; produce shape compatible
//     with lib/calibration.js#summarise
//   - end-to-end: GET /api/account/calibration with seeded plans returns
//     the right per-dimension breakdown
//   - auth gate: 401 without cookie
//   - threshold: minSamples surfaces in the payload (=3)
//   - empty case: zero actuals → sampleSize 0, empty groups
//   - /account/plans/ markup contract: new card slot exists; app.js
//     fetches /api/account/calibration + has the breakdown render
//     function

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const kv = require('../lib/intelligence/kv-store');
const actuals = require('../lib/actuals');
const calibration = require('../lib/calibration');
const auth = require('../lib/auth');
const savedPlans = require('../lib/saved-plans');
const accountHandler = require('../lib/handlers/account');

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}

// ── actuals.rowsFromPlans ─────────────────────────────

test('rowsFromPlans: empty input → empty array', () => {
  assert.deepEqual(actuals.rowsFromPlans(null), []);
  assert.deepEqual(actuals.rowsFromPlans(undefined), []);
  assert.deepEqual(actuals.rowsFromPlans([]), []);
});

test('rowsFromPlans: skips plans without .actual', () => {
  const rows = actuals.rowsFromPlans([
    { inputs: { productCategory: 'apparel' }, snapshot: { perShipmentLandedTotal: 10000 } },
    { inputs: { productCategory: 'apparel' }, snapshot: { perShipmentLandedTotal: 10000 }, actual: { landedCents: 1050000 } },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].landedCents, 1050000);
});

test('rowsFromPlans: skips plans without inputs OR snapshot OR positive landedCents', () => {
  const rows = actuals.rowsFromPlans([
    { snapshot: { perShipmentLandedTotal: 10000 }, actual: { landedCents: 1000000 } },         // no inputs
    { inputs: { productCategory: 'a' }, actual: { landedCents: 1000000 } },                    // no snapshot
    { inputs: { productCategory: 'a' }, snapshot: { perShipmentLandedTotal: 10000 } },         // no actual
    { inputs: { productCategory: 'a' }, snapshot: { perShipmentLandedTotal: 10000 }, actual: { landedCents: 0 } },  // zero
    { inputs: { productCategory: 'a' }, snapshot: { perShipmentLandedTotal: 10000 }, actual: { landedCents: -1 } }, // negative
    { inputs: { productCategory: 'a' }, snapshot: { perShipmentLandedTotal: 10000 }, actual: { landedCents: 1234 } }, // valid
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].landedCents, 1234);
});

test('rowsFromPlans: output shape is compatible with calibration.summarise', () => {
  // The aggregator reads r.inputs.productCategory + r.snapshot.perShipmentLandedTotal
  // + r.landedCents. Feed rowsFromPlans output straight into summarise()
  // and assert the byCategory group fires.
  const rows = actuals.rowsFromPlans([
    { inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL' }, snapshot: { perShipmentLandedTotal: 10000 }, actual: { landedCents: 1050000 } },
  ]);
  const summary = calibration.summarise(rows);
  assert.equal(summary.total.sampleSize, 1);
  assert.equal(summary.byCategory.length, 1);
  assert.equal(summary.byCategory[0].key, 'apparel');
});

// ── handleCalibration end-to-end ──────────────────────

async function seedPlanWithActual(emailAddr, planInputs, snapshotLanded, actualLandedEur) {
  const planDiff = require('../lib/plan-diff');
  // Use a fake snapshot so we don't need composePlan in this test.
  const snapshot = { perShipmentLandedTotal: snapshotLanded, asOf: new Date().toISOString() };
  const plan = await savedPlans.savePlan({ email: emailAddr, inputs: planInputs, snapshot });
  await actuals.setActual(plan.id, emailAddr, { landedEur: actualLandedEur });
  return plan;
}

function reqWithCookie(method, emailAddr, action) {
  const cookie = auth.buildSessionCookie(emailAddr);
  return {
    method,
    url: '/api/account/' + action,
    headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
    query: { path: ['account', action] },
  };
}

test('GET /api/account/calibration: 401 without session', async () => {
  const req = { method: 'GET', url: '/api/account/calibration', headers: {}, query: { path: ['account', 'calibration'] } };
  const res = mockRes();
  await accountHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test('GET /api/account/calibration: empty case → total.sampleSize 0', async () => {
  kv._resetMemoryStore();
  const req = reqWithCookie('GET', 'empty@example.com', 'calibration');
  const res = mockRes();
  await accountHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.total.sampleSize, 0);
  assert.deepEqual(body.byCategory, []);
  assert.equal(body.minSamples, calibration.WEAK_SAMPLE_THRESHOLD);
});

test('GET /api/account/calibration: aggregates the user\'s actuals by category + route', async () => {
  kv._resetMemoryStore();
  const e = 'breakdown@example.com';
  // Three apparel CN→PL plans, all running 5% UNDER estimate
  await seedPlanWithActual(e, { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL' }, 10000, 9500);
  await seedPlanWithActual(e, { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL' }, 20000, 19000);
  await seedPlanWithActual(e, { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL' }, 30000, 28500);
  // One machinery VN→DE plan running 8% OVER
  await seedPlanWithActual(e, { productCategory: 'machinery', originCountry: 'VN', destinationCountry: 'DE' }, 50000, 54000);

  const req = reqWithCookie('GET', e, 'calibration');
  const res = mockRes();
  await accountHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);

  // Total: 4 actuals across both categories.
  assert.equal(body.total.sampleSize, 4);
  // Categories.
  const apparelCat = body.byCategory.find((g) => g.key === 'apparel');
  assert.ok(apparelCat);
  assert.equal(apparelCat.sampleSize, 3);
  assert.ok(apparelCat.avgVariancePct < 0, 'apparel ran under → negative variance');
  const machineryCat = body.byCategory.find((g) => g.key === 'machinery');
  assert.ok(machineryCat);
  assert.equal(machineryCat.sampleSize, 1);
  assert.ok(machineryCat.avgVariancePct > 0, 'machinery ran over → positive variance');
  assert.equal(machineryCat.weak, true, 'one-sample group flagged as weak');

  // Routes.
  const cnpl = body.byRoute.find((g) => g.key === 'CN → PL');
  assert.ok(cnpl);
  assert.equal(cnpl.sampleSize, 3);
  const vnde = body.byRoute.find((g) => g.key === 'VN → DE');
  assert.ok(vnde);
  assert.equal(vnde.sampleSize, 1);
});

test('GET /api/account/calibration: only the signed-in user\'s plans count (cross-user isolation)', async () => {
  kv._resetMemoryStore();
  await seedPlanWithActual('me@example.com',    { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL' }, 10000, 9000);
  await seedPlanWithActual('other@example.com', { productCategory: 'machinery', originCountry: 'TR', destinationCountry: 'DE' }, 50000, 60000);

  const req = reqWithCookie('GET', 'me@example.com', 'calibration');
  const res = mockRes();
  await accountHandler(req, res);
  const body = JSON.parse(res.body);
  // Only my one apparel plan should be aggregated.
  assert.equal(body.total.sampleSize, 1);
  assert.deepEqual(body.byCategory.map((g) => g.key), ['apparel']);
});

test('GET /api/account/calibration: minSamples reflects WEAK_SAMPLE_THRESHOLD', async () => {
  kv._resetMemoryStore();
  const req = reqWithCookie('GET', 'min@example.com', 'calibration');
  const res = mockRes();
  await accountHandler(req, res);
  const body = JSON.parse(res.body);
  assert.equal(body.minSamples, 3);
});

// ── Dispatcher: 405 on POST ────────────────────────

test('POST /api/account/calibration: 404 (read-only sub-action)', async () => {
  kv._resetMemoryStore();
  const req = reqWithCookie('POST', 'pst@example.com', 'calibration');
  const res = mockRes();
  await accountHandler(req, res);
  assert.equal(res.statusCode, 404, 'dispatcher rejects POST on the calibration action');
});

// ── /account/plans/ UI contract ────────────────────

test('/account/plans/index.html: plans-calibration-breakdown slot present (hidden default)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'plans', 'index.html'), 'utf8');
  assert.match(html, /id=["']plans-calibration-breakdown["']/);
  assert.match(html, /id=["']plans-calibration-breakdown["'][^>]*hidden/);
  assert.match(html, /\.calibration-breakdown\b/);
});

test('/account/plans/app.js: fetches /api/account/calibration + has breakdown render', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'plans', 'app.js'), 'utf8');
  assert.match(js, /fetch\(['"]\/api\/account\/calibration['"]/);
  assert.match(js, /loadBreakdown\b/);
  assert.match(js, /renderBreakdownCard\b/);
  // Threshold gating reads minSamples from the response.
  assert.match(js, /minSamples/);
  // Direction colour classes used.
  assert.match(js, /dir-under/);
  assert.match(js, /dir-over/);
});

// ── Module surface ────────────────────────────────

test('actuals + account handler expose the new surface', () => {
  assert.equal(typeof actuals.rowsFromPlans, 'function');
  assert.equal(typeof accountHandler.handleCalibration, 'function');
});
