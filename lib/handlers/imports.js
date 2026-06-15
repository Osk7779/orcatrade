'use strict';

// /api/imports — Import Request CRUD + lifecycle actions.
//
// L1.0 of docs/strategic-plan-2026-2031.md §4.1.2 — the customer-intent
// primitive that precedes Goods (L1.1), Supplier (L1.2), Shipment (L1.3).
//
// URL shape (catch-all):
//   GET    /api/imports                              → list
//   POST   /api/imports                              → create (status starts 'submitted')
//   GET    /api/imports/<externalId>                 → detail
//   POST   /api/imports/<externalId>/process         → kick off AI orchestrator (NOT YET WIRED — 501)
//   POST   /api/imports/<externalId>/review          → team-side review action
//   POST   /api/imports/<externalId>/decide          → customer-side approve/reject
//   POST   /api/imports/<externalId>/cancel          → cancel (any non-terminal status)
//   GET    /api/imports/<externalId>/history         → audit timeline
//   DELETE /api/imports/<externalId>                 → archive
//
// List filters: ?status=quoted · ?mine=1 (filter to current user's
// requests via created_by_email_hash match) · ?limit=N ·
// ?includeArchived=1.
//
// All mutations audit-logged before success (ADR 0005). Illegal
// transitions surface as 409 conflicts instead of silent shape changes.
//
// /process is reserved here but returns 501 in this commit; the AI
// orchestrator (lib/ai/import-request-orchestrator.js) lands in the
// next commit on this branch and turns 501 into 202+orchestrator-run.

const crypto = require('node:crypto');
const auth = require('../auth');
const orgs = require('../orgs');
const importRequests = require('../db/import-requests');
const importRequestOrchestrator = require('../ai/import-request-orchestrator');
const events = require('../events');
const log = require('../log').withContext({ handler: 'imports' });

// Subset of event types that belong on an import request's audit timeline.
const IMPORT_REQUEST_TIMELINE_EVENT_TYPES = new Set([
  'import_request_created',
  'import_request_updated',
  'import_request_status_transition',
  'import_request_archived',
]);

// Per-event redactor for the timeline endpoint. Strips chain-stamp
// internals (_seq, _hash, _prevHash) and any PII the audit log might
// carry. Mirrors the shipments handler treatment.
function redactTimelineEvent(e) {
  if (!e || typeof e !== 'object') return e;
  const { _seq, _hash, _prevHash, email, ...keep } = e;
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

// Catch-all path delivers ['imports', '<id>', '<action>?'].
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
  const mine = q.mine === '1' || q.mine === 'true';
  const result = await importRequests.listImportRequestsForOrg({
    orgId: ctx.orgIdNumeric,
    includeArchived: q.includeArchived === '1' || q.includeArchived === 'true',
    limit: q.limit ? Number(q.limit) : undefined,
    status: q.status ? String(q.status) : undefined,
    createdByEmailHash: mine ? ctx.emailHash : undefined,
  });
  if (!result.ok) {
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    if (result.errors.some((e) => /status must be|orgId required/.test(e))) {
      return jsonResponse(res, 400, { error: result.errors[0] });
    }
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  return jsonResponse(res, 200, { ok: true, importRequests: result.importRequests });
}

async function handleGet(req, res, ctx, externalId) {
  const result = await importRequests.getImportRequestByExternalId({
    orgId: ctx.orgIdNumeric,
    externalId,
  });
  if (!result.ok) {
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  return jsonResponse(res, 200, { ok: true, importRequest: result.importRequest });
}

async function handleCreate(req, res, ctx) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const result = await importRequests.createImportRequest({
    orgId: ctx.orgIdNumeric,
    createdByEmailHash: ctx.emailHash,
    label: body.label,
    productDescription: body.productDescription,
    hsCodeGuess: body.hsCodeGuess,
    targetQuantity: body.targetQuantity,
    targetQuantityUnit: body.targetQuantityUnit,
    targetUnitPriceCents: body.targetUnitPriceCents,
    originCountry: body.originCountry,
    destinationCountry: body.destinationCountry,
    targetDeliveryDate: body.targetDeliveryDate,
    certificationRequirements: body.certificationRequirements,
    intentMetadata: body.intentMetadata,
    metadata: body.metadata,
  });
  if (!result.ok) {
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    const status = result.errors.some((e) => /required|must be|≤|ADR/.test(e)) ? 400 : 500;
    return jsonResponse(res, status, { error: 'Validation failed', errors: result.errors });
  }
  return jsonResponse(res, 201, { ok: true, importRequest: result.importRequest });
}

async function handleProcess(req, res, ctx, externalId) {
  // Kick the request through the calculator orchestrator: transitions
  // submitted → processing, runs sourcing + customs + routing + finance
  // calculators, atomically attaches shortlist + quote and transitions
  // to awaiting_review. Runs synchronously for v1 — total wall clock is
  // typically <1s because everything is in-process. Once we add live
  // TARIC + comtrade calls in v2 this should move to a background
  // worker with the handler returning 202 immediately.
  const result = await importRequestOrchestrator.runOrchestrator({
    orgId: ctx.orgIdNumeric,
    externalId,
    actorEmailHash: ctx.emailHash,
  });
  if (!result.ok) {
    if (result.code === 'not_found') return jsonResponse(res, 404, { error: 'Not found' });
    if (result.code === 'wrong_state') return jsonResponse(res, 409, { error: result.errors[0] });
    if (result.code === 'concurrent_modification') return jsonResponse(res, 409, { error: result.errors[0] });
    if (result.code === 'bad_input') return jsonResponse(res, 400, { error: result.errors[0] });
    // All other failure codes already transitioned the row to 'failed'
    // with the reason recorded in failure_state — surface 502 so the
    // client knows the calculator pipeline (an upstream of sorts) is
    // the cause, not a client-side bug.
    log.warn('orchestrator failed', { externalId, code: result.code, errors: result.errors });
    return jsonResponse(res, 502, { error: result.errors[0], code: result.code });
  }
  return jsonResponse(res, 202, { ok: true, importRequest: result.importRequest, aiRunId: result.aiRunId });
}

async function handleReview(req, res, ctx, externalId) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const result = await importRequests.attachTeamReview({
    orgId: ctx.orgIdNumeric,
    externalId,
    actorEmailHash: ctx.emailHash,
    decision: body.decision,
    edits: Array.isArray(body.edits) ? body.edits : undefined,
    notes: typeof body.notes === 'string' ? body.notes : undefined,
  });
  if (!result.ok) {
    if (result.conflict) return jsonResponse(res, 409, { error: result.errors[0] });
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    if (result.errors.some((e) => /required|decision must|approved|sent_back|rejected/.test(e))) {
      return jsonResponse(res, 400, { error: result.errors[0] });
    }
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  return jsonResponse(res, 200, { ok: true, importRequest: result.importRequest });
}

async function handleDecide(req, res, ctx, externalId) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const result = await importRequests.attachCustomerDecision({
    orgId: ctx.orgIdNumeric,
    externalId,
    actorEmailHash: ctx.emailHash,
    decision: body.decision,
    notes: typeof body.notes === 'string' ? body.notes : undefined,
  });
  if (!result.ok) {
    if (result.conflict) return jsonResponse(res, 409, { error: result.errors[0] });
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    if (result.errors.some((e) => /required|decision must|approved|rejected/.test(e))) {
      return jsonResponse(res, 400, { error: result.errors[0] });
    }
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  return jsonResponse(res, 200, { ok: true, importRequest: result.importRequest });
}

async function handleCancel(req, res, ctx, externalId) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const result = await importRequests.transitionImportRequestStatus({
    orgId: ctx.orgIdNumeric,
    externalId,
    actorEmailHash: ctx.emailHash,
    toStatus: 'cancelled',
    details: {
      cancelledBy: ctx.emailHash,
      reason: typeof body.reason === 'string' ? body.reason.slice(0, 4000) : 'customer_requested',
    },
  });
  if (!result.ok) {
    if (result.conflict) return jsonResponse(res, 409, { error: result.errors[0], legalNext: result.legalNext });
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  return jsonResponse(res, 200, { ok: true, importRequest: result.importRequest, unchanged: result.unchanged || false });
}

async function handleHistory(req, res, ctx, externalId) {
  // Confirm the request belongs to this org BEFORE returning any audit
  // data — even with a guess at an externalId, a non-owner must see a
  // 404 (not "this request exists, just not yours").
  const fetched = await importRequests.getImportRequestByExternalId({
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
      entityType: 'import_request',
      entityId: externalId,
      limit: 200,
    });
    const filtered = raw
      .filter((e) => IMPORT_REQUEST_TIMELINE_EVENT_TYPES.has(e.type))
      .map(redactTimelineEvent);
    return jsonResponse(res, 200, { ok: true, events: filtered });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'history read failed';
    log.warn('history read failed', { err: message, externalId });
    return jsonResponse(res, 500, { error: 'Could not read import request history' });
  }
}

async function handleArchive(req, res, ctx, externalId) {
  const result = await importRequests.archiveImportRequest({
    orgId: ctx.orgIdNumeric,
    externalId,
    actorEmailHash: ctx.emailHash,
  });
  if (!result.ok) {
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  return jsonResponse(res, 200, { ok: true, importRequest: result.importRequest, unchanged: result.unchanged || false });
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

  // ['imports'] | ['imports', externalId] | ['imports', externalId, action]
  const segments = pathSegments(req);
  const externalId = segments[1] || '';
  const action = segments[2] || '';

  try {
    if (!externalId) {
      if (req.method === 'GET') return handleList(req, res, ctx);
      if (req.method === 'POST') return handleCreate(req, res, ctx);
      return jsonResponse(res, 405, { error: 'Method not allowed on /api/imports' });
    }
    if (action === 'process') {
      if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'process requires POST' });
      return handleProcess(req, res, ctx, externalId);
    }
    if (action === 'review') {
      if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'review requires POST' });
      return handleReview(req, res, ctx, externalId);
    }
    if (action === 'decide') {
      if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'decide requires POST' });
      return handleDecide(req, res, ctx, externalId);
    }
    if (action === 'cancel') {
      if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'cancel requires POST' });
      return handleCancel(req, res, ctx, externalId);
    }
    if (action === 'history') {
      if (req.method !== 'GET') return jsonResponse(res, 405, { error: 'history requires GET' });
      return handleHistory(req, res, ctx, externalId);
    }
    if (action) {
      return jsonResponse(res, 404, { error: `Unknown action: ${action}` });
    }
    if (req.method === 'GET') return handleGet(req, res, ctx, externalId);
    if (req.method === 'DELETE') return handleArchive(req, res, ctx, externalId);
    return jsonResponse(res, 405, { error: 'Method not allowed on /api/imports/<id>' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'imports handler threw';
    log.error('handler threw', { err: message, method: req.method, externalId, action });
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
