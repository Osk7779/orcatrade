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
 * Network only. The shape-parsing happens in `parseUpstreamResponse`
 * which is unit-testable on its own.
 */
async function fetchUpstreamRate(hs, origin) {
  // Hard kill-switch: lets tests, CI, and local dev opt out of the
  // outbound HTTP entirely. Used by `npm test` (set in package.json) so
  // example-plan generation doesn't fan out into N real fetches.
  if (process.env.ORCATRADE_DISABLE_LIVE_TARIC) return null;

  // The UK Trade Tariff exposes measures at multiple HS depths. For most
  // commodities the canonical MFN rate sits on the parent heading (the
  // first 4 digits), not the 10-digit leaf. We try /commodities/<full>
  // first (gives sub-heading precision when present) and fall back to
  // /headings/<4-digit> if the 10-digit lookup returned no usable measure.
  const attempts = [`${UPSTREAM_BASE}/commodities/${hs}`];
  if (hs.length >= 4) attempts.push(`${UPSTREAM_BASE}/headings/${hs.slice(0, 4)}`);

  for (const url of attempts) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/vnd.api+json' },
      });
      if (!res.ok) continue;
      const body = await res.json();
      const parsed = parseUpstreamResponse(body, { hs, origin });
      if (parsed) return parsed;
    } catch (_err) {
      // try next attempt
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

/**
 * Parse a UK Trade Tariff `/commodities/<hs>` JSON:API response into our
 * normalised rate record (or null when no usable MFN rate is found).
 *
 * The shape we walk:
 *   data: { type: 'commodity', attributes: {…} }
 *   included: [
 *     { type: 'measure', id, relationships: {
 *         measure_type: { data: { id: '103' } },          // 103 = third-country MFN
 *         duty_expression: { data: { id: '<expr-id>' } },
 *         geographical_area: { data: { id: '1011' } },    // 1011 = ERGA OMNES (all third countries)
 *       }, attributes: { origin, effective_start_date, … } },
 *     { type: 'duty_expression', id: '<expr-id>',
 *       attributes: { base: '12.00 %', formatted_base: '<span>12.00</span> %' } },
 *     …
 *   ]
 *
 * Notes:
 *   - There can be multiple type-103 measures (different geographical
 *     areas, different validity windows). We pick the first one with a
 *     parseable ad-valorem rate that's also currently in effect.
 *   - Specific-duty-only lines (e.g. "EUR 5.00 / kg" with no `%`) return
 *     null — the caller falls back to the chapter estimator.
 *   - The HTML in `formatted_base` is stripped before regex matching so
 *     we don't get fooled by attribute strings.
 */
function parseUpstreamResponse(body, ctx = {}) {
  const included = Array.isArray(body && body.included) ? body.included : [];
  // Index duty_expression entries by id for O(1) lookup.
  const exprById = Object.create(null);
  for (const entry of included) {
    if (entry && entry.type === 'duty_expression' && entry.id) exprById[entry.id] = entry;
  }
  const now = Date.now();
  for (const entry of included) {
    if (!entry || entry.type !== 'measure') continue;
    const rels = entry.relationships || {};
    const measureType = rels.measure_type && rels.measure_type.data && String(rels.measure_type.data.id);
    if (measureType !== '103') continue;
    // Effective window check — skip future-dated or expired measures.
    const start = entry.attributes && entry.attributes.effective_start_date;
    const end = entry.attributes && entry.attributes.effective_end_date;
    if (start && new Date(start).getTime() > now) continue;
    if (end && new Date(end).getTime() < now) continue;
    const exprRef = rels.duty_expression && rels.duty_expression.data && rels.duty_expression.data.id;
    if (!exprRef || !exprById[exprRef]) continue;
    const attrs = exprById[exprRef].attributes || {};
    const raw = attrs.base || attrs.formatted_base || '';
    const cleaned = String(raw).replace(/<[^>]+>/g, '');
    const pctMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*%/);
    if (!pctMatch) continue;
    const rate = parseFloat(pctMatch[1]) / 100;
    if (!Number.isFinite(rate) || rate < 0 || rate > 2) continue;
    return {
      rate,
      source: 'uk-trade-tariff',
      sourceLabel: 'UK Trade Tariff (sanity-check; EU may differ)',
      asOf: new Date().toISOString().slice(0, 10),
      raw: { dutyExpression: cleaned, hs: ctx.hs, origin: ctx.origin },
    };
  }
  return null;
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
  _parseUpstreamResponse: parseUpstreamResponse,
  _cacheKey: cacheKey,
  _CACHE_TTL_SECONDS: CACHE_TTL_SECONDS,
  _STALE_TTL_SECONDS: STALE_TTL_SECONDS,
};
