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

function jsonResponse(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function expectedToken() {
  return process.env.ORCATRADE_LEADS_TOKEN || '';
}

// Constant-time compare so a slow attacker can't time out the right token.
function tokensMatch(a, b) {
  if (!a || !b) return false;
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
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

  // Auth
  const expected = expectedToken();
  if (!expected) {
    return jsonResponse(res, 503, { error: 'Leads dashboard not configured (set ORCATRADE_LEADS_TOKEN)' });
  }
  const provided = readQueryParam(req, 'token');
  if (!tokensMatch(provided, expected)) {
    return jsonResponse(res, 401, { error: 'Unauthorized' });
  }

  const since = readQueryParam(req, 'since') || null;
  const type = readQueryParam(req, 'type') || null;
  const limit = Number(readQueryParam(req, 'limit')) || 1000;

  const log = await events.list({ type, since, limit });
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
