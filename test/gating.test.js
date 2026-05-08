// Tier-gating tests (Sprint 42).

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const kv = require('../lib/intelligence/kv-store');
const auth = require('../lib/auth');
const userTier = require('../lib/user-tier');
const gating = require('../lib/gating');

function authedReq(email, ip = '1.2.3.4') {
  const cookie = auth.buildSessionCookie(email);
  return {
    method: 'POST',
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}`, 'x-forwarded-for': ip },
    url: '/api/whatever',
  };
}
function anonReq(ip = '1.2.3.4') {
  return { method: 'POST', headers: { 'x-forwarded-for': ip }, url: '/api/whatever' };
}

// ── resolveIdentity / resolveTierForRequest ─────────

test('resolveIdentity: signed-in → email', () => {
  const id = gating.resolveIdentity(authedReq('id@example.com'));
  assert.equal(id.kind, 'email');
  assert.equal(id.identity, 'id@example.com');
});

test('resolveIdentity: anonymous → ip:<ip>', () => {
  const id = gating.resolveIdentity(anonReq('9.9.9.9'));
  assert.equal(id.kind, 'ip');
  assert.equal(id.identity, 'ip:9.9.9.9');
});

test('resolveTierForRequest: anonymous defaults to free', async () => {
  kv._resetMemoryStore();
  const r = await gating.resolveTierForRequest(anonReq());
  assert.equal(r.tierId, 'free');
});

test('resolveTierForRequest: signed-in returns persisted tier', async () => {
  kv._resetMemoryStore();
  await userTier.setUserTier('pro@example.com', { tierId: 'growth' });
  const r = await gating.resolveTierForRequest(authedReq('pro@example.com'));
  assert.equal(r.tierId, 'growth');
});

// ── checkFeature ────────────────────────────────────

test('checkFeature: free tier blocked from orchestrator', async () => {
  kv._resetMemoryStore();
  const v = await gating.checkFeature(authedReq('free@example.com'), 'orchestratorAgent');
  assert.equal(v.allowed, false);
  assert.equal(v.status, 402);
  assert.equal(v.body.code, 'tier_gate');
  assert.equal(v.body.currentTier, 'free');
  assert.equal(v.body.minimumTier, 'growth'); // first tier with orchestrator
  assert.equal(v.body.upgradeUrl, '/pricing/');
});

test('checkFeature: growth tier allowed for orchestrator', async () => {
  kv._resetMemoryStore();
  await userTier.setUserTier('grow@example.com', { tierId: 'growth' });
  const v = await gating.checkFeature(authedReq('grow@example.com'), 'orchestratorAgent');
  assert.equal(v.allowed, true);
});

test('checkFeature: free tier allowed for complianceAgent (entry-level)', async () => {
  kv._resetMemoryStore();
  const v = await gating.checkFeature(authedReq('newbie@example.com'), 'complianceAgent');
  assert.equal(v.allowed, true);
});

test('checkFeature: anonymous user gated like free tier', async () => {
  kv._resetMemoryStore();
  const v = await gating.checkFeature(anonReq(), 'sourcingAgent');
  assert.equal(v.allowed, false);
  assert.equal(v.body.currentTier, 'free');
});

// ── minimumTierForFeature ───────────────────────────

test('minimumTierForFeature: returns lowest tier granting feature', () => {
  assert.equal(gating.minimumTierForFeature('complianceAgent'), 'free');
  assert.equal(gating.minimumTierForFeature('sourcingAgent'), 'starter');
  assert.equal(gating.minimumTierForFeature('orchestratorAgent'), 'growth');
  assert.equal(gating.minimumTierForFeature('apiAccess'), 'scale');
  assert.equal(gating.minimumTierForFeature('whiteLabel'), 'enterprise');
  assert.equal(gating.minimumTierForFeature('made-up'), null);
});

// ── checkQuota ──────────────────────────────────────

test('checkQuota: increments usage and blocks when limit hit', async () => {
  kv._resetMemoryStore();
  await userTier.setUserTier('quota@example.com', { tierId: 'free' }); // 20/mo
  let last;
  for (let i = 0; i < 20; i++) {
    last = await gating.checkQuota(authedReq('quota@example.com'), 'agentQueriesPerMonth', 1);
    assert.equal(last.allowed, true, `call ${i + 1} should be allowed`);
  }
  assert.equal(last.used, 20);
  assert.equal(last.remaining, 0);
  // 21st call → blocked
  const blocked = await gating.checkQuota(authedReq('quota@example.com'), 'agentQueriesPerMonth', 1);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'tier_quota');
  assert.equal(blocked.body.used, 20);
  assert.equal(blocked.body.limit, 20);
});

test('checkQuota: scale tier returns unlimited', async () => {
  kv._resetMemoryStore();
  await userTier.setUserTier('infinite@example.com', { tierId: 'scale' });
  const v = await gating.checkQuota(authedReq('infinite@example.com'), 'agentQueriesPerMonth', 1);
  assert.equal(v.allowed, true);
  assert.equal(v.limit, 'unlimited');
});

test('checkQuota: feature unavailable on tier returns 402', async () => {
  kv._resetMemoryStore();
  await userTier.setUserTier('nofree@example.com', { tierId: 'free' });
  // Free tier has supplierMonitors=0 → blocked
  const v = await gating.checkQuota(authedReq('nofree@example.com'), 'supplierMonitors', 1);
  assert.equal(v.allowed, false);
  assert.equal(v.status, 402);
});

test('checkQuota: scoped per identity (no cross-user leak)', async () => {
  kv._resetMemoryStore();
  await userTier.setUserTier('a@example.com', { tierId: 'starter' });
  await userTier.setUserTier('b@example.com', { tierId: 'starter' });
  for (let i = 0; i < 50; i++) {
    await gating.checkQuota(authedReq('a@example.com'), 'savedPlans', 1);
  }
  // B should still have full quota
  const v = await gating.checkQuota(authedReq('b@example.com'), 'savedPlans', 1);
  assert.equal(v.allowed, true);
  assert.equal(v.used, 1);
});

test('checkQuota: anonymous keyed by IP', async () => {
  kv._resetMemoryStore();
  for (let i = 0; i < 5; i++) {
    await gating.checkQuota(anonReq('77.77.77.77'), 'savedPlans', 1);
  }
  const blocked = await gating.checkQuota(anonReq('77.77.77.77'), 'savedPlans', 1);
  assert.equal(blocked.allowed, false);
  // Different IP should be unaffected
  const otherIp = await gating.checkQuota(anonReq('1.1.1.1'), 'savedPlans', 1);
  assert.equal(otherIp.allowed, true);
});

// ── gate(res) helper ────────────────────────────────

test('gate: writes 402 in vercel-style response', () => {
  let captured = { status: null, body: null };
  const res = {
    status(s) { captured.status = s; return this; },
    json(b) { captured.body = b; return this; },
  };
  const verdict = { allowed: false, status: 402, body: { error: 'gated', code: 'tier_gate' } };
  const wrote = gating.gate(res, verdict);
  assert.equal(wrote, true);
  assert.equal(captured.status, 402);
  assert.equal(captured.body.code, 'tier_gate');
});

test('gate: writes 429 in raw-Node response', () => {
  let captured = { statusCode: null, body: null };
  const res = {
    setHeader() {},
    end(body) { captured.body = body; },
  };
  Object.defineProperty(res, 'statusCode', {
    get() { return captured.statusCode; },
    set(v) { captured.statusCode = v; },
  });
  const verdict = { allowed: false, status: 429, body: { error: 'quota', code: 'tier_quota' } };
  const wrote = gating.gate(res, verdict);
  assert.equal(wrote, true);
  assert.equal(captured.statusCode, 429);
  assert.match(captured.body, /tier_quota/);
});

test('gate: noop when verdict.allowed is true', () => {
  let called = false;
  const res = { status() { called = true; return this; }, json() { return this; } };
  gating.gate(res, { allowed: true });
  assert.equal(called, false);
});

// ── Wired handlers actually call the gate ───────────

test('orchestrator handler: free tier → 402 tier_gate', async () => {
  kv._resetMemoryStore();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  const orchestrator = require('../lib/handlers/orchestrator');
  const req = authedReq('free-orc@example.com');
  req.body = { messages: [{ role: 'user', content: 'hi' }] };
  let captured = { status: null, body: null };
  const res = {
    setHeader() {},
    status(s) { captured.status = s; return this; },
    json(b) { captured.body = b; return this; },
    end() { return this; },
  };
  await orchestrator(req, res);
  assert.equal(captured.status, 402);
  assert.equal(captured.body.code, 'tier_gate');
  assert.equal(captured.body.requiredFeature, 'orchestratorAgent');
});

test('plans handler: POST blocked on saved-plan quota at limit', async () => {
  kv._resetMemoryStore();
  await userTier.setUserTier('plan-cap@example.com', { tierId: 'free' });
  const plansHandler = require('../lib/handlers/plans');
  function authedPlansReq(method, body) {
    const cookie = auth.buildSessionCookie('plan-cap@example.com');
    return {
      method, body, url: '/api/plans',
      query: { path: ['plans'] },
      headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
    };
  }
  const inputs = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 };
  // Free tier savedPlans quota is 5 — fill it
  for (let i = 0; i < 5; i++) {
    const res = { statusCode: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b || ''; } };
    await plansHandler(authedPlansReq('POST', { inputs }), res);
    assert.equal(res.statusCode, 200, `save ${i + 1} should succeed`);
  }
  // 6th save → 429 tier_quota
  const blockedRes = { statusCode: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b || ''; } };
  await plansHandler(authedPlansReq('POST', { inputs }), blockedRes);
  assert.equal(blockedRes.statusCode, 429);
  const json = JSON.parse(blockedRes.body);
  assert.equal(json.code, 'tier_quota');
  assert.equal(json.quota, 'savedPlans');
});

test('compliance agent handler: free tier allowed (within quota)', async () => {
  kv._resetMemoryStore();
  // Compliance is the entry-level — free tier should pass the feature gate.
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  const agentHandler = require('../lib/handlers/agent');
  const req = authedReq('free-cmp@example.com');
  req.body = { messages: [{ role: 'user', content: 'hi' }] };
  let captured = { status: null, body: null };
  // Mock supports SSE streaming so the handler can run past the gate
  // (it will fail later trying to reach Anthropic, which is fine — the
  // gate verdict is the only thing under test here).
  const res = {
    setHeader() {},
    write() { return true; },
    status(s) { captured.status = s; return this; },
    json(b) { captured.body = b; return this; },
    end() { return this; },
  };
  try { await agentHandler(req, res); } catch (_e) { /* allow downstream failures */ }
  // 402 (tier_gate) should NOT happen here. We accept 200/500/etc — anything but 402.
  assert.notEqual(captured.status, 402);
});
