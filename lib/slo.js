// SLO instrumentation — apex plan P1.A.
//
// Per-handler latency tracking. The dispatcher (api/[...path].js)
// wraps every handler call with `slo.record(key, latencyMs, status)`;
// this module buckets samples in KV and computes p50/p95/p99 + error
// rate per handler on demand.
//
// Storage shape (KV-only, no PG dependency):
//
//   slo:samples:<handler>            — list of last N latencies (ms),
//                                      newest first. Capped at
//                                      MAX_SAMPLES_PER_HANDLER. TTL
//                                      RETENTION_TTL_SECONDS.
//   slo:errors:<handler>             — array of [{ ts, status }] for
//                                      the last N error responses
//                                      (>=500). Same cap + TTL.
//
// Why KV not PG: latencies are stream-shaped (we don't query individual
// samples; we want p95 over a window). PG would be overkill; KV's
// capped-array pattern is the right fit.
//
// SLO targets (per docs/security/data-flow.md + the apex plan):
//   /api/agent (compliance)    p95 ≤ 8000ms
//   /api/orchestrator          p95 ≤ 12000ms (more tool calls)
//   /api/health                p95 ≤ 500ms
//   /api/customs (calc)        p95 ≤ 1000ms
//   default (anything else)    p95 ≤ 3000ms
//
// Status page consumes /api/slo (handler shipped alongside this).

'use strict';

const kv = require('./intelligence/kv-store');
const log = require('./log').withContext({ module: 'slo' });

const MAX_SAMPLES_PER_HANDLER = 200;
// Rolling 24h-equivalent retention. Counters use this same TTL via
// kv-store's per-key TTL surface.
const RETENTION_TTL_SECONDS = 24 * 60 * 60;

const SAMPLES_KEY_PREFIX = 'slo:samples:';
const ERRORS_KEY_PREFIX = 'slo:errors:';

// Per-handler p95 targets, in ms. The dispatcher uses HANDLER_TARGETS[key]
// when present, else DEFAULT_TARGET. Exported so test cases + dashboards
// can render the SLO bar against the right ceiling.
const HANDLER_TARGETS = Object.freeze({
  agent: 8000,            // compliance agent — tool-use loop
  orchestrator: 12000,    // meta-agent — more tools per turn
  'sourcing-agent': 8000,
  'logistics-agent': 8000,
  'finance-agent': 8000,
  health: 500,
  customs: 1000,
  routing: 1000,
  warehouse: 1000,
  'sourcing-quote': 1000,
  'finance-quote': 1000,
  insurance: 1000,
  returns: 1000,
  samples: 1000,
});

const DEFAULT_TARGET_MS = 3000;

function targetFor(handlerKey) {
  return HANDLER_TARGETS[handlerKey] || DEFAULT_TARGET_MS;
}

// Sanitise the handler key so it can be safely embedded in a KV key.
// Same alphabet as the dispatcher's URL segment validation.
function safeKey(handlerKey) {
  if (typeof handlerKey !== 'string') return null;
  if (!/^[a-z0-9-]{1,64}$/i.test(handlerKey)) return null;
  return handlerKey.toLowerCase();
}

// Fire-and-forget: append a latency sample for one handler.
// Never throws — telemetry must not break the request. Status >=500
// also bumps the error array so the SLO snapshot can show error rate.
async function record(handlerKey, latencyMs, statusCode) {
  const key = safeKey(handlerKey);
  if (!key) return;
  if (!Number.isFinite(latencyMs)) return;
  const ms = Math.max(0, Math.round(latencyMs));
  const status = Number.isFinite(statusCode) ? Number(statusCode) : null;

  try {
    const samplesKey = SAMPLES_KEY_PREFIX + key;
    const existing = (await kv.get(samplesKey)) || [];
    const arr = Array.isArray(existing) ? existing : [];
    const updated = [ms, ...arr].slice(0, MAX_SAMPLES_PER_HANDLER);
    await kv.set(samplesKey, updated, { ttlSeconds: RETENTION_TTL_SECONDS });
  } catch (err) {
    log.warn('slo.record samples failed', { handler: key, err: err && err.message });
    /* swallow — telemetry never blocks the request */
  }

  if (status != null && status >= 500) {
    try {
      const errorsKey = ERRORS_KEY_PREFIX + key;
      const existing = (await kv.get(errorsKey)) || [];
      const arr = Array.isArray(existing) ? existing : [];
      const updated = [{ ts: Date.now(), status }, ...arr].slice(0, MAX_SAMPLES_PER_HANDLER);
      await kv.set(errorsKey, updated, { ttlSeconds: RETENTION_TTL_SECONDS });
    } catch (err) {
      log.warn('slo.record errors failed', { handler: key, err: err && err.message });
    }
  }
}

// Pure: given an array of latency samples, compute percentiles.
function percentiles(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { count: 0, p50: null, p95: null, p99: null, max: null };
  }
  const sorted = samples.slice().filter(Number.isFinite).sort((a, b) => a - b);
  const n = sorted.length;
  function pct(p) {
    if (n === 0) return null;
    // Nearest-rank: ceil(p × n) — 1-indexed.
    const idx = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1));
    return sorted[idx];
  }
  return {
    count: n,
    p50: pct(50),
    p95: pct(95),
    p99: pct(99),
    max: sorted[n - 1],
  };
}

// Read the current snapshot for one handler.
async function snapshot(handlerKey) {
  const key = safeKey(handlerKey);
  if (!key) return null;
  const [samples, errors] = await Promise.all([
    kv.get(SAMPLES_KEY_PREFIX + key).catch(() => null),
    kv.get(ERRORS_KEY_PREFIX + key).catch(() => null),
  ]);
  const samplesArr = Array.isArray(samples) ? samples : [];
  const errorsArr = Array.isArray(errors) ? errors : [];
  const pcts = percentiles(samplesArr);
  return {
    handler: key,
    target_p95_ms: targetFor(key),
    ...pcts,
    errorCount: errorsArr.length,
    errorRate: pcts.count > 0
      ? errorsArr.length / (pcts.count + errorsArr.length)
      : 0,
    withinSlo: pcts.p95 != null ? pcts.p95 <= targetFor(key) : null,
  };
}

// Snapshot for all known handlers (anything with a HANDLER_TARGETS entry
// OR currently has samples in KV).
async function snapshotAll() {
  const handlers = Object.keys(HANDLER_TARGETS);
  // Race samples for any handler not in the static target list.
  // (Cheap: a single kv.get per key.)
  const results = await Promise.all(
    handlers.map((h) => snapshot(h).catch(() => null)),
  );
  const out = {};
  for (const r of results) {
    if (r) out[r.handler] = r;
  }
  return { generatedAt: new Date().toISOString(), handlers: out };
}

module.exports = {
  record,
  snapshot,
  snapshotAll,
  percentiles,
  targetFor,
  HANDLER_TARGETS,
  DEFAULT_TARGET_MS,
  MAX_SAMPLES_PER_HANDLER,
  RETENTION_TTL_SECONDS,
  // Internals for tests:
  _safeKey: safeKey,
  _SAMPLES_KEY_PREFIX: SAMPLES_KEY_PREFIX,
  _ERRORS_KEY_PREFIX: ERRORS_KEY_PREFIX,
};
