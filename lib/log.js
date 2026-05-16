// Structured logging helper.
//
// Replaces ad-hoc console.log/warn/error in handlers with one-line
// JSON-per-event output that's greppable in Vercel logs and ready to
// pipe into Sentry / Axiom / Datadog without further structuring.
//
// Why: today's lib/handlers/* uses console.* with string interpolation
// — fine for `tail -f` but invisible to log aggregators. Structured JSON
// makes every event filterable by level / event / request-id / handler
// without writing a parser. Track 4.1 of backend-grade-plan.md.
//
// Usage:
//   const log = require('../log');
//   log.info('founding application accepted', { spot: 7, email });
//   log.warn('resend rate-limited', { status: 429 });
//   log.error('upstream timeout', { url, durationMs });
//
// Per-handler context via withContext (so each handler doesn't repeat itself):
//   const log = require('../log').withContext({ handler: 'auth', action: 'verify' });
//   log.info('magic link verified', { ttlSec: 900 });   // automatic handler/action fields
//
// Levels (lowest → highest): debug, info, warn, error.
// ORCATRADE_LOG_LEVEL env var sets the floor (default: info). Anything below
// is dropped — keeps prod logs lean.
//
// PII redaction: any extras field whose key matches a PII signal
// (email, token, password, secret, apiKey, cookie, auth, authorization)
// has its value masked to its first two characters + ***. Nested objects
// are walked recursively. This is a belt-and-braces — handlers should still
// not pass secrets in, but if they do, we don't leak them to logs.

'use strict';

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

function resolveMinLevel() {
  const raw = (process.env.ORCATRADE_LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[raw] != null ? LEVELS[raw] : LEVELS.info;
}

// PII signals. Matched case-insensitively on the key.
const PII_KEYS = new Set([
  'email', 'emails',
  'token', 'tokens', 'apitoken', 'authtoken', 'magic_token', 'magictoken',
  'password', 'passcode', 'pwd',
  'secret', 'apikey', 'api_key',
  'cookie', 'cookies',
  'authorization', 'auth',
  'sessionid', 'session_id',
]);

function maskString(s) {
  if (typeof s !== 'string') return '[redacted]';
  if (s.length <= 3) return '[redacted]';
  return s.slice(0, 2) + '***';
}

function redact(obj, depth = 0) {
  if (depth > 6) return '[depth-limit]'; // defensive, no real cycles in our payloads
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map(v => redact(v, depth + 1));
  if (typeof obj !== 'object') return obj;
  if (obj instanceof Error) {
    return { name: obj.name, message: obj.message, stack: obj.stack };
  }
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (PII_KEYS.has(k.toLowerCase())) {
      out[k] = typeof v === 'string' ? maskString(v) : '[redacted]';
    } else if (v && typeof v === 'object') {
      out[k] = redact(v, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function emit(levelName, message, extras, baseContext) {
  if (LEVELS[levelName] < resolveMinLevel()) return;
  const payload = {
    ts: new Date().toISOString(),
    level: levelName,
    msg: typeof message === 'string' ? message : String(message),
  };
  if (baseContext) Object.assign(payload, baseContext);
  if (extras && typeof extras === 'object') {
    Object.assign(payload, redact(extras));
  }
  const line = JSON.stringify(payload);
  // Use the matching console method so log aggregators preserve severity.
  if (levelName === 'error') {
    // eslint-disable-next-line no-console
    console.error(line);
  } else if (levelName === 'warn') {
    // eslint-disable-next-line no-console
    console.warn(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

function makeApi(baseContext) {
  return {
    debug: (msg, extras) => emit('debug', msg, extras, baseContext),
    info: (msg, extras) => emit('info', msg, extras, baseContext),
    warn: (msg, extras) => emit('warn', msg, extras, baseContext),
    error: (msg, extras) => emit('error', msg, extras, baseContext),
    withContext: (extra) => makeApi({ ...(baseContext || {}), ...extra }),
  };
}

const root = makeApi(null);

// Request-id generator. Crypto-strong, 12 hex chars — enough entropy for
// log correlation, short enough to fit a curl `-H "x-request-id: ..."`.
function generateRequestId() {
  // Node 16+ exposes crypto on globalThis; fall back to Math.random for
  // any exotic runtime (and yes, that fallback is fine for a log id —
  // it's not a security token).
  try {
    const crypto = require('node:crypto');
    return crypto.randomBytes(6).toString('hex');
  } catch (_) {
    return Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }
}

module.exports = Object.assign(root, {
  LEVELS,
  PII_KEYS,
  redact,
  generateRequestId,
  // Exposed for tests + internal callers that want to assert on level cutoffs.
  _resolveMinLevel: resolveMinLevel,
});
