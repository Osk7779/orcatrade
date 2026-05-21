// /api/orgs — Organisation + seat management endpoint (Sprint BG-3.1).
//
//   GET  /api/orgs                  → list orgs the signed-in user belongs to
//   POST /api/orgs   { name }       → create a new org (current user becomes owner)
//   GET  /api/orgs/<id>             → fetch one org + its members (must be a member)
//   POST /api/orgs/<id>/invite      → invite an email at a given role (must be admin+)
//   POST /api/orgs/<id>/remove      → remove a member (must be admin+; cannot remove owner)
//   POST /api/orgs/<id>/transfer    → transfer ownership to an existing member (owner only)
//   POST /api/orgs/<id>/tier        → assign tier (ADMIN token only; Sprint BG-3.3 phase 1)
//
// Most sub-actions require a valid session cookie; /tier is admin-only
// (ORCATRADE_LEADS_TOKEN), bypassing the user-session gate.
//
// The handler dispatches on URL segments after `/api/orgs/`. Sibling
// pattern to lib/handlers/auth.js + lib/handlers/account.js.

'use strict';

const auth = require('../auth');
const orgs = require('../orgs');
const events = require('../events');
const userTier = require('../user-tier');
const tiersCatalog = require('../tiers');
const log = require('../log').withContext({ handler: 'orgs' });
const adminAuth = require('../admin-auth');
const ssoConfig = require('../sso-config');

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://orcatrade.pl';

function jsonResponse(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

function segmentsFromReq(req) {
  if (req.query && req.query.path) {
    const parts = Array.isArray(req.query.path)
      ? req.query.path
      : String(req.query.path).split('/');
    return parts.slice(1); // drop the leading 'orgs'
  }
  const url = (req.url || '').split('?')[0];
  return url.replace(/^\/api\/orgs\/?/, '').split('/').filter(Boolean);
}

// ── Sub-actions ─────────────────────────────────────────────

async function handleList(req, res, user) {
  const records = await orgs.listOrgsForEmail(user.email);
  return jsonResponse(res, 200, { ok: true, orgs: records });
}

async function handleCreate(req, res, user) {
  const body = req.body || {};
  const name = body.name;
  if (!orgs.isValidName(name)) {
    return jsonResponse(res, 400, { error: 'name required (1-100 chars)' });
  }
  const record = await orgs.createOrg({ name, ownerEmail: user.email });
  log.withContext({ requestId: req.requestId }).info('org created', { orgId: record.id });
  // Sprint BG-5.5 — audit trail.
  try { await events.record('org_created', { email: user.email, orgId: record.id, orgName: record.name }); } catch (_) {}
  return jsonResponse(res, 201, { ok: true, org: record });
}

async function handleGet(req, res, user, orgId) {
  const org = await orgs.getOrg(orgId);
  if (!org) return jsonResponse(res, 404, { error: 'org not found' });
  // Must be a member to view.
  const isMember = await orgs.hasRole(orgId, user.email, 'member');
  if (!isMember) return jsonResponse(res, 403, { error: 'not a member of this org' });
  const members = await orgs.listMembers(orgId);
  return jsonResponse(res, 200, { ok: true, org, members });
}

async function handleInvite(req, res, user, orgId) {
  const body = req.body || {};
  const email = body.email;
  const role = body.role || 'member';
  if (!email) return jsonResponse(res, 400, { error: 'email required' });
  if (!auth.isValidEmail(email)) return jsonResponse(res, 400, { error: 'invalid email format' });
  if (!orgs.ALLOWED_ROLES.has(role) || role === 'owner') {
    return jsonResponse(res, 400, { error: 'role must be one of: admin, member' });
  }
  // Must be admin+ on this org.
  const isAdmin = await orgs.hasRole(orgId, user.email, 'admin');
  if (!isAdmin) return jsonResponse(res, 403, { error: 'admin role required to invite' });
  try {
    const result = await orgs.addMember(orgId, { email, role });
    log.withContext({ requestId: req.requestId }).info('member invited', {
      orgId, inviterEmail: user.email, role, alreadyMember: result.alreadyMember,
    });
    // Sprint BG-5.5 — audit trail. Only log new invites, not idempotent
    // re-adds — they're not security events, they're no-ops.
    if (!result.alreadyMember) {
      try {
        await events.record('org_member_invited', {
          email: user.email,           // inviter (the actor)
          orgId,
          inviteeEmail: email,         // invitee
          role,
        });
      } catch (_) {}
    }
    return jsonResponse(res, 200, { ok: true, ...result });
  } catch (err) {
    return jsonResponse(res, 400, { error: err.message });
  }
}

async function handleRemove(req, res, user, orgId) {
  const body = req.body || {};
  const email = body.email;
  if (!email) return jsonResponse(res, 400, { error: 'email required' });
  const isAdmin = await orgs.hasRole(orgId, user.email, 'admin');
  if (!isAdmin) return jsonResponse(res, 403, { error: 'admin role required to remove' });
  const result = await orgs.removeMember(orgId, email);
  if (!result.removed) return jsonResponse(res, 400, { error: result.reason || 'cannot remove' });
  log.withContext({ requestId: req.requestId }).info('member removed', { orgId });
  // Sprint BG-5.5 — audit trail. Both the actor (admin/owner) and the
  // target are captured so a removed member can dispute the action later.
  try {
    await events.record('org_member_removed', {
      email: user.email,             // actor
      orgId,
      removedEmail: email,           // target
    });
  } catch (_) {}
  return jsonResponse(res, 200, { ok: true });
}

// POST /api/orgs/<id>/tier  body: { tierId, billingCycle?, source? }
//   Admin-only (ORCATRADE_LEADS_TOKEN). Assigns an effective tier to
//   the org — every member sees it via userTier.resolveTier(email)
//   on their next gated request. Phase 1 is admin-set only; phase 2
//   wires the Stripe webhook to write here.
//
// DELETE /api/orgs/<id>/tier
//   Clears the override. Members revert to per-email tier behaviour.
async function handleSetTier(req, res, orgId) {
  const body = req.body || {};
  const tierId = body.tierId;
  if (!tiersCatalog.isValidTierId(tierId)) {
    return jsonResponse(res, 400, {
      error: 'tierId must be one of: ' + tiersCatalog.TIER_IDS.join(', '),
    });
  }
  const org = await orgs.getOrg(orgId);
  if (!org) return jsonResponse(res, 404, { error: 'org not found' });
  try {
    const record = await userTier.setOrgTier(orgId, {
      tierId,
      billingCycle: body.billingCycle || null,
      source: body.source || 'admin',
    });
    log.withContext({ requestId: req.requestId }).info('org tier assigned', { orgId, tierId });
    try {
      await events.record('org_tier_assigned', {
        orgId, tierId, source: record.source,
      });
    } catch (_) {}
    return jsonResponse(res, 200, { ok: true, orgId, tier: record });
  } catch (err) {
    return jsonResponse(res, 400, { error: err.message });
  }
}

async function handleClearTier(req, res, orgId) {
  const org = await orgs.getOrg(orgId);
  if (!org) return jsonResponse(res, 404, { error: 'org not found' });
  await userTier.clearOrgTier(orgId);
  log.withContext({ requestId: req.requestId }).info('org tier cleared', { orgId });
  try { await events.record('org_tier_cleared', { orgId }); } catch (_) {}
  return jsonResponse(res, 200, { ok: true, orgId });
}

// GET /api/orgs/admin?token=...   (Sprint BG-3.6)
//
// Admin-only listing of every org on the platform, with member count +
// current effective tier. Used by /dashboard/orgs/ for ops + sales to
// find an orgId before flipping its tier via POST /api/orgs/<id>/tier.
//
// Privacy: returns email addresses of owners + member counts (not
// individual member emails — those require user-session access to the
// per-org detail page). Same admin gate as /tier above.
async function handleAdminList(req, res) {
  const rawLimit = (req.query && req.query.limit)
    || new URLSearchParams((req.url || '').split('?')[1] || '').get('limit');
  const parsedLimit = Number(rawLimit);
  const limit = rawLimit === '' || rawLimit == null || !Number.isFinite(parsedLimit)
    ? 200
    : Math.min(10000, Math.max(1, parsedLimit));

  const records = await orgs.listAllOrgs({ limit });
  const enriched = [];
  for (const o of records) {
    const members = await orgs.listMembers(o.id);
    const tier = await userTier.getOrgTier(o.id);
    enriched.push({
      id: o.id,
      name: o.name,
      ownerEmail: o.ownerEmail,
      createdAt: o.createdAt,
      memberCount: Array.isArray(members) ? members.length : 0,
      tier: tier ? {
        tierId: tier.tierId,
        billingCycle: tier.billingCycle,
        since: tier.since,
        source: tier.source,
      } : null,
    });
  }

  log.withContext({ requestId: req.requestId }).info('orgs admin list', {
    returned: enriched.length, limit,
  });

  return jsonResponse(res, 200, {
    ok: true,
    asOf: new Date().toISOString(),
    limit,
    returned: enriched.length,
    orgs: enriched,
  });
}

// GET /api/orgs/admin/<orgId>   (Sprint BG-3.7)
//
// Per-org admin detail — full member list (email + role + joinedAt)
// plus the tier record. Same admin-token gate as the /admin list view.
// Used by /dashboard/orgs/ to expand a row inline when clicked.
//
// Privacy: we surface raw member emails here because (a) ops uses
// this for sales-team account work and (b) the admin token is
// already the gate. The user-facing /account/orgs/<id>/ surface
// still requires user-session membership.
async function handleAdminGet(req, res, orgId) {
  const org = await orgs.getOrg(orgId);
  if (!org) return jsonResponse(res, 404, { error: 'org not found' });
  const members = await orgs.listMembers(orgId);
  const tier = await userTier.getOrgTier(orgId);

  log.withContext({ requestId: req.requestId }).info('orgs admin detail', {
    orgId, memberCount: Array.isArray(members) ? members.length : 0,
  });

  return jsonResponse(res, 200, {
    ok: true,
    asOf: new Date().toISOString(),
    org: {
      id: org.id,
      name: org.name,
      ownerEmail: org.ownerEmail,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    },
    members: Array.isArray(members) ? members : [],
    tier: tier ? {
      tierId: tier.tierId,
      billingCycle: tier.billingCycle,
      since: tier.since,
      source: tier.source,
    } : null,
  });
}

async function handleTransfer(req, res, user, orgId) {
  const body = req.body || {};
  const toEmail = body.toEmail;
  if (!toEmail) return jsonResponse(res, 400, { error: 'toEmail required' });
  // Only the current owner can transfer.
  const org = await orgs.getOrg(orgId);
  if (!org) return jsonResponse(res, 404, { error: 'org not found' });
  if (org.ownerEmail !== orgs.normaliseEmail(user.email)) {
    return jsonResponse(res, 403, { error: 'only the current owner can transfer ownership' });
  }
  try {
    const updated = await orgs.transferOwnership(orgId, { fromEmail: user.email, toEmail });
    log.withContext({ requestId: req.requestId }).info('ownership transferred', { orgId });
    // Sprint BG-5.5 — audit trail. Ownership transfer is the highest-impact
    // org operation: it changes who can do ANYTHING on the org going forward.
    try {
      await events.record('org_ownership_transferred', {
        email: user.email,           // outgoing owner (the actor)
        orgId,
        toEmail,                     // new owner
      });
    } catch (_) {}
    return jsonResponse(res, 200, { ok: true, org: updated });
  } catch (err) {
    return jsonResponse(res, 400, { error: err.message });
  }
}

// ── Dispatcher ──────────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', SITE_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const segments = segmentsFromReq(req);
  const orgId = segments[0] || '';
  const action = segments[1] || null;

  // Admin paths (Sprint BG-3.3 phase 1 + BG-3.6 + BG-3.7) — all
  // bypass the user-session gate. Token via X-Admin-Token header OR
  // ?token=… query.
  //
  //   GET    /api/orgs/admin             → list every org (BG-3.6)
  //   GET    /api/orgs/admin/<orgId>     → org detail with members (BG-3.7)
  //   POST   /api/orgs/<id>/tier         → set org tier (BG-3.3 p1)
  //   DELETE /api/orgs/<id>/tier         → clear org tier (BG-3.3 p1)
  const isAdminRoute = (orgId === 'admin')
    || (orgId && action === 'tier');
  if (isAdminRoute) {
    // Sprint admin-session-auth: session cookie (when email is on
    // ORCATRADE_ADMIN_EMAILS) OR legacy token via ?token=… / X-Admin-Token.
    const verdict = await adminAuth.verifyAdmin(req);
    if (!verdict.ok) {
      if (verdict.statusCode === 401) {
        log.warn('orgs admin route unauthorized', { requestId: req.requestId });
      }
      return jsonResponse(res, verdict.statusCode, { error: verdict.error });
    }
    if (orgId === 'admin') {
      if (req.method !== 'GET') return jsonResponse(res, 405, { error: 'Method not allowed' });
      // /admin           → list every org
      // /admin/<orgId>   → detail for one org (Sprint BG-3.7)
      if (!action) return handleAdminList(req, res);
      return handleAdminGet(req, res, action);
    }
    // /<id>/tier
    if (req.method === 'POST')   return handleSetTier(req, res, orgId);
    if (req.method === 'DELETE') return handleClearTier(req, res, orgId);
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  // Every other sub-action requires a valid user session.
  // Strict variant honours the per-email revocation list (Sprint BG-3.2
  // phase 1) — "Sign out everywhere" must kick the user out of org admin
  // operations on every device, immediately.
  const user = await auth.getCurrentUserStrict(req);
  if (!user) {
    return jsonResponse(res, 401, { error: 'Not signed in. Use /api/auth/request to receive a magic link.' });
  }

  // GET /api/orgs        → list mine
  // POST /api/orgs       → create
  if (segments.length === 0) {
    if (req.method === 'GET') return handleList(req, res, user);
    if (req.method === 'POST') return handleCreate(req, res, user);
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  // /api/orgs/<id>            → GET fetch
  // /api/orgs/<id>/invite     → POST
  // /api/orgs/<id>/remove     → POST
  // /api/orgs/<id>/transfer   → POST
  if (!action) {
    if (req.method === 'GET') return handleGet(req, res, user, orgId);
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }
  // /api/orgs/<id>/sso supports GET + POST + DELETE (owner-gated) — handle
  // before the POST-only guard that the other sub-actions sit behind.
  if (action === 'sso') {
    if (req.method === 'GET') return handleGetSso(req, res, user, orgId);
    if (req.method === 'POST') return handleSetSso(req, res, user, orgId);
    if (req.method === 'DELETE') return handleDeleteSso(req, res, user, orgId);
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }
  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }
  if (action === 'invite') return handleInvite(req, res, user, orgId);
  if (action === 'remove') return handleRemove(req, res, user, orgId);
  if (action === 'transfer') return handleTransfer(req, res, user, orgId);
  return jsonResponse(res, 404, { error: `Unknown sub-action /api/orgs/<id>/${action}` });
};

// ── Owner-gated SSO config (Sprint sso-oidc-v1 phase 3) ──
//
// GET    /api/orgs/<id>/sso → read config (clientSecret MASKED)
// POST   /api/orgs/<id>/sso → set the org's OIDC config
// DELETE /api/orgs/<id>/sso → remove it
// Owner-only: SSO config holds the client secret + governs who can sign
// in as the org, so it's the highest-trust org operation — gated to the
// single owner (not admins).
async function requireOwner(req, res, user, orgId) {
  const org = await orgs.getOrg(orgId);
  if (!org) { jsonResponse(res, 404, { error: 'Organisation not found' }); return null; }
  if (org.ownerEmail !== orgs.normaliseEmail(user.email)) {
    jsonResponse(res, 403, { error: 'Only the organisation owner can manage SSO' });
    return null;
  }
  return org;
}

async function handleGetSso(req, res, user, orgId) {
  if (!(await requireOwner(req, res, user, orgId))) return;
  const cfg = await ssoConfig.getConfig(orgId);
  if (!cfg) return jsonResponse(res, 200, { ok: true, configured: false, config: null });
  // Never return the client secret — surface only that one is set.
  const { clientSecret, ...safe } = cfg; // eslint-disable-line no-unused-vars
  return jsonResponse(res, 200, {
    ok: true,
    configured: ssoConfig.isComplete(cfg),
    config: { ...safe, clientSecretSet: !!clientSecret },
    initiateUrl: `${SITE_ORIGIN}/api/auth/sso/initiate?org=${encodeURIComponent(orgId)}`,
  });
}

async function handleSetSso(req, res, user, orgId) {
  if (!(await requireOwner(req, res, user, orgId))) return;
  const body = req.body || {};
  const result = await ssoConfig.setConfig(orgId, body);
  if (!result.ok) {
    return jsonResponse(res, 400, {
      error: result.reason === 'incomplete'
        ? 'SSO config incomplete — issuer, clientId, clientSecret, authorizationEndpoint, tokenEndpoint and jwksUri are all required.'
        : 'Could not save SSO config',
      reason: result.reason,
    });
  }
  try { await events.record('org_sso_configured', { email: user.email, orgId }); } catch (_) {}
  return jsonResponse(res, 200, {
    ok: true,
    initiateUrl: `${SITE_ORIGIN}/api/auth/sso/initiate?org=${encodeURIComponent(orgId)}`,
  });
}

async function handleDeleteSso(req, res, user, orgId) {
  if (!(await requireOwner(req, res, user, orgId))) return;
  await ssoConfig.deleteConfig(orgId);
  try { await events.record('org_sso_removed', { email: user.email, orgId }); } catch (_) {}
  return jsonResponse(res, 200, { ok: true });
}

// Test surface
module.exports.handleSetTier = handleSetTier;
module.exports.handleClearTier = handleClearTier;
module.exports.handleAdminList = handleAdminList;
module.exports.handleAdminGet = handleAdminGet;
module.exports.handleGetSso = handleGetSso;
module.exports.handleSetSso = handleSetSso;
module.exports.handleDeleteSso = handleDeleteSso;
