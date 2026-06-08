// @ts-check
'use strict';

// Tier-A precondition TA-3 — calculator green-state stamp.
//
// Every calculator that participates in Tier-A must stamp its
// last-green-build time to KV. The stamp says: "the regression test
// suite for this calculator passed on `main` at this UTC time." Tier-A
// evaluation reads the stamp and fails TA-3 if it's older than 24h
// (or missing entirely).
//
// Who writes the stamp
// ────────────────────
// A CI job on `push: main` runs the calculator's regression suite. On
// green, it calls `stampLastGreenAt(calculatorName)` which writes the
// current ISO time to KV. The stamp's TTL is 7 days — long enough that
// a transient CI outage doesn't immediately disqualify Tier-A, short
// enough that a calculator removed from the codebase auto-expires
// from the eligibility surface.
//
// (The CI-side wiring ships in a follow-up — this PR ships the
// read/write API + tests so the function exists for ADR-0020 evaluation
// today.)

const kv = require('../kv-store');

const KEY_PREFIX = 'tier-a:green-state:';
const STAMP_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * @param {string} calculatorName
 * @returns {string}
 */
function key(calculatorName) {
  if (typeof calculatorName !== 'string' || !calculatorName) {
    throw new Error('green-state key requires a non-empty calculatorName');
  }
  // Be defensive: collapse anything that isn't safe in a KV key.
  const safe = calculatorName.replace(/[^a-zA-Z0-9_\-.]/g, '_');
  return `${KEY_PREFIX}${safe}`;
}

/**
 * @param {string} calculatorName
 * @returns {Promise<string|null>} ISO time of the last green stamp, or null if absent/unreadable
 */
async function readLastGreenAt(calculatorName) {
  try {
    const raw = await kv.get(key(calculatorName));
    if (!raw) return null;
    const value = typeof raw === 'string' ? raw : (raw && raw.iso) || null;
    if (!value || typeof value !== 'string') return null;
    // Validate it parses; a corrupted stamp must fail TA-3 rather than pass it.
    if (!Number.isFinite(Date.parse(value))) return null;
    return value;
  } catch (_) {
    return null;
  }
}

/**
 * @param {string} calculatorName
 * @param {{ nowMs?: number }} [opts]  override clock for deterministic tests
 * @returns {Promise<{ ok: true, iso: string } | { ok: false, err: string }>}
 */
async function stampLastGreenAt(calculatorName, opts = {}) {
  const nowMs = typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();
  const iso = new Date(nowMs).toISOString();
  try {
    await kv.set(key(calculatorName), iso, { ttlSeconds: STAMP_TTL_SECONDS });
    return { ok: true, iso };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'kv-set-failed';
    return { ok: false, err: message };
  }
}

module.exports = {
  readLastGreenAt,
  stampLastGreenAt,
  STAMP_TTL_SECONDS,
  KEY_PREFIX,
  _key: key,
};
