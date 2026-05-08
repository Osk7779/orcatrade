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

test('composePlan returns errors when validation fails', () => {
  const plan = composePlan({});
  assert.equal(plan.ok, false);
  assert.ok(plan.errors);
});

test('composePlan returns full plan structure for CN→PL apparel', () => {
  const plan = composePlan({
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
});

test('composePlan skips warehouse when monthlyOrders absent', () => {
  const plan = composePlan({
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

test('composePlan skips warehouse when monthlyOrders < 100', () => {
  const plan = composePlan({
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

test('composePlan uppercases country codes', () => {
  const plan = composePlan({
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

test('composePlan handles claimPreferential as string "true"', () => {
  const plan = composePlan({
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

test('composePlan respects explicit hsCode override', () => {
  const plan = composePlan({
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

test('composePlan totals: landed = transport + value + duty + vat + brokerage', () => {
  const plan = composePlan({
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
