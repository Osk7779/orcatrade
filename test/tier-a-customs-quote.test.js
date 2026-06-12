'use strict';

// Tier-A wire-up tests for the customs-quote calculator.
//
// Pins the integration contract:
//   - COVERAGE manifest stays in parity with HS_CHAPTER_DUTY + EU_VAT
//   - buildTierAInput() emits the documented snapshot source_kind for
//     each rate-card source (mirror for PRICING_SNAPSHOT, primary_regulator
//     for TARIC liveRateMeta)
//   - End-to-end: a passing sync quote → buildTierAInput → evaluate()
//     fails TA-2 (mirror source); with a synthetic live snapshot AND
//     a stamped green-state, the same quote passes Tier-A
//   - The stamp script's calculator list includes customs-quote
//
// Together these tests prove the contract: customs-quote outputs are
// classifiable today, and the only path to eligibility is the
// async live-TARIC code path — exactly as ADR 0020 prescribes.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const customs = require(path.join(ROOT, 'lib', 'intelligence', 'customs-quote'));
const tierA = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a'));
const greenState = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a', 'green-state'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));
const stampScript = require(path.join(ROOT, 'scripts', 'tier-a-stamp'));

// ── COVERAGE manifest parity ──────────────────────────────────────────

test('TIER_A_COVERAGE.hsChapter.values contains every key of HS_CHAPTER_DUTY', () => {
  const declared = new Set(customs.TIER_A_COVERAGE.axes.hsChapter.values);
  const actual = new Set(Object.keys(customs.HS_CHAPTER_DUTY));
  for (const k of actual) {
    assert.ok(declared.has(k), `HS chapter "${k}" in HS_CHAPTER_DUTY but missing from TIER_A_COVERAGE.hsChapter`);
  }
  // Inverse: no orphan in COVERAGE that isn't in the duty table.
  for (const k of declared) {
    assert.ok(actual.has(k), `HS chapter "${k}" declared in COVERAGE but missing from HS_CHAPTER_DUTY`);
  }
});

test('TIER_A_COVERAGE.destinationCountry.values matches Object.keys(EU_VAT)', () => {
  const declared = new Set(customs.TIER_A_COVERAGE.axes.destinationCountry.values);
  const actual = new Set(Object.keys(customs.EU_VAT));
  for (const k of actual) {
    assert.ok(declared.has(k), `EU country "${k}" in EU_VAT but missing from TIER_A_COVERAGE.destinationCountry`);
  }
  for (const k of declared) {
    assert.ok(actual.has(k), `EU country "${k}" declared in COVERAGE but missing from EU_VAT`);
  }
});

test('TIER_A_COVERAGE.calculatorName === "customs-quote"', () => {
  assert.equal(customs.TIER_A_COVERAGE.calculatorName, 'customs-quote');
});

test('TIER_A_COVERAGE is frozen — cannot be mutated at runtime', () => {
  assert.equal(Object.isFrozen(customs.TIER_A_COVERAGE), true);
  assert.equal(Object.isFrozen(customs.TIER_A_COVERAGE.axes), true);
});

// ── buildTierAInput snapshot shape ────────────────────────────────────

function sampleSyncQuote() {
  // Pick inputs that pass validation: HS chapter 85 (electrical), DE
  // destination, modest customs value.
  return customs.calculateQuote({
    customsValueEur: 50_000,
    hsCode: '8501',
    destinationCountry: 'DE',
    originCountry: 'CN',
    linesCount: 3,
  });
}

test('buildTierAInput on a sync quote emits a mirror snapshot from PRICING_SNAPSHOT', () => {
  const quote = sampleSyncQuote();
  assert.equal(quote.ok, true);
  const ta = customs.buildTierAInput(quote);
  assert.equal(ta.calculatorName, 'customs-quote');
  assert.ok(Array.isArray(ta.snapshots) && ta.snapshots.length >= 1);
  const mirror = ta.snapshots.find((s) => s.source_kind === 'mirror');
  assert.ok(mirror, 'expected at least one mirror snapshot from PRICING_SNAPSHOT');
  assert.ok(mirror.id.startsWith('customs-quote:pricing@'), `mirror snapshot id should be tagged: got ${mirror.id}`);
  // PRICING_SNAPSHOT.asOf is 'YYYY-MM-DD' — must be normalised to ISO.
  assert.match(mirror.as_of_iso, /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
});

test('buildTierAInput on a quote with liveRateMeta emits a primary_regulator snapshot', () => {
  // Synthesise a quote-shaped object with the liveRateMeta block the
  // async code path attaches. We don't have to actually call TARIC.
  const quote = sampleSyncQuote();
  quote.duty.liveRateMeta = {
    source: 'taric-live',
    sourceLabel: 'EU TARIC live API',
    asOf: '2026-06-08T11:00:00.000Z',
    fromCache: false,
    stale: false,
    rate: 0.025,
  };
  const ta = customs.buildTierAInput(quote);
  const primary = ta.snapshots.find((s) => s.source_kind === 'primary_regulator');
  assert.ok(primary, 'expected a primary_regulator snapshot when liveRateMeta is present');
  assert.equal(primary.as_of_iso, '2026-06-08T11:00:00.000Z');
  assert.ok(primary.id.includes('8501'), `primary snapshot id should reference the HS code: got ${primary.id}`);
});

// ── PR #132: liveRateMeta drops the mirror snapshot ──────────────────

test('buildTierAInput on a quote with liveRateMeta OMITS the rate-card mirror (PR #132 primary-source gate)', () => {
  // The TA-2 check (every snapshot must be source_kind:'primary_
  // regulator') fails as soon as ANY snapshot is a mirror. Before
  // PR #132 the rate-card mirror was always emitted alongside the
  // primary, blocking every eligible:true verdict in production.
  //
  // The fix: when liveRateMeta is present, the mirror snapshot is
  // operationally redundant (the primary overrode it via
  // mfnRateOverride in calculateQuoteAsync), so drop it. The
  // snapshot list contains exactly ONE entry, source_kind:
  // 'primary_regulator'.
  const quote = sampleSyncQuote();
  quote.duty.liveRateMeta = {
    source: 'taric-live',
    sourceLabel: 'EU TARIC live API',
    asOf: '2026-06-08T11:00:00.000Z',
    fromCache: false,
    stale: false,
    rate: 0.025,
  };
  const ta = customs.buildTierAInput(quote);
  assert.equal(ta.snapshots.length, 1,
    `expected exactly 1 snapshot when liveRateMeta is present (PR #132); got ${ta.snapshots.length}: ${JSON.stringify(ta.snapshots)}`);
  assert.equal(ta.snapshots[0].source_kind, 'primary_regulator');
  const mirror = ta.snapshots.find((s) => s.source_kind === 'mirror');
  assert.equal(mirror, undefined, 'mirror snapshot must NOT appear alongside the primary_regulator snapshot');
});

test('buildTierAInput on a sync quote (no liveRateMeta) still emits the mirror snapshot honestly (no PR #132 regression)', () => {
  // Conservative posture: when there's no primary, declare the
  // mirror explicitly so TA-2 fails honestly. Don't paper over
  // the mirror-only path by emitting an empty snapshots array
  // (which would fail TA-1 instead — wrong failure reason).
  const quote = sampleSyncQuote();
  // Explicitly NO liveRateMeta on the duty block.
  assert.equal(quote.duty && quote.duty.liveRateMeta, undefined);
  const ta = customs.buildTierAInput(quote);
  assert.equal(ta.snapshots.length, 1);
  assert.equal(ta.snapshots[0].source_kind, 'mirror');
});

test('end-to-end: quote with liveRateMeta → buildTierAInput → evaluate() → eligible:true (no manual snapshot fix-up)', async () => {
  // This is the contract PR #132 promises in production: a quote
  // backed by a successful live TARIC call, evaluated within 30
  // days of the snapshot, with TA-3 green-stamped, lands
  // eligible:true WITHOUT any manual snapshot manipulation in the
  // caller. Pre-PR #132 this test would have failed on TA-2 even
  // with the green stamp.
  kv._resetMemoryStore();
  const nowNearSnapshot = Date.parse('2026-05-15T12:00:00.000Z');
  await greenState.stampLastGreenAt('customs-quote', { nowMs: nowNearSnapshot });
  const quote = sampleSyncQuote();
  quote.duty.liveRateMeta = {
    source: 'taric-live',
    sourceLabel: 'EU TARIC live API',
    asOf: '2026-05-14T00:00:00.000Z',
    fromCache: false,
    stale: false,
    rate: 0.025,
  };
  const ta = customs.buildTierAInput(quote);
  const verdict = await tierA.evaluate(ta, { nowMs: nowNearSnapshot });
  assert.equal(verdict.eligible, true,
    `expected eligible:true on the production code path; got: ${JSON.stringify(verdict)}`);
});

test('buildTierAInput on a failed quote returns a well-shaped (but empty-snapshots) input', () => {
  const ta = customs.buildTierAInput({ ok: false, errors: ['something'] });
  assert.equal(ta.calculatorName, 'customs-quote');
  assert.deepEqual(ta.snapshots, []);
  assert.deepEqual(ta.escalations, []);
  assert.deepEqual(ta.overrides, []);
  assert.equal(ta.calculatorCoverage, customs.TIER_A_COVERAGE);
});

test('buildTierAInput coverageInput surfaces hsChapter + destinationCountry + declaredValueCents', () => {
  const quote = sampleSyncQuote();
  const ta = customs.buildTierAInput(quote);
  assert.equal(ta.coverageInput.hsChapter, '85');
  assert.equal(ta.coverageInput.destinationCountry, 'DE');
  assert.equal(ta.coverageInput.declaredValueCents, 50_000 * 100);
});

// ── End-to-end through tierA.evaluate ─────────────────────────────────

const NOW_MS = Date.parse('2026-06-08T12:00:00.000Z');

test('sync quote → buildTierAInput → evaluate() fails TA-2 (mirror source only)', async () => {
  // Stamp green-state so TA-3 passes — isolates the failure to TA-2.
  kv._resetMemoryStore();
  await greenState.stampLastGreenAt('customs-quote', { nowMs: NOW_MS });
  // Need a PRICING_SNAPSHOT.asOf within 30 days of NOW_MS for TA-1 to pass.
  // PRICING_SNAPSHOT.asOf is '2026-05-07' → 32 days before NOW_MS, so TA-1
  // would actually fail first. That's a real consequence of a stale rate
  // card — for THIS test we want to isolate TA-2, so fast-forward "now"
  // to within 30 days of the snapshot date.
  const nowNearSnapshot = Date.parse('2026-05-15T12:00:00.000Z');
  await greenState.stampLastGreenAt('customs-quote', { nowMs: nowNearSnapshot });
  const quote = sampleSyncQuote();
  const ta = customs.buildTierAInput(quote);
  const verdict = await tierA.evaluate(ta, { nowMs: nowNearSnapshot });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.failedReason, tierA.REASONS.NON_PRIMARY_SOURCE);
});

test('sync quote → mirror snapshot replaced with primary_regulator → eligible:true (when all TA-N pass)', async () => {
  kv._resetMemoryStore();
  const nowNearSnapshot = Date.parse('2026-05-15T12:00:00.000Z');
  await greenState.stampLastGreenAt('customs-quote', { nowMs: nowNearSnapshot });
  const quote = sampleSyncQuote();
  const ta = customs.buildTierAInput(quote);
  // Replace the mirror snapshot with a primary_regulator one to prove
  // the contract end-to-end (in real production, the async code path's
  // liveRateMeta supplies this).
  ta.snapshots = [{
    id: 'taric-live:8501@2026-05-14',
    source_kind: 'primary_regulator',
    as_of_iso: '2026-05-14T00:00:00.000Z',
  }];
  const verdict = await tierA.evaluate(ta, { nowMs: nowNearSnapshot });
  assert.equal(verdict.eligible, true, `expected eligible:true, got: ${JSON.stringify(verdict)}`);
});

test('out-of-coverage HS chapter (not in HS_CHAPTER_DUTY) fails TA-5', async () => {
  kv._resetMemoryStore();
  const nowNearSnapshot = Date.parse('2026-05-15T12:00:00.000Z');
  await greenState.stampLastGreenAt('customs-quote', { nowMs: nowNearSnapshot });
  // calculateQuote rejects unknown HS chapters at validation, so we
  // hand-build a quote-shaped input that *would* be in coverage in every
  // axis except hsChapter, and verify TA-5 fires.
  const ta = customs.buildTierAInput({
    ok: true,
    inputs: { hsChapter: '99', destinationCountry: 'DE', customsValueEur: 1000 },
    duty: { liveRateMeta: { source: 'taric-live', sourceLabel: 'x', asOf: '2026-05-14T00:00:00.000Z', rate: 0 } },
  });
  // Strip the mirror snapshot so TA-2 passes (otherwise it fires before TA-5)
  // — same shape calculateQuoteAsync produces in production when TARIC live
  // provides the authoritative number and we don't want to count the rate-card
  // mirror against TA-2.
  ta.snapshots = ta.snapshots.filter((s) => s.source_kind === 'primary_regulator');
  const verdict = await tierA.evaluate(ta, { nowMs: nowNearSnapshot });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.failedReason, tierA.REASONS.OUTSIDE_COVERAGE);
  assert.equal(verdict.detail.axis, 'hsChapter');
});

// ── Stamp script ──────────────────────────────────────────────────────

test('tier-a-stamp script lists customs-quote', () => {
  assert.ok(
    stampScript.CALCULATORS.includes('customs-quote'),
    'scripts/tier-a-stamp.js CALCULATORS must include "customs-quote" so its TA-3 stamp gets written',
  );
});

test('tier-a-stamp script returns 0 (no-op) when KV is not configured', async () => {
  // In the test environment, no KV_REST_API_URL / KV_REST_API_TOKEN are
  // set, so kv.isConfigured() returns false. The script must exit 0
  // (no-op) rather than fail — this keeps the CI workflow green before
  // KV secrets are wired in repo settings.
  kv._resetMemoryStore();
  const prevUrl = process.env.KV_REST_API_URL;
  const prevTok = process.env.KV_REST_API_TOKEN;
  const prevUpUrl = process.env.UPSTASH_REDIS_REST_URL;
  const prevUpTok = process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    const exitCode = await stampScript.main();
    assert.equal(exitCode, 0, 'no-op path must exit 0');
    // Nothing should have been stamped (script no-op'd before calling greenState).
    const stamp = await greenState.readLastGreenAt('customs-quote');
    assert.equal(stamp, null, 'no-op path must not write any stamp');
  } finally {
    if (prevUrl !== undefined) process.env.KV_REST_API_URL = prevUrl;
    if (prevTok !== undefined) process.env.KV_REST_API_TOKEN = prevTok;
    if (prevUpUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = prevUpUrl;
    if (prevUpTok !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = prevUpTok;
  }
});

test('greenState.stampLastGreenAt directly stamps every CALCULATORS entry (end-to-end with in-memory KV)', async () => {
  // The script's stamping logic gates on isConfigured() — but the
  // underlying greenState API works against either backend. This test
  // bypasses the env gate and proves the per-calculator stamp path
  // produces a readable round-trip for every CALCULATORS entry.
  kv._resetMemoryStore();
  for (const name of stampScript.CALCULATORS) {
    const stamp = await greenState.stampLastGreenAt(name);
    assert.equal(stamp.ok, true, `stamp for ${name} must succeed`);
    const readBack = await greenState.readLastGreenAt(name);
    assert.equal(readBack, stamp.iso, `read-back for ${name} must match the stamp`);
  }
});
