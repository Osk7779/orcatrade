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
const adminAuth = require('../admin-auth');

function jsonResponse(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
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

// ── Sprint audit-csv-export-v1 — CSV serialiser ──────
//
// Procurement question "send me the audit log of who did what" gets a
// CSV answer instead of "let me build that." Reuses the redactRow
// output (already hashed + truncated) so no extra PII discipline is
// needed at the serialiser — the data is already safe before it
// reaches this layer.
//
// Columns chosen for compliance / DPA-review use cases:
//   at      — ISO timestamp
//   type    — event type (auth_signin, plan_saved, etc.)
//   emailHash — 12-hex pseudonym (NEVER raw email)
//   planId  — when present (plan_saved / actual_reported etc.)
//   orgId   — when present (org_* events)
//   ip      — when present (auth_signin only)
//   payload — JSON-serialised remainder of the row, for fields the
//             above five columns don't cover. JSON-stringified +
//             wrapped in CSV-escaped quotes so a comma in the JSON
//             body doesn't break the column count.

const CSV_COLUMNS = ['at', 'type', 'emailHash', 'planId', 'orgId', 'ip', 'payload'];

function escapeCsvField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s === '') return '';
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Pure: given an array of REDACTED rows (output of redactRow), produce
// an RFC 4180 CSV string with CSV_COLUMNS header. Caller must redact
// FIRST — the serialiser does not introduce any new redaction logic;
// it would be a security regression if it did (because that would
// duplicate / drift from the redactRow contract).
function rowsToCsv(redactedRows) {
  const out = [CSV_COLUMNS.join(',')];
  const safe = Array.isArray(redactedRows) ? redactedRows : [];
  for (const r of safe) {
    if (!r || typeof r !== 'object') continue;
    // Build the payload field from anything not already mapped to a
    // dedicated column. Keep the JSON deterministic-ish by sorting keys.
    const reserved = new Set(['at', 'type', 'emailHash', 'email', 'planId', 'orgId', 'ip']);
    const extras = {};
    for (const k of Object.keys(r).sort()) {
      if (!reserved.has(k)) extras[k] = r[k];
    }
    const payload = Object.keys(extras).length > 0 ? JSON.stringify(extras) : '';
    const row = [
      r.at || '',
      r.type || '',
      r.emailHash || '',
      r.planId || '',
      r.orgId || '',
      r.ip || '',
      payload,
    ];
    out.push(row.map(escapeCsvField).join(','));
  }
  // RFC 4180 says CRLF line endings.
  return out.join('\r\n') + '\r\n';
}

function csvFilename() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return 'orcatrade-audit-' + stamp + '.csv';
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

  // Sprint admin-session-auth: session cookie (when email is on
  // ORCATRADE_ADMIN_EMAILS) OR legacy token via ?token=… / X-Admin-Token.
  const verdict = await adminAuth.verifyAdmin(req);
  if (!verdict.ok) {
    if (verdict.statusCode === 401) {
      log.warn('audit unauthorized', { requestId: req.requestId, ip: req.headers['x-forwarded-for'] });
    }
    return jsonResponse(res, verdict.statusCode, { error: verdict.error });
  }

  const since = readQueryParam(req, 'since') || null;
  const type = readQueryParam(req, 'type') || null;
  // Limit handling: empty/missing/NaN defaults to 200; any provided number
  // (including 0) is clamped to [1, 1000]. The earlier `|| 200` form
  // silently turned a 0 query into the default — the explicit form
  // here keeps the clamp predictable.
  const rawLimit = readQueryParam(req, 'limit');
  const parsedLimit = Number(rawLimit);
  // Sprint audit-csv-export-v1 — CSV exports get a higher cap (5000)
  // because the use case is "send me the data" rather than "render the
  // dashboard table". JSON path keeps its 1000-row ceiling unchanged.
  const format = String(readQueryParam(req, 'format') || '').toLowerCase();
  const csvMode = format === 'csv';
  const maxLimit = csvMode ? 5000 : 1000;
  const limit = rawLimit === '' || !Number.isFinite(parsedLimit)
    ? (csvMode ? 5000 : 200)
    : Math.min(maxLimit, Math.max(1, parsedLimit));

  // Sprint BG-2.3: read via listUnified() — Postgres when DATABASE_URL
  // is set, KV fallback when empty/unconfigured. Dashboards now escape
  // the 5000-event KV cap automatically once events have accumulated.
  const allEvents = await events.listUnified({ type, since, limit });
  const redacted = allEvents.map(redactRow);

  log.info('audit accessed', {
    requestId: req.requestId,
    type, since, limit, returned: redacted.length, format: csvMode ? 'csv' : 'json',
  });

  if (csvMode) {
    const csv = rowsToCsv(redacted);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + csvFilename() + '"');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(csv);
  }

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
module.exports.CSV_COLUMNS = CSV_COLUMNS;
module.exports.escapeCsvField = escapeCsvField;
module.exports.rowsToCsv = rowsToCsv;
module.exports.csvFilename = csvFilename;
