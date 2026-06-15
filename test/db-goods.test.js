'use strict';

// Goods master data-layer tests.
//
// Without a live Postgres in the test env (DATABASE_URL unset), CRUD
// operations return { ok: false, errors: ['Postgres not configured…'] }.
// That contract is itself worth pinning — the handler relies on it
// to translate to 503. The validation + row-mapping + ID-generation
// pure functions are tested directly.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const goods = require(path.join(ROOT, 'lib', 'db', 'goods'));

// ── _generateGoodsId ──────────────────────────────────────────────────

test('_generateGoodsId emits 16-hex ids with the "gd_" prefix', () => {
  for (let i = 0; i < 5; i++) {
    const id = goods._generateGoodsId();
    assert.match(id, /^gd_[a-f0-9]{16}$/);
  }
});

test('_generateGoodsId is unique across many calls (sanity)', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(goods._generateGoodsId());
  assert.equal(seen.size, 200, 'expected 200 unique ids');
});

// ── _validateForCreate ────────────────────────────────────────────────

const VALID_CREATE = Object.freeze({
  orgId: 42,
  createdByEmailHash: 'aabbccdd11223344',
  sku: 'WIDGET-001',
  displayName: 'Widget — 1L PET bottle',
  hsCode: '85015210',
  originCountry: 'CN',
  typicalUnitValueCents: 24_99,
  cbamInScope: false,
  reachSvhcFlags: [],
  restrictedSubstances: {},
  metadata: {},
});

test('_validateForCreate returns no errors on a well-formed input', () => {
  assert.deepEqual(goods._validateForCreate(VALID_CREATE), []);
});

test('_validateForCreate rejects null / non-object input', () => {
  assert.deepEqual(goods._validateForCreate(null), ['input required']);
  assert.deepEqual(goods._validateForCreate('a string'), ['input required']);
});

test('_validateForCreate requires orgId as a positive integer', () => {
  const r = goods._validateForCreate({ ...VALID_CREATE, orgId: 'abc' });
  assert.ok(r.some((e) => e.includes('orgId')));
  const r2 = goods._validateForCreate({ ...VALID_CREATE, orgId: -1 });
  assert.ok(r2.some((e) => e.includes('orgId')));
  const r3 = goods._validateForCreate({ ...VALID_CREATE, orgId: 1.5 });
  assert.ok(r3.some((e) => e.includes('orgId')));
});

test('_validateForCreate enforces SKU bounds + non-whitespace edges', () => {
  assert.ok(goods._validateForCreate({ ...VALID_CREATE, sku: '' }).some((e) => /sku/.test(e)));
  assert.ok(goods._validateForCreate({ ...VALID_CREATE, sku: ' lead' }).some((e) => /leading\/trailing/.test(e)));
  assert.ok(goods._validateForCreate({ ...VALID_CREATE, sku: 'trail ' }).some((e) => /leading\/trailing/.test(e)));
  assert.ok(goods._validateForCreate({ ...VALID_CREATE, sku: 'x'.repeat(101) }).some((e) => /≤100/.test(e)));
});

test('_validateForCreate rejects hsCode shorter than 6 or longer than 10 digits', () => {
  assert.ok(goods._validateForCreate({ ...VALID_CREATE, hsCode: '12345' }).some((e) => /hsCode/.test(e)));
  assert.ok(goods._validateForCreate({ ...VALID_CREATE, hsCode: '12345678901' }).some((e) => /hsCode/.test(e)));
  assert.ok(goods._validateForCreate({ ...VALID_CREATE, hsCode: '85.01' }).some((e) => /hsCode/.test(e)));
});

test('_validateForCreate accepts 6, 8, and 10-digit hsCodes', () => {
  for (const hsCode of ['850152', '85015210', '8501521000']) {
    assert.deepEqual(goods._validateForCreate({ ...VALID_CREATE, hsCode }), []);
  }
});

test('_validateForCreate rejects malformed originCountry', () => {
  assert.ok(goods._validateForCreate({ ...VALID_CREATE, originCountry: 'CHN' }).some((e) => /ISO-2/.test(e)));
  assert.ok(goods._validateForCreate({ ...VALID_CREATE, originCountry: 'C1' }).some((e) => /ISO-2/.test(e)));
});

test('_validateForCreate accepts lowercase originCountry (normalised at write time)', () => {
  // The data layer normalises to uppercase before INSERT. Validation
  // accepts either case to be user-friendly; the CHECK constraint on
  // the column still enforces uppercase at the DB level.
  assert.deepEqual(goods._validateForCreate({ ...VALID_CREATE, originCountry: 'cn' }), []);
});

test('_validateForCreate accepts a null / undefined / empty originCountry', () => {
  for (const v of [null, undefined, '']) {
    assert.deepEqual(goods._validateForCreate({ ...VALID_CREATE, originCountry: v }), []);
  }
});

test('_validateForCreate rejects negative or non-integer typicalUnitValueCents', () => {
  assert.ok(goods._validateForCreate({ ...VALID_CREATE, typicalUnitValueCents: -5 }).some((e) => /non-negative/.test(e)));
  assert.ok(goods._validateForCreate({ ...VALID_CREATE, typicalUnitValueCents: 1.5 }).some((e) => /non-negative integer/.test(e)));
});

test('_validateForCreate rejects malformed reachSvhcFlags / restrictedSubstances / metadata', () => {
  assert.ok(goods._validateForCreate({ ...VALID_CREATE, reachSvhcFlags: 'not-an-array' }).some((e) => /reachSvhcFlags/.test(e)));
  assert.ok(goods._validateForCreate({ ...VALID_CREATE, restrictedSubstances: [] }).some((e) => /restrictedSubstances/.test(e)));
  assert.ok(goods._validateForCreate({ ...VALID_CREATE, metadata: [] }).some((e) => /metadata/.test(e)));
});

// ── _validateForUpdate ────────────────────────────────────────────────

test('_validateForUpdate accepts an empty patch (no-op semantics)', () => {
  assert.deepEqual(goods._validateForUpdate({}), []);
});

test('_validateForUpdate enforces same type rules as create when fields are present', () => {
  assert.ok(goods._validateForUpdate({ hsCode: 'abc' }).some((e) => /hsCode/.test(e)));
  assert.ok(goods._validateForUpdate({ originCountry: 'USA' }).some((e) => /ISO-2/.test(e)));
  assert.ok(goods._validateForUpdate({ cbamInScope: 'yes' }).some((e) => /boolean/.test(e)));
  assert.ok(goods._validateForUpdate({ typicalUnitValueCents: 1.1 }).some((e) => /non-negative integer/.test(e)));
});

test('_validateForUpdate accepts a partial patch with only one field', () => {
  assert.deepEqual(goods._validateForUpdate({ displayName: 'New name' }), []);
});

// ── _rowToGoods ───────────────────────────────────────────────────────

test('_rowToGoods maps snake_case columns to camelCase fields', () => {
  const row = {
    id: 1,
    external_id: 'gd_abc',
    org_id: 7,
    created_by_email_hash: 'aaa',
    sku: 'X',
    display_name: 'Display',
    hs_code: '850152',
    origin_country: 'CN',
    typical_unit_value_cents: '2499',
    cbam_in_scope: false,
    reach_svhc_flags: [{ cas: '50-00-0' }],
    restricted_substances: { EU: 'see REACH' },
    metadata: { ref: 'X' },
    created_at: '2026-06-08T00:00:00.000Z',
    updated_at: '2026-06-08T00:00:00.000Z',
    archived_at: null,
  };
  const obj = goods._rowToGoods(row);
  assert.equal(obj.externalId, 'gd_abc');
  assert.equal(obj.orgId, 7);
  assert.equal(obj.createdByEmailHash, 'aaa');
  assert.equal(obj.displayName, 'Display');
  assert.equal(obj.hsCode, '850152');
  assert.equal(obj.originCountry, 'CN');
  assert.equal(obj.typicalUnitValueCents, 2499, 'bigint string must be converted to Number');
  assert.equal(obj.cbamInScope, false);
  assert.deepEqual(obj.reachSvhcFlags, [{ cas: '50-00-0' }]);
  assert.deepEqual(obj.restrictedSubstances, { EU: 'see REACH' });
  assert.deepEqual(obj.metadata, { ref: 'X' });
  assert.equal(obj.archivedAt, null);
});

test('_rowToGoods returns null on null/undefined input', () => {
  assert.equal(goods._rowToGoods(null), null);
  assert.equal(goods._rowToGoods(undefined), null);
});

test('_rowToGoods normalises null jsonb fields to safe defaults', () => {
  const row = {
    id: 1, external_id: 'gd_x', org_id: 1, created_by_email_hash: 'x',
    sku: 'X', display_name: 'X', hs_code: '850152', origin_country: null,
    typical_unit_value_cents: null, cbam_in_scope: false,
    reach_svhc_flags: null, restricted_substances: null, metadata: null,
    created_at: '2026', updated_at: '2026', archived_at: null,
  };
  const obj = goods._rowToGoods(row);
  assert.deepEqual(obj.reachSvhcFlags, []);
  assert.deepEqual(obj.restrictedSubstances, {});
  assert.deepEqual(obj.metadata, {});
  assert.equal(obj.typicalUnitValueCents, null);
});

// ── 503 path: every CRUD operation when PG unconfigured ───────────────

test('createGoods returns "Postgres not configured" when DATABASE_URL is unset', async () => {
  // Validation must still happen first (so a missing-orgId test gets a
  // 400-shaped error, not a 503 mask).
  const r = await goods.createGoods(VALID_CREATE);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Postgres not configured/i);
});

test('getGoodsByExternalId returns "Postgres not configured" when DATABASE_URL is unset', async () => {
  const r = await goods.getGoodsByExternalId({ orgId: 1, externalId: 'gd_x' });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Postgres not configured/i);
});

test('listGoodsForOrg returns "Postgres not configured" when DATABASE_URL is unset', async () => {
  const r = await goods.listGoodsForOrg({ orgId: 1 });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Postgres not configured/i);
});

test('updateGoods returns "Postgres not configured" when DATABASE_URL is unset', async () => {
  const r = await goods.updateGoods({
    orgId: 1, externalId: 'gd_x', actorEmailHash: 'h', patch: { displayName: 'new' },
  });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Postgres not configured/i);
});

test('archiveGoods returns "Postgres not configured" when DATABASE_URL is unset', async () => {
  const r = await goods.archiveGoods({ orgId: 1, externalId: 'gd_x', actorEmailHash: 'h' });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Postgres not configured/i);
});

// ── Validation precedes 503 ───────────────────────────────────────────

test('createGoods surfaces a 400-shaped validation error even when PG is unconfigured', async () => {
  // The handler should return 400, not 503, when input is invalid.
  // The data layer signals this by returning errors that DON'T mention
  // "Postgres not configured".
  const r = await goods.createGoods({ ...VALID_CREATE, hsCode: 'XYZ' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /hsCode/.test(e)));
  assert.ok(!r.errors.some((e) => /Postgres/.test(e)), 'validation errors must come before the PG-config check');
});

test('updateGoods surfaces a 400-shaped validation error even when PG is unconfigured', async () => {
  const r = await goods.updateGoods({
    orgId: 1, externalId: 'gd_x', actorEmailHash: 'h', patch: { cbamInScope: 'yes' },
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /cbamInScope/.test(e)));
  assert.ok(!r.errors.some((e) => /Postgres/.test(e)));
});

// ── Schema migration is discoverable + idempotent ─────────────────────

test('schema-009-goods-master.sql exists + carries the IF NOT EXISTS idempotency markers', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'schema-009-goods-master.sql'), 'utf8');
  assert.match(src, /CREATE TABLE IF NOT EXISTS goods_master/);
  // partial unique index — central to the "SKU unique while active" rule
  assert.match(src, /CREATE UNIQUE INDEX IF NOT EXISTS goods_master_org_sku_active_uidx[^;]*WHERE archived_at IS NULL/s);
  // check constraints on hs_code + origin_country
  assert.match(src, /CONSTRAINT goods_master_hs_code_format/);
  assert.match(src, /CONSTRAINT goods_master_origin_country_format/);
});
