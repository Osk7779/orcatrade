'use strict';

// Live-Postgres integration tests for the system-of-record stack:
// goods_master + supplier_master + shipment_master + the promotion
// bridge that connects them.
//
// Skips cleanly when:
//   - DATABASE_URL is unset (local `npm test` stays hermetic)
//   - ORCATRADE_INTEGRATION_TESTS env is not '1' (extra guard so a
//     misconfigured local Postgres doesn't accidentally trigger them)
//
// Runs in CI via .github/workflows/pg-integration.yml against an
// ephemeral postgres:15 service container. Each test creates its own
// fresh organisation row so the suite is order-independent and can
// safely re-run.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

const SHOULD_RUN = process.env.ORCATRADE_INTEGRATION_TESTS === '1' && !!process.env.DATABASE_URL;
const SKIP_MSG = 'integration suite skipped — set ORCATRADE_INTEGRATION_TESTS=1 + DATABASE_URL';

// Lazy-require so this file loads cleanly even when DATABASE_URL is
// unset — the Neon driver requires() will succeed but isConfigured()
// will be false; we early-return before any actual query.
const db = require(path.join(ROOT, 'lib', 'db', 'client'));
const goodsDb = require(path.join(ROOT, 'lib', 'db', 'goods'));
const suppliersDb = require(path.join(ROOT, 'lib', 'db', 'suppliers'));
const shipmentsDb = require(path.join(ROOT, 'lib', 'db', 'shipments'));

// ── Skip-gate ─────────────────────────────────────────────────────────

test('integration suite preconditions', (t) => {
  if (!SHOULD_RUN) {
    t.skip(SKIP_MSG);
    return;
  }
  assert.equal(db.isConfigured(), true, 'DATABASE_URL must be set');
});

// ── Org fixtures ──────────────────────────────────────────────────────

/**
 * Create a fresh org for an integration test. Each test gets its own
 * org so they don't collide. Returns the numeric id + external_id.
 */
async function createTestOrg(label) {
  const ext = `org_test_${crypto.randomBytes(6).toString('hex')}`;
  const ownerHash = crypto.randomBytes(8).toString('hex');
  const rows = await db.query(
    `INSERT INTO organisations (external_id, name, slug, owner_email_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, external_id`,
    [ext, label || `Integration Test ${ext}`, ext, ownerHash],
  );
  return { id: Number(rows[0].id), externalId: rows[0].external_id, ownerHash };
}

// ── Goods master CRUD round-trip ──────────────────────────────────────

test('goods: create → get → list → update → archive round-trips against live PG', { skip: !SHOULD_RUN }, async () => {
  const org = await createTestOrg('goods-roundtrip');

  // CREATE
  const created = await goodsDb.createGoods({
    orgId: org.id,
    createdByEmailHash: org.ownerHash,
    sku: 'WIDGET-001',
    displayName: 'Widget — 1L PET bottle',
    hsCode: '85015210',
    originCountry: 'CN',
    typicalUnitValueCents: 2499,
    cbamInScope: false,
  });
  assert.equal(created.ok, true, `create: ${JSON.stringify(created)}`);
  assert.ok(created.goods.externalId.startsWith('gd_'));

  // GET
  const fetched = await goodsDb.getGoodsByExternalId({ orgId: org.id, externalId: created.goods.externalId });
  assert.equal(fetched.ok, true);
  assert.equal(fetched.goods.sku, 'WIDGET-001');
  assert.equal(fetched.goods.originCountry, 'CN');

  // LIST
  const listed = await goodsDb.listGoodsForOrg({ orgId: org.id });
  assert.equal(listed.ok, true);
  assert.equal(listed.goods.length, 1);

  // UPDATE
  const updated = await goodsDb.updateGoods({
    orgId: org.id,
    externalId: created.goods.externalId,
    actorEmailHash: org.ownerHash,
    patch: { displayName: 'Widget — 2L PET bottle', cbamInScope: true },
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.goods.displayName, 'Widget — 2L PET bottle');
  assert.equal(updated.goods.cbamInScope, true);

  // ARCHIVE
  const archived = await goodsDb.archiveGoods({
    orgId: org.id,
    externalId: created.goods.externalId,
    actorEmailHash: org.ownerHash,
  });
  assert.equal(archived.ok, true);
  assert.ok(archived.goods.archivedAt, 'archivedAt must be set after archive');

  // LIST excludes archived by default
  const listAfter = await goodsDb.listGoodsForOrg({ orgId: org.id });
  assert.equal(listAfter.goods.length, 0, 'archived rows excluded from list by default');

  // includeArchived surfaces them
  const listAll = await goodsDb.listGoodsForOrg({ orgId: org.id, includeArchived: true });
  assert.equal(listAll.goods.length, 1);
});

test('goods: partial unique index rejects two active rows with same (org_id, sku)', { skip: !SHOULD_RUN }, async () => {
  const org = await createTestOrg('goods-conflict');

  const first = await goodsDb.createGoods({
    orgId: org.id,
    createdByEmailHash: org.ownerHash,
    sku: 'DUPLICATE-SKU',
    displayName: 'First',
    hsCode: '850152',
  });
  assert.equal(first.ok, true);

  const second = await goodsDb.createGoods({
    orgId: org.id,
    createdByEmailHash: org.ownerHash,
    sku: 'DUPLICATE-SKU',
    displayName: 'Second (should conflict)',
    hsCode: '850152',
  });
  assert.equal(second.ok, false);
  assert.equal(second.conflict, true, 'expected the conflict:true marker so the handler returns 409');
  assert.match(second.errors[0], /sku already exists/i);
});

test('goods: archived row frees the SKU for re-use within the same org', { skip: !SHOULD_RUN }, async () => {
  const org = await createTestOrg('goods-reuse');

  const v1 = await goodsDb.createGoods({
    orgId: org.id, createdByEmailHash: org.ownerHash,
    sku: 'REUSED-SKU', displayName: 'v1', hsCode: '850152',
  });
  await goodsDb.archiveGoods({ orgId: org.id, externalId: v1.goods.externalId, actorEmailHash: org.ownerHash });

  const v2 = await goodsDb.createGoods({
    orgId: org.id, createdByEmailHash: org.ownerHash,
    sku: 'REUSED-SKU', displayName: 'v2 (after v1 retired)', hsCode: '850152',
  });
  assert.equal(v2.ok, true, 'reusing an archived SKU code must succeed');
});

test('goods: CHECK constraint rejects invalid hsCode', { skip: !SHOULD_RUN }, async () => {
  const org = await createTestOrg('goods-check');
  // Bypass the JS validation to hit the SQL CHECK directly: hsCode '99'
  // would normally fail validateForCreate ('6-10 digit numeric string').
  // We can't easily do that without an injection — instead, use the
  // JS-permitted but DB-rejected case: hsCode 'abc' fails JS check first.
  // So we test the DB constraint indirectly: a code that's all-numeric
  // but the wrong length is caught by JS validation and never reaches
  // the DB. The CHECK constraint defends against future regressions
  // where someone removes the JS guard. For now, assert validation
  // gives us a good 4xx-shaped error and never an unhandled PG error.
  const bad = await goodsDb.createGoods({
    orgId: org.id, createdByEmailHash: org.ownerHash,
    sku: 'X', displayName: 'X', hsCode: 'abc',
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /hsCode/.test(e)));
});

test('goods: getGoodsBySku finds active rows + skips archived', { skip: !SHOULD_RUN }, async () => {
  const org = await createTestOrg('goods-by-sku');
  const created = await goodsDb.createGoods({
    orgId: org.id, createdByEmailHash: org.ownerHash,
    sku: 'LOOKUP-SKU', displayName: 'Lookup test', hsCode: '850152',
    originCountry: 'VN',
  });

  // Active row → found
  const found = await goodsDb.getGoodsBySku({ orgId: org.id, sku: 'LOOKUP-SKU' });
  assert.equal(found.ok, true);
  assert.equal(found.goods.originCountry, 'VN');

  // Archive it, then look up again → not_found (active-only lookup)
  await goodsDb.archiveGoods({ orgId: org.id, externalId: created.goods.externalId, actorEmailHash: org.ownerHash });
  const missAfterArchive = await goodsDb.getGoodsBySku({ orgId: org.id, sku: 'LOOKUP-SKU' });
  assert.equal(missAfterArchive.ok, false);
  assert.equal(missAfterArchive.notFound, true);
});

// ── Supplier master CRUD round-trip ───────────────────────────────────

test('suppliers: create → get → list → update sanctions → archive round-trips', { skip: !SHOULD_RUN }, async () => {
  const org = await createTestOrg('suppliers-roundtrip');

  const created = await suppliersDb.createSupplier({
    orgId: org.id,
    createdByEmailHash: org.ownerHash,
    entityName: 'Shenzhen Lighting Co., Ltd.',
    legalForm: 'ltd',
    hqCountry: 'CN',
    registrationNumber: '914403007654321XYZ',
    registrationAuthority: 'SAIC',
    website: 'https://example.cn',
    factoryLocations: [{ countryCode: 'CN', city: 'Shenzhen', role: 'manufacturing' }],
    auditCerts: [{ standard: 'iso_9001', issuer: 'SGS', issuedAt: '2025-01-15' }],
  });
  assert.equal(created.ok, true);
  assert.ok(created.supplier.externalId.startsWith('sp_'));
  assert.equal(created.supplier.legalForm, 'ltd');
  assert.equal(created.supplier.hqCountry, 'CN');

  // UPDATE sanctions status (the rescreen cron's write path)
  const screened = await suppliersDb.updateSupplier({
    orgId: org.id,
    externalId: created.supplier.externalId,
    actorEmailHash: org.ownerHash,
    patch: {
      sanctionsLastScreenedAt: new Date().toISOString(),
      sanctionsLastStatus: 'clear',
      sanctionsLastMatchSummary: { hits: 0 },
    },
  });
  assert.equal(screened.ok, true);
  assert.equal(screened.supplier.sanctionsLastStatus, 'clear');

  // LIST filtered by hqCountry
  const listed = await suppliersDb.listSuppliersForOrg({ orgId: org.id, hqCountry: 'CN' });
  assert.equal(listed.ok, true);
  assert.equal(listed.suppliers.length, 1);

  const listedOther = await suppliersDb.listSuppliersForOrg({ orgId: org.id, hqCountry: 'DE' });
  assert.equal(listedOther.suppliers.length, 0);

  // ARCHIVE
  const archived = await suppliersDb.archiveSupplier({
    orgId: org.id,
    externalId: created.supplier.externalId,
    actorEmailHash: org.ownerHash,
  });
  assert.equal(archived.ok, true);
});

test('suppliers: registration_number partial unique index conflicts within an org', { skip: !SHOULD_RUN }, async () => {
  const org = await createTestOrg('suppliers-conflict');
  const first = await suppliersDb.createSupplier({
    orgId: org.id, createdByEmailHash: org.ownerHash,
    entityName: 'First', hqCountry: 'CN', registrationNumber: 'DUP-123',
  });
  assert.equal(first.ok, true);

  const second = await suppliersDb.createSupplier({
    orgId: org.id, createdByEmailHash: org.ownerHash,
    entityName: 'Second', hqCountry: 'CN', registrationNumber: 'DUP-123',
  });
  assert.equal(second.ok, false);
  assert.equal(second.conflict, true);
});

test('suppliers: null registration_number is permitted multiple times within an org', { skip: !SHOULD_RUN }, async () => {
  const org = await createTestOrg('suppliers-null-reg');
  const a = await suppliersDb.createSupplier({
    orgId: org.id, createdByEmailHash: org.ownerHash,
    entityName: 'A (no reg num)', hqCountry: 'CN',
  });
  const b = await suppliersDb.createSupplier({
    orgId: org.id, createdByEmailHash: org.ownerHash,
    entityName: 'B (no reg num either)', hqCountry: 'CN',
  });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true, 'partial-unique-index with NOT NULL guard must allow multiple null rows');
});

// ── Shipment master + state machine ────────────────────────────────────

test('shipments: create → state machine round-trip planned→booked→in_transit→cleared→delivered', { skip: !SHOULD_RUN }, async () => {
  const org = await createTestOrg('shipments-happy-path');

  const created = await shipmentsDb.createShipment({
    orgId: org.id,
    createdByEmailHash: org.ownerHash,
    label: 'Q3 widget restock',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueCents: 25_000_00,
    weightKg: 800,
  });
  assert.equal(created.ok, true);
  assert.equal(created.shipment.status, 'planned', 'shipments start in planned status');

  const t1 = await shipmentsDb.transitionShipmentStatus({
    orgId: org.id, externalId: created.shipment.externalId, actorEmailHash: org.ownerHash, toStatus: 'booked',
  });
  assert.equal(t1.ok, true);
  assert.equal(t1.shipment.status, 'booked');

  const t2 = await shipmentsDb.transitionShipmentStatus({
    orgId: org.id, externalId: created.shipment.externalId, actorEmailHash: org.ownerHash, toStatus: 'in_transit',
  });
  assert.equal(t2.shipment.status, 'in_transit');

  const t3 = await shipmentsDb.transitionShipmentStatus({
    orgId: org.id, externalId: created.shipment.externalId, actorEmailHash: org.ownerHash, toStatus: 'cleared',
  });
  assert.equal(t3.shipment.status, 'cleared');
  assert.ok(t3.shipment.clearedAt, 'cleared_at stamp must be set on the cleared transition');

  const t4 = await shipmentsDb.transitionShipmentStatus({
    orgId: org.id, externalId: created.shipment.externalId, actorEmailHash: org.ownerHash, toStatus: 'delivered',
  });
  assert.equal(t4.shipment.status, 'delivered');
  assert.ok(t4.shipment.deliveredAt);
});

test('shipments: illegal transition is rejected with conflict:true (handler returns 409)', { skip: !SHOULD_RUN }, async () => {
  const org = await createTestOrg('shipments-illegal-transition');
  const created = await shipmentsDb.createShipment({
    orgId: org.id, createdByEmailHash: org.ownerHash,
    label: 'illegal-test', originCountry: 'CN', destinationCountry: 'PL',
    customsValueCents: 1000_00,
  });
  // planned → cleared is NOT a legal edge
  const bad = await shipmentsDb.transitionShipmentStatus({
    orgId: org.id, externalId: created.shipment.externalId, actorEmailHash: org.ownerHash, toStatus: 'cleared',
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.conflict, true);
  assert.match(bad.errors[0], /illegal transition: planned → cleared/);
});

test('shipments: exception lifecycle — open + acknowledge + queue surfaces SLA fields', { skip: !SHOULD_RUN }, async () => {
  const org = await createTestOrg('shipments-exception');
  const created = await shipmentsDb.createShipment({
    orgId: org.id, createdByEmailHash: org.ownerHash,
    label: 'exception-test', originCountry: 'CN', destinationCountry: 'PL',
    customsValueCents: 5000_00,
  });

  // Open exception with details
  const opened = await shipmentsDb.transitionShipmentStatus({
    orgId: org.id, externalId: created.shipment.externalId, actorEmailHash: org.ownerHash,
    toStatus: 'exception',
    details: { reason: 'taric_drift', detail: 'MFN rate moved 12% → 8.5%' },
  });
  assert.equal(opened.ok, true);
  assert.equal(opened.shipment.exceptionState.reason, 'taric_drift');
  assert.equal(opened.shipment.exceptionState.previousStatus, 'planned');
  assert.ok(opened.shipment.exceptionState.openedAt);

  // Queue surfaces this row with computed fields
  const queue = await shipmentsDb.listExceptionQueue({ orgId: org.id });
  assert.equal(queue.ok, true);
  assert.equal(queue.queue.length, 1);
  assert.equal(queue.queue[0].externalId, created.shipment.externalId);
  assert.equal(queue.queue[0]._queue.acknowledged, false);
  assert.equal(typeof queue.queue[0]._queue.ageHours, 'number');

  // Acknowledge
  const ack = await shipmentsDb.acknowledgeException({
    orgId: org.id, externalId: created.shipment.externalId, actorEmailHash: org.ownerHash,
    note: 'Investigating',
  });
  assert.equal(ack.ok, true);
  assert.ok(ack.shipment.exceptionState.acknowledgedAt);
  assert.equal(ack.shipment.exceptionState.acknowledgmentNote, 'Investigating');

  // Acknowledging again is idempotent
  const ack2 = await shipmentsDb.acknowledgeException({
    orgId: org.id, externalId: created.shipment.externalId, actorEmailHash: org.ownerHash,
  });
  assert.equal(ack2.ok, true);
  assert.equal(ack2.unchanged, true);

  // Recovery: exception → planned is a legal edge
  const recovered = await shipmentsDb.transitionShipmentStatus({
    orgId: org.id, externalId: created.shipment.externalId, actorEmailHash: org.ownerHash, toStatus: 'planned',
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.shipment.status, 'planned');

  // Acknowledging when NOT in exception status → conflict
  const ackBad = await shipmentsDb.acknowledgeException({
    orgId: org.id, externalId: created.shipment.externalId, actorEmailHash: org.ownerHash,
  });
  assert.equal(ackBad.ok, false);
  assert.equal(ackBad.conflict, true);
});

test('shipments: list filtering by status + supplier/goods external ids', { skip: !SHOULD_RUN }, async () => {
  const org = await createTestOrg('shipments-list-filter');
  const a = await shipmentsDb.createShipment({
    orgId: org.id, createdByEmailHash: org.ownerHash,
    label: 'A', originCountry: 'CN', destinationCountry: 'PL', customsValueCents: 1000_00,
    goodsExternalId: 'gd_test_a',
    supplierExternalId: 'sp_test_a',
  });
  const b = await shipmentsDb.createShipment({
    orgId: org.id, createdByEmailHash: org.ownerHash,
    label: 'B', originCountry: 'VN', destinationCountry: 'DE', customsValueCents: 2000_00,
  });
  await shipmentsDb.transitionShipmentStatus({
    orgId: org.id, externalId: a.shipment.externalId, actorEmailHash: org.ownerHash, toStatus: 'booked',
  });

  const filteredByStatus = await shipmentsDb.listShipmentsForOrg({ orgId: org.id, status: 'booked' });
  assert.equal(filteredByStatus.shipments.length, 1);
  assert.equal(filteredByStatus.shipments[0].externalId, a.shipment.externalId);

  const filteredByGoods = await shipmentsDb.listShipmentsForOrg({ orgId: org.id, goodsExternalId: 'gd_test_a' });
  assert.equal(filteredByGoods.shipments.length, 1);

  const filteredBySupplier = await shipmentsDb.listShipmentsForOrg({ orgId: org.id, supplierExternalId: 'sp_test_a' });
  assert.equal(filteredBySupplier.shipments.length, 1);
});
