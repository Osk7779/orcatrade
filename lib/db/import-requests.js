// @ts-check
'use strict';

// Import Request CRUD + state machine — L1.0 of
// docs/strategic-plan-2026-2031.md §4.1.2.
//
// The customer-intent primitive that precedes Goods (L1.1), Supplier
// (L1.2), Shipment (L1.3). The Operator wedge of the billion-dollar
// direction: the customer expresses what they want to import; the AI
// generates a factory shortlist + a calculator-grounded landed-cost
// quote; the OrcaTrade team reviews (ADR 0015) before the customer
// sees it; the customer approves; downstream Shipment + Goods +
// Supplier get materialised.
//
// Mirrors lib/db/shipments.js in shape. The load-bearing distinct
// piece is the wider state machine and the AI-artefact attach
// functions that transition + write JSONB atomically so the orchestrator
// can't leave a row in a half-written state.
//
// State transitions
// ─────────────────
//   submitted        → processing | cancelled | failed
//   processing       → awaiting_review | failed | cancelled
//   awaiting_review  → quoted | cancelled | failed
//   quoted           → customer_approved | customer_rejected
//                    | expired | cancelled
//   customer_approved, customer_rejected, expired, cancelled, failed → ∅
//
// The transition table is the source of truth (mirrored in
// app-shell/lib/api.ts; a drift-guard test pins both sides).

const crypto = require('node:crypto');
const db = require('./client');
const events = require('../events');
const log = require('../log').withContext({ module: 'db-import-requests' });

const ISO2_RE = /^[A-Z]{2}$/;
const HS_RE = /^[0-9]{6,10}$/;

const STATUSES = Object.freeze([
  'submitted',
  'processing',
  'awaiting_review',
  'quoted',
  'customer_approved',
  'customer_rejected',
  'expired',
  'cancelled',
  'failed',
]);

const TERMINAL_STATUSES = Object.freeze([
  'customer_approved',
  'customer_rejected',
  'expired',
  'cancelled',
  'failed',
]);

const QUANTITY_UNITS = Object.freeze([
  'pieces', 'kg', 'pallets', 'units', 'cartons', 'tonnes', 'litres', 'cubic_metres',
]);

/**
 * Canonical transition table. Adding a new edge here requires updating
 * the drift-guard test that pins the table contents against the SQL
 * status-check constraint and the TS mirror in app-shell/lib/api.ts.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const VALID_TRANSITIONS = Object.freeze({
  submitted: Object.freeze(['processing', 'cancelled', 'failed']),
  processing: Object.freeze(['awaiting_review', 'failed', 'cancelled']),
  awaiting_review: Object.freeze(['quoted', 'cancelled', 'failed', 'processing']),
  quoted: Object.freeze(['customer_approved', 'customer_rejected', 'expired', 'cancelled']),
  customer_approved: Object.freeze([]),
  customer_rejected: Object.freeze([]),
  expired: Object.freeze([]),
  cancelled: Object.freeze([]),
  failed: Object.freeze([]),
});

function generateImportRequestId() {
  return 'ir_' + crypto.randomBytes(8).toString('hex');
}

/**
 * @param {Record<string, any> | null | undefined} r
 */
function rowToImportRequest(r) {
  if (!r) return null;
  return {
    id: r.id,
    externalId: r.external_id,
    orgId: r.org_id,
    createdByEmailHash: r.created_by_email_hash,
    label: r.label,
    status: r.status,
    productDescription: r.product_description,
    hsCodeGuess: r.hs_code_guess,
    targetQuantity: r.target_quantity == null ? null : Number(r.target_quantity),
    targetQuantityUnit: r.target_quantity_unit,
    targetUnitPriceCents: r.target_unit_price_cents == null ? null : Number(r.target_unit_price_cents),
    originCountry: r.origin_country,
    destinationCountry: r.destination_country,
    targetDeliveryDate: r.target_delivery_date,
    certificationRequirements: Array.isArray(r.certification_requirements) ? r.certification_requirements : [],
    intentMetadata: (r.intent_metadata && typeof r.intent_metadata === 'object') ? r.intent_metadata : {},
    factoryShortlist: Array.isArray(r.factory_shortlist) ? r.factory_shortlist : [],
    shortlistGeneratedAt: r.shortlist_generated_at,
    landedQuote: r.landed_quote,
    quoteGeneratedAt: r.quote_generated_at,
    quoteExpiresAt: r.quote_expires_at,
    aiRunIds: Array.isArray(r.ai_run_ids) ? r.ai_run_ids : [],
    teamReviewState: (r.team_review_state && typeof r.team_review_state === 'object') ? r.team_review_state : {},
    customerDecisionState: (r.customer_decision_state && typeof r.customer_decision_state === 'object') ? r.customer_decision_state : {},
    failureState: (r.failure_state && typeof r.failure_state === 'object') ? r.failure_state : {},
    linkedShipmentExternalId: r.linked_shipment_external_id,
    linkedGoodsExternalId: r.linked_goods_external_id,
    linkedSupplierExternalId: r.linked_supplier_external_id,
    metadata: (r.metadata && typeof r.metadata === 'object') ? r.metadata : {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archivedAt: r.archived_at,
  };
}

// ── Validation ────────────────────────────────────────────────────────

/**
 * @param {Record<string, any>} input
 */
function validateForCreate(input) {
  /** @type {string[]} */
  const errors = [];
  if (!input || typeof input !== 'object') return ['input required'];

  if (!Number.isInteger(input.orgId) || input.orgId <= 0) errors.push('orgId required (positive integer)');
  if (!input.createdByEmailHash || typeof input.createdByEmailHash !== 'string') errors.push('createdByEmailHash required');

  if (!input.label || typeof input.label !== 'string') errors.push('label required');
  else if (input.label.length > 200) errors.push('label must be ≤200 chars');

  if (!input.productDescription || typeof input.productDescription !== 'string') {
    errors.push('productDescription required');
  } else if (input.productDescription.length > 4000) {
    errors.push('productDescription must be ≤4000 chars');
  }

  if (!input.destinationCountry || typeof input.destinationCountry !== 'string') {
    errors.push('destinationCountry required');
  } else if (!ISO2_RE.test(String(input.destinationCountry).toUpperCase())) {
    errors.push('destinationCountry must be ISO-2 uppercase');
  }

  if (input.originCountry != null && input.originCountry !== '') {
    if (!ISO2_RE.test(String(input.originCountry).toUpperCase())) errors.push('originCountry must be ISO-2 uppercase');
  }

  if (input.hsCodeGuess != null && input.hsCodeGuess !== '') {
    if (!HS_RE.test(String(input.hsCodeGuess))) errors.push('hsCodeGuess must be 6-10 digits');
  }

  if (input.targetQuantity != null) {
    if (!Number.isInteger(input.targetQuantity) || input.targetQuantity <= 0) {
      errors.push('targetQuantity must be a positive integer');
    }
  }

  if (input.targetQuantityUnit != null && input.targetQuantityUnit !== '') {
    if (!QUANTITY_UNITS.includes(input.targetQuantityUnit)) {
      errors.push(`targetQuantityUnit must be one of: ${QUANTITY_UNITS.join(', ')}`);
    }
  }

  if (input.targetUnitPriceCents != null) {
    if (!Number.isInteger(input.targetUnitPriceCents) || input.targetUnitPriceCents < 0) {
      errors.push('targetUnitPriceCents must be a non-negative integer (ADR 0004)');
    }
  }

  if (input.certificationRequirements !== undefined) {
    if (!Array.isArray(input.certificationRequirements)) {
      errors.push('certificationRequirements must be an array');
    } else if (input.certificationRequirements.some((c) => typeof c !== 'string' || !c.trim())) {
      errors.push('certificationRequirements entries must be non-empty strings');
    }
  }

  if (input.intentMetadata !== undefined && (typeof input.intentMetadata !== 'object' || Array.isArray(input.intentMetadata))) {
    errors.push('intentMetadata must be an object');
  }

  if (input.metadata !== undefined && (typeof input.metadata !== 'object' || Array.isArray(input.metadata))) {
    errors.push('metadata must be an object');
  }

  return errors;
}

// ── State machine ─────────────────────────────────────────────────────

/**
 * @param {string} from
 * @param {string} to
 */
function isLegalTransition(from, to) {
  if (typeof from !== 'string' || typeof to !== 'string') return false;
  if (!STATUSES.includes(from) || !STATUSES.includes(to)) return false;
  const allowed = VALID_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

// ── Helpers ───────────────────────────────────────────────────────────

function notConfigured() {
  return { ok: false, errors: ['Postgres not configured (DATABASE_URL missing)'] };
}

/**
 * @param {string} message
 */
function failureFromDb(message) {
  if (/violates check constraint.*import_requests_status_check/i.test(message)) {
    return { ok: false, errors: [`status must be one of: ${STATUSES.join(', ')}`] };
  }
  if (/violates check constraint.*import_requests_origin_country_format/i.test(message)) {
    return { ok: false, errors: ['originCountry must be ISO-2 uppercase'] };
  }
  if (/violates check constraint.*import_requests_destination_country_format/i.test(message)) {
    return { ok: false, errors: ['destinationCountry must be ISO-2 uppercase'] };
  }
  if (/violates check constraint.*import_requests_hs_code_format/i.test(message)) {
    return { ok: false, errors: ['hsCodeGuess must be 6-10 digits'] };
  }
  if (/violates check constraint.*import_requests_target_quantity_non_negative/i.test(message)) {
    return { ok: false, errors: ['targetQuantity must be a positive integer'] };
  }
  if (/violates check constraint.*import_requests_target_unit_price_non_negative/i.test(message)) {
    return { ok: false, errors: ['targetUnitPriceCents must be a non-negative integer'] };
  }
  if (/violates check constraint.*import_requests_target_quantity_unit_check/i.test(message)) {
    return { ok: false, errors: [`targetQuantityUnit must be one of: ${QUANTITY_UNITS.join(', ')}`] };
  }
  return { ok: false, errors: [message] };
}

// ── CRUD ──────────────────────────────────────────────────────────────

/**
 * @param {Record<string, any>} input
 */
async function createImportRequest(input) {
  const errors = validateForCreate(input);
  if (errors.length) return { ok: false, errors };
  if (!db.isConfigured()) return notConfigured();

  const externalId = generateImportRequestId();
  try {
    const rows = await db.query(
      `INSERT INTO import_requests (
        external_id, org_id, created_by_email_hash, label, status,
        product_description, hs_code_guess,
        target_quantity, target_quantity_unit, target_unit_price_cents,
        origin_country, destination_country, target_delivery_date,
        certification_requirements, intent_metadata, metadata
      ) VALUES (
        $1, $2, $3, $4, 'submitted',
        $5, $6,
        $7, $8, $9,
        $10, $11, $12,
        $13, $14, $15
      )
      RETURNING *`,
      [
        externalId, input.orgId, input.createdByEmailHash, input.label,
        input.productDescription,
        input.hsCodeGuess || null,
        input.targetQuantity == null ? null : input.targetQuantity,
        input.targetQuantityUnit || null,
        input.targetUnitPriceCents == null ? null : input.targetUnitPriceCents,
        input.originCountry ? String(input.originCountry).toUpperCase() : null,
        String(input.destinationCountry).toUpperCase(),
        input.targetDeliveryDate || null,
        JSON.stringify(input.certificationRequirements || []),
        JSON.stringify(input.intentMetadata || {}),
        JSON.stringify(input.metadata || {}),
      ],
    );
    const importRequest = rowToImportRequest(rows[0]);
    await events.record('import_request_created', {
      orgId: input.orgId,
      actorEmailHash: input.createdByEmailHash,
      entityType: 'import_request',
      entityId: externalId,
      after: importRequest,
    });
    return { ok: true, importRequest };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'import_request create failed';
    log.warn('createImportRequest failed', { err: message });
    return failureFromDb(message);
  }
}

/**
 * @param {{ orgId: number, externalId: string }} input
 */
async function getImportRequestByExternalId({ orgId, externalId }) {
  if (!Number.isInteger(orgId) || !externalId) return { ok: false, errors: ['orgId + externalId required'] };
  if (!db.isConfigured()) return notConfigured();
  try {
    const rows = await db.query(
      `SELECT * FROM import_requests WHERE org_id = $1 AND external_id = $2`,
      [orgId, externalId],
    );
    if (rows.length === 0) return { ok: false, errors: ['not_found'], notFound: true };
    return { ok: true, importRequest: rowToImportRequest(rows[0]) };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'import_request read failed');
  }
}

/**
 * @param {{
 *   orgId: number,
 *   includeArchived?: boolean,
 *   limit?: number,
 *   status?: string,
 *   createdByEmailHash?: string
 * }} input
 */
async function listImportRequestsForOrg({ orgId, includeArchived = false, limit = 200, status, createdByEmailHash }) {
  if (!Number.isInteger(orgId)) return { ok: false, errors: ['orgId required'] };
  if (status && !STATUSES.includes(status)) return { ok: false, errors: [`status must be one of: ${STATUSES.join(', ')}`] };
  if (!db.isConfigured()) return notConfigured();
  const cappedLimit = Math.max(1, Math.min(1000, Number(limit) || 200));

  /** @type {string[]} */
  const where = ['org_id = $1'];
  /** @type {any[]} */
  const params = [orgId];
  if (!includeArchived) where.push('archived_at IS NULL');
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (createdByEmailHash) {
    params.push(createdByEmailHash);
    where.push(`created_by_email_hash = $${params.length}`);
  }
  params.push(cappedLimit);
  try {
    const rows = await db.query(
      `SELECT * FROM import_requests WHERE ${where.join(' AND ')}
       ORDER BY updated_at DESC LIMIT $${params.length}`,
      params,
    );
    return { ok: true, importRequests: rows.map(rowToImportRequest) };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'import_request list failed');
  }
}

// ── State-machine transitions ────────────────────────────────────────

/**
 * Generic status transition. Rejects illegal edges with conflict:true
 * so the handler returns 409. Use the artefact-attach functions below
 * (attachShortlistAndQuote / attachTeamReview / attachCustomerDecision)
 * for transitions that ALSO write jsonb payload — they keep the
 * artefact + status in lockstep within a single UPDATE.
 *
 * @param {{ orgId: number, externalId: string, actorEmailHash: string, toStatus: string, details?: Record<string, any> }} input
 */
async function transitionImportRequestStatus({ orgId, externalId, actorEmailHash, toStatus, details }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'] };
  }
  if (!STATUSES.includes(toStatus)) {
    return { ok: false, errors: [`toStatus must be one of: ${STATUSES.join(', ')}`] };
  }
  if (!db.isConfigured()) return notConfigured();

  const before = await getImportRequestByExternalId({ orgId, externalId });
  if (!before.ok) return before;
  const beforeRow = /** @type {any} */ (before).importRequest;

  if (beforeRow.status === toStatus) {
    return { ok: true, importRequest: beforeRow, unchanged: true };
  }
  if (!isLegalTransition(beforeRow.status, toStatus)) {
    return {
      ok: false,
      conflict: true,
      errors: [`illegal transition ${beforeRow.status} → ${toStatus}`],
      legalNext: VALID_TRANSITIONS[beforeRow.status] || [],
    };
  }

  // Failure transitions write the reason into failure_state. Other
  // transitions merge details into metadata for forensic context.
  const merging = (details && typeof details === 'object') ? details : {};
  const isFailure = toStatus === 'failed';

  try {
    const rows = await db.query(
      isFailure
        ? `UPDATE import_requests
             SET status = $1,
                 failure_state = COALESCE(failure_state, '{}'::jsonb) || $2::jsonb,
                 updated_at = now()
           WHERE org_id = $3 AND external_id = $4 RETURNING *`
        : `UPDATE import_requests
             SET status = $1,
                 metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
                 updated_at = now()
           WHERE org_id = $3 AND external_id = $4 RETURNING *`,
      [toStatus, JSON.stringify(merging), orgId, externalId],
    );
    const importRequest = rowToImportRequest(rows[0]);
    await events.record('import_request_status_transition', {
      orgId,
      actorEmailHash,
      entityType: 'import_request',
      entityId: externalId,
      before: { status: beforeRow.status },
      after: { status: toStatus },
      detail: merging,
    });
    return { ok: true, importRequest };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'import_request transition failed');
  }
}

/**
 * Attach AI-generated shortlist + landed-cost quote atomically with the
 * processing → awaiting_review transition. Called by the orchestrator.
 *
 * The shortlist + quote are validated only for shape — the calculator-
 * grounding contract (ADR 0002) lives in lib/ai/import-request-
 * orchestrator.js. By the time we get here the numbers ARE the
 * calculator output; this layer is the persistence boundary.
 *
 * @param {{
 *   orgId: number,
 *   externalId: string,
 *   actorEmailHash: string,
 *   shortlist: Array<Record<string, any>>,
 *   landedQuote: Record<string, any>,
 *   aiRunIds?: string[],
 *   quoteValidForDays?: number
 * }} input
 */
async function attachShortlistAndQuote({
  orgId, externalId, actorEmailHash, shortlist, landedQuote, aiRunIds, quoteValidForDays = 14,
}) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'] };
  }
  if (!Array.isArray(shortlist)) return { ok: false, errors: ['shortlist must be an array'] };
  if (!landedQuote || typeof landedQuote !== 'object' || Array.isArray(landedQuote)) {
    return { ok: false, errors: ['landedQuote must be an object'] };
  }
  if (!db.isConfigured()) return notConfigured();

  const before = await getImportRequestByExternalId({ orgId, externalId });
  if (!before.ok) return before;
  const beforeRow = /** @type {any} */ (before).importRequest;

  // Only legal from 'processing'. Reject early so we don't half-write.
  if (beforeRow.status !== 'processing') {
    return {
      ok: false,
      conflict: true,
      errors: [`attachShortlistAndQuote requires status='processing', got '${beforeRow.status}'`],
    };
  }

  const validDays = Number.isInteger(quoteValidForDays) && quoteValidForDays > 0 ? quoteValidForDays : 14;
  const runIds = Array.isArray(aiRunIds) ? aiRunIds : [];

  try {
    const rows = await db.query(
      `UPDATE import_requests
         SET status = 'awaiting_review',
             factory_shortlist = $1::jsonb,
             shortlist_generated_at = now(),
             landed_quote = $2::jsonb,
             quote_generated_at = now(),
             quote_expires_at = now() + ($3 || ' days')::interval,
             ai_run_ids = COALESCE(ai_run_ids, '[]'::jsonb) || $4::jsonb,
             updated_at = now()
       WHERE org_id = $5 AND external_id = $6 AND status = 'processing'
       RETURNING *`,
      [
        JSON.stringify(shortlist),
        JSON.stringify(landedQuote),
        String(validDays),
        JSON.stringify(runIds),
        orgId,
        externalId,
      ],
    );
    if (rows.length === 0) {
      // Lost race: someone else changed status between our read and write.
      return { ok: false, conflict: true, errors: ['concurrent modification — request status changed'] };
    }
    const importRequest = rowToImportRequest(rows[0]);
    await events.record('import_request_status_transition', {
      orgId,
      actorEmailHash,
      entityType: 'import_request',
      entityId: externalId,
      before: { status: 'processing' },
      after: { status: 'awaiting_review' },
      detail: {
        subtype: 'shortlist_and_quote_attached',
        candidates: shortlist.length,
        aiRunIds: runIds,
      },
    });
    return { ok: true, importRequest };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'attachShortlistAndQuote failed');
  }
}

/**
 * Team-side review action. Carries the team's decision:
 *   - 'approved'   → awaiting_review → quoted        (customer sees the quote)
 *   - 'sent_back'  → awaiting_review → processing    (orchestrator re-runs)
 *   - 'rejected'   → awaiting_review → cancelled     (terminal)
 *
 * @param {{
 *   orgId: number,
 *   externalId: string,
 *   actorEmailHash: string,
 *   decision: 'approved' | 'sent_back' | 'rejected',
 *   edits?: Array<Record<string, any>>,
 *   notes?: string
 * }} input
 */
async function attachTeamReview({ orgId, externalId, actorEmailHash, decision, edits, notes }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'] };
  }
  if (!['approved', 'sent_back', 'rejected'].includes(decision)) {
    return { ok: false, errors: ['decision must be approved | sent_back | rejected'] };
  }
  if (!db.isConfigured()) return notConfigured();

  const before = await getImportRequestByExternalId({ orgId, externalId });
  if (!before.ok) return before;
  const beforeRow = /** @type {any} */ (before).importRequest;
  if (beforeRow.status !== 'awaiting_review') {
    return {
      ok: false,
      conflict: true,
      errors: [`attachTeamReview requires status='awaiting_review', got '${beforeRow.status}'`],
    };
  }

  const reviewPayload = {
    decision,
    reviewedByEmailHash: actorEmailHash,
    reviewedAt: new Date().toISOString(),
    edits: Array.isArray(edits) ? edits : [],
    notes: typeof notes === 'string' ? notes.slice(0, 4000) : '',
  };

  const toStatus = decision === 'approved' ? 'quoted'
    : decision === 'sent_back' ? 'processing'
    : 'cancelled';

  try {
    const rows = await db.query(
      `UPDATE import_requests
         SET status = $1,
             team_review_state = $2::jsonb,
             updated_at = now()
       WHERE org_id = $3 AND external_id = $4 AND status = 'awaiting_review'
       RETURNING *`,
      [toStatus, JSON.stringify(reviewPayload), orgId, externalId],
    );
    if (rows.length === 0) {
      return { ok: false, conflict: true, errors: ['concurrent modification — request status changed'] };
    }
    const importRequest = rowToImportRequest(rows[0]);
    await events.record('import_request_status_transition', {
      orgId,
      actorEmailHash,
      entityType: 'import_request',
      entityId: externalId,
      before: { status: 'awaiting_review' },
      after: { status: toStatus },
      detail: { subtype: 'team_reviewed', decision, editCount: reviewPayload.edits.length },
    });
    return { ok: true, importRequest };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'attachTeamReview failed');
  }
}

/**
 * Customer-side decision on the quoted request:
 *   - 'approved'  → quoted → customer_approved   (downstream Shipment will spawn)
 *   - 'rejected'  → quoted → customer_rejected   (terminal)
 *
 * @param {{
 *   orgId: number,
 *   externalId: string,
 *   actorEmailHash: string,
 *   decision: 'approved' | 'rejected',
 *   notes?: string
 * }} input
 */
async function attachCustomerDecision({ orgId, externalId, actorEmailHash, decision, notes }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'] };
  }
  if (!['approved', 'rejected'].includes(decision)) {
    return { ok: false, errors: ['decision must be approved | rejected'] };
  }
  if (!db.isConfigured()) return notConfigured();

  const before = await getImportRequestByExternalId({ orgId, externalId });
  if (!before.ok) return before;
  const beforeRow = /** @type {any} */ (before).importRequest;
  if (beforeRow.status !== 'quoted') {
    return {
      ok: false,
      conflict: true,
      errors: [`attachCustomerDecision requires status='quoted', got '${beforeRow.status}'`],
    };
  }

  const decisionPayload = {
    decision,
    decidedByEmailHash: actorEmailHash,
    decidedAt: new Date().toISOString(),
    notes: typeof notes === 'string' ? notes.slice(0, 4000) : '',
  };

  const toStatus = decision === 'approved' ? 'customer_approved' : 'customer_rejected';

  try {
    const rows = await db.query(
      `UPDATE import_requests
         SET status = $1,
             customer_decision_state = $2::jsonb,
             updated_at = now()
       WHERE org_id = $3 AND external_id = $4 AND status = 'quoted'
       RETURNING *`,
      [toStatus, JSON.stringify(decisionPayload), orgId, externalId],
    );
    if (rows.length === 0) {
      return { ok: false, conflict: true, errors: ['concurrent modification — request status changed'] };
    }
    const importRequest = rowToImportRequest(rows[0]);
    await events.record('import_request_status_transition', {
      orgId,
      actorEmailHash,
      entityType: 'import_request',
      entityId: externalId,
      before: { status: 'quoted' },
      after: { status: toStatus },
      detail: { subtype: 'customer_decided', decision },
    });
    return { ok: true, importRequest };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'attachCustomerDecision failed');
  }
}

/**
 * Link the downstream Shipment (and optionally Goods + Supplier) that
 * was materialised from this request. Called after customer approval
 * by the fulfilment-spawn flow. Does NOT change status — the request
 * stays in 'customer_approved' as the system-of-record of the intent.
 *
 * @param {{
 *   orgId: number,
 *   externalId: string,
 *   actorEmailHash: string,
 *   linkedShipmentExternalId: string,
 *   linkedGoodsExternalId?: string,
 *   linkedSupplierExternalId?: string
 * }} input
 */
async function linkMaterialisedShipment({
  orgId, externalId, actorEmailHash,
  linkedShipmentExternalId, linkedGoodsExternalId, linkedSupplierExternalId,
}) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash || !linkedShipmentExternalId) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash, linkedShipmentExternalId required'] };
  }
  if (!db.isConfigured()) return notConfigured();

  const before = await getImportRequestByExternalId({ orgId, externalId });
  if (!before.ok) return before;
  const beforeRow = /** @type {any} */ (before).importRequest;
  if (beforeRow.status !== 'customer_approved') {
    return {
      ok: false,
      conflict: true,
      errors: [`linkMaterialisedShipment requires status='customer_approved', got '${beforeRow.status}'`],
    };
  }

  try {
    const rows = await db.query(
      `UPDATE import_requests
         SET linked_shipment_external_id = $1,
             linked_goods_external_id = COALESCE($2, linked_goods_external_id),
             linked_supplier_external_id = COALESCE($3, linked_supplier_external_id),
             updated_at = now()
       WHERE org_id = $4 AND external_id = $5
       RETURNING *`,
      [
        linkedShipmentExternalId,
        linkedGoodsExternalId || null,
        linkedSupplierExternalId || null,
        orgId,
        externalId,
      ],
    );
    const importRequest = rowToImportRequest(rows[0]);
    await events.record('import_request_updated', {
      orgId,
      actorEmailHash,
      entityType: 'import_request',
      entityId: externalId,
      before: {
        linkedShipmentExternalId: beforeRow.linkedShipmentExternalId,
        linkedGoodsExternalId: beforeRow.linkedGoodsExternalId,
        linkedSupplierExternalId: beforeRow.linkedSupplierExternalId,
      },
      after: {
        linkedShipmentExternalId,
        linkedGoodsExternalId: linkedGoodsExternalId || beforeRow.linkedGoodsExternalId,
        linkedSupplierExternalId: linkedSupplierExternalId || beforeRow.linkedSupplierExternalId,
      },
    });
    return { ok: true, importRequest };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'linkMaterialisedShipment failed');
  }
}

/**
 * @param {{ orgId: number, externalId: string, actorEmailHash: string }} input
 */
async function archiveImportRequest({ orgId, externalId, actorEmailHash }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'] };
  }
  if (!db.isConfigured()) return notConfigured();

  const before = await getImportRequestByExternalId({ orgId, externalId });
  if (!before.ok) return before;
  const beforeRow = /** @type {any} */ (before).importRequest;
  if (beforeRow.archivedAt) return { ok: true, importRequest: beforeRow, unchanged: true };

  try {
    const rows = await db.query(
      `UPDATE import_requests SET archived_at = now(), updated_at = now()
       WHERE org_id = $1 AND external_id = $2 AND archived_at IS NULL
       RETURNING *`,
      [orgId, externalId],
    );
    if (rows.length === 0) return { ok: true, importRequest: beforeRow, unchanged: true };
    const importRequest = rowToImportRequest(rows[0]);
    await events.record('import_request_archived', {
      orgId,
      actorEmailHash,
      entityType: 'import_request',
      entityId: externalId,
      before: beforeRow,
      after: importRequest,
    });
    return { ok: true, importRequest };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'archiveImportRequest failed');
  }
}

module.exports = {
  // Constants / introspection — exposed so drift-guard tests can pin
  // them against the SQL migration and the TS mirror.
  STATUSES,
  TERMINAL_STATUSES,
  QUANTITY_UNITS,
  VALID_TRANSITIONS,
  isLegalTransition,
  // Internal helpers exposed for tests.
  _rowToImportRequest: rowToImportRequest,
  _validateForCreate: validateForCreate,
  // CRUD.
  createImportRequest,
  getImportRequestByExternalId,
  listImportRequestsForOrg,
  // State machine + artefact attachers.
  transitionImportRequestStatus,
  attachShortlistAndQuote,
  attachTeamReview,
  attachCustomerDecision,
  linkMaterialisedShipment,
  archiveImportRequest,
};
