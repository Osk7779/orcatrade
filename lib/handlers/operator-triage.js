// /api/operator-triage — cross-org triage console feed (sprint 87,
// Track E: operator leverage).
//
// The whole book of business on one screen: per-org open-work
// counts ranked by urgency (SLA risk → € at stake → review queue)
// so one operator runs a hundred orgs. This is the surface that
// makes the counterparty's unit economics work.
//
// AUTH IS THE LOAD-BEARING PART: this endpoint crosses org
// boundaries, so it gates on verifyAdmin (ORCATRADE_ADMIN_EMAILS
// session allowlist / ops token) BEFORE any query — the same gate
// as the leads + audit dashboards. An org admin is NOT enough;
// org-scoped users have the /imports/insights cockpit.
//
// No cache: this is a low-traffic staff tool where freshness is
// the point — an operator acting on a stale worklist double-works
// a row a colleague just cleared.

'use strict';

const adminAuth = require('../admin-auth');
const importRequests = require('../db/import-requests');
const slaCalc = require('../intelligence/sla');

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end();
  }

  // Platform-staff gate FIRST — nothing cross-org computes for an
  // unauthenticated caller.
  const verdict = await adminAuth.verifyAdmin(req);
  if (!verdict.ok) {
    return json(res, verdict.statusCode, { error: verdict.error });
  }

  const slaRiskHours = slaCalc.slaRiskThresholdHours();
  const result = await importRequests.aggregateOperatorTriage({ slaRiskHours });
  if (!result.ok) {
    if (/not configured/i.test(result.errors[0])) {
      return json(res, 503, { error: result.errors[0] });
    }
    return json(res, 500, { error: result.errors[0] });
  }
  return json(res, 200, {
    ok: true,
    rows: result.rows,
    // Surface the derivation so the console can name the line it
    // draws ("at risk = unquoted past 36h of the 48h budget").
    slaRiskThresholdHours: slaRiskHours,
    slaTargetHours: slaCalc.SLA_QUOTE_TURNAROUND_TARGET_HOURS,
    generatedAt: new Date().toISOString(),
  });
};
