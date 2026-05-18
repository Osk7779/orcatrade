// Actuals capture — Sprint BG-1.4.
//
// A "saved plan" carries OrcaTrade's ESTIMATE of landed cost at the time
// the user saved it (the snapshot field, see lib/plan-diff.js). This
// module lets the user record the ACTUAL outcome after the shipment
// completes — what they really paid all-in. The variance between the
// two is the Track 1 reality-check loop: every customer who logs their
// actuals teaches the platform where its calculator drifts from reality.
//
// v1 scope (intentionally minimal):
//   - One actual per plan. Re-reporting overwrites the previous value.
//   - One number: total landed cost in EUR (integer cents internally).
//   - Optional free-text notes (≤500 chars).
//   - No duty/freight breakdown — that's a deliberate v2 follow-on once
//     we have enough actuals to know which breakdown is worth asking.
//
// Storage:
//   The actual is attached as a sibling field on the existing plan
//   record (KV `plan:<planId>`). No new key, no fanout. The Postgres
//   `actuals` table (BG-2.1 schema) is the durable corpus — wiring up
//   the dual-write is a follow-on (mirrors lib/events.js BG-2.2).

'use strict';

const kv = require('./intelligence/kv-store');
const savedPlans = require('./saved-plans');

const MAX_NOTES_LEN = 500;
const MAX_LANDED_EUR = 1e9;                     // €1B sanity cap — anything above is operator error

// ── Sanitisers (exported for tests) ──────────────────────

function sanitiseLandedEur(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_LANDED_EUR) return null;
  return n;
}

function sanitiseNotes(s) {
  if (s == null) return '';
  return String(s).trim().slice(0, MAX_NOTES_LEN);
}

// ── Record builder ───────────────────────────────────────

function buildActualRecord({ landedEur, notes }) {
  const eur = sanitiseLandedEur(landedEur);
  if (eur == null) {
    throw new Error('landedEur must be a positive number ≤ 1,000,000,000');
  }
  return {
    // Integer cents, banker's-rounded at the conversion edge (BG-1.1
    // money math convention). Keeps every downstream computation
    // (variance, %, totals) doing pure-integer arithmetic.
    landedCents: Math.round(eur * 100),
    currency: 'EUR',
    reportedAt: new Date().toISOString(),
    notes: sanitiseNotes(notes),
  };
}

// ── Variance computation ─────────────────────────────────
//
// Compares the actual against the snapshot taken AT SAVE time, not
// against the current re-computed estimate. Rationale: the user wants
// to know "did my call match reality?" not "would today's pricing
// match my outcome?" The "today" comparison is plan-diff's job.
//
// Significance threshold: ±3% deviation from estimate. Below that the
// estimate is "on target"; above is reported as over/under by % + €.

function computeVariance(actual, snapshot) {
  if (!actual || typeof actual.landedCents !== 'number') return null;
  if (!snapshot || !snapshot.perShipmentLandedTotal) return null;
  const estimateEur = Number(snapshot.perShipmentLandedTotal);
  if (!Number.isFinite(estimateEur) || estimateEur <= 0) return null;

  const actualEur = actual.landedCents / 100;
  const deltaEur = actualEur - estimateEur;
  // Round delta to whole cents; pct to 1 decimal.
  const deltaEurRounded = Math.round(deltaEur * 100) / 100;
  const deltaPct = Math.round((deltaEur / estimateEur) * 1000) / 10;

  let direction = 'on-target';
  if (deltaEur > 0) direction = 'over';
  else if (deltaEur < 0) direction = 'under';

  return {
    estimateEur,
    actualEur,
    deltaEur: deltaEurRounded,
    deltaPct,
    direction,
    significant: Math.abs(deltaPct) >= 3,
  };
}

// ── Persistence (KV) ─────────────────────────────────────

async function setActual(planId, email, payload) {
  const record = await savedPlans.getPlan(planId, email);
  if (!record) return null;
  const actual = buildActualRecord(payload);
  const updated = { ...record, actual };
  await kv.set(
    savedPlans.planKey(planId),
    updated,
    { ttlSeconds: savedPlans.PLAN_TTL_DAYS * 24 * 60 * 60 }
  );
  return updated;
}

async function clearActual(planId, email) {
  const record = await savedPlans.getPlan(planId, email);
  if (!record) return null;
  if (!record.actual) return record;
  // eslint-disable-next-line no-unused-vars
  const { actual, ...rest } = record;
  await kv.set(
    savedPlans.planKey(planId),
    rest,
    { ttlSeconds: savedPlans.PLAN_TTL_DAYS * 24 * 60 * 60 }
  );
  return rest;
}

// ── Calibration summary (Sprint BG-1.5) ──────────────────
//
// Rolls a list of enriched plan records (the shape returned by
// /api/plans — i.e. with .actual + .actualVariance attached when
// present) into a single user-facing snapshot:
//
//   {
//     planCount,           // total saved plans
//     withActuals,         // plans that have an actual logged
//     totalEstimateEur,    // sum of estimates ACROSS plans-with-actuals
//     totalActualEur,      // sum of actuals across the same plans
//     totalDeltaEur,       // actual - estimate (positive = over budget)
//     // Weighted average variance — weighted by estimate value, NOT a
//     // simple mean of per-plan percentages. A single €1M plan
//     // shouldn't be drowned out by ten €500 plans, and vice-versa.
//     // Returns null when there are no actuals to weight.
//     avgVariancePct,
//     // Directional split — useful for the headline ("3 came in
//     // under-budget, 1 over"). Excludes plans without an actual.
//     byDirection: { over, under, onTarget },
//   }
//
// Pure function — no I/O, no async. Caller passes the already-fetched
// plans list. Used today by /account/plans/ app.js to render the
// calibration card; useful tomorrow on a server-side calibration
// digest endpoint without rewiring the math.

function summariseActuals(plans) {
  const safe = Array.isArray(plans) ? plans : [];
  let totalEstimateCents = 0;
  let totalActualCents = 0;
  let weightedSumPct = 0;
  let weightTotal = 0;
  let withActuals = 0;
  let over = 0, under = 0, onTarget = 0;

  for (const p of safe) {
    if (!p || !p.actual || !p.actualVariance) continue;
    const v = p.actualVariance;
    const estCents = Math.round(Number(v.estimateEur || 0) * 100);
    const actCents = Math.round(Number(v.actualEur || 0) * 100);
    // Only count plans that actually contribute to the math. A
    // malformed variance (zero/negative estimate, missing fields)
    // would otherwise inflate "outcomes logged" without affecting
    // the displayed averages — confusing.
    if (estCents <= 0) continue;
    withActuals++;
    totalEstimateCents += estCents;
    totalActualCents += actCents;
    // Weight = estimate cents. Big plans pull the average more.
    weightedSumPct += Number(v.deltaPct || 0) * estCents;
    weightTotal += estCents;
    if (v.direction === 'over') over++;
    else if (v.direction === 'under') under++;
    else onTarget++;
  }

  const avgVariancePct = weightTotal > 0
    ? Math.round((weightedSumPct / weightTotal) * 10) / 10  // 1 decimal
    : null;

  return {
    planCount: safe.length,
    withActuals,
    totalEstimateEur: Math.round(totalEstimateCents / 100 * 100) / 100,
    totalActualEur: Math.round(totalActualCents / 100 * 100) / 100,
    totalDeltaEur: Math.round((totalActualCents - totalEstimateCents) / 100 * 100) / 100,
    avgVariancePct,
    byDirection: { over, under, onTarget },
  };
}

module.exports = {
  MAX_NOTES_LEN,
  MAX_LANDED_EUR,
  sanitiseLandedEur,
  sanitiseNotes,
  buildActualRecord,
  computeVariance,
  summariseActuals,
  setActual,
  clearActual,
};
