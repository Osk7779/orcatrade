// GET /api/health — operational status of every external dependency.
//
// What this returns
// ─────────────────
//   { status: 'ok' | 'degraded' | 'down',
//     ts, requestId, version,
//     subsystems: {
//       kv:        { status, mode, probedAt, latencyMs }
//       taric:     { status, lastWarmAt, ageHours, warmCount }
//       resend:    { status, configured }
//       stripe:    { status, configured }
//       anthropic: { status, configured }
//     } }
//
// Status policy
// ─────────────
//   ok       = every subsystem reports ok
//   degraded = one subsystem is misconfigured but the platform still runs
//              (e.g. no Resend → no emails; no Stripe → no upgrades; no
//              Anthropic → no AI; no TARIC warm cache → chapter estimator
//              fallback). HTTP 200 — caller can see which subsystem.
//   down     = KV unreachable. Almost nothing works; HTTP 503 so an
//              uptime probe pages someone.
//
// Why these subsystems
// ────────────────────
// The five external dependencies the platform leans on. Track 4.4 of the
// backend-grade-plan adds circuit breakers around four of them; this
// endpoint is the single source of truth those circuits + the public
// status page read from.

'use strict';

const kv = require('../intelligence/kv-store');
const log = require('../log').withContext({ handler: 'health' });
const circuit = require('../circuit');
const db = require('../db/client');

const PROBE_KEY = 'health:probe';
const PROBE_TTL_SECONDS = 60;
const TARIC_WARM_TIMESTAMP_KEY = 'taric:warm:lastRun';
const TARIC_STALE_HOURS = 25; // nightly cron runs at 04:15 UTC; >25h = it failed

// Phase 0 P0.8 — per-probe timeout + SLO.
//
// Each async probe is wrapped in Promise.race with a 2000ms ceiling.
// A hung KV / PG / sanctions / RAG query no longer holds the whole
// endpoint open; instead the slow probe returns its onTimeout result
// and the rest of the response is still useful for triage.
//
// All probes also run in PARALLEL via Promise.all, so total endpoint
// latency is bounded by max(probe_latency) + small slack, not sum.
// With 5 async probes at 2s ceiling each, worst-case total ≈ 2.5s.
//
// SLO TARGET (asserted by test/health-slo.test.js):
//   - Per-probe ceiling: 2000ms (PROBE_TIMEOUT_MS)
//   - Endpoint total p95 budget: 3000ms (SLO_TOTAL_BUDGET_MS) — parallel
//     execution + 2s per-probe + slack for serialisation + log emit
//   - Surfaced as `slo.budgetMs` + `slo.actualMs` on the response so
//     uptime checkers can alert on regressions
//
// The longer-term measurement (p50/p95 to KV) is a Phase 1 follow-up
// when /status/ wants historical SLO compliance plots; for now the
// per-request latency is the rolling signal.
const PROBE_TIMEOUT_MS = 2000;
const SLO_TOTAL_BUDGET_MS = 3000;

/**
 * Run an async probe with a hard per-probe timeout. On timeout, calls
 * onTimeout({ latencyMs, err }) → must return a probe result with a
 * status. Caller wraps each probe with its own onTimeout because
 * subsystems differ on what 'timeout' means semantically:
 *   - KV / PG timeout = 'down' (paging condition)
 *   - TARIC / sanctions / RAG timeout = 'degraded' (graceful fallback)
 */
async function probeWithTimeout(probeFn, timeoutMs, onTimeout) {
  const start = Date.now();
  let timer;
  try {
    return await Promise.race([
      probeFn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout (${timeoutMs}ms)`)), timeoutMs);
      }),
    ]);
  } catch (err) {
    if (err && typeof err.message === 'string' && err.message.startsWith('timeout')) {
      return onTimeout({ latencyMs: Date.now() - start, err: err.message });
    }
    // Non-timeout exception → re-throw so the probe's own catch (if any)
    // handles it. Most probes already have try/catch returning a
    // structured status; this path is for unexpected throws.
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function probeKv() {
  const start = Date.now();
  const probeVal = `probe-${start}`;
  try {
    await kv.set(PROBE_KEY, probeVal, { ttlSeconds: PROBE_TTL_SECONDS });
    const echoed = await kv.get(PROBE_KEY);
    const latencyMs = Date.now() - start;
    if (echoed !== probeVal) {
      return { status: 'down', mode: kv.getMode(), probedAt: new Date().toISOString(), latencyMs, err: 'echo mismatch' };
    }
    return { status: 'ok', mode: kv.getMode(), probedAt: new Date().toISOString(), latencyMs };
  } catch (err) {
    return { status: 'down', mode: kv.getMode(), probedAt: new Date().toISOString(), err: err.message };
  }
}

async function probeTaricWarmth() {
  try {
    const last = await kv.get(TARIC_WARM_TIMESTAMP_KEY);
    if (!last) {
      return { status: 'degraded', lastWarmAt: null, ageHours: null, reason: 'never warmed' };
    }
    const lastMs = Date.parse(last);
    if (!Number.isFinite(lastMs)) {
      return { status: 'degraded', lastWarmAt: last, ageHours: null, reason: 'invalid timestamp' };
    }
    const ageHours = Math.round((Date.now() - lastMs) / 3.6e6 * 10) / 10;
    if (ageHours > TARIC_STALE_HOURS) {
      return { status: 'degraded', lastWarmAt: last, ageHours, reason: `stale (>${TARIC_STALE_HOURS}h)` };
    }
    return { status: 'ok', lastWarmAt: last, ageHours };
  } catch (err) {
    return { status: 'degraded', lastWarmAt: null, ageHours: null, err: err.message };
  }
}

function probeEnvVar(name) {
  const present = !!process.env[name];
  return {
    status: present ? 'ok' : 'degraded',
    configured: present,
    ...(present ? {} : { reason: `${name} not set` }),
  };
}

// Sprint BG-2.1: Postgres probe. If not configured, degraded (the platform
// still runs on KV — Postgres is the durable source-of-truth in flight).
// If configured but unreachable, down. Latency surfaced so a slow Neon
// region shows up before users notice.
async function probePostgres() {
  if (!db.isConfigured()) {
    return { status: 'degraded', configured: false, reason: 'DATABASE_URL not set — running KV-only' };
  }
  try {
    const r = await db.probe();
    if (r.ok) {
      return { status: 'ok', configured: true, latencyMs: r.latencyMs, mode: r.mode };
    }
    return { status: 'down', configured: true, latencyMs: r.latencyMs, err: r.err };
  } catch (err) {
    return { status: 'down', configured: true, err: err.message };
  }
}

// Sprint BG-4.2: Sentry probe. Validates SENTRY_DSN env shape via the
// pure parseDsn() — we never make a real network call here so the
// health endpoint stays fast even if Sentry is slow. Unconfigured DSN
// returns degraded (errors land in stdout logs only); malformed DSN
// also returns degraded with a `reason` field so an admin can fix it.
function probeSentry() {
  const sentry = require('../sentry');
  if (!process.env.SENTRY_DSN) {
    return { status: 'degraded', configured: false, reason: 'SENTRY_DSN not set — errors land in Vercel logs only' };
  }
  const parsed = sentry.parseDsn(process.env.SENTRY_DSN);
  if (!parsed) {
    return { status: 'degraded', configured: true, reason: 'SENTRY_DSN set but malformed' };
  }
  return { status: 'ok', configured: true, host: parsed.host, projectId: parsed.projectId };
}

// Anthropic accepts either env name across the codebase.
function probeAnthropic() {
  const present = !!(process.env.ANTHROPIC_API_KEY || process.env.ORCATRADE_OS_API);
  return {
    status: present ? 'ok' : 'degraded',
    configured: present,
    ...(present ? {} : { reason: 'ANTHROPIC_API_KEY (or ORCATRADE_OS_API) not set' }),
  };
}

// Sprint sanctions-lists-v1 / rag-v1 observability. Both report whether their
// optional Postgres-backed data is loaded. Crucially they're 'ok' even when
// NOT loaded (the platform falls back to sample screening / BM25 retrieval) —
// only a real error is 'degraded', so an un-activated capability never pages.
async function probeSanctions() {
  const store = require('../intelligence/sanctions-list-store');
  if (!store.isAvailable()) {
    return { status: 'ok', loaded: false, mode: 'sample', reason: 'no DB — screening uses the illustrative sample' };
  }
  try {
    const meta = await store.listMeta();
    if (meta.authoritative && meta.totalCount) {
      return { status: 'ok', loaded: true, totalCount: meta.totalCount, sources: meta.sources };
    }
    return { status: 'ok', loaded: false, mode: 'sample', reason: 'consolidated list not loaded — run sanctions-refresh' };
  } catch (err) {
    return { status: 'degraded', loaded: false, err: err.message };
  }
}

async function probeRag() {
  const store = require('../intelligence/rag-store');
  const embConfigured = require('../ai/embeddings').isConfigured();
  if (!store.isAvailable()) {
    return { status: 'ok', loaded: false, mode: 'bm25', reason: 'no DB — retrieval is BM25-only' };
  }
  try {
    const count = await store.count();
    const hybrid = count > 0 && embConfigured;
    return {
      status: 'ok',
      loaded: count > 0,
      indexedChunks: count,
      embeddingsConfigured: embConfigured,
      mode: hybrid ? 'hybrid' : 'bm25',
      ...(count > 0 && !embConfigured ? { reason: 'vectors present but VOYAGE_API_KEY not set' } : {}),
      ...(count === 0 ? { reason: 'no vectors — run rag-reindex to enable semantic retrieval' } : {}),
    };
  } catch (err) {
    return { status: 'degraded', loaded: false, err: err.message };
  }
}

function aggregate(subsystems) {
  // KV-down is the historical paging condition. As of BG-2.1 Postgres
  // is also a source-of-truth — when it's down + configured, that's a
  // paging condition too (e.g. audit log writes will fail). If
  // Postgres isn't configured at all (DATABASE_URL unset), it stays
  // degraded — the platform still runs KV-only.
  if (subsystems.kv && subsystems.kv.status === 'down') return 'down';
  if (subsystems.postgres && subsystems.postgres.status === 'down') return 'down';
  for (const s of Object.values(subsystems)) {
    if (s && s.status === 'degraded') return 'degraded';
  }
  return 'ok';
}

module.exports = async (req, res) => {
  // Hard limit: GET only. Status checks are read-only.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Allow', 'GET, HEAD');
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const requestId = req.requestId || null;
  const totalProbeStart = Date.now();

  // Run async probes in parallel with per-probe timeouts (P0.8).
  // Sync probes (env-var checks) finish immediately — kept inline.
  const [kvR, postgresR, taricR, sanctionsR, ragR] = await Promise.all([
    probeWithTimeout(probeKv, PROBE_TIMEOUT_MS, ({ latencyMs, err }) => ({
      status: 'down',
      mode: kv.getMode(),
      probedAt: new Date().toISOString(),
      latencyMs,
      err,
    })),
    probeWithTimeout(probePostgres, PROBE_TIMEOUT_MS, ({ latencyMs, err }) => {
      // If PG isn't configured, the probe never makes a network call so
      // the timeout shouldn't fire — but if somehow it does, treat as
      // degraded (matches the not-configured baseline).
      const configured = db.isConfigured();
      return {
        status: configured ? 'down' : 'degraded',
        configured,
        latencyMs,
        err,
      };
    }),
    probeWithTimeout(probeTaricWarmth, PROBE_TIMEOUT_MS, ({ latencyMs, err }) => ({
      status: 'degraded',
      lastWarmAt: null,
      ageHours: null,
      latencyMs,
      err,
      reason: `probe timeout (${err})`,
    })),
    probeWithTimeout(probeSanctions, PROBE_TIMEOUT_MS, ({ latencyMs, err }) => ({
      status: 'degraded',
      loaded: false,
      mode: 'sample',
      latencyMs,
      err,
      reason: `probe timeout (${err})`,
    })),
    probeWithTimeout(probeRag, PROBE_TIMEOUT_MS, ({ latencyMs, err }) => ({
      status: 'degraded',
      loaded: false,
      mode: 'bm25',
      latencyMs,
      err,
      reason: `probe timeout (${err})`,
    })),
  ]);

  const subsystems = {
    kv: kvR,
    postgres: postgresR,
    taric: taricR,
    resend: probeEnvVar('RESEND_API_KEY'),
    stripe: probeEnvVar('STRIPE_SECRET_KEY'),
    anthropic: probeAnthropic(),
    sentry: probeSentry(),
    sanctions: sanctionsR,
    rag: ragR,
  };

  const totalProbeLatencyMs = Date.now() - totalProbeStart;

  // Sprint BG-4.4: surface circuit-breaker states. An open breaker means
  // an upstream is currently being short-circuited — this is more useful
  // than env-presence alone because it captures actual recent failures.
  // The breaker overlays onto its subsystem: if the breaker is open the
  // subsystem flips to degraded even when its env var is present.
  try {
    const resendCircuit = await circuit.state('resend');
    if (resendCircuit !== 'closed') {
      subsystems.resend.circuit = resendCircuit;
      subsystems.resend.status = 'degraded';
      subsystems.resend.reason = `circuit ${resendCircuit}`;
    } else {
      subsystems.resend.circuit = 'closed';
    }
  } catch (_) { /* circuit state unreachable — leave env-only status */ }

  const status = aggregate(subsystems);
  const payload = {
    status,
    ts: new Date().toISOString(),
    requestId,
    version: process.env.VERCEL_GIT_COMMIT_SHA
      ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 8)
      : 'dev',
    // Phase 0 P0.8 — endpoint-level SLO. Parallel execution + 2s per-probe
    // timeout caps total at ~2.5s; budget is 3s with slack. Uptime checkers
    // can alert when actualMs > budgetMs even at status: 'ok'.
    slo: {
      perProbeTimeoutMs: PROBE_TIMEOUT_MS,
      budgetMs: SLO_TOTAL_BUDGET_MS,
      actualMs: totalProbeLatencyMs,
      withinBudget: totalProbeLatencyMs <= SLO_TOTAL_BUDGET_MS,
    },
    subsystems,
  };

  // Log at the right severity so the uptime probe can grep it easily.
  if (status === 'down') {
    log.error('health probe DOWN', { requestId, subsystems });
  } else if (status === 'degraded') {
    log.warn('health probe degraded', { requestId, degraded: Object.entries(subsystems).filter(([_, v]) => v.status !== 'ok').map(([k]) => k) });
  } else {
    log.info('health probe ok', { requestId });
  }

  res.statusCode = status === 'down' ? 503 : 200;
  res.setHeader('Content-Type', 'application/json');
  // Cache-Control: never cache. Health must reflect live state.
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'HEAD') {
    return res.end();
  }
  return res.end(JSON.stringify(payload));
};

// Test surface
module.exports.probeKv = probeKv;
module.exports.probeTaricWarmth = probeTaricWarmth;
module.exports.probeEnvVar = probeEnvVar;
module.exports.probeAnthropic = probeAnthropic;
module.exports.probePostgres = probePostgres;
module.exports.probeSentry = probeSentry;
module.exports.probeSanctions = probeSanctions;
module.exports.probeRag = probeRag;
module.exports.probeWithTimeout = probeWithTimeout;
module.exports.aggregate = aggregate;
module.exports.PROBE_KEY = PROBE_KEY;
module.exports.PROBE_TIMEOUT_MS = PROBE_TIMEOUT_MS;
module.exports.SLO_TOTAL_BUDGET_MS = SLO_TOTAL_BUDGET_MS;
module.exports.TARIC_WARM_TIMESTAMP_KEY = TARIC_WARM_TIMESTAMP_KEY;
module.exports.TARIC_STALE_HOURS = TARIC_STALE_HOURS;
