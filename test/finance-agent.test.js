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

test('lookupHsCode returns a real suggestion via lib/intelligence/hs-code-lookup', async () => {
  // P0.11: replaces the prior `confidence: 0` placeholder. Calculator-
  // grounded module returns ranked HS6 candidates + a confidence tier
  // — never null suggestion for well-known queries.
  const r = await toolImpls.lookupHsCode({ productDescription: 'cotton t-shirt' });
  assert.ok(r.suggestion, 'expected a suggestion');
  assert.match(r.suggestion.hs6, /^6109/);
  assert.ok(r.confidence > 0);
  assert.ok(['high', 'medium', 'low'].includes(r.confidenceTier));
  assert.match(r.verifyUrl, /taric\.ec\.europa\.eu/);
});

test('searchRegulations returns hits for capital controls query', async () => {
  const r = await toolImpls.searchRegulations({ query: 'CBAM certificate cost', topK: 3 });
  assert.ok(r.hits.length > 0);
});

test('requestHumanReview returns a queued ticket id (lib/human-review)', async () => {
  // Post P0.10: ticket ids are minted by lib/human-review.js (KV-backed
  // queue) and follow `tkt_<base36-time>_<8hex>`. The old per-agent prefix
  // (`tkt_fin_…`) was a placeholder before the real queue existed.
  const r = await toolImpls.requestHumanReview({
    reason: 'LC issuance above €100k',
    severity: 'major',
    handoffTo: 'banking_partner',
  });
  assert.match(r.ticketId, /^tkt_[a-z0-9]+_[0-9a-f]{8}$/);
  assert.equal(r.handoffTo, 'banking_partner');
});
