// Tier definitions + user-tier persistence + /api/tiers handler (Sprint 40).

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const kv = require('../lib/intelligence/kv-store');
const tiers = require('../lib/tiers');
const userTier = require('../lib/user-tier');
const auth = require('../lib/auth');
const tiersHandler = require('../lib/handlers/tiers');

// ── lib/tiers.js catalogue ────────────────────────────

test('TIER_IDS contains the expected five tiers', () => {
  assert.deepEqual([...tiers.TIER_IDS], ['free', 'starter', 'growth', 'scale', 'enterprise']);
});

test('getTier: returns the canonical record for a known id', () => {
  const t = tiers.getTier('growth');
  assert.equal(t.id, 'growth');
  assert.equal(t.name, 'Growth');
  assert.equal(t.priceMonthlyEur, 399);
  assert.equal(t.popular, true);
});

test('getTier: returns null for unknown id', () => {
  assert.equal(tiers.getTier('made-up'), null);
});

test('isValidTierId: rejects unknown ids and non-strings', () => {
  assert.equal(tiers.isValidTierId('free'), true);
  assert.equal(tiers.isValidTierId('made-up'), false);
  assert.equal(tiers.isValidTierId(null), false);
  assert.equal(tiers.isValidTierId(123), false);
});

test('hasFeature: free tier excludes premium agents', () => {
  assert.equal(tiers.hasFeature('free', 'orchestratorAgent'), false);
  assert.equal(tiers.hasFeature('free', 'apiAccess'), false);
});

test('hasFeature: growth tier unlocks all agents', () => {
  assert.equal(tiers.hasFeature('growth', 'sourcingAgent'), true);
  assert.equal(tiers.hasFeature('growth', 'orchestratorAgent'), true);
  assert.equal(tiers.hasFeature('growth', 'logisticsAgent'), true);
});

test('hasFeature: scale tier adds API + custom training', () => {
  assert.equal(tiers.hasFeature('scale', 'apiAccess'), true);
  assert.equal(tiers.hasFeature('scale', 'customAgentTraining'), true);
  // Still no white-label until enterprise
  assert.equal(tiers.hasFeature('scale', 'whiteLabel'), false);
});

test('hasFeature: enterprise tier unlocks white-label + ERP', () => {
  assert.equal(tiers.hasFeature('enterprise', 'whiteLabel'), true);
  assert.equal(tiers.hasFeature('enterprise', 'erpIntegration'), true);
});

test('hasFeature: unknown tier falls back to default (free)', () => {
  assert.equal(tiers.hasFeature('made-up', 'orchestratorAgent'), false);
});

test('getQuota: respects ascending limits across tiers', () => {
  assert.equal(tiers.getQuota('free', 'agentQueriesPerMonth'), 20);
  assert.equal(tiers.getQuota('starter', 'agentQueriesPerMonth'), 200);
  assert.equal(tiers.getQuota('growth', 'agentQueriesPerMonth'), 1000);
  assert.equal(tiers.getQuota('scale', 'agentQueriesPerMonth'), Infinity);
  assert.equal(tiers.getQuota('enterprise', 'agentQueriesPerMonth'), Infinity);
});

test('annualSavingPct: starter/growth/scale ≈ 17% (2 months free)', () => {
  // 12 - (annual / monthly) ≈ 2 → ~16-17%
  assert.equal(tiers.annualSavingPct('starter'), 17);
  assert.equal(tiers.annualSavingPct('growth'), 17);
  assert.equal(tiers.annualSavingPct('scale'), 17);
  assert.equal(tiers.annualSavingPct('free'), 0);
  assert.equal(tiers.annualSavingPct('enterprise'), 0);
});

test('toCatalog: serialises Infinity quotas as "unlimited" (JSON-safe)', () => {
  const catalog = tiers.toCatalog();
  const scale = catalog.find(t => t.id === 'scale');
  assert.equal(scale.quotas.agentQueriesPerMonth, 'unlimited');
  // Round-trip through JSON
  const json = JSON.stringify(catalog);
  assert.match(json, /"unlimited"/);
});

// ── lib/user-tier.js persistence ──────────────────────

test('getUserTier: defaults to free when never set', async () => {
  kv._resetMemoryStore();
  const r = await userTier.getUserTier('never@example.com');
  assert.equal(r.tierId, 'free');
  assert.equal(r.source, 'default');
});

test('setUserTier + getUserTier round-trip', async () => {
  kv._resetMemoryStore();
  await userTier.setUserTier('user@example.com', { tierId: 'growth', billingCycle: 'annual', source: 'stripe' });
  const r = await userTier.getUserTier('user@example.com');
  assert.equal(r.tierId, 'growth');
  assert.equal(r.billingCycle, 'annual');
  assert.equal(r.source, 'stripe');
  assert.ok(r.since);
});

test('setUserTier: rejects invalid tierId', async () => {
  kv._resetMemoryStore();
  await assert.rejects(
    () => userTier.setUserTier('user@example.com', { tierId: 'made-up' }),
    /invalid tierId/,
  );
});

test('setUserTier: requires email', async () => {
  await assert.rejects(
    () => userTier.setUserTier('', { tierId: 'free' }),
    /email required/,
  );
});

test('clearUserTier: subsequent reads default to free', async () => {
  kv._resetMemoryStore();
  await userTier.setUserTier('drop@example.com', { tierId: 'starter' });
  const before = await userTier.getUserTier('drop@example.com');
  assert.equal(before.tierId, 'starter');
  await userTier.clearUserTier('drop@example.com');
  const after = await userTier.getUserTier('drop@example.com');
  assert.equal(after.tierId, 'free');
});

test('user-tier: case-insensitive on email', async () => {
  kv._resetMemoryStore();
  await userTier.setUserTier('CASE@EXAMPLE.COM', { tierId: 'starter' });
  const r = await userTier.getUserTier('case@example.com');
  assert.equal(r.tierId, 'starter');
});

// ── /api/tiers handler ────────────────────────────────

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}

test('handler: GET /api/tiers returns public catalogue (no auth)', async () => {
  const req = { method: 'GET', headers: {}, url: '/api/tiers', query: { path: ['tiers'] } };
  const res = mockRes();
  await tiersHandler(req, res);
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.ok, true);
  assert.equal(json.catalog.length, 5);
  assert.equal(json.defaultTierId, 'free');
});

test('handler: GET /api/tiers/me 401 without auth cookie', async () => {
  const req = { method: 'GET', headers: {}, url: '/api/tiers/me', query: { path: ['tiers', 'me'] } };
  const res = mockRes();
  await tiersHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test('handler: GET /api/tiers/me returns tier for signed-in user', async () => {
  kv._resetMemoryStore();
  await userTier.setUserTier('signed-in@example.com', { tierId: 'growth' });
  const cookie = auth.buildSessionCookie('signed-in@example.com');
  const req = {
    method: 'GET',
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
    url: '/api/tiers/me',
    query: { path: ['tiers', 'me'] },
  };
  const res = mockRes();
  await tiersHandler(req, res);
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.tierId, 'growth');
  assert.equal(json.tier.name, 'Growth');
});

test('handler: GET /api/tiers/me defaults to free for new users', async () => {
  kv._resetMemoryStore();
  const cookie = auth.buildSessionCookie('new-user@example.com');
  const req = {
    method: 'GET',
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
    url: '/api/tiers/me',
    query: { path: ['tiers', 'me'] },
  };
  const res = mockRes();
  await tiersHandler(req, res);
  const json = JSON.parse(res.body);
  assert.equal(json.tierId, 'free');
  assert.equal(json.source, 'default');
});

test('handler: POST returns 405', async () => {
  const req = { method: 'POST', headers: {}, url: '/api/tiers', query: {} };
  const res = mockRes();
  await tiersHandler(req, res);
  assert.equal(res.statusCode, 405);
});

// ── Pricing page wiring ───────────────────────────────

test('pricing page CTAs carry data-tier attributes', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'pricing/index.html'), 'utf8');
  for (const id of ['free', 'starter', 'growth', 'scale', 'enterprise']) {
    assert.match(html, new RegExp(`data-tier="${id}"`), `expected data-tier="${id}" on a CTA`);
  }
});

test('pricing page bootstraps /api/tiers/me current-plan badge', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'pricing/index.html'), 'utf8');
  assert.match(html, /\/api\/tiers\/me/);
  assert.match(html, /tier--current/);
});

test('api/[...path].js dispatcher registers tiers handler', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dispatcher = fs.readFileSync(path.join(__dirname, '..', 'api/[...path].js'), 'utf8');
  assert.match(dispatcher, /tiers: require\('\.\.\/lib\/handlers\/tiers'\)/);
});
