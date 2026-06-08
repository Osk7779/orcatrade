// @ts-check
'use strict';

// Supplier master CRUD — L1.2 of docs/strategic-plan-2026-2031.md §4.1.2.
//
// PG-primary store (no KV mirror today); see schema-010-supplier-master.sql
// for the design rationale.
//
// Mirrors lib/db/goods.js's shape: validation-first, awaited audit log
// before success (ADR 0005), email-hash for the actor (ADR 0008),
// graceful 503 fallthrough when DATABASE_URL is unset.

const crypto = require('node:crypto');
const db = require('./client');
const events = require('../events');
const log = require('../log').withContext({ module: 'db-suppliers' });

const ISO2_RE = /^[A-Z]{2}$/;

// Closed taxonomies kept in sync with the CHECK constraints in
// schema-010-supplier-master.sql. Drift between code and SQL surfaces
// via the schema-constraint test that pins both values together.
const LEGAL_FORMS = Object.freeze([
  'llc', 'gmbh', 'sp_z_o_o', 'ltd', 'sa', 'kft', 'sarl', 'srl', 'sas',
  'inc', 'corp', 'oy', 'ab', 'as', 'bv', 'nv', 'plc', 'cooperative', 'other',
]);
const SANCTIONS_STATUSES = Object.freeze(['clear', 'potential_match', 'match', 'pending']);

function generateSupplierId() {
  return 'sp_' + crypto.randomBytes(8).toString('hex');
}

/**
 * @param {Record<string, any> | null | undefined} r
 */
function rowToSupplier(r) {
  if (!r) return null;
  return {
    id: r.id,
    externalId: r.external_id,
    orgId: r.org_id,
    createdByEmailHash: r.created_by_email_hash,
    entityName: r.entity_name,
    legalForm: r.legal_form,
    hqCountry: r.hq_country,
    registrationNumber: r.registration_number,
    registrationAuthority: r.registration_authority,
    website: r.website,
    primaryContactEmailHash: r.primary_contact_email_hash,
    factoryLocations: Array.isArray(r.factory_locations) ? r.factory_locations : [],
    sanctionsLastScreenedAt: r.sanctions_last_screened_at,
    sanctionsLastStatus: r.sanctions_last_status,
    sanctionsLastMatchSummary: (r.sanctions_last_match_summary && typeof r.sanctions_last_match_summary === 'object') ? r.sanctions_last_match_summary : {},
    auditCerts: Array.isArray(r.audit_certs) ? r.audit_certs : [],
    lastOnSiteAuditDate: r.last_on_site_audit_date,
    eudrDdsEvidence: (r.eudr_dds_evidence && typeof r.eudr_dds_evidence === 'object') ? r.eudr_dds_evidence : {},
    trustScore: r.trust_score == null ? null : Number(r.trust_score),
    trustScoreComputedAt: r.trust_score_computed_at,
    trustScoreComponents: (r.trust_score_components && typeof r.trust_score_components === 'object') ? r.trust_score_components : {},
    metadata: (r.metadata && typeof r.metadata === 'object') ? r.metadata : {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archivedAt: r.archived_at,
  };
}

// ── Validation ────────────────────────────────────────────────────────

/**
 * @param {Record<string, any>} input
 * @returns {string[]}
 */
function validateForCreate(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return ['input required'];

  if (!Number.isInteger(input.orgId) || input.orgId <= 0) errors.push('orgId required (positive integer)');
  if (!input.createdByEmailHash || typeof input.createdByEmailHash !== 'string') errors.push('createdByEmailHash required');

  if (!input.entityName || typeof input.entityName !== 'string') errors.push('entityName required');
  else if (input.entityName.length > 200) errors.push('entityName must be ≤200 chars');

  if (!input.hqCountry || !ISO2_RE.test(String(input.hqCountry).toUpperCase())) {
    errors.push('hqCountry required (ISO-2 uppercase)');
  }

  if (input.legalForm !== undefined && input.legalForm !== null) {
    if (!LEGAL_FORMS.includes(String(input.legalForm))) {
      errors.push(`legalForm must be one of: ${LEGAL_FORMS.join(', ')}`);
    }
  }

  if (input.registrationNumber !== undefined && input.registrationNumber !== null && input.registrationNumber !== '') {
    if (typeof input.registrationNumber !== 'string') errors.push('registrationNumber must be a string');
    else if (input.registrationNumber.length > 100) errors.push('registrationNumber must be ≤100 chars');
  }

  if (input.website !== undefined && input.website !== null && input.website !== '') {
    if (typeof input.website !== 'string') errors.push('website must be a string');
    else if (input.website.length > 500) errors.push('website must be ≤500 chars');
  }

  if (input.factoryLocations !== undefined && !Array.isArray(input.factoryLocations)) errors.push('factoryLocations must be an array');
  if (input.auditCerts !== undefined && !Array.isArray(input.auditCerts)) errors.push('auditCerts must be an array');
  if (input.eudrDdsEvidence !== undefined && (typeof input.eudrDdsEvidence !== 'object' || Array.isArray(input.eudrDdsEvidence))) {
    errors.push('eudrDdsEvidence must be an object');
  }
  if (input.metadata !== undefined && (typeof input.metadata !== 'object' || Array.isArray(input.metadata))) {
    errors.push('metadata must be an object');
  }

  return errors;
}

/**
 * @param {Record<string, any>} input
 * @returns {string[]}
 */
function validateForUpdate(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return ['input required'];
  // Sparse patch — validate present fields only.
  if (input.entityName !== undefined) {
    if (typeof input.entityName !== 'string' || !input.entityName) errors.push('entityName must be a non-empty string');
    else if (input.entityName.length > 200) errors.push('entityName must be ≤200 chars');
  }
  if (input.hqCountry !== undefined && !ISO2_RE.test(String(input.hqCountry).toUpperCase())) {
    errors.push('hqCountry must be ISO-2 uppercase');
  }
  if (input.legalForm !== undefined && input.legalForm !== null && !LEGAL_FORMS.includes(String(input.legalForm))) {
    errors.push(`legalForm must be one of: ${LEGAL_FORMS.join(', ')}`);
  }
  if (input.sanctionsLastStatus !== undefined && input.sanctionsLastStatus !== null && !SANCTIONS_STATUSES.includes(String(input.sanctionsLastStatus))) {
    errors.push(`sanctionsLastStatus must be one of: ${SANCTIONS_STATUSES.join(', ')}`);
  }
  if (input.trustScore !== undefined && input.trustScore !== null) {
    if (!Number.isInteger(input.trustScore) || input.trustScore < 0 || input.trustScore > 100) {
      errors.push('trustScore must be an integer 0-100');
    }
  }
  if (input.factoryLocations !== undefined && !Array.isArray(input.factoryLocations)) errors.push('factoryLocations must be an array');
  if (input.auditCerts !== undefined && !Array.isArray(input.auditCerts)) errors.push('auditCerts must be an array');
  if (input.eudrDdsEvidence !== undefined && (typeof input.eudrDdsEvidence !== 'object' || Array.isArray(input.eudrDdsEvidence))) {
    errors.push('eudrDdsEvidence must be an object');
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
 */
function failureFromDb(message) {
  if (/duplicate key value violates unique constraint.*supplier_master_org_regnumber_active_uidx/i.test(message)) {
    return { ok: false, errors: ['registrationNumber already exists for this org'], conflict: true };
  }
  if (/violates check constraint.*supplier_master_hq_country_format/i.test(message)) {
    return { ok: false, errors: ['hqCountry must be ISO-2 uppercase'] };
  }
  if (/violates check constraint.*supplier_master_legal_form_check/i.test(message)) {
    return { ok: false, errors: [`legalForm must be one of: ${LEGAL_FORMS.join(', ')}`] };
  }
  if (/violates check constraint.*supplier_master_sanctions_status_check/i.test(message)) {
    return { ok: false, errors: [`sanctionsLastStatus must be one of: ${SANCTIONS_STATUSES.join(', ')}`] };
  }
  if (/violates check constraint.*supplier_master_trust_score_bounds/i.test(message)) {
    return { ok: false, errors: ['trustScore must be an integer 0-100'] };
  }
  return { ok: false, errors: [message] };
}

// ── CRUD ──────────────────────────────────────────────────────────────

/**
 * @param {Record<string, any>} input
 */
async function createSupplier(input) {
  const errors = validateForCreate(input);
  if (errors.length) return { ok: false, errors };
  if (!db.isConfigured()) return notConfigured();

  const externalId = generateSupplierId();
  const hqCountry = String(input.hqCountry).toUpperCase();
  try {
    const rows = await db.query(
      `INSERT INTO supplier_master (
        external_id, org_id, created_by_email_hash,
        entity_name, legal_form, hq_country, registration_number, registration_authority,
        website, primary_contact_email_hash,
        factory_locations, audit_certs, last_on_site_audit_date,
        eudr_dds_evidence, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *`,
      [
        externalId,
        input.orgId,
        input.createdByEmailHash,
        input.entityName,
        input.legalForm || null,
        hqCountry,
        input.registrationNumber || null,
        input.registrationAuthority || null,
        input.website || null,
        input.primaryContactEmailHash || null,
        JSON.stringify(input.factoryLocations || []),
        JSON.stringify(input.auditCerts || []),
        input.lastOnSiteAuditDate || null,
        JSON.stringify(input.eudrDdsEvidence || {}),
        JSON.stringify(input.metadata || {}),
      ],
    );
    const supplier = rowToSupplier(rows[0]);
    // ADR 0005: await the audit-log write before returning success.
    await events.record('supplier_master_created', {
      orgId: input.orgId,
      actorEmailHash: input.createdByEmailHash,
      entityType: 'supplier_master',
      entityId: externalId,
      after: supplier,
    });
    return { ok: true, supplier };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'supplier create failed';
    log.warn('createSupplier failed', { err: message });
    return failureFromDb(message);
  }
}

/**
 * @param {{ orgId: number, externalId: string }} input
 */
async function getSupplierByExternalId({ orgId, externalId }) {
  if (!Number.isInteger(orgId) || !externalId) return { ok: false, errors: ['orgId + externalId required'] };
  if (!db.isConfigured()) return notConfigured();
  try {
    const rows = await db.query(
      `SELECT * FROM supplier_master WHERE org_id = $1 AND external_id = $2`,
      [orgId, externalId],
    );
    if (rows.length === 0) return { ok: false, errors: ['not_found'], notFound: true };
    return { ok: true, supplier: rowToSupplier(rows[0]) };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'supplier read failed');
  }
}

/**
 * @param {{ orgId: number, includeArchived?: boolean, limit?: number, hqCountry?: string }} input
 */
async function listSuppliersForOrg({ orgId, includeArchived = false, limit = 200, hqCountry }) {
  if (!Number.isInteger(orgId)) return { ok: false, errors: ['orgId required'] };
  if (!db.isConfigured()) return notConfigured();
  const cappedLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
  /** @type {string[]} */
  const where = ['org_id = $1'];
  /** @type {any[]} */
  const params = [orgId];
  if (!includeArchived) where.push('archived_at IS NULL');
  if (hqCountry) {
    if (!ISO2_RE.test(String(hqCountry).toUpperCase())) return { ok: false, errors: ['hqCountry must be ISO-2'] };
    params.push(String(hqCountry).toUpperCase());
    where.push(`hq_country = $${params.length}`);
  }
  params.push(cappedLimit);
  try {
    const rows = await db.query(
      `SELECT * FROM supplier_master WHERE ${where.join(' AND ')}
       ORDER BY updated_at DESC LIMIT $${params.length}`,
      params,
    );
    return { ok: true, suppliers: rows.map(rowToSupplier) };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'supplier list failed');
  }
}

/**
 * @param {{ orgId: number, externalId: string, actorEmailHash: string, patch: Record<string, any> }} input
 */
async function updateSupplier({ orgId, externalId, actorEmailHash, patch }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'] };
  }
  const errors = validateForUpdate(patch);
  if (errors.length) return { ok: false, errors };
  if (!db.isConfigured()) return notConfigured();

  const before = await getSupplierByExternalId({ orgId, externalId });
  if (!before.ok) return before;
  const beforeSupplier = /** @type {any} */ (before).supplier;

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
  if (patch.entityName !== undefined) addSet('entity_name', String(patch.entityName));
  if (patch.legalForm !== undefined) addSet('legal_form', patch.legalForm || null);
  if (patch.hqCountry !== undefined) addSet('hq_country', String(patch.hqCountry).toUpperCase());
  if (patch.registrationNumber !== undefined) addSet('registration_number', patch.registrationNumber || null);
  if (patch.registrationAuthority !== undefined) addSet('registration_authority', patch.registrationAuthority || null);
  if (patch.website !== undefined) addSet('website', patch.website || null);
  if (patch.primaryContactEmailHash !== undefined) addSet('primary_contact_email_hash', patch.primaryContactEmailHash || null);
  if (patch.factoryLocations !== undefined) addSet('factory_locations', JSON.stringify(patch.factoryLocations));
  if (patch.sanctionsLastScreenedAt !== undefined) addSet('sanctions_last_screened_at', patch.sanctionsLastScreenedAt);
  if (patch.sanctionsLastStatus !== undefined) addSet('sanctions_last_status', patch.sanctionsLastStatus);
  if (patch.sanctionsLastMatchSummary !== undefined) addSet('sanctions_last_match_summary', JSON.stringify(patch.sanctionsLastMatchSummary));
  if (patch.auditCerts !== undefined) addSet('audit_certs', JSON.stringify(patch.auditCerts));
  if (patch.lastOnSiteAuditDate !== undefined) addSet('last_on_site_audit_date', patch.lastOnSiteAuditDate);
  if (patch.eudrDdsEvidence !== undefined) addSet('eudr_dds_evidence', JSON.stringify(patch.eudrDdsEvidence));
  if (patch.trustScore !== undefined) addSet('trust_score', patch.trustScore);
  if (patch.trustScoreComputedAt !== undefined) addSet('trust_score_computed_at', patch.trustScoreComputedAt);
  if (patch.trustScoreComponents !== undefined) addSet('trust_score_components', JSON.stringify(patch.trustScoreComponents));
  if (patch.metadata !== undefined) addSet('metadata', JSON.stringify(patch.metadata));

  if (setClauses.length === 0) {
    return { ok: true, supplier: beforeSupplier, unchanged: true };
  }
  setClauses.push(`updated_at = now()`);

  try {
    const rows = await db.query(
      `UPDATE supplier_master SET ${setClauses.join(', ')}
       WHERE org_id = $1 AND external_id = $2
       RETURNING *`,
      params,
    );
    if (rows.length === 0) return { ok: false, errors: ['not_found'], notFound: true };
    const after = rowToSupplier(rows[0]);
    await events.record('supplier_master_updated', {
      orgId,
      actorEmailHash,
      entityType: 'supplier_master',
      entityId: externalId,
      before: beforeSupplier,
      after,
    });
    return { ok: true, supplier: after };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'supplier update failed');
  }
}

/**
 * @param {{ orgId: number, externalId: string, actorEmailHash: string }} input
 */
async function archiveSupplier({ orgId, externalId, actorEmailHash }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'] };
  }
  if (!db.isConfigured()) return notConfigured();
  const before = await getSupplierByExternalId({ orgId, externalId });
  if (!before.ok) return before;
  const beforeSupplier = /** @type {any} */ (before).supplier;
  if (beforeSupplier.archivedAt) {
    return { ok: true, supplier: beforeSupplier, unchanged: true };
  }
  try {
    const rows = await db.query(
      `UPDATE supplier_master SET archived_at = now(), updated_at = now()
       WHERE org_id = $1 AND external_id = $2 AND archived_at IS NULL
       RETURNING *`,
      [orgId, externalId],
    );
    if (rows.length === 0) return { ok: false, errors: ['not_found'], notFound: true };
    const after = rowToSupplier(rows[0]);
    await events.record('supplier_master_archived', {
      orgId,
      actorEmailHash,
      entityType: 'supplier_master',
      entityId: externalId,
      before: beforeSupplier,
      after,
    });
    return { ok: true, supplier: after };
  } catch (err) {
    return failureFromDb(err instanceof Error ? err.message : 'supplier archive failed');
  }
}

module.exports = {
  createSupplier,
  getSupplierByExternalId,
  listSuppliersForOrg,
  updateSupplier,
  archiveSupplier,
  LEGAL_FORMS,
  SANCTIONS_STATUSES,
  // Exposed for tests
  _rowToSupplier: rowToSupplier,
  _validateForCreate: validateForCreate,
  _validateForUpdate: validateForUpdate,
  _generateSupplierId: generateSupplierId,
};
