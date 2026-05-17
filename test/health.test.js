// Tests for lib/handlers/health.js — Sprint BG-4.3 operational status probe.
//
// Strategy: exercise the aggregate logic + individual probes against the
// in-memory KV fallback. The probeKv test sets a key and reads it back;
// the probeTaricWarmth test writes a recent + stale timestamp and asserts
// the verdict; aggregate covers the down/degraded/ok matrix.

const test = require('node:test');
const assert = require('node:assert/strict');

const kv = require('../lib/intelligence/kv-store');
const health = require('../lib/handlers/health');

// Snapshot + restore the relevant env vars across tests so we don't leak.
// Must be async-aware: if fn returns a Promise, restore in its .finally —
// otherwise the sync finally below restores env vars BEFORE the awaited
// test code observes them.
async function withEnv(overrides, fn) {
  const keys = Object.keys(overrides);
  const prev = {};
  for (const k of keys) { prev[k] = process.env[k]; }
  for (const k of keys) {
    if (overrides[k] == null) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

// ── aggregate ────────────────────────────────────────────────────

test('aggregate: every subsystem ok → ok', () => {
  assert.equal(health.aggregate({
    kv: { status: 'ok' }, taric: { status: 'ok' },
    resend: { status: 'ok' }, stripe: { status: 'ok' }, anthropic: { status: 'ok' },
  }), 'ok');
});

test('aggregate: one degraded subsystem → degraded', () => {
  assert.equal(health.aggregate({
    kv: { status: 'ok' }, taric: { status: 'ok' },
    resend: { status: 'degraded' }, stripe: { status: 'ok' }, anthropic: { status: 'ok' },
  }), 'degraded');
});

test('aggregate: kv down → down (overrides degraded)', () => {
  assert.equal(health.aggregate({
    kv: { status: 'down' }, taric: { status: 'degraded' },
    resend: { status: 'ok' }, stripe: { status: 'ok' }, anthropic: { status: 'ok' },
  }), 'down');
});

test('aggregate: kv ok but taric degraded → degraded (kv-down threshold is hard)', () => {
  assert.equal(health.aggregate({
    kv: { status: 'ok' }, taric: { status: 'degraded' },
    resend: { status: 'ok' }, stripe: { status: 'ok' }, anthropic: { status: 'ok' },
  }), 'degraded');
});

// ── probeKv ───────────────────────────────────────────────────────

test('probeKv: round-trips a probe value through the store', async () => {
  kv._resetMemoryStore();
  const r = await health.probeKv();
  assert.equal(r.status, 'ok');
  assert.ok(['memory', 'rest'].includes(r.mode));
  assert.match(r.probedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Number.isFinite(r.latencyMs));
  assert.ok(r.latencyMs >= 0);
});

// ── probeTaricWarmth ──────────────────────────────────────────────

test('probeTaricWarmth: never-warmed → degraded with reason', async () => {
  kv._resetMemoryStore();
  const r = await health.probeTaricWarmth();
  assert.equal(r.status, 'degraded');
  assert.equal(r.lastWarmAt, null);
  assert.match(r.reason || '', /never warmed/i);
});

test('probeTaricWarmth: recent timestamp → ok', async () => {
  kv._resetMemoryStore();
  await kv.set('taric:warm:lastRun', new Date().toISOString(), { ttlSeconds: 60 * 60 * 24 });
  const r = await health.probeTaricWarmth();
  assert.equal(r.status, 'ok');
  assert.ok(r.ageHours >= 0 && r.ageHours < 1);
});

test('probeTaricWarmth: stale (>25h) → degraded with reason', async () => {
  kv._resetMemoryStore();
  const ancient = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
  await kv.set('taric:warm:lastRun', ancient, { ttlSeconds: 60 * 60 * 24 });
  const r = await health.probeTaricWarmth();
  assert.equal(r.status, 'degraded');
  assert.ok(r.ageHours > 25);
  assert.match(r.reason || '', /stale/i);
});

test('probeTaricWarmth: invalid timestamp → degraded', async () => {
  kv._resetMemoryStore();
  await kv.set('taric:warm:lastRun', 'not-a-date', { ttlSeconds: 60 });
  const r = await health.probeTaricWarmth();
  assert.equal(r.status, 'degraded');
  assert.equal(r.ageHours, null);
});

// ── probeEnvVar ──────────────────────────────────────────────────

test('probeEnvVar: present → ok + configured:true', () => {
  withEnv({ TEST_HEALTH_VAR: 'sk_test_123' }, () => {
    const r = health.probeEnvVar('TEST_HEALTH_VAR');
    assert.equal(r.status, 'ok');
    assert.equal(r.configured, true);
  });
});

test('probeEnvVar: missing → degraded with reason', () => {
  withEnv({ TEST_HEALTH_VAR: null }, () => {
    const r = health.probeEnvVar('TEST_HEALTH_VAR');
    assert.equal(r.status, 'degraded');
    assert.equal(r.configured, false);
    assert.match(r.reason, /not set/);
  });
});

// ── End-to-end handler ──────────────────────────────────────────

function mockReqRes({ method = 'GET' } = {}) {
  const headers = {};
  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader(k, v) { headers[k] = v; },
    body: '',
    end(b) { this.body = b || ''; this.headersSent = true; return this; },
  };
  const req = { method, requestId: 'test-rid' };
  return { req, res, headers };
}

test('handler rejects non-GET with 405', async () => {
  const { req, res } = mockReqRes({ method: 'POST' });
  await health(req, res);
  assert.equal(res.statusCode, 405);
});

test('handler returns 200 + degraded when only DATABASE_URL is missing (postgres-not-configured)', async () => {
  // Sprint BG-2.1 added postgres as a subsystem. When DATABASE_URL is unset
  // the postgres probe returns "degraded" (the platform still runs KV-only)
  // — which means the overall status flips to degraded even with every
  // other env var set. This is the realistic "live in dev with no Neon" path.
  kv._resetMemoryStore();
  await kv.set('taric:warm:lastRun', new Date().toISOString(), { ttlSeconds: 60 });
  await withEnv({
    RESEND_API_KEY: 'x', STRIPE_SECRET_KEY: 'x', ANTHROPIC_API_KEY: 'x', ORCATRADE_OS_API: null,
    DATABASE_URL: null, DATABASE_URL_UNPOOLED: null,
  }, async () => {
    const { req, res } = mockReqRes();
    await health(req, res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'degraded', 'postgres unconfigured → overall degraded');
    assert.equal(body.subsystems.kv.status, 'ok');
    assert.equal(body.subsystems.taric.status, 'ok');
    assert.equal(body.subsystems.resend.status, 'ok');
    assert.equal(body.subsystems.anthropic.status, 'ok');
    assert.equal(body.subsystems.postgres.status, 'degraded');
    assert.equal(body.subsystems.postgres.configured, false);
  });
});

test('handler returns 200 + degraded when one env var missing', async () => {
  kv._resetMemoryStore();
  await kv.set('taric:warm:lastRun', new Date().toISOString(), { ttlSeconds: 60 });
  await withEnv({
    RESEND_API_KEY: null, STRIPE_SECRET_KEY: 'x', ANTHROPIC_API_KEY: 'x', ORCATRADE_OS_API: null,
  }, async () => {
    const { req, res } = mockReqRes();
    await health(req, res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'degraded');
    assert.equal(body.subsystems.resend.status, 'degraded');
    assert.equal(body.subsystems.resend.configured, false);
  });
});

test('probeAnthropic: ANTHROPIC_API_KEY OR ORCATRADE_OS_API counts as configured', () => {
  withEnv({ ANTHROPIC_API_KEY: null, ORCATRADE_OS_API: 'sk_legacy' }, () => {
    const r = health.probeAnthropic();
    assert.equal(r.status, 'ok');
    assert.equal(r.configured, true);
  });
  withEnv({ ANTHROPIC_API_KEY: 'sk_new', ORCATRADE_OS_API: null }, () => {
    const r = health.probeAnthropic();
    assert.equal(r.status, 'ok');
  });
  withEnv({ ANTHROPIC_API_KEY: null, ORCATRADE_OS_API: null }, () => {
    const r = health.probeAnthropic();
    assert.equal(r.status, 'degraded');
    assert.equal(r.configured, false);
  });
});

test('handler shape: returns ts/version/subsystems', async () => {
  kv._resetMemoryStore();
  const { req, res } = mockReqRes();
  await health(req, res);
  const body = JSON.parse(res.body);
  assert.match(body.ts, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(typeof body.version === 'string');
  assert.ok(body.subsystems.kv);
  assert.ok(body.subsystems.taric);
  assert.ok(body.subsystems.resend);
  assert.ok(body.subsystems.stripe);
  assert.ok(body.subsystems.anthropic);
});

test('handler sets Cache-Control: no-store (live state)', async () => {
  const { req, res, headers } = mockReqRes();
  await health(req, res);
  assert.equal(headers['Cache-Control'], 'no-store');
});

// ── Sprint BG-4.4: circuit overlay ───────────────────────────────

test('resend subsystem flips to degraded when its circuit is open (env var present)', async () => {
  const circuit = require('../lib/circuit');
  kv._resetMemoryStore();
  await kv.set('taric:warm:lastRun', new Date().toISOString(), { ttlSeconds: 60 });
  // Force the resend circuit open.
  await circuit._writeState('resend', { state: 'open', failures: 5, openedAt: Date.now() });
  await withEnv({
    RESEND_API_KEY: 'present', STRIPE_SECRET_KEY: 'x', ANTHROPIC_API_KEY: 'x', ORCATRADE_OS_API: null,
  }, async () => {
    const { req, res } = mockReqRes();
    await health(req, res);
    const body = JSON.parse(res.body);
    assert.equal(body.subsystems.resend.status, 'degraded');
    assert.equal(body.subsystems.resend.configured, true);
    assert.equal(body.subsystems.resend.circuit, 'open');
    assert.match(body.subsystems.resend.reason || '', /circuit open/);
    assert.equal(body.status, 'degraded'); // overall flips too
  });
  // Reset for downstream tests.
  await circuit.reset('resend');
});

test('resend circuit field is "closed" when breaker is healthy', async () => {
  const circuit = require('../lib/circuit');
  kv._resetMemoryStore();
  await kv.set('taric:warm:lastRun', new Date().toISOString(), { ttlSeconds: 60 });
  await circuit.reset('resend');
  await withEnv({
    RESEND_API_KEY: 'present', STRIPE_SECRET_KEY: 'x', ANTHROPIC_API_KEY: 'x', ORCATRADE_OS_API: null,
  }, async () => {
    const { req, res } = mockReqRes();
    await health(req, res);
    const body = JSON.parse(res.body);
    assert.equal(body.subsystems.resend.status, 'ok');
    assert.equal(body.subsystems.resend.circuit, 'closed');
  });
});
