// User notification preferences — Sprint prefs-v1.
//
// Today the only outbound user-comm is plan-revision-emails (driven
// from lib/handlers/cron.js). The cron has been sending without an
// explicit opt-in surface — defensible as "service-related" since
// the user actively saved the plan we're emailing them about, but
// a real compliance / UX gap.
//
// This module is the prefs storage + opt-out layer:
//   - getPrefs(email)                    → { planRevisionEmails }
//   - setPrefs(email, partial)           → merged record
//   - isEnabled(email, key)              → boolean (default true)
//   - generateUnsubscribeToken(email)    → HMAC-signed token
//   - verifyUnsubscribeToken(token)      → email | null
//
// Default for every pref is `true` (backwards-compatible — users
// who created their account before this sprint keep getting their
// plan-revision emails until they explicitly opt out).
//
// Unsubscribe-token shape: `<email-base64url>.<hmac-hex>`. HMAC is
// SHA-256 of the email using ORCATRADE_AUTH_SECRET. No expiry —
// the token is per-email-forever; revocation is not a use case
// (the user always has the option to re-opt-in via /account/preferences/).

'use strict';

const crypto = require('node:crypto');
const kv = require('./intelligence/kv-store');

const PREFS_KEY_PREFIX = 'prefs:';
const PREFS_TTL_DAYS = 2 * 365; // 2 years — refresh on every change

// Keys here have to match the booleans we read in lib/handlers/cron.js
// and surface in /account/preferences/. Adding a new key is a 3-line
// change: add to PREF_KEYS, ALLOWED_PREFS, and the UI.
const PREF_KEYS = ['planRevisionEmails'];

function normaliseEmail(email) {
  return String(email || '').toLowerCase().trim();
}

function prefsKey(email) {
  return PREFS_KEY_PREFIX + normaliseEmail(email);
}

function defaultPrefs() {
  // Every shipping pref defaults to TRUE — opt-out semantics. A user
  // who has never visited /account/preferences/ keeps receiving the
  // emails they've been receiving since BG-J.
  const out = {};
  for (const k of PREF_KEYS) out[k] = true;
  return out;
}

async function getPrefs(email) {
  const e = normaliseEmail(email);
  if (!e) return defaultPrefs();
  const rec = await kv.get(prefsKey(e));
  if (!rec || typeof rec !== 'object') return defaultPrefs();
  // Merge over defaults so a new pref key added in a later sprint
  // returns its default rather than undefined.
  const out = defaultPrefs();
  for (const k of PREF_KEYS) {
    if (typeof rec[k] === 'boolean') out[k] = rec[k];
  }
  return out;
}

async function setPrefs(email, partial) {
  const e = normaliseEmail(email);
  if (!e) throw new Error('setPrefs: email required');
  const safe = (partial && typeof partial === 'object') ? partial : {};
  const current = await getPrefs(e);
  // Only accept known pref keys — silently drop anything else.
  for (const k of PREF_KEYS) {
    if (typeof safe[k] === 'boolean') current[k] = safe[k];
  }
  const stored = {
    ...current,
    updatedAt: new Date().toISOString(),
  };
  await kv.set(prefsKey(e), stored, { ttlSeconds: PREFS_TTL_DAYS * 24 * 60 * 60 });
  return stored;
}

async function isEnabled(email, key) {
  if (!PREF_KEYS.includes(key)) return false;
  const prefs = await getPrefs(email);
  return prefs[key] === true;
}

// ── Unsubscribe-token signing / verification ─────────────

function authSecret() {
  // Reuse the auth-cookie secret. It's already in production for
  // session signing; we lean on the same KMS posture.
  return process.env.ORCATRADE_AUTH_SECRET || 'dev-fallback-orcatrade-prefs';
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function generateUnsubscribeToken(email) {
  const e = normaliseEmail(email);
  if (!e) throw new Error('generateUnsubscribeToken: email required');
  const encoded = base64url(e);
  const sig = crypto.createHmac('sha256', authSecret()).update(encoded).digest('hex');
  return encoded + '.' + sig;
}

// Returns the email if the token is valid, null otherwise. Constant-
// time comparison so a guessing attack can't time-side-channel a
// valid signature.
function verifyUnsubscribeToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;
  const expected = crypto.createHmac('sha256', authSecret()).update(encoded).digest('hex');
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch (_) {
    return null;
  }
  let email;
  try { email = base64urlDecode(encoded); }
  catch (_) { return null; }
  return normaliseEmail(email) || null;
}

module.exports = {
  PREFS_KEY_PREFIX,
  PREFS_TTL_DAYS,
  PREF_KEYS,
  prefsKey,
  defaultPrefs,
  getPrefs,
  setPrefs,
  isEnabled,
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
};
