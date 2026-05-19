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
const hash = require('./hash');

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
  // Sprint BG-1.4 phase 1.5 — Postgres dual-write. KV is the
  // user-facing primary; PG is the cross-user calibration corpus.
  // Append-only INSERT — multiple revisions over time are preserved
  // for analytics; the "current" actual is `DISTINCT ON (saved_plan_id)
  // ORDER BY reported_at DESC`. Fire-and-forget so a PG outage can't
  // break a save that already succeeded in KV.
  recordPg(planId, actual, record.email).catch(() => { /* never propagate */ });
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
  // Sprint BG-1.4 phase 1.5 — mirror the clear on the PG side. The
  // user said "remove this data", so we honour it across both stores.
  clearPg(planId).catch(() => { /* never propagate */ });
  return rest;
}

// ── Postgres dual-write (Sprint BG-1.4 phase 1.5) ────────
//
// Same shape as lib/events.js#recordPg and lib/saved-plans.js#recordPg.
// KV remains the user-facing source of truth — every UI read goes
// through KV via savedPlans.getPlan. PG is the durable, cross-user
// corpus for analytics + future calibration (BG-1.6).
//
// Storage choice: append-only on setActual. Multiple revisions of an
// actual against the same plan are preserved as separate rows; the
// "current" value is `DISTINCT ON (saved_plan_id) ORDER BY reported_at
// DESC`. This costs a little duplication on PG but preserves the
// full revision history — useful when calibrating: "did the user
// keep tweaking the number, or was the first answer the final one?"
// clearActual deletes ALL rows for the plan (the user has asked us
// to forget) — there's no GDPR-acceptable middle ground.
//
// FK shape: the BG-2.1 schema declares actuals.saved_plan_id as a
// bigint FK to saved_plans.id. KV plan ids are 'pl_<hex>' strings,
// stored in PG as saved_plans.external_id. We resolve via subquery
// rather than two round-trips, which also means: if the saved_plan
// PG row doesn't exist yet (a savePlan that fire-and-forget-failed
// against PG), the subquery returns null and the NOT NULL FK rejects
// the insert — exactly the right outcome. Fire-and-forget swallows it.

// Pure helper: takes a plan external id + actual record + owner email
// and returns the parameter tuple for INSERT INTO actuals. Exported
// for tests + future cron / migration consumers.
function buildPgInsertParams(planExternalId, actualRecord, ownerEmail) {
  if (!planExternalId || typeof planExternalId !== 'string') {
    throw new Error('buildPgInsertParams: planExternalId required');
  }
  if (!actualRecord || typeof actualRecord.landedCents !== 'number') {
    throw new Error('buildPgInsertParams: actualRecord.landedCents required');
  }
  if (!ownerEmail) {
    throw new Error('buildPgInsertParams: ownerEmail required');
  }
  // Pseudonymised post-Article-17 emails pass through as identity.
  const emailHash = hash.isAlreadyPseudonym(ownerEmail)
    ? String(ownerEmail)
    : hash.emailHash(ownerEmail);
  return {
    planExternalId,
    landedCents: actualRecord.landedCents,
    // v1 doesn't capture duty/freight breakdown — those columns stay
    // null. v2 (BG-1.4 phase 2) will populate them.
    dutyCents: null,
    freightCents: null,
    emailHash,
    notes: actualRecord.notes && actualRecord.notes.length > 0 ? actualRecord.notes : null,
  };
}

async function recordPg(planExternalId, actualRecord, ownerEmail) {
  let db;
  try { db = require('./db/client'); }
  catch (_) { return { written: false, reason: 'db-module-unavailable' }; }
  if (!db.isConfigured()) return { written: false, reason: 'not-configured' };

  let params;
  try { params = buildPgInsertParams(planExternalId, actualRecord, ownerEmail); }
  catch (err) { return { written: false, err: err.message }; }

  try {
    // The saved_plan_id subquery resolves the external_id → bigint
    // FK. If the saved_plans row doesn't exist (e.g. PG dual-write
    // for the parent plan failed), the SELECT returns null and the
    // NOT NULL FK constraint rejects the insert. Correct behaviour:
    // the actual is preserved in KV, the PG-side just stays empty
    // for that plan until BG-1.6 calibration backfill catches up.
    await db.query(
      `INSERT INTO actuals
         (saved_plan_id, reported_landed_cents, reported_duty_cents,
          reported_freight_cents, reported_by_email_hash, notes)
       VALUES (
         (SELECT id FROM saved_plans WHERE external_id = $1),
         $2, $3, $4, $5, $6
       )`,
      [
        params.planExternalId,
        params.landedCents,
        params.dutyCents,
        params.freightCents,
        params.emailHash,
        params.notes,
      ],
    );
    return { written: true };
  } catch (err) {
    return { written: false, err: err.message };
  }
}

async function clearPg(planExternalId) {
  let db;
  try { db = require('./db/client'); }
  catch (_) { return { written: false, reason: 'db-module-unavailable' }; }
  if (!db.isConfigured()) return { written: false, reason: 'not-configured' };
  if (!planExternalId || typeof planExternalId !== 'string') {
    return { written: false, err: 'planExternalId required' };
  }
  try {
    await db.query(
      `DELETE FROM actuals
         WHERE saved_plan_id = (SELECT id FROM saved_plans WHERE external_id = $1)`,
      [planExternalId],
    );
    return { written: true };
  } catch (err) {
    return { written: false, err: err.message };
  }
}

// Cross-user read path for BG-1.6 calibration analytics. Returns one
// row per saved_plan (the latest reported_at) joined with the plan's
// inputs + snapshot. Returns [] when not configured or on DB error.
async function listFromPg({ limit = 1000 } = {}) {
  let db;
  try { db = require('./db/client'); }
  catch (_) { return []; }
  if (!db.isConfigured()) return [];

  const safeLimit = Math.max(1, Math.min(10000, Number(limit) || 1000));
  try {
    const rows = await db.query(
      `SELECT DISTINCT ON (a.saved_plan_id)
              a.saved_plan_id,
              p.external_id      AS plan_external_id,
              p.email_hash       AS plan_email_hash,
              p.inputs_json,
              p.snapshot_json,
              a.reported_landed_cents,
              a.reported_duty_cents,
              a.reported_freight_cents,
              a.reported_at,
              a.notes
         FROM actuals a
         JOIN saved_plans p ON p.id = a.saved_plan_id
         WHERE p.archived_at IS NULL
         ORDER BY a.saved_plan_id, a.reported_at DESC
         LIMIT $1`,
      [safeLimit],
    );
    return (rows || []).map((r) => ({
      planId: r.plan_external_id,
      emailHash: r.plan_email_hash,
      inputs: r.inputs_json || {},
      snapshot: r.snapshot_json || null,
      landedCents: Number(r.reported_landed_cents) || 0,
      dutyCents: r.reported_duty_cents == null ? null : Number(r.reported_duty_cents),
      freightCents: r.reported_freight_cents == null ? null : Number(r.reported_freight_cents),
      reportedAt: r.reported_at instanceof Date ? r.reported_at.toISOString() : r.reported_at,
      notes: r.notes || '',
    }));
  } catch (_err) {
    return [];
  }
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

// Sprint user-calibration-breakdown-v1 — adapter from saved-plan
// records (the user-scoped shape) to calibration row shape (what
// lib/calibration.js#summarise expects).
//
// A saved-plan record carries actual at `record.actual.landedCents`.
// The calibration aggregator wants `landedCents` at the top level
// alongside `inputs` + `snapshot`. We project + filter out plans
// without a logged actual so the aggregator only sees calibratable
// rows.
function rowsFromPlans(plans) {
  const safe = Array.isArray(plans) ? plans : [];
  const out = [];
  for (const p of safe) {
    if (!p || !p.actual || !p.inputs || !p.snapshot) continue;
    const landedCents = Number(p.actual.landedCents);
    if (!Number.isFinite(landedCents) || landedCents <= 0) continue;
    out.push({
      inputs: p.inputs,
      snapshot: p.snapshot,
      landedCents,
      reportedAt: p.actual.reportedAt || null,
    });
  }
  return out;
}

module.exports = {
  MAX_NOTES_LEN,
  MAX_LANDED_EUR,
  sanitiseLandedEur,
  sanitiseNotes,
  buildActualRecord,
  computeVariance,
  summariseActuals,
  rowsFromPlans,
  setActual,
  clearActual,
  // Sprint BG-1.4 phase 1.5 — Postgres dual-write
  buildPgInsertParams,
  recordPg,
  clearPg,
  listFromPg,
};
