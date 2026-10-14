'use strict';

// Sprint 60 — extends per-org operator-config with the THIRD knob:
// the supplier-concentration threshold (sprint-57 cohort #9's
// sensitivity gate). Sprint 42 made the stall threshold dialable;
// sprint 43 did the same for the spike multiplier; sprint 60
// closes the per-org config story across all four proactive
// trifectas (stall has none + concentration was the last
// remaining hardcoded threshold).
//
// Tests cover four layers:
//   1. DEFAULT_OPERATOR_CONFIG: new knob present with value 0.75;
//      previous two knobs unchanged (no regression)
//   2. validatePartial: accepts two-decimal floats in [0.50, 0.95];
//      rejects three-decimal precision (0.755), out-of-range,
//      Infinity, NaN; coexists with the sprint-42/43 knobs
//   3. aggregateOpsInsights threading: new param flows; defensive
//      [0.50, 0.95] re-bound at the deepest layer; effective value
//      used in the classifier gate AND surfaced in the
//      supplierConcentration.threshold response field
//   4. Cron + UI: runImportRequestSupplierConcentrationAlert
//      loads config + passes through; OperatorConfigPanel renders
//      the third field with the right range gates + reads the
//      effective threshold from data.supplierConcentration.threshold

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const operatorConfig = require('../lib/operator-config');

const ROOT = path.resolve(__dirname, '..');
const HELPER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'operator-config.js'), 'utf8');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const CRON_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'cron.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// ── Defaults ──────────────────────────────────────────────────────

test('DEFAULT_OPERATOR_CONFIG.supplierConcentrationThreshold = 0.75 (matches sprint-57 default)', () => {
  // 0.75 mirrors the sprint-57 SUPPLIER_CONCENTRATION_THRESHOLD
  // constant so an org that never touches config sees zero
  // behaviour change.
  assert.equal(operatorConfig.DEFAULT_OPERATOR_CONFIG.supplierConcentrationThreshold, 0.75);
});

test('DEFAULT_OPERATOR_CONFIG.stallThresholdDays + declineSpikeRateMultiplier still at sprint-42/43 defaults (no regression)', () => {
  assert.equal(operatorConfig.DEFAULT_OPERATOR_CONFIG.stallThresholdDays, 7);
  assert.equal(operatorConfig.DEFAULT_OPERATOR_CONFIG.declineSpikeRateMultiplier, 2);
});

// ── validatePartial — two-decimal float knob ──────────────────────

test('validatePartial accepts two-decimal floats in [0.50, 0.95] for supplierConcentrationThreshold', () => {
  for (const v of [0.5, 0.55, 0.6, 0.75, 0.8, 0.85, 0.9, 0.95]) {
    const r = operatorConfig.validatePartial({ supplierConcentrationThreshold: v });
    assert.equal(r.ok, true, `expected ${v} to pass`);
    assert.equal(r.value.supplierConcentrationThreshold, v);
  }
});

test('validatePartial rejects three-or-more-decimal precision (band is two-decimal)', () => {
  // 0.755 isn't meaningfully distinguishable from 0.75 against
  // a 30-day window. Pin the two-decimal precision check.
  for (const v of [0.755, 0.7501, 0.001, 0.123]) {
    const r = operatorConfig.validatePartial({ supplierConcentrationThreshold: v });
    assert.equal(r.ok, false, `expected ${v} to fail`);
    assert.match(r.errors[0], /at most two decimal places/i);
  }
});

test('validatePartial rejects out-of-range, NaN, Infinity for supplierConcentrationThreshold', () => {
  for (const v of [0, 0.49, 0.96, 1, 2, NaN, Infinity, -Infinity]) {
    const r = operatorConfig.validatePartial({ supplierConcentrationThreshold: v });
    assert.equal(r.ok, false, `expected ${v} to fail`);
  }
});

test('validatePartial accepts ALL three knobs in a single PATCH payload (config coexistence)', () => {
  // A user dialing all three at once shouldn't have to fire
  // three PATCHes. Cross-layer coexistence pinned.
  const r = operatorConfig.validatePartial({
    stallThresholdDays: 14,
    declineSpikeRateMultiplier: 1.5,
    supplierConcentrationThreshold: 0.6,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    stallThresholdDays: 14,
    declineSpikeRateMultiplier: 1.5,
    supplierConcentrationThreshold: 0.6,
  });
});

// ── aggregateOpsInsights threading ─────────────────────────────────

test('aggregateOpsInsights accepts supplierConcentrationThreshold + uses it in the classifier gate', () => {
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block, 'aggregateOpsInsights body not located');
  const body = block[0];
  assert.match(body, /effectiveConcentrationThreshold/);
  assert.match(body, /concentrationShare >= effectiveConcentrationThreshold/);
});

test('aggregateOpsInsights defensively re-bounds supplierConcentrationThreshold to [0.50, 0.95]', () => {
  // Defence-in-depth — operator-config validates the same range
  // at write time, but the deepest layer must guard against a
  // corrupt cache entry that bypassed validation (e.g. 0.001 →
  // never flag anything, 1.5 → never trigger).
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(
    body,
    /Number\.isFinite\(candidateConcentration\) && candidateConcentration >= 0\.5 && candidateConcentration <= 0\.95/,
  );
});

test('aggregateOpsInsights surfaces EFFECTIVE threshold in supplierConcentration.threshold', () => {
  // UI + email composers read this — same source-of-truth
  // discipline as sprint-42's stalledQueue.thresholdDays +
  // sprint-43's declineSpike.rateMultiplier. Without this, the
  // panel could show "Conc: 60%" while the SQL actually used
  // 75%.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(body, /threshold: effectiveConcentrationThreshold/);
});

// ── Cron threading ────────────────────────────────────────────────

test('runImportRequestSupplierConcentrationAlert loads operator-config + passes threshold', () => {
  // Alert numbers MUST match what an admin sees on the live
  // cockpit when reading the same config.
  const block = CRON_SRC.match(/async function runImportRequestSupplierConcentrationAlert\([\s\S]*?\n\}/);
  assert.ok(block, 'runImportRequestSupplierConcentrationAlert body not located');
  const body = block[0];
  assert.match(body, /require\(['"]\.\.\/operator-config['"]\)/);
  assert.match(body, /const orgConfig = await operatorConfig\.getOperatorConfig\(orgIdNumeric\)/);
  assert.match(body, /supplierConcentrationThreshold: orgConfig\.supplierConcentrationThreshold/);
});

// ── TS mirror ──────────────────────────────────────────────────────

test('TS OperatorConfig extends with supplierConcentrationThreshold: number', () => {
  assert.match(
    API_TS,
    /export interface OperatorConfig \{[\s\S]*?stallThresholdDays: number;[\s\S]*?declineSpikeRateMultiplier: number;[\s\S]*?supplierConcentrationThreshold: number;[\s\S]*?\}/,
  );
});

// ── UI ─────────────────────────────────────────────────────────────

test('OperatorConfigPanel accepts ALL THREE effective values as props', () => {
  assert.match(
    INSIGHTS_TSX,
    /<OperatorConfigPanel\s+currentStallThreshold=\{data\.stalledQueue\.thresholdDays\}\s+currentSpikeMultiplier=\{data\.declineSpike\.rateMultiplier\}\s+currentConcentrationThreshold=\{data\.supplierConcentration\.threshold\}/,
  );
});

test('OperatorConfigPanel renders the concentration field with [0.50, 0.95] range gates + 0.05 step', () => {
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block, 'OperatorConfigPanel body not located');
  const body = block[0];
  assert.match(body, /id="supplierConcentrationThreshold"/);
  assert.match(body, /Supplier-concentration sensitivity \(share\)/);
  assert.match(body, /min=\{0\.5\}/);
  assert.match(body, /max=\{0\.95\}/);
  assert.match(body, /step=\{0\.05\}/);
});

test('OperatorConfigPanel Save sends ONLY the dirty fields (no spurious PATCH on unchanged knobs)', () => {
  // Without this, a user who tweaked only the stall knob would
  // PATCH ALL three fields — including no-op concentration +
  // spike values — generating noise audit-log entries.
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /if \(dirtyStall\) patch\.stallThresholdDays = Number\(pendingStall\)/);
  assert.match(body, /if \(dirtySpike\) patch\.declineSpikeRateMultiplier = Number\(pendingSpike\)/);
  assert.match(body, /if \(dirtyConcentration\) patch\.supplierConcentrationThreshold = Number\(pendingConcentration\)/);
});

test('OperatorConfigPanel summary renders the EFFECTIVE threshold as integer percentage in the collapsed view', () => {
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  // Math.round(threshold * 100) for the integer-percentage
  // display (e.g. "75%"). Matches the sprint-57 card's display
  // posture.
  assert.match(body, /Math\.round\(currentConcentrationThreshold \* 100\)/);
});

test('OperatorConfigPanel dirty aggregate covers all three knobs (drift-guard against forgetting one)', () => {
  // The aggregate `dirty` is what gates the Save button — if a
  // knob is missing from the OR, dirtying it alone wouldn't
  // enable Save. Pin the three-way OR explicitly.
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  assert.match(block[0], /const dirty = dirtyStall \|\| dirtySpike \|\| dirtyConcentration/);
});
