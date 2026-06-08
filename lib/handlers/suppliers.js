'use strict';

// /api/suppliers — Supplier master CRUD endpoint.
//
// Mirrors /api/goods (L1.1). Auth-required + org-scoped + audit-logged
// per ADR 0005. The shape of the data + the breadth of the supplier
// record (sanctions, audit certs, EUDR DDS, trust score, factory
// locations) is the only meaningful difference.
//
// URL shape (catch-all):
//   GET    /api/suppliers                  → list active for the user's org
//   POST   /api/suppliers                  → create
//   GET    /api/suppliers/<externalId>     → fetch one
//   PATCH  /api/suppliers/<externalId>     → partial update
//   DELETE /api/suppliers/<externalId>     → soft-delete (archive)
//
// Optional query params on list:
//   ?hqCountry=CN              → filter by HQ country
//   ?includeArchived=1         → include soft-deleted rows
//   ?limit=N                   → 1-1000, default 200

const crypto = require('node:crypto');
const auth = require('../auth');
const orgs = require('../orgs');
const suppliers = require('../db/suppliers');
const log = require('../log').withContext({ handler: 'suppliers' });

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

function externalIdFromUrl(req) {
  if (req.query && req.query.path) {
    const parts = Array.isArray(req.query.path) ? req.query.path : String(req.query.path).split('/');
    return (parts[1] || '').trim();
  }
  const url = (req.url || '').split('?')[0];
  const segments = url.replace(/^\/api\/suppliers\/?/, '').split('/').filter(Boolean);
  return (segments[0] || '').trim();
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
  const limit = q.limit ? Number(q.limit) : undefined;
  const includeArchived = q.includeArchived === '1' || q.includeArchived === 'true';
  const hqCountry = q.hqCountry ? String(q.hqCountry) : undefined;
  const result = await suppliers.listSuppliersForOrg({
    orgId: ctx.orgIdNumeric,
    includeArchived,
    limit,
    hqCountry,
  });
  if (!result.ok) {
    const status = /not configured/i.test(result.errors[0]) ? 503 : (result.errors.some((e) => /must be|required/.test(e)) ? 400 : 500);
    return jsonResponse(res, status, { error: result.errors[0] });
  }
  return jsonResponse(res, 200, { ok: true, suppliers: result.suppliers });
}

async function handleGet(req, res, ctx, externalId) {
  const result = await suppliers.getSupplierByExternalId({ orgId: ctx.orgIdNumeric, externalId });
  if (!result.ok) {
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    const status = /not configured/i.test(result.errors[0]) ? 503 : 500;
    return jsonResponse(res, status, { error: result.errors[0] });
  }
  return jsonResponse(res, 200, { ok: true, supplier: result.supplier });
}

async function handleCreate(req, res, ctx) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const result = await suppliers.createSupplier({
    orgId: ctx.orgIdNumeric,
    createdByEmailHash: ctx.emailHash,
    entityName: body.entityName,
    legalForm: body.legalForm,
    hqCountry: body.hqCountry,
    registrationNumber: body.registrationNumber,
    registrationAuthority: body.registrationAuthority,
    website: body.website,
    primaryContactEmailHash: body.primaryContactEmailHash,
    factoryLocations: body.factoryLocations,
    auditCerts: body.auditCerts,
    lastOnSiteAuditDate: body.lastOnSiteAuditDate,
    eudrDdsEvidence: body.eudrDdsEvidence,
    metadata: body.metadata,
  });
  if (!result.ok) {
    if (result.conflict) return jsonResponse(res, 409, { error: result.errors[0] });
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    const status = result.errors.some((e) => /required|must be|≤/.test(e)) ? 400 : 500;
    return jsonResponse(res, status, { error: 'Validation failed', errors: result.errors });
  }
  return jsonResponse(res, 201, { ok: true, supplier: result.supplier });
}

async function handleUpdate(req, res, ctx, externalId) {
  const patch = (req.body && typeof req.body === 'object') ? req.body : {};
  const result = await suppliers.updateSupplier({
    orgId: ctx.orgIdNumeric,
    externalId,
    actorEmailHash: ctx.emailHash,
    patch,
  });
  if (!result.ok) {
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    const status = result.errors.some((e) => /required|must be|≤/.test(e)) ? 400 : 500;
    return jsonResponse(res, status, { error: 'Validation failed', errors: result.errors });
  }
  return jsonResponse(res, 200, { ok: true, supplier: result.supplier, unchanged: result.unchanged || false });
}

async function handleArchive(req, res, ctx, externalId) {
  const result = await suppliers.archiveSupplier({
    orgId: ctx.orgIdNumeric,
    externalId,
    actorEmailHash: ctx.emailHash,
  });
  if (!result.ok) {
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  return jsonResponse(res, 200, { ok: true, supplier: result.supplier, unchanged: result.unchanged || false });
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

  const externalId = externalIdFromUrl(req);

  try {
    if (!externalId) {
      if (req.method === 'GET') return handleList(req, res, ctx);
      if (req.method === 'POST') return handleCreate(req, res, ctx);
      return jsonResponse(res, 405, { error: 'Method not allowed on /api/suppliers' });
    }
    if (req.method === 'GET') return handleGet(req, res, ctx, externalId);
    if (req.method === 'PATCH') return handleUpdate(req, res, ctx, externalId);
    if (req.method === 'DELETE') return handleArchive(req, res, ctx, externalId);
    return jsonResponse(res, 405, { error: 'Method not allowed on /api/suppliers/<id>' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'suppliers handler threw';
    log.error('handler threw', { err: message, method: req.method, externalId });
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
