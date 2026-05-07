// Operations Orchestrator — composition + tool-routing tests.
// Verifies the meta-agent merges Compliance + Logistics tools without duplication
// and exposes the same impl behaviours.

const test = require('node:test');
const assert = require('node:assert/strict');

const orchestrator = require('../api/orchestrator');
const compliance = require('../api/agent');
const logistics = require('../api/logistics-agent');
const sourcing = require('../api/sourcing-agent');
const finance = require('../api/finance-agent');

const { TOOLS, toolImpls, classifyTool } = orchestrator;

// ── Tool merge correctness ───────────────────────────────

test('Orchestrator exposes 25 unique tools (Compliance 11 + Logistics 8 + Sourcing 7 + Finance 8 - shared)', () => {
  assert.equal(TOOLS.length, 25);
  const allNames = new Set([
    ...compliance.TOOLS.map(t => t.name),
    ...logistics.TOOLS.map(t => t.name),
    ...sourcing.TOOLS.map(t => t.name),
    ...finance.TOOLS.map(t => t.name),
  ]);
  assert.equal(allNames.size, TOOLS.length);
});

test('Finance Agent tools are present in the Orchestrator', () => {
  const orchNames = new Set(TOOLS.map(t => t.name));
  for (const t of finance.TOOLS) {
    assert.ok(orchNames.has(t.name), `${t.name} from Finance Agent must be present`);
  }
});

test('classifyTool tags finance tools as "finance"', () => {
  for (const name of ['comparePaymentInstruments', 'estimateLcCost', 'estimateFxHedgingCost', 'calculateWorkingCapitalCycle', 'assessTradeCreditCover']) {
    assert.equal(classifyTool(name), 'finance', `${name} -> finance`);
  }
});

test('Sourcing Agent tools are present in the Orchestrator', () => {
  const orchNames = new Set(TOOLS.map(t => t.name));
  for (const t of sourcing.TOOLS) {
    assert.ok(orchNames.has(t.name), `${t.name} from Sourcing Agent must be present`);
  }
});

test('classifyTool tags sourcing tools as "sourcing"', () => {
  for (const name of ['compareSourcingCountries', 'assessSourcingRisk', 'estimateSourcingLeadTime', 'listSupplierShortlist']) {
    assert.equal(classifyTool(name), 'sourcing', `${name} -> sourcing`);
  }
});

test('No duplicate tool names in the merged set', () => {
  const names = TOOLS.map(t => t.name);
  const unique = new Set(names);
  assert.equal(unique.size, names.length);
});

test('Every Compliance Agent tool is present in the Orchestrator', () => {
  const orchNames = new Set(TOOLS.map(t => t.name));
  for (const t of compliance.TOOLS) {
    assert.ok(orchNames.has(t.name), `${t.name} from Compliance Agent must be present`);
  }
});

test('Every Logistics Agent tool is present in the Orchestrator', () => {
  const orchNames = new Set(TOOLS.map(t => t.name));
  for (const t of logistics.TOOLS) {
    assert.ok(orchNames.has(t.name), `${t.name} from Logistics Agent must be present`);
  }
});

test('Shared tools (lookupHsCode, searchRegulations, requestHumanReview) appear exactly once', () => {
  for (const shared of ['lookupHsCode', 'searchRegulations', 'requestHumanReview']) {
    const count = TOOLS.filter(t => t.name === shared).length;
    assert.equal(count, 1, `${shared} appears once`);
  }
});

test('toolImpls covers every TOOL by name', () => {
  for (const t of TOOLS) {
    assert.equal(typeof toolImpls[t.name], 'function', `${t.name} has implementation`);
  }
});

// ── classifyTool routing ─────────────────────────────────

test('classifyTool tags compliance tools as "compliance"', () => {
  for (const name of ['checkCbamApplicability', 'estimateCbamExposure', 'checkEudrApplicability', 'assessReachCompliance', 'checkCeApplicability']) {
    assert.equal(classifyTool(name), 'compliance', `${name} -> compliance`);
  }
});

test('classifyTool tags logistics tools as "logistics"', () => {
  for (const name of ['compareTransportModes', 'estimateLandedCost', 'compareWarehouseHubs', 'recommendShipmentPlan', 'getDestinationVatRate']) {
    assert.equal(classifyTool(name), 'logistics', `${name} -> logistics`);
  }
});

test('classifyTool tags shared tools as "shared"', () => {
  for (const name of ['lookupHsCode', 'requestHumanReview']) {
    assert.equal(classifyTool(name), 'shared', `${name} -> shared`);
  }
  // searchRegulations is in compliance set, not shared (it's most-used by compliance)
  assert.equal(classifyTool('searchRegulations'), 'compliance');
});

test('classifyTool returns null for unknown names', () => {
  assert.equal(classifyTool('unknownTool'), null);
});

// ── Tool implementations behave the same as specialists ──

test('compareTransportModes via Orchestrator returns 4 modes (CN→DE)', () => {
  const r = toolImpls.compareTransportModes({
    weightKg: 800, originCountry: 'CN', destinationCountry: 'DE',
  });
  assert.equal(r.ok, true);
  assert.equal(r.modes.length, 4);
});

test('estimateLandedCost via Orchestrator applies VN preferential when claimed', () => {
  const r = toolImpls.estimateLandedCost({
    customsValueEur: 25000, hsCode: '6203', destinationCountry: 'DE',
    originCountry: 'VN', linesCount: 4, claimPreferential: true,
  });
  assert.equal(r.ok, true);
  assert.ok(r.duty.ratePercent < 12, 'preferential lowers the 12% MFN rate');
});

test('checkCbamApplicability via Orchestrator returns the same result as via Compliance Agent', () => {
  const args = { productCategory: 'iron_and_steel', originCountry: 'CN' };
  const orchResult = toolImpls.checkCbamApplicability(args);
  const compResult = compliance.toolImpls.checkCbamApplicability(args);
  assert.deepEqual(orchResult, compResult);
});

test('searchRegulations via Orchestrator returns results across multiple regulations', () => {
  const r = toolImpls.searchRegulations({
    query: 'steel anti-dumping CBAM',
    regulationIds: ['cbam', 'eudr', 'reach', 'ce'],
    topK: 5,
  });
  assert.ok(Array.isArray(r.hits));
  assert.ok(r.hits.length > 0);
});

test('recommendShipmentPlan composes routing + customs + warehouse via Orchestrator', () => {
  const r = toolImpls.recommendShipmentPlan({
    weightKg: 5000, originCountry: 'VN', destinationCountry: 'FR',
    customsValueEur: 42000, hsCode: '94', linesCount: 6,
    monthlyOrders: 1500, avgUnitsPerOrder: 1.8, avgLinesPerOrder: 1.3,
    avgPalletsHeld: 90, avgOrderWeightKg: 1.5,
    claimPreferential: true,
  });
  assert.equal(r.ok, true);
  assert.ok(r.shipment.modeQuote);
  assert.ok(r.clearance.recommendedRoute);
  assert.ok(r.warehouse.recommendation);
});

test('requestHumanReview via Orchestrator generates a ticket id', () => {
  const r = toolImpls.requestHumanReview({
    reason: 'Cross-domain anti-dumping flag',
    severity: 'moderate',
    handoffTo: 'compliance_agent',
  });
  assert.ok(r.ticketId);
  assert.equal(r.severity, 'moderate');
});
