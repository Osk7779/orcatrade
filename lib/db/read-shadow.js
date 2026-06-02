// Read-shadow: compare KV reads against the Postgres mirror.
//
// Apex II / III plan A2 — step 1 toward the Postgres-primary cutover.
//
// Today (2026-06-01) Postgres is a dual-write mirror behind KV: every
// mutation that hits the KV-primary path also fires a best-effort
// PG write (events, actuals, saved plans, portfolios, drafts,
// snapshots, agent memory). Nobody has measured how often the two
// agree, which is the precondition for confidently flipping PG to
// primary. The "built-but-inert" framing applies — the dual-write
// machinery exists but its integrity is unverified.
//
// What this module does
// ─────────────────────
//   shadowCompare({ name, kvValue, pgFetcher, projector? })
//
// Runs `pgFetcher()` best-effort. When it returns, projects both
// the KV value and the PG result through `projector(value)` (default
// identity), compares the projections via canonical JSON, and emits
// one of three structured log lines:
//   { event: 'db_shadow_match',       name }
//   { event: 'db_shadow_divergence',  name, divergedKeys, kvProjection, pgProjection }
//   { event: 'db_shadow_unavailable', name, reason }
//
// All paths are non-throwing and return undefined — the caller's
// hot path (the KV read) is the only thing that matters; the PG
// read is observability-only.
//
// Why opt-in
// ──────────
// PG reads cost a round-trip each. Mass-enabling read-shadow doubles
// read traffic. The env flag `ORCATRADE_SHADOW_PG` (truthy → enabled)
// gates participation so we can stage the rollout per handler. CI
// and dev default to OFF so the existing test suite stays hermetic.
//
// Why "projector"
// ───────────────
// KV records carry per-store metadata (TTL hints, served-from-cache
// markers, raw email) that the PG mirror legitimately doesn't. A
// projector function lets each call-site strip the noise so the
// comparison answers "do the durable-truth fields agree?" rather
// than "are the in-memory shapes byte-identical?".
//
// Why "best-effort"
// ─────────────────
// PG outage / slow PG / pooler exhaustion must NEVER degrade the
// customer-facing read. A swallowed exception + an `unavailable`
// log line is the right shape — the divergence-rate metric will
// show "X% reads couldn't shadow-check today" rather than X% 5xx.

'use strict';

const log = require('../log').withContext({ module: 'db-shadow' });

function isEnabled() {
  return !!process.env.ORCATRADE_SHADOW_PG;
}

// Canonical JSON: sorted keys at every depth so two structurally
// equal objects serialise identically. Dates → ISO strings (PG
// driver emits Date objects; KV emits strings; without this the
// shadow log would scream "everything differs" on the first read).
function canonical(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonical(value[key]);
    }
    return out;
  }
  return value;
}

function jsonEq(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

// Top-level keys whose canonical projections differ between the
// two sides. Useful as a tight diagnostic in the log line — the
// full projections are also logged so the divergence is reproducible.
function divergedKeys(a, b) {
  const out = [];
  const ak = a && typeof a === 'object' ? Object.keys(a) : [];
  const bk = b && typeof b === 'object' ? Object.keys(b) : [];
  const keys = new Set([...ak, ...bk]);
  for (const k of keys) {
    if (!jsonEq(a ? a[k] : undefined, b ? b[k] : undefined)) out.push(k);
  }
  return out.sort();
}

/**
 * Compare a KV-canonical value against a PG-fetched value, log the
 * outcome, and return nothing. Never throws.
 *
 * @param {object} input
 * @param {string} input.name           — read identity, e.g. 'saved-plans.getPlan'
 * @param {*}      input.kvValue        — the canonical (KV) result the caller already has
 * @param {Function} input.pgFetcher    — async () => pg result, or null/undefined
 * @param {Function} [input.projector]  — (v) => projected v; defaults to identity
 * @returns {Promise<void>}
 */
async function shadowCompare({ name, kvValue, pgFetcher, projector }) {
  if (!isEnabled()) return;
  if (!name || typeof name !== 'string') return;
  if (typeof pgFetcher !== 'function') return;

  let pgValue;
  try {
    pgValue = await pgFetcher();
  } catch (err) {
    log.warn('db_shadow_unavailable', {
      event: 'db_shadow_unavailable',
      name,
      reason: 'pgFetcher threw',
      err: err && err.message,
    });
    return;
  }

  const proj = typeof projector === 'function' ? projector : (v) => v;
  let kvProj, pgProj;
  try {
    kvProj = proj(kvValue);
    pgProj = proj(pgValue);
  } catch (err) {
    log.warn('db_shadow_unavailable', {
      event: 'db_shadow_unavailable',
      name,
      reason: 'projector threw',
      err: err && err.message,
    });
    return;
  }

  // A null/undefined PG result is "unavailable" rather than
  // "divergent" — the PG mirror may simply not have caught up yet
  // (eventual-consistency under dual-write), or the row was pruned.
  // Either way it's a different signal from "the rows disagree."
  if (pgProj == null && kvProj != null) {
    log.warn('db_shadow_unavailable', {
      event: 'db_shadow_unavailable',
      name,
      reason: 'pg returned null but kv had a value',
    });
    return;
  }
  if (pgProj == null && kvProj == null) {
    log.info('db_shadow_match', { event: 'db_shadow_match', name });
    return;
  }

  if (jsonEq(kvProj, pgProj)) {
    log.info('db_shadow_match', { event: 'db_shadow_match', name });
    return;
  }

  const keys = divergedKeys(kvProj, pgProj);
  log.warn('db_shadow_divergence', {
    event: 'db_shadow_divergence',
    name,
    divergedKeys: keys,
    kvProjection: kvProj,
    pgProjection: pgProj,
  });
}

module.exports = {
  shadowCompare,
  isEnabled,
  // Test surface
  _canonical: canonical,
  _jsonEq: jsonEq,
  _divergedKeys: divergedKeys,
};
