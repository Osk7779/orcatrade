// Sprint BG-3.3 phase 1 — Org-aware tier lookup.
//
// Two layers:
//   1. lib/user-tier.js: org-tier CRUD + resolveTier precedence.
//      Org-tier (when set) wins over per-email tier. Backwards-
//      compatible: orgs with no tier set fall through to per-email.
//   2. /api/orgs/<id>/tier admin endpoint: token-gated, audit-emitting.

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
process.env.ORCATRADE_LEADS_TOKEN = 'test-admin-token';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');

const userTier = require('../lib/user-tier');
const tiersCatalog = require('../lib/tiers');
const orgs = require('../lib/orgs');
const events = require('../lib/events');
const kv = require('../lib/intelligence/kv-store');
const orgsHandler = require('../lib/handlers/orgs');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(body) { this.body = body || ''; return this; },
  };
}

// ── Org-tier CRUD ─────────────────────────────────────

test('orgTierKey: namespaced and trimmed', () => {
  assert.equal(userTier.orgTierKey('org_abc'), 'tier:org:org_abc');
  assert.equal(userTier.orgTierKey('  org_x  '), 'tier:org:org_x');
});

test('getOrgTier: returns null when no record', async () => {
  kv._resetMemoryStore();
  assert.equal(await userTier.getOrgTier('org_never_set'), null);
  assert.equal(await userTier.getOrgTier(''), null);
  assert.equal(await userTier.getOrgTier(null), null);
});

test('setOrgTier: writes the record + getOrgTier reads it back', async () => {
  kv._resetMemoryStore();
  const r = await userTier.setOrgTier('org_acme', { tierId: 'growth', billingCycle: 'monthly' });
  assert.equal(r.tierId, 'growth');
  assert.equal(r.billingCycle, 'monthly');
  assert.equal(r.source, 'manual');
  assert.match(r.since, /^\d{4}-\d{2}-\d{2}T/);
  const refetched = await userTier.getOrgTier('org_acme');
  assert.equal(refetched.tierId, 'growth');
  assert.equal(refetched.billingCycle, 'monthly');
});

test('setOrgTier: rejects invalid tier ids + empty orgId', async () => {
  kv._resetMemoryStore();
  await assert.rejects(() => userTier.setOrgTier('', { tierId: 'growth' }), /orgId required/);
  await assert.rejects(() => userTier.setOrgTier('org_x', { tierId: 'bogus' }), /invalid tierId/);
});

test('clearOrgTier: removes the record; idempotent', async () => {
  kv._resetMemoryStore();
  await userTier.setOrgTier('org_acme', { tierId: 'growth' });
  assert.equal(await userTier.clearOrgTier('org_acme'), true);
  assert.equal(await userTier.getOrgTier('org_acme'), null);
  // Re-clearing is a no-op.
  assert.equal(await userTier.clearOrgTier('org_acme'), true);
});

test('clearOrgTier: empty orgId returns false', async () => {
  assert.equal(await userTier.clearOrgTier(''), false);
  assert.equal(await userTier.clearOrgTier(null), false);
});

// ── resolveTier precedence ────────────────────────────

test('resolveTier: empty email → default tier with origin "default"', async () => {
  kv._resetMemoryStore();
  const r = await userTier.resolveTier('');
  assert.equal(r.tier.id, tiersCatalog.DEFAULT_TIER_ID);
  assert.equal(r.origin, 'default');
});

test('resolveTier: no org + no per-email → free tier with origin "default"', async () => {
  kv._resetMemoryStore();
  const r = await userTier.resolveTier('lonely@example.com');
  assert.equal(r.tier.id, 'free');
  assert.equal(r.origin, 'default');
});

test('resolveTier: no org + per-email tier set → returns the per-email tier with origin "email"', async () => {
  kv._resetMemoryStore();
  await userTier.setUserTier('paid@example.com', { tierId: 'starter', source: 'stripe' });
  const r = await userTier.resolveTier('paid@example.com');
  assert.equal(r.tier.id, 'starter');
  assert.equal(r.origin, 'email');
  assert.equal(r.record.source, 'stripe');
});

test('resolveTier: in org WITHOUT org-tier → falls through to per-email tier', async () => {
  kv._resetMemoryStore();
  const org = await orgs.createOrg({ name: 'Fallback Co', ownerEmail: 'falls@example.com' });
  assert.ok(org.id);
  // No org-tier set. Per-email tier set to growth.
  await userTier.setUserTier('falls@example.com', { tierId: 'growth' });
  const r = await userTier.resolveTier('falls@example.com');
  assert.equal(r.tier.id, 'growth');
  assert.equal(r.origin, 'email');
});

test('resolveTier: in org WITH org-tier → org-tier wins, origin "org"', async () => {
  kv._resetMemoryStore();
  const org = await orgs.createOrg({ name: 'Override Co', ownerEmail: 'owner@example.com' });
  await userTier.setOrgTier(org.id, { tierId: 'scale' });
  // Even if per-email tier is set lower, org wins.
  await userTier.setUserTier('owner@example.com', { tierId: 'starter' });
  const r = await userTier.resolveTier('owner@example.com');
  assert.equal(r.tier.id, 'scale');
  assert.equal(r.origin, 'org');
  assert.equal(r.orgId, org.id);
});

test('resolveTier: higher-tier-wins across all the user\'s orgs (Sprint BG-3.3 phase 2)', async () => {
  kv._resetMemoryStore();
  const orgA = await orgs.createOrg({ name: 'A Co', ownerEmail: 'multi@example.com' });
  const orgB = await orgs.createOrg({ name: 'B Co', ownerEmail: 'multi@example.com' });
  // Set org-tier on the SECOND org only. Phase 1 would have ignored
  // this (it only looked at the primary/oldest org). Phase 2 looks at
  // EVERY org and picks the highest tier — Enterprise on the second
  // org wins even though the primary has no tier set.
  await userTier.setOrgTier(orgB.id, { tierId: 'enterprise' });
  const r = await userTier.resolveTier('multi@example.com');
  assert.equal(r.tier.id, 'enterprise');
  assert.equal(r.origin, 'org');
  assert.equal(r.orgId, orgB.id, 'the winning org is the one with the highest tier');

  // Now also set the primary org to Growth — Enterprise on org B
  // still beats Growth on org A (the user gets the BEST tier across
  // every org they belong to, regardless of which is primary).
  await userTier.setOrgTier(orgA.id, { tierId: 'growth' });
  const r2 = await userTier.resolveTier('multi@example.com');
  assert.equal(r2.tier.id, 'enterprise');
  assert.equal(r2.orgId, orgB.id);
});

test('resolveTier: ties broken by oldest membership (primary org wins on equal rank)', async () => {
  // Both orgs on Growth — primary (oldest membership) wins the tie.
  kv._resetMemoryStore();
  const orgA = await orgs.createOrg({ name: 'A Co', ownerEmail: 'tied@example.com' });
  const orgB = await orgs.createOrg({ name: 'B Co', ownerEmail: 'tied@example.com' });
  await userTier.setOrgTier(orgA.id, { tierId: 'growth' });
  await userTier.setOrgTier(orgB.id, { tierId: 'growth' });
  const r = await userTier.resolveTier('tied@example.com');
  assert.equal(r.tier.id, 'growth');
  assert.equal(r.orgId, orgA.id, 'oldest membership wins the tie');
});

test('resolveTier: no orgs have a tier set → falls through to per-email/default', async () => {
  kv._resetMemoryStore();
  await orgs.createOrg({ name: 'No-tier', ownerEmail: 'fallback@example.com' });
  const r = await userTier.resolveTier('fallback@example.com');
  assert.equal(r.tier.id, 'free');
  assert.equal(r.origin, 'default');
});

test('resolveTier: backwards-compatible record shape — { record: { tierId, ... }, tier }', async () => {
  // gating.js + billing.js + handlers/tiers.js read r.record.tierId
  // and r.tier — both must still be present and correct.
  kv._resetMemoryStore();
  const r = await userTier.resolveTier('compat@example.com');
  assert.ok(r.record);
  assert.equal(r.record.tierId, 'free');
  assert.ok(r.tier);
  assert.equal(r.tier.id, 'free');
});

// ── ALLOWED_TYPES surface ─────────────────────────────

test('events.ALLOWED_TYPES includes org_tier_assigned + org_tier_cleared', () => {
  assert.ok(events.ALLOWED_TYPES.has('org_tier_assigned'));
  assert.ok(events.ALLOWED_TYPES.has('org_tier_cleared'));
});

// ── /api/orgs/<id>/tier admin endpoint ────────────────

test('POST /api/orgs/<id>/tier: 401 without token', async () => {
  kv._resetMemoryStore();
  const org = await orgs.createOrg({ name: 'Endpoint Co', ownerEmail: 'admin@example.com' });
  const req = {
    method: 'POST', headers: {}, body: { tierId: 'growth' },
    query: { path: ['orgs', org.id, 'tier'] },
    url: `/api/orgs/${org.id}/tier`,
  };
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test('POST /api/orgs/<id>/tier: 401 on wrong token', async () => {
  kv._resetMemoryStore();
  const org = await orgs.createOrg({ name: 'Endpoint Co', ownerEmail: 'admin@example.com' });
  const req = {
    method: 'POST', headers: { 'x-admin-token': 'wrong' }, body: { tierId: 'growth' },
    query: { path: ['orgs', org.id, 'tier'] },
    url: `/api/orgs/${org.id}/tier`,
  };
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test('POST /api/orgs/<id>/tier: 503 when ORCATRADE_LEADS_TOKEN unset', async () => {
  kv._resetMemoryStore();
  const org = await orgs.createOrg({ name: 'Endpoint Co', ownerEmail: 'admin@example.com' });
  const prev = process.env.ORCATRADE_LEADS_TOKEN;
  delete process.env.ORCATRADE_LEADS_TOKEN;
  try {
    const req = {
      method: 'POST', headers: { 'x-admin-token': 'anything' }, body: { tierId: 'growth' },
      query: { path: ['orgs', org.id, 'tier'] },
      url: `/api/orgs/${org.id}/tier`,
    };
    const res = mockRes();
    await orgsHandler(req, res);
    assert.equal(res.statusCode, 503);
  } finally {
    process.env.ORCATRADE_LEADS_TOKEN = prev;
  }
});

test('POST /api/orgs/<id>/tier: 400 on missing/invalid tierId', async () => {
  kv._resetMemoryStore();
  const org = await orgs.createOrg({ name: 'Endpoint Co', ownerEmail: 'admin@example.com' });
  const baseReq = {
    method: 'POST', headers: { 'x-admin-token': 'test-admin-token' },
    query: { path: ['orgs', org.id, 'tier'] },
    url: `/api/orgs/${org.id}/tier`,
  };
  const r1 = mockRes();
  await orgsHandler({ ...baseReq, body: {} }, r1);
  assert.equal(r1.statusCode, 400);
  const r2 = mockRes();
  await orgsHandler({ ...baseReq, body: { tierId: 'bogus' } }, r2);
  assert.equal(r2.statusCode, 400);
});

test('POST /api/orgs/<id>/tier: 404 on unknown org', async () => {
  kv._resetMemoryStore();
  const req = {
    method: 'POST', headers: { 'x-admin-token': 'test-admin-token' },
    body: { tierId: 'growth' },
    query: { path: ['orgs', 'org_does_not_exist', 'tier'] },
    url: '/api/orgs/org_does_not_exist/tier',
  };
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 404);
});

test('POST /api/orgs/<id>/tier: happy path + emits org_tier_assigned event', async () => {
  kv._resetMemoryStore();
  const org = await orgs.createOrg({ name: 'Endpoint Co', ownerEmail: 'admin@example.com' });
  const req = {
    method: 'POST', headers: { 'x-admin-token': 'test-admin-token' },
    body: { tierId: 'growth', billingCycle: 'annual' },
    query: { path: ['orgs', org.id, 'tier'] },
    url: `/api/orgs/${org.id}/tier`,
  };
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.tier.tierId, 'growth');
  assert.equal(body.tier.billingCycle, 'annual');
  // Org tier persisted.
  const refetched = await userTier.getOrgTier(org.id);
  assert.equal(refetched.tierId, 'growth');
  // Audit event emitted.
  const hits = (await events.list({})).filter((e) => e.type === 'org_tier_assigned');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].orgId, org.id);
  assert.equal(hits[0].tierId, 'growth');
});

test('POST /api/orgs/<id>/tier: token via ?token=… also accepted', async () => {
  kv._resetMemoryStore();
  const org = await orgs.createOrg({ name: 'Endpoint Co', ownerEmail: 'admin@example.com' });
  const req = {
    method: 'POST', headers: {}, body: { tierId: 'starter' },
    query: { path: ['orgs', org.id, 'tier'], token: 'test-admin-token' },
    url: `/api/orgs/${org.id}/tier?token=test-admin-token`,
  };
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 200);
});

test('DELETE /api/orgs/<id>/tier: clears + emits org_tier_cleared event', async () => {
  kv._resetMemoryStore();
  const org = await orgs.createOrg({ name: 'Endpoint Co', ownerEmail: 'admin@example.com' });
  await userTier.setOrgTier(org.id, { tierId: 'growth' });
  const req = {
    method: 'DELETE', headers: { 'x-admin-token': 'test-admin-token' },
    query: { path: ['orgs', org.id, 'tier'] },
    url: `/api/orgs/${org.id}/tier`,
  };
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 200);
  const refetched = await userTier.getOrgTier(org.id);
  assert.equal(refetched, null);
  const hits = (await events.list({})).filter((e) => e.type === 'org_tier_cleared');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].orgId, org.id);
});

test('admin tier endpoint does NOT require a user session (no auth cookie needed)', async () => {
  // This sprint's whole point: sales team can curl this from a Slackbot
  // without impersonating a user. No session cookie attached here.
  kv._resetMemoryStore();
  const org = await orgs.createOrg({ name: 'Endpoint Co', ownerEmail: 'admin@example.com' });
  const req = {
    method: 'POST', headers: { 'x-admin-token': 'test-admin-token' },
    body: { tierId: 'growth' },
    query: { path: ['orgs', org.id, 'tier'] },
    url: `/api/orgs/${org.id}/tier`,
  };
  const res = mockRes();
  await orgsHandler(req, res);
  // 200, not 401. Admin token bypasses the session gate.
  assert.equal(res.statusCode, 200);
});

// ── Module surface ─────────────────────────────────────

test('lib/user-tier.js exports the BG-3.3 phase 1 surface', () => {
  for (const name of ['ORG_TIER_KEY_PREFIX', 'orgTierKey', 'getOrgTier', 'setOrgTier', 'clearOrgTier']) {
    assert.ok(userTier[name], `${name} exported`);
  }
});
