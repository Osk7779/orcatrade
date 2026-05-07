const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RATE_SNAPSHOT,
  BASE_RATES_PCT,
  GOODS_LOADING,
  ROUTE_LOADING,
  COVERAGE_OPTIONS,
  MIN_PREMIUM_EUR,
  COMMISSION_PCT,
  detectCorridor,
  validateInput,
  calculateQuote,
  listGoodsTypes,
  listTransportModes,
  listCoverageOptions,
} = require('../lib/intelligence/insurance-quote');

// ── Registry integrity ───────────────────────────────────

test('BASE_RATES_PCT exposes all four transport modes', () => {
  for (const mode of ['sea_fcl', 'sea_lcl', 'air', 'rail']) {
    assert.ok(Number.isFinite(BASE_RATES_PCT[mode]), `${mode} should have a numeric rate`);
  }
});

test('GOODS_LOADING entries have multiplier and label', () => {
  for (const [key, def] of Object.entries(GOODS_LOADING)) {
    assert.ok(Number.isFinite(def.multiplier), `${key} multiplier`);
    assert.ok(def.label, `${key} label`);
  }
});

test('COVERAGE_OPTIONS includes ICC A/B/C with descending multipliers', () => {
  assert.equal(COVERAGE_OPTIONS.icc_a.multiplier, 1.00);
  assert.ok(COVERAGE_OPTIONS.icc_b.multiplier < 1.00);
  assert.ok(COVERAGE_OPTIONS.icc_c.multiplier < COVERAGE_OPTIONS.icc_b.multiplier);
  assert.equal(COVERAGE_OPTIONS.icc_a.recommended, true);
});

test('MIN_PREMIUM_EUR is a positive sane figure', () => {
  assert.ok(MIN_PREMIUM_EUR > 0 && MIN_PREMIUM_EUR < 200);
});

test('COMMISSION_PCT falls within the doc-stated 10-15% band', () => {
  assert.ok(COMMISSION_PCT >= 0.10 && COMMISSION_PCT <= 0.15);
});

// ── detectCorridor ───────────────────────────────────────

test('detectCorridor identifies Asia-EU mainline routes', () => {
  assert.equal(detectCorridor('CN', 'DE').multiplier, ROUTE_LOADING.asia_to_eu_mainline.multiplier);
  assert.equal(detectCorridor('VN', 'NL').multiplier, ROUTE_LOADING.asia_to_eu_mainline.multiplier);
  assert.equal(detectCorridor('IN', 'PL').multiplier, ROUTE_LOADING.asia_to_eu_mainline.multiplier);
});

test('detectCorridor identifies Asia-EU periphery (CEE) routes', () => {
  assert.equal(detectCorridor('CN', 'CZ').multiplier, ROUTE_LOADING.asia_to_eu_periphery.multiplier);
  assert.equal(detectCorridor('VN', 'LT').multiplier, ROUTE_LOADING.asia_to_eu_periphery.multiplier);
});

test('detectCorridor identifies intra-EU short-circuit', () => {
  assert.equal(detectCorridor('DE', 'PL').multiplier, ROUTE_LOADING.intra_eu.multiplier);
});

test('detectCorridor falls back to default for unmapped corridors', () => {
  const result = detectCorridor('JP', 'US');
  assert.equal(result.multiplier, ROUTE_LOADING.default.multiplier);
});

test('detectCorridor handles missing inputs gracefully', () => {
  assert.equal(detectCorridor(null, 'DE').multiplier, ROUTE_LOADING.default.multiplier);
  assert.equal(detectCorridor('CN', '').multiplier, ROUTE_LOADING.default.multiplier);
});

// ── validateInput ────────────────────────────────────────

test('validateInput rejects missing or non-positive cargo value', () => {
  const result = validateInput({ transportMode: 'sea_fcl' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('cargoValueEur')));
});

test('validateInput rejects unknown transport mode', () => {
  const result = validateInput({ cargoValueEur: 1000, transportMode: 'submarine' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('transportMode')));
});

test('validateInput rejects unsupported goods or coverage', () => {
  const goods = validateInput({ cargoValueEur: 1000, transportMode: 'sea_fcl', goodsType: 'unicorn' });
  assert.equal(goods.ok, false);
  const cov = validateInput({ cargoValueEur: 1000, transportMode: 'sea_fcl', coverage: 'icc_z' });
  assert.equal(cov.ok, false);
});

test('validateInput accepts a complete request', () => {
  const result = validateInput({
    cargoValueEur: 100000,
    transportMode: 'sea_fcl',
    goodsType: 'electronics',
    coverage: 'icc_a',
  });
  assert.equal(result.ok, true);
});

// ── calculateQuote ───────────────────────────────────────

test('calculateQuote produces deterministic premium for known inputs', () => {
  const result = calculateQuote({
    cargoValueEur: 250000,
    transportMode: 'sea_fcl',
    goodsType: 'electronics',
    originCountry: 'CN',
    destinationCountry: 'DE',
    coverage: 'icc_a',
  });
  // Sea FCL base 0.06% × electronics 1.2 × Asia-EU mainline 1.0 × ICC(A) 1.0 = 0.072%
  // 250,000 × 0.00072 = 180
  assert.equal(result.ok, true);
  assert.equal(result.premium.eur, 180);
  assert.equal(result.calc.baseRatePct.value, 0.06);
  assert.equal(result.calc.goodsMultiplier.value, 1.2);
  assert.equal(result.calc.routeMultiplier.value, 1.0);
  assert.equal(result.calc.coverageMultiplier.value, 1.0);
});

test('calculateQuote applies minimum premium for very small cargo', () => {
  const result = calculateQuote({
    cargoValueEur: 1000,
    transportMode: 'sea_fcl',
    goodsType: 'general',
    coverage: 'icc_a',
  });
  // 1000 × 0.06% × 1.0 × default(no countries → default 1.2) × 1.0 = 0.72
  assert.equal(result.premium.eur, MIN_PREMIUM_EUR);
  assert.equal(result.premium.minPremiumApplied, true);
});

test('calculateQuote shows ICC(C) is cheaper than ICC(A) for same cargo', () => {
  const baseInput = { cargoValueEur: 500000, transportMode: 'sea_fcl', goodsType: 'general', originCountry: 'CN', destinationCountry: 'DE' };
  const a = calculateQuote(Object.assign({}, baseInput, { coverage: 'icc_a' }));
  const b = calculateQuote(Object.assign({}, baseInput, { coverage: 'icc_b' }));
  const c = calculateQuote(Object.assign({}, baseInput, { coverage: 'icc_c' }));
  assert.ok(a.premium.eur > b.premium.eur, 'ICC(A) should be more expensive than (B)');
  assert.ok(b.premium.eur > c.premium.eur, 'ICC(B) should be more expensive than (C)');
});

test('calculateQuote breakdown includes commission within 10-15% band', () => {
  const result = calculateQuote({
    cargoValueEur: 500000,
    transportMode: 'sea_fcl',
    goodsType: 'electronics',
    originCountry: 'CN',
    destinationCountry: 'DE',
  });
  const ratio = result.breakdown.orcaTradeCommissionEur / result.breakdown.premiumEur;
  assert.ok(ratio >= 0.10 && ratio <= 0.15, `commission ratio ${ratio} should be in 10-15% band`);
  assert.equal(result.breakdown.premiumEur, result.breakdown.orcaTradeCommissionEur + result.breakdown.netToInsurerEur);
});

test('calculateQuote retail comparison shows positive savings', () => {
  const result = calculateQuote({
    cargoValueEur: 500000,
    transportMode: 'air',
    goodsType: 'high_value',
    originCountry: 'CN',
    destinationCountry: 'DE',
  });
  assert.ok(result.retailComparison.savingsVsRetailEur > 0);
  assert.ok(result.retailComparison.savingsPct > 0 && result.retailComparison.savingsPct < 100);
});

test('calculateQuote returns coverage description per ICC clause', () => {
  const a = calculateQuote({ cargoValueEur: 100000, transportMode: 'sea_fcl', coverage: 'icc_a' });
  const c = calculateQuote({ cargoValueEur: 100000, transportMode: 'sea_fcl', coverage: 'icc_c' });
  assert.match(a.coverage.whatIsCovered, /all-risks|All risks/i);
  assert.match(c.coverage.whatIsCovered, /Major casualties|major casualties/);
});

test('calculateQuote returns nextSteps with non-empty array', () => {
  const result = calculateQuote({ cargoValueEur: 100000, transportMode: 'sea_fcl' });
  assert.ok(Array.isArray(result.nextSteps));
  assert.ok(result.nextSteps.length >= 3);
});

test('calculateQuote rejects invalid input with errors array', () => {
  const result = calculateQuote({});
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.errors));
  assert.ok(result.errors.length > 0);
});

// ── Listing helpers ──────────────────────────────────────

test('listGoodsTypes returns objects with key/label/multiplier', () => {
  const list = listGoodsTypes();
  assert.ok(list.length >= Object.keys(GOODS_LOADING).length);
  for (const item of list) {
    assert.ok(item.key);
    assert.ok(item.label);
    assert.ok(Number.isFinite(item.multiplier));
  }
});

test('listTransportModes returns 4 modes with base rates', () => {
  const list = listTransportModes();
  assert.equal(list.length, 4);
});

test('listCoverageOptions returns 3 ICC options', () => {
  const list = listCoverageOptions();
  assert.equal(list.length, 3);
  assert.ok(list.find(o => o.key === 'icc_a' && o.recommended));
});

// ── Snapshot integrity ──────────────────────────────────

test('RATE_SNAPSHOT exposes asOf date and source', () => {
  assert.match(RATE_SNAPSHOT.asOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(RATE_SNAPSHOT.source);
});
