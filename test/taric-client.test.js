'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const taric = require('../lib/intelligence/taric-client');
const kv = require('../lib/intelligence/kv-store');

// Most tests run with ORCATRADE_DISABLE_LIVE_TARIC=1 (set by npm test). We
// flip the env around carefully inside specific tests to exercise the
// upstream-fetch branch. The kv store is in memory mode under tests, so
// we reset it before each scenario that depends on cache state.

test.beforeEach(() => {
  kv._resetMemoryStore();
});

// ── input normalisation ────────────────────────────────────────────────

test('normaliseHs accepts 6, 8, 10 digit codes; strips dots and spaces', () => {
  assert.equal(taric.normaliseHs('6203.42'), '620342');
  assert.equal(taric.normaliseHs('6203 42 11'), '62034211');
  assert.equal(taric.normaliseHs('6203421100'), '6203421100');
  assert.equal(taric.normaliseHs('62-03-42'), '620342');
});

test('normaliseHs rejects nonsense', () => {
  assert.equal(taric.normaliseHs(''), null);
  assert.equal(taric.normaliseHs(null), null);
  assert.equal(taric.normaliseHs('123'), null);          // wrong length
  assert.equal(taric.normaliseHs('12345'), null);
  assert.equal(taric.normaliseHs('not a code'), null);
});

test('normaliseOrigin uppercases + requires 2-letter ISO', () => {
  assert.equal(taric.normaliseOrigin('cn'), 'CN');
  assert.equal(taric.normaliseOrigin(' VN '), 'VN');
  assert.equal(taric.normaliseOrigin('USA'), null);
  assert.equal(taric.normaliseOrigin(''), null);
  assert.equal(taric.normaliseOrigin(null), null);
});

// ── lookupHsRate behaviour ─────────────────────────────────────────────

test('lookupHsRate returns null on invalid HS', async () => {
  const r = await taric.lookupHsRate('abc', 'CN');
  assert.equal(r, null);
});

test('lookupHsRate returns null on invalid origin', async () => {
  const r = await taric.lookupHsRate('62034211', 'USA');
  assert.equal(r, null);
});

test('lookupHsRate returns null when upstream is disabled + no cache', async () => {
  // ORCATRADE_DISABLE_LIVE_TARIC=1 is set by npm test, so the upstream
  // fetch returns null. With nothing in cache, lookup should return null.
  const r = await taric.lookupHsRate('62034211', 'CN');
  assert.equal(r, null);
});

test('lookupHsRate serves fresh cache without hitting upstream', async () => {
  const key = taric._cacheKey('62034211', 'CN');
  await kv.setJson(key, {
    rate: 0.12,
    source: 'uk-trade-tariff',
    sourceLabel: 'UK Trade Tariff',
    asOf: '2026-05-01',
    savedAt: Math.floor(Date.now() / 1000),  // fresh
  }, 60 * 60);

  const r = await taric.lookupHsRate('62034211', 'CN');
  assert.ok(r, 'should return cached value');
  assert.equal(r.rate, 0.12);
  assert.equal(r.fromCache, true);
  assert.equal(r.stale, false);
});

test('lookupHsRate falls back to stale cache when upstream fails', async () => {
  const key = taric._cacheKey('62034211', 'CN');
  // savedAt eight days ago → past CACHE_TTL_SECONDS (7d)
  const eightDaysAgo = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;
  await kv.setJson(key, {
    rate: 0.115,
    source: 'uk-trade-tariff',
    sourceLabel: 'UK Trade Tariff',
    asOf: '2026-04-01',
    savedAt: eightDaysAgo,
  }, 60 * 60 * 24 * 30);

  // Upstream is killed by env var → fetch returns null → stale fallback fires.
  const r = await taric.lookupHsRate('62034211', 'CN');
  assert.ok(r, 'should return stale cache');
  assert.equal(r.rate, 0.115);
  assert.equal(r.fromCache, true);
  assert.equal(r.stale, true);
});

test('lookupHsRate with skipUpstream=true never hits the network', async () => {
  // No cache + skipUpstream → null
  const r = await taric.lookupHsRate('62034211', 'CN', { skipUpstream: true });
  assert.equal(r, null);

  // With cache + skipUpstream → returns cached value
  const key = taric._cacheKey('62034211', 'CN');
  await kv.setJson(key, {
    rate: 0.08,
    source: 'uk-trade-tariff',
    sourceLabel: 'UK Trade Tariff',
    asOf: '2026-04-01',
    savedAt: Math.floor(Date.now() / 1000),
  }, 60 * 60);
  const r2 = await taric.lookupHsRate('62034211', 'CN', { skipUpstream: true });
  assert.ok(r2);
  assert.equal(r2.rate, 0.08);
});

// ── taricVerifyUrl ────────────────────────────────────────────────────

test('taricVerifyUrl builds a usable EU TARIC URL with HS code', () => {
  const url = taric.taricVerifyUrl('62034211', 'CN');
  assert.match(url, /^https:\/\/taric\.ec\.europa\.eu\//);
  assert.match(url, /GoodsCode=62034211/);
  assert.match(url, /#origin=CN/);
});

test('taricVerifyUrl returns null for invalid HS', () => {
  assert.equal(taric.taricVerifyUrl('xyz', 'CN'), null);
});

test('taricVerifyUrl works without origin', () => {
  const url = taric.taricVerifyUrl('62034211');
  assert.match(url, /GoodsCode=62034211/);
  assert.doesNotMatch(url, /#origin=/);
});

// ── customs-quote integration via calculateQuoteAsync ─────────────────

test('calculateQuoteAsync falls back to sync path when no hsCode', async () => {
  const customs = require('../lib/intelligence/customs-quote');
  const r = await customs.calculateQuoteAsync({
    customsValueEur: 50000,
    hsCode: '62',                 // 2-digit, too short for live lookup
    destinationCountry: 'DE',
    originCountry: 'CN',
  });
  assert.equal(r.ok, true);
  assert.equal(r.duty.mfnSource, 'chapter-estimator');
  assert.equal(r.duty.liveRateMeta, undefined);
});

test('calculateQuoteAsync uses chapter estimator when upstream is disabled + no cache', async () => {
  const customs = require('../lib/intelligence/customs-quote');
  const r = await customs.calculateQuoteAsync({
    customsValueEur: 50000,
    hsCode: '62034211',           // 8-digit, eligible for live lookup
    destinationCountry: 'DE',
    originCountry: 'CN',
  });
  assert.equal(r.ok, true);
  // Upstream killed, no cache → falls back to chapter rate, source label
  // stays at the chapter estimator.
  assert.equal(r.duty.mfnSource, 'chapter-estimator');
});

test('calculateQuoteAsync uses cached live rate when present', async () => {
  const customs = require('../lib/intelligence/customs-quote');
  const key = taric._cacheKey('62034211', 'CN');
  await kv.setJson(key, {
    rate: 0.155,                   // distinctly different from chapter (12%)
    source: 'uk-trade-tariff',
    sourceLabel: 'UK Trade Tariff (sanity-check; EU may differ)',
    asOf: '2026-05-01',
    savedAt: Math.floor(Date.now() / 1000),
  }, 60 * 60);

  const r = await customs.calculateQuoteAsync({
    customsValueEur: 50000,
    hsCode: '62034211',
    destinationCountry: 'DE',
    originCountry: 'CN',
  });
  assert.equal(r.ok, true);
  // mfnRate is the live one (15.5%), chapter rate is preserved for transparency
  assert.equal(r.duty.mfnRatePercent.toFixed(1), '15.5');
  assert.equal(r.duty.chapterRatePercent.toFixed(1), '12.0');
  assert.ok(r.duty.mfnSource.includes('UK Trade Tariff') || r.duty.mfnSource.includes('uk-trade-tariff'));
  assert.ok(r.duty.liveRateMeta);
  assert.equal(r.duty.liveRateMeta.fromCache, true);
});

test('calculateQuoteAsync still stacks trade-defence on top of live MFN', async () => {
  const customs = require('../lib/intelligence/customs-quote');
  // Bicycles ex-CN: chapter 87 MFN is 10%; AD 48.5%; combined 58.5%.
  // We seed a "live" chapter-equivalent rate of 10% and confirm the AD
  // still stacks (i.e. the live override only swaps the MFN portion).
  const key = taric._cacheKey('87120030', 'CN');
  await kv.setJson(key, {
    rate: 0.10,
    source: 'uk-trade-tariff',
    sourceLabel: 'UK Trade Tariff',
    asOf: '2026-05-01',
    savedAt: Math.floor(Date.now() / 1000),
  }, 60 * 60);

  const r = await customs.calculateQuoteAsync({
    customsValueEur: 100000,
    hsCode: '87120030',
    destinationCountry: 'DE',
    originCountry: 'CN',
  });
  assert.equal(r.ok, true);
  // Rate should be 10% MFN + AD; the AD database has rates around 48.5%.
  assert.ok(r.duty.ratePercent > 50, `expected combined rate > 50%, got ${r.duty.ratePercent}`);
  assert.ok(r.duty.tradeDefenceMeasures.length > 0, 'AD measure should still apply');
});

test('calculateQuoteAsync next-steps surface a TARIC verify link when live rate applied', async () => {
  const customs = require('../lib/intelligence/customs-quote');
  const key = taric._cacheKey('62034211', 'CN');
  await kv.setJson(key, {
    rate: 0.12, source: 'uk-trade-tariff', sourceLabel: 'UK Trade Tariff',
    asOf: '2026-05-01', savedAt: Math.floor(Date.now() / 1000),
  }, 60 * 60);

  const r = await customs.calculateQuoteAsync({
    customsValueEur: 50000, hsCode: '62034211',
    destinationCountry: 'DE', originCountry: 'CN',
  });
  assert.equal(r.ok, true);
  const verifyStep = r.nextSteps.find(s => /taric\.ec\.europa\.eu/.test(s));
  assert.ok(verifyStep, 'next-steps should include a EU TARIC verify link');
});
