'use strict';

// Tier-A primary-regulator path tests for routing-quote (PR #145).
// Mirrors warehouse-tier-a-primary.test.js (PR #143) — fifth and
// final per-calculator gate.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const routing = require(path.join(ROOT, 'lib', 'intelligence', 'routing-quote'));
const tierA = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a'));
const greenState = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a', 'green-state'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));

function sampleSyncQuote() {
  return routing.calculateQuote({
    weightKg: 800,
    volumeCbm: 4,
    originCountry: 'CN',
    destinationCountry: 'DE',
    urgencyDays: 35,
  });
}

// ── calculateQuoteAsync surface ──────────────────────────────────────

test('calculateQuoteAsync is exported and async', () => {
  assert.equal(typeof routing.calculateQuoteAsync, 'function');
});

test('Async falls back to sync when no freightArea supplied', async () => {
  const out = await routing.calculateQuoteAsync({
    weightKg: 800, volumeCbm: 4, originCountry: 'CN', destinationCountry: 'DE',
  });
  assert.equal(out.ok, true);
  assert.equal(out.liveFreightMeta, undefined);
});

test('Async falls back when opts.useEurostat is false', async () => {
  kv._resetMemoryStore();
  const out = await routing.calculateQuoteAsync(
    { weightKg: 800, volumeCbm: 4, originCountry: 'CN', destinationCountry: 'DE' },
    { freightArea: 'EU27_2020', useEurostat: false },
  );
  assert.equal(out.ok, true);
  assert.equal(out.liveFreightMeta, undefined);
});

test('Async falls back when Eurostat returns no data', async () => {
  kv._resetMemoryStore();
  const out = await routing.calculateQuoteAsync(
    { weightKg: 800, volumeCbm: 4, originCountry: 'CN', destinationCountry: 'DE' },
    { freightArea: 'EU27_2020' },
  );
  assert.equal(out.ok, true);
  assert.equal(out.liveFreightMeta, undefined);
});

test('Async attaches liveFreightMeta when Eurostat returned data', async () => {
  kv._resetMemoryStore();
  await kv.set('eurostat-freight:EU27_2020', {
    area: 'EU27_2020',
    asOfPeriod: '2025-Q4',
    asOf: '2025-10-01T00:00:00.000Z',
    source: 'eurostat-freight-ppi',
    nace: 'H50',
    seasonalAdjustment: 'NSA',
    baseYear: 2015,
    indexValue: 145.8,
  });
  const out = await routing.calculateQuoteAsync(
    { weightKg: 800, volumeCbm: 4, originCountry: 'CN', destinationCountry: 'DE' },
    { freightArea: 'EU27_2020' },
  );
  assert.equal(out.ok, true);
  assert.ok(out.liveFreightMeta);
  assert.equal(out.liveFreightMeta.source, 'eurostat-freight-ppi');
  assert.equal(out.liveFreightMeta.area, 'EU27_2020');
  assert.equal(out.liveFreightMeta.asOfPeriod, '2025-Q4');
  assert.equal(out.liveFreightMeta.nace, 'H50');
  assert.equal(out.liveFreightMeta.indexValue, 145.8);
  assert.match(out.liveFreightMeta.verifyUrl, /ec\.europa\.eu\/eurostat/);
});

// ── buildTierAInput primary-source path ──────────────────────────────

test('buildTierAInput on a sync quote emits the mirror snapshot honestly', () => {
  const quote = sampleSyncQuote();
  const ta = routing.buildTierAInput(quote);
  assert.equal(ta.snapshots.length, 1);
  assert.equal(ta.snapshots[0].source_kind, 'mirror');
});

test('buildTierAInput on a quote with liveFreightMeta OMITS the mirror', () => {
  const quote = sampleSyncQuote();
  quote.liveFreightMeta = {
    area: 'EU27_2020',
    asOfPeriod: '2025-Q4',
    asOf: '2025-10-01T00:00:00.000Z',
    source: 'eurostat-freight-ppi',
    nace: 'H50',
    seasonalAdjustment: 'NSA',
    baseYear: 2015,
    indexValue: 145.8,
    fromCache: false,
    stale: false,
  };
  const ta = routing.buildTierAInput(quote);
  assert.equal(ta.snapshots.length, 1);
  assert.equal(ta.snapshots[0].source_kind, 'primary_regulator');
  assert.equal(ta.snapshots[0].id, 'eurostat-freight-ppi:EU27_2020@2025-Q4');
  assert.equal(ta.snapshots[0].freshness_days, 120,
    'quarterly Eurostat snapshot must carry the 120-day freshness override');
});

test('buildTierAInput preserves weightKg in coverageInput (no regression)', () => {
  const quote = sampleSyncQuote();
  const ta = routing.buildTierAInput(quote);
  assert.equal(ta.coverageInput.weightKg, 800);
});

// ── End-to-end ──────────────────────────────────────────────────────

test('end-to-end sync: TA-2 fails with NON_PRIMARY_SOURCE', async () => {
  kv._resetMemoryStore();
  // routing-quote's PRICING_SNAPSHOT.asOf is 2026-04-15; pick a nowMs
  // within 30 days so TA-1 passes and TA-2 (NON_PRIMARY_SOURCE) fires.
  const nowMs = Date.parse('2026-04-25T12:00:00.000Z');
  await greenState.stampLastGreenAt('routing-quote', { nowMs });
  const quote = sampleSyncQuote();
  const ta = routing.buildTierAInput(quote);
  const verdict = await tierA.evaluate(ta, { nowMs });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.failedReason, tierA.REASONS.NON_PRIMARY_SOURCE);
});

test('end-to-end primary: quote with liveFreightMeta → eligible:true', async () => {
  kv._resetMemoryStore();
  // Pick a nowMs within 120 days of the 2025-Q4 snapshot start (2025-10-01).
  const nowMs = Date.parse('2025-12-15T12:00:00.000Z');
  await greenState.stampLastGreenAt('routing-quote', { nowMs });
  const quote = sampleSyncQuote();
  quote.liveFreightMeta = {
    area: 'EU27_2020',
    asOfPeriod: '2025-Q4',
    asOf: '2025-10-01T00:00:00.000Z',
    source: 'eurostat-freight-ppi',
    nace: 'H50',
    seasonalAdjustment: 'NSA',
    baseYear: 2015,
    indexValue: 145.8,
    fromCache: true,
    stale: false,
  };
  const ta = routing.buildTierAInput(quote);
  const verdict = await tierA.evaluate(ta, { nowMs });
  assert.equal(verdict.eligible, true,
    `expected eligible:true; got: ${JSON.stringify(verdict)}`);
});
