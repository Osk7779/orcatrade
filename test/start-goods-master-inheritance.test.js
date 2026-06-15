'use strict';

// L1.1 follow-up — goods master quote-time inheritance.
//
// Pins the wizard's auth-aware SKU lookup behaviour. Without
// DATABASE_URL in the test env we exercise:
//   - Anonymous-user funnel: no SKU → no inheritance; SKU present
//     but no session → no inheritance
//   - getGoodsBySku data-layer 503 / validation contract
//   - The inheritance helper exports + module surface
//   - The composePlanWithRoadmap path does not break when goods master
//     enrichment runs (regression guard on plan shape)
//
// Live PG round-trips (SKU exists / SKU missing / cbam inheritance)
// are exercised in an integration test once DATABASE_URL lands in CI.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const startHandler = require(path.join(ROOT, 'lib', 'handlers', 'start'));
const goodsDb = require(path.join(ROOT, 'lib', 'db', 'goods'));

// ── getGoodsBySku contract ────────────────────────────────────────────

test('getGoodsBySku rejects malformed input (validation precedes PG check)', async () => {
  const r1 = await goodsDb.getGoodsBySku({ orgId: 'abc', sku: 'X' });
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => /orgId/i.test(e)));

  const r2 = await goodsDb.getGoodsBySku({ orgId: 7, sku: '' });
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => /sku/i.test(e)));
});

test('getGoodsBySku returns "Postgres not configured" when DATABASE_URL is unset', async () => {
  const r = await goodsDb.getGoodsBySku({ orgId: 7, sku: 'WIDGET-001' });
  assert.equal(r.ok, false);
  // Validation error wins if input is bad; here orgId + sku are valid,
  // so we hit the PG-not-configured branch.
  assert.match(r.errors[0], /Postgres not configured/i);
});

test('getGoodsBySku is exported from lib/db/goods', () => {
  assert.equal(typeof goodsDb.getGoodsBySku, 'function');
});

// ── resolveGoodsMasterInheritance — anon / no-SKU paths ───────────────

test('resolveGoodsMasterInheritance: no SKU → no inheritance, body unchanged', async () => {
  const body = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL' };
  const result = await startHandler.resolveGoodsMasterInheritance({ headers: {} }, body);
  assert.equal(result.inheritance, null);
  assert.strictEqual(result.body, body, 'body must be returned identically when no SKU is present');
});

test('resolveGoodsMasterInheritance: empty SKU string → no inheritance', async () => {
  const body = { sku: '', productCategory: 'apparel' };
  const result = await startHandler.resolveGoodsMasterInheritance({ headers: {} }, body);
  assert.equal(result.inheritance, null);
});

test('resolveGoodsMasterInheritance: SKU present, no session cookie → no inheritance', async () => {
  // auth.getCurrentUser returns null/throws when there's no session.
  // The helper must degrade silently (preserves the anonymous-user funnel).
  const body = { sku: 'WIDGET-001', productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL' };
  const result = await startHandler.resolveGoodsMasterInheritance(
    { headers: {}, url: '/api/start' },
    body,
  );
  assert.equal(result.inheritance, null);
  // body is returned (possibly the same reference, possibly enriched).
  // Since no inheritance happened, fields should be intact.
  assert.equal(result.body.sku, 'WIDGET-001');
  assert.equal(result.body.productCategory, 'apparel');
});

test('resolveGoodsMasterInheritance: null body → handled gracefully', async () => {
  // Defensive: composePlan would error on a null body, but the helper
  // must not throw before that — anonymous-funnel must always work.
  const result = await startHandler.resolveGoodsMasterInheritance({ headers: {} }, null);
  assert.equal(result.inheritance, null);
  assert.equal(result.body, null);
});

// ── composePlan path is unaffected by missing inheritance ─────────────

test('composePlan still produces a valid plan when no inheritance applies', async () => {
  const plan = await startHandler.composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
    linesCount: 2,
  });
  assert.equal(plan.ok, true, `composePlan must succeed: ${JSON.stringify(plan.errors)}`);
  // plan.goodsMasterInheritance is set by the HANDLER, not composePlan,
  // so composePlan output should never carry it.
  assert.equal(plan.goodsMasterInheritance, undefined);
});

// ── Module surface ────────────────────────────────────────────────────

test('lib/handlers/start.js exports resolveGoodsMasterInheritance for downstream callers + tests', () => {
  assert.equal(typeof startHandler.resolveGoodsMasterInheritance, 'function');
});

test('lib/handlers/start.js still exports composePlan + validateInput (no regression on existing surface)', () => {
  assert.equal(typeof startHandler.composePlan, 'function');
  assert.equal(typeof startHandler.validateInput, 'function');
});
