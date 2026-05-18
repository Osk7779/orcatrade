// Sprint BG-5.6 — user-facing /account/activity/ + GET /api/account/activity.
//
// Three layers asserted:
//   1. Pure filterUserActivity + redactActivityRow behavior — covers the
//      cross-membership privacy guarantee.
//   2. handleActivity end-to-end — auth gate, payload shape, redaction
//      reaches the wire.
//   3. /account/activity/ HTML + app.js markup contract.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const auth = require('../lib/auth');
const events = require('../lib/events');
const kv = require('../lib/intelligence/kv-store');
const accountHandler = require('../lib/handlers/account');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
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

// ── filterUserActivity ────────────────────────────────

test('filterUserActivity: empty list → empty', () => {
  assert.deepEqual(accountHandler.filterUserActivity([], 'me@x.com'), []);
});

test('filterUserActivity: returns only security event types', () => {
  const ev = [
    { type: 'auth_signin',           email: 'me@x.com' },
    { type: 'import_plan_generated', email: 'me@x.com' },   // product event → filtered out
    { type: 'plan_saved',            email: 'me@x.com' },   // product event → filtered out
    { type: 'ai_call',               email: 'me@x.com' },   // product event → filtered out
    { type: 'org_created',           email: 'me@x.com' },
  ];
  const out = accountHandler.filterUserActivity(ev, 'me@x.com');
  assert.deepEqual(out.map(e => e.type), ['auth_signin', 'org_created']);
});

test('filterUserActivity: matches actor + target fields', () => {
  const ev = [
    { type: 'org_member_invited', email: 'admin@x.com', inviteeEmail: 'me@x.com', role: 'member' },
    { type: 'org_member_removed', email: 'admin@x.com', removedEmail: 'me@x.com' },
    { type: 'org_ownership_transferred', email: 'old@x.com', toEmail: 'me@x.com' },
    { type: 'auth_signin', email: 'someone@x.com' },  // not me — drop
  ];
  const out = accountHandler.filterUserActivity(ev, 'me@x.com');
  assert.equal(out.length, 3);
  assert.deepEqual(out.map(e => e.type).sort(),
    ['org_member_invited', 'org_member_removed', 'org_ownership_transferred']);
});

test('filterUserActivity: email matching is case-insensitive', () => {
  const ev = [{ type: 'auth_signin', email: 'Me@Example.COM' }];
  const out = accountHandler.filterUserActivity(ev, 'me@example.com');
  assert.equal(out.length, 1);
});

test('filterUserActivity: empty email → returns empty array', () => {
  const ev = [{ type: 'auth_signin', email: 'somebody@x.com' }];
  assert.deepEqual(accountHandler.filterUserActivity(ev, ''), []);
  assert.deepEqual(accountHandler.filterUserActivity(ev, null), []);
});

test('filterUserActivity: ignores malformed entries gracefully', () => {
  const ev = [null, { type: 'auth_signin' /* no email field */ }, { email: 'me@x.com' /* no type */ }];
  assert.deepEqual(accountHandler.filterUserActivity(ev, 'me@x.com'), []);
});

// ── redactActivityRow ─────────────────────────────────

test('redactActivityRow: leaves my own email intact, redacts everyone elses', () => {
  const row = {
    type: 'org_member_invited',
    email: 'admin@x.com',
    inviteeEmail: 'me@x.com',
    role: 'member',
  };
  const out = accountHandler.redactActivityRow(row, 'me@x.com');
  assert.equal(out.email, '(another user)');
  assert.equal(out.inviteeEmail, 'me@x.com');
});

test('redactActivityRow: case-insensitive own-email match', () => {
  const out = accountHandler.redactActivityRow({ email: 'Me@X.COM' }, 'me@x.com');
  assert.equal(out.email, 'Me@X.COM');
});

test('redactActivityRow: every identity field handled — including transfer', () => {
  const row = {
    type: 'org_ownership_transferred',
    email: 'old@x.com',
    toEmail: 'me@x.com',
  };
  const out = accountHandler.redactActivityRow(row, 'me@x.com');
  assert.equal(out.email, '(another user)');
  assert.equal(out.toEmail, 'me@x.com');
});

test('redactActivityRow: preserves non-identity fields (role, ip, source, orgId)', () => {
  const row = {
    type: 'auth_signin',
    email: 'me@x.com',
    source: 'magic-link',
    ip: '203.0.113.1',
    at: '2026-05-18T10:00:00.000Z',
  };
  const out = accountHandler.redactActivityRow(row, 'me@x.com');
  assert.equal(out.source, 'magic-link');
  assert.equal(out.ip, '203.0.113.1');
  assert.equal(out.at, '2026-05-18T10:00:00.000Z');
});

// ── SECURITY_EVENT_TYPES surface ──────────────────────

test('SECURITY_EVENT_TYPES matches the BG-5.5 set (no product events leak)', () => {
  const expected = new Set([
    'auth_signin',
    'auth_logout',
    'auth_revoke_all',
    'account_exported',
    'org_created',
    'org_member_invited',
    'org_member_removed',
    'org_ownership_transferred',
  ]);
  // No more, no less.
  assert.equal(accountHandler.SECURITY_EVENT_TYPES.size, expected.size);
  for (const t of expected) {
    assert.ok(accountHandler.SECURITY_EVENT_TYPES.has(t), `missing ${t}`);
  }
  // Product events must NOT appear.
  for (const t of ['import_plan_generated', 'plan_saved', 'ai_call', 'founding_applied']) {
    assert.ok(!accountHandler.SECURITY_EVENT_TYPES.has(t), `${t} leaked into security set`);
  }
});

// ── handleActivity end-to-end ─────────────────────────

test('handleActivity: 401 when not signed in (via dispatcher)', async () => {
  kv._resetMemoryStore();
  const req = {
    method: 'GET', headers: {}, query: { path: ['account', 'activity'] },
    url: '/api/account/activity',
  };
  const res = mockRes();
  await accountHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test('handleActivity: empty timeline when user has no events', async () => {
  kv._resetMemoryStore();
  const req = reqWithCookie('GET', 'fresh@example.com', {
    query: { path: ['account', 'activity'] },
    url: '/api/account/activity',
  });
  const res = mockRes();
  await accountHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.deepEqual(body.events, []);
  assert.equal(body.user.email, 'fresh@example.com');
});

test('handleActivity: returns only the signed-in user\'s events', async () => {
  kv._resetMemoryStore();
  // Seed some events — mix of mine + someone else's.
  await events.record('auth_signin', { email: 'someone-else@x.com', source: 'magic-link' });
  await events.record('auth_signin', { email: 'mine@x.com', source: 'magic-link', ip: '203.0.113.1' });
  await events.record('org_created', { email: 'mine@x.com', orgId: 'org_abc', orgName: 'My Co' });
  await events.record('auth_signin', { email: 'someone-else@x.com', source: 'magic-link' });

  const req = reqWithCookie('GET', 'mine@x.com', {
    query: { path: ['account', 'activity'] },
    url: '/api/account/activity',
  });
  const res = mockRes();
  await accountHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.events.length, 2);
  // Everything visible must mention me.
  for (const e of body.events) {
    assert.equal(e.email, 'mine@x.com');
  }
});

test('handleActivity: redacts other emails in invite/remove/transfer rows', async () => {
  kv._resetMemoryStore();
  // Someone removed me from their org — I should be able to see the
  // event, but I should NOT learn the admin's email.
  await events.record('org_member_removed', {
    email: 'admin@x.com',          // actor (will be redacted from MY view)
    removedEmail: 'mine@x.com',    // target = me (will be kept)
    orgId: 'org_xyz',
  });

  const req = reqWithCookie('GET', 'mine@x.com', {
    query: { path: ['account', 'activity'] },
    url: '/api/account/activity',
  });
  const res = mockRes();
  await accountHandler(req, res);
  const body = JSON.parse(res.body);
  assert.equal(body.events.length, 1);
  const row = body.events[0];
  assert.equal(row.email, '(another user)');
  assert.equal(row.removedEmail, 'mine@x.com');
  // The raw foreign email must not appear in the wire response.
  assert.equal(JSON.stringify(row).indexOf('admin@x.com'), -1);
});

test('handleActivity: caps at 50 rows even when many are present', async () => {
  kv._resetMemoryStore();
  for (let i = 0; i < 70; i++) {
    await events.record('auth_signin', { email: 'busy@x.com', source: 'magic-link' });
  }
  const req = reqWithCookie('GET', 'busy@x.com', {
    query: { path: ['account', 'activity'] },
    url: '/api/account/activity',
  });
  const res = mockRes();
  await accountHandler(req, res);
  const body = JSON.parse(res.body);
  assert.equal(body.events.length, 50);
  assert.equal(body.limit, 50);
});

test('dispatcher: 404 list now advertises GET /api/account/activity', async () => {
  const cookie = auth.buildSessionCookie('signed-in@example.com');
  const req = {
    method: 'GET', headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
    query: { path: ['account', 'bogus'] },
    url: '/api/account/bogus',
  };
  const res = mockRes();
  await accountHandler(req, res);
  assert.equal(res.statusCode, 404);
  const j = JSON.parse(res.body);
  assert.match(j.error, /\/api\/account\/activity/);
});

// ── /account/activity/ HTML + app.js contract ─────────

const ACTIVITY_HTML = fs.readFileSync(path.join(__dirname, '..', 'account', 'activity', 'index.html'), 'utf8');
const ACTIVITY_JS = fs.readFileSync(path.join(__dirname, '..', 'account', 'activity', 'app.js'), 'utf8');

test('/account/activity/ page exists, substantial, noindex', () => {
  assert.ok(ACTIVITY_HTML.length > 1500);
  assert.match(ACTIVITY_HTML, /<meta name="robots" content="noindex,\s*nofollow"/i);
});

test('/account/activity/ page declares every required DOM hook', () => {
  for (const id of ['authNeeded', 'content', 'events', 'error']) {
    assert.match(ACTIVITY_HTML, new RegExp(`id=["']${id}["']`), `id="${id}" present`);
  }
});

test('/account/activity/ page breadcrumb links back to /account/', () => {
  assert.match(ACTIVITY_HTML, /href=["']\/account\/["']/);
});

test('/account/activity/ page cross-links to /account/privacy/ for full export', () => {
  assert.match(ACTIVITY_HTML, /href=["']\/account\/privacy\/["']/);
});

test('/account/activity/ app.js bootstraps from /api/auth/me and reads /api/account/activity', () => {
  assert.match(ACTIVITY_JS, /fetch\(['"`]\/api\/auth\/me/);
  assert.match(ACTIVITY_JS, /fetch\(['"`]\/api\/account\/activity/);
});

test('/account/activity/ app.js DOMContentLoaded handler is browser-guarded', () => {
  assert.match(ACTIVITY_JS, /typeof document !== ['"]undefined['"]/);
});

test('/account/activity/ app.js EVENT_META covers every BG-5.5 type', () => {
  const mod = require('../account/activity/app.js');
  for (const t of [
    'auth_signin', 'auth_logout', 'auth_revoke_all', 'account_exported',
    'org_created', 'org_member_invited', 'org_member_removed', 'org_ownership_transferred',
  ]) {
    assert.ok(mod.EVENT_META[t], `EVENT_META missing ${t}`);
    assert.ok(mod.EVENT_META[t].label, `${t} has a label`);
    assert.ok(mod.EVENT_META[t].pill, `${t} has a pill class`);
  }
});

test('/account/activity/ app.js renderDetail distinguishes inviter vs invitee', () => {
  const mod = require('../account/activity/app.js');
  const asActor = mod.renderDetail({
    type: 'org_member_invited', email: 'me@x.com', inviteeEmail: 'other@x.com', role: 'admin',
  }, 'me@x.com');
  const asTarget = mod.renderDetail({
    type: 'org_member_invited', email: 'admin@x.com', inviteeEmail: 'me@x.com', role: 'admin',
  }, 'me@x.com');
  assert.match(asActor, /You invited/);
  assert.match(asTarget, /You were invited/);
});

test('/account/activity/ app.js escapeHtml neutralises angle brackets + quotes', () => {
  const mod = require('../account/activity/app.js');
  const out = mod.escapeHtml('<script>alert("x")</script>');
  assert.equal(out.indexOf('<'), -1);
  assert.equal(out.indexOf('"'), -1);
  assert.match(out, /&lt;script&gt;/);
});

// ── /account/ quick-links cross-link to activity ──────

test('/account/ quick-links includes the activity page', () => {
  const accountHtml = fs.readFileSync(path.join(__dirname, '..', 'account', 'index.html'), 'utf8');
  assert.match(accountHtml, /href=["']\/account\/activity\/["']/);
  assert.match(accountHtml, /Recent activity/i);
});
