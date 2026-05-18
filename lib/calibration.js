// Cross-user calibration analytics — Sprint BG-1.6.
//
// Reads from actuals.listFromPg() (BG-1.4 phase 1.5) — one row per
// saved_plan with the latest reported actual — and groups by the
// dimensions an operator cares about: category, origin, destination,
// (origin → destination) route.
//
// Output answers operator-level questions:
//   - "Where is the calculator drifting most?" (by group, sorted by
//     |avgVariancePct|)
//   - "What's our cumulative bias?" (overall avgVariancePct + total
//     estimate vs total actual)
//   - "Which routes have enough actuals to trust the variance?"
//     (sampleSize per group — small samples are statistically weak)
//
// Pure module: takes the listFromPg() rows + returns a plain summary
// object. No I/O. The handler (lib/handlers/calibration.js) does the
// fetch + auth + response shaping.

'use strict';

// Significance gates. Below 3 samples per group, the variance is too
// noisy to act on — we still surface the group but mark it `weak: true`
// so the dashboard can render it muted.
const WEAK_SAMPLE_THRESHOLD = 3;
const SIGNIFICANT_VARIANCE_PCT = 3;     // |x| ≥ 3% is "drift worth noting"

// Pure: given (landedCents, snapshot) produces { estimateEur, actualEur,
// deltaEur, deltaPct }. Mirrors actuals.computeVariance but operates
// on the PG-shape row (which carries snapshot_json + landed cents).
function rowVariance(row) {
  if (!row || !row.snapshot) return null;
  const estimateEur = Number(row.snapshot.perShipmentLandedTotal);
  if (!Number.isFinite(estimateEur) || estimateEur <= 0) return null;
  const actualEur = Number(row.landedCents) / 100;
  if (!Number.isFinite(actualEur) || actualEur <= 0) return null;
  const deltaEur = actualEur - estimateEur;
  return {
    estimateEur,
    actualEur,
    deltaEur,
    deltaPct: (deltaEur / estimateEur) * 100,
  };
}

// Accumulator: keeps running totals for a group so the final value-
// weighted average + counts come out in a single pass.
function emptyAcc() {
  return {
    count: 0,
    totalEstimateCents: 0,
    totalActualCents: 0,
    weightedSumPct: 0,         // sum of (deltaPct * estimateCents)
    over: 0,
    under: 0,
    onTarget: 0,
  };
}

function accumulate(acc, variance) {
  acc.count++;
  const estCents = Math.round(variance.estimateEur * 100);
  const actCents = Math.round(variance.actualEur * 100);
  acc.totalEstimateCents += estCents;
  acc.totalActualCents += actCents;
  acc.weightedSumPct += variance.deltaPct * estCents;
  if (variance.deltaPct > 0.5) acc.over++;
  else if (variance.deltaPct < -0.5) acc.under++;
  else acc.onTarget++;
}

function finalise(key, acc) {
  const avgVariancePct = acc.totalEstimateCents > 0
    ? Math.round((acc.weightedSumPct / acc.totalEstimateCents) * 10) / 10
    : 0;
  return {
    key,
    sampleSize: acc.count,
    weak: acc.count < WEAK_SAMPLE_THRESHOLD,
    avgVariancePct,
    significant: Math.abs(avgVariancePct) >= SIGNIFICANT_VARIANCE_PCT && acc.count >= WEAK_SAMPLE_THRESHOLD,
    totalEstimateEur: Math.round(acc.totalEstimateCents / 100 * 100) / 100,
    totalActualEur: Math.round(acc.totalActualCents / 100 * 100) / 100,
    over: acc.over,
    under: acc.under,
    onTarget: acc.onTarget,
  };
}

// Sort: largest absolute drift first (significant groups float to the
// top); among ties, larger sample size wins; weak samples sink.
function sortByDrift(rows) {
  return rows.slice().sort((a, b) => {
    if (a.weak !== b.weak) return a.weak ? 1 : -1;
    const ad = Math.abs(a.avgVariancePct);
    const bd = Math.abs(b.avgVariancePct);
    if (ad !== bd) return bd - ad;
    return b.sampleSize - a.sampleSize;
  });
}

// Pure: takes rows (from actuals.listFromPg()) + a key extractor and
// returns the finalised grouped summary, sorted by drift.
function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows || []) {
    const variance = rowVariance(row);
    if (!variance) continue;
    const key = keyFn(row);
    if (!key) continue;
    if (!map.has(key)) map.set(key, emptyAcc());
    accumulate(map.get(key), variance);
  }
  const out = [];
  for (const [key, acc] of map.entries()) out.push(finalise(key, acc));
  return sortByDrift(out);
}

// Top-level aggregator. Returns the operator-friendly summary the
// dashboard renders directly.
function summarise(rows) {
  const safe = Array.isArray(rows) ? rows : [];
  const totalAcc = emptyAcc();
  for (const row of safe) {
    const v = rowVariance(row);
    if (!v) continue;
    accumulate(totalAcc, v);
  }
  const total = finalise('all', totalAcc);

  return {
    asOf: new Date().toISOString(),
    total: {
      sampleSize: total.sampleSize,
      avgVariancePct: total.avgVariancePct,
      totalEstimateEur: total.totalEstimateEur,
      totalActualEur: total.totalActualEur,
      totalDeltaEur: Math.round((total.totalActualEur - total.totalEstimateEur) * 100) / 100,
      direction: total.avgVariancePct > 0.5 ? 'over'
        : total.avgVariancePct < -0.5 ? 'under'
        : 'on-target',
      over: total.over,
      under: total.under,
      onTarget: total.onTarget,
    },
    byCategory: groupBy(safe, (r) => r.inputs && r.inputs.productCategory),
    byOrigin: groupBy(safe, (r) => r.inputs && r.inputs.originCountry),
    byDestination: groupBy(safe, (r) => r.inputs && r.inputs.destinationCountry),
    byRoute: groupBy(safe, (r) => {
      if (!r.inputs || !r.inputs.originCountry || !r.inputs.destinationCountry) return '';
      return r.inputs.originCountry + ' → ' + r.inputs.destinationCountry;
    }),
  };
}

// ── Drift alerts (Sprint BG-1.7) ─────────────────────────
//
// Walks the summary produced by summarise() and returns the groups
// (across every dimension) whose drift crosses an alert-grade
// threshold AND has enough samples to trust. The cron job in
// lib/handlers/cron.js calls this nightly and emits one structured
// log.warn per alert — BG-4.2 then forwards those to Sentry so the
// ops team gets paged before the drift reaches a customer quote.
//
// Defaults intentionally tighter than the dashboard's "significant"
// flag:
//   - The dashboard surfaces ≥3% drift on ≥3 samples (informative).
//   - An alert needs ≥5% drift on ≥5 samples (actionable).
// These are not pricing-team thresholds; they're "do we have enough
// signal to make someone look at this?" thresholds. A pricing
// decision still requires human review.

const ALERT_MIN_DRIFT_PCT = 5;
const ALERT_MIN_SAMPLES   = 5;

// Pure: given a summary object, return one entry per (dimension, group)
// that crosses the alert thresholds. Sorted by |drift| desc so the
// worst row comes out first in any consumer.
function findAlerts(summary, opts = {}) {
  const minDrift   = Number(opts.minDriftPct) || ALERT_MIN_DRIFT_PCT;
  const minSamples = Number(opts.minSamples)  || ALERT_MIN_SAMPLES;
  if (!summary || typeof summary !== 'object') return [];

  const out = [];
  const dimensions = ['byRoute', 'byCategory', 'byOrigin', 'byDestination'];
  for (const dim of dimensions) {
    const rows = Array.isArray(summary[dim]) ? summary[dim] : [];
    for (const r of rows) {
      if (!r || typeof r.avgVariancePct !== 'number') continue;
      if (r.sampleSize < minSamples) continue;
      if (Math.abs(r.avgVariancePct) < minDrift) continue;
      out.push({
        dimension: dim,
        key: r.key,
        sampleSize: r.sampleSize,
        avgVariancePct: r.avgVariancePct,
        direction: r.avgVariancePct > 0 ? 'over' : 'under',
        totalEstimateEur: r.totalEstimateEur,
        totalActualEur: r.totalActualEur,
      });
    }
  }
  out.sort((a, b) => Math.abs(b.avgVariancePct) - Math.abs(a.avgVariancePct));
  return out;
}

module.exports = {
  WEAK_SAMPLE_THRESHOLD,
  SIGNIFICANT_VARIANCE_PCT,
  ALERT_MIN_DRIFT_PCT,
  ALERT_MIN_SAMPLES,
  rowVariance,
  groupBy,
  summarise,
  findAlerts,
};
