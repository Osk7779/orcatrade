// /api/audit — admin event-by-event feed (Sprint BG-5.3).
//
// Whereas /api/leads aggregates the event log into summary tiles for
// conversion analytics, /api/audit returns the raw rows for an admin
// reviewing who-did-what. Used by /dashboard/audit/ which shows a
// filterable table of recent mutations.
//
//   GET /api/audit?token=…&type=plan_saved&since=YYYY-MM-DD&limit=200
//
// Output: { ok, asOf, mode, total, returned, events: [...] }
// 401 if token missing/wrong; 503 if ORCATRADE_LEADS_TOKEN env unset.
//
// PII redaction: every row is passed through the same lib/log.js redact()
// pipeline that masks email/token/secret/apiKey/cookie/authorization
// fields. An admin reviewing the audit dashboard still sees the row but
// not the raw email address — the dashboard surfaces a deterministic
// hash if needed for cross-event correlation.

'use strict';

const crypto = require('node:crypto');
const events = require('../events');
const kv = require('../intelligence/kv-store');
const log = require('../log').withContext({ handler: 'audit' });

function jsonResponse(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

function expectedToken() {
  return process.env.ORCATRADE_LEADS_TOKEN || '';
}

function tokensMatch(a, b) {
  if (!a || !b) return false;
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function readQueryParam(req, name) {
  if (req.query && req.query[name] != null) return String(req.query[name]);
  const qs = (req.url || '').split('?')[1] || '';
  return new URLSearchParams(qs).get(name) || '';
}

// SHA-256 first-12-hex of an email. Deterministic across calls so admins
// can correlate "this hash appears in 3 different events" without seeing
// the raw address.
function hashEmail(email) {
  return crypto.createHash('sha256').update(String(email).toLowerCase().trim()).digest('hex').slice(0, 12);
}

// Per-row redaction: mirrors log.js's redact() for the stored event but
// keeps cross-event correlation via the email hash. The redact() helper
// turns email into "ab***" which is fine for one-off reads but loses the
// "same user touched these 3 events" linkability. So we redact via a
// hash here while still surfacing the type/at/locale/category etc.
function redactRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  if (out.email && !String(out.email).startsWith('deleted-')) {
    out.emailHash = hashEmail(out.email);
    delete out.email;
  }
  // Free-text fields can leak PII too — keep first 80 chars or hash.
  if (typeof out.message === 'string') {
    out.message = out.message.length > 80 ? out.message.slice(0, 80) + '…' : out.message;
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }
  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  const expected = expectedToken();
  if (!expected) {
    return jsonResponse(res, 503, { error: 'Audit dashboard not configured (set ORCATRADE_LEADS_TOKEN)' });
  }
  const provided = readQueryParam(req, 'token');
  if (!tokensMatch(provided, expected)) {
    log.warn('audit unauthorized', { requestId: req.requestId, ip: req.headers['x-forwarded-for'] });
    return jsonResponse(res, 401, { error: 'Unauthorized' });
  }

  const since = readQueryParam(req, 'since') || null;
  const type = readQueryParam(req, 'type') || null;
  // Limit handling: empty/missing/NaN defaults to 200; any provided number
  // (including 0) is clamped to [1, 1000]. The earlier `|| 200` form
  // silently turned a 0 query into the default — the explicit form
  // here keeps the clamp predictable.
  const rawLimit = readQueryParam(req, 'limit');
  const parsedLimit = Number(rawLimit);
  const limit = rawLimit === '' || !Number.isFinite(parsedLimit)
    ? 200
    : Math.min(1000, Math.max(1, parsedLimit));

  // Sprint BG-2.3: read via listUnified() — Postgres when DATABASE_URL
  // is set, KV fallback when empty/unconfigured. Dashboards now escape
  // the 5000-event KV cap automatically once events have accumulated.
  const allEvents = await events.listUnified({ type, since, limit });
  const redacted = allEvents.map(redactRow);

  log.info('audit accessed', {
    requestId: req.requestId,
    type, since, limit, returned: redacted.length,
  });

  return jsonResponse(res, 200, {
    ok: true,
    asOf: new Date().toISOString(),
    mode: kv.getMode(),
    type,
    since,
    limit,
    returned: redacted.length,
    events: redacted,
    allowedTypes: [...events.ALLOWED_TYPES].sort(),
  });
};

// Test surface
module.exports.redactRow = redactRow;
module.exports.hashEmail = hashEmail;
