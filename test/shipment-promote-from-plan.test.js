'use strict';

// Plan → shipment promotion tests.
//
// Pins the bridge that turns a saved wizard plan into the operational
// shipment_master entity. Without DATABASE_URL in the test env we can't
// exercise the live INSERT, so we focus on:
//   - buildShipmentSeedFromPlan: pure-function shape, ADR-0004 cents
//     conversion, label fallback, snapshot capture
//   - resolvePlanForPromotion: invalid-id / not-found / wrong-owner
//     paths
//   - The promotion helpers are exported on the handler module surface

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const shipmentsHandler = require(path.join(ROOT, 'lib', 'handlers', 'shipments'));
const savedPlans = require(path.join(ROOT, 'lib', 'saved-plans'));

// ── buildShipmentSeedFromPlan (pure function) ─────────────────────────

test('buildShipmentSeedFromPlan: label derives from category·route signature when no plan label is set', () => {
  const seed = shipmentsHandler.buildShipmentSeedFromPlan({
    inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL' },
  });
  assert.equal(seed.label, 'apparel · CN→PL');
});

test('buildShipmentSeedFromPlan: prefers the plan.label when set', () => {
  const seed = shipmentsHandler.buildShipmentSeedFromPlan({
    label: 'Q3 widget restock',
    inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL' },
  });
  assert.equal(seed.label, 'Q3 widget restock (from saved plan)');
});

test('buildShipmentSeedFromPlan: falls back to generic label when inputs are sparse', () => {
  const seed = shipmentsHandler.buildShipmentSeedFromPlan({ inputs: {} });
  assert.equal(seed.label, 'Shipment from saved plan');
});

test('buildShipmentSeedFromPlan: converts customsValueEur → customsValueCents (ADR 0004)', () => {
  const seed = shipmentsHandler.buildShipmentSeedFromPlan({
    inputs: { customsValueEur: 25000, originCountry: 'CN', destinationCountry: 'PL' },
  });
  assert.equal(seed.customsValueCents, 2_500_000, '€25,000 → 2,500,000 cents');
});

test('buildShipmentSeedFromPlan: customsValueCents omitted when customsValueEur is missing or invalid', () => {
  const seedMissing = shipmentsHandler.buildShipmentSeedFromPlan({ inputs: {} });
  assert.equal(seedMissing.customsValueCents, undefined);
  const seedNan = shipmentsHandler.buildShipmentSeedFromPlan({ inputs: { customsValueEur: 'abc' } });
  assert.equal(seedNan.customsValueCents, undefined);
});

test('buildShipmentSeedFromPlan: origin/destination + weight propagate', () => {
  const seed = shipmentsHandler.buildShipmentSeedFromPlan({
    inputs: { originCountry: 'CN', destinationCountry: 'PL', weightKg: 800 },
  });
  assert.equal(seed.originCountry, 'CN');
  assert.equal(seed.destinationCountry, 'PL');
  assert.equal(seed.weightKg, 800);
});

test('buildShipmentSeedFromPlan: weightKg rounds to an integer', () => {
  const seed = shipmentsHandler.buildShipmentSeedFromPlan({ inputs: { weightKg: 799.7 } });
  assert.equal(seed.weightKg, 800);
});

test('buildShipmentSeedFromPlan: inputsSnapshot captures the plan inputs verbatim', () => {
  const inputs = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 };
  const seed = shipmentsHandler.buildShipmentSeedFromPlan({ inputs });
  assert.deepEqual(seed.inputsSnapshot, inputs);
});

test('buildShipmentSeedFromPlan: quoteSnapshot captures plan.snapshot (the full quote result)', () => {
  const snapshot = { totals: { dutyEur: 1200 }, tier_a: { eligible: false } };
  const seed = shipmentsHandler.buildShipmentSeedFromPlan({ inputs: {}, snapshot });
  assert.deepEqual(seed.quoteSnapshot, snapshot);
});

test('buildShipmentSeedFromPlan: tolerates a null plan gracefully', () => {
  const seed = shipmentsHandler.buildShipmentSeedFromPlan(null);
  // Should produce a default-shaped seed, not throw.
  assert.equal(seed.label, 'Shipment from saved plan');
  assert.equal(seed.originCountry, null);
  assert.equal(seed.destinationCountry, null);
  assert.equal(seed.weightKg, null);
  assert.deepEqual(seed.inputsSnapshot, {});
  assert.equal(seed.quoteSnapshot, null);
});

// ── resolvePlanForPromotion ───────────────────────────────────────────

test('resolvePlanForPromotion: rejects malformed planId before touching KV', async () => {
  const result = await shipmentsHandler.resolvePlanForPromotion({ email: 'a@b.test' }, 'not-a-plan-id');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_id');
  assert.match(result.error, /pl_<hex>/);
});

test('resolvePlanForPromotion: rejects an empty planId', async () => {
  const result = await shipmentsHandler.resolvePlanForPromotion({ email: 'a@b.test' }, '');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_id');
});

test('resolvePlanForPromotion: a non-existent plan returns not_found', async () => {
  // Use a well-formed planId that doesn't exist in KV.
  const result = await shipmentsHandler.resolvePlanForPromotion(
    { email: 'a@b.test' },
    'pl_0000000000000000',
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_found');
});

test('resolvePlanForPromotion: a plan owned by a different user returns not_found (no existence leak)', async () => {
  // Create a plan owned by user-A, then try to fetch as user-B. Per
  // the saved-plans ownership-check contract, we should get back null
  // → reason:'not_found' (not 'wrong_owner') so existence isn't leaked.
  const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));
  kv._resetMemoryStore();
  const save = await savedPlans.savePlan({
    email: 'owner@example.test',
    inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL' },
  });
  assert.ok(save.id, 'savePlan should have produced an id');
  const result = await shipmentsHandler.resolvePlanForPromotion(
    { email: 'intruder@example.test' },
    save.id,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_found', 'wrong-owner must look identical to not-found to prevent existence leak');
});

test('resolvePlanForPromotion: a plan owned by the requesting user resolves OK', async () => {
  const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));
  kv._resetMemoryStore();
  const save = await savedPlans.savePlan({
    email: 'owner@example.test',
    inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000 },
    label: 'Q3 widgets',
  });
  const result = await shipmentsHandler.resolvePlanForPromotion(
    { email: 'owner@example.test' },
    save.id,
  );
  assert.equal(result.ok, true);
  assert.equal(result.plan.label, 'Q3 widgets');
  assert.equal(result.plan.inputs.customsValueEur, 25000);
});

// ── Module surface ────────────────────────────────────────────────────

test('handler exposes resolvePlanForPromotion + buildShipmentSeedFromPlan on the module surface', () => {
  assert.equal(typeof shipmentsHandler.resolvePlanForPromotion, 'function');
  assert.equal(typeof shipmentsHandler.buildShipmentSeedFromPlan, 'function');
});

test('handler is still a single async function (dispatcher contract preserved)', () => {
  assert.equal(typeof shipmentsHandler, 'function');
});
