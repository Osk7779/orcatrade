// /api/human-review — admin queue inspector (Phase 0 P0.10).
//
//   GET  /api/human-review?status=new&limit=50  — list tickets
//   POST /api/human-review                      — claim or resolve
//        body { id, action: 'claim',   claimedBy }
//        body { id, action: 'resolve', resolvedBy, resolution? }
//
// Admin-gated via the same lib/admin-auth pattern /api/audit + /api/leads
// use (x-admin-token header or ?token= query param; matches one of
// ORCATRADE_LEADS_TOKEN / ORCATRADE_ADMIN_TOKEN; admin emails on
// ORCATRADE_ADMIN_EMAILS get session-cookie access).
//
// Phase 1 follow-up: an in-app UI under app-shell that consumes this
// endpoint. Today the API is the surface; on-call uses curl + the
// runbook at docs/runbooks/human-review-queue.md.

'use strict';

const humanReview = require('../human-review');
const adminAuth = require('../admin-auth');
const log = require('../log').withContext({ handler: 'human-review' });

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

function queryParam(req, name) {
  if (req.query && req.query[name] != null) return String(req.query[name]);
  const qs = (req.url || '').split('?')[1] || '';
  return new URLSearchParams(qs).get(name) || '';
}

module.exports = async function handler(req, res) {
  // Admin gate — same pattern as /api/audit + /api/leads (verifyAdmin
  // accepts session cookie with ORCATRADE_ADMIN_EMAILS allow-list OR
  // X-Admin-Token header / ?token= matching ORCATRADE_LEADS_TOKEN).
  const verdict = await adminAuth.verifyAdmin(req);
  if (!verdict.ok) {
    return json(res, verdict.statusCode || 401, { error: verdict.error || 'unauthorized' });
  }
  const actor = verdict.email || `admin-token-${verdict.mode || 'unknown'}`;

  if (req.method === 'GET') {
    const status = queryParam(req, 'status') || undefined;
    const limit = Number(queryParam(req, 'limit')) || undefined;
    try {
      const tickets = await humanReview.listTickets({ status, limit });
      return json(res, 200, {
        ok: true,
        count: tickets.length,
        tickets,
      });
    } catch (err) {
      log.error('listTickets failed', { err });
      return json(res, 500, { error: 'list failed' });
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const { id, action } = body;
    if (!id) return json(res, 400, { error: 'id required' });

    try {
      if (action === 'claim') {
        const claimedBy = body.claimedBy || actor;
        const result = await humanReview.claimTicket(id, claimedBy);
        if (!result.ok) return json(res, 404, { error: result.reason });
        return json(res, 200, { ok: true, ticket: result.ticket });
      }
      if (action === 'resolve') {
        const resolvedBy = body.resolvedBy || actor;
        const result = await humanReview.resolveTicket(id, resolvedBy, body.resolution);
        if (!result.ok) return json(res, 404, { error: result.reason });
        return json(res, 200, { ok: true, ticket: result.ticket });
      }
      return json(res, 400, { error: 'action must be "claim" or "resolve"' });
    } catch (err) {
      log.error('mutate ticket failed', { id, action, err });
      return json(res, 500, { error: err.message || 'mutation failed' });
    }
  }

  res.statusCode = 405;
  res.setHeader('Allow', 'GET, POST');
  return res.end();
};
