// Sprint monitoring-v1 — the proactive monitoring rules engine
// (lib/intelligence/monitoring.js). Pure/calculator-grounded: recompute is
// injected, so these tests run without a network or the AI layer.

const test = require('node:test');
const assert = require('node:assert/strict');

const monitoring = require('../lib/intelligence/monitoring');

// A composePlan-shaped result extractSnapshot() can read.
function planResult({ landed, duty = 4000, vat = 11000, transport = 3000, brokerage = 150, ratePercent = 8 }) {
  return {
    ok: true,
    totals: { perShipmentLandedTotal: landed, dutyEur: duty, vatEur: vat, transportEur: transport, brokerageEur: brokerage },
    customs: { duty: { ratePercent } },
  };
}

const savedSnapshot = {
  asOf: '2026-01-01', perShipmentLandedTotal: 100000,
  dutyEur: 4000, vatEur: 11000, transportEur: 3000, brokerageEur: 150, dutyRatePct: 8,
};

// ── plan cost drift ─────────────────────────────────────

test('planCostDriftAlerts fires when landed cost moves ≥5%, attributes the driver', async () => {
  const plan = { id: 'pl_1', label: 'CN bikes', inputs: { productCategory: 'bicycles' }, snapshot: savedSnapshot, savedAt: '2026-01-01' };
  // Duty jumps 4000 → 12000 (an AD measure), landed 100k → 108k = +8%.
  const recomputePlan = async () => planResult({ landed: 108000, duty: 12000, ratePercent: 58.5 });
  const alerts = await monitoring.planCostDriftAlerts(plan, { recomputePlan });
  assert.equal(alerts.length, 1);
  const a = alerts[0];
  assert.equal(a.type, 'plan_cost_drift');
  assert.equal(a.severity, 'medium'); // 8% → medium (≥10% would be high)
  assert.match(a.title, /up 8%/);
  assert.equal(a.data.driver, 'duty'); // biggest mover
  assert.equal(a.dedupeKey, 'plan_cost_drift:pl_1');
});

test('planCostDriftAlerts: ≥10% move is high severity', async () => {
  const plan = { id: 'pl_2', snapshot: savedSnapshot, savedAt: '2026-01-01', inputs: {} };
  const recomputePlan = async () => planResult({ landed: 115000, duty: 19000 });
  const alerts = await monitoring.planCostDriftAlerts(plan, { recomputePlan });
  assert.equal(alerts[0].severity, 'high');
});

test('planCostDriftAlerts: sub-5% move is silent', async () => {
  const plan = { id: 'pl_3', snapshot: savedSnapshot, savedAt: '2026-01-01', inputs: {} };
  const recomputePlan = async () => planResult({ landed: 102000 }); // +2%
  assert.deepEqual(await monitoring.planCostDriftAlerts(plan, { recomputePlan }), []);
});

test('planCostDriftAlerts: no baseline snapshot → no alert (nothing to diff)', async () => {
  const plan = { id: 'pl_4', inputs: {}, savedAt: '2026-01-01' };
  const recomputePlan = async () => planResult({ landed: 200000 });
  assert.deepEqual(await monitoring.planCostDriftAlerts(plan, { recomputePlan }), []);
});

test('planCostDriftAlerts: a failed recompute never throws', async () => {
  const plan = { id: 'pl_5', snapshot: savedSnapshot, savedAt: '2026-01-01', inputs: {} };
  const recomputePlan = async () => { throw new Error('TARIC down'); };
  assert.deepEqual(await monitoring.planCostDriftAlerts(plan, { recomputePlan }), []);
});

// ── FX exposure ─────────────────────────────────────────

test('fxExposureAlerts fires for an unhedged volatile non-EUR plan', () => {
  // TRY is a high-vol currency in the snapshot → recommendation "hedge".
  const plan = { id: 'pl_fx', label: 'TR steel', inputs: { quoteCurrency: 'TRY', customsValueEur: 100000, paymentTermsDays: 90 } };
  const alerts = monitoring.fxExposureAlerts(plan);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'fx_exposure');
  assert.equal(alerts[0].data.currency, 'TRY');
  assert.match(alerts[0].dedupeKey, /^fx_exposure:pl_fx:TRY$/);
});

test('fxExposureAlerts is silent for EUR-settled plans', () => {
  const plan = { id: 'pl_eur', inputs: { quoteCurrency: 'EUR', customsValueEur: 100000 } };
  assert.deepEqual(monitoring.fxExposureAlerts(plan), []);
});

// ── compliance deadlines ────────────────────────────────

test('complianceDeadlineAlerts surfaces critical/high CBAM/EUDR obligations only', () => {
  // CBAM-relevant import (steel ex-CN). asOf near a quarterly CBAM deadline.
  const planInputs = [{ productCategory: 'steel', hsCode: '720851', originCountry: 'CN', destinationCountry: 'DE', customsValueEur: 200000 }];
  const alerts = monitoring.complianceDeadlineAlerts(planInputs, { asOf: '2026-01-20' });
  for (const a of alerts) {
    assert.equal(a.type, 'compliance_deadline');
    assert.ok(['critical', 'high'].includes(a.severity));
    assert.match(a.dedupeKey, /^compliance_deadline:/);
  }
});

// ── sanctions list delta ────────────────────────────────

test('sanctionsUpdateAlerts fires only when the shared context flags a change', () => {
  const none = monitoring.sanctionsUpdateAlerts({ sanctionsChanged: false });
  assert.deepEqual(none, []);

  const changed = monitoring.sanctionsUpdateAlerts({
    sanctionsChanged: true,
    sanctionsFingerprint: 'abc123',
    sanctions: { totalCount: 39813, sources: [{ source: 'UN', count: 1002 }] },
    sanctionsPrevTotal: 38811,
  });
  assert.equal(changed.length, 1);
  assert.equal(changed[0].type, 'sanctions_list_update');
  assert.equal(changed[0].severity, 'info');
  assert.equal(changed[0].dedupeKey, 'sanctions_list_update:abc123');
});

test('sanctionsFingerprint is stable + order-independent', () => {
  const a = monitoring.sanctionsFingerprint({ authoritative: true, totalCount: 3, sources: [{ source: 'UN', count: 1 }, { source: 'OFAC', count: 2 }] });
  const b = monitoring.sanctionsFingerprint({ authoritative: true, totalCount: 3, sources: [{ source: 'OFAC', count: 2 }, { source: 'UN', count: 1 }] });
  assert.equal(a, b);
  assert.equal(monitoring.sanctionsFingerprint({ authoritative: false }), null);
});

// ── evaluateUser end-to-end (with stubs) ────────────────

test('evaluateUser aggregates alerts across rules', async () => {
  const plans = [
    { id: 'pl_a', label: 'CN bikes', inputs: { productCategory: 'bicycles', quoteCurrency: 'TRY', customsValueEur: 100000 }, snapshot: savedSnapshot, savedAt: '2026-01-01' },
  ];
  const recomputePlan = async () => planResult({ landed: 112000, duty: 16000 }); // +12% → high drift
  const candidates = await monitoring.evaluateUser(
    { plans, portfolios: [] },
    { sanctionsChanged: true, sanctionsFingerprint: 'fp1', sanctions: { totalCount: 100, sources: [] } },
    { recomputePlan, asOf: '2026-01-20' },
  );
  const types = candidates.map((c) => c.type);
  assert.ok(types.includes('plan_cost_drift'));
  assert.ok(types.includes('fx_exposure'));
  assert.ok(types.includes('sanctions_list_update'));
});

test('EMAILABLE_TYPES excludes compliance_deadline (owns a separate email stream)', () => {
  assert.ok(monitoring.EMAILABLE_TYPES.has('plan_cost_drift'));
  assert.ok(monitoring.EMAILABLE_TYPES.has('fx_exposure'));
  assert.ok(monitoring.EMAILABLE_TYPES.has('sanctions_list_update'));
  assert.ok(!monitoring.EMAILABLE_TYPES.has('compliance_deadline'));
});
