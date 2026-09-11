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
  // Sprint 64 — rating-trend drop sensitivity. The star-delta
  // threshold that gates the sprint-62 rating-trend classifier:
  // a cohort flags when (baselineAvg - currentAvg) >= threshold
  // (with the count floor also satisfied).
  //
  // Default 0.5 stars (matches sprint-62 RATING_TREND_DROP_
  // THRESHOLD constant for back-compat). Range [0.2, 2.0]:
  //   0.2 — strict (catches small drift before it compounds)
  //   1.0+ — tolerant (catches only obvious cliffs)
  // One-decimal precision matches the sprint-31 ratingCohort
  // rounding precision — the avg-rating itself is one decimal,
  // so threshold resolution finer than 0.1 is noise.
  ratingTrendDropThreshold: 0.5,
  // Sprint 71 — customer-side follow-up gate. The "no customer
  // decision in `quoted` for > N days" threshold that drives the
  // sprint-69 aging-quotes cohort + the sprint-70 daily alert.
  //
  // Default 5 days (matches sprint-69 QUOTE_FOLLOWUP_THRESHOLD_
  // DAYS constant for back-compat). Range [1, 30]:
  //   1 — strict (chase every silent customer within a day)
  //   14+ — tolerant (only long-cold quotes surface)
  // Integer only — the SQL uses ($2 || ' days')::interval so
  // sub-day resolution wouldn't survive the round-trip anyway.
  quoteFollowUpThresholdDays: 5,
  // Sprint 89 — per-org quote-turnaround SLA target (hours). The
  // negotiated-SLA pattern: a contract may commit tighter or
  // looser than the 48h platform default, and the org's cockpit
  // attainment (sprint 83) measures against THEIR number.
  // Deliberately does NOT move the public /api/sla page (the
  // platform-wide published commitment) or the cross-org triage
  // risk line — those stay on the platform target.
  // Range [4, 168]: 4h = same-business-morning aggressive;
  // 168h = one week, past which a "turnaround SLA" is fiction.
  slaQuoteTurnaroundTargetHours: 48,
  // Sprint 89 — per-org first-response SLA target (hours). Same
  // negotiated-SLA posture; measures the sprint-84 human-only
  // clock against the contract's number. Range [1, 72].
  slaFirstResponseTargetHours: 24,
});

// Sprint 67 — canonical list of the config knobs. Derived from
// DEFAULT_OPERATOR_CONFIG (single source of truth) + frozen so a
// callers can Object.freeze-check but not mutate. Used by:
//   - unsetKnobs (below) as the "known knob" allowlist
//   - the handler's reset[] validation, so an unknown knob 400s
//     without any KV mutation
// A new knob added to DEFAULT_OPERATOR_CONFIG automatically shows
// up here at boot; there's no hand-maintained parallel list.
const KNOB_KEYS = Object.freeze(Object.keys(DEFAULT_OPERATOR_CONFIG));

// Sprint 68 — SAP-GTS/ONESOURCE-style named "policy profiles."
// One click snaps all four knobs to the preset values so admins
// don't have to think about each dial individually.
//
// `balanced` MUST equal DEFAULT_OPERATOR_CONFIG so an org that
// never customises still identifies as `balanced` (not `custom`).
//
// `strict` = aggressive detection band — catches subtle drift,
// higher alert volume. Suits enterprise ops teams with tight
// SLAs who prefer over-alerting.
//
// `tolerant` = noise-floor band — only obvious cliffs trigger.
// Suits smaller teams who prefer to hear only the loud signals
// and can tolerate slower response times.
//
// All preset values are validated at boot (see the freeze +
// identifyPreset test) so a typo here or a future range change
// on a knob that leaves a preset out of band would surface
// immediately, not silently.
const PRESET_NAMES = Object.freeze(['strict', 'balanced', 'tolerant']);
const PRESETS = Object.freeze({
  strict: Object.freeze({
    stallThresholdDays: 3,
    declineSpikeRateMultiplier: 1.5,
    supplierConcentrationThreshold: 0.5,
    ratingTrendDropThreshold: 0.2,
    // Sprint 71 — chase silent customers within 2 days (tight
    // enterprise cadence). Lower bound = 1 in validation, but
    // 2 leaves headroom for a "reply-by-tomorrow" default.
    quoteFollowUpThresholdDays: 2,
    // Sprint 89 — tight-contract band: quote inside one working
    // day, first human touch inside a morning.
    slaQuoteTurnaroundTargetHours: 24,
    slaFirstResponseTargetHours: 8,
  }),
  // Balanced === defaults. Same values as DEFAULT_OPERATOR_CONFIG
  // so identifyPreset returns `balanced` for a config that has
  // never been customised.
  balanced: Object.freeze({
    stallThresholdDays: 7,
    declineSpikeRateMultiplier: 2,
    supplierConcentrationThreshold: 0.75,
    ratingTrendDropThreshold: 0.5,
    // Sprint 71 — 5 days (matches DEFAULT_OPERATOR_CONFIG for
    // the balanced === defaults identity invariant).
    quoteFollowUpThresholdDays: 5,
    // Sprint 89 — the platform commitments (identity invariant:
    // balanced MUST equal DEFAULT_OPERATOR_CONFIG).
    slaQuoteTurnaroundTargetHours: 48,
    slaFirstResponseTargetHours: 24,
  }),
  tolerant: Object.freeze({
    stallThresholdDays: 14,
    declineSpikeRateMultiplier: 5,
    supplierConcentrationThreshold: 0.9,
    ratingTrendDropThreshold: 1.5,
    // Sprint 71 — 10 days (only long-cold quotes surface).
    quoteFollowUpThresholdDays: 10,
    // Sprint 89 — loose-contract band: three working days to
    // quote, two to a first human touch.
    slaQuoteTurnaroundTargetHours: 72,
    slaFirstResponseTargetHours: 48,
  }),
});

// Sprint 68 — given an effective config (defaults + custom
// merged), return the preset name whose values match exactly,
// or 'custom' if no preset matches. Float comparison uses
// Math.abs < 1e-9 to survive IEEE-754 nudges from the same
// sprint-60/64 lesson (0.55 * 100 !== 55). The renderer uses
// the return to highlight the active preset chip.
//
// @param {typeof DEFAULT_OPERATOR_CONFIG} effective
function identifyPreset(effective) {
  if (!effective || typeof effective !== 'object') return 'custom';
  for (const name of PRESET_NAMES) {
    const preset = PRESETS[name];
    let matches = true;
    for (const knob of KNOB_KEYS) {
      const a = Number(effective[knob]);
      const b = Number(preset[knob]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 1e-9) {
        matches = false;
        break;
      }
    }
    if (matches) return name;
  }
  return 'custom';
}

// Sprint 73 — build the reversal plan for one history entry. The
// SAP-GTS pattern: an undo is a REVERSAL DOCUMENT (a new change
// that restores prior values through the normal mutation + audit
// path), never a deletion of history. Pure function — takes the
// projected history entry (listOperatorConfigHistory shape) and
// returns { ok, set, reset } or { ok: false, error }:
//   - previous[k] === null  → the knob was at platform default
//                             before the change → reset it
//   - previous[k] = number  → the knob was custom → set it back
// Truthful-refusal discipline: entries with no `previous` (sprint
// 42..71 legacy, or the pre-mutation read failed at write time)
// are NOT undoable — we never guess what the prior state was.
// Unknown knob names refuse too (a malformed historical event
// must not drive a mutation).
//
// @param {{ previous?: Record<string, unknown> | null } | null} entry
function buildUndoPlan(entry) {
  if (!entry || typeof entry !== 'object') {
    return { ok: false, error: 'nothing to undo' };
  }
  const previous = entry.previous;
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) {
    return {
      ok: false,
      error: 'cannot undo: the last change predates before-value capture',
    };
  }
  const keys = Object.keys(previous);
  if (keys.length === 0) {
    return { ok: false, error: 'cannot undo: no before-values recorded' };
  }
  const known = new Set(KNOB_KEYS);
  /** @type {Record<string, number>} */
  const set = {};
  /** @type {string[]} */
  const reset = [];
  for (const k of keys) {
    if (!known.has(k)) {
      return { ok: false, error: `cannot undo: unknown knob in history entry: ${k}` };
    }
    const v = previous[k];
    if (v === null) {
      reset.push(k);
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      set[k] = v;
    } else {
      return { ok: false, error: `cannot undo: malformed before-value for ${k}` };
    }
  }
  return { ok: true, set, reset };
}

// Sprint 75 — org-level alert cadence. `daily` (the default —
// current behaviour) keeps the three daily proactive alert emails
// (stalled 08:00, decline-spike 08:30, aging-quotes 08:45) firing;
// `weekly` suppresses them org-wide so the org hears about those
// signals via the weekly digests + the live cockpit only. The
// ONESOURCE/SAP-GTS "notification policy" pattern — org-level
// noise control layered UNDER the per-recipient prefs (a daily-
// cadence org still honours each recipient's mute).
//
// Deliberately NOT a sixth knob in DEFAULT_OPERATOR_CONFIG: the
// knob machinery is numeric-typed end to end (validatePartial
// branches, preset values, identifyPreset's Number() comparison)
// — an enum in KNOB_KEYS would silently break preset identity
// (every org would identify as `custom`). Separate KV namespace,
// same PATCH surface + audit history.
//
// Storage discipline: the default is stored as ABSENCE (kv.del on
// a reset to 'daily') so the keyspace only holds real overrides —
// the same posture as unsetKnobs.
const ALERT_CADENCES = Object.freeze(['daily', 'weekly']);
const DEFAULT_ALERT_CADENCE = 'daily';
const CADENCE_KEY_PREFIX = 'operator-alert-cadence:';

function cadenceKey(orgIdNumeric) {
  return CADENCE_KEY_PREFIX + String(orgIdNumeric).trim();
}

// Fail-open read: a KV blip or a malformed stored value resolves
// to the default — the read path (cron fan-outs, GET projection)
// never throws. A malformed value degrading to 'daily' means a
// noisy org gets alerts it asked to silence for one cycle — the
// safe failure direction (missed alerts would be the dangerous
// one).
//
// @param {number} orgIdNumeric
async function getAlertCadence(orgIdNumeric) {
  if (!Number.isFinite(orgIdNumeric)) return DEFAULT_ALERT_CADENCE;
  let stored = null;
  try {
    stored = await kv.get(cadenceKey(orgIdNumeric));
  } catch (_) {
    stored = null;
  }
  return (typeof stored === 'string' && ALERT_CADENCES.includes(stored))
    ? stored
    : DEFAULT_ALERT_CADENCE;
}

// @param {number} orgIdNumeric
// @param {string} value
async function setAlertCadence(orgIdNumeric, value) {
  if (!Number.isFinite(orgIdNumeric)) {
    return { ok: false, errors: ['orgIdNumeric required'] };
  }
  if (typeof value !== 'string' || !ALERT_CADENCES.includes(value)) {
    return {
      ok: false,
      errors: [`alertCadence must be one of: ${ALERT_CADENCES.join(' | ')}`],
    };
  }
  try {
    if (value === DEFAULT_ALERT_CADENCE) {
      // Default = absence — keeps the keyspace to real overrides.
      await kv.del(cadenceKey(orgIdNumeric));
    } else {
      await kv.set(cadenceKey(orgIdNumeric), value);
    }
  } catch (err) {
    return {
      ok: false,
      errors: [`kv write failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  return { ok: true, alertCadence: value };
}

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
  // Sprint 64 — one-decimal float knob mirroring the sprint-43
  // declineSpikeRateMultiplier shape:
  //   - Number.isFinite catches NaN/Infinity/null/object
  //   - Epsilon `Math.abs(Math.round(n * 10) - n * 10) > 1e-9`
  //     enforces one-decimal precision (IEEE-754 lesson from
  //     sprint 60 — `0.3 * 10 === 3.0000000000000004`, strict-
  //     equality would reject legitimate one-decimal values)
  //   - Range [0.2, 2.0] — strict-to-tolerant band
  if (Object.prototype.hasOwnProperty.call(partial, 'ratingTrendDropThreshold')) {
    const raw = partial.ratingTrendDropThreshold;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      errors.push('ratingTrendDropThreshold must be a finite number');
    } else if (Math.abs(Math.round(n * 10) - n * 10) > 1e-9) {
      errors.push('ratingTrendDropThreshold must have at most one decimal place');
    } else if (n < 0.2 || n > 2.0) {
      errors.push('ratingTrendDropThreshold must be between 0.2 and 2.0');
    } else {
      out.ratingTrendDropThreshold = n;
    }
  }
  // Sprint 71 — integer knob mirroring the sprint-42 stall shape:
  //   - Number.isInteger + String round-trip catches "5.5" strings
  //     that Number() would coerce to a non-integer
  //   - Range [1, 30] — strict-to-tolerant band
  if (Object.prototype.hasOwnProperty.call(partial, 'quoteFollowUpThresholdDays')) {
    const raw = partial.quoteFollowUpThresholdDays;
    const n = Number(raw);
    if (!Number.isInteger(n) || String(n) !== String(raw)) {
      errors.push('quoteFollowUpThresholdDays must be a plain integer');
    } else if (n < 1 || n > 30) {
      errors.push('quoteFollowUpThresholdDays must be between 1 and 30');
    } else {
      out.quoteFollowUpThresholdDays = n;
    }
  }
  // Sprint 89 — integer knobs mirroring the sprint-42/71 shape
  // (Number.isInteger + String round-trip catches "48.5" strings).
  if (Object.prototype.hasOwnProperty.call(partial, 'slaQuoteTurnaroundTargetHours')) {
    const raw = partial.slaQuoteTurnaroundTargetHours;
    const n = Number(raw);
    if (!Number.isInteger(n) || String(n) !== String(raw)) {
      errors.push('slaQuoteTurnaroundTargetHours must be a plain integer');
    } else if (n < 4 || n > 168) {
      errors.push('slaQuoteTurnaroundTargetHours must be between 4 and 168');
    } else {
      out.slaQuoteTurnaroundTargetHours = n;
    }
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'slaFirstResponseTargetHours')) {
    const raw = partial.slaFirstResponseTargetHours;
    const n = Number(raw);
    if (!Number.isInteger(n) || String(n) !== String(raw)) {
      errors.push('slaFirstResponseTargetHours must be a plain integer');
    } else if (n < 1 || n > 72) {
      errors.push('slaFirstResponseTargetHours must be between 1 and 72');
    } else {
      out.slaFirstResponseTargetHours = n;
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

// Sprint 67 — reset knobs back to their platform default. Removes
// the named keys from the stored partial so the next read gets
// DEFAULTS merged in (no custom override). Cleaner than accepting
// `null` on setOperatorConfig — the audit event's detail carries
// `reset: [key, ...]` distinctly from `patched: { key: value }`
// so the renderer can tell them apart at a glance.
//
// Empty keys[] is a no-op success (returns effective config
// unchanged). Unknown keys 400 as `{ ok: false, errors: [...] }`
// so an out-of-date client never silently wipes state it didn't
// mean to touch.
//
// @param {number} orgIdNumeric
// @param {ReadonlyArray<string>} keys
async function unsetKnobs(orgIdNumeric, keys) {
  if (!Number.isFinite(orgIdNumeric)) {
    return { ok: false, errors: ['orgIdNumeric required'] };
  }
  if (!Array.isArray(keys)) {
    return { ok: false, errors: ['keys must be an array of knob names'] };
  }
  if (keys.length === 0) {
    // No-op — return the current effective config unchanged.
    const current = await getOperatorConfig(orgIdNumeric);
    return { ok: true, config: current };
  }
  const known = new Set(KNOB_KEYS);
  const errors = [];
  const dedup = [];
  const seen = new Set();
  for (const k of keys) {
    if (typeof k !== 'string' || !known.has(k)) {
      errors.push(`unknown knob key: ${String(k)}`);
      continue;
    }
    if (!seen.has(k)) {
      seen.add(k);
      dedup.push(k);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  let existing = {};
  try {
    const stored = await kv.get(key(orgIdNumeric));
    if (stored && typeof stored === 'object') existing = stored;
  } catch (_) {
    existing = {};
  }
  const next = { ...existing };
  for (const k of dedup) delete next[k];
  try {
    await kv.set(key(orgIdNumeric), next);
  } catch (err) {
    return {
      ok: false,
      errors: [`kv write failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  return { ok: true, config: { ...DEFAULT_OPERATOR_CONFIG, ...next } };
}

module.exports = {
  DEFAULT_OPERATOR_CONFIG,
  KEY_PREFIX,
  KNOB_KEYS,
  PRESET_NAMES,
  PRESETS,
  ALERT_CADENCES,
  DEFAULT_ALERT_CADENCE,
  CADENCE_KEY_PREFIX,
  getAlertCadence,
  setAlertCadence,
  buildUndoPlan,
  getOperatorConfig,
  identifyPreset,
  setOperatorConfig,
  unsetKnobs,
  validatePartial,
};
