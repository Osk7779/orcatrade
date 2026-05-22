// Sourcing Agent — tool-implementation tests.

const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../lib/handlers/sourcing-agent');
const { TOOLS, toolImpls } = handler;

test('TOOLS exposes 7 named tool schemas', () => {
  assert.equal(Array.isArray(TOOLS), true);
  assert.equal(TOOLS.length, 7);
  const names = TOOLS.map(t => t.name).sort();
  assert.deepEqual(names, [
    'assessSourcingRisk',
    'compareSourcingCountries',
    'estimateSourcingLeadTime',
    'listSupplierShortlist',
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

// ── Tool behaviour tests ─────────────────────────────────

test('compareSourcingCountries returns ranked recommendation', () => {
  const r = toolImpls.compareSourcingCountries({
    productCategory: 'apparel', targetFobUnitEur: 4, moq: 2000, urgencyWeeks: 16, costPriority: 'balanced',
  });
  assert.equal(r.ok, true);
  assert.ok(r.recommendation.primary);
  assert.equal(r.comparison.length, 5);
});

test('assessSourcingRisk returns risk profile + audit recommendation', () => {
  const r = toolImpls.assessSourcingRisk({ productCategory: 'electronics', country: 'CN' });
  assert.equal(r.qualityRisk, 'low');
  assert.equal(r.ipRisk, 'high');
  assert.match(r.auditRecommendation, /audit|inspection/i);
});

test('estimateSourcingLeadTime computes total weeks', () => {
  const r = toolImpls.estimateSourcingLeadTime({
    productCategory: 'apparel', country: 'TR', moq: 1000,
  });
  assert.equal(r.totalWeeks, 5); // 4 production + 1 sea (TR advantage)
});

test('listSupplierShortlist returns curated examples', () => {
  const r = toolImpls.listSupplierShortlist({ productCategory: 'apparel', country: 'CN' });
  assert.ok(r.suppliers.length > 0);
});

test('lookupHsCode returns low-confidence placeholder', () => {
  const r = toolImpls.lookupHsCode({ productDescription: 'cotton t-shirt' });
  assert.equal(r.confidence, 0);
});

test('searchRegulations returns hits for EUDR wood query', async () => {
  const r = await toolImpls.searchRegulations({ query: 'EUDR wood traceability', regulationIds: ['eudr'], topK: 3 });
  assert.ok(r.hits.length > 0);
});

test('requestHumanReview returns ticket id with sourcing prefix', () => {
  const r = toolImpls.requestHumanReview({
    reason: 'First PO above €20k for VN furniture',
    severity: 'major',
  });
  assert.match(r.ticketId, /^tkt_src_/);
});
