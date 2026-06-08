'use strict';

// /api/goods — Goods master CRUD endpoint.
//
// All operations require:
//   - a valid session cookie (auth.getCurrentUser)
//   - the user belonging to an organisation (lib/orgs.listOrgsForEmail)
//
// Today the resolved org is the user's primary org (first in
// listOrgsForEmail order — matches the billing/checkout handler's
// pattern). When org-switching UI lands, a request can opt into a
// non-primary org via the ORG_ID_HEADER.
//
// URL shape (resolved via api/[...path].js catch-all):
//   GET  /api/goods                  → list active goods for the user's org
//   POST /api/goods                  → create a new good
//   GET  /api/goods/<externalId>     → fetch one
//   PATCH /api/goods/<externalId>    → partial update
//   DELETE /api/goods/<externalId>   → soft-delete (archive)
//
// Every mutation is audit-logged BEFORE returning success — lib/db/goods.js
// awaits events.record() before resolving its promise (ADR 0005).

const crypto = require('node:crypto');
const auth = require('../auth');
const orgs = require('../orgs');
const goods = require('../db/goods');
const log = require('../log').withContext({ handler: 'goods' });

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
  // Catch-all delivers req.query.path as either array or '/'-joined string.
  // /api/goods/<externalId> → ['goods', '<externalId>']
  if (req.query && req.query.path) {
    const parts = Array.isArray(req.query.path) ? req.query.path : String(req.query.path).split('/');
    return (parts[1] || '').trim();
  }
  const url = (req.url || '').split('?')[0];
  const segments = url.replace(/^\/api\/goods\/?/, '').split('/').filter(Boolean);
  return (segments[0] || '').trim();
}

async function resolveOrgId(req, user) {
  // Explicit org via header overrides primary-org lookup. Validated below
  // by checking membership before we use it.
  const explicit = String(req.headers[ORG_ID_HEADER] || '').trim();
  const userOrgs = await orgs.listOrgsForEmail(user.email);
  if (!Array.isArray(userOrgs) || userOrgs.length === 0) return { ok: false, status: 403, error: 'No organisation found for this user' };
  if (explicit) {
    const match = userOrgs.find((o) => String(o.id) === explicit);
    if (!match) return { ok: false, status: 403, error: `Not a member of org "${explicit}"` };
    return { ok: true, orgId: explicit, orgIdNumeric: numericOrgIdFor(match) };
  }
  const primary = userOrgs[0];
  return { ok: true, orgId: primary.id, orgIdNumeric: numericOrgIdFor(primary) };
}

// orgs.listOrgsForEmail returns external-id orgs (e.g. 'org_abc…'). The
// goods_master.org_id column is a Postgres bigint that references the
// organisations(id). We need the numeric id. orgs.getById exposes it.
async function numericOrgIdFor(org) {
  if (typeof org.dbId === 'number') return org.dbId;
  // Today lib/orgs.js is KV-primary and does not expose the numeric PG id
  // on the same object. Until the Postgres-org-of-record migration lands,
  // we look up the row by external_id in lib/db/orgs (or fall back to a
  // direct query). To avoid creating yet another lookup module in this
  // PR, we read the row directly via the goods data-layer's db client.
  const dbClient = require('../db/client');
  if (!dbClient.isConfigured()) return null;
  const row = await dbClient.queryOne(`SELECT id FROM organisations WHERE external_id = $1`, [org.id]);
  return row ? Number(row.id) : null;
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
  // resolved.orgIdNumeric is a Promise from numericOrgIdFor — await it.
  const orgIdNumeric = await resolved.orgIdNumeric;
  if (!Number.isInteger(orgIdNumeric)) {
    jsonResponse(res, 503, { error: 'Organisation not yet mirrored to Postgres — please retry' });
    return null;
  }
  return { user, emailHash: emailHash(user.email), orgIdNumeric };
}

// ── Route bodies ──────────────────────────────────────────────────────

async function handleList(req, res, ctx) {
  const limit = req.query && req.query.limit ? Number(req.query.limit) : undefined;
  const includeArchived = req.query && (req.query.includeArchived === '1' || req.query.includeArchived === 'true');
  const result = await goods.listGoodsForOrg({ orgId: ctx.orgIdNumeric, includeArchived, limit });
  if (!result.ok) {
    const status = /not configured/i.test(result.errors[0]) ? 503 : 500;
    return jsonResponse(res, status, { error: result.errors[0] });
  }
  return jsonResponse(res, 200, { ok: true, goods: result.goods });
}

async function handleGet(req, res, ctx, externalId) {
  const result = await goods.getGoodsByExternalId({ orgId: ctx.orgIdNumeric, externalId });
  if (!result.ok) {
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    const status = /not configured/i.test(result.errors[0]) ? 503 : 500;
    return jsonResponse(res, status, { error: result.errors[0] });
  }
  return jsonResponse(res, 200, { ok: true, goods: result.goods });
}

async function handleCreate(req, res, ctx) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const result = await goods.createGoods({
    orgId: ctx.orgIdNumeric,
    createdByEmailHash: ctx.emailHash,
    sku: body.sku,
    displayName: body.displayName,
    hsCode: body.hsCode,
    originCountry: body.originCountry,
    typicalUnitValueCents: body.typicalUnitValueCents,
    cbamInScope: body.cbamInScope,
    reachSvhcFlags: body.reachSvhcFlags,
    restrictedSubstances: body.restrictedSubstances,
    metadata: body.metadata,
  });
  if (!result.ok) {
    if (result.conflict) return jsonResponse(res, 409, { error: result.errors[0] });
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    // Validation errors are 400; bare DB errors are 500.
    const status = result.errors.some((e) => /required|must be|≤/.test(e)) ? 400 : 500;
    return jsonResponse(res, status, { error: 'Validation failed', errors: result.errors });
  }
  return jsonResponse(res, 201, { ok: true, goods: result.goods });
}

async function handleUpdate(req, res, ctx, externalId) {
  const patch = (req.body && typeof req.body === 'object') ? req.body : {};
  const result = await goods.updateGoods({
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
  return jsonResponse(res, 200, { ok: true, goods: result.goods, unchanged: result.unchanged || false });
}

async function handleArchive(req, res, ctx, externalId) {
  const result = await goods.archiveGoods({
    orgId: ctx.orgIdNumeric,
    externalId,
    actorEmailHash: ctx.emailHash,
  });
  if (!result.ok) {
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  return jsonResponse(res, 200, { ok: true, goods: result.goods, unchanged: result.unchanged || false });
}

// ── Top-level dispatch ────────────────────────────────────────────────

module.exports = async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${ORG_ID_HEADER}`);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const ctx = await ensureAuthedOrg(req, res);
  if (!ctx) return; // response already sent

  const externalId = externalIdFromUrl(req);

  try {
    if (!externalId) {
      if (req.method === 'GET') return handleList(req, res, ctx);
      if (req.method === 'POST') return handleCreate(req, res, ctx);
      return jsonResponse(res, 405, { error: 'Method not allowed on /api/goods' });
    }
    if (req.method === 'GET') return handleGet(req, res, ctx, externalId);
    if (req.method === 'PATCH') return handleUpdate(req, res, ctx, externalId);
    if (req.method === 'DELETE') return handleArchive(req, res, ctx, externalId);
    return jsonResponse(res, 405, { error: 'Method not allowed on /api/goods/<id>' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'goods handler threw';
    log.error('handler threw', { err: message, method: req.method, externalId });
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
