// Retention enforcement — apex plan P1.I.
//
// The plan's phrasing: "Retention enforcement. Automated purge per
// policy per table; nightly verification job."
//
// Two halves:
//
//   1. PURGE — walks each PG table that holds time-bound data and
//      deletes rows older than the policy. Idempotent: safe to run
//      twice; second pass is a no-op.
//
//   2. VERIFY — asserts the policy is being honoured: no row in any
//      retention-bound table is older than (policy + 1 day grace).
//      Returns a verdict the nightly cron emits to ops.
//
// KV-side retention is handled by Upstash TTLs (every counter and
// ephemeral key has ttlSeconds per PR #67's hygiene gate); this module
// covers the PG-side durable corpus that has no automatic expiry.
//
// Source of truth for retention periods: docs/security/retention-policy.md.
// If a period changes there, also update RETENTION_POLICIES below in the
// same commit.

'use strict';

const log = require('./log').withContext({ module: 'retention' });

// Per-table retention configuration. Each entry:
//   table      — PG table name
//   timeColumn — DATE/TIMESTAMP column used for the age check
//   maxAgeDays — rows STRICTLY older than this are eligible for purge
//   keepNewest — optional cap: ALSO keep only the newest N rows per
//                user, regardless of age (e.g. "50 plans per user max"
//                from data-flow.md)
//   userColumn — column used to group when keepNewest is set
//   reason     — short prose for the policy doc and audit row
const RETENTION_POLICIES = Object.freeze({
  events: {
    table: 'events',
    timeColumn: 'created_at',
    maxAgeDays: 365,
    reason: 'Event log retained 1 year per docs/security/data-flow.md; KV-side has the same TTL.',
  },
  saved_plans: {
    table: 'saved_plans',
    timeColumn: 'created_at',
    maxAgeDays: 365,
    keepNewest: 50,
    userColumn: 'email_hash',
    reason: 'Per-user plan archive: 1 year + max 50 newest per user (data-flow.md). Older plans rolled off.',
  },
  saved_portfolios: {
    table: 'saved_portfolios',
    timeColumn: 'created_at',
    maxAgeDays: 365,
    keepNewest: 50,
    userColumn: 'email_hash',
    reason: 'Mirrors saved_plans retention; portfolios are the multi-SKU parent.',
  },
  actuals: {
    table: 'actuals',
    timeColumn: 'created_at',
    maxAgeDays: 365,
    reason: 'Reality-check reports retained 1 year for calibration analytics; older drop off when the parent plan does.',
  },
  monitoring_alerts: {
    table: 'monitoring_alerts',
    timeColumn: 'created_at',
    maxAgeDays: 180,
    reason: 'Operational alerts retained 6 months; older entries provide no incident-response value.',
  },
});

// Pure: given a current timestamp (Date) + a policy, return the
// cutoff ISO string. Rows where timeColumn < cutoff are purgeable.
function ageBasedCutoff(now, policy) {
  if (!policy || typeof policy.maxAgeDays !== 'number') {
    throw new TypeError('ageBasedCutoff: policy.maxAgeDays required');
  }
  const cutoff = new Date(now.getTime() - policy.maxAgeDays * 24 * 60 * 60 * 1000);
  return cutoff.toISOString();
}

// Pure: build the per-table purge SQL. Two flavours:
//   - simple age cutoff (events, actuals, monitoring_alerts)
//   - age cutoff PLUS keep-newest-N-per-user (plans, portfolios)
//
// Returns { sql, params } ready to pass to db.query().
function buildPurgeSql(policy, cutoffIso) {
  // Validate the table + column names are safe (parameterised SQL
  // doesn't bind identifiers, so we do an allowlist check here).
  if (!/^[a-z_][a-z0-9_]{0,63}$/i.test(policy.table)) {
    throw new Error(`Unsafe table name: ${policy.table}`);
  }
  if (!/^[a-z_][a-z0-9_]{0,63}$/i.test(policy.timeColumn)) {
    throw new Error(`Unsafe time column: ${policy.timeColumn}`);
  }

  // Treat keepNewest as opt-out via `undefined` / `null` only — any
  // explicit value (including 0) is validated. Otherwise a config
  // typo `keepNewest: 0` would silently drop to the simple-age path
  // and never raise.
  const keepUnset = policy.keepNewest === undefined || policy.keepNewest === null;
  if (keepUnset) {
    // Simple age cutoff.
    return {
      sql: `DELETE FROM ${policy.table} WHERE ${policy.timeColumn} < $1`,
      params: [cutoffIso],
    };
  }

  // Age cutoff OR not-in-the-newest-N-per-user. Either reason is
  // enough to purge.
  if (!Number.isInteger(policy.keepNewest) || policy.keepNewest <= 0) {
    throw new Error(`keepNewest must be a positive integer, got: ${policy.keepNewest}`);
  }
  if (!/^[a-z_][a-z0-9_]{0,63}$/i.test(policy.userColumn)) {
    throw new Error(`Unsafe user column: ${policy.userColumn}`);
  }
  // Use a window function to rank rows per user by recency; delete
  // anything ranked > keepNewest OR older than the cutoff.
  return {
    sql: `
      DELETE FROM ${policy.table}
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY ${policy.userColumn}
                   ORDER BY ${policy.timeColumn} DESC
                 ) AS rn
          FROM ${policy.table}
        ) ranked
        WHERE ranked.rn > $1
      )
      OR ${policy.timeColumn} < $2
    `,
    params: [policy.keepNewest, cutoffIso],
  };
}

// Pure: build the per-table verification SQL. Asserts NO row exists
// past the policy + 1 day grace. The grace allows the daily purge job
// to run before the verifier flags drift.
function buildVerifySql(policy, cutoffIso) {
  if (!/^[a-z_][a-z0-9_]{0,63}$/i.test(policy.table)) {
    throw new Error(`Unsafe table name: ${policy.table}`);
  }
  if (!/^[a-z_][a-z0-9_]{0,63}$/i.test(policy.timeColumn)) {
    throw new Error(`Unsafe time column: ${policy.timeColumn}`);
  }
  return {
    sql: `SELECT COUNT(*)::int AS overdue FROM ${policy.table} WHERE ${policy.timeColumn} < $1`,
    params: [cutoffIso],
  };
}

// One-day grace before the verifier flags drift. Daily purge runs at
// 03:00 UTC; verifier runs at 04:00 UTC; grace = 1 day past the
// policy means the verifier ignores rows that aged into purge-eligible
// status during the past 24 hours.
const VERIFY_GRACE_DAYS = 1;

function ageBasedVerifyCutoff(now, policy) {
  const cutoff = new Date(now.getTime() - (policy.maxAgeDays + VERIFY_GRACE_DAYS) * 24 * 60 * 60 * 1000);
  return cutoff.toISOString();
}

// Live (DB-touching) entry point. Iterates RETENTION_POLICIES, runs
// the purge SQL for each, returns a summary. Idempotent; safe on dry
// repeated runs.
async function runPurge(opts = {}) {
  const now = opts.now || new Date();
  const policies = opts.policies || RETENTION_POLICIES;

  let db;
  try { db = require('./db/client'); }
  catch (_) { return { ok: false, reason: 'db-module-unavailable' }; }
  if (!db.isConfigured()) {
    return { ok: false, reason: 'db-not-configured' };
  }

  const results = [];
  for (const [name, policy] of Object.entries(policies)) {
    const cutoff = ageBasedCutoff(now, policy);
    const { sql, params } = buildPurgeSql(policy, cutoff);
    try {
      const r = await db.query(sql, params);
      results.push({
        policy: name,
        table: policy.table,
        cutoff,
        purged: r && typeof r.rowCount === 'number' ? r.rowCount : (r && r.rows ? r.rows.length : 0),
        ok: true,
      });
    } catch (err) {
      log.error('retention purge failed', { policy: name, table: policy.table, err: err.message });
      results.push({ policy: name, table: policy.table, ok: false, err: err.message });
    }
  }
  return { ok: results.every(r => r.ok), now: now.toISOString(), results };
}

// Live verification — asserts no table has an overdue row.
async function runVerify(opts = {}) {
  const now = opts.now || new Date();
  const policies = opts.policies || RETENTION_POLICIES;

  let db;
  try { db = require('./db/client'); }
  catch (_) { return { ok: false, reason: 'db-module-unavailable' }; }
  if (!db.isConfigured()) {
    return { ok: false, reason: 'db-not-configured' };
  }

  const results = [];
  for (const [name, policy] of Object.entries(policies)) {
    const cutoff = ageBasedVerifyCutoff(now, policy);
    const { sql, params } = buildVerifySql(policy, cutoff);
    try {
      const r = await db.query(sql, params);
      const overdue = (r && r.rows && r.rows[0] && r.rows[0].overdue) || 0;
      results.push({
        policy: name,
        table: policy.table,
        cutoff,
        overdue,
        ok: overdue === 0,
      });
    } catch (err) {
      log.error('retention verify failed', { policy: name, table: policy.table, err: err.message });
      results.push({ policy: name, table: policy.table, ok: false, err: err.message });
    }
  }
  const overallOk = results.every(r => r.ok);
  if (!overallOk) {
    log.warn('retention verification found overdue rows', { results });
  }
  return { ok: overallOk, now: now.toISOString(), results };
}

module.exports = {
  RETENTION_POLICIES,
  VERIFY_GRACE_DAYS,
  ageBasedCutoff,
  ageBasedVerifyCutoff,
  buildPurgeSql,
  buildVerifySql,
  runPurge,
  runVerify,
};
