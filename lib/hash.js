// Email-hash utility — Sprint BG-2.2 + apex P1.3 (salted pseudonym).
//
// Single source of truth for "what does an OrcaTrade email hash look like?"
// — used by lib/handlers/account.js (GDPR pseudonymisation), lib/handlers/audit.js
// (admin row redaction), and lib/events.js (dual-write to Postgres without
// storing raw emails).
//
// Two hash flavours
// ─────────────────
//   emailHash(email)        — LEGACY v1: SHA-256(lowercase(trim(email))), 16-hex.
//                             Deterministic, no salt. Vulnerable to dictionary /
//                             rainbow-table attack if the hash store is breached.
//                             Kept as the default for backward-compat with
//                             existing KV rows + PG events shipped against v1.
//
//   emailHashSalted(email)  — v2 (apex P1.3): HMAC-SHA256(EMAIL_PSEUDO_SALT, email),
//                             16-hex. Resistant to dictionary attack: even with
//                             the full hash store, an attacker without the salt
//                             can't pre-compute candidates. New writes SHOULD
//                             prefer this when EMAIL_PSEUDO_SALT is configured.
//
// Backwards compatibility
// ───────────────────────
// Existing data on KV + PG was written with the v1 hash. We don't rewrite history
// (events are an append-only audit log; lawful Article-17 erasure is the only
// modification path). Migration strategy:
//   - New writes: callers can opt into the v2 hash via emailHashSalted() once
//     the salt is configured.
//   - Lookups: when a salt is configured, the matching layer SHOULD compute both
//     hashes (legacy + salted) and look up under each — old rows match v1,
//     new rows match v2. See `matchingHashes(email)` below.
//
// Salt requirement
// ────────────────
// `EMAIL_PSEUDO_SALT` is a server-side env var (≥32 chars). If unset,
// emailHashSalted() throws — the salted path must NEVER silently fall back
// to v1 (a silent fallback would defeat the purpose). Callers that opt into
// the v2 path MUST ensure the salt is configured.
//
// We DELIBERATELY truncate to 16 hex characters (64 bits of entropy) — more
// than enough to avoid collisions at OrcaTrade's scale (~1M users would
// have a 1-in-billions chance of collision), but short enough to fit
// comfortably in dashboard cells + logs.

'use strict';

const crypto = require('node:crypto');

const HASH_LENGTH_HEX = 16;
const SALT_ENV_VAR = 'EMAIL_PSEUDO_SALT';
const MIN_SALT_LENGTH = 32;

function normaliseEmail(email) {
  if (email == null) return '';
  return String(email).toLowerCase().trim();
}

// v1 — legacy unsalted hash. Kept for backward compat with rows written
// before P1.3 landed. New writes should prefer emailHashSalted().
function emailHash(email) {
  const norm = normaliseEmail(email);
  if (!norm) return null;
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, HASH_LENGTH_HEX);
}

// Read + validate the configured salt. Throws if unset / too short — a
// silent fallback to v1 would defeat the purpose of salting.
function resolveSalt() {
  const salt = process.env[SALT_ENV_VAR];
  if (!salt || typeof salt !== 'string') {
    throw new Error(
      `${SALT_ENV_VAR} is not set. Generate a random ≥${MIN_SALT_LENGTH}-char value (e.g. ` +
      '`openssl rand -hex 32`) and set it on every environment. Without the salt the ' +
      'v2 hash silently degrades — emailHashSalted() refuses rather than fall back.',
    );
  }
  if (salt.length < MIN_SALT_LENGTH) {
    throw new Error(
      `${SALT_ENV_VAR} is too short (${salt.length} < ${MIN_SALT_LENGTH}). ` +
      'A short salt is brute-forceable against a small known-victim set.',
    );
  }
  return salt;
}

// v2 — apex P1.3. HMAC-SHA256 keyed by the server-side salt. Throws if the
// salt isn't configured (no silent fallback). Same 16-hex output shape as
// v1 so downstream storage doesn't change.
function emailHashSalted(email) {
  const norm = normaliseEmail(email);
  if (!norm) return null;
  const salt = resolveSalt();   // throws if unset / too short
  return crypto.createHmac('sha256', salt).update(norm).digest('hex').slice(0, HASH_LENGTH_HEX);
}

// Returns BOTH the v1 (legacy) and v2 (salted, when configured) hashes for
// the same email. Callers performing lookups against a mixed-version store
// can check membership under each. Returns { v1, v2 } where v2 is null if
// the salt isn't configured. v1 is always present (it's the default).
function matchingHashes(email) {
  const v1 = emailHash(email);
  let v2 = null;
  try { v2 = emailHashSalted(email); }
  catch (_) { /* salt not configured — v2 stays null */ }
  return { v1, v2 };
}

// Whether the configured environment supports the salted v2 path.
// Boolean — does NOT throw. Useful for handlers that want to log
// "writing v2" vs "writing v1" without surfacing the no-salt error.
function isSaltedHashConfigured() {
  try { resolveSalt(); return true; }
  catch (_) { return false; }
}

// Reverse-lookup helper used by the audit dashboard's row redactor when a
// payload already carries a pseudonym (post-Article-17). We leave such
// values alone instead of re-hashing them, because the pseudonym IS the
// identity link for that deleted user.
function isAlreadyPseudonym(email) {
  return typeof email === 'string' && email.startsWith('deleted-') && email.endsWith('@anonymised.local');
}

module.exports = {
  emailHash,
  emailHashSalted,
  matchingHashes,
  isSaltedHashConfigured,
  normaliseEmail,
  isAlreadyPseudonym,
  HASH_LENGTH_HEX,
  SALT_ENV_VAR,
  MIN_SALT_LENGTH,
};
