// KV TTL hygiene — apex plan P1.14 ("Rate-limit TTL hygiene").
//
// The plan's phrasing: "TTL on every counter; test fails on TTL-less KV write."
// Read narrowly that means every `kv.incr(...)` call (counters) must pass
// ttlSeconds. Read more broadly it means every KV key that represents
// transient/ephemeral state — magic tokens, password-reset tokens, MFA
// challenge IDs, rate-limit counters, session caches — must expire.
//
// Why this is load-bearing:
//   1. Vercel KV / Upstash Redis has size caps. Unbounded growth eventually
//      breaks the platform.
//   2. Magic tokens without TTL stay valid forever — a leaked link from
//      six months ago could still sign someone in.
//   3. Rate-limit counters without TTL never reset — a user who tripped
//      the limit once is throttled until manual KV intervention.
//
// What this test pins:
//   - Every `kv.incr(<key>, ...)` call passes `ttlSeconds:` in the options.
//     Counters that don't reset are the most common bug class.
//   - Every kv.set call whose key name looks ephemeral (magic-token,
//     reset-token, mfa-challenge, signup-token, session, rate-, throttle-)
//     passes `ttlSeconds`. Names that look DURABLE (account, password,
//     mfa-config without "challenge") are exempt — those are intentionally
//     long-lived state.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIB_DIR = path.join(ROOT, 'lib');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && full.endsWith('.js')) out.push(full);
  }
  return out;
}

function stripCommentsAndStrings(src) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.split('\n').map(line => {
    const idx = line.indexOf('//');
    return idx === -1 ? line : line.slice(0, idx);
  }).join('\n');
  // For TTL detection we KEEP strings — the kv key name encodes intent
  // ("rate:foo" vs "account:foo") — but neutralise comments only.
  return out;
}

// ── Counter discipline ────────────────────────────────────────

test('every kv.incr() call passes ttlSeconds', () => {
  const offenders = [];
  for (const file of walk(LIB_DIR)) {
    const src = stripCommentsAndStrings(fs.readFileSync(file, 'utf8'));
    const re = /\bkv\.incr\s*\(([^)]*)\)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const args = m[1];
      if (!/\bttlSeconds\s*:/.test(args)) {
        const line = src.slice(0, m.index).split('\n').length;
        const rel = path.relative(ROOT, file);
        offenders.push(`${rel}:${line}: kv.incr() without ttlSeconds`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `kv.incr() calls missing ttlSeconds (counters that never reset):\n  ${offenders.join('\n  ')}\n\n` +
    'A counter without TTL never resets — a user who tripped the rate limit once stays throttled forever ' +
    'unless an admin clears the key by hand. Pass ttlSeconds in the options object on every incr().');
});

// ── Ephemeral-name discipline ─────────────────────────────────

// Substrings in a KV key name that signal ephemeral / token / counter
// state. If the key name contains one of these AND the kv.set call
// doesn't pass ttlSeconds, the write is suspicious.
const EPHEMERAL_NAME_SIGNALS = Object.freeze([
  'magic-token', 'magic_token', 'magictoken',
  'reset-token', 'reset_token', 'resettoken',
  'signup-token', 'signup_token', 'signuptoken',
  'verify-token', 'verifytoken',
  'session:', 'session-',
  'rate:', 'rate-', 'ratelimit:', 'throttle:',
  'mfa-challenge', 'mfa_challenge',
  'csrf', 'nonce:',
  'cooldown',
]);

// Per-file allowlist for legitimate persist-forever cases that happen
// to match a substring. Empty today; add with a justification comment.
const PER_FILE_ALLOWLIST = Object.freeze({});

test('kv.set with an ephemeral-looking key passes ttlSeconds', () => {
  const offenders = [];
  for (const file of walk(LIB_DIR)) {
    const rel = path.relative(ROOT, file);
    const allowed = new Set(PER_FILE_ALLOWLIST[rel] || []);
    const src = stripCommentsAndStrings(fs.readFileSync(file, 'utf8'));

    // Match kv.set(<key-expr>, <value>, <opts>) — opts is optional.
    // We approximate the first arg with a "until first comma at depth 0"
    // walk because key expressions can include function calls.
    const re = /\bkv\.set\s*\(([\s\S]*?)\)\s*[;,)]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const fullArgs = m[1];
      // Quick pre-filter — if ttlSeconds appears anywhere in the args
      // block, the call is compliant; skip.
      if (/\bttlSeconds\s*:/.test(fullArgs)) continue;

      // Does the args block reference one of the ephemeral signals?
      const lowered = fullArgs.toLowerCase();
      const hit = EPHEMERAL_NAME_SIGNALS.find(sig => lowered.includes(sig));
      if (!hit) continue;
      if (allowed.has(hit)) continue;

      const line = src.slice(0, m.index).split('\n').length;
      offenders.push(`${rel}:${line}: kv.set with ephemeral signal "${hit}" but no ttlSeconds`);
    }
  }
  assert.deepEqual(offenders, [],
    `kv.set calls with ephemeral-looking keys but no ttlSeconds:\n  ${offenders.join('\n  ')}\n\n` +
    'A key name containing one of these substrings: ' + EPHEMERAL_NAME_SIGNALS.join(', ') + '\n' +
    'is a strong signal that the value is supposed to expire. Without ttlSeconds:\n' +
    '  - a magic token from six months ago stays valid forever (auth bypass risk)\n' +
    '  - a rate-limit hit throttles the user permanently (until manual KV intervention)\n' +
    '  - a session cache fills KV until storage caps are hit.\n' +
    'If this is genuinely persistent state with a name that happens to match, add a ' +
    'PER_FILE_ALLOWLIST entry with a justification comment.');
});

// ── Defensive: the test itself is calibrated ──────────────────

test('the ephemeral-signal list is non-trivial', () => {
  // A future "simplification" that empties the list would silently
  // disable the gate. Pin a floor.
  assert.ok(EPHEMERAL_NAME_SIGNALS.length >= 10,
    `EPHEMERAL_NAME_SIGNALS shrunk to ${EPHEMERAL_NAME_SIGNALS.length} entries — must keep ≥10 ` +
    '(covers magic tokens, reset tokens, sessions, rate-limits, MFA, CSRF/nonces, cooldowns).');
});
