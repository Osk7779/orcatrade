// Eurostat warehousing PPI client — resolves the EU/EA Producer Price
// Index for warehousing and support activities for transportation
// (NACE H52), the primary regulator-quality benchmark for warehouse
// pricing in the European Union.
//
// Why this exists
// ─────────────────
// warehouse-quote.js uses a static PRICING_SNAPSHOT (OrcaTrade's
// quarterly 3PL benchmark survey, mirror only) for all 6 EU hubs. That
// surfaces honest mid-market estimates but doesn't cite a primary
// regulator — so every Tier-A verdict (ADR 0020) on the warehouse
// calculator has returned eligible:false since the wedge opened
// (PR #109 / #116).
//
// This client closes that gate. Eurostat publishes a quarterly PPI for
// warehousing services per Member State and at the EU/EA aggregate
// level under dataset sts_sepp_q (Producer prices in services), NACE
// section H52 ("Warehousing and support activities for transportation").
// Auditors uniquely trust Eurostat for EU-wide producer-price
// movements — it's the same dataset central banks read. A snapshot of
// "warehousing PPI (EA20, NACE H52) = 132.4 in 2025-Q4" turns the
// static rate-card into a primary-regulator-cited input.
//
// Source — and its caveats
// ────────────────────────
// Eurostat dissemination API: https://ec.europa.eu/eurostat/api/dissemination
// Public, no API key, generous fair-use limits. We hit
//   /statistics/1.0/data/sts_sepp_q?nace_r2=H52&geo=<area>&s_adj=NSA&unit=I15
// Quarterly (q), non-seasonally-adjusted (NSA), index 2015=100 (I15).
// The response is SDMX-JSON 2.0 with one observation per quarter; we
// extract the most recent observation.
//
// Caveats explicitly surfaced in every return value:
//   - Eurostat releases this dataset on a ~3-month lag (the PPI for
//     Q1 typically publishes mid-Q2). Snapshots are 1-2 quarters old
//     by design — not a freshness bug.
//   - The index is 2015=100. A reading of 132.4 means warehousing
//     producer prices rose 32.4% from the 2015 baseline. Callers
//     pricing in absolute euros use this as a drift attestation, not
//     a price-level lookup.
//   - Source is always 'eurostat-warehousing-ppi' so consumers can
//     name it accurately in operator-facing copy.
//   - Area codes use Eurostat's geo coding: 'EA20' (Euro area),
//     'EU27_2020' (EU27 post-Brexit), or ISO-2 country codes for
//     Member States (NL, DE, PL, CZ, ES, etc.).
//
// Caching strategy
// ────────────────
// Key shape: `eurostat-warehousing:<area>`. No date in the key — we
// always fetch "latest available quarter" and let the cached
// asOfPeriod tell consumers how stale it is. TTL 7d fresh / 90d stale
// because Eurostat releases quarterly; a 7-day fresh window guarantees
// we re-check within one release cycle, and the 90-day stale window
// keeps the calculator alive if Eurostat goes down between releases.
//
// All upstream HTTP requests time out at 6 seconds — Eurostat's API
// is slower than ECB but still well under the function timeout.

'use strict';

const kv = require('./kv-store');

const UPSTREAM_BASE =
  'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data';
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;       // 7 days fresh
const STALE_TTL_SECONDS = 90 * 24 * 60 * 60;      // up to 90 days stale
const REQUEST_TIMEOUT_MS = 6000;

// Eurostat publishes sts_sepp_q for the EU27, the Euro area, and each
// Member State (plus a handful of EFTA partners). We curate to the
// areas the warehouse calculator's hub catalogue actually covers,
// plus the two aggregate benchmarks.
const EUROSTAT_SUPPORTED_AREAS = Object.freeze([
  // Aggregates
  'EU27_2020',
  'EA20',
  // Member States represented in HUBS
  'NL', 'DE', 'PL', 'CZ', 'ES',
  // Other Member States the calculator's region matrix covers
  'FR', 'BE', 'LU', 'AT', 'IT', 'PT', 'DK', 'SE', 'FI',
  'EE', 'LV', 'LT', 'BG', 'RO', 'SK', 'HU', 'GR', 'IE',
]);

function normaliseArea(code) {
  if (!code || typeof code !== 'string') return null;
  const upper = code.trim().toUpperCase();
  // Match Eurostat geo codes — ISO-2 country, or known aggregate.
  if (!/^[A-Z0-9_]{2,12}$/.test(upper)) return null;
  return upper;
}

function cacheKey(area) {
  return `eurostat-warehousing:${area}`;
}

/**
 * Fetch the latest warehousing-PPI observation from Eurostat. Returns
 * null on any failure — caller falls back to the cached/mirror path.
 */
async function fetchUpstream(area) {
  if (process.env.ORCATRADE_DISABLE_LIVE_EUROSTAT) return null;
  if (process.env.ORCATRADE_DISABLE_LIVE_TARIC) return null;

  const url =
    `${UPSTREAM_BASE}/sts_sepp_q` +
    `?format=JSON&lang=EN` +
    `&nace_r2=H52` +
    `&geo=${area}` +
    `&s_adj=NSA` +
    `&unit=I15`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return parseUpstreamResponse(body, { area });
  } catch (_) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Parse the Eurostat SDMX-JSON 2.0 response into a snapshot shape we
 * can persist. Unit-testable on its own.
 *
 * SDMX-JSON 2.0 (Eurostat dialect) carries:
 *   value: { "<flat-index>": <number>, ... }
 *   dimension.time.category.index: { "2024-Q4": 0, "2025-Q1": 1, ... }
 *   dimension.time.category.label: { "2024-Q4": "2024-Q4", ... }
 *   size: [<n_geo>, <n_nace>, ..., <n_time>]
 *
 * For a query that pins everything except `time` to a single value,
 * the flat-index equals the time-position. We pick the highest time
 * index that has a value and read it.
 */
function parseUpstreamResponse(body, { area }) {
  try {
    if (!body || !body.value || !body.dimension || !body.dimension.time) {
      return null;
    }
    const timeCat = body.dimension.time.category;
    if (!timeCat || !timeCat.index) return null;

    const periodByIndex = {};
    for (const [period, idx] of Object.entries(timeCat.index)) {
      periodByIndex[Number(idx)] = period;
    }

    const presentIndices = Object.keys(body.value)
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a);
    if (presentIndices.length === 0) return null;

    let chosen = null;
    for (const idx of presentIndices) {
      const v = Number(body.value[String(idx)]);
      if (Number.isFinite(v) && v > 0 && periodByIndex[idx]) {
        chosen = { idx, value: v, period: periodByIndex[idx] };
        break;
      }
    }
    if (!chosen) return null;

    // Eurostat quarters are formatted YYYY-Qn (e.g. "2025-Q4"). Convert
    // to a representative ISO timestamp at the START of the quarter so
    // ADR 0020's TA-1 fresh-snapshot check has something to compare
    // against. (The TA window logic treats this as a daily timestamp.)
    const asOf = quarterToIsoStartUtc(chosen.period);
    if (!asOf) return null;

    return {
      area,
      asOfPeriod: chosen.period,
      asOf,
      source: 'eurostat-warehousing-ppi',
      nace: 'H52',
      seasonalAdjustment: 'NSA',
      baseYear: 2015,
      indexValue: chosen.value,
    };
  } catch (_) {
    return null;
  }
}

function quarterToIsoStartUtc(period) {
  if (typeof period !== 'string') return null;
  const m = period.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  const year = Number(m[1]);
  const quarter = Number(m[2]);
  const month = String((quarter - 1) * 3 + 1).padStart(2, '0');
  return `${year}-${month}-01T00:00:00.000Z`;
}

/**
 * Read-through cache: return fresh data, else stale, else upstream,
 * else null.
 */
async function lookupWarehousingPpi(area, opts = {}) {
  const a = normaliseArea(area);
  if (!a) return null;

  if (!EUROSTAT_SUPPORTED_AREAS.includes(a)) return null;

  const key = cacheKey(a);

  const fresh = await kv.get(key);
  if (fresh) {
    return { ...fresh, fromCache: true, stale: false };
  }

  if (opts.skipUpstream === true) return null;

  const live = await fetchUpstream(a);
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
 * Construct the Eurostat browser URL operators can click to verify
 * the snapshot manually.
 */
function eurostatVerifyUrl(area) {
  const a = normaliseArea(area);
  if (!a) return null;
  return (
    `https://ec.europa.eu/eurostat/databrowser/view/sts_sepp_q/default/table` +
    `?lang=en&category=sts.sts_se.sts_se_prc`
  );
}

module.exports = {
  lookupWarehousingPpi,
  eurostatVerifyUrl,
  normaliseArea,
  parseUpstreamResponse,
  quarterToIsoStartUtc,
  EUROSTAT_SUPPORTED_AREAS,
  CACHE_TTL_SECONDS,
  STALE_TTL_SECONDS,
  REQUEST_TIMEOUT_MS,
};
