'use strict';

// /api/shipments — Shipment master CRUD + state transitions.
//
// URL shape (catch-all):
//   GET    /api/shipments                         → list
//   POST   /api/shipments                         → create (status starts 'planned')
//   GET    /api/shipments/<externalId>            → fetch
//   PATCH  /api/shipments/<externalId>            → partial update (non-status fields only)
//   POST   /api/shipments/<externalId>/transition → state transition (with optional details)
//   DELETE /api/shipments/<externalId>            → archive
//
// List filters: ?status=in_transit · ?supplierExternalId=sp_… ·
// ?goodsExternalId=gd_… · ?includeArchived=1 · ?limit=N
//
// All mutations audit-logged before success (ADR 0005). Status changes
// flow through transitionShipmentStatus so illegal edges surface as
// 409 conflicts instead of silent shape changes.

const crypto = require('node:crypto');
const auth = require('../auth');
const orgs = require('../orgs');
const shipments = require('../db/shipments');
const log = require('../log').withContext({ handler: 'shipments' });

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

// Catch-all path delivers ['shipments', '<id>', '<action>?'].
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
  const row = await dbClient.queryOne(`SELECT id FROM organisations WHERE external_id = $1`, [org.id]);
  return row ? Number(row.id) : null;
}

async function resolveOrgId(req, user) {
  const explicit = String(req.headers[ORG_ID_HEADER] || '').trim();
  const userOrgs = await orgs.listOrgsForEmail(user.email);
  if (!Array.isArray(userOrgs) || userOrgs.length === 0) return { ok: false, status: 403, error: 'No organisation found for this user' };
  if (explicit) {
    const match = userOrgs.find((o) => String(o.id) === explicit);
    if (!match) return { ok: false, status: 403, error: `Not a member of org "${explicit}"` };
    return { ok: true, orgIdNumeric: await numericOrgIdFor(match) };
  }
  return { ok: true, orgIdNumeric: await numericOrgIdFor(userOrgs[0]) };
}

async function ensureAuthedOrg(req, res) {
  const user = await auth.getCurrentUser(req);
  if (!user) {
    jsonResponse(res, 401, { error: 'Sign in required' });
    return null;
  }
  const resolved = await resolveOrgId(req, user);
  if (!resolved.ok) {
    jsonResponse(res, resolved.status, { error: resolved.error });
    return null;
  }
  if (!Number.isInteger(resolved.orgIdNumeric)) {
    jsonResponse(res, 503, { error: 'Organisation not yet mirrored to Postgres — please retry' });
    return null;
  }
  return { user, emailHash: emailHash(user.email), orgIdNumeric: resolved.orgIdNumeric };
}

// ── Route bodies ──────────────────────────────────────────────────────

async function handleList(req, res, ctx) {
  const q = req.query || {};
  const result = await shipments.listShipmentsForOrg({
    orgId: ctx.orgIdNumeric,
    includeArchived: q.includeArchived === '1' || q.includeArchived === 'true',
    limit: q.limit ? Number(q.limit) : undefined,
    status: q.status ? String(q.status) : undefined,
    supplierExternalId: q.supplierExternalId ? String(q.supplierExternalId) : undefined,
    goodsExternalId: q.goodsExternalId ? String(q.goodsExternalId) : undefined,
  });
  if (!result.ok) {
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    if (result.errors.some((e) => /status must be|orgId required/.test(e))) return jsonResponse(res, 400, { error: result.errors[0] });
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  return jsonResponse(res, 200, { ok: true, shipments: result.shipments });
}

async function handleGet(req, res, ctx, externalId) {
  const result = await shipments.getShipmentByExternalId({ orgId: ctx.orgIdNumeric, externalId });
  if (!result.ok) {
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  return jsonResponse(res, 200, { ok: true, shipment: result.shipment });
}

async function handleCreate(req, res, ctx) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const result = await shipments.createShipment({
    orgId: ctx.orgIdNumeric,
    createdByEmailHash: ctx.emailHash,
    label: body.label,
    goodsExternalId: body.goodsExternalId,
    supplierExternalId: body.supplierExternalId,
    plannedDepartureDate: body.plannedDepartureDate,
    plannedArrivalDate: body.plannedArrivalDate,
    customsValueCents: body.customsValueCents,
    originCountry: body.originCountry,
    destinationCountry: body.destinationCountry,
    weightKg: body.weightKg,
    containerCount: body.containerCount,
    documentVault: body.documentVault,
    inputsSnapshot: body.inputsSnapshot,
    quoteSnapshot: body.quoteSnapshot,
    metadata: body.metadata,
  });
  if (!result.ok) {
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    const status = result.errors.some((e) => /required|must be|≤|ADR/.test(e)) ? 400 : 500;
    return jsonResponse(res, status, { error: 'Validation failed', errors: result.errors });
  }
  return jsonResponse(res, 201, { ok: true, shipment: result.shipment });
}

async function handleUpdate(req, res, ctx, externalId) {
  const patch = (req.body && typeof req.body === 'object') ? req.body : {};
  const result = await shipments.updateShipment({
    orgId: ctx.orgIdNumeric,
    externalId,
    actorEmailHash: ctx.emailHash,
    patch,
  });
  if (!result.ok) {
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    const status = result.errors.some((e) => /must|status changes go through/.test(e)) ? 400 : 500;
    return jsonResponse(res, status, { error: 'Validation failed', errors: result.errors });
  }
  return jsonResponse(res, 200, { ok: true, shipment: result.shipment, unchanged: result.unchanged || false });
}

async function handleTransition(req, res, ctx, externalId) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const toStatus = body.toStatus || body.status;
  if (!toStatus) return jsonResponse(res, 400, { error: 'toStatus required' });
  const result = await shipments.transitionShipmentStatus({
    orgId: ctx.orgIdNumeric,
    externalId,
    actorEmailHash: ctx.emailHash,
    toStatus: String(toStatus),
    details: body.details && typeof body.details === 'object' ? body.details : undefined,
  });
  if (!result.ok) {
    if (result.conflict) return jsonResponse(res, 409, { error: result.errors[0] });
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    if (result.errors.some((e) => /required|must be/.test(e))) return jsonResponse(res, 400, { error: result.errors[0] });
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  return jsonResponse(res, 200, { ok: true, shipment: result.shipment, unchanged: result.unchanged || false });
}

async function handleArchive(req, res, ctx, externalId) {
  const result = await shipments.archiveShipment({
    orgId: ctx.orgIdNumeric,
    externalId,
    actorEmailHash: ctx.emailHash,
  });
  if (!result.ok) {
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  return jsonResponse(res, 200, { ok: true, shipment: result.shipment, unchanged: result.unchanged || false });
}

module.exports = async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${ORG_ID_HEADER}`);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const ctx = await ensureAuthedOrg(req, res);
  if (!ctx) return;

  // ['shipments'] | ['shipments', externalId] | ['shipments', externalId, 'transition']
  const segments = pathSegments(req);
  const externalId = segments[1] || '';
  const action = segments[2] || '';

  try {
    if (!externalId) {
      if (req.method === 'GET') return handleList(req, res, ctx);
      if (req.method === 'POST') return handleCreate(req, res, ctx);
      return jsonResponse(res, 405, { error: 'Method not allowed on /api/shipments' });
    }
    // Item or transition.
    if (action === 'transition') {
      if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'transition requires POST' });
      return handleTransition(req, res, ctx, externalId);
    }
    if (action) {
      return jsonResponse(res, 404, { error: `Unknown action: ${action}` });
    }
    if (req.method === 'GET') return handleGet(req, res, ctx, externalId);
    if (req.method === 'PATCH') return handleUpdate(req, res, ctx, externalId);
    if (req.method === 'DELETE') return handleArchive(req, res, ctx, externalId);
    return jsonResponse(res, 405, { error: 'Method not allowed on /api/shipments/<id>' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'shipments handler threw';
    log.error('handler threw', { err: message, method: req.method, externalId, action });
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
