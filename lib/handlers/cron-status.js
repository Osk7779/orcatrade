'use strict';

// Sprint 52 — org-admin-facing cron observability surface.
//
// The cron-observability-v1 sprint wrote cron:lastRun:<job> +
// cron:lastError:<job> KV keys on every cron tick; an existing
// /api/cron/status endpoint exposes them BUT gates on a platform-
// admin token (lib/admin-auth.js — must be in
// ORCATRADE_ADMIN_EMAILS). That's the right surface for internal
// ops staff but wrong for an org admin watching the platform
// stack their workflow depends on.
//
// Sprint 52 ships a session-authed, org-admin-gated mirror:
//   GET /api/cron-status → per-job status with derived health.
// Same KV reads as the platform-admin endpoint, no new state.
// Cron data is platform-wide (NOT org-scoped) — any org's admin
// can see it; the gate is just "is this caller an admin in
// SOMEONE'S org," same role bar as operator-config / api-keys /
// webhooks settings.

const crypto = require('crypto');
const auth = require('../auth');
const orgs = require('../orgs');
const rbac = require('../rbac');
const log = require('../log');

const OPS_REVIEW_ROLES = new Set(['admin', 'owner']);
const ORG_ID_HEADER = 'x-orcatrade-org';

// Derived-health staleness windows (in ms). Per-job staleness is
// computed against an expected cadence; for jobs that we KNOW
// run < 1/day, "stale" fires after 36h; for hourly+ jobs after
// 90 min. v1 uses one global STALE_AFTER_MS (36h) — works for the
// majority of jobs (daily / weekly / monthly). A future sprint can
// add per-job expected cadence overrides.
const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

function jsonResponse(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

function emailHash(email) {
  return crypto.createHash('sha256').update(String(email).toLowerCase().trim()).digest('hex').slice(0, 16);
}

async function numericOrgIdFor(org) {
  if (typeof org.dbId === 'number') return org.dbId;
  const dbClient = require('../db/client');
  if (!dbClient.isConfigured()) return null;
  const row = await dbClient.queryOne(
    `SELECT id FROM organisations WHERE external_id = $1`,
    [org.id],
  );
  return row ? Number(row.id) : null;
}

async function resolveOrg(req, user) {
  const explicit = String(req.headers[ORG_ID_HEADER] || '').trim();
  const userOrgs = await orgs.listOrgsForEmail(user.email);
  if (!Array.isArray(userOrgs) || userOrgs.length === 0) {
    return { ok: false, status: 403, error: 'No organisation found for this user' };
  }
  if (explicit) {
    const match = userOrgs.find((o) => String(o.id) === explicit);
    if (!match) return { ok: false, status: 403, error: `Not a member of org "${explicit}"` };
    return { ok: true, org: match };
  }
  return { ok: true, org: userOrgs[0] };
}

async function ensureAuthedAdmin(req, res) {
  const user = await auth.getCurrentUser(req);
  if (!user) {
    jsonResponse(res, 401, { error: 'Sign in required' });
    return null;
  }
  const resolved = await resolveOrg(req, user);
  if (!resolved.ok) {
    jsonResponse(res, resolved.status, { error: resolved.error });
    return null;
  }
  const orgIdNumeric = await numericOrgIdFor(resolved.org);
  if (!Number.isInteger(orgIdNumeric)) {
    jsonResponse(res, 503, { error: 'Organisation not yet mirrored to Postgres — please retry' });
    return null;
  }
  const role = await orgs.getMemberRole(resolved.org.id, user.email).catch(() => null);
  const canonical = String(rbac.canonicalRole(role || ''));
  if (!OPS_REVIEW_ROLES.has(canonical)) {
    jsonResponse(res, 403, {
      error: 'Forbidden: only owner / admin members can view cron status',
      role: canonical || null,
    });
    return null;
  }
  return { user, emailHash: emailHash(user.email), orgIdNumeric };
}

// Derive a job's health classification from the raw KV state.
// Categories:
//   'ok'    — last run was a success AND within STALE_AFTER_MS
//   'error' — last attempt thrown OR last summary !ok
//   'stale' — last successful run is older than STALE_AFTER_MS
//   'never' — no last-run record (job has never fired since the
//             cron-observability KV was added, OR a brand-new job
//             that hasn't run yet)
//
// 'error' wins over 'stale' so an active failure doesn't get
// hidden behind an age check.
function classifyHealth({ lastRun, lastError, nowMs }) {
  // No record at all.
  if (!lastRun && !lastError) return 'never';
  // Last run threw OR returned ok:false.
  if (lastError && (!lastRun || Date.parse(lastError.ranAt) >= Date.parse(lastRun.ranAt))) {
    return 'error';
  }
  if (lastRun && lastRun.ok === false) return 'error';
  // No success record at all.
  if (!lastRun) return 'never';
  const ageMs = nowMs - Date.parse(lastRun.completedAt || lastRun.ranAt);
  if (ageMs > STALE_AFTER_MS) return 'stale';
  return 'ok';
}

module.exports = async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${ORG_ID_HEADER}`);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { error: 'Method not allowed on /api/cron-status' });
  }
  const ctx = await ensureAuthedAdmin(req, res);
  if (!ctx) return;

  try {
    // Read the canonical JOBS map from the cron handler. We pull
    // the keys (job names) and then read each one's KV record.
    // Lazy-required so the boot order stays clean.
    const cronHandler = require('./cron');
    const jobNames = Object.keys(cronHandler.JOBS).sort();
    const kv = require('../intelligence/kv-store');
    const nowMs = Date.now();
    /** @type {Array<any>} */
    const jobs = [];
    for (const name of jobNames) {
      let lastRun = null;
      let lastError = null;
      try {
        lastRun = (await kv.get(cronHandler.CRON_LAST_RUN_PREFIX + name)) || null;
        lastError = (await kv.get(cronHandler.CRON_LAST_ERROR_PREFIX + name)) || null;
      } catch (_) {
        // KV blip on one job key shouldn't blank the whole page.
        // Surface 'never' rather than 500.
      }
      jobs.push({
        name,
        health: classifyHealth({ lastRun, lastError, nowMs }),
        lastRun,
        lastError,
      });
    }
    return jsonResponse(res, 200, {
      ok: true,
      asOf: new Date(nowMs).toISOString(),
      staleAfterMs: STALE_AFTER_MS,
      jobs,
    });
  } catch (err) {
    log.error('cron-status handler threw', {
      err: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};

module.exports.classifyHealth = classifyHealth;
module.exports.STALE_AFTER_MS = STALE_AFTER_MS;
