'use strict';

// Tier-A eligibility — exhaustive contract tests for the ADR 0020
// preconditions. Each TA-N must fail in isolation (one bad input,
// nothing else wrong, the corresponding REASON surfaces). The all-pass
// case must return eligible:true. The drift-guard test pins the
// REASONS taxonomy against the ADR file so the contract cannot mutate
// silently.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const tierA = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a'));
const eligibility = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a', 'eligibility'));
const coverage = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a', 'coverage'));
const greenState = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a', 'green-state'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));

// Anchor "now" so every test computes ages off the same instant.
const NOW_MS = Date.parse('2026-06-08T12:00:00.000Z');
const ONE_DAY = 24 * 60 * 60 * 1000;

// Reusable: a calculator coverage manifest with all 4 axis types
// represented, scoped tight enough that we can mint passing and
// failing inputs deterministically.
const COVERAGE_OK = Object.freeze({
  calculatorName: 'customs-quote',
  version: 1,
  axes: {
    hsChapter: { type: 'prefixSet', values: ['84', '85'] },
    originCountry: { type: 'set', values: ['CN', 'VN'] },
    destCountry: { type: 'set', values: ['DE', 'PL', 'NL'] },
    declaredValueCents: { type: 'integer-range', min: 100, max: 10_000_000_00 },
  },
});

// A snapshot fresh + primary-source — drop it through any TA-1/TA-2 path
// and it passes both.
function freshPrimarySnapshot(id = 'taric-2026Q2', ageDays = 0) {
  const ts = new Date(NOW_MS - ageDays * ONE_DAY).toISOString();
  return { id, source_kind: 'primary_regulator', as_of_iso: ts };
}

// Stub green-state reader. Default = green stamped 1h ago (passes TA-3).
function fakeGreenReader(isoOverride) {
  return async () => isoOverride !== undefined ? isoOverride : new Date(NOW_MS - 60 * 60 * 1000).toISOString();
}

function passingInput(overrides = {}) {
  return {
    calculatorName: 'customs-quote',
    snapshots: [freshPrimarySnapshot('s1', 0), freshPrimarySnapshot('s2', 5)],
    escalations: [],
    overrides: [],
    coverageInput: { hsChapter: '8501', originCountry: 'CN', destCountry: 'DE', declaredValueCents: 50_000_00 },
    calculatorCoverage: COVERAGE_OK,
    ...overrides,
  };
}

// ── ALL-PASS GUARDRAIL ────────────────────────────────────────────────

test('evaluate() returns eligible:true when every precondition holds', async () => {
  const verdict = await tierA.evaluate(passingInput(), { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() });
  assert.equal(verdict.eligible, true, 'all-pass input must qualify for Tier-A');
  assert.equal(verdict.schemaVersion, tierA.SCHEMA_VERSION);
  assert.equal(verdict.evaluatedAtIso, new Date(NOW_MS).toISOString());
  assert.equal(verdict.failedReason, undefined, 'eligible verdicts must NOT carry a failedReason');
});

// ── TA-1: snapshot freshness ──────────────────────────────────────────

test('TA-1: a snapshot older than 30 days fails with STALE_SNAPSHOT', async () => {
  const v = await tierA.evaluate(
    passingInput({ snapshots: [freshPrimarySnapshot('s1', 0), freshPrimarySnapshot('stale-s2', 35)] }),
    { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() },
  );
  assert.equal(v.eligible, false);
  assert.equal(v.failedReason, tierA.REASONS.STALE_SNAPSHOT);
  assert.equal(v.detail.snapshotId, 'stale-s2');
  assert.ok(v.detail.ageDays >= 30, `stale snapshot reported age ${v.detail.ageDays} — expected ≥30`);
  assert.equal(v.detail.maxAgeDays, tierA.SNAPSHOT_MAX_AGE_DAYS);
});

test('TA-1: an empty snapshots array fails with STALE_SNAPSHOT', async () => {
  const v = await tierA.evaluate(
    passingInput({ snapshots: [] }),
    { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() },
  );
  assert.equal(v.failedReason, tierA.REASONS.STALE_SNAPSHOT);
});

test('TA-1: a snapshot with an unparseable as_of_iso fails', async () => {
  const v = await tierA.evaluate(
    passingInput({ snapshots: [{ id: 'bad', source_kind: 'primary_regulator', as_of_iso: 'not-a-date' }] }),
    { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() },
  );
  assert.equal(v.failedReason, tierA.REASONS.STALE_SNAPSHOT);
});

test('TA-1: a snapshot with freshness_days override is accepted past the default 30-day window', async () => {
  // PR #144: quarterly Eurostat sources structurally publish on a
  // ~75-day lag — a calculator that knows this declares freshness_days
  // on the snapshot itself. 90 days old + freshness_days:120 should
  // pass; 90 days old without the override (default 30) still fails.
  const ninetyDaysOld = {
    id: 'eurostat-warehousing-ppi:EU27_2020@2025-Q4',
    source_kind: 'primary_regulator',
    as_of_iso: new Date(NOW_MS - 90 * ONE_DAY).toISOString(),
    freshness_days: 120,
  };
  const vOk = await tierA.evaluate(
    passingInput({ snapshots: [ninetyDaysOld] }),
    { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() },
  );
  assert.equal(vOk.eligible, true, 'expected eligible:true with freshness_days override');

  // Same snapshot WITHOUT the override fails TA-1.
  const noOverride = { ...ninetyDaysOld, freshness_days: undefined };
  const vFail = await tierA.evaluate(
    passingInput({ snapshots: [noOverride] }),
    { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() },
  );
  assert.equal(vFail.eligible, false);
  assert.equal(vFail.failedReason, tierA.REASONS.STALE_SNAPSHOT);
  assert.equal(vFail.detail.maxAgeDays, tierA.SNAPSHOT_MAX_AGE_DAYS);
});

test('TA-1: freshness_days override still rejects a snapshot older than the declared window', async () => {
  // Honesty discipline — the override doesn't whitewash genuine
  // staleness. 200 days old with freshness_days:120 still fails.
  const wayTooOld = {
    id: 'eurostat-warehousing-ppi:EU27_2020@2024-Q4',
    source_kind: 'primary_regulator',
    as_of_iso: new Date(NOW_MS - 200 * ONE_DAY).toISOString(),
    freshness_days: 120,
  };
  const v = await tierA.evaluate(
    passingInput({ snapshots: [wayTooOld] }),
    { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() },
  );
  assert.equal(v.eligible, false);
  assert.equal(v.failedReason, tierA.REASONS.STALE_SNAPSHOT);
  assert.equal(v.detail.maxAgeDays, 120,
    'reported maxAgeDays must be the declared freshness_days, not the global default');
});

// ── TA-2: primary-regulator source ────────────────────────────────────

test('TA-2: a snapshot from a mirror source fails with NON_PRIMARY_SOURCE', async () => {
  const stale = { id: 'mirror-s', source_kind: 'mirror', as_of_iso: new Date(NOW_MS).toISOString() };
  const v = await tierA.evaluate(
    passingInput({ snapshots: [freshPrimarySnapshot('s1', 0), stale] }),
    { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() },
  );
  assert.equal(v.failedReason, tierA.REASONS.NON_PRIMARY_SOURCE);
  assert.equal(v.detail.snapshotId, 'mirror-s');
  assert.equal(v.detail.actualSourceKind, 'mirror');
  assert.equal(v.detail.requiredSourceKind, 'primary_regulator');
});

test('TA-2: customer_supplied source kind fails', async () => {
  const cs = { id: 'cs', source_kind: 'customer_supplied', as_of_iso: new Date(NOW_MS).toISOString() };
  const v = await tierA.evaluate(
    passingInput({ snapshots: [cs] }),
    { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() },
  );
  assert.equal(v.failedReason, tierA.REASONS.NON_PRIMARY_SOURCE);
  assert.equal(v.detail.actualSourceKind, 'customer_supplied');
});

test('TA-2: manual source kind fails', async () => {
  const m = { id: 'm', source_kind: 'manual', as_of_iso: new Date(NOW_MS).toISOString() };
  const v = await tierA.evaluate(
    passingInput({ snapshots: [m] }),
    { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() },
  );
  assert.equal(v.failedReason, tierA.REASONS.NON_PRIMARY_SOURCE);
});

// ── TA-3: calculator green-state stamp ────────────────────────────────

test('TA-3: a missing green stamp fails with CALCULATOR_NOT_GREEN', async () => {
  const v = await tierA.evaluate(passingInput(), { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader(null) });
  assert.equal(v.failedReason, tierA.REASONS.CALCULATOR_NOT_GREEN);
  assert.equal(v.detail.calculatorName, 'customs-quote');
  assert.equal(v.detail.lastGreenIso, null);
});

test('TA-3: a green stamp >24h old fails', async () => {
  const stale = new Date(NOW_MS - 25 * 60 * 60 * 1000).toISOString();
  const v = await tierA.evaluate(passingInput(), { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader(stale) });
  assert.equal(v.failedReason, tierA.REASONS.CALCULATOR_NOT_GREEN);
  assert.equal(v.detail.lastGreenIso, stale);
  assert.ok(v.detail.ageHours > 24, `age reported ${v.detail.ageHours} — expected >24`);
});

test('TA-3: a green stamp exactly at 24h boundary passes', async () => {
  // ADR says "≤ 24 hours" — the boundary value should pass.
  const onBoundary = new Date(NOW_MS - 24 * 60 * 60 * 1000).toISOString();
  const v = await tierA.evaluate(passingInput(), { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader(onBoundary) });
  assert.equal(v.eligible, true, '24h-on-the-dot stamp must pass the gate');
});

test('TA-3: a corrupted stamp string fails', async () => {
  const v = await tierA.evaluate(passingInput(), { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader('not-an-iso') });
  assert.equal(v.failedReason, tierA.REASONS.CALCULATOR_NOT_GREEN);
});

// ── TA-4: escalations + overrides ─────────────────────────────────────

test('TA-4: any escalation present fails with ESCALATION_OR_OVERRIDE', async () => {
  const v = await tierA.evaluate(
    passingInput({ escalations: [{ id: 'esc-1', reason: 'cargo-over-20k' }] }),
    { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() },
  );
  assert.equal(v.failedReason, tierA.REASONS.ESCALATION_OR_OVERRIDE);
  assert.equal(v.detail.escalationCount, 1);
  assert.equal(v.detail.overrideCount, 0);
});

test('TA-4: any override present fails', async () => {
  const v = await tierA.evaluate(
    passingInput({ overrides: [{ field: 'duty_rate_pct', from: 0.08, to: 0.05, reason: 'BTI ruling' }] }),
    { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() },
  );
  assert.equal(v.failedReason, tierA.REASONS.ESCALATION_OR_OVERRIDE);
  assert.equal(v.detail.overrideCount, 1);
});

test('TA-4: both arrays empty is the only passing shape', async () => {
  const v = await tierA.evaluate(
    passingInput({ escalations: [], overrides: [] }),
    { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() },
  );
  assert.equal(v.eligible, true);
});

// ── TA-5: coverage envelope ───────────────────────────────────────────

test('TA-5: an HS chapter outside the prefixSet fails with OUTSIDE_COVERAGE', async () => {
  const v = await tierA.evaluate(
    passingInput({ coverageInput: { hsChapter: '6203', originCountry: 'CN', destCountry: 'DE', declaredValueCents: 50_000_00 } }),
    { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() },
  );
  assert.equal(v.failedReason, tierA.REASONS.OUTSIDE_COVERAGE);
  assert.equal(v.detail.axis, 'hsChapter');
});

test('TA-5: an origin country outside the set fails', async () => {
  const v = await tierA.evaluate(
    passingInput({ coverageInput: { hsChapter: '8501', originCountry: 'BD', destCountry: 'DE', declaredValueCents: 50_000_00 } }),
    { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() },
  );
  assert.equal(v.failedReason, tierA.REASONS.OUTSIDE_COVERAGE);
  assert.equal(v.detail.axis, 'originCountry');
});

test('TA-5: a declared value above the integer-range max fails', async () => {
  const v = await tierA.evaluate(
    passingInput({ coverageInput: { hsChapter: '8501', originCountry: 'CN', destCountry: 'DE', declaredValueCents: 50_000_000_00 } }),
    { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() },
  );
  assert.equal(v.failedReason, tierA.REASONS.OUTSIDE_COVERAGE);
  assert.equal(v.detail.axis, 'declaredValueCents');
});

test('TA-5: a missing input axis fails with missing-input-axis', async () => {
  const v = await tierA.evaluate(
    passingInput({ coverageInput: { hsChapter: '8501', originCountry: 'CN', destCountry: 'DE' /* declaredValueCents missing */ } }),
    { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() },
  );
  assert.equal(v.failedReason, tierA.REASONS.OUTSIDE_COVERAGE);
  assert.equal(v.detail.axis, 'declaredValueCents');
  assert.equal(v.detail.reason, 'missing-input-axis');
});

test('TA-5: a calculator without a declared coverage manifest fails', async () => {
  const v = await tierA.evaluate(
    passingInput({ calculatorCoverage: undefined }),
    { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() },
  );
  assert.equal(v.failedReason, tierA.REASONS.OUTSIDE_COVERAGE);
});

// ── First-failure-wins ordering ───────────────────────────────────────

test('order: TA-1 fires before TA-2 when both would fail', async () => {
  const stale = { id: 'old-mirror', source_kind: 'mirror', as_of_iso: new Date(NOW_MS - 40 * ONE_DAY).toISOString() };
  const v = await tierA.evaluate(
    passingInput({ snapshots: [stale] }),
    { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() },
  );
  // Stale (TA-1) is reported before non-primary (TA-2).
  assert.equal(v.failedReason, tierA.REASONS.STALE_SNAPSHOT);
});

test('order: TA-2 fires before TA-3 when both would fail', async () => {
  const v = await tierA.evaluate(
    passingInput({ snapshots: [{ id: 'm', source_kind: 'manual', as_of_iso: new Date(NOW_MS).toISOString() }] }),
    { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader(null) }, // also missing green stamp
  );
  assert.equal(v.failedReason, tierA.REASONS.NON_PRIMARY_SOURCE);
});

// ── Coverage axis matchers (unit-level) ───────────────────────────────

test('coverage: type=all admits everything', () => {
  const m = { calculatorName: 'x', version: 1, axes: { foo: { type: 'all' } } };
  assert.equal(coverage.isWithinCoverage(m, { foo: 'whatever' }).within, true);
  assert.equal(coverage.isWithinCoverage(m, { foo: 12345 }).within, true);
});

test('coverage: type=set is exact-membership', () => {
  const m = { calculatorName: 'x', version: 1, axes: { c: { type: 'set', values: ['DE', 'NL'] } } };
  assert.equal(coverage.isWithinCoverage(m, { c: 'DE' }).within, true);
  const miss = coverage.isWithinCoverage(m, { c: 'FR' });
  assert.equal(miss.within, false);
  assert.equal(miss.reason, 'not-in-set');
});

test('coverage: type=prefixSet matches any declared prefix', () => {
  const m = { calculatorName: 'x', version: 1, axes: { hs: { type: 'prefixSet', values: ['84', '85'] } } };
  assert.equal(coverage.isWithinCoverage(m, { hs: '8501' }).within, true);
  assert.equal(coverage.isWithinCoverage(m, { hs: '8401' }).within, true);
  assert.equal(coverage.isWithinCoverage(m, { hs: '6203' }).within, false);
});

test('coverage: type=range is inclusive on both bounds', () => {
  const m = { calculatorName: 'x', version: 1, axes: { v: { type: 'range', min: 10, max: 20 } } };
  assert.equal(coverage.isWithinCoverage(m, { v: 10 }).within, true);
  assert.equal(coverage.isWithinCoverage(m, { v: 20 }).within, true);
  assert.equal(coverage.isWithinCoverage(m, { v: 9 }).within, false);
  assert.equal(coverage.isWithinCoverage(m, { v: 21 }).within, false);
});

test('coverage: type=integer-range rejects floats', () => {
  const m = { calculatorName: 'x', version: 1, axes: { v: { type: 'integer-range', min: 0, max: 100 } } };
  assert.equal(coverage.isWithinCoverage(m, { v: 50 }).within, true);
  assert.equal(coverage.isWithinCoverage(m, { v: 50.5 }).within, false);
});

test('coverage: malformed manifest surfaces a manifest-axis error', () => {
  const result = coverage.isWithinCoverage(null, { foo: 1 });
  assert.equal(result.within, false);
});

// ── Green-state KV round-trip ─────────────────────────────────────────

test('greenState.stampLastGreenAt → readLastGreenAt round-trips the ISO time', async () => {
  kv._resetMemoryStore();
  const stamp = await greenState.stampLastGreenAt('customs-quote', { nowMs: NOW_MS });
  assert.equal(stamp.ok, true);
  const readBack = await greenState.readLastGreenAt('customs-quote');
  assert.equal(readBack, stamp.iso);
});

test('greenState.readLastGreenAt → null when no stamp exists', async () => {
  kv._resetMemoryStore();
  assert.equal(await greenState.readLastGreenAt('never-stamped'), null);
});

test('greenState.readLastGreenAt → null on a corrupted ISO value', async () => {
  kv._resetMemoryStore();
  await kv.set(greenState._key('customs-quote'), 'definitely-not-iso', { ttlSeconds: 60 });
  assert.equal(await greenState.readLastGreenAt('customs-quote'), null);
});

test('greenState._key sanitises unsafe characters', () => {
  assert.equal(greenState._key('customs-quote'), 'tier-a:green-state:customs-quote');
  assert.equal(greenState._key('weird/name with spaces'), 'tier-a:green-state:weird_name_with_spaces');
});

// ── ADR 0020 ↔ implementation drift guard ─────────────────────────────

test('REASONS strings match the taxonomy named in ADR 0020', () => {
  // If the ADR's failure-reason taxonomy ever changes, this test fails
  // loudly so the implementation drift is caught at the source. Each
  // REASON value must appear verbatim in the ADR file.
  const adrPath = path.join(ROOT, 'docs', 'adr', '0020-tier-a-confidence-definition.md');
  const adrSrc = fs.readFileSync(adrPath, 'utf8');
  for (const [name, value] of Object.entries(tierA.REASONS)) {
    assert.ok(
      adrSrc.includes(value),
      `REASONS.${name} = "${value}" must appear in docs/adr/0020-tier-a-confidence-definition.md (drift between code and the ADR's failure taxonomy)`,
    );
  }
});

test('ADR 0020 constants match the implementation', () => {
  // The ADR fixes specific thresholds. Pin them.
  assert.equal(tierA.SNAPSHOT_MAX_AGE_DAYS, 30, 'ADR 0020 TA-1 fixes snapshot_age_days ≤ 30');
  assert.equal(tierA.GREEN_STATE_MAX_AGE_MS, 24 * 60 * 60 * 1000, 'ADR 0020 TA-3 fixes the green-state window at 24h');
  assert.equal(tierA.PRIMARY_REGULATOR_SOURCE, 'primary_regulator', 'ADR 0020 TA-2 source_kind label');
});

test('REASONS object is frozen — no runtime mutation', () => {
  assert.equal(Object.isFrozen(tierA.REASONS), true);
});

// ── eligibility module preserves backward-compat surface ──────────────

test('public surface exports the documented members', () => {
  assert.equal(typeof tierA.evaluate, 'function');
  assert.equal(typeof tierA.REASONS, 'object');
  assert.equal(typeof tierA.SCHEMA_VERSION, 'number');
  assert.equal(typeof tierA.greenState, 'object');
  assert.equal(typeof tierA.coverage, 'object');
});

// ── Defensive: bad input shapes never throw ───────────────────────────

test('evaluate() with null input returns an OUTSIDE_COVERAGE failure (does not throw)', async () => {
  const v = await eligibility.evaluate(null, { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() });
  assert.equal(v.eligible, false);
  assert.equal(v.failedReason, tierA.REASONS.OUTSIDE_COVERAGE);
});

test('evaluate() with missing calculatorName returns an OUTSIDE_COVERAGE failure', async () => {
  const v = await eligibility.evaluate(
    { snapshots: [freshPrimarySnapshot()] },
    { nowMs: NOW_MS, readLastGreenAt: fakeGreenReader() },
  );
  assert.equal(v.failedReason, tierA.REASONS.OUTSIDE_COVERAGE);
});
