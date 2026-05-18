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

  // Sprint BG-2.3: read via listUnified() — Postgres when DATABASE_URL
  // is set, KV fallback when empty/unconfigured. The aggregator works
  // on either shape because PG rows carry the same flat payload fields
  // (with email stripped + replaced by emailHash).
  const log = await events.listUnified({ type, since, limit });
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
