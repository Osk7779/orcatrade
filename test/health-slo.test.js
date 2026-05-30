'use strict';

// Phase 0 task P0.8 of docs/execution-plan.md.
//
// Verifies the /api/health endpoint's SLO posture:
//
//   1. probeWithTimeout enforces a hard ceiling per probe; a hung probe
//      times out at PROBE_TIMEOUT_MS instead of holding the endpoint
//      open indefinitely.
//   2. Parallel execution caps total endpoint latency at
//      ~max(probe_latency) + slack instead of sum-of-all-probes.
//   3. The handler exports PROBE_TIMEOUT_MS + SLO_TOTAL_BUDGET_MS as
//      contract constants so an uptime checker can assert against them.
//   4. The handler runs probes in parallel (source-pin against a
//      future refactor that re-introduces sequential awaits).
//
// What this test does NOT cover (Phase 1):
//   - Recording p50/p95 to KV for /status/ historical plots. Deliberate
//     scope deferral per the comment in lib/handlers/health.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const health = require('../lib/handlers/health');

const ROOT = path.resolve(__dirname, '..');

// ── probeWithTimeout (the load-bearing helper) ──────────────────────────

test('probeWithTimeout resolves with probe result when fast', async () => {
  const result = await health.probeWithTimeout(
    async () => ({ status: 'ok', greeting: 'hi' }),
    100,
    () => ({ status: 'down', err: 'unexpected timeout' }),
  );
  assert.deepEqual(result, { status: 'ok', greeting: 'hi' });
});

test('probeWithTimeout fires onTimeout when probe hangs', async () => {
  const start = Date.now();
  const result = await health.probeWithTimeout(
    () => new Promise(() => {/* never resolves */}),
    50,  // 50ms ceiling for the test
    ({ latencyMs, err }) => ({ status: 'down', latencyMs, err }),
  );
  const elapsed = Date.now() - start;
  assert.equal(result.status, 'down');
  assert.match(result.err, /^timeout \(50ms\)/);
  // Latency should be ~50ms; assert it's bounded under 200ms (generous
  // for slow CI).
  assert.ok(result.latencyMs >= 40 && result.latencyMs < 200,
    `latencyMs should be ~50ms; was ${result.latencyMs}`);
  assert.ok(elapsed < 200,
    `total elapsed should be bounded by the timeout, not the hung probe; was ${elapsed}ms`);
});

test('probeWithTimeout re-throws non-timeout errors so the caller can handle them', async () => {
  await assert.rejects(
    () => health.probeWithTimeout(
      async () => { throw new Error('database is on fire'); },
      100,
      () => ({ status: 'down', err: 'should-not-be-called' }),
    ),
    /database is on fire/,
    'a non-timeout throw must propagate, not be misinterpreted as timeout',
  );
});

// ── Parallel-execution latency bound ────────────────────────────────────

test('5 slow probes run in parallel complete in ~max, not sum', async () => {
  // Five probes that each sleep 100ms. Sequential = 500ms; parallel ≈ 100ms.
  const start = Date.now();
  const results = await Promise.all([1, 2, 3, 4, 5].map((n) =>
    health.probeWithTimeout(
      () => new Promise((resolve) => setTimeout(() => resolve({ status: 'ok', n }), 100)),
      health.PROBE_TIMEOUT_MS,
      () => ({ status: 'down', err: 'unexpected timeout' }),
    ),
  ));
  const elapsed = Date.now() - start;
  assert.equal(results.length, 5);
  assert.ok(elapsed < 300,
    `5 × 100ms probes in parallel should complete in <300ms; took ${elapsed}ms (sequential would be 500ms+)`);
});

// ── Contract constants ─────────────────────────────────────────────────

test('PROBE_TIMEOUT_MS and SLO_TOTAL_BUDGET_MS are exported as contract', () => {
  assert.equal(typeof health.PROBE_TIMEOUT_MS, 'number');
  assert.ok(health.PROBE_TIMEOUT_MS > 0 && health.PROBE_TIMEOUT_MS <= 5000,
    'per-probe timeout should be (0, 5000]ms');
  assert.equal(typeof health.SLO_TOTAL_BUDGET_MS, 'number');
  assert.ok(health.SLO_TOTAL_BUDGET_MS >= health.PROBE_TIMEOUT_MS,
    'total budget must be ≥ per-probe ceiling (otherwise impossible to satisfy)');
});

test('SLO total budget covers parallel-execution worst case + small slack', () => {
  // The budget should be at least the per-probe ceiling plus slack for
  // serialisation, log emit, and JSON encoding. If the budget is set
  // too tight, the SLO will alert spuriously.
  const minimumBudget = health.PROBE_TIMEOUT_MS + 500;
  assert.ok(health.SLO_TOTAL_BUDGET_MS >= minimumBudget,
    `SLO_TOTAL_BUDGET_MS (${health.SLO_TOTAL_BUDGET_MS}) should be ≥ per-probe ceiling + 500ms slack (${minimumBudget})`);
});

// ── Source-pin: handler runs probes in parallel ─────────────────────────

test('handler runs async probes via Promise.all (parallel, not sequential)', () => {
  // Source-pin: a future refactor that re-introduces `await probeKv()`
  // → `await probePostgres()` (sequential) would silently break the
  // SLO. This assertion fails loudly on that regression.
  const src = fs.readFileSync(path.join(ROOT, 'lib/handlers/health.js'), 'utf8');
  assert.match(src, /Promise\.all\(\[/,
    'health.js handler must use Promise.all to run probes in parallel');
  assert.match(src, /probeWithTimeout\(probeKv,/,
    'probeKv must be wrapped in probeWithTimeout (per-probe ceiling)');
  assert.match(src, /probeWithTimeout\(probePostgres,/,
    'probePostgres must be wrapped in probeWithTimeout');
  assert.match(src, /probeWithTimeout\(probeTaricWarmth,/,
    'probeTaricWarmth must be wrapped in probeWithTimeout');
  assert.match(src, /probeWithTimeout\(probeSanctions,/,
    'probeSanctions must be wrapped in probeWithTimeout');
  assert.match(src, /probeWithTimeout\(probeRag,/,
    'probeRag must be wrapped in probeWithTimeout');
});

test('handler emits slo block in the response payload', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/handlers/health.js'), 'utf8');
  assert.match(src, /slo:\s*\{/,
    'payload must include the slo block so uptime checkers can read perProbeTimeoutMs / budgetMs / actualMs / withinBudget');
  assert.match(src, /perProbeTimeoutMs:\s*PROBE_TIMEOUT_MS/);
  assert.match(src, /budgetMs:\s*SLO_TOTAL_BUDGET_MS/);
  assert.match(src, /actualMs:\s*totalProbeLatencyMs/);
  assert.match(src, /withinBudget:\s*totalProbeLatencyMs\s*<=\s*SLO_TOTAL_BUDGET_MS/);
});
