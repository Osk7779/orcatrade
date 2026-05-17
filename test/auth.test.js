// Magic-link auth tests.

const test = require('node:test');
const assert = require('node:assert/strict');

// Pin a stable secret for tests
process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';

// Run KV in memory mode
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const auth = require('../lib/auth');
const kv = require('../lib/intelligence/kv-store');
const authHandler = require('../lib/handlers/auth');

// ── Token generation ──────────────────────────────────

test('generateMagicToken returns a 64-char hex string (256 bits)', () => {
  const t = auth.generateMagicToken();
  assert.match(t, /^[a-f0-9]{64}$/);
});

test('generateMagicToken produces unique tokens', () => {
  const t1 = auth.generateMagicToken();
  const t2 = auth.generateMagicToken();
  assert.notEqual(t1, t2);
});

test('magicKvKey prepends the auth namespace', () => {
  const k = auth.magicKvKey('abc123');
  assert.equal(k, 'auth:magic:abc123');
});

// ── Cookie signing / verification ─────────────────────

test('buildSessionCookie + verifyAndParseCookie round-trip', () => {
  const cookie = auth.buildSessionCookie('user@example.com');
  const parsed = auth.verifyAndParseCookie(cookie);
  assert.ok(parsed);
  assert.equal(parsed.email, 'user@example.com');
  assert.ok(parsed.iat);
  assert.ok(parsed.exp > Date.now());
});

test('email is lowercased in cookie', () => {
  const cookie = auth.buildSessionCookie('USER@EXAMPLE.COM');
  const parsed = auth.verifyAndParseCookie(cookie);
  assert.equal(parsed.email, 'user@example.com');
});

test('verifyAndParseCookie rejects tampered cookie', () => {
  const cookie = auth.buildSessionCookie('user@example.com');
  const parts = cookie.split('.');
  // Modify the payload
  const tampered = parts[0].slice(0, -1) + 'X' + '.' + parts[1];
  assert.equal(auth.verifyAndParseCookie(tampered), null);
});

test('verifyAndParseCookie rejects forged signature', () => {
  const cookie = auth.buildSessionCookie('user@example.com');
  const parts = cookie.split('.');
  const forged = parts[0] + '.' + 'a'.repeat(64);
  assert.equal(auth.verifyAndParseCookie(forged), null);
});

test('verifyAndParseCookie rejects expired cookie', () => {
  // Build a cookie with exp in the past
  const expired = auth.signPayload({ email: 'old@user.com', iat: 0, exp: 1 });
  assert.equal(auth.verifyAndParseCookie(expired), null);
});

test('verifyAndParseCookie rejects malformed inputs', () => {
  assert.equal(auth.verifyAndParseCookie(null), null);
  assert.equal(auth.verifyAndParseCookie(''), null);
  assert.equal(auth.verifyAndParseCookie('not-a-cookie'), null);
  assert.equal(auth.verifyAndParseCookie('a.b.c'), null);  // wrong segment count
});

// ── Cookie header helpers ─────────────────────────────

test('parseCookies extracts named cookies', () => {
  const cookies = auth.parseCookies('foo=1; bar=2; orcatrade_session=abc');
  assert.equal(cookies.foo, '1');
  assert.equal(cookies.bar, '2');
  assert.equal(cookies.orcatrade_session, 'abc');
});

test('parseCookies handles missing/empty', () => {
  assert.deepEqual(auth.parseCookies(''), {});
  assert.deepEqual(auth.parseCookies(null), {});
});

test('buildSetCookieHeader sets HttpOnly + SameSite=Lax + Secure', () => {
  const h = auth.buildSetCookieHeader('test-value');
  assert.match(h, /HttpOnly/);
  assert.match(h, /SameSite=Lax/);
  assert.match(h, /Secure/);
  assert.match(h, /Path=\//);
  assert.match(h, /Max-Age=\d+/);
});

test('buildSetCookieHeader skips Secure when explicitly disabled (dev)', () => {
  const h = auth.buildSetCookieHeader('v', { secure: false });
  assert.ok(!/Secure/.test(h), 'no Secure flag in dev mode');
  assert.match(h, /HttpOnly/);
});

test('buildClearCookieHeader sets Max-Age=0', () => {
  const h = auth.buildClearCookieHeader();
  assert.match(h, /Max-Age=0/);
  assert.match(h, /HttpOnly/);
});

// ── getCurrentUser ────────────────────────────────────

test('getCurrentUser: returns user from valid cookie', () => {
  const cookie = auth.buildSessionCookie('me@example.com');
  const fakeReq = { headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}; other=x` } };
  const user = auth.getCurrentUser(fakeReq);
  assert.ok(user);
  assert.equal(user.email, 'me@example.com');
});

test('getCurrentUser: returns null with no cookie header', () => {
  assert.equal(auth.getCurrentUser({ headers: {} }), null);
});

test('getCurrentUser: returns null with malformed cookie', () => {
  const fakeReq = { headers: { cookie: 'orcatrade_session=garbage' } };
  assert.equal(auth.getCurrentUser(fakeReq), null);
});

// ── isValidEmail ──────────────────────────────────────

test('isValidEmail accepts well-formed addresses', () => {
  assert.equal(auth.isValidEmail('user@example.com'), true);
  assert.equal(auth.isValidEmail('first.last+tag@subdomain.co.uk'), true);
});

test('isValidEmail rejects malformed', () => {
  assert.equal(auth.isValidEmail(''), false);
  assert.equal(auth.isValidEmail(null), false);
  assert.equal(auth.isValidEmail('no-at-sign'), false);
  assert.equal(auth.isValidEmail('two@@signs.com'), false);
  assert.equal(auth.isValidEmail('no-tld@example'), false);
  assert.equal(auth.isValidEmail('a'.repeat(250) + '@x.com'), false); // too long
});

// ── /api/auth/* sub-actions ───────────────────────────
// We invoke the handlers directly with mock req/res.

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    end(body) { this.body = body || ''; return this; },
  };
  res.headersSent = false;
  res.writableEnded = false;
  return res;
}

test('handleRequest: 405 on non-POST', async () => {
  const req = { method: 'GET', headers: {}, body: {} };
  const res = mockRes();
  await authHandler.handleRequest(req, res);
  assert.equal(res.statusCode, 405);
});

test('handleRequest: 400 on missing/invalid email', async () => {
  const req = { method: 'POST', headers: {}, body: { email: '' } };
  const res = mockRes();
  await authHandler.handleRequest(req, res);
  assert.equal(res.statusCode, 400);
});

test('handleRequest: 202 on valid email + token written to KV', async () => {
  kv._resetMemoryStore();
  const req = { method: 'POST', headers: {}, body: { email: 'flow@example.com' } };
  const res = mockRes();
  await authHandler.handleRequest(req, res);
  assert.equal(res.statusCode, 202);
  // Verify a magic token was stored
  const keys = await kv.listKeys('auth:magic:');
  assert.equal(keys.length, 1);
  const storedEmail = await kv.get(keys[0]);
  assert.equal(storedEmail, 'flow@example.com');
});

test('handleVerify: 400 on missing token', async () => {
  const req = { method: 'GET', headers: {}, query: {} };
  const res = mockRes();
  await authHandler.handleVerify(req, res);
  assert.equal(res.statusCode, 400);
});

test('handleVerify: 400 on malformed token (not 64 hex)', async () => {
  const req = { method: 'GET', headers: {}, query: { token: 'short' } };
  const res = mockRes();
  await authHandler.handleVerify(req, res);
  assert.equal(res.statusCode, 400);
});

test('handleVerify: 400 on unknown/expired token', async () => {
  kv._resetMemoryStore();
  const req = { method: 'GET', headers: {}, query: { token: 'a'.repeat(64) } };
  const res = mockRes();
  await authHandler.handleVerify(req, res);
  assert.equal(res.statusCode, 400);
});

test('handleVerify: full flow — token consumed, cookie set, 302 to /account/', async () => {
  kv._resetMemoryStore();
  // Stage a valid token in KV
  const token = auth.generateMagicToken();
  await kv.set(auth.magicKvKey(token), 'flow@example.com', { ttlSeconds: 900 });

  const req = { method: 'GET', headers: {}, query: { token } };
  const res = mockRes();
  await authHandler.handleVerify(req, res);

  assert.equal(res.statusCode, 302);
  assert.equal(res.headers['location'], '/account/');
  assert.match(res.headers['set-cookie'], /orcatrade_session=/);
  assert.match(res.headers['set-cookie'], /HttpOnly/);
  // Token should have been deleted (one-time-use)
  const stillThere = await kv.get(auth.magicKvKey(token));
  assert.equal(stillThere, null);
});

test('handleMe: 401 when not signed in', async () => {
  const req = { method: 'GET', headers: {} };
  const res = mockRes();
  await authHandler.handleMe(req, res);
  assert.equal(res.statusCode, 401);
});

test('handleMe: 200 + user when valid cookie present', async () => {
  const cookie = auth.buildSessionCookie('signed-in@example.com');
  const req = { method: 'GET', headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` } };
  const res = mockRes();
  await authHandler.handleMe(req, res);
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.user.email, 'signed-in@example.com');
});

test('handleLogout: clears cookie + 200 on POST', async () => {
  const req = { method: 'POST', headers: {} };
  const res = mockRes();
  await authHandler.handleLogout(req, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['set-cookie'], /Max-Age=0/);
});

test('handleLogout: clears cookie + 302 redirect on GET', async () => {
  const req = { method: 'GET', headers: {} };
  const res = mockRes();
  await authHandler.handleLogout(req, res);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers['location'], '/account/');
  assert.match(res.headers['set-cookie'], /Max-Age=0/);
});

// ── Dispatcher routing ────────────────────────────────

test('dispatcher: unknown action → 404', async () => {
  const req = {
    method: 'GET', headers: {}, query: { path: ['auth', 'unknown'] },
    url: '/api/auth/unknown',
  };
  const res = mockRes();
  res.status = function (code) { this.statusCode = code; return this; };
  res.end = function (b) { this.body = b || ''; };
  await authHandler(req, res);
  assert.equal(res.statusCode, 404);
});

test('dispatcher: routes /api/auth/me to handleMe', async () => {
  const req = {
    method: 'GET', headers: {}, query: { path: ['auth', 'me'] },
    url: '/api/auth/me',
  };
  const res = mockRes();
  res.status = function (code) { this.statusCode = code; return this; };
  await authHandler(req, res);
  // No cookie → 401
  assert.equal(res.statusCode, 401);
});

// ── /account/ page presence ───────────────────────────

test('/account/ page exists with sign-in form', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'account/index.html'), 'utf8');
  assert.match(html, /id="signin-form"/);
  assert.match(html, /id="state-loading"/);
  assert.match(html, /id="state-signin"/);
  assert.match(html, /id="state-sent"/);
  assert.match(html, /id="state-signedin"/);
});

test('/account/app.js calls /api/auth/me on load', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', 'account/app.js'), 'utf8');
  assert.match(js, /fetch\('\/api\/auth\/me'/);
  assert.match(js, /fetch\('\/api\/auth\/request'/);
  assert.match(js, /fetch\('\/api\/auth\/logout'/);
});

// ── api/[...path].js dispatcher includes auth ─────────

test('api/[...path].js dispatcher registers auth handler', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dispatcher = fs.readFileSync(path.join(__dirname, '..', 'api/[...path].js'), 'utf8');
  assert.match(dispatcher, /auth: require\('\.\.\/lib\/handlers\/auth'\)/);
});

// ── Sprint BG-3.2 phase 1: Session revocation ─────────

test('revKvKey is namespaced + email-normalised', () => {
  assert.equal(auth.revKvKey('Foo@Example.com'), 'auth:rev-min-iat:foo@example.com');
  assert.equal(auth.revKvKey('  trim@me.com  '), 'auth:rev-min-iat:trim@me.com');
});

test('getMinIat returns 0 when no revocation set', async () => {
  kv._resetMemoryStore();
  const v = await auth.getMinIat('never-revoked@example.com');
  assert.equal(v, 0);
});

test('getMinIat returns the stored timestamp after revoke', async () => {
  kv._resetMemoryStore();
  const before = Date.now();
  const ok = await auth.revokeAllSessionsForEmail('user@example.com');
  assert.equal(ok, true);
  const v = await auth.getMinIat('user@example.com');
  assert.ok(v >= before && v <= Date.now() + 100);
});

test('revokeAllSessionsForEmail is email-case-insensitive', async () => {
  kv._resetMemoryStore();
  await auth.revokeAllSessionsForEmail('USER@EXAMPLE.COM');
  const v = await auth.getMinIat('user@example.com');
  assert.ok(v > 0);
});

test('revokeAllSessionsForEmail returns false on empty email', async () => {
  kv._resetMemoryStore();
  assert.equal(await auth.revokeAllSessionsForEmail(''), false);
  assert.equal(await auth.revokeAllSessionsForEmail(null), false);
});

test('getCurrentUserStrict: returns user when no revocation', async () => {
  kv._resetMemoryStore();
  const cookie = auth.buildSessionCookie('strict@example.com');
  const req = { headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` } };
  const user = await auth.getCurrentUserStrict(req);
  assert.ok(user);
  assert.equal(user.email, 'strict@example.com');
});

test('getCurrentUserStrict: returns null when cookie iat < revocation timestamp', async () => {
  kv._resetMemoryStore();
  // Build a cookie with iat in the past
  const past = Date.now() - 60_000;
  const cookieVal = auth.signPayload({
    email: 'kicked@example.com',
    iat: past,
    exp: Date.now() + 60_000,
  });
  const req = { headers: { cookie: `orcatrade_session=${encodeURIComponent(cookieVal)}` } };
  // Revoke now — the cookie should no longer pass strict check
  await auth.revokeAllSessionsForEmail('kicked@example.com');
  const user = await auth.getCurrentUserStrict(req);
  assert.equal(user, null);
});

test('getCurrentUserStrict: a NEW cookie minted AFTER revocation still works', async () => {
  kv._resetMemoryStore();
  await auth.revokeAllSessionsForEmail('roundtrip@example.com');
  // Small sleep is overkill — Date.now() advances naturally between calls.
  // But to be safe, mint with explicit iat > the stored timestamp.
  const stored = await auth.getMinIat('roundtrip@example.com');
  const fresh = auth.signPayload({
    email: 'roundtrip@example.com',
    iat: stored + 1000,
    exp: Date.now() + 60_000,
  });
  const req = { headers: { cookie: `orcatrade_session=${encodeURIComponent(fresh)}` } };
  const user = await auth.getCurrentUserStrict(req);
  assert.ok(user);
  assert.equal(user.email, 'roundtrip@example.com');
});

test('getCurrentUserStrict: null when there is no cookie', async () => {
  kv._resetMemoryStore();
  const user = await auth.getCurrentUserStrict({ headers: {} });
  assert.equal(user, null);
});

test('handleRevokeAll: 405 on non-POST', async () => {
  const req = { method: 'GET', headers: {} };
  const res = mockRes();
  await authHandler.handleRevokeAll(req, res);
  assert.equal(res.statusCode, 405);
});

test('handleRevokeAll: 401 when not signed in', async () => {
  const req = { method: 'POST', headers: {} };
  const res = mockRes();
  await authHandler.handleRevokeAll(req, res);
  assert.equal(res.statusCode, 401);
});

test('handleRevokeAll: writes min-iat + clears cookie + 200 when signed in', async () => {
  kv._resetMemoryStore();
  const cookie = auth.buildSessionCookie('killmysessions@example.com');
  const req = {
    method: 'POST',
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
  };
  const res = mockRes();
  const before = Date.now();
  await authHandler.handleRevokeAll(req, res);
  assert.equal(res.statusCode, 200);
  // Cookie cleared
  assert.match(res.headers['set-cookie'], /Max-Age=0/);
  // Min-iat written
  const stored = await auth.getMinIat('killmysessions@example.com');
  assert.ok(stored >= before);
});

test('dispatcher: routes /api/auth/revoke-all to handleRevokeAll', async () => {
  const req = {
    method: 'POST', headers: {}, query: { path: ['auth', 'revoke-all'] },
    url: '/api/auth/revoke-all',
  };
  const res = mockRes();
  res.status = function (code) { this.statusCode = code; return this; };
  await authHandler(req, res);
  // No cookie → 401
  assert.equal(res.statusCode, 401);
});

test('dispatcher: 404 list includes revoke-all', async () => {
  const req = {
    method: 'GET', headers: {}, query: { path: ['auth', 'bogus'] },
    url: '/api/auth/bogus',
  };
  const res = mockRes();
  res.status = function (code) { this.statusCode = code; return this; };
  res.end = function (b) { this.body = b || ''; };
  await authHandler(req, res);
  assert.equal(res.statusCode, 404);
  const j = JSON.parse(res.body);
  assert.ok(j.available.includes('revoke-all'));
});

// ── UI surface for BG-3.2 phase 1 ─────────────────────

test('/account/ page renders the "Sign out everywhere" button', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'account/index.html'), 'utf8');
  assert.match(html, /id=["']revoke-all-btn["']/);
  assert.match(html, /Sign out everywhere/i);
  assert.match(html, /id=["']revoke-all-msg["']/);
});

test('/account/app.js wires the Sign-out-everywhere button to /api/auth/revoke-all', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', 'account/app.js'), 'utf8');
  assert.match(js, /revoke-all-btn/);
  assert.match(js, /fetch\(['"`]\/api\/auth\/revoke-all['"`]/);
  // Must prompt the user via confirm() — destructive action.
  assert.match(js, /confirm\(/);
});

// ── Strict gate is wired on sensitive handlers ────────

test('account + orgs handlers use getCurrentUserStrict (BG-3.2 strict gate)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const account = fs.readFileSync(path.join(__dirname, '..', 'lib/handlers/account.js'), 'utf8');
  const orgs = fs.readFileSync(path.join(__dirname, '..', 'lib/handlers/orgs.js'), 'utf8');
  assert.match(account, /getCurrentUserStrict/);
  assert.match(orgs, /getCurrentUserStrict/);
});
