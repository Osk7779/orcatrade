// Sprint returnto-resume-v1 — anonymous Subscribe → signup → resume.
//
// Closes the conversion leak where clicking Subscribe on /pricing/ as
// an anonymous visitor 401s and dead-ends. Now the click sends the
// visitor to /signup/?return=/pricing/?subscribe=<tier>-<cycle>, every
// auth path honours that returnTo, and /pricing/ on signed-in return
// auto-fires the original checkout intent.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const auth = require('../lib/auth');
const kv = require('../lib/intelligence/kv-store');
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

// ── isSafeReturnTo: open-redirect defence ────────────────

test('isSafeReturnTo: accepts same-site relative paths', () => {
  assert.equal(auth.isSafeReturnTo('/pricing/'), '/pricing/');
  assert.equal(auth.isSafeReturnTo('/pricing/?subscribe=growth-monthly'), '/pricing/?subscribe=growth-monthly');
  assert.equal(auth.isSafeReturnTo('/account/billing/'), '/account/billing/');
});

test('isSafeReturnTo: rejects absolute URLs', () => {
  assert.equal(auth.isSafeReturnTo('https://evil.com/'), null);
  assert.equal(auth.isSafeReturnTo('http://orcatrade.pl/account/'), null);
});

test('isSafeReturnTo: rejects protocol-relative URLs', () => {
  // //evil.com is a classic open-redirect bypass
  assert.equal(auth.isSafeReturnTo('//evil.com/'), null);
});

test('isSafeReturnTo: rejects backslash bypasses', () => {
  // Some browsers normalise \\evil.com to //evil.com
  assert.equal(auth.isSafeReturnTo('/\\evil.com'), null);
  assert.equal(auth.isSafeReturnTo('\\\\evil.com'), null);
});

test('isSafeReturnTo: rejects javascript: / data: / mailto:', () => {
  assert.equal(auth.isSafeReturnTo('javascript:alert(1)'), null);
  assert.equal(auth.isSafeReturnTo('data:text/html,foo'), null);
  assert.equal(auth.isSafeReturnTo('mailto:a@b.com'), null);
  assert.equal(auth.isSafeReturnTo('/javascript:alert(1)'), null);
});

test('isSafeReturnTo: rejects empty + non-string + over-long', () => {
  assert.equal(auth.isSafeReturnTo(''), null);
  assert.equal(auth.isSafeReturnTo(null), null);
  assert.equal(auth.isSafeReturnTo(undefined), null);
  assert.equal(auth.isSafeReturnTo(12345), null);
  assert.equal(auth.isSafeReturnTo('/' + 'a'.repeat(600)), null);
});

test('isSafeReturnTo: rejects bare paths without leading slash', () => {
  assert.equal(auth.isSafeReturnTo('pricing/'), null);
  assert.equal(auth.isSafeReturnTo('https'), null);
});

// ── Magic-link request + verify carry returnTo ──────────

test('handleRequest: stores returnTo alongside email when safe', async () => {
  kv._resetMemoryStore();
  const res = mockRes();
  await authHandler.handleRequest({
    method: 'POST', headers: { 'x-forwarded-for': '1.1.1.1' },
    body: { email: 'rt-flow@example.com', returnTo: '/pricing/?subscribe=growth-monthly' },
  }, res);
  assert.equal(res.statusCode, 202);
  const keys = await kv.listKeys('auth:magic:');
  assert.equal(keys.length, 1);
  const record = await kv.get(keys[0]);
  // New shape: { email, returnTo }
  assert.equal(record.email, 'rt-flow@example.com');
  assert.equal(record.returnTo, '/pricing/?subscribe=growth-monthly');
});

test('handleRequest: unsafe returnTo is dropped, KV stays legacy-string-clean', async () => {
  kv._resetMemoryStore();
  const res = mockRes();
  await authHandler.handleRequest({
    method: 'POST', headers: { 'x-forwarded-for': '2.2.2.2' },
    body: { email: 'rt-flow@example.com', returnTo: 'https://evil.com/' },
  }, res);
  assert.equal(res.statusCode, 202);
  const keys = await kv.listKeys('auth:magic:');
  const record = await kv.get(keys[0]);
  // No returnTo → store as plain-string (legacy shape) so handleVerify
  // doesn't even see a tainted value.
  assert.equal(typeof record, 'string');
  assert.equal(record, 'rt-flow@example.com');
});

test('handleVerify: 302 to returnTo when present', async () => {
  kv._resetMemoryStore();
  const token = auth.generateMagicToken();
  await kv.set(auth.magicKvKey(token), {
    email: 'rt@example.com',
    returnTo: '/pricing/?subscribe=growth-monthly',
  }, { ttlSeconds: 900 });
  const res = mockRes();
  await authHandler.handleVerify({ method: 'GET', headers: {}, query: { token } }, res);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers['location'], '/pricing/?subscribe=growth-monthly');
});

test('handleVerify: legacy plain-string KV record still works (no returnTo)', async () => {
  kv._resetMemoryStore();
  const token = auth.generateMagicToken();
  await kv.set(auth.magicKvKey(token), 'legacy@example.com', { ttlSeconds: 900 });
  const res = mockRes();
  await authHandler.handleVerify({ method: 'GET', headers: {}, query: { token } }, res);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers['location'], '/account/');
});

test('handleVerify: tainted returnTo on KV record is ignored (defence in depth)', async () => {
  kv._resetMemoryStore();
  const token = auth.generateMagicToken();
  // Pretend an attacker compromised KV and wrote a malicious returnTo.
  // The handler MUST re-validate on read.
  await kv.set(auth.magicKvKey(token), {
    email: 'rt@example.com',
    returnTo: 'https://evil.com/',
  }, { ttlSeconds: 900 });
  const res = mockRes();
  await authHandler.handleVerify({ method: 'GET', headers: {}, query: { token } }, res);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers['location'], '/account/');
});

// ── Signup carries returnTo through to confirm ──────────

test('handleSignup → handleSignupConfirm: returnTo round-trips', async () => {
  kv._resetMemoryStore();
  // email+password path
  const req = {
    method: 'POST', headers: { 'x-forwarded-for': '3.3.3.3' },
    body: {
      email: 'pw-rt@example.com',
      password: 'signuppassphrase12',
      returnTo: '/pricing/?subscribe=starter-annual',
    },
  };
  const res = mockRes();
  await authHandler.handleSignup(req, res);
  assert.equal(res.statusCode, 202);

  // Find the pending record + token
  const keys = await kv.listKeys('signup:');
  assert.equal(keys.length, 1);
  const token = keys[0].replace(/^signup:/, '');
  const pending = await kv.get(keys[0]);
  assert.equal(pending.returnTo, '/pricing/?subscribe=starter-annual');

  // Confirm
  const confirmRes = mockRes();
  await authHandler.handleSignupConfirm({
    method: 'GET', headers: {}, query: { token },
  }, confirmRes);
  assert.equal(confirmRes.statusCode, 302);
  assert.equal(confirmRes.headers['location'], '/pricing/?subscribe=starter-annual');
});

test('handleSignup email-only with returnTo: magic-link record carries it', async () => {
  kv._resetMemoryStore();
  const res = mockRes();
  await authHandler.handleSignup({
    method: 'POST', headers: { 'x-forwarded-for': '4.4.4.4' },
    body: { email: 'magic-rt@example.com', returnTo: '/account/billing/' },
  }, res);
  assert.equal(res.statusCode, 202);
  const keys = await kv.listKeys('auth:magic:');
  assert.equal(keys.length, 1);
  const record = await kv.get(keys[0]);
  assert.equal(record.email, 'magic-rt@example.com');
  assert.equal(record.returnTo, '/account/billing/');
});

test('handleSignupConfirm: tainted stored returnTo is re-validated on read', async () => {
  kv._resetMemoryStore();
  // Directly stage a pending record with an unsafe returnTo.
  const token = 'a'.repeat(64);
  await kv.set(`signup:${token}`, {
    email: 'tainted@example.com',
    passwordRecord: null,
    returnTo: '//evil.com/',
  }, { ttlSeconds: 3600 });
  const res = mockRes();
  await authHandler.handleSignupConfirm({
    method: 'GET', headers: {}, query: { token },
  }, res);
  assert.equal(res.statusCode, 302);
  // Falls back to /account/?welcome=1, NOT the unsafe URL.
  assert.match(res.headers['location'], /^\/account\/\?welcome=1/);
});

// ── Password login echoes safe returnTo ─────────────────

test('handleLogin: echoes returnTo when safe', async () => {
  kv._resetMemoryStore();
  await auth.setPassword('login-rt@example.com', 'loginpassphrase12');
  const res = mockRes();
  await authHandler.handleLogin({
    method: 'POST', headers: { 'x-forwarded-for': '5.5.5.5' },
    body: {
      email: 'login-rt@example.com',
      password: 'loginpassphrase12',
      returnTo: '/pricing/?subscribe=growth-monthly',
    },
  }, res);
  assert.equal(res.statusCode, 200);
  const body = parseJsonBody(res);
  assert.equal(body.returnTo, '/pricing/?subscribe=growth-monthly');
});

test('handleLogin: drops unsafe returnTo (responds with null)', async () => {
  kv._resetMemoryStore();
  await auth.setPassword('login-rt@example.com', 'loginpassphrase12');
  const res = mockRes();
  await authHandler.handleLogin({
    method: 'POST', headers: { 'x-forwarded-for': '6.6.6.6' },
    body: {
      email: 'login-rt@example.com',
      password: 'loginpassphrase12',
      returnTo: 'https://evil.com/',
    },
  }, res);
  assert.equal(res.statusCode, 200);
  const body = parseJsonBody(res);
  assert.equal(body.returnTo, null);
});

// ── Password reset confirm echoes safe returnTo ─────────

test('handlePasswordResetConfirm: echoes returnTo when safe', async () => {
  kv._resetMemoryStore();
  await auth.setPassword('reset-rt@example.com', 'oldpassphrase123');
  const minted = await auth.createPasswordResetToken('reset-rt@example.com');
  const res = mockRes();
  await authHandler.handlePasswordResetConfirm({
    method: 'POST', headers: {},
    body: {
      token: minted.token,
      newPassword: 'newresetpassphrase1',
      returnTo: '/pricing/?subscribe=scale-annual',
    },
  }, res);
  assert.equal(res.statusCode, 200);
  const body = parseJsonBody(res);
  assert.equal(body.returnTo, '/pricing/?subscribe=scale-annual');
});

// ── createPendingSignup persists returnTo when safe ─────

test('createPendingSignup: stores safe returnTo', async () => {
  kv._resetMemoryStore();
  const pending = await auth.createPendingSignup('store@example.com', null, {
    returnTo: '/pricing/?subscribe=growth-monthly',
  });
  const rec = await kv.get(`signup:${pending.token}`);
  assert.equal(rec.returnTo, '/pricing/?subscribe=growth-monthly');
});

test('createPendingSignup: drops unsafe returnTo to null', async () => {
  kv._resetMemoryStore();
  const pending = await auth.createPendingSignup('store@example.com', null, {
    returnTo: 'https://evil.com/',
  });
  const rec = await kv.get(`signup:${pending.token}`);
  assert.equal(rec.returnTo, null);
});

// ── /pricing/ + /account/ + /signup/ markup contracts ───

test('/pricing/ uses /signup/?return=… on 401 + auto-resumes on ?subscribe=', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'pricing', 'index.html'), 'utf8');
  // Routes 401 visitors to /signup/, not /account/, because /signup/ is
  // the explicit entry for new users (and signed-out visitors are
  // statistically more likely to be new).
  assert.match(html, /\/signup\/\?return=/);
  // Auto-resume hook present
  assert.match(html, /params\.get\('subscribe'\)/);
  assert.match(html, /startCheckout/);
});

test('/account/app.js threads pageReturnTo into login + magic-link bodies', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'app.js'), 'utf8');
  assert.match(js, /pageReturnTo/);
  // Both flows
  assert.match(js, /returnTo: pageReturnTo/);
  // Post-login client redirect honours server-echoed returnTo
  assert.match(js, /resp\.j\.returnTo/);
});

test('/signup/app.js threads pageReturnTo into the body when present', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'signup', 'app.js'), 'utf8');
  assert.match(js, /pageReturnTo/);
  assert.match(js, /body\.returnTo = pageReturnTo/);
});

test('/account/reset/app.js honours ?return= + redirects on server-echo', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'reset', 'app.js'), 'utf8');
  assert.match(js, /pageReturnTo/);
  assert.match(js, /returnTo: pageReturnTo/);
  assert.match(js, /resp\.j\.returnTo/);
});

// ── Module surface ──────────────────────────────────────

test('lib/auth.js exports isSafeReturnTo', () => {
  assert.equal(typeof auth.isSafeReturnTo, 'function');
});
