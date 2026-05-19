// /api/leads — conversion analytics summary (Sprint 36).
//
// Token-gated GET endpoint that aggregates events from lib/events into
// summary tiles for /dashboard/leads/. Auth via env-var
// ORCATRADE_LEADS_TOKEN — set this on Vercel (Production env), pass as
// `?token=<value>` from the dashboard page. The page itself is static
// and noindex; the token is the only access control.
//
//   GET /api/leads?token=…&since=YYYY-MM-DD&type=import_plan_generated
//
// Returns: { ok, asOf, mode, summary, mostRecent, since }
// 401 if token missing or wrong.

'use strict';

const crypto = require('node:crypto');
const events = require('../events');
const kv = require('../intelligence/kv-store');
const adminAuth = require('../admin-auth');

function jsonResponse(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readQueryParam(req, name) {
  if (req.query && req.query[name] != null) return String(req.query[name]);
  const url = req.url || '';
  const qs = url.split('?')[1] || '';
  const params = new URLSearchParams(qs);
  return params.get(name) || '';
}

// ── Sprint leads-csv-export-v1 — CSV serialiser ──────
//
// Escapes per RFC 4180: wrap in double-quotes when the field contains
// a comma, newline, or embedded double-quote; double up any embedded
// quotes. Null/undefined become the empty string.

// Columns chosen for procurement/investor diligence. The PII discipline
// matches the audit dashboard: NO raw email at the wire. emailHash is
// surfaced when it exists (PG dual-write path), the email-captured
// boolean otherwise — so a reader can do per-user correlation without
// the raw identity ever leaving the server.
const CSV_COLUMNS = [
  'at', 'type', 'locale',
  'productCategory', 'originCountry', 'destinationCountry', 'route',
  'landedTotalEur', 'hsCodeProvided', 'hsCodeLength', 'dutyMfnSource',
  'emailCaptured', 'emailHash',
];

function escapeCsvField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s === '') return '';
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function hashEmail(email) {
  return crypto.createHash('sha256').update(String(email).toLowerCase().trim()).digest('hex').slice(0, 12);
}

// Pure: given the event log, return an RFC 4180 CSV string with the
// CSV_COLUMNS header. PG-shape rows already carry emailHash; KV-shape
// rows carry raw email — we hash it here so raw addresses NEVER make
// it onto the wire. Both shapes flow through the same projection so
// the CSV reader doesn't need to know which storage backed the row.
function eventsToCsv(eventLog) {
  const rows = [CSV_COLUMNS.join(',')];
  const safe = Array.isArray(eventLog) ? eventLog : [];
  for (const e of safe) {
    const inputs = e.inputs || {};
    const route = inputs.originCountry && inputs.destinationCountry
      ? inputs.originCountry + '→' + inputs.destinationCountry
      : '';
    let emailHash = e.emailHash || null;
    if (!emailHash && e.email && !String(e.email).startsWith('deleted-')) {
      emailHash = hashEmail(e.email);
    }
    const row = [
      e.at || '',
      e.type || '',
      e.locale || '',
      inputs.productCategory || '',
      inputs.originCountry || '',
      inputs.destinationCountry || '',
      route,
      Number.isFinite(Number(e.landedTotal)) && Number(e.landedTotal) > 0 ? Math.round(Number(e.landedTotal)) : '',
      e.hsCodeProvided === true ? 'true' : (e.hsCodeProvided === false ? 'false' : ''),
      e.hsCodeLength != null ? e.hsCodeLength : '',
      e.dutyMfnSource || '',
      e.emailProvided === true ? 'true' : (e.emailProvided === false ? 'false' : ''),
      emailHash || '',
    ];
    rows.push(row.map(escapeCsvField).join(','));
  }
  // RFC 4180 says CRLF line endings.
  return rows.join('\r\n') + '\r\n';
}

function csvFilename() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return 'orcatrade-leads-' + stamp + '.csv';
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
    return jsonResponse(res, verdict.statusCode, { error: verdict.error });
  }

  const since = readQueryParam(req, 'since') || null;
  const type = readQueryParam(req, 'type') || null;
  const limit = Number(readQueryParam(req, 'limit')) || 1000;
  const format = String(readQueryParam(req, 'format') || '').toLowerCase();

  // Sprint BG-2.3: read via listUnified() — Postgres when DATABASE_URL
  // is set, KV fallback when empty/unconfigured. The aggregator works
  // on either shape because PG rows carry the same flat payload fields
  // (with email stripped + replaced by emailHash).
  const log = await events.listUnified({ type, since, limit });

  // Sprint leads-csv-export-v1 — branch on ?format=csv. Returns an
  // RFC 4180 CSV with the event projection (no raw email, ever).
  if (format === 'csv') {
    const csv = eventsToCsv(log);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + csvFilename() + '"');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(csv);
  }

  const summary = events.aggregate(log);

  return jsonResponse(res, 200, {
    ok: true,
    asOf: new Date().toISOString(),
    mode: kv.getMode(),
    since,
    type,
    summary,
  });
};

// Test surface
module.exports.CSV_COLUMNS = CSV_COLUMNS;
module.exports.escapeCsvField = escapeCsvField;
module.exports.eventsToCsv = eventsToCsv;
module.exports.csvFilename = csvFilename;
