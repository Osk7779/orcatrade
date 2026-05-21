// Sprint sso-oidc-v1 — OIDC RP core, tested ADVERSARIALLY against a real
// RSA keypair. Every rejection branch here is an account-takeover hole if
// it didn't fire, so these are the load-bearing security tests.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const oidc = require('../lib/oidc');

// ── Test harness: a real RSA keypair + a JWT minter ─────

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = publicKey.export({ format: 'jwk' });
JWK.kid = 'test-key-1';
JWK.kty = 'RSA';
const JWKS = { keys: [JWK] };

const ISSUER = 'https://idp.example.com';
const CLIENT_ID = 'orcatrade-client';
const NONCE = 'nonce-abc';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Mint a signed JWT. `alg` + `kid` + claim overrides let tests forge.
function mintToken({ header = {}, claims = {}, sign = 'RS256' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = Object.assign({ alg: 'RS256', typ: 'JWT', kid: 'test-key-1' }, header);
  const c = Object.assign({ iss: ISSUER, aud: CLIENT_ID, exp: now + 600, iat: now, nonce: NONCE, email: 'user@corp.com', sub: 'idp-sub-1' }, claims);
  const signingInput = `${b64url(h)}.${b64url(c)}`;
  let sig = '';
  if (sign === 'RS256') {
    sig = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } else if (sign === 'HS256-pub') {
    // alg-confusion attack: HMAC the token with the PUBLIC key as the secret.
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
    sig = crypto.createHmac('sha256', pubPem).update(signingInput).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } else if (sign === 'none') {
    sig = '';
  }
  return `${signingInput}.${sig}`;
}

const baseOpts = () => ({ jwks: JWKS, issuer: ISSUER, clientId: CLIENT_ID, nonce: NONCE });

// ── Happy path ──────────────────────────────────────────

test('verifyIdToken: accepts a valid RS256 token + extracts email/sub', () => {
  const r = oidc.verifyIdToken(mintToken(), baseOpts());
  assert.equal(r.ok, true);
  assert.equal(r.claims.email, 'user@corp.com');
  assert.equal(r.claims.sub, 'idp-sub-1');
});

test('verifyIdToken: lowercases the email claim', () => {
  const r = oidc.verifyIdToken(mintToken({ claims: { email: 'User@Corp.COM' } }), baseOpts());
  assert.equal(r.claims.email, 'user@corp.com');
});

// ── Adversarial: each rejection is a security gate ──────

test('REJECT alg:none (the classic unsigned-token bypass)', () => {
  const tok = mintToken({ header: { alg: 'none' }, sign: 'none' });
  assert.equal(oidc.verifyIdToken(tok, baseOpts()).reason, 'bad-alg');
});

test('REJECT HS256 alg-confusion (public key used as HMAC secret)', () => {
  const tok = mintToken({ header: { alg: 'HS256' }, sign: 'HS256-pub' });
  // bad-alg fires first (we only accept RS256) — the confusion never gets a chance.
  assert.equal(oidc.verifyIdToken(tok, baseOpts()).reason, 'bad-alg');
});

test('REJECT a tampered payload (signature no longer matches)', () => {
  const tok = mintToken();
  const parts = tok.split('.');
  const forgedPayload = b64url({ iss: ISSUER, aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600, nonce: NONCE, email: 'attacker@evil.com', sub: 'x' });
  const tampered = `${parts[0]}.${forgedPayload}.${parts[2]}`;
  assert.equal(oidc.verifyIdToken(tampered, baseOpts()).reason, 'bad-signature');
});

test('REJECT a token signed by a different (attacker) key', () => {
  const evil = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = Math.floor(Date.now() / 1000);
  const h = b64url({ alg: 'RS256', typ: 'JWT', kid: 'test-key-1' }); // claims our kid
  const c = b64url({ iss: ISSUER, aud: CLIENT_ID, exp: now + 600, nonce: NONCE, email: 'user@corp.com' });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${c}`), evil.privateKey).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(oidc.verifyIdToken(`${h}.${c}.${sig}`, baseOpts()).reason, 'bad-signature');
});

test('REJECT wrong issuer', () => {
  assert.equal(oidc.verifyIdToken(mintToken({ claims: { iss: 'https://evil-idp.com' } }), baseOpts()).reason, 'bad-issuer');
});

test('REJECT wrong audience (token minted for another client)', () => {
  assert.equal(oidc.verifyIdToken(mintToken({ claims: { aud: 'some-other-client' } }), baseOpts()).reason, 'bad-audience');
});

test('ACCEPT audience array that contains our client id', () => {
  const r = oidc.verifyIdToken(mintToken({ claims: { aud: ['other', CLIENT_ID] } }), baseOpts());
  assert.equal(r.ok, true);
});

test('REJECT expired token (beyond clock skew)', () => {
  const past = Math.floor(Date.now() / 1000) - (oidc.CLOCK_SKEW_SECONDS + 60);
  assert.equal(oidc.verifyIdToken(mintToken({ claims: { exp: past } }), baseOpts()).reason, 'expired');
});

test('REJECT replayed token with a stale nonce', () => {
  assert.equal(oidc.verifyIdToken(mintToken({ claims: { nonce: 'OLD-nonce' } }), baseOpts()).reason, 'bad-nonce');
});

test('REJECT unknown kid when JWKS has multiple keys (no guessing)', () => {
  const second = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'jwk' });
  second.kid = 'other'; second.kty = 'RSA';
  const multi = { keys: [JWK, second] };
  const tok = mintToken({ header: { kid: 'does-not-exist' } });
  assert.equal(oidc.verifyIdToken(tok, Object.assign(baseOpts(), { jwks: multi })).reason, 'no-key');
});

test('REJECT a token with no usable email claim', () => {
  assert.equal(oidc.verifyIdToken(mintToken({ claims: { email: undefined } }), baseOpts()).reason, 'no-email');
});

test('REJECT malformed token strings', () => {
  assert.equal(oidc.verifyIdToken('not-a-jwt', baseOpts()).reason, 'malformed');
  assert.equal(oidc.verifyIdToken('a.b', baseOpts()).reason, 'malformed');
  assert.equal(oidc.verifyIdToken('', baseOpts()).reason, 'malformed');
});

// ── PKCE / state / nonce / URL builder ──────────────────

test('generatePkce: challenge is base64url SHA-256 of the verifier (S256)', () => {
  const { verifier, challenge, method } = oidc.generatePkce();
  assert.equal(method, 'S256');
  const expected = crypto.createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(challenge, expected);
});

test('generateState / generateNonce produce unique 32-hex tokens', () => {
  assert.match(oidc.generateState(), /^[a-f0-9]{32}$/);
  assert.notEqual(oidc.generateNonce(), oidc.generateNonce());
});

test('buildAuthorizationUrl carries response_type=code + PKCE + state + nonce', () => {
  const url = oidc.buildAuthorizationUrl({
    authorizationEndpoint: 'https://idp.example.com/authorize',
    clientId: CLIENT_ID, redirectUri: 'https://orcatrade.pl/api/auth/sso/callback',
    state: 'st', nonce: 'no', codeChallenge: 'cc',
  });
  assert.match(url, /response_type=code/);
  assert.match(url, /code_challenge=cc/);
  assert.match(url, /code_challenge_method=S256/);
  assert.match(url, /state=st/);
  assert.match(url, /nonce=no/);
  assert.match(url, /client_id=orcatrade-client/);
});

test('selectJwk: returns the single key when no kid; null when ambiguous', () => {
  assert.equal(oidc.selectJwk(JWKS, null).kid, 'test-key-1'); // single key
  const multi = { keys: [JWK, Object.assign({}, JWK, { kid: 'k2' })] };
  assert.equal(oidc.selectJwk(multi, null), null); // ambiguous → null
  assert.equal(oidc.selectJwk(multi, 'k2').kid, 'k2');
});
