// Sprint BG-3.2 phase 2 — visible sessions list.
//
// Covers:
//   - Cookie shape: sid field carried through round-trip, generateSessionId
//     produces 16 hex chars, old cookies (no sid) still verify
//   - Session metadata persistence: recordSession writes both the record
//     + the per-email index; listSessionsForEmail returns records sorted
//     newest-first; expired records skipped
//   - Per-session revoke: revokeSession ownership-checked + idempotent,
//     isSessionRevoked surfaces it, getCurrentUserStrict honours it
//   - Sanitisers: sanitiseUa caps + trims
//   - Handler: GET /api/auth/sessions returns the right shape with the
//     "isCurrent" flag set on the matching sid + currentSid surfaced;
//     POST /api/auth/sessions/<sid>/revoke owner-check + audit + cookie
//     clear when revoking current
//   - Magic-link verify: cookie issued carries the sid that gets
//     persisted in KV (same value, not different ones)
//   - events.ALLOWED_TYPES contract: auth_session_revoked added
//   - /account/security/ UI markup contract

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auth = require('../lib/auth');
const events = require('../lib/events');
const kv = require('../lib/intelligence/kv-store');
const authHandler = require('../lib/handlers/auth');

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}

function reqWithCookie(method, email, sidOverride, extras = {}) {
  // sidOverride is optional — when undefined we let buildSessionCookie
  // generate a fresh one and capture it via parsing the cookie back.
  const cookie = sidOverride === null
    ? require('../lib/auth').signPayload({
        email: String(email).toLowerCase(),
        iat: Date.now(),
        exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
        // intentionally no sid — simulates a pre-sprint cookie
      })
    : auth.buildSessionCookie(email, sidOverride ? { sid: sidOverride } : {});
  return {
    method,
    headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
    body: {},
    ...extras,
  };
}

// ── Cookie shape ─────────────────────────────────────

test('generateSessionId: 16 hex chars, unique per call', () => {
  const a = auth.generateSessionId();
  const b = auth.generateSessionId();
  assert.match(a, /^[a-f0-9]{16}$/);
  assert.match(b, /^[a-f0-9]{16}$/);
  assert.notEqual(a, b);
});

test('buildSessionCookie: carries the generated sid in the verified payload', () => {
  const cookie = auth.buildSessionCookie('user@example.com');
  const parsed = auth.verifyAndParseCookie(cookie);
  assert.ok(parsed);
  assert.match(parsed.sid, /^[a-f0-9]{16}$/);
});

test('buildSessionCookie: opts.sid is honoured + survives round-trip', () => {
  const cookie = auth.buildSessionCookie('user@example.com', { sid: 'abcdef0123456789' });
  const parsed = auth.verifyAndParseCookie(cookie);
  assert.equal(parsed.sid, 'abcdef0123456789');
});

test('getCurrentUser: surfaces sid (or null for legacy cookies)', () => {
  const cookieWithSid = auth.buildSessionCookie('user@example.com');
  const req1 = { headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookieWithSid) } };
  const u1 = auth.getCurrentUser(req1);
  assert.ok(u1);
  assert.match(u1.sid, /^[a-f0-9]{16}$/);

  // Pre-sprint cookie shape — no sid field.
  const legacyCookie = auth.signPayload({
    email: 'legacy@example.com',
    iat: Date.now(),
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });
  const req2 = { headers: { cookie: 'orcatrade_session=' + encodeURIComponent(legacyCookie) } };
  const u2 = auth.getCurrentUser(req2);
  assert.ok(u2);
  assert.equal(u2.sid, null);
});

// ── Sanitisers ───────────────────────────────────────

test('sanitiseUa: trims, caps at 250 chars, returns null for empty', () => {
  assert.equal(auth.sanitiseUa(''), null);
  assert.equal(auth.sanitiseUa(null), null);
  assert.equal(auth.sanitiseUa('   '), null);
  assert.equal(auth.sanitiseUa('  Chrome/128  '), 'Chrome/128');
  const long = 'x'.repeat(500);
  assert.equal(auth.sanitiseUa(long).length, 250);
});

// ── Session persistence + listing ───────────────────

test('recordSession + listSessionsForEmail: returns own sessions newest-first', async () => {
  kv._resetMemoryStore();
  await auth.recordSession({
    sid: '1111111111111111', email: 'multi@example.com',
    iat: Date.now() - 2000, exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
    ua: 'Chrome on macOS', ip: '1.1.1.1',
  });
  // Tiny delay so createdAt differs.
  await new Promise((r) => setTimeout(r, 10));
  await auth.recordSession({
    sid: '2222222222222222', email: 'multi@example.com',
    iat: Date.now(), exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
    ua: 'Safari on iOS', ip: '2.2.2.2',
  });
  const list = await auth.listSessionsForEmail('multi@example.com');
  assert.equal(list.length, 2);
  // Newest first.
  assert.equal(list[0].sid, '2222222222222222');
  assert.equal(list[1].sid, '1111111111111111');
});

test('listSessionsForEmail: filters out expired records', async () => {
  kv._resetMemoryStore();
  await auth.recordSession({
    sid: 'aaaaaaaaaaaaaaaa', email: 'exp@example.com',
    iat: Date.now() - 60_000, exp: Date.now() - 1000, // already expired
    ua: 'old', ip: '0.0.0.0',
  });
  await auth.recordSession({
    sid: 'bbbbbbbbbbbbbbbb', email: 'exp@example.com',
    iat: Date.now(), exp: Date.now() + 60_000,
    ua: 'fresh', ip: '0.0.0.0',
  });
  const list = await auth.listSessionsForEmail('exp@example.com');
  assert.equal(list.length, 1);
  assert.equal(list[0].sid, 'bbbbbbbbbbbbbbbb');
});

test('listSessionsForEmail: case-insensitive on email', async () => {
  kv._resetMemoryStore();
  await auth.recordSession({
    sid: 'cccccccccccccccc', email: 'Case@Example.com',
    iat: Date.now(), exp: Date.now() + 60_000,
    ua: 'x', ip: '0.0.0.0',
  });
  const list = await auth.listSessionsForEmail('case@example.com');
  assert.equal(list.length, 1);
});

test('listSessionsForEmail: empty email returns []', async () => {
  kv._resetMemoryStore();
  assert.deepEqual(await auth.listSessionsForEmail(''), []);
  assert.deepEqual(await auth.listSessionsForEmail(null), []);
});

// ── Per-session revoke ──────────────────────────────

test('revokeSession: ownership-checked, idempotent, surfaces via isSessionRevoked', async () => {
  kv._resetMemoryStore();
  await auth.recordSession({
    sid: '3333333333333333', email: 'rev@example.com',
    iat: Date.now(), exp: Date.now() + 60_000,
    ua: 'Chrome', ip: '0.0.0.0',
  });
  // Wrong owner → no revoke.
  const wrong = await auth.revokeSession('3333333333333333', 'someone-else@example.com');
  assert.equal(wrong, false);
  // Right owner → revoke.
  const ok = await auth.revokeSession('3333333333333333', 'rev@example.com');
  assert.equal(ok, true);
  assert.equal(await auth.isSessionRevoked('3333333333333333'), true);
  // Idempotent.
  const second = await auth.revokeSession('3333333333333333', 'rev@example.com');
  assert.equal(second, true);
});

test('revokeSession: unknown sid returns false', async () => {
  kv._resetMemoryStore();
  const r = await auth.revokeSession('deadbeefdeadbeef', 'whoever@example.com');
  assert.equal(r, false);
});

test('getCurrentUserStrict: rejects revoked sessions', async () => {
  kv._resetMemoryStore();
  // Build a session, persist it, revoke it.
  const sid = '4444444444444444';
  await auth.recordSession({
    sid, email: 'strict@example.com',
    iat: Date.now(), exp: Date.now() + 60_000,
    ua: 'Chrome', ip: '0.0.0.0',
  });
  const cookie = auth.buildSessionCookie('strict@example.com', { sid });
  const req = { headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) } };
  // Pre-revoke: ok.
  assert.ok(await auth.getCurrentUserStrict(req));
  // Revoke.
  await auth.revokeSession(sid, 'strict@example.com');
  // Post-revoke: null.
  assert.equal(await auth.getCurrentUserStrict(req), null);
});

test('getCurrentUserStrict: pre-sprint cookie (no sid) still works', async () => {
  kv._resetMemoryStore();
  const legacyCookie = auth.signPayload({
    email: 'legacy-strict@example.com',
    iat: Date.now(), exp: Date.now() + 60_000,
  });
  const req = { headers: { cookie: 'orcatrade_session=' + encodeURIComponent(legacyCookie) } };
  const user = await auth.getCurrentUserStrict(req);
  assert.ok(user);
  assert.equal(user.email, 'legacy-strict@example.com');
  assert.equal(user.sid, null);
});

// ── handleListSessions ──────────────────────────────

test('GET /api/auth/sessions: 401 without session', async () => {
  const req = { method: 'GET', headers: {} };
  const res = mockRes();
  await authHandler.handleListSessions(req, res);
  assert.equal(res.statusCode, 401);
});

test('GET /api/auth/sessions: 405 on POST', async () => {
  const req = reqWithCookie('POST', 'user@example.com');
  const res = mockRes();
  await authHandler.handleListSessions(req, res);
  assert.equal(res.statusCode, 405);
});

test('GET /api/auth/sessions: returns own sessions with isCurrent flag', async () => {
  kv._resetMemoryStore();
  const currentSid = '5555555555555555';
  const otherSid = '6666666666666666';
  await auth.recordSession({ sid: currentSid, email: 'me@example.com', iat: Date.now(), exp: Date.now() + 60_000, ua: 'Chrome' });
  await auth.recordSession({ sid: otherSid, email: 'me@example.com', iat: Date.now() - 1000, exp: Date.now() + 60_000, ua: 'Safari' });
  const req = reqWithCookie('GET', 'me@example.com', currentSid);
  const res = mockRes();
  await authHandler.handleListSessions(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.currentSid, currentSid);
  assert.equal(body.sessions.length, 2);
  const cur = body.sessions.find((s) => s.sid === currentSid);
  const oth = body.sessions.find((s) => s.sid === otherSid);
  assert.equal(cur.isCurrent, true);
  assert.equal(oth.isCurrent, false);
  // ip is NOT surfaced to the client.
  assert.equal(cur.ip, undefined);
});

test('GET /api/auth/sessions: pre-sprint cookie returns currentSid=null', async () => {
  kv._resetMemoryStore();
  const req = reqWithCookie('GET', 'legacy@example.com', null /* sentinel for legacy cookie */);
  const res = mockRes();
  await authHandler.handleListSessions(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.currentSid, null);
  assert.deepEqual(body.sessions, []);
});

// ── handleRevokeSession ─────────────────────────────

test('POST /api/auth/sessions/<sid>/revoke: 401 without session', async () => {
  const req = { method: 'POST', headers: {} };
  const res = mockRes();
  await authHandler.handleRevokeSession(req, res, '7777777777777777');
  assert.equal(res.statusCode, 401);
});

test('POST /api/auth/sessions/<sid>/revoke: 400 on malformed sid', async () => {
  const req = reqWithCookie('POST', 'me@example.com');
  const res = mockRes();
  await authHandler.handleRevokeSession(req, res, 'not-hex');
  assert.equal(res.statusCode, 400);
});

test('POST /api/auth/sessions/<sid>/revoke: 405 on GET', async () => {
  const req = reqWithCookie('GET', 'me@example.com');
  const res = mockRes();
  await authHandler.handleRevokeSession(req, res, '8888888888888888');
  assert.equal(res.statusCode, 405);
});

test('POST /api/auth/sessions/<sid>/revoke: 404 when sid is not theirs', async () => {
  kv._resetMemoryStore();
  // Plant a session under a different email.
  await auth.recordSession({ sid: '9999999999999999', email: 'other@example.com', iat: Date.now(), exp: Date.now() + 60_000, ua: 'x' });
  const req = reqWithCookie('POST', 'me@example.com');
  const res = mockRes();
  await authHandler.handleRevokeSession(req, res, '9999999999999999');
  assert.equal(res.statusCode, 404);
});

test('POST /api/auth/sessions/<sid>/revoke: owner success, audit emitted', async () => {
  kv._resetMemoryStore();
  const sid = 'aaaa1111bbbb2222';
  await auth.recordSession({ sid, email: 'audit@example.com', iat: Date.now(), exp: Date.now() + 60_000, ua: 'x' });
  // Sign in via a DIFFERENT current session so revoking the recorded
  // one doesn't try to clear our cookie.
  const req = reqWithCookie('POST', 'audit@example.com', 'cccc3333dddd4444');
  const res = mockRes();
  await authHandler.handleRevokeSession(req, res, sid);
  assert.equal(res.statusCode, 200);
  // Audit row written.
  const log = await events.list({ type: 'auth_session_revoked' });
  const row = log.find((e) => e.sid === sid);
  assert.ok(row);
  assert.equal(row.email, 'audit@example.com');
});

test('POST /api/auth/sessions/<sid>/revoke: revoking CURRENT session clears the cookie', async () => {
  kv._resetMemoryStore();
  const sid = 'ee01ee01ee01ee01';
  await auth.recordSession({ sid, email: 'self-revoke@example.com', iat: Date.now(), exp: Date.now() + 60_000, ua: 'x' });
  const req = reqWithCookie('POST', 'self-revoke@example.com', sid);
  const res = mockRes();
  await authHandler.handleRevokeSession(req, res, sid);
  assert.equal(res.statusCode, 200);
  // Cookie cleared in the response.
  assert.match(res.headers['set-cookie'], /Max-Age=0/);
});

// ── handleVerify writes the session metadata ────────

test('handleVerify: persists the same sid that the cookie carries', async () => {
  kv._resetMemoryStore();
  // Plant a magic token + email.
  const token = '0'.repeat(64);
  await kv.set(auth.magicKvKey(token), 'verify-test@example.com', { ttlSeconds: 900 });

  const req = {
    method: 'GET',
    url: '/api/auth/verify?token=' + token,
    headers: { 'x-forwarded-proto': 'https', 'user-agent': 'TestBrowser/1.0' },
    query: { token, path: ['auth', 'verify'] },
  };
  const res = mockRes();
  await authHandler.handleVerify(req, res);
  assert.equal(res.statusCode, 302);
  // Cookie issued.
  const setCookie = res.headers['set-cookie'];
  assert.ok(setCookie);
  // Parse the cookie value out of the Set-Cookie header.
  const match = setCookie.match(/^orcatrade_session=([^;]+)/);
  assert.ok(match);
  const decoded = decodeURIComponent(match[1]);
  const parsed = auth.verifyAndParseCookie(decoded);
  assert.ok(parsed);
  assert.match(parsed.sid, /^[a-f0-9]{16}$/);

  // Microtask drain so the fire-and-forget recordSession resolves.
  await new Promise((r) => setTimeout(r, 30));

  const list = await auth.listSessionsForEmail('verify-test@example.com');
  assert.equal(list.length, 1);
  assert.equal(list[0].sid, parsed.sid);
  assert.equal(list[0].ua, 'TestBrowser/1.0');
});

// ── Dispatcher routing ───────────────────────────────

test('dispatcher: /api/auth/sessions routes to handleListSessions', async () => {
  kv._resetMemoryStore();
  const cookie = auth.buildSessionCookie('disp@example.com');
  const req = {
    method: 'GET',
    url: '/api/auth/sessions',
    headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
    query: { path: ['auth', 'sessions'] },
  };
  const res = mockRes();
  await authHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.sessions));
});

test('dispatcher: /api/auth/sessions/<sid>/revoke routes to handleRevokeSession', async () => {
  kv._resetMemoryStore();
  const sid = '1010101010101010';
  await auth.recordSession({ sid, email: 'disp-rev@example.com', iat: Date.now(), exp: Date.now() + 60_000, ua: 'x' });
  const cookie = auth.buildSessionCookie('disp-rev@example.com', { sid: '2020202020202020' });
  const req = {
    method: 'POST',
    url: '/api/auth/sessions/' + sid + '/revoke',
    headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
    query: { path: ['auth', 'sessions', sid, 'revoke'] },
  };
  const res = mockRes();
  await authHandler(req, res);
  assert.equal(res.statusCode, 200);
});

test('dispatcher: /api/auth/sessions/<sid>/garbage returns 404', async () => {
  const cookie = auth.buildSessionCookie('disp@example.com');
  const req = {
    method: 'POST',
    url: '/api/auth/sessions/abcdef0123456789/nope',
    headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
    query: { path: ['auth', 'sessions', 'abcdef0123456789', 'nope'] },
  };
  const res = mockRes();
  await authHandler(req, res);
  assert.equal(res.statusCode, 404);
});

// ── events.ALLOWED_TYPES ─────────────────────────────

test('events.ALLOWED_TYPES contains auth_session_revoked', () => {
  assert.ok(events.ALLOWED_TYPES.has('auth_session_revoked'));
});

// ── /account/security/ markup contract ──────────────

test('/account/security/index.html: noindex + endpoint references + DOM hooks', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'security', 'index.html'), 'utf8');
  assert.match(html, /noindex/i);
  assert.match(html, /id=["']sessions["']/);
  assert.match(html, /id=["']empty["']/);
  assert.match(html, /id=["']authNeeded["']/);
  assert.match(html, /id=["']legacyBanner["']/);
});

test('/account/security/app.js: fetches /api/auth/sessions + has revoke wiring', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'security', 'app.js'), 'utf8');
  assert.match(js, /fetch\(['"]\/api\/auth\/sessions['"]/);
  assert.match(js, /\/api\/auth\/sessions\/.*\/revoke/);
  // Bounces to /account/ when revoking the current session.
  assert.match(js, /window\.location\.href\s*=\s*['"]\/account\/['"]/);
});

test('/account/index.html includes the Active sessions quick-link', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'index.html'), 'utf8');
  assert.match(html, /href=["']\/account\/security\/["']/);
  assert.match(html, /Active sessions/);
});
