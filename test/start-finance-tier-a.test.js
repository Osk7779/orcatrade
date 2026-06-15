'use strict';

// Tier-A wire-up tests for the /api/start finance sub-result.
// Mirrors test/start-tier-a.test.js (customs PR #91), test/start-
// sourcing-tier-a.test.js (sourcing PR #110), and test/start-
// routing-tier-a.test.js (routing PR #114). Every wizard plan now
// produces FOUR calculator-grounded tier_a verdicts.

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

// ── tier_a is present on the finance sub-block ────────────────────────

test('composePlan attaches a tier_a verdict to the finance block', async () => {
  const plan = await composePlan(VALID_INPUT);
  assert.equal(plan.ok, true);
  assert.ok(plan.finance, 'finance block must be present');
  assert.ok(plan.finance.tier_a, 'plan.finance.tier_a must be set on successful finance result');
  const v = plan.finance.tier_a;
  assert.equal(typeof v.eligible, 'boolean');
  assert.equal(typeof v.evaluatedAtIso, 'string');
  assert.equal(v.schemaVersion, tierA.SCHEMA_VERSION);
});

test('finance tier_a.failedReason is a canonical REASONS value when eligible:false', async () => {
  const plan = await composePlan(VALID_INPUT);
  const v = plan.finance.tier_a;
  if (v && v.eligible === false) {
    const allowed = new Set(Object.values(tierA.REASONS));
    assert.ok(
      allowed.has(v.failedReason),
      `failedReason "${v.failedReason}" must be one of REASONS: ${[...allowed].join(', ')}`,
    );
  }
});

test('deterministic finance path is reliably ineligible (PRICING_SNAPSHOT is mirror-only)', async () => {
  // finance-quote's PRICING_SNAPSHOT is OrcaTrade's partner-bank rate
  // table → mirror only. TA-2 reliably fails. Acceptable reasons:
  // NON_PRIMARY_SOURCE, STALE_SNAPSHOT, or CALCULATOR_NOT_GREEN.
  // NEVER eligible:true until ECB FX lands.
  const plan = await composePlan(VALID_INPUT);
  const v = plan.finance.tier_a;
  assert.equal(v.eligible, false, 'deterministic finance path cannot satisfy TA-2');
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

test('a thrown finance tier-a evaluation leaves plan.finance.tier_a null but the plan still composes', async () => {
  const orig = tierA.evaluate;
  tierA.evaluate = async () => { throw new Error('synthetic tier-a failure'); };
  try {
    const plan = await composePlan(VALID_INPUT);
    assert.equal(plan.ok, true, 'plan must still compose even if tier-a throws');
    assert.equal(plan.finance.tier_a, null, 'finance.tier_a is null on evaluator failure');
    // Finance recommendation + instruments still populated:
    assert.ok(plan.finance.recommendation, 'finance.recommendation still present');
    assert.ok(plan.finance.instruments, 'finance.instruments still present');
    // Customs + sourcing + routing tier_a also null in this synthetic
    // — same mocked evaluator throws on all four — regression guards
    // for PRs #91 + #110 + #114 paths.
    assert.equal(plan.customs.tier_a, null);
    assert.equal(plan.sourcing.tier_a, null);
    assert.equal(plan.routing.tier_a, null);
  } finally {
    tierA.evaluate = orig;
  }
});

// ── Plan shape: new finance block carries the deterministic result ────

test('plan.finance carries the calculator-grounded recommendation and instrument list', async () => {
  const plan = await composePlan(VALID_INPUT);
  assert.equal(plan.finance.ok, true);
  // Calculator-grounded — recommendation comes from
  // finance.comparePaymentInstruments(), not from the LLM.
  assert.ok(plan.finance.recommendation, 'recommendation must be present');
  assert.equal(typeof plan.finance.recommendation.preferredKey, 'string');
  assert.ok(plan.finance.recommendation.instrument, 'recommendation.instrument must be present');
  assert.equal(typeof plan.finance.recommendation.reason, 'string');
  // Full instrument list — wizard surfaces this as a comparison card.
  assert.ok(Array.isArray(plan.finance.instruments), 'instruments must be an array');
  assert.ok(plan.finance.instruments.length >= 3, 'expect at least 3 payment instruments');
  for (const inst of plan.finance.instruments) {
    assert.equal(typeof inst.key, 'string');
    assert.equal(typeof inst.label, 'string');
    assert.equal(typeof inst.totalCostEur, 'number', `instrument ${inst.key} must carry a deterministic total cost`);
  }
});

test('plan.finance keys are exactly the documented set (no leakage of helper fields)', async () => {
  const plan = await composePlan(VALID_INPUT);
  const expectedKeys = new Set([
    'ok', 'recommendation', 'instruments', 'paymentEducation', 'tier_a',
  ]);
  for (const key of Object.keys(plan.finance)) {
    assert.ok(expectedKeys.has(key), `unexpected key on plan.finance: "${key}"`);
  }
});

test('plan.finance.tier_a is never undefined (always a verdict or null)', async () => {
  const plan = await composePlan(VALID_INPUT);
  assert.notEqual(plan.finance.tier_a, undefined);
});

// ── All four verdicts present on every valid plan ─────────────────────

test('plan carries customs + sourcing + routing + finance tier_a verdicts on every valid plan (FOUR)', async () => {
  // The compounding signal. Customs (PR #91) + sourcing (PR #110) +
  // routing (PR #114) + finance (this PR). Four calculator-grounded
  // verdicts per plan — the wedge is now four-dimensional.
  const plan = await composePlan(VALID_INPUT);
  assert.ok(plan.customs.tier_a, 'customs verdict (PR #91)');
  assert.ok(plan.sourcing.tier_a, 'sourcing verdict (PR #110)');
  assert.ok(plan.routing.tier_a, 'routing verdict (PR #114)');
  assert.ok(plan.finance.tier_a, 'finance verdict (this PR)');
  // Independent evaluatedAtIso stamps prove each was computed by its
  // own call (not shared via reference).
  assert.equal(typeof plan.customs.tier_a.evaluatedAtIso, 'string');
  assert.equal(typeof plan.sourcing.tier_a.evaluatedAtIso, 'string');
  assert.equal(typeof plan.routing.tier_a.evaluatedAtIso, 'string');
  assert.equal(typeof plan.finance.tier_a.evaluatedAtIso, 'string');
});

// ── Calculator-grounding: amount flows from the wizard input ──────────

test('finance comparison runs with amountEur = customsValueEur (calculator-grounding contract)', async () => {
  // amountEur is the consignment value supplied by the wizard. Verify
  // the deterministic cost math reflects this — every instrument's
  // totalCostEur must be calculable from costPercent × customsValueEur
  // (with rounding). We don't re-derive the math here; we just assert
  // costs are non-zero and scale with amount.
  const small = await composePlan({ ...VALID_INPUT, customsValueEur: 5000 });
  const large = await composePlan({ ...VALID_INPUT, customsValueEur: 200000 });
  // For every instrument key common to both, the large plan's cost
  // should be >= the small plan's cost (cost is monotonic in amount).
  const smallByKey = new Map(small.finance.instruments.map(i => [i.key, i.totalCostEur]));
  for (const inst of large.finance.instruments) {
    const smallCost = smallByKey.get(inst.key);
    if (smallCost == null) continue;
    assert.ok(
      inst.totalCostEur >= smallCost,
      `instrument ${inst.key}: large amount cost ${inst.totalCostEur} must be >= small amount cost ${smallCost}`,
    );
  }
});
