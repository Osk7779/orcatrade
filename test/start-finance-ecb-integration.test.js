'use strict';

// PR #142: end-to-end test for the finance-quote ECB integration on
// /api/start. When ECB returns a fresh spot rate for the supplier-
// currency, plan.finance.tier_a should flip eligible:false →
// eligible:true.

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
  destinationCountry: 'PL',
  customsValueEur: 25000,
  weightKg: 800,
  linesCount: 2,
  urgencyWeeks: 12,
  claimPreferential: false,
});

test('composePlan still attaches plan.finance.tier_a (PR #116 invariant)', async () => {
  kv._resetMemoryStore();
  const plan = await composePlan(VALID_INPUT);
  assert.ok(plan.finance.tier_a);
  assert.equal(typeof plan.finance.tier_a.eligible, 'boolean');
});

test('without ECB KV seed, finance tier_a stays eligible:false (sync mirror)', async () => {
  kv._resetMemoryStore();
  const plan = await composePlan(VALID_INPUT);
  assert.equal(plan.finance.tier_a.eligible, false);
});

test('with ECB KV seeded for CNY+today, plan.finance.tier_a flips eligible:true', async () => {
  kv._resetMemoryStore();
  await greenState.stampLastGreenAt('finance-quote');
  const today = new Date().toISOString().slice(0, 10);
  await kv.set(`ecb-fx:CNY:${today}`, {
    currency: 'CNY',
    asOfDate: today,
    asOf: `${today}T00:00:00.000Z`,
    source: 'ecb-fx',
    unitsPerEur: 7.60,
    eurPerUnit: 1 / 7.60,
  });
  const plan = await composePlan(VALID_INPUT);
  assert.equal(plan.finance.tier_a.eligible, true,
    `expected eligible:true; got: ${JSON.stringify(plan.finance.tier_a)}`);
});

test('Unsupported origin currency (VND) → sync fallback, finance tier_a stays eligible:false', async () => {
  // VND isn't in COUNTRY_TO_CURRENCY → opts.fxCurrency undefined →
  // comparePaymentInstrumentsAsync falls back to sync.
  kv._resetMemoryStore();
  const plan = await composePlan({ ...VALID_INPUT, originCountry: 'VN' });
  assert.equal(plan.finance.tier_a.eligible, false);
});

// Drift guards
const startSrc = fs.readFileSync(
  path.join(ROOT, 'lib', 'handlers', 'start.js'),
  'utf8',
);

test('start.js awaits comparePaymentInstrumentsAsync (NOT sync)', () => {
  assert.match(startSrc, /await finance\.comparePaymentInstrumentsAsync\(/);
});

test('start.js maintains COUNTRY_TO_CURRENCY map (ECB-supported only)', () => {
  assert.match(startSrc, /const COUNTRY_TO_CURRENCY = \{/);
  assert.match(startSrc, /CN: 'CNY'/);
  assert.match(startSrc, /TR: 'TRY'/);
  // VND/BDT must NOT be there.
  assert.doesNotMatch(startSrc, /VN: 'VND'/);
  assert.doesNotMatch(startSrc, /BD: 'BDT'/);
});

test('start.js derives ecbDate via clock read (calculator stays deterministic)', () => {
  assert.match(startSrc, /const ecbDate = new Date\(\)\.toISOString\(\)\.slice\(0, 10\);/);
});

test('finance-quote still exports both sync + async (no breaking change)', () => {
  const finance = require(path.join(ROOT, 'lib', 'intelligence', 'finance-quote'));
  assert.equal(typeof finance.comparePaymentInstruments, 'function');
  assert.equal(typeof finance.comparePaymentInstrumentsAsync, 'function');
});
