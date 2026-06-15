'use strict';

// Tier-A wire-up tests for sourcing-quote. Same shape as
// test/tier-a-customs-quote.test.js + test/tier-a-finance-quote.test.js
// — COVERAGE parity, mirror-source posture, coverageInput surfacing,
// end-to-end through tierA.evaluate.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const sourcing = require(path.join(ROOT, 'lib', 'intelligence', 'sourcing-quote'));
const tierA = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a'));
const greenState = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a', 'green-state'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));
const stampScript = require(path.join(ROOT, 'scripts', 'tier-a-stamp'));

// ── COVERAGE manifest ─────────────────────────────────────────────────

test('TIER_A_COVERAGE.calculatorName === "sourcing-quote"', () => {
  assert.equal(sourcing.TIER_A_COVERAGE.calculatorName, 'sourcing-quote');
});

test('TIER_A_COVERAGE is frozen', () => {
  assert.equal(Object.isFrozen(sourcing.TIER_A_COVERAGE), true);
  assert.equal(Object.isFrozen(sourcing.TIER_A_COVERAGE.axes), true);
});

test('TIER_A_COVERAGE.productCategory matches the published category list both ways', () => {
  // Drift guard: every category in listCategories() must appear in
  // COVERAGE; every COVERAGE value must be a real category. Adding
  // a category without updating COVERAGE silently disqualifies its
  // quotes from Tier-A.
  const declared = new Set(sourcing.TIER_A_COVERAGE.axes.productCategory.values);
  const published = new Set(sourcing.listCategories().map((c) => c.key));
  for (const k of published) {
    assert.ok(declared.has(k), `category "${k}" published but missing from TIER_A_COVERAGE`);
  }
  for (const k of declared) {
    assert.ok(published.has(k), `category "${k}" declared in COVERAGE but not in listCategories()`);
  }
});

// ── buildTierAInput ───────────────────────────────────────────────────

function sampleQuote() {
  return sourcing.recommendCountry({
    productCategory: 'apparel',
    targetFobUnitEur: 8,
    moq: 2000,
    urgencyWeeks: 12,
    costPriority: 'balanced',
  });
}

test('buildTierAInput on a successful recommendCountry quote emits a mirror snapshot', () => {
  const quote = sampleQuote();
  assert.equal(quote.ok, true);
  const ta = sourcing.buildTierAInput(quote);
  assert.equal(ta.calculatorName, 'sourcing-quote');
  assert.equal(ta.snapshots.length, 1);
  const mirror = ta.snapshots[0];
  assert.equal(mirror.source_kind, 'mirror');
  assert.ok(mirror.id.startsWith('sourcing-quote:pricing@'));
  assert.match(mirror.as_of_iso, /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
});

test('buildTierAInput surfaces productCategory in coverageInput', () => {
  const quote = sampleQuote();
  const ta = sourcing.buildTierAInput(quote);
  assert.equal(ta.coverageInput.productCategory, 'apparel');
});

test('buildTierAInput on a failed quote returns a well-shaped empty input', () => {
  const ta = sourcing.buildTierAInput({ ok: false, errors: ['something'] });
  assert.equal(ta.calculatorName, 'sourcing-quote');
  assert.deepEqual(ta.snapshots, []);
  assert.deepEqual(ta.coverageInput, {});
  assert.equal(ta.calculatorCoverage, sourcing.TIER_A_COVERAGE);
});

test('buildTierAInput escalations + overrides default to empty arrays (TA-4 fail-open posture)', () => {
  const ta = sourcing.buildTierAInput(sampleQuote());
  assert.deepEqual(ta.escalations, []);
  assert.deepEqual(ta.overrides, []);
});

// ── End-to-end through tierA.evaluate ─────────────────────────────────

// PRICING_SNAPSHOT.asOf = 2026-05-07. Anchor "now" within 30 days so
// TA-1 passes; failure mode is reliably TA-2 (mirror).
const NOW_MS = Date.parse('2026-05-15T12:00:00.000Z');

test('sourcing quote → buildTierAInput → evaluate() fails TA-2 (mirror source only)', async () => {
  kv._resetMemoryStore();
  await greenState.stampLastGreenAt('sourcing-quote', { nowMs: NOW_MS });
  const ta = sourcing.buildTierAInput(sampleQuote());
  const verdict = await tierA.evaluate(ta, { nowMs: NOW_MS });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.failedReason, tierA.REASONS.NON_PRIMARY_SOURCE);
});

test('with a synthetic primary_regulator snapshot, the same quote becomes eligible:true', async () => {
  kv._resetMemoryStore();
  await greenState.stampLastGreenAt('sourcing-quote', { nowMs: NOW_MS });
  const ta = sourcing.buildTierAInput(sampleQuote());
  ta.snapshots = [{
    id: 'world-bank-comtrade:apparel-cn@2026-05-14',
    source_kind: 'primary_regulator',
    as_of_iso: '2026-05-14T00:00:00.000Z',
  }];
  const verdict = await tierA.evaluate(ta, { nowMs: NOW_MS });
  assert.equal(verdict.eligible, true, `expected eligible:true, got: ${JSON.stringify(verdict)}`);
});

test('out-of-coverage productCategory (not in CATEGORIES) fails TA-5', async () => {
  kv._resetMemoryStore();
  await greenState.stampLastGreenAt('sourcing-quote', { nowMs: NOW_MS });
  // Hand-built quote-shaped object so we hit a category that
  // validateInput would reject — we want to confirm TA-5 specifically.
  const ta = sourcing.buildTierAInput({
    ok: true,
    inputs: { productCategory: 'unknown_category' },
    asOf: '2026-05-07',
  });
  // Strip mirror so TA-2 passes (otherwise TA-2 fires before TA-5).
  ta.snapshots = [{ id: 'p', source_kind: 'primary_regulator', as_of_iso: '2026-05-14T00:00:00.000Z' }];
  const verdict = await tierA.evaluate(ta, { nowMs: NOW_MS });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.failedReason, tierA.REASONS.OUTSIDE_COVERAGE);
  assert.equal(verdict.detail.axis, 'productCategory');
});

// ── Stamp script integration ──────────────────────────────────────────

test('scripts/tier-a-stamp.js CALCULATORS includes sourcing-quote', () => {
  assert.ok(
    stampScript.CALCULATORS.includes('sourcing-quote'),
    'sourcing-quote must be in CALCULATORS so its TA-3 stamp is written',
  );
});

test('greenState.stampLastGreenAt round-trips for sourcing-quote', async () => {
  kv._resetMemoryStore();
  const stamp = await greenState.stampLastGreenAt('sourcing-quote');
  assert.equal(stamp.ok, true);
  const readBack = await greenState.readLastGreenAt('sourcing-quote');
  assert.equal(readBack, stamp.iso);
});

// ── Module-surface ────────────────────────────────────────────────────

test('sourcing-quote exports TIER_A_COVERAGE + buildTierAInput', () => {
  assert.equal(typeof sourcing.buildTierAInput, 'function');
  assert.equal(typeof sourcing.TIER_A_COVERAGE, 'object');
});
