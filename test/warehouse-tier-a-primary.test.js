'use strict';

// Tier-A primary-regulator path tests for warehouse-quote (PR #143).
// Mirrors test/finance-tier-a-primary.test.js (PR #141) and
// test/sourcing-tier-a-primary.test.js (PR #139) — fourth per-
// calculator gate.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const warehouse = require(path.join(ROOT, 'lib', 'intelligence', 'warehouse-quote'));
const tierA = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a'));
const greenState = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a', 'green-state'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));

function sampleSyncQuote() {
  return warehouse.calculateQuote({
    monthlyOrders: 2000,
    avgUnitsPerOrder: 1.8,
    avgLinesPerOrder: 1.4,
    avgPalletsHeld: 40,
    avgOrderWeightKg: 1.2,
    primaryDestination: 'DE',
    valueAddedServices: [],
    returnsRate: 0.05,
    skuCount: 120,
  });
}

// ── calculateQuoteAsync surface ──────────────────────────────────────

test('calculateQuoteAsync is exported and async', () => {
  assert.equal(typeof warehouse.calculateQuoteAsync, 'function');
});

test('Async falls back to sync when no ppiArea supplied', async () => {
  const out = await warehouse.calculateQuoteAsync({
    monthlyOrders: 2000,
    avgUnitsPerOrder: 1.8,
    avgLinesPerOrder: 1.4,
    avgPalletsHeld: 40,
    avgOrderWeightKg: 1.2,
    primaryDestination: 'DE',
  });
  assert.equal(out.ok, true);
  assert.equal(out.livePpiMeta, undefined);
});

test('Async falls back when opts.useEurostat is false', async () => {
  kv._resetMemoryStore();
  const out = await warehouse.calculateQuoteAsync(
    {
      monthlyOrders: 2000, avgUnitsPerOrder: 1.8, avgLinesPerOrder: 1.4,
      avgPalletsHeld: 40, avgOrderWeightKg: 1.2, primaryDestination: 'DE',
    },
    { ppiArea: 'EA20', useEurostat: false },
  );
  assert.equal(out.ok, true);
  assert.equal(out.livePpiMeta, undefined);
});

test('Async falls back when Eurostat returns no data', async () => {
  kv._resetMemoryStore();
  const out = await warehouse.calculateQuoteAsync(
    {
      monthlyOrders: 2000, avgUnitsPerOrder: 1.8, avgLinesPerOrder: 1.4,
      avgPalletsHeld: 40, avgOrderWeightKg: 1.2, primaryDestination: 'DE',
    },
    { ppiArea: 'EA20' },
  );
  assert.equal(out.ok, true);
  assert.equal(out.livePpiMeta, undefined);
});

test('Async attaches livePpiMeta when Eurostat returned data', async () => {
  kv._resetMemoryStore();
  await kv.set('eurostat-warehousing:EA20', {
    area: 'EA20',
    asOfPeriod: '2025-Q4',
    asOf: '2025-10-01T00:00:00.000Z',
    source: 'eurostat-warehousing-ppi',
    nace: 'H52',
    seasonalAdjustment: 'NSA',
    baseYear: 2015,
    indexValue: 132.4,
  });
  const out = await warehouse.calculateQuoteAsync(
    {
      monthlyOrders: 2000, avgUnitsPerOrder: 1.8, avgLinesPerOrder: 1.4,
      avgPalletsHeld: 40, avgOrderWeightKg: 1.2, primaryDestination: 'DE',
    },
    { ppiArea: 'EA20' },
  );
  assert.equal(out.ok, true);
  assert.ok(out.livePpiMeta);
  assert.equal(out.livePpiMeta.source, 'eurostat-warehousing-ppi');
  assert.equal(out.livePpiMeta.area, 'EA20');
  assert.equal(out.livePpiMeta.asOfPeriod, '2025-Q4');
  assert.equal(out.livePpiMeta.nace, 'H52');
  assert.equal(out.livePpiMeta.indexValue, 132.4);
  assert.match(out.livePpiMeta.verifyUrl, /ec\.europa\.eu\/eurostat/);
});

// ── buildTierAInput primary-source path ──────────────────────────────

test('buildTierAInput on a sync quote emits the mirror snapshot honestly', () => {
  const quote = sampleSyncQuote();
  const ta = warehouse.buildTierAInput(quote);
  assert.equal(ta.snapshots.length, 1);
  assert.equal(ta.snapshots[0].source_kind, 'mirror');
});

test('buildTierAInput on a quote with livePpiMeta OMITS the rate-card mirror (PR #132 pattern)', () => {
  const quote = sampleSyncQuote();
  quote.livePpiMeta = {
    area: 'EA20',
    asOfPeriod: '2025-Q4',
    asOf: '2025-10-01T00:00:00.000Z',
    source: 'eurostat-warehousing-ppi',
    nace: 'H52',
    seasonalAdjustment: 'NSA',
    baseYear: 2015,
    indexValue: 132.4,
    fromCache: false,
    stale: false,
  };
  const ta = warehouse.buildTierAInput(quote);
  assert.equal(ta.snapshots.length, 1);
  assert.equal(ta.snapshots[0].source_kind, 'primary_regulator');
  assert.equal(ta.snapshots[0].id, 'eurostat-warehousing-ppi:EA20@2025-Q4');
});

test('buildTierAInput preserves monthlyOrders in coverageInput (no regression)', () => {
  const quote = sampleSyncQuote();
  const ta = warehouse.buildTierAInput(quote);
  assert.equal(ta.coverageInput.monthlyOrders, 2000);
});

// ── End-to-end ──────────────────────────────────────────────────────

test('end-to-end sync: TA-2 fails with NON_PRIMARY_SOURCE', async () => {
  kv._resetMemoryStore();
  const nowMs = Date.parse('2026-05-15T12:00:00.000Z'); // within 30 days of PRICING_SNAPSHOT.asOf
  await greenState.stampLastGreenAt('warehouse-quote', { nowMs });
  const quote = sampleSyncQuote();
  const ta = warehouse.buildTierAInput(quote);
  const verdict = await tierA.evaluate(ta, { nowMs });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.failedReason, tierA.REASONS.NON_PRIMARY_SOURCE);
});

test('end-to-end primary: quote with livePpiMeta → eligible:true', async () => {
  kv._resetMemoryStore();
  // Pick a nowMs within 30 days of the 2025-Q4 snapshot start (2025-10-01).
  const nowMs = Date.parse('2025-10-25T12:00:00.000Z');
  await greenState.stampLastGreenAt('warehouse-quote', { nowMs });
  const quote = sampleSyncQuote();
  quote.livePpiMeta = {
    area: 'EA20',
    asOfPeriod: '2025-Q4',
    asOf: '2025-10-01T00:00:00.000Z',
    source: 'eurostat-warehousing-ppi',
    nace: 'H52',
    seasonalAdjustment: 'NSA',
    baseYear: 2015,
    indexValue: 132.4,
    fromCache: true,
    stale: false,
  };
  const ta = warehouse.buildTierAInput(quote);
  const verdict = await tierA.evaluate(ta, { nowMs });
  assert.equal(verdict.eligible, true,
    `expected eligible:true; got: ${JSON.stringify(verdict)}`);
});
