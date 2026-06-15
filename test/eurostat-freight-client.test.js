'use strict';

// Tests for lib/intelligence/eurostat-freight-client.js — the
// Eurostat water-transport-PPI (NACE H50) primary-regulator source
// backing routing-quote's Tier-A path (PR #145).
//
// Hermetic: ORCATRADE_DISABLE_LIVE_TARIC=1 (set in npm test) also
// disables live Eurostat fetches via a parallel kill switch.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const freight = require(path.join(ROOT, 'lib', 'intelligence', 'eurostat-freight-client'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));

// ── Normalisation ────────────────────────────────────────────────────

test('normaliseArea accepts ISO-2 country codes (case-insensitive)', () => {
  assert.equal(freight.normaliseArea('DE'), 'DE');
  assert.equal(freight.normaliseArea('nl'), 'NL');
});

test('normaliseArea accepts Eurostat aggregate codes', () => {
  assert.equal(freight.normaliseArea('EU27_2020'), 'EU27_2020');
  assert.equal(freight.normaliseArea('EA20'), 'EA20');
});

test('normaliseArea rejects malformed inputs', () => {
  assert.equal(freight.normaliseArea(''), null);
  assert.equal(freight.normaliseArea(null), null);
  assert.equal(freight.normaliseArea('!!!'), null);
});

// ── Response parsing ────────────────────────────────────────────────

test('parseUpstreamResponse extracts the most recent observation', () => {
  const body = {
    value: { '0': 138.1, '1': 141.5, '2': 145.8 },
    dimension: {
      time: {
        category: {
          index: { '2025-Q2': 0, '2025-Q3': 1, '2025-Q4': 2 },
        },
      },
    },
  };
  const out = freight.parseUpstreamResponse(body, { area: 'EU27_2020' });
  assert.ok(out);
  assert.equal(out.area, 'EU27_2020');
  assert.equal(out.asOfPeriod, '2025-Q4');
  assert.equal(out.asOf, '2025-10-01T00:00:00.000Z');
  assert.equal(out.source, 'eurostat-freight-ppi');
  assert.equal(out.nace, 'H50');
  assert.equal(out.indexValue, 145.8);
});

test('parseUpstreamResponse skips non-finite values', () => {
  const body = {
    value: { '0': 138.1, '1': 141.5 },
    dimension: {
      time: {
        category: {
          index: { '2025-Q2': 0, '2025-Q3': 1, '2025-Q4': 2 },
        },
      },
    },
  };
  const out = freight.parseUpstreamResponse(body, { area: 'EU27_2020' });
  assert.ok(out);
  assert.equal(out.asOfPeriod, '2025-Q3');
});

test('parseUpstreamResponse returns null on malformed body', () => {
  assert.equal(freight.parseUpstreamResponse(null, { area: 'EU27_2020' }), null);
  assert.equal(freight.parseUpstreamResponse({}, { area: 'EU27_2020' }), null);
});

// ── Lookup ──────────────────────────────────────────────────────────

test('lookupFreightPpi returns null for unsupported areas', async () => {
  kv._resetMemoryStore();
  assert.equal(await freight.lookupFreightPpi('ZZ'), null);
  assert.equal(await freight.lookupFreightPpi('US'), null);
});

test('lookupFreightPpi returns fresh cache hit with fromCache:true / stale:false', async () => {
  kv._resetMemoryStore();
  const snapshot = {
    area: 'EU27_2020',
    asOfPeriod: '2025-Q4',
    asOf: '2025-10-01T00:00:00.000Z',
    source: 'eurostat-freight-ppi',
    nace: 'H50',
    seasonalAdjustment: 'NSA',
    baseYear: 2015,
    indexValue: 145.8,
  };
  await kv.set('eurostat-freight:EU27_2020', snapshot);
  const out = await freight.lookupFreightPpi('EU27_2020');
  assert.ok(out);
  assert.equal(out.fromCache, true);
  assert.equal(out.stale, false);
  assert.equal(out.area, 'EU27_2020');
  assert.equal(out.indexValue, 145.8);
});

test('lookupFreightPpi falls back to stale cache when upstream is disabled', async () => {
  kv._resetMemoryStore();
  const stale = {
    area: 'EU27_2020',
    asOfPeriod: '2025-Q3',
    asOf: '2025-07-01T00:00:00.000Z',
    source: 'eurostat-freight-ppi',
    nace: 'H50',
    seasonalAdjustment: 'NSA',
    baseYear: 2015,
    indexValue: 141.5,
  };
  await kv.set('eurostat-freight:EU27_2020:stale', stale);
  const out = await freight.lookupFreightPpi('EU27_2020');
  assert.ok(out);
  assert.equal(out.stale, true);
  assert.equal(out.fromCache, true);
});

test('lookupFreightPpi returns null on malformed input', async () => {
  kv._resetMemoryStore();
  assert.equal(await freight.lookupFreightPpi(null), null);
  assert.equal(await freight.lookupFreightPpi(''), null);
});

test('lookupFreightPpi honours opts.skipUpstream', async () => {
  kv._resetMemoryStore();
  assert.equal(await freight.lookupFreightPpi('EU27_2020', { skipUpstream: true }), null);
});

// ── Verify URL + supported areas ────────────────────────────────────

test('eurostatVerifyUrl returns a public-portal databrowser URL', () => {
  const url = freight.eurostatVerifyUrl();
  assert.ok(url);
  assert.ok(url.startsWith('https://ec.europa.eu/eurostat/databrowser'));
  assert.match(url, /sts_sepp_q/);
});

test('EUROSTAT_SUPPORTED_AREAS includes EU27_2020 + EA20 + key seaboard MS', () => {
  for (const area of ['EU27_2020', 'EA20', 'DE', 'NL', 'ES', 'IT', 'GR']) {
    assert.ok(freight.EUROSTAT_SUPPORTED_AREAS.includes(area),
      `EUROSTAT_SUPPORTED_AREAS must include "${area}"`);
  }
});

test('Constants exposed at documented values', () => {
  assert.equal(freight.CACHE_TTL_SECONDS, 7 * 24 * 60 * 60);
  assert.equal(freight.STALE_TTL_SECONDS, 90 * 24 * 60 * 60);
  assert.equal(freight.REQUEST_TIMEOUT_MS, 6000);
});
