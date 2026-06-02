// Sprint portfolio-drift-v1 — "what changed since you saved" for portfolios.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
process.env.ORCATRADE_DISABLE_LIVE_TARIC = '1';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const { comparePortfolioSnapshots, aggregatePortfolio } = require('../lib/intelligence/portfolio-aggregate');
const sp = require('../lib/saved-portfolios');
const auth = require('../lib/auth');
const kv = require('../lib/intelligence/kv-store');
const portfolioHandler = require('../lib/handlers/portfolio');

function snap(landed, duty, blended) {
  return { totals: { perShipmentLandedTotal: landed, dutyEur: duty }, blendedDutyRatePct: blended };
}
function freshAgg(landed, duty, blended) {
  return { totals: { perShipmentLandedTotal: landed, dutyEur: duty }, blendedDutyRatePct: blended };
}
function mockRes() {
  const res = {
    statusCode: 200, headers: {}, body: '', _json: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this._json = obj; this.body = JSON.stringify(obj); return this; },
    end(body) { this.body = body || ''; return this; },
  };
  return res;
}
function parse(res) { try { return res._json || JSON.parse(res.body); } catch (_) { return null; } }
function cookieFor(email) { return 'orcatrade_session=' + encodeURIComponent(auth.buildSessionCookie(email)); }

// ── comparePortfolioSnapshots (pure) ────────────────────

test('material increase flagged with correct delta + direction', () => {
  const d = comparePortfolioSnapshots(snap(100000, 8000, 8), freshAgg(112000, 9000, 9));
  assert.equal(d.landedDeltaEur, 12000);
  assert.equal(d.landedDeltaPct, 12);
  assert.equal(d.direction, 'up');
  assert.equal(d.material, true);
  assert.equal(d.dutyDeltaEur, 1000);
  assert.equal(d.blendedDutyDeltaPct, 1);
});

test('material decrease flagged as down', () => {
  const d = comparePortfolioSnapshots(snap(100000, 8000, 8), freshAgg(90000, 7000, 7));
  assert.equal(d.landedDeltaEur, -10000);
  assert.equal(d.landedDeltaPct, -10);
  assert.equal(d.direction, 'down');
  assert.equal(d.material, true);
});

test('sub-threshold change is not material', () => {
  const d = comparePortfolioSnapshots(snap(100000, 8000, 8), freshAgg(102000, 8100, 8));
  assert.equal(d.landedDeltaPct, 2);
  assert.equal(d.material, false);
});

test('null when no baseline (legacy save / zero base / missing totals)', () => {
  assert.equal(comparePortfolioSnapshots(null, freshAgg(100, 1, 1)), null);
  assert.equal(comparePortfolioSnapshots(snap(0, 0, 0), freshAgg(100, 1, 1)), null);
  assert.equal(comparePortfolioSnapshots({ blendedDutyRatePct: 5 }, freshAgg(100, 1, 1)), null);
  assert.equal(comparePortfolioSnapshots(snap(100, 1, 1), null), null);
});

test('custom threshold respected', () => {
  const d = comparePortfolioSnapshots(snap(100000, 8000, 8), freshAgg(103000, 8000, 8), { thresholdPct: 2 });
  assert.equal(d.material, true); // 3% >= 2%
});

// ── /api/portfolio/item/<id>/refresh endpoint ───────────

const lines = [
  { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 50000, weightKg: 2000 },
  { productCategory: 'electronics', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 30000, weightKg: 800 },
];

test('refresh: 401 unauthed', async () => {
  kv._resetMemoryStore();
  const rec = await sp.savePortfolio({ email: 'o@example.com', lines });
  const res = mockRes();
  await portfolioHandler({ method: 'POST', headers: {}, query: { path: 'portfolio/item/' + rec.id + '/refresh' } }, res);
  assert.equal(res.statusCode, 401);
});

test('refresh: 404 for non-owner / unknown', async () => {
  kv._resetMemoryStore();
  const rec = await sp.savePortfolio({ email: 'o@example.com', lines });
  const res = mockRes();
  await portfolioHandler({ method: 'POST', headers: { cookie: cookieFor('intruder@example.com') }, query: { path: 'portfolio/item/' + rec.id + '/refresh' } }, res);
  assert.equal(res.statusCode, 404);
});

test('refresh: 200 recomputes + returns aggregate, lines, drift, savedAt', async () => {
  kv._resetMemoryStore();
  // Save with a deliberately-stale snapshot so drift is computable + material.
  const staleSnapshot = {
    lineCount: 2, blendedDutyRatePct: 4, consolidationSavingEur: 0,
    totals: { customsValueEur: 80000, dutyEur: 1000, vatEur: 1, brokerageEur: 1, transportEur: 1, perShipmentLandedTotal: 50000 },
  };
  const rec = await sp.savePortfolio({ email: 'o@example.com', lines, label: 'Cat', snapshot: staleSnapshot });
  const res = mockRes();
  await portfolioHandler({ method: 'POST', headers: { cookie: cookieFor('o@example.com') }, query: { path: 'portfolio/item/' + rec.id + '/refresh' } }, res);
  assert.equal(res.statusCode, 200);
  const body = parse(res);
  assert.equal(body.ok, true);
  assert.ok(body.aggregate && body.aggregate.totals.perShipmentLandedTotal > 0);
  assert.equal(body.lines.length, 2);
  assert.equal(body.label, 'Cat');
  assert.ok(body.savedAt);
  // Drift present: real recompute (~105k) vs stale 50k baseline → material up.
  assert.ok(body.drift);
  assert.equal(body.drift.direction, 'up');
  assert.equal(body.drift.material, true);
});

test('refresh: drift is null when the saved portfolio had no snapshot', async () => {
  kv._resetMemoryStore();
  const rec = await sp.savePortfolio({ email: 'o@example.com', lines }); // no snapshot
  const res = mockRes();
  await portfolioHandler({ method: 'POST', headers: { cookie: cookieFor('o@example.com') }, query: { path: 'portfolio/item/' + rec.id + '/refresh' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(parse(res).drift, null);
});

// ── UI contract ─────────────────────────────────────────

test('/portfolio/ reopens saved portfolios via /refresh + renders a drift callout', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'portfolio', 'app.js'), 'utf8');
  assert.match(js, /\/refresh/);
  assert.match(js, /data\.drift/);
  assert.match(js, /pf-drift/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'portfolio', 'legacy', 'index.html'), 'utf8');
  assert.match(html, /\.pf-drift/);
});
