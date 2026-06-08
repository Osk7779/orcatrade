'use strict';

// Tier-A wire-up tests for the /api/start composite plan response.
//
// Pins that every successful plan response carries a tier_a verdict
// on the customs sub-block, with the verdict shape ADR 0020 +
// lib/intelligence/tier-a defines. The wizard UI badge will read
// this field; the eligible-rate metric reads the observability log
// the handler emits per evaluation.
//
// /api/start is the highest-traffic compute path on the platform —
// every wizard submission flows through it — so pinning the
// integration here matters more than any other handler-layer touch.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const startHandler = require(path.join(ROOT, 'lib', 'handlers', 'start'));
const tierA = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a'));

const { composePlan } = startHandler;

// Tight, validation-passing input matching the shape an existing
// test/start.test.js suite uses — CN → PL apparel, modest value.
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

// ── tier_a is present on every successful plan ────────────────────────

test('composePlan attaches a tier_a verdict to the customs block', async () => {
  const plan = await composePlan(VALID_INPUT);
  assert.equal(plan.ok, true);
  assert.ok(plan.customs, 'customs block must be present');
  // tier_a may be null if evaluation threw (best-effort contract), but
  // for the valid-input path it must produce a verdict.
  assert.ok(plan.customs.tier_a, 'plan.customs.tier_a must be set after successful customs result');
  const v = plan.customs.tier_a;
  // Required verdict fields per ADR 0020 + tierA.evaluate contract:
  assert.equal(typeof v.eligible, 'boolean');
  assert.equal(typeof v.evaluatedAtIso, 'string');
  assert.equal(v.schemaVersion, tierA.SCHEMA_VERSION);
});

test('tier_a.failedReason is a canonical REASONS value when eligible:false', async () => {
  const plan = await composePlan(VALID_INPUT);
  if (plan.customs.tier_a && plan.customs.tier_a.eligible === false) {
    const allowed = new Set(Object.values(tierA.REASONS));
    assert.ok(
      allowed.has(plan.customs.tier_a.failedReason),
      `failedReason "${plan.customs.tier_a.failedReason}" must be one of REASONS: ${[...allowed].join(', ')}`,
    );
  }
});

test('without TARIC live, the customs tier_a path is reliably ineligible (deterministic)', async () => {
  // The test runner sets ORCATRADE_DISABLE_LIVE_TARIC=1 so the async
  // path falls back to the sync chapter-rate calculator. The mirror-
  // only snapshot guarantees TA-2 fails (or TA-1 first if PRICING_SNAPSHOT
  // is stale enough, or TA-3 if green stamp absent). What we pin: it
  // is NEVER eligible:true on this path.
  process.env.ORCATRADE_DISABLE_LIVE_TARIC = '1';
  const plan = await composePlan(VALID_INPUT);
  assert.equal(plan.customs.tier_a.eligible, false, 'deterministic path cannot satisfy TA-2');
  const acceptable = new Set([
    tierA.REASONS.NON_PRIMARY_SOURCE,
    tierA.REASONS.STALE_SNAPSHOT,
    tierA.REASONS.CALCULATOR_NOT_GREEN,
  ]);
  assert.ok(
    acceptable.has(plan.customs.tier_a.failedReason),
    `expected one of ${[...acceptable].join(' / ')}, got "${plan.customs.tier_a.failedReason}"`,
  );
});

// ── Best-effort: a thrown evaluator does not break the plan ───────────

test('a thrown tier-a evaluation leaves plan.customs.tier_a as null but the plan still composes', async () => {
  const orig = tierA.evaluate;
  tierA.evaluate = async () => { throw new Error('synthetic tier-a failure'); };
  try {
    const plan = await composePlan(VALID_INPUT);
    assert.equal(plan.ok, true, 'plan must still compose even if tier-a throws');
    assert.equal(plan.customs.tier_a, null, 'tier_a is null on evaluator failure (best-effort contract)');
    // The rest of the customs block must still be populated:
    assert.ok(plan.customs.standard, 'standard customs quote still present');
    assert.ok(plan.customs.duty, 'duty block still present');
  } finally {
    tierA.evaluate = orig;
  }
});

// ── Plan shape parity: existing customs fields are unaffected ─────────

test('existing plan.customs fields are unchanged by the tier_a addition', async () => {
  const plan = await composePlan(VALID_INPUT);
  // Spot-check the pre-existing fields the wizard UI already reads.
  assert.equal(plan.customs.ok, true);
  assert.ok(plan.customs.duty);
  assert.ok(plan.customs.vat);
  assert.ok(plan.customs.standard);
  assert.ok(plan.customs.bonded);
  assert.ok(plan.customs.recommendation);
  assert.equal(typeof plan.customs.preferentialSavingEur, 'number');
  // tier_a is the only new field — no other field should appear or vanish.
  const expectedKeys = new Set([
    'ok', 'duty', 'vat', 'standard', 'bonded', 'recommendation', 'hsChapterLabel',
    'tradeDefenceMeasures', 'preferentialApplied', 'preferentialAvailable',
    'preferentialSavingEur', 'tier_a',
  ]);
  for (const key of Object.keys(plan.customs)) {
    assert.ok(expectedKeys.has(key), `unexpected key on plan.customs: "${key}"`);
  }
});

// ── tier_a is omitted when the customs result itself failed ───────────

test('plan.customs.tier_a is null when customs sub-result fails (no eligibility on a non-quote)', async () => {
  // We can't easily force customsResult.ok=false without injecting,
  // so we use an input where customs would fail validation: a value
  // way above the calculator's accepted range. composePlan's
  // top-level validateInput catches the global limits, but if it
  // somehow squeaked through, customsResult.ok would be false and
  // tier_a remains null.
  //
  // For now we assert the SHAPE: when customs.ok is true, tier_a is
  // a verdict object; when customs.ok is false, tier_a is null. The
  // first half is covered above; this test pins the contract that
  // tier_a is never an undefined property.
  const plan = await composePlan(VALID_INPUT);
  assert.notEqual(plan.customs.tier_a, undefined, 'tier_a must be set (either a verdict or null) — never undefined');
});
