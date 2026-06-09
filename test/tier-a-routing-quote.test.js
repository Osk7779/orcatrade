'use strict';

// Tier-A wire-up tests for routing-quote. Same shape as
// test/tier-a-customs-quote.test.js / -finance-quote / -sourcing-quote.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const routing = require(path.join(ROOT, 'lib', 'intelligence', 'routing-quote'));
const tierA = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a'));
const greenState = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a', 'green-state'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));
const stampScript = require(path.join(ROOT, 'scripts', 'tier-a-stamp'));

// ── COVERAGE manifest ─────────────────────────────────────────────────

test('TIER_A_COVERAGE.calculatorName === "routing-quote"', () => {
  assert.equal(routing.TIER_A_COVERAGE.calculatorName, 'routing-quote');
});

test('TIER_A_COVERAGE is frozen', () => {
  assert.equal(Object.isFrozen(routing.TIER_A_COVERAGE), true);
  assert.equal(Object.isFrozen(routing.TIER_A_COVERAGE.axes), true);
});

test('TIER_A_COVERAGE.weightKg bounds match cargo physics: [1, 50_000]', () => {
  // 1 kg floor (rejects zero/negative); 50 t ceiling (FCL practical
  // max with batching). Above 50 t = dedicated charter, not a
  // wizard quote.
  assert.equal(routing.TIER_A_COVERAGE.axes.weightKg.type, 'integer-range');
  assert.equal(routing.TIER_A_COVERAGE.axes.weightKg.min, 1);
  assert.equal(routing.TIER_A_COVERAGE.axes.weightKg.max, 50_000);
});

// ── buildTierAInput ───────────────────────────────────────────────────

function sampleQuote() {
  return routing.calculateQuote({
    weightKg: 800,
    volumeCbm: 4,
    originCountry: 'CN',
    destinationCountry: 'DE',
    urgencyDays: 60,
    costPriority: 'balanced',
  });
}

test('buildTierAInput on a successful quote emits a mirror snapshot', () => {
  const quote = sampleQuote();
  assert.equal(quote.ok, true);
  const ta = routing.buildTierAInput(quote);
  assert.equal(ta.calculatorName, 'routing-quote');
  assert.equal(ta.snapshots.length, 1);
  const mirror = ta.snapshots[0];
  assert.equal(mirror.source_kind, 'mirror');
  assert.ok(mirror.id.startsWith('routing-quote:pricing@'));
  assert.match(mirror.as_of_iso, /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
});

test('buildTierAInput surfaces weightKg in coverageInput', () => {
  const quote = sampleQuote();
  const ta = routing.buildTierAInput(quote);
  assert.equal(ta.coverageInput.weightKg, 800);
});

test('buildTierAInput rounds non-integer weights to the nearest kg', () => {
  // The coverage axis is integer-range. routing-quote accepts
  // floats (validateInput uses Number()), but Tier-A needs an
  // integer to satisfy the axis matcher.
  const ta = routing.buildTierAInput({
    ok: true,
    inputs: { weightKg: 799.7 },
  });
  assert.equal(ta.coverageInput.weightKg, 800);
});

test('buildTierAInput on a failed quote returns a well-shaped empty input', () => {
  const ta = routing.buildTierAInput({ ok: false, errors: ['something'] });
  assert.equal(ta.calculatorName, 'routing-quote');
  assert.deepEqual(ta.snapshots, []);
  assert.deepEqual(ta.coverageInput, {});
  assert.equal(ta.calculatorCoverage, routing.TIER_A_COVERAGE);
});

test('buildTierAInput escalations + overrides default to empty arrays (TA-4 fail-open)', () => {
  const ta = routing.buildTierAInput(sampleQuote());
  assert.deepEqual(ta.escalations, []);
  assert.deepEqual(ta.overrides, []);
});

// ── End-to-end through tierA.evaluate ─────────────────────────────────

// PRICING_SNAPSHOT.asOf = 2026-04-15. Anchor "now" within 30 days so
// TA-1 passes; failure mode is reliably TA-2 (mirror).
const NOW_MS = Date.parse('2026-05-01T12:00:00.000Z');

test('quote → buildTierAInput → evaluate() fails TA-2 (mirror source only)', async () => {
  kv._resetMemoryStore();
  await greenState.stampLastGreenAt('routing-quote', { nowMs: NOW_MS });
  const ta = routing.buildTierAInput(sampleQuote());
  const verdict = await tierA.evaluate(ta, { nowMs: NOW_MS });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.failedReason, tierA.REASONS.NON_PRIMARY_SOURCE);
});

test('with a synthetic primary_regulator snapshot, the same quote becomes eligible:true', async () => {
  kv._resetMemoryStore();
  await greenState.stampLastGreenAt('routing-quote', { nowMs: NOW_MS });
  const ta = routing.buildTierAInput(sampleQuote());
  ta.snapshots = [{
    id: 'scfi-sea-cn-eu@2026-04-30',
    source_kind: 'primary_regulator',
    as_of_iso: '2026-04-30T00:00:00.000Z',
  }];
  const verdict = await tierA.evaluate(ta, { nowMs: NOW_MS });
  assert.equal(verdict.eligible, true, `expected eligible:true, got: ${JSON.stringify(verdict)}`);
});

test('weight at the 50_000 kg boundary is in-coverage; over fails TA-5', async () => {
  kv._resetMemoryStore();
  await greenState.stampLastGreenAt('routing-quote', { nowMs: NOW_MS });
  function buildAt(weightKg) {
    const ta = routing.buildTierAInput({
      ok: true,
      inputs: { weightKg },
    });
    ta.snapshots = [{ id: 'p', source_kind: 'primary_regulator', as_of_iso: '2026-04-30T00:00:00.000Z' }];
    return ta;
  }
  const atBoundary = await tierA.evaluate(buildAt(50_000), { nowMs: NOW_MS });
  assert.equal(atBoundary.eligible, true, '50_000 kg boundary must pass (inclusive range)');
  const overBoundary = await tierA.evaluate(buildAt(50_001), { nowMs: NOW_MS });
  assert.equal(overBoundary.eligible, false);
  assert.equal(overBoundary.failedReason, tierA.REASONS.OUTSIDE_COVERAGE);
  assert.equal(overBoundary.detail.axis, 'weightKg');
});

test('weight at 1 kg passes; weight at 0 fails (positive cargo only)', async () => {
  kv._resetMemoryStore();
  await greenState.stampLastGreenAt('routing-quote', { nowMs: NOW_MS });
  function buildAt(weightKg) {
    const ta = routing.buildTierAInput({
      ok: true,
      inputs: { weightKg },
    });
    ta.snapshots = [{ id: 'p', source_kind: 'primary_regulator', as_of_iso: '2026-04-30T00:00:00.000Z' }];
    return ta;
  }
  const atOne = await tierA.evaluate(buildAt(1), { nowMs: NOW_MS });
  assert.equal(atOne.eligible, true, '1 kg must pass (inclusive lower bound)');
  const atZero = await tierA.evaluate(buildAt(0), { nowMs: NOW_MS });
  assert.equal(atZero.eligible, false);
  assert.equal(atZero.failedReason, tierA.REASONS.OUTSIDE_COVERAGE);
});

// ── Stamp script integration ──────────────────────────────────────────

test('scripts/tier-a-stamp.js CALCULATORS includes routing-quote', () => {
  assert.ok(
    stampScript.CALCULATORS.includes('routing-quote'),
    'routing-quote must be in CALCULATORS so its TA-3 stamp is written',
  );
});

test('greenState.stampLastGreenAt round-trips for routing-quote', async () => {
  kv._resetMemoryStore();
  const stamp = await greenState.stampLastGreenAt('routing-quote');
  assert.equal(stamp.ok, true);
  const readBack = await greenState.readLastGreenAt('routing-quote');
  assert.equal(readBack, stamp.iso);
});

// ── Module-surface ────────────────────────────────────────────────────

test('routing-quote exports TIER_A_COVERAGE + buildTierAInput', () => {
  assert.equal(typeof routing.buildTierAInput, 'function');
  assert.equal(typeof routing.TIER_A_COVERAGE, 'object');
});
