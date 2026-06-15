'use strict';

// Tests for lib/intelligence/eurostat-warehousing-client.js — the
// Eurostat warehousing-PPI (NACE H52) primary-regulator source backing
// warehouse-quote's Tier-A path (PR #143).
//
// Hermetic: ORCATRADE_DISABLE_LIVE_TARIC=1 (set in npm test) also
// disables live Eurostat fetches via a parallel kill switch.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const eurostat = require(path.join(ROOT, 'lib', 'intelligence', 'eurostat-warehousing-client'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));

// ── Normalisation ────────────────────────────────────────────────────

test('normaliseArea accepts ISO-2 country codes (case-insensitive)', () => {
  assert.equal(eurostat.normaliseArea('NL'), 'NL');
  assert.equal(eurostat.normaliseArea('nl'), 'NL');
  assert.equal(eurostat.normaliseArea(' De '), 'DE');
});

test('normaliseArea accepts Eurostat aggregate codes (EU27_2020, EA20)', () => {
  assert.equal(eurostat.normaliseArea('EU27_2020'), 'EU27_2020');
  assert.equal(eurostat.normaliseArea('EA20'), 'EA20');
});

test('normaliseArea rejects malformed inputs', () => {
  assert.equal(eurostat.normaliseArea(''), null);
  assert.equal(eurostat.normaliseArea(null), null);
  assert.equal(eurostat.normaliseArea(123), null);
  assert.equal(eurostat.normaliseArea('!!!'), null);
});

// ── Quarter helper ──────────────────────────────────────────────────

test('quarterToIsoStartUtc maps "YYYY-Qn" → first day of the quarter (UTC)', () => {
  assert.equal(eurostat.quarterToIsoStartUtc('2025-Q1'), '2025-01-01T00:00:00.000Z');
  assert.equal(eurostat.quarterToIsoStartUtc('2025-Q2'), '2025-04-01T00:00:00.000Z');
  assert.equal(eurostat.quarterToIsoStartUtc('2025-Q3'), '2025-07-01T00:00:00.000Z');
  assert.equal(eurostat.quarterToIsoStartUtc('2025-Q4'), '2025-10-01T00:00:00.000Z');
});

test('quarterToIsoStartUtc returns null for malformed period', () => {
  assert.equal(eurostat.quarterToIsoStartUtc('2025'), null);
  assert.equal(eurostat.quarterToIsoStartUtc('2025-Q5'), null);
  assert.equal(eurostat.quarterToIsoStartUtc(null), null);
});

// ── Response parsing ────────────────────────────────────────────────

test('parseUpstreamResponse extracts the most recent observation', () => {
  // Synthesise the Eurostat SDMX-JSON 2.0 response shape.
  const body = {
    value: {
      '0': 128.2,
      '1': 130.5,
      '2': 132.4,  // most recent
    },
    dimension: {
      time: {
        category: {
          index: {
            '2025-Q2': 0,
            '2025-Q3': 1,
            '2025-Q4': 2,
          },
          label: {
            '2025-Q2': '2025-Q2',
            '2025-Q3': '2025-Q3',
            '2025-Q4': '2025-Q4',
          },
        },
      },
    },
    size: [1, 1, 1, 3],
  };
  const out = eurostat.parseUpstreamResponse(body, { area: 'EA20' });
  assert.ok(out);
  assert.equal(out.area, 'EA20');
  assert.equal(out.asOfPeriod, '2025-Q4');
  assert.equal(out.asOf, '2025-10-01T00:00:00.000Z');
  assert.equal(out.source, 'eurostat-warehousing-ppi');
  assert.equal(out.nace, 'H52');
  assert.equal(out.seasonalAdjustment, 'NSA');
  assert.equal(out.baseYear, 2015);
  assert.equal(out.indexValue, 132.4);
});

test('parseUpstreamResponse skips non-finite values when finding the latest', () => {
  const body = {
    value: {
      '0': 128.2,
      '1': 130.5,
      // 2 missing — latest valid observation is index 1
    },
    dimension: {
      time: {
        category: {
          index: {
            '2025-Q2': 0,
            '2025-Q3': 1,
            '2025-Q4': 2,
          },
        },
      },
    },
  };
  const out = eurostat.parseUpstreamResponse(body, { area: 'EA20' });
  assert.ok(out);
  assert.equal(out.asOfPeriod, '2025-Q3');
  assert.equal(out.indexValue, 130.5);
});

test('parseUpstreamResponse returns null on malformed body', () => {
  assert.equal(eurostat.parseUpstreamResponse(null, { area: 'EA20' }), null);
  assert.equal(eurostat.parseUpstreamResponse({}, { area: 'EA20' }), null);
  assert.equal(eurostat.parseUpstreamResponse({ value: {} }, { area: 'EA20' }), null);
});

test('parseUpstreamResponse returns null when no positive value present', () => {
  const body = {
    value: { '0': 0, '1': -1 },
    dimension: { time: { category: { index: { '2025-Q3': 0, '2025-Q4': 1 } } } },
  };
  assert.equal(eurostat.parseUpstreamResponse(body, { area: 'EA20' }), null);
});

// ── Lookup ──────────────────────────────────────────────────────────

test('lookupWarehousingPpi returns null for unsupported areas', async () => {
  kv._resetMemoryStore();
  assert.equal(await eurostat.lookupWarehousingPpi('ZZ'), null);
  assert.equal(await eurostat.lookupWarehousingPpi('US'), null);
});

test('lookupWarehousingPpi returns fresh cache hit with fromCache:true / stale:false', async () => {
  kv._resetMemoryStore();
  const snapshot = {
    area: 'EA20',
    asOfPeriod: '2025-Q4',
    asOf: '2025-10-01T00:00:00.000Z',
    source: 'eurostat-warehousing-ppi',
    nace: 'H52',
    seasonalAdjustment: 'NSA',
    baseYear: 2015,
    indexValue: 132.4,
  };
  await kv.set('eurostat-warehousing:EA20', snapshot);
  const out = await eurostat.lookupWarehousingPpi('EA20');
  assert.ok(out);
  assert.equal(out.fromCache, true);
  assert.equal(out.stale, false);
  assert.equal(out.area, 'EA20');
  assert.equal(out.indexValue, 132.4);
});

test('lookupWarehousingPpi falls back to stale cache when upstream is disabled', async () => {
  kv._resetMemoryStore();
  const stale = {
    area: 'EA20',
    asOfPeriod: '2025-Q3',
    asOf: '2025-07-01T00:00:00.000Z',
    source: 'eurostat-warehousing-ppi',
    nace: 'H52',
    seasonalAdjustment: 'NSA',
    baseYear: 2015,
    indexValue: 130.5,
  };
  await kv.set('eurostat-warehousing:EA20:stale', stale);
  const out = await eurostat.lookupWarehousingPpi('EA20');
  assert.ok(out);
  assert.equal(out.stale, true);
  assert.equal(out.fromCache, true);
});

test('lookupWarehousingPpi returns null on malformed input', async () => {
  kv._resetMemoryStore();
  assert.equal(await eurostat.lookupWarehousingPpi(null), null);
  assert.equal(await eurostat.lookupWarehousingPpi(''), null);
});

test('lookupWarehousingPpi honours opts.skipUpstream', async () => {
  kv._resetMemoryStore();
  assert.equal(await eurostat.lookupWarehousingPpi('EA20', { skipUpstream: true }), null);
});

// ── Verify URL ──────────────────────────────────────────────────────

test('eurostatVerifyUrl returns a public-portal databrowser URL', () => {
  const url = eurostat.eurostatVerifyUrl('EA20');
  assert.ok(url);
  assert.ok(url.startsWith('https://ec.europa.eu/eurostat/databrowser'));
  assert.match(url, /sts_sepp_q/);
});

test('eurostatVerifyUrl returns null on bad input', () => {
  assert.equal(eurostat.eurostatVerifyUrl(null), null);
  assert.equal(eurostat.eurostatVerifyUrl(''), null);
});

// ── Supported areas pinned ──────────────────────────────────────────

test('EUROSTAT_SUPPORTED_AREAS includes warehouse-quote\'s 5 hub countries + EU/EA aggregates', () => {
  for (const area of ['NL', 'DE', 'PL', 'CZ', 'ES', 'EU27_2020', 'EA20']) {
    assert.ok(eurostat.EUROSTAT_SUPPORTED_AREAS.includes(area),
      `EUROSTAT_SUPPORTED_AREAS must include "${area}"`);
  }
});

test('Constants exposed at documented values', () => {
  assert.equal(eurostat.CACHE_TTL_SECONDS, 7 * 24 * 60 * 60);
  assert.equal(eurostat.STALE_TTL_SECONDS, 90 * 24 * 60 * 60);
  assert.equal(eurostat.REQUEST_TIMEOUT_MS, 6000);
});
