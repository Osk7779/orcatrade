// Per-upstream circuit breaker.
//
// Why
// ───
// Every fetch to TARIC / Resend / Stripe / Anthropic is a place where a
// slow or hanging upstream can blow up the platform's p99 latency. The
// circuit watches recent failures, opens after a threshold, and short-
// circuits subsequent calls with a documented fallback for a cool-down
// period. After the cool-down it lets ONE probe through (half-open); on
// success the circuit closes, on failure it stays open for another
// cycle.
//
// This is Track 4.4 of backend-grade-plan.md. The shape mirrors the
// classic Hystrix / resilience4j contract but stripped of all the
// configurability we don't need: one threshold, one cool-down, one
// half-open probe at a time.
//
// State storage
// ─────────────
// KV (Upstash REST when configured, in-memory fallback in dev/tests).
// Key shape: `circuit:<name>` → JSON state. TTL is intentionally long
// (24h) — the circuit auto-heals via the half-open probe; we never
// want it to silently reset because KV expired the key.
//
// Public API
// ──────────
//   await circuit.run(name, asyncFn, { fallback, threshold?, cooldownMs? })
//     → result of asyncFn() if circuit closed/half-open + fn succeeds
//     → result of fallback() if circuit open OR fn throws
//
//   await circuit.state(name) → 'closed' | 'open' | 'half-open' (for /api/health later)
//   await circuit.reset(name) → admin override; rare

'use strict';

const kv = require('./intelligence/kv-store');
const log = require('./log').withContext({ module: 'circuit' });

const DEFAULT_THRESHOLD = 5;          // consecutive failures before opening
const DEFAULT_COOLDOWN_MS = 30_000;   // 30s — short enough to recover quickly, long enough that a flaky upstream isn't hammered
const STATE_TTL_SECONDS = 60 * 60 * 24; // 24h. Auto-healing via half-open probe means we never want silent reset.

function key(name) { return `circuit:${name}`; }

async function readState(name) {
  try {
    const raw = await kv.get(key(name));
    if (!raw) return { state: 'closed', failures: 0, openedAt: null };
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return { state: 'closed', failures: 0, openedAt: null };
    return {
      state: parsed.state === 'open' || parsed.state === 'half-open' ? parsed.state : 'closed',
      failures: Number(parsed.failures) || 0,
      openedAt: Number.isFinite(Number(parsed.openedAt)) ? Number(parsed.openedAt) : null,
    };
  } catch (_) {
    // Failed to read the state — treat as closed so the upstream still gets a chance.
    return { state: 'closed', failures: 0, openedAt: null };
  }
}

async function writeState(name, state) {
  try {
    await kv.set(key(name), JSON.stringify(state), { ttlSeconds: STATE_TTL_SECONDS });
  } catch (err) {
    // Persistence failure is non-fatal — the circuit just won't survive a cold start.
    log.warn('state write failed', { name, err: err.message });
  }
}

// Compute the effective state at the moment of a call. If the recorded
// state is 'open' and cooldown has elapsed, promote to 'half-open' (one
// probe allowed through). Pure function — does NOT persist.
function effectiveState(stored, now, cooldownMs) {
  if (stored.state !== 'open') return stored.state;
  if (stored.openedAt == null) return 'open';
  return (now - stored.openedAt) >= cooldownMs ? 'half-open' : 'open';
}

async function state(name, { cooldownMs = DEFAULT_COOLDOWN_MS } = {}) {
  const stored = await readState(name);
  return effectiveState(stored, Date.now(), cooldownMs);
}

async function reset(name) {
  await writeState(name, { state: 'closed', failures: 0, openedAt: null });
}

// Wrap an async upstream call. Returns the fn result, or — if the
// circuit is open or fn throws — calls fallback() and returns its
// result. fallback is REQUIRED: every place that uses a circuit must
// have an explicit degraded path. (No "throw the original error" —
// that's what we're trying to avoid.)
async function run(name, fn, opts = {}) {
  const threshold = opts.threshold || DEFAULT_THRESHOLD;
  const cooldownMs = opts.cooldownMs || DEFAULT_COOLDOWN_MS;
  if (typeof opts.fallback !== 'function') {
    throw new Error(`circuit.run("${name}"): fallback function required`);
  }

  const stored = await readState(name);
  const now = Date.now();
  const effective = effectiveState(stored, now, cooldownMs);

  if (effective === 'open') {
    // Short-circuit immediately. No upstream call, no probe.
    log.warn('circuit short-circuited', { name, state: 'open', failures: stored.failures });
    return opts.fallback({ shortCircuited: true, state: 'open' });
  }

  // closed OR half-open: try the upstream.
  try {
    const result = await fn();
    if (stored.state !== 'closed' || stored.failures !== 0) {
      // Recovery: close the circuit on success.
      await writeState(name, { state: 'closed', failures: 0, openedAt: null });
      log.info('circuit closed (recovered)', { name, from: stored.state });
    }
    return result;
  } catch (err) {
    const failures = stored.failures + 1;
    if (failures >= threshold || effective === 'half-open') {
      // Trip (or stay tripped after a failed half-open probe).
      await writeState(name, { state: 'open', failures, openedAt: now });
      log.error('circuit opened', { name, failures, err: err.message });
    } else {
      await writeState(name, { state: 'closed', failures, openedAt: null });
      log.warn('circuit failure recorded', { name, failures, threshold, err: err.message });
    }
    return opts.fallback({ shortCircuited: false, state: failures >= threshold ? 'open' : 'closed', err });
  }
}

module.exports = {
  run,
  state,
  reset,
  // Internals exposed for tests
  _readState: readState,
  _writeState: writeState,
  _effectiveState: effectiveState,
  DEFAULT_THRESHOLD,
  DEFAULT_COOLDOWN_MS,
  STATE_TTL_SECONDS,
};
