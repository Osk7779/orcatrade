// Working capital cycle calculator tests.

const test = require('node:test');
const assert = require('node:assert/strict');

const wc = require('../lib/intelligence/working-capital');
const { composePlan } = require('../lib/handlers/start');

// ── Validation ────────────────────────────────────────

test('validateInput accepts plausible inputs', () => {
  const r = wc.validateInput({ annualThroughputEur: 300000, daysInventory: 60, daysReceivable: 30, daysPayable: 60, waccPct: 8 });
  assert.equal(r.ok, true);
});

test('validateInput rejects zero or negative annualThroughput', () => {
  assert.equal(wc.validateInput({ annualThroughputEur: 0 }).ok, false);
  assert.equal(wc.validateInput({ annualThroughputEur: -1 }).ok, false);
});

test('validateInput rejects out-of-range day fields', () => {
  assert.equal(wc.validateInput({ annualThroughputEur: 100000, daysInventory: 500 }).ok, false);
  assert.equal(wc.validateInput({ annualThroughputEur: 100000, daysReceivable: -1 }).ok, false);
  assert.equal(wc.validateInput({ annualThroughputEur: 100000, daysPayable: 1000 }).ok, false);
});

test('validateInput rejects waccPct out of range', () => {
  assert.equal(wc.validateInput({ annualThroughputEur: 100000, waccPct: -1 }).ok, false);
  assert.equal(wc.validateInput({ annualThroughputEur: 100000, waccPct: 100 }).ok, false);
});

// ── CCC arithmetic ───────────────────────────────────

test('CCC = DIO + DSO - DPO (standard B2C: 60 + 0 - 60 = 0)', () => {
  const r = wc.calculateWorkingCapital({
    annualThroughputEur: 300000,
    daysInventory: 60,
    daysReceivable: 0,
    daysPayable: 60,
    waccPct: 8,
  });
  assert.equal(r.ccc, 0);
  assert.equal(r.workingCapitalEur, 0);
  assert.equal(r.annualCapitalCostEur, 0);
});

test('CCC positive: capital tied up (B2B 60-day terms with 60d inventory)', () => {
  const r = wc.calculateWorkingCapital({
    annualThroughputEur: 365000, // €1k/day for clean math
    daysInventory: 60,
    daysReceivable: 60,
    daysPayable: 30,
    waccPct: 8,
  });
  // CCC = 60 + 60 - 30 = 90 days; daily COGS = 1000; WC tied up = 90,000
  assert.equal(r.ccc, 90);
  assert.equal(r.workingCapitalEur, 90000);
  // Annual cost = 90000 * 0.08 = 7200
  assert.equal(r.annualCapitalCostEur, 7200);
});

test('CCC negative: supplier-funded operation (good)', () => {
  const r = wc.calculateWorkingCapital({
    annualThroughputEur: 365000,
    daysInventory: 30,
    daysReceivable: 0,
    daysPayable: 90,
    waccPct: 8,
  });
  // CCC = 30 + 0 - 90 = -60; supplier funds 60 days of operations
  assert.equal(r.ccc, -60);
  assert.equal(r.workingCapitalEur, -60000);
  assert.equal(r.verdict, 'supplier_funded');
});

// ── Verdicts ─────────────────────────────────────────

test('verdict tight when CCC <= 30', () => {
  const r = wc.calculateWorkingCapital({ annualThroughputEur: 100000, daysInventory: 30, daysReceivable: 0, daysPayable: 30 });
  assert.equal(r.verdict, 'tight');
});

test('verdict standard when CCC 30-90', () => {
  const r = wc.calculateWorkingCapital({ annualThroughputEur: 100000, daysInventory: 60, daysReceivable: 30, daysPayable: 30 });
  assert.equal(r.verdict, 'standard');
});

test('verdict capital_intensive when CCC 90-150', () => {
  const r = wc.calculateWorkingCapital({ annualThroughputEur: 100000, daysInventory: 90, daysReceivable: 60, daysPayable: 30 });
  assert.equal(r.verdict, 'capital_intensive');
});

test('verdict severe when CCC > 150', () => {
  const r = wc.calculateWorkingCapital({ annualThroughputEur: 100000, daysInventory: 120, daysReceivable: 90, daysPayable: 30 });
  assert.equal(r.verdict, 'severe');
});

// ── Levers ───────────────────────────────────────────

test('levers expose 3 standard moves', () => {
  const r = wc.calculateWorkingCapital({ annualThroughputEur: 365000, daysInventory: 60, daysReceivable: 30, daysPayable: 60 });
  assert.equal(r.levers.length, 3);
  const keys = r.levers.map(l => l.key).sort();
  assert.deepEqual(keys, ['dio-20', 'dpo+30', 'dso-15']);
});

test('lever annualCostDelta is negative (saving)', () => {
  const r = wc.calculateWorkingCapital({ annualThroughputEur: 365000, daysInventory: 60, daysReceivable: 30, daysPayable: 60, waccPct: 8 });
  for (const l of r.levers) {
    assert.ok(l.annualCostDelta < 0, `${l.key}: annual cost should decrease`);
  }
});

test('dpo+30 lever saves the most (largest CCC compression)', () => {
  // All three levers compress CCC differently: dpo+30 (-30), dio-20 (-20), dso-15 (-15)
  const r = wc.calculateWorkingCapital({ annualThroughputEur: 365000, daysInventory: 60, daysReceivable: 30, daysPayable: 60 });
  const dpo30 = r.levers.find(l => l.key === 'dpo+30');
  const dio20 = r.levers.find(l => l.key === 'dio-20');
  const dso15 = r.levers.find(l => l.key === 'dso-15');
  assert.ok(Math.abs(dpo30.annualCostDelta) > Math.abs(dio20.annualCostDelta));
  assert.ok(Math.abs(dio20.annualCostDelta) > Math.abs(dso15.annualCostDelta));
});

// ── End-to-end through composePlan ───────────────────

test('composePlan: plan.workingCapital populated with defaults', () => {
  const p = composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
  });
  assert.equal(p.ok, true);
  assert.ok(p.workingCapital);
  assert.equal(p.workingCapital.ok, true);
  // Default DSO=0 (B2C), DPO=60 (paymentTermsDays default), DIO=60
  // CCC = 60 + 0 - 60 = 0
  assert.equal(p.workingCapital.ccc, 0);
});

test('composePlan: B2B context with 30-day DSO produces positive CCC', () => {
  const p = composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
    daysReceivable: 30,
  });
  // CCC = 60 + 30 - 60 = 30
  assert.equal(p.workingCapital.ccc, 30);
  assert.ok(p.workingCapital.workingCapitalEur > 0);
});

test('composePlan: paymentTermsDays flows into DPO', () => {
  const p1 = composePlan({
    productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL',
    customsValueEur: 25000, weightKg: 800,
    paymentTermsDays: 90,
  });
  // CCC = 60 + 0 - 90 = -30 (supplier-funded)
  assert.equal(p1.workingCapital.ccc, -30);
  assert.equal(p1.workingCapital.verdict, 'supplier_funded');

  const p2 = composePlan({
    productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL',
    customsValueEur: 25000, weightKg: 800,
    paymentTermsDays: 30,
  });
  // CCC = 60 + 0 - 30 = 30
  assert.equal(p2.workingCapital.ccc, 30);
});

test('module exposes sensible defaults', () => {
  assert.equal(wc.DEFAULT_DAYS_RECEIVABLE, 0);
  assert.equal(wc.DEFAULT_DAYS_PAYABLE, 60);
  assert.equal(wc.DEFAULT_DAYS_INVENTORY, 60);
  assert.equal(wc.DEFAULT_WACC_PCT, 8.0);
});
