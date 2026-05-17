// Email-hash utility — Sprint BG-2.2.
//
// Single source of truth for "what does an OrcaTrade email hash look like?"
// — used by lib/handlers/account.js (GDPR pseudonymisation), lib/handlers/audit.js
// (admin row redaction), and lib/events.js (dual-write to Postgres without
// storing raw emails).
//
// Contract: deterministic + case-insensitive + trim-stable. The same user
// always hashes to the same 16-hex value, so:
//   - audit dashboard can correlate events across time
//   - Article 17 deletions pseudonymise to a consistent identity
//   - Postgres event rows can be joined back to a user without ever seeing
//     the raw email column
//
// We DELIBERATELY truncate to 16 hex characters (64 bits of entropy) — more
// than enough to avoid collisions at OrcaTrade's scale (~1M users would
// have a 1-in-billions chance of collision), but short enough to fit
// comfortably in dashboard cells + logs.

'use strict';

const crypto = require('node:crypto');

const HASH_LENGTH_HEX = 16;

function normaliseEmail(email) {
  if (email == null) return '';
  return String(email).toLowerCase().trim();
}

function emailHash(email) {
  const norm = normaliseEmail(email);
  if (!norm) return null;
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, HASH_LENGTH_HEX);
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
  normaliseEmail,
  isAlreadyPseudonym,
  HASH_LENGTH_HEX,
};
