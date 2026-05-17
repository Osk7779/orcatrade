// /api/orgs — Organisation + seat management endpoint (Sprint BG-3.1).
//
//   GET  /api/orgs                  → list orgs the signed-in user belongs to
//   POST /api/orgs   { name }       → create a new org (current user becomes owner)
//   GET  /api/orgs/<id>             → fetch one org + its members (must be a member)
//   POST /api/orgs/<id>/invite      → invite an email at a given role (must be admin+)
//   POST /api/orgs/<id>/remove      → remove a member (must be admin+; cannot remove owner)
//   POST /api/orgs/<id>/transfer    → transfer ownership to an existing member (owner only)
//
// All sub-actions require a valid session cookie. 401 otherwise.
//
// The handler dispatches on URL segments after `/api/orgs/`. Sibling
// pattern to lib/handlers/auth.js + lib/handlers/account.js.

'use strict';

const auth = require('../auth');
const orgs = require('../orgs');
const log = require('../log').withContext({ handler: 'orgs' });

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
  return jsonResponse(res, 200, { ok: true });
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
    return jsonResponse(res, 200, { ok: true, org: updated });
  } catch (err) {
    return jsonResponse(res, 400, { error: err.message });
  }
}

// ── Dispatcher ──────────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', SITE_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const user = auth.getCurrentUser(req);
  if (!user) {
    return jsonResponse(res, 401, { error: 'Not signed in. Use /api/auth/request to receive a magic link.' });
  }

  const segments = segmentsFromReq(req);

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
  const orgId = segments[0];
  const action = segments[1] || null;

  if (!action) {
    if (req.method === 'GET') return handleGet(req, res, user, orgId);
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
