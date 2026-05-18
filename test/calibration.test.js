// Sprint BG-1.6 — Cross-user calibration dashboard.
//
// Three layers:
//   1. Pure aggregators in lib/calibration.js — variance + groupBy + summarise.
//   2. /api/calibration handler — token gate + payload shape.
//   3. /dashboard/calibration/ HTML + app.js markup contract.

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
process.env.ORCATRADE_LEADS_TOKEN = 'test-leads-token';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const calibration = require('../lib/calibration');
const handler = require('../lib/handlers/calibration');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(body) { this.body = body || ''; return this; },
  };
}

// Row shape mirrors actuals.listFromPg(): { planId, emailHash, inputs,
// snapshot, landedCents, dutyCents, freightCents, reportedAt, notes }.
function row({ category = 'apparel', origin = 'CN', destination = 'PL', estimate = 30000, actual = 30000, planId = 'pl_x' } = {}) {
  return {
    planId,
    emailHash: 'aaaaaaaaaaaaaaaa',
    inputs: { productCategory: category, originCountry: origin, destinationCountry: destination, customsValueEur: 25000 },
    snapshot: { perShipmentLandedTotal: estimate, schemaVersion: 1 },
    landedCents: Math.round(actual * 100),
    dutyCents: null,
    freightCents: null,
    reportedAt: '2026-05-18T10:00:00.000Z',
    notes: '',
  };
}

// ── rowVariance (pure) ────────────────────────────────

test('rowVariance: positive delta when actual > estimate', () => {
  const v = calibration.rowVariance(row({ estimate: 30000, actual: 33000 }));
  assert.equal(v.estimateEur, 30000);
  assert.equal(v.actualEur, 33000);
  assert.equal(v.deltaEur, 3000);
  assert.equal(Math.round(v.deltaPct * 10) / 10, 10);
});

test('rowVariance: null when snapshot missing or estimate non-positive', () => {
  assert.equal(calibration.rowVariance({}), null);
  assert.equal(calibration.rowVariance({ snapshot: null, landedCents: 1000 }), null);
  assert.equal(calibration.rowVariance({ snapshot: { perShipmentLandedTotal: 0 }, landedCents: 1000 }), null);
  assert.equal(calibration.rowVariance({ snapshot: { perShipmentLandedTotal: -10 }, landedCents: 1000 }), null);
});

test('rowVariance: null when landedCents non-positive or missing', () => {
  assert.equal(calibration.rowVariance({ snapshot: { perShipmentLandedTotal: 1000 }, landedCents: 0 }), null);
  assert.equal(calibration.rowVariance({ snapshot: { perShipmentLandedTotal: 1000 } }), null);
});

// ── groupBy (pure) ────────────────────────────────────

test('groupBy: empty input → empty array', () => {
  assert.deepEqual(calibration.groupBy([], (r) => r.inputs.productCategory), []);
  assert.deepEqual(calibration.groupBy(null, (r) => r.inputs.productCategory), []);
});

test('groupBy: groups by extracted key', () => {
  const rows = [
    row({ category: 'apparel',     estimate: 10000, actual: 11000 }),
    row({ category: 'apparel',     estimate: 10000, actual: 10500 }),
    row({ category: 'electronics', estimate: 50000, actual: 51000 }),
  ];
  const out = calibration.groupBy(rows, (r) => r.inputs.productCategory);
  // Sorted by |drift| desc; significant rows first; weak samples (<3) sink.
  // apparel sample=2 → weak; electronics sample=1 → weak. Both weak, so
  // tie-break: bigger |drift| wins. apparel avg = ((10+5)*10000)/20000 = 7.5%;
  // electronics = (2%)*50000/50000 = 2%. apparel wins.
  assert.equal(out.length, 2);
  assert.equal(out[0].key, 'apparel');
  assert.equal(out[0].sampleSize, 2);
  assert.equal(out[0].weak, true);
  assert.equal(out[0].avgVariancePct, 7.5);
  assert.equal(out[1].key, 'electronics');
});

test('groupBy: significant non-weak group floats above weak groups regardless of drift', () => {
  // 3 samples of apparel at 5% drift (significant, non-weak).
  // 1 sample of electronics at 30% drift (weak — sinks).
  const rows = [
    row({ category: 'apparel', estimate: 10000, actual: 10500 }),
    row({ category: 'apparel', estimate: 10000, actual: 10500 }),
    row({ category: 'apparel', estimate: 10000, actual: 10500 }),
    row({ category: 'electronics', estimate: 10000, actual: 13000 }),
  ];
  const out = calibration.groupBy(rows, (r) => r.inputs.productCategory);
  assert.equal(out[0].key, 'apparel');
  assert.equal(out[0].weak, false);
  assert.equal(out[0].significant, true);
  assert.equal(out[1].key, 'electronics');
  assert.equal(out[1].weak, true);
});

test('groupBy: skips rows with missing key', () => {
  // The row() helper has a default, so to actually get a missing key
  // we delete it after construction.
  const goodRow = row({ category: 'apparel', estimate: 10000, actual: 10500 });
  const missingKeyRow = row({ estimate: 10000, actual: 10500 });
  delete missingKeyRow.inputs.productCategory;
  const out = calibration.groupBy([goodRow, missingKeyRow], (r) => r.inputs.productCategory);
  assert.equal(out.length, 1);
  assert.equal(out[0].sampleSize, 1);
  assert.equal(out[0].key, 'apparel');
});

test('groupBy: value-weighted average (big rows pull the average more)', () => {
  const rows = [
    row({ category: 'apparel', estimate: 100000, actual: 110000 }),  // 10% over, weight 100k
    row({ category: 'apparel', estimate: 1000,   actual: 990 }),     // -1% under, weight 1k
  ];
  const out = calibration.groupBy(rows, (r) => r.inputs.productCategory);
  // avg = (10*100000 + (-1)*1000) / 101000 = 999000/101000 ≈ 9.89 → rounded to 9.9
  assert.equal(out[0].avgVariancePct, 9.9);
  assert.equal(out[0].sampleSize, 2);
});

// ── summarise (the headline aggregator) ───────────────

test('summarise: empty input — sampleSize 0, on-target, all groups empty', () => {
  const s = calibration.summarise([]);
  assert.equal(s.total.sampleSize, 0);
  assert.equal(s.total.direction, 'on-target');
  assert.deepEqual(s.byRoute, []);
  assert.deepEqual(s.byCategory, []);
  assert.deepEqual(s.byOrigin, []);
  assert.deepEqual(s.byDestination, []);
  assert.match(s.asOf, /^\d{4}-\d{2}-\d{2}T/);
});

test('summarise: total = value-weighted across ALL rows + direction reflects sign', () => {
  const rows = [
    row({ origin: 'CN', destination: 'PL', estimate: 30000, actual: 33000 }),   // +10%
    row({ origin: 'VN', destination: 'DE', estimate: 30000, actual: 33000 }),   // +10%
  ];
  const s = calibration.summarise(rows);
  assert.equal(s.total.sampleSize, 2);
  assert.equal(s.total.avgVariancePct, 10);
  assert.equal(s.total.direction, 'over');
  assert.equal(s.total.totalEstimateEur, 60000);
  assert.equal(s.total.totalActualEur, 66000);
  assert.equal(s.total.totalDeltaEur, 6000);
  assert.equal(s.total.over, 2);
  assert.equal(s.total.under, 0);
  assert.equal(s.total.onTarget, 0);
});

test('summarise: route key is "origin → destination"; routes with missing parts dropped', () => {
  const rows = [
    row({ origin: 'CN', destination: 'PL', estimate: 30000, actual: 33000 }),
    row({ origin: 'CN', destination: undefined, estimate: 30000, actual: 33000 }),
  ];
  const s = calibration.summarise(rows);
  assert.equal(s.byRoute.length, 1);
  assert.equal(s.byRoute[0].key, 'CN → PL');
});

test('summarise: under-budget cumulative bias → direction:under', () => {
  const rows = [
    row({ estimate: 30000, actual: 27000 }),   // -10%
    row({ estimate: 30000, actual: 28500 }),   // -5%
  ];
  const s = calibration.summarise(rows);
  assert.ok(s.total.avgVariancePct < 0);
  assert.equal(s.total.direction, 'under');
});

// ── findAlerts (Sprint BG-1.7) ────────────────────────

test('findAlerts: empty summary → empty alerts', () => {
  assert.deepEqual(calibration.findAlerts(null), []);
  assert.deepEqual(calibration.findAlerts({}), []);
  assert.deepEqual(calibration.findAlerts({ byRoute: [], byCategory: [] }), []);
});

test('findAlerts: ignores groups with too few samples', () => {
  // 10% drift but only 2 samples — below ALERT_MIN_SAMPLES.
  const summary = {
    byRoute: [{ key: 'CN → PL', sampleSize: 2, avgVariancePct: 10, totalEstimateEur: 1000, totalActualEur: 1100 }],
    byCategory: [], byOrigin: [], byDestination: [],
  };
  assert.deepEqual(calibration.findAlerts(summary), []);
});

test('findAlerts: ignores groups with insufficient drift', () => {
  // 5 samples but only 2% drift — below ALERT_MIN_DRIFT_PCT.
  const summary = {
    byRoute: [{ key: 'CN → PL', sampleSize: 5, avgVariancePct: 2, totalEstimateEur: 1000, totalActualEur: 1020 }],
    byCategory: [], byOrigin: [], byDestination: [],
  };
  assert.deepEqual(calibration.findAlerts(summary), []);
});

test('findAlerts: returns groups crossing both thresholds, with direction', () => {
  const summary = {
    byRoute: [
      { key: 'CN → PL', sampleSize: 8, avgVariancePct: 12, totalEstimateEur: 100000, totalActualEur: 112000 },
      { key: 'VN → DE', sampleSize: 7, avgVariancePct: -8, totalEstimateEur: 50000, totalActualEur: 46000 },
    ],
    byCategory: [
      { key: 'apparel', sampleSize: 10, avgVariancePct: 6, totalEstimateEur: 80000, totalActualEur: 84800 },
    ],
    byOrigin: [],
    byDestination: [],
  };
  const alerts = calibration.findAlerts(summary);
  assert.equal(alerts.length, 3);
  // Sorted by |drift| desc: CN→PL (12) > VN→DE (8) > apparel (6).
  assert.equal(alerts[0].key, 'CN → PL');
  assert.equal(alerts[0].direction, 'over');
  assert.equal(alerts[0].dimension, 'byRoute');
  assert.equal(alerts[1].key, 'VN → DE');
  assert.equal(alerts[1].direction, 'under');
  assert.equal(alerts[2].key, 'apparel');
  assert.equal(alerts[2].dimension, 'byCategory');
});

test('findAlerts: respects custom thresholds via opts', () => {
  const summary = {
    byRoute: [{ key: 'CN → PL', sampleSize: 4, avgVariancePct: 4, totalEstimateEur: 1000, totalActualEur: 1040 }],
    byCategory: [], byOrigin: [], byDestination: [],
  };
  // With looser defaults (3 samples, 3% drift) the row crosses both.
  assert.equal(calibration.findAlerts(summary, { minSamples: 3, minDriftPct: 3 }).length, 1);
  // With tighter defaults (5/5) it doesn't.
  assert.equal(calibration.findAlerts(summary, { minSamples: 5, minDriftPct: 5 }).length, 0);
});

test('findAlerts: defends against malformed row entries', () => {
  const summary = {
    byRoute: [
      null,
      { key: 'CN → PL', sampleSize: 8 /* no avgVariancePct */, totalEstimateEur: 1000, totalActualEur: 1100 },
      { key: 'VN → DE', sampleSize: 8, avgVariancePct: 12, totalEstimateEur: 50000, totalActualEur: 56000 },
    ],
    byCategory: [], byOrigin: [], byDestination: [],
  };
  const alerts = calibration.findAlerts(summary);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].key, 'VN → DE');
});

// ── runCalibrationDriftCheck (cron job, Sprint BG-1.7) ─

test('runCalibrationDriftCheck: PG unconfigured → no-op result with alertCount=0', async () => {
  // Reuse the lazy-loaded cron module for the runner.
  const cron = require('../lib/handlers/cron');
  const kv = require('../lib/intelligence/kv-store');
  const prevDb = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_UNPOOLED;
  kv._resetMemoryStore();
  try {
    const result = await cron.runCalibrationDriftCheck({});
    assert.equal(result.rowsScanned, 0);
    assert.equal(result.totalSampleSize, 0);
    assert.equal(result.alertCount, 0);
    assert.deepEqual(result.alerts, []);
    assert.match(result.runAt, /^\d{4}-\d{2}-\d{2}T/);
    // Even on a no-op the job writes the snapshot so the dashboard
    // can show "last run, no alerts" rather than a stale state.
    const snap = await kv.get(cron.CALIBRATION_ALERT_KEY);
    assert.ok(snap);
    assert.equal(snap.alerts.length, 0);
  } finally {
    if (prevDb) process.env.DATABASE_URL = prevDb;
  }
});

test('JOBS map registers the calibration-drift-check job', () => {
  const cron = require('../lib/handlers/cron');
  assert.equal(typeof cron.JOBS['calibration-drift-check'], 'function');
});

// ── /api/calibration handler ──────────────────────────

test('handler: 405 on non-GET', async () => {
  const req = { method: 'POST', headers: {}, query: {}, url: '/api/calibration' };
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

test('handler: 503 when ORCATRADE_LEADS_TOKEN unset', async () => {
  const prev = process.env.ORCATRADE_LEADS_TOKEN;
  delete process.env.ORCATRADE_LEADS_TOKEN;
  try {
    const req = { method: 'GET', headers: {}, query: { token: 'anything' }, url: '/api/calibration' };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 503);
  } finally {
    process.env.ORCATRADE_LEADS_TOKEN = prev;
  }
});

test('handler: 401 on missing token', async () => {
  const req = { method: 'GET', headers: {}, query: {}, url: '/api/calibration' };
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 401);
});

test('handler: 401 on wrong token', async () => {
  const req = { method: 'GET', headers: {}, query: { token: 'wrong' }, url: '/api/calibration' };
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 401);
});

test('handler: 200 + empty summary when Postgres unconfigured (no actuals)', async () => {
  const prevDb = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_UNPOOLED;
  try {
    const req = { method: 'GET', headers: {}, query: { token: 'test-leads-token' }, url: '/api/calibration' };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.rowsScanned, 0);
    assert.equal(body.total.sampleSize, 0);
    assert.deepEqual(body.byCategory, []);
    assert.match(body.asOf, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok('mode' in body);
    assert.ok('limit' in body);
  } finally {
    if (prevDb) process.env.DATABASE_URL = prevDb;
  }
});

test('handler: response includes the alerts array (Sprint BG-1.7)', async () => {
  const prevDb = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_UNPOOLED;
  try {
    const req = { method: 'GET', headers: {}, query: { token: 'test-leads-token' }, url: '/api/calibration' };
    const res = mockRes();
    await handler(req, res);
    const body = JSON.parse(res.body);
    // Even with zero rows the alerts field is present (empty array)
    // so the client never has to branch on undefined.
    assert.ok(Array.isArray(body.alerts), 'alerts must be an array');
    assert.equal(body.alerts.length, 0);
  } finally {
    if (prevDb) process.env.DATABASE_URL = prevDb;
  }
});

test('handler: limit defaults to 1000 + is clamped to [1, 10000]', async () => {
  const prevDb = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_UNPOOLED;
  try {
    async function runWith(qLimit) {
      const req = { method: 'GET', headers: {}, query: { token: 'test-leads-token', limit: qLimit }, url: '/api/calibration' };
      const res = mockRes();
      await handler(req, res);
      const body = JSON.parse(res.body);
      return body.limit;
    }
    assert.equal(await runWith(''), 1000);
    assert.equal(await runWith('notANumber'), 1000);
    assert.equal(await runWith('0'), 1);
    assert.equal(await runWith('-50'), 1);
    assert.equal(await runWith('99999'), 10000);
    assert.equal(await runWith('500'), 500);
  } finally {
    if (prevDb) process.env.DATABASE_URL = prevDb;
  }
});

// ── Dispatcher registration ───────────────────────────

test('api/[...path].js dispatcher registers calibration handler', () => {
  const dispatcher = fs.readFileSync(path.join(__dirname, '..', 'api/[...path].js'), 'utf8');
  assert.match(dispatcher, /calibration: require\('\.\.\/lib\/handlers\/calibration'\)/);
});

// ── /dashboard/calibration/ UI contract ───────────────

const HTML = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'calibration', 'index.html'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'calibration', 'app.js'), 'utf8');

test('/dashboard/calibration/ page exists + noindex', () => {
  assert.ok(HTML.length > 1500);
  assert.match(HTML, /<meta name="robots" content="noindex,\s*nofollow"/i);
});

test('/dashboard/calibration/ page has every required DOM hook', () => {
  // BG-1.6 hooks + BG-1.7 alerts-pane slot.
  for (const id of ['controls', 'token', 'limit', 'load-btn', 'error', 'empty', 'results', 'stats', 'alerts-pane', 'byRoute', 'byCategory', 'byOrigin', 'byDestination']) {
    assert.match(HTML, new RegExp(`id=["']${id}["']`), `id="${id}" present`);
  }
});

test('/dashboard/calibration/ app.js renders alerts when payload has any (Sprint BG-1.7)', () => {
  assert.match(JS, /function renderAlerts\s*\(/);
  // The alerts pane CSS hooks must be referenced when rendering.
  assert.match(JS, /alerts-pane/);
  // Direction colour classes used.
  assert.match(JS, /pct\s+['"]?\s*\+\s*a\.direction|a\.direction/);
});

test('/dashboard/calibration/ app.js fetches /api/calibration with the token', () => {
  // URL built into a variable, then passed to fetch — assert that the
  // URL string with the token query param exists in the source, plus
  // that we actually call fetch().
  assert.match(JS, /\/api\/calibration\?token=/);
  assert.match(JS, /encodeURIComponent\(token\)/);
  assert.match(JS, /fetch\(/);
});

test('/dashboard/calibration/ app.js handles 401 + 503 + ok branches', () => {
  assert.match(JS, /resp\.status\s*===\s*401/);
  assert.match(JS, /resp\.status\s*===\s*503/);
});

test('/dashboard/calibration/ app.js persists token in sessionStorage', () => {
  assert.match(JS, /sessionStorage\.setItem/);
  assert.match(JS, /sessionStorage\.getItem/);
});
