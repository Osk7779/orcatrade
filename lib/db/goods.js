// @ts-check
'use strict';

// Goods master CRUD — L1.1 of docs/strategic-plan-2026-2031.md §4.1.2.
//
// PG-primary store (no KV mirror today); see schema-009-goods-master.sql
// for the design rationale.
//
// Every mutation:
//   1. Validates input synchronously (returns 4xx-shaped errors)
//   2. Writes to Postgres (returns 5xx-shaped errors on driver failure)
//   3. **Awaits the audit-log write before returning success** (ADR 0005)
//
// Privacy: row.created_by_email_hash, never raw email (ADR 0008).
// Money: typical_unit_value_cents is integer cents (ADR 0004).
//
// When DATABASE_URL is not set (test env, dev without Neon), every
// operation returns { ok: false, errors: ['Postgres not configured'] }
// rather than throwing. Handlers translate to 503.

const crypto = require('node:crypto');
const db = require('./client');
const events = require('../events');
const log = require('../log').withContext({ module: 'db-goods' });

const HS_RE = /^[0-9]{6,10}$/;
const ISO2_RE = /^[A-Z]{2}$/;

function generateGoodsId() {
  return 'gd_' + crypto.randomBytes(8).toString('hex');
}

/**
 * Row → public object. Maps snake_case to camelCase; preserves jsonb
 * fields as parsed objects (Neon driver auto-parses jsonb columns).
 * @param {Record<string, any> | null | undefined} r
 */
function rowToGoods(r) {
  if (!r) return null;
  return {
    id: r.id,
    externalId: r.external_id,
    orgId: r.org_id,
    createdByEmailHash: r.created_by_email_hash,
    sku: r.sku,
    displayName: r.display_name,
    hsCode: r.hs_code,
    originCountry: r.origin_country,
    typicalUnitValueCents: r.typical_unit_value_cents == null ? null : Number(r.typical_unit_value_cents),
    cbamInScope: r.cbam_in_scope === true,
    reachSvhcFlags: Array.isArray(r.reach_svhc_flags) ? r.reach_svhc_flags : [],
    restrictedSubstances: (r.restricted_substances && typeof r.restricted_substances === 'object') ? r.restricted_substances : {},
    metadata: (r.metadata && typeof r.metadata === 'object') ? r.metadata : {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archivedAt: r.archived_at,
  };
}

// ── Validation ────────────────────────────────────────────────────────

/**
 * @param {*} input
 * @returns {string[]} list of error messages; empty = OK
 */
function validateForCreate(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return ['input required'];

  if (!Number.isInteger(input.orgId) || input.orgId <= 0) errors.push('orgId required (positive integer)');
  if (!input.createdByEmailHash || typeof input.createdByEmailHash !== 'string') errors.push('createdByEmailHash required');

  if (!input.sku || typeof input.sku !== 'string') errors.push('sku required');
  else if (input.sku.length > 100) errors.push('sku must be ≤100 chars');
  else if (!/^\S/.test(input.sku) || !/\S$/.test(input.sku)) errors.push('sku must not have leading/trailing whitespace');

  if (!input.displayName || typeof input.displayName !== 'string') errors.push('displayName required');
  else if (input.displayName.length > 200) errors.push('displayName must be ≤200 chars');

  if (!input.hsCode || !HS_RE.test(String(input.hsCode))) errors.push('hsCode required (6-10 digit numeric string)');

  if (input.originCountry != null && input.originCountry !== '') {
    if (!ISO2_RE.test(String(input.originCountry).toUpperCase())) errors.push('originCountry must be ISO-2 uppercase');
  }

  if (input.typicalUnitValueCents != null) {
    if (!Number.isInteger(input.typicalUnitValueCents) || input.typicalUnitValueCents < 0) {
      errors.push('typicalUnitValueCents must be a non-negative integer');
    }
  }

  if (input.reachSvhcFlags != null && !Array.isArray(input.reachSvhcFlags)) errors.push('reachSvhcFlags must be an array');
  if (input.restrictedSubstances != null && (typeof input.restrictedSubstances !== 'object' || Array.isArray(input.restrictedSubstances))) {
    errors.push('restrictedSubstances must be an object');
  }
  if (input.metadata != null && (typeof input.metadata !== 'object' || Array.isArray(input.metadata))) {
    errors.push('metadata must be an object');
  }

  return errors;
}

/**
 * @param {*} input
 * @returns {string[]}
 */
function validateForUpdate(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return ['input required'];
  // Update is sparse: every field is optional. We validate types only when present.
  if (input.displayName !== undefined) {
    if (typeof input.displayName !== 'string' || !input.displayName) errors.push('displayName must be a non-empty string');
    else if (input.displayName.length > 200) errors.push('displayName must be ≤200 chars');
  }
  if (input.hsCode !== undefined && !HS_RE.test(String(input.hsCode))) errors.push('hsCode must be 6-10 digits');
  if (input.originCountry !== undefined && input.originCountry !== null && input.originCountry !== '') {
    if (!ISO2_RE.test(String(input.originCountry).toUpperCase())) errors.push('originCountry must be ISO-2 uppercase');
  }
  if (input.typicalUnitValueCents !== undefined && input.typicalUnitValueCents !== null) {
    if (!Number.isInteger(input.typicalUnitValueCents) || input.typicalUnitValueCents < 0) {
      errors.push('typicalUnitValueCents must be a non-negative integer');
    }
  }
  if (input.cbamInScope !== undefined && typeof input.cbamInScope !== 'boolean') errors.push('cbamInScope must be boolean');
  if (input.reachSvhcFlags !== undefined && !Array.isArray(input.reachSvhcFlags)) errors.push('reachSvhcFlags must be an array');
  if (input.restrictedSubstances !== undefined && (typeof input.restrictedSubstances !== 'object' || Array.isArray(input.restrictedSubstances))) {
    errors.push('restrictedSubstances must be an object');
  }
  if (input.metadata !== undefined && (typeof input.metadata !== 'object' || Array.isArray(input.metadata))) {
    errors.push('metadata must be an object');
  }
  return errors;
}

// ── Helpers ───────────────────────────────────────────────────────────

function notConfigured() {
  return { ok: false, errors: ['Postgres not configured (DATABASE_URL missing)'] };
}

/**
 * @param {string} message
 * @returns {{ ok: false, errors: string[], conflict?: true }}
 */
function failureFromDb(message) {
  // Postgres duplicate-key error on the partial unique index → SKU clash.
  if (/duplicate key value violates unique constraint.*goods_master_org_sku_active_uidx/i.test(message)) {
    return { ok: false, errors: ['sku already exists for this org'], conflict: true };
  }
  if (/violates check constraint.*goods_master_hs_code_format/i.test(message)) {
    return { ok: false, errors: ['hsCode must be 6-10 digits'] };
  }
  if (/violates check constraint.*goods_master_origin_country_format/i.test(message)) {
    return { ok: false, errors: ['originCountry must be ISO-2 uppercase'] };
  }
  return { ok: false, errors: [message] };
}

// ── CRUD ──────────────────────────────────────────────────────────────

/**
 * @param {Record<string, any>} input
 */
async function createGoods(input) {
  const errors = validateForCreate(input);
  if (errors.length) return { ok: false, errors };
  if (!db.isConfigured()) return notConfigured();

  const externalId = generateGoodsId();
  const originCountry = input.originCountry ? String(input.originCountry).toUpperCase() : null;
  try {
    const rows = await db.query(
      `INSERT INTO goods_master (
        external_id, org_id, created_by_email_hash, sku, display_name,
        hs_code, origin_country, typical_unit_value_cents, cbam_in_scope,
        reach_svhc_flags, restricted_substances, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
      [
        externalId,
        input.orgId,
        input.createdByEmailHash,
        input.sku,
        input.displayName,
        String(input.hsCode),
        originCountry,
        input.typicalUnitValueCents == null ? null : input.typicalUnitValueCents,
        Boolean(input.cbamInScope),
        JSON.stringify(input.reachSvhcFlags || []),
        JSON.stringify(input.restrictedSubstances || {}),
        JSON.stringify(input.metadata || {}),
      ],
    );
    const goods = rowToGoods(rows[0]);
    // ADR 0005: audit-log BEFORE returning success. A throw here surfaces
    // as a 5xx; we never silently swallow.
    await events.record('goods_master_created', {
      orgId: input.orgId,
      actorEmailHash: input.createdByEmailHash,
      entityType: 'goods_master',
      entityId: externalId,
      after: goods,
    });
    return { ok: true, goods };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'goods create failed';
    log.warn('createGoods failed', { err: message });
    return failureFromDb(message);
  }
}

/**
 * @param {{ orgId: number, externalId: string }} input
 */
async function getGoodsByExternalId({ orgId, externalId }) {
  if (!db.isConfigured()) return notConfigured();
  if (!Number.isInteger(orgId) || !externalId) return { ok: false, errors: ['orgId + externalId required'] };
  try {
    const rows = await db.query(
      `SELECT * FROM goods_master WHERE org_id = $1 AND external_id = $2`,
      [orgId, externalId],
    );
    if (rows.length === 0) return { ok: false, errors: ['not_found'], notFound: true };
    return { ok: true, goods: rowToGoods(rows[0]) };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'goods read failed');
  }
}

/**
 * @param {{ orgId: number, includeArchived?: boolean, limit?: number }} input
 */
async function listGoodsForOrg({ orgId, includeArchived = false, limit = 200 }) {
  if (!db.isConfigured()) return notConfigured();
  if (!Number.isInteger(orgId)) return { ok: false, errors: ['orgId required'] };
  const cappedLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
  try {
    const rows = await db.query(
      includeArchived
        ? `SELECT * FROM goods_master WHERE org_id = $1 ORDER BY updated_at DESC LIMIT $2`
        : `SELECT * FROM goods_master WHERE org_id = $1 AND archived_at IS NULL ORDER BY updated_at DESC LIMIT $2`,
      [orgId, cappedLimit],
    );
    return { ok: true, goods: rows.map(rowToGoods) };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'goods list failed');
  }
}

/**
 * @param {{ orgId: number, externalId: string, actorEmailHash: string, patch: Record<string, any> }} input
 */
async function updateGoods({ orgId, externalId, actorEmailHash, patch }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'] };
  }
  const errors = validateForUpdate(patch);
  if (errors.length) return { ok: false, errors };
  if (!db.isConfigured()) return notConfigured();

  // Fetch the BEFORE row first so the audit-log diff is complete.
  const before = await getGoodsByExternalId({ orgId, externalId });
  if (!before.ok) return before;
  // `ok: true` narrows .goods to non-undefined; the inline `any` cast is a
  // typecheck affordance — TS can't narrow our union via the boolean `ok`
  // flag, but the runtime invariant holds.
  const beforeGoods = /** @type {any} */ (before).goods;

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
  if (patch.displayName !== undefined) addSet('display_name', String(patch.displayName));
  if (patch.hsCode !== undefined) addSet('hs_code', String(patch.hsCode));
  if (patch.originCountry !== undefined) addSet('origin_country', patch.originCountry == null || patch.originCountry === '' ? null : String(patch.originCountry).toUpperCase());
  if (patch.typicalUnitValueCents !== undefined) addSet('typical_unit_value_cents', patch.typicalUnitValueCents);
  if (patch.cbamInScope !== undefined) addSet('cbam_in_scope', Boolean(patch.cbamInScope));
  if (patch.reachSvhcFlags !== undefined) addSet('reach_svhc_flags', JSON.stringify(patch.reachSvhcFlags));
  if (patch.restrictedSubstances !== undefined) addSet('restricted_substances', JSON.stringify(patch.restrictedSubstances));
  if (patch.metadata !== undefined) addSet('metadata', JSON.stringify(patch.metadata));

  if (setClauses.length === 0) {
    // No-op update — return the existing row without touching the DB or audit log.
    return { ok: true, goods: beforeGoods, unchanged: true };
  }
  setClauses.push(`updated_at = now()`);

  try {
    const rows = await db.query(
      `UPDATE goods_master SET ${setClauses.join(', ')}
       WHERE org_id = $1 AND external_id = $2
       RETURNING *`,
      params,
    );
    if (rows.length === 0) return { ok: false, errors: ['not_found'], notFound: true };
    const after = rowToGoods(rows[0]);
    await events.record('goods_master_updated', {
      orgId,
      actorEmailHash,
      entityType: 'goods_master',
      entityId: externalId,
      before: beforeGoods,
      after,
    });
    return { ok: true, goods: after };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'goods update failed');
  }
}

/**
 * @param {{ orgId: number, externalId: string, actorEmailHash: string }} input
 */
async function archiveGoods({ orgId, externalId, actorEmailHash }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'] };
  }
  if (!db.isConfigured()) return notConfigured();
  const before = await getGoodsByExternalId({ orgId, externalId });
  if (!before.ok) return before;
  const beforeGoods = /** @type {any} */ (before).goods;
  if (beforeGoods.archivedAt) {
    // Idempotent: already archived → success, no audit-log event.
    return { ok: true, goods: beforeGoods, unchanged: true };
  }
  try {
    const rows = await db.query(
      `UPDATE goods_master SET archived_at = now(), updated_at = now()
       WHERE org_id = $1 AND external_id = $2 AND archived_at IS NULL
       RETURNING *`,
      [orgId, externalId],
    );
    if (rows.length === 0) return { ok: false, errors: ['not_found'], notFound: true };
    const after = rowToGoods(rows[0]);
    await events.record('goods_master_archived', {
      orgId,
      actorEmailHash,
      entityType: 'goods_master',
      entityId: externalId,
      before: beforeGoods,
      after,
    });
    return { ok: true, goods: after };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'goods archive failed');
  }
}

module.exports = {
  createGoods,
  getGoodsByExternalId,
  listGoodsForOrg,
  updateGoods,
  archiveGoods,
  // Exposed for unit tests
  _rowToGoods: rowToGoods,
  _validateForCreate: validateForCreate,
  _validateForUpdate: validateForUpdate,
  _generateGoodsId: generateGoodsId,
};
