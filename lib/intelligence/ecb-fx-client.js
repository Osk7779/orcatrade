// ECB FX client — resolves a currency pair to the European Central
// Bank's daily reference rate, the primary regulator for EUR-
// denominated FX.
//
// Why this exists
// ─────────────────
// finance-quote.js uses a static FX_TABLE (annualised volatility +
// annualForwardPremiumPercent per pair) for hedging cost estimates.
// That's good enough for category-level estimates but doesn't cite a
// primary regulator — so every Tier-A verdict (ADR 0020) on a
// finance recommendation has returned eligible:false since the wedge
// opened (PR #109 / #116).
//
// This client closes that gate. The ECB publishes daily reference
// rates against EUR for ~30 actively traded currencies; financial
// auditors uniquely trust ECB rates for EUR-denominated transactions
// (vs the partner-bank rate-card we use today). A spot snapshot of
// "EUR/CNY = 7.79 on YYYY-MM-DD" turns the static rate-card into a
// primary-regulator-cited input.
//
// Source — and its caveats
// ────────────────────────
// ECB Statistical Data Warehouse: https://data-api.ecb.europa.eu
// Public, no API key, generous fair-use limits. We hit the
// EXR.D.<currency>.EUR.SP00.A endpoint — daily (D), spot (SP00),
// average (A). The response is structured JSON with one observation
// per business day; we extract the most recent.
//
// Caveats explicitly surfaced in every return value:
//   - The ECB publishes reference rates for the previous business
//     day at ~16:00 CET. Snapshots are 1-3 days old by design.
//   - The rate is EUR-denominated: 1 EUR = N <currency>. Callers
//     needing the inverse (CNY/EUR = 0.128) flip at the boundary.
//   - Source is always 'ecb-fx' so consumers can name it accurately
//     in operator-facing copy.
//   - Currency codes are ISO-4217 (uppercase three-letter).
//
// Caching strategy
// ────────────────
// Key shape: `ecb-fx:<currency>:<date>`. Daily granularity. TTL 24h
// fresh / 7 days stale. ECB updates rates once per business day;
// caching at day granularity captures every meaningful change.
// Stale-while-revalidate (PR #132/#139 pattern) keeps the
// calculator alive on ECB downtime.
//
// All upstream HTTP requests time out at 4 seconds — matches TARIC
// client; ECB is fast.

'use strict';

const kv = require('./kv-store');

const UPSTREAM_BASE = 'https://data-api.ecb.europa.eu/service/data';
const CACHE_TTL_SECONDS = 24 * 60 * 60;          // 24 hours fresh
const STALE_TTL_SECONDS = 7 * 24 * 60 * 60;      // up to 7 days served stale
const REQUEST_TIMEOUT_MS = 4000;

// ECB doesn't publish CNH (offshore CNY) — finance-quote uses CNY
// in its FX_TABLE so that's what we look up. ECB doesn't publish a
// daily VND or BDT reference rate either; lookups for those return
// null and the caller falls back to the rate-card path.
const ECB_SUPPORTED_CURRENCIES = Object.freeze([
  'USD', 'CNY', 'INR', 'GBP', 'JPY', 'KRW', 'TRY', 'BRL', 'MXN',
  'AUD', 'CAD', 'CHF', 'HKD', 'SGD', 'ZAR', 'PLN', 'CZK', 'HUF',
]);

function normaliseCurrency(code) {
  if (!code || typeof code !== 'string') return null;
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(upper)) return null;
  return upper;
}

/**
 * Normalise a calendar date to YYYY-MM-DD. Accepts a Date, a
 * YYYY-MM-DD string, or a full ISO timestamp. The caller (handler
 * code, allowed to read the clock) supplies "today" or "last
 * business day".
 */
function normaliseDate(input) {
  if (!input) return null;
  if (input instanceof Date) {
    const y = input.getUTCFullYear();
    const m = String(input.getUTCMonth() + 1).padStart(2, '0');
    const d = String(input.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(input);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function cacheKey(currency, date) {
  return `ecb-fx:${currency}:${date}`;
}

/**
 * Fetch a fresh spot rate from ECB. Returns null on any failure —
 * caller falls back to the cached/mirror path.
 */
async function fetchUpstream(currency, date) {
  if (process.env.ORCATRADE_DISABLE_LIVE_ECB) return null;
  if (process.env.ORCATRADE_DISABLE_LIVE_TARIC) return null;

  // ECB SDMX query: dataset EXR (exchange rates), key D.<ccy>.EUR.SP00.A.
  // Trailing date filter to get the most recent observation up to
  // the requested date.
  const url = `${UPSTREAM_BASE}/EXR/D.${currency}.EUR.SP00.A?format=jsondata&lastNObservations=1&endPeriod=${date}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return parseUpstreamResponse(body, { currency });
  } catch (_) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Parse the ECB SDMX-JSON response into a snapshot shape we can
 * persist. Unit-testable on its own.
 *
 * The SDMX-JSON response carries observations under
 *   dataSets[0].series['<dimensions>'].observations
 * with date dimensions described in
 *   structure.dimensions.observation[0].values
 *
 * We extract the most recent observation (highest date) and its
 * numeric rate.
 */
function parseUpstreamResponse(body, { currency }) {
  try {
    const ds = body && body.dataSets && body.dataSets[0];
    if (!ds || !ds.series) return null;
    const seriesKeys = Object.keys(ds.series);
    if (seriesKeys.length === 0) return null;
    const series = ds.series[seriesKeys[0]];
    if (!series || !series.observations) return null;

    const dateValues = body.structure
      && body.structure.dimensions
      && body.structure.dimensions.observation
      && body.structure.dimensions.observation[0]
      && body.structure.dimensions.observation[0].values;
    if (!Array.isArray(dateValues)) return null;

    // Pick the most recent observation (highest observation index).
    const obsKeys = Object.keys(series.observations);
    if (obsKeys.length === 0) return null;
    const latestIdx = obsKeys.map(Number).sort((a, b) => b - a)[0];
    const obs = series.observations[String(latestIdx)];
    const rate = obs && obs[0] != null ? Number(obs[0]) : null;
    if (!Number.isFinite(rate) || rate <= 0) return null;

    const dateMeta = dateValues[latestIdx];
    const asOfDate = dateMeta && dateMeta.id;
    if (!asOfDate || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) return null;

    return {
      currency,
      asOfDate,
      asOf: `${asOfDate}T00:00:00.000Z`,
      source: 'ecb-fx',
      // Rate is 1 EUR = N <currency>.
      eurPerUnit: 1 / rate,
      unitsPerEur: rate,
    };
  } catch (_) {
    return null;
  }
}

/**
 * Read-through cache: return fresh data, else stale, else upstream,
 * else null.
 */
async function lookupSpotRate(currency, date, opts = {}) {
  const ccy = normaliseCurrency(currency);
  const dateN = normaliseDate(date);
  if (!ccy || !dateN) return null;

  // Currencies the ECB doesn't publish (VND, BDT, etc.) — short-
  // circuit to null without burning an upstream call.
  if (!ECB_SUPPORTED_CURRENCIES.includes(ccy)) return null;

  const key = cacheKey(ccy, dateN);

  const fresh = await kv.get(key);
  if (fresh) {
    return { ...fresh, fromCache: true, stale: false };
  }

  if (opts.skipUpstream === true) return null;

  const live = await fetchUpstream(ccy, dateN);
  if (live) {
    try {
      await kv.set(key, live, { ex: CACHE_TTL_SECONDS });
      await kv.set(`${key}:stale`, live, { ex: STALE_TTL_SECONDS });
    } catch (_) { /* cache write failure is non-fatal */ }
    return { ...live, fromCache: false, stale: false };
  }

  const stale = await kv.get(`${key}:stale`);
  if (stale) {
    return { ...stale, fromCache: true, stale: true };
  }
  return null;
}

/**
 * Construct the ECB SDW portal URL operators can click to verify
 * the snapshot manually.
 */
function ecbVerifyUrl(currency) {
  const ccy = normaliseCurrency(currency);
  if (!ccy) return null;
  return `https://data.ecb.europa.eu/data/datasets/EXR/EXR.D.${ccy}.EUR.SP00.A`;
}

module.exports = {
  lookupSpotRate,
  ecbVerifyUrl,
  normaliseCurrency,
  normaliseDate,
  parseUpstreamResponse,
  ECB_SUPPORTED_CURRENCIES,
  CACHE_TTL_SECONDS,
  STALE_TTL_SECONDS,
  REQUEST_TIMEOUT_MS,
};
