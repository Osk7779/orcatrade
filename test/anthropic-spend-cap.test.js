'use strict';

// Apex P1.7 — per-tenant Anthropic spend cap (bill-protection).
//
// docs/runbooks/ai-agent-failure.md §7 documented the gap:
//   "a single user looping the chat agent" can blow past a tier's
//   agentQueriesPerMonth budget WHILE STILL BEING WITHIN it,
//   because long contexts on Opus 4.7 cost 5× more than the
//   per-query budget assumes. This PR ships the floor.
//
// Coverage:
//   1. Every tier carries a monthlyAnthropicSpendCapCents quota
//      (caps grow monotonically up the tier ladder; Enterprise = Infinity)
//   2. spend-cap module: recordSpend increments the monthly counter;
//      getMonthlySpend reads it; failure paths are non-throwing
//   3. gating.checkAgentSpend: returns allowed when under cap;
//      429 with tier_spend_cap code when at/over; fails OPEN on
//      anonymous identity / KV outage
//   4. cost-telemetry side-effect: recordAnthropicCall now calls
//      spend-cap.recordSpend when email/emailHash is supplied
//   5. Source-pin: orchestrator handler wires gating.checkAgentSpend
//      pre-flight + threads email into withCostTelemetry

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const kv = require('../lib/intelligence/kv-store');
const tiers = require('../lib/tiers');
const spendCap = require('../lib/ai/spend-cap');
const gating = require('../lib/gating');
const costTelemetry = require('../lib/ai/cost-telemetry');
const hashLib = require('../lib/hash');

// ── tier configuration ────────────────────────────────────────────

test('every tier defines monthlyAnthropicSpendCapCents', () => {
  for (const tier of tiers.TIERS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(tier.quotas, 'monthlyAnthropicSpendCapCents'),
      `tier ${tier.id} must declare monthlyAnthropicSpendCapCents`,
    );
  }
});

test('spend caps are monotonic up the tier ladder (free < starter < growth < scale)', () => {
  const get = (id) => tiers.getQuota(id, 'monthlyAnthropicSpendCapCents');
  const free = get('free');
  const starter = get('starter');
  const growth = get('growth');
  const scale = get('scale');
  const enterprise = get('enterprise');
  assert.ok(free > 0, 'free tier has a positive defensive floor (€1)');
  assert.ok(starter > free, `starter (${starter}) > free (${free})`);
  assert.ok(growth > starter, `growth (${growth}) > starter (${starter})`);
  assert.ok(scale > growth, `scale (${scale}) > growth (${growth})`);
  assert.equal(enterprise, Infinity, 'enterprise tier is unlimited (negotiated per contract)');
});

// ── spend-cap module ──────────────────────────────────────────────

test('recordSpend writes the per-month counter keyed by email_hash', async () => {
  kv._resetMemoryStore();
  const res = await spendCap.recordSpend({ email: 'alice@example.com', costCents: 250 });
  assert.equal(res.recorded, true);
  assert.equal(res.total, 250);
  const expectedKey = spendCap.spendKey(hashLib.emailHash('alice@example.com'), spendCap.currentMonthBucket());
  assert.equal(res.key, expectedKey);
});

test('recordSpend accumulates across calls within a month', async () => {
  kv._resetMemoryStore();
  await spendCap.recordSpend({ email: 'bob@example.com', costCents: 100 });
  await spendCap.recordSpend({ email: 'bob@example.com', costCents: 150 });
  const r3 = await spendCap.recordSpend({ email: 'bob@example.com', costCents: 50 });
  assert.equal(r3.total, 300);
});

test('recordSpend keeps users separate (no cross-tenant accumulation)', async () => {
  kv._resetMemoryStore();
  await spendCap.recordSpend({ email: 'a@example.com', costCents: 500 });
  await spendCap.recordSpend({ email: 'b@example.com', costCents: 100 });
  const a = await spendCap.getMonthlySpend({ email: 'a@example.com' });
  const b = await spendCap.getMonthlySpend({ email: 'b@example.com' });
  assert.equal(a.currentCents, 500);
  assert.equal(b.currentCents, 100);
});

test('recordSpend is a no-op on zero or negative cents', async () => {
  kv._resetMemoryStore();
  const r0 = await spendCap.recordSpend({ email: 'c@example.com', costCents: 0 });
  const rNeg = await spendCap.recordSpend({ email: 'c@example.com', costCents: -50 });
  const rNaN = await spendCap.recordSpend({ email: 'c@example.com', costCents: 'not-a-number' });
  assert.equal(r0.recorded, false);
  assert.equal(rNeg.recorded, false);
  assert.equal(rNaN.recorded, false);
});

test('recordSpend is a no-op when no identity is available', async () => {
  kv._resetMemoryStore();
  const noEmail = await spendCap.recordSpend({ costCents: 100 });
  assert.equal(noEmail.recorded, false);
  assert.equal(noEmail.reason, 'no-identity');
});

test('recordSpend accepts a pre-hashed email pseudonym (post-Article-17 identity)', async () => {
  kv._resetMemoryStore();
  // Already-hashed pseudonym (Article 17 pattern): pass through.
  const pseudonym = 'a1b2c3d4e5f60718';   // 16-hex, lib/hash.isAlreadyPseudonym shape
  const res = await spendCap.recordSpend({ emailHash: pseudonym, costCents: 200 });
  assert.equal(res.recorded, true);
  // Reading back with the same pseudonym returns the same counter.
  const read = await spendCap.getMonthlySpend({ emailHash: pseudonym });
  assert.equal(read.currentCents, 200);
});

test('getMonthlySpend returns 0 for an unknown user (no rows in KV yet)', async () => {
  kv._resetMemoryStore();
  const s = await spendCap.getMonthlySpend({ email: 'never-spent@example.com' });
  assert.equal(s.currentCents, 0);
  assert.match(s.bucket, /^\d{4}-\d{2}$/);
});

// ── gating.checkAgentSpend ─────────────────────────────────────────

// Build a minimal mock request that resolves identity to a known
// email via the auth cookie. resolveIdentity reads req.headers.cookie.
function makeReqWithSession(email) {
  const auth = require('../lib/auth');
  const cookie = auth.buildSessionCookie(email);
  return {
    method: 'POST', url: '/api/orchestrator',
    headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
    body: {},
  };
}

test('checkAgentSpend allows when under the tier cap', async () => {
  kv._resetMemoryStore();
  const req = makeReqWithSession('under-cap@example.com');
  // Free tier (default for unknown users) cap is 100 cents. Record 50.
  await spendCap.recordSpend({ email: 'under-cap@example.com', costCents: 50 });
  const v = await gating.checkAgentSpend(req);
  assert.equal(v.allowed, true);
  assert.equal(v.currentCents, 50);
  assert.equal(v.capCents, 100);
  assert.equal(v.remainingCents, 50);
});

test('checkAgentSpend rejects with 429 + tier_spend_cap code when over the tier cap', async () => {
  kv._resetMemoryStore();
  const req = makeReqWithSession('over-cap@example.com');
  // Free tier cap is 100 cents. Record 150.
  await spendCap.recordSpend({ email: 'over-cap@example.com', costCents: 150 });
  const v = await gating.checkAgentSpend(req);
  assert.equal(v.allowed, false);
  assert.equal(v.status, 429);
  assert.equal(v.body.code, 'tier_spend_cap');
  assert.equal(v.body.currentTier, 'free');
  assert.equal(v.body.currentEur, 1.5);
  assert.equal(v.body.capEur, 1.0);
  assert.match(v.body.upgradeUrl, /pricing/);
});

test('checkAgentSpend fails OPEN for anonymous identity (no email in session)', async () => {
  kv._resetMemoryStore();
  // No cookie → anonymous identity → ledger has nothing to read.
  const req = { method: 'POST', url: '/api/orchestrator', headers: {}, body: {} };
  const v = await gating.checkAgentSpend(req);
  assert.equal(v.allowed, true);
  assert.equal(v.kind, 'anonymous');
});

test('checkAgentSpend returns allowed:true with unlimited cap for enterprise tier', async () => {
  // Simulate an enterprise user. Set the tier directly via userTier.
  kv._resetMemoryStore();
  const userTier = require('../lib/user-tier');
  await userTier.setUserTier('enterprise-user@example.com', { tierId: 'enterprise', billingCycle: 'monthly', source: 'test' });
  // Record a huge spend.
  await spendCap.recordSpend({ email: 'enterprise-user@example.com', costCents: 100_000_00 });
  const req = makeReqWithSession('enterprise-user@example.com');
  const v = await gating.checkAgentSpend(req);
  assert.equal(v.allowed, true);
  assert.equal(v.capCents, 'unlimited');
});

// ── cost-telemetry side-effect ────────────────────────────────────

test('recordAnthropicCall records spend into the ledger when email is provided', async () => {
  kv._resetMemoryStore();
  // Stub Anthropic response with a known token count → known cost.
  const fakeResponse = {
    usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    stop_reason: 'end_turn',
  };
  costTelemetry.recordAnthropicCall({
    agent: 'orchestrator',
    model: 'claude-opus-4-7',
    response: fakeResponse,
    latencyMs: 1234,
    email: 'metered@example.com',
  });
  // Recording is fire-and-forget; settle then read.
  await new Promise((r) => setTimeout(r, 30));
  const s = await spendCap.getMonthlySpend({ email: 'metered@example.com' });
  assert.ok(s.currentCents > 0, 'spend ledger must reflect the cost of the call');
});

test('recordAnthropicCall is a no-op on the ledger when no email/emailHash provided', async () => {
  kv._resetMemoryStore();
  const fakeResponse = {
    usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    stop_reason: 'end_turn',
  };
  costTelemetry.recordAnthropicCall({
    agent: 'orchestrator',
    model: 'claude-opus-4-7',
    response: fakeResponse,
    latencyMs: 1234,
  });
  await new Promise((r) => setTimeout(r, 30));
  // No identity → no ledger entry; the function still logs the
  // structured telemetry line either way (verifiable in
  // /dashboard/ai/), but the spend gate has nothing to count.
  const s = await spendCap.getMonthlySpend({ email: 'metered@example.com' });
  assert.equal(s.currentCents, 0);
});

// ── source-pin: orchestrator handler wires the gate + telemetry ──

test('orchestrator handler calls gating.checkAgentSpend pre-flight', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/handlers/orchestrator.js'), 'utf8');
  assert.match(
    src,
    /gating\.checkAgentSpend\(req\)/,
    'orchestrator must call checkAgentSpend before invoking Anthropic',
  );
  // Pin the order: spend gate must come AFTER feature/quota gates
  // (so the tier-gate copy comes first when both would fail) and
  // BEFORE Anthropic invocation.
  assert.match(
    src,
    /checkQuota[\s\S]{0,1000}checkAgentSpend[\s\S]{0,4000}callAnthropic/,
    'gate order: feature → quota → spend → callAnthropic',
  );
});

test('orchestrator threads email into withCostTelemetry so spend gets recorded', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/handlers/orchestrator.js'), 'utf8');
  assert.match(
    src,
    /withCostTelemetry\(\s*\{[\s\S]{0,1200}email:\s*\(auth\.getCurrentUser\(req\)\s*\|\|\s*\{\}\)\.email/,
    'withCostTelemetry must receive email so the ledger is populated',
  );
});
