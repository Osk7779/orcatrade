'use strict';

// PR #146: end-to-end test for the routing-quote Eurostat freight
// integration on /api/start. When Eurostat returns a fresh water-
// transport-PPI observation for EU27_2020, plan.routing.tier_a should
// flip eligible:false → eligible:true. This is the LAST wedge in the
// Tier-A primary-regulator surface — the customer-facing wizard now
// emits eligible:true on every calculator when its primary source is
// available.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const startHandler = require(path.join(ROOT, 'lib', 'handlers', 'start'));
const greenState = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a', 'green-state'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));

const { composePlan } = startHandler;

const VALID_INPUT = Object.freeze({
  productCategory: 'apparel',
  originCountry: 'CN',
  destinationCountry: 'DE',
  customsValueEur: 25000,
  weightKg: 800,
  linesCount: 2,
  urgencyWeeks: 12,
  claimPreferential: false,
});

test('composePlan still attaches plan.routing.tier_a (PR #115 invariant)', async () => {
  kv._resetMemoryStore();
  const plan = await composePlan(VALID_INPUT);
  assert.ok(plan.routing);
  assert.ok(plan.routing.tier_a);
  assert.equal(typeof plan.routing.tier_a.eligible, 'boolean');
});

test('without Eurostat KV seed, routing tier_a stays eligible:false (sync mirror)', async () => {
  kv._resetMemoryStore();
  const plan = await composePlan(VALID_INPUT);
  assert.equal(plan.routing.tier_a.eligible, false);
});

test('with Eurostat KV seeded for EU27_2020, plan.routing.tier_a flips eligible:true', async () => {
  kv._resetMemoryStore();
  await greenState.stampLastGreenAt('routing-quote');
  const now = new Date();
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  const period = `${now.getUTCFullYear()}-Q${quarter}`;
  const isoMonth = String((quarter - 1) * 3 + 1).padStart(2, '0');
  const asOf = `${now.getUTCFullYear()}-${isoMonth}-01T00:00:00.000Z`;
  await kv.set('eurostat-freight:EU27_2020', {
    area: 'EU27_2020',
    asOfPeriod: period,
    asOf,
    source: 'eurostat-freight-ppi',
    nace: 'H50',
    seasonalAdjustment: 'NSA',
    baseYear: 2015,
    indexValue: 145.8,
  });
  const plan = await composePlan(VALID_INPUT);
  assert.equal(plan.routing.tier_a.eligible, true,
    `expected eligible:true; got: ${JSON.stringify(plan.routing.tier_a)}`);
});

// Drift guards
const startSrc = fs.readFileSync(
  path.join(ROOT, 'lib', 'handlers', 'start.js'),
  'utf8',
);

test('start.js awaits routing.calculateQuoteAsync (NOT sync) at the primary call site', () => {
  assert.match(startSrc, /await routing\.calculateQuoteAsync\(/);
});

test('start.js passes freightArea: EU27_2020 to routing async surface', () => {
  assert.match(startSrc, /freightArea: 'EU27_2020'/);
});

test('routing-quote still exports both sync + async (no breaking change)', () => {
  const r = require(path.join(ROOT, 'lib', 'intelligence', 'routing-quote'));
  assert.equal(typeof r.calculateQuote, 'function');
  assert.equal(typeof r.calculateQuoteAsync, 'function');
});

// Wedge-completion guard: the three calculator surfaces wired to
// Eurostat (routing) and ECB (finance) primary sources by this PR
// chain flip together on the same composePlan call when seeds are
// present. (Customs + sourcing require valid HS-code lookups whose
// upstream contracts live in separate clients; their flip is verified
// in their own integration tests — start-customs-* and start-sourcing-*.)
test('Tier-A primary-source closure: routing + finance + warehouse all flip when seeded together', async () => {
  kv._resetMemoryStore();
  for (const calc of ['finance-quote', 'warehouse-quote', 'routing-quote']) {
    await greenState.stampLastGreenAt(calc);
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  const period = `${now.getUTCFullYear()}-Q${quarter}`;
  const isoMonth = String((quarter - 1) * 3 + 1).padStart(2, '0');
  const asOf = `${now.getUTCFullYear()}-${isoMonth}-01T00:00:00.000Z`;

  await kv.set(`ecb-fx:CNY:${today}`, {
    currency: 'CNY', asOfDate: today, asOf: `${today}T00:00:00.000Z`,
    source: 'ecb-fx', unitsPerEur: 7.60, eurPerUnit: 1 / 7.60,
  });
  await kv.set('eurostat-warehousing:EU27_2020', {
    area: 'EU27_2020', asOfPeriod: period, asOf, source: 'eurostat-warehousing-ppi',
    nace: 'H52', seasonalAdjustment: 'NSA', baseYear: 2015, indexValue: 132.4,
  });
  await kv.set('eurostat-freight:EU27_2020', {
    area: 'EU27_2020', asOfPeriod: period, asOf, source: 'eurostat-freight-ppi',
    nace: 'H50', seasonalAdjustment: 'NSA', baseYear: 2015, indexValue: 145.8,
  });

  const plan = await composePlan({
    ...VALID_INPUT,
    monthlyOrders: 2000,
    avgUnitsPerOrder: 1.8,
    avgLinesPerOrder: 1.4,
    avgPalletsHeld: 40,
    avgOrderWeightKg: 1.2,
  });

  assert.equal(plan.routing.tier_a.eligible, true,
    `routing should be eligible:true; got ${JSON.stringify(plan.routing.tier_a)}`);
  assert.equal(plan.finance.tier_a.eligible, true,
    `finance should be eligible:true; got ${JSON.stringify(plan.finance.tier_a)}`);
  assert.equal(plan.warehouse.tier_a.eligible, true,
    `warehouse should be eligible:true; got ${JSON.stringify(plan.warehouse.tier_a)}`);
});
