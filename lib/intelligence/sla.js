// SLA engine — sprint 83 (Track C of the billion-dollar program).
//
// Enterprise buyers ask two questions the cohorts never answered:
// "what do you commit to?" and "how do you prove you hit it?"
// This module is the deterministic half of the answer: given the
// stamped lifecycle timestamps, compute measured attainment
// against a named target. No LLM (ADR 0003), no stored figure —
// stateless recomputation, the accuracy-ledger discipline.
//
// v1 commitment: QUOTE TURNAROUND — submitted → customer-visible
// 'quoted' (the quoted_at stamp, schema-023), 48-hour target,
// measured over a rolling 90-day window. First-write-only stamps
// mean reworks can't launder a slow first answer.
//
// Honesty gates are SHARED with the accuracy ledger (single
// source: below INDICATIVE_MIN scoreable rows the headline
// metrics are withheld; the count still ships). Two trust
// instruments with two different definitions of "enough data"
// would be a credibility bug.

'use strict';

const { INDICATIVE_MIN, MEASURED_MIN } = require('./accuracy-ledger');

// 48 hours = the two-working-day line most B2B quote SLAs draw.
// Rolling 90 days: long enough to be a track record, short enough
// that last quarter's ops don't mask this month's regression.
const SLA_QUOTE_TURNAROUND_TARGET_HOURS = 48;
const SLA_WINDOW_DAYS = 90;

// Sprint 84 — first-response commitment: 24 plain-clock hours to
// the first HUMAN ops action (review decision or ops message).
// Deliberately NOT the automated orchestrator transition — an
// instant machine transition would make this trivially 100%,
// which is marketing, not measurement.
const SLA_FIRST_RESPONSE_TARGET_HOURS = 24;

// Sprint 87 — triage risk line: a request still unquoted at 75%
// of the turnaround budget is AT RISK (36h of 48h spent — enough
// runway left to act, late enough that it needs an operator's
// eyes). Derived, not hand-set, so a future target change moves
// the risk line with it.
const SLA_RISK_FRACTION = 0.75;
function slaRiskThresholdHours() {
  return Math.round(SLA_QUOTE_TURNAROUND_TARGET_HOURS * SLA_RISK_FRACTION);
}

/** @param {number} n */
function round1(n) {
  return Math.round(n * 10) / 10;
}

// One row → turnaround hours, or null when unscoreable (missing or
// non-chronological stamps — a clock-skewed negative duration must
// be dropped, not counted as instant).
//
// @param {{ createdAt?: string, quotedAt?: string }} row
function turnaroundHours(row) {
  if (!row || typeof row !== 'object') return null;
  const created = Date.parse(String(row.createdAt || ''));
  const quoted = Date.parse(String(row.quotedAt || ''));
  if (!Number.isFinite(created) || !Number.isFinite(quoted)) return null;
  if (quoted < created) return null;
  return (quoted - created) / 3_600_000;
}

// Attainment over a set of rows. Same tier semantics as the
// accuracy ledger: 'insufficient' withholds every headline metric
// (a 100%-within-target claim over 3 rows is marketing).
//
// @param {Array<{ createdAt?: string, quotedAt?: string }>} rows
// @param {{ targetHours?: number }} opts
function computeSlaAttainment(rows, { targetHours = SLA_QUOTE_TURNAROUND_TARGET_HOURS } = {}) {
  const input = Array.isArray(rows) ? rows : [];
  const hours = [];
  for (const row of input) {
    const h = turnaroundHours(row);
    if (h !== null) hours.push(h);
  }
  const n = hours.length;
  const tier = n >= MEASURED_MIN ? 'measured' : (n >= INDICATIVE_MIN ? 'indicative' : 'insufficient');
  const withhold = tier === 'insufficient';

  const sorted = [...hours].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const medianH = n === 0 ? null : (n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
  // Nearest-rank p95 — the SLA number a procurement reviewer reads
  // as "all but the worst 5%".
  const p95H = n === 0 ? null : sorted[Math.min(n - 1, Math.ceil(0.95 * n) - 1)];

  return {
    targetHours,
    sampleSize: n,
    tier,
    withinTargetPct: (withhold || n === 0)
      ? null
      : Math.round((hours.filter((h) => h <= targetHours).length / n) * 100),
    medianHours: (withhold || medianH === null) ? null : round1(medianH),
    p95Hours: (withhold || p95H === null) ? null : round1(p95H),
  };
}

module.exports = {
  SLA_QUOTE_TURNAROUND_TARGET_HOURS,
  SLA_FIRST_RESPONSE_TARGET_HOURS,
  SLA_WINDOW_DAYS,
  SLA_RISK_FRACTION,
  slaRiskThresholdHours,
  turnaroundHours,
  computeSlaAttainment,
};
