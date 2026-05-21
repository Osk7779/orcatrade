// Sprint mfa-totp-v1 — TOTP two-factor: crypto vectors, enrollment,
// login enforcement, and backup-code recovery.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const totp = require('../lib/totp');
const auth = require('../lib/auth');
const kv = require('../lib/intelligence/kv-store');
const events = require('../lib/events');
const authHandler = require('../lib/handlers/auth');

function mockRes() {
  const res = {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    end(body) { this.body = body || ''; return this; },
  };
  res.headersSent = false; res.writableEnded = false;
  return res;
}
function parseJsonBody(res) { try { return JSON.parse(res.body); } catch (_) { return null; } }

// ── RFC 6238 vectors (the security-critical core) ───────

test('totp matches RFC 6238 test vectors (SHA1, 6-digit)', () => {
  const secretHex = Buffer.from('12345678901234567890', 'ascii').toString('hex');
  // The RFC publishes 8-digit values; our 6-digit output = last 6 digits.
  assert.equal(totp.totp(secretHex, { now: 59 * 1000 }), '287082');
  assert.equal(totp.totp(secretHex, { now: 1111111109 * 1000 }), '081804');
  assert.equal(totp.totp(secretHex, { now: 1111111111 * 1000 }), '050471');
  assert.equal(totp.totp(secretHex, { now: 1234567890 * 1000 }), '005924');
});

test('base32Encode known vector ("Hello" → JBSWY3DP)', () => {
  assert.equal(totp.base32Encode(Buffer.from('Hello')), 'JBSWY3DP');
});

test('verifyTotp accepts current code + tolerates ±1 step skew', () => {
  const secretHex = totp.generateSecretHex();
  const now = 1700000000 * 1000;
  const code = totp.totp(secretHex, { now });
  assert.equal(totp.verifyTotp(secretHex, code, { now }), true);
  // One step earlier / later still validates (clock skew + boundary typing)
  assert.equal(totp.verifyTotp(secretHex, code, { now: now + 30000 }), true);
  assert.equal(totp.verifyTotp(secretHex, code, { now: now - 30000 }), true);
  // Two steps away does not
  assert.equal(totp.verifyTotp(secretHex, code, { now: now + 90000 }), false);
});

test('verifyTotp rejects malformed codes', () => {
  const secretHex = totp.generateSecretHex();
  assert.equal(totp.verifyTotp(secretHex, '12345'), false);   // too short
  assert.equal(totp.verifyTotp(secretHex, 'abcdef'), false);  // non-numeric
  assert.equal(totp.verifyTotp(secretHex, ''), false);
});

test('otpauthUri carries base32 secret + SHA1/6/30 params', () => {
  const secretHex = totp.generateSecretHex();
  const uri = totp.otpauthUri({ secretHex, email: 'u@example.com' });
  assert.match(uri, /^otpauth:\/\/totp\/OrcaTrade:u%40example\.com\?/);
  assert.match(uri, /algorithm=SHA1/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
});

// ── ALLOWED_TYPES ───────────────────────────────────────

test('ALLOWED_TYPES includes MFA lifecycle events', () => {
  for (const t of ['auth_mfa_enabled', 'auth_mfa_disabled', 'auth_mfa_challenge_failed']) {
    assert.ok(events.ALLOWED_TYPES.has(t), 'missing ' + t);
  }
});

// ── Storage layer: enroll → enable → verify → disable ───

test('beginMfaEnrollment writes a not-yet-enabled record', async () => {
  kv._resetMemoryStore();
  const enr = await auth.beginMfaEnrollment('u@example.com');
  assert.ok(enr.secretB32 && enr.otpauthUri && enr.secretHex);
  assert.equal(await auth.isMfaEnabled('u@example.com'), false); // not enabled until confirmed
});

test('enableMfa requires a valid code, then enables + returns backup codes', async () => {
  kv._resetMemoryStore();
  const enr = await auth.beginMfaEnrollment('u@example.com');
  // Wrong code fails
  const bad = await auth.enableMfa('u@example.com', '000000');
  assert.equal(bad.ok, false);
  assert.equal(await auth.isMfaEnabled('u@example.com'), false);
  // Correct code enables
  const code = totp.totp(enr.secretHex);
  const ok = await auth.enableMfa('u@example.com', code);
  assert.equal(ok.ok, true);
  assert.equal(ok.backupCodes.length, auth.MFA_BACKUP_CODE_COUNT);
  assert.equal(await auth.isMfaEnabled('u@example.com'), true);
});

test('verifyMfaCode accepts a TOTP code', async () => {
  kv._resetMemoryStore();
  const enr = await auth.beginMfaEnrollment('u@example.com');
  await auth.enableMfa('u@example.com', totp.totp(enr.secretHex));
  const r = await auth.verifyMfaCode('u@example.com', totp.totp(enr.secretHex));
  assert.equal(r.ok, true);
  assert.equal(r.method, 'totp');
});

test('backup code works once then is consumed', async () => {
  kv._resetMemoryStore();
  const enr = await auth.beginMfaEnrollment('u@example.com');
  const enabled = await auth.enableMfa('u@example.com', totp.totp(enr.secretHex));
  const backup = enabled.backupCodes[0];
  const first = await auth.verifyMfaCode('u@example.com', backup);
  assert.equal(first.ok, true);
  assert.equal(first.method, 'backup');
  // Second use of the same backup code fails (single-use)
  const second = await auth.verifyMfaCode('u@example.com', backup);
  assert.equal(second.ok, false);
});

test('disableMfa removes the record', async () => {
  kv._resetMemoryStore();
  const enr = await auth.beginMfaEnrollment('u@example.com');
  await auth.enableMfa('u@example.com', totp.totp(enr.secretHex));
  await auth.disableMfa('u@example.com');
  assert.equal(await auth.isMfaEnabled('u@example.com'), false);
});

test('MFA challenge create → peek (non-consuming) → delete', async () => {
  kv._resetMemoryStore();
  const id = await auth.createMfaChallenge('u@example.com');
  assert.match(id, /^[a-f0-9]{32}$/);
  // Peek does NOT consume — a wrong code shouldn't void the challenge.
  assert.equal(await auth.peekMfaChallenge(id), 'u@example.com');
  assert.equal(await auth.peekMfaChallenge(id), 'u@example.com');
  await auth.deleteMfaChallenge(id);
  assert.equal(await auth.peekMfaChallenge(id), null);
});

// ── Endpoint: enrollment ────────────────────────────────

function cookieFor(email) {
  return 'orcatrade_session=' + encodeURIComponent(auth.buildSessionCookie(email));
}

test('handleMfaBegin: 401 unauthed, 200 + secret authed', async () => {
  kv._resetMemoryStore();
  const r401 = mockRes();
  await authHandler.handleMfaBegin({ method: 'POST', headers: {}, body: {} }, r401);
  assert.equal(r401.statusCode, 401);

  const r200 = mockRes();
  await authHandler.handleMfaBegin({ method: 'POST', headers: { cookie: cookieFor('u@example.com') }, body: {} }, r200);
  assert.equal(r200.statusCode, 200);
  const body = parseJsonBody(r200);
  assert.ok(body.secret && body.otpauthUri);
  // The raw hex secret must NOT be sent to the client.
  assert.ok(!/secretHex/.test(r200.body));
});

test('handleMfaBegin: 409 when MFA already enabled', async () => {
  kv._resetMemoryStore();
  const enr = await auth.beginMfaEnrollment('u@example.com');
  await auth.enableMfa('u@example.com', totp.totp(enr.secretHex));
  const res = mockRes();
  await authHandler.handleMfaBegin({ method: 'POST', headers: { cookie: cookieFor('u@example.com') }, body: {} }, res);
  assert.equal(res.statusCode, 409);
});

test('handleMfaEnable: 400 bad code, 200 + backup codes on valid', async () => {
  kv._resetMemoryStore();
  const enr = await auth.beginMfaEnrollment('u@example.com');
  const cookie = cookieFor('u@example.com');

  const bad = mockRes();
  await authHandler.handleMfaEnable({ method: 'POST', headers: { cookie }, body: { code: '000000' } }, bad);
  assert.equal(bad.statusCode, 400);

  const ok = mockRes();
  await authHandler.handleMfaEnable({ method: 'POST', headers: { cookie }, body: { code: totp.totp(enr.secretHex) } }, ok);
  assert.equal(ok.statusCode, 200);
  const body = parseJsonBody(ok);
  assert.equal(body.backupCodes.length, auth.MFA_BACKUP_CODE_COUNT);
  await new Promise((r) => setImmediate(r));
  const log = await kv.get('events:log');
  assert.ok((log || []).some((e) => e.type === 'auth_mfa_enabled'));
});

test('handleMfaDisable: 401 without a code, 200 with a valid code + audit', async () => {
  kv._resetMemoryStore();
  const enr = await auth.beginMfaEnrollment('u@example.com');
  await auth.enableMfa('u@example.com', totp.totp(enr.secretHex));
  const cookie = cookieFor('u@example.com');

  const noCode = mockRes();
  await authHandler.handleMfaDisable({ method: 'POST', headers: { cookie }, body: {} }, noCode);
  assert.equal(noCode.statusCode, 401);
  assert.equal(await auth.isMfaEnabled('u@example.com'), true); // still on

  const ok = mockRes();
  await authHandler.handleMfaDisable({ method: 'POST', headers: { cookie }, body: { code: totp.totp(enr.secretHex) } }, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(await auth.isMfaEnabled('u@example.com'), false);
  await new Promise((r) => setImmediate(r));
  const log = await kv.get('events:log');
  assert.ok((log || []).some((e) => e.type === 'auth_mfa_disabled'));
});

// ── Login enforcement ───────────────────────────────────

test('handleLogin: MFA-enabled account gets a challenge, NOT a session', async () => {
  kv._resetMemoryStore();
  await auth.setPassword('mfa@example.com', 'correctpassphrase1');
  const enr = await auth.beginMfaEnrollment('mfa@example.com');
  await auth.enableMfa('mfa@example.com', totp.totp(enr.secretHex));

  const res = mockRes();
  await authHandler.handleLogin({
    method: 'POST', headers: { 'x-forwarded-for': '1.1.1.1' },
    body: { email: 'mfa@example.com', password: 'correctpassphrase1' },
  }, res);
  assert.equal(res.statusCode, 200);
  const body = parseJsonBody(res);
  assert.equal(body.mfaRequired, true);
  assert.match(body.challengeId, /^[a-f0-9]{32}$/);
  // Crucially: NO session cookie was set by the first factor alone.
  assert.ok(!res.headers['set-cookie']);
});

test('handleLogin: non-MFA account still mints a session directly', async () => {
  kv._resetMemoryStore();
  await auth.setPassword('plain@example.com', 'correctpassphrase1');
  const res = mockRes();
  await authHandler.handleLogin({
    method: 'POST', headers: { 'x-forwarded-for': '2.2.2.2' },
    body: { email: 'plain@example.com', password: 'correctpassphrase1' },
  }, res);
  assert.equal(res.statusCode, 200);
  const body = parseJsonBody(res);
  assert.ok(!body.mfaRequired);
  assert.ok(res.headers['set-cookie']);
});

test('handleMfaVerify: completes the challenge with a TOTP code → session', async () => {
  kv._resetMemoryStore();
  const enr = await auth.beginMfaEnrollment('mfa@example.com');
  await auth.enableMfa('mfa@example.com', totp.totp(enr.secretHex));
  const challengeId = await auth.createMfaChallenge('mfa@example.com');

  const res = mockRes();
  await authHandler.handleMfaVerify({
    method: 'POST', headers: {},
    body: { challengeId, code: totp.totp(enr.secretHex), returnTo: '/pricing/?subscribe=growth-monthly' },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.headers['set-cookie']);
  const body = parseJsonBody(res);
  assert.equal(body.returnTo, '/pricing/?subscribe=growth-monthly');
  // Challenge is single-use — a replay fails.
  const replay = mockRes();
  await authHandler.handleMfaVerify({
    method: 'POST', headers: {},
    body: { challengeId, code: totp.totp(enr.secretHex) },
  }, replay);
  assert.equal(replay.statusCode, 400); // challenge gone
});

test('handleMfaVerify: wrong code → 401, challenge survives for retry', async () => {
  kv._resetMemoryStore();
  const enr = await auth.beginMfaEnrollment('mfa@example.com');
  await auth.enableMfa('mfa@example.com', totp.totp(enr.secretHex));
  const challengeId = await auth.createMfaChallenge('mfa@example.com');

  const wrong = mockRes();
  await authHandler.handleMfaVerify({ method: 'POST', headers: {}, body: { challengeId, code: '000000' } }, wrong);
  assert.equal(wrong.statusCode, 401);
  // The challenge is NOT consumed on a wrong code — retry with the right one works.
  const right = mockRes();
  await authHandler.handleMfaVerify({ method: 'POST', headers: {}, body: { challengeId, code: totp.totp(enr.secretHex) } }, right);
  assert.equal(right.statusCode, 200);
});

test('handleMfaVerify: rate-limited after 5 attempts → 429 + challenge burned', async () => {
  kv._resetMemoryStore();
  const enr = await auth.beginMfaEnrollment('mfa@example.com');
  await auth.enableMfa('mfa@example.com', totp.totp(enr.secretHex));
  const challengeId = await auth.createMfaChallenge('mfa@example.com');
  for (let i = 0; i < 5; i++) {
    const r = mockRes();
    await authHandler.handleMfaVerify({ method: 'POST', headers: {}, body: { challengeId, code: '000000' } }, r);
  }
  const limited = mockRes();
  await authHandler.handleMfaVerify({ method: 'POST', headers: {}, body: { challengeId, code: '000000' } }, limited);
  assert.equal(limited.statusCode, 429);
  // Even the right code now fails: the rate limiter still blocks (checked
  // first) AND the challenge was deleted on the 429. Either way, not 200.
  const after = mockRes();
  await authHandler.handleMfaVerify({ method: 'POST', headers: {}, body: { challengeId, code: totp.totp(enr.secretHex) } }, after);
  assert.notEqual(after.statusCode, 200);
});

test('handleVerify (magic-link): MFA account redirects to /account/?mfa=, no session', async () => {
  kv._resetMemoryStore();
  const enr = await auth.beginMfaEnrollment('magic-mfa@example.com');
  await auth.enableMfa('magic-mfa@example.com', totp.totp(enr.secretHex));
  const token = auth.generateMagicToken();
  await kv.set(auth.magicKvKey(token), 'magic-mfa@example.com', { ttlSeconds: 900 });

  const res = mockRes();
  await authHandler.handleVerify({ method: 'GET', headers: {}, query: { token } }, res);
  assert.equal(res.statusCode, 302);
  assert.match(res.headers['location'], /^\/account\/\?mfa=[a-f0-9]{32}/);
  // First factor alone does NOT set a session cookie.
  assert.ok(!res.headers['set-cookie']);
});

// ── /api/auth/me surfaces mfaEnabled ────────────────────

test('handleMe surfaces mfaEnabled', async () => {
  kv._resetMemoryStore();
  const cookie = cookieFor('me@example.com');
  const before = mockRes();
  await authHandler.handleMe({ method: 'GET', headers: { cookie } }, before);
  assert.equal(parseJsonBody(before).mfaEnabled, false);

  const enr = await auth.beginMfaEnrollment('me@example.com');
  await auth.enableMfa('me@example.com', totp.totp(enr.secretHex));
  const after = mockRes();
  await authHandler.handleMe({ method: 'GET', headers: { cookie } }, after);
  assert.equal(parseJsonBody(after).mfaEnabled, true);
});

// ── Dispatcher routing ──────────────────────────────────

test('dispatcher routes /api/auth/mfa/* sub-actions', async () => {
  const begin = mockRes();
  await authHandler({ method: 'POST', headers: {}, query: { path: 'auth/mfa/begin' }, body: {} }, begin);
  assert.equal(begin.statusCode, 401); // unauthed but route resolved

  const verify = mockRes();
  await authHandler({ method: 'POST', headers: {}, query: { path: 'auth/mfa/verify' }, body: {} }, verify);
  assert.equal(verify.statusCode, 400); // missing fields but route resolved

  const unknown = mockRes();
  await authHandler({ method: 'POST', headers: {}, query: { path: 'auth/mfa/nope' }, body: {} }, unknown);
  assert.equal(unknown.statusCode, 404);
});

// ── UI contracts ────────────────────────────────────────

test('/account/security/ has the MFA card + JS wiring', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'security', 'index.html'), 'utf8');
  assert.match(html, /id="mfaCard"/);
  assert.match(html, /id="mfaSecret"/);
  assert.match(html, /id="mfaBackupList"/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'security', 'app.js'), 'utf8');
  assert.match(js, /\/api\/auth\/mfa\/begin/);
  assert.match(js, /\/api\/auth\/mfa\/enable/);
  assert.match(js, /\/api\/auth\/mfa\/disable/);
  assert.match(js, /loadMfaCard/);
});

test('/account/ has the inline MFA challenge state + JS wiring', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'index.html'), 'utf8');
  assert.match(html, /id="state-mfa"/);
  assert.match(html, /id="mfa-code"/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'app.js'), 'utf8');
  assert.match(js, /\/api\/auth\/mfa\/verify/);
  assert.match(js, /mfaChallengeId/);
  assert.match(js, /mfaRequired/);
  // ?mfa= detection for the magic-link path
  assert.match(js, /params\.get\('mfa'\)/);
});
