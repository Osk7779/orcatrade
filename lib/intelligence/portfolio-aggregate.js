// Multi-SKU portfolio aggregation — Sprint portfolio-v1.
//
// The /start/ wizard plans ONE product at a time. A real importer brings
// in many SKUs from (often) the same supplier, and needs the numbers a
// per-SKU view can't show: total portfolio landed cost, the BLENDED
// effective duty rate across the catalogue, and the consolidation saving
// from clearing SKUs that share an origin+destination as a single customs
// entry instead of N separate ones.
//
// This module is PURE: it takes already-composed per-line plans (each the
// output of start.composePlan) and a brokerageFee(linesCount) function
// (injected so the math is testable without importing the customs module)
// and returns the aggregate. No I/O, no LLM — every number is a
// deterministic roll-up of the per-line calculator outputs.

'use strict';

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// Sum a numeric field across an array of per-line `totals` objects.
function sumField(plans, field) {
  return plans.reduce((acc, p) => acc + (Number(p.totals && p.totals[field]) || 0), 0);
}

function groupKey(line) {
  const o = String(line.inputs && line.inputs.originCountry || '').toUpperCase();
  const d = String(line.inputs && line.inputs.destinationCountry || '').toUpperCase();
  return `${o}__${d}`;
}

// Aggregate an array of composed per-line plans into a portfolio view.
//
// @param plans     Array of start.composePlan results with ok:true.
// @param opts.brokerageFee  (linesCount:number) => eur — the customs
//        brokerage formula. Injected for testability + to keep this pure.
//        Falls back to a no-consolidation model (saving = 0) if absent.
// @returns {
//   lineCount,
//   totals: { customsValueEur, dutyEur, vatEur, brokerageEur, transportEur,
//             perShipmentLandedTotal, effectiveLandedTotal, vatRecoverableEur },
//   blendedDutyRatePct,
//   groups: [{ originCountry, destinationCountry, lineIndexes, lineCount,
//              totalCustomsLines, combinedWeightKg,
//              independentBrokerageEur, consolidatedBrokerageEur,
//              brokerageSavingEur, independentTransportEur,
//              transportConsolidatable }],
//   consolidationSavingEur,
// }
function aggregatePortfolio(plans, opts = {}) {
  const ok = Array.isArray(plans) ? plans.filter((p) => p && p.ok && p.totals) : [];
  const brokerageFee = typeof opts.brokerageFee === 'function' ? opts.brokerageFee : null;

  const totals = {
    customsValueEur: round2(sumField(ok, 'customsValueEur')),
    dutyEur: round2(sumField(ok, 'dutyEur')),
    vatEur: round2(sumField(ok, 'vatEur')),
    brokerageEur: round2(sumField(ok, 'brokerageEur')),
    transportEur: round2(sumField(ok, 'transportEur')),
    perShipmentLandedTotal: round2(sumField(ok, 'perShipmentLandedTotal')),
    effectiveLandedTotal: round2(sumField(ok, 'effectiveLandedTotal')),
    vatRecoverableEur: round2(sumField(ok, 'vatRecoverableEur')),
  };

  // Blended effective duty: total duty paid ÷ total customs value. This is
  // the single number that tells an importer "what rate am I actually
  // paying across my whole catalogue" — invisible in any per-SKU plan.
  const blendedDutyRatePct = totals.customsValueEur > 0
    ? round2((totals.dutyEur / totals.customsValueEur) * 100)
    : 0;

  // Consolidation: group lines by origin+destination. SKUs that share a
  // lane can clear as ONE customs entry, paying one brokerage fee on the
  // combined line count instead of N independent fees.
  const byLane = new Map();
  ok.forEach((line, idx) => {
    // idx here is the index within the ok[] array; map back to the caller's
    // original index via the line's own position is not needed — we expose
    // the ok-array index, which the handler aligns with its input order
    // (it only aggregates successful lines).
    const key = groupKey(line);
    if (!byLane.has(key)) byLane.set(key, []);
    byLane.get(key).push({ line, idx });
  });

  const groups = [];
  let consolidationSavingEur = 0;
  for (const [, entries] of byLane) {
    const first = entries[0].line;
    const originCountry = String(first.inputs.originCountry || '').toUpperCase();
    const destinationCountry = String(first.inputs.destinationCountry || '').toUpperCase();
    const totalCustomsLines = entries.reduce((a, e) => a + (Math.max(1, Math.floor(Number(e.line.inputs.linesCount) || 1))), 0);
    const combinedWeightKg = round2(entries.reduce((a, e) => a + (Number(e.line.inputs.weightKg) || 0), 0));
    const independentBrokerageEur = round2(entries.reduce((a, e) => a + (Number(e.line.totals.brokerageEur) || 0), 0));
    const independentTransportEur = round2(entries.reduce((a, e) => a + (Number(e.line.totals.transportEur) || 0), 0));

    let consolidatedBrokerageEur = independentBrokerageEur;
    if (brokerageFee) consolidatedBrokerageEur = round2(brokerageFee(totalCustomsLines));
    const brokerageSavingEur = Math.max(0, round2(independentBrokerageEur - consolidatedBrokerageEur));
    consolidationSavingEur += brokerageSavingEur;

    groups.push({
      originCountry,
      destinationCountry,
      lineIndexes: entries.map((e) => e.idx),
      lineCount: entries.length,
      totalCustomsLines,
      combinedWeightKg,
      independentBrokerageEur,
      consolidatedBrokerageEur,
      brokerageSavingEur,
      independentTransportEur,
      // More than one SKU on the same lane → they can physically ship
      // together; transport (LCL→FCL) consolidation is then an additional
      // opportunity beyond the brokerage saving we quantify above.
      transportConsolidatable: entries.length > 1,
    });
  }

  // Largest-lane first so the UI surfaces the biggest consolidation
  // opportunity at the top.
  groups.sort((a, b) => b.lineCount - a.lineCount || b.brokerageSavingEur - a.brokerageSavingEur);

  return {
    lineCount: ok.length,
    totals,
    blendedDutyRatePct,
    groups,
    consolidationSavingEur: round2(consolidationSavingEur),
  };
}

// ── Drift detection (Sprint portfolio-drift-v1) ─────────
//
// Compare a freshly-recomputed portfolio aggregate against the snapshot
// stored when the user saved it, so reopening a saved portfolio shows
// "what changed since you saved this on <date>". Pure arithmetic — the
// same deterministic basis as the single-plan revision cron. A change is
// "material" when the total landed cost moved ≥ the threshold (default
// 5%), matching the plan-revision significance bar.
//
// @param saved  the stored snapshot { totals:{perShipmentLandedTotal,…},
//               blendedDutyRatePct, … } (or null for legacy saves)
// @param fresh  a fresh aggregatePortfolio() result
// @returns null when no baseline is available, else {
//   baselineLandedEur, currentLandedEur, landedDeltaEur, landedDeltaPct,
//   blendedDutyDeltaPct, dutyDeltaEur, direction ('up'|'down'|'flat'),
//   material (bool)
// }
function comparePortfolioSnapshots(saved, fresh, opts = {}) {
  const thresholdPct = Number.isFinite(opts.thresholdPct) ? opts.thresholdPct : 5;
  if (!saved || !saved.totals || !fresh || !fresh.totals) return null;
  const base = Number(saved.totals.perShipmentLandedTotal) || 0;
  const now = Number(fresh.totals.perShipmentLandedTotal) || 0;
  if (base <= 0) return null;
  const landedDeltaEur = round2(now - base);
  const landedDeltaPct = round2((landedDeltaEur / base) * 100);
  const dutyDeltaEur = round2((Number(fresh.totals.dutyEur) || 0) - (Number(saved.totals.dutyEur) || 0));
  const blendedDutyDeltaPct = round2((Number(fresh.blendedDutyRatePct) || 0) - (Number(saved.blendedDutyRatePct) || 0));
  const direction = landedDeltaEur > 0 ? 'up' : (landedDeltaEur < 0 ? 'down' : 'flat');
  return {
    baselineLandedEur: round2(base),
    currentLandedEur: round2(now),
    landedDeltaEur,
    landedDeltaPct,
    dutyDeltaEur,
    blendedDutyDeltaPct,
    direction,
    material: Math.abs(landedDeltaPct) >= thresholdPct,
  };
}

module.exports = { aggregatePortfolio, comparePortfolioSnapshots, round2 };
