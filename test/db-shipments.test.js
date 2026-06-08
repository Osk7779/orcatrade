'use strict';

// Shipment master data-layer tests. The state machine is the
// load-bearing distinct piece vs goods + suppliers, so it gets the
// majority of the test surface.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const shipments = require(path.join(ROOT, 'lib', 'db', 'shipments'));

// ── ID generation ─────────────────────────────────────────────────────

test('_generateShipmentId emits 16-hex ids with the "sh_" prefix', () => {
  for (let i = 0; i < 5; i++) {
    assert.match(shipments._generateShipmentId(), /^sh_[a-f0-9]{16}$/);
  }
});

test('_generateShipmentId is unique across many calls', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(shipments._generateShipmentId());
  assert.equal(seen.size, 200);
});

// ── Validation ────────────────────────────────────────────────────────

const VALID_CREATE = Object.freeze({
  orgId: 42,
  createdByEmailHash: 'aabbccdd11223344',
  label: 'Q3 widget restock',
  originCountry: 'CN',
  destinationCountry: 'PL',
  customsValueCents: 25_000_00,
  weightKg: 800,
  containerCount: 1,
});

test('_validateForCreate accepts a well-formed input', () => {
  assert.deepEqual(shipments._validateForCreate(VALID_CREATE), []);
});

test('_validateForCreate requires orgId + createdByEmailHash + label', () => {
  assert.ok(shipments._validateForCreate({ ...VALID_CREATE, orgId: 'abc' }).some((e) => /orgId/.test(e)));
  assert.ok(shipments._validateForCreate({ ...VALID_CREATE, createdByEmailHash: '' }).some((e) => /createdByEmailHash/.test(e)));
  assert.ok(shipments._validateForCreate({ ...VALID_CREATE, label: '' }).some((e) => /label/.test(e)));
});

test('_validateForCreate rejects malformed country codes', () => {
  assert.ok(shipments._validateForCreate({ ...VALID_CREATE, originCountry: 'CHN' }).some((e) => /originCountry/.test(e)));
  assert.ok(shipments._validateForCreate({ ...VALID_CREATE, destinationCountry: 'PLD' }).some((e) => /destinationCountry/.test(e)));
});

test('_validateForCreate enforces integer-cents money discipline (ADR 0004)', () => {
  assert.ok(shipments._validateForCreate({ ...VALID_CREATE, customsValueCents: -1 }).some((e) => /ADR 0004/.test(e)));
  assert.ok(shipments._validateForCreate({ ...VALID_CREATE, customsValueCents: 1.5 }).some((e) => /ADR 0004/.test(e)));
});

// ── State machine ─────────────────────────────────────────────────────

test('STATUSES exposes exactly 7 closed states matching the SQL CHECK constraint', () => {
  assert.deepEqual(
    [...shipments.STATUSES].sort(),
    ['booked', 'cancelled', 'cleared', 'delivered', 'exception', 'in_transit', 'planned'].sort(),
  );
});

test('VALID_TRANSITIONS happy-path: planned → booked → in_transit → cleared → delivered all legal', () => {
  assert.equal(shipments.isLegalTransition('planned', 'booked'), true);
  assert.equal(shipments.isLegalTransition('booked', 'in_transit'), true);
  assert.equal(shipments.isLegalTransition('in_transit', 'cleared'), true);
  assert.equal(shipments.isLegalTransition('cleared', 'delivered'), true);
});

test('VALID_TRANSITIONS: any non-cancelled non-delivered state → cancelled is legal', () => {
  for (const from of ['planned', 'booked', 'in_transit', 'exception']) {
    assert.equal(shipments.isLegalTransition(from, 'cancelled'), true, `${from} → cancelled must be legal`);
  }
});

test('VALID_TRANSITIONS: cleared and delivered are NOT cancellable (post-customs-clearance is finalised)', () => {
  assert.equal(shipments.isLegalTransition('cleared', 'cancelled'), false);
  assert.equal(shipments.isLegalTransition('delivered', 'cancelled'), false);
});

test('VALID_TRANSITIONS: any non-cancelled state → exception is legal', () => {
  for (const from of ['planned', 'booked', 'in_transit', 'cleared', 'delivered']) {
    assert.equal(shipments.isLegalTransition(from, 'exception'), true, `${from} → exception must be legal`);
  }
});

test('VALID_TRANSITIONS: exception can fan out to any non-cancelled state (recovery)', () => {
  for (const to of ['planned', 'booked', 'in_transit', 'cleared', 'delivered', 'cancelled']) {
    assert.equal(shipments.isLegalTransition('exception', to), true, `exception → ${to} must be legal`);
  }
});

test('VALID_TRANSITIONS: cancelled is terminal — no outbound edges', () => {
  for (const to of shipments.STATUSES) {
    if (to === 'cancelled') continue;
    assert.equal(shipments.isLegalTransition('cancelled', to), false, `cancelled → ${to} must be illegal`);
  }
});

test('VALID_TRANSITIONS: backward edges in the happy-path are ILLEGAL', () => {
  // No going back from cleared to in_transit, etc.
  assert.equal(shipments.isLegalTransition('cleared', 'in_transit'), false);
  assert.equal(shipments.isLegalTransition('in_transit', 'booked'), false);
  assert.equal(shipments.isLegalTransition('booked', 'planned'), false);
  assert.equal(shipments.isLegalTransition('delivered', 'cleared'), false);
});

test('isLegalTransition: unknown states return false', () => {
  assert.equal(shipments.isLegalTransition('foo', 'planned'), false);
  assert.equal(shipments.isLegalTransition('planned', 'bar'), false);
  assert.equal(shipments.isLegalTransition(null, 'planned'), false);
});

test('VALID_TRANSITIONS object is frozen', () => {
  assert.equal(Object.isFrozen(shipments.VALID_TRANSITIONS), true);
});

// ── Row mapping ───────────────────────────────────────────────────────

test('_rowToShipment maps snake_case to camelCase + normalises bigint strings', () => {
  const row = {
    id: 1, external_id: 'sh_abc', org_id: 7, created_by_email_hash: 'aaa',
    label: 'X', status: 'in_transit',
    goods_external_id: 'gd_x', supplier_external_id: 'sp_x',
    planned_departure_date: '2026-09-15', planned_arrival_date: '2026-10-20',
    customs_value_cents: '2500000', origin_country: 'CN', destination_country: 'PL',
    carrier: 'Maersk', booking_ref: 'BK-1', container_count: 1, weight_kg: 800, volume_cbm: '12.5',
    bl_number: 'BL-1', actual_departure_date: '2026-09-16', eta: '2026-10-18',
    last_known_location: 'Suez Canal',
    cleared_at: null, declaration_ref: null, duty_paid_cents: null, vat_paid_cents: null,
    brokerage_paid_cents: null, delivered_at: null,
    exception_state: {}, document_vault: [{ docType: 'commercial_invoice' }],
    inputs_snapshot: { sku: 'X' }, quote_snapshot: { totals: { dutyEur: 100 } },
    metadata: { tag: 'pilot' },
    created_at: '2026-06-08T00:00:00Z', updated_at: '2026-06-08T00:00:00Z', archived_at: null,
  };
  const obj = shipments._rowToShipment(row);
  assert.equal(obj.externalId, 'sh_abc');
  assert.equal(obj.status, 'in_transit');
  assert.equal(obj.goodsExternalId, 'gd_x');
  assert.equal(obj.supplierExternalId, 'sp_x');
  assert.equal(obj.customsValueCents, 2500000, 'bigint string must convert to Number');
  assert.equal(obj.volumeCbm, 12.5, 'numeric string must convert');
  assert.deepEqual(obj.documentVault, [{ docType: 'commercial_invoice' }]);
  assert.deepEqual(obj.inputsSnapshot, { sku: 'X' });
});

test('_rowToShipment returns null on null input', () => {
  assert.equal(shipments._rowToShipment(null), null);
});

// ── 503 path ──────────────────────────────────────────────────────────

test('createShipment / get / list / update / transition / archive all return 503 shape when PG unconfigured', async () => {
  const r1 = await shipments.createShipment(VALID_CREATE);
  assert.match(r1.errors[0], /Postgres not configured/i);
  const r2 = await shipments.getShipmentByExternalId({ orgId: 1, externalId: 'sh_x' });
  assert.match(r2.errors[0], /Postgres not configured/i);
  const r3 = await shipments.listShipmentsForOrg({ orgId: 1 });
  assert.match(r3.errors[0], /Postgres not configured/i);
  const r4 = await shipments.updateShipment({ orgId: 1, externalId: 'sh_x', actorEmailHash: 'h', patch: { label: 'Y' } });
  assert.match(r4.errors[0], /Postgres not configured/i);
  const r5 = await shipments.transitionShipmentStatus({ orgId: 1, externalId: 'sh_x', actorEmailHash: 'h', toStatus: 'booked' });
  assert.match(r5.errors[0], /Postgres not configured/i);
  const r6 = await shipments.archiveShipment({ orgId: 1, externalId: 'sh_x', actorEmailHash: 'h' });
  assert.match(r6.errors[0], /Postgres not configured/i);
});

// ── Validation precedes 503 ───────────────────────────────────────────

test('createShipment surfaces validation errors even when PG is unconfigured', async () => {
  const r = await shipments.createShipment({ ...VALID_CREATE, originCountry: 'XYZ' });
  assert.ok(r.errors.some((e) => /originCountry/.test(e)));
  assert.ok(!r.errors.some((e) => /Postgres/.test(e)));
});

test('transitionShipmentStatus rejects unknown toStatus before checking PG', async () => {
  const r = await shipments.transitionShipmentStatus({
    orgId: 1, externalId: 'sh_x', actorEmailHash: 'h', toStatus: 'wibble',
  });
  assert.ok(r.errors.some((e) => /toStatus must be one of/.test(e)));
});

test('updateShipment rejects a "status" key in patch (status changes flow through transition)', async () => {
  const r = await shipments.updateShipment({
    orgId: 1, externalId: 'sh_x', actorEmailHash: 'h', patch: { status: 'booked', label: 'X' },
  });
  assert.ok(r.errors.some((e) => /transitionShipmentStatus/.test(e)));
});

// ── Schema discoverability + drift guards ─────────────────────────────

test('schema-011-shipment-master.sql carries IF NOT EXISTS + status CHECK + state-machine indexes', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'schema-011-shipment-master.sql'), 'utf8');
  assert.match(src, /CREATE TABLE IF NOT EXISTS shipment_master/);
  assert.match(src, /CONSTRAINT shipment_master_status_check/);
  // Exception queue feeder index — load-bearing for the Phase 3 dashboard
  assert.match(src, /shipment_master_exception_queue_idx[\s\S]*WHERE status = 'exception'/);
  // ETA dashboard partial index
  assert.match(src, /shipment_master_eta_idx[\s\S]*WHERE status = 'in_transit'/);
});

test('STATUSES in code stays in parity with the SQL status CHECK constraint', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'schema-011-shipment-master.sql'), 'utf8');
  const match = src.match(/status IN \(([^)]+)\)/);
  assert.ok(match, 'status CHECK constraint not located in schema-011');
  const sqlValues = (match[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, ''));
  const codeValues = [...shipments.STATUSES];
  assert.deepEqual([...sqlValues].sort(), [...codeValues].sort(), 'STATUSES in code drifted from the SQL CHECK constraint');
});
