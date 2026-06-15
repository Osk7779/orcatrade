// @ts-check
'use strict';

// Tier-A eligibility — the deterministic five-precondition gate defined
// in docs/adr/0020-tier-a-confidence-definition.md.
//
// A calculator output qualifies for the Tier-A badge (and therefore the
// liability-bearing accuracy guarantee from the Phase 3 strategic plan)
// if and only if ALL of TA-1 through TA-5 pass. Each precondition has
// a code-verifiable predicate; failure surfaces as a single named
// reason from REASONS so the audit log + UI can render it without
// inventing strings.
//
// This module is calculator-agnostic — it takes a normalised input
// shape and returns a verdict. Per-calculator integration (gathering
// the snapshots + escalations + overrides + coverage manifest for a
// specific quote) ships in later PRs, one per calculator.
//
// Strict ADR mapping
// ──────────────────
//   TA-1  every input has pinned snapshot with age ≤ 30 days
//   TA-2  every snapshot source_kind === 'primary_regulator'
//   TA-3  calculator-green-state stamp <= 24h ago
//   TA-4  no escalations AND no overrides
//   TA-5  input within calculator's declared coverage envelope
//
// Order of evaluation matches the ADR numbering. A quote that fails
// multiple preconditions surfaces the FIRST failure encountered — the
// audit-log reader can recompute the others from the persisted inputs.

const greenState = require('./green-state');
const coverage = require('./coverage');

/** Canonical failure-reason strings. Match the taxonomy in ADR 0020. */
const REASONS = Object.freeze({
  STALE_SNAPSHOT: 'snapshot-stale-TA1',
  NON_PRIMARY_SOURCE: 'non-primary-source-TA2',
  CALCULATOR_NOT_GREEN: 'calculator-not-green-TA3',
  ESCALATION_OR_OVERRIDE: 'escalation-or-override-TA4',
  OUTSIDE_COVERAGE: 'outside-coverage-TA5',
});

const SNAPSHOT_MAX_AGE_DAYS = 30;
const GREEN_STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PRIMARY_REGULATOR_SOURCE = 'primary_regulator';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} Snapshot
 * @property {string} id           short identifier, e.g. 'taric-2026Q2-ch85'
 * @property {string} source_kind  'primary_regulator' | 'mirror' | 'manual' | 'customer_supplied'
 * @property {string} as_of_iso    snapshot capture time as ISO-8601 string
 * @property {number} [freshness_days]  optional per-snapshot TA-1 window override (days).
 *   Defaults to {@link SNAPSHOT_MAX_AGE_DAYS} (30). Some primary regulators
 *   structurally publish on slower cadences than 30 days (e.g. Eurostat
 *   warehousing PPI is quarterly with a ~75-day publication lag — the
 *   "freshest" observation is always >30 days old by design). A calculator
 *   that knows its source's cadence declares it here so TA-1 evaluates
 *   against the cadence-aware floor instead of the default. Honesty
 *   discipline: the override must reflect the source's documented
 *   publication frequency + a small buffer, not "however stale our
 *   snapshot is today".
 */

/**
 * @typedef {Object} EligibilityInput
 * @property {string}    calculatorName              calculator that produced the quote (e.g. 'customs-quote')
 * @property {Snapshot[]} snapshots                  every pinned input the calculator consumed
 * @property {Array<*>}  [escalations]               human-review escalations on this quote (empty array = none)
 * @property {Array<*>}  [overrides]                 manual overrides on inputs/outputs (empty array = none)
 * @property {object}    coverageInput               input axes the calculator's coverage envelope checks
 * @property {object}    [calculatorCoverage]        the calculator's COVERAGE manifest (passed in so this module stays calculator-agnostic)
 */

/**
 * @typedef {Object} EligibilityVerdict
 * @property {boolean}  eligible
 * @property {string}   [failedReason]  one of REASONS — present iff eligible === false
 * @property {object}   [detail]        diagnostic context for the failed precondition
 * @property {string}   evaluatedAtIso  ISO time the verdict was computed (for audit log)
 * @property {number}   schemaVersion   bump on any contract change so persisted verdicts can be migrated
 */

/** Schema version of the persisted verdict shape. Bump on contract change. */
const SCHEMA_VERSION = 1;

/** @param {unknown} n */
function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * @param {Snapshot|undefined} snapshot
 * @param {number} nowMs
 */
function snapshotAgeDays(snapshot, nowMs) {
  if (!snapshot || typeof snapshot.as_of_iso !== 'string') return Infinity;
  const t = Date.parse(snapshot.as_of_iso);
  if (!isFiniteNumber(t)) return Infinity;
  return (nowMs - t) / MS_PER_DAY;
}

// ── TA-1: every snapshot ≤ 30 days old ────────────────────────────────

/**
 * @param {Snapshot[]|undefined} snapshots
 * @param {number} nowMs
 */
function checkTA1(snapshots, nowMs) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return { ok: false, detail: { reason: 'no snapshots supplied — Tier-A requires at least one pinned input' } };
  }
  for (const s of snapshots) {
    const age = snapshotAgeDays(s, nowMs);
    const override = s && isFiniteNumber(s.freshness_days) ? Number(s.freshness_days) : null;
    const maxAgeDays = override !== null && override > 0 ? override : SNAPSHOT_MAX_AGE_DAYS;
    if (!(age <= maxAgeDays)) {
      return {
        ok: false,
        detail: {
          snapshotId: s && s.id ? s.id : '(unknown)',
          ageDays: Number.isFinite(age) ? Number(age.toFixed(2)) : null,
          maxAgeDays,
        },
      };
    }
  }
  return { ok: true };
}

// ── TA-2: every snapshot from a primary-regulator source ──────────────

/** @param {Snapshot[]} snapshots */
function checkTA2(snapshots) {
  for (const s of snapshots) {
    if (!s || s.source_kind !== PRIMARY_REGULATOR_SOURCE) {
      return {
        ok: false,
        detail: {
          snapshotId: s && s.id ? s.id : '(unknown)',
          actualSourceKind: s && s.source_kind ? s.source_kind : '(missing)',
          requiredSourceKind: PRIMARY_REGULATOR_SOURCE,
        },
      };
    }
  }
  return { ok: true };
}

// ── TA-3: calculator green-state ≤ 24h ago ────────────────────────────

/**
 * @param {string} calculatorName
 * @param {number} nowMs
 * @param {(name: string) => Promise<string|null>} readLastGreenAt
 */
async function checkTA3(calculatorName, nowMs, readLastGreenAt) {
  const lastGreenIso = await readLastGreenAt(calculatorName);
  if (!lastGreenIso) {
    return {
      ok: false,
      detail: { calculatorName, lastGreenIso: null, reason: 'no green-state stamp recorded for this calculator' },
    };
  }
  const lastGreenMs = Date.parse(lastGreenIso);
  if (!isFiniteNumber(lastGreenMs)) {
    return { ok: false, detail: { calculatorName, lastGreenIso, reason: 'green-state stamp is not a valid ISO time' } };
  }
  const ageMs = nowMs - lastGreenMs;
  if (ageMs > GREEN_STATE_MAX_AGE_MS) {
    return {
      ok: false,
      detail: {
        calculatorName,
        lastGreenIso,
        ageHours: Number((ageMs / (60 * 60 * 1000)).toFixed(2)),
        maxAgeHours: GREEN_STATE_MAX_AGE_MS / (60 * 60 * 1000),
      },
    };
  }
  return { ok: true };
}

// ── TA-4: no escalations, no overrides ────────────────────────────────

/**
 * @param {unknown[]|undefined} escalations
 * @param {unknown[]|undefined} overrides
 */
function checkTA4(escalations, overrides) {
  const esc = Array.isArray(escalations) ? escalations : [];
  const ovr = Array.isArray(overrides) ? overrides : [];
  if (esc.length > 0 || ovr.length > 0) {
    return {
      ok: false,
      detail: {
        escalationCount: esc.length,
        overrideCount: ovr.length,
      },
    };
  }
  return { ok: true };
}

// ── TA-5: input within the calculator's declared coverage envelope ───

/**
 * @param {object|undefined} coverageInput
 * @param {object|undefined} calculatorCoverage
 */
function checkTA5(coverageInput, calculatorCoverage) {
  if (!calculatorCoverage) {
    return {
      ok: false,
      detail: { reason: 'calculator did not declare a coverage manifest — Tier-A requires one (see ADR 0020 + lib/intelligence/tier-a/coverage.js)' },
    };
  }
  // coverage.isWithinCoverage is duck-typed and tolerant of malformed manifests;
  // the typed cast just satisfies @ts-check while preserving the runtime contract.
  const result = coverage.isWithinCoverage(
    /** @type {import('./coverage').CoverageManifest} */ (calculatorCoverage),
    /** @type {Object<string, any>} */ (coverageInput || {}),
  );
  if (!result.within) {
    return { ok: false, detail: result };
  }
  return { ok: true };
}

/**
 * Evaluate Tier-A eligibility for a calculator output.
 *
 * @param {EligibilityInput} input
 * @param {{ nowMs?: number, readLastGreenAt?: (name: string) => Promise<string|null> }} [opts]
 *   nowMs           — override clock for deterministic tests (default: Date.now())
 *   readLastGreenAt — override green-state reader for deterministic tests (default: greenState.readLastGreenAt)
 * @returns {Promise<EligibilityVerdict>}
 */
async function evaluate(input, opts = {}) {
  const nowMs = typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();
  const readLastGreenAt = typeof opts.readLastGreenAt === 'function' ? opts.readLastGreenAt : greenState.readLastGreenAt;
  const evaluatedAtIso = new Date(nowMs).toISOString();

  if (!input || typeof input !== 'object') {
    return failure(REASONS.OUTSIDE_COVERAGE, { reason: 'no input supplied' }, evaluatedAtIso);
  }
  if (!input.calculatorName || typeof input.calculatorName !== 'string') {
    return failure(REASONS.OUTSIDE_COVERAGE, { reason: 'calculatorName required' }, evaluatedAtIso);
  }

  // Order matches ADR numbering. First failure wins; the audit reader can
  // recompute the rest from the persisted snapshots if needed.
  const ta1 = checkTA1(input.snapshots, nowMs);
  if (!ta1.ok) return failure(REASONS.STALE_SNAPSHOT, ta1.detail, evaluatedAtIso);

  const ta2 = checkTA2(input.snapshots);
  if (!ta2.ok) return failure(REASONS.NON_PRIMARY_SOURCE, ta2.detail, evaluatedAtIso);

  const ta3 = await checkTA3(input.calculatorName, nowMs, readLastGreenAt);
  if (!ta3.ok) return failure(REASONS.CALCULATOR_NOT_GREEN, ta3.detail, evaluatedAtIso);

  const ta4 = checkTA4(input.escalations, input.overrides);
  if (!ta4.ok) return failure(REASONS.ESCALATION_OR_OVERRIDE, ta4.detail, evaluatedAtIso);

  const ta5 = checkTA5(input.coverageInput, input.calculatorCoverage);
  if (!ta5.ok) return failure(REASONS.OUTSIDE_COVERAGE, ta5.detail, evaluatedAtIso);

  return {
    eligible: true,
    evaluatedAtIso,
    schemaVersion: SCHEMA_VERSION,
  };
}

/**
 * @param {string} failedReason
 * @param {object|undefined} detail
 * @param {string} evaluatedAtIso
 * @returns {EligibilityVerdict}
 */
function failure(failedReason, detail, evaluatedAtIso) {
  return {
    eligible: false,
    failedReason,
    detail: detail || {},
    evaluatedAtIso,
    schemaVersion: SCHEMA_VERSION,
  };
}

module.exports = {
  evaluate,
  REASONS,
  SCHEMA_VERSION,
  SNAPSHOT_MAX_AGE_DAYS,
  GREEN_STATE_MAX_AGE_MS,
  PRIMARY_REGULATOR_SOURCE,
  // Exposed for unit tests of individual preconditions
  _checkTA1: checkTA1,
  _checkTA2: checkTA2,
  _checkTA3: checkTA3,
  _checkTA4: checkTA4,
  _checkTA5: checkTA5,
};
