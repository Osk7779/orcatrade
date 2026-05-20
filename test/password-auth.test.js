// Sprint password-auth-v1 — tests for password storage, login, change,
// reset, and signup-with-password flows.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const auth = require('../lib/auth');
const kv = require('../lib/intelligence/kv-store');
const events = require('../lib/events');
const authHandler = require('../lib/handlers/auth');

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

function parseJsonBody(res) {
  try { return JSON.parse(res.body); } catch (_) { return null; }
}

// ── validatePasswordStrength ─────────────────────────────

test('validatePasswordStrength: rejects non-strings', () => {
  assert.equal(auth.validatePasswordStrength(null).ok, false);
  assert.equal(auth.validatePasswordStrength(undefined).ok, false);
  assert.equal(auth.validatePasswordStrength(12345).ok, false);
});

test('validatePasswordStrength: rejects short passwords (<12)', () => {
  const r = auth.validatePasswordStrength('eleven-chrs');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'too-short');
});

test('validatePasswordStrength: accepts 12+ char passphrase', () => {
  assert.equal(auth.validatePasswordStrength('ships sail east in winter').ok, true);
});

test('validatePasswordStrength: rejects all-uniform password', () => {
  const r = auth.validatePasswordStrength('aaaaaaaaaaaa');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'too-uniform');
});

test('validatePasswordStrength: rejects long ascending sequence', () => {
  const r = auth.validatePasswordStrength('abcdefghijkl');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'sequential');
});

test('validatePasswordStrength: rejects >1024 chars', () => {
  const r = auth.validatePasswordStrength('a' + 'b'.repeat(1024));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'too-long');
});

// ── hashPasswordRecord / verifyPasswordRecord ───────────

test('hashPasswordRecord returns scrypt record with salt+hash hex', async () => {
  const record = await auth.hashPasswordRecord('correct horse battery staple');
  assert.equal(record.algo, 'scrypt');
  assert.match(record.salt, /^[a-f0-9]{64}$/);  // 32 bytes
  assert.match(record.hash, /^[a-f0-9]{128}$/); // 64 bytes
  assert.ok(record.createdAt);
  assert.ok(record.updatedAt);
});

test('verifyPasswordRecord matches correct password and rejects wrong', async () => {
  const record = await auth.hashPasswordRecord('correct horse battery staple');
  assert.equal(await auth.verifyPasswordRecord('correct horse battery staple', record), true);
  assert.equal(await auth.verifyPasswordRecord('wrong horse battery staple', record), false);
  assert.equal(await auth.verifyPasswordRecord('', record), false);
});

test('verifyPasswordRecord rejects malformed records', async () => {
  assert.equal(await auth.verifyPasswordRecord('whatever', null), false);
  assert.equal(await auth.verifyPasswordRecord('whatever', { algo: 'bcrypt' }), false);
  assert.equal(await auth.verifyPasswordRecord('whatever', { algo: 'scrypt', salt: 'not-hex', hash: 'also-not' }), false);
});

// ── setPassword / verifyPassword (KV-backed) ────────────

test('setPassword: rejects weak passwords', async () => {
  kv._resetMemoryStore();
  const r = await auth.setPassword('user@example.com', 'short');
  assert.equal(r.ok, false);
});

test('setPassword + verifyPassword round-trip', async () => {
  kv._resetMemoryStore();
  const set = await auth.setPassword('user@example.com', 'mypassphrase123');
  assert.equal(set.ok, true);
  const ok = await auth.verifyPassword('user@example.com', 'mypassphrase123');
  assert.equal(ok.ok, true);
  const bad = await auth.verifyPassword('user@example.com', 'wrongpassword12');
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'mismatch');
});

test('verifyPassword on no-record returns no-record reason', async () => {
  kv._resetMemoryStore();
  const r = await auth.verifyPassword('absent@example.com', 'anyvalue1234');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-record');
});

test('hasPassword toggles with setPassword + deletePasswordRecord', async () => {
  kv._resetMemoryStore();
  assert.equal(await auth.hasPassword('user@example.com'), false);
  await auth.setPassword('user@example.com', 'mypassphrase123');
  assert.equal(await auth.hasPassword('user@example.com'), true);
  await auth.deletePasswordRecord('user@example.com');
  assert.equal(await auth.hasPassword('user@example.com'), false);
});

test('setPassword preserves createdAt across rotations', async () => {
  kv._resetMemoryStore();
  await auth.setPassword('rotate@example.com', 'firstpassphrase1');
  const first = await auth.getPasswordRecord('rotate@example.com');
  // Tiny delay so updatedAt differs
  await new Promise((r) => setTimeout(r, 20));
  await auth.setPassword('rotate@example.com', 'secondpassphrase2');
  const second = await auth.getPasswordRecord('rotate@example.com');
  assert.equal(second.createdAt, first.createdAt);
  assert.notEqual(second.updatedAt, first.updatedAt);
  assert.notEqual(second.hash, first.hash);
});

test('email is normalised on password keys (case-insensitive)', async () => {
  kv._resetMemoryStore();
  await auth.setPassword('User@Example.Com', 'mypassphrase123');
  // Should be retrievable in any case
  assert.equal(await auth.hasPassword('user@example.com'), true);
  assert.equal(await auth.hasPassword('USER@EXAMPLE.COM'), true);
});

// ── Password reset tokens ──────────────────────────────

test('createPasswordResetToken + consumePasswordResetToken round-trip', async () => {
  kv._resetMemoryStore();
  const minted = await auth.createPasswordResetToken('reset@example.com');
  assert.ok(minted && minted.token);
  // Token shape: 32-hex.64-hex
  assert.match(minted.token, /^[a-f0-9]{32}\.[a-f0-9]{64}$/);
  const email = await auth.consumePasswordResetToken(minted.token);
  assert.equal(email, 'reset@example.com');
});

test('consumePasswordResetToken is single-use', async () => {
  kv._resetMemoryStore();
  const minted = await auth.createPasswordResetToken('reset@example.com');
  await auth.consumePasswordResetToken(minted.token);
  // Second consume MUST fail
  const second = await auth.consumePasswordResetToken(minted.token);
  assert.equal(second, null);
});

test('consumePasswordResetToken rejects forged signature', async () => {
  kv._resetMemoryStore();
  const minted = await auth.createPasswordResetToken('reset@example.com');
  const [jti] = minted.token.split('.');
  const forged = jti + '.' + 'a'.repeat(64);
  assert.equal(await auth.consumePasswordResetToken(forged), null);
});

test('parsePasswordResetToken rejects malformed shapes', () => {
  assert.equal(auth.parsePasswordResetToken(null), null);
  assert.equal(auth.parsePasswordResetToken(''), null);
  assert.equal(auth.parsePasswordResetToken('no-dot'), null);
  assert.equal(auth.parsePasswordResetToken('a.b.c'), null);
  assert.equal(auth.parsePasswordResetToken('short.short'), null);
});

// ── Pending signup tokens ───────────────────────────────

test('createPendingSignup + consumePendingSignup carry passwordRecord', async () => {
  kv._resetMemoryStore();
  const passwordRecord = await auth.hashPasswordRecord('signup-passphrase-123');
  const pending = await auth.createPendingSignup('newuser@example.com', passwordRecord);
  assert.ok(pending && pending.token);
  assert.match(pending.token, /^[a-f0-9]{64}$/);
  const consumed = await auth.consumePendingSignup(pending.token);
  assert.equal(consumed.email, 'newuser@example.com');
  assert.equal(consumed.passwordRecord.algo, 'scrypt');
});

test('consumePendingSignup is single-use', async () => {
  kv._resetMemoryStore();
  const pending = await auth.createPendingSignup('newuser@example.com', null);
  await auth.consumePendingSignup(pending.token);
  assert.equal(await auth.consumePendingSignup(pending.token), null);
});

// ── ALLOWED_TYPES inclusion ─────────────────────────────

test('ALLOWED_TYPES includes new password-auth event types', () => {
  const types = [
    'auth_password_set',
    'auth_password_changed',
    'auth_password_cleared',
    'auth_signin_password',
    'auth_signin_failed_password',
    'auth_password_reset_requested',
    'auth_password_reset_confirmed',
    'auth_signup_requested',
    'auth_signup_confirmed',
  ];
  for (const t of types) assert.ok(events.ALLOWED_TYPES.has(t), 'missing ALLOWED_TYPE: ' + t);
});

// ── /api/auth/login ─────────────────────────────────────

test('handleLogin: 405 on non-POST', async () => {
  const req = { method: 'GET', headers: {}, body: {} };
  const res = mockRes();
  await authHandler.handleLogin(req, res);
  assert.equal(res.statusCode, 405);
});

test('handleLogin: 400 on missing email or password', async () => {
  const r = mockRes();
  await authHandler.handleLogin({ method: 'POST', headers: {}, body: {} }, r);
  assert.equal(r.statusCode, 400);
});

test('handleLogin: 401 for unknown email (vague message — no email enumeration)', async () => {
  kv._resetMemoryStore();
  const res = mockRes();
  await authHandler.handleLogin({
    method: 'POST', headers: { 'x-forwarded-for': '1.1.1.1' },
    body: { email: 'absent@example.com', password: 'anyvalue1234' },
  }, res);
  assert.equal(res.statusCode, 401);
  const body = parseJsonBody(res);
  // The error message MUST be identical whether the email exists or
  // the password mismatched — otherwise an attacker can enumerate
  // accounts.
  assert.equal(body.error, 'Invalid email or password');
});

test('handleLogin: 401 for wrong password (same message as unknown email)', async () => {
  kv._resetMemoryStore();
  await auth.setPassword('login@example.com', 'correctpassphrase1');
  const res = mockRes();
  await authHandler.handleLogin({
    method: 'POST', headers: { 'x-forwarded-for': '2.2.2.2' },
    body: { email: 'login@example.com', password: 'wrongpassword1234' },
  }, res);
  assert.equal(res.statusCode, 401);
  const body = parseJsonBody(res);
  assert.equal(body.error, 'Invalid email or password');
});

test('handleLogin: 200 on correct credentials + Set-Cookie + audit row', async () => {
  kv._resetMemoryStore();
  await auth.setPassword('login@example.com', 'correctpassphrase1');
  const res = mockRes();
  await authHandler.handleLogin({
    method: 'POST', headers: { 'x-forwarded-for': '3.3.3.3' },
    body: { email: 'login@example.com', password: 'correctpassphrase1' },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.headers['set-cookie']);
  assert.match(res.headers['set-cookie'], /orcatrade_session=/);
  // Audit row must be auth_signin_password
  await new Promise((r) => setImmediate(r));
  const log = await kv.get('events:log');
  const row = (log || []).find((e) => e.type === 'auth_signin_password');
  assert.ok(row, 'expected auth_signin_password audit row');
  assert.equal(row.email, 'login@example.com');
});

test('handleLogin: 429 after rate-limit hit', async () => {
  kv._resetMemoryStore();
  const ip = '4.4.4.4';
  // Burn the bucket
  for (let i = 0; i < 11; i++) {
    const res = mockRes();
    await authHandler.handleLogin({
      method: 'POST', headers: { 'x-forwarded-for': ip },
      body: { email: 'rate@example.com', password: 'whatever-not-matching' },
    }, res);
  }
  const finalRes = mockRes();
  await authHandler.handleLogin({
    method: 'POST', headers: { 'x-forwarded-for': ip },
    body: { email: 'rate@example.com', password: 'whatever-not-matching' },
  }, finalRes);
  assert.equal(finalRes.statusCode, 429);
});

// ── /api/auth/password/set ──────────────────────────────

test('handlePasswordSet: 401 when not signed in', async () => {
  kv._resetMemoryStore();
  const res = mockRes();
  await authHandler.handlePasswordSet({ method: 'POST', headers: {}, body: { newPassword: 'mypassphrase123' } }, res);
  assert.equal(res.statusCode, 401);
});

test('handlePasswordSet: 400 on weak new password', async () => {
  kv._resetMemoryStore();
  const cookie = auth.buildSessionCookie('user@example.com');
  const res = mockRes();
  await authHandler.handlePasswordSet({
    method: 'POST',
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
    body: { newPassword: 'short' },
  }, res);
  assert.equal(res.statusCode, 400);
});

test('handlePasswordSet: 200 sets password + audit_password_set fires', async () => {
  kv._resetMemoryStore();
  const cookie = auth.buildSessionCookie('first@example.com');
  const res = mockRes();
  await authHandler.handlePasswordSet({
    method: 'POST',
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
    body: { newPassword: 'firstpassphrase12' },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(await auth.hasPassword('first@example.com'), true);
  await new Promise((r) => setImmediate(r));
  const log = await kv.get('events:log');
  const row = (log || []).find((e) => e.type === 'auth_password_set');
  assert.ok(row, 'auth_password_set expected');
});

test('handlePasswordSet: 400 when changing without currentPassword', async () => {
  kv._resetMemoryStore();
  await auth.setPassword('rotate@example.com', 'oldpassphrase123');
  const cookie = auth.buildSessionCookie('rotate@example.com');
  const res = mockRes();
  await authHandler.handlePasswordSet({
    method: 'POST',
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
    body: { newPassword: 'newpassphrase1234' },
  }, res);
  assert.equal(res.statusCode, 400);
});

test('handlePasswordSet: 401 when currentPassword is wrong', async () => {
  kv._resetMemoryStore();
  await auth.setPassword('rotate@example.com', 'oldpassphrase123');
  const cookie = auth.buildSessionCookie('rotate@example.com');
  const res = mockRes();
  await authHandler.handlePasswordSet({
    method: 'POST',
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
    body: { newPassword: 'newpassphrase1234', currentPassword: 'wrongoldpassphrase' },
  }, res);
  assert.equal(res.statusCode, 401);
});

test('handlePasswordSet: 200 rotates + auth_password_changed audit fires', async () => {
  kv._resetMemoryStore();
  await auth.setPassword('rotate@example.com', 'oldpassphrase123');
  const cookie = auth.buildSessionCookie('rotate@example.com');
  const res = mockRes();
  await authHandler.handlePasswordSet({
    method: 'POST',
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
    body: { newPassword: 'newpassphrase1234', currentPassword: 'oldpassphrase123' },
  }, res);
  assert.equal(res.statusCode, 200);
  // Old must no longer verify; new must
  assert.equal((await auth.verifyPassword('rotate@example.com', 'oldpassphrase123')).ok, false);
  assert.equal((await auth.verifyPassword('rotate@example.com', 'newpassphrase1234')).ok, true);
  await new Promise((r) => setImmediate(r));
  const log = await kv.get('events:log');
  const row = (log || []).find((e) => e.type === 'auth_password_changed');
  assert.ok(row, 'auth_password_changed expected');
});

// ── /api/auth/password/clear ────────────────────────────

test('handlePasswordClear: 200 when no password (no-op)', async () => {
  kv._resetMemoryStore();
  const cookie = auth.buildSessionCookie('none@example.com');
  const res = mockRes();
  await authHandler.handlePasswordClear({
    method: 'POST',
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
    body: {},
  }, res);
  assert.equal(res.statusCode, 200);
  const body = parseJsonBody(res);
  assert.equal(body.hasPassword, false);
});

test('handlePasswordClear: 401 on wrong current password', async () => {
  kv._resetMemoryStore();
  await auth.setPassword('clear@example.com', 'somepassphrase123');
  const cookie = auth.buildSessionCookie('clear@example.com');
  const res = mockRes();
  await authHandler.handlePasswordClear({
    method: 'POST',
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
    body: { currentPassword: 'wrongpassphrase12' },
  }, res);
  assert.equal(res.statusCode, 401);
});

test('handlePasswordClear: 200 deletes password + audit row', async () => {
  kv._resetMemoryStore();
  await auth.setPassword('clear@example.com', 'somepassphrase123');
  const cookie = auth.buildSessionCookie('clear@example.com');
  const res = mockRes();
  await authHandler.handlePasswordClear({
    method: 'POST',
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
    body: { currentPassword: 'somepassphrase123' },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(await auth.hasPassword('clear@example.com'), false);
  await new Promise((r) => setImmediate(r));
  const log = await kv.get('events:log');
  const row = (log || []).find((e) => e.type === 'auth_password_cleared');
  assert.ok(row, 'auth_password_cleared expected');
});

// ── /api/auth/password/reset/request ────────────────────

test('handlePasswordResetRequest: 202 universal (does not leak existence)', async () => {
  kv._resetMemoryStore();
  const res1 = mockRes();
  await authHandler.handlePasswordResetRequest({
    method: 'POST', headers: { 'x-forwarded-for': '5.5.5.5' },
    body: { email: 'no-account@example.com' },
  }, res1);
  assert.equal(res1.statusCode, 202);
  // No reset KV record minted for unknown account
  const keysAfterUnknown = await kv.listKeys('pwreset:');
  assert.equal(keysAfterUnknown.length, 0);

  // With an account that has a password, a token IS minted (still 202)
  await auth.setPassword('real@example.com', 'realpassphrase123');
  const res2 = mockRes();
  await authHandler.handlePasswordResetRequest({
    method: 'POST', headers: { 'x-forwarded-for': '5.5.5.5' },
    body: { email: 'real@example.com' },
  }, res2);
  assert.equal(res2.statusCode, 202);
  const keysAfterReal = await kv.listKeys('pwreset:');
  assert.equal(keysAfterReal.length, 1);
});

test('handlePasswordResetRequest: 400 on invalid email', async () => {
  const res = mockRes();
  await authHandler.handlePasswordResetRequest({
    method: 'POST', headers: { 'x-forwarded-for': '6.6.6.6' },
    body: { email: 'not-an-email' },
  }, res);
  assert.equal(res.statusCode, 400);
});

// ── /api/auth/password/reset/confirm ────────────────────

test('handlePasswordResetConfirm: 400 on missing token', async () => {
  const res = mockRes();
  await authHandler.handlePasswordResetConfirm({
    method: 'POST', headers: {}, body: { newPassword: 'newpassphrase1234' },
  }, res);
  assert.equal(res.statusCode, 400);
});

test('handlePasswordResetConfirm: 400 on weak new password', async () => {
  kv._resetMemoryStore();
  await auth.setPassword('confirm@example.com', 'oldpassphrase123');
  const minted = await auth.createPasswordResetToken('confirm@example.com');
  const res = mockRes();
  await authHandler.handlePasswordResetConfirm({
    method: 'POST', headers: {}, body: { token: minted.token, newPassword: 'short' },
  }, res);
  assert.equal(res.statusCode, 400);
});

test('handlePasswordResetConfirm: 400 on invalid/expired token', async () => {
  kv._resetMemoryStore();
  const res = mockRes();
  await authHandler.handlePasswordResetConfirm({
    method: 'POST', headers: {},
    body: { token: 'a'.repeat(32) + '.' + 'b'.repeat(64), newPassword: 'newpassphrase1234' },
  }, res);
  assert.equal(res.statusCode, 400);
});

test('handlePasswordResetConfirm: 200 happy path, sets cookie + revokes other sessions + audit', async () => {
  kv._resetMemoryStore();
  await auth.setPassword('confirm@example.com', 'oldpassphrase123');
  const minted = await auth.createPasswordResetToken('confirm@example.com');
  const res = mockRes();
  await authHandler.handlePasswordResetConfirm({
    method: 'POST', headers: {},
    body: { token: minted.token, newPassword: 'newresetpassphrase1' },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.headers['set-cookie']);
  // New password works
  assert.equal((await auth.verifyPassword('confirm@example.com', 'newresetpassphrase1')).ok, true);
  // Other sessions revoked (min-iat set)
  const minIat = await auth.getMinIat('confirm@example.com');
  assert.ok(minIat > 0);
  // Audit rows present
  await new Promise((r) => setImmediate(r));
  const log = await kv.get('events:log');
  const ok = (log || []).find((e) => e.type === 'auth_password_reset_confirmed');
  assert.ok(ok, 'auth_password_reset_confirmed expected');
});

test('handlePasswordResetConfirm: token cannot be re-used', async () => {
  kv._resetMemoryStore();
  await auth.setPassword('replay@example.com', 'oldpassphrase123');
  const minted = await auth.createPasswordResetToken('replay@example.com');
  // First consume succeeds
  await authHandler.handlePasswordResetConfirm({
    method: 'POST', headers: {},
    body: { token: minted.token, newPassword: 'newresetpassphrase1' },
  }, mockRes());
  // Replay must fail
  const res = mockRes();
  await authHandler.handlePasswordResetConfirm({
    method: 'POST', headers: {},
    body: { token: minted.token, newPassword: 'yetanotherpassphrase' },
  }, res);
  assert.equal(res.statusCode, 400);
});

// ── /api/auth/signup ────────────────────────────────────

test('handleSignup: 400 on invalid email', async () => {
  const res = mockRes();
  await authHandler.handleSignup({
    method: 'POST', headers: { 'x-forwarded-for': '7.7.7.7' },
    body: { email: 'not-an-email' },
  }, res);
  assert.equal(res.statusCode, 400);
});

test('handleSignup email-only: 202 + magic-link token in KV', async () => {
  kv._resetMemoryStore();
  const res = mockRes();
  await authHandler.handleSignup({
    method: 'POST', headers: { 'x-forwarded-for': '8.8.8.8' },
    body: { email: 'magic@example.com' },
  }, res);
  assert.equal(res.statusCode, 202);
  const body = parseJsonBody(res);
  assert.equal(body.withPassword, false);
  const keys = await kv.listKeys('auth:magic:');
  assert.equal(keys.length, 1);
});

test('handleSignup with password: 202 + pending-signup record (no password yet)', async () => {
  kv._resetMemoryStore();
  const res = mockRes();
  await authHandler.handleSignup({
    method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' },
    body: { email: 'pwsignup@example.com', password: 'signupthepassphrase' },
  }, res);
  assert.equal(res.statusCode, 202);
  const body = parseJsonBody(res);
  assert.equal(body.withPassword, true);
  // Password NOT yet in real `password:` slot — only in pending record.
  assert.equal(await auth.hasPassword('pwsignup@example.com'), false);
  const keys = await kv.listKeys('signup:');
  assert.equal(keys.length, 1);
});

test('handleSignup with weak password: 400', async () => {
  kv._resetMemoryStore();
  const res = mockRes();
  await authHandler.handleSignup({
    method: 'POST', headers: { 'x-forwarded-for': '10.10.10.10' },
    body: { email: 'weak@example.com', password: 'short' },
  }, res);
  assert.equal(res.statusCode, 400);
});

// ── /api/auth/signup/confirm ───────────────────────────

test('handleSignupConfirm: 400 on missing token', async () => {
  const res = mockRes();
  await authHandler.handleSignupConfirm({ method: 'GET', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 400);
});

test('handleSignupConfirm: 400 on unknown token', async () => {
  kv._resetMemoryStore();
  const res = mockRes();
  await authHandler.handleSignupConfirm({
    method: 'GET', headers: {}, query: { token: 'a'.repeat(64) },
  }, res);
  assert.equal(res.statusCode, 400);
});

test('handleSignupConfirm: 302 with cookie + password landed in real slot', async () => {
  kv._resetMemoryStore();
  const passwordRecord = await auth.hashPasswordRecord('confirmedpassphrase1');
  const pending = await auth.createPendingSignup('confirm-signup@example.com', passwordRecord);
  const res = mockRes();
  await authHandler.handleSignupConfirm({
    method: 'GET', headers: {}, query: { token: pending.token },
  }, res);
  assert.equal(res.statusCode, 302);
  assert.match(res.headers['location'], /\/account\//);
  assert.ok(res.headers['set-cookie']);
  // Password now in real slot
  assert.equal(await auth.hasPassword('confirm-signup@example.com'), true);
  // And verifies
  const ok = await auth.verifyPassword('confirm-signup@example.com', 'confirmedpassphrase1');
  assert.equal(ok.ok, true);
});

// ── /api/auth/me surfaces hasPassword ───────────────────

test('handleMe: surfaces hasPassword=false when no password set', async () => {
  kv._resetMemoryStore();
  const cookie = auth.buildSessionCookie('nopw@example.com');
  const res = mockRes();
  await authHandler.handleMe({
    method: 'GET',
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
  }, res);
  assert.equal(res.statusCode, 200);
  const body = parseJsonBody(res);
  assert.equal(body.hasPassword, false);
});

test('handleMe: surfaces hasPassword=true after setPassword', async () => {
  kv._resetMemoryStore();
  await auth.setPassword('haspw@example.com', 'hispassphrase123');
  const cookie = auth.buildSessionCookie('haspw@example.com');
  const res = mockRes();
  await authHandler.handleMe({
    method: 'GET',
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
  }, res);
  assert.equal(res.statusCode, 200);
  const body = parseJsonBody(res);
  assert.equal(body.hasPassword, true);
});

// ── Dispatcher routing ──────────────────────────────────

test('dispatcher: routes /api/auth/login', async () => {
  const req = { method: 'POST', headers: {}, query: { path: 'auth/login' }, body: { email: 'x@y.com', password: '' } };
  const res = mockRes();
  await authHandler(req, res);
  assert.equal(res.statusCode, 400); // body validation hits first; the route DID resolve
});

test('dispatcher: routes /api/auth/password/set', async () => {
  const req = { method: 'POST', headers: {}, query: { path: 'auth/password/set' }, body: { newPassword: 'short' } };
  const res = mockRes();
  await authHandler(req, res);
  // Not signed in → 401 (proves the route resolved to handlePasswordSet)
  assert.equal(res.statusCode, 401);
});

test('dispatcher: routes /api/auth/password/reset/request', async () => {
  const req = { method: 'POST', headers: { 'x-forwarded-for': '11.11.11.11' }, query: { path: 'auth/password/reset/request' }, body: { email: 'rt@example.com' } };
  const res = mockRes();
  await authHandler(req, res);
  assert.equal(res.statusCode, 202);
});

test('dispatcher: routes /api/auth/password/reset/confirm', async () => {
  const req = { method: 'POST', headers: {}, query: { path: 'auth/password/reset/confirm' }, body: { token: '', newPassword: 'short' } };
  const res = mockRes();
  await authHandler(req, res);
  // Missing token → 400 (proves the route resolved)
  assert.equal(res.statusCode, 400);
});

test('dispatcher: routes /api/auth/signup + /api/auth/signup/confirm', async () => {
  const req1 = { method: 'POST', headers: { 'x-forwarded-for': '12.12.12.12' }, query: { path: 'auth/signup' }, body: { email: 'd@example.com' } };
  const res1 = mockRes();
  await authHandler(req1, res1);
  assert.equal(res1.statusCode, 202);

  const req2 = { method: 'GET', headers: {}, query: { path: 'auth/signup/confirm', token: 'a'.repeat(64) } };
  const res2 = mockRes();
  await authHandler(req2, res2);
  assert.equal(res2.statusCode, 400); // unknown token, but route resolved
});

test('dispatcher: unknown /api/auth/password sub-action → 404', async () => {
  const req = { method: 'POST', headers: {}, query: { path: 'auth/password/nope' }, body: {} };
  const res = mockRes();
  await authHandler(req, res);
  assert.equal(res.statusCode, 404);
});

// ── /signup/ + /account/reset/ markup contracts ─────────

test('/signup/ markup: page exists with email + password fields + toggle', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'signup', 'index.html'), 'utf8');
  assert.match(html, /id="email"/);
  assert.match(html, /id="password"/);
  assert.match(html, /id="toggle-mode-btn"/);
  assert.match(html, /\/signup\/app\.js/);
  // Cross-link back to /account/ for users who already have an account
  assert.match(html, /\/account\//);
});

test('/signup/app.js: POSTs to /api/auth/signup with locale-correct body', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'signup', 'app.js'), 'utf8');
  assert.match(js, /\/api\/auth\/signup/);
  assert.match(js, /passwordMode/);
});

test('/account/reset/ markup: page reads ?token= and POSTs to confirm', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'reset', 'index.html'), 'utf8');
  assert.match(html, /id="newPassword"/);
  assert.match(html, /id="state-form"/);
  assert.match(html, /id="state-no-token"/);
  assert.match(html, /id="state-done"/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'reset', 'app.js'), 'utf8');
  assert.match(js, /\/api\/auth\/password\/reset\/confirm/);
  assert.match(js, /URLSearchParams|searchParams\.get\('token'\)|params\.get\('token'\)/);
});

test('/account/security/ markup: password card + form wired', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'security', 'index.html'), 'utf8');
  assert.match(html, /id="passwordCard"/);
  assert.match(html, /id="newPassword"/);
  assert.match(html, /id="pwForm"/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'security', 'app.js'), 'utf8');
  assert.match(js, /\/api\/auth\/password\/set/);
  assert.match(js, /\/api\/auth\/password\/clear/);
  assert.match(js, /loadPasswordCard/);
});

test('/account/ markup: password-mode toggle + forgot-password link present', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'index.html'), 'utf8');
  assert.match(html, /id="toggle-mode-btn"/);
  assert.match(html, /id="forgot-password-link"/);
  assert.match(html, /id="password-field"/);
  assert.match(html, /\/signup\//);
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'app.js'), 'utf8');
  assert.match(js, /\/api\/auth\/login/);
  assert.match(js, /\/api\/auth\/password\/reset\/request/);
  assert.match(js, /passwordMode/);
});
