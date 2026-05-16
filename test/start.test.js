// Import Plan Builder backend tests.

const test = require('node:test');
const assert = require('node:assert/strict');

const startHandler = require('../lib/handlers/start');
const { composePlan, validateInput, CATEGORY_TO_HS } = startHandler;

// ── Validation ─────────────────────────────────────────

test('validateInput rejects empty input', () => {
  const r = validateInput(null);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 1);
});

test('validateInput requires productCategory, originCountry, destinationCountry', () => {
  const r = validateInput({ customsValueEur: 1000, weightKg: 100 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('productCategory')));
  assert.ok(r.errors.some(e => e.includes('originCountry')));
  assert.ok(r.errors.some(e => e.includes('destinationCountry')));
});

test('validateInput requires positive customsValueEur and weightKg', () => {
  const r = validateInput({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 0,
    weightKg: -5,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('customsValueEur')));
  assert.ok(r.errors.some(e => e.includes('weightKg')));
});

test('validateInput rejects customsValueEur over 10M', () => {
  const r = validateInput({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 20_000_000,
    weightKg: 100,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('10M')));
});

test('validateInput rejects malformed email', () => {
  const r = validateInput({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 1000,
    weightKg: 100,
    email: 'not-an-email',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('email')));
});

test('validateInput accepts well-formed input', () => {
  const r = validateInput({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
    email: 'lead@example.com',
  });
  assert.equal(r.ok, true);
});

// ── HS-chapter mapping ─────────────────────────────────

test('CATEGORY_TO_HS covers all 8 wizard categories', () => {
  for (const cat of ['apparel', 'electronics', 'furniture', 'toys', 'cosmetics', 'homeware', 'footwear', 'machinery']) {
    assert.ok(CATEGORY_TO_HS[cat], `${cat} mapped`);
    assert.match(CATEGORY_TO_HS[cat], /^\d{2}$/, `${cat} → 2-digit chapter`);
  }
});

test('CATEGORY_TO_HS apparel → 62 (woven)', () => {
  assert.equal(CATEGORY_TO_HS.apparel, '62');
});

// ── Plan composition ───────────────────────────────────

test('composePlan returns errors when validation fails', async () => {
  const plan = await composePlan({});
  assert.equal(plan.ok, false);
  assert.ok(plan.errors);
});

test('composePlan returns full plan structure for CN→PL apparel', async () => {
  const plan = await composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
    linesCount: 2,
    urgencyWeeks: 12,
    monthlyOrders: 500,
    avgUnitsPerOrder: 1.5,
    claimPreferential: false,
  });
  assert.equal(plan.ok, true);
  assert.match(plan.asOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(plan.inputs.productCategory, 'apparel');
  assert.equal(plan.inputs.originCountry, 'CN');
  assert.equal(plan.inputs.destinationCountry, 'PL');
  assert.equal(plan.inputs.hsCode, '62');

  assert.ok(plan.sourcing);
  assert.ok(plan.routing);
  assert.ok(plan.customs);
  assert.ok(plan.warehouse);
  assert.ok(plan.totals);

  assert.ok(plan.sourcing.recommendation, 'sourcing recommends an origin');
  assert.ok(plan.routing.recommendation, 'routing recommends a mode');
  assert.ok(plan.customs.standard, 'customs returns standard quote');
  assert.ok(plan.customs.bonded, 'customs returns bonded quote');
  assert.ok(plan.warehouse.recommendation, 'warehouse recommends a hub');
  assert.ok(Array.isArray(plan.warehouse.hubs));

  assert.ok(plan.totals.transportEur > 0);
  assert.ok(plan.totals.dutyEur >= 0);
  assert.ok(plan.totals.vatEur > 0);
  assert.ok(plan.totals.perShipmentLandedTotal > plan.totals.customsValueEur);

  // effectiveLandedTotal: P&L cost net of recoverable VAT.
  assert.ok(Number.isFinite(plan.totals.effectiveLandedTotal));
  assert.equal(plan.totals.vatRecoverableEur, plan.totals.vatEur);
  // Math: perShipment - vat = effective.
  const expectedEffective = plan.totals.perShipmentLandedTotal - plan.totals.vatEur;
  assert.ok(Math.abs(plan.totals.effectiveLandedTotal - expectedEffective) < 0.01,
    `effectiveLandedTotal (${plan.totals.effectiveLandedTotal}) should equal perShipment (${plan.totals.perShipmentLandedTotal}) minus VAT (${plan.totals.vatEur})`);
  // Sanity: effective < gross.
  assert.ok(plan.totals.effectiveLandedTotal < plan.totals.perShipmentLandedTotal);

  // Origin matrix carries the same lens for each alternative.
  assert.ok(Array.isArray(plan.originSensitivity.matrix));
  for (const row of plan.originSensitivity.matrix) {
    assert.ok(Number.isFinite(row.effectiveLandedTotal), `${row.origin} matrix row exposes effectiveLandedTotal`);
    const rowExpected = row.transportEur + plan.totals.customsValueEur + row.dutyEur + row.brokerageEur;
    assert.ok(Math.abs(row.effectiveLandedTotal - rowExpected) < 0.01);
  }
});

test('composePlan skips warehouse when monthlyOrders absent', async () => {
  const plan = await composePlan({
    productCategory: 'electronics',
    originCountry: 'VN',
    destinationCountry: 'DE',
    customsValueEur: 50000,
    weightKg: 300,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.warehouse.skipped, true);
  assert.equal(plan.totals.warehouseMonthlyEur, null);
});

test('composePlan skips warehouse when monthlyOrders < 100', async () => {
  const plan = await composePlan({
    productCategory: 'cosmetics',
    originCountry: 'IN',
    destinationCountry: 'DE',
    customsValueEur: 8000,
    weightKg: 120,
    monthlyOrders: 50,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.warehouse.skipped, true);
});

test('composePlan uppercases country codes', async () => {
  const plan = await composePlan({
    productCategory: 'apparel',
    originCountry: 'cn',
    destinationCountry: 'pl',
    customsValueEur: 10000,
    weightKg: 200,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.inputs.originCountry, 'CN');
  assert.equal(plan.inputs.destinationCountry, 'PL');
});

test('composePlan handles claimPreferential as string "true"', async () => {
  const plan = await composePlan({
    productCategory: 'apparel',
    originCountry: 'VN',
    destinationCountry: 'PL',
    customsValueEur: 10000,
    weightKg: 200,
    claimPreferential: 'true',
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.inputs.claimPreferential, true);
});

test('composePlan respects explicit hsCode override', async () => {
  const plan = await composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 10000,
    weightKg: 200,
    hsCode: '61',
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.inputs.hsCode, '61');
});

test('composePlan: 8-digit hsCode with cached TARIC entry uses live rate', async () => {
  const kv = require('../lib/intelligence/kv-store');
  const taric = require('../lib/intelligence/taric-client');
  kv._resetMemoryStore();
  // Seed the cache with a synthetic live rate that's distinctly different
  // from the apparel chapter baseline (12%) so the override is visible.
  await kv.setJson(taric._cacheKey('62034235', 'CN'), {
    rate: 0.155,
    source: 'uk-trade-tariff',
    sourceLabel: 'UK Trade Tariff (sanity-check; EU may differ)',
    asOf: '2026-05-01',
    savedAt: Math.floor(Date.now() / 1000),
  }, 60 * 60);

  const plan = await composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 10000,
    weightKg: 200,
    hsCode: '6203 42 35',          // user-typed with spaces — should still resolve
  });
  assert.equal(plan.ok, true);
  // mfnSource should reflect the live lookup, not the chapter estimator.
  assert.match(
    plan.customs.duty.mfnSource,
    /UK Trade Tariff|uk-trade-tariff/,
    `expected live source, got "${plan.customs.duty.mfnSource}"`
  );
  // The live rate (15.5%) was applied, not the chapter (12%).
  assert.ok(plan.customs.duty.mfnRatePercent > 14, `expected mfn > 14%, got ${plan.customs.duty.mfnRatePercent}`);
  // The chapter rate is preserved for transparency in the response.
  assert.equal(plan.customs.duty.chapterRatePercent, 12);
});

test('composePlan totals: landed = transport + value + duty + vat + brokerage', async () => {
  const plan = await composePlan({
    productCategory: 'furniture',
    originCountry: 'CN',
    destinationCountry: 'DE',
    customsValueEur: 40000,
    weightKg: 1500,
    linesCount: 1,
  });
  assert.equal(plan.ok, true);
  const t = plan.totals;
  const expected = t.transportEur + t.customsValueEur + t.dutyEur + t.vatEur + t.brokerageEur;
  assert.ok(Math.abs(expected - t.perShipmentLandedTotal) < 0.01);
});

// ── Module exports ─────────────────────────────────────

test('module exports default handler + helpers', () => {
  assert.equal(typeof startHandler, 'function');
  assert.equal(typeof startHandler.composePlan, 'function');
  assert.equal(typeof startHandler.validateInput, 'function');
  assert.equal(typeof startHandler.CATEGORY_TO_HS, 'object');
});
