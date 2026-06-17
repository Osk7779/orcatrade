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
const rbac = require('../rbac');
const importRequests = require('../db/import-requests');
const importRequestOrchestrator = require('../ai/import-request-orchestrator');
const importsEmails = require('../imports-emails');
const events = require('../events');
const log = require('../log').withContext({ handler: 'imports' });

// Roles allowed to act on the team-side review queue. Drift-guarded
// against lib/imports-emails.OPS_NOTIFICATION_ROLES — the same set
// that receives the queue notification email. analyst / finance /
// compliance_officer / viewer / legacy member roles can see the
// customer-facing surface (their own requests, /imports/new) but
// cannot approve someone else's quote in awaiting_review.
const OPS_REVIEW_ROLES = new Set(['owner', 'admin']);

/**
 * Pure-function role gate exposed for tests + reused by the handler.
 * Accepts both canonical role names and the legacy 'member' alias
 * (rbac.canonicalRole maps 'member' → 'viewer').
 *
 * @param {string | null | undefined} role
 */
function isOpsRole(role) {
  const canonical = rbac.canonicalRole(role || '');
  return OPS_REVIEW_ROLES.has(String(canonical));
}

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

/**
 * Look up the current user's role within the org keyed by ctx.orgIdNumeric.
 * Returns the canonical role string, or null when the lookup fails for any
 * reason (org not mirrored, KV unavailable, user not a member). Treating
 * null as "no role" gives the requireOpsRole gate a safe-default DENY.
 *
 * @param {{ orgIdNumeric: number, user: { email: string } }} ctx
 */
async function lookupCtxRole(ctx) {
  const dbClient = require('../db/client');
  if (!dbClient.isConfigured()) return null;
  try {
    const row = await dbClient.queryOne(
      `SELECT external_id FROM organisations WHERE id = $1`,
      [ctx.orgIdNumeric],
    );
    if (!row || !row.external_id) return null;
    const role = await orgs.getMemberRole(row.external_id, ctx.user.email);
    return rbac.canonicalRole(role || '');
  } catch (err) {
    log.warn('lookupCtxRole failed', { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Send a 403 + return null when the current user lacks an ops role;
 * return { ok: true, role } when they have one. Designed to be called
 * at the top of handlers that gate ops-only actions, mirroring the
 * shape of ensureAuthedOrg.
 *
 * @param {*} _req
 * @param {*} res
 * @param {{ orgIdNumeric: number, user: { email: string } }} ctx
 */
async function requireOpsRole(_req, res, ctx) {
  const role = await lookupCtxRole(ctx);
  if (isOpsRole(role)) return { ok: true, role: String(role) };
  jsonResponse(res, 403, {
    error: 'Forbidden: only owner / admin members can review queued import requests',
    role: role || null,
  });
  return null;
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
    // Sprint 23 — drill-down cohort filter. Powers the
    // /imports?status=cancelled&declineReason=<reason> view linked
    // from the Ops Insights bars.
    declineReason: q.declineReason ? String(q.declineReason) : undefined,
    // Sprint 25 — free-text search across label, product_description,
    // external_id. Capped at 200 chars at the handler to prevent a
    // pathological multi-MB query string from reaching the data
    // layer; data layer escapes ILIKE wildcards.
    q: q.q ? String(q.q).slice(0, 200) : undefined,
    // Sprint 29 — supplier-pick cohort drill-down. Powers the
    // /imports?supplierPick=<ISO-2> view linked from the Top Picked
    // Countries cohort card on /imports/insights. Validated against
    // the ISO-2 shape at the data layer.
    supplierPickCountry: q.supplierPick ? String(q.supplierPick) : undefined,
  });
  if (!result.ok) {
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    if (result.errors.some((e) => /status must be|orgId required|declineReason must be|supplierPickCountry must be/.test(e))) {
      return jsonResponse(res, 400, { error: result.errors[0] });
    }
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  // Sprint 21 — augment each list entry with the caller's per-thread
  // unread count. Pure function; no extra DB round-trip. The caller
  // sees a tiny badge on /imports rows without pulling messages[] for
  // every entry on a list endpoint that should stay light.
  const augmented = (result.importRequests || []).map((r) => ({
    ...r,
    unreadMessageCount: importRequests.computeUnreadCount({
      messages: r.messages,
      messageReadState: r.messageReadState,
      actorEmailHash: ctx.emailHash,
    }),
  }));
  return jsonResponse(res, 200, { ok: true, importRequests: augmented });
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
  // Sprint 21 — same unread-count augmentation on the single-row path.
  const r = result.importRequest;
  const augmented = {
    ...r,
    unreadMessageCount: importRequests.computeUnreadCount({
      messages: r.messages,
      messageReadState: r.messageReadState,
      actorEmailHash: ctx.emailHash,
    }),
  };
  return jsonResponse(res, 200, { ok: true, importRequest: augmented });
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
    // Sprint 16 — revision lineage. Set when /imports/new lands with
    // ?revise=<externalId> and the customer submits the revised form.
    // The data-layer verifies same-org existence before insert.
    revisedFromExternalId: typeof body.revisedFromExternalId === 'string' && body.revisedFromExternalId
      ? body.revisedFromExternalId
      : undefined,
  });
  if (!result.ok) {
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    const status = result.errors.some((e) => /required|must be|≤|ADR/.test(e)) ? 400 : 500;
    return jsonResponse(res, status, { error: 'Validation failed', errors: result.errors });
  }
  // Stash the customer's raw email in KV so the "quote ready" email
  // has a recipient. Postgres only carries the email_hash (ADR 0008);
  // the KV row is the only place raw PII lives for this request, and
  // it expires after CONTACT_TTL_SECONDS. Fail-soft — the request
  // creation succeeds even if KV is down.
  await importsEmails.storeCustomerContact(result.importRequest.externalId, ctx.user.email);
  return jsonResponse(res, 201, { ok: true, importRequest: result.importRequest });
}

async function handleWhatIf(req, res, ctx, externalId) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};

  // Validate overrides up-front so the calculator never sees garbage.
  /** @type {string[]} */
  const errors = [];
  if (body.targetQuantity != null && (!Number.isInteger(body.targetQuantity) || body.targetQuantity <= 0)) {
    errors.push('targetQuantity must be a positive integer');
  }
  if (body.targetUnitPriceCents != null && (!Number.isInteger(body.targetUnitPriceCents) || body.targetUnitPriceCents < 0)) {
    errors.push('targetUnitPriceCents must be a non-negative integer (ADR 0004)');
  }
  if (body.originCountry != null && body.originCountry !== '') {
    if (!/^[A-Z]{2}$/i.test(String(body.originCountry))) {
      errors.push('originCountry must be ISO-2');
    }
  }
  if (body.hsCodeGuess != null && body.hsCodeGuess !== '') {
    if (!/^[0-9]{6,10}$/.test(String(body.hsCodeGuess))) {
      errors.push('hsCodeGuess must be 6-10 digits');
    }
  }
  if (errors.length) {
    return jsonResponse(res, 400, { error: 'Validation failed', errors });
  }

  // Read the persisted request — its existing intent + any prior
  // landed quote are the baseline we recompute against.
  const readResult = await importRequests.getImportRequestByExternalId({
    orgId: ctx.orgIdNumeric, externalId,
  });
  if (!readResult.ok) {
    if (readResult.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (/not configured/i.test(readResult.errors[0])) {
      return jsonResponse(res, 503, { error: readResult.errors[0] });
    }
    return jsonResponse(res, 500, { error: readResult.errors[0] });
  }
  const request = readResult.importRequest;

  // Build synthetic intent: customer's persisted fields with the
  // override fields layered on top. Keep productDescription, target
  // delivery date, and destination from the baseline — the what-if
  // mode is for tuning quantity, unit price, origin, and HS code.
  const classification = importRequestOrchestrator.classifyProductCategory(request.productDescription);
  const overriddenQuantity = Number.isInteger(body.targetQuantity) && body.targetQuantity > 0
    ? body.targetQuantity
    : (request.targetQuantity || 1000);
  const overriddenUnitPriceCents = body.targetUnitPriceCents != null
    ? body.targetUnitPriceCents
    : request.targetUnitPriceCents;
  const overriddenOrigin = body.originCountry
    ? String(body.originCountry).toUpperCase()
    : (request.originCountry || 'CN');
  const overriddenHsGuess = body.hsCodeGuess != null && body.hsCodeGuess !== ''
    ? String(body.hsCodeGuess)
    : (request.hsCodeGuess || null);

  // Derive urgencyWeeks from targetDeliveryDate the same way the
  // orchestrator does. Sprint 1 sets DEFAULT_URGENCY_WEEKS = 8.
  let urgencyWeeks;
  if (request.targetDeliveryDate) {
    const t = new Date(String(request.targetDeliveryDate));
    if (!Number.isNaN(t.getTime())) {
      const days = Math.max(7, Math.round((t.getTime() - Date.now()) / 86400000));
      urgencyWeeks = Math.max(1, Math.round(days / 7));
    }
  }

  const result = await importRequestOrchestrator.computeWhatIfQuote({
    productCategory: classification.category,
    productDescription: request.productDescription,
    originCountry: overriddenOrigin,
    destinationCountry: request.destinationCountry,
    targetQuantity: overriddenQuantity,
    targetUnitPriceCents: overriddenUnitPriceCents,
    hsCodeGuess: overriddenHsGuess,
    urgencyWeeks,
  });
  const whatIfQuote = result.landedQuote;
  const baselineQuote = request.landedQuote || null;
  const delta = baselineQuote && Number.isFinite(baselineQuote.totalLandedCents)
    ? {
        totalLandedCents: {
          from: baselineQuote.totalLandedCents,
          to: whatIfQuote.totalLandedCents,
          deltaCents: whatIfQuote.totalLandedCents - baselineQuote.totalLandedCents,
          deltaPct: baselineQuote.totalLandedCents > 0
            ? ((whatIfQuote.totalLandedCents - baselineQuote.totalLandedCents) / baselineQuote.totalLandedCents) * 100
            : null,
        },
        cargoValueCents: {
          from: baselineQuote.cargoValueCents,
          to: whatIfQuote.cargoValueCents,
          deltaCents: whatIfQuote.cargoValueCents - baselineQuote.cargoValueCents,
        },
        orcatradeFeeCents: {
          from: baselineQuote.orcatradeFeeCents,
          to: whatIfQuote.orcatradeFeeCents,
          deltaCents: whatIfQuote.orcatradeFeeCents - baselineQuote.orcatradeFeeCents,
        },
      }
    : null;

  return jsonResponse(res, 200, {
    ok: true,
    whatIfQuote,
    baselineQuote,
    appliedInputs: result.appliedInputs,
    delta,
  });
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
  // Notify the ops team that a new request hit the review queue.
  // Fail-soft: a Resend outage doesn't block the orchestrator response.
  if (result.importRequest && result.importRequest.status === 'awaiting_review') {
    importsEmails.sendNewInQueueEmail({
      request: result.importRequest,
      orgIdNumeric: ctx.orgIdNumeric,
    }).catch((err) => {
      log.warn('sendNewInQueueEmail threw', { externalId, err: err instanceof Error ? err.message : String(err) });
    });
  }
  return jsonResponse(res, 202, { ok: true, importRequest: result.importRequest, aiRunId: result.aiRunId });
}

async function handleReview(req, res, ctx, externalId) {
  // Sprint 6 ch 2: gate the team-side review action on owner/admin
  // role. Customer-facing /imports + /imports/new + /imports/[id]
  // stay open to all signed-in members (a user always sees + manages
  // their own requests). Only /review is ops-only.
  const guard = await requireOpsRole(req, res, ctx);
  if (!guard) return;

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const result = await importRequests.attachTeamReview({
    orgId: ctx.orgIdNumeric,
    externalId,
    actorEmailHash: ctx.emailHash,
    decision: body.decision,
    edits: Array.isArray(body.edits) ? body.edits : undefined,
    notes: typeof body.notes === 'string' ? body.notes : undefined,
    // Sprint 16 — required when decision='rejected'. The data-layer
    // rejects the call with a 400-style validation error if the
    // reason is missing or not in the enum.
    declineReason: typeof body.declineReason === 'string' ? body.declineReason : undefined,
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
  // Notify the customer that their quote is now live for approval. Only
  // fires on team-side 'approved' (which transitions awaiting_review →
  // quoted). Fail-soft.
  if (body.decision === 'approved' && result.importRequest && result.importRequest.status === 'quoted') {
    importsEmails.sendQuoteReadyEmail({ request: result.importRequest }).catch((err) => {
      log.warn('sendQuoteReadyEmail threw', { externalId, err: err instanceof Error ? err.message : String(err) });
    });
  }
  // Sprint 16 — notify the customer of a structured rejection. Fires on
  // team-side 'rejected' (which transitions awaiting_review → cancelled).
  // The email surfaces the decline reason + a "Revise" CTA for revisable
  // reasons; out_of_scope shows a dashboard link without a CTA. Fail-soft
  // so a Resend outage never blocks the data-layer transition.
  if (body.decision === 'rejected' && result.importRequest && result.importRequest.status === 'cancelled') {
    importsEmails.sendCustomerRejectedEmail({ request: result.importRequest }).catch((err) => {
      log.warn('sendCustomerRejectedEmail threw', { externalId, err: err instanceof Error ? err.message : String(err) });
    });
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

  // On approval, auto-materialise the downstream Shipment. Failure of
  // materialisation does NOT roll back the customer_approved transition
  // — the customer has said yes. We surface the materialisation error
  // alongside the request so the team console can retry or link
  // manually. A successful materialisation also returns the new
  // shipment_master row in the same response so the UI can navigate
  // straight to it.
  if (body.decision === 'approved') {
    const mat = await importRequestOrchestrator.materialiseApprovedRequest({
      orgId: ctx.orgIdNumeric,
      externalId,
      actorEmailHash: ctx.emailHash,
    });
    if (mat.ok) {
      // Notify ops that fulfilment can begin. Includes the shipment id
      // when materialisation produced one. Fail-soft.
      importsEmails.sendCustomerApprovedEmail({
        request: mat.importRequest,
        shipment: mat.shipment || null,
        orgIdNumeric: ctx.orgIdNumeric,
      }).catch((err) => {
        log.warn('sendCustomerApprovedEmail threw', { externalId, err: err instanceof Error ? err.message : String(err) });
      });
      return jsonResponse(res, 200, {
        ok: true,
        importRequest: mat.importRequest,
        shipment: mat.shipment,
        alreadyMaterialised: !!mat.alreadyMaterialised,
      });
    }
    log.warn('materialiseApprovedRequest failed; request stays approved without shipment', {
      externalId, code: mat.code, errors: mat.errors,
    });
    // Customer still approved — team needs to know so they can create
    // the shipment manually. shipment=null signals the manual path.
    importsEmails.sendCustomerApprovedEmail({
      request: result.importRequest,
      shipment: null,
      orgIdNumeric: ctx.orgIdNumeric,
    }).catch((err) => {
      log.warn('sendCustomerApprovedEmail threw (mat-fail branch)', { externalId, err: err instanceof Error ? err.message : String(err) });
    });
    return jsonResponse(res, 200, {
      ok: true,
      importRequest: result.importRequest,
      shipment: null,
      materialisation: {
        ok: false,
        code: mat.code,
        errors: mat.errors,
      },
    });
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

async function handleDossier(req, res, ctx, externalId) {
  // Sprint 12 ch 2 — compliance dossier PDF. Read the persisted
  // import_request (org-scoped), generate the PDF via the dossier
  // helper, send as application/pdf with a filename hint so the
  // browser's "Save as…" picks a sensible name. No persistence; the
  // dossier is a snapshot — every download reflects current state.
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
    const dossier = require('../intelligence/compliance-dossier');
    const bytes = await dossier.generateComplianceDossier({
      request: fetched.importRequest,
      generatedAt: new Date().toISOString().slice(0, 10),
    });
    const filename = `orcatrade-compliance-${externalId}.pdf`;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(bytes.length));
    return res.end(Buffer.from(bytes));
  } catch (err) {
    log.error('dossier generation failed', {
      externalId,
      err: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(res, 500, { error: 'Could not generate compliance dossier' });
  }
}

// Sprint 15 — customer-shareable landed-cost quote PDF. Parallel to
// handleDossier (sprint 12); same auth + org-scoping + no-store
// caching pattern. The quote PDF is the artifact the customer's CFO
// asks for; tight one-pager with the landed-cost breakdown front-and-
// centre, supplier shortlist preview, validity window. Available as
// soon as the quote is ready (status >= 'quote_ready') — earlier
// statuses have no quote to render so we 404 with a meaningful error.
async function handleQuotePdf(req, res, ctx, externalId) {
  const fetched = await importRequests.getImportRequestByExternalId({
    orgId: ctx.orgIdNumeric,
    externalId,
  });
  if (!fetched.ok) {
    if (fetched.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (/not configured/i.test(fetched.errors[0])) return jsonResponse(res, 503, { error: fetched.errors[0] });
    return jsonResponse(res, 500, { error: fetched.errors[0] });
  }
  const request = fetched.importRequest;
  // Pre-quote statuses (submitted / processing / failed) have no
  // landedQuote to render — return 409 so the UI can hide the button
  // until the quote exists, rather than 500 on an empty PDF.
  if (!request.landedQuote) {
    return jsonResponse(res, 409, {
      error: 'Quote PDF is available once the team has built your landed-cost quote.',
    });
  }
  try {
    const quotePdf = require('../intelligence/landed-quote-pdf');
    // Compute a 14-day validity window from request.lastReviewedAt /
    // approvedAt / now — same window as the orchestrator's default
    // quoteValidForDays. The PDF cover renders this as "Valid until".
    const baseIso = request.lastReviewedAt || request.lastUpdatedAt || new Date().toISOString();
    const validUntilTs = Date.parse(baseIso) + 14 * 24 * 60 * 60 * 1000;
    const validUntil = Number.isFinite(validUntilTs)
      ? new Date(validUntilTs).toISOString().slice(0, 10)
      : null;
    const bytes = await quotePdf.generateLandedQuotePdf({
      request,
      generatedAt: new Date().toISOString().slice(0, 10),
      validUntil,
    });
    const filename = `orcatrade-quote-${externalId}.pdf`;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(bytes.length));
    return res.end(Buffer.from(bytes));
  } catch (err) {
    log.error('landed-quote PDF generation failed', {
      externalId,
      err: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(res, 500, { error: 'Could not generate landed-cost quote PDF' });
  }
}

// Sprint 17 — Ops Insights. Ops-only because the funnel + decline-
// reason breakdown is org-wide aggregate data that customers shouldn't
// see for their own org (a customer should only see their own
// requests). The same RBAC gate that protects the review action
// protects this endpoint.
async function handleInsights(req, res, ctx) {
  const guard = await requireOpsRole(req, res, ctx);
  if (!guard) return;
  const url = new URL(req.url || '/', 'https://orcatrade.local');
  const requested = Number(url.searchParams.get('windowDays') || 30);
  const windowDays = Number.isFinite(requested) ? requested : 30;
  const result = await importRequests.aggregateOpsInsights({
    orgId: ctx.orgIdNumeric,
    windowDays,
  });
  if (!result.ok) {
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  return jsonResponse(res, 200, {
    ok: true,
    windowDays: result.windowDays,
    insights: result.insights,
  });
}

// Sprint 18 — per-request customer ↔ ops messaging thread. POST with
// { body } — the role is inferred from the caller's RBAC (owner/admin
// → 'ops', everyone else → 'customer'). This keeps the request body
// small and prevents a customer from spoofing role='ops' from the
// browser. The data-layer enforces the same-org WHERE clause so a
// cross-org POST returns 404 (not "this exists but isn't yours").
async function handlePostMessage(req, res, ctx, externalId) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const role = isOpsRole(ctx.role) ? 'ops' : 'customer';
  const result = await importRequests.appendImportRequestMessage({
    orgId: ctx.orgIdNumeric,
    externalId,
    actorEmailHash: ctx.emailHash,
    role,
    body: typeof body.body === 'string' ? body.body : '',
  });
  if (!result.ok) {
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (result.conflict) return jsonResponse(res, 409, { error: result.errors[0] });
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    if (result.errors.some((e) => /required|must be|<=|empty|one of/.test(e))) {
      return jsonResponse(res, 400, { error: result.errors[0] });
    }
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  // Fire the cross-side email notification. Customer-posted message →
  // ops inbox; ops-posted message → customer email. Fail-soft.
  importsEmails.sendImportRequestMessageEmail({
    request: result.importRequest,
    message: result.message,
    orgIdNumeric: ctx.orgIdNumeric,
  }).catch((err) => {
    log.warn('sendImportRequestMessageEmail threw', { externalId, err: err instanceof Error ? err.message : String(err) });
  });
  return jsonResponse(res, 201, { ok: true, importRequest: result.importRequest, message: result.message });
}

// Sprint 20 — bulk team review. Ops-only (same RBAC gate as
// /review). The data-layer loops over externalIds calling
// attachTeamReview per row; failures are isolated so a single drift
// (status changed concurrently, missing decline reason, etc.) does
// NOT roll back successful rows. The handler fans out per-row emails
// (quote-ready / customer-rejected) using the same fail-soft pattern
// as the single-row /review path — a Resend outage cannot block any
// of the data-layer writes.
async function handleBulkReview(req, res, ctx) {
  const guard = await requireOpsRole(req, res, ctx);
  if (!guard) return;

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const result = await importRequests.bulkAttachTeamReview({
    orgId: ctx.orgIdNumeric,
    externalIds: Array.isArray(body.externalIds) ? body.externalIds : [],
    actorEmailHash: ctx.emailHash,
    decision: body.decision,
    notes: typeof body.notes === 'string' ? body.notes : undefined,
    declineReason: typeof body.declineReason === 'string' ? body.declineReason : undefined,
  });
  if (!result.ok) {
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    return jsonResponse(res, 400, { error: result.errors[0] });
  }

  // Per-row email fan-out — mirrors handleReview's hookup. Customer-
  // visible state changes (approved → quoted, rejected → cancelled)
  // each fire the corresponding email. The customer for ROW N hears
  // about ROW N; no cross-row leakage. Fail-soft via .catch().
  for (const { importRequest } of result.succeeded) {
    if (body.decision === 'approved' && importRequest.status === 'quoted') {
      importsEmails.sendQuoteReadyEmail({ request: importRequest }).catch((err) => {
        log.warn('sendQuoteReadyEmail threw (bulk)', { externalId: importRequest.externalId, err: err instanceof Error ? err.message : String(err) });
      });
    } else if (body.decision === 'rejected' && importRequest.status === 'cancelled') {
      importsEmails.sendCustomerRejectedEmail({ request: importRequest }).catch((err) => {
        log.warn('sendCustomerRejectedEmail threw (bulk)', { externalId: importRequest.externalId, err: err instanceof Error ? err.message : String(err) });
      });
    }
  }

  return jsonResponse(res, 200, {
    ok: true,
    decision: result.decision,
    succeededCount: result.succeededCount,
    failedCount: result.failedCount,
    succeeded: result.succeeded.map((s) => ({ externalId: s.externalId })),
    failed: result.failed,
  });
}

// Sprint 21 — mark messages on a thread as read for the calling user.
// Idempotent (re-marking the same set is safe). NOT audit-logged —
// read receipts are metadata about visibility, not substantive state
// (would otherwise flood the audit chain head + KV).
async function handleMarkMessagesRead(req, res, ctx, externalId) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const result = await importRequests.markMessagesRead({
    orgId: ctx.orgIdNumeric,
    externalId,
    actorEmailHash: ctx.emailHash,
    readUpToMessageId: typeof body.readUpToMessageId === 'string' ? body.readUpToMessageId : undefined,
    readUpToAt: typeof body.readUpToAt === 'string' ? body.readUpToAt : undefined,
  });
  if (!result.ok) {
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  // Compute the post-mark unread count for the response so the UI
  // can immediately drop its badge to 0 without a re-fetch.
  const unreadCount = importRequests.computeUnreadCount({
    messages: result.importRequest.messages,
    messageReadState: result.importRequest.messageReadState,
    actorEmailHash: ctx.emailHash,
  });
  return jsonResponse(res, 200, {
    ok: true,
    importRequest: result.importRequest,
    unreadCount,
  });
}

// Sprint 27 — compliance evidence attachment. Both customer and ops
// can attach evidence to a request (customer attaches their own;
// ops can attach evidence on behalf of any request in the org).
// Body is JSON: { regime, label, url, notes? }. URL must be a single
// https:// link — drift-guarded at the data layer.
async function handlePostEvidence(req, res, ctx, externalId) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const result = await importRequests.appendEvidenceAttachment({
    orgId: ctx.orgIdNumeric,
    externalId,
    actorEmailHash: ctx.emailHash,
    regime: typeof body.regime === 'string' ? body.regime : '',
    label: typeof body.label === 'string' ? body.label : '',
    url: typeof body.url === 'string' ? body.url : '',
    notes: typeof body.notes === 'string' ? body.notes : undefined,
  });
  if (!result.ok) {
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (result.conflict) return jsonResponse(res, 409, { error: result.errors[0] });
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    if (result.errors.some((e) => /required|must be|<=|one of|https/.test(e))) {
      return jsonResponse(res, 400, { error: result.errors[0] });
    }
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  return jsonResponse(res, 201, {
    ok: true,
    importRequest: result.importRequest,
    attachment: result.attachment,
  });
}

// Sprint 30 — customer rating. RBAC: only the request creator can
// rate. We enforce this by comparing ctx.emailHash against the
// request's createdByEmailHash. Ops cannot rate on the customer's
// behalf — a 403 nudges them to nudge the customer instead. The
// data-layer enforces the status guard (customer_approved only)
// + the 1-5 score range + 2000-char comment cap.
async function handlePostRating(req, res, ctx, externalId) {
  // Authorize as request creator. Fetch the row first so we can
  // compare email hashes without trusting the client.
  const fetched = await importRequests.getImportRequestByExternalId({
    orgId: ctx.orgIdNumeric,
    externalId,
  });
  if (!fetched.ok) {
    if (fetched.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (/not configured/i.test(fetched.errors[0])) return jsonResponse(res, 503, { error: fetched.errors[0] });
    return jsonResponse(res, 500, { error: fetched.errors[0] });
  }
  if (fetched.importRequest.createdByEmailHash !== ctx.emailHash) {
    return jsonResponse(res, 403, { error: 'Only the request creator can submit a rating.' });
  }

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const result = await importRequests.recordCustomerRating({
    orgId: ctx.orgIdNumeric,
    externalId,
    actorEmailHash: ctx.emailHash,
    score: Number(body.score),
    comment: typeof body.comment === 'string' ? body.comment : undefined,
  });
  if (!result.ok) {
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    if (result.conflict) return jsonResponse(res, 409, { error: result.errors[0] });
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    if (result.errors.some((e) => /required|must be|<=|integer in/.test(e))) {
      return jsonResponse(res, 400, { error: result.errors[0] });
    }
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  // Sprint 33 — fire the immediate ops alert when the score is in
  // the "needs follow-up" range (1-2★). Fail-soft: a Resend hiccup
  // cannot block the rating write. The sender itself short-circuits
  // when score > 2, so the caller can fire unconditionally.
  if (result.rating && result.rating.score <= 2) {
    importsEmails.sendLowRatingAlert({
      request: result.importRequest,
      rating: result.rating,
      isSupersession: result.isSupersession === true,
      orgIdNumeric: ctx.orgIdNumeric,
    }).catch((err) => {
      log.warn('sendLowRatingAlert threw', {
        externalId, err: err instanceof Error ? err.message : String(err),
      });
    });
  }
  return jsonResponse(res, 201, {
    ok: true,
    importRequest: result.importRequest,
    rating: result.rating,
  });
}

// Sprint 34 — CSV export of the imports list. Reuses
// listImportRequestsForOrg with the same filter taxonomy as
// handleList so the export mirrors exactly whatever filtered view
// ops is looking at. At v1 volumes (hundreds of rows, not millions)
// in-memory generation is fine; streaming becomes worth the
// complexity at 50k+ rows.
//
// Output: RFC-4180 CSV with header row. Every field is wrapped in
// double-quotes + internal quotes doubled; embedded newlines stay
// inline (RFC allows them inside quoted fields). UTF-8 BOM at the
// top so Excel opens it without garbling diacritics — a real
// problem on customer-facing exports (we saw it on the partner
// brief earlier in the program).
function csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  if (s === '') return '';
  // Always quote — defensive against fields that don't currently
  // contain special chars but might tomorrow. Doubled-double-quote
  // escaping is the RFC-4180 convention.
  return '"' + s.replace(/"/g, '""') + '"';
}

// Map an importRequest row to the export columns. Pinned here so a
// drift-guard test can assert every load-bearing field is included.
// Adding a new field is a 2-line change: extend EXPORT_COLUMNS and
// extend exportRowFor.
const EXPORT_COLUMNS = Object.freeze([
  'External ID',
  'Status',
  'Label',
  'Product description',
  'HS code',
  'Origin',
  'Destination',
  'Target quantity',
  'Target unit',
  'Target unit price (EUR)',
  'Landed total (EUR)',
  'Confidence tier',
  'Decline reason',
  'Supplier pick country',
  'Customer rating',
  'Created at',
  'Updated at',
]);

function exportRowFor(r) {
  const landed = r.landedQuote && Number.isFinite(r.landedQuote.totalLandedCents)
    ? (Number(r.landedQuote.totalLandedCents) / 100).toFixed(2)
    : '';
  const unitPrice = Number.isFinite(Number(r.targetUnitPriceCents))
    ? (Number(r.targetUnitPriceCents) / 100).toFixed(2)
    : '';
  const declineReason = (r.teamReviewState && r.teamReviewState.declineReason) || '';
  const pickCountry = (r.supplierPick && r.supplierPick.country) || '';
  const rating = (r.customerRating && Number.isInteger(r.customerRating.score))
    ? String(r.customerRating.score)
    : '';
  return [
    r.externalId,
    r.status,
    r.label,
    r.productDescription,
    r.hsCodeGuess || '',
    r.originCountry || '',
    r.destinationCountry,
    r.targetQuantity || '',
    r.targetQuantityUnit || '',
    unitPrice,
    landed,
    (r.landedQuote && r.landedQuote.confidenceTier) || '',
    declineReason,
    pickCountry,
    rating,
    r.createdAt || '',
    r.updatedAt || '',
  ];
}

async function handleExportCsv(req, res, ctx) {
  const q = req.query || {};
  const mine = q.mine === '1' || q.mine === 'true';
  // Export caps at 5000 rows. The customer-facing list page caps at
  // 200 (sprint 1 default), but ops use the export for compliance +
  // board reports and can plausibly want a quarter's worth at once.
  // 5000 keeps the in-memory generation well under 50MB even with
  // large product descriptions.
  const result = await importRequests.listImportRequestsForOrg({
    orgId: ctx.orgIdNumeric,
    includeArchived: q.includeArchived === '1' || q.includeArchived === 'true',
    limit: 5000,
    status: q.status ? String(q.status) : undefined,
    createdByEmailHash: mine ? ctx.emailHash : undefined,
    declineReason: q.declineReason ? String(q.declineReason) : undefined,
    q: q.q ? String(q.q).slice(0, 200) : undefined,
    supplierPickCountry: q.supplierPick ? String(q.supplierPick) : undefined,
  });
  if (!result.ok) {
    if (/not configured/i.test(result.errors[0])) return jsonResponse(res, 503, { error: result.errors[0] });
    if (result.errors.some((e) => /status must be|orgId required|declineReason must be|supplierPickCountry must be/.test(e))) {
      return jsonResponse(res, 400, { error: result.errors[0] });
    }
    return jsonResponse(res, 500, { error: result.errors[0] });
  }
  const rows = result.importRequests || [];
  // UTF-8 BOM (﻿) so Excel + Numbers open the file without
  // mangling diacritics in customer-supplied product descriptions
  // (Vietnamese, Polish, German etc).
  const lines = ['﻿' + EXPORT_COLUMNS.map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push(exportRowFor(r).map(csvEscape).join(','));
  }
  const csv = lines.join('\r\n');
  const filename = `orcatrade-imports-${new Date().toISOString().slice(0, 10)}.csv`;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', String(Buffer.byteLength(csv, 'utf8')));
  return res.end(csv);
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
    // Sprint 17 — /api/imports/insights. Collides with the externalId
    // slot; we resolve it here as a literal action segment so a future
    // request id can never start with the literal "insights".
    if (externalId === 'insights' && !action) {
      if (req.method !== 'GET') return jsonResponse(res, 405, { error: 'insights requires GET' });
      return handleInsights(req, res, ctx);
    }
    // Sprint 20 — /api/imports/bulk-review. Same reserved-keyword
    // pattern (external IDs are 'ir_<16hex>' and never collide with
    // the literal "bulk-review").
    if (externalId === 'bulk-review' && !action) {
      if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'bulk-review requires POST' });
      return handleBulkReview(req, res, ctx);
    }
    // Sprint 34 — /api/imports/export.csv. Reuses listImportRequestsForOrg
    // with the same filter taxonomy as handleList so the export
    // mirrors whatever filtered view ops is looking at.
    if (externalId === 'export.csv' && !action) {
      if (req.method !== 'GET') return jsonResponse(res, 405, { error: 'export.csv requires GET' });
      return handleExportCsv(req, res, ctx);
    }
    if (action === 'process') {
      if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'process requires POST' });
      return handleProcess(req, res, ctx, externalId);
    }
    if (action === 'whatif') {
      if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'whatif requires POST' });
      return handleWhatIf(req, res, ctx, externalId);
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
    if (action === 'dossier') {
      if (req.method !== 'GET') return jsonResponse(res, 405, { error: 'dossier requires GET' });
      return handleDossier(req, res, ctx, externalId);
    }
    if (action === 'quote') {
      if (req.method !== 'GET') return jsonResponse(res, 405, { error: 'quote requires GET' });
      return handleQuotePdf(req, res, ctx, externalId);
    }
    if (action === 'messages') {
      // Sprint 21 — sub-action `messages/read` for the read-receipt
      // path. Without the sub-action it's the sprint-18 POST-message
      // path. The sub-segment lookup uses segments[3] (the slot after
      // the action) so we don't collide with future deeper actions.
      const sub = segments[3] || '';
      if (sub === 'read') {
        if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'messages/read requires POST' });
        return handleMarkMessagesRead(req, res, ctx, externalId);
      }
      if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'messages requires POST' });
      return handlePostMessage(req, res, ctx, externalId);
    }
    if (action === 'evidence') {
      // Sprint 27 — append a compliance evidence attachment. URL-based
      // v1: customer or ops posts a cloud-share link (SharePoint /
      // GDrive / DropBox / signed S3) + a label + regime tag. Inline
      // file upload deferred until real customer volume justifies
      // storage + AV-scan + signed-URL infra.
      if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'evidence requires POST' });
      return handlePostEvidence(req, res, ctx, externalId);
    }
    if (action === 'rating') {
      // Sprint 30 — customer rating. Customer-only path; ops cannot
      // rate on the customer's behalf. Last-write-wins on
      // supersession; the audit chain preserves the supersession
      // event so the prior rating is recoverable.
      if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'rating requires POST' });
      return handlePostRating(req, res, ctx, externalId);
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

// Exposed for tests of the RBAC gate in isolation (sprint 6 ch 2).
module.exports.isOpsRole = isOpsRole;
module.exports.OPS_REVIEW_ROLES = OPS_REVIEW_ROLES;
