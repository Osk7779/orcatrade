// Apex P1.3 — salted email pseudonym (HMAC-SHA256).
//
// Tests cover:
//   - emailHash (v1 legacy unsalted) preserved unchanged for back-compat
//   - emailHashSalted (v2) uses HMAC-SHA256 + EMAIL_PSEUDO_SALT
//   - emailHashSalted REFUSES to fall back to v1 when salt is unset
//     (silent fallback would defeat the purpose)
//   - Short-salt rejection (brute-force defence)
//   - matchingHashes returns both forms for mixed-version stores
//   - isSaltedHashConfigured exposes a no-throw boolean

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Reset env between tests via a helper.
const ORIGINAL_SALT = process.env.EMAIL_PSEUDO_SALT;
function setSalt(value) {
  if (value == null) delete process.env.EMAIL_PSEUDO_SALT;
  else process.env.EMAIL_PSEUDO_SALT = value;
}

test.after(() => setSalt(ORIGINAL_SALT));

// hash.js reads process.env.EMAIL_PSEUDO_SALT at call time, not at
// require time, so we can require once and toggle the env between
// tests. Confirm that contract.
const hash = require('../lib/hash');

// ── v1 legacy: deterministic, unsalted ───────────────────────

test('emailHash: v1 hash is deterministic + case-insensitive', () => {
  const a = hash.emailHash('Alice@Example.COM');
  const b = hash.emailHash('  alice@example.com  ');
  assert.equal(a, b, 'normalisation strips case + whitespace');
  assert.match(a, /^[0-9a-f]{16}$/, '16-hex output');
});

test('emailHash: v1 hash does NOT depend on the salt env var', () => {
  setSalt('abcdefghijklmnopqrstuvwxyz0123456789abcdef');
  const withSalt = hash.emailHash('alice@example.com');
  setSalt(null);
  const withoutSalt = hash.emailHash('alice@example.com');
  assert.equal(withSalt, withoutSalt,
    'v1 must NOT silently absorb the salt — it would break back-compat');
});

test('emailHash: empty / null input returns null', () => {
  assert.equal(hash.emailHash(null), null);
  assert.equal(hash.emailHash(''), null);
  assert.equal(hash.emailHash('   '), null);
});

// ── v2 salted: requires EMAIL_PSEUDO_SALT ────────────────────

test('emailHashSalted: throws when EMAIL_PSEUDO_SALT is unset', () => {
  setSalt(null);
  assert.throws(() => hash.emailHashSalted('alice@example.com'),
    /EMAIL_PSEUDO_SALT is not set/);
});

test('emailHashSalted: throws on too-short salt (brute-force defence)', () => {
  setSalt('short');
  assert.throws(() => hash.emailHashSalted('alice@example.com'),
    /too short/);
});

test('emailHashSalted: deterministic + 16-hex when salt is configured', () => {
  setSalt('a'.repeat(40));
  const a = hash.emailHashSalted('alice@example.com');
  const b = hash.emailHashSalted('alice@example.com');
  assert.equal(a, b, 'same input + same salt → same output');
  assert.match(a, /^[0-9a-f]{16}$/, '16-hex output');
});

test('emailHashSalted: different salts → different hashes (rotation invariant)', () => {
  setSalt('a'.repeat(40));
  const withA = hash.emailHashSalted('alice@example.com');
  setSalt('b'.repeat(40));
  const withB = hash.emailHashSalted('alice@example.com');
  assert.notEqual(withA, withB, 'salt rotation produces fresh hashes');
});

test('emailHashSalted: v2 hash differs from v1 for the same email', () => {
  setSalt('a'.repeat(40));
  const v1 = hash.emailHash('alice@example.com');
  const v2 = hash.emailHashSalted('alice@example.com');
  assert.notEqual(v1, v2,
    'v2 must not collide with v1 — same email under different schemes is two different pseudonyms');
});

test('emailHashSalted: case-insensitive + trim-stable like v1', () => {
  setSalt('a'.repeat(40));
  const a = hash.emailHashSalted('Alice@Example.COM');
  const b = hash.emailHashSalted('  alice@example.com  ');
  assert.equal(a, b);
});

test('emailHashSalted: empty / null → null', () => {
  setSalt('a'.repeat(40));
  assert.equal(hash.emailHashSalted(null), null);
  assert.equal(hash.emailHashSalted(''), null);
});

// ── matchingHashes: dual lookup for mixed-version stores ─────

test('matchingHashes: returns v1 + v2 when salt is configured', () => {
  setSalt('a'.repeat(40));
  const r = hash.matchingHashes('alice@example.com');
  assert.match(r.v1, /^[0-9a-f]{16}$/);
  assert.match(r.v2, /^[0-9a-f]{16}$/);
  assert.notEqual(r.v1, r.v2);
});

test('matchingHashes: returns v1 + v2:null when salt is unset', () => {
  setSalt(null);
  const r = hash.matchingHashes('alice@example.com');
  assert.match(r.v1, /^[0-9a-f]{16}$/);
  assert.equal(r.v2, null, 'no salt → no v2');
});

// ── isSaltedHashConfigured ───────────────────────────────────

test('isSaltedHashConfigured: false when unset', () => {
  setSalt(null);
  assert.equal(hash.isSaltedHashConfigured(), false);
});

test('isSaltedHashConfigured: false when salt too short', () => {
  setSalt('short');
  assert.equal(hash.isSaltedHashConfigured(), false);
});

test('isSaltedHashConfigured: true when salt valid', () => {
  setSalt('a'.repeat(40));
  assert.equal(hash.isSaltedHashConfigured(), true);
});

// ── Defensive: no silent fallback ────────────────────────────

test('NO silent fallback — emailHashSalted never returns the v1 value when salt is unset', () => {
  // This is the load-bearing property of the apex P1.3 design. If
  // emailHashSalted silently fell back to v1 when the salt is unset,
  // a future code path that "uses salted hash" would silently store
  // unsalted hashes in production — defeating the purpose entirely.
  setSalt(null);
  const v1 = hash.emailHash('alice@example.com');
  try {
    const result = hash.emailHashSalted('alice@example.com');
    assert.fail(`expected throw, got ${result}`);
  } catch (err) {
    assert.match(err.message, /EMAIL_PSEUDO_SALT/);
    assert.notEqual(err.message, v1, 'error message must NOT contain the v1 hash');
  }
});

// ── Documentation contract ───────────────────────────────────

test('lib/hash.js documents the salt requirement + back-compat strategy', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'hash.js'), 'utf8');
  // Must reference HMAC-SHA256 + the env var name + back-compat
  assert.match(src, /HMAC-SHA256/i);
  assert.match(src, /EMAIL_PSEUDO_SALT/);
  assert.match(src, /back(?:wards|ward)[ -]compat/i);
  assert.match(src, /silent\s+fallback|silently/i);
});

test('.env.example documents EMAIL_PSEUDO_SALT', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const env = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  assert.match(env, /EMAIL_PSEUDO_SALT/);
  assert.match(env, /openssl rand -hex 32/);
});
