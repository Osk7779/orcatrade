// Per-tenant Anthropic spend cap — apex P1.7 bill-protection.
//
// Why this exists
// ───────────────
// docs/runbooks/ai-agent-failure.md §7 documents the cost-spike
// failure mode: "a single user looping the chat agent" can blow
// past a tier's agentQueriesPerMonth budget WHILE STILL BEING
// WITHIN it — long contexts on Opus 4.7 cost 5× more than the
// average tier-2 query the per-query budget assumes. The
// agentQueriesPerMonth quota is the user-facing limit; this
// module is the platform-side bill-protection floor.
//
// Counter
// ───────
// After every Anthropic call, lib/ai/cost-telemetry.js records
// the per-call costCents to:
//
//   KV key   `aispend:<emailHash>:<YYYY-MM>`
//   KV value integer cents (cumulative for the month)
//   TTL      62 days (spans any month boundary)
//
// Gate
// ────
// Before the agent invokes Anthropic, gating.checkAgentSpend(req)
// reads the current month's spend, compares against the tier's
// `quotas.monthlyAnthropicSpendCapCents`, and returns a 429 if
// the cap is exceeded.
//
// PII discipline
// ──────────────
// Identity in the KV key is email_hash (lib/hash.js, SHA-256
// first-16-hex). Raw email never enters the spend ledger. This
// matches ADR 0008 + the events-stream / human-review-queue /
// shadow-seam patterns.
//
// Best-effort
// ───────────
// recordSpend is fire-and-forget — a KV outage on the recording
// path must NEVER throw to the cost-telemetry caller. The gate
// reads the counter and treats KV errors as "spend unknown =
// allow," failing open rather than locking everyone out. This is
// a deliberate posture: a cap is a defensive floor, not a hard
// auth boundary; the user-facing agentQueriesPerMonth quota is
// the actual gate.

'use strict';

const kv = require('../intelligence/kv-store');
const hash = require('../hash');
const log = require('../log').withContext({ module: 'spend-cap' });

const SPEND_KEY_PREFIX = 'aispend:';
// 62 days — same window as gating's checkQuota, spans any month
// boundary cleanly.
const SPEND_TTL_SECONDS = 62 * 24 * 60 * 60;

function currentMonthBucket(now = new Date()) {
  return now.toISOString().slice(0, 7); // YYYY-MM
}

function spendKey(emailHashValue, bucket) {
  return `${SPEND_KEY_PREFIX}${emailHashValue}:${bucket}`;
}

// Resolve the email-hash identity for the spend ledger. Accepts
// either a raw email (hashes it) or an already-hashed pseudonym
// (passes through, matching events.js's pattern). Anonymous /
// unknown identity → null (the spend cap doesn't apply because
// we can't attribute the cost to any tenant).
function resolveSpendIdentity({ email, emailHash: providedHash }) {
  if (providedHash && typeof providedHash === 'string') return providedHash;
  if (!email || typeof email !== 'string') return null;
  if (hash.isAlreadyPseudonym(email)) return String(email);
  return hash.emailHash(email);
}

/**
 * Increment the user's monthly Anthropic spend counter by
 * `costCents`. Best-effort, non-throwing. Calls with 0 or
 * negative cents (e.g. cached-prefix-only hits) are no-ops.
 *
 * @param {object} input
 * @param {string} [input.email]         — raw email
 * @param {string} [input.emailHash]     — pre-hashed pseudonym
 * @param {number} input.costCents       — integer cents
 * @returns {Promise<{recorded: boolean, key?: string, total?: number, reason?: string}>}
 */
async function recordSpend({ email, emailHash: providedHash, costCents }) {
  const cents = Number(costCents);
  if (!Number.isFinite(cents) || cents <= 0) {
    return { recorded: false, reason: 'no-cost' };
  }
  const identity = resolveSpendIdentity({ email, emailHash: providedHash });
  if (!identity) return { recorded: false, reason: 'no-identity' };
  const bucket = currentMonthBucket();
  const key = spendKey(identity, bucket);
  try {
    // INCRBY-equivalent: read, add, write. KV doesn't expose
    // atomic INCRBY uniformly across the in-memory fallback +
    // Upstash REST so we use the same read-modify-write pattern
    // gating.checkQuota uses. Race window is small and the
    // ledger is informational — exact-to-the-cent isn't required
    // for the gate to fire when the budget is genuinely exceeded.
    const current = Number(await kv.get(key)) || 0;
    const next = current + Math.floor(cents);
    await kv.set(key, next, { ttlSeconds: SPEND_TTL_SECONDS });
    return { recorded: true, key, total: next };
  } catch (err) {
    log.warn('recordSpend KV write failed', {
      identity, bucket, costCents: cents, err: err.message,
    });
    return { recorded: false, reason: 'kv-error', err: err.message };
  }
}

/**
 * Read the user's cumulative Anthropic spend for the current
 * month. KV outage → 0 (fail-open, see module header).
 *
 * @param {object} input
 * @param {string} [input.email]
 * @param {string} [input.emailHash]
 * @returns {Promise<{currentCents: number, bucket: string, identity: string|null}>}
 */
async function getMonthlySpend({ email, emailHash: providedHash }) {
  const identity = resolveSpendIdentity({ email, emailHash: providedHash });
  const bucket = currentMonthBucket();
  if (!identity) return { currentCents: 0, bucket, identity: null };
  try {
    const current = Number(await kv.get(spendKey(identity, bucket))) || 0;
    return { currentCents: current, bucket, identity };
  } catch (err) {
    log.warn('getMonthlySpend KV read failed', { identity, bucket, err: err.message });
    return { currentCents: 0, bucket, identity };
  }
}

module.exports = {
  recordSpend,
  getMonthlySpend,
  currentMonthBucket,
  spendKey,
  resolveSpendIdentity,
  SPEND_KEY_PREFIX,
  SPEND_TTL_SECONDS,
};
