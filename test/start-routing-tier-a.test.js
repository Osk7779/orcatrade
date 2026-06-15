'use strict';

// Tier-A wire-up tests for the /api/start routing sub-result.
// Mirrors test/start-tier-a.test.js (customs) + test/start-sourcing-
// tier-a.test.js (sourcing). Every wizard plan now produces THREE
// calculator-grounded tier_a verdicts.

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

// ── tier_a is present on the routing sub-block ────────────────────────

test('composePlan attaches a tier_a verdict to the routing block', async () => {
  const plan = await composePlan(VALID_INPUT);
  assert.equal(plan.ok, true);
  assert.ok(plan.routing, 'routing block must be present');
  assert.ok(plan.routing.tier_a, 'plan.routing.tier_a must be set on successful routing result');
  const v = plan.routing.tier_a;
  assert.equal(typeof v.eligible, 'boolean');
  assert.equal(typeof v.evaluatedAtIso, 'string');
  assert.equal(v.schemaVersion, tierA.SCHEMA_VERSION);
});

test('routing tier_a.failedReason is a canonical REASONS value when eligible:false', async () => {
  const plan = await composePlan(VALID_INPUT);
  const v = plan.routing.tier_a;
  if (v && v.eligible === false) {
    const allowed = new Set(Object.values(tierA.REASONS));
    assert.ok(
      allowed.has(v.failedReason),
      `failedReason "${v.failedReason}" must be one of REASONS: ${[...allowed].join(', ')}`,
    );
  }
});

test('deterministic routing path is reliably ineligible (no primary regulator wired yet)', async () => {
  // PRICING_SNAPSHOT is OrcaTrade's partner-forwarder spot rate
  // snapshot → mirror only. TA-2 reliably fails. Acceptable reasons:
  // NON_PRIMARY_SOURCE, STALE_SNAPSHOT, or CALCULATOR_NOT_GREEN.
  // NEVER eligible:true.
  const plan = await composePlan(VALID_INPUT);
  const v = plan.routing.tier_a;
  assert.equal(v.eligible, false, 'deterministic routing path cannot satisfy TA-2');
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

test('a thrown routing tier-a evaluation leaves plan.routing.tier_a null but the plan still composes', async () => {
  const orig = tierA.evaluate;
  tierA.evaluate = async () => { throw new Error('synthetic tier-a failure'); };
  try {
    const plan = await composePlan(VALID_INPUT);
    assert.equal(plan.ok, true, 'plan must still compose even if tier-a throws');
    assert.equal(plan.routing.tier_a, null, 'routing.tier_a is null on evaluator failure');
    // Routing recommendation + modes still populated:
    assert.ok(plan.routing.recommendation, 'routing.recommendation still present');
    assert.ok(plan.routing.modes, 'routing.modes still present');
    // Customs + sourcing tier_a also null in this synthetic — same
    // mocked evaluator throws on all three — regression guards for
    // PR #91 + PR #110 paths.
    assert.equal(plan.customs.tier_a, null);
    assert.equal(plan.sourcing.tier_a, null);
  } finally {
    tierA.evaluate = orig;
  }
});

// ── Plan shape parity: existing routing fields unchanged ──────────────

test('existing plan.routing fields are unchanged by the tier_a addition', async () => {
  const plan = await composePlan(VALID_INPUT);
  // Pre-existing fields preserved (may be null if routing failed):
  assert.ok('recommendation' in plan.routing);
  assert.ok('modes' in plan.routing);
  assert.ok('railEducation' in plan.routing);
  assert.ok('recommendedQuote' in plan.routing);
  // Tier_a is the only new field — no other key should appear.
  const expectedKeys = new Set([
    'recommendation', 'modes', 'railEducation', 'recommendedQuote', 'tier_a',
  ]);
  for (const key of Object.keys(plan.routing)) {
    assert.ok(expectedKeys.has(key), `unexpected key on plan.routing: "${key}"`);
  }
});

test('plan.routing.tier_a is never undefined (always a verdict or null)', async () => {
  const plan = await composePlan(VALID_INPUT);
  assert.notEqual(plan.routing.tier_a, undefined);
});

// ── All three verdicts present on every valid plan ────────────────────

test('plan carries customs + sourcing + routing tier_a verdicts on every valid plan (THREE)', async () => {
  // The compounding signal. Customs (PR #91) + sourcing (PR #110) +
  // routing (this PR). Three calculator-grounded badges per plan.
  const plan = await composePlan(VALID_INPUT);
  assert.ok(plan.customs.tier_a, 'customs verdict (PR #91)');
  assert.ok(plan.sourcing.tier_a, 'sourcing verdict (PR #110)');
  assert.ok(plan.routing.tier_a, 'routing verdict (this PR)');
  // Independent evaluatedAtIso stamps prove each was computed by its
  // own call (not shared via reference).
  assert.equal(typeof plan.customs.tier_a.evaluatedAtIso, 'string');
  assert.equal(typeof plan.sourcing.tier_a.evaluatedAtIso, 'string');
  assert.equal(typeof plan.routing.tier_a.evaluatedAtIso, 'string');
});
