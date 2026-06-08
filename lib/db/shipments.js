// @ts-check
'use strict';

// Shipment master CRUD + state machine — L1.3 of
// docs/strategic-plan-2026-2031.md §4.1.2.
//
// PG-primary store. Mirrors lib/db/goods.js + lib/db/suppliers.js in
// shape; the load-bearing distinct piece is the state machine.
//
// State transitions
// ─────────────────
//   planned    → booked     | exception | cancelled
//   booked     → in_transit | exception | cancelled
//   in_transit → cleared    | exception | cancelled
//   cleared    → delivered  | exception
//   delivered  → exception                                     (recovery only)
//   exception  → planned | booked | in_transit | cleared | delivered | cancelled
//   cancelled  → ∅                                              (terminal)
//
// The transition table is the source of truth (lives in code, with a
// drift-guard test against the SQL status-check constraint). The data
// layer rejects illegal transitions with conflict:true so the handler
// returns 409, never silently mutates state.

const crypto = require('node:crypto');
const db = require('./client');
const events = require('../events');
const log = require('../log').withContext({ module: 'db-shipments' });

const ISO2_RE = /^[A-Z]{2}$/;

const STATUSES = Object.freeze(['planned', 'booked', 'in_transit', 'cleared', 'delivered', 'exception', 'cancelled']);
const TERMINAL_STATUSES = Object.freeze(['cancelled']);

/**
 * Canonical transition table. Adding a new edge here requires updating
 * the test that pins the table contents and the runbook for ops.
 * @type {Record<string, readonly string[]>}
 */
const VALID_TRANSITIONS = Object.freeze({
  planned: Object.freeze(['booked', 'exception', 'cancelled']),
  booked: Object.freeze(['in_transit', 'exception', 'cancelled']),
  in_transit: Object.freeze(['cleared', 'exception', 'cancelled']),
  cleared: Object.freeze(['delivered', 'exception']),
  delivered: Object.freeze(['exception']),
  exception: Object.freeze(['planned', 'booked', 'in_transit', 'cleared', 'delivered', 'cancelled']),
  cancelled: Object.freeze([]),
});

function generateShipmentId() {
  return 'sh_' + crypto.randomBytes(8).toString('hex');
}

/**
 * @param {Record<string, any> | null | undefined} r
 */
function rowToShipment(r) {
  if (!r) return null;
  return {
    id: r.id,
    externalId: r.external_id,
    orgId: r.org_id,
    createdByEmailHash: r.created_by_email_hash,
    label: r.label,
    status: r.status,
    goodsExternalId: r.goods_external_id,
    supplierExternalId: r.supplier_external_id,
    plannedDepartureDate: r.planned_departure_date,
    plannedArrivalDate: r.planned_arrival_date,
    customsValueCents: r.customs_value_cents == null ? null : Number(r.customs_value_cents),
    originCountry: r.origin_country,
    destinationCountry: r.destination_country,
    carrier: r.carrier,
    bookingRef: r.booking_ref,
    containerCount: r.container_count == null ? null : Number(r.container_count),
    weightKg: r.weight_kg == null ? null : Number(r.weight_kg),
    volumeCbm: r.volume_cbm == null ? null : Number(r.volume_cbm),
    blNumber: r.bl_number,
    actualDepartureDate: r.actual_departure_date,
    eta: r.eta,
    lastKnownLocation: r.last_known_location,
    clearedAt: r.cleared_at,
    declarationRef: r.declaration_ref,
    dutyPaidCents: r.duty_paid_cents == null ? null : Number(r.duty_paid_cents),
    vatPaidCents: r.vat_paid_cents == null ? null : Number(r.vat_paid_cents),
    brokeragePaidCents: r.brokerage_paid_cents == null ? null : Number(r.brokerage_paid_cents),
    deliveredAt: r.delivered_at,
    exceptionState: (r.exception_state && typeof r.exception_state === 'object') ? r.exception_state : {},
    documentVault: Array.isArray(r.document_vault) ? r.document_vault : [],
    inputsSnapshot: r.inputs_snapshot,
    quoteSnapshot: r.quote_snapshot,
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
  const errors = [];
  if (!input || typeof input !== 'object') return ['input required'];
  if (!Number.isInteger(input.orgId) || input.orgId <= 0) errors.push('orgId required (positive integer)');
  if (!input.createdByEmailHash || typeof input.createdByEmailHash !== 'string') errors.push('createdByEmailHash required');
  if (!input.label || typeof input.label !== 'string') errors.push('label required');
  else if (input.label.length > 200) errors.push('label must be ≤200 chars');

  if (input.originCountry != null && input.originCountry !== '') {
    if (!ISO2_RE.test(String(input.originCountry).toUpperCase())) errors.push('originCountry must be ISO-2 uppercase');
  }
  if (input.destinationCountry != null && input.destinationCountry !== '') {
    if (!ISO2_RE.test(String(input.destinationCountry).toUpperCase())) errors.push('destinationCountry must be ISO-2 uppercase');
  }

  if (input.customsValueCents != null) {
    if (!Number.isInteger(input.customsValueCents) || input.customsValueCents < 0) {
      errors.push('customsValueCents must be a non-negative integer (ADR 0004)');
    }
  }
  if (input.weightKg != null) {
    if (!Number.isInteger(input.weightKg) || input.weightKg < 0) errors.push('weightKg must be a non-negative integer');
  }
  if (input.containerCount != null) {
    if (!Number.isInteger(input.containerCount) || input.containerCount < 0) errors.push('containerCount must be a non-negative integer');
  }

  if (input.documentVault !== undefined && !Array.isArray(input.documentVault)) errors.push('documentVault must be an array');
  if (input.exceptionState !== undefined && (typeof input.exceptionState !== 'object' || Array.isArray(input.exceptionState))) {
    errors.push('exceptionState must be an object');
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
  if (/violates check constraint.*shipment_master_status_check/i.test(message)) {
    return { ok: false, errors: [`status must be one of: ${STATUSES.join(', ')}`] };
  }
  if (/violates check constraint.*shipment_master_origin_country_format/i.test(message)) {
    return { ok: false, errors: ['originCountry must be ISO-2 uppercase'] };
  }
  if (/violates check constraint.*shipment_master_destination_country_format/i.test(message)) {
    return { ok: false, errors: ['destinationCountry must be ISO-2 uppercase'] };
  }
  if (/violates check constraint.*shipment_master_(customs_value|money)_non_negative/i.test(message)) {
    return { ok: false, errors: ['monetary values must be non-negative'] };
  }
  return { ok: false, errors: [message] };
}

// ── CRUD + state machine ──────────────────────────────────────────────

/**
 * @param {Record<string, any>} input
 */
async function createShipment(input) {
  const errors = validateForCreate(input);
  if (errors.length) return { ok: false, errors };
  if (!db.isConfigured()) return notConfigured();

  const externalId = generateShipmentId();
  try {
    const rows = await db.query(
      `INSERT INTO shipment_master (
        external_id, org_id, created_by_email_hash, label, status,
        goods_external_id, supplier_external_id,
        planned_departure_date, planned_arrival_date,
        customs_value_cents, origin_country, destination_country,
        weight_kg, container_count,
        document_vault, inputs_snapshot, quote_snapshot, metadata
      ) VALUES (
        $1, $2, $3, $4, 'planned',
        $5, $6,
        $7, $8,
        $9, $10, $11,
        $12, $13,
        $14, $15, $16, $17
      )
      RETURNING *`,
      [
        externalId, input.orgId, input.createdByEmailHash, input.label,
        input.goodsExternalId || null, input.supplierExternalId || null,
        input.plannedDepartureDate || null, input.plannedArrivalDate || null,
        input.customsValueCents == null ? null : input.customsValueCents,
        input.originCountry ? String(input.originCountry).toUpperCase() : null,
        input.destinationCountry ? String(input.destinationCountry).toUpperCase() : null,
        input.weightKg == null ? null : input.weightKg,
        input.containerCount == null ? null : input.containerCount,
        JSON.stringify(input.documentVault || []),
        input.inputsSnapshot ? JSON.stringify(input.inputsSnapshot) : null,
        input.quoteSnapshot ? JSON.stringify(input.quoteSnapshot) : null,
        JSON.stringify(input.metadata || {}),
      ],
    );
    const shipment = rowToShipment(rows[0]);
    await events.record('shipment_master_created', {
      orgId: input.orgId,
      actorEmailHash: input.createdByEmailHash,
      entityType: 'shipment_master',
      entityId: externalId,
      after: shipment,
    });
    return { ok: true, shipment };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'shipment create failed';
    log.warn('createShipment failed', { err: message });
    return failureFromDb(message);
  }
}

/**
 * @param {{ orgId: number, externalId: string }} input
 */
async function getShipmentByExternalId({ orgId, externalId }) {
  if (!Number.isInteger(orgId) || !externalId) return { ok: false, errors: ['orgId + externalId required'] };
  if (!db.isConfigured()) return notConfigured();
  try {
    const rows = await db.query(
      `SELECT * FROM shipment_master WHERE org_id = $1 AND external_id = $2`,
      [orgId, externalId],
    );
    if (rows.length === 0) return { ok: false, errors: ['not_found'], notFound: true };
    return { ok: true, shipment: rowToShipment(rows[0]) };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'shipment read failed');
  }
}

/**
 * @param {{ orgId: number, includeArchived?: boolean, limit?: number, status?: string, supplierExternalId?: string, goodsExternalId?: string }} input
 */
async function listShipmentsForOrg({ orgId, includeArchived = false, limit = 200, status, supplierExternalId, goodsExternalId }) {
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
  if (supplierExternalId) {
    params.push(supplierExternalId);
    where.push(`supplier_external_id = $${params.length}`);
  }
  if (goodsExternalId) {
    params.push(goodsExternalId);
    where.push(`goods_external_id = $${params.length}`);
  }
  params.push(cappedLimit);
  try {
    const rows = await db.query(
      `SELECT * FROM shipment_master WHERE ${where.join(' AND ')}
       ORDER BY updated_at DESC LIMIT $${params.length}`,
      params,
    );
    return { ok: true, shipments: rows.map(rowToShipment) };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'shipment list failed');
  }
}

/**
 * State transition. Rejects with conflict:true on an illegal edge so
 * the handler returns 409. The `details` payload is appended to
 * exception_state when the new status is 'exception'; otherwise it
 * extends `metadata`.
 *
 * @param {{ orgId: number, externalId: string, actorEmailHash: string, toStatus: string, details?: Record<string, any> }} input
 */
async function transitionShipmentStatus({ orgId, externalId, actorEmailHash, toStatus, details }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'] };
  }
  if (!STATUSES.includes(toStatus)) {
    return { ok: false, errors: [`toStatus must be one of: ${STATUSES.join(', ')}`] };
  }
  if (!db.isConfigured()) return notConfigured();

  const before = await getShipmentByExternalId({ orgId, externalId });
  if (!before.ok) return before;
  const beforeShipment = /** @type {any} */ (before).shipment;

  if (beforeShipment.status === toStatus) {
    return { ok: true, shipment: beforeShipment, unchanged: true };
  }
  if (!isLegalTransition(beforeShipment.status, toStatus)) {
    return {
      ok: false,
      errors: [`illegal transition: ${beforeShipment.status} → ${toStatus}`],
      conflict: true,
    };
  }

  /** @type {Record<string, any>} */
  const exceptionState = toStatus === 'exception'
    ? {
        reason: (details && details.reason) || 'unspecified',
        openedAt: new Date().toISOString(),
        previousStatus: beforeShipment.status,
        ...(details || {}),
      }
    : beforeShipment.exceptionState || {};

  // Stamp transition timestamps where applicable. cleared_at and
  // delivered_at are first-class columns; everything else lives in
  // metadata.transitions[].
  const setClauses = ['status = $3', 'updated_at = now()', 'exception_state = $4'];
  /** @type {any[]} */
  const params = [orgId, externalId, toStatus, JSON.stringify(exceptionState)];
  if (toStatus === 'cleared') {
    params.push(new Date().toISOString());
    setClauses.push(`cleared_at = $${params.length}`);
  }
  if (toStatus === 'delivered') {
    params.push(new Date().toISOString());
    setClauses.push(`delivered_at = $${params.length}`);
  }
  try {
    const rows = await db.query(
      `UPDATE shipment_master SET ${setClauses.join(', ')}
       WHERE org_id = $1 AND external_id = $2
       RETURNING *`,
      params,
    );
    if (rows.length === 0) return { ok: false, errors: ['not_found'], notFound: true };
    const after = rowToShipment(rows[0]);
    await events.record('shipment_master_status_transition', {
      orgId,
      actorEmailHash,
      entityType: 'shipment_master',
      entityId: externalId,
      before: { status: beforeShipment.status },
      after: { status: toStatus },
      detail: details || null,
    });
    return { ok: true, shipment: after };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'shipment transition failed');
  }
}

/**
 * Sparse-patch update for fields that are NOT the status. Status
 * changes always go through transitionShipmentStatus.
 *
 * @param {{ orgId: number, externalId: string, actorEmailHash: string, patch: Record<string, any> }} input
 */
async function updateShipment({ orgId, externalId, actorEmailHash, patch }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'] };
  }
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'status')) {
    return {
      ok: false,
      errors: ['status changes go through transitionShipmentStatus, not updateShipment'],
    };
  }
  if (!db.isConfigured()) return notConfigured();

  const before = await getShipmentByExternalId({ orgId, externalId });
  if (!before.ok) return before;
  const beforeShipment = /** @type {any} */ (before).shipment;

  /** @type {string[]} */
  const setClauses = [];
  /** @type {any[]} */
  const params = [orgId, externalId];
  /**
   * @param {string} col
   * @param {any} value
   */
  function addSet(col, value) {
    params.push(value);
    setClauses.push(`${col} = $${params.length}`);
  }
  if (patch.label !== undefined) addSet('label', String(patch.label));
  if (patch.goodsExternalId !== undefined) addSet('goods_external_id', patch.goodsExternalId || null);
  if (patch.supplierExternalId !== undefined) addSet('supplier_external_id', patch.supplierExternalId || null);
  if (patch.plannedDepartureDate !== undefined) addSet('planned_departure_date', patch.plannedDepartureDate || null);
  if (patch.plannedArrivalDate !== undefined) addSet('planned_arrival_date', patch.plannedArrivalDate || null);
  if (patch.customsValueCents !== undefined) addSet('customs_value_cents', patch.customsValueCents);
  if (patch.originCountry !== undefined) addSet('origin_country', patch.originCountry ? String(patch.originCountry).toUpperCase() : null);
  if (patch.destinationCountry !== undefined) addSet('destination_country', patch.destinationCountry ? String(patch.destinationCountry).toUpperCase() : null);
  if (patch.carrier !== undefined) addSet('carrier', patch.carrier || null);
  if (patch.bookingRef !== undefined) addSet('booking_ref', patch.bookingRef || null);
  if (patch.containerCount !== undefined) addSet('container_count', patch.containerCount);
  if (patch.weightKg !== undefined) addSet('weight_kg', patch.weightKg);
  if (patch.volumeCbm !== undefined) addSet('volume_cbm', patch.volumeCbm);
  if (patch.blNumber !== undefined) addSet('bl_number', patch.blNumber || null);
  if (patch.actualDepartureDate !== undefined) addSet('actual_departure_date', patch.actualDepartureDate || null);
  if (patch.eta !== undefined) addSet('eta', patch.eta || null);
  if (patch.lastKnownLocation !== undefined) addSet('last_known_location', patch.lastKnownLocation || null);
  if (patch.declarationRef !== undefined) addSet('declaration_ref', patch.declarationRef || null);
  if (patch.dutyPaidCents !== undefined) addSet('duty_paid_cents', patch.dutyPaidCents);
  if (patch.vatPaidCents !== undefined) addSet('vat_paid_cents', patch.vatPaidCents);
  if (patch.brokeragePaidCents !== undefined) addSet('brokerage_paid_cents', patch.brokeragePaidCents);
  if (patch.documentVault !== undefined) addSet('document_vault', JSON.stringify(patch.documentVault));
  if (patch.metadata !== undefined) addSet('metadata', JSON.stringify(patch.metadata));

  if (setClauses.length === 0) {
    return { ok: true, shipment: beforeShipment, unchanged: true };
  }
  setClauses.push(`updated_at = now()`);

  try {
    const rows = await db.query(
      `UPDATE shipment_master SET ${setClauses.join(', ')}
       WHERE org_id = $1 AND external_id = $2
       RETURNING *`,
      params,
    );
    if (rows.length === 0) return { ok: false, errors: ['not_found'], notFound: true };
    const after = rowToShipment(rows[0]);
    await events.record('shipment_master_updated', {
      orgId,
      actorEmailHash,
      entityType: 'shipment_master',
      entityId: externalId,
      before: beforeShipment,
      after,
    });
    return { ok: true, shipment: after };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'shipment update failed');
  }
}

/**
 * @param {{ orgId: number, externalId: string, actorEmailHash: string }} input
 */
async function archiveShipment({ orgId, externalId, actorEmailHash }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'] };
  }
  if (!db.isConfigured()) return notConfigured();
  const before = await getShipmentByExternalId({ orgId, externalId });
  if (!before.ok) return before;
  const beforeShipment = /** @type {any} */ (before).shipment;
  if (beforeShipment.archivedAt) {
    return { ok: true, shipment: beforeShipment, unchanged: true };
  }
  try {
    const rows = await db.query(
      `UPDATE shipment_master SET archived_at = now(), updated_at = now()
       WHERE org_id = $1 AND external_id = $2 AND archived_at IS NULL
       RETURNING *`,
      [orgId, externalId],
    );
    if (rows.length === 0) return { ok: false, errors: ['not_found'], notFound: true };
    const after = rowToShipment(rows[0]);
    await events.record('shipment_master_archived', {
      orgId,
      actorEmailHash,
      entityType: 'shipment_master',
      entityId: externalId,
      before: beforeShipment,
      after,
    });
    return { ok: true, shipment: after };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'shipment archive failed');
  }
}

// ── Exception queue (L1.5) ────────────────────────────────────────────
//
// All shipments where status='exception' AND archived_at IS NULL,
// sorted oldest-first (highest priority). Each row carries computed
// fields ops teams need but the underlying schema doesn't store:
//   - ageHours: hours since exception_state.openedAt
//   - acknowledged: bool, true iff exception_state.acknowledgedAt is set
//   - slaBreached: bool, true iff ageHours > SLA_THRESHOLD_HOURS for
//     un-acknowledged exceptions
//
// SLA_THRESHOLD_HOURS is intentionally a constant for v1 — per-org
// SLA configuration is a follow-up. 24h matches the standing internal
// commitment ops carries today (named in docs/strategic-plan-2026-2031.md
// §5.2 once SLAs are formalised).

const EXCEPTION_SLA_THRESHOLD_HOURS = 24;

/**
 * @param {{ orgId: number, limit?: number, includeAcknowledged?: boolean }} input
 */
async function listExceptionQueue({ orgId, limit = 200, includeAcknowledged = true }) {
  if (!Number.isInteger(orgId)) return { ok: false, errors: ['orgId required'] };
  if (!db.isConfigured()) return notConfigured();
  const cappedLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
  try {
    const rows = await db.query(
      `SELECT * FROM shipment_master
       WHERE org_id = $1 AND status = 'exception' AND archived_at IS NULL
       ORDER BY updated_at ASC
       LIMIT $2`,
      [orgId, cappedLimit],
    );
    const nowMs = Date.now();
    /** @type {any[]} */
    const queue = [];
    for (const row of rows) {
      const shipment = rowToShipment(row);
      if (!shipment) continue;
      const exc = shipment.exceptionState || {};
      const openedAtMs = exc.openedAt ? Date.parse(exc.openedAt) : NaN;
      const ageHours = Number.isFinite(openedAtMs) ? (nowMs - openedAtMs) / (60 * 60 * 1000) : null;
      const acknowledged = Boolean(exc.acknowledgedAt);
      if (acknowledged && !includeAcknowledged) continue;
      queue.push({
        ...shipment,
        _queue: {
          ageHours: ageHours == null ? null : Math.round(ageHours * 10) / 10,
          acknowledged,
          acknowledgedAt: exc.acknowledgedAt || null,
          acknowledgedBy: exc.acknowledgedBy || null,
          slaBreached: ageHours != null && !acknowledged && ageHours > EXCEPTION_SLA_THRESHOLD_HOURS,
          slaThresholdHours: EXCEPTION_SLA_THRESHOLD_HOURS,
        },
      });
    }
    return { ok: true, queue };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'exception queue read failed');
  }
}

/**
 * Acknowledge an open exception. Records the actor + optional note in
 * exception_state but does NOT change the shipment's status — the
 * shipment stays in 'exception' until it transitions out (recovery via
 * transitionShipmentStatus).
 *
 * Idempotent: acknowledging an already-acknowledged exception returns
 * { ok: true, unchanged: true } without emitting another audit event.
 *
 * @param {{ orgId: number, externalId: string, actorEmailHash: string, note?: string }} input
 */
async function acknowledgeException({ orgId, externalId, actorEmailHash, note }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'] };
  }
  if (!db.isConfigured()) return notConfigured();
  const before = await getShipmentByExternalId({ orgId, externalId });
  if (!before.ok) return before;
  const beforeShipment = /** @type {any} */ (before).shipment;
  if (beforeShipment.status !== 'exception') {
    return {
      ok: false,
      errors: [`cannot acknowledge — shipment is in status '${beforeShipment.status}', not 'exception'`],
      conflict: true,
    };
  }
  const prevState = beforeShipment.exceptionState || {};
  if (prevState.acknowledgedAt) {
    return { ok: true, shipment: beforeShipment, unchanged: true };
  }
  const nowIso = new Date().toISOString();
  const nextState = {
    ...prevState,
    acknowledgedAt: nowIso,
    acknowledgedBy: actorEmailHash,
    acknowledgmentNote: note ? String(note).slice(0, 500) : undefined,
  };
  try {
    const rows = await db.query(
      `UPDATE shipment_master SET exception_state = $3, updated_at = now()
       WHERE org_id = $1 AND external_id = $2
       RETURNING *`,
      [orgId, externalId, JSON.stringify(nextState)],
    );
    if (rows.length === 0) return { ok: false, errors: ['not_found'], notFound: true };
    const after = rowToShipment(rows[0]);
    await events.record('shipment_master_exception_acknowledged', {
      orgId,
      actorEmailHash,
      entityType: 'shipment_master',
      entityId: externalId,
      detail: { acknowledgedAt: nowIso, note: nextState.acknowledgmentNote || null },
    });
    return { ok: true, shipment: after };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'exception acknowledgement failed');
  }
}

module.exports = {
  createShipment,
  getShipmentByExternalId,
  listShipmentsForOrg,
  listExceptionQueue,
  transitionShipmentStatus,
  acknowledgeException,
  updateShipment,
  archiveShipment,
  STATUSES,
  TERMINAL_STATUSES,
  VALID_TRANSITIONS,
  EXCEPTION_SLA_THRESHOLD_HOURS,
  isLegalTransition,
  _rowToShipment: rowToShipment,
  _validateForCreate: validateForCreate,
  _generateShipmentId: generateShipmentId,
};
