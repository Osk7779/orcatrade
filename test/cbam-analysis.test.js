const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ETS_PRICE_SNAPSHOT,
  DEFAULT_EMISSIONS_INTENSITIES,
  detectCategory,
  determineCbamApplicability,
  calculateCertificateExposure,
  calculatePenaltyExposure,
  buildCbamTimeline,
  buildCarbonPriceCredit,
  buildEvidenceGaps,
} = require('../lib/intelligence/cbam-analysis');

// ── detectCategory ────────────────────────────────────────

test('detectCategory matches steel keywords across product / description', () => {
  assert.equal(detectCategory('iron and steel', 'rebar'), 'iron_and_steel');
  assert.equal(detectCategory('rebar', null), 'iron_and_steel');
  assert.equal(detectCategory('Hot-rolled wire rod', ''), 'iron_and_steel');
});

test('detectCategory matches cement, aluminium, fertilisers, hydrogen, electricity', () => {
  assert.equal(detectCategory('Portland cement', null), 'cement');
  assert.equal(detectCategory('Aluminium extrusions', null), 'aluminium');
  assert.equal(detectCategory('Urea fertiliser', null), 'fertilisers');
  assert.equal(detectCategory('Industrial hydrogen', null), 'hydrogen');
  assert.equal(detectCategory('Electricity import', null), 'electricity');
});

test('detectCategory returns null for non-CBAM goods', () => {
  assert.equal(detectCategory('Wooden furniture', 'plywood'), null);
  assert.equal(detectCategory('Coffee beans', null), null);
  assert.equal(detectCategory('Cotton textiles', null), null);
});

// ── determineCbamApplicability ────────────────────────────

test('CBAM applies to non-EEA origin matching an Annex I category', () => {
  const result = determineCbamApplicability({
    productCategory: 'iron and steel',
    productDescription: 'rebar',
    originCountry: 'CN',
  });
  assert.equal(result.applies, true);
  assert.equal(result.categoryKey, 'iron_and_steel');
  assert.match(result.citation, /2023\/956/);
});

test('CBAM does not apply to EEA EFTA origin even for covered goods', () => {
  const result = determineCbamApplicability({
    productCategory: 'aluminium',
    originCountry: 'NO',
  });
  assert.equal(result.applies, false);
  assert.match(result.reason, /EEA/);
});

test('CBAM applicability returns amber confidence without HS code, green with', () => {
  const noHs = determineCbamApplicability({
    productCategory: 'iron and steel',
    originCountry: 'CN',
  });
  assert.equal(noHs.confidence, 'amber');

  const withHs = determineCbamApplicability({
    productCategory: 'iron and steel',
    originCountry: 'CN',
    hsCode: '7214 99',
  });
  assert.equal(withHs.confidence, 'green');
});

test('CBAM does not apply when product matches no Annex I category', () => {
  const result = determineCbamApplicability({
    productCategory: 'wood furniture',
    originCountry: 'VN',
  });
  assert.equal(result.applies, false);
  assert.equal(result.categoryKey, null);
});

// ── calculateCertificateExposure ──────────────────────────

test('certificate exposure math: tonnes × intensity × price', () => {
  const result = calculateCertificateExposure({
    tonnesGoods: 1200,
    categoryKey: 'iron_and_steel',
    etsPriceEur: 75,
  });
  assert.ok(result, 'exposure should be computed');
  // 1200 × 1.99 × 75 = 179,100
  assert.equal(result.certificateCostEur.central, 179100);
  assert.equal(Math.round(result.tonnesEmissions.central), 2388);
  assert.equal(result.calc.length, 5);
});

test('certificate exposure low/high scenarios reflect intensity range × price scenarios', () => {
  const result = calculateCertificateExposure({
    tonnesGoods: 1000,
    categoryKey: 'cement',
    etsPriceEur: 75,
  });
  // Cement intensity range [0.55, 0.95], scenario price range [60, 95]
  // low = 1000 × 0.55 × 60 = 33,000
  // high = 1000 × 0.95 × 95 = 90,250
  assert.equal(result.certificateCostEur.low, 33000);
  assert.equal(result.certificateCostEur.high, 90250);
  assert.equal(result.certificateCostEur.central, 1000 * 0.79 * 75);
});

test('certificate exposure returns null on unknown category or zero tonnes', () => {
  assert.equal(calculateCertificateExposure({ tonnesGoods: 0, categoryKey: 'cement' }), null);
  assert.equal(calculateCertificateExposure({ tonnesGoods: 100, categoryKey: 'unknown' }), null);
});

test('intensity defaults are present and finite for every covered category', () => {
  for (const [key, def] of Object.entries(DEFAULT_EMISSIONS_INTENSITIES)) {
    assert.ok(Number.isFinite(def.valueTco2ePerTonne), `${key} intensity should be finite`);
    assert.equal(def.rangeTco2ePerTonne.length, 2, `${key} should have low/high range`);
    assert.ok(def.source, `${key} should have a source citation`);
  }
});

// ── calculatePenaltyExposure ──────────────────────────────

test('Art. 26 penalty: authorised declarant misses surrender → €100/tCO2e', () => {
  const result = calculatePenaltyExposure({
    tonnesEmissions: 2400,
    isAuthorisedDeclarant: true,
  });
  assert.equal(result.ratePerTonneEur, 100);
  assert.equal(result.penaltyEur, 240000);
  assert.match(result.citation, /Art\. 26\(1\)/);
});

test('Art. 26 penalty: non-authorised importer → 4× base rate (within 3-5× window)', () => {
  const result = calculatePenaltyExposure({
    tonnesEmissions: 2400,
    isAuthorisedDeclarant: false,
  });
  assert.equal(result.ratePerTonneEur, 400);
  assert.equal(result.penaltyEur, 960000);
  assert.match(result.citation, /Art\. 26\(2\)/);
});

test('penalty exposure handles zero or invalid emissions', () => {
  assert.equal(calculatePenaltyExposure({ tonnesEmissions: 0 }), null);
  assert.equal(calculatePenaltyExposure({ tonnesEmissions: -1 }), null);
});

// ── buildCbamTimeline ─────────────────────────────────────

test('CBAM timeline marks past, today, upcoming statuses correctly', () => {
  const timeline = buildCbamTimeline({ asOfDate: '2026-05-07' });
  assert.ok(timeline.length >= 4, 'timeline should have at least 4 events');

  const transitionalStart = timeline.find(e => e.date === '2023-10-01');
  const definitiveStart = timeline.find(e => e.date === '2026-01-01');
  const firstDeclaration = timeline.find(e => e.date === '2027-05-31');

  assert.equal(transitionalStart.status, 'past');
  assert.equal(definitiveStart.status, 'past');
  assert.equal(firstDeclaration.status, 'upcoming');
  assert.ok(firstDeclaration.daysFromAsOf > 0);
  assert.ok(transitionalStart.daysFromAsOf < 0);
});

// ── buildCarbonPriceCredit ────────────────────────────────

test('carbon-price credit lookup for China surfaces National ETS', () => {
  const credit = buildCarbonPriceCredit('CN', 1000);
  assert.equal(credit.hasScheme, true);
  assert.match(credit.scheme, /China/);
  assert.match(credit.citation, /Art\. 9/);
});

test('carbon-price credit lookup for an unknown country flags missing record', () => {
  const credit = buildCarbonPriceCredit('ZZ', 1000);
  assert.equal(credit.hasScheme, null);
  assert.match(credit.note, /verify/i);
});

test('carbon-price credit returns null when no origin given', () => {
  assert.equal(buildCarbonPriceCredit(null, 1000), null);
});

// ── buildEvidenceGaps ─────────────────────────────────────

test('non-authorised declarant produces a blocker-severity authorisation gap', () => {
  const gaps = buildEvidenceGaps({
    categoryKey: 'iron_and_steel',
    importerEntity: 'Acme GmbH',
    supplier: 'Hangzhou Steel',
    originCountry: 'CN',
    asOfDate: '2026-05-07',
    authorisedDeclarant: false,
  });
  const authGap = gaps.find(g => g.type === 'authorisation');
  assert.ok(authGap, 'authorisation gap should exist when not authorised');
  assert.equal(authGap.severity, 'blocker');
});

test('authorised declarant skips the authorisation gap', () => {
  const gaps = buildEvidenceGaps({
    categoryKey: 'iron_and_steel',
    importerEntity: 'Acme GmbH',
    supplier: 'Hangzhou Steel',
    originCountry: 'CN',
    asOfDate: '2026-05-07',
    authorisedDeclarant: true,
  });
  assert.equal(gaps.find(g => g.type === 'authorisation'), undefined);
});

test('Chinese-origin imports add a carbon-price-credit evidence gap', () => {
  const gaps = buildEvidenceGaps({
    categoryKey: 'aluminium',
    importerEntity: 'Acme GmbH',
    originCountry: 'CN',
    authorisedDeclarant: true,
  });
  assert.ok(gaps.find(g => g.type === 'carbon_price_credit'));
});

// ── ETS_PRICE_SNAPSHOT integrity ─────────────────────────

test('ETS price snapshot is a finite, positive figure with metadata', () => {
  assert.ok(Number.isFinite(ETS_PRICE_SNAPSHOT.priceEurPerTonne));
  assert.ok(ETS_PRICE_SNAPSHOT.priceEurPerTonne > 0);
  assert.ok(ETS_PRICE_SNAPSHOT.asOf);
  assert.ok(ETS_PRICE_SNAPSHOT.scenarioRange.lowEur < ETS_PRICE_SNAPSHOT.scenarioRange.highEur);
});
