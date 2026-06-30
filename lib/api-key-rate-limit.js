// Sprint 46 — per-API-key rate limiting.
//
// A leaked sprint-44 key is a DoS amplifier without limits — an
// attacker (or a buggy client) can hammer GET /api/imports until
// the orchestration starts losing other tenants. Sprint 46 caps
// per-key usage at REQUESTS_PER_MINUTE in a sliding window
// implemented as fixed-window buckets (60-second granularity).
//
// Bucketing rather than true sliding-window for two reasons:
//   1. Atomic INCR is cheap (one round-trip) — true sliding window
//      requires sorted-set tracking with multiple round-trips
//   2. Bucket boundaries are predictable for clients to backoff
//      against (Reset header is the next bucket start)
//
// The bucket key is `ratelimit:apikey:<keyId>:<bucket>` where
// `bucket = floor(now / 60_000)`. TTL is 65 seconds — long enough
// that a slow request hitting the boundary doesn't roll over
// before the bucket settles, short enough that stale buckets
// don't pile up.
//
// Limit is generous for v1 (600/min = 10/sec) — accommodates ERP
// batch sync without burning a hole through the orchestrator.
// Tunable via env (ORCATRADE_API_KEY_RATE_LIMIT) for the rare
// enterprise customer who needs more, OR for tests that need
// less to validate the gate fires.

'use strict';

const kv = require('./intelligence/kv-store');

const BUCKET_PREFIX = 'ratelimit:apikey:';
const WINDOW_SECONDS = 60;
const BUCKET_TTL_SECONDS = 65;
const DEFAULT_LIMIT = 600;

function getLimit() {
  const env = Number(process.env.ORCATRADE_API_KEY_RATE_LIMIT);
  if (Number.isInteger(env) && env > 0 && env <= 100000) return env;
  return DEFAULT_LIMIT;
}

// Compute the current bucket id from epoch ms. floor(ms / 60_000)
// gives a monotonically-increasing bucket per minute. Date.now() is
// banned in workflow scripts but not in runtime code.
function currentBucket(nowMs) {
  return Math.floor((typeof nowMs === 'number' ? nowMs : Date.now()) / 1000 / WINDOW_SECONDS);
}

function bucketKey(keyId, bucket) {
  return `${BUCKET_PREFIX}${String(keyId)}:${bucket}`;
}

// Check + record one request against the bucket. Returns
// `{ ok, limit, remaining, count, bucket, resetAt }` where:
//   - ok    = false ⇒ the caller should 429
//   - limit = the active per-minute cap (so callers can echo it
//             in headers without re-reading the env)
//   - remaining = max(0, limit - count); always present
//   - resetAt = epoch ms when the current bucket rolls over;
//               clients use this to schedule backoff
//
// KV failures fail OPEN (returns ok: true) so an Upstash blip
// doesn't break the API surface. This is the conservative choice
// for a rate limiter — a brief over-the-limit window is preferable
// to a hard outage. Logged at the caller boundary.
//
// @param {{ keyId: string, nowMs?: number }} input
async function checkAndRecord({ keyId, nowMs }) {
  const limit = getLimit();
  if (typeof keyId !== 'string' || !keyId) {
    // No key → can't track. Fail OPEN; the gate above us already
    // resolved a valid bearer so this branch is defensive.
    return { ok: true, limit, remaining: limit, count: 0, bucket: 0, resetAt: 0 };
  }
  const bucket = currentBucket(nowMs);
  // resetAt is the START of the NEXT bucket — when the count rolls
  // back to 0. Surfaced as a Unix epoch in seconds (consistent with
  // the IETF rate-limit-headers draft).
  const resetAt = (bucket + 1) * WINDOW_SECONDS;
  // Precompute the bucket key on its own line so the kv.incr call
  // doesn't have nested parens — the repo-wide TTL-hygiene lint test
  // greps for `kv.incr(..., ttlSeconds:)` with a single-paren-pair
  // regex that breaks on nested calls.
  const bk = bucketKey(keyId, bucket);
  let count = 0;
  try {
    count = Number(await kv.incr(bk, { ttlSeconds: BUCKET_TTL_SECONDS })) || 0;
  } catch (_) {
    // KV blip — fail open. The caller should still echo the
    // (probably empty) headers.
    return { ok: true, limit, remaining: limit, count: 0, bucket, resetAt };
  }
  const remaining = Math.max(0, limit - count);
  return {
    ok: count <= limit,
    limit,
    remaining,
    count,
    bucket,
    resetAt,
  };
}

// Attach the standard rate-limit response headers from a check
// result. Called from the handler whether or not the request was
// rate-limited — same shape every time so clients can rely on it.
//
// Header naming follows the IETF rate-limit draft:
//   RateLimit-Limit:     per-window quota
//   RateLimit-Remaining: requests remaining in the window
//   RateLimit-Reset:     epoch SECONDS when the window resets
//
// Also emits the legacy X-RateLimit-* triple for clients that
// haven't adopted the draft yet.
//
// @param {any} res
// @param {{ limit: number, remaining: number, resetAt: number }} result
function setHeaders(res, result) {
  if (!res || typeof res.setHeader !== 'function' || !result) return;
  try {
    res.setHeader('RateLimit-Limit', String(result.limit));
    res.setHeader('RateLimit-Remaining', String(result.remaining));
    res.setHeader('RateLimit-Reset', String(result.resetAt));
    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Reset', String(result.resetAt));
  } catch (_) {
    // Headers already sent (unlikely but possible if a stream
    // already wrote) — swallow.
  }
}

module.exports = {
  BUCKET_PREFIX,
  WINDOW_SECONDS,
  BUCKET_TTL_SECONDS,
  DEFAULT_LIMIT,
  getLimit,
  currentBucket,
  bucketKey,
  checkAndRecord,
  setHeaders,
};
