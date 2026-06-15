// UN Comtrade client — resolves an HS code to a primary-regulator
// trade-flow snapshot listing top exporting countries by trade value.
//
// Why this exists
// ─────────────────
// sourcing-quote.js historically used a static rate-card (PRICING_SNAPSHOT)
// for country comparison. That's good enough for category-level scoring
// but doesn't cite a primary regulator — so every Tier-A verdict (ADR
// 0020) on a sourcing recommendation has returned eligible:false since
// the wedge opened (PR #99 / #110).
//
// This client closes that gate. UN Comtrade is the international trade-
// statistics primary regulator: every country's customs administration
// reports trade flows monthly, and the UN consolidates them into a
// canonical dataset. A trade-flow snapshot of "top 10 exporters of HS
// code Y to the EU in the last 12 months" turns the static rate-card
// into a primary-regulator-backed comparison.
//
// Source — and its caveats
// ────────────────────────
// UN Comtrade public API: https://comtradeapi.un.org/data/v1
// The free preview tier is anonymous + rate-limited but doesn't require
// an API key for basic queries. For higher-volume use, set
// COMTRADE_API_KEY (registered at https://comtradeplus.un.org).
//
// Caveats explicitly surfaced in every return value:
//   - asOf is the period the data covers (last full year, typically),
//     NOT the API call timestamp. Snapshots stay valid for the TTL
//     window even if the year doesn't change.
//   - source is always 'un-comtrade' so consumers can name it accurately
//     in operator-facing copy.
//   - reporter codes are ISO-3 (Comtrade convention); callers needing
//     ISO-2 must map at the boundary.
//
// Caching strategy
// ────────────────
// Key shape: `comtrade:flows:<hs>:<reporting_period>`. TTL 30 days
// fresh / 90 days stale — Comtrade data updates monthly at most, so a
// 30-day cache is generously fresh AND stays well within the API's
// fair-use guidance. Stale-while-revalidate (PR #132 customs pattern)
// keeps the calculator alive if Comtrade is down at quote time.
//
// All upstream HTTP requests time out at 6 seconds (slightly longer
// than the TARIC client's 4s budget — Comtrade's edge is genuinely
// further than the UK Trade Tariff endpoint).

'use strict';

const kv = require('./kv-store');

const UPSTREAM_BASE = 'https://comtradeapi.un.org/data/v1/get';
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;        // 30 days fresh
const STALE_TTL_SECONDS = 90 * 24 * 60 * 60;        // up to 90 days served stale on upstream failure
const REQUEST_TIMEOUT_MS = 6000;

// Top-N exporters surfaced in the snapshot. 10 strikes a balance
// between operator-readable + audit-defensible coverage of the major
// origins.
const TOP_EXPORTERS_COUNT = 10;

/**
 * Normalise an HS code to digits only. Comtrade accepts 2-, 4-, or
 * 6-digit codes; we permit 8/10 too and trim to HS6 since that's the
 * globally-stable level (HS8+ is national).
 */
function normaliseHs(hsCode) {
  if (!hsCode || typeof hsCode !== 'string') return null;
  const digits = hsCode.replace(/\D/g, '');
  if (digits.length < 2) return null;
  // Trim to 6 digits — Comtrade's commodity classification stops at
  // the WCO-harmonised HS6 level. Sub-headings (HS8+) are national
  // and wouldn't query reliably across all reporters.
  return digits.length >= 6 ? digits.slice(0, 6) : digits;
}

/**
 * Comtrade splits trade data by "period" (year for annual data,
 * YYYYMM for monthly). v1 of this client uses annual data — operators
 * comparing sourcing countries care about full-year throughput, not
 * month-by-month noise.
 *
 * normalisePeriod accepts: a 4-digit year, a YYYY-MM date string, a
 * full ISO timestamp. Returns the year as a 4-digit string.
 */
function normalisePeriod(period) {
  if (period == null) return null;
  const s = String(period);
  const m = s.match(/^(\d{4})/);
  return m ? m[1] : null;
}

function cacheKey(hs, period) {
  return `comtrade:flows:${hs}:${period}`;
}

/**
 * Fetch a fresh trade-flow snapshot from Comtrade. Returns null on any
 * failure — caller falls back to the cached/mirror path.
 *
 * @param {string} hs — HS code (normalised to ≤6 digits before calling)
 * @param {string} period — 4-digit year
 */
async function fetchUpstream(hs, period) {
  // Hard kill-switch parallel to ORCATRADE_DISABLE_LIVE_TARIC. CI and
  // local dev want network-free defaults; setting either disables the
  // upstream fetch entirely.
  if (process.env.ORCATRADE_DISABLE_LIVE_COMTRADE) return null;
  if (process.env.ORCATRADE_DISABLE_LIVE_TARIC) return null;

  // typeCode=C → commodities (vs services). freqCode=A → annual.
  // clCode=HS → Harmonized System classification. reporterCode=0 →
  // "World" view (all reporting countries). partnerCode=918 →
  // European Union (reported as a partner). flowCode=X → exports.
  // The EU code 918 is the Comtrade reporter for "European Union":
  // returns the volume that flowed TO the EU from each reporter.
  const params = new URLSearchParams({
    typeCode: 'C',
    freqCode: 'A',
    clCode: 'HS',
    period,
    reporterCode: '',        // all reporters
    cmdCode: hs,
    flowCode: 'X',           // exports
    partnerCode: '918',      // EU
  });
  const url = `${UPSTREAM_BASE}/preview?${params.toString()}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers = { 'Accept': 'application/json' };
    if (process.env.COMTRADE_API_KEY) {
      headers['Ocp-Apim-Subscription-Key'] = process.env.COMTRADE_API_KEY;
    }
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) return null;
    const body = await res.json();
    return parseUpstreamResponse(body, { hs, period });
  } catch (_) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Parse the Comtrade response into a snapshot shape we can persist.
 * Unit-testable on its own; takes a body, returns a snapshot or null.
 *
 * Expected Comtrade response shape:
 *   { count, data: [{ reporterCode, reporterISO, reporterDesc,
 *                     period, primaryValue, ... }, ...] }
 */
function parseUpstreamResponse(body, { hs, period }) {
  if (!body || !Array.isArray(body.data)) return null;
  const rows = body.data
    .filter((r) => r && Number.isFinite(Number(r.primaryValue)) && Number(r.primaryValue) > 0)
    .map((r) => ({
      reporterCode: r.reporterCode != null ? String(r.reporterCode) : null,
      reporterIso: typeof r.reporterISO === 'string' ? r.reporterISO : null,
      reporterDesc: typeof r.reporterDesc === 'string' ? r.reporterDesc : null,
      // Comtrade primary value is USD-denominated trade value for the
      // period. Operators care about RELATIVE ranking, not absolute
      // currency, so we don't convert.
      tradeValueUsd: Number(r.primaryValue),
    }))
    .sort((a, b) => b.tradeValueUsd - a.tradeValueUsd)
    .slice(0, TOP_EXPORTERS_COUNT);
  if (rows.length === 0) return null;
  return {
    hs,
    period,
    asOf: `${period}-12-31T23:59:59.999Z`,
    source: 'un-comtrade',
    reporters: rows,
  };
}

/**
 * Read-through cache: return fresh data, else stale, else upstream,
 * else null. The "stale-while-revalidate" semantics are critical —
 * Comtrade going down at quote time shouldn't crash the calculator.
 *
 * @returns {Promise<{ hs, period, asOf, source, reporters, fromCache?, stale? } | null>}
 */
async function lookupTopExporters(hsCode, period, opts = {}) {
  const hs = normaliseHs(hsCode);
  const periodN = normalisePeriod(period);
  if (!hs || !periodN) return null;

  const key = cacheKey(hs, periodN);

  // Fresh cache hit
  const fresh = await kv.get(key);
  if (fresh) {
    return { ...fresh, fromCache: true, stale: false };
  }

  // Skip upstream if caller asked (used by tests to keep behaviour
  // hermetic without setting the global env switch).
  if (opts.skipUpstream === true) return null;

  // Try live upstream
  const live = await fetchUpstream(hs, periodN);
  if (live) {
    try {
      await kv.set(key, live, { ex: CACHE_TTL_SECONDS });
      // Best-effort: store a longer-lived stale copy too. If KV
      // doesn't support a per-key dual-TTL, this is a harmless
      // overwrite later.
      await kv.set(`${key}:stale`, live, { ex: STALE_TTL_SECONDS });
    } catch (_) { /* cache write failure is non-fatal */ }
    return { ...live, fromCache: false, stale: false };
  }

  // Stale-while-revalidate fallback
  const stale = await kv.get(`${key}:stale`);
  if (stale) {
    return { ...stale, fromCache: true, stale: true };
  }
  return null;
}

/**
 * Construct the Comtrade portal URL operators can click to verify the
 * snapshot manually. Useful in operator-facing copy ("Verify on UN
 * Comtrade: <url>") + audit-trail event detail.
 */
function comtradeVerifyUrl(hsCode, period) {
  const hs = normaliseHs(hsCode);
  const periodN = normalisePeriod(period);
  if (!hs || !periodN) return null;
  return `https://comtradeplus.un.org/TradeFlow?Frequency=A&Period=${periodN}&CommodityCodes=${hs}&Reporters=all&Partners=918&Flows=X`;
}

module.exports = {
  // Public surface
  lookupTopExporters,
  comtradeVerifyUrl,
  // Helpers exposed for tests
  normaliseHs,
  normalisePeriod,
  parseUpstreamResponse,
  // Constants exposed for tests + downstream rate-limiting / cache
  // observability
  TOP_EXPORTERS_COUNT,
  CACHE_TTL_SECONDS,
  STALE_TTL_SECONDS,
  REQUEST_TIMEOUT_MS,
};
