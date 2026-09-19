'use strict';

// Sprint 44 — per-org API key management.
//
// URL shape (catch-all):
//   GET    /api/api-keys              → list redacted keys for the
//                                       caller's org
//   POST   /api/api-keys              → create a key; raw value
//                                       returned ONCE
//   DELETE /api/api-keys/<keyId>      → revoke a key
//
// All routes are admin-only — API keys are an org-wide security
// surface. Per-key audit events on create/revoke; key listing is
// NOT audited (read-only, no state change).
//
// The bearer-token lookup path (apiKeys.lookupByBearer) is exposed
// by lib/api-keys.js; a future sprint wires it into specific GET
// endpoints by passing the Authorization header through the
// existing auth helper. v1 ships the management surface only.

const crypto = require('crypto');
const auth = require('../auth');
const orgs = require('../orgs');
const rbac = require('../rbac');
const events = require('../events');
const log = require('../log');
const apiKeys = require('../api-keys');

const OPS_REVIEW_ROLES = new Set(['admin', 'owner']);
const ORG_ID_HEADER = 'x-orcatrade-org';

function jsonResponse(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

function emailHash(email) {
  return crypto.createHash('sha256').update(String(email).toLowerCase().trim()).digest('hex').slice(0, 16);
}

function pathSegments(req) {
  if (req.query && req.query.path) {
    const arr = Array.isArray(req.query.path) ? req.query.path : String(req.query.path).split('/');
    return arr.map((s) => s.trim()).filter(Boolean);
  }
  const url = (req.url || '').split('?')[0];
  return url.replace(/^\/api\//, '').split('/').filter(Boolean);
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

async function resolveOrg(req, user) {
  const explicit = String(req.headers[ORG_ID_HEADER] || '').trim();
  const userOrgs = await orgs.listOrgsForEmail(user.email);
  if (!Array.isArray(userOrgs) || userOrgs.length === 0) {
    return { ok: false, status: 403, error: 'No organisation found for this user' };
  }
  if (explicit) {
    const match = userOrgs.find((o) => String(o.id) === explicit);
    if (!match) return { ok: false, status: 403, error: `Not a member of org "${explicit}"` };
    return { ok: true, org: match };
  }
  return { ok: true, org: userOrgs[0] };
}

async function ensureAuthedAdmin(req, res) {
  const user = await auth.getCurrentUser(req);
  if (!user) {
    jsonResponse(res, 401, { error: 'Sign in required' });
    return null;
  }
  const resolved = await resolveOrg(req, user);
  if (!resolved.ok) {
    jsonResponse(res, resolved.status, { error: resolved.error });
    return null;
  }
  const orgIdNumeric = await numericOrgIdFor(resolved.org);
  if (!Number.isInteger(orgIdNumeric)) {
    jsonResponse(res, 503, { error: 'Organisation not yet mirrored to Postgres — please retry' });
    return null;
  }
  // Admin-only — API keys are an org-wide security surface. Same
  // RBAC gate as operator-config (sprint 42).
  const role = await orgs.getMemberRole(resolved.org.id, user.email).catch(() => null);
  const canonical = String(rbac.canonicalRole(role || ''));
  if (!OPS_REVIEW_ROLES.has(canonical)) {
    jsonResponse(res, 403, {
      error: 'Forbidden: only owner / admin members can manage API keys',
      role: canonical || null,
    });
    return null;
  }
  return {
    user,
    emailHash: emailHash(user.email),
    orgIdNumeric,
    orgExternalId: resolved.org.id,
  };
}

async function handleList(req, res, ctx) {
  const keys = await apiKeys.listApiKeysForOrg(ctx.orgIdNumeric);
  // Filter out revoked entries from the list — they only appear in
  // audit views (not implemented in v1). The data layer keeps them
  // for historical reference.
  const active = keys.filter((k) => !k.revoked);
  return jsonResponse(res, 200, { ok: true, keys: active });
}

async function handleCreate(req, res, ctx) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const result = await apiKeys.createApiKey({
    orgIdNumeric: ctx.orgIdNumeric,
    label: typeof body.label === 'string' ? body.label : '',
    actorEmailHash: ctx.emailHash,
    // Sprint 56 — narrowed permission set. Empty/omitted →
    // legacy unscoped (admin-equivalent). The data-layer
    // validateScopes rejects anything not in API_KEY_SCOPES.
    scopes: Array.isArray(body.scopes) ? body.scopes : [],
  });
  if (!result.ok) {
    const msg = result.errors[0] || 'create failed';
    const status = /required|must be|at most|control|unsupported|array/.test(msg) ? 400 : 500;
    return jsonResponse(res, status, { error: msg });
  }
  // Audit-log BEFORE returning 201 (ADR-0005). The detail intentionally
  // does NOT include the raw key — only the keyId hash, the label,
  // and the redacted form.
  try {
    await events.record('api_key_created', {
      orgId: ctx.orgIdNumeric,
      entityType: 'api_key',
      entityId: result.keyId,
      actorEmailHash: ctx.emailHash,
      detail: {
        label: result.metadata.label,
        redactedKey: result.metadata.redactedKey,
        // Sprint 56 — audit the narrowing. Reading the chain
        // tells you not just "key K was created" but "key K
        // was created with these scopes."
        scopes: result.metadata.scopes,
      },
    });
  } catch (err) {
    log.warn('api-keys audit write failed (create)', {
      orgIdNumeric: ctx.orgIdNumeric,
      err: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(res, 500, { error: 'Could not record audit event for API key create' });
  }
  // Response includes the RAW key ONCE — this is the only place it's
  // ever surfaced. The UI must echo + copy + warn the user that
  // they won't see it again.
  return jsonResponse(res, 201, {
    ok: true,
    key: result.raw,
    keyId: result.keyId,
    label: result.metadata.label,
    createdAt: result.metadata.createdAt,
    redactedKey: result.metadata.redactedKey,
    // Sprint 56 — echo scopes so the UI can render the chip
    // immediately after create without a list-refresh round-trip.
    scopes: result.metadata.scopes,
  });
}

async function handleRevoke(req, res, ctx, keyId) {
  const result = await apiKeys.revokeApiKey({
    orgIdNumeric: ctx.orgIdNumeric,
    keyId,
    actorEmailHash: ctx.emailHash,
  });
  if (!result.ok) {
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    return jsonResponse(res, 500, { error: result.errors[0] || 'revoke failed' });
  }
  if (!result.alreadyRevoked) {
    try {
      await events.record('api_key_revoked', {
        orgId: ctx.orgIdNumeric,
        entityType: 'api_key',
        entityId: keyId,
        actorEmailHash: ctx.emailHash,
        detail: { label: result.metadata.label },
      });
    } catch (err) {
      log.warn('api-keys audit write failed (revoke)', {
        orgIdNumeric: ctx.orgIdNumeric,
        keyId,
        err: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(res, 500, { error: 'Could not record audit event for API key revoke' });
    }
  }
  return jsonResponse(res, 200, { ok: true, alreadyRevoked: !!result.alreadyRevoked });
}

module.exports = async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${ORG_ID_HEADER}`);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  const ctx = await ensureAuthedAdmin(req, res);
  if (!ctx) return;

  const segments = pathSegments(req); // ['api-keys'] | ['api-keys', '<keyId>'] | ['api-keys', 'scopes']
  const keyId = segments[1] || '';

  try {
    // Sprint 56 — public scope-whitelist endpoint so the UI's
    // create-form checkboxes don't hardcode the list. Same
    // admin-only gate as the other routes (already passed).
    if (keyId === 'scopes') {
      if (req.method !== 'GET') return jsonResponse(res, 405, { error: 'scopes requires GET' });
      return jsonResponse(res, 200, { ok: true, scopes: apiKeys.API_KEY_SCOPES });
    }
    if (!keyId) {
      if (req.method === 'GET') return handleList(req, res, ctx);
      if (req.method === 'POST') return handleCreate(req, res, ctx);
      return jsonResponse(res, 405, { error: 'Method not allowed on /api/api-keys' });
    }
    if (req.method === 'DELETE') return handleRevoke(req, res, ctx, keyId);
    return jsonResponse(res, 405, { error: 'Method not allowed on /api/api-keys/<id>' });
  } catch (err) {
    log.error('api-keys handler threw', {
      method: req.method,
      err: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
