// Plan-diff tests (Sprint 35).

const test = require('node:test');
const assert = require('node:assert/strict');

const planDiff = require('../lib/plan-diff');

// ── extractSnapshot ──────────────────────────────────

test('extractSnapshot: pulls totals + dutyRatePct from a composePlan result', () => {
  const plan = {
    asOf: '2026-05-08',
    totals: {
      perShipmentLandedTotal: 28425.5,
      dutyEur: 3000.2,
      vatEur: 5500,
      transportEur: 4500,
      brokerageEur: 425,
    },
    customs: { duty: { ratePercent: 12 } },
  };
  const s = planDiff.extractSnapshot(plan);
  assert.equal(s.asOf, '2026-05-08');
  assert.equal(s.perShipmentLandedTotal, 28425.5);
  assert.equal(s.dutyEur, 3000.2);
  assert.equal(s.vatEur, 5500);
  assert.equal(s.transportEur, 4500);
  assert.equal(s.brokerageEur, 425);
  assert.equal(s.dutyRatePct, 12);
});

test('extractSnapshot: defaults asOf to today when missing', () => {
  const s = planDiff.extractSnapshot({ totals: { perShipmentLandedTotal: 1000 } });
  assert.match(s.asOf, /^\d{4}-\d{2}-\d{2}$/);
});

test('extractSnapshot: returns null for non-object input', () => {
  assert.equal(planDiff.extractSnapshot(null), null);
  assert.equal(planDiff.extractSnapshot('nope'), null);
});

test('extractSnapshot: dutyRatePct defaults to null when customs missing', () => {
  const s = planDiff.extractSnapshot({ totals: { perShipmentLandedTotal: 1000 } });
  assert.equal(s.dutyRatePct, null);
});

// ── sanitiseSnapshot ─────────────────────────────────

test('sanitiseSnapshot: keeps only known fields', () => {
  const s = planDiff.sanitiseSnapshot({
    asOf: '2026-01-01',
    perShipmentLandedTotal: 100,
    arbitrary: 'x',
    __proto__: { polluted: true },
  });
  assert.equal(s.perShipmentLandedTotal, 100);
  assert.equal(s.asOf, '2026-01-01');
  assert.equal(s.arbitrary, undefined);
  assert.equal(s.polluted, undefined);
});

test('sanitiseSnapshot: returns null on null/empty input', () => {
  assert.equal(planDiff.sanitiseSnapshot(null), null);
  assert.equal(planDiff.sanitiseSnapshot({}), null);
  assert.equal(planDiff.sanitiseSnapshot({ unknown: 1 }), null);
});

// ── diffSnapshots ────────────────────────────────────

test('diffSnapshots: positive delta when current > saved', () => {
  const saved = { perShipmentLandedTotal: 10000, dutyEur: 1000, vatEur: 2300, transportEur: 4000, brokerageEur: 200, dutyRatePct: 10 };
  const current = { perShipmentLandedTotal: 11000, dutyEur: 1200, vatEur: 2300, transportEur: 4800, brokerageEur: 200, dutyRatePct: 12 };
  const d = planDiff.diffSnapshots(saved, current, new Date(Date.now() - 20 * 86400000).toISOString());
  assert.equal(d.landedDeltaEur, 1000);
  assert.equal(d.landedDeltaPct, 10);
  assert.equal(d.significant, true);
  assert.equal(d.primaryDriver, 'transport'); // +800 transport beats +200 duty
  assert.equal(d.components.dutyEur, 200);
  assert.equal(d.components.transportEur, 800);
  assert.equal(d.components.dutyRatePct, 2);
  assert.equal(d.daysSinceSaved >= 19 && d.daysSinceSaved <= 21, true);
});

test('diffSnapshots: negative delta when current < saved', () => {
  const saved = { perShipmentLandedTotal: 10000, dutyEur: 1000, vatEur: 2300, transportEur: 4000, brokerageEur: 200 };
  const current = { perShipmentLandedTotal: 9500, dutyEur: 800, vatEur: 2300, transportEur: 3900, brokerageEur: 200 };
  const d = planDiff.diffSnapshots(saved, current, new Date().toISOString());
  assert.equal(d.landedDeltaEur, -500);
  assert.equal(d.landedDeltaPct, -5);
  assert.equal(d.significant, true);
  assert.equal(d.primaryDriver, 'duty');
});

test('diffSnapshots: not significant below 5%', () => {
  const saved = { perShipmentLandedTotal: 10000, dutyEur: 1000, vatEur: 2300, transportEur: 4000, brokerageEur: 200 };
  const current = { perShipmentLandedTotal: 10200, dutyEur: 1000, vatEur: 2300, transportEur: 4200, brokerageEur: 200 };
  const d = planDiff.diffSnapshots(saved, current, new Date().toISOString());
  assert.equal(d.landedDeltaPct, 2);
  assert.equal(d.significant, false);
});

test('diffSnapshots: returns null when either side missing', () => {
  assert.equal(planDiff.diffSnapshots(null, { perShipmentLandedTotal: 10 }, new Date().toISOString()), null);
  assert.equal(planDiff.diffSnapshots({ perShipmentLandedTotal: 10 }, null, new Date().toISOString()), null);
});

test('diffSnapshots: handles zero saved total without divide-by-zero', () => {
  const d = planDiff.diffSnapshots(
    { perShipmentLandedTotal: 0, dutyEur: 0, vatEur: 0, transportEur: 0, brokerageEur: 0 },
    { perShipmentLandedTotal: 100, dutyEur: 50, vatEur: 0, transportEur: 50, brokerageEur: 0 },
    new Date().toISOString(),
  );
  assert.equal(d.landedDeltaEur, 100);
  assert.equal(d.landedDeltaPct, 0);
});

// ── enrichRecord ─────────────────────────────────────

test('enrichRecord: attaches current + delta when both sides present', () => {
  const record = {
    id: 'pl_test',
    savedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    snapshot: { perShipmentLandedTotal: 10000, dutyEur: 1000, vatEur: 2300, transportEur: 4000, brokerageEur: 200 },
  };
  const current = { perShipmentLandedTotal: 11000, dutyEur: 1200, vatEur: 2300, transportEur: 4800, brokerageEur: 200 };
  const enriched = planDiff.enrichRecord(record, current);
  assert.equal(enriched.id, 'pl_test'); // original fields preserved
  assert.deepEqual(enriched.current, current);
  assert.equal(enriched.delta.landedDeltaEur, 1000);
  // Non-mutating: original record untouched
  assert.equal(record.current, undefined);
  assert.equal(record.delta, undefined);
});

test('enrichRecord: returns current + null delta when no saved snapshot', () => {
  const record = { id: 'pl_legacy', savedAt: new Date().toISOString() };
  const current = { perShipmentLandedTotal: 5000 };
  const enriched = planDiff.enrichRecord(record, current);
  assert.deepEqual(enriched.current, current);
  assert.equal(enriched.delta, null);
});

test('enrichRecord: returns null current + null delta when no current', () => {
  const record = {
    id: 'pl_x',
    savedAt: new Date().toISOString(),
    snapshot: { perShipmentLandedTotal: 1000 },
  };
  const enriched = planDiff.enrichRecord(record, null);
  assert.equal(enriched.current, null);
  assert.equal(enriched.delta, null);
});

// ── daysBetween ──────────────────────────────────────

test('daysBetween: returns 0 for missing or invalid input', () => {
  assert.equal(planDiff.daysBetween(null), 0);
  assert.equal(planDiff.daysBetween('not-a-date'), 0);
});

test('daysBetween: counts whole days', () => {
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
  const days = planDiff.daysBetween(tenDaysAgo);
  assert.equal(days >= 9 && days <= 10, true);
});

// ── Sprint BG-0c: effectiveLandedTotal tracking ───────────

test('extractSnapshot: captures effectiveLandedTotal when present', () => {
  const plan = {
    asOf: '2026-05-17',
    totals: {
      perShipmentLandedTotal: 119000,
      effectiveLandedTotal: 100000,
      dutyEur: 12000, vatEur: 19000, transportEur: 3500, brokerageEur: 75,
    },
    customs: { duty: { ratePercent: 12 } },
  };
  const s = planDiff.extractSnapshot(plan);
  assert.equal(s.effectiveLandedTotal, 100000);
});

test('extractSnapshot: effectiveLandedTotal is null on legacy snapshots', () => {
  const plan = {
    totals: { perShipmentLandedTotal: 1000 }, // no effectiveLandedTotal
  };
  const s = planDiff.extractSnapshot(plan);
  assert.equal(s.effectiveLandedTotal, null);
});

test('diffSnapshots: surfaces effectiveLandedDeltaEur + Pct when both sides present', () => {
  const saved = {
    asOf: '2026-04-01', perShipmentLandedTotal: 119000, effectiveLandedTotal: 100000,
    dutyEur: 12000, vatEur: 19000, transportEur: 3500, brokerageEur: 75, dutyRatePct: 12,
  };
  const current = {
    asOf: '2026-05-17', perShipmentLandedTotal: 125000, effectiveLandedTotal: 105000,
    dutyEur: 13000, vatEur: 20000, transportEur: 3700, brokerageEur: 75, dutyRatePct: 13,
  };
  const d = planDiff.diffSnapshots(saved, current, '2026-04-01T00:00:00Z');
  assert.equal(d.effectiveLandedDeltaEur, 5000);
  assert.equal(d.effectiveLandedDeltaPct, 5);
});

test('diffSnapshots: effectiveLandedDelta is null when legacy snapshot lacks the field', () => {
  const saved = {
    asOf: '2026-04-01', perShipmentLandedTotal: 119000, effectiveLandedTotal: null,
    dutyEur: 12000, vatEur: 19000, transportEur: 3500, brokerageEur: 75, dutyRatePct: 12,
  };
  const current = {
    asOf: '2026-05-17', perShipmentLandedTotal: 125000, effectiveLandedTotal: 105000,
    dutyEur: 13000, vatEur: 20000, transportEur: 3700, brokerageEur: 75, dutyRatePct: 13,
  };
  const d = planDiff.diffSnapshots(saved, current);
  assert.equal(d.effectiveLandedDeltaEur, null);
  assert.equal(d.effectiveLandedDeltaPct, null);
  // Gross delta still computed normally.
  assert.equal(d.landedDeltaEur, 6000);
});

test('SNAPSHOT_FIELDS includes effectiveLandedTotal for sanitiseSnapshot to preserve it', () => {
  assert.ok(planDiff.SNAPSHOT_FIELDS.includes('effectiveLandedTotal'),
    'BG-0c relies on sanitiseSnapshot keeping the new field on round-trip');
  // Verify it actually round-trips.
  const round = planDiff.sanitiseSnapshot({
    asOf: '2026-05-17', perShipmentLandedTotal: 119000, effectiveLandedTotal: 100000,
    dutyEur: 12000, vatEur: 19000, transportEur: 3500, brokerageEur: 75, dutyRatePct: 12,
  });
  assert.equal(round.effectiveLandedTotal, 100000);
});
