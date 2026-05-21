// RFC 6238 TOTP (time-based one-time passwords) — Sprint mfa-totp-v1.
//
// Zero-dep, node:crypto only — same philosophy as lib/stripe.js. We do
// NOT pull `otplib` or `speakeasy`: TOTP is ~80 lines of well-specified
// HMAC, and avoiding the dep keeps cold starts fast and the supply
// chain small.
//
// Standard parameters (Google Authenticator / Authy / 1Password compatible):
//   - HMAC-SHA1 (the de-facto authenticator default; SHA256/512 exist
//     but many apps don't support them, so SHA1 maximises compatibility)
//   - 6 digits
//   - 30-second time step
//   - T0 = 0 (Unix epoch)
//
// Secrets are generated as raw bytes, stored hex, and surfaced base32 for
// the otpauth:// URI + manual key entry (authenticator apps speak base32).
//
// Public API:
//   generateSecretHex()                       → 40-hex (20 bytes, 160 bits)
//   base32Encode(buffer)                       → RFC 4648 base32, no padding
//   otpauthUri({ secretHex, email, issuer })   → otpauth://totp/... URI
//   totp(secretHex, { now })                   → current 6-digit code
//   verifyTotp(secretHex, code, { window, now })→ bool, constant-time-ish

'use strict';

const crypto = require('node:crypto');

const DIGITS = 6;
const STEP_SECONDS = 30;
const SECRET_BYTES = 20; // 160 bits, RFC 4226 recommended minimum

// ── base32 (RFC 4648, no padding) ───────────────────────

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += B32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

// ── Secret generation ───────────────────────────────────

function generateSecretHex() {
  return crypto.randomBytes(SECRET_BYTES).toString('hex');
}

// ── otpauth:// URI ──────────────────────────────────────
//
// Format: otpauth://totp/<issuer>:<account>?secret=<base32>&issuer=<issuer>&algorithm=SHA1&digits=6&period=30
function otpauthUri({ secretHex, email, issuer = 'OrcaTrade' }) {
  const secretB32 = base32Encode(Buffer.from(secretHex, 'hex'));
  // Label is "issuer:account" — the colon is the separator and stays
  // literal (per the otpauth spec / Google Authenticator); only the two
  // sides are percent-encoded.
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── HOTP / TOTP core ────────────────────────────────────

function hotp(secretBytes, counter) {
  // 8-byte big-endian counter
  const buf = Buffer.alloc(8);
  // counter can exceed 32 bits; write as two 32-bit halves.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', secretBytes).update(buf).digest();
  // Dynamic truncation (RFC 4226 §5.3)
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  const otp = binCode % Math.pow(10, DIGITS);
  return String(otp).padStart(DIGITS, '0');
}

function counterFor(now) {
  const seconds = Math.floor((now != null ? now : Date.now()) / 1000);
  return Math.floor(seconds / STEP_SECONDS);
}

function totp(secretHex, { now } = {}) {
  if (!secretHex || !/^[a-f0-9]+$/i.test(secretHex)) return null;
  const secretBytes = Buffer.from(secretHex, 'hex');
  return hotp(secretBytes, counterFor(now));
}

// Verify a candidate code against the secret, allowing ±`window` steps
// to absorb clock skew + the user typing across a step boundary. Default
// window=1 means the code is valid for ~90s (previous, current, next step).
function verifyTotp(secretHex, code, { window = 1, now } = {}) {
  if (!secretHex || !/^[a-f0-9]+$/i.test(secretHex)) return false;
  if (typeof code !== 'string') code = String(code == null ? '' : code);
  const normalised = code.replace(/\s+/g, '');
  if (!/^[0-9]{6}$/.test(normalised)) return false;
  const secretBytes = Buffer.from(secretHex, 'hex');
  const base = counterFor(now);
  for (let i = -window; i <= window; i++) {
    const candidate = hotp(secretBytes, base + i);
    // Constant-time compare per candidate (both fixed 6-digit strings).
    const a = Buffer.from(candidate);
    const b = Buffer.from(normalised);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

module.exports = {
  DIGITS,
  STEP_SECONDS,
  SECRET_BYTES,
  base32Encode,
  generateSecretHex,
  otpauthUri,
  hotp,
  totp,
  verifyTotp,
};
