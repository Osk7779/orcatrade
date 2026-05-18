// Sprint BG-5.5 — audit log for security-sensitive operations.
//
// Asserts every security-sensitive handler records the correct event
// type with the right payload, that the new types are accepted by the
// events.ALLOWED_TYPES gate, and that handler failures (cookie missing,
// validation failure) DON'T emit a spurious audit event.

const test = require('node:test');
const assert = require('node:assert/strict');

// Pin auth secret + run KV in memory mode + no Resend + no real upstreams
process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const auth = require('../lib/auth');
const events = require('../lib/events');
const kv = require('../lib/intelligence/kv-store');
const authHandler = require('../lib/handlers/auth');
const orgsHandler = require('../lib/handlers/orgs');
const accountHandler = require('../lib/handlers/account');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    end(body) { this.body = body || ''; return this; },
  };
}

function reqWithCookie(method, email, extras = {}) {
  const cookie = auth.buildSessionCookie(email);
  return {
    method,
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
    body: {},
    ...extras,
  };
}

// ── ALLOWED_TYPES surface ─────────────────────────────

test('ALLOWED_TYPES includes every BG-5.5 audit type', () => {
  for (const t of [
    'auth_logout',
    'auth_revoke_all',
    'org_created',
    'org_member_invited',
    'org_member_removed',
    'org_ownership_transferred',
    'account_exported',
    'account_deleted',
  ]) {
    assert.ok(events.ALLOWED_TYPES.has(t), `ALLOWED_TYPES is missing ${t}`);
  }
});

// ── Auth handler audit events ─────────────────────────

test('handleVerify writes auth_signin on successful magic-link redemption', async () => {
  kv._resetMemoryStore();
  const token = auth.generateMagicToken();
  await kv.set(auth.magicKvKey(token), 'audit-signin@example.com', { ttlSeconds: 900 });
  const req = { method: 'GET', headers: {}, query: { token } };
  const res = mockRes();
  await authHandler.handleVerify(req, res);
  assert.equal(res.statusCode, 302);
  const log = await events.list({});
  const hits = log.filter((e) => e.type === 'auth_signin');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].email, 'audit-signin@example.com');
  assert.equal(hits[0].source, 'magic-link');
});

test('handleVerify does NOT write auth_signin on a malformed token', async () => {
  kv._resetMemoryStore();
  const req = { method: 'GET', headers: {}, query: { token: 'too-short' } };
  const res = mockRes();
  await authHandler.handleVerify(req, res);
  const log = await events.list({});
  assert.equal(log.filter((e) => e.type === 'auth_signin').length, 0);
});

test('handleLogout writes auth_logout when a session cookie was present', async () => {
  kv._resetMemoryStore();
  const req = reqWithCookie('POST', 'audit-logout@example.com');
  const res = mockRes();
  await authHandler.handleLogout(req, res);
  const hits = (await events.list({})).filter((e) => e.type === 'auth_logout');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].email, 'audit-logout@example.com');
});

test('handleLogout does NOT write auth_logout when the user was not signed in', async () => {
  kv._resetMemoryStore();
  const req = { method: 'POST', headers: {} };
  const res = mockRes();
  await authHandler.handleLogout(req, res);
  const log = await events.list({});
  assert.equal(log.filter((e) => e.type === 'auth_logout').length, 0);
});

test('handleRevokeAll writes auth_revoke_all on success', async () => {
  kv._resetMemoryStore();
  const req = reqWithCookie('POST', 'revoke-audit@example.com');
  const res = mockRes();
  await authHandler.handleRevokeAll(req, res);
  assert.equal(res.statusCode, 200);
  const hits = (await events.list({})).filter((e) => e.type === 'auth_revoke_all');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].email, 'revoke-audit@example.com');
});

test('handleRevokeAll does NOT write auth_revoke_all on a 401', async () => {
  kv._resetMemoryStore();
  const req = { method: 'POST', headers: {} };
  const res = mockRes();
  await authHandler.handleRevokeAll(req, res);
  assert.equal(res.statusCode, 401);
  const log = await events.list({});
  assert.equal(log.filter((e) => e.type === 'auth_revoke_all').length, 0);
});

// ── Org handler audit events ──────────────────────────

test('handleCreate (POST /api/orgs) writes org_created', async () => {
  kv._resetMemoryStore();
  const req = reqWithCookie('POST', 'org-owner@example.com', {
    body: { name: 'Acme Imports' },
    query: { path: ['orgs'] },
    url: '/api/orgs',
  });
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 201);
  const created = JSON.parse(res.body).org;
  const hits = (await events.list({})).filter((e) => e.type === 'org_created');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].email, 'org-owner@example.com');
  assert.equal(hits[0].orgName, 'Acme Imports');
  assert.equal(hits[0].orgId, created.id);
});

test('handleInvite writes org_member_invited (new member only, not on re-invite)', async () => {
  kv._resetMemoryStore();
  const orgs = require('../lib/orgs');
  const org = await orgs.createOrg({ name: 'Invite Co', ownerEmail: 'inviter@example.com' });

  // First invite → records event.
  const req1 = reqWithCookie('POST', 'inviter@example.com', {
    body: { email: 'invitee@example.com', role: 'member' },
    query: { path: ['orgs', org.id, 'invite'] },
    url: `/api/orgs/${org.id}/invite`,
  });
  await orgsHandler(req1, mockRes());

  // Re-invite (same email) → idempotent no-op, should NOT double-log.
  const req2 = reqWithCookie('POST', 'inviter@example.com', {
    body: { email: 'invitee@example.com', role: 'member' },
    query: { path: ['orgs', org.id, 'invite'] },
    url: `/api/orgs/${org.id}/invite`,
  });
  await orgsHandler(req2, mockRes());

  const hits = (await events.list({})).filter((e) => e.type === 'org_member_invited');
  assert.equal(hits.length, 1, 'only the first invite should record');
  assert.equal(hits[0].email, 'inviter@example.com');
  assert.equal(hits[0].inviteeEmail, 'invitee@example.com');
  assert.equal(hits[0].role, 'member');
  assert.equal(hits[0].orgId, org.id);
});

test('handleRemove writes org_member_removed with both actor + target', async () => {
  kv._resetMemoryStore();
  const orgs = require('../lib/orgs');
  const org = await orgs.createOrg({ name: 'Remove Co', ownerEmail: 'admin@example.com' });
  await orgs.addMember(org.id, { email: 'tobekicked@example.com', role: 'member' });

  const req = reqWithCookie('POST', 'admin@example.com', {
    body: { email: 'tobekicked@example.com' },
    query: { path: ['orgs', org.id, 'remove'] },
    url: `/api/orgs/${org.id}/remove`,
  });
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 200);

  const hits = (await events.list({})).filter((e) => e.type === 'org_member_removed');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].email, 'admin@example.com');         // actor
  assert.equal(hits[0].removedEmail, 'tobekicked@example.com'); // target
  assert.equal(hits[0].orgId, org.id);
});

test('handleTransfer writes org_ownership_transferred', async () => {
  kv._resetMemoryStore();
  const orgs = require('../lib/orgs');
  const org = await orgs.createOrg({ name: 'Transfer Co', ownerEmail: 'old@example.com' });
  await orgs.addMember(org.id, { email: 'new@example.com', role: 'admin' });

  const req = reqWithCookie('POST', 'old@example.com', {
    body: { toEmail: 'new@example.com' },
    query: { path: ['orgs', org.id, 'transfer'] },
    url: `/api/orgs/${org.id}/transfer`,
  });
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 200);

  const hits = (await events.list({})).filter((e) => e.type === 'org_ownership_transferred');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].email, 'old@example.com');     // outgoing owner (actor)
  assert.equal(hits[0].toEmail, 'new@example.com');   // new owner
  assert.equal(hits[0].orgId, org.id);
});

test('handleCreate does NOT write org_created on validation failure', async () => {
  kv._resetMemoryStore();
  const req = reqWithCookie('POST', 'fail@example.com', {
    body: { name: '' },              // missing name → 400
    query: { path: ['orgs'] },
    url: '/api/orgs',
  });
  const res = mockRes();
  await orgsHandler(req, res);
  assert.equal(res.statusCode, 400);
  const log = await events.list({});
  assert.equal(log.filter((e) => e.type === 'org_created').length, 0);
});

// ── Account handler audit events ──────────────────────

test('handleExport writes account_exported with the export stats', async () => {
  kv._resetMemoryStore();
  const req = reqWithCookie('GET', 'exporter@example.com', {
    query: { path: ['account', 'export'] },
    url: '/api/account/export',
  });
  const res = mockRes();
  await accountHandler(req, res);
  assert.equal(res.statusCode, 200);

  const hits = (await events.list({})).filter((e) => e.type === 'account_exported');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].email, 'exporter@example.com');
  assert.equal(typeof hits[0].savedPlanCount, 'number');
  assert.equal(typeof hits[0].eventCount, 'number');
});

test('handleDelete writes account_deleted using the PSEUDONYM as identity (no raw email)', async () => {
  kv._resetMemoryStore();
  const req = reqWithCookie('POST', 'goingaway@example.com', {
    body: { confirm: true },
    query: { path: ['account', 'delete'] },
    url: '/api/account/delete',
  });
  const res = mockRes();
  await accountHandler(req, res);
  assert.equal(res.statusCode, 200);

  const log = await events.list({});
  const hits = log.filter((e) => e.type === 'account_deleted');
  assert.equal(hits.length, 1);
  // The audit entry MUST carry the pseudonym, not the raw email — otherwise
  // we'd reintroduce the very PII the user asked us to delete.
  assert.ok(/^deleted-[a-f0-9]{16}@anonymised\.local$/.test(hits[0].email),
    `expected pseudonym identity, got ${hits[0].email}`);
  // The original email must not appear anywhere on the entry.
  assert.equal(JSON.stringify(hits[0]).indexOf('goingaway@example.com'), -1,
    'raw email leaked into the account_deleted audit row');
});

test('handleDelete does NOT write account_deleted without { confirm: true }', async () => {
  kv._resetMemoryStore();
  const req = reqWithCookie('POST', 'nope@example.com', {
    body: {},                        // missing confirm → 400
    query: { path: ['account', 'delete'] },
    url: '/api/account/delete',
  });
  const res = mockRes();
  await accountHandler(req, res);
  assert.equal(res.statusCode, 400);
  const log = await events.list({});
  assert.equal(log.filter((e) => e.type === 'account_deleted').length, 0);
});
