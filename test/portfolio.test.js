// Sprint portfolio-v1 — multi-SKU portfolio aggregation + endpoint.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Deterministic: no live TARIC fan-out during composePlan.
process.env.ORCATRADE_DISABLE_LIVE_TARIC = '1';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const { aggregatePortfolio, round2 } = require('../lib/intelligence/portfolio-aggregate');
const portfolioHandler = require('../lib/handlers/portfolio');
const customs = require('../lib/intelligence/customs-quote');
const kv = require('../lib/intelligence/kv-store');
const events = require('../lib/events');

// Stub brokerage formula matching the real customs constants.
const stubBrokerage = (lines) => Math.min(45 + 8 * Math.max(1, Math.floor(lines || 1)), 250);

// Build a synthetic per-line composed plan.
function line({ origin = 'CN', dest = 'PL', linesCount = 1, weightKg = 1000, customsValue = 10000, duty = 1200, vat = 2500, brokerage = 53, transport = 500 }) {
  const landed = customsValue + duty + vat + brokerage + transport;
  return {
    ok: true,
    inputs: { originCountry: origin, destinationCountry: dest, linesCount, weightKg },
    totals: {
      customsValueEur: customsValue, dutyEur: duty, vatEur: vat,
      brokerageEur: brokerage, transportEur: transport,
      perShipmentLandedTotal: landed,
      effectiveLandedTotal: customsValue + duty + brokerage + transport,
      vatRecoverableEur: vat,
    },
  };
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

// ── Aggregator: totals + blended duty ───────────────────

test('aggregatePortfolio sums per-line totals', () => {
  const a = aggregatePortfolio([
    line({ customsValue: 10000, duty: 1200, vat: 2500, brokerage: 53, transport: 500 }),
    line({ customsValue: 30000, duty: 900, vat: 7000, brokerage: 61, transport: 800 }),
  ], { brokerageFee: stubBrokerage });
  assert.equal(a.lineCount, 2);
  assert.equal(a.totals.customsValueEur, 40000);
  assert.equal(a.totals.dutyEur, 2100);
  assert.equal(a.totals.vatEur, 9500);
  assert.equal(a.totals.brokerageEur, 114);
  assert.equal(a.totals.transportEur, 1300);
});

test('blended duty rate = total duty / total customs value', () => {
  const a = aggregatePortfolio([
    line({ customsValue: 10000, duty: 1200 }), // 12%
    line({ customsValue: 30000, duty: 900 }),  // 3%
  ], { brokerageFee: stubBrokerage });
  // (1200 + 900) / 40000 = 5.25%
  assert.equal(a.blendedDutyRatePct, 5.25);
});

test('blended duty rate is 0 when customs value is 0 (no divide-by-zero)', () => {
  const a = aggregatePortfolio([], { brokerageFee: stubBrokerage });
  assert.equal(a.blendedDutyRatePct, 0);
  assert.equal(a.lineCount, 0);
});

// ── Consolidation grouping + brokerage saving ───────────

test('same-lane lines consolidate into one customs entry, saving brokerage', () => {
  // Two CN→PL lines: 5 + 3 customs lines, brokerage 85 + 69 = 154 indep.
  const a = aggregatePortfolio([
    line({ origin: 'CN', dest: 'PL', linesCount: 5, brokerage: stubBrokerage(5) }),
    line({ origin: 'CN', dest: 'PL', linesCount: 3, brokerage: stubBrokerage(3) }),
  ], { brokerageFee: stubBrokerage });
  assert.equal(a.groups.length, 1);
  const g = a.groups[0];
  assert.equal(g.originCountry, 'CN');
  assert.equal(g.destinationCountry, 'PL');
  assert.equal(g.lineCount, 2);
  assert.equal(g.totalCustomsLines, 8);
  assert.equal(g.independentBrokerageEur, stubBrokerage(5) + stubBrokerage(3)); // 85 + 69 = 154
  assert.equal(g.consolidatedBrokerageEur, stubBrokerage(8)); // 45 + 64 = 109
  assert.equal(g.brokerageSavingEur, 154 - 109); // 45
  assert.equal(g.transportConsolidatable, true);
  assert.equal(a.consolidationSavingEur, 45);
});

test('different lanes do not consolidate', () => {
  const a = aggregatePortfolio([
    line({ origin: 'CN', dest: 'PL', linesCount: 2 }),
    line({ origin: 'VN', dest: 'DE', linesCount: 2 }),
  ], { brokerageFee: stubBrokerage });
  assert.equal(a.groups.length, 2);
  // Single-line lanes can't consolidate brokerage with anyone → 0 saving.
  assert.equal(a.consolidationSavingEur, 0);
  for (const g of a.groups) assert.equal(g.transportConsolidatable, false);
});

test('groups sorted by line count (biggest consolidation opportunity first)', () => {
  const a = aggregatePortfolio([
    line({ origin: 'VN', dest: 'DE', linesCount: 1 }),
    line({ origin: 'CN', dest: 'PL', linesCount: 1 }),
    line({ origin: 'CN', dest: 'PL', linesCount: 1 }),
    line({ origin: 'CN', dest: 'PL', linesCount: 1 }),
  ], { brokerageFee: stubBrokerage });
  assert.equal(a.groups[0].originCountry, 'CN');
  assert.equal(a.groups[0].lineCount, 3);
});

test('aggregator ignores non-ok / malformed entries', () => {
  const a = aggregatePortfolio([
    line({ customsValue: 10000, duty: 1000 }),
    { ok: false, errors: ['bad'] },
    null,
  ], { brokerageFee: stubBrokerage });
  assert.equal(a.lineCount, 1);
  assert.equal(a.totals.customsValueEur, 10000);
});

test('without a brokerageFee, consolidation saving is 0 (no model)', () => {
  const a = aggregatePortfolio([
    line({ origin: 'CN', dest: 'PL', linesCount: 5 }),
    line({ origin: 'CN', dest: 'PL', linesCount: 3 }),
  ]);
  assert.equal(a.consolidationSavingEur, 0);
});

// ── Endpoint ────────────────────────────────────────────

const goodLine = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 50000, weightKg: 2000 };

test('POST /api/portfolio: 405 on non-POST', async () => {
  const res = mockRes();
  await portfolioHandler({ method: 'GET', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 405);
});

test('POST /api/portfolio: 400 when lines[] missing/empty', async () => {
  const r1 = mockRes();
  await portfolioHandler({ method: 'POST', headers: { 'x-forwarded-for': '1.1.1.1' }, body: {} }, r1);
  assert.equal(r1.statusCode, 400);
  const r2 = mockRes();
  await portfolioHandler({ method: 'POST', headers: { 'x-forwarded-for': '1.1.1.1' }, body: { lines: [] } }, r2);
  assert.equal(r2.statusCode, 400);
});

test('POST /api/portfolio: 400 when too many lines', async () => {
  const lines = Array.from({ length: portfolioHandler.MAX_LINES + 1 }, () => ({ ...goodLine }));
  const res = mockRes();
  await portfolioHandler({ method: 'POST', headers: { 'x-forwarded-for': '2.2.2.2' }, body: { lines } }, res);
  assert.equal(res.statusCode, 400);
});

test('POST /api/portfolio: 200 with aggregate + per-line plans', async () => {
  kv._resetMemoryStore();
  const res = mockRes();
  await portfolioHandler({
    method: 'POST', headers: { 'x-forwarded-for': '3.3.3.3' },
    body: { lines: [
      { ...goodLine, customsValueEur: 50000 },
      { ...goodLine, productCategory: 'electronics', customsValueEur: 30000 },
    ] },
  }, res);
  assert.equal(res.statusCode, 200);
  const body = res._json;
  assert.equal(body.ok, true);
  assert.equal(body.aggregate.lineCount, 2);
  assert.ok(body.aggregate.totals.perShipmentLandedTotal > 0);
  assert.ok(typeof body.aggregate.blendedDutyRatePct === 'number');
  assert.equal(body.lines.length, 2);
  // Both apparel + electronics share CN→PL → one consolidation group.
  assert.equal(body.aggregate.groups.length, 1);
  assert.ok(body.aggregate.groups[0].brokerageSavingEur >= 0);
});

test('POST /api/portfolio: keeps per-line errors, still aggregates the good ones', async () => {
  kv._resetMemoryStore();
  const res = mockRes();
  await portfolioHandler({
    method: 'POST', headers: { 'x-forwarded-for': '4.4.4.4' },
    body: { lines: [
      { ...goodLine },
      { productCategory: 'apparel', originCountry: 'CN' }, // missing destination + value → invalid
    ] },
  }, res);
  assert.equal(res.statusCode, 200);
  const body = res._json;
  assert.equal(body.aggregate.lineCount, 1);
  assert.equal(body.lineErrors.length, 1);
  assert.equal(body.lineErrors[0].index, 1);
});

test('POST /api/portfolio: 400 when every line is invalid', async () => {
  const res = mockRes();
  await portfolioHandler({
    method: 'POST', headers: { 'x-forwarded-for': '5.5.5.5' },
    body: { lines: [{ productCategory: 'apparel' }, { originCountry: 'CN' }] },
  }, res);
  assert.equal(res.statusCode, 400);
  assert.ok(Array.isArray(res._json.lineErrors));
});

test('POST /api/portfolio: records a portfolio_generated event (no PII)', async () => {
  kv._resetMemoryStore();
  const res = mockRes();
  await portfolioHandler({
    method: 'POST', headers: { 'x-forwarded-for': '6.6.6.6' },
    body: { lines: [{ ...goodLine }] },
  }, res);
  await new Promise((r) => setImmediate(r));
  const logRows = await kv.get('events:log');
  const row = (logRows || []).find((e) => e.type === 'portfolio_generated');
  assert.ok(row, 'expected portfolio_generated event');
  assert.equal(row.lineCount, 1);
  assert.ok(!/@/.test(JSON.stringify(row)), 'event must carry no email');
});

test('POST /api/portfolio: 429 after the rate limit', async () => {
  const ip = '7.7.7.7';
  for (let i = 0; i < portfolioHandler.MAX_LINES; i++) { /* noop */ }
  for (let i = 0; i < 7; i++) {
    const r = mockRes();
    await portfolioHandler({ method: 'POST', headers: { 'x-forwarded-for': ip }, body: { lines: [{ ...goodLine }] } }, r);
  }
  const limited = mockRes();
  await portfolioHandler({ method: 'POST', headers: { 'x-forwarded-for': ip }, body: { lines: [{ ...goodLine }] } }, limited);
  assert.equal(limited.statusCode, 429);
});

// ── Wiring ──────────────────────────────────────────────

test('portfolio is registered in the api router', () => {
  const router = fs.readFileSync(path.join(__dirname, '..', 'api', '[...path].js'), 'utf8');
  assert.match(router, /portfolio:\s*require\('\.\.\/lib\/handlers\/portfolio'\)/);
});

test('portfolio_generated is an allowed event type', () => {
  assert.ok(events.ALLOWED_TYPES.has('portfolio_generated'));
});

test('customs.brokerageFee is exported (used by the endpoint for consolidation)', () => {
  assert.equal(typeof customs.brokerageFee, 'function');
});
