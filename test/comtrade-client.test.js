'use strict';

// Tests for lib/intelligence/comtrade-client.js — the UN Comtrade
// primary-regulator trade-flow source that backs sourcing-quote's
// Tier-A eligibility path (PR #139).
//
// Hermetic: ORCATRADE_DISABLE_LIVE_TARIC=1 (set in package.json's npm
// test script) ALSO disables live Comtrade fetches via a parallel
// check inside fetchUpstream. This keeps the test suite network-free
// without requiring callers to set a second env switch.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const comtrade = require(path.join(ROOT, 'lib', 'intelligence', 'comtrade-client'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));

// ── Normalisation helpers ────────────────────────────────────────────

test('normaliseHs accepts 6-digit codes verbatim', () => {
  assert.equal(comtrade.normaliseHs('620342'), '620342');
});

test('normaliseHs trims 8/10-digit codes to HS6 (globally-stable level)', () => {
  // HS8+ is national. WCO-harmonised level is HS6; querying Comtrade
  // for an HS10 would miss most reporters who only report at HS6.
  assert.equal(comtrade.normaliseHs('62034235'), '620342');
  assert.equal(comtrade.normaliseHs('6203423500'), '620342');
});

test('normaliseHs strips non-digits before length check', () => {
  // "6203.42" (dot-separated) and "6203 42" (spaced) are common
  // operator-facing forms.
  assert.equal(comtrade.normaliseHs('6203.42'), '620342');
  assert.equal(comtrade.normaliseHs('6203 42'), '620342');
});

test('normaliseHs rejects single-digit or non-string input', () => {
  assert.equal(comtrade.normaliseHs(''), null);
  assert.equal(comtrade.normaliseHs('1'), null);
  assert.equal(comtrade.normaliseHs(null), null);
  assert.equal(comtrade.normaliseHs(undefined), null);
  assert.equal(comtrade.normaliseHs(620342), null);
});

test('normaliseHs accepts 2/4-digit codes (Comtrade supports chapter + heading queries)', () => {
  assert.equal(comtrade.normaliseHs('62'), '62');
  assert.equal(comtrade.normaliseHs('6203'), '6203');
});

test('normalisePeriod extracts the 4-digit year from various input shapes', () => {
  assert.equal(comtrade.normalisePeriod('2024'), '2024');
  assert.equal(comtrade.normalisePeriod('2024-12'), '2024');
  assert.equal(comtrade.normalisePeriod('2024-12-31T23:59:59.999Z'), '2024');
  assert.equal(comtrade.normalisePeriod(2024), '2024');
});

test('normalisePeriod rejects non-year input', () => {
  assert.equal(comtrade.normalisePeriod(''), null);
  assert.equal(comtrade.normalisePeriod('not-a-year'), null);
  assert.equal(comtrade.normalisePeriod(null), null);
});

// ── Response parsing ─────────────────────────────────────────────────

test('parseUpstreamResponse extracts top-N exporters sorted by trade value', () => {
  // Synthesise a Comtrade-shaped response. The real API returns
  // `primaryValue` (USD-denominated). Order is deliberately
  // scrambled to verify the parser sorts.
  const body = {
    data: [
      { reporterCode: 156, reporterISO: 'CHN', reporterDesc: 'China',     primaryValue: 1_000_000_000 },
      { reporterCode: 392, reporterISO: 'JPN', reporterDesc: 'Japan',     primaryValue: 100_000_000 },
      { reporterCode: 410, reporterISO: 'KOR', reporterDesc: 'Korea',     primaryValue: 200_000_000 },
      { reporterCode: 704, reporterISO: 'VNM', reporterDesc: 'Vietnam',   primaryValue: 500_000_000 },
    ],
  };
  const out = comtrade.parseUpstreamResponse(body, { hs: '620342', period: '2024' });
  assert.ok(out, 'parseUpstreamResponse must return a snapshot');
  assert.equal(out.hs, '620342');
  assert.equal(out.period, '2024');
  assert.equal(out.source, 'un-comtrade');
  assert.equal(out.reporters.length, 4);
  // Sorted descending by tradeValueUsd.
  assert.equal(out.reporters[0].reporterIso, 'CHN');
  assert.equal(out.reporters[1].reporterIso, 'VNM');
  assert.equal(out.reporters[2].reporterIso, 'KOR');
  assert.equal(out.reporters[3].reporterIso, 'JPN');
});

test('parseUpstreamResponse caps the reporters list at TOP_EXPORTERS_COUNT (10)', () => {
  const body = {
    data: Array.from({ length: 25 }, (_, i) => ({
      reporterCode: 100 + i,
      reporterISO: `R${i}`,
      reporterDesc: `Reporter ${i}`,
      primaryValue: 1000 - i,
    })),
  };
  const out = comtrade.parseUpstreamResponse(body, { hs: '620342', period: '2024' });
  assert.ok(out);
  assert.equal(out.reporters.length, comtrade.TOP_EXPORTERS_COUNT);
  assert.equal(comtrade.TOP_EXPORTERS_COUNT, 10);
});

test('parseUpstreamResponse drops rows with zero / non-finite primaryValue (data hygiene)', () => {
  // Comtrade sometimes returns rows with primaryValue === 0 or null
  // for partner-reported flows that don't quite reconcile. Filtering
  // these out keeps the snapshot operator-relevant.
  const body = {
    data: [
      { reporterCode: 156, reporterISO: 'CHN', reporterDesc: 'China', primaryValue: 1_000_000 },
      { reporterCode: 392, reporterISO: 'JPN', reporterDesc: 'Japan', primaryValue: 0 },
      { reporterCode: 410, reporterISO: 'KOR', reporterDesc: 'Korea', primaryValue: null },
      { reporterCode: 704, reporterISO: 'VNM', reporterDesc: 'Vietnam', primaryValue: -50 },
    ],
  };
  const out = comtrade.parseUpstreamResponse(body, { hs: '620342', period: '2024' });
  assert.ok(out);
  assert.equal(out.reporters.length, 1);
  assert.equal(out.reporters[0].reporterIso, 'CHN');
});

test('parseUpstreamResponse returns null on malformed body', () => {
  // Don't crash the calculator if Comtrade returns something
  // unexpected — return null and let the caller fall back to the
  // mirror path.
  assert.equal(comtrade.parseUpstreamResponse(null, { hs: '620342', period: '2024' }), null);
  assert.equal(comtrade.parseUpstreamResponse({}, { hs: '620342', period: '2024' }), null);
  assert.equal(comtrade.parseUpstreamResponse({ data: 'not-an-array' }, { hs: '620342', period: '2024' }), null);
  assert.equal(comtrade.parseUpstreamResponse({ data: [] }, { hs: '620342', period: '2024' }), null);
});

test('parseUpstreamResponse emits an end-of-year asOf timestamp for the requested period', () => {
  // The snapshot's asOf is the period boundary (year-end), not the
  // API call time — Comtrade data covers a period, not a moment.
  const body = {
    data: [{ reporterCode: 156, reporterISO: 'CHN', reporterDesc: 'China', primaryValue: 1000 }],
  };
  const out = comtrade.parseUpstreamResponse(body, { hs: '620342', period: '2024' });
  assert.ok(out);
  assert.equal(out.asOf, '2024-12-31T23:59:59.999Z');
});

// ── Verify URL ───────────────────────────────────────────────────────

test('comtradeVerifyUrl returns a public-portal URL with the correct query params', () => {
  const url = comtrade.comtradeVerifyUrl('620342', '2024');
  assert.ok(url);
  assert.ok(url.startsWith('https://comtradeplus.un.org/TradeFlow?'));
  assert.match(url, /CommodityCodes=620342/);
  assert.match(url, /Period=2024/);
  // partnerCode=918 is the EU — see comtrade-client comment.
  assert.match(url, /Partners=918/);
  // flowCode=X means exports.
  assert.match(url, /Flows=X/);
});

test('comtradeVerifyUrl returns null on malformed inputs (caller should not surface bad links)', () => {
  assert.equal(comtrade.comtradeVerifyUrl(null, '2024'), null);
  assert.equal(comtrade.comtradeVerifyUrl('620342', null), null);
  assert.equal(comtrade.comtradeVerifyUrl('', ''), null);
});

// ── Cache-aware lookupTopExporters ──────────────────────────────────

test('lookupTopExporters returns null when ORCATRADE_DISABLE_LIVE_TARIC is set + no cache', async () => {
  // The kill switch is parallel to the TARIC client's — set in
  // package.json's npm test script. Confirms hermetic test mode
  // works as designed.
  kv._resetMemoryStore();
  // (ORCATRADE_DISABLE_LIVE_TARIC=1 is set in the env for the suite)
  const out = await comtrade.lookupTopExporters('620342', '2024');
  assert.equal(out, null);
});

test('lookupTopExporters returns a fresh cache hit with fromCache:true / stale:false', async () => {
  kv._resetMemoryStore();
  const snapshot = {
    hs: '620342',
    period: '2024',
    asOf: '2024-12-31T23:59:59.999Z',
    source: 'un-comtrade',
    reporters: [{ reporterCode: '156', reporterIso: 'CHN', reporterDesc: 'China', tradeValueUsd: 1_000_000 }],
  };
  await kv.set('comtrade:flows:620342:2024', snapshot);
  const out = await comtrade.lookupTopExporters('620342', '2024');
  assert.ok(out, 'fresh cache hit must return a snapshot');
  assert.equal(out.fromCache, true);
  assert.equal(out.stale, false);
  assert.equal(out.hs, '620342');
  assert.equal(out.reporters[0].reporterIso, 'CHN');
});

test('lookupTopExporters falls back to stale cache when upstream is disabled + no fresh', async () => {
  // Stale-while-revalidate: when the live upstream is unavailable
  // (env kill-switch + no fresh cache), we still serve the stale
  // copy with stale:true so the caller can warn the operator.
  kv._resetMemoryStore();
  const staleSnapshot = {
    hs: '620342',
    period: '2024',
    asOf: '2024-12-31T23:59:59.999Z',
    source: 'un-comtrade',
    reporters: [{ reporterCode: '156', reporterIso: 'CHN', reporterDesc: 'China', tradeValueUsd: 500_000 }],
  };
  await kv.set('comtrade:flows:620342:2024:stale', staleSnapshot);
  // Fresh cache is empty; upstream is disabled. We expect the stale
  // copy to come through.
  const out = await comtrade.lookupTopExporters('620342', '2024');
  assert.ok(out, 'stale fallback must return a snapshot');
  assert.equal(out.stale, true);
  assert.equal(out.fromCache, true);
});

test('lookupTopExporters returns null when HS or period is unparseable', async () => {
  kv._resetMemoryStore();
  assert.equal(await comtrade.lookupTopExporters(null, '2024'), null);
  assert.equal(await comtrade.lookupTopExporters('620342', null), null);
  assert.equal(await comtrade.lookupTopExporters('', ''), null);
});

test('lookupTopExporters honours opts.skipUpstream (hermetic test path)', async () => {
  // Some tests want to verify cache behaviour WITHOUT setting the
  // global ORCATRADE_DISABLE_LIVE_* env switch. opts.skipUpstream
  // turns off the upstream fetch for a single call.
  kv._resetMemoryStore();
  const out = await comtrade.lookupTopExporters('620342', '2024', { skipUpstream: true });
  assert.equal(out, null);
});

// ── Cache key shape ──────────────────────────────────────────────────

test('Cache key uses HS6 + 4-digit period (predictable for ops + audit)', async () => {
  // The cache key is operator-debuggable: a support engineer can
  // inspect KV for `comtrade:flows:<hs>:<year>` to see what
  // snapshot was served. Drift guard pins the key shape.
  kv._resetMemoryStore();
  const snapshot = {
    hs: '620342',
    period: '2024',
    asOf: '2024-12-31T23:59:59.999Z',
    source: 'un-comtrade',
    reporters: [{ reporterCode: '156', reporterIso: 'CHN', reporterDesc: 'China', tradeValueUsd: 1 }],
  };
  await kv.set('comtrade:flows:620342:2024', snapshot);
  const out = await comtrade.lookupTopExporters('620342', '2024');
  assert.ok(out);
  // And the same call with a 10-digit code (which normalises to HS6)
  // hits the same cache.
  const out10 = await comtrade.lookupTopExporters('6203423500', '2024');
  assert.ok(out10, 'HS10 must normalise to HS6 and hit the same cache key');
  assert.equal(out10.reporters[0].reporterIso, 'CHN');
});

// ── Constants exposed for downstream observability ───────────────────

test('CACHE + STALE TTLs are exposed at the documented values', () => {
  // Make these inspectable so downstream rate-limiting / SRE tooling
  // can read the cache windows without re-deriving them.
  assert.equal(comtrade.CACHE_TTL_SECONDS, 30 * 24 * 60 * 60);
  assert.equal(comtrade.STALE_TTL_SECONDS, 90 * 24 * 60 * 60);
  assert.equal(comtrade.REQUEST_TIMEOUT_MS, 6000);
  assert.equal(comtrade.TOP_EXPORTERS_COUNT, 10);
});
