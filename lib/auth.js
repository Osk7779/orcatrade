// Magic-link auth — token generation, session-cookie signing, current-user
// resolution from request cookies.
//
// Flow:
//   1. POST /api/auth/request { email } → server generates 32-byte random
//      token, stores `auth:magic:<token>` → email in KV with 15-min TTL,
//      sends Resend email with link `/api/auth/verify?token=<token>`.
//   2. GET /api/auth/verify?token=<token> → server reads token from KV,
//      mints a 30-day session cookie (signed payload), deletes the token,
//      redirects to /account/.
//   3. /account/ page calls GET /api/auth/me → returns { email } parsed
//      from the cookie.
//   4. POST /api/auth/logout → clears the cookie, returns { ok: true }.
//
// Security:
//   - Token: 256 bits of entropy via crypto.randomBytes.
//   - Cookie payload: base64url JSON {email, iat, exp}.
//   - Cookie signature: HMAC-SHA256 of payload using ORCATRADE_AUTH_SECRET.
//   - Cookie attributes: HttpOnly, Secure (in prod), SameSite=Lax, Path=/.
//
// In dev without ORCATRADE_AUTH_SECRET set, we fall back to a derived
// constant — sessions still work but are not portable across deploys.
// Production should always set the secret.

'use strict';

const crypto = require('node:crypto');

const COOKIE_NAME = 'orcatrade_session';
const SESSION_TTL_DAYS = 30;
const MAGIC_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
const KV_KEY_PREFIX = 'auth:magic:';

function getAuthSecret() {
  const secret = process.env.ORCATRADE_AUTH_SECRET || '';
  if (secret) return secret;
  // Dev fallback — deterministic but warns at startup. Production must set
  // ORCATRADE_AUTH_SECRET to a 32+ byte random string.
  return 'dev-fallback-orcatrade-' + (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 16);
}

// ── Token generation ──────────────────────────────────

function generateMagicToken() {
  return crypto.randomBytes(32).toString('hex');
}

function magicKvKey(token) {
  return KV_KEY_PREFIX + token;
}

// ── Cookie signing / verification ─────────────────────

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function signPayload(payloadObj) {
  const payload = base64url(JSON.stringify(payloadObj));
  const sig = crypto.createHmac('sha256', getAuthSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyAndParseCookie(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', getAuthSecret()).update(payload).digest('hex');
  // Constant-time comparison
  if (sig.length !== expected.length) return null;
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(base64urlDecode(payload));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (!parsed.email || !parsed.exp) return null;
  if (Date.now() > parsed.exp) return null;
  return parsed;
}

// Sprint BG-3.2 phase 2 — each cookie now carries a per-session ID so
// users can see + revoke individual devices. The ID is a 16-hex-char
// random token; embedded in the same signed payload as email/iat/exp.
//
// Cookies issued BEFORE this sprint don't carry sid — the verifier
// returns sid=null and the UI labels them "legacy session". They keep
// working until natural 30-day expiry.
function generateSessionId() {
  return crypto.randomBytes(8).toString('hex'); // 16 hex chars
}

function buildSessionCookie(email, opts = {}) {
  const now = Date.now();
  const payload = {
    email: String(email).toLowerCase().trim(),
    iat: now,
    exp: now + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    sid: opts.sid || generateSessionId(),
  };
  return signPayload(payload);
}

// ── Cookie header helpers ──────────────────────────────

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return out;
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

// Sprint cookie-domain-v1 — share the session cookie across apex +
// every subdomain (orcatrade.pl AND www.orcatrade.pl AND any future
// subdomain). Without this the cookie is locked to the exact hostname
// where it was first set, which silently breaks every cross-subdomain
// navigation (sign in on apex → visit www → no cookie sent → 401 →
// stripe checkout fails, etc.).
//
// COOKIE_DOMAIN env can override (useful for staging on a vercel.app
// hostname or local dev). When unset in production we default to
// orcatrade.pl. When unset AND secure=false (the local-dev path), we
// omit the Domain attribute entirely so the cookie still works on
// localhost.
function cookieDomainAttribute(secure) {
  const explicit = process.env.COOKIE_DOMAIN;
  if (explicit) return `Domain=${explicit}`;
  if (!secure) return null; // local dev — leave the cookie hostname-locked
  return 'Domain=orcatrade.pl';
}

function buildSetCookieHeader(value, { maxAgeSeconds = SESSION_TTL_DAYS * 24 * 60 * 60, secure = true } = {}) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAgeSeconds}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  const domain = cookieDomainAttribute(secure);
  if (domain) parts.push(domain);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function buildClearCookieHeader() {
  // Must use the SAME Domain attribute on the clear as on the set,
  // otherwise the browser treats it as a different cookie and the
  // original keeps working. Defaults match buildSetCookieHeader's
  // production defaults (secure=true).
  const parts = [
    `${COOKIE_NAME}=`,
    'Max-Age=0',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  const domain = cookieDomainAttribute(true);
  if (domain) parts.push(domain);
  parts.push('Secure');
  return parts.join('; ');
}

// ── Current-user resolution ────────────────────────────

function getCurrentUser(req) {
  const cookieHeader = req && req.headers ? req.headers.cookie : '';
  const cookies = parseCookies(cookieHeader);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const parsed = verifyAndParseCookie(token);
  if (!parsed) return null;
  // Sprint BG-3.2 phase 2 — sid may be null on pre-sprint cookies. The
  // UI surfaces those as "legacy session". Keep returning the field so
  // every caller can pivot off it.
  return { email: parsed.email, iat: parsed.iat, exp: parsed.exp, sid: parsed.sid || null };
}

// ── Email validation ───────────────────────────────────

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length > 200) return false;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed);
}

// ── Session revocation (Sprint BG-3.2 phase 1) ──────────
//
// Strategy: stateless sessions stay stateless. To invalidate them at
// will, we keep a per-email "minimum iat" timestamp in KV. Any session
// whose `iat` is earlier than `auth:rev-min-iat:<email>` is rejected.
//
// When a user clicks "Sign out everywhere" we set the timestamp to now.
// Every active cookie for that email — across every device they've
// signed in on — instantly stops working. New sign-ins after that
// timestamp work normally.
//
// We deliberately did NOT add a per-session ID. That would change the
// cookie contract + require server-side state for every session. The
// min-iat approach is the minimum-invasive way to get the security
// guarantee: "the user can kill everything in one click."
//
// Public API:
//   - revokeAllSessionsForEmail(email) → async, idempotent
//   - getMinIat(email) → async, returns unix ms, 0 if no revocation
//   - getCurrentUserStrict(req) → async — like getCurrentUser but also
//     checks min-iat. Handlers touching sensitive data (account/, orgs/)
//     use this; lower-stakes handlers can keep the sync getCurrentUser.

const REV_KEY_PREFIX = 'auth:rev-min-iat:';
// 31-day TTL — same as session lifetime + 1 day. Once every session
// issued before the revocation has expired naturally, the key can age
// out without consequence.
const REV_TTL_SECONDS = (SESSION_TTL_DAYS + 1) * 24 * 60 * 60;

function revKvKey(email) {
  return REV_KEY_PREFIX + String(email).toLowerCase().trim();
}

async function revokeAllSessionsForEmail(email) {
  const kv = require('./intelligence/kv-store');
  const e = String(email || '').toLowerCase().trim();
  if (!e) return false;
  try {
    await kv.set(revKvKey(e), Date.now(), { ttlSeconds: REV_TTL_SECONDS });
    return true;
  } catch (_) {
    return false;
  }
}

async function getMinIat(email) {
  const kv = require('./intelligence/kv-store');
  const e = String(email || '').toLowerCase().trim();
  if (!e) return 0;
  try {
    const v = await kv.get(revKvKey(e));
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (_) {
    return 0;
  }
}

// Async variant of getCurrentUser that enforces the revocation list.
// Returns null when the cookie is missing, malformed, expired, OR when
// the session's iat is earlier than the user's revocation timestamp.
//
// Use this in handlers that touch sensitive data — anything under
// /api/account/* or /api/orgs/* — so a "sign out everywhere" actually
// kicks the user out of those flows immediately.
//
// Lower-stakes handlers (e.g. /api/start which is read-only and used
// for anonymous plan generation too) can keep the sync getCurrentUser.
//
// Sprint BG-3.2 phase 2 — also checks the per-session revoke list: a
// user can revoke ONE device from /account/security/ without touching
// other devices. If the cookie's sid is in `session:revoked:<sid>` the
// session is dead even though min-iat says the rest are still good.
async function getCurrentUserStrict(req) {
  const user = getCurrentUser(req);
  if (!user) return null;
  const minIat = await getMinIat(user.email);
  if (minIat > 0 && (user.iat || 0) < minIat) return null;
  if (user.sid && await isSessionRevoked(user.sid)) return null;
  return user;
}

// ── Per-session metadata (Sprint BG-3.2 phase 2) ────────
//
// On every magic-link verify we persist:
//   session:<sid> → { email, iat, exp, ua, ip, createdAt, lastSeenAt }
// + an index per email for the listing endpoint:
//   session:byEmail:<email> → [sid, sid, …]
//
// Per-session revocation: a separate `session:revoked:<sid>` key
// (boolean) gives getCurrentUserStrict a single KV lookup to enforce
// without scanning the whole user's session list.

const SESSION_PREFIX = 'session:';
const SESSION_INDEX_PREFIX = 'session:byEmail:';
const SESSION_REVOKE_PREFIX = 'session:revoked:';
const SESSION_TTL_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60;

function sessionKey(sid) { return SESSION_PREFIX + String(sid).toLowerCase().trim(); }
function sessionIndexKey(email) { return SESSION_INDEX_PREFIX + String(email).toLowerCase().trim(); }
function sessionRevokeKey(sid) { return SESSION_REVOKE_PREFIX + String(sid).toLowerCase().trim(); }

// Truncate UA to 250 chars — enough for "Chrome 128 on Mac" hints
// without leaking full fingerprinting payloads into KV.
function sanitiseUa(ua) {
  if (!ua || typeof ua !== 'string') return null;
  const trimmed = ua.trim();
  if (!trimmed) return null;
  return trimmed.length > 250 ? trimmed.slice(0, 250) : trimmed;
}

// Persist a new session record alongside the email index. Called from
// handleVerify after a successful magic-link redemption.
async function recordSession({ sid, email, iat, exp, ua, ip }) {
  const kv = require('./intelligence/kv-store');
  if (!sid || !email) return null;
  const e = String(email).toLowerCase().trim();
  const now = new Date().toISOString();
  const record = {
    sid,
    email: e,
    iat: iat || Date.now(),
    exp: exp || Date.now() + SESSION_TTL_SECONDS * 1000,
    ua: sanitiseUa(ua),
    ip: ip || null,
    createdAt: now,
    lastSeenAt: now,
  };
  try {
    await kv.set(sessionKey(sid), record, { ttlSeconds: SESSION_TTL_SECONDS });
    const existing = (await kv.get(sessionIndexKey(e))) || [];
    if (Array.isArray(existing) && !existing.includes(sid)) {
      const updated = existing.concat([sid]).slice(-50); // hard cap, defensive
      await kv.set(sessionIndexKey(e), updated, { ttlSeconds: SESSION_TTL_SECONDS });
    } else if (!Array.isArray(existing)) {
      await kv.set(sessionIndexKey(e), [sid], { ttlSeconds: SESSION_TTL_SECONDS });
    }
    return record;
  } catch (_) {
    return null;
  }
}

async function listSessionsForEmail(email) {
  const kv = require('./intelligence/kv-store');
  const e = String(email || '').toLowerCase().trim();
  if (!e) return [];
  const sids = (await kv.get(sessionIndexKey(e))) || [];
  if (!Array.isArray(sids)) return [];
  const out = [];
  for (const sid of sids) {
    const rec = await kv.get(sessionKey(sid));
    if (!rec) continue;
    // Defensive — confirm the record's email matches before surfacing.
    if (rec.email && rec.email !== e) continue;
    // Skip expired records — KV TTL should catch this but a clock
    // skew or test injection can leave stale rows.
    if (rec.exp && Date.now() > rec.exp) continue;
    if (await isSessionRevoked(sid)) continue;
    out.push(rec);
  }
  // Newest first (largest createdAt).
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function isSessionRevoked(sid) {
  const kv = require('./intelligence/kv-store');
  if (!sid) return false;
  try {
    const v = await kv.get(sessionRevokeKey(sid));
    return v === true || (v && typeof v === 'object');
  } catch (_) {
    return false;
  }
}

// Revoke a single session. Ownership-checked: a user can only revoke
// their own sessions. Returns true on success, false on not-found /
// not-owner. Idempotent.
async function revokeSession(sid, requestingEmail) {
  const kv = require('./intelligence/kv-store');
  const e = String(requestingEmail || '').toLowerCase().trim();
  if (!sid || !e) return false;
  const rec = await kv.get(sessionKey(sid));
  if (!rec || rec.email !== e) return false;
  await kv.set(sessionRevokeKey(sid), { revokedAt: new Date().toISOString() }, { ttlSeconds: SESSION_TTL_SECONDS + 24 * 60 * 60 });
  return true;
}

// ── Password auth (Sprint password-auth-v1) ──────────────
//
// Storage namespace: `password:<email>` → {
//   algo: 'scrypt',
//   N, r, p, dkLen,             // scrypt cost params, stored per-record
//                                 so we can lift N later without breaking
//                                 existing passwords.
//   salt: '<hex 32B>',
//   hash: '<hex 64B>',
//   createdAt, updatedAt,
// }
//
// Strategy: scrypt via node:crypto. Zero-dep, FIPS-grade. Default params
// N=2^15, r=8, p=1, dkLen=64 — ~100ms hash on commodity hardware.
//
// Public API:
//   - validatePasswordStrength(password) → { ok, reason }
//   - hashPasswordRecord(password) → record (the object to persist)
//   - verifyPasswordRecord(password, record) → bool, constant-time
//   - setPassword(email, password) — writes the record after strength check
//   - getPasswordRecord(email) → record | null
//   - verifyPassword(email, password) → { ok, reason }
//   - deletePasswordRecord(email)
//   - hasPassword(email) → bool

const PASSWORD_KEY_PREFIX = 'password:';
const SCRYPT_DEFAULT_N = 1 << 15;  // 32768
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DKLEN = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024; // 64 MiB — scrypt default is 32 MiB; lift so N=2^15 fits

function passwordKvKey(email) {
  return PASSWORD_KEY_PREFIX + String(email).toLowerCase().trim();
}

// NIST SP 800-63B: prefer length over arbitrary complexity. We require
// 12+ chars, cap at 1024 to prevent CPU-burn via long-password scrypt
// calls, and reject the trivially-weak shapes (all-same-char, ASCII
// sequences). We do NOT enforce upper/lower/symbol mixes — that's
// security theatre that pushes users toward password reuse.
function validatePasswordStrength(password) {
  if (typeof password !== 'string') return { ok: false, reason: 'not-a-string' };
  if (password.length < 12) return { ok: false, reason: 'too-short' };
  if (password.length > 1024) return { ok: false, reason: 'too-long' };
  // All-same-char ("aaaaaaaaaaaa")
  if (/^(.)\1+$/.test(password)) return { ok: false, reason: 'too-uniform' };
  // Ascending ASCII run of ≥12 ("1234567890ab", "abcdefghijkl")
  let asc = 1;
  for (let i = 1; i < password.length; i++) {
    if (password.charCodeAt(i) === password.charCodeAt(i - 1) + 1) {
      asc++;
      if (asc >= 12) return { ok: false, reason: 'sequential' };
    } else asc = 1;
  }
  return { ok: true };
}

function scryptHash(password, salt, { N = SCRYPT_DEFAULT_N, r = SCRYPT_R, p = SCRYPT_P, dkLen = SCRYPT_DKLEN } = {}) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, dkLen, { N, r, p, maxmem: SCRYPT_MAXMEM }, (err, derived) => {
      if (err) return reject(err);
      resolve(derived);
    });
  });
}

async function hashPasswordRecord(password, { N = SCRYPT_DEFAULT_N } = {}) {
  const salt = crypto.randomBytes(32);
  const derived = await scryptHash(password, salt, { N });
  const now = new Date().toISOString();
  return {
    algo: 'scrypt',
    N, r: SCRYPT_R, p: SCRYPT_P, dkLen: SCRYPT_DKLEN,
    salt: salt.toString('hex'),
    hash: derived.toString('hex'),
    createdAt: now,
    updatedAt: now,
  };
}

async function verifyPasswordRecord(password, record) {
  if (!record || record.algo !== 'scrypt') return false;
  if (typeof password !== 'string') return false;
  let salt, expected;
  try {
    salt = Buffer.from(record.salt, 'hex');
    expected = Buffer.from(record.hash, 'hex');
  } catch (_) { return false; }
  const N = Number(record.N) || SCRYPT_DEFAULT_N;
  const r = Number(record.r) || SCRYPT_R;
  const p = Number(record.p) || SCRYPT_P;
  const dkLen = Number(record.dkLen) || SCRYPT_DKLEN;
  if (expected.length !== dkLen) return false;
  let derived;
  try {
    derived = await scryptHash(password, salt, { N, r, p, dkLen });
  } catch (_) { return false; }
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

async function getPasswordRecord(email) {
  const kv = require('./intelligence/kv-store');
  const e = String(email || '').toLowerCase().trim();
  if (!e) return null;
  try {
    const record = await kv.get(passwordKvKey(e));
    return record || null;
  } catch (_) { return null; }
}

async function hasPassword(email) {
  const record = await getPasswordRecord(email);
  return !!(record && record.hash);
}

async function setPassword(email, password) {
  const kv = require('./intelligence/kv-store');
  const e = String(email || '').toLowerCase().trim();
  if (!e) return { ok: false, reason: 'no-email' };
  const strength = validatePasswordStrength(password);
  if (!strength.ok) return { ok: false, reason: strength.reason };
  const existing = await getPasswordRecord(e);
  const record = await hashPasswordRecord(password);
  if (existing && existing.createdAt) record.createdAt = existing.createdAt;
  try {
    // No TTL — passwords persist until user deletes their account or
    // explicitly clears their password.
    await kv.set(passwordKvKey(e), record);
    return { ok: true };
  } catch (_) {
    return { ok: false, reason: 'storage-failed' };
  }
}

async function deletePasswordRecord(email) {
  const kv = require('./intelligence/kv-store');
  const e = String(email || '').toLowerCase().trim();
  if (!e) return false;
  try { await kv.del(passwordKvKey(e)); return true; } catch (_) { return false; }
}

async function verifyPassword(email, password) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return { ok: false, reason: 'no-email' };
  if (typeof password !== 'string' || !password) return { ok: false, reason: 'no-password' };
  const record = await getPasswordRecord(e);
  if (!record) return { ok: false, reason: 'no-record' };
  const ok = await verifyPasswordRecord(password, record);
  return { ok, reason: ok ? null : 'mismatch' };
}

// ── Password reset tokens (Sprint password-auth-v1) ─────
//
// HMAC-signed single-use tokens for forgot-password flow.
// Token format: `<jti-hex32>.<sig-hex64>` where:
//   - jti is 16 random bytes (32 hex chars)
//   - sig is HMAC-SHA256(jti || ':' || email, ORCATRADE_AUTH_SECRET)
//
// Single-use enforced via KV: `pwreset:<jti>` → email, 1-hour TTL. On
// confirm we read+delete in one go; a replayed token finds no KV entry
// and is rejected.
//
// Why include email in HMAC: prevents jti-collision misdirection AND
// lets the verifier check that the token holder claims the same email
// the KV record was minted for.

const PWRESET_KEY_PREFIX = 'pwreset:';
const PWRESET_TTL_SECONDS = 60 * 60; // 1 hour

function pwresetKvKey(jti) {
  return PWRESET_KEY_PREFIX + String(jti).toLowerCase().trim();
}

function signPwresetToken(jti, email) {
  const e = String(email).toLowerCase().trim();
  const sig = crypto.createHmac('sha256', getAuthSecret()).update(`${jti}:${e}`).digest('hex');
  return `${jti}.${sig}`;
}

async function createPasswordResetToken(email) {
  const kv = require('./intelligence/kv-store');
  const e = String(email || '').toLowerCase().trim();
  if (!e) return null;
  const jti = crypto.randomBytes(16).toString('hex');
  const token = signPwresetToken(jti, e);
  try {
    await kv.set(pwresetKvKey(jti), e, { ttlSeconds: PWRESET_TTL_SECONDS });
    return { token, jti, email: e };
  } catch (_) {
    return null;
  }
}

function parsePasswordResetToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [jti, sig] = parts;
  if (!/^[a-f0-9]{32}$/.test(jti) || !/^[a-f0-9]{64}$/.test(sig)) return null;
  return { jti, sig };
}

// Verify the HMAC AND consume the single-use KV record. Returns the
// email on success, null on any failure. The KV record is deleted on
// successful verify so a second confirm with the same token fails.
async function consumePasswordResetToken(token) {
  const kv = require('./intelligence/kv-store');
  const parts = parsePasswordResetToken(token);
  if (!parts) return null;
  const { jti, sig } = parts;
  const email = await kv.get(pwresetKvKey(jti));
  if (!email || typeof email !== 'string') return null;
  // Re-derive the expected signature against the stored email and
  // compare constant-time.
  const expected = crypto.createHmac('sha256', getAuthSecret()).update(`${jti}:${email}`).digest('hex');
  if (sig.length !== expected.length) return null;
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch (_) { return null; }
  // Single-use: delete the KV record so the token cannot be replayed.
  try { await kv.del(pwresetKvKey(jti)); } catch (_) { /* best effort */ }
  return email;
}

// ── Signup pending tokens (Sprint password-auth-v1) ─────
//
// For email+password signup we don't write `password:<email>` until the
// user clicks the verification link. Otherwise an attacker could
// pre-empt sign-up for an address they don't own and lock the real
// owner out (or, worse, silently squat the magic-link auth surface).
//
// KV namespace: `signup:<token>` → { email, passwordRecord } with
// 1-hour TTL. On consume we drop the password record into the real
// `password:<email>` slot and mint a session cookie.

const SIGNUP_KEY_PREFIX = 'signup:';
const SIGNUP_TTL_SECONDS = 60 * 60;

function signupKvKey(token) {
  return SIGNUP_KEY_PREFIX + String(token).toLowerCase().trim();
}

function generateSignupToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function createPendingSignup(email, passwordRecord) {
  const kv = require('./intelligence/kv-store');
  const e = String(email || '').toLowerCase().trim();
  if (!e) return null;
  const token = generateSignupToken();
  try {
    await kv.set(signupKvKey(token), { email: e, passwordRecord: passwordRecord || null }, { ttlSeconds: SIGNUP_TTL_SECONDS });
    return { token, email: e };
  } catch (_) { return null; }
}

async function consumePendingSignup(token) {
  const kv = require('./intelligence/kv-store');
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const record = await kv.get(signupKvKey(token));
  if (!record || !record.email) return null;
  try { await kv.del(signupKvKey(token)); } catch (_) { /* best effort */ }
  return record;
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_DAYS,
  MAGIC_TOKEN_TTL_SECONDS,
  KV_KEY_PREFIX,
  REV_KEY_PREFIX,
  REV_TTL_SECONDS,
  generateMagicToken,
  magicKvKey,
  signPayload,
  verifyAndParseCookie,
  buildSessionCookie,
  parseCookies,
  buildSetCookieHeader,
  buildClearCookieHeader,
  getCurrentUser,
  // Sprint BG-3.2 phase 1
  revokeAllSessionsForEmail,
  getMinIat,
  getCurrentUserStrict,
  revKvKey,
  isValidEmail,
  // Sprint BG-3.2 phase 2
  generateSessionId,
  SESSION_PREFIX,
  SESSION_INDEX_PREFIX,
  SESSION_REVOKE_PREFIX,
  sessionKey,
  sessionIndexKey,
  sessionRevokeKey,
  sanitiseUa,
  recordSession,
  listSessionsForEmail,
  isSessionRevoked,
  revokeSession,
  // Sprint password-auth-v1
  PASSWORD_KEY_PREFIX,
  SCRYPT_DEFAULT_N,
  PWRESET_KEY_PREFIX,
  PWRESET_TTL_SECONDS,
  SIGNUP_KEY_PREFIX,
  SIGNUP_TTL_SECONDS,
  passwordKvKey,
  pwresetKvKey,
  signupKvKey,
  validatePasswordStrength,
  hashPasswordRecord,
  verifyPasswordRecord,
  setPassword,
  getPasswordRecord,
  deletePasswordRecord,
  hasPassword,
  verifyPassword,
  createPasswordResetToken,
  parsePasswordResetToken,
  consumePasswordResetToken,
  generateSignupToken,
  createPendingSignup,
  consumePendingSignup,
};
