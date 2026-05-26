// Tests for lib/orgs.js + lib/handlers/orgs.js — Sprint BG-3.1 foundation.

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');

const auth = require('../lib/auth');
const kv = require('../lib/intelligence/kv-store');
const orgs = require('../lib/orgs');
const orgsHandler = require('../lib/handlers/orgs');

function makeReq({ method = 'GET', urlPath = '', email = null, body = {} } = {}) {
  const req = {
    method,
    url: `/api/orgs${urlPath ? '/' + urlPath : ''}`,
    headers: {},
    body,
    requestId: 'test-req-id',
    query: { path: ['orgs', ...urlPath.split('/').filter(Boolean)] },
  };
  if (email) {
    const cookie = auth.buildSessionCookie(email);
    req.headers.cookie = `orcatrade_session=${encodeURIComponent(cookie)}`;
  }
  return req;
}

function makeRes() {
  const res = {
    statusCode: 200,
    _headers: {},
    body: '',
    setHeader(k, v) { this._headers[k] = v; },
    end(b) { this.body = b || ''; return this; },
  };
  return res;
}

// ── Library — createOrg + retrieval ─────────────────────────

test('createOrg: produces a record with deterministic id shape', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme Imports', ownerEmail: 'alice@example.com' });
  assert.match(o.id, /^org_[a-f0-9]{16}$/);
  assert.equal(o.name, 'Acme Imports');
  assert.equal(o.ownerEmail, 'alice@example.com');
  assert.match(o.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('createOrg: requires non-empty name + valid email', async () => {
  kv._resetMemoryStore();
  await assert.rejects(orgs.createOrg({ name: '', ownerEmail: 'a@b.c' }), /name must be/);
  await assert.rejects(orgs.createOrg({ name: 'x'.repeat(101), ownerEmail: 'a@b.c' }), /name must be/);
  await assert.rejects(orgs.createOrg({ name: 'OK', ownerEmail: '' }), /ownerEmail required/);
});

test('createOrg: owner is automatically a member with role=owner', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  const members = await orgs.listMembers(o.id);
  assert.equal(members.length, 1);
  assert.equal(members[0].email, 'alice@example.com');
  assert.equal(members[0].role, 'owner');
});

test('createOrg: appears in listOrgsForEmail for the owner', async () => {
  kv._resetMemoryStore();
  await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  await orgs.createOrg({ name: 'Beta', ownerEmail: 'alice@example.com' });
  const list = await orgs.listOrgsForEmail('alice@example.com');
  assert.equal(list.length, 2);
});

test('createOrg: case-insensitive email normalisation', async () => {
  kv._resetMemoryStore();
  await orgs.createOrg({ name: 'Acme', ownerEmail: 'Alice@Example.COM' });
  const list = await orgs.listOrgsForEmail('alice@example.com');
  assert.equal(list.length, 1, 'mixed-case email should normalise to lowercase');
});

// ── addMember + listMembers ─────────────────────────────────

test('addMember: appends a new member with member role + records joinedAt', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  const r = await orgs.addMember(o.id, { email: 'bob@example.com', role: 'member' });
  assert.equal(r.alreadyMember, false);
  assert.equal(r.member.email, 'bob@example.com');
  assert.equal(r.member.role, 'member');
  const members = await orgs.listMembers(o.id);
  assert.equal(members.length, 2);
});

test('addMember: idempotent — re-adding returns alreadyMember:true', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  await orgs.addMember(o.id, { email: 'bob@example.com', role: 'member' });
  const r = await orgs.addMember(o.id, { email: 'bob@example.com', role: 'member' });
  assert.equal(r.alreadyMember, true);
  assert.equal((await orgs.listMembers(o.id)).length, 2);
});

test('addMember: role=owner is forbidden (use transferOwnership)', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  await assert.rejects(orgs.addMember(o.id, { email: 'bob@example.com', role: 'owner' }),
    /cannot add a second owner/);
});

test('addMember: role must be in ALLOWED_ROLES', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  await assert.rejects(orgs.addMember(o.id, { email: 'b@b.c', role: 'evil' }), /role must be one of/);
});

test('addMember: bob now appears in listOrgsForEmail(bob)', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  await orgs.addMember(o.id, { email: 'bob@example.com', role: 'member' });
  const list = await orgs.listOrgsForEmail('bob@example.com');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, o.id);
});

// ── removeMember ────────────────────────────────────────────

test('removeMember: drops the member + index entry', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  await orgs.addMember(o.id, { email: 'bob@example.com', role: 'member' });
  const r = await orgs.removeMember(o.id, 'bob@example.com');
  assert.equal(r.removed, true);
  assert.equal((await orgs.listMembers(o.id)).length, 1);
  assert.equal((await orgs.listOrgsForEmail('bob@example.com')).length, 0);
});

test('removeMember: refuses to remove the owner', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  const r = await orgs.removeMember(o.id, 'alice@example.com');
  assert.equal(r.removed, false);
  assert.equal(r.reason, 'cannot-remove-owner');
});

// ── transferOwnership ───────────────────────────────────────

test('transferOwnership: passes the title + demotes old owner to admin', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  await orgs.addMember(o.id, { email: 'bob@example.com', role: 'member' });
  const updated = await orgs.transferOwnership(o.id, { fromEmail: 'alice@example.com', toEmail: 'bob@example.com' });
  assert.equal(updated.ownerEmail, 'bob@example.com');
  const members = await orgs.listMembers(o.id);
  const alice = members.find(m => m.email === 'alice@example.com');
  const bob = members.find(m => m.email === 'bob@example.com');
  assert.equal(alice.role, 'admin', 'old owner demoted to admin');
  assert.equal(bob.role, 'owner');
});

test('transferOwnership: rejects when toEmail is not a member', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  await assert.rejects(orgs.transferOwnership(o.id, { fromEmail: 'alice@example.com', toEmail: 'stranger@example.com' }),
    /must already be a member/);
});

test('transferOwnership: rejects when fromEmail is not the current owner', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  await orgs.addMember(o.id, { email: 'bob@example.com', role: 'member' });
  await orgs.addMember(o.id, { email: 'carol@example.com', role: 'member' });
  await assert.rejects(orgs.transferOwnership(o.id, { fromEmail: 'bob@example.com', toEmail: 'carol@example.com' }),
    /not the current owner/);
});

// ── hasRole ─────────────────────────────────────────────────

test('hasRole: owner satisfies all role requirements', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  assert.equal(await orgs.hasRole(o.id, 'alice@example.com', 'owner'), true);
  assert.equal(await orgs.hasRole(o.id, 'alice@example.com', 'admin'), true);
  assert.equal(await orgs.hasRole(o.id, 'alice@example.com', 'member'), true);
});

test('hasRole: member does NOT satisfy admin or owner', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  await orgs.addMember(o.id, { email: 'bob@example.com', role: 'member' });
  assert.equal(await orgs.hasRole(o.id, 'bob@example.com', 'member'), true);
  assert.equal(await orgs.hasRole(o.id, 'bob@example.com', 'admin'), false);
  assert.equal(await orgs.hasRole(o.id, 'bob@example.com', 'owner'), false);
});

test('hasRole: non-member fails for any role', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  assert.equal(await orgs.hasRole(o.id, 'stranger@example.com', 'member'), false);
});

// ── HTTP handler end-to-end ─────────────────────────────────

test('handler: 401 when no session cookie', async () => {
  const req = makeReq({ method: 'GET' });
  const res = makeRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test('handler: POST /api/orgs creates an org for the signed-in user', async () => {
  kv._resetMemoryStore();
  const req = makeReq({ method: 'POST', email: 'alice@example.com', body: { name: 'My Co' } });
  const res = makeRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.org.name, 'My Co');
  assert.equal(body.org.ownerEmail, 'alice@example.com');
});

test('handler: POST /api/orgs rejects missing name', async () => {
  const req = makeReq({ method: 'POST', email: 'alice@example.com', body: {} });
  const res = makeRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 400);
});

test('handler: GET /api/orgs lists the signed-in user\'s orgs', async () => {
  kv._resetMemoryStore();
  await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  await orgs.createOrg({ name: 'Beta', ownerEmail: 'alice@example.com' });
  const req = makeReq({ method: 'GET', email: 'alice@example.com' });
  const res = makeRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.orgs.length, 2);
});

test('handler: POST /api/orgs/<id>/invite requires admin role', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  await orgs.addMember(o.id, { email: 'bob@example.com', role: 'member' });
  // bob is a regular member — must not be able to invite.
  const req = makeReq({ method: 'POST', urlPath: `${o.id}/invite`, email: 'bob@example.com',
    body: { email: 'charlie@example.com', role: 'member' } });
  const res = makeRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 403);
});

test('handler: owner invites a member end-to-end', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  const req = makeReq({ method: 'POST', urlPath: `${o.id}/invite`, email: 'alice@example.com',
    body: { email: 'bob@example.com', role: 'member' } });
  const res = makeRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 200);
  const members = await orgs.listMembers(o.id);
  assert.equal(members.length, 2);
});

test('handler: an analyst cannot invite (RBAC — lacks member-management)', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  await orgs.addMember(o.id, { email: 'ana@example.com', role: 'analyst' });
  const req = makeReq({ method: 'POST', urlPath: `${o.id}/invite`, email: 'ana@example.com',
    body: { email: 'new@example.com', role: 'viewer' } });
  const res = makeRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 403);
  assert.match(JSON.parse(res.body).requiredPermission, /members/);
});

test('handler: admin can invite at a new enterprise role (compliance_officer)', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  await orgs.addMember(o.id, { email: 'adam@example.com', role: 'admin' });
  const req = makeReq({ method: 'POST', urlPath: `${o.id}/invite`, email: 'adam@example.com',
    body: { email: 'cory@example.com', role: 'compliance_officer' } });
  const res = makeRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 200);
  const members = await orgs.listMembers(o.id);
  assert.equal(members.find((m) => m.email === 'cory@example.com').role, 'compliance_officer');
});

test('handler: nobody can be invited as owner (transfer-only)', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  const req = makeReq({ method: 'POST', urlPath: `${o.id}/invite`, email: 'alice@example.com',
    body: { email: 'usurper@example.com', role: 'owner' } });
  const res = makeRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 400);
});

test('handler: GET /api/orgs/<id> requires membership', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  const req = makeReq({ method: 'GET', urlPath: o.id, email: 'stranger@example.com' });
  const res = makeRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 403);
});

test('handler: GET /api/orgs/<id> returns org + members for a member', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  await orgs.addMember(o.id, { email: 'bob@example.com', role: 'admin' });
  const req = makeReq({ method: 'GET', urlPath: o.id, email: 'bob@example.com' });
  const res = makeRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.org.id, o.id);
  assert.equal(body.members.length, 2);
});

test('handler: POST /api/orgs/<id>/transfer requires owner role', async () => {
  kv._resetMemoryStore();
  const o = await orgs.createOrg({ name: 'Acme', ownerEmail: 'alice@example.com' });
  await orgs.addMember(o.id, { email: 'bob@example.com', role: 'admin' });
  const req = makeReq({ method: 'POST', urlPath: `${o.id}/transfer`, email: 'bob@example.com',
    body: { toEmail: 'bob@example.com' } });
  const res = makeRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 403);
});

test('handler: OPTIONS preflight returns 204', async () => {
  const req = { method: 'OPTIONS', url: '/api/orgs', headers: {}, query: { path: ['orgs'] } };
  const res = makeRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 204);
});
