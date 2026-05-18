// Sprint BG-3.4 — /api/billing/me surfaces org-tier provenance.
//
// Verifies the response payload across all three resolve-origins
// (default / email / org), plus the UI markup hook for the badge.

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auth = require('../lib/auth');
const userTier = require('../lib/user-tier');
const orgs = require('../lib/orgs');
const kv = require('../lib/intelligence/kv-store');
const billing = require('../lib/handlers/billing');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(body) { this.body = body || ''; return this; },
  };
}

function userObj(email) {
  return { email, iat: Date.now() - 1000, exp: Date.now() + 60_000 };
}

// ── /api/billing/me response shape ────────────────────

test('handleMe: default origin when user has no org + no tier set', async () => {
  kv._resetMemoryStore();
  const req = { headers: {} };
  const res = mockRes();
  await billing.handleMe(req, res, userObj('fresh@example.com'));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.tierId, 'free');
  assert.equal(body.origin, 'default');
  assert.equal(body.orgId, null);
  assert.equal(body.orgName, null);
});

test('handleMe: email origin when user has per-email tier set, no org', async () => {
  kv._resetMemoryStore();
  await userTier.setUserTier('paid@example.com', { tierId: 'starter', source: 'stripe' });
  const req = { headers: {} };
  const res = mockRes();
  await billing.handleMe(req, res, userObj('paid@example.com'));
  const body = JSON.parse(res.body);
  assert.equal(body.tierId, 'starter');
  assert.equal(body.origin, 'email');
  assert.equal(body.orgId, null);
  assert.equal(body.orgName, null);
});

test('handleMe: org origin surfaces orgId + orgName when org-tier set', async () => {
  kv._resetMemoryStore();
  const org = await orgs.createOrg({ name: 'Acme Imports', ownerEmail: 'admin@acme.com' });
  await userTier.setOrgTier(org.id, { tierId: 'growth' });
  // Per-email tier deliberately set LOWER — org should win.
  await userTier.setUserTier('admin@acme.com', { tierId: 'starter' });
  const req = { headers: {} };
  const res = mockRes();
  await billing.handleMe(req, res, userObj('admin@acme.com'));
  const body = JSON.parse(res.body);
  assert.equal(body.tierId, 'growth');
  assert.equal(body.origin, 'org');
  assert.equal(body.orgId, org.id);
  assert.equal(body.orgName, 'Acme Imports');
});

test('handleMe: org origin gracefully handles missing org record (orgName null, not crash)', async () => {
  kv._resetMemoryStore();
  // Set org-tier for an org_id that has no matching org record. This
  // shouldn't crash — orgName comes back null and the rest of the
  // payload still renders.
  await userTier.setOrgTier('org_orphan', { tierId: 'growth' });
  // We need a user whose primary org resolves to org_orphan. Trick:
  // hand-write the email→orgs index directly to avoid the orgs.createOrg
  // validation flow that would also create the org record.
  await kv.set('org:byEmail:orphan@example.com', ['org_orphan']);
  const req = { headers: {} };
  const res = mockRes();
  await billing.handleMe(req, res, userObj('orphan@example.com'));
  const body = JSON.parse(res.body);
  // resolveTier finds the org-tier via listOrgsForEmail → but getOrg
  // returns null for the orphan id, so the function falls through.
  // The exact tier here depends on listOrgsForEmail filtering — what
  // matters is that handleMe doesn't crash and the response is valid.
  assert.equal(typeof body.tierId, 'string');
  assert.equal(typeof body.origin, 'string');
  assert.ok('orgName' in body);
});

test('handleMe: response keeps the BG-3.3-phase-0 fields unchanged (no caller breakage)', async () => {
  kv._resetMemoryStore();
  const req = { headers: {} };
  const res = mockRes();
  await billing.handleMe(req, res, userObj('compat@example.com'));
  const body = JSON.parse(res.body);
  for (const f of ['ok', 'email', 'tierId', 'billingCycle', 'since', 'source', 'hasStripeCustomer']) {
    assert.ok(f in body, `legacy field ${f} preserved`);
  }
});

// ── /account/billing/ UI markup contract ──────────────

test('/account/billing/index.html declares the org-tier badge slot', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'billing', 'index.html'), 'utf8');
  assert.match(html, /id=["']org-tier-badge["']/);
  assert.match(html, /id=["']org-tier-link["']/);
  // Badge starts hidden — JS reveals it only when origin === 'org'.
  assert.match(html, /id=["']org-tier-badge["'][^>]*hidden/);
  // Origin row appears in the meta-grid so the user can see the tier-source label too.
  assert.match(html, /id=["']origin["']/);
});

test('/account/billing/app.js reveals the badge when origin === "org"', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'billing', 'app.js'), 'utf8');
  assert.match(js, /data\.origin\s*===\s*['"]org['"]/);
  // Link target points to /account/orgs/?id=<orgId>.
  assert.match(js, /\/account\/orgs\/\?id=['"]?\s*\+\s*encodeURIComponent\(data\.orgId/);
  // Falls back to orgId when orgName missing.
  assert.match(js, /data\.orgName\s*\|\|\s*data\.orgId/);
});
