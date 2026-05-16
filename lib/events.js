// Event log (Sprint 36).
//
// A small, KV-backed append-only log of structured product events. Used by
// the conversion analytics dashboard at /dashboard/leads/ to surface which
// categories/origins/destinations actually convert through the wizard.
//
// Why a single capped array (not a list / stream):
//   - We don't have native list ops in our KV abstraction
//   - 5,000 events ≈ months of headroom at current volumes
//   - Aggregation over 5k items in JS is microseconds — no need for a TSDB
//   - Old events fall off the tail naturally; no cron required
//
// Race condition note: read-modify-write is not atomic. At our throughput
// (single-digit submissions per day) the loss probability is negligible;
// upgrade to Redis LPUSH + LTRIM if/when volume warrants.

'use strict';

const kv = require('./intelligence/kv-store');

const EVENT_LOG_KEY = 'events:log';
const MAX_EVENTS = 5000;
const EVENT_TTL_DAYS = 365;

const ALLOWED_TYPES = new Set([
  'import_plan_generated',
  'plan_saved',
  'plan_share_opened',
  'auth_signin',
  'auth_signup',
]);

function nowIso() { return new Date().toISOString(); }

async function record(type, payload = {}) {
  if (!type || typeof type !== 'string') return false;
  if (!ALLOWED_TYPES.has(type)) return false;
  const event = {
    type,
    at: nowIso(),
    ...payload,
  };
  try {
    const existing = (await kv.get(EVENT_LOG_KEY)) || [];
    const arr = Array.isArray(existing) ? existing : [];
    const updated = [event, ...arr].slice(0, MAX_EVENTS);
    await kv.set(EVENT_LOG_KEY, updated, { ttlSeconds: EVENT_TTL_DAYS * 24 * 60 * 60 });
    return true;
  } catch (_err) {
    // Event recording must never fail an upstream request
    return false;
  }
}

async function list({ type = null, limit = 500, since = null } = {}) {
  const existing = (await kv.get(EVENT_LOG_KEY)) || [];
  let arr = Array.isArray(existing) ? existing : [];
  if (type) arr = arr.filter(e => e.type === type);
  if (since) {
    const cutoff = Date.parse(since);
    if (Number.isFinite(cutoff)) arr = arr.filter(e => Date.parse(e.at) >= cutoff);
  }
  return arr.slice(0, Math.max(1, Math.min(MAX_EVENTS, Number(limit) || 500)));
}

// ── Aggregation helpers ──────────────────────────────

function topN(map, n = 5) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

function bucketByDay(events) {
  const map = new Map();
  for (const e of events) {
    const day = (e.at || '').slice(0, 10);
    if (!day) continue;
    map.set(day, (map.get(day) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function aggregate(events) {
  const total = events.length;
  if (total === 0) {
    return {
      total: 0,
      byType: [], byLocale: [], byCategory: [], byOrigin: [], byDestination: [],
      topRoutes: [], byDay: [], emailCaptured: 0, meanLandedEur: null, recent: [],
      // Sprint G: HS-code engagement on import_plan_generated events
      hsCodeProvided: 0, hsCodeProvidedRate: 0, byDutyMfnSource: [],
    };
  }

  const byType = new Map();
  const byLocale = new Map();
  const byCategory = new Map();
  const byOrigin = new Map();
  const byDestination = new Map();
  const byRoute = new Map();
  const byDutyMfnSource = new Map();
  let emailCaptured = 0;
  let landedSum = 0;
  let landedCount = 0;
  // Sprint G: track HS-code engagement only on import_plan_generated
  // events (plan_saved + others don't carry the input).
  let planEvents = 0;
  let hsCodeProvided = 0;

  for (const e of events) {
    byType.set(e.type, (byType.get(e.type) || 0) + 1);
    if (e.locale) byLocale.set(e.locale, (byLocale.get(e.locale) || 0) + 1);
    const inputs = e.inputs || {};
    if (inputs.productCategory) byCategory.set(inputs.productCategory, (byCategory.get(inputs.productCategory) || 0) + 1);
    if (inputs.originCountry) byOrigin.set(inputs.originCountry, (byOrigin.get(inputs.originCountry) || 0) + 1);
    if (inputs.destinationCountry) byDestination.set(inputs.destinationCountry, (byDestination.get(inputs.destinationCountry) || 0) + 1);
    if (inputs.originCountry && inputs.destinationCountry) {
      const route = `${inputs.originCountry}→${inputs.destinationCountry}`;
      byRoute.set(route, (byRoute.get(route) || 0) + 1);
    }
    if (e.emailProvided) emailCaptured++;
    if (Number.isFinite(Number(e.landedTotal)) && Number(e.landedTotal) > 0) {
      landedSum += Number(e.landedTotal);
      landedCount++;
    }
    if (e.type === 'import_plan_generated') {
      planEvents++;
      if (e.hsCodeProvided) hsCodeProvided++;
      const src = e.dutyMfnSource || 'chapter-estimator';
      byDutyMfnSource.set(src, (byDutyMfnSource.get(src) || 0) + 1);
    }
  }

  return {
    total,
    byType: topN(byType, 10),
    byLocale: topN(byLocale, 5),
    byCategory: topN(byCategory, 10),
    byOrigin: topN(byOrigin, 10),
    byDestination: topN(byDestination, 10),
    topRoutes: topN(byRoute, 10),
    byDay: bucketByDay(events),
    emailCaptured,
    emailCaptureRate: total ? Math.round((emailCaptured / total) * 1000) / 10 : 0,
    meanLandedEur: landedCount ? Math.round(landedSum / landedCount) : null,
    // Sprint G — % of plan-generation events where the user supplied
    // an 8+ digit HS code (triggers the Sprint D live-rate path).
    hsCodeProvided,
    hsCodeProvidedRate: planEvents ? Math.round((hsCodeProvided / planEvents) * 1000) / 10 : 0,
    byDutyMfnSource: topN(byDutyMfnSource, 5),
    recent: events.slice(0, 10).map(e => ({
      type: e.type,
      at: e.at,
      locale: e.locale || null,
      route: (e.inputs && e.inputs.originCountry && e.inputs.destinationCountry)
        ? `${e.inputs.originCountry}→${e.inputs.destinationCountry}`
        : null,
      category: (e.inputs && e.inputs.productCategory) || null,
      landedTotal: e.landedTotal || null,
      emailProvided: !!e.emailProvided,
    })),
  };
}

module.exports = {
  EVENT_LOG_KEY,
  MAX_EVENTS,
  ALLOWED_TYPES,
  record,
  list,
  aggregate,
  topN,
  bucketByDay,
};
