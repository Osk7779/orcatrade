// /dashboard/ai/ per-tenant rollup — apex P1.7 visibility (PR #49).
//
// Two surfaces under test:
//   1. cost-telemetry.recordAnthropicCall hashes the caller's email to
//      emailHash via lib/hash (16-hex SHA-256) before the ai_call event
//      hits storage — raw email NEVER lands in the event payload.
//   2. The dashboard's aggregate() builds a byTenant rollup grouped by
//      emailHash, with anonymous calls bucketed under '(anonymous)'.

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
const hash = require('../lib/hash');

const dashboardAgg = require('../dashboard/ai/app.js');

// ── Upstream: cost-telemetry → emailHash ──────────────────────

test('recordAnthropicCall hashes email into emailHash before persisting', async () => {
  kv._resetMemoryStore();
  telemetry.recordAnthropicCall({
    agent: 'orchestrator',
    promptVersion: 'v1', promptHash: 'h',
    model: 'claude-opus-4-7',
    requestId: 'r',
    response: { usage: { input_tokens: 1000, output_tokens: 500 } },
    latencyMs: 10,
    email: 'Alice@Example.COM',  // mixed case + whitespace robustness
  });
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  const list = await events.list({ type: 'ai_call', limit: 10 });
  assert.equal(list.length, 1);
  const evt = list[0];
  assert.equal(evt.email, undefined, 'raw email must never enter the event payload');
  assert.equal(evt.emailHash, hash.emailHash('alice@example.com'), 'emailHash is deterministic + case-insensitive');
  assert.equal(evt.emailHash.length, 16, '16-hex pseudonym per lib/hash contract');
});

test('recordAnthropicCall without email omits emailHash entirely', async () => {
  kv._resetMemoryStore();
  telemetry.recordAnthropicCall({
    agent: 'compliance',
    promptVersion: 'v1', promptHash: 'h',
    model: 'claude-sonnet-4-6',
    requestId: 'r',
    response: { usage: { input_tokens: 100, output_tokens: 50 } },
    latencyMs: 10,
  });
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  const list = await events.list({ type: 'ai_call', limit: 10 });
  assert.equal(list[0].emailHash, undefined, 'anonymous calls carry no emailHash');
});

// ── Dashboard aggregator: byTenant rollup ─────────────────────

test('aggregate: byTenant groups ai_call events by emailHash', () => {
  const a = dashboardAgg.aggregate([
    { type: 'ai_call', agent: 'orchestrator', emailHash: 'aaa111', costCents: 50, at: new Date().toISOString() },
    { type: 'ai_call', agent: 'compliance',   emailHash: 'aaa111', costCents: 30, at: new Date().toISOString() },
    { type: 'ai_call', agent: 'sourcing',     emailHash: 'bbb222', costCents: 20, at: new Date().toISOString() },
  ]);
  assert.equal(a.byTenant['aaa111'].cents, 80, 'two calls from same tenant summed');
  assert.equal(a.byTenant['aaa111'].calls, 2);
  assert.equal(a.byTenant['bbb222'].cents, 20);
  assert.equal(a.byTenant['bbb222'].calls, 1);
});

test('aggregate: byTenant buckets events without emailHash under (anonymous)', () => {
  const a = dashboardAgg.aggregate([
    { type: 'ai_call', agent: 'orchestrator', emailHash: 'aaa111', costCents: 50, at: new Date().toISOString() },
    { type: 'ai_call', agent: 'compliance',                       costCents: 30, at: new Date().toISOString() },
    { type: 'ai_call', agent: 'sourcing',                         costCents: 20, at: new Date().toISOString() },
  ]);
  assert.ok(a.byTenant['(anonymous)'], 'anonymous bucket exists');
  assert.equal(a.byTenant['(anonymous)'].cents, 50);
  assert.equal(a.byTenant['(anonymous)'].calls, 2);
});

test('aggregate: byTenant tracks per-agent breakdown so dashboard can show top agent', () => {
  const a = dashboardAgg.aggregate([
    { type: 'ai_call', agent: 'compliance',   emailHash: 'aaa', costCents: 10, at: new Date().toISOString() },
    { type: 'ai_call', agent: 'compliance',   emailHash: 'aaa', costCents: 10, at: new Date().toISOString() },
    { type: 'ai_call', agent: 'orchestrator', emailHash: 'aaa', costCents: 50, at: new Date().toISOString() },
  ]);
  const t = a.byTenant['aaa'];
  assert.equal(t.agents.compliance, 2);
  assert.equal(t.agents.orchestrator, 1);
});

test('aggregate: byTenant captures the most-recent tier observed per tenant', () => {
  // Events arrive newest-first from /api/audit (events.list contract). The
  // aggregator walks them in array order and the first non-null tier wins.
  const a = dashboardAgg.aggregate([
    { type: 'ai_call', agent: 'orchestrator', emailHash: 'aaa', tier: 'scale',  costCents: 10, at: new Date().toISOString() },
    { type: 'ai_call', agent: 'orchestrator', emailHash: 'aaa', tier: 'growth', costCents: 10, at: new Date().toISOString() },
  ]);
  assert.equal(a.byTenant['aaa'].tier, 'scale', 'newest non-null tier is the rollup tier');
});

// ── HTML contract — the panel + the JS hook ───────────────────

test('AI dashboard HTML carries the byTenant panel hook', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'ai', 'index.html'), 'utf8');
  assert.match(html, /id=["']byTenant["']/, 'byTenant element id present');
  assert.match(html, /Spend by tenant/i, 'panel heading present');
});

test('AI dashboard JS renders byTenant via a renderByTenant function', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'ai', 'app.js'), 'utf8');
  // Source-pin: the renderer must exist AND be wired into refresh().
  // Without this pin the panel could silently regress to "empty div".
  assert.match(js, /function renderByTenant\(/, 'renderByTenant function defined');
  assert.match(js, /renderByTenant\(agg\.byTenant\)/, 'renderByTenant called from refresh()');
});

test('AI dashboard JS sorts byTenant by spend desc and caps at top 20', () => {
  // Source-pin against the documented contract — the dashboard MUST cap
  // the visible table or a runaway-spender list could push the page off
  // the screen during an incident. The .slice(0, 20) is load-bearing.
  const js = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'ai', 'app.js'), 'utf8');
  assert.match(js, /\.slice\(0,\s*20\)/, 'top-20 cap present');
  assert.match(js, /b\[1\]\.cents\s*-\s*a\[1\]\.cents/, 'sorted by cents desc');
});
