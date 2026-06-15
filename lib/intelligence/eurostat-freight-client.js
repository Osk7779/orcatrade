// Eurostat freight (water transport) PPI client — resolves the EU
// Producer Price Index for water transport services (NACE H50), the
// primary regulator-quality benchmark for sea-freight pricing in the
// European Union.
//
// Why this exists
// ─────────────────
// routing-quote.js uses a static PRICING_SNAPSHOT of mid-market spot
// rates from OrcaTrade partner forwarders. That's the right shape for
// indicative quotes, but doesn't cite a primary regulator — so every
// Tier-A verdict (ADR 0020) on a routing recommendation has returned
// eligible:false since the wedge opened (PR #109 / #115).
//
// This client closes that gate. Eurostat publishes a quarterly PPI
// for water-transport services per Member State and at the EU/EA
// aggregate level under dataset sts_sepp_q (Producer prices in
// services), NACE section H50 ("Water transport") — the same
// dataset / API surface used by the warehousing client (PR #143). For
// sea freight specifically, the EU27 aggregate is the canonical
// primary-source benchmark; auditors trust it for cross-border price
// movements the way they trust Eurostat for everything else.
//
// Why not SCFI / WCI / FBX?
//   - SCFI (Shanghai Containerized Freight Index) is the most-cited
//     industry index for Asia→Europe rates, but the Shanghai Shipping
//     Exchange publishes it via HTML/PDF — no clean public API. A
//     scrape-based source would not meet the primary-regulator bar
//     and would carry a fragile contract.
//   - WCI (Drewry World Container Index) is paywalled.
//   - FBX (Freightos Baltic Index) is published publicly but is a
//     commercial product, not a primary regulator.
//   - Eurostat H50 is the publicly-funded EU statistical authority's
//     own water-transport-services price index. Pricing movements
//     here are the closest primary-source proxy for the sea-freight
//     spot rates that drive routing-quote's recommendations.
//
// Source — and its caveats
// ────────────────────────
// Eurostat dissemination API: https://ec.europa.eu/eurostat/api/dissemination
// Public, no API key, generous fair-use limits. We hit
//   /statistics/1.0/data/sts_sepp_q?nace_r2=H50&geo=<area>&s_adj=NSA&unit=I15
// Quarterly (q), non-seasonally-adjusted (NSA), index 2015=100 (I15).
//
// Caveats explicitly surfaced in every return value:
//   - Eurostat releases this dataset on a ~3-month lag (the PPI for
//     Q1 typically publishes mid-Q2). Snapshots are 1-2 quarters old
//     by design — not a freshness bug.
//   - The index is 2015=100. A reading of 145.8 means water-transport
//     producer prices rose 45.8% from the 2015 baseline. Callers
//     pricing absolute euros use this as a drift attestation, not a
//     price-level lookup.
//   - Source is always 'eurostat-freight-ppi' so consumers can name
//     it accurately in operator-facing copy.
//
// Caching strategy
// ────────────────
// Key shape: `eurostat-freight:<area>`. 7d fresh / 90d stale — same
// cadence as the warehousing client (PR #143). Eurostat's quarterly
// release rhythm dominates either choice.
//
// All upstream HTTP requests time out at 6 seconds.

'use strict';

const kv = require('./kv-store');

const UPSTREAM_BASE =
  'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data';
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const STALE_TTL_SECONDS = 90 * 24 * 60 * 60;
const REQUEST_TIMEOUT_MS = 6000;

// Eurostat publishes sts_sepp_q water-transport prices for the EU27,
// the Euro area, and a varying subset of Member States (some MS have
// gaps for H50 specifically). We curate to the aggregates the routing
// calculator actually defers to plus a few core MS for diagnostic
// queries.
const EUROSTAT_SUPPORTED_AREAS = Object.freeze([
  'EU27_2020',
  'EA20',
  'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'PL', 'DK', 'SE', 'GR', 'PT',
]);

function normaliseArea(code) {
  if (!code || typeof code !== 'string') return null;
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z0-9_]{2,12}$/.test(upper)) return null;
  return upper;
}

function cacheKey(area) {
  return `eurostat-freight:${area}`;
}

async function fetchUpstream(area) {
  if (process.env.ORCATRADE_DISABLE_LIVE_EUROSTAT) return null;
  if (process.env.ORCATRADE_DISABLE_LIVE_TARIC) return null;

  const url =
    `${UPSTREAM_BASE}/sts_sepp_q` +
    `?format=JSON&lang=EN` +
    `&nace_r2=H50` +
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

    const asOf = quarterToIsoStartUtc(chosen.period);
    if (!asOf) return null;

    return {
      area,
      asOfPeriod: chosen.period,
      asOf,
      source: 'eurostat-freight-ppi',
      nace: 'H50',
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

async function lookupFreightPpi(area, opts = {}) {
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

function eurostatVerifyUrl() {
  return (
    `https://ec.europa.eu/eurostat/databrowser/view/sts_sepp_q/default/table` +
    `?lang=en&category=sts.sts_se.sts_se_prc`
  );
}

module.exports = {
  lookupFreightPpi,
  eurostatVerifyUrl,
  normaliseArea,
  parseUpstreamResponse,
  quarterToIsoStartUtc,
  EUROSTAT_SUPPORTED_AREAS,
  CACHE_TTL_SECONDS,
  STALE_TTL_SECONDS,
  REQUEST_TIMEOUT_MS,
};
