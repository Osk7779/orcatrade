'use strict';

// Supplier master data-layer tests. Same shape as test/db-goods.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const suppliers = require(path.join(ROOT, 'lib', 'db', 'suppliers'));

// ── _generateSupplierId ───────────────────────────────────────────────

test('_generateSupplierId emits 16-hex ids with the "sp_" prefix', () => {
  for (let i = 0; i < 5; i++) {
    const id = suppliers._generateSupplierId();
    assert.match(id, /^sp_[a-f0-9]{16}$/);
  }
});

test('_generateSupplierId is unique across many calls (sanity)', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(suppliers._generateSupplierId());
  assert.equal(seen.size, 200);
});

// ── _validateForCreate ────────────────────────────────────────────────

const VALID_CREATE = Object.freeze({
  orgId: 42,
  createdByEmailHash: 'aabbccdd11223344',
  entityName: 'Shenzhen Lighting Co., Ltd.',
  legalForm: 'ltd',
  hqCountry: 'CN',
  registrationNumber: '914403007654321XYZ',
  registrationAuthority: 'SAIC',
  website: 'https://example.cn',
  factoryLocations: [{ countryCode: 'CN', city: 'Shenzhen', role: 'manufacturing' }],
  auditCerts: [{ standard: 'iso_9001', issuer: 'SGS', issuedAt: '2025-01-15', expiresAt: '2028-01-15' }],
  eudrDdsEvidence: {},
  metadata: {},
});

test('_validateForCreate returns no errors on a well-formed input', () => {
  assert.deepEqual(suppliers._validateForCreate(VALID_CREATE), []);
});

test('_validateForCreate rejects null / non-object input', () => {
  assert.deepEqual(suppliers._validateForCreate(null), ['input required']);
});

test('_validateForCreate requires entityName + hqCountry', () => {
  assert.ok(suppliers._validateForCreate({ ...VALID_CREATE, entityName: '' }).some((e) => /entityName/.test(e)));
  assert.ok(suppliers._validateForCreate({ ...VALID_CREATE, hqCountry: '' }).some((e) => /hqCountry/.test(e)));
});

test('_validateForCreate rejects malformed hqCountry', () => {
  assert.ok(suppliers._validateForCreate({ ...VALID_CREATE, hqCountry: 'CHN' }).some((e) => /ISO-2/.test(e)));
  assert.ok(suppliers._validateForCreate({ ...VALID_CREATE, hqCountry: 'C1' }).some((e) => /ISO-2/.test(e)));
});

test('_validateForCreate accepts lowercase hqCountry (normalised at write time)', () => {
  assert.deepEqual(suppliers._validateForCreate({ ...VALID_CREATE, hqCountry: 'cn' }), []);
});

test('_validateForCreate rejects legalForm outside the closed taxonomy', () => {
  assert.ok(suppliers._validateForCreate({ ...VALID_CREATE, legalForm: 'partnership' }).some((e) => /legalForm/.test(e)));
});

test('_validateForCreate accepts every legalForm in the taxonomy', () => {
  for (const lf of suppliers.LEGAL_FORMS) {
    assert.deepEqual(suppliers._validateForCreate({ ...VALID_CREATE, legalForm: lf }), [], `legalForm "${lf}" must validate`);
  }
});

test('_validateForCreate rejects malformed factoryLocations / auditCerts / metadata', () => {
  assert.ok(suppliers._validateForCreate({ ...VALID_CREATE, factoryLocations: 'not-an-array' }).some((e) => /factoryLocations/.test(e)));
  assert.ok(suppliers._validateForCreate({ ...VALID_CREATE, auditCerts: 'no' }).some((e) => /auditCerts/.test(e)));
  assert.ok(suppliers._validateForCreate({ ...VALID_CREATE, eudrDdsEvidence: [] }).some((e) => /eudrDdsEvidence/.test(e)));
  assert.ok(suppliers._validateForCreate({ ...VALID_CREATE, metadata: [] }).some((e) => /metadata/.test(e)));
});

test('_validateForCreate enforces registrationNumber bounds', () => {
  assert.ok(suppliers._validateForCreate({ ...VALID_CREATE, registrationNumber: 'x'.repeat(101) }).some((e) => /registrationNumber/.test(e)));
});

// ── _validateForUpdate ────────────────────────────────────────────────

test('_validateForUpdate accepts an empty patch', () => {
  assert.deepEqual(suppliers._validateForUpdate({}), []);
});

test('_validateForUpdate rejects sanctionsLastStatus outside the closed taxonomy', () => {
  assert.ok(suppliers._validateForUpdate({ sanctionsLastStatus: 'maybe' }).some((e) => /sanctionsLastStatus/.test(e)));
});

test('_validateForUpdate accepts every sanctionsLastStatus in the taxonomy', () => {
  for (const status of suppliers.SANCTIONS_STATUSES) {
    assert.deepEqual(suppliers._validateForUpdate({ sanctionsLastStatus: status }), []);
  }
});

test('_validateForUpdate enforces trustScore bounds (0-100 integer)', () => {
  assert.ok(suppliers._validateForUpdate({ trustScore: -1 }).some((e) => /trustScore/.test(e)));
  assert.ok(suppliers._validateForUpdate({ trustScore: 101 }).some((e) => /trustScore/.test(e)));
  assert.ok(suppliers._validateForUpdate({ trustScore: 50.5 }).some((e) => /trustScore/.test(e)));
  assert.deepEqual(suppliers._validateForUpdate({ trustScore: 0 }), []);
  assert.deepEqual(suppliers._validateForUpdate({ trustScore: 100 }), []);
});

// ── _rowToSupplier ────────────────────────────────────────────────────

test('_rowToSupplier maps snake_case columns to camelCase', () => {
  const row = {
    id: 1, external_id: 'sp_abc', org_id: 7, created_by_email_hash: 'aaa',
    entity_name: 'X Co.', legal_form: 'ltd', hq_country: 'CN',
    registration_number: '914', registration_authority: 'SAIC', website: 'https://x',
    primary_contact_email_hash: 'bbb',
    factory_locations: [{ city: 'SZX' }],
    sanctions_last_screened_at: '2026-06-08T00:00:00Z',
    sanctions_last_status: 'clear',
    sanctions_last_match_summary: { hits: 0 },
    audit_certs: [{ standard: 'iso_9001' }],
    last_on_site_audit_date: '2026-04-15',
    eudr_dds_evidence: { geolocationProof: 'attached' },
    trust_score: '85',
    trust_score_computed_at: '2026-06-08T00:00:00Z',
    trust_score_components: { sanctions: 30, audits: 30, history: 25 },
    metadata: { tag: 'pilot' },
    created_at: '2026-06-08T00:00:00Z', updated_at: '2026-06-08T00:00:00Z', archived_at: null,
  };
  const obj = suppliers._rowToSupplier(row);
  assert.equal(obj.entityName, 'X Co.');
  assert.equal(obj.hqCountry, 'CN');
  assert.equal(obj.legalForm, 'ltd');
  assert.equal(obj.sanctionsLastStatus, 'clear');
  assert.deepEqual(obj.factoryLocations, [{ city: 'SZX' }]);
  assert.equal(obj.trustScore, 85, 'smallint string must be converted to Number');
  assert.deepEqual(obj.trustScoreComponents, { sanctions: 30, audits: 30, history: 25 });
});

test('_rowToSupplier returns null on null input', () => {
  assert.equal(suppliers._rowToSupplier(null), null);
});

test('_rowToSupplier normalises null jsonb to safe defaults', () => {
  const row = {
    id: 1, external_id: 'sp_x', org_id: 1, created_by_email_hash: 'x',
    entity_name: 'X', legal_form: null, hq_country: 'CN',
    registration_number: null, registration_authority: null, website: null,
    primary_contact_email_hash: null,
    factory_locations: null, sanctions_last_screened_at: null, sanctions_last_status: null,
    sanctions_last_match_summary: null, audit_certs: null, last_on_site_audit_date: null,
    eudr_dds_evidence: null, trust_score: null, trust_score_computed_at: null,
    trust_score_components: null, metadata: null,
    created_at: '2026', updated_at: '2026', archived_at: null,
  };
  const obj = suppliers._rowToSupplier(row);
  assert.deepEqual(obj.factoryLocations, []);
  assert.deepEqual(obj.auditCerts, []);
  assert.deepEqual(obj.eudrDdsEvidence, {});
  assert.deepEqual(obj.trustScoreComponents, {});
  assert.deepEqual(obj.metadata, {});
  assert.equal(obj.trustScore, null);
});

// ── 503 path: every CRUD operation when PG unconfigured ───────────────

test('createSupplier returns "Postgres not configured" when DATABASE_URL is unset', async () => {
  const r = await suppliers.createSupplier(VALID_CREATE);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Postgres not configured/i);
});

test('getSupplierByExternalId returns "Postgres not configured" when DATABASE_URL is unset', async () => {
  const r = await suppliers.getSupplierByExternalId({ orgId: 1, externalId: 'sp_x' });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Postgres not configured/i);
});

test('listSuppliersForOrg returns "Postgres not configured" when DATABASE_URL is unset', async () => {
  const r = await suppliers.listSuppliersForOrg({ orgId: 1 });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Postgres not configured/i);
});

test('updateSupplier returns "Postgres not configured" when DATABASE_URL is unset', async () => {
  const r = await suppliers.updateSupplier({
    orgId: 1, externalId: 'sp_x', actorEmailHash: 'h', patch: { entityName: 'new' },
  });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Postgres not configured/i);
});

test('archiveSupplier returns "Postgres not configured" when DATABASE_URL is unset', async () => {
  const r = await suppliers.archiveSupplier({ orgId: 1, externalId: 'sp_x', actorEmailHash: 'h' });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Postgres not configured/i);
});

// ── Validation precedes 503 ───────────────────────────────────────────

test('createSupplier surfaces a 400-shaped validation error even when PG is unconfigured', async () => {
  const r = await suppliers.createSupplier({ ...VALID_CREATE, hqCountry: 'XYZ' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /hqCountry/.test(e)));
  assert.ok(!r.errors.some((e) => /Postgres/.test(e)));
});

// ── Schema-code parity (LEGAL_FORMS + SANCTIONS_STATUSES match SQL CHECK constraints) ─

test('schema-010-supplier-master.sql is discoverable + idempotent + carries CHECK constraints', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'schema-010-supplier-master.sql'), 'utf8');
  assert.match(src, /CREATE TABLE IF NOT EXISTS supplier_master/);
  assert.match(src, /CREATE UNIQUE INDEX IF NOT EXISTS supplier_master_org_regnumber_active_uidx[^;]*WHERE archived_at IS NULL AND registration_number IS NOT NULL/s);
  assert.match(src, /CONSTRAINT supplier_master_hq_country_format/);
  assert.match(src, /CONSTRAINT supplier_master_sanctions_status_check/);
  assert.match(src, /CONSTRAINT supplier_master_legal_form_check/);
  assert.match(src, /CONSTRAINT supplier_master_trust_score_bounds/);
});

test('LEGAL_FORMS in lib/db/suppliers.js stays in parity with schema-010-supplier-master.sql CHECK constraint', () => {
  // Drift guard: every value declared in code must appear in the SQL
  // CHECK list, and vice versa. Catches the regression where adding a
  // legal form to code without updating the schema silently rejects.
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'schema-010-supplier-master.sql'), 'utf8');
  const match = src.match(/legal_form IN \(([^)]+)\)/);
  assert.ok(match, 'legal_form CHECK constraint not located in schema-010');
  const sqlValues = (match[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, ''));
  const codeValues = [...suppliers.LEGAL_FORMS];
  assert.deepEqual([...sqlValues].sort(), [...codeValues].sort(), 'LEGAL_FORMS in code drifted from the SQL CHECK constraint');
});

test('SANCTIONS_STATUSES in lib/db/suppliers.js stays in parity with schema-010 CHECK constraint', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'schema-010-supplier-master.sql'), 'utf8');
  const match = src.match(/sanctions_last_status IN \(([^)]+)\)/);
  assert.ok(match, 'sanctions_last_status CHECK constraint not located in schema-010');
  const sqlValues = (match[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, ''));
  const codeValues = [...suppliers.SANCTIONS_STATUSES];
  assert.deepEqual([...sqlValues].sort(), [...codeValues].sort(), 'SANCTIONS_STATUSES in code drifted from the SQL CHECK constraint');
});
