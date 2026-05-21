// Sprint sso-oidc-v1 (phase 2) — config/flow store + initiate/callback
// endpoints. The callback's network calls (token exchange, JWKS fetch)
// are exercised by stubbing global.fetch with a real RSA-signed token.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
process.env.SITE_ORIGIN = 'https://orcatrade.pl';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const ssoConfig = require('../lib/sso-config');
const authHandler = require('../lib/handlers/auth');
const auth = require('../lib/auth');
const kv = require('../lib/intelligence/kv-store');

// ── A real keypair + IdP stub ───────────────────────────
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', kty: 'RSA' });
const JWKS = { keys: [JWK] };
const ISSUER = 'https://idp.acme.test';
const CLIENT_ID = 'orca-acme';

function b64url(o) { return Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function idToken(claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url({ alg: 'RS256', typ: 'JWT', kid: 'k1' });
  const c = b64url(Object.assign({ iss: ISSUER, aud: CLIENT_ID, exp: now + 600, iat: now, email: 'alice@acme.test', sub: 's1' }, claims));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${c}`), privateKey).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${h}.${c}.${sig}`;
}

const CONFIG = {
  issuer: ISSUER, clientId: CLIENT_ID, clientSecret: 'shh',
  authorizationEndpoint: ISSUER + '/authorize',
  tokenEndpoint: ISSUER + '/token',
  jwksUri: ISSUER + '/jwks',
};

function mockRes() {
  const res = {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    end(body) { this.body = body || ''; return this; },
  };
  return res;
}

// Install a fetch stub that answers the token + jwks endpoints.
function stubFetch({ token = idToken(), tokenOk = true, jwks = JWKS } = {}) {
  const original = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u === CONFIG.tokenEndpoint) {
      return { ok: tokenOk, json: async () => (tokenOk ? { id_token: token, access_token: 'a' } : {}) };
    }
    if (u === CONFIG.jwksUri) {
      return { ok: true, json: async () => jwks };
    }
    return { ok: false, json: async () => ({}) };
  };
  return () => { global.fetch = original; };
}

// Seed a flow by calling initiate, then extract the state + nonce from the
// redirect (a real IdP echoes the nonce back in the id_token, so tests must
// mint the token with this exact nonce to pass verification).
async function initiateAndGetState(orgId) {
  const res = mockRes();
  await authHandler.handleSsoInitiate({ method: 'GET', headers: {}, query: { org: orgId } }, res);
  assert.equal(res.statusCode, 302);
  const url = new URL(res.headers['location']);
  return { state: url.searchParams.get('state'), nonce: url.searchParams.get('nonce') };
}

// ── Config / flow store ─────────────────────────────────

test('setConfig rejects incomplete config; getConfig returns a complete one', async () => {
  kv._resetMemoryStore();
  assert.equal((await ssoConfig.setConfig('org1', { issuer: ISSUER })).ok, false);
  assert.equal((await ssoConfig.setConfig('org1', CONFIG)).ok, true);
  const got = await ssoConfig.getConfig('org1');
  assert.equal(got.issuer, ISSUER);
  assert.ok(ssoConfig.isComplete(got));
});

test('sanitiseConfig drops unknown fields + lowercases allowedDomains', () => {
  const c = ssoConfig.sanitiseConfig(Object.assign({}, CONFIG, { evil: 'x', allowedDomains: ['ACME.test', 'bad'] }));
  assert.ok(!('evil' in c));
  assert.deepEqual(c.allowedDomains, ['acme.test']); // 'bad' has no dot → dropped
});

test('emailDomainAllowed: open when no allowlist, enforced when set', () => {
  assert.equal(ssoConfig.emailDomainAllowed({}, 'x@any.com'), true);
  assert.equal(ssoConfig.emailDomainAllowed({ allowedDomains: ['acme.test'] }, 'a@acme.test'), true);
  assert.equal(ssoConfig.emailDomainAllowed({ allowedDomains: ['acme.test'] }, 'a@evil.com'), false);
});

test('flow is single-use (consume deletes it)', async () => {
  kv._resetMemoryStore();
  await ssoConfig.createFlow('st1', { orgId: 'o', nonce: 'n', codeVerifier: 'v' });
  assert.equal((await ssoConfig.consumeFlow('st1')).orgId, 'o');
  assert.equal(await ssoConfig.consumeFlow('st1'), null); // replay → gone
});

// ── initiate ────────────────────────────────────────────

test('initiate: 400 without org, 404 when no config, 302 with PKCE when configured', async () => {
  kv._resetMemoryStore();
  const noOrg = mockRes();
  await authHandler.handleSsoInitiate({ method: 'GET', headers: {}, query: {} }, noOrg);
  assert.equal(noOrg.statusCode, 400);

  const noCfg = mockRes();
  await authHandler.handleSsoInitiate({ method: 'GET', headers: {}, query: { org: 'org1' } }, noCfg);
  assert.equal(noCfg.statusCode, 404);

  await ssoConfig.setConfig('org1', CONFIG);
  const ok = mockRes();
  await authHandler.handleSsoInitiate({ method: 'GET', headers: {}, query: { org: 'org1' } }, ok);
  assert.equal(ok.statusCode, 302);
  const url = new URL(ok.headers['location']);
  assert.equal(url.origin + url.pathname, ISSUER + '/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('state'));
});

// ── callback ────────────────────────────────────────────

test('callback: happy path verifies the token + mints a session', async () => {
  kv._resetMemoryStore();
  await ssoConfig.setConfig('org1', CONFIG);
  const { state, nonce } = await initiateAndGetState('org1');
  const restore = stubFetch({ token: idToken({ nonce }) });
  try {
    const res = mockRes();
    await authHandler.handleSsoCallback({ method: 'GET', headers: {}, query: { code: 'abc', state } }, res);
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers['location'], '/account/');
    assert.match(res.headers['set-cookie'], /orcatrade_session=/);
    // The minted cookie carries the IdP-asserted email.
    const m = /orcatrade_session=([^;]+)/.exec(res.headers['set-cookie']);
    const parsed = auth.verifyAndParseCookie(decodeURIComponent(m[1]));
    assert.equal(parsed.email, 'alice@acme.test');
  } finally { restore(); }
});

test('callback: 302-to-error on missing params + unknown state', async () => {
  kv._resetMemoryStore();
  const miss = mockRes();
  await authHandler.handleSsoCallback({ method: 'GET', headers: {}, query: { state: 'x' } }, miss);
  assert.match(miss.headers['location'], /sso_error=missing-params/);

  const bad = mockRes();
  await authHandler.handleSsoCallback({ method: 'GET', headers: {}, query: { code: 'c', state: 'never-issued' } }, bad);
  assert.match(bad.headers['location'], /sso_error=bad-state/);
});

test('callback: a token that fails verification mints NO session (fail closed)', async () => {
  kv._resetMemoryStore();
  await ssoConfig.setConfig('org1', CONFIG);
  const { state } = await initiateAndGetState('org1');
  // Token with the wrong audience → verifyIdToken rejects → no session.
  const restore = stubFetch({ token: idToken({ aud: 'someone-else' }) });
  try {
    const res = mockRes();
    await authHandler.handleSsoCallback({ method: 'GET', headers: {}, query: { code: 'abc', state } }, res);
    assert.match(res.headers['location'], /sso_error=token-bad-audience/);
    assert.ok(!res.headers['set-cookie'], 'no session cookie on a rejected token');
  } finally { restore(); }
});

test('callback: domain allowlist blocks an out-of-domain email', async () => {
  kv._resetMemoryStore();
  await ssoConfig.setConfig('org1', Object.assign({}, CONFIG, { allowedDomains: ['acme.test'] }));
  const { state, nonce } = await initiateAndGetState('org1');
  const restore = stubFetch({ token: idToken({ email: 'mallory@evil.com', nonce }) });
  try {
    const res = mockRes();
    await authHandler.handleSsoCallback({ method: 'GET', headers: {}, query: { code: 'abc', state } }, res);
    assert.match(res.headers['location'], /sso_error=domain-not-allowed/);
    assert.ok(!res.headers['set-cookie']);
  } finally { restore(); }
});

test('callback: token-exchange failure fails closed', async () => {
  kv._resetMemoryStore();
  await ssoConfig.setConfig('org1', CONFIG);
  const { state } = await initiateAndGetState('org1');
  const restore = stubFetch({ tokenOk: false });
  try {
    const res = mockRes();
    await authHandler.handleSsoCallback({ method: 'GET', headers: {}, query: { code: 'abc', state } }, res);
    assert.match(res.headers['location'], /sso_error=exchange-failed/);
    assert.ok(!res.headers['set-cookie']);
  } finally { restore(); }
});

test('callback: replayed state (already consumed) is rejected', async () => {
  kv._resetMemoryStore();
  await ssoConfig.setConfig('org1', CONFIG);
  const { state, nonce } = await initiateAndGetState('org1');
  const restore = stubFetch({ token: idToken({ nonce }) });
  try {
    const first = mockRes();
    await authHandler.handleSsoCallback({ method: 'GET', headers: {}, query: { code: 'abc', state } }, first);
    assert.equal(first.statusCode, 302);
    const replay = mockRes();
    await authHandler.handleSsoCallback({ method: 'GET', headers: {}, query: { code: 'abc', state } }, replay);
    assert.match(replay.headers['location'], /sso_error=bad-state/); // flow already consumed
  } finally { restore(); }
});

// ── dispatcher ──────────────────────────────────────────

test('dispatcher routes /api/auth/sso/initiate + /callback + 404 unknown', async () => {
  kv._resetMemoryStore();
  const init = mockRes();
  await authHandler({ method: 'GET', headers: {}, query: { path: 'auth/sso/initiate' } }, init);
  assert.equal(init.statusCode, 400); // no org, but route resolved
  const unknown = mockRes();
  await authHandler({ method: 'GET', headers: {}, query: { path: 'auth/sso/nope' } }, unknown);
  assert.equal(unknown.statusCode, 404);
});
