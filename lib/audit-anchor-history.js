// Anchor-history store — apex III2 (follow-on to PR #35).
//
// A single live anchor proves "the chain head right now is X." A
// rolling history of anchors proves "the chain head was X on day N-1,
// X' on day N, X'' on day N+1 — continuous and append-only." That's
// the load-bearing procurement claim: customers can show their own
// auditor a time-series of our chain heads that they pinned over
// weeks/months, and a future rewrite is detectable against their
// independently-stored copy.
//
// Storage layout
// ──────────────
//   KV key   `audit:anchor:history`
//   KV value JSON array of snapshots, NEWEST FIRST inside the array
//   Cap      MAX_SNAPSHOTS (90) — ≈ 3 months of daily snapshots
//   TTL      400 days — outlives the cap so a stale lookup still works
//
// Each snapshot:
//   {
//     savedAt:     ISO datetime when recordAnchorSnapshot ran
//     asOf:        ISO datetime the underlying anchor was generated
//     chainHead:   sha256 hex (or genesis when chain empty)
//     chainLength: integer
//     genesis:     anchor.genesis (frozen string; included for
//                  cross-snapshot verification even if we rotate
//                  the genesis constant in a future protocol bump)
//   }
//
// Why "best-effort"
// ─────────────────
// History is observability, not auth. A KV outage on
// recordAnchorSnapshot must not throw — the next cron tick retries.
// A KV outage on listAnchorSnapshots returns [] — the public history
// endpoint degrades-to-empty, which is honest and not a 5xx.

'use strict';

const kv = require('./intelligence/kv-store');
const auditAnchor = require('./handlers/audit-anchor');
const log = require('./log').withContext({ module: 'audit-anchor-history' });

const HISTORY_KEY = 'audit:anchor:history';
const MAX_SNAPSHOTS = 90;
const HISTORY_TTL_SECONDS = 400 * 24 * 60 * 60;

function nowIso() { return new Date().toISOString(); }

async function readHistory() {
  try {
    const raw = await kv.getJson(HISTORY_KEY);
    if (!Array.isArray(raw)) return [];
    return raw;
  } catch (err) {
    log.warn('readHistory failed', { err: err && err.message });
    return [];
  }
}

async function writeHistory(history) {
  const trimmed = history.length > MAX_SNAPSHOTS ? history.slice(0, MAX_SNAPSHOTS) : history;
  await kv.setJson(HISTORY_KEY, trimmed, HISTORY_TTL_SECONDS);
  return trimmed.length;
}

/**
 * Capture the current anchor and prepend it to the history. Idempotent
 * on the (chainHead, chainLength) pair within a 1-hour window — a
 * second call inside an hour with the same anchor values doesn't
 * duplicate the row. (Daily cron is the expected caller, but a
 * manual re-run during incident triage shouldn't pollute the
 * series with N back-to-back identical entries.)
 *
 * @returns {Promise<{ written: boolean, snapshot, reason? }>}
 */
async function recordAnchorSnapshot() {
  let anchor;
  try {
    anchor = await auditAnchor.readAnchor();
  } catch (err) {
    log.error('recordAnchorSnapshot: readAnchor failed', { err: err && err.message });
    return { written: false, reason: 'readAnchor failed', err: err && err.message };
  }
  if (!anchor || !anchor.chainHead) {
    return { written: false, reason: 'anchor unavailable' };
  }

  const snapshot = {
    savedAt: nowIso(),
    asOf: anchor.asOf,
    chainHead: anchor.chainHead,
    chainLength: anchor.chainLength,
    genesis: anchor.genesis,
  };

  let history;
  try {
    history = await readHistory();
  } catch (err) {
    log.error('recordAnchorSnapshot: readHistory failed', { err: err && err.message });
    history = [];
  }

  // 1-hour dedupe window: if the newest existing snapshot has the
  // same (chainHead, chainLength) AND was saved within the last
  // 60 minutes, treat this as a no-op. The chain only grows
  // append-only; identical values back-to-back add no information.
  const newest = history[0];
  if (newest
    && newest.chainHead === snapshot.chainHead
    && newest.chainLength === snapshot.chainLength
    && Date.now() - Date.parse(newest.savedAt) < 60 * 60 * 1000
  ) {
    return { written: false, reason: 'duplicate within dedupe window', snapshot: newest };
  }

  history.unshift(snapshot);
  try {
    await writeHistory(history);
    return { written: true, snapshot };
  } catch (err) {
    log.error('recordAnchorSnapshot: KV write failed', { err: err && err.message });
    return { written: false, reason: 'KV write failed', err: err && err.message };
  }
}

/**
 * Public read of recent anchor snapshots, newest first.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit] — default 30, hard-capped at MAX_SNAPSHOTS
 * @returns {Promise<object[]>}
 */
async function listAnchorSnapshots({ limit } = {}) {
  // Forgiving limit handling: a missing / non-positive / non-finite
  // value falls back to the default of 30 rather than 1, so a stray
  // `?limit=` or `?limit=-1` from the client doesn't accidentally
  // truncate the response to a single row. Out-of-range positives
  // are still hard-capped at MAX_SNAPSHOTS.
  const n = Number(limit);
  const cap = (!Number.isFinite(n) || n <= 0)
    ? Math.min(MAX_SNAPSHOTS, 30)
    : Math.min(MAX_SNAPSHOTS, Math.floor(n));
  const history = await readHistory();
  return history.slice(0, cap);
}

module.exports = {
  recordAnchorSnapshot,
  listAnchorSnapshots,
  HISTORY_KEY,
  MAX_SNAPSHOTS,
  HISTORY_TTL_SECONDS,
  // Test surface
  _readHistory: readHistory,
  _writeHistory: writeHistory,
};
