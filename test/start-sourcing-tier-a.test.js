'use strict';

// Tier-A wire-up tests for the /api/start sourcing sub-result.
// Mirrors test/start-tier-a.test.js (which pinned the customs sub-
// result contract) — same shape, different calculator. Every wizard
// plan now produces TWO calculator-grounded tier_a verdicts.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const startHandler = require(path.join(ROOT, 'lib', 'handlers', 'start'));
const tierA = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a'));

const { composePlan } = startHandler;

const VALID_INPUT = Object.freeze({
  productCategory: 'apparel',
  originCountry: 'CN',
  destinationCountry: 'PL',
  customsValueEur: 25000,
  weightKg: 800,
  linesCount: 2,
  urgencyWeeks: 12,
  claimPreferential: false,
});

// ── tier_a is present on the sourcing sub-block ───────────────────────

test('composePlan attaches a tier_a verdict to the sourcing block', async () => {
  const plan = await composePlan(VALID_INPUT);
  assert.equal(plan.ok, true);
  assert.ok(plan.sourcing, 'sourcing block must be present');
  assert.ok(plan.sourcing.tier_a, 'plan.sourcing.tier_a must be set on successful sourcing result');
  const v = plan.sourcing.tier_a;
  assert.equal(typeof v.eligible, 'boolean');
  assert.equal(typeof v.evaluatedAtIso, 'string');
  assert.equal(v.schemaVersion, tierA.SCHEMA_VERSION);
});

test('sourcing tier_a.failedReason is a canonical REASONS value when eligible:false', async () => {
  const plan = await composePlan(VALID_INPUT);
  const v = plan.sourcing.tier_a;
  if (v && v.eligible === false) {
    const allowed = new Set(Object.values(tierA.REASONS));
    assert.ok(
      allowed.has(v.failedReason),
      `failedReason "${v.failedReason}" must be one of REASONS: ${[...allowed].join(', ')}`,
    );
  }
});

test('deterministic sourcing path is reliably ineligible (no primary regulator wired yet)', async () => {
  // PRICING_SNAPSHOT is OrcaTrade's internal benchmark → mirror only.
  // TA-2 fails reliably. Acceptable reasons: NON_PRIMARY_SOURCE
  // (mirror), STALE_SNAPSHOT (PRICING_SNAPSHOT > 30 days), or
  // CALCULATOR_NOT_GREEN (CI stamp absent). NEVER eligible:true.
  const plan = await composePlan(VALID_INPUT);
  const v = plan.sourcing.tier_a;
  assert.equal(v.eligible, false, 'deterministic sourcing path cannot satisfy TA-2');
  const acceptable = new Set([
    tierA.REASONS.NON_PRIMARY_SOURCE,
    tierA.REASONS.STALE_SNAPSHOT,
    tierA.REASONS.CALCULATOR_NOT_GREEN,
  ]);
  assert.ok(
    acceptable.has(v.failedReason),
    `expected one of ${[...acceptable].join(' / ')}, got "${v.failedReason}"`,
  );
});

// ── Best-effort: a thrown evaluator does not break the plan ───────────

test('a thrown sourcing tier-a evaluation leaves plan.sourcing.tier_a null but the plan still composes', async () => {
  const orig = tierA.evaluate;
  tierA.evaluate = async () => { throw new Error('synthetic tier-a failure'); };
  try {
    const plan = await composePlan(VALID_INPUT);
    assert.equal(plan.ok, true, 'plan must still compose even if tier-a throws');
    assert.equal(plan.sourcing.tier_a, null, 'sourcing.tier_a is null on evaluator failure');
    // Sourcing recommendation + comparison still populated:
    assert.ok(plan.sourcing.recommendation, 'sourcing.recommendation still present');
    assert.ok(plan.sourcing.comparison, 'sourcing.comparison still present');
    // Customs tier_a should ALSO be null in this synthetic — same
    // mocked evaluator throws on both — proves the customs path
    // gracefully degrades too (regression guard from PR #91).
    assert.equal(plan.customs.tier_a, null);
  } finally {
    tierA.evaluate = orig;
  }
});

// ── Plan shape parity: existing sourcing fields unchanged ─────────────

test('existing plan.sourcing fields are unchanged by the tier_a addition', async () => {
  const plan = await composePlan(VALID_INPUT);
  // Pre-existing fields:
  assert.ok(plan.sourcing.recommendation || plan.sourcing.recommendation === null);
  assert.ok(plan.sourcing.comparison || plan.sourcing.comparison === null);
  assert.ok('yourOriginRisk' in plan.sourcing);
  // Tier_a is the only new field.
  const expectedKeys = new Set(['recommendation', 'yourOriginRisk', 'comparison', 'tier_a']);
  for (const key of Object.keys(plan.sourcing)) {
    assert.ok(expectedKeys.has(key), `unexpected key on plan.sourcing: "${key}"`);
  }
});

test('plan.sourcing.tier_a is never undefined (always a verdict or null)', async () => {
  const plan = await composePlan(VALID_INPUT);
  assert.notEqual(plan.sourcing.tier_a, undefined);
});

// ── Both verdicts are independent ─────────────────────────────────────

test('plan carries BOTH customs and sourcing tier_a verdicts on every valid plan', async () => {
  // The whole point of this PR — wider wedge signal per plan.
  const plan = await composePlan(VALID_INPUT);
  assert.ok(plan.customs.tier_a, 'customs verdict present (from PR #91)');
  assert.ok(plan.sourcing.tier_a, 'sourcing verdict present (this PR)');
  // Both should be independent calculations with their own
  // evaluatedAtIso stamps — assert they're at least string-shaped.
  assert.equal(typeof plan.customs.tier_a.evaluatedAtIso, 'string');
  assert.equal(typeof plan.sourcing.tier_a.evaluatedAtIso, 'string');
});
