// /api/calibration — cross-user calibration analytics (Sprint BG-1.6).
//
// Token-gated admin endpoint (same gate as /api/audit + /api/leads).
// Reads from lib/actuals.listFromPg() which JOINs actuals + saved_plans
// via the FK landed in BG-1.4 phase 1.5. Returns the operator-friendly
// summary an ops or product person uses to spot calculator drift:
//
//   GET /api/calibration?token=…&limit=1000
//
// Response:
//   {
//     ok, asOf, mode, sampleSize, total: { … },
//     byCategory: [{key, sampleSize, avgVariancePct, …}, …],
//     byOrigin:   [{key, …}, …],
//     byDestination: […],
//     byRoute:    […],
//   }
//
// PII discipline: rows from listFromPg() already carry only email_hash
// (never raw email — saved_plans + actuals are hash-keyed in PG).
// The handler never re-introduces email.

'use strict';

const actuals = require('../actuals');
const calibration = require('../calibration');
const kv = require('../intelligence/kv-store');
const log = require('../log').withContext({ handler: 'calibration' });
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
      log.warn('calibration unauthorized', {
        requestId: req.requestId, ip: req.headers['x-forwarded-for'],
      });
    }
    return jsonResponse(res, verdict.statusCode, { error: verdict.error });
  }

  // Limit handling matches /api/audit: empty/missing/NaN → 1000;
  // explicit number clamped to [1, 10000].
  const rawLimit = readQueryParam(req, 'limit');
  const parsedLimit = Number(rawLimit);
  const limit = rawLimit === '' || !Number.isFinite(parsedLimit)
    ? 1000
    : Math.min(10000, Math.max(1, parsedLimit));

  const rows = await actuals.listFromPg({ limit });
  const summary = calibration.summarise(rows);
  // Sprint BG-1.7 — surface alerts in the response so the dashboard
  // can render a "current alerts" pill without re-running the
  // aggregator. Same function the cron uses, so dashboard and Sentry
  // never drift apart.
  const alerts = calibration.findAlerts(summary);

  log.info('calibration accessed', {
    requestId: req.requestId,
    sampleSize: summary.total.sampleSize,
    rowsScanned: rows.length,
    alertCount: alerts.length,
  });

  return jsonResponse(res, 200, {
    ok: true,
    mode: kv.getMode(),
    limit,
    rowsScanned: rows.length,
    alerts,
    ...summary,
  });
};
