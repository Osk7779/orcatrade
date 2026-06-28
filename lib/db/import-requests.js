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

// Structured decline reasons — sprint 16. When ops rejects a request,
// they pick one of these so the customer email + the activity feed
// can render a meaningful explanation. Each maps to a templated
// customer-facing message in lib/imports-emails.js + a TS mirror in
// app-shell/lib/api.ts. The data-layer is the single source of truth;
// a drift-guard test pins parity with the TS mirror.
//
// 'price_target_unrealistic' — landed total exceeds target by >20%
//   (most common; the revision path is the customer raising their
//   target or accepting a smaller MOQ)
// 'compliance_blocker' — CBAM/EUDR/REACH probe says the goods can't
//   ship as described (e.g. EUDR DDS unavailable for the origin)
// 'origin_restriction' — anti-dumping / sanctions / embargo on the
//   stated origin country
// 'out_of_scope' — product category we don't currently service
//   (e.g. live animals, ammunition); not revisable as-is
// 'documentation_missing' — customer's stated certifications can't
//   be evidenced from the shortlisted suppliers
// 'other' — free-text catch-all; the notes field carries the detail
const DECLINE_REASONS = Object.freeze([
  'price_target_unrealistic',
  'compliance_blocker',
  'origin_restriction',
  'out_of_scope',
  'documentation_missing',
  'other',
]);

// Which decline reasons offer a "Revise this request" CTA in the
// customer email. Out-of-scope is terminal (we don't service the
// category); the others are recoverable with a revision.
const REVISABLE_DECLINE_REASONS = Object.freeze([
  'price_target_unrealistic',
  'compliance_blocker',
  'origin_restriction',
  'documentation_missing',
  'other',
]);

// Sprint 38 — stalled-request watch threshold. A request sitting in
// 'awaiting_review' with NO activity for > STALL_THRESHOLD_DAYS days
// is the first proactive signal the platform surfaces: not "look at
// past data" (every other cohort) but "this needs your attention
// NOW."
//
// 7 days is the SLA most B2B customers expect from a quote-handling
// team; longer than that and the customer has moved on or escalated.
// We pick "no activity" (updated_at proxy) rather than "no status
// transition" deliberately — if the customer attached evidence or ops
// messaged 3 days ago, that's engagement, not stall. The threshold is
// hard-coded in v1; a future sprint can lift it to per-org config
// once the bucket has enough data to recommend a non-default.
//
// Drift-guard tests pin this constant + the cohort cap below; a
// future sprint can re-tune both, but a silent change would skew
// every dashboard comparing windows.
const STALL_THRESHOLD_DAYS = 7;
const STALLED_QUEUE_CAP = 10;

// Sprint 40 — decline-reason spike detection (cohort #7 — second
// proactive signal). Sprint 38 detected STATE stalls (rows sitting
// too long); sprint 40 detects TREND signals (reasons spiking vs
// baseline).
//
// Window arithmetic: 7-day "current" vs 30-day "baseline." The
// baseline includes the current window — a longer comparator that
// gets a vote so a slow-build trend reads as a spike too.
//
// A reason is flagged as spiking when ALL of:
//   - currentCount >= DECLINE_SPIKE_MIN_COUNT (3)
//     → kills noise from a single re-declined "other"
//   - currentRate (count/day) >= DECLINE_SPIKE_RATE_MULT (2) × baselineRate
//     → catches genuine acceleration vs the prior month
//
// Baseline-zero case: if baselineCount === 0, baselineRate === 0
// and the multiplier division would explode. We treat that case as
// "always spiking when currentCount >= MIN_COUNT" — a reason
// surfacing for the first time IS the signal.
//
// Drift-guard tests pin all four constants; a silent retune would
// skew every spike comparison in flight.
const DECLINE_SPIKE_CURRENT_DAYS = 7;
const DECLINE_SPIKE_BASELINE_DAYS = 30;
const DECLINE_SPIKE_MIN_COUNT = 3;
const DECLINE_SPIKE_RATE_MULT = 2;

// Sprint 53 — quote-acceptance rate degradation watch (cohort #8 —
// third proactive signal). Sprint 38 detected STATE stalls;
// sprint 40 detected TREND decline spikes; sprint 53 detects
// ACCEPTANCE-RATE drift.
//
// The rate is computed over requests that EXITED `quoted` in the
// window — i.e., status now in ('customer_approved',
// 'customer_rejected', 'expired'). The "approved" branch becomes
// the numerator; the union of all three is the denominator. Open
// quoted-but-undecided requests are deliberately excluded so a
// week-end queue blip doesn't depress the rate (sprint 38
// stalled-queue cohort covers those separately).
//
// Windows:
//   Current  — last 30 days (created_at >= now - 30d)
//   Baseline — prior 60 days (created_at in [now - 90d, now - 30d])
//
// Flagging:
//   - currentCount >= MIN_COUNT (5) — single-digit denominators
//     are noise (1 of 1 == 100%; 0 of 1 == 0%)
//   - currentRate < THRESHOLD (0.75) × baselineRate
//     → "rate degraded to less than three-quarters of historical pace"
//
// Baseline-zero case: if baseline had no decisions (new org),
// degradation can't be assessed — surface NaN-as-null rate so the
// UI can render "no baseline yet" rather than a misleading 0%.
const QUOTE_ACCEPTANCE_CURRENT_DAYS = 30;
const QUOTE_ACCEPTANCE_BASELINE_DAYS = 60;
const QUOTE_ACCEPTANCE_MIN_COUNT = 5;
const QUOTE_ACCEPTANCE_DEGRADATION_THRESHOLD = 0.75;
const QUOTE_ACCEPTANCE_EXITED_STATUSES = Object.freeze([
  'customer_approved',
  'customer_rejected',
  'expired',
]);

// Sprint 57 — supplier-concentration risk watch (cohort #9 — FOURTH
// proactive signal). Sprint 38 watches STATE stalls, sprint 40
// watches TREND on rejections, sprint 53 watches TREND on
// approvals; sprint 57 watches RISK on sourcing exposure.
//
// Sprint 28 picks bind every customer-approved request to one
// supplier country. If one country dominates the recent picks
// (e.g. >= 75% to CN), a tariff shift / sanctions list update
// takes the team's sourcing surface offline overnight. Surface
// the concentration so the team can diversify proactively.
//
// Cohort math:
//   Numerator   — count of picks to the TOP country in the window
//   Denominator — total picks in the window
//   Share       — numerator / denominator (0..1)
//   isConcentrated when share >= THRESHOLD AND total >= MIN_COUNT
//
// MIN_COUNT (5) kills noise: 1 of 1 (100%) and 0 of 0 (NaN) would
// otherwise fire the gate.
const SUPPLIER_CONCENTRATION_WINDOW_DAYS = 30;
const SUPPLIER_CONCENTRATION_MIN_COUNT = 5;
const SUPPLIER_CONCENTRATION_THRESHOLD = 0.75;

// Sprint 18 — per-request messaging thread roles. 'system' is reserved
// for platform-emitted entries; v1 only uses customer + ops. The role
// MUST match how the UI styles the message bubble (customer on the
// left, ops on the right, system centred) — a drift-guard pins it.
const MESSAGE_ROLES = Object.freeze(['customer', 'ops', 'system']);
const MESSAGE_BODY_MAX = 4000;
const MESSAGES_MAX_PER_REQUEST = 200;

// Sprint 55 — internal ops notes caps. Same body limit as
// messages so the validator surface stays consistent; lower
// per-request cap because notes are quieter than thread
// messages (one or two per major lifecycle event).
const INTERNAL_NOTE_BODY_MAX = 4000;
const INTERNAL_NOTES_MAX_PER_REQUEST = 100;

function generateInternalNoteId() {
  return 'note_' + crypto.randomBytes(8).toString('hex');
}

function generateMessageId() {
  return 'msg_' + crypto.randomBytes(4).toString('hex');
}

// Sprint 27 — compliance evidence regime taxonomy. Each attached
// document gets tagged with one of these so the UI can group + filter
// by regulatory regime. 'other' is the catch-all; legal/financial
// docs the customer wants associated with the request but don't map
// to a regime (insurance certs, freight bookings, supplier MSAs).
//
// The set matches the apex compliance coverage from CLAUDE.md
// ("EU/UK customs & duty, CBAM, EUDR, REACH"); 'origin' is its own
// bucket because origin-verification (certificates of origin, FTA
// supplier declarations) is the most common evidence ask outside
// the headline regimes.
const COMPLIANCE_REGIMES = Object.freeze(['CBAM', 'EUDR', 'REACH', 'origin', 'other']);
const EVIDENCE_LABEL_MAX = 200;
const EVIDENCE_NOTES_MAX = 1000;
const EVIDENCE_MAX_PER_REQUEST = 50;
const EVIDENCE_URL_MAX = 2000;

function generateEvidenceId() {
  return 'ev_' + crypto.randomBytes(4).toString('hex');
}

// Sprint 28 — supplier-pick rationale taxonomy. Categorising the
// "why we picked this country" answer makes the historical signal
// actionable: a customer can see "your team picked Vietnam 4 times,
// 3 of those were lead-time wins" — far more useful than the raw
// free-text rationale.
const PICK_RATIONALE_CATEGORIES = Object.freeze([
  'cost',                // landed cost beats alternatives
  'lead_time',           // shorter time to delivery
  'compliance',          // origin / regime fit (e.g. EBA preference, CBAM exemption)
  'past_relationship',   // team has worked with this corridor before
  'capacity',            // factory availability for the volume
  'other',               // free-text supplements
]);
const PICK_RATIONALE_MAX = 500;

// Sprint 30 — customer rating bounds. 1-5 scale (5-star convention
// universally understood; 7-point Likert was a contender but adds
// no signal at this granularity). Comment cap matches sprint-16
// decline-note + sprint-18 message body discipline (4000 chars is
// excessive for a single rating; 2000 is generous).
const RATING_MIN = 1;
const RATING_MAX = 5;
const RATING_COMMENT_MAX = 2000;

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
    revisedFromExternalId: r.revised_from_external_id,
    messages: Array.isArray(r.messages) ? r.messages : [],
    messageReadState: (r.message_read_state && typeof r.message_read_state === 'object' && !Array.isArray(r.message_read_state))
      ? r.message_read_state
      : {},
    evidenceAttachments: Array.isArray(r.evidence_attachments) ? r.evidence_attachments : [],
    supplierPick: (r.supplier_pick && typeof r.supplier_pick === 'object' && !Array.isArray(r.supplier_pick))
      ? r.supplier_pick
      : null,
    customerRating: (r.customer_rating && typeof r.customer_rating === 'object' && !Array.isArray(r.customer_rating))
      ? r.customer_rating
      : null,
    // Sprint 55 — ops-only annotations. CRITICAL: the handler
    // layer REDACTS this field when ctx.role is not ops. A
    // customer hitting their own request detail endpoint must
    // never see these notes. Drift-guard tests pin the redaction
    // at every layer.
    internalNotes: Array.isArray(r.internal_notes) ? r.internal_notes : [],
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

  // Sprint 16 — revision lineage. Format-validate only; same-org
  // existence is checked at insert time by the createImportRequest
  // path (a cross-org reference is rejected with notFound).
  if (input.revisedFromExternalId != null && input.revisedFromExternalId !== '') {
    if (typeof input.revisedFromExternalId !== 'string'
        || !/^ir_[a-f0-9]{16}$/.test(input.revisedFromExternalId)) {
      errors.push('revisedFromExternalId must match the ir_<16hex> shape');
    }
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

  // Sprint 16 — if revisedFromExternalId is set, verify the source
  // request exists in the SAME org before inserting. A cross-org
  // reference must not stick. Same-org enforcement is what makes
  // the absence of a FK on revised_from_external_id safe.
  if (input.revisedFromExternalId) {
    const source = /** @type {any} */ (await getImportRequestByExternalId({
      orgId: input.orgId,
      externalId: input.revisedFromExternalId,
    }));
    if (!source.ok || source.notFound) {
      return {
        ok: false,
        errors: ['revisedFromExternalId references a request that does not exist in this org'],
      };
    }
  }

  const externalId = generateImportRequestId();
  try {
    const rows = await db.query(
      `INSERT INTO import_requests (
        external_id, org_id, created_by_email_hash, label, status,
        product_description, hs_code_guess,
        target_quantity, target_quantity_unit, target_unit_price_cents,
        origin_country, destination_country, target_delivery_date,
        certification_requirements, intent_metadata, metadata,
        revised_from_external_id
      ) VALUES (
        $1, $2, $3, $4, 'submitted',
        $5, $6,
        $7, $8, $9,
        $10, $11, $12,
        $13, $14, $15,
        $16
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
        input.revisedFromExternalId || null,
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
 *   createdByEmailHash?: string,
 *   declineReason?: string,
 *   q?: string,
 *   supplierPickCountry?: string
 * }} input
 */
async function listImportRequestsForOrg({ orgId, includeArchived = false, limit = 200, status, createdByEmailHash, declineReason, q, supplierPickCountry }) {
  if (!Number.isInteger(orgId)) return { ok: false, errors: ['orgId required'] };
  if (status && !STATUSES.includes(status)) return { ok: false, errors: [`status must be one of: ${STATUSES.join(', ')}`] };
  // Sprint 23 — drill-down filter. Reject unknown decline reasons at
  // the data layer so a forged query-param can't hit a JSONB lookup
  // with arbitrary text.
  if (declineReason != null && declineReason !== '' && !DECLINE_REASONS.includes(declineReason)) {
    return { ok: false, errors: [`declineReason must be one of: ${DECLINE_REASONS.join(', ')}`] };
  }
  // Sprint 29 — supplier-pick cohort filter. Validate ISO-2 shape
  // BEFORE the db.isConfigured() check so the data layer returns a
  // structured validation error even in test envs without PG.
  const pickCountryEarly = typeof supplierPickCountry === 'string' ? supplierPickCountry.trim().toUpperCase() : '';
  if (pickCountryEarly && !/^[A-Z]{2}$/.test(pickCountryEarly)) {
    return { ok: false, errors: ['supplierPickCountry must be ISO-2 uppercase'] };
  }
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
  // Sprint 23 — drill-down by structured decline reason. The
  // schema-012 / sprint-16 JSONB shape is team_review_state.declineReason.
  // Cohort lookups are infrequent + small (the cohort itself is
  // typically < 30 rows in a 30-day window) so a JSONB ->> equality
  // is fast enough without a dedicated index.
  if (declineReason) {
    params.push(declineReason);
    where.push(`team_review_state->>'declineReason' = $${params.length}`);
  }
  // Sprint 29 — drill-down by supplier pick country. Closes the
  // sprint-28 learning loop: the Ops Insights cohort card surfaces
  // "12 picks for Vietnam"; clicking it lands here with
  // ?supplierPick=VN, scoped to the org-wide cohort (NOT mine=1 —
  // the handler drops mine=1 for cohort views, matching sprint 23's
  // pattern). ISO-2 validation lives above the db.isConfigured()
  // check; this block just plumbs the validated value into the WHERE.
  if (pickCountryEarly) {
    params.push(pickCountryEarly);
    where.push(`supplier_pick->>'country' = $${params.length}`);
  }
  // Sprint 25 — free-text search across label, product_description,
  // external_id. ILIKE (case-insensitive) with leading + trailing %
  // wildcards so the search finds substrings ("Shenzhen" in
  // "LED · CN→DE Shenzhen pick"). The string is trimmed at the
  // handler layer and capped at 200 chars; we also strip ILIKE
  // wildcards from the user input (% and _) so a literal "100%
  // cotton" query doesn't blow open into a full-table scan with a
  // dangling wildcard. Postgres handles trigram-style ILIKE on
  // labels/descriptions fast enough at v1 volumes (<10k rows) without
  // a dedicated GIN index; revisit when the row count crosses 100k.
  const qTrimmed = typeof q === 'string' ? q.trim() : '';
  if (qTrimmed) {
    const safe = qTrimmed.replace(/[\\%_]/g, (ch) => '\\' + ch);
    params.push('%' + safe + '%');
    const i = params.length;
    where.push(`(label ILIKE $${i} OR product_description ILIKE $${i} OR external_id ILIKE $${i})`);
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

// ── Aggregations / insights (sprint 17) ──────────────────────────────

/**
 * Ops Insights — calculator-grounded aggregate over the org's import
 * requests within a sliding window.
 *
 * Three cohorts:
 *   1. funnel        — per-status counts (every status the schema
 *                      defines, even when 0; the UI renders the full
 *                      taxonomy so a missing row reads "0 in this
 *                      stage" rather than "missing stage")
 *   2. declineReasons — when team rejected, which structured reason
 *                      they picked. Keyed by reason; 0-entries
 *                      omitted so the breakdown chart doesn't show
 *                      empty bars
 *   3. revisionCohort — among RECOVERABLE declines (team picked a
 *                      revisable reason), how many became revisions?
 *                      And of those revisions, how many became
 *                      customer_approved? This is the closed-loop
 *                      metric the platform actually exists to drive
 *                      higher — the headline number on the page
 *
 * The data layer is the single source of truth (ADR 0002 — no LLM in
 * this path). Every count traces to a row that ALREADY landed in
 * import_requests. The UI just renders.
 *
 * windowDays defaults to 30 and is clamped to [1, 365] — anything
 * shorter is too noisy, anything longer is too stale to be useful for
 * day-to-day operations.
 *
 * @param {{ orgId: number, windowDays?: number, stallThresholdDays?: number, declineSpikeRateMultiplier?: number }} input
 */
async function aggregateOpsInsights({ orgId, windowDays = 30, stallThresholdDays, declineSpikeRateMultiplier }) {
  if (!Number.isInteger(orgId)) return { ok: false, errors: ['orgId required'] };
  if (!db.isConfigured()) return notConfigured();
  const days = Math.max(1, Math.min(365, Number(windowDays) || 30));
  // Sprint 42 — per-org stall threshold override. Falls back to the
  // platform default constant when the caller hasn't loaded org
  // config (callers that don't need per-org tuning, like tests +
  // legacy call sites, can stay shape-compatible). Re-bounds the
  // value to [1, 90] defensively — operator-config.js validates the
  // same range at write time, but this is the deepest enforcement
  // layer so a corrupt cache entry can't drive a runaway interval.
  // Number() coerces undefined → NaN, which Number.isInteger
  // catches; this lets TS narrow the value cleanly under strict
  // null checks without weakening the runtime check.
  const candidateThreshold = Number(stallThresholdDays);
  const effectiveStallThreshold = Number.isInteger(candidateThreshold) && candidateThreshold >= 1 && candidateThreshold <= 90
    ? candidateThreshold
    : STALL_THRESHOLD_DAYS;
  // Sprint 43 — per-org decline-spike rate multiplier. Same
  // defence-in-depth pattern as the stall threshold: defensive
  // re-bound to [1.5, 10] catches a corrupt cache entry that
  // bypassed write-time validation. Float-tolerant
  // (Number.isFinite + range) — the multiplier carries
  // one-decimal precision; integer checks would reject 1.5.
  const candidateMultiplier = Number(declineSpikeRateMultiplier);
  const effectiveSpikeMultiplier = Number.isFinite(candidateMultiplier) && candidateMultiplier >= 1.5 && candidateMultiplier <= 10
    ? candidateMultiplier
    : DECLINE_SPIKE_RATE_MULT;

  try {
    // ── 1. Funnel: every status with a count for the window ──
    // We use a CTE to anchor the window in SQL (now() - interval) so
    // the cutoff is consistent across queries even if they run a
    // millisecond apart. archived_at IS NULL because the platform
    // treats archived requests as if they never existed.
    const funnelRows = await db.query(
      `SELECT status, COUNT(*)::int AS n
         FROM import_requests
        WHERE org_id = $1
          AND archived_at IS NULL
          AND created_at >= now() - ($2 || ' days')::interval
        GROUP BY status`,
      [orgId, String(days)],
    );
    /** @type {Record<string, number>} */
    const funnelByStatus = {};
    for (const s of STATUSES) funnelByStatus[s] = 0;
    for (const r of funnelRows) {
      const key = String(r.status);
      funnelByStatus[key] = Number(r.n);
    }
    const totalInWindow = Object.values(funnelByStatus).reduce(
      (acc, n) => acc + Number(n || 0),
      0,
    );

    // ── 2. Decline-reason breakdown for the window ──
    // Pulls from team_review_state.declineReason (JSONB) where the
    // request was rejected. Only rejected requests carry this; the
    // WHERE clause uses a JSONB existence operator to skip rows
    // without the key (no false-positive "missing" buckets).
    const declineRows = await db.query(
      `SELECT team_review_state->>'declineReason' AS reason, COUNT(*)::int AS n
         FROM import_requests
        WHERE org_id = $1
          AND archived_at IS NULL
          AND created_at >= now() - ($2 || ' days')::interval
          AND team_review_state ? 'declineReason'
        GROUP BY team_review_state->>'declineReason'`,
      [orgId, String(days)],
    );
    /** @type {Record<string, number>} */
    const declineReasons = {};
    for (const r of declineRows) {
      const key = String(r.reason || 'other');
      // Defensive: skip values that aren't in the canonical enum
      // so a future schema drift never pollutes the breakdown.
      if (DECLINE_REASONS.includes(key)) {
        declineReasons[key] = Number(r.n);
      }
    }
    const totalDeclined = Object.values(declineReasons).reduce(
      (acc, n) => acc + Number(n || 0),
      0,
    );

    // ── 3. Revision cohort ──
    // The headline metric: of the recoverable declines we issued,
    // how many became revisions? And of those, how many got past the
    // team this time? The denominator (recoverable declines) only
    // counts rejections with a REVISABLE_DECLINE_REASONS reason
    // (out_of_scope is not counted because we already know it can't
    // be revised).
    //
    // We don't restrict the revision-side of the join to the window —
    // if a request was declined on day 1 and revised on day 35, that's
    // still a recovery for the cohort. The window only constrains
    // the SOURCE declines so the cohort identity is stable.
    const revisableReasons = REVISABLE_DECLINE_REASONS;
    const declineCohort = await db.query(
      `SELECT COUNT(*)::int AS n
         FROM import_requests
        WHERE org_id = $1
          AND archived_at IS NULL
          AND created_at >= now() - ($2 || ' days')::interval
          AND status = 'cancelled'
          AND team_review_state->>'declineReason' = ANY($3::text[])`,
      [orgId, String(days), Array.from(revisableReasons)],
    );
    const recoverableDeclined = Number((declineCohort[0] && declineCohort[0].n) || 0);

    // Count revisions that point BACK to a recoverable-declined row
    // in the window. A LEFT JOIN gives us both the revisions count
    // and the revisions-that-succeeded count in one pass.
    const revisionRows = await db.query(
      `SELECT
          COUNT(*)::int AS revisions,
          COUNT(*) FILTER (
            WHERE r.status IN ('customer_approved', 'quoted', 'awaiting_review', 'processing')
          )::int AS revisions_progressed
         FROM import_requests r
         JOIN import_requests src
           ON src.external_id = r.revised_from_external_id
          AND src.org_id = r.org_id
        WHERE r.org_id = $1
          AND r.archived_at IS NULL
          AND src.archived_at IS NULL
          AND src.status = 'cancelled'
          AND src.team_review_state->>'declineReason' = ANY($3::text[])
          AND src.created_at >= now() - ($2 || ' days')::interval`,
      [orgId, String(days), Array.from(revisableReasons)],
    );
    const revisions = Number((revisionRows[0] && revisionRows[0].revisions) || 0);
    const revisionsProgressed = Number(
      (revisionRows[0] && revisionRows[0].revisions_progressed) || 0,
    );

    // ── 4. Top picked countries (sprint 29) ──
    // Closes the sprint-28 learning loop org-wide: which countries
    // has the team materialised in the window, with the dominant
    // rationale category? Sprint 28's per-shortlist badge is a
    // signal IN context; this cohort turns the same data into a
    // narrative ("we picked Vietnam 12 times this quarter, mostly
    // for lead-time reasons").
    //
    // Recency dimension: supplier_pick->>'pickedAt' — same rule as
    // aggregateSupplierPicks. A request created long ago but
    // materialised recently still counts.
    // Sprint 32 — cross-cohort correlation. Same row pull as the
    // sprint-29 picks aggregation, plus customer_rating->>score so
    // the cohort can report per-country avgRating ("Vietnam picks
    // averaged 4.6★, Bangladesh averaged 3.1★"). avgRating is
    // computed only over RATED picks; unrated picks land in the
    // count but not the rating sum.
    const pickRows = await db.query(
      `SELECT
          supplier_pick->>'country' AS country,
          supplier_pick->>'rationaleCategory' AS rationale_category,
          supplier_pick->>'pickedAt' AS picked_at,
          (customer_rating->>'score')::int AS rating_score
         FROM import_requests
        WHERE org_id = $1
          AND archived_at IS NULL
          AND supplier_pick IS NOT NULL
          AND (supplier_pick->>'pickedAt')::timestamptz >= now() - ($2 || ' days')::interval`,
      [orgId, String(days)],
    );
    /** @type {Record<string, { count: number, lastPickedAt: string, rationaleCategoryMix: Record<string, number>, ratedCount: number, ratingSum: number }>} */
    const pickByCountry = {};
    for (const r of pickRows) {
      const country = String(r.country || '').toUpperCase();
      if (!country) continue;
      const at = String(r.picked_at || '');
      const cat = String(r.rationale_category || 'other');
      if (!pickByCountry[country]) {
        pickByCountry[country] = {
          count: 0, lastPickedAt: at, rationaleCategoryMix: {},
          ratedCount: 0, ratingSum: 0,
        };
      }
      const entry = pickByCountry[country];
      entry.count += 1;
      if (at && at > entry.lastPickedAt) entry.lastPickedAt = at;
      entry.rationaleCategoryMix[cat] = (entry.rationaleCategoryMix[cat] || 0) + 1;
      const score = Number(r.rating_score);
      if (Number.isInteger(score) && score >= 1 && score <= 5) {
        entry.ratedCount += 1;
        entry.ratingSum += score;
      }
    }
    // ── 5. Rating health cohort (sprint 31) ──
    // Sprint 30 captures customer_rating on customer_approved rows.
    // This block surfaces the org's rating health for the window:
    // average score, count + denominator (so the UI can render
    // "rated 18 / 24 approvals · 75%"), score distribution histogram
    // (per-star counts), and the "needs follow-up" callout — count of
    // 1-2★ ratings that ops should reach out about.
    //
    // Denominator nuance: ratings live on customer_approved requests;
    // the denominator is the count of customer_approved rows IN the
    // window, NOT the global approval count, so "rated %" stays
    // window-honest.
    const approvedInWindow = Number(funnelByStatus.customer_approved || 0);
    const ratingRows = await db.query(
      `SELECT (customer_rating->>'score')::int AS score
         FROM import_requests
        WHERE org_id = $1
          AND archived_at IS NULL
          AND customer_rating IS NOT NULL
          AND status = 'customer_approved'
          AND (customer_rating->>'ratedAt')::timestamptz >= now() - ($2 || ' days')::interval`,
      [orgId, String(days)],
    );
    /** @type {number[]} */
    const scoreDistribution = [0, 0, 0, 0, 0];
    let scoreSum = 0;
    let totalRated = 0;
    let lowScoreCount = 0;
    for (const r of ratingRows) {
      const score = Number(r.score);
      if (!Number.isInteger(score) || score < 1 || score > 5) continue;
      // We just bounds-checked score above; the tuple index is safe.
      scoreDistribution[score - 1] = (scoreDistribution[score - 1] || 0) + 1;
      scoreSum += score;
      totalRated += 1;
      if (score <= 2) lowScoreCount += 1;
    }
    const averageScore = totalRated > 0
      ? Math.round((scoreSum / totalRated) * 10) / 10  // one decimal place
      : null;
    const ratedPercentage = approvedInWindow > 0
      ? Math.round((totalRated / approvedInWindow) * 100)
      : null;

    // Project to the response shape: sorted by count desc, top 6,
    // with the dominant rationale derived server-side so the UI
    // doesn't re-do the work.
    const topPickedCountries = Object.entries(pickByCountry)
      .map(([country, info]) => {
        let dominantRationale = null;
        let dominantCount = 0;
        for (const [cat, n] of Object.entries(info.rationaleCategoryMix)) {
          if (n > dominantCount) { dominantCount = n; dominantRationale = cat; }
        }
        // Sprint 32 — cross-cohort correlation. avgRating null when
        // none of this country's picks have ratings yet; the UI
        // surfaces "no ratings yet" rather than a misleading "0★".
        const avgRating = info.ratedCount > 0
          ? Math.round((info.ratingSum / info.ratedCount) * 10) / 10
          : null;
        return {
          country,
          count: info.count,
          lastPickedAt: info.lastPickedAt || null,
          dominantRationale,
          rationaleCategoryMix: info.rationaleCategoryMix,
          avgRating,
          ratedCount: info.ratedCount,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    const totalPicked = Object.values(pickByCountry).reduce(
      (acc, info) => acc + info.count, 0,
    );

    // ── 6. Stalled-request watch (sprint 38) ──
    // Cohort #6 — the first PROACTIVE signal in the insights page.
    // Every other cohort (1-5) summarises past data; this one names
    // the requests that need attention NOW: in 'awaiting_review' AND
    // updated_at < now() - STALL_THRESHOLD_DAYS days.
    //
    // The window is intentionally NOT scoped to `days` — a request
    // stalled 14 days ago doesn't stop being stalled just because the
    // dashboard switched to a 7-day window. The stall is a live state,
    // not a windowed metric.
    //
    // Two queries: COUNT(*) for the total (drives the headline number
    // even when the list is truncated), then the LIMITed list. Done
    // as separate calls so the count isn't capped at STALLED_QUEUE_
    // CAP — ops sees "47 stalled" even when the card shows the
    // top 10.
    //
    // Sort by updated_at ASC — oldest stalls first — because "this
    // has been sitting for 31 days" is more urgent than "this just
    // crossed the 7-day line."
    const stalledCountRows = await db.query(
      `SELECT COUNT(*)::int AS n
         FROM import_requests
        WHERE org_id = $1
          AND archived_at IS NULL
          AND status = 'awaiting_review'
          AND updated_at < now() - ($2 || ' days')::interval`,
      [orgId, String(effectiveStallThreshold)],
    );
    const stalledCount = Number((stalledCountRows[0] && stalledCountRows[0].n) || 0);
    /** @type {Array<{ externalId: string, label: string, updatedAt: string, daysStalled: number }>} */
    let stalledItems = [];
    if (stalledCount > 0) {
      const stalledListRows = await db.query(
        `SELECT external_id, label, updated_at,
                EXTRACT(EPOCH FROM (now() - updated_at)) / 86400 AS days_stalled
           FROM import_requests
          WHERE org_id = $1
            AND archived_at IS NULL
            AND status = 'awaiting_review'
            AND updated_at < now() - ($2 || ' days')::interval
          ORDER BY updated_at ASC
          LIMIT $3`,
        [orgId, String(effectiveStallThreshold), STALLED_QUEUE_CAP],
      );
      stalledItems = stalledListRows.map(/** @param {any} r */ (r) => ({
        externalId: String(r.external_id),
        label: String(r.label || ''),
        updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
        // Server-side rounding: one decimal (matches the rating
        // cohort's display precision). UI doesn't divide-by-zero or
        // re-round.
        daysStalled: Math.round(Number(r.days_stalled) * 10) / 10,
      }));
    }

    // ── 7. Decline-reason spike detection (sprint 40) ──
    // Second proactive cohort. Two SQL queries — one bounded to
    // CURRENT (7 days), one to BASELINE (30 days). The baseline
    // INCLUDES the current window deliberately: a 30-day
    // comparator that sees both the prior 23 days + the current
    // 7 days makes "slow burn" trends still register as spikes
    // when the rate accelerates.
    //
    // Window-agnostic (NOT bounded by `days`) — a sustained spike
    // doesn't stop being a spike when the dashboard's `days`
    // toggle changes.
    const spikeCurrentRows = await db.query(
      `SELECT team_review_state->>'declineReason' AS reason, COUNT(*)::int AS n
         FROM import_requests
        WHERE org_id = $1
          AND archived_at IS NULL
          AND created_at >= now() - ($2 || ' days')::interval
          AND team_review_state ? 'declineReason'
        GROUP BY team_review_state->>'declineReason'`,
      [orgId, String(DECLINE_SPIKE_CURRENT_DAYS)],
    );
    const spikeBaselineRows = await db.query(
      `SELECT team_review_state->>'declineReason' AS reason, COUNT(*)::int AS n
         FROM import_requests
        WHERE org_id = $1
          AND archived_at IS NULL
          AND created_at >= now() - ($2 || ' days')::interval
          AND team_review_state ? 'declineReason'
        GROUP BY team_review_state->>'declineReason'`,
      [orgId, String(DECLINE_SPIKE_BASELINE_DAYS)],
    );
    /** @type {Record<string, number>} */
    const currentByReason = {};
    /** @type {Record<string, number>} */
    const baselineByReason = {};
    for (const r of spikeCurrentRows) {
      const key = String(r.reason || 'other');
      if (DECLINE_REASONS.includes(key)) currentByReason[key] = Number(r.n);
    }
    for (const r of spikeBaselineRows) {
      const key = String(r.reason || 'other');
      if (DECLINE_REASONS.includes(key)) baselineByReason[key] = Number(r.n);
    }
    /** @type {Array<{ reason: string, currentCount: number, baselineCount: number, currentRate: number, baselineRate: number, ratio: number | null }>} */
    const spikes = [];
    for (const reason of Object.keys(currentByReason)) {
      const currentCount = Number(currentByReason[reason] || 0);
      const baselineCount = Number(baselineByReason[reason] || 0);
      if (currentCount < DECLINE_SPIKE_MIN_COUNT) continue;
      const currentRate = currentCount / DECLINE_SPIKE_CURRENT_DAYS;
      const baselineRate = baselineCount / DECLINE_SPIKE_BASELINE_DAYS;
      // Baseline-zero: a first-time reason that hits the count gate
      // IS the signal. ratio=null surfaces the "no prior baseline"
      // case so the UI can render "new vs baseline" instead of "Nx".
      if (baselineRate === 0) {
        spikes.push({
          reason,
          currentCount,
          baselineCount,
          currentRate: Math.round(currentRate * 100) / 100,
          baselineRate: 0,
          ratio: null,
        });
        continue;
      }
      if (currentRate < effectiveSpikeMultiplier * baselineRate) continue;
      spikes.push({
        reason,
        currentCount,
        baselineCount,
        currentRate: Math.round(currentRate * 100) / 100,
        baselineRate: Math.round(baselineRate * 100) / 100,
        ratio: Math.round((currentRate / baselineRate) * 10) / 10,
      });
    }
    // Sort biggest spike first; nulls (first-time reasons) at the
    // top because they're the most striking signal.
    spikes.sort((a, b) => {
      if (a.ratio === null && b.ratio === null) return b.currentCount - a.currentCount;
      if (a.ratio === null) return -1;
      if (b.ratio === null) return 1;
      return Number(b.ratio) - Number(a.ratio);
    });

    // ── 8. Quote-acceptance rate degradation (sprint 53) ──
    // Third proactive cohort. Of requests that EXITED `quoted` in
    // the current window (status now in customer_approved /
    // customer_rejected / expired), what % went to
    // customer_approved? Compare against the baseline window
    // (prior 60 days). Open-and-undecided rows EXCLUDED so a
    // week-end queue blip doesn't depress the rate — those are
    // covered separately by the sprint-38 stalled-queue cohort.
    //
    // Two queries with mirrored shape (cleaner SQL than a single
    // CTE; both bind the same status array via $3).
    const exitedStatuses = Array.from(QUOTE_ACCEPTANCE_EXITED_STATUSES);
    const currentRows = await db.query(
      `SELECT
          COUNT(*) FILTER (WHERE status = 'customer_approved')::int AS approved,
          COUNT(*)::int AS total
         FROM import_requests
        WHERE org_id = $1
          AND archived_at IS NULL
          AND status = ANY($3::text[])
          AND created_at >= now() - ($2 || ' days')::interval`,
      [orgId, String(QUOTE_ACCEPTANCE_CURRENT_DAYS), exitedStatuses],
    );
    const baselineRows = await db.query(
      `SELECT
          COUNT(*) FILTER (WHERE status = 'customer_approved')::int AS approved,
          COUNT(*)::int AS total
         FROM import_requests
        WHERE org_id = $1
          AND archived_at IS NULL
          AND status = ANY($4::text[])
          AND created_at < now() - ($2 || ' days')::interval
          AND created_at >= now() - (($2::int + $3::int) || ' days')::interval`,
      [
        orgId,
        String(QUOTE_ACCEPTANCE_CURRENT_DAYS),
        String(QUOTE_ACCEPTANCE_BASELINE_DAYS),
        exitedStatuses,
      ],
    );
    const currentApproved = Number((currentRows[0] && currentRows[0].approved) || 0);
    const currentQuoted = Number((currentRows[0] && currentRows[0].total) || 0);
    const baselineApproved = Number((baselineRows[0] && baselineRows[0].approved) || 0);
    const baselineQuoted = Number((baselineRows[0] && baselineRows[0].total) || 0);
    // Rates are 0..1 floats; null when denominator is 0 so the UI
    // can render "no baseline yet" instead of a misleading 0%.
    // Server rounding: 3-decimal precision (0.001 = 0.1pp) so the
    // delta math is stable across reads.
    const currentRate = currentQuoted > 0
      ? Math.round((currentApproved / currentQuoted) * 1000) / 1000
      : null;
    const baselineRate = baselineQuoted > 0
      ? Math.round((baselineApproved / baselineQuoted) * 1000) / 1000
      : null;
    // delta = current - baseline. Null when either rate is null
    // (one of the windows had no decisions).
    const acceptanceDelta = (currentRate !== null && baselineRate !== null)
      ? Math.round((currentRate - baselineRate) * 1000) / 1000
      : null;
    // isDegraded fires when ALL of:
    //   currentQuoted >= MIN_COUNT (noise floor)
    //   baselineRate > 0          (otherwise the threshold check
    //                              divides into nonsense)
    //   currentRate < THRESHOLD × baselineRate
    const isDegraded = (
      currentQuoted >= QUOTE_ACCEPTANCE_MIN_COUNT
      && baselineRate !== null
      && baselineRate > 0
      && currentRate !== null
      && currentRate < QUOTE_ACCEPTANCE_DEGRADATION_THRESHOLD * baselineRate
    );

    // ── 9. Supplier-concentration risk watch (sprint 57) ──
    // Fourth proactive cohort. Of all picks in the last
    // WINDOW_DAYS, what share went to a single dominant country?
    // When the share crosses THRESHOLD AND the denominator is
    // meaningful (>= MIN_COUNT), surface the concentration.
    //
    // Same query shape as the sprint-29 topPickedCountries
    // aggregation — bind window via $2 and group on country.
    // Lighter projection: we only need country + count, no rating
    // join (the supplier-pick cohort already surfaces ratings).
    const concentrationRows = await db.query(
      `SELECT supplier_pick->>'country' AS country, COUNT(*)::int AS n
         FROM import_requests
        WHERE org_id = $1
          AND archived_at IS NULL
          AND supplier_pick IS NOT NULL
          AND (supplier_pick->>'pickedAt')::timestamptz >= now() - ($2 || ' days')::interval
        GROUP BY supplier_pick->>'country'`,
      [orgId, String(SUPPLIER_CONCENTRATION_WINDOW_DAYS)],
    );
    let concentrationTotal = 0;
    let concentrationTop = null;  /** @type {string|null} */
    let concentrationTopCount = 0;
    for (const r of concentrationRows) {
      const country = String(r.country || '').toUpperCase();
      if (!country) continue;  // Same defensive skip as sprint 29.
      const count = Number(r.n) || 0;
      concentrationTotal += count;
      if (count > concentrationTopCount) {
        concentrationTop = country;
        concentrationTopCount = count;
      }
    }
    // Server-side 3-decimal rounding for stability across reads
    // (matches sprint-53 quote-acceptance precision). Null when
    // denominator = 0 so the UI can render "no picks yet."
    const concentrationShare = concentrationTotal > 0
      ? Math.round((concentrationTopCount / concentrationTotal) * 1000) / 1000
      : null;
    const isConcentrated = (
      concentrationTotal >= SUPPLIER_CONCENTRATION_MIN_COUNT
      && concentrationShare !== null
      && concentrationShare >= SUPPLIER_CONCENTRATION_THRESHOLD
    );

    return {
      ok: true,
      windowDays: days,
      insights: {
        funnelByStatus,
        totalInWindow,
        declineReasons,
        totalDeclined,
        revisionCohort: {
          recoverableDeclined,
          revisions,
          revisionsProgressed,
          // Rates rendered server-side so the UI doesn't divide-by-zero.
          revisionRate: recoverableDeclined > 0
            ? Math.round((revisions / recoverableDeclined) * 100)
            : null,
          progressionRate: revisions > 0
            ? Math.round((revisionsProgressed / revisions) * 100)
            : null,
        },
        // Sprint 29 — cohort #4. Empty array when no picks landed
        // in the window; the UI renders an empty-state coaching
        // message in that case.
        topPickedCountries,
        totalPicked,
        // Sprint 31 — cohort #5. Rating health for the window.
        // averageScore null when no ratings; ratedPercentage null
        // when no approvals (avoiding NaN). scoreDistribution is a
        // fixed-length [1★, 2★, 3★, 4★, 5★] array so the UI can
        // iterate without sparsity handling.
        ratingCohort: {
          averageScore,
          totalRated,
          totalApproved: approvedInWindow,
          ratedPercentage,
          scoreDistribution,
          lowScoreCount,
        },
        // Sprint 38 — cohort #6. Stalled-request watch. The first
        // PROACTIVE signal: requests sitting in 'awaiting_review' for
        // > STALL_THRESHOLD_DAYS days. count is the org-wide total
        // (not capped); items is the top STALLED_QUEUE_CAP, oldest
        // first. thresholdDays surfaced so the UI can render the
        // exact stall threshold without re-coding it.
        stalledQueue: {
          // Sprint 42 — surface the EFFECTIVE threshold (org config
          // applied) so the UI + email composers render the actual
          // value the SQL queried, not the static default.
          thresholdDays: effectiveStallThreshold,
          count: stalledCount,
          items: stalledItems,
        },
        // Sprint 40 — cohort #7. Decline-reason spike detection.
        // Second proactive signal: which decline reasons are
        // accelerating vs the 30-day baseline. currentDays +
        // baselineDays + minCount + rateMultiplier surfaced so the
        // UI can name the comparison the server made. Empty array
        // when no reason crosses the gate; the UI renders the card
        // ONLY when spikes.length > 0 (no empty-state on healthy
        // weeks).
        declineSpike: {
          currentDays: DECLINE_SPIKE_CURRENT_DAYS,
          baselineDays: DECLINE_SPIKE_BASELINE_DAYS,
          minCount: DECLINE_SPIKE_MIN_COUNT,
          // Sprint 43 — surface the EFFECTIVE multiplier (after
          // per-org config + defensive re-bound). UI + email read
          // this so they render what the classifier actually used.
          rateMultiplier: effectiveSpikeMultiplier,
          spikes,
        },
        // Sprint 53 — cohort #8. Third proactive signal. Quote-
        // acceptance rate drift vs prior baseline. Always present;
        // the UI gates the card render on isDegraded so a healthy
        // org sees nothing.
        quoteAcceptance: {
          currentDays: QUOTE_ACCEPTANCE_CURRENT_DAYS,
          baselineDays: QUOTE_ACCEPTANCE_BASELINE_DAYS,
          minCount: QUOTE_ACCEPTANCE_MIN_COUNT,
          degradationThreshold: QUOTE_ACCEPTANCE_DEGRADATION_THRESHOLD,
          currentApproved,
          currentQuoted,
          currentRate,
          baselineApproved,
          baselineQuoted,
          baselineRate,
          delta: acceptanceDelta,
          isDegraded,
        },
        // Sprint 57 — cohort #9. Fourth proactive signal.
        // Supplier-concentration risk. Always present; the UI
        // gates the card render on isConcentrated.
        supplierConcentration: {
          windowDays: SUPPLIER_CONCENTRATION_WINDOW_DAYS,
          minCount: SUPPLIER_CONCENTRATION_MIN_COUNT,
          threshold: SUPPLIER_CONCENTRATION_THRESHOLD,
          totalPicks: concentrationTotal,
          topCountry: concentrationTop,
          topCountryCount: concentrationTopCount,
          topCountryShare: concentrationShare,
          isConcentrated,
        },
      },
    };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'aggregate insights failed');
  }
}

// ── Bulk team review (sprint 20) ─────────────────────────────────────

/**
 * Bulk version of attachTeamReview. Ops productivity for the queue:
 * at any real volume, clicking through 20+ awaiting-review requests
 * one-by-one becomes the bottleneck. This wraps the existing per-row
 * attachTeamReview path so every existing invariant (RBAC gate at the
 * handler, status='awaiting_review' precondition, structured decline
 * reason enforcement, audit-before-success) is preserved verbatim.
 *
 * Soft cap at 50 — anything bigger is almost certainly misuse (an
 * accidental "select all" on a 200-row queue) and should require a
 * deliberate second pass. The cap is enforced server-side; the UI
 * surfaces it BEFORE the user clicks send.
 *
 * Per-row independence: a single row failing (status drift, missing
 * decline reason for a 'rejected' decision, concurrent modification)
 * MUST NOT roll back the rows that succeeded. We collect successes
 * and failures separately and return both so the queue can update
 * itself accurately + surface a per-row error message.
 *
 * @param {{
 *   orgId: number,
 *   externalIds: string[],
 *   actorEmailHash: string,
 *   decision: 'approved' | 'sent_back' | 'rejected',
 *   notes?: string,
 *   declineReason?: string,
 * }} input
 */
async function bulkAttachTeamReview({ orgId, externalIds, actorEmailHash, decision, notes, declineReason }) {
  if (!Number.isInteger(orgId)) {
    return { ok: false, errors: ['orgId required'] };
  }
  if (!Array.isArray(externalIds) || externalIds.length === 0) {
    return { ok: false, errors: ['externalIds[] required (non-empty)'] };
  }
  if (externalIds.length > 50) {
    return { ok: false, errors: ['bulk-review capped at 50 requests per call'] };
  }
  // Dedup the ids so a customer-side double-submit doesn't fan out
  // duplicate audit events.
  const ids = [...new Set(externalIds.map(String))];
  /** @type {Array<{ externalId: string, importRequest: any }>} */
  const succeeded = [];
  /** @type {Array<{ externalId: string, error: string, conflict?: boolean, notFound?: boolean }>} */
  const failed = [];

  for (const externalId of ids) {
    const result = await attachTeamReview({
      orgId,
      externalId,
      actorEmailHash,
      decision,
      notes,
      declineReason,
    });
    if (result.ok) {
      const win = /** @type {any} */ (result);
      succeeded.push({ externalId, importRequest: win.importRequest });
    } else {
      const fail = /** @type {any} */ (result);
      failed.push({
        externalId,
        error: (fail.errors && fail.errors[0]) || 'unknown',
        conflict: fail.conflict || false,
        notFound: fail.notFound || false,
      });
    }
  }

  return {
    ok: true,
    decision,
    succeededCount: succeeded.length,
    failedCount: failed.length,
    succeeded,
    failed,
  };
}

// ── Automatic quote expiry (sprint 19) ───────────────────────────────

/**
 * Sweep `quoted` requests whose quote_expires_at is in the past and
 * transition each to `expired`. Posts a `system`-role message on the
 * request thread so the customer sees the reason if they revisit the
 * page later. Audit-logged + ORG_ACTIVITY_TYPES (so the dashboard
 * activity feed picks it up).
 *
 * Runs from the cron dispatcher (lib/handlers/cron.js) on a nightly
 * schedule (GitHub Actions). Idempotent — re-running on the same set
 * of rows is a no-op because the WHERE clause requires status='quoted'
 * (already-expired rows fall out of the set).
 *
 * Multi-org scope: when orgId is omitted (the cron path), the sweep
 * runs across EVERY org. When orgId is provided (admin tooling /
 * tests), it scopes to that org. Postgres handles the scaling — the
 * partial index import_requests_quote_expiry_idx in schema-012 is
 * exactly this query's index.
 *
 * Returns { ok, expiredCount, errors[], processedAt } so the cron
 * dashboard can surface "10 quotes auto-expired last night" without
 * a follow-up query.
 *
 * @param {{ orgId?: number, limit?: number, nowOverride?: string }} [input]
 */
async function expireStaleQuotes(input = {}) {
  if (!db.isConfigured()) return notConfigured();
  const cap = Math.max(1, Math.min(1000, Number(input.limit) || 500));
  /** @type {any[]} */
  const params = [];
  let where = `status = 'quoted'
        AND quote_expires_at IS NOT NULL
        AND quote_expires_at < `;
  if (input.nowOverride) {
    params.push(input.nowOverride);
    where += `$${params.length}::timestamptz`;
  } else {
    where += `now()`;
  }
  where += `
        AND archived_at IS NULL`;
  if (Number.isInteger(input.orgId) && input.orgId !== undefined) {
    params.push(input.orgId);
    where += `
        AND org_id = $${params.length}`;
  }
  params.push(cap);

  try {
    // Snapshot the candidate rows BEFORE the transition so we can
    // fire audit + message events for each one. A single UPDATE...
    // RETURNING would be cheaper but the audit + system message
    // payloads need per-row context (org, externalId) that we'd
    // have to pluck out anyway.
    const candidates = await db.query(
      `SELECT id, org_id, external_id
         FROM import_requests
        WHERE ${where}
        ORDER BY quote_expires_at ASC
        LIMIT $${params.length}`,
      params,
    );

    /** @type {Array<{ externalId: string, orgId: number }>} */
    const expired = [];
    /** @type {Array<{ externalId: string, error: string }>} */
    const errors = [];
    const expiredAt = new Date().toISOString();

    for (const row of candidates) {
      const orgId = Number(row.org_id);
      const externalId = String(row.external_id);
      try {
        // Atomic transition: same WHERE shape as the candidate query
        // (status='quoted' + quote_expires_at < now()) so two concurrent
        // sweeps don't double-fire. If another worker already flipped
        // the row, rows.length === 0 and we skip cleanly.
        //
        // We ALSO append a system message in the same UPDATE so the
        // thread + status flip stay in lockstep. JSONB concat with
        // jsonb_build_object lets us synthesise the message row inline.
        const messageId = generateMessageId();
        const messageRow = {
          id: messageId,
          role: 'system',
          body: 'Quote expired automatically · submit a fresh request if you still want to proceed.',
          byEmailHash: 'system',
          at: expiredAt,
        };
        const updated = await db.query(
          `UPDATE import_requests
             SET status = 'expired',
                 messages = messages || $1::jsonb,
                 updated_at = now()
           WHERE id = $2 AND status = 'quoted'
           RETURNING *`,
          [JSON.stringify([messageRow]), Number(row.id)],
        );
        if (updated.length === 0) continue;

        // Audit-log the transition BEFORE moving on (ADR 0005). A
        // failure here surfaces as the row appearing in errors[]
        // but the transition itself has already committed.
        await events.record('import_request_status_transition', {
          orgId,
          actorEmailHash: 'system',
          entityType: 'import_request',
          entityId: externalId,
          before: { status: 'quoted' },
          after: { status: 'expired' },
          detail: { subtype: 'auto_expired', messageId },
        });
        await events.record('import_request_message_posted', {
          orgId,
          actorEmailHash: 'system',
          entityType: 'import_request',
          entityId: externalId,
          detail: { messageId, role: 'system', length: messageRow.body.length },
        });
        expired.push({ externalId, orgId });
      } catch (err) {
        errors.push({
          externalId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      ok: true,
      expiredCount: expired.length,
      expired,
      errors,
      processedAt: expiredAt,
    };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'expire stale quotes failed');
  }
}

// ── Messages (sprint 18) ─────────────────────────────────────────────

/**
 * Append a message to the import request's thread. Used by both
 * customer-side ("clarifying question about lead time") and ops-side
 * ("need a higher-res CAD drawing") writes.
 *
 * Same-org enforcement is implicit in the WHERE clause: the UPDATE
 * matches on org_id + external_id together, so a cross-org append
 * touches 0 rows and we return notFound.
 *
 * Append-only — once written, a message cannot be edited or deleted
 * via this path. (A future GDPR Article-17 delete still works via the
 * existing account-delete pseudonymisation in lib/handlers/account.js;
 * that path nukes the actor_email_hash, not the message body.) This
 * append-only property is what makes the thread valid evidence for a
 * future dispute — "ops told the customer X on date Y".
 *
 * Soft cap at MESSAGES_MAX_PER_REQUEST (200). A thread at that depth
 * is almost certainly a dispute or a misuse pattern; returning 409
 * with a clear error nudges ops to open a fresh request rather than
 * paper over the issue.
 *
 * @param {{
 *   orgId: number,
 *   externalId: string,
 *   actorEmailHash: string,
 *   role: 'customer' | 'ops' | 'system',
 *   body: string
 * }} input
 */
async function appendImportRequestMessage({ orgId, externalId, actorEmailHash, role, body }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'] };
  }
  if (!MESSAGE_ROLES.includes(role)) {
    return { ok: false, errors: [`role must be one of: ${MESSAGE_ROLES.join(', ')}`] };
  }
  if (typeof body !== 'string') {
    return { ok: false, errors: ['body must be a string'] };
  }
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return { ok: false, errors: ['body cannot be empty'] };
  }
  if (trimmed.length > MESSAGE_BODY_MAX) {
    return { ok: false, errors: [`body must be <= ${MESSAGE_BODY_MAX} chars`] };
  }
  if (!db.isConfigured()) return notConfigured();

  const before = await getImportRequestByExternalId({ orgId, externalId });
  if (!before.ok) return before;
  const beforeRow = /** @type {any} */ (before).importRequest;
  const existing = Array.isArray(beforeRow.messages) ? beforeRow.messages : [];
  if (existing.length >= MESSAGES_MAX_PER_REQUEST) {
    return {
      ok: false,
      conflict: true,
      errors: [`message cap (${MESSAGES_MAX_PER_REQUEST}) reached — open a fresh request to continue the conversation`],
    };
  }

  const message = {
    id: generateMessageId(),
    role,
    body: trimmed,
    byEmailHash: actorEmailHash,
    at: new Date().toISOString(),
  };

  try {
    const rows = await db.query(
      `UPDATE import_requests
         SET messages = messages || $1::jsonb,
             updated_at = now()
       WHERE org_id = $2 AND external_id = $3
       RETURNING *`,
      [JSON.stringify([message]), orgId, externalId],
    );
    if (rows.length === 0) {
      return { ok: false, notFound: true, errors: ['Not found'] };
    }
    const importRequest = rowToImportRequest(rows[0]);
    // Audit-log the message append BEFORE returning success (ADR
    // 0005). The message body itself is NOT in the audit detail
    // (it's already in the row); we just record the actor + role +
    // message id so the audit reader can correlate.
    await events.record('import_request_message_posted', {
      orgId,
      actorEmailHash,
      entityType: 'import_request',
      entityId: externalId,
      detail: { messageId: message.id, role, length: trimmed.length },
    });
    return { ok: true, importRequest, message };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'append message failed');
  }
}

/**
 * Sprint 55 — append an internal ops note to a request.
 *
 * RBAC discipline: the handler layer enforces ops-only via
 * requireOpsRole BEFORE calling this. This helper is intentionally
 * unaware of role — same posture as appendImportRequestMessage. The
 * detail endpoint redacts the column when the reader isn't ops.
 *
 * @param {{ orgId: number, externalId: string, actorEmailHash: string, body: string }} input
 */
async function appendInternalNote({ orgId, externalId, actorEmailHash, body }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'] };
  }
  if (typeof body !== 'string') {
    return { ok: false, errors: ['body must be a string'] };
  }
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return { ok: false, errors: ['body cannot be empty'] };
  }
  if (trimmed.length > INTERNAL_NOTE_BODY_MAX) {
    return { ok: false, errors: [`body must be <= ${INTERNAL_NOTE_BODY_MAX} chars`] };
  }
  if (!db.isConfigured()) return notConfigured();

  const before = await getImportRequestByExternalId({ orgId, externalId });
  if (!before.ok) return before;
  const beforeRow = /** @type {any} */ (before).importRequest;
  const existing = Array.isArray(beforeRow.internalNotes) ? beforeRow.internalNotes : [];
  if (existing.length >= INTERNAL_NOTES_MAX_PER_REQUEST) {
    return {
      ok: false,
      conflict: true,
      errors: [`internal-note cap (${INTERNAL_NOTES_MAX_PER_REQUEST}) reached for this request`],
    };
  }

  const note = {
    id: generateInternalNoteId(),
    body: trimmed,
    byEmailHash: actorEmailHash,
    at: new Date().toISOString(),
  };

  try {
    const rows = await db.query(
      `UPDATE import_requests
         SET internal_notes = internal_notes || $1::jsonb,
             updated_at = now()
       WHERE org_id = $2 AND external_id = $3
       RETURNING *`,
      [JSON.stringify([note]), orgId, externalId],
    );
    if (rows.length === 0) {
      return { ok: false, notFound: true, errors: ['Not found'] };
    }
    const importRequest = rowToImportRequest(rows[0]);
    // Audit-log BEFORE returning success (ADR-0005). The body
    // itself stays on the row (not in the chain detail) — same
    // privacy posture as sprint 18 messages + sprint 30 ratings.
    await events.record('import_request_internal_note_added', {
      orgId,
      actorEmailHash,
      entityType: 'import_request',
      entityId: externalId,
      detail: { noteId: note.id, length: trimmed.length },
    });
    return { ok: true, importRequest, note };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'append internal note failed');
  }
}

/**
 * Sprint 21 — per-user read receipt on the thread. Stamps the user's
 * lastReadAt + lastReadMessageId into message_read_state[emailHash].
 * Subsequent computeUnreadCount calls compare each message's
 * timestamp against that mark to derive unread.
 *
 * Idempotent — re-marking on the same set of messages is safe
 * (the JSONB merge with jsonb_set just overwrites the same value).
 *
 * Same-org enforcement via WHERE clause; cross-org mark touches 0
 * rows and returns notFound.
 *
 * No audit event fires here — read receipts are NOT a mutation in
 * the ADR-0005 sense. They're metadata about who has SEEN what, not
 * changes to substantive state. Flooding the audit log with one
 * row per dashboard load would degrade the chain head's utility +
 * blow KV capacity at scale.
 *
 * @param {{
 *   orgId: number,
 *   externalId: string,
 *   actorEmailHash: string,
 *   readUpToMessageId?: string,
 *   readUpToAt?: string,
 * }} input
 */
async function markMessagesRead({ orgId, externalId, actorEmailHash, readUpToMessageId, readUpToAt }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'] };
  }
  if (!db.isConfigured()) return notConfigured();

  // Default to "now" if no explicit timestamp — covers the auto-mark
  // path on detail-page open.
  const at = (typeof readUpToAt === 'string' && readUpToAt) || new Date().toISOString();
  const mark = {
    lastReadAt: at,
    lastReadMessageId: typeof readUpToMessageId === 'string' ? readUpToMessageId : null,
  };

  try {
    const rows = await db.query(
      `UPDATE import_requests
         SET message_read_state = jsonb_set(
               COALESCE(message_read_state, '{}'::jsonb),
               ARRAY[$1::text],
               $2::jsonb,
               true
             ),
             updated_at = now()
       WHERE org_id = $3 AND external_id = $4
       RETURNING *`,
      [actorEmailHash, JSON.stringify(mark), orgId, externalId],
    );
    if (rows.length === 0) {
      return { ok: false, notFound: true, errors: ['Not found'] };
    }
    return { ok: true, importRequest: rowToImportRequest(rows[0]) };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'mark messages read failed');
  }
}

/**
 * Compute the unread count for a specific user against a request's
 * messages. Pure function — exported so the same logic powers the
 * list view, the detail page, AND the read-state drift tests
 * without a DB round-trip.
 *
 * Rules:
 *   • A message the user POSTED themselves never counts as unread
 *     (you don't get a notification for your own message)
 *   • A message with at <= lastReadAt counts as read
 *   • A message with no lastReadAt entry counts as unread (first
 *     visit to a thread with existing messages)
 *
 * @param {{
 *   messages: Array<{ id: string, at: string, byEmailHash: string }> | undefined,
 *   messageReadState: Record<string, { lastReadAt?: string }> | undefined,
 *   actorEmailHash: string,
 * }} input
 * @returns {number}
 */
function computeUnreadCount({ messages, messageReadState, actorEmailHash }) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  if (!actorEmailHash) return 0;
  const mark = (messageReadState && messageReadState[actorEmailHash]) || null;
  const lastReadMs = mark && typeof mark.lastReadAt === 'string'
    ? Date.parse(mark.lastReadAt)
    : 0;
  let unread = 0;
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    // Skip messages this user posted themselves.
    if (m.byEmailHash === actorEmailHash) continue;
    // Skip 'system' messages too — they don't need an "ack" from
    // either side. (Sprint 19's auto-expiry post is the canonical
    // case; pinging both sides "you have 1 unread" would be noise.)
    if (/** @type {any} */ (m).role === 'system') continue;
    const ts = typeof m.at === 'string' ? Date.parse(m.at) : 0;
    if (!Number.isFinite(ts)) continue;
    if (ts > lastReadMs) unread += 1;
  }
  return unread;
}

// ── Compliance evidence (sprint 27) ──────────────────────────────────

/**
 * Append a compliance evidence attachment to the request. Append-only:
 * once an entry lands, even the original attacher cannot edit or delete
 * it via this path — supersession is a separate event so the audit
 * chain stays intact (compliance auditors think this way: every
 * artefact is preserved, supersession is a recorded action).
 *
 * Same-org enforcement via the WHERE clause; a cross-org append
 * touches 0 rows and returns notFound.
 *
 * URL validation is intentionally lenient: we accept any https://
 * cloud-share URL (SharePoint, Google Drive, DropBox, signed S3
 * URLs, customer-side servers). v1 doesn't inspect the resource —
 * the customer or ops who attached it vouches for the contents.
 * Future sprints can layer URL-host allowlists or HEAD-checks on
 * the same field without changing the schema.
 *
 * Soft cap at 50 attachments — anything bigger almost certainly
 * means evidence-spam; the customer should attach an index doc and
 * reference inside it.
 *
 * @param {{
 *   orgId: number,
 *   externalId: string,
 *   actorEmailHash: string,
 *   regime: string,
 *   label: string,
 *   url: string,
 *   notes?: string
 * }} input
 */
async function appendEvidenceAttachment({ orgId, externalId, actorEmailHash, regime, label, url, notes }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'] };
  }
  if (!COMPLIANCE_REGIMES.includes(regime)) {
    return { ok: false, errors: [`regime must be one of: ${COMPLIANCE_REGIMES.join(', ')}`] };
  }
  if (typeof label !== 'string' || label.trim().length === 0) {
    return { ok: false, errors: ['label required (non-empty string)'] };
  }
  const trimmedLabel = label.trim();
  if (trimmedLabel.length > EVIDENCE_LABEL_MAX) {
    return { ok: false, errors: [`label must be <= ${EVIDENCE_LABEL_MAX} chars`] };
  }
  if (typeof url !== 'string' || url.length === 0) {
    return { ok: false, errors: ['url required'] };
  }
  const trimmedUrl = url.trim();
  if (trimmedUrl.length > EVIDENCE_URL_MAX) {
    return { ok: false, errors: [`url must be <= ${EVIDENCE_URL_MAX} chars`] };
  }
  if (!/^https:\/\/[^\s]+$/i.test(trimmedUrl)) {
    return { ok: false, errors: ['url must be a single https:// link (no whitespace)'] };
  }
  let trimmedNotes = '';
  if (notes != null) {
    if (typeof notes !== 'string') return { ok: false, errors: ['notes must be a string'] };
    trimmedNotes = notes.trim();
    if (trimmedNotes.length > EVIDENCE_NOTES_MAX) {
      return { ok: false, errors: [`notes must be <= ${EVIDENCE_NOTES_MAX} chars`] };
    }
  }
  if (!db.isConfigured()) return notConfigured();

  const before = await getImportRequestByExternalId({ orgId, externalId });
  if (!before.ok) return before;
  const beforeRow = /** @type {any} */ (before).importRequest;
  const existing = Array.isArray(beforeRow.evidenceAttachments) ? beforeRow.evidenceAttachments : [];
  if (existing.length >= EVIDENCE_MAX_PER_REQUEST) {
    return {
      ok: false,
      conflict: true,
      errors: [`evidence cap (${EVIDENCE_MAX_PER_REQUEST}) reached — attach an index document and reference inside it`],
    };
  }

  const attachment = {
    id: generateEvidenceId(),
    regime,
    label: trimmedLabel,
    url: trimmedUrl,
    uploadedByEmailHash: actorEmailHash,
    uploadedAt: new Date().toISOString(),
    notes: trimmedNotes || '',
  };

  try {
    const rows = await db.query(
      `UPDATE import_requests
         SET evidence_attachments = evidence_attachments || $1::jsonb,
             updated_at = now()
       WHERE org_id = $2 AND external_id = $3
       RETURNING *`,
      [JSON.stringify([attachment]), orgId, externalId],
    );
    if (rows.length === 0) {
      return { ok: false, notFound: true, errors: ['Not found'] };
    }
    const importRequest = rowToImportRequest(rows[0]);
    // Audit-log the append BEFORE returning success (ADR 0005). The
    // URL itself is NOT in the audit detail — the row already carries
    // it. We record { evidenceId, regime, urlHost } so the audit
    // reader can correlate without leaking the full link.
    let urlHost = '';
    try { urlHost = new URL(trimmedUrl).host; } catch (_) { urlHost = ''; }
    await events.record('import_request_evidence_attached', {
      orgId,
      actorEmailHash,
      entityType: 'import_request',
      entityId: externalId,
      detail: { evidenceId: attachment.id, regime, urlHost, hasNotes: trimmedNotes.length > 0 },
    });
    return { ok: true, importRequest, attachment };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'append evidence failed');
  }
}

// ── Supplier-pick learning loop (sprint 28) ─────────────────────────

/**
 * Record the supplier-country pick at materialisation time. Called
 * from the orchestrator's materialiseApprovedRequest path after the
 * downstream Shipment + Supplier rows land. Idempotent for the same
 * (org, request) — a second call replaces the existing pick rather
 * than appending (since each request has exactly one materialised
 * pick). A future supersession event would write a different row.
 *
 * The hsPrefix6 field is derived at write time so the aggregate
 * query (next function) can index on it without parsing the full HS
 * code each time.
 *
 * @param {{
 *   orgId: number,
 *   externalId: string,
 *   actorEmailHash: string,
 *   country: string,
 *   hsCode?: string | null,
 *   rationaleCategory: string,
 *   rationale?: string
 * }} input
 */
async function recordSupplierPick({ orgId, externalId, actorEmailHash, country, hsCode, rationaleCategory, rationale }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'] };
  }
  if (typeof country !== 'string' || !ISO2_RE.test(country.toUpperCase())) {
    return { ok: false, errors: ['country required (ISO-2)'] };
  }
  if (!PICK_RATIONALE_CATEGORIES.includes(rationaleCategory)) {
    return {
      ok: false,
      errors: [`rationaleCategory must be one of: ${PICK_RATIONALE_CATEGORIES.join(', ')}`],
    };
  }
  let trimmedRationale = '';
  if (rationale != null) {
    if (typeof rationale !== 'string') return { ok: false, errors: ['rationale must be a string'] };
    trimmedRationale = rationale.trim();
    if (trimmedRationale.length > PICK_RATIONALE_MAX) {
      return { ok: false, errors: [`rationale must be <= ${PICK_RATIONALE_MAX} chars`] };
    }
  }
  if (!db.isConfigured()) return notConfigured();

  // Derive the indexed hsPrefix6. Accept null (no HS classified yet)
  // — the aggregate query simply won't match those rows on the
  // hsPrefix dimension.
  const hsPrefix6 = (typeof hsCode === 'string' && /^[0-9]{6,}/.test(hsCode))
    ? hsCode.slice(0, 6)
    : null;

  const pick = {
    country: country.toUpperCase(),
    rationaleCategory,
    rationale: trimmedRationale,
    hsPrefix6,
    pickedByEmailHash: actorEmailHash,
    pickedAt: new Date().toISOString(),
  };

  try {
    const rows = await db.query(
      `UPDATE import_requests
         SET supplier_pick = $1::jsonb,
             updated_at = now()
       WHERE org_id = $2 AND external_id = $3
       RETURNING *`,
      [JSON.stringify(pick), orgId, externalId],
    );
    if (rows.length === 0) {
      return { ok: false, notFound: true, errors: ['Not found'] };
    }
    const importRequest = rowToImportRequest(rows[0]);
    // Audit-log the pick BEFORE returning success (ADR 0005). The
    // rationale free-text is already on the row; detail just records
    // { country, hsPrefix6, rationaleCategory } so the audit reader
    // can correlate without re-pulling the row.
    await events.record('import_request_supplier_picked', {
      orgId,
      actorEmailHash,
      entityType: 'import_request',
      entityId: externalId,
      detail: {
        country: pick.country,
        hsPrefix6,
        rationaleCategory,
      },
    });
    return { ok: true, importRequest, pick };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'record supplier pick failed');
  }
}

/**
 * Aggregate the org's historical supplier picks for a given
 * (hsPrefix6, originHint) bucket within a sliding window. Returns
 * a map: country → { count, lastPickedAt, rationaleCategoryMix }.
 *
 * This is the "your team picked Vietnam 4 times in the last 90
 * days" learning signal. Called by the orchestrator when building
 * a new shortlist — each top-3 country gets the enrichment.
 *
 * Pure read; no audit event. windowDays clamped to [1, 365].
 *
 * @param {{
 *   orgId: number,
 *   hsPrefix6?: string | null,
 *   windowDays?: number
 * }} input
 */
async function aggregateSupplierPicks({ orgId, hsPrefix6, windowDays = 90 }) {
  if (!Number.isInteger(orgId)) return { ok: false, errors: ['orgId required'] };
  if (!db.isConfigured()) return notConfigured();
  const days = Math.max(1, Math.min(365, Number(windowDays) || 90));

  /** @type {string[]} */
  const where = [
    'org_id = $1',
    'archived_at IS NULL',
    'supplier_pick IS NOT NULL',
  ];
  /** @type {any[]} */
  const params = [orgId];
  // Pick recency is what matters — a 2-year-old pick is stale. Use
  // pickedAt from the JSONB rather than created_at so a request
  // created long ago but materialised recently still counts.
  params.push(String(days));
  where.push(`(supplier_pick->>'pickedAt')::timestamptz >= now() - ($${params.length} || ' days')::interval`);
  if (typeof hsPrefix6 === 'string' && hsPrefix6.length === 6) {
    params.push(hsPrefix6);
    where.push(`supplier_pick->>'hsPrefix6' = $${params.length}`);
  }

  try {
    // Sprint 32 — cross-cohort correlation: pull customer_rating
    // alongside the pick so byCountry can report avgRating per
    // country. The rating may be NULL (customer hasn't rated yet);
    // we count it in ratedPicks separately so avg is computed only
    // over rated picks (NOT picks-as-denominator, which would skew
    // toward 0 for fresh approvals).
    const rows = await db.query(
      `SELECT
          supplier_pick->>'country' AS country,
          supplier_pick->>'rationaleCategory' AS rationale_category,
          supplier_pick->>'pickedAt' AS picked_at,
          (customer_rating->>'score')::int AS rating_score
         FROM import_requests
        WHERE ${where.join(' AND ')}`,
      params,
    );
    /** @type {Record<string, { count: number, lastPickedAt: string, rationaleCategoryMix: Record<string, number>, ratedCount: number, ratingSum: number, avgRating: number | null }>} */
    const byCountry = {};
    for (const r of rows) {
      const country = String(r.country || '').toUpperCase();
      if (!country) continue;
      const at = String(r.picked_at || '');
      const cat = String(r.rationale_category || 'other');
      if (!byCountry[country]) {
        byCountry[country] = {
          count: 0, lastPickedAt: at, rationaleCategoryMix: {},
          ratedCount: 0, ratingSum: 0, avgRating: null,
        };
      }
      const entry = byCountry[country];
      entry.count += 1;
      if (at && at > entry.lastPickedAt) entry.lastPickedAt = at;
      entry.rationaleCategoryMix[cat] = (entry.rationaleCategoryMix[cat] || 0) + 1;
      const score = Number(r.rating_score);
      if (Number.isInteger(score) && score >= 1 && score <= 5) {
        entry.ratedCount += 1;
        entry.ratingSum += score;
      }
    }
    // Finalise avgRating once all rows are accumulated. One-decimal
    // server-side rounding matches sprint-31 ratingCohort precision.
    for (const entry of Object.values(byCountry)) {
      entry.avgRating = entry.ratedCount > 0
        ? Math.round((entry.ratingSum / entry.ratedCount) * 10) / 10
        : null;
    }
    return { ok: true, windowDays: days, byCountry };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'aggregate supplier picks failed');
  }
}

// ── Customer rating (sprint 30) ─────────────────────────────────────

/**
 * Record (or supersede) a customer rating on an approved request.
 * Authorization is enforced at the handler: the request creator can
 * rate; ops cannot rate on the customer's behalf.
 *
 * Last-write-wins on the supersession case — a second call from the
 * same actor replaces the prior rating verbatim. The audit chain
 * preserves the supersession event so the prior rating is recoverable
 * from the audit log.
 *
 * Same-org enforcement via the WHERE clause; a cross-org call touches
 * 0 rows and returns notFound.
 *
 * Gated on status === 'customer_approved' — earlier statuses don't
 * have a customer-visible quote to evaluate; later/terminal statuses
 * (rejected, cancelled, expired, failed) wouldn't represent a
 * delivery experience worth rating. Returns conflict:true on bad
 * status so the handler can map to 409.
 *
 * @param {{
 *   orgId: number,
 *   externalId: string,
 *   actorEmailHash: string,
 *   score: number,
 *   comment?: string
 * }} input
 */
async function recordCustomerRating({ orgId, externalId, actorEmailHash, score, comment }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'] };
  }
  if (!Number.isInteger(score) || score < RATING_MIN || score > RATING_MAX) {
    return { ok: false, errors: [`score must be an integer in [${RATING_MIN}, ${RATING_MAX}]`] };
  }
  let trimmedComment = '';
  if (comment != null) {
    if (typeof comment !== 'string') return { ok: false, errors: ['comment must be a string'] };
    trimmedComment = comment.trim();
    if (trimmedComment.length > RATING_COMMENT_MAX) {
      return { ok: false, errors: [`comment must be <= ${RATING_COMMENT_MAX} chars`] };
    }
  }
  if (!db.isConfigured()) return notConfigured();

  const before = await getImportRequestByExternalId({ orgId, externalId });
  if (!before.ok) return before;
  const beforeRow = /** @type {any} */ (before).importRequest;
  if (beforeRow.status !== 'customer_approved') {
    return {
      ok: false,
      conflict: true,
      errors: [`recordCustomerRating requires status='customer_approved', got '${beforeRow.status}'`],
    };
  }

  const rating = {
    score,
    comment: trimmedComment || '',
    ratedByEmailHash: actorEmailHash,
    ratedAt: new Date().toISOString(),
  };
  // Capture whether this is a supersession so the audit event can
  // record it; the customer's last rating is what matters going
  // forward but a supersession is a meaningful signal.
  const isSupersession = Boolean(
    beforeRow.customerRating
    && typeof beforeRow.customerRating === 'object'
    && Number.isFinite(beforeRow.customerRating.score),
  );

  try {
    const rows = await db.query(
      `UPDATE import_requests
         SET customer_rating = $1::jsonb,
             updated_at = now()
       WHERE org_id = $2 AND external_id = $3
       RETURNING *`,
      [JSON.stringify(rating), orgId, externalId],
    );
    if (rows.length === 0) {
      return { ok: false, notFound: true, errors: ['Not found'] };
    }
    const importRequest = rowToImportRequest(rows[0]);
    // Audit-log BEFORE returning success (ADR 0005). Detail carries
    // { score, hasComment, isSupersession } — the free-text comment
    // stays on the row, not in the audit chain head (privacy +
    // locality discipline; same posture as sprint-18 messages +
    // sprint-28 picks).
    await events.record('import_request_rated', {
      orgId,
      actorEmailHash,
      entityType: 'import_request',
      entityId: externalId,
      detail: {
        score,
        hasComment: trimmedComment.length > 0,
        isSupersession,
      },
    });
    // Sprint 33 — return isSupersession to the handler so the
    // low-rating alert email can render different subject + body
    // copy on a "REVISED DOWN" vs first-time rating.
    return { ok: true, importRequest, rating, isSupersession };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'record customer rating failed');
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
 *   notes?: string,
 *   declineReason?: string
 * }} input
 */
async function attachTeamReview({ orgId, externalId, actorEmailHash, decision, edits, notes, declineReason }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'] };
  }
  if (!['approved', 'sent_back', 'rejected'].includes(decision)) {
    return { ok: false, errors: ['decision must be approved | sent_back | rejected'] };
  }
  // declineReason is required when ops rejects — every "no" must carry
  // a structured reason so the customer email + activity feed render
  // meaningfully. 'other' covers cases the enum doesn't, with the free-
  // text notes carrying the detail.
  if (decision === 'rejected') {
    if (!declineReason || !DECLINE_REASONS.includes(declineReason)) {
      return {
        ok: false,
        errors: [`declineReason required when decision='rejected' (one of: ${DECLINE_REASONS.join(', ')})`],
      };
    }
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
  if (decision === 'rejected') {
    // The guard above asserts declineReason is a valid enum value
    // before we get here; the type narrowing is what we tell TS.
    const reason = /** @type {string} */ (declineReason);
    /** @type {any} */ (reviewPayload).declineReason = reason;
    /** @type {any} */ (reviewPayload).revisable = REVISABLE_DECLINE_REASONS.includes(reason);
  }

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
  DECLINE_REASONS,
  REVISABLE_DECLINE_REASONS,
  STALL_THRESHOLD_DAYS,
  STALLED_QUEUE_CAP,
  DECLINE_SPIKE_CURRENT_DAYS,
  DECLINE_SPIKE_BASELINE_DAYS,
  DECLINE_SPIKE_MIN_COUNT,
  DECLINE_SPIKE_RATE_MULT,
  QUOTE_ACCEPTANCE_CURRENT_DAYS,
  QUOTE_ACCEPTANCE_BASELINE_DAYS,
  QUOTE_ACCEPTANCE_MIN_COUNT,
  QUOTE_ACCEPTANCE_DEGRADATION_THRESHOLD,
  SUPPLIER_CONCENTRATION_WINDOW_DAYS,
  SUPPLIER_CONCENTRATION_MIN_COUNT,
  SUPPLIER_CONCENTRATION_THRESHOLD,
  MESSAGE_ROLES,
  MESSAGE_BODY_MAX,
  MESSAGES_MAX_PER_REQUEST,
  COMPLIANCE_REGIMES,
  EVIDENCE_LABEL_MAX,
  EVIDENCE_NOTES_MAX,
  EVIDENCE_MAX_PER_REQUEST,
  EVIDENCE_URL_MAX,
  PICK_RATIONALE_CATEGORIES,
  PICK_RATIONALE_MAX,
  RATING_MIN,
  RATING_MAX,
  RATING_COMMENT_MAX,
  // Internal helpers exposed for tests.
  _rowToImportRequest: rowToImportRequest,
  _validateForCreate: validateForCreate,
  // CRUD.
  createImportRequest,
  getImportRequestByExternalId,
  listImportRequestsForOrg,
  aggregateOpsInsights,
  // State machine + artefact attachers.
  transitionImportRequestStatus,
  attachShortlistAndQuote,
  attachTeamReview,
  bulkAttachTeamReview,
  attachCustomerDecision,
  linkMaterialisedShipment,
  appendImportRequestMessage,
  appendInternalNote,
  INTERNAL_NOTE_BODY_MAX,
  INTERNAL_NOTES_MAX_PER_REQUEST,
  appendEvidenceAttachment,
  recordSupplierPick,
  aggregateSupplierPicks,
  recordCustomerRating,
  markMessagesRead,
  computeUnreadCount,
  expireStaleQuotes,
  archiveImportRequest,
};
