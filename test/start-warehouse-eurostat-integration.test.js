'use strict';

// PR #144: end-to-end test for the warehouse-quote Eurostat
// integration on /api/start. When Eurostat returns a fresh
// warehousing-PPI observation for EU27_2020, plan.warehouse.tier_a
// should flip eligible:false → eligible:true.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const startHandler = require(path.join(ROOT, 'lib', 'handlers', 'start'));
const greenState = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a', 'green-state'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));

const { composePlan } = startHandler;

// monthlyOrders triggers the warehouse branch (≥100).
const VALID_INPUT = Object.freeze({
  productCategory: 'apparel',
  originCountry: 'CN',
  destinationCountry: 'DE',
  customsValueEur: 25000,
  weightKg: 800,
  linesCount: 2,
  urgencyWeeks: 12,
  claimPreferential: false,
  monthlyOrders: 2000,
  avgUnitsPerOrder: 1.8,
  avgLinesPerOrder: 1.4,
  avgPalletsHeld: 40,
  avgOrderWeightKg: 1.2,
});

test('composePlan still attaches plan.warehouse.tier_a (PR #120 invariant)', async () => {
  kv._resetMemoryStore();
  const plan = await composePlan(VALID_INPUT);
  assert.ok(plan.warehouse);
  assert.ok(plan.warehouse.tier_a);
  assert.equal(typeof plan.warehouse.tier_a.eligible, 'boolean');
});

test('without Eurostat KV seed, warehouse tier_a stays eligible:false (sync mirror)', async () => {
  kv._resetMemoryStore();
  const plan = await composePlan(VALID_INPUT);
  assert.equal(plan.warehouse.tier_a.eligible, false);
});

test('with Eurostat KV seeded for EU27_2020, plan.warehouse.tier_a flips eligible:true', async () => {
  kv._resetMemoryStore();
  // Stamp last-green at a time within 30 days of the Eurostat snapshot.
  await greenState.stampLastGreenAt('warehouse-quote');
  // The snapshot itself is set to today's quarter so the TA-1 fresh-
  // snapshot check passes too. We just take "today" from the system
  // clock the same way start.js does. (Note: the calculator-itself
  // never reads the clock; start.js owns clock reads.)
  const now = new Date();
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  const period = `${now.getUTCFullYear()}-Q${quarter}`;
  const isoMonth = String((quarter - 1) * 3 + 1).padStart(2, '0');
  const asOf = `${now.getUTCFullYear()}-${isoMonth}-01T00:00:00.000Z`;
  await kv.set('eurostat-warehousing:EU27_2020', {
    area: 'EU27_2020',
    asOfPeriod: period,
    asOf,
    source: 'eurostat-warehousing-ppi',
    nace: 'H52',
    seasonalAdjustment: 'NSA',
    baseYear: 2015,
    indexValue: 132.4,
  });
  const plan = await composePlan(VALID_INPUT);
  assert.equal(plan.warehouse.tier_a.eligible, true,
    `expected eligible:true; got: ${JSON.stringify(plan.warehouse.tier_a)}`);
});

test('Below monthlyOrders threshold (50) → warehouse branch skipped, no async call needed', async () => {
  kv._resetMemoryStore();
  const plan = await composePlan({ ...VALID_INPUT, monthlyOrders: 50 });
  // Handler reports the skip explicitly; tier_a is absent because
  // there's no quote to evaluate against.
  assert.equal(plan.warehouse.skipped, true);
  assert.equal(plan.warehouse.tier_a, undefined);
});

// Drift guards
const startSrc = fs.readFileSync(
  path.join(ROOT, 'lib', 'handlers', 'start.js'),
  'utf8',
);

test('start.js awaits calculateQuoteAsync (NOT sync)', () => {
  assert.match(startSrc, /await warehouse\.calculateQuoteAsync\(/);
});

test('start.js passes ppiArea: EU27_2020 to warehouse async surface', () => {
  assert.match(startSrc, /ppiArea: 'EU27_2020'/);
});

test('warehouse-quote still exports both sync + async (no breaking change)', () => {
  const wh = require(path.join(ROOT, 'lib', 'intelligence', 'warehouse-quote'));
  assert.equal(typeof wh.calculateQuote, 'function');
  assert.equal(typeof wh.calculateQuoteAsync, 'function');
});
