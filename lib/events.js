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
const hash = require('./hash');

const EVENT_LOG_KEY = 'events:log';
const MAX_EVENTS = 5000;
const EVENT_TTL_DAYS = 365;

const ALLOWED_TYPES = new Set([
  'import_plan_generated',
  'plan_saved',
  'plan_share_opened',
  'auth_signin',
  'auth_signup',
  // Sprint J — Founding 10 pilot applications.
  'founding_applied',
  // Sprint BG-6.5 — per-Anthropic-call cost telemetry. Carries
  // { agent, promptVersion, model, costCents, latencyMs, inputTokens,
  //   outputTokens, cacheReadTokens, stopReason, requestId } — no PII.
  // Used by /dashboard/ai/ to render weekly spend + per-agent breakdown.
  'ai_call',
  // Sprint BG-5.5 — audit log for security-sensitive operations.
  // Every entry below answers a "who did what, when?" question that an
  // auditor (FSA, investor due-diligence, partner DPA review) or a user
  // disputing a session ("I never logged in from there") will ask.
  // Email field, when present, is hashed by buildPgInsertParams before
  // landing in Postgres — KV keeps the raw email for /dashboard/audit.
  'auth_logout',
  'auth_revoke_all',
  'org_created',
  'org_member_invited',
  'org_member_removed',
  'org_ownership_transferred',
  'account_exported',
  'account_deleted',
  // Sprint BG-1.4 — Track 1 reality-check loop. actual_reported is the
  // signal every customer sends back to the platform: "your estimate
  // was off by X%". actual_cleared lets them undo a mistaken entry.
  // The audit dashboard surfaces these so we can spot calibration
  // drift before customers see it as a quote problem.
  'actual_reported',
  'actual_cleared',
  // Sprint BG-3.3 phase 1 — admin manually assigns/clears a tier
  // override for an org. Carries { orgId, tierId, source } — never
  // raw email. The audit row is how we trace "who approved this
  // Team-plan upgrade" without storing it in Stripe metadata yet.
  'org_tier_assigned',
  'org_tier_cleared',
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
  // ── Primary: KV ──────────────────────────────────────
  // The dashboards still read from KV today; PG is the long-term home
  // (Sprint BG-2.2). If the KV write fails, the function returns false
  // and the caller knows to retry — same as before.
  try {
    const existing = (await kv.get(EVENT_LOG_KEY)) || [];
    const arr = Array.isArray(existing) ? existing : [];
    const updated = [event, ...arr].slice(0, MAX_EVENTS);
    await kv.set(EVENT_LOG_KEY, updated, { ttlSeconds: EVENT_TTL_DAYS * 24 * 60 * 60 });
  } catch (_err) {
    // KV failure = primary failure. Don't fire PG either; report false.
    return false;
  }

  // ── Secondary: Postgres (Sprint BG-2.2) ──────────────
  // Fire-and-forget. Once dashboards migrate to read from PG (follow-up
  // sprint), this row is what powers them past the 5000-event KV cap.
  // KV-only mode (DATABASE_URL unset) is a no-op — recordPg returns
  // { written: false, reason: 'not-configured' } without throwing.
  recordPg(type, payload).catch(() => { /* never propagate to caller */ });

  return true;
}

// Pure function: takes (type, payload) and returns the parameter tuple
// for the INSERT INTO events statement. Email is hashed via lib/hash.js
// and stripped from the jsonb payload so raw emails never land in
// Postgres. Pseudonymised "deleted-…@anonymised.local" emails pass
// through unchanged (they're the post-Article-17 identity, not PII).
// Exported for test surface — the SQL execution itself is in recordPg.
function buildPgInsertParams(type, payload) {
  const safePayload = (payload && typeof payload === 'object') ? { ...payload } : {};
  let emailHash = null;
  if (safePayload.email) {
    if (hash.isAlreadyPseudonym(safePayload.email)) {
      // Don't re-hash a pseudonym — keep it as the identity column verbatim.
      emailHash = String(safePayload.email);
    } else {
      emailHash = hash.emailHash(safePayload.email);
    }
    delete safePayload.email;  // raw email NEVER goes into pg.events.payload
  }
  return {
    type,
    emailHash,
    payloadJson: JSON.stringify(safePayload),
  };
}

async function recordPg(type, payload) {
  // Lazy-required so the events module loads cleanly in test envs that
  // don't have @neondatabase/serverless installed.
  let db;
  try { db = require('./db/client'); }
  catch (_) { return { written: false, reason: 'db-module-unavailable' }; }
  if (!db.isConfigured()) return { written: false, reason: 'not-configured' };

  const { type: t, emailHash, payloadJson } = buildPgInsertParams(type, payload);
  try {
    await db.query(
      'INSERT INTO events (type, email_hash, payload) VALUES ($1, $2, $3::jsonb)',
      [t, emailHash, payloadJson],
    );
    return { written: true };
  } catch (err) {
    return { written: false, err: err.message };
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
      // Sprint J.3: Founding 10 pipeline
      foundingApplied: 0, foundingWaitlist: 0, foundingRecent: [],
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

  // Sprint J.3: pull Founding 10 stats off the same event stream so the
  // leads dashboard can surface them as a tile + recent-applications panel.
  // Events arrive newest-first per list() — preserve that order for the
  // recent panel (capped at 10).
  const foundingEvents = events.filter(e => e.type === 'founding_applied');
  const foundingApplied = foundingEvents.length;
  const foundingWaitlist = foundingEvents.filter(e => e.waitlist === true).length;
  const foundingRecent = foundingEvents.slice(0, 10).map(e => ({
    at: e.at,
    name: e.name || null,
    company: e.company || null,
    // KV rows carry raw email; PG rows (BG-2.2 dual-write) carry emailHash
    // only. Surface both so the dashboard can show whichever exists.
    email: e.email || null,
    emailHash: e.emailHash || null,
    role: e.role || null,
    monthlyValueEur: e.monthlyValueEur || null,
    waitlist: !!e.waitlist,
  }));

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
    // Sprint J.3: Founding 10 pipeline
    foundingApplied,
    foundingWaitlist,
    foundingRecent,
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

// Optional read path from Postgres. Returns events newest-first.
// Used by future-sprint code that wants the full unbounded corpus
// (past the 5000-event KV cap). Today's dashboards still read from
// KV via list() above; this is opt-in via events.listFromPg().
async function listFromPg({ type = null, limit = 500, since = null } = {}) {
  let db;
  try { db = require('./db/client'); }
  catch (_) { return []; }
  if (!db.isConfigured()) return [];

  const safeLimit = Math.max(1, Math.min(MAX_EVENTS, Number(limit) || 500));
  const whereClauses = [];
  const params = [];
  let i = 1;
  if (type) {
    whereClauses.push(`type = $${i++}`);
    params.push(type);
  }
  if (since) {
    const cutoff = new Date(since);
    if (!Number.isNaN(cutoff.getTime())) {
      whereClauses.push(`created_at >= $${i++}`);
      params.push(cutoff.toISOString());
    }
  }
  const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
  params.push(safeLimit);
  const sql = `
    SELECT type, email_hash, payload, created_at
    FROM events
    ${where}
    ORDER BY created_at DESC
    LIMIT $${i}
  `.trim();
  try {
    const rows = await db.query(sql, params);
    // Flatten back to the same shape KV consumers expect:
    //   { type, at, ...payload }
    return rows.map(r => ({
      type: r.type,
      at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      ...(typeof r.payload === 'string' ? JSON.parse(r.payload) : (r.payload || {})),
      // email_hash surfaces here too — useful for the audit dashboard
      // which already redacts to a hash before display.
      ...(r.email_hash ? { emailHash: r.email_hash } : {}),
    }));
  } catch (_) {
    return [];
  }
}

// Unified read path — Sprint BG-2.3.
//
// Picks the storage layer at runtime: Postgres when DATABASE_URL is set
// (durable + unbounded), KV otherwise (legacy + capped at 5000 rows).
// Dashboards (audit, leads, ai) call this instead of list() directly so
// they automatically benefit from the durable corpus without a code
// change at the call site.
//
// PII contract holds either way:
//   - KV rows carry the raw `email` field (handlers redact at display)
//   - PG rows carry `emailHash` only (stripped before INSERT — see
//     buildPgInsertParams in BG-2.2). Handlers see the hash and skip
//     the hashing pass.
async function listUnified(opts = {}) {
  let db;
  try { db = require('./db/client'); }
  catch (_) { db = null; }
  if (db && db.isConfigured()) {
    const rows = await listFromPg(opts);
    // Defensive: if PG returned [] AND we *think* there should be data,
    // fall back to KV. Today this almost always means "PG is empty
    // because the dual-write only fires for new events since BG-2.2".
    // Once historical KV events have aged out, we can drop the fallback.
    if (rows.length === 0) {
      const kvRows = await list(opts);
      if (kvRows.length > 0) return kvRows;
    }
    return rows;
  }
  return await list(opts);
}

module.exports = {
  EVENT_LOG_KEY,
  MAX_EVENTS,
  ALLOWED_TYPES,
  record,
  recordPg,
  buildPgInsertParams,
  list,
  listFromPg,
  listUnified,
  aggregate,
  topN,
  bucketByDay,
};
