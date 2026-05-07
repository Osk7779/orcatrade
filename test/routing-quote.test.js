const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PRICING_SNAPSHOT,
  BASE_RATES,
  TRANSIT_DAYS,
  CO2_GRAMS_PER_TKM,
  RAIL_VIABLE_ORIGINS,
  RAIL_VIABLE_DESTINATIONS,
  detectOriginMultiplier,
  isRailViable,
  chargeableWeightKg,
  corridorDistance,
  calcCO2,
  validateInput,
  calculateModeQuote,
  recommendMode,
  calculateQuote,
  listModes,
} = require('../lib/intelligence/routing-quote');

// ── Constants ────────────────────────────────────────────

test('BASE_RATES exposes 4 modes (sea_fcl, sea_lcl, air, rail)', () => {
  for (const mode of ['sea_fcl', 'sea_lcl', 'air', 'rail']) {
    assert.ok(Number.isFinite(BASE_RATES[mode].eurPerKg), `${mode} eurPerKg`);
    assert.ok(BASE_RATES[mode].label);
  }
});

test('Air rate is highest, sea FCL lowest', () => {
  assert.ok(BASE_RATES.air.eurPerKg > BASE_RATES.rail.eurPerKg);
  assert.ok(BASE_RATES.rail.eurPerKg > BASE_RATES.sea_lcl.eurPerKg);
  assert.ok(BASE_RATES.sea_lcl.eurPerKg > BASE_RATES.sea_fcl.eurPerKg);
});

test('TRANSIT_DAYS shows air fastest, sea slowest', () => {
  assert.ok(TRANSIT_DAYS.air.max < TRANSIT_DAYS.rail.min);
  assert.ok(TRANSIT_DAYS.rail.max < TRANSIT_DAYS.sea_fcl.min);
});

test('CO2_GRAMS_PER_TKM shows air ≫ rail ≫ sea', () => {
  assert.ok(CO2_GRAMS_PER_TKM.air > CO2_GRAMS_PER_TKM.rail);
  assert.ok(CO2_GRAMS_PER_TKM.rail > CO2_GRAMS_PER_TKM.sea_fcl);
});

test('PRICING_SNAPSHOT exposes asOf date and source', () => {
  assert.match(PRICING_SNAPSHOT.asOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(PRICING_SNAPSHOT.source);
});

// ── detectOriginMultiplier ───────────────────────────────

test('detectOriginMultiplier returns 1.0 for China baseline', () => {
  assert.equal(detectOriginMultiplier('CN'), 1.00);
});

test('detectOriginMultiplier returns higher multiplier for India', () => {
  assert.ok(detectOriginMultiplier('IN') > detectOriginMultiplier('CN'));
});

test('detectOriginMultiplier falls back for unknown origins', () => {
  const fallback = detectOriginMultiplier('ZZ');
  assert.ok(Number.isFinite(fallback));
  assert.ok(fallback > 1.0);
});

// ── isRailViable ─────────────────────────────────────────

test('isRailViable returns true for China → Poland', () => {
  assert.equal(isRailViable({ originCountry: 'CN', destinationCountry: 'PL' }), true);
});

test('isRailViable returns true for China → Germany', () => {
  assert.equal(isRailViable({ originCountry: 'CN', destinationCountry: 'DE' }), true);
});

test('isRailViable returns false for Vietnam → EU (no rail network)', () => {
  assert.equal(isRailViable({ originCountry: 'VN', destinationCountry: 'DE' }), false);
});

test('isRailViable returns false for India → EU', () => {
  assert.equal(isRailViable({ originCountry: 'IN', destinationCountry: 'PL' }), false);
});

test('isRailViable returns false for missing inputs', () => {
  assert.equal(isRailViable({ originCountry: '', destinationCountry: 'DE' }), false);
});

// ── chargeableWeightKg ───────────────────────────────────

test('chargeableWeightKg uses actual when actual > volumetric', () => {
  const result = chargeableWeightKg({ weightKg: 1000, volumeCbm: 1 });
  // volumetric for air: 1 × 167 = 167. Actual 1000 > 167.
  assert.equal(result.chargeableAir, 1000);
});

test('chargeableWeightKg uses air-volumetric when volume dominates', () => {
  const result = chargeableWeightKg({ weightKg: 50, volumeCbm: 2 });
  // volumetric for air: 2 × 167 = 334. Actual 50 < 334.
  assert.equal(result.chargeableAir, 334);
});

// ── corridorDistance ─────────────────────────────────────

test('corridorDistance returns rail-specific distance for China', () => {
  const sea = corridorDistance({ originCountry: 'CN', mode: 'sea_fcl' });
  const rail = corridorDistance({ originCountry: 'CN', mode: 'rail' });
  assert.ok(rail < sea);
});

test('corridorDistance returns air-specific (shortest) for China-air', () => {
  const air = corridorDistance({ originCountry: 'CN', mode: 'air' });
  const sea = corridorDistance({ originCountry: 'CN', mode: 'sea_fcl' });
  assert.ok(air < sea);
});

// ── calcCO2 ──────────────────────────────────────────────

test('calcCO2 returns higher emissions for air than for sea on the same shipment', () => {
  const air = calcCO2({ totalKg: 1000, mode: 'air', originCountry: 'CN' });
  const sea = calcCO2({ totalKg: 1000, mode: 'sea_fcl', originCountry: 'CN' });
  assert.ok(air > sea * 5, 'air should be at least 5x sea CO2');
});

test('calcCO2 returns 0 for unknown mode', () => {
  const result = calcCO2({ totalKg: 1000, mode: 'submarine', originCountry: 'CN' });
  assert.equal(result, 0);
});

// ── validateInput ────────────────────────────────────────

test('validateInput rejects missing weight', () => {
  const r = validateInput({ originCountry: 'CN', destinationCountry: 'DE' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('weightKg')));
});

test('validateInput rejects missing origin/destination', () => {
  const r = validateInput({ weightKg: 100 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('originCountry')));
});

test('validateInput rejects extreme weight', () => {
  const r = validateInput({ weightKg: 500000, originCountry: 'CN', destinationCountry: 'DE' });
  assert.equal(r.ok, false);
});

test('validateInput accepts complete request', () => {
  const r = validateInput({ weightKg: 500, originCountry: 'CN', destinationCountry: 'DE' });
  assert.equal(r.ok, true);
});

// ── calculateModeQuote ───────────────────────────────────

test('calculateModeQuote returns viable rail for China → DE', () => {
  const r = calculateModeQuote('rail', { weightKg: 500, volumeCbm: 2, originCountry: 'CN', destinationCountry: 'DE' });
  assert.equal(r.viable, true);
  assert.ok(r.totalEur > 0);
});

test('calculateModeQuote returns unavailable rail for VN → DE', () => {
  const r = calculateModeQuote('rail', { weightKg: 500, volumeCbm: 2, originCountry: 'VN', destinationCountry: 'DE' });
  assert.equal(r.viable, false);
  assert.match(r.viabilityReason, /China-Europe/);
});

test('calculateModeQuote air uses air-volumetric chargeable weight', () => {
  const r = calculateModeQuote('air', { weightKg: 50, volumeCbm: 2, originCountry: 'CN', destinationCountry: 'DE' });
  assert.equal(r.chargeableWeightKg, 334); // 2 × 167
});

// ── recommendMode ────────────────────────────────────────

test('recommendMode forces air when urgency < 14 days', () => {
  const r = calculateQuote({ weightKg: 500, originCountry: 'CN', destinationCountry: 'DE', urgencyDays: 7 });
  assert.equal(r.recommendation.primary, 'air');
});

test('recommendMode picks rail in 200-5000kg China-EU sweet spot', () => {
  const r = calculateQuote({ weightKg: 500, originCountry: 'CN', destinationCountry: 'DE' });
  assert.equal(r.recommendation.primary, 'rail');
});

test('recommendMode picks sea_fcl above 5t', () => {
  const r = calculateQuote({ weightKg: 8000, originCountry: 'CN', destinationCountry: 'PL' });
  assert.equal(r.recommendation.primary, 'sea_fcl');
});

test('recommendMode picks air for sub-200kg', () => {
  const r = calculateQuote({ weightKg: 50, originCountry: 'CN', destinationCountry: 'DE' });
  assert.equal(r.recommendation.primary, 'air');
});

test('recommendMode picks cheapest viable when costPriority=cost', () => {
  const r = calculateQuote({ weightKg: 500, originCountry: 'CN', destinationCountry: 'DE', costPriority: 'cost' });
  // Cheapest at 500kg CN-DE is sea_fcl
  assert.equal(r.recommendation.primary, 'sea_fcl');
});

// ── calculateQuote integration ───────────────────────────

test('calculateQuote returns 4 modes', () => {
  const r = calculateQuote({ weightKg: 500, originCountry: 'CN', destinationCountry: 'DE' });
  assert.equal(r.ok, true);
  assert.equal(r.quotes.length, 4);
});

test('calculateQuote marks rail unavailable for VN origin', () => {
  const r = calculateQuote({ weightKg: 500, originCountry: 'VN', destinationCountry: 'DE' });
  const rail = r.quotes.find(q => q.mode === 'rail');
  assert.equal(rail.viable, false);
});

test('calculateQuote includes railEducation block', () => {
  const r = calculateQuote({ weightKg: 500, originCountry: 'CN', destinationCountry: 'DE' });
  assert.ok(r.railEducation);
  assert.ok(r.railEducation.whyRailMatters);
  assert.ok(r.railEducation.bestForRail);
  assert.ok(r.railEducation.whenRailIsWrong);
});

test('calculateQuote returns nextSteps array', () => {
  const r = calculateQuote({ weightKg: 500, originCountry: 'CN', destinationCountry: 'DE' });
  assert.ok(Array.isArray(r.nextSteps));
  assert.ok(r.nextSteps.length >= 2);
});

test('calculateQuote rejects malformed input with errors', () => {
  const r = calculateQuote({});
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.errors));
});

test('calculateQuote each mode includes formula label', () => {
  const r = calculateQuote({ weightKg: 500, originCountry: 'CN', destinationCountry: 'DE' });
  for (const q of r.quotes) {
    if (q.viable) assert.ok(q.formula && q.formula.length > 0);
  }
});

// ── listModes ────────────────────────────────────────────

test('listModes returns 4 modes with key/label/eurPerKg', () => {
  const list = listModes();
  assert.equal(list.length, 4);
  for (const item of list) {
    assert.ok(item.key);
    assert.ok(item.label);
    assert.ok(Number.isFinite(item.eurPerKg));
  }
});
