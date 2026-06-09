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
const savedPlans = require('../saved-plans');
const events = require('../events');
const log = require('../log').withContext({ handler: 'shipments' });

// Subset of event types that belong on a shipment's audit timeline.
// Filtered server-side so the client never has to render an internal
// system event that happens to carry the same entityId.
const SHIPMENT_TIMELINE_EVENT_TYPES = new Set([
  'shipment_master_created',
  'shipment_master_updated',
  'shipment_master_status_transition',
  'shipment_master_exception_acknowledged',
  'shipment_master_archived',
]);

// Per-event redactor for the timeline endpoint. Strips chain-stamp
// internals (_seq, _hash, _prevHash) and any PII the audit log might
// carry (event.record() is the choke point, but this is belt-and-braces
// for surfacing to a signed-in customer rather than an admin).
function redactTimelineEvent(e) {
  if (!e || typeof e !== 'object') return e;
  const {
    _seq, _hash, _prevHash, email, ...keep
  } = e;
  return keep;
}

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

  // Plan → shipment promotion. When the body carries `fromSavedPlanId`,
  // resolve the saved plan first and seed the shipment's fields from
  // its inputs + quote snapshot. The user can override any field by
  // including it explicitly in the body — the body wins over the plan.
  // This is the bridge that turns the wizard funnel (saved plan) into
  // the operational entity (shipment) without re-typing.
  let seed = {};
  if (body.fromSavedPlanId) {
    const resolved = await resolvePlanForPromotion(ctx.user, body.fromSavedPlanId);
    if (!resolved.ok) {
      const map = { not_found: 404, wrong_owner: 404, invalid_id: 400 };
      return jsonResponse(res, map[resolved.reason] || 500, { error: resolved.error });
    }
    seed = buildShipmentSeedFromPlan(resolved.plan);
    log.info('shipment promoted from saved plan', {
      event: 'shipment_promoted_from_plan',
      planId: body.fromSavedPlanId,
    });
  }

  const result = await shipments.createShipment({
    orgId: ctx.orgIdNumeric,
    createdByEmailHash: ctx.emailHash,
    label: body.label != null ? body.label : seed.label,
    goodsExternalId: body.goodsExternalId != null ? body.goodsExternalId : seed.goodsExternalId,
    supplierExternalId: body.supplierExternalId != null ? body.supplierExternalId : seed.supplierExternalId,
    plannedDepartureDate: body.plannedDepartureDate != null ? body.plannedDepartureDate : seed.plannedDepartureDate,
    plannedArrivalDate: body.plannedArrivalDate != null ? body.plannedArrivalDate : seed.plannedArrivalDate,
    customsValueCents: body.customsValueCents != null ? body.customsValueCents : seed.customsValueCents,
    originCountry: body.originCountry != null ? body.originCountry : seed.originCountry,
    destinationCountry: body.destinationCountry != null ? body.destinationCountry : seed.destinationCountry,
    weightKg: body.weightKg != null ? body.weightKg : seed.weightKg,
    containerCount: body.containerCount != null ? body.containerCount : seed.containerCount,
    documentVault: body.documentVault != null ? body.documentVault : seed.documentVault,
    inputsSnapshot: body.inputsSnapshot != null ? body.inputsSnapshot : seed.inputsSnapshot,
    quoteSnapshot: body.quoteSnapshot != null ? body.quoteSnapshot : seed.quoteSnapshot,
    metadata: body.metadata != null ? body.metadata : seed.metadata,
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

async function handleExceptionQueue(req, res, ctx) {
  const q = req.query || {};
  const result = await shipments.listExceptionQueue({
    orgId: ctx.orgIdNumeric,
    limit: q.limit ? Number(q.limit) : undefined,
    includeAcknowledged: q.includeAcknowledged !== '0' && q.includeAcknowledged !== 'false',
  });
  if (!result.ok) {
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    if (result.errors.some((e) => /orgId required/.test(e))) return jsonResponse(res, 400, { error: result.errors[0] });
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  return jsonResponse(res, 200, {
    ok: true,
    queue: result.queue,
    slaThresholdHours: shipments.EXCEPTION_SLA_THRESHOLD_HOURS,
  });
}

async function handleAcknowledgeException(req, res, ctx, externalId) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const result = await shipments.acknowledgeException({
    orgId: ctx.orgIdNumeric,
    externalId,
    actorEmailHash: ctx.emailHash,
    note: typeof body.note === 'string' ? body.note : undefined,
  });
  if (!result.ok) {
    if (result.conflict) return jsonResponse(res, 409, { error: result.errors[0] });
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    if (result.errors.some((e) => /required/.test(e))) return jsonResponse(res, 400, { error: result.errors[0] });
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  return jsonResponse(res, 200, { ok: true, shipment: result.shipment, unchanged: result.unchanged || false });
}

async function handleHistory(req, res, ctx, externalId) {
  // Confirm the shipment belongs to the user's org BEFORE returning
  // any audit data — even with a guess at an externalId, a non-owner
  // must see a 404 (not "this shipment exists, just not yours").
  const fetched = await shipments.getShipmentByExternalId({
    orgId: ctx.orgIdNumeric,
    externalId,
  });
  if (!fetched.ok) {
    if (fetched.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (/not configured/i.test(fetched.errors[0])) return jsonResponse(res, 503, { error: fetched.errors[0] });
    return jsonResponse(res, 500, { error: fetched.errors[0] });
  }
  try {
    const raw = await events.listForEntity({
      entityType: 'shipment_master',
      entityId: externalId,
      limit: 200,
    });
    const filtered = raw
      .filter((e) => SHIPMENT_TIMELINE_EVENT_TYPES.has(e.type))
      .map(redactTimelineEvent);
    return jsonResponse(res, 200, { ok: true, events: filtered });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'history read failed';
    log.warn('history read failed', { err: message, externalId });
    return jsonResponse(res, 500, { error: 'Could not read shipment history' });
  }
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

// ── Plan → shipment promotion ─────────────────────────────────────────
//
// Saved-plans ownership is per-user-email. Shipments are org-scoped.
// The bridge: a signed-in user may only promote a plan they personally
// own; the resulting shipment lands in their primary org. A user with
// multiple orgs can opt into a different org via the X-OrcaTrade-Org
// header (already handled by ensureAuthedOrg's resolveOrgId).

/**
 * @param {{ email: string }} user
 * @param {string} planId
 * @returns {Promise<{ ok: true, plan: object } | { ok: false, reason: string, error: string }>}
 */
async function resolvePlanForPromotion(user, planId) {
  if (typeof planId !== 'string' || !/^pl_[a-f0-9]{8,32}$/.test(planId)) {
    return { ok: false, reason: 'invalid_id', error: 'fromSavedPlanId must look like pl_<hex>' };
  }
  const plan = await savedPlans.getPlan(planId, user.email);
  if (!plan) {
    // savedPlans.getPlan returns null on both "doesn't exist" and
    // "exists but you don't own it" — we don't distinguish to avoid
    // leaking plan existence to a non-owner.
    return { ok: false, reason: 'not_found', error: 'Saved plan not found or not owned by this user' };
  }
  return { ok: true, plan };
}

/**
 * Build a shipment-create seed from a saved plan. Returns only the
 * keys the saved plan can supply; the handler overlays the body on top.
 *
 * @param {Record<string, any>} plan
 * @returns {Record<string, any>}
 */
function buildShipmentSeedFromPlan(plan) {
  const safePlan = (plan && typeof plan === 'object') ? plan : {};
  const inputs = (safePlan.inputs && typeof safePlan.inputs === 'object') ? safePlan.inputs : {};
  const seed = {
    // Default label includes the plan's own label or a category/route signature.
    label: safePlan.label
      ? `${safePlan.label} (from saved plan)`
      : (inputs.productCategory && inputs.originCountry && inputs.destinationCountry
          ? `${inputs.productCategory} · ${inputs.originCountry}→${inputs.destinationCountry}`
          : 'Shipment from saved plan'),
    originCountry: inputs.originCountry || null,
    destinationCountry: inputs.destinationCountry || null,
    weightKg: Number.isFinite(Number(inputs.weightKg)) ? Math.round(Number(inputs.weightKg)) : null,
    inputsSnapshot: inputs,
    quoteSnapshot: safePlan.snapshot || null,
  };
  // Euros → integer cents (ADR 0004). The savedPlans schema carries
  // customsValueEur as a number; convert at the boundary.
  if (Number.isFinite(Number(inputs.customsValueEur))) {
    seed.customsValueCents = Math.round(Number(inputs.customsValueEur) * 100);
  }
  return seed;
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

  // ['shipments'] | ['shipments', externalId] | ['shipments', externalId, 'transition'] |
  // ['shipments', externalId, 'exception', 'acknowledge'] | ['shipments', 'exceptions']
  const segments = pathSegments(req);
  const externalId = segments[1] || '';
  const action = segments[2] || '';

  // 'exceptions' is a RESERVED collection path under /api/shipments that
  // shadows the externalId slot. Route it to the queue handler before
  // we try to treat it as a shipment id.
  if (externalId === 'exceptions' && !action) {
    if (req.method !== 'GET') return jsonResponse(res, 405, { error: 'Method not allowed on /api/shipments/exceptions' });
    return handleExceptionQueue(req, res, ctx);
  }

  try {
    if (!externalId) {
      if (req.method === 'GET') return handleList(req, res, ctx);
      if (req.method === 'POST') return handleCreate(req, res, ctx);
      return jsonResponse(res, 405, { error: 'Method not allowed on /api/shipments' });
    }
    // Item or sub-action.
    if (action === 'transition') {
      if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'transition requires POST' });
      return handleTransition(req, res, ctx, externalId);
    }
    if (action === 'history') {
      if (req.method !== 'GET') return jsonResponse(res, 405, { error: 'history requires GET' });
      return handleHistory(req, res, ctx, externalId);
    }
    if (action === 'exception' && segments[3] === 'acknowledge') {
      if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'acknowledge requires POST' });
      return handleAcknowledgeException(req, res, ctx, externalId);
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

// Exposed for tests of the promotion bridge in isolation.
module.exports.resolvePlanForPromotion = resolvePlanForPromotion;
module.exports.buildShipmentSeedFromPlan = buildShipmentSeedFromPlan;
