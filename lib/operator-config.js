// Sprint 42 — per-org operator config (v1).
//
// The operator wedge ships with hard-coded thresholds for the
// proactive cohorts: STALL_THRESHOLD_DAYS=7 (sprint 38), plus the
// decline-spike windows + multipliers (sprint 40). Those defaults
// fit most teams but enterprise customers want to dial them for
// their own SLA — a team with a 3-day quote SLA needs stall
// alerts firing at 3 days, not 7.
//
// Sprint 42 lifts the FIRST knob (stallThresholdDays) into a
// KV-backed per-org config. Future sprints can extend the config
// with more knobs without rewriting the helper or the threading.
// Discipline:
//   - DEFAULTS are the source of truth — get() always merges so
//     a config-missing org just gets the platform defaults
//   - Validation is strict (range + integer) so a misconfig can't
//     break aggregateOpsInsights or the cron callers
//   - KV is the only store (no PG) — keeps the read path on the
//     hot loop fast (cohort aggregation calls this once per org
//     per cron run)
//
// KV namespace: operator-config:<orgId>. No TTL — the config
// persists until explicitly cleared.

'use strict';

const kv = require('./intelligence/kv-store');

const KEY_PREFIX = 'operator-config:';

// Sprint 42+ — config knobs. Each knob is documented at the
// validation boundary below so a future widening of the config is
// grep-able.
const DEFAULT_OPERATOR_CONFIG = Object.freeze({
  // The "no activity in awaiting_review for > N days" gate that
  // drives the sprint-38 stalled-queue cohort + the sprint-39
  // daily alert. Default 7 (one work week — most B2B quote SLAs).
  // Bounded [1, 90] — 1 day is the tightest realistic SLA;
  // anything longer than 90 days means stall detection isn't
  // helping (rows that age out are quote-expiry candidates).
  stallThresholdDays: 7,
  // Sprint 43 — decline-spike sensitivity. The multiplier that
  // gates the sprint-40 spike classifier: a reason flags as
  // spiking when its 7-day rate is >= multiplier × the 30-day
  // baseline rate (with the count floor also satisfied).
  //
  // Default 2.0 = "doubled vs baseline" (the cleanest line between
  // trend and noise). Range [1.5, 10] = strict (1.5 = "any
  // meaningful acceleration") to tolerant (10 = "only big shifts
  // make the cut"). One-decimal precision — anything finer is
  // noise relative to the 30-day baseline's resolution.
  declineSpikeRateMultiplier: 2,
  // Sprint 60 — supplier-concentration sensitivity. The share-
  // threshold that gates the sprint-57 concentration classifier:
  // a cohort flags when the top country's share of the last
  // 30-day picks is >= threshold (with the count floor also
  // satisfied).
  //
  // Default 0.75 = "75% to one country is the textbook dominant
  // supplier line" (matches sprint-57 SUPPLIER_CONCENTRATION_
  // THRESHOLD constant for back-compat). Range [0.50, 0.95]:
  //   0.50 — strict (any half-or-more concentration)
  //   0.85+ — tolerant (only crushing dominance)
  // Two-decimal precision (vs one-decimal for the spike
  // multiplier) because the band is narrow and 0.75 itself is
  // not representable in one-decimal increments without
  // jumping to 0.7 or 0.8.
  supplierConcentrationThreshold: 0.75,
});

function key(orgIdNumeric) {
  return KEY_PREFIX + String(orgIdNumeric).trim();
}

// Validate a partial config payload. Returns { ok, value, errors }
// where `value` is the sanitised partial (only valid keys kept) and
// `errors` is a non-empty array on failure. Defensive: every field
// is gated so a stray null/undefined/object can't survive.
//
// @param {any} partial
function validatePartial(partial) {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    return { ok: false, errors: ['payload must be a config object'] };
  }
  /** @type {Partial<typeof DEFAULT_OPERATOR_CONFIG>} */
  const out = {};
  /** @type {string[]} */
  const errors = [];
  if (Object.prototype.hasOwnProperty.call(partial, 'stallThresholdDays')) {
    const raw = partial.stallThresholdDays;
    const n = Number(raw);
    if (!Number.isInteger(n) || String(n) !== String(raw)) {
      errors.push('stallThresholdDays must be a plain integer');
    } else if (n < 1 || n > 90) {
      errors.push('stallThresholdDays must be between 1 and 90');
    } else {
      out.stallThresholdDays = n;
    }
  }
  // Sprint 43 — float-typed knob with one-decimal precision. Distinct
  // validation from the integer knobs above:
  //   - Number.isFinite catches NaN/Infinity/null/object
  //   - Math.round(n * 10) === n * 10 enforces one-decimal precision
  //     (1.5 ok, 1.55 not — the 30-day baseline doesn't have the
  //     resolution to distinguish 1.55× from 1.5×)
  //   - Range [1.5, 10] — strict-to-tolerant band
  if (Object.prototype.hasOwnProperty.call(partial, 'declineSpikeRateMultiplier')) {
    const raw = partial.declineSpikeRateMultiplier;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      errors.push('declineSpikeRateMultiplier must be a finite number');
    } else if (Math.round(n * 10) !== n * 10) {
      errors.push('declineSpikeRateMultiplier must have at most one decimal place');
    } else if (n < 1.5 || n > 10) {
      errors.push('declineSpikeRateMultiplier must be between 1.5 and 10');
    } else {
      out.declineSpikeRateMultiplier = n;
    }
  }
  // Sprint 60 — two-decimal float knob with narrower band than the
  // sprint-43 multiplier:
  //   - Number.isFinite catches NaN/Infinity/null/object
  //   - Math.round(n * 100) === n * 100 enforces 2-decimal precision
  //     (0.75 ok, 0.755 not — the narrow band needs the resolution
  //     but 3 decimals is finer than the 30-day window resolves)
  //   - Range [0.50, 0.95] — strict-to-tolerant
  if (Object.prototype.hasOwnProperty.call(partial, 'supplierConcentrationThreshold')) {
    const raw = partial.supplierConcentrationThreshold;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      errors.push('supplierConcentrationThreshold must be a finite number');
    } else if (Math.abs(Math.round(n * 100) - n * 100) > 1e-9) {
      // Epsilon comparison — IEEE-754 means `0.55 * 100 ===
      // 55.00000000000001`, so a strict-equality check would
      // reject legitimate two-decimal values. 1e-9 is well
      // below any meaningful three-decimal precision we'd
      // accept (0.001 = 1e-3).
      errors.push('supplierConcentrationThreshold must have at most two decimal places');
    } else if (n < 0.5 || n > 0.95) {
      errors.push('supplierConcentrationThreshold must be between 0.50 and 0.95');
    } else {
      out.supplierConcentrationThreshold = n;
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  if (Object.keys(out).length === 0) {
    return { ok: false, errors: ['payload contained no valid config keys'] };
  }
  return { ok: true, value: out };
}

// Read the org's effective config. ALWAYS returns a complete config
// object — defaults merged in for any field the org hasn't customised.
// Reads that miss KV (network blip, key absent) fall back to the
// platform defaults so the read path never throws.
//
// @param {number} orgIdNumeric
async function getOperatorConfig(orgIdNumeric) {
  if (!Number.isFinite(orgIdNumeric)) return { ...DEFAULT_OPERATOR_CONFIG };
  let stored = null;
  try {
    stored = await kv.get(key(orgIdNumeric));
  } catch (_) {
    // KV blip → defaults. Logged at the caller boundary (the
    // handler) because operator-config has no log import to
    // avoid the circular dep.
    stored = null;
  }
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_OPERATOR_CONFIG };
  // Merge: defaults provide every field; stored OVERRIDES per key.
  // Re-validate at read time so a stale invalid value (manual KV
  // mutation, prior validation drift) doesn't corrupt the read.
  const validated = validatePartial(stored);
  if (!validated.ok) return { ...DEFAULT_OPERATOR_CONFIG };
  return { ...DEFAULT_OPERATOR_CONFIG, ...validated.value };
}

// Persist a partial config. Only the validated keys land in KV; an
// invalid value bounces with { ok: false, errors } so the caller
// can surface them. Merges with any existing config so a single-knob
// PATCH doesn't clobber previously-set knobs.
//
// @param {number} orgIdNumeric
// @param {any} partial
async function setOperatorConfig(orgIdNumeric, partial) {
  if (!Number.isFinite(orgIdNumeric)) return { ok: false, errors: ['orgIdNumeric required'] };
  const validated = validatePartial(partial);
  if (!validated.ok) return { ok: false, errors: validated.errors };
  // Read-merge-write so a single-knob PATCH never clobbers other
  // knobs the org has set. Re-validation of the existing stored
  // value happens implicitly via the merge — the input we just
  // validated wins.
  let existing = {};
  try {
    const stored = await kv.get(key(orgIdNumeric));
    if (stored && typeof stored === 'object') existing = stored;
  } catch (_) {
    existing = {};
  }
  const merged = { ...existing, ...validated.value };
  try {
    await kv.set(key(orgIdNumeric), merged);
  } catch (err) {
    return { ok: false, errors: [`kv write failed: ${err instanceof Error ? err.message : String(err)}`] };
  }
  // Return the effective config (defaults + merged) so the caller
  // can echo it back to the UI without a second read.
  return { ok: true, config: { ...DEFAULT_OPERATOR_CONFIG, ...merged } };
}

module.exports = {
  DEFAULT_OPERATOR_CONFIG,
  KEY_PREFIX,
  getOperatorConfig,
  setOperatorConfig,
  validatePartial,
};
