'use strict';

// PR #140 integration tests: when the start handler runs and the
// Comtrade KV cache holds a fresh trade-flow snapshot for the
// derived HS code, plan.sourcing.tier_a should flip from
// eligible:false (PR #99/#110 sync baseline) to eligible:true.
//
// Pre-PR #140 the start handler called sourcing.recommendCountry
// (sync) — the rate-card mirror was the only snapshot emitted and
// TA-2 always failed. This PR swaps to recommendCountryAsync with
// an explicit period derived in the handler (calculator stays
// deterministic per ADR 0020).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const startHandler = require(path.join(ROOT, 'lib', 'handlers', 'start'));
const sourcing = require(path.join(ROOT, 'lib', 'intelligence', 'sourcing-quote'));
const tierA = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a'));
const greenState = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a', 'green-state'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));

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

// CATEGORY_TO_HS maps 'apparel' → '62' (woven apparel chapter). The
// Comtrade lookup uses HS6 by default; HS2 normalises to itself.
const APPAREL_HS = '62';

// Period derivation in start.js: `String(new Date().getFullYear() - 1)`.
// Compute it the same way here so the test's seeded cache key matches
// what composePlan() will look up.
function expectedPeriod() {
  return String(new Date().getFullYear() - 1);
}

// ── Existing behaviour preserved ─────────────────────────────────────

test('composePlan still attaches plan.sourcing.tier_a (PR #110 invariant)', async () => {
  // Whether or not Comtrade data is present, the tier_a verdict
  // field must exist on the sourcing block. PR #110 pinned this; PR
  // #140 mustn't have changed the shape contract.
  kv._resetMemoryStore();
  const plan = await composePlan(VALID_INPUT);
  assert.equal(plan.ok, true);
  assert.ok(plan.sourcing, 'sourcing block must be present');
  assert.ok(plan.sourcing.tier_a, 'sourcing.tier_a must be set');
  assert.equal(typeof plan.sourcing.tier_a.eligible, 'boolean');
});

test('without Comtrade KV seed, sourcing tier_a stays eligible:false (sync fallback)', async () => {
  // The async path falls back to sync when Comtrade has no data,
  // and buildTierAInput emits the rate-card mirror → TA-2 fails →
  // eligible:false. Conservative posture: no badge unless backed
  // by primary regulator.
  kv._resetMemoryStore();
  const plan = await composePlan(VALID_INPUT);
  const v = plan.sourcing.tier_a;
  assert.equal(v.eligible, false,
    `expected eligible:false on the sync fallback path; got: ${JSON.stringify(v)}`);
});

// ── PR #140: eligible:true when Comtrade KV has data ────────────────

test('with Comtrade KV seeded for the derived HS + period, plan.sourcing.tier_a may flip eligible:true', async () => {
  // End-to-end happy path. Pre-PR #140 this test would have failed
  // because the start handler called the sync path even when
  // Comtrade data was available.
  //
  // We seed the SAME cache key the handler will look up:
  //   comtrade:flows:<hs>:<period> where hs = '62' (apparel
  //   chapter from CATEGORY_TO_HS) and period = last full year.
  //
  // Whether the verdict actually flips eligible:true depends on the
  // other Tier-A preconditions (TA-1 freshness, TA-3 green-stamp,
  // TA-5 coverage). composePlan reads "now" via Date.now() for the
  // freshness check, so we seed an asOf within the last 30 days.
  kv._resetMemoryStore();
  await greenState.stampLastGreenAt('sourcing-quote');

  const period = expectedPeriod();
  // asOf within 30 days of "now" so TA-1 freshness passes. Use 5
  // days ago in milliseconds to be safe across edge-of-month runs.
  const recentAsOf = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  await kv.set(`comtrade:flows:${APPAREL_HS}:${period}`, {
    hs: APPAREL_HS,
    period,
    asOf: recentAsOf,
    source: 'un-comtrade',
    reporters: [
      { reporterCode: '156', reporterIso: 'CHN', reporterDesc: 'China', tradeValueUsd: 1_000_000_000 },
      { reporterCode: '704', reporterIso: 'VNM', reporterDesc: 'Vietnam', tradeValueUsd: 500_000_000 },
    ],
  });

  const plan = await composePlan(VALID_INPUT);
  const v = plan.sourcing.tier_a;
  assert.equal(v.eligible, true,
    `expected eligible:true on the Comtrade-backed path; got: ${JSON.stringify(v)}`);
});

// ── HS code derivation ─────────────────────────────────────────────

test('start.js derives the same HS code for sourcing AND customs (single source of truth)', async () => {
  // PR #140 lifted the hsCode derivation above the sourcing call so
  // both paths share the same value. A future refactor that
  // accidentally re-introduces a divergence would silently break
  // the Comtrade lookup. Drift guard reads the source.
  const fs = require('node:fs');
  const startSrc = fs.readFileSync(
    path.join(ROOT, 'lib', 'handlers', 'start.js'),
    'utf8',
  );
  const declarations = startSrc.match(/const hsCode = input\.hsCode \|\| CATEGORY_TO_HS\[productCategory\] \|\| '99';/g);
  assert.ok(declarations, 'hsCode derivation not located');
  assert.equal(declarations.length, 1,
    `expected exactly ONE hsCode declaration in start.js (shared between sourcing + customs); got ${declarations.length}`);
});

test('start.js passes opts.period to recommendCountryAsync (calculator-determinism contract)', async () => {
  // The calculator-determinism test (test/calculator-determinism.
  // test.js) caught an early version of PR #139 reading the clock
  // inside the calculator. PR #139's fix: caller must supply
  // opts.period. PR #140 must honor this contract.
  const fs = require('node:fs');
  const startSrc = fs.readFileSync(
    path.join(ROOT, 'lib', 'handlers', 'start.js'),
    'utf8',
  );
  // The clock read happens in the handler (allowed) and the value
  // is passed as opts.period.
  assert.match(startSrc, /const comtradePeriod = String\(new Date\(\)\.getFullYear\(\) - 1\);/);
  assert.match(
    startSrc,
    /sourcing\.recommendCountryAsync\([\s\S]*?\{ period: comtradePeriod \}\)/,
  );
});

// ── Async-path wiring ──────────────────────────────────────────────

test('start.js awaits sourcing.recommendCountryAsync (NOT the sync recommendCountry)', async () => {
  const fs = require('node:fs');
  const startSrc = fs.readFileSync(
    path.join(ROOT, 'lib', 'handlers', 'start.js'),
    'utf8',
  );
  // The async path call site exists.
  assert.match(startSrc, /await sourcing\.recommendCountryAsync\(/);
  // And the sync call no longer fires for the main sourcing
  // recommendation. (assessRisk also lives on the sourcing module
  // but uses the sync surface and isn't the recommendation
  // calculation — it's a per-origin risk-pull.)
  //
  // Drift guard reads only the function block we changed —
  // assessRisk and listCountries calls elsewhere are fine.
  const composePlanBlock = startSrc.match(/async function composePlan[\s\S]*?\n\}/);
  assert.ok(composePlanBlock, 'composePlan body not located');
  assert.doesNotMatch(
    composePlanBlock[0],
    /sourcing\.recommendCountry\(/,
    'composePlan must not call the sync sourcing.recommendCountry (PR #140 swap)',
  );
});

// ── PR #139 surface still intact ───────────────────────────────────

test('sourcing-quote still exports both recommendCountry AND recommendCountryAsync (no breaking change)', () => {
  // Library consumers (potentially outside this handler) may rely
  // on the sync recommendCountry. PR #140 must not have removed it.
  assert.equal(typeof sourcing.recommendCountry, 'function');
  assert.equal(typeof sourcing.recommendCountryAsync, 'function');
});
