// FX risk calculator tests.

const test = require('node:test');
const assert = require('node:assert/strict');

const fxData = require('../lib/intelligence/data/fx-snapshot');
const fx = require('../lib/intelligence/fx-quote');
const { composePlan } = require('../lib/handlers/start');

// ── Snapshot table ─────────────────────────────────────

test('SUPPORTED_CURRENCIES includes major Asian sourcing currencies', () => {
  for (const c of ['USD', 'CNY', 'VND', 'INR', 'BDT', 'TRY', 'HKD', 'TWD', 'KRW', 'JPY', 'GBP', 'EUR']) {
    assert.ok(fxData.SUPPORTED_CURRENCIES.includes(c), `${c} supported`);
  }
});

test('ASOF is yyyy-mm-dd', () => {
  assert.match(fxData.ASOF, /^\d{4}-\d{2}-\d{2}$/);
});

test('EUR rate is 1.0 (identity)', () => {
  assert.equal(fxData.RATES.EUR, 1.0);
});

test('USD rate is plausible (around 1.0–1.3)', () => {
  const rate = fxData.RATES.USD;
  assert.ok(rate > 0.85 && rate < 1.5, `USD rate ${rate} should be in plausible range`);
});

test('VND rate is in thousands (around 25k–28k)', () => {
  const rate = fxData.RATES.VND;
  assert.ok(rate > 20000 && rate < 30000, `VND rate ${rate} should be ~26k`);
});

// ── Conversion ─────────────────────────────────────────

test('convertToEur: 1080 USD ≈ €1000 at 1.08 rate', () => {
  const result = fxData.convertToEur(1080, 'USD');
  assert.ok(Math.abs(result - 1000) < 0.01, `expected ~1000, got ${result}`);
});

test('convertToEur: handles unsupported currency by returning null', () => {
  assert.equal(fxData.convertToEur(100, 'XXX'), null);
});

test('convertFromEur: €1000 → ~1080 USD', () => {
  const result = fxData.convertFromEur(1000, 'USD');
  assert.ok(Math.abs(result - 1080) < 0.01);
});

test('convertFromEur: €1000 → ~26.3M VND', () => {
  const result = fxData.convertFromEur(1000, 'VND');
  assert.ok(Math.abs(result - 26300000) < 1, `expected 26.3M, got ${result}`);
});

// ── assessFxRisk ───────────────────────────────────────

test('assessFxRisk: EUR is no-op (returns noFxRisk: true)', () => {
  const r = fx.assessFxRisk({ customsValueEur: 30000, quoteCurrency: 'EUR', paymentTermsDays: 60 });
  assert.equal(r.ok, true);
  assert.equal(r.noFxRisk, true);
});

test('assessFxRisk: USD on €30K, 60-day terms — produces full risk profile', () => {
  const r = fx.assessFxRisk({ customsValueEur: 30000, quoteCurrency: 'USD', paymentTermsDays: 60 });
  assert.equal(r.ok, true);
  assert.equal(r.currency, 'USD');
  assert.ok(r.spotRateForeignPerEur > 0);
  assert.ok(r.equivalentForeign > 30000); // USD weaker than EUR
  assert.match(r.equivalentForeignFormatted, /^\$/);
  assert.ok(r.riskEur1Sigma90d > 0);
  assert.ok(r.hedgeCostEur > 0);
  assert.ok(['hedge', 'consider', 'accept', 'skip'].includes(r.recommendation));
});

test('assessFxRisk: TRY on €30K → recommend hedge (high vol)', () => {
  const r = fx.assessFxRisk({ customsValueEur: 30000, quoteCurrency: 'TRY', paymentTermsDays: 60 });
  assert.equal(r.recommendation, 'hedge');
  assert.ok(r.riskEur1Sigma90d > 2000, 'TRY 12% vol on €30K = ~€3.6K risk');
});

test('assessFxRisk: HKD (pegged to USD, very low vol) → recommend accept', () => {
  const r = fx.assessFxRisk({ customsValueEur: 30000, quoteCurrency: 'HKD', paymentTermsDays: 60 });
  assert.equal(r.recommendation, 'accept');
});

test('assessFxRisk: small €3K shipment → recommend skip (below threshold)', () => {
  const r = fx.assessFxRisk({ customsValueEur: 3000, quoteCurrency: 'USD', paymentTermsDays: 60 });
  assert.equal(r.recommendation, 'skip');
});

test('assessFxRisk: hedge cost scales with payment-term days', () => {
  const r30 = fx.assessFxRisk({ customsValueEur: 30000, quoteCurrency: 'USD', paymentTermsDays: 30 });
  const r90 = fx.assessFxRisk({ customsValueEur: 30000, quoteCurrency: 'USD', paymentTermsDays: 90 });
  assert.ok(r90.hedgeCostEur > r30.hedgeCostEur, 'longer terms = higher hedge cost');
  // Should roughly triple (30 → 90 days)
  assert.ok(r90.hedgeCostEur > 2 * r30.hedgeCostEur);
});

test('assessFxRisk: CNY hedge cost > USD (wider EM forward spread)', () => {
  const usd = fx.assessFxRisk({ customsValueEur: 30000, quoteCurrency: 'USD', paymentTermsDays: 60 });
  const cny = fx.assessFxRisk({ customsValueEur: 30000, quoteCurrency: 'CNY', paymentTermsDays: 60 });
  assert.ok(cny.hedgeCostEur > usd.hedgeCostEur);
});

test('assessFxRisk: rejects malformed input', () => {
  const r = fx.assessFxRisk({ customsValueEur: -100, quoteCurrency: 'USD' });
  assert.equal(r.ok, false);
  assert.ok(r.errors);
});

test('assessFxRisk: rejects unsupported currency', () => {
  const r = fx.assessFxRisk({ customsValueEur: 30000, quoteCurrency: 'XXX' });
  assert.equal(r.ok, false);
});

// ── End-to-end through composePlan ─────────────────────

test('composePlan: quoteCurrency=EUR → fx is null', () => {
  const p = composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
    quoteCurrency: 'EUR',
  });
  assert.equal(p.fx, null);
});

test('composePlan: quoteCurrency=USD → fx populated', () => {
  const p = composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
    quoteCurrency: 'USD',
    paymentTermsDays: 60,
  });
  assert.ok(p.fx);
  assert.equal(p.fx.currency, 'USD');
  assert.ok(p.fx.equivalentForeignFormatted.startsWith('$'));
});

test('composePlan: quoteCurrency defaults to EUR when not provided (backwards compat)', () => {
  const p = composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
  });
  assert.equal(p.fx, null);
});
