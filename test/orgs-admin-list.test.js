// Sprint BG-3.6 — /dashboard/orgs/ admin view of every org.
//
// Three layers:
//   1. lib/orgs.listAllOrgs — pure storage scan + filter (skips
//      `org:members:*` and `org:byEmail:*` index keys).
//   2. GET /api/orgs/admin — admin-token-gated, enriches each org
//      with memberCount + tier.
//   3. /dashboard/orgs/ markup contract.

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
process.env.ORCATRADE_LEADS_TOKEN = 'test-admin-token';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const orgs = require('../lib/orgs');
const userTier = require('../lib/user-tier');
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

// ── listAllOrgs (storage layer) ───────────────────────

test('listAllOrgs: empty when no orgs exist', async () => {
  kv._resetMemoryStore();
  const r = await orgs.listAllOrgs();
  assert.deepEqual(r, []);
});

test('listAllOrgs: returns every org record but skips index keys', async () => {
  kv._resetMemoryStore();
  const a = await orgs.createOrg({ name: 'Acme', ownerEmail: 'a@example.com' });
  const b = await orgs.createOrg({ name: 'Beta',  ownerEmail: 'b@example.com' });
  // Add a member so the `org:members:<id>` index key exists and the
  // filter has work to do.
  await orgs.addMember(a.id, { email: 'extra@example.com', role: 'member' });
  const list = await orgs.listAllOrgs();
  assert.equal(list.length, 2);
  const ids = list.map((o) => o.id).sort();
  assert.deepEqual(ids, [a.id, b.id].sort());
});

test('listAllOrgs: returns newest-first by createdAt', async () => {
  kv._resetMemoryStore();
  const a = await orgs.createOrg({ name: 'First',  ownerEmail: 'a@example.com' });
  // Force timestamps to be visibly distinct so the sort is deterministic
  // even on machines where two createOrg calls land in the same ms.
  const rec = await kv.get(orgs.orgKey(a.id));
  rec.createdAt = '2026-01-01T00:00:00.000Z';
  await kv.set(orgs.orgKey(a.id), rec);
  const b = await orgs.createOrg({ name: 'Second', ownerEmail: 'b@example.com' });
  const rec2 = await kv.get(orgs.orgKey(b.id));
  rec2.createdAt = '2026-05-01T00:00:00.000Z';
  await kv.set(orgs.orgKey(b.id), rec2);
  const list = await orgs.listAllOrgs();
  // Newest first.
  assert.equal(list[0].id, b.id);
  assert.equal(list[1].id, a.id);
});

test('listAllOrgs: respects limit', async () => {
  kv._resetMemoryStore();
  for (let i = 0; i < 5; i++) {
    await orgs.createOrg({ name: 'Co ' + i, ownerEmail: `o${i}@example.com` });
  }
  const list = await orgs.listAllOrgs({ limit: 3 });
  assert.equal(list.length, 3);
});

// ── /api/orgs/admin endpoint ──────────────────────────

test('GET /api/orgs/admin: 401 without token', async () => {
  kv._resetMemoryStore();
  await orgs.createOrg({ name: 'Acme', ownerEmail: 'a@example.com' });
  const req = {
    method: 'GET', headers: {}, query: { path: ['orgs', 'admin'] },
    url: '/api/orgs/admin',
  };
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test('GET /api/orgs/admin: 401 with wrong token', async () => {
  kv._resetMemoryStore();
  const req = {
    method: 'GET', headers: { 'x-admin-token': 'nope' },
    query: { path: ['orgs', 'admin'] },
    url: '/api/orgs/admin',
  };
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test('GET /api/orgs/admin: 503 when ORCATRADE_LEADS_TOKEN unset', async () => {
  kv._resetMemoryStore();
  const prev = process.env.ORCATRADE_LEADS_TOKEN;
  delete process.env.ORCATRADE_LEADS_TOKEN;
  try {
    const req = {
      method: 'GET', headers: { 'x-admin-token': 'anything' },
      query: { path: ['orgs', 'admin'] },
      url: '/api/orgs/admin',
    };
    const res = mockRes();
    await orgsHandler(req, res);
    assert.equal(res.statusCode, 503);
  } finally {
    process.env.ORCATRADE_LEADS_TOKEN = prev;
  }
});

test('GET /api/orgs/admin: 200 + enriched payload (memberCount + tier per row)', async () => {
  kv._resetMemoryStore();
  const a = await orgs.createOrg({ name: 'Acme', ownerEmail: 'owner@a.com' });
  await orgs.addMember(a.id, { email: 'm1@a.com', role: 'admin' });
  await orgs.addMember(a.id, { email: 'm2@a.com', role: 'member' });
  await userTier.setOrgTier(a.id, { tierId: 'growth', billingCycle: 'annual' });

  const b = await orgs.createOrg({ name: 'Beta', ownerEmail: 'owner@b.com' });
  // No org-tier set on Beta; should come back with tier: null.

  const req = {
    method: 'GET', headers: { 'x-admin-token': 'test-admin-token' },
    query: { path: ['orgs', 'admin'] },
    url: '/api/orgs/admin',
  };
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.returned, 2);
  const acme = body.orgs.find((o) => o.name === 'Acme');
  const beta = body.orgs.find((o) => o.name === 'Beta');
  assert.equal(acme.memberCount, 3);    // owner + 2 added members
  assert.equal(acme.tier.tierId, 'growth');
  assert.equal(acme.tier.billingCycle, 'annual');
  assert.equal(beta.memberCount, 1);
  assert.equal(beta.tier, null);
});

test('GET /api/orgs/admin: empty list returns ok with returned=0', async () => {
  kv._resetMemoryStore();
  const req = {
    method: 'GET', headers: { 'x-admin-token': 'test-admin-token' },
    query: { path: ['orgs', 'admin'] },
    url: '/api/orgs/admin',
  };
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.returned, 0);
  assert.deepEqual(body.orgs, []);
});

test('GET /api/orgs/admin: limit defaults to 200 + is clamped to [1, 10000]', async () => {
  kv._resetMemoryStore();
  async function callWith(qLimit) {
    const req = {
      method: 'GET', headers: { 'x-admin-token': 'test-admin-token' },
      query: { path: ['orgs', 'admin'], limit: qLimit },
      url: '/api/orgs/admin?limit=' + (qLimit == null ? '' : qLimit),
    };
    const res = mockRes();
    await orgsHandler(req, res);
    return JSON.parse(res.body).limit;
  }
  assert.equal(await callWith(''), 200);
  assert.equal(await callWith('notANumber'), 200);
  assert.equal(await callWith('0'), 1);
  assert.equal(await callWith('-50'), 1);
  assert.equal(await callWith('99999'), 10000);
  assert.equal(await callWith('500'), 500);
});

test('GET /api/orgs/admin: token via ?token=… also accepted (parity with /tier)', async () => {
  kv._resetMemoryStore();
  await orgs.createOrg({ name: 'Acme', ownerEmail: 'a@example.com' });
  const req = {
    method: 'GET', headers: {},
    query: { path: ['orgs', 'admin'], token: 'test-admin-token' },
    url: '/api/orgs/admin?token=test-admin-token',
  };
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 200);
});

test('admin /admin route does NOT require a user session', async () => {
  // No auth cookie attached — admin token must be sufficient.
  kv._resetMemoryStore();
  await orgs.createOrg({ name: 'Acme', ownerEmail: 'a@example.com' });
  const req = {
    method: 'GET', headers: { 'x-admin-token': 'test-admin-token' },
    query: { path: ['orgs', 'admin'] },
    url: '/api/orgs/admin',
  };
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 200);
});

// ── /dashboard/orgs/ markup contract ──────────────────

test('/dashboard/orgs/ page exists + noindex', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'orgs', 'index.html'), 'utf8');
  assert.ok(html.length > 1500);
  assert.match(html, /<meta name="robots" content="noindex,\s*nofollow"/i);
});

test('/dashboard/orgs/ has every required DOM hook', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'orgs', 'index.html'), 'utf8');
  for (const id of ['controls', 'token', 'limit', 'load-btn', 'error', 'empty', 'results', 'stats', 'orgs-tbody']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `id="${id}" present`);
  }
});

test('/dashboard/orgs/ app.js fetches /api/orgs/admin with the token', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'orgs', 'app.js'), 'utf8');
  assert.match(js, /\/api\/orgs\/admin/);
  // Token is still passed as a query param when present (Sprint
  // admin-session-auth made the param optional — cookie-first path —
  // but the URL still must carry token=encodeURIComponent(token) when
  // a token is in hand).
  assert.match(js, /token=['"]?\s*\+\s*encodeURIComponent\(token\)/);
});

test('/dashboard/orgs/ app.js: cookie-first probe on cold load (Sprint admin-session-auth)', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'orgs', 'app.js'), 'utf8');
  assert.match(js, /async function load\(silent\)/);
  assert.match(js, /DOMContentLoaded[\s\S]{0,200}load\(true\)/);
});

test('/dashboard/orgs/ app.js persists token in sessionStorage', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'orgs', 'app.js'), 'utf8');
  assert.match(js, /sessionStorage\.setItem/);
  assert.match(js, /sessionStorage\.getItem/);
});

test('/dashboard/orgs/ page documents the /tier curl example', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'orgs', 'index.html'), 'utf8');
  assert.match(html, /\/api\/orgs\/[^/]+\/tier/);
  assert.match(html, /X-Admin-Token/i);
});

// ── GET /api/orgs/admin/<orgId> detail (Sprint BG-3.7) ─

test('GET /api/orgs/admin/<orgId>: 401 without token', async () => {
  kv._resetMemoryStore();
  const a = await orgs.createOrg({ name: 'Acme', ownerEmail: 'a@example.com' });
  const req = {
    method: 'GET', headers: {}, query: { path: ['orgs', 'admin', a.id] },
    url: '/api/orgs/admin/' + a.id,
  };
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test('GET /api/orgs/admin/<orgId>: 404 on unknown org', async () => {
  kv._resetMemoryStore();
  const req = {
    method: 'GET', headers: { 'x-admin-token': 'test-admin-token' },
    query: { path: ['orgs', 'admin', 'org_does_not_exist'] },
    url: '/api/orgs/admin/org_does_not_exist',
  };
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 404);
});

test('GET /api/orgs/admin/<orgId>: returns org + members + tier with full role + joinedAt', async () => {
  kv._resetMemoryStore();
  const a = await orgs.createOrg({ name: 'Acme', ownerEmail: 'owner@a.com' });
  await orgs.addMember(a.id, { email: 'admin@a.com', role: 'admin' });
  await orgs.addMember(a.id, { email: 'm1@a.com', role: 'member' });
  await userTier.setOrgTier(a.id, { tierId: 'growth', billingCycle: 'monthly' });

  const req = {
    method: 'GET', headers: { 'x-admin-token': 'test-admin-token' },
    query: { path: ['orgs', 'admin', a.id] },
    url: '/api/orgs/admin/' + a.id,
  };
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.org.id, a.id);
  assert.equal(body.org.name, 'Acme');
  assert.equal(body.org.ownerEmail, 'owner@a.com');
  assert.equal(body.members.length, 3);
  // Member objects carry the role + joinedAt the UI renders inline.
  const owner = body.members.find((m) => m.email === 'owner@a.com');
  const admin = body.members.find((m) => m.email === 'admin@a.com');
  assert.equal(owner.role, 'owner');
  assert.equal(admin.role, 'admin');
  assert.ok(body.members.every((m) => m.joinedAt || m.invitedAt),
    'every member has a joinedAt or invitedAt timestamp');
  assert.equal(body.tier.tierId, 'growth');
  assert.equal(body.tier.billingCycle, 'monthly');
});

test('GET /api/orgs/admin/<orgId>: tier null when no override set', async () => {
  kv._resetMemoryStore();
  const a = await orgs.createOrg({ name: 'NoTier', ownerEmail: 'owner@nt.com' });
  const req = {
    method: 'GET', headers: { 'x-admin-token': 'test-admin-token' },
    query: { path: ['orgs', 'admin', a.id] },
    url: '/api/orgs/admin/' + a.id,
  };
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.tier, null);
});

test('detail endpoint does NOT require a user session (admin token only)', async () => {
  kv._resetMemoryStore();
  const a = await orgs.createOrg({ name: 'Acme', ownerEmail: 'a@example.com' });
  const req = {
    method: 'GET', headers: { 'x-admin-token': 'test-admin-token' },
    query: { path: ['orgs', 'admin', a.id] },
    url: '/api/orgs/admin/' + a.id,
  };
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 200);
});

// ── /dashboard/orgs/ expand-row UI (Sprint BG-3.7) ────

test('/dashboard/orgs/ CSS declares the expandable row hooks', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'orgs', 'index.html'), 'utf8');
  assert.match(html, /tr\.org-row\b/);
  assert.match(html, /tr\.org-detail\b/);
  // Role pills coloured by role (owner gold, admin blue, member grey).
  assert.match(html, /\.pill\.role-owner\b/);
  assert.match(html, /\.pill\.role-admin\b/);
});

test('/dashboard/orgs/ app.js wires the expand handler + detail fetch', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'orgs', 'app.js'), 'utf8');
  assert.match(js, /function toggleDetail\(/);
  // Detail endpoint URL shape: /api/orgs/admin/<orgId>?token=…
  assert.match(js, /\/api\/orgs\/admin\/['"]?\s*\+\s*encodeURIComponent\(orgId\)/);
  // Click handler on .org-row triggers toggleDetail.
  assert.match(js, /querySelectorAll\(['"]tr\.org-row['"]\)/);
  assert.match(js, /toggleDetail\(row\)/);
});

test('/dashboard/orgs/ Copy-ID button stops propagation (does not trigger row expand)', () => {
  // Subtle but important: a Copy-ID click should NOT also collapse/
  // expand the row. e.stopPropagation() prevents the click bubbling
  // up to the row handler.
  const js = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'orgs', 'app.js'), 'utf8');
  assert.match(js, /e\.stopPropagation\(\)/);
});

// ── Module surface ─────────────────────────────────────

test('lib/orgs.js exports listAllOrgs', () => {
  assert.equal(typeof orgs.listAllOrgs, 'function');
});

test('lib/handlers/orgs.js exports handleAdminGet', () => {
  assert.equal(typeof orgsHandler.handleAdminGet, 'function');
});
