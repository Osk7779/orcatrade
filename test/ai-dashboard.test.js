// Tests for /dashboard/ai/ — Sprint BG-6.5.
//
// Three layers under test:
//   1. events.ALLOWED_TYPES includes 'ai_call' so cost-telemetry can record
//   2. cost-telemetry.recordAnthropicCall writes via events.record (fire-and-forget)
//   3. /dashboard/ai/ markup contract + the aggregator's math

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
process.env.ORCATRADE_LOG_LEVEL = 'info';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const events = require('../lib/events');
const kv = require('../lib/intelligence/kv-store');
const telemetry = require('../lib/ai/cost-telemetry');

// ── Persistence wiring ──────────────────────────────────────

test('events.ALLOWED_TYPES includes ai_call', () => {
  assert.ok(events.ALLOWED_TYPES.has('ai_call'), 'ai_call must be an allowed event type');
});

test('recordAnthropicCall writes an ai_call event via events.record', async () => {
  kv._resetMemoryStore();
  telemetry.recordAnthropicCall({
    agent: 'orchestrator',
    promptVersion: 'v1',
    promptHash: 'abc123def456',
    model: 'claude-sonnet-4-7',
    requestId: 'rid-test',
    response: { usage: { input_tokens: 5000, output_tokens: 2000 }, stop_reason: 'end_turn' },
    latencyMs: 1234,
  });
  // events.record is fired without await; let the microtask queue drain.
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  const list = await events.list({ type: 'ai_call', limit: 10 });
  assert.equal(list.length, 1, 'one ai_call event recorded');
  const evt = list[0];
  assert.equal(evt.agent, 'orchestrator');
  assert.equal(evt.promptVersion, 'v1');
  assert.equal(evt.promptHash, 'abc123def456');
  assert.equal(evt.model, 'claude-sonnet-4-7');
  assert.equal(evt.inputTokens, 5000);
  assert.equal(evt.outputTokens, 2000);
  assert.equal(evt.stopReason, 'end_turn');
  assert.ok(Number.isFinite(evt.costCents) && evt.costCents > 0);
  assert.equal(evt.latencyMs, 1234);
});

test('events.record(ai_call) carries no PII (no email, no user identifier)', async () => {
  kv._resetMemoryStore();
  telemetry.recordAnthropicCall({
    agent: 'compliance',
    promptVersion: 'v1', promptHash: 'h',
    model: 'claude-sonnet-4-6',
    requestId: 'r',
    response: { usage: { input_tokens: 100, output_tokens: 50 } },
    latencyMs: 100,
  });
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  const list = await events.list({ type: 'ai_call', limit: 10 });
  const evt = list[0];
  assert.equal(evt.email, undefined, 'no email field');
  assert.equal(evt.name, undefined, 'no name field');
  assert.equal(evt.message, undefined, 'no free-text fields');
});

// ── Dashboard markup contract ───────────────────────────────

test('AI dashboard HTML page exists and carries required hooks', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'ai', 'index.html'), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex,\s*nofollow"/i);
  for (const id of ['tokenInput', 'reloadBtn', 'stats', 'byAgent', 'byPromptVersion', 'topCalls', 'errBanner', 'lastChecked']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `id="${id}" present`);
  }
  // Must fetch via /api/audit?type=ai_call to inherit the audit handler's
  // PII redaction + token gate.
  const js = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'ai', 'app.js'), 'utf8');
  assert.match(js, /\/api\/audit/);
  assert.match(js, /type:\s*['"]ai_call['"]/);
});

test('AI dashboard cites the cost source (no hidden pricing magic)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'ai', 'index.html'), 'utf8');
  assert.match(html, /anthropic\.com\/pricing/i);
  assert.match(html, /cost-telemetry\.js/);
});

// ── Aggregator unit tests (pulled from the dashboard's app.js via Node require) ─

const dashboardAgg = require('../dashboard/ai/app.js');

test('aggregate: empty input → all-zero shape', () => {
  const a = dashboardAgg.aggregate([]);
  assert.equal(a.totalCents, 0);
  assert.equal(a.callCount, 0);
  assert.deepEqual(a.byAgent, {});
  assert.deepEqual(a.byPromptVersion, {});
});

test('aggregate: sums costCents across ai_call events', () => {
  const a = dashboardAgg.aggregate([
    { type: 'ai_call', agent: 'orchestrator', promptVersion: 'v1', costCents: 50, inputTokens: 1000, outputTokens: 500, at: new Date().toISOString() },
    { type: 'ai_call', agent: 'sourcing',     promptVersion: 'v1', costCents: 30, inputTokens: 400,  outputTokens: 100, at: new Date().toISOString() },
    { type: 'ai_call', agent: 'orchestrator', promptVersion: 'v1', costCents: 20, inputTokens: 200,  outputTokens: 50,  at: new Date().toISOString() },
    { type: 'import_plan_generated', costCents: 9999 },  // ignored
  ]);
  assert.equal(a.totalCents, 100);
  assert.equal(a.callCount, 3);
  assert.equal(a.byAgent.orchestrator.cents, 70);
  assert.equal(a.byAgent.orchestrator.calls, 2);
  assert.equal(a.byAgent.sourcing.cents, 30);
  assert.equal(a.byPromptVersion['orchestrator:v1'].cents, 70);
  assert.equal(a.byPromptVersion['sourcing:v1'].cents, 30);
  assert.equal(a.totalInTokens, 1600);
  assert.equal(a.totalOutTokens, 650);
});

test('aggregate: inWeek isolates costCents from the last 7 days', () => {
  const oldDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const a = dashboardAgg.aggregate([
    { type: 'ai_call', agent: 'a', costCents: 100, at: oldDate },
    { type: 'ai_call', agent: 'a', costCents: 50,  at: recentDate },
  ]);
  assert.equal(a.totalCents, 150);
  assert.equal(a.inWeek, 50);
});

test('fmtCents: <100 → cents, ≥100 → euros', () => {
  assert.equal(dashboardAgg.fmtCents(0), '0c');
  assert.equal(dashboardAgg.fmtCents(50), '50c');
  assert.equal(dashboardAgg.fmtCents(100), '€1.00');
  assert.equal(dashboardAgg.fmtCents(12345), '€123.45');
});
