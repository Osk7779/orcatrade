// Quote Accuracy Ledger — sprint 80 (Track B of the billion-dollar
// program: the commercial weapon).
//
// Turns the Tier-A accuracy guarantee from a CLAIM into a MEASURED
// INSTRUMENT: "our landed-cost quotes land within X% of the actual
// outcome, measured over N customer-reported actuals." Nobody in
// this market publishes that number. We do — including when the
// number is "not enough data yet", because the instrument's
// credibility rests on it never flattering itself.
//
// Pure calculator (lib/intelligence — LLM-free per ADR 0003; the
// import-graph test enforces). Input rows come from
// actuals.listFromPg(); every money sum is integer cents
// (ADR 0004). Percentages are DISPLAY analytics derived from
// integer-cent ratios — never money that drives a decision.
//
// Honesty gates (the load-bearing part):
//   sampleSize < INDICATIVE_MIN  → tier 'insufficient' — headline
//     metrics are WITHHELD (null), only the count ships. A ledger
//     that quotes a median over 3 rows is marketing, not
//     measurement.
//   INDICATIVE_MIN ≤ n < MEASURED_MIN → tier 'indicative' —
//     metrics ship, labelled as early-sample.
//   n ≥ MEASURED_MIN → tier 'measured'.
// Pre-revenue truthfulness (standing directive): with zero real
// customer actuals the ledger reports sampleSize 0 and NOTHING
// else — the instrument exists, the numbers accrue.

'use strict';

const INDICATIVE_MIN = 10;
const MEASURED_MIN = 50;

// One row → its absolute-percent error, or null when the row can't
// be scored (no estimate, zero/negative values, missing actual).
//
// Two estimate sources (sprint 81 merged the wedge corpus in):
//   - row.estimateCents — INTEGER cents, preferred. The import-
//     request cut supplies this directly (no float round-trip).
//   - row.snapshot.perShipmentLandedTotal — legacy EUR-float from
//     saved plans, converted to integer cents AT THE BOUNDARY.
// After either path, everything is integer arithmetic.
//
// @param {{ landedCents?: number, estimateCents?: number, snapshot?: any }} row
function scoreRow(row) {
  if (!row || typeof row !== 'object') return null;
  const actualCents = Number(row.landedCents);
  if (!Number.isFinite(actualCents) || actualCents <= 0) return null;
  let estimateCents = null;
  if (Number.isInteger(row.estimateCents) && row.estimateCents > 0) {
    estimateCents = row.estimateCents;
  } else {
    const estimateEur = row.snapshot ? Number(row.snapshot.perShipmentLandedTotal) : NaN;
    if (!Number.isFinite(estimateEur) || estimateEur <= 0) return null;
    estimateCents = Math.round(estimateEur * 100);
  }
  if (estimateCents <= 0) return null;
  const deltaCents = actualCents - estimateCents;
  return {
    estimateCents,
    actualCents,
    deltaCents,
    absErrorPct: Math.abs(deltaCents / estimateCents) * 100,
  };
}

// Median over a sorted-copy — standard midpoint average for even n.
/** @param {number[]} values */
function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** @param {number} n */
function round1(n) {
  return Math.round(n * 10) / 10;
}

// The ledger. Every metric is derived; nothing is stored — re-run
// over the corpus and you get the same answer (reproducibility is
// the point: an auditor can recompute it).
//
// @param {Array<{ landedCents?: number, snapshot?: any, reportedAt?: string }>} rows
function computeAccuracyLedger(rows) {
  const input = Array.isArray(rows) ? rows : [];
  const scored = [];
  for (const row of input) {
    const s = scoreRow(row);
    if (s) scored.push({ ...s, reportedAt: (row && row.reportedAt) || null });
  }
  const n = scored.length;
  const tier = n >= MEASURED_MIN ? 'measured' : (n >= INDICATIVE_MIN ? 'indicative' : 'insufficient');

  // Integer-cent sums (ADR 0004) — the value-weighted view weights
  // a €200k shipment 100× a €2k one, which is what a CFO asks for.
  let totalEstimateCents = 0;
  let totalActualCents = 0;
  for (const s of scored) {
    totalEstimateCents += s.estimateCents;
    totalActualCents += s.actualCents;
  }

  // Headline metrics are WITHHELD below the indicative gate — the
  // count still ships so the surface can say "N reported so far".
  const withhold = tier === 'insufficient';
  const absErrors = scored.map((s) => s.absErrorPct);
  const within = (pct) => {
    if (withhold || n === 0) return null;
    return Math.round((absErrors.filter((e) => e <= pct).length / n) * 100);
  };

  const reportedAts = scored
    .map((s) => s.reportedAt)
    .filter((v) => typeof v === 'string' && v.length > 0)
    .sort();

  return {
    sampleSize: n,
    tier,
    // Share of quotes whose actual landed within ±X% (whole %).
    within5Pct: within(5),
    within10Pct: within(10),
    within20Pct: within(20),
    // Median absolute error (1dp) — robust to a single wild outlier
    // in a way a mean is not.
    medianAbsErrorPct: (withhold || n === 0) ? null : round1(/** @type {number} */ (median(absErrors))),
    // Value-weighted bias (1dp): + means actuals ran over the
    // quotes; − means quotes were conservative. Computed from
    // integer-cent totals.
    valueWeightedBiasPct: (withhold || totalEstimateCents <= 0)
      ? null
      : round1(((totalActualCents - totalEstimateCents) / totalEstimateCents) * 100),
    // Integer cents — the corpus scale, quotable ("measured over
    // €X of reported outcomes").
    totalEstimateCents,
    totalActualCents,
    oldestReportedAt: reportedAts.length > 0 ? reportedAts[0] : null,
    newestReportedAt: reportedAts.length > 0 ? reportedAts[reportedAts.length - 1] : null,
  };
}

module.exports = {
  INDICATIVE_MIN,
  MEASURED_MIN,
  scoreRow,
  median,
  computeAccuracyLedger,
};
