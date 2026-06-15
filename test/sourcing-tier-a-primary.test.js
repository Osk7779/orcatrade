'use strict';

// Tier-A primary-regulator path tests for sourcing-quote (PR #139).
// Mirrors test/tier-a-customs-quote.test.js's "PR #132 primary-source
// gate" section. Closes the second per-calculator primary-source gate
// — sourcing-quote now flips eligible:true when backed by UN Comtrade
// data.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const sourcing = require(path.join(ROOT, 'lib', 'intelligence', 'sourcing-quote'));
const tierA = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a'));
const greenState = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a', 'green-state'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));

function sampleSyncQuote() {
  return sourcing.recommendCountry({
    productCategory: 'apparel',
    targetFobUnitEur: 12,
    moq: 1000,
    urgencyWeeks: 16,
    costPriority: 'balanced',
  });
}

// ── recommendCountryAsync surface ────────────────────────────────────

test('recommendCountryAsync is exported and async', () => {
  assert.equal(typeof sourcing.recommendCountryAsync, 'function');
});

test('recommendCountryAsync falls back to sync recommendCountry when no HS code', async () => {
  // Category-only sourcing queries (no hsCode) don't get a Comtrade
  // path — the calculator can't query trade flows without a
  // commodity. The fallback preserves backward compatibility.
  const out = await sourcing.recommendCountryAsync({
    productCategory: 'apparel',
    targetFobUnitEur: 12,
    moq: 1000,
    urgencyWeeks: 16,
  });
  assert.equal(out.ok, true);
  assert.equal(out.tradeFlowMeta, undefined);
});

test('recommendCountryAsync falls back when opts.useComtrade is false (opt-out path)', async () => {
  kv._resetMemoryStore();
  const out = await sourcing.recommendCountryAsync(
    { productCategory: 'apparel', hsCode: '620342', targetFobUnitEur: 12, moq: 1000, urgencyWeeks: 16 },
    { useComtrade: false, period: '2024' },
  );
  assert.equal(out.ok, true);
  assert.equal(out.tradeFlowMeta, undefined);
});

test('recommendCountryAsync falls back when opts.period is missing (calculator deterministic)', async () => {
  // The calculator must not read the clock (see
  // test/calculator-determinism.test.js). The caller (start.js or
  // test) supplies period; if absent, async path falls back to
  // sync without surfacing tradeFlowMeta.
  kv._resetMemoryStore();
  const out = await sourcing.recommendCountryAsync({
    productCategory: 'apparel',
    hsCode: '620342',
    targetFobUnitEur: 12,
    moq: 1000,
    urgencyWeeks: 16,
  });
  assert.equal(out.ok, true);
  assert.equal(out.tradeFlowMeta, undefined);
});

test('recommendCountryAsync falls back when Comtrade returns no data', async () => {
  // No fresh cache + ORCATRADE_DISABLE_LIVE_TARIC=1 (set for the
  // test suite) → comtrade.lookupTopExporters returns null →
  // tradeFlowMeta absent.
  kv._resetMemoryStore();
  const out = await sourcing.recommendCountryAsync({
    productCategory: 'apparel',
    hsCode: '620342',
    targetFobUnitEur: 12,
    moq: 1000,
    urgencyWeeks: 16,
  }, { period: '2024' });
  assert.equal(out.ok, true);
  assert.equal(out.tradeFlowMeta, undefined);
});

test('recommendCountryAsync attaches tradeFlowMeta when Comtrade returned data', async () => {
  // Seed the KV cache with a Comtrade-shaped snapshot for a fixed
  // period. The calculator stays deterministic; the caller supplies
  // the period.
  kv._resetMemoryStore();
  const period = '2024';
  const snapshot = {
    hs: '620342',
    period,
    asOf: `${period}-12-31T23:59:59.999Z`,
    source: 'un-comtrade',
    reporters: [
      { reporterCode: '156', reporterIso: 'CHN', reporterDesc: 'China', tradeValueUsd: 1_000_000 },
      { reporterCode: '704', reporterIso: 'VNM', reporterDesc: 'Vietnam', tradeValueUsd: 500_000 },
    ],
  };
  await kv.set(`comtrade:flows:620342:${period}`, snapshot);

  const out = await sourcing.recommendCountryAsync({
    productCategory: 'apparel',
    hsCode: '620342',
    targetFobUnitEur: 12,
    moq: 1000,
    urgencyWeeks: 16,
  }, { period });
  assert.equal(out.ok, true);
  assert.ok(out.tradeFlowMeta, 'tradeFlowMeta must be attached when Comtrade returned data');
  assert.equal(out.tradeFlowMeta.source, 'un-comtrade');
  assert.equal(out.tradeFlowMeta.hs, '620342');
  assert.equal(out.tradeFlowMeta.period, period);
  assert.equal(out.tradeFlowMeta.topExporterCount, 2);
  assert.equal(out.tradeFlowMeta.fromCache, true);
  assert.equal(out.tradeFlowMeta.stale, false);
  assert.match(out.tradeFlowMeta.verifyUrl, /https:\/\/comtradeplus\.un\.org/);
});

// ── buildTierAInput primary-source path ──────────────────────────────

test('buildTierAInput on a sync quote (no tradeFlowMeta) emits the mirror snapshot honestly', () => {
  // Conservative posture: when there's no primary, declare the
  // mirror explicitly so TA-2 fails with NON_PRIMARY_SOURCE rather
  // than an empty-snapshots failure (which would yield STALE_SNAPSHOT
  // instead — wrong reason). Same invariant as PR #132 customs.
  const quote = sampleSyncQuote();
  const ta = sourcing.buildTierAInput(quote);
  assert.equal(ta.snapshots.length, 1);
  assert.equal(ta.snapshots[0].source_kind, 'mirror');
  assert.ok(ta.snapshots[0].id.startsWith('sourcing-quote:pricing@'));
});

test('buildTierAInput on a quote with tradeFlowMeta OMITS the rate-card mirror (PR #132/#139 primary-source gate)', () => {
  // Drops the mirror when the primary regulator is present.
  // TA-2 fails as soon as ANY snapshot is non-primary, so emitting
  // both would block the eligibility flip — same rationale as PR
  // #132 documented for customs-quote.
  const quote = sampleSyncQuote();
  quote.tradeFlowMeta = {
    hs: '620342',
    period: '2024',
    asOf: '2024-12-31T23:59:59.999Z',
    source: 'un-comtrade',
    fromCache: false,
    stale: false,
    topExporterCount: 5,
  };
  const ta = sourcing.buildTierAInput(quote);
  assert.equal(ta.snapshots.length, 1,
    `expected exactly 1 snapshot when tradeFlowMeta is present; got ${ta.snapshots.length}: ${JSON.stringify(ta.snapshots)}`);
  assert.equal(ta.snapshots[0].source_kind, 'primary_regulator');
  // Snapshot id encodes the HS6 + period for audit traceability.
  assert.equal(ta.snapshots[0].id, 'comtrade-flow:620342@2024');
  // Mirror must NOT appear alongside the primary.
  const mirror = ta.snapshots.find((s) => s.source_kind === 'mirror');
  assert.equal(mirror, undefined);
});

test('buildTierAInput preserves productCategory in coverageInput (no regression)', () => {
  // PR #99's coverage axis still flows through unchanged.
  const quote = sampleSyncQuote();
  const ta = sourcing.buildTierAInput(quote);
  assert.equal(ta.coverageInput.productCategory, 'apparel');
});

// ── End-to-end through tierA.evaluate ──────────────────────────────

test('quote → buildTierAInput → evaluate() fails TA-2 (mirror source only) on the sync path', async () => {
  // Confirms the rate-card-only path still fails Tier-A — operators
  // running a category-only sourcing query don't accidentally get a
  // "Tier-A" badge.
  //
  // sourcing-quote PRICING_SNAPSHOT.asOf is '2026-05-07'. Anchor
  // "now" within the 30-day TA-1 freshness window so the verdict
  // fails on TA-2 (the source-kind we want to test), not TA-1.
  kv._resetMemoryStore();
  const nowMs = Date.parse('2026-05-20T12:00:00.000Z');
  await greenState.stampLastGreenAt('sourcing-quote', { nowMs });
  const quote = sampleSyncQuote();
  const ta = sourcing.buildTierAInput(quote);
  const verdict = await tierA.evaluate(ta, { nowMs });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.failedReason, tierA.REASONS.NON_PRIMARY_SOURCE);
});

test('end-to-end: quote with tradeFlowMeta → buildTierAInput → evaluate() → eligible:true', async () => {
  // The contract PR #139 promises in production: a sourcing
  // recommendation backed by a Comtrade trade-flow snapshot,
  // evaluated within 30 days of the snapshot's period boundary,
  // with TA-3 green-stamped, lands eligible:true.
  //
  // Pre-PR #139 this would have failed on TA-2 even with the green
  // stamp because the mirror snapshot was always emitted.
  kv._resetMemoryStore();
  // Choose a "now" within 30 days of the snapshot's asOf so TA-1
  // (freshness) passes. snapshot is 2024-12-31; now is 2025-01-15.
  const nowMs = Date.parse('2025-01-15T12:00:00.000Z');
  await greenState.stampLastGreenAt('sourcing-quote', { nowMs });
  const quote = sampleSyncQuote();
  quote.tradeFlowMeta = {
    hs: '620342',
    period: '2024',
    asOf: '2024-12-31T23:59:59.999Z',
    source: 'un-comtrade',
    fromCache: true,
    stale: false,
    topExporterCount: 8,
  };
  const ta = sourcing.buildTierAInput(quote);
  const verdict = await tierA.evaluate(ta, { nowMs });
  assert.equal(verdict.eligible, true,
    `expected eligible:true on the production code path; got: ${JSON.stringify(verdict)}`);
});
