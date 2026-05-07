const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PRICING_SNAPSHOT,
  ASSESSMENT_FEE_BASE_EUR,
  ASSESSMENT_FEE_PER_PIECE_EUR,
  ASSESSMENT_FEE_CAP_EUR,
  CATEGORY_HINTS,
  detectOriginRegion,
  clampAssessmentFee,
  validateInput,
  calculateQuote,
  listCategories,
  calculateReturnToSupplier,
  calculateLocalRefurb,
  calculateLocalScrap,
  recommendRoute,
} = require('../lib/intelligence/returns-quote');

// ── Constants ────────────────────────────────────────────

test('Pricing constants are positive', () => {
  assert.ok(ASSESSMENT_FEE_BASE_EUR > 0);
  assert.ok(ASSESSMENT_FEE_PER_PIECE_EUR > 0);
  assert.ok(ASSESSMENT_FEE_CAP_EUR > ASSESSMENT_FEE_BASE_EUR);
});

test('CATEGORY_HINTS includes core categories with weeeApplicable + refurbViability', () => {
  for (const key of ['electronics', 'textiles', 'furniture', 'machinery', 'cosmetics', 'general']) {
    assert.ok(CATEGORY_HINTS[key], `missing ${key}`);
    assert.equal(typeof CATEGORY_HINTS[key].weeeApplicable, 'boolean');
    assert.ok(CATEGORY_HINTS[key].refurbViability);
    assert.ok(CATEGORY_HINTS[key].label);
  }
});

test('PRICING_SNAPSHOT exposes asOf date and source', () => {
  assert.match(PRICING_SNAPSHOT.asOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(PRICING_SNAPSHOT.source);
});

// ── detectOriginRegion ───────────────────────────────────

test('detectOriginRegion identifies common Asia origins', () => {
  assert.equal(detectOriginRegion('CN').name, 'China');
  assert.equal(detectOriginRegion('VN').name, 'Vietnam');
  assert.equal(detectOriginRegion('IN').name, 'India');
});

test('detectOriginRegion falls back for unknown', () => {
  assert.equal(detectOriginRegion('ZZ').name, 'Other');
  assert.equal(detectOriginRegion(null).name, 'Other');
});

// ── clampAssessmentFee ───────────────────────────────────

test('clampAssessmentFee scales linearly until cap', () => {
  assert.equal(clampAssessmentFee(10), ASSESSMENT_FEE_BASE_EUR + ASSESSMENT_FEE_PER_PIECE_EUR * 10);
  // 100 base + 5 × N capped at 500 → break-even at N = 80
  assert.equal(clampAssessmentFee(80), ASSESSMENT_FEE_CAP_EUR);
  assert.equal(clampAssessmentFee(1000), ASSESSMENT_FEE_CAP_EUR);
});

// ── validateInput ────────────────────────────────────────

test('validateInput rejects missing or out-of-range pieces / weight / value', () => {
  const a = validateInput({ category: 'electronics' });
  assert.equal(a.ok, false);
  assert.ok(a.errors.some(e => e.includes('piecesCount')));
  assert.ok(a.errors.some(e => e.includes('totalWeightKg')));
  assert.ok(a.errors.some(e => e.includes('declaredValueEur')));

  const b = validateInput({ piecesCount: 200000, totalWeightKg: 60000, declaredValueEur: 100, category: 'electronics' });
  assert.equal(b.ok, false);
});

test('validateInput rejects unknown category', () => {
  const r = validateInput({ piecesCount: 10, totalWeightKg: 5, declaredValueEur: 100, category: 'aliens' });
  assert.equal(r.ok, false);
});

test('validateInput rejects malformed origin country', () => {
  const r = validateInput({ piecesCount: 10, totalWeightKg: 5, declaredValueEur: 100, originCountry: 'CHIN' });
  assert.equal(r.ok, false);
});

test('validateInput accepts complete request', () => {
  const r = validateInput({ piecesCount: 10, totalWeightKg: 5, declaredValueEur: 100, category: 'electronics', originCountry: 'CN' });
  assert.equal(r.ok, true);
});

// ── calculateReturnToSupplier ────────────────────────────

test('calculateReturnToSupplier applies minimum shipping when calculated below', () => {
  const result = calculateReturnToSupplier({ totalWeightKg: 1, originCountry: 'CN', express: false });
  // 1.20 × 1 × 1.0 = 1.20 → far below €90 min
  const shippingRow = result.breakdown.find(b => b.label.includes('shipping'));
  assert.ok(shippingRow.eur >= 90);
});

test('calculateReturnToSupplier scales with weight × region multiplier', () => {
  const cn = calculateReturnToSupplier({ totalWeightKg: 100, originCountry: 'CN', express: false });
  const inIndia = calculateReturnToSupplier({ totalWeightKg: 100, originCountry: 'IN', express: false });
  // India multiplier 1.15 > China 1.0
  assert.ok(inIndia.totalEur > cn.totalEur);
});

test('calculateReturnToSupplier express rate higher than standard', () => {
  const std = calculateReturnToSupplier({ totalWeightKg: 100, originCountry: 'CN', express: false });
  const exp = calculateReturnToSupplier({ totalWeightKg: 100, originCountry: 'CN', express: true });
  assert.ok(exp.totalEur > std.totalEur);
});

// ── calculateLocalRefurb ─────────────────────────────────

test('calculateLocalRefurb returns unavailable for non-viable categories', () => {
  const r = calculateLocalRefurb({ piecesCount: 100, declaredValueEur: 5000, category: 'textiles' });
  assert.equal(r.unavailable, true);
  assert.equal(r.totalEur, null);
});

test('calculateLocalRefurb returns viable cost for electronics', () => {
  const r = calculateLocalRefurb({ piecesCount: 50, declaredValueEur: 15000, category: 'electronics' });
  // diagnostic 600 + refurb 1500 + transport 60 = 2160 - parts recovery 400 = 1760
  assert.equal(r.totalEur, 1760);
  assert.equal(r.grossCostEur, 2160);
  assert.equal(r.partsRecoveryAllowanceEur, 400);
});

test('calculateLocalRefurb applies parts-recovery credit (negative line)', () => {
  const r = calculateLocalRefurb({ piecesCount: 10, declaredValueEur: 1000, category: 'machinery' });
  const negativeLines = r.breakdown.filter(b => b.eur < 0);
  assert.ok(negativeLines.length > 0);
});

// ── calculateLocalScrap ──────────────────────────────────

test('calculateLocalScrap charges WEEE certificate for electronics', () => {
  const electronics = calculateLocalScrap({ totalWeightKg: 100, category: 'electronics' });
  const textiles = calculateLocalScrap({ totalWeightKg: 100, category: 'textiles' });
  const electronicsHasWeee = electronics.breakdown.some(b => b.label.includes('WEEE'));
  const textilesHasWeee = textiles.breakdown.some(b => b.label.includes('WEEE'));
  assert.equal(electronicsHasWeee, true);
  assert.equal(textilesHasWeee, false);
});

test('calculateLocalScrap applies metal-recovery credit for electronics > 50kg', () => {
  const r = calculateLocalScrap({ totalWeightKg: 200, category: 'electronics' });
  assert.ok(r.metalRecoveryEur > 0);
  assert.ok(r.totalEur < r.grossCostEur);
});

test('calculateLocalScrap does not apply metal recovery for non-WEEE categories', () => {
  const r = calculateLocalScrap({ totalWeightKg: 200, category: 'textiles' });
  assert.equal(r.metalRecoveryEur, 0);
});

// ── calculateQuote — integration ──────────────────────

test('calculateQuote returns three routes for electronics from CN', () => {
  const r = calculateQuote({ piecesCount: 50, totalWeightKg: 80, declaredValueEur: 15000, category: 'electronics', originCountry: 'CN' });
  assert.equal(r.ok, true);
  assert.equal(r.routes.length, 3);
  for (const route of r.routes) {
    assert.ok(route.routeKey);
    assert.ok(route.label);
  }
});

test('calculateQuote marks textiles refurb route unavailable but other two viable', () => {
  const r = calculateQuote({ piecesCount: 500, totalWeightKg: 200, declaredValueEur: 5000, category: 'textiles', originCountry: 'CN' });
  const refurb = r.routes.find(rt => rt.routeKey === 'local_refurb');
  assert.equal(refurb.unavailable, true);
  const others = r.routes.filter(rt => !rt.unavailable);
  assert.equal(others.length, 2);
});

test('calculateQuote includes assessment fee in totalIncludingAssessmentEur', () => {
  const r = calculateQuote({ piecesCount: 10, totalWeightKg: 50, declaredValueEur: 5000, category: 'electronics', originCountry: 'CN' });
  const refurb = r.routes.find(rt => rt.routeKey === 'local_refurb');
  assert.equal(refurb.totalIncludingAssessmentEur, refurb.totalEur + r.assessmentFeeEur);
});

test('calculateQuote returns nextSteps array', () => {
  const r = calculateQuote({ piecesCount: 10, totalWeightKg: 5, declaredValueEur: 200, category: 'electronics', originCountry: 'CN' });
  assert.ok(Array.isArray(r.nextSteps));
  assert.ok(r.nextSteps.length >= 3);
});

test('calculateQuote rejects malformed input with errors array', () => {
  const r = calculateQuote({});
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.errors));
});

// ── recommendRoute ───────────────────────────────────────

test('recommendRoute prefers refurb when declared value ≥ 1.5× refurb cost', () => {
  const r = calculateQuote({ piecesCount: 50, totalWeightKg: 80, declaredValueEur: 15000, category: 'electronics', originCountry: 'CN' });
  assert.equal(r.recommendation.primaryRouteKey, 'local_refurb');
});

test('recommendRoute prefers return-to-supplier when refurb is unavailable AND value supports it', () => {
  const r = calculateQuote({ piecesCount: 500, totalWeightKg: 200, declaredValueEur: 5000, category: 'textiles', originCountry: 'CN' });
  // Refurb unavailable for textiles. Value €5000 vs return-to-supplier ~€940 → 5×, well above 2× threshold
  assert.equal(r.recommendation.primaryRouteKey, 'return_to_supplier');
});

test('recommendRoute falls back to cheapest when value < cost', () => {
  const r = calculateQuote({ piecesCount: 10, totalWeightKg: 200, declaredValueEur: 50, category: 'electronics', originCountry: 'CN' });
  // €50 declared value is below all routes; cheapest wins
  assert.ok(r.recommendation.primaryRouteKey);
  assert.match(r.recommendation.reasoning.toLowerCase(), /caution|cheapest|exceeds/);
});

test('recommendRoute warns when cheapest route exceeds declared value', () => {
  const r = calculateQuote({ piecesCount: 5, totalWeightKg: 500, declaredValueEur: 100, category: 'electronics', originCountry: 'CN' });
  assert.match(r.recommendation.reasoning.toLowerCase(), /caution|exceeds|write off/);
});

// ── Helpers ──────────────────────────────────────────────

test('listCategories returns each category with metadata', () => {
  const list = listCategories();
  assert.equal(list.length, Object.keys(CATEGORY_HINTS).length);
  for (const item of list) {
    assert.ok(item.key);
    assert.ok(item.label);
    assert.ok(item.refurbViability);
  }
});
