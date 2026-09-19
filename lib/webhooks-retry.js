// Sprint 50 — webhook retry queue with exponential backoff.
//
// Sprint 48 explicitly deferred this: "A failed delivery records
// ok:false in the log + status on the subscription; nothing
// re-fires." Sprint 50 closes that gap so a transient customer
// outage (deploy window, 5xx burst, brief network issue) doesn't
// permanently lose events.
//
// Architecture:
//   - dispatch.deliverEvent failure → queueRetry({ event, subId, error })
//   - KV state: webhook:retry:<deliveryId> →
//       { subId, event, attemptCount, nextAttemptAt, lastError, abandoned }
//   - Per-sub index: webhook:retry-index:<subId> → array of due-now ids
//   - Cron `webhook-retry-flush` (every 5 min) reads each org's
//     retry index, attempts each due retry, re-queues with backoff
//     OR marks abandoned after MAX_ATTEMPTS
//
// Backoff schedule (after the original attempt failed):
//   attempt 1 → wait 60s
//   attempt 2 → wait 300s   (5m)
//   attempt 3 → wait 1800s  (30m)
//   attempt 4 → wait 7200s  (2h)
//   attempt 5 → wait 21600s (6h)
//   attempt 6 → ABANDONED (logged + per-sub consecutive-failure
//                          counter incremented for sprint-51's
//                          auto-disable)
// Total elapsed before abandonment: ~9h35m. Long enough that a
// deploy window or business-day outage settles; short enough that
// we're not retrying for days.
//
// Jitter: ±20% to prevent thundering-herd when many failures share
// the same backoff bucket. Pure-determined-jitter via a hash of the
// deliveryId so a deliveryId-replay (testing) gets reproducible
// timing — important for the cron test path.

'use strict';

const crypto = require('crypto');
const kv = require('./intelligence/kv-store');

const RETRY_PREFIX = 'webhook:retry:';
const RETRY_INDEX_PREFIX = 'webhook:retry-index:';
const RETRY_TTL_SECONDS = 24 * 60 * 60; // 24h — well past the 9h35m total elapse
const MAX_ATTEMPTS = 5;

// Backoff schedule in seconds. Index = (attemptCount - 1) AFTER
// incrementing on failure, so index 0 = "after first retry-attempt
// failed, wait 60s before attempt 2." Drift-guard pins these
// values + the count.
const BACKOFF_SECONDS = Object.freeze([
  60,      // 1 min
  300,     // 5 min
  1_800,   // 30 min
  7_200,   // 2 hr
  21_600,  // 6 hr
]);

function indexKey(subId) { return RETRY_INDEX_PREFIX + String(subId); }
function retryKey(deliveryId) { return RETRY_PREFIX + String(deliveryId); }

// Deterministic ±20% jitter from the delivery id. SHA-256 of the
// id → first 4 bytes → unsigned int → range-mapped to [-0.2, +0.2].
// Reproducible for testing + spreads concurrent retries.
function jitterMultiplier(deliveryId) {
  const hash = crypto.createHash('sha256').update(String(deliveryId)).digest();
  const u32 = hash.readUInt32BE(0);
  const ratio = u32 / 0xffffffff;          // 0..1
  return 1 + ((ratio - 0.5) * 0.4);        // [0.8, 1.2]
}

// Compute the next attempt timestamp (ms epoch). Returns null when
// the attempt count exceeds MAX_ATTEMPTS — the caller marks the
// retry abandoned.
//
// @param {{ deliveryId: string, attemptCount: number, nowMs?: number }} input
function computeNextAttemptMs({ deliveryId, attemptCount, nowMs }) {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) return null;
  // attemptCount counts retries that ALREADY failed. Backoff index
  // is (attemptCount - 1) — after attempt 1 fails, wait
  // BACKOFF_SECONDS[0] before attempt 2.
  if (attemptCount > BACKOFF_SECONDS.length) return null;
  const baseSeconds = BACKOFF_SECONDS[attemptCount - 1];
  const jitter = jitterMultiplier(deliveryId);
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  return Math.round(now + baseSeconds * 1000 * jitter);
}

// Queue a NEW retry after the original delivery failed. attemptCount
// starts at 1 (the first retry is attempt #2 overall — the original
// counts as attempt #1, this is the first re-attempt).
//
// @param {{ deliveryId: string, subId: string, event: any, error: string|null, nowMs?: number }} input
async function queueRetry({ deliveryId, subId, event, error, nowMs }) {
  if (!deliveryId || !subId || !event) return { ok: false, reason: 'missing fields' };
  const nextAttemptAt = computeNextAttemptMs({ deliveryId, attemptCount: 1, nowMs });
  if (nextAttemptAt === null) return { ok: false, reason: 'cannot-schedule' };
  const state = {
    deliveryId,
    subId,
    event,
    attemptCount: 1,
    nextAttemptAt,
    lastError: error || null,
    abandoned: false,
    queuedAt: new Date(typeof nowMs === 'number' ? nowMs : Date.now()).toISOString(),
  };
  try {
    await kv.set(retryKey(deliveryId), state, { ttlSeconds: RETRY_TTL_SECONDS });
  } catch (_) {
    return { ok: false, reason: 'kv-write-failed' };
  }
  // Push to per-sub index. Read-merge-write — same race trade-off
  // as the sprint-49 delivery index. Unsorted; the cron's drain
  // path filters by nextAttemptAt.
  try {
    const existing = (await kv.get(indexKey(subId))) || [];
    const arr = Array.isArray(existing) ? existing : [];
    if (!arr.includes(deliveryId)) arr.push(deliveryId);
    await kv.set(indexKey(subId), arr, { ttlSeconds: RETRY_TTL_SECONDS });
  } catch (_) {
    /* index write best-effort */
  }
  return { ok: true, state };
}

// Read the current retry state for a delivery. null when not found.
async function getRetry(deliveryId) {
  try {
    const s = await kv.get(retryKey(deliveryId));
    return (s && typeof s === 'object') ? s : null;
  } catch (_) {
    return null;
  }
}

// Mark a retry as ABANDONED — final attempt failed + max attempts
// reached. The KV entry stays for the 24h TTL so an audit reader
// can see it. The index entry is removed so the cron doesn't
// re-pick it.
async function markAbandoned({ deliveryId, subId, lastError }) {
  const state = (await getRetry(deliveryId)) || {};
  const next = {
    ...state,
    deliveryId,
    subId,
    abandoned: true,
    abandonedAt: new Date().toISOString(),
    lastError: lastError || state.lastError || null,
  };
  try {
    await kv.set(retryKey(deliveryId), next, { ttlSeconds: RETRY_TTL_SECONDS });
  } catch (_) { /* best-effort */ }
  // Pop from index.
  try {
    const existing = (await kv.get(indexKey(subId))) || [];
    const arr = (Array.isArray(existing) ? existing : []).filter((id) => id !== deliveryId);
    await kv.set(indexKey(subId), arr, { ttlSeconds: RETRY_TTL_SECONDS });
  } catch (_) { /* best-effort */ }
}

// Re-schedule a still-retriable delivery after a retry attempt
// failed. Increments attemptCount + recomputes nextAttemptAt.
// Returns the new state, or { abandoned: true } when the cap is
// reached.
//
// @param {{ deliveryId: string, subId: string, error: string|null, nowMs?: number }} input
async function rescheduleAfterFailure({ deliveryId, subId, error, nowMs }) {
  const state = await getRetry(deliveryId);
  if (!state) return { ok: false, reason: 'not-found' };
  const nextCount = (Number(state.attemptCount) || 1) + 1;
  if (nextCount > MAX_ATTEMPTS) {
    await markAbandoned({ deliveryId, subId, lastError: error });
    return { ok: true, abandoned: true };
  }
  const nextAttemptAt = computeNextAttemptMs({
    deliveryId, attemptCount: nextCount, nowMs,
  });
  if (nextAttemptAt === null) {
    await markAbandoned({ deliveryId, subId, lastError: error });
    return { ok: true, abandoned: true };
  }
  const updated = {
    ...state,
    attemptCount: nextCount,
    nextAttemptAt,
    lastError: error || null,
  };
  try {
    await kv.set(retryKey(deliveryId), updated, { ttlSeconds: RETRY_TTL_SECONDS });
  } catch (_) {
    return { ok: false, reason: 'kv-write-failed' };
  }
  return { ok: true, state: updated };
}

// Remove a delivery from the queue — used when a retry succeeds.
async function clearRetry({ deliveryId, subId }) {
  try {
    await kv.del(retryKey(deliveryId));
  } catch (_) { /* best-effort */ }
  try {
    const existing = (await kv.get(indexKey(subId))) || [];
    const arr = (Array.isArray(existing) ? existing : []).filter((id) => id !== deliveryId);
    await kv.set(indexKey(subId), arr, { ttlSeconds: RETRY_TTL_SECONDS });
  } catch (_) { /* best-effort */ }
}

// List the queued retries for a subscription that are DUE NOW
// (nextAttemptAt <= nowMs). Used by the cron flush + by the
// /api/webhooks/<id>/deliveries UI count.
//
// @param {{ subId: string, nowMs?: number, includeFuture?: boolean }} input
async function listDueRetriesForSubscription({ subId, nowMs, includeFuture }) {
  if (typeof subId !== 'string' || !subId) return [];
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  let ids = [];
  try {
    ids = (await kv.get(indexKey(subId))) || [];
    if (!Array.isArray(ids)) ids = [];
  } catch (_) {
    return [];
  }
  const entries = await Promise.all(
    ids.map((id) => kv.get(retryKey(id)).catch(() => null)),
  );
  const valid = entries.filter((e) => e && typeof e === 'object' && !e.abandoned);
  if (includeFuture) return valid;
  return valid.filter((e) => Number(e.nextAttemptAt) <= now);
}

// Count pending (non-abandoned) retries for a subscription —
// surfaces in the UI as "N retries pending."
async function countPendingForSubscription(subId) {
  const all = await listDueRetriesForSubscription({ subId, includeFuture: true });
  return all.length;
}

module.exports = {
  RETRY_PREFIX,
  RETRY_INDEX_PREFIX,
  RETRY_TTL_SECONDS,
  MAX_ATTEMPTS,
  BACKOFF_SECONDS,
  jitterMultiplier,
  computeNextAttemptMs,
  queueRetry,
  getRetry,
  markAbandoned,
  rescheduleAfterFailure,
  clearRetry,
  listDueRetriesForSubscription,
  countPendingForSubscription,
};
