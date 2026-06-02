// Apex P1.A — per-handler SLO instrumentation.
//
// Tests cover:
//   - percentiles() pure math (p50/p95/p99/max)
//   - record() never throws + persists to KV + caps at MAX_SAMPLES
//   - error array bumped only on status >= 500
//   - snapshot() returns the right shape + withinSlo verdict
//   - snapshotAll() iterates known handlers
//   - HANDLER_TARGETS covers the critical surfaces with sensible bands
//   - /api/slo handler returns the snapshot shape (cache-control no-store)
//   - safeKey rejects invalid handler names (no KV-key injection)

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');

const slo = require('../lib/slo');
const sloHandler = require('../lib/handlers/slo');
const kv = require('../lib/intelligence/kv-store');

// ── percentiles() pure math ──────────────────────────────────

test('percentiles: empty samples → all nulls + count=0', () => {
  const r = slo.percentiles([]);
  assert.equal(r.count, 0);
  assert.equal(r.p50, null);
  assert.equal(r.p95, null);
  assert.equal(r.p99, null);
  assert.equal(r.max, null);
});

test('percentiles: single sample → all percentiles equal that sample', () => {
  const r = slo.percentiles([100]);
  assert.equal(r.count, 1);
  assert.equal(r.p50, 100);
  assert.equal(r.p95, 100);
  assert.equal(r.p99, 100);
  assert.equal(r.max, 100);
});

test('percentiles: sorted ascending — p50 is median, p95 is high tail', () => {
  // Samples 1..100. p50 ≈ 50, p95 ≈ 95.
  const samples = Array.from({ length: 100 }, (_, i) => i + 1);
  const r = slo.percentiles(samples);
  assert.equal(r.count, 100);
  assert.equal(r.p50, 50);
  assert.equal(r.p95, 95);
  assert.equal(r.p99, 99);
  assert.equal(r.max, 100);
});

test('percentiles: rejects non-finite values (NaN / Infinity)', () => {
  const r = slo.percentiles([10, 20, NaN, Infinity, 30, -Infinity]);
  // Only 10, 20, 30 are finite → count = 3
  assert.equal(r.count, 3);
  assert.equal(r.max, 30);
});

// ── record() persistence ─────────────────────────────────────

test('record: persists latency to slo:samples:<handler> in KV', async () => {
  kv._resetMemoryStore();
  await slo.record('customs', 250, 200);
  const samples = await kv.get(slo._SAMPLES_KEY_PREFIX + 'customs');
  assert.ok(Array.isArray(samples));
  assert.equal(samples[0], 250);
});

test('record: newest first; caps at MAX_SAMPLES_PER_HANDLER', async () => {
  kv._resetMemoryStore();
  // Push MAX + 5 to trigger the cap.
  const cap = slo.MAX_SAMPLES_PER_HANDLER;
  for (let i = 0; i < cap + 5; i++) {
    await slo.record('customs', i, 200);
  }
  const samples = await kv.get(slo._SAMPLES_KEY_PREFIX + 'customs');
  assert.equal(samples.length, cap, 'cap enforced');
  // Newest first — last write was cap+4
  assert.equal(samples[0], cap + 4);
});

test('record: status < 500 does NOT bump the error array', async () => {
  kv._resetMemoryStore();
  await slo.record('customs', 100, 200);
  await slo.record('customs', 200, 404);
  const errors = await kv.get(slo._ERRORS_KEY_PREFIX + 'customs');
  // KV memory-store returns undefined for missing keys; either is OK.
  assert.ok(!errors || errors.length === 0);
});

test('record: status >= 500 bumps the error array', async () => {
  kv._resetMemoryStore();
  await slo.record('customs', 1500, 500);
  await slo.record('customs', 1600, 503);
  const errors = await kv.get(slo._ERRORS_KEY_PREFIX + 'customs');
  assert.equal(errors.length, 2);
  assert.equal(errors[0].status, 503, 'newest first');
});

test('record: never throws on bad input (telemetry must not break requests)', async () => {
  await assert.doesNotReject(async () => slo.record(null, 100, 200));
  await assert.doesNotReject(async () => slo.record('valid', NaN, 200));
  await assert.doesNotReject(async () => slo.record('invalid/key', 100, 200));
  await assert.doesNotReject(async () => slo.record('', 100));
});

test('safeKey: rejects KV-injection-shaped strings', () => {
  assert.equal(slo._safeKey('valid-key'), 'valid-key');
  assert.equal(slo._safeKey('also-VALID'), 'also-valid');
  assert.equal(slo._safeKey('invalid/slash'), null);
  assert.equal(slo._safeKey('invalid:colon'), null);
  assert.equal(slo._safeKey('invalid space'), null);
  assert.equal(slo._safeKey(null), null);
  assert.equal(slo._safeKey(undefined), null);
  assert.equal(slo._safeKey(''), null);
  assert.equal(slo._safeKey('a'.repeat(65)), null, 'over-long rejected');
});

// ── snapshot ─────────────────────────────────────────────────

test('snapshot: with samples → shape + within-SLO verdict (under target)', async () => {
  kv._resetMemoryStore();
  // Customs target = 1000ms. Push 100 samples all at 250ms → well under.
  for (let i = 0; i < 100; i++) await slo.record('customs', 250, 200);
  const r = await slo.snapshot('customs');
  assert.equal(r.handler, 'customs');
  assert.equal(r.count, 100);
  assert.equal(r.p95, 250);
  assert.equal(r.target_p95_ms, 1000);
  assert.equal(r.withinSlo, true);
  assert.equal(r.errorCount, 0);
});

test('snapshot: p95 over target → withinSlo:false', async () => {
  kv._resetMemoryStore();
  // 80 fast samples + 20 slow ones (100 total) → p95 (index ceil(0.95*100)-1
  // = 94 in sorted order) lands on the slow side. Customs target = 1000ms.
  for (let i = 0; i < 80; i++) await slo.record('customs', 100, 200);
  for (let i = 0; i < 20; i++) await slo.record('customs', 5000, 200);
  const r = await slo.snapshot('customs');
  assert.ok(r.p95 >= 5000, `expected p95 ≥ 5000, got ${r.p95}`);
  assert.equal(r.withinSlo, false);
});

test('snapshot: errors contribute to errorRate', async () => {
  kv._resetMemoryStore();
  // 8 ok + 2 errors → errorRate = 2 / 10 = 0.2
  for (let i = 0; i < 8; i++) await slo.record('customs', 100, 200);
  for (let i = 0; i < 2; i++) await slo.record('customs', 100, 500);
  const r = await slo.snapshot('customs');
  // The error array counts only the 500s; the samples array counts all 10
  // (status doesn't affect sample recording). So errorRate = 2 / (10 + 2) = 0.166…
  assert.ok(r.errorRate > 0.1 && r.errorRate < 0.5,
    `expected errorRate ≈ 0.166, got ${r.errorRate}`);
  assert.equal(r.errorCount, 2);
});

test('snapshot: no samples for a handler → empty-state response', async () => {
  kv._resetMemoryStore();
  const r = await slo.snapshot('orchestrator');
  assert.equal(r.handler, 'orchestrator');
  assert.equal(r.count, 0);
  assert.equal(r.p95, null);
  assert.equal(r.target_p95_ms, 12000, 'orchestrator target preserved even with no samples');
  assert.equal(r.withinSlo, null);
});

test('snapshot: invalid handler name → null (defensive)', async () => {
  const r = await slo.snapshot('inva/lid');
  assert.equal(r, null);
});

// ── snapshotAll ──────────────────────────────────────────────

test('snapshotAll: includes every HANDLER_TARGETS entry', async () => {
  kv._resetMemoryStore();
  const r = await slo.snapshotAll();
  assert.ok(r.generatedAt);
  for (const key of Object.keys(slo.HANDLER_TARGETS)) {
    assert.ok(r.handlers[key], `handler ${key} missing from snapshotAll`);
  }
});

// ── HANDLER_TARGETS calibration ─────────────────────────────

test('HANDLER_TARGETS covers the load-bearing surfaces with sensible bands', () => {
  const t = slo.HANDLER_TARGETS;
  // Health must be sub-500ms; anything else means the probe itself is slow.
  assert.ok(t.health <= 500, `health target ${t.health}ms must be ≤500`);
  // Orchestrator has the broadest tool surface; should have the longest budget.
  assert.ok(t.orchestrator >= t.agent, 'orchestrator p95 should be ≥ compliance agent');
  // Specialists in the 5-15s range.
  assert.ok(t.agent >= 3000 && t.agent <= 15000,
    `agent target ${t.agent}ms outside [3s, 15s]`);
  assert.ok(t.orchestrator <= 20000,
    `orchestrator target ${t.orchestrator}ms unreasonably high (>20s)`);
});

// ── /api/slo handler ─────────────────────────────────────────

function mockRes() {
  const headers = {};
  let body = '';
  let statusCode = 200;
  return {
    headers,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    end(b) { if (b) body = b; },
    get statusCode() { return statusCode; },
    set statusCode(v) { statusCode = v; },
    get body() { return body; },
  };
}

test('GET /api/slo returns the snapshot shape', async () => {
  kv._resetMemoryStore();
  await slo.record('customs', 250, 200);
  const req = { method: 'GET', headers: {}, query: { path: ['slo'] } };
  const res = mockRes();
  await sloHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['content-type'], 'application/json');
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.ok(body.generatedAt);
  assert.ok(body.handlers);
  assert.ok(body.handlers.customs, 'customs snapshot included');
});

test('GET /api/slo rejects non-GET', async () => {
  const req = { method: 'POST', headers: {}, query: {} };
  const res = mockRes();
  await sloHandler(req, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers['allow'], 'GET');
});

test('GET /api/slo OPTIONS preflight returns 200', async () => {
  const req = { method: 'OPTIONS', headers: {}, query: {} };
  const res = mockRes();
  await sloHandler(req, res);
  assert.equal(res.statusCode, 200);
});
