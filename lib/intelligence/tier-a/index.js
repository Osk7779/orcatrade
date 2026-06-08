// @ts-check
'use strict';

// Public surface for the Tier-A eligibility module.
//
// Spec: docs/adr/0020-tier-a-confidence-definition.md
// Strategy frame: docs/strategic-plan-2026-2031.md §4.1.3 + §5.1
//
// This module is the deterministic eligibility gate behind OrcaTrade's
// Phase 3 liability-bearing accuracy guarantee. A calculator output
// qualifies for the Tier-A badge (and therefore the guarantee) iff
// `evaluate(input)` resolves to `{ eligible: true }`. Failures surface
// a single canonical REASONS string + diagnostic detail so audit-log
// readers and UI surfaces can render the reason without inventing
// strings.
//
// Calculator integration shape (per future PRs)
// ─────────────────────────────────────────────
// Each calculator that emits Tier-A-eligible outputs:
//   1. exports a `COVERAGE` manifest (see ./coverage.js for shape)
//   2. records its inputs as snapshots with source_kind/as_of_iso
//   3. calls tierA.evaluate(input) at quote-emit time
//   4. persists the verdict to the quote artefact + audit log

const { evaluate, REASONS, SCHEMA_VERSION, SNAPSHOT_MAX_AGE_DAYS, GREEN_STATE_MAX_AGE_MS, PRIMARY_REGULATOR_SOURCE } = require('./eligibility');
const coverage = require('./coverage');
const greenState = require('./green-state');

module.exports = {
  evaluate,
  REASONS,
  SCHEMA_VERSION,
  SNAPSHOT_MAX_AGE_DAYS,
  GREEN_STATE_MAX_AGE_MS,
  PRIMARY_REGULATOR_SOURCE,
  coverage,
  greenState,
};
