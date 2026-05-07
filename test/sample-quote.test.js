const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PRICING_SNAPSHOT,
  BASE_CONSOLIDATION_FEE_EUR,
  PER_SUPPLIER_FEE_EUR,
  RUSH_TURNAROUND_FEE_EUR,
  EXPRESS_SURCHARGE_EUR,
  SHIPPING_BANDS,
  DESTINATION_SURCHARGE,
  detectDestinationRegion,
  pickShippingBand,
  validateInput,
  calculateQuote,
  listShippingBands,
  listDestinationRegions,
} = require('../lib/intelligence/sample-quote');

// ── Constants integrity ──────────────────────────────────

test('Pricing constants are positive and sane', () => {
  assert.ok(BASE_CONSOLIDATION_FEE_EUR > 0);
  assert.ok(PER_SUPPLIER_FEE_EUR > 0);
  assert.ok(RUSH_TURNAROUND_FEE_EUR > 0);
  assert.ok(EXPRESS_SURCHARGE_EUR > 0);
});

test('SHIPPING_BANDS are non-empty and ordered by maxWeightKg ascending', () => {
  assert.ok(SHIPPING_BANDS.length >= 4);
  for (let i = 1; i < SHIPPING_BANDS.length; i++) {
    assert.ok(SHIPPING_BANDS[i].maxWeightKg > SHIPPING_BANDS[i - 1].maxWeightKg);
  }
});

test('DESTINATION_SURCHARGE includes EU mainland and CEE/Baltics keys', () => {
  assert.ok(DESTINATION_SURCHARGE.EU_MAINLAND);
  assert.ok(DESTINATION_SURCHARGE.CEE_BALTICS);
  assert.ok(DESTINATION_SURCHARGE.UK);
  assert.ok(DESTINATION_SURCHARGE.OTHER);
});

test('PRICING_SNAPSHOT exposes asOf date and source', () => {
  assert.match(PRICING_SNAPSHOT.asOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(PRICING_SNAPSHOT.source);
});

// ── detectDestinationRegion ─────────────────────────────

test('detectDestinationRegion maps known EU countries correctly', () => {
  assert.equal(detectDestinationRegion('PL').label, DESTINATION_SURCHARGE.CEE_BALTICS.label);
  assert.equal(detectDestinationRegion('DE').label, DESTINATION_SURCHARGE.EU_MAINLAND.label);
  assert.equal(detectDestinationRegion('GB').label, DESTINATION_SURCHARGE.UK.label);
  assert.equal(detectDestinationRegion('SE').label, DESTINATION_SURCHARGE.NORDICS.label);
  assert.equal(detectDestinationRegion('IT').label, DESTINATION_SURCHARGE.SOUTHERN_EU.label);
  assert.equal(detectDestinationRegion('CH').label, DESTINATION_SURCHARGE.SWITZERLAND.label);
});

test('detectDestinationRegion falls back to OTHER for unknown', () => {
  assert.equal(detectDestinationRegion('ZZ').label, DESTINATION_SURCHARGE.OTHER.label);
  assert.equal(detectDestinationRegion(null).label, DESTINATION_SURCHARGE.OTHER.label);
  assert.equal(detectDestinationRegion('').label, DESTINATION_SURCHARGE.OTHER.label);
});

// ── pickShippingBand ────────────────────────────────────

test('pickShippingBand picks the lowest-applicable band', () => {
  assert.equal(pickShippingBand(0.5).maxWeightKg, 1);
  assert.equal(pickShippingBand(3).maxWeightKg, 5);
  assert.equal(pickShippingBand(7).maxWeightKg, 10);
  assert.equal(pickShippingBand(15).maxWeightKg, 20);
});

test('pickShippingBand handles weights above all bands', () => {
  const band = pickShippingBand(50);
  assert.equal(band.eur, SHIPPING_BANDS[SHIPPING_BANDS.length - 1].eur);
});

// ── validateInput ───────────────────────────────────────

test('validateInput rejects missing supplierCount or weight', () => {
  const r = validateInput({ destinationCountry: 'DE' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('supplierCount')));
  assert.ok(r.errors.some(e => e.includes('totalWeightKg')));
});

test('validateInput rejects supplier counts above cap', () => {
  const r = validateInput({ supplierCount: 30, totalWeightKg: 5, destinationCountry: 'DE' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('25')));
});

test('validateInput rejects weight above cap', () => {
  const r = validateInput({ supplierCount: 5, totalWeightKg: 200, destinationCountry: 'DE' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('100')));
});

test('validateInput rejects malformed country code', () => {
  const r = validateInput({ supplierCount: 5, totalWeightKg: 5, destinationCountry: 'GERM' });
  assert.equal(r.ok, false);
});

test('validateInput accepts complete request', () => {
  const r = validateInput({ supplierCount: 5, totalWeightKg: 5, destinationCountry: 'PL' });
  assert.equal(r.ok, true);
});

// ── calculateQuote ──────────────────────────────────────

test('calculateQuote produces deterministic total for a known case', () => {
  const r = calculateQuote({
    supplierCount: 3,
    totalWeightKg: 2,
    destinationCountry: 'PL',
    express: false,
    rushTurnaround: false,
  });
  // Consolidation: 40 + (15 × 3) = 85
  // Shipping: band(2 kg) → €40 × CEE_BALTICS multiplier 1.05 = 42
  // Total: 85 + 42 = 127
  assert.equal(r.ok, true);
  assert.equal(r.breakdown.totalEur, 127);
  assert.equal(r.breakdown.consolidationFee.eur, 85);
  assert.equal(r.breakdown.shipping.eur, 42);
  assert.equal(r.breakdown.expressSurcharge, null);
  assert.equal(r.breakdown.rushSurcharge, null);
});

test('calculateQuote applies express + rush surcharges', () => {
  const r = calculateQuote({
    supplierCount: 5,
    totalWeightKg: 8,
    destinationCountry: 'DE',
    express: true,
    rushTurnaround: true,
  });
  // Consolidation: 40 + (15 × 5) = 115
  // Shipping: band(8 kg) → €60 × EU_MAINLAND 1.0 = 60
  // Express: +35, Rush: +30
  // Total: 115 + 60 + 35 + 30 = 240
  assert.equal(r.breakdown.totalEur, 240);
  assert.ok(r.breakdown.expressSurcharge);
  assert.ok(r.breakdown.rushSurcharge);
});

test('calculateQuote returns timeline strings for combinations', () => {
  const standard = calculateQuote({ supplierCount: 3, totalWeightKg: 2, destinationCountry: 'DE' });
  assert.match(standard.timeline.totalEstimate, /12.*17/);

  const expressRush = calculateQuote({
    supplierCount: 3, totalWeightKg: 2, destinationCountry: 'DE',
    express: true, rushTurnaround: true,
  });
  assert.match(expressRush.timeline.totalEstimate, /5.*7/);
});

test('calculateQuote returns inclusions and exclusions arrays', () => {
  const r = calculateQuote({ supplierCount: 3, totalWeightKg: 2, destinationCountry: 'DE' });
  assert.ok(Array.isArray(r.inclusions) && r.inclusions.length >= 3);
  assert.ok(Array.isArray(r.exclusions) && r.exclusions.length >= 1);
});

test('calculateQuote returns nextSteps array', () => {
  const r = calculateQuote({ supplierCount: 1, totalWeightKg: 0.5, destinationCountry: 'PL' });
  assert.ok(Array.isArray(r.nextSteps) && r.nextSteps.length >= 3);
});

test('calculateQuote rejects malformed input with errors array', () => {
  const r = calculateQuote({});
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.errors));
});

test('calculateQuote increases total monotonically with supplier count', () => {
  const a = calculateQuote({ supplierCount: 1, totalWeightKg: 2, destinationCountry: 'DE' });
  const b = calculateQuote({ supplierCount: 5, totalWeightKg: 2, destinationCountry: 'DE' });
  const c = calculateQuote({ supplierCount: 10, totalWeightKg: 2, destinationCountry: 'DE' });
  assert.ok(b.breakdown.totalEur > a.breakdown.totalEur);
  assert.ok(c.breakdown.totalEur > b.breakdown.totalEur);
});

test('calculateQuote increases total monotonically with weight band', () => {
  const a = calculateQuote({ supplierCount: 3, totalWeightKg: 0.5, destinationCountry: 'DE' });
  const b = calculateQuote({ supplierCount: 3, totalWeightKg: 7, destinationCountry: 'DE' });
  const c = calculateQuote({ supplierCount: 3, totalWeightKg: 25, destinationCountry: 'DE' });
  assert.ok(b.breakdown.totalEur > a.breakdown.totalEur);
  assert.ok(c.breakdown.totalEur > b.breakdown.totalEur);
});

test('calculateQuote applies destination region multiplier', () => {
  const eu = calculateQuote({ supplierCount: 3, totalWeightKg: 5, destinationCountry: 'DE' });
  const ch = calculateQuote({ supplierCount: 3, totalWeightKg: 5, destinationCountry: 'CH' });
  // Switzerland has 1.20 multiplier vs EU mainland 1.0
  assert.ok(ch.breakdown.totalEur > eu.breakdown.totalEur);
});

// ── Listing helpers ─────────────────────────────────────

test('listShippingBands returns rows with label and EUR price', () => {
  const list = listShippingBands();
  assert.equal(list.length, SHIPPING_BANDS.length);
  for (const item of list) {
    assert.ok(item.label);
    assert.ok(Number.isFinite(item.eur));
  }
});

test('listDestinationRegions returns key/label/multiplier rows', () => {
  const list = listDestinationRegions();
  assert.ok(list.length >= 5);
  for (const item of list) {
    assert.ok(item.key);
    assert.ok(item.label);
    assert.ok(Number.isFinite(item.multiplier));
  }
});
