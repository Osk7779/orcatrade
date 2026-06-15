'use strict';

// Tests for lib/intelligence/ecb-fx-client.js — the ECB Statistical
// Data Warehouse primary-regulator source backing finance-quote's
// Tier-A path (PR #141).
//
// Hermetic: ORCATRADE_DISABLE_LIVE_TARIC=1 (set in npm test) also
// disables live ECB fetches via a parallel kill switch.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ecb = require(path.join(ROOT, 'lib', 'intelligence', 'ecb-fx-client'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));

// ── Normalisation ────────────────────────────────────────────────────

test('normaliseCurrency accepts ISO-4217 three-letter codes (case-insensitive)', () => {
  assert.equal(ecb.normaliseCurrency('USD'), 'USD');
  assert.equal(ecb.normaliseCurrency('usd'), 'USD');
  assert.equal(ecb.normaliseCurrency(' Cny '), 'CNY');
});

test('normaliseCurrency rejects non-ISO-4217 inputs', () => {
  assert.equal(ecb.normaliseCurrency(''), null);
  assert.equal(ecb.normaliseCurrency('US'), null);
  assert.equal(ecb.normaliseCurrency('USDT'), null);
  assert.equal(ecb.normaliseCurrency(null), null);
  assert.equal(ecb.normaliseCurrency(840), null);
});

test('normaliseDate accepts Date / YYYY-MM-DD / ISO timestamp', () => {
  assert.equal(ecb.normaliseDate('2026-06-15'), '2026-06-15');
  assert.equal(ecb.normaliseDate('2026-06-15T10:30:00.000Z'), '2026-06-15');
  assert.equal(ecb.normaliseDate(new Date('2026-06-15T00:00:00.000Z')), '2026-06-15');
});

test('normaliseDate rejects malformed input', () => {
  assert.equal(ecb.normaliseDate(''), null);
  assert.equal(ecb.normaliseDate('not-a-date'), null);
  assert.equal(ecb.normaliseDate(null), null);
});

// ── Response parsing ────────────────────────────────────────────────

test('parseUpstreamResponse extracts the most recent observation + rate', () => {
  // Synthesise the ECB SDMX-JSON response shape.
  const body = {
    dataSets: [{
      series: {
        '0:0:0:0:0': {
          observations: {
            '0': [7.50],
            '1': [7.55],
            '2': [7.60],  // most recent
          },
        },
      },
    }],
    structure: {
      dimensions: {
        observation: [{
          values: [
            { id: '2026-06-13' },
            { id: '2026-06-14' },
            { id: '2026-06-15' },
          ],
        }],
      },
    },
  };
  const out = ecb.parseUpstreamResponse(body, { currency: 'CNY' });
  assert.ok(out);
  assert.equal(out.currency, 'CNY');
  assert.equal(out.asOfDate, '2026-06-15');
  assert.equal(out.source, 'ecb-fx');
  assert.equal(out.unitsPerEur, 7.60);
  // 1 EUR = 7.60 CNY → 1 CNY = 1/7.60 EUR
  assert.ok(Math.abs(out.eurPerUnit - (1 / 7.60)) < 0.000001);
});

test('parseUpstreamResponse returns null on malformed body', () => {
  assert.equal(ecb.parseUpstreamResponse(null, { currency: 'CNY' }), null);
  assert.equal(ecb.parseUpstreamResponse({}, { currency: 'CNY' }), null);
  assert.equal(ecb.parseUpstreamResponse({ dataSets: [] }, { currency: 'CNY' }), null);
});

test('parseUpstreamResponse returns null when rate is non-positive', () => {
  const body = {
    dataSets: [{
      series: { 'k': { observations: { '0': [0] } } },
    }],
    structure: { dimensions: { observation: [{ values: [{ id: '2026-06-15' }] }] } },
  };
  assert.equal(ecb.parseUpstreamResponse(body, { currency: 'CNY' }), null);
});

// ── Lookup ──────────────────────────────────────────────────────────

test('lookupSpotRate returns null for unsupported currencies (VND, BDT, etc.)', async () => {
  // ECB doesn't publish daily VND or BDT reference rates — short-
  // circuit without burning an upstream call.
  kv._resetMemoryStore();
  assert.equal(await ecb.lookupSpotRate('VND', '2026-06-15'), null);
  assert.equal(await ecb.lookupSpotRate('BDT', '2026-06-15'), null);
});

test('lookupSpotRate returns fresh cache hit with fromCache:true / stale:false', async () => {
  kv._resetMemoryStore();
  const snapshot = {
    currency: 'CNY',
    asOfDate: '2026-06-15',
    asOf: '2026-06-15T00:00:00.000Z',
    source: 'ecb-fx',
    unitsPerEur: 7.60,
    eurPerUnit: 1 / 7.60,
  };
  await kv.set('ecb-fx:CNY:2026-06-15', snapshot);
  const out = await ecb.lookupSpotRate('CNY', '2026-06-15');
  assert.ok(out);
  assert.equal(out.fromCache, true);
  assert.equal(out.stale, false);
  assert.equal(out.currency, 'CNY');
});

test('lookupSpotRate falls back to stale cache when upstream is disabled', async () => {
  kv._resetMemoryStore();
  const stale = {
    currency: 'CNY',
    asOfDate: '2026-06-10',
    asOf: '2026-06-10T00:00:00.000Z',
    source: 'ecb-fx',
    unitsPerEur: 7.55,
    eurPerUnit: 1 / 7.55,
  };
  await kv.set('ecb-fx:CNY:2026-06-15:stale', stale);
  const out = await ecb.lookupSpotRate('CNY', '2026-06-15');
  assert.ok(out);
  assert.equal(out.stale, true);
  assert.equal(out.fromCache, true);
});

test('lookupSpotRate returns null on malformed input', async () => {
  kv._resetMemoryStore();
  assert.equal(await ecb.lookupSpotRate(null, '2026-06-15'), null);
  assert.equal(await ecb.lookupSpotRate('CNY', null), null);
  assert.equal(await ecb.lookupSpotRate('USDT', '2026-06-15'), null);
});

test('lookupSpotRate honours opts.skipUpstream', async () => {
  kv._resetMemoryStore();
  assert.equal(await ecb.lookupSpotRate('USD', '2026-06-15', { skipUpstream: true }), null);
});

// ── Verify URL ──────────────────────────────────────────────────────

test('ecbVerifyUrl returns a public-portal URL with the currency in the path', () => {
  const url = ecb.ecbVerifyUrl('CNY');
  assert.ok(url);
  assert.ok(url.startsWith('https://data.ecb.europa.eu'));
  assert.match(url, /EXR\.D\.CNY\.EUR\.SP00\.A/);
});

test('ecbVerifyUrl returns null on bad input', () => {
  assert.equal(ecb.ecbVerifyUrl(null), null);
  assert.equal(ecb.ecbVerifyUrl(''), null);
});

// ── ECB-supported currencies pinned ─────────────────────────────────

test('ECB_SUPPORTED_CURRENCIES includes finance-quote\'s main FX_TABLE pairs (sans CNH, VND, BDT)', () => {
  // The supported list curates ECB's reference-rate basket. finance-
  // quote's FX_TABLE uses USD/CNY/INR/GBP/TRY among others; the
  // structurally-managed currencies (VND, BDT) lack daily ECB
  // reference rates so they don't appear.
  for (const ccy of ['USD', 'CNY', 'INR', 'GBP', 'TRY']) {
    assert.ok(ecb.ECB_SUPPORTED_CURRENCIES.includes(ccy),
      `ECB_SUPPORTED_CURRENCIES must include "${ccy}" (used by finance-quote FX_TABLE)`);
  }
});

test('Constants exposed at documented values', () => {
  assert.equal(ecb.CACHE_TTL_SECONDS, 24 * 60 * 60);
  assert.equal(ecb.STALE_TTL_SECONDS, 7 * 24 * 60 * 60);
  assert.equal(ecb.REQUEST_TIMEOUT_MS, 4000);
});
