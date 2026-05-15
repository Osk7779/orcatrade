// TCO calculator tests.

const test = require('node:test');
const assert = require('node:assert/strict');

const tco = require('../lib/intelligence/tco-quote');
const { composePlan } = require('../lib/handlers/start');

const SAMPLE_PER_SHIPMENT = {
  customsValueEur: 25000,
  dutyEur: 3000,
  vatEur: 6440,
  brokerageEur: 78,
  transportEur: 5350,
};

// ── Validation ────────────────────────────────────────

test('validateInput accepts defaults', () => {
  const r = tco.validateInput({ shipmentsPerYear: 12, waccPct: 8, daysInInventory: 60 });
  assert.equal(r.ok, true);
});

test('validateInput rejects shipmentsPerYear out of range', () => {
  assert.equal(tco.validateInput({ shipmentsPerYear: 0 }).ok, false);
  assert.equal(tco.validateInput({ shipmentsPerYear: 500 }).ok, false);
  assert.equal(tco.validateInput({ shipmentsPerYear: -1 }).ok, false);
});

test('validateInput rejects waccPct out of range', () => {
  assert.equal(tco.validateInput({ waccPct: -1 }).ok, false);
  assert.equal(tco.validateInput({ waccPct: 100 }).ok, false);
});

test('validateInput rejects daysInInventory out of range', () => {
  assert.equal(tco.validateInput({ daysInInventory: -1 }).ok, false);
  assert.equal(tco.validateInput({ daysInInventory: 500 }).ok, false);
});

// ── scaleAnnual ───────────────────────────────────────

test('scaleAnnual: scales every line item by shipmentsPerYear', () => {
  const result = tco.scaleAnnual(SAMPLE_PER_SHIPMENT, 12, 8, 60);
  assert.equal(result.annualCustomsValueEur, 300000);   // 25k × 12
  assert.equal(result.annualDutyEur, 36000);            // 3k × 12
  assert.equal(result.annualVatEur, 77280);             // 6.44k × 12
  assert.equal(result.annualBrokerageEur, 936);         // 78 × 12
  assert.equal(result.annualTransportEur, 64200);       // 5.35k × 12
});

test('scaleAnnual: inventory carrying cost = avg inventory × WACC', () => {
  const result = tco.scaleAnnual(SAMPLE_PER_SHIPMENT, 12, 8, 60);
  // avg inventory = 300k × 60/365 ≈ 49,315
  // carrying cost = 49,315 × 0.08 ≈ 3,945
  assert.ok(Math.abs(result.avgInventoryValueEur - 49315) < 5);
  assert.ok(Math.abs(result.inventoryCarryingCostEur - 3945) < 5);
});

test('scaleAnnual: net cost excludes VAT, cash-flow cost includes VAT', () => {
  const result = tco.scaleAnnual(SAMPLE_PER_SHIPMENT, 12, 8, 60);
  // net = duty + brokerage + transport + carrying = 36000 + 936 + 64200 + 3945
  assert.ok(Math.abs(result.annualNetCost - 105081) < 10);
  // cash-flow = net + VAT = ... + 77280
  assert.ok(Math.abs(result.annualCashFlowCost - result.annualNetCost - 77280) < 1);
});

// ── calculateTco ──────────────────────────────────────

test('calculateTco: returns ok with main + sensitivity at 4 frequencies', () => {
  const r = tco.calculateTco({ perShipment: SAMPLE_PER_SHIPMENT });
  assert.equal(r.ok, true);
  assert.ok(r.main);
  assert.equal(r.sensitivity.length, 4);
  assert.deepEqual(r.sensitivity.map(s => s.shipmentsPerYear), [6, 12, 24, 52]);
});

test('calculateTco: warehouse annual € is layered into main + sensitivity', () => {
  const r = tco.calculateTco({
    perShipment: SAMPLE_PER_SHIPMENT,
    warehouseAnnualEur: 60000,
    shipmentsPerYear: 12,
  });
  // annualNetCostWithWarehouse should be larger than annualNetCost by ~60k
  assert.ok(r.main.annualNetCostWithWarehouse > r.main.annualNetCost);
  assert.equal(r.main.annualNetCostWithWarehouse - r.main.annualNetCost, 60000);
});

test('calculateTco: sensitivity frequencies show non-decreasing throughput', () => {
  const r = tco.calculateTco({ perShipment: SAMPLE_PER_SHIPMENT });
  for (let i = 1; i < r.sensitivity.length; i++) {
    assert.ok(
      r.sensitivity[i].annualCustomsValueEur >= r.sensitivity[i - 1].annualCustomsValueEur,
      `sensitivity[${i}] throughput >= sensitivity[${i - 1}]`,
    );
  }
});

test('calculateTco: bonded.worthExploring true when deferral > €1k', () => {
  const r = tco.calculateTco({ perShipment: SAMPLE_PER_SHIPMENT, shipmentsPerYear: 12, daysInInventory: 60, waccPct: 8 });
  // duty + VAT × WACC × days/365 = (36000 + 77280) × 0.08 × 60/365 ≈ 1,489
  assert.equal(r.bonded.worthExploring, true);
  assert.ok(r.bonded.potentialDeferralValueEur > 1000);
});

test('calculateTco: bonded.worthExploring false on tiny shipments', () => {
  const r = tco.calculateTco({
    perShipment: { customsValueEur: 1000, dutyEur: 50, vatEur: 240, brokerageEur: 78, transportEur: 200 },
    shipmentsPerYear: 6,
  });
  assert.equal(r.bonded.worthExploring, false);
});

test('calculateTco: costPerEurThroughputBp is reasonable basis-points figure', () => {
  const r = tco.calculateTco({ perShipment: SAMPLE_PER_SHIPMENT, shipmentsPerYear: 12 });
  // ~35% on €25k customs value × 12 → ~3500 bp
  assert.ok(r.costPerEurThroughputBp > 500 && r.costPerEurThroughputBp < 10000);
});

test('calculateTco: rejects bad input', () => {
  const r = tco.calculateTco({ perShipment: SAMPLE_PER_SHIPMENT, shipmentsPerYear: 999 });
  assert.equal(r.ok, false);
  assert.ok(r.errors);
});

test('calculateTco: rejects malformed perShipment', () => {
  const r = tco.calculateTco({ perShipment: { customsValueEur: 'not-a-number' } });
  assert.equal(r.ok, false);
  assert.ok(r.errors);
});

// ── End-to-end through composePlan ─────────────────────

test('composePlan: plan.tco populated with default 12 shipments/year', async () => {
  const p = await composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
  });
  assert.equal(p.ok, true);
  assert.ok(p.tco);
  assert.equal(p.tco.ok, true);
  assert.equal(p.tco.inputs.shipmentsPerYear, 12);
  assert.equal(p.tco.inputs.waccPct, 8);
  assert.equal(p.tco.inputs.daysInInventory, 60);
});

test('composePlan: custom shipmentsPerYear flows through', async () => {
  const p = await composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
    shipmentsPerYear: 24,
    waccPct: 12,
    daysInInventory: 90,
  });
  assert.equal(p.tco.inputs.shipmentsPerYear, 24);
  assert.equal(p.tco.inputs.waccPct, 12);
  assert.equal(p.tco.inputs.daysInInventory, 90);
});

test('composePlan: 3PL hub costs roll into TCO when monthlyOrders >= 100', async () => {
  const p = await composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
    monthlyOrders: 500,
  });
  // With 3PL, annualNetCostWithWarehouse > annualNetCost
  assert.ok(p.tco.main.annualNetCostWithWarehouse > p.tco.main.annualNetCost);
  assert.ok(p.tco.main.annualWarehouseEur > 0);
});

test('composePlan: no 3PL when monthlyOrders absent — annualWarehouseEur is 0', async () => {
  const p = await composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
  });
  assert.equal(p.tco.main.annualWarehouseEur, 0);
  assert.equal(p.tco.main.annualNetCostWithWarehouse, p.tco.main.annualNetCost);
});

// ── Defaults catalogue ────────────────────────────────

test('module exposes sensible defaults', () => {
  assert.equal(tco.DEFAULT_SHIPMENTS_PER_YEAR, 12);
  assert.equal(tco.DEFAULT_WACC_PCT, 8.0);
  assert.equal(tco.DEFAULT_DAYS_IN_INVENTORY, 60);
  assert.deepEqual(tco.SENSITIVITY_FREQUENCIES, [6, 12, 24, 52]);
});
