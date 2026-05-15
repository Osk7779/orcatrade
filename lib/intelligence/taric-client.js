// TARIC client — resolves 8-10 digit HS codes to current MFN duty rates,
// with aggressive KV caching.
//
// Why this exists
// ─────────────────
// customs-quote.js historically used a chapter-level static table (~2-digit
// HS resolution). That's good enough for category-level estimates but
// undersells the platform when a user supplies a real 10-digit commodity
// code. This client gives sub-chapter precision when the user knows their
// HS code.
//
// Source — and its caveats
// ────────────────────────
// The EU TARIC consultation portal (taric.ec.europa.eu) doesn't expose a
// free public REST API for HS-line rates. The closest free, well-documented
// equivalent is the UK Trade Tariff API
// (https://www.trade-tariff.service.gov.uk/api/v2/) — which is a fork of
// the same WTO bound-rate baseline EU TARIC uses, with UK divergences for
// some FTAs and trade-defence measures. For ~80% of HS lines the third-
// country MFN rate matches; for the rest, our caller can flag the
// discrepancy or fall back to the chapter estimate.
//
// We're explicit about the source in every return value so consumers can
// surface "UK sanity-check" wording rather than pretending we hit TARIC
// directly. A future swap to a paid EU-direct provider or our own bulk-XML
// ingestion only needs to change `fetchUpstreamRate` — the cache + caller
// contract stays the same.
//
// Caching strategy
// ────────────────
// Key shape: `taric:rate:<hs>:<origin>`. TTL 7 days — EU MFN rates change
// quarterly at most, so 7 days strikes a balance between freshness and
// upstream-API load. On upstream failure we still return cached values
// even if expired (stale-while-revalidate semantics): bad data is better
// than no data when the alternative is a static chapter rate.
//
// All upstream HTTP requests time out at 4 seconds; the customs calc must
// stay snappy even if the upstream is slow.

'use strict';

const kv = require('./kv-store');

const UPSTREAM_BASE = 'https://www.trade-tariff.service.gov.uk/api/v2';
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;          // 7 days fresh
const STALE_TTL_SECONDS = 30 * 24 * 60 * 60;         // up to 30 days served stale on upstream failure
const REQUEST_TIMEOUT_MS = 4000;

/**
 * Normalise an HS code to digits only. Returns null for inputs that can't
 * plausibly be an HS code (must be 6, 8, or 10 digits after cleanup).
 */
function normaliseHs(hsCode) {
  if (!hsCode || typeof hsCode !== 'string') return null;
  const digits = hsCode.replace(/\D/g, '');
  if (digits.length === 6 || digits.length === 8 || digits.length === 10) return digits;
  return null;
}

function normaliseOrigin(originIso) {
  if (!originIso || typeof originIso !== 'string') return null;
  const upper = originIso.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : null;
}

function cacheKey(hs, origin) {
  return `taric:rate:${hs}:${origin}`;
}

/**
 * Fetch a fresh rate from the upstream API. Returns null on any failure.
 * The UK Trade Tariff API returns commodity records with `import_measures`,
 * each carrying a duty_expression that we parse for the MFN rate.
 */
async function fetchUpstreamRate(hs, origin) {
  // Hard kill-switch: lets tests, CI, and local dev opt out of the
  // outbound HTTP entirely. Used by `npm test` (set in package.json) so
  // example-plan generation doesn't fan out into N real fetches.
  if (process.env.ORCATRADE_DISABLE_LIVE_TARIC) return null;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // The UK endpoint accepts the full 10-digit code; if a user gave us 6,
    // we still query — the API resolves to the heading and returns chapter-
    // level measures.
    const url = `${UPSTREAM_BASE}/commodities/${hs}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/vnd.api+json' },
    });
    if (!res.ok) return null;
    const body = await res.json();

    // Walk the JSON:API response. Third-country duty is the MFN baseline
    // measure (measure_type_id "103"). Preferential and trade-defence
    // measures live alongside but we only want the MFN rate here — the
    // calculator's existing preferential + AD/CVD layers handle the rest.
    const included = Array.isArray(body.included) ? body.included : [];
    const measures = included.filter(x => x.type === 'measure');
    const mfn = measures.find(m =>
      m.attributes && (m.attributes.measure_type_id === '103' || m.attributes.measure_type_id === 103)
    );
    if (!mfn) return null;

    // The duty expression is a string like "12.00 %" or "5.5 %"; sometimes
    // compound (e.g. "EUR 5.00 / kg + 12.00 %"). We extract the ad-valorem
    // portion. Specific-duty-only lines (EUR/kg) can't be applied without
    // unit weight, so we return null and let the caller fall back.
    const expr = (mfn.attributes && mfn.attributes.duty_expression) || '';
    const pctMatch = String(expr).match(/(\d+(?:\.\d+)?)\s*%/);
    if (!pctMatch) return null;
    const rate = parseFloat(pctMatch[1]) / 100;
    if (!Number.isFinite(rate) || rate < 0 || rate > 2) return null;

    return {
      rate,
      source: 'uk-trade-tariff',                       // honest about provenance
      sourceLabel: 'UK Trade Tariff (sanity-check; EU may differ)',
      asOf: new Date().toISOString().slice(0, 10),
      raw: { dutyExpression: expr, hs, origin },
    };
  } catch (_err) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Resolve a per-line duty rate from cache or upstream.
 *
 * Returns:
 *   { rate, source, sourceLabel, asOf, fromCache, stale } when found.
 *   null                                                  when no data
 *                                                          (caller falls back).
 *
 * Behaviour:
 *   - Invalid HS/origin → null immediately, no upstream call.
 *   - Fresh cache hit → returned with fromCache=true.
 *   - Stale cache + upstream success → cache refreshed, fresh value returned.
 *   - Stale cache + upstream failure → stale value returned with stale=true.
 *   - No cache + upstream failure → null.
 *
 * The optional opts.skipUpstream=true skips the network call entirely (used
 * in tests + to keep request-path latency bounded when a chapter estimate
 * is acceptable).
 */
async function lookupHsRate(hsCode, originIso, opts = {}) {
  const hs = normaliseHs(hsCode);
  const origin = normaliseOrigin(originIso);
  if (!hs || !origin) return null;

  const key = cacheKey(hs, origin);
  let cached = null;
  try {
    cached = await kv.getJson(key);
  } catch (_err) {
    cached = null;
  }

  // Cache entry shape: { rate, source, sourceLabel, asOf, savedAt }
  const now = Math.floor(Date.now() / 1000);
  const fresh =
    cached && cached.savedAt && now - cached.savedAt < CACHE_TTL_SECONDS;

  if (fresh) {
    return { ...cached, fromCache: true, stale: false };
  }

  if (opts.skipUpstream) {
    // No fresh cache and caller asked us not to hit upstream.
    if (cached) return { ...cached, fromCache: true, stale: true };
    return null;
  }

  const fresh_ = await fetchUpstreamRate(hs, origin);
  if (fresh_) {
    const record = { ...fresh_, savedAt: now };
    try {
      await kv.setJson(key, record, STALE_TTL_SECONDS);
    } catch (_err) {
      // Cache write failure is non-fatal — just return the value.
    }
    return { ...fresh_, fromCache: false, stale: false };
  }

  // Upstream failed. If we have a stale cache entry, return it.
  if (cached) return { ...cached, fromCache: true, stale: true };
  return null;
}

/**
 * Generate a deep link into the public EU TARIC consultation portal for a
 * given HS code + origin. Always safe to surface as a "verify on TARIC"
 * link in result UIs — no network call, no caching.
 */
function taricVerifyUrl(hsCode, originIso) {
  const hs = normaliseHs(hsCode);
  if (!hs) return null;
  // The TARIC consultation portal accepts a goods code query. Origin is
  // surfaced via a separate filter; including it as a hash fragment helps
  // a curious user filter manually but doesn't drive the search.
  const origin = normaliseOrigin(originIso);
  const base = `https://taric.ec.europa.eu/taric3-public/online/goods?GoodsCode=${hs}&Country=ALL`;
  return origin ? `${base}#origin=${origin}` : base;
}

module.exports = {
  lookupHsRate,
  taricVerifyUrl,
  normaliseHs,
  normaliseOrigin,
  // Test seam: lets unit tests stub the upstream without monkey-patching
  // global fetch.
  _fetchUpstreamRate: fetchUpstreamRate,
  _cacheKey: cacheKey,
  _CACHE_TTL_SECONDS: CACHE_TTL_SECONDS,
  _STALE_TTL_SECONDS: STALE_TTL_SECONDS,
};
