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

const PROBE_KEY = 'health:probe';
const PROBE_TTL_SECONDS = 60;
const TARIC_WARM_TIMESTAMP_KEY = 'taric:warm:lastRun';
const TARIC_STALE_HOURS = 25; // nightly cron runs at 04:15 UTC; >25h = it failed

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

// Anthropic accepts either env name across the codebase.
function probeAnthropic() {
  const present = !!(process.env.ANTHROPIC_API_KEY || process.env.ORCATRADE_OS_API);
  return {
    status: present ? 'ok' : 'degraded',
    configured: present,
    ...(present ? {} : { reason: 'ANTHROPIC_API_KEY (or ORCATRADE_OS_API) not set' }),
  };
}

function aggregate(subsystems) {
  if (subsystems.kv.status === 'down') return 'down';
  for (const s of Object.values(subsystems)) {
    if (s.status === 'degraded') return 'degraded';
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
  const subsystems = {
    kv: await probeKv(),
    taric: await probeTaricWarmth(),
    resend: probeEnvVar('RESEND_API_KEY'),
    stripe: probeEnvVar('STRIPE_SECRET_KEY'),
    anthropic: probeAnthropic(),
  };

  const status = aggregate(subsystems);
  const payload = {
    status,
    ts: new Date().toISOString(),
    requestId,
    version: process.env.VERCEL_GIT_COMMIT_SHA
      ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 8)
      : 'dev',
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
module.exports.aggregate = aggregate;
module.exports.PROBE_KEY = PROBE_KEY;
module.exports.TARIC_WARM_TIMESTAMP_KEY = TARIC_WARM_TIMESTAMP_KEY;
module.exports.TARIC_STALE_HOURS = TARIC_STALE_HOURS;
