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

function buildSetCookieHeader(value, { maxAgeSeconds = SESSION_TTL_DAYS * 24 * 60 * 60, secure = true } = {}) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAgeSeconds}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function buildClearCookieHeader() {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure`;
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
};
