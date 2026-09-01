'use strict';

// Org-scoped activity feed (sprint 14).
//
// GET /api/activity?limit=20
//   → { ok: true, events: ActivityEvent[] }
//
// Powers the live activity widget on /dashboard. Newest-first. The
// allowlist of which event types appear in the org-wide feed lives
// in lib/events.js (ORG_ACTIVITY_TYPES) so personal-security events
// (auth_*, mfa_*, password_*) never leak into a teammate's view —
// those belong in the personal audit at /account/security.
//
// Auth + org-scoping mirror the imports handler exactly (same
// resolveOrgId + ORG_ID_HEADER pattern), so a user only ever sees
// the activity of orgs they are a member of.

const auth = require('../auth');
const orgs = require('../orgs');
const events = require('../events');
const log = require('../log');

const ORG_ID_HEADER = 'x-orcatrade-org';

function jsonResponse(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function numericOrgIdFor(org) {
  if (typeof org.dbId === 'number') return org.dbId;
  const dbClient = require('../db/client');
  if (!dbClient.isConfigured()) return null;
  const row = await dbClient.queryOne(
    `SELECT id FROM organisations WHERE external_id = $1`,
    [org.id],
  );
  return row ? Number(row.id) : null;
}

async function resolveOrgId(req, user) {
  const explicit = String(req.headers[ORG_ID_HEADER] || '').trim();
  const userOrgs = await orgs.listOrgsForEmail(user.email);
  if (!Array.isArray(userOrgs) || userOrgs.length === 0) {
    return { ok: false, status: 403, error: 'No organisation found for this user' };
  }
  if (explicit) {
    const match = userOrgs.find((o) => String(o.id) === explicit);
    if (!match) return { ok: false, status: 403, error: `Not a member of org "${explicit}"` };
    return { ok: true, orgIdNumeric: await numericOrgIdFor(match) };
  }
  return { ok: true, orgIdNumeric: await numericOrgIdFor(userOrgs[0]) };
}

// PII redaction: events stamp _seq / _hash / _prevHash internals at
// write time (lib/events.js chain). Strip them on the way out — the
// dashboard never needs the chain stamps, and exposing them adds
// surface area for a future security review nit. Also strip any
// `email` field (the only PII that historically leaked into payloads;
// new code uses emailHash exclusively).
function redactActivityEvent(e) {
  if (!e || typeof e !== 'object') return e;
  const { _seq, _hash, _prevHash, email, ...keep } = e;
  return keep;
}

module.exports = async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${ORG_ID_HEADER}`);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  const user = await auth.getCurrentUser(req);
  if (!user) {
    return jsonResponse(res, 401, { error: 'Sign in required' });
  }
  const resolved = await resolveOrgId(req, user);
  if (!resolved.ok) {
    return jsonResponse(res, resolved.status, { error: resolved.error });
  }

  // Parse ?limit clamp client-side; lib/events.js also clamps to MAX_EVENTS.
  const url = new URL(req.url || '/', 'https://orcatrade.local');
  const requested = Number(url.searchParams.get('limit') || 20);
  const limit = Math.max(1, Math.min(100, Number.isFinite(requested) ? requested : 20));

  try {
    const raw = await events.listForOrg({
      orgId: resolved.orgIdNumeric,
      limit,
    });
    const sanitised = raw.map(redactActivityEvent);
    return jsonResponse(res, 200, { ok: true, events: sanitised });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'activity read failed';
    log.warn('activity feed read failed', { err: message });
    return jsonResponse(res, 500, { error: 'Could not read activity feed' });
  }
};
