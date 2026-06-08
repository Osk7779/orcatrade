'use strict';

// Tier-A wire-up tests for finance-quote. Same shape as
// test/tier-a-customs-quote.test.js — pins COVERAGE parity,
// buildTierAInput snapshot shape, and full evaluate() integration.
//
// finance-quote has clearer primary sources (ECB FX, named bank rate
// cards) than customs at the surface — but until those are wired,
// PRICING_SNAPSHOT is OrcaTrade's internal benchmark and registers
// as source_kind:'mirror'. Tier-A is therefore reliably ineligible
// today, exactly matching the customs-quote posture without live
// TARIC. The contract is what we pin.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const finance = require(path.join(ROOT, 'lib', 'intelligence', 'finance-quote'));
const tierA = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a'));
const greenState = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a', 'green-state'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));
const stampScript = require(path.join(ROOT, 'scripts', 'tier-a-stamp'));

// ── COVERAGE manifest ─────────────────────────────────────────────────

test('TIER_A_COVERAGE.calculatorName === "finance-quote"', () => {
  assert.equal(finance.TIER_A_COVERAGE.calculatorName, 'finance-quote');
});

test('TIER_A_COVERAGE is frozen — cannot be mutated at runtime', () => {
  assert.equal(Object.isFrozen(finance.TIER_A_COVERAGE), true);
  assert.equal(Object.isFrozen(finance.TIER_A_COVERAGE.axes), true);
});

test('TIER_A_COVERAGE.amountCents upper bound matches the calculator validateInput cap of €50M', () => {
  // validateInput caps amountEur at 50_000_000 → in integer cents that's
  // 50_000_000 * 100 = 5_000_000_000. A drift between the two surfaces
  // would silently make Tier-A more or less permissive than the
  // underlying calculator. Pin the parity.
  assert.equal(
    finance.TIER_A_COVERAGE.axes.amountCents.max,
    50_000_000 * 100,
    'TIER_A_COVERAGE.amountCents.max must equal the €50M validateInput cap × 100',
  );
});

test('TIER_A_COVERAGE.amountCents.min = 100 (rejects sub-€1 amounts)', () => {
  assert.equal(finance.TIER_A_COVERAGE.axes.amountCents.min, 100);
});

// ── buildTierAInput ───────────────────────────────────────────────────

function sampleHedgeQuote() {
  return finance.estimateFxHedgingCost({
    amountEur: 250_000,
    currencyPair: 'EUR/CNY',
    durationDays: 90,
  });
}

function samplePaymentQuote() {
  return finance.comparePaymentInstruments({
    amountEur: 50_000,
    supplierCountry: 'CN',
    supplierRelationshipMonths: 18,
    importerRiskAppetite: 'balanced',
  });
}

test('buildTierAInput on a successful FX hedge quote emits a mirror snapshot', () => {
  const quote = sampleHedgeQuote();
  assert.equal(quote.ok, true);
  const ta = finance.buildTierAInput(quote);
  assert.equal(ta.calculatorName, 'finance-quote');
  assert.equal(ta.snapshots.length, 1);
  const mirror = ta.snapshots[0];
  assert.equal(mirror.source_kind, 'mirror');
  assert.ok(mirror.id.startsWith('finance-quote:pricing@'));
  assert.match(mirror.as_of_iso, /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
});

test('buildTierAInput on a successful payment-instrument quote surfaces amountCents', () => {
  const quote = samplePaymentQuote();
  assert.equal(quote.ok, true);
  const ta = finance.buildTierAInput(quote);
  assert.equal(ta.coverageInput.amountCents, 50_000 * 100);
});

test('buildTierAInput on a failed quote returns a well-shaped empty input', () => {
  const ta = finance.buildTierAInput({ ok: false, errors: ['something'] });
  assert.equal(ta.calculatorName, 'finance-quote');
  assert.deepEqual(ta.snapshots, []);
  assert.deepEqual(ta.coverageInput, {});
  assert.equal(ta.calculatorCoverage, finance.TIER_A_COVERAGE);
});

test('buildTierAInput escalations + overrides default to empty arrays (TA-4 fail-open posture)', () => {
  const ta = finance.buildTierAInput(sampleHedgeQuote());
  assert.deepEqual(ta.escalations, []);
  assert.deepEqual(ta.overrides, []);
});

// ── End-to-end through tierA.evaluate ─────────────────────────────────

// Snapshot is dated 2026-05-07. Anchor "now" within 30 days of that
// so TA-1 passes; then the failure mode is reliably TA-2 (mirror).
const NOW_MS = Date.parse('2026-05-15T12:00:00.000Z');

test('hedge quote → buildTierAInput → evaluate() fails TA-2 (mirror source only)', async () => {
  kv._resetMemoryStore();
  await greenState.stampLastGreenAt('finance-quote', { nowMs: NOW_MS });
  const ta = finance.buildTierAInput(sampleHedgeQuote());
  const verdict = await tierA.evaluate(ta, { nowMs: NOW_MS });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.failedReason, tierA.REASONS.NON_PRIMARY_SOURCE);
});

test('hedge quote with synthetic primary_regulator snapshot → eligible:true', async () => {
  kv._resetMemoryStore();
  await greenState.stampLastGreenAt('finance-quote', { nowMs: NOW_MS });
  const ta = finance.buildTierAInput(sampleHedgeQuote());
  // Synthesise a primary-regulator snapshot — this is what live ECB FX
  // wiring would produce. End-to-end contract: the mechanism works,
  // even though no finance function emits this today.
  ta.snapshots = [{
    id: 'ecb-fx-eur-cny@2026-05-14',
    source_kind: 'primary_regulator',
    as_of_iso: '2026-05-14T00:00:00.000Z',
  }];
  const verdict = await tierA.evaluate(ta, { nowMs: NOW_MS });
  assert.equal(verdict.eligible, true, `expected eligible:true, got: ${JSON.stringify(verdict)}`);
});

test('quote at the €50M boundary is in-coverage; over the boundary fails TA-5', async () => {
  kv._resetMemoryStore();
  await greenState.stampLastGreenAt('finance-quote', { nowMs: NOW_MS });
  // Synthesise a quote-shaped object so we can hit the boundary
  // without going through validateInput's own €50M reject.
  function buildAt(amountEur) {
    const ta = finance.buildTierAInput({
      ok: true,
      inputs: { amountEur },
      asOf: '2026-05-07',
    });
    ta.snapshots = [{ id: 'p', source_kind: 'primary_regulator', as_of_iso: '2026-05-14T00:00:00.000Z' }];
    return ta;
  }
  const atBoundary = await tierA.evaluate(buildAt(50_000_000), { nowMs: NOW_MS });
  assert.equal(atBoundary.eligible, true, '€50M boundary must pass (inclusive range)');
  const overBoundary = await tierA.evaluate(buildAt(50_000_001), { nowMs: NOW_MS });
  assert.equal(overBoundary.eligible, false);
  assert.equal(overBoundary.failedReason, tierA.REASONS.OUTSIDE_COVERAGE);
  assert.equal(overBoundary.detail.axis, 'amountCents');
});

// ── Stamp script integration ──────────────────────────────────────────

test('scripts/tier-a-stamp.js CALCULATORS includes finance-quote', () => {
  assert.ok(
    stampScript.CALCULATORS.includes('finance-quote'),
    'finance-quote must be in the CALCULATORS list so its TA-3 stamp is written',
  );
});

test('greenState.stampLastGreenAt round-trips for finance-quote', async () => {
  kv._resetMemoryStore();
  const stamp = await greenState.stampLastGreenAt('finance-quote');
  assert.equal(stamp.ok, true);
  const readBack = await greenState.readLastGreenAt('finance-quote');
  assert.equal(readBack, stamp.iso);
});

// ── Module-surface ────────────────────────────────────────────────────

test('finance-quote exports TIER_A_COVERAGE + buildTierAInput', () => {
  assert.equal(typeof finance.buildTierAInput, 'function');
  assert.equal(typeof finance.TIER_A_COVERAGE, 'object');
});
