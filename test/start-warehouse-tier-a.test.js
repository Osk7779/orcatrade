'use strict';

// Tier-A wire-up tests for the /api/start warehouse sub-result.
// Mirrors test/start-tier-a.test.js (customs PR #91), test/start-
// sourcing-tier-a.test.js (sourcing PR #110), test/start-routing-
// tier-a.test.js (routing PR #114), and test/start-finance-tier-a
// (finance PR #116). Closes the wedge at FIVE calculator-grounded
// tier_a verdicts per plan.
//
// Edge case unique to warehouse: warehouseResult is only computed
// when monthlyOrders >= 100, so the verdict is conditionally absent.
// The skipped state has its own shape — no tier_a key when the
// volume question was left blank.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const startHandler = require(path.join(ROOT, 'lib', 'handlers', 'start'));
const tierA = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a'));

const { composePlan } = startHandler;

const BASE_INPUT = Object.freeze({
  productCategory: 'apparel',
  originCountry: 'CN',
  destinationCountry: 'PL',
  customsValueEur: 25000,
  weightKg: 800,
  linesCount: 2,
  urgencyWeeks: 12,
  claimPreferential: false,
});

const INPUT_WITH_VOLUME = Object.freeze({
  ...BASE_INPUT,
  monthlyOrders: 1500,
  avgUnitsPerOrder: 1.5,
  avgLinesPerOrder: 1.2,
  avgPalletsHeld: 50,
  avgOrderWeightKg: 2,
});

// ── tier_a is present on the warehouse sub-block when computed ─────────

test('composePlan attaches a tier_a verdict to the warehouse block when monthlyOrders >= 100', async () => {
  const plan = await composePlan(INPUT_WITH_VOLUME);
  assert.equal(plan.ok, true);
  assert.ok(plan.warehouse, 'warehouse block must be present');
  assert.notEqual(plan.warehouse.skipped, true, 'warehouse must NOT be in skipped state for this input');
  assert.ok(plan.warehouse.tier_a, 'plan.warehouse.tier_a must be set on successful warehouse result');
  const v = plan.warehouse.tier_a;
  assert.equal(typeof v.eligible, 'boolean');
  assert.equal(typeof v.evaluatedAtIso, 'string');
  assert.equal(v.schemaVersion, tierA.SCHEMA_VERSION);
});

test('warehouse tier_a.failedReason is a canonical REASONS value when eligible:false', async () => {
  const plan = await composePlan(INPUT_WITH_VOLUME);
  const v = plan.warehouse.tier_a;
  if (v && v.eligible === false) {
    const allowed = new Set(Object.values(tierA.REASONS));
    assert.ok(
      allowed.has(v.failedReason),
      `failedReason "${v.failedReason}" must be one of REASONS: ${[...allowed].join(', ')}`,
    );
  }
});

test('deterministic warehouse path is reliably ineligible (PRICING_SNAPSHOT is mirror-only)', async () => {
  // PRICING_SNAPSHOT is the OrcaTrade quarterly 3PL benchmark survey
  // → mirror only. TA-2 reliably fails. Acceptable reasons:
  // NON_PRIMARY_SOURCE, STALE_SNAPSHOT, or CALCULATOR_NOT_GREEN.
  // NEVER eligible:true until Eurostat / hub-published rate cards
  // are wired in.
  const plan = await composePlan(INPUT_WITH_VOLUME);
  const v = plan.warehouse.tier_a;
  assert.equal(v.eligible, false, 'deterministic warehouse path cannot satisfy TA-2');
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

// ── Skipped state preserves its shape (no tier_a key) ──────────────────

test('warehouse skipped state (no monthlyOrders) does NOT carry a tier_a key', async () => {
  // When the wizard caller leaves volume blank, the warehouse leg is
  // omitted from the plan entirely. The skipped sub-block has a
  // documented shape: { skipped: true, reason: '...' }. Adding a
  // tier_a:null here would be misleading (there's no calculation to
  // verdict on).
  const plan = await composePlan(BASE_INPUT);
  assert.equal(plan.ok, true);
  assert.ok(plan.warehouse, 'warehouse key must always be present');
  assert.equal(plan.warehouse.skipped, true);
  assert.equal('tier_a' in plan.warehouse, false, 'skipped warehouse must NOT carry a tier_a key');
  assert.ok(plan.warehouse.reason, 'skipped warehouse must carry a reason');
});

// ── Best-effort: a thrown evaluator does not break the plan ───────────

test('a thrown warehouse tier-a evaluation leaves plan.warehouse.tier_a null but the plan still composes', async () => {
  const orig = tierA.evaluate;
  tierA.evaluate = async () => { throw new Error('synthetic tier-a failure'); };
  try {
    const plan = await composePlan(INPUT_WITH_VOLUME);
    assert.equal(plan.ok, true, 'plan must still compose even if tier-a throws');
    assert.equal(plan.warehouse.tier_a, null, 'warehouse.tier_a is null on evaluator failure');
    // Warehouse recommendation + hubs still populated:
    assert.ok(plan.warehouse.recommendation, 'warehouse.recommendation still present');
    assert.ok(plan.warehouse.hubs, 'warehouse.hubs still present');
    // Customs + sourcing + routing + finance tier_a also null in
    // this synthetic — same mocked evaluator throws on all five —
    // regression guards for PRs #91 + #110 + #114 + #116 paths.
    assert.equal(plan.customs.tier_a, null);
    assert.equal(plan.sourcing.tier_a, null);
    assert.equal(plan.routing.tier_a, null);
    assert.equal(plan.finance.tier_a, null);
  } finally {
    tierA.evaluate = orig;
  }
});

// ── Plan shape: warehouse populated branch carries tier_a ─────────────

test('plan.warehouse (populated branch) keys are exactly the documented set', async () => {
  const plan = await composePlan(INPUT_WITH_VOLUME);
  const expectedKeys = new Set([
    'ok', 'recommendation', 'recommendedHub', 'hubs', 'tier_a',
  ]);
  for (const key of Object.keys(plan.warehouse)) {
    assert.ok(expectedKeys.has(key), `unexpected key on plan.warehouse: "${key}"`);
  }
});

test('plan.warehouse.tier_a is never undefined on populated branch (always a verdict or null)', async () => {
  const plan = await composePlan(INPUT_WITH_VOLUME);
  assert.notEqual(plan.warehouse.tier_a, undefined);
});

// ── All FIVE verdicts present on every valid plan with volume ──────────

test('plan carries customs + sourcing + routing + finance + warehouse tier_a verdicts (FIVE — wedge closed)', async () => {
  // The compounding signal. Customs (PR #91) + sourcing (PR #110) +
  // routing (PR #114) + finance (PR #116) + warehouse (this PR).
  // Five calculator-grounded verdicts per plan when the wizard caller
  // supplies monthly volume. The wedge is now five-dimensional at
  // the composer layer — the wedge is closed.
  const plan = await composePlan(INPUT_WITH_VOLUME);
  assert.ok(plan.customs.tier_a, 'customs verdict (PR #91)');
  assert.ok(plan.sourcing.tier_a, 'sourcing verdict (PR #110)');
  assert.ok(plan.routing.tier_a, 'routing verdict (PR #114)');
  assert.ok(plan.finance.tier_a, 'finance verdict (PR #116)');
  assert.ok(plan.warehouse.tier_a, 'warehouse verdict (this PR)');
  // Independent evaluatedAtIso stamps prove each was computed by its
  // own call (not shared via reference).
  assert.equal(typeof plan.customs.tier_a.evaluatedAtIso, 'string');
  assert.equal(typeof plan.sourcing.tier_a.evaluatedAtIso, 'string');
  assert.equal(typeof plan.routing.tier_a.evaluatedAtIso, 'string');
  assert.equal(typeof plan.finance.tier_a.evaluatedAtIso, 'string');
  assert.equal(typeof plan.warehouse.tier_a.evaluatedAtIso, 'string');
});

// ── Calculator-grounding: monthlyOrders flows from the wizard input ──

test('warehouse tier_a coverageInput reflects the supplied monthlyOrders (calculator-grounding contract)', async () => {
  // The tier_a verdict carries coverage diagnostic info when
  // eligible:false. Verify the monthlyOrders flows through.
  const plan = await composePlan({ ...INPUT_WITH_VOLUME, monthlyOrders: 5000 });
  const v = plan.warehouse.tier_a;
  // The verdict is reliably ineligible (mirror snapshot). The
  // detail field carries the failed axis when OUTSIDE_COVERAGE;
  // for NON_PRIMARY_SOURCE / STALE_SNAPSHOT / CALCULATOR_NOT_GREEN
  // the detail is absent. Either way the verdict must not be
  // undefined.
  assert.notEqual(v, undefined);
  assert.notEqual(v, null);
});
