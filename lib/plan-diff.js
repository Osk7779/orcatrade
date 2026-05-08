// Plan-revision diff (Sprint 35).
//
// When a user revisits a saved plan, prices may have shifted: duty rates
// change quarterly, ocean freight monthly, FX daily. We snapshot the
// landed-cost components at save-time and recompute on view, so the
// /account/plans/ page can surface "what's changed since you saved this"
// callouts. The snapshot lives inside the saved-plan record (small —
// ~6 numbers + an asOf date) so the diff is a pure local operation.
//
// Public API:
//   extractSnapshot(plan)            → small {asOf, totals…} from a composePlan() result
//   diffSnapshots(saved, current)    → {daysSinceSaved, landedDeltaEur, landedDeltaPct, primaryDriver, significant, components}
//   enrichRecord(record, current)    → returns record + {current, delta} (non-mutating)

'use strict';

const SIGNIFICANT_PCT_THRESHOLD = 5; // ≥5% change flips `significant: true`

const SNAPSHOT_FIELDS = [
  'asOf',
  'perShipmentLandedTotal',
  'dutyEur',
  'vatEur',
  'transportEur',
  'brokerageEur',
  'dutyRatePct',
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function extractSnapshot(plan) {
  if (!plan || typeof plan !== 'object') return null;
  const t = plan.totals || {};
  const dutyRatePct = plan.customs && plan.customs.duty && Number.isFinite(Number(plan.customs.duty.ratePercent))
    ? Number(plan.customs.duty.ratePercent)
    : null;
  return {
    asOf: plan.asOf || new Date().toISOString().slice(0, 10),
    perShipmentLandedTotal: num(t.perShipmentLandedTotal),
    dutyEur: num(t.dutyEur),
    vatEur: num(t.vatEur),
    transportEur: num(t.transportEur),
    brokerageEur: num(t.brokerageEur),
    dutyRatePct,
  };
}

function sanitiseSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const out = {};
  for (const k of SNAPSHOT_FIELDS) {
    if (snapshot[k] !== undefined && snapshot[k] !== null) out[k] = snapshot[k];
  }
  return Object.keys(out).length ? out : null;
}

function daysBetween(savedAtIso, nowMs = Date.now()) {
  if (!savedAtIso) return 0;
  const t = Date.parse(savedAtIso);
  if (!Number.isFinite(t)) return 0;
  const ms = nowMs - t;
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function diffSnapshots(saved, current, savedAtIso) {
  if (!saved || !current) return null;
  const components = {};
  for (const k of ['dutyEur', 'vatEur', 'transportEur', 'brokerageEur']) {
    components[k] = num(current[k]) - num(saved[k]);
  }
  const dutyRateDelta = (current.dutyRatePct != null && saved.dutyRatePct != null)
    ? num(current.dutyRatePct) - num(saved.dutyRatePct)
    : null;

  const landedDeltaEur = num(current.perShipmentLandedTotal) - num(saved.perShipmentLandedTotal);
  const savedTotal = num(saved.perShipmentLandedTotal);
  const landedDeltaPct = savedTotal > 0
    ? Math.round((landedDeltaEur / savedTotal) * 1000) / 10
    : 0;

  // Pick the component that moved most in absolute terms — that's the
  // headline driver in the UI callout ("transport up €240, the rest steady").
  let primaryDriver = null;
  let primaryAbs = 0;
  for (const [k, v] of Object.entries(components)) {
    if (Math.abs(v) > primaryAbs) {
      primaryAbs = Math.abs(v);
      primaryDriver = k.replace(/Eur$/, '');
    }
  }

  return {
    daysSinceSaved: daysBetween(savedAtIso),
    landedDeltaEur: Math.round(landedDeltaEur),
    landedDeltaPct,
    primaryDriver,
    significant: Math.abs(landedDeltaPct) >= SIGNIFICANT_PCT_THRESHOLD,
    components: {
      dutyEur: Math.round(components.dutyEur),
      vatEur: Math.round(components.vatEur),
      transportEur: Math.round(components.transportEur),
      brokerageEur: Math.round(components.brokerageEur),
      dutyRatePct: dutyRateDelta != null ? Math.round(dutyRateDelta * 10) / 10 : null,
    },
  };
}

function enrichRecord(record, current) {
  if (!record) return record;
  const saved = record.snapshot || null;
  if (!saved || !current) {
    // No snapshot stored (legacy plan) → still attach current so UI can
    // show "current pricing" without a delta.
    return Object.assign({}, record, { current: current || null, delta: null });
  }
  const delta = diffSnapshots(saved, current, record.savedAt);
  return Object.assign({}, record, { current, delta });
}

module.exports = {
  SIGNIFICANT_PCT_THRESHOLD,
  SNAPSHOT_FIELDS,
  extractSnapshot,
  sanitiseSnapshot,
  diffSnapshots,
  enrichRecord,
  daysBetween,
};
