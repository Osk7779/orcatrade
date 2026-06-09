'use strict';

// Tier-A wire-up tests for warehouse-quote. Same shape as
// test/tier-a-customs-quote.test.js / -finance-quote / -sourcing-quote
// / -routing-quote. Closes the calculator-side wedge at 5/5.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const warehouse = require(path.join(ROOT, 'lib', 'intelligence', 'warehouse-quote'));
const tierA = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a'));
const greenState = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a', 'green-state'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));
const stampScript = require(path.join(ROOT, 'scripts', 'tier-a-stamp'));

// ── COVERAGE manifest ─────────────────────────────────────────────────

test('TIER_A_COVERAGE.calculatorName === "warehouse-quote"', () => {
  assert.equal(warehouse.TIER_A_COVERAGE.calculatorName, 'warehouse-quote');
});

test('TIER_A_COVERAGE is frozen', () => {
  assert.equal(Object.isFrozen(warehouse.TIER_A_COVERAGE), true);
  assert.equal(Object.isFrozen(warehouse.TIER_A_COVERAGE.axes), true);
});

test('TIER_A_COVERAGE.monthlyOrders bounds match SME fulfilment range: [100, 100_000]', () => {
  // 100 orders/month floor — below that, the warehouse calculator's
  // amortised setup fees dominate and rates aren't really comparable
  // to monthly-fee 3PLs. 100,000/month ceiling — above that is
  // enterprise-volume territory with dedicated rate negotiation, not
  // public list-rate comparison. validateInput accepts a wider range
  // (1 to 500,000); Tier-A pins the regression-tested band.
  assert.equal(warehouse.TIER_A_COVERAGE.axes.monthlyOrders.type, 'integer-range');
  assert.equal(warehouse.TIER_A_COVERAGE.axes.monthlyOrders.min, 100);
  assert.equal(warehouse.TIER_A_COVERAGE.axes.monthlyOrders.max, 100_000);
});

// ── buildTierAInput ───────────────────────────────────────────────────

function sampleQuote(overrides) {
  return warehouse.calculateQuote({
    monthlyOrders: 1500,
    avgUnitsPerOrder: 1.5,
    avgLinesPerOrder: 1.2,
    avgPalletsHeld: 50,
    avgOrderWeightKg: 2,
    primaryDestination: 'DE',
    ...(overrides || {}),
  });
}

test('buildTierAInput on a successful quote emits a mirror snapshot', () => {
  const quote = sampleQuote();
  assert.equal(quote.ok, true);
  const ta = warehouse.buildTierAInput(quote);
  assert.equal(ta.calculatorName, 'warehouse-quote');
  assert.equal(ta.snapshots.length, 1);
  const mirror = ta.snapshots[0];
  assert.equal(mirror.source_kind, 'mirror');
  assert.ok(mirror.id.startsWith('warehouse-quote:pricing@'));
  assert.match(mirror.as_of_iso, /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
});

test('buildTierAInput surfaces monthlyOrders in coverageInput', () => {
  const quote = sampleQuote();
  const ta = warehouse.buildTierAInput(quote);
  assert.equal(ta.coverageInput.monthlyOrders, 1500);
});

test('buildTierAInput rounds non-integer order counts to the nearest integer', () => {
  // The coverage axis is integer-range. validateInput accepts floats
  // (Number()); Tier-A needs an integer to satisfy the axis matcher.
  const ta = warehouse.buildTierAInput({
    ok: true,
    inputs: { monthlyOrders: 1499.6 },
  });
  assert.equal(ta.coverageInput.monthlyOrders, 1500);
});

test('buildTierAInput on a failed quote returns a well-shaped empty input', () => {
  const ta = warehouse.buildTierAInput({ ok: false, errors: ['something'] });
  assert.equal(ta.calculatorName, 'warehouse-quote');
  assert.deepEqual(ta.snapshots, []);
  assert.deepEqual(ta.coverageInput, {});
  assert.equal(ta.calculatorCoverage, warehouse.TIER_A_COVERAGE);
});

test('buildTierAInput escalations + overrides default to empty arrays (TA-4 fail-open)', () => {
  const ta = warehouse.buildTierAInput(sampleQuote());
  assert.deepEqual(ta.escalations, []);
  assert.deepEqual(ta.overrides, []);
});

// ── End-to-end through tierA.evaluate ─────────────────────────────────

// PRICING_SNAPSHOT.asOf = 2026-05-07. Anchor "now" within 30 days so
// TA-1 passes; failure mode is reliably TA-2 (mirror).
const NOW_MS = Date.parse('2026-05-20T12:00:00.000Z');

test('quote → buildTierAInput → evaluate() fails TA-2 (mirror source only)', async () => {
  kv._resetMemoryStore();
  await greenState.stampLastGreenAt('warehouse-quote', { nowMs: NOW_MS });
  const ta = warehouse.buildTierAInput(sampleQuote());
  const verdict = await tierA.evaluate(ta, { nowMs: NOW_MS });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.failedReason, tierA.REASONS.NON_PRIMARY_SOURCE);
});

test('with a synthetic primary_regulator snapshot, the same quote becomes eligible:true', async () => {
  kv._resetMemoryStore();
  await greenState.stampLastGreenAt('warehouse-quote', { nowMs: NOW_MS });
  const ta = warehouse.buildTierAInput(sampleQuote());
  ta.snapshots = [{
    id: 'eurostat-warehousing-ppi@2026-05-15',
    source_kind: 'primary_regulator',
    as_of_iso: '2026-05-15T00:00:00.000Z',
  }];
  const verdict = await tierA.evaluate(ta, { nowMs: NOW_MS });
  assert.equal(verdict.eligible, true, `expected eligible:true, got: ${JSON.stringify(verdict)}`);
});

test('monthlyOrders at the 100_000 boundary is in-coverage; over fails TA-5', async () => {
  kv._resetMemoryStore();
  await greenState.stampLastGreenAt('warehouse-quote', { nowMs: NOW_MS });
  function buildAt(monthlyOrders) {
    const ta = warehouse.buildTierAInput({
      ok: true,
      inputs: { monthlyOrders },
    });
    ta.snapshots = [{ id: 'p', source_kind: 'primary_regulator', as_of_iso: '2026-05-15T00:00:00.000Z' }];
    return ta;
  }
  const atBoundary = await tierA.evaluate(buildAt(100_000), { nowMs: NOW_MS });
  assert.equal(atBoundary.eligible, true, '100_000 orders/month boundary must pass (inclusive range)');
  const overBoundary = await tierA.evaluate(buildAt(100_001), { nowMs: NOW_MS });
  assert.equal(overBoundary.eligible, false);
  assert.equal(overBoundary.failedReason, tierA.REASONS.OUTSIDE_COVERAGE);
  assert.equal(overBoundary.detail.axis, 'monthlyOrders');
});

test('monthlyOrders at 100 passes; at 99 fails (SME fulfilment floor)', async () => {
  kv._resetMemoryStore();
  await greenState.stampLastGreenAt('warehouse-quote', { nowMs: NOW_MS });
  function buildAt(monthlyOrders) {
    const ta = warehouse.buildTierAInput({
      ok: true,
      inputs: { monthlyOrders },
    });
    ta.snapshots = [{ id: 'p', source_kind: 'primary_regulator', as_of_iso: '2026-05-15T00:00:00.000Z' }];
    return ta;
  }
  const atFloor = await tierA.evaluate(buildAt(100), { nowMs: NOW_MS });
  assert.equal(atFloor.eligible, true, '100 orders/month must pass (inclusive lower bound)');
  const belowFloor = await tierA.evaluate(buildAt(99), { nowMs: NOW_MS });
  assert.equal(belowFloor.eligible, false);
  assert.equal(belowFloor.failedReason, tierA.REASONS.OUTSIDE_COVERAGE);
});

// ── Stamp script integration ──────────────────────────────────────────

test('scripts/tier-a-stamp.js CALCULATORS includes warehouse-quote', () => {
  assert.ok(
    stampScript.CALCULATORS.includes('warehouse-quote'),
    'warehouse-quote must be in CALCULATORS so its TA-3 stamp is written',
  );
});

test('scripts/tier-a-stamp.js CALCULATORS now contains all FIVE calculators', () => {
  // Foundation-layer parity: the wedge is now fully homogenised at
  // the calculator level. Each subsequent /api/start composer +
  // email + pill PR can chain warehouse through the same pattern
  // used for customs (PR #91/#92/#98), sourcing (PR #110/#111/#112),
  // routing (PR #114/#115), and finance (PR #116/#117).
  const expected = new Set([
    'customs-quote',
    'finance-quote',
    'sourcing-quote',
    'routing-quote',
    'warehouse-quote',
  ]);
  for (const name of expected) {
    assert.ok(stampScript.CALCULATORS.includes(name), `${name} missing from CALCULATORS`);
  }
});

test('greenState.stampLastGreenAt round-trips for warehouse-quote', async () => {
  kv._resetMemoryStore();
  const stamp = await greenState.stampLastGreenAt('warehouse-quote');
  assert.equal(stamp.ok, true);
  const readBack = await greenState.readLastGreenAt('warehouse-quote');
  assert.equal(readBack, stamp.iso);
});

// ── Module-surface ────────────────────────────────────────────────────

test('warehouse-quote exports TIER_A_COVERAGE + buildTierAInput', () => {
  assert.equal(typeof warehouse.buildTierAInput, 'function');
  assert.equal(typeof warehouse.TIER_A_COVERAGE, 'object');
});
