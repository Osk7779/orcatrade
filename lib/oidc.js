// OIDC relying-party core — Sprint sso-oidc-v1.
//
// Enterprise SSO via OpenID Connect Authorization Code flow + PKCE. We
// deliberately chose OIDC over SAML: ID tokens are signed JWTs (JWS),
// verified against the IdP's published JWKS — far less error-prone than
// hand-rolling SAML XML-DSig (canonicalisation + signature-wrapping are
// classic CVE territory). Zero-dep, node:crypto only.
//
// This module is the security-critical core and is PURE (no I/O): token
// parsing, RS256-against-JWKS verification, and claim validation. The
// handler does the network (discovery, token exchange, JWKS fetch) and
// passes the fetched JWKS in here. Every validation that, if skipped,
// would be an account-takeover hole is covered by an adversarial test:
//   - alg confusion: ONLY RS256 accepted; alg:none / HS256 rejected
//   - signature: verified against the JWKS key, never token-supplied material
//   - audience: aud MUST contain our clientId
//   - issuer: iss MUST equal the configured issuer
//   - expiry: exp MUST be in the future (small clock skew allowed)
//   - replay: nonce MUST match the one we minted for this flow

'use strict';

const crypto = require('node:crypto');

const CLOCK_SKEW_SECONDS = 120;

// ── base64url ───────────────────────────────────────────

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecodeToBuf(str) {
  const padded = String(str).replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (String(str).length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

// ── CSRF / replay nonces + PKCE ─────────────────────────

function generateState() { return crypto.randomBytes(16).toString('hex'); }
function generateNonce() { return crypto.randomBytes(16).toString('hex'); }

// PKCE S256: verifier is a high-entropy random string; challenge is the
// base64url SHA-256 of the verifier. Protects the code exchange even if
// the redirect is intercepted.
function generatePkce() {
  const verifier = b64urlEncode(crypto.randomBytes(32));
  const challenge = b64urlEncode(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}

// ── Authorization URL ───────────────────────────────────

function buildAuthorizationUrl({ authorizationEndpoint, clientId, redirectUri, state, nonce, codeChallenge, scope = 'openid email profile' }) {
  if (!authorizationEndpoint || !clientId || !redirectUri) return null;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  const sep = authorizationEndpoint.includes('?') ? '&' : '?';
  return `${authorizationEndpoint}${sep}${params.toString()}`;
}

// ── JWT parse ───────────────────────────────────────────

function parseJwt(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = JSON.parse(b64urlDecodeToBuf(parts[0]).toString('utf8'));
    payload = JSON.parse(b64urlDecodeToBuf(parts[1]).toString('utf8'));
  } catch (_) { return null; }
  if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') return null;
  return {
    header,
    payload,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: parts[2],
  };
}

// ── JWKS key selection + RS256 verification ─────────────

function selectJwk(jwks, kid) {
  const keys = (jwks && Array.isArray(jwks.keys)) ? jwks.keys : [];
  const rsaKeys = keys.filter((k) => k && k.kty === 'RSA');
  if (kid) {
    const match = rsaKeys.find((k) => k.kid === kid);
    if (match) return match;
  }
  // No kid (or no match): only safe to fall back when there's exactly one
  // RSA key — otherwise we'd be guessing.
  return rsaKeys.length === 1 ? rsaKeys[0] : null;
}

function verifySignatureRS256(signingInput, signatureB64url, jwk) {
  if (!jwk || jwk.kty !== 'RSA') return false;
  let pubKey;
  try {
    // node:crypto builds an RSA public key straight from the JWK (n, e).
    pubKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  } catch (_) { return false; }
  let sig;
  try { sig = b64urlDecodeToBuf(signatureB64url); } catch (_) { return false; }
  try {
    return crypto.verify('RSA-SHA256', Buffer.from(signingInput), pubKey, sig);
  } catch (_) { return false; }
}

// ── ID-token verification (the gate) ────────────────────
//
// Returns { ok:true, claims } or { ok:false, reason }. Every reason maps
// to a security check that an attacker would try to bypass.
function verifyIdToken(token, { jwks, issuer, clientId, nonce, now = Math.floor(Date.now() / 1000) } = {}) {
  const parsed = parseJwt(token);
  if (!parsed) return { ok: false, reason: 'malformed' };

  // 1. Algorithm: ONLY RS256. This rejects alg:none and the HS256
  //    "use the public key as an HMAC secret" confusion attack.
  if (parsed.header.alg !== 'RS256') return { ok: false, reason: 'bad-alg' };

  // 2. Signature against the JWKS key (never token-supplied key material).
  const jwk = selectJwk(jwks, parsed.header.kid);
  if (!jwk) return { ok: false, reason: 'no-key' };
  if (!verifySignatureRS256(parsed.signingInput, parsed.signature, jwk)) {
    return { ok: false, reason: 'bad-signature' };
  }

  const c = parsed.payload;

  // 3. Issuer must match exactly.
  if (!issuer || c.iss !== issuer) return { ok: false, reason: 'bad-issuer' };

  // 4. Audience must contain our client id.
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!clientId || !aud.includes(clientId)) return { ok: false, reason: 'bad-audience' };

  // 5. Expiry (+ optional nbf), with a small clock-skew tolerance.
  if (typeof c.exp !== 'number' || now > c.exp + CLOCK_SKEW_SECONDS) return { ok: false, reason: 'expired' };
  if (typeof c.nbf === 'number' && now + CLOCK_SKEW_SECONDS < c.nbf) return { ok: false, reason: 'not-yet-valid' };

  // 6. Nonce must match the one minted for this flow (replay protection).
  if (nonce && c.nonce !== nonce) return { ok: false, reason: 'bad-nonce' };

  // Email is what we key our accounts on; require a verified-ish address.
  const email = typeof c.email === 'string' ? c.email.toLowerCase().trim() : null;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, reason: 'no-email' };

  return { ok: true, claims: { sub: c.sub || null, email, name: c.name || null, emailVerified: c.email_verified === true } };
}

module.exports = {
  CLOCK_SKEW_SECONDS,
  b64urlEncode,
  b64urlDecodeToBuf,
  generateState,
  generateNonce,
  generatePkce,
  buildAuthorizationUrl,
  parseJwt,
  selectJwk,
  verifySignatureRS256,
  verifyIdToken,
};
