// Logistics Agent — tool-implementation tests.
// Network-free: validates each tool wrapper returns the expected shape against the
// underlying calculators. The full SSE / Anthropic loop is exercised separately
// via scripts/logistics-agent-eval.js.

const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../lib/handlers/logistics-agent');
const { TOOLS, toolImpls } = handler;

// ── Tool catalogue ───────────────────────────────────────

test('TOOLS exposes 8 named tool schemas', () => {
  assert.equal(Array.isArray(TOOLS), true);
  assert.equal(TOOLS.length, 8);
  const names = TOOLS.map(t => t.name).sort();
  assert.deepEqual(names, [
    'compareTransportModes',
    'compareWarehouseHubs',
    'estimateLandedCost',
    'getDestinationVatRate',
    'lookupHsCode',
    'recommendShipmentPlan',
    'requestHumanReview',
    'searchRegulations',
  ]);
});

test('Every TOOL has a description and input_schema', () => {
  for (const t of TOOLS) {
    assert.ok(t.description && t.description.length > 30, `${t.name} has substantial description`);
    assert.ok(t.input_schema && t.input_schema.type === 'object', `${t.name} has object input_schema`);
    assert.ok(t.input_schema.properties, `${t.name} declares properties`);
  }
});

test('toolImpls covers every TOOL by name', () => {
  for (const t of TOOLS) {
    assert.equal(typeof toolImpls[t.name], 'function', `${t.name} has implementation`);
  }
});

// ── compareTransportModes ────────────────────────────────

test('compareTransportModes returns 4 modes for CN→DE', () => {
  const r = toolImpls.compareTransportModes({
    weightKg: 800, volumeCbm: 3, originCountry: 'CN', destinationCountry: 'DE',
  });
  assert.equal(r.ok, true);
  assert.equal(r.modes.length, 4);
  for (const m of r.modes) {
    assert.ok(['sea_fcl', 'sea_lcl', 'air', 'rail'].includes(m.mode));
    assert.equal(typeof m.viable, 'boolean');
    assert.ok('totalEur' in m);
    assert.ok('co2kg' in m);
  }
  assert.ok(r.recommendation);
});

test('compareTransportModes flags rail unavailable for VN origin', () => {
  const r = toolImpls.compareTransportModes({
    weightKg: 800, volumeCbm: 3, originCountry: 'VN', destinationCountry: 'DE',
  });
  const rail = r.modes.find(m => m.mode === 'rail');
  assert.equal(rail.viable, false);
  assert.match(rail.viabilityReason, /China-Europe|rail/i);
});

test('compareTransportModes returns errors for malformed input', () => {
  const r = toolImpls.compareTransportModes({ weightKg: 0, originCountry: '', destinationCountry: '' });
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.errors));
});

// ── estimateLandedCost ───────────────────────────────────

test('estimateLandedCost returns standard + bonded for CN apparel→DE', () => {
  const r = toolImpls.estimateLandedCost({
    customsValueEur: 25000, hsCode: '6203', destinationCountry: 'DE',
    originCountry: 'CN', linesCount: 4, bondedDays: 30, bondedVolumeCbm: 5,
    releaseStrategy: 'free_circulation',
  });
  assert.equal(r.ok, true);
  assert.equal(r.standard.routeKey, 'standard_clearance');
  assert.equal(r.bonded.routeKey, 'bonded_warehouse');
  assert.ok(r.duty.ratePercent > 0);
  assert.equal(r.vat.country, 'Germany');
  assert.ok(r.recommendation);
});

test('estimateLandedCost VN preferential drops the duty rate', () => {
  const cn = toolImpls.estimateLandedCost({
    customsValueEur: 25000, hsCode: '6203', destinationCountry: 'DE',
    originCountry: 'CN', linesCount: 4,
  });
  const vn = toolImpls.estimateLandedCost({
    customsValueEur: 25000, hsCode: '6203', destinationCountry: 'DE',
    originCountry: 'VN', linesCount: 4, claimPreferential: true,
  });
  assert.ok(vn.duty.ratePercent < cn.duty.ratePercent);
});

test('estimateLandedCost returns errors for non-EU destination', () => {
  const r = toolImpls.estimateLandedCost({
    customsValueEur: 1000, hsCode: '6203', destinationCountry: 'US',
  });
  assert.equal(r.ok, false);
});

// ── compareWarehouseHubs ─────────────────────────────────

test('compareWarehouseHubs returns 6 hubs sorted by cost', () => {
  const r = toolImpls.compareWarehouseHubs({
    monthlyOrders: 1500, avgUnitsPerOrder: 1.5, avgLinesPerOrder: 1.2,
    avgPalletsHeld: 50, avgOrderWeightKg: 2, primaryDestination: 'DE',
  });
  assert.equal(r.ok, true);
  assert.equal(r.hubs.length, 6);
  // Sorted ascending by totalMonthlyEur
  for (let i = 1; i < r.hubs.length; i++) {
    assert.ok(r.hubs[i].totalMonthlyEur >= r.hubs[i - 1].totalMonthlyEur);
  }
  assert.ok(r.recommendation);
});

test('compareWarehouseHubs picks Iberian hub for ES destination', () => {
  const r = toolImpls.compareWarehouseHubs({
    monthlyOrders: 1500, avgUnitsPerOrder: 1.5, avgLinesPerOrder: 1.2,
    avgPalletsHeld: 50, avgOrderWeightKg: 2, primaryDestination: 'ES',
  });
  assert.equal(r.recommendation.primary, 'ES_BCN');
});

// ── recommendShipmentPlan (orchestrator) ─────────────────

test('recommendShipmentPlan composes routing + customs (no warehouse if missing)', () => {
  const r = toolImpls.recommendShipmentPlan({
    weightKg: 800, originCountry: 'CN', destinationCountry: 'DE',
    customsValueEur: 25000, hsCode: '6203', linesCount: 4,
  });
  assert.equal(r.ok, true);
  assert.ok(r.shipment.modeQuote);
  assert.ok(r.clearance.recommendedRoute);
  assert.equal(r.warehouse.skipped, true);
  assert.ok(r.totals.perShipmentLandedTotal > 0);
});

test('recommendShipmentPlan includes warehouse leg when monthly profile is provided', () => {
  const r = toolImpls.recommendShipmentPlan({
    weightKg: 5000, originCountry: 'VN', destinationCountry: 'FR',
    customsValueEur: 42000, hsCode: '94', linesCount: 6,
    monthlyOrders: 1500, avgUnitsPerOrder: 1.8, avgLinesPerOrder: 1.3,
    avgPalletsHeld: 90, avgOrderWeightKg: 1.5,
    claimPreferential: true,
  });
  assert.equal(r.ok, true);
  assert.ok(r.warehouse.recommendation);
  assert.ok(r.warehouse.recommendedHub);
  assert.ok(r.totals.warehouseMonthlyEur > 0);
});

test('recommendShipmentPlan: per-shipment landed total = transport + customs value + duty + vat + brokerage', () => {
  const r = toolImpls.recommendShipmentPlan({
    weightKg: 800, originCountry: 'CN', destinationCountry: 'DE',
    customsValueEur: 25000, hsCode: '6203', linesCount: 4,
  });
  const expected = r.totals.transportEur + r.totals.customsValueEur + r.totals.dutyEur + r.totals.vatEur + r.totals.brokerageEur;
  assert.ok(Math.abs(r.totals.perShipmentLandedTotal - expected) < 1, 'totals reconcile within rounding');
});

// ── getDestinationVatRate ─────────────────────────────────

test('getDestinationVatRate returns rate + name for DE', () => {
  const r = toolImpls.getDestinationVatRate({ country: 'DE' });
  assert.equal(r.country, 'DE');
  assert.equal(r.name, 'Germany');
  assert.equal(r.rate, 0.19);
  assert.equal(r.ratePercent, 19);
});

test('getDestinationVatRate errors on non-EU country', () => {
  const r = toolImpls.getDestinationVatRate({ country: 'US' });
  assert.ok(r.error);
});

// ── lookupHsCode (placeholder) ────────────────────────────

test('lookupHsCode returns low-confidence placeholder', () => {
  const r = toolImpls.lookupHsCode({ productDescription: 'cotton shirt' });
  assert.equal(r.confidence, 0);
  assert.ok(r.message);
});

// ── searchRegulations ─────────────────────────────────────

test('searchRegulations returns hits with chunkId for CBAM steel query', async () => {
  const r = await toolImpls.searchRegulations({ query: 'CBAM steel imports', regulationIds: ['cbam'], topK: 3 });
  assert.ok(Array.isArray(r.hits));
  assert.ok(r.hits.length > 0);
  for (const h of r.hits) {
    assert.ok(h.chunkId);
    assert.ok(h.regulation);
  }
});

// ── requestHumanReview ────────────────────────────────────

test('requestHumanReview returns ticket id and routes to handoff target', () => {
  const r = toolImpls.requestHumanReview({
    reason: 'Cargo > €50k forwarder booking in flight',
    severity: 'major',
    handoffTo: 'human_ops',
  });
  assert.match(r.ticketId, /^tkt_log_/);
  assert.equal(r.handoffTo, 'human_ops');
  assert.equal(r.severity, 'major');
});

test('requestHumanReview defaults handoffTo to human_ops', () => {
  const r = toolImpls.requestHumanReview({
    reason: 'Anti-dumping risk on CN steel',
    severity: 'moderate',
  });
  assert.equal(r.handoffTo, 'human_ops');
});
