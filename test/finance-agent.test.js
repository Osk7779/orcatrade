// Finance Agent — tool-implementation tests.

const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../lib/handlers/finance-agent');
const { TOOLS, toolImpls } = handler;

test('TOOLS exposes 8 named tool schemas', () => {
  assert.equal(TOOLS.length, 8);
  const names = TOOLS.map(t => t.name).sort();
  assert.deepEqual(names, [
    'assessTradeCreditCover',
    'calculateWorkingCapitalCycle',
    'comparePaymentInstruments',
    'estimateFxHedgingCost',
    'estimateLcCost',
    'lookupHsCode',
    'requestHumanReview',
    'searchRegulations',
  ]);
});

test('Every TOOL has description and input_schema', () => {
  for (const t of TOOLS) {
    assert.ok(t.description && t.description.length > 30);
    assert.ok(t.input_schema && t.input_schema.type === 'object');
  }
});

test('toolImpls covers every TOOL', () => {
  for (const t of TOOLS) {
    assert.equal(typeof toolImpls[t.name], 'function');
  }
});

test('comparePaymentInstruments via agent returns recommendation', () => {
  const r = toolImpls.comparePaymentInstruments({ amountEur: 40000, supplierRelationshipMonths: 3 });
  assert.equal(r.ok, true);
  assert.ok(r.recommendation.preferredKey);
});

test('estimateLcCost via agent returns total + percentage', () => {
  const r = toolImpls.estimateLcCost({ amountEur: 100000, durationMonths: 6, confirmed: true });
  assert.equal(r.ok, true);
  assert.ok(r.totalEur > 0);
  assert.ok(r.allInPercent > 0);
});

test('estimateFxHedgingCost via agent returns cost + 1-sigma risk', () => {
  const r = toolImpls.estimateFxHedgingCost({ amountEur: 50000, currencyPair: 'EUR_CNY', durationDays: 90 });
  assert.equal(r.ok, true);
  assert.ok(r.hedgingCostEur > 0);
  assert.ok(r.unhedgedRiskOneSigmaEur > 0);
});

test('calculateWorkingCapitalCycle via agent returns cycle + carry cost', () => {
  const r = toolImpls.calculateWorkingCapitalCycle({ dioDays: 60, dsoDays: 30, dpoDays: 20 });
  assert.equal(r.ok, true);
  assert.equal(r.cycleDays, 70);
});

test('assessTradeCreditCover via agent returns premium', () => {
  const r = toolImpls.assessTradeCreditCover({ buyerCountry: 'DE', buyerSizeBracket: 'tier1', exposureEur: 80000 });
  assert.equal(r.ok, true);
  assert.ok(r.annualPremiumEur > 0);
});

test('lookupHsCode returns low-confidence placeholder', () => {
  const r = toolImpls.lookupHsCode({ productDescription: 'cotton t-shirt' });
  assert.equal(r.confidence, 0);
});

test('searchRegulations returns hits for capital controls query', () => {
  const r = toolImpls.searchRegulations({ query: 'CBAM certificate cost', topK: 3 });
  assert.ok(r.hits.length > 0);
});

test('requestHumanReview returns ticket id with finance prefix', () => {
  const r = toolImpls.requestHumanReview({
    reason: 'LC issuance above €100k',
    severity: 'major',
    handoffTo: 'banking_partner',
  });
  assert.match(r.ticketId, /^tkt_fin_/);
  assert.equal(r.handoffTo, 'banking_partner');
});
