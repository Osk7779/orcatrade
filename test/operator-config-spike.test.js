'use strict';

// Sprint 43 — extends per-org operator-config with the
// declineSpikeRateMultiplier knob. Sprint 42 made the sprint-38
// stall threshold dialable; sprint 43 does the same for the sprint-40
// spike multiplier. Closes the per-org config story across BOTH
// proactive trifectas.
//
// Tests cover four layers:
//   1. DEFAULT_OPERATOR_CONFIG: new knob present with value 2; the
//      sprint-42 stall knob is unchanged (no regression)
//   2. validatePartial: accepts one-decimal floats in [1.5, 10];
//      rejects two-decimal precision (1.55), out-of-range, infinity,
//      NaN, non-finite; coexists with the sprint-42 stall knob (a
//      single PATCH can update both)
//   3. aggregateOpsInsights threading: new param flows; defensive
//      [1.5, 10] re-bound at the deepest layer; effective value
//      used in the spike-classifier rate gate AND surfaced in the
//      declineSpike.rateMultiplier response field
//   4. Cron + UI: runImportRequestDeclineSpikeAlert loads config +
//      passes through; OperatorConfigPanel renders the second field
//      with the right range gates + reads the effective multiplier
//      from data.declineSpike.rateMultiplier
//
// The "store as raw value, surface effective" pattern (sprint 42)
// extends cleanly here. Drift-guard pins that BOTH the classifier
// AND the response field read from the same effective variable so
// a UI showing "currently 2.5×" can never lie about what the SQL
// actually used.

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

test('DEFAULT_OPERATOR_CONFIG.declineSpikeRateMultiplier = 2 (matches sprint-40 default)', () => {
  // 2 mirrors the sprint-40 DECLINE_SPIKE_RATE_MULT constant so an
  // org that never touches config sees no behaviour change.
  assert.equal(operatorConfig.DEFAULT_OPERATOR_CONFIG.declineSpikeRateMultiplier, 2);
});

test('DEFAULT_OPERATOR_CONFIG.stallThresholdDays still 7 (sprint-42 not regressed)', () => {
  assert.equal(operatorConfig.DEFAULT_OPERATOR_CONFIG.stallThresholdDays, 7);
});

// ── validatePartial — float-typed knob ─────────────────────────────

test('validatePartial accepts one-decimal floats in [1.5, 10] for declineSpikeRateMultiplier', () => {
  // The strict-to-tolerant band. Boundary values + a typical value.
  for (const v of [1.5, 2.0, 2.5, 3.7, 10.0, 10]) {
    const r = operatorConfig.validatePartial({ declineSpikeRateMultiplier: v });
    assert.equal(r.ok, true, `expected ${v} to pass`);
    assert.equal(r.value.declineSpikeRateMultiplier, v);
  }
});

test('validatePartial rejects two-or-more-decimal precision (the 30d baseline lacks the resolution)', () => {
  // 1.55 isn't meaningfully distinguishable from 1.5 against a
  // 30-day baseline. Pin the one-decimal precision check.
  for (const v of [1.55, 2.001, 2.123]) {
    const r = operatorConfig.validatePartial({ declineSpikeRateMultiplier: v });
    assert.equal(r.ok, false, `expected ${v} to fail`);
    assert.match(r.errors[0], /at most one decimal place/i);
  }
});

test('validatePartial rejects out-of-range, NaN, Infinity', () => {
  // Below 1.5 and above 10 are out. NaN/Infinity from
  // Number(badInput) must surface as "not finite", NOT silently
  // pass as a number.
  for (const v of [0, 1, 1.4, 10.1, 11, 99, NaN, Infinity, -Infinity]) {
    const r = operatorConfig.validatePartial({ declineSpikeRateMultiplier: v });
    assert.equal(r.ok, false, `expected ${v} to fail`);
  }
});

test('validatePartial accepts BOTH knobs in a single PATCH payload (config coexistence)', () => {
  // A user dialing both at once shouldn't have to fire two PATCHes.
  const r = operatorConfig.validatePartial({
    stallThresholdDays: 14,
    declineSpikeRateMultiplier: 1.5,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    stallThresholdDays: 14,
    declineSpikeRateMultiplier: 1.5,
  });
});

// ── aggregateOpsInsights threading ─────────────────────────────────

test('aggregateOpsInsights accepts declineSpikeRateMultiplier + uses it in the rate gate', () => {
  // The classifier MUST read the effective value, not the
  // constant — otherwise a per-org override would silently fail
  // to bite.
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block, 'aggregateOpsInsights body not located');
  const body = block[0];
  assert.match(body, /effectiveSpikeMultiplier/);
  assert.match(body, /if \(currentRate < effectiveSpikeMultiplier \* baselineRate\) continue/);
});

test('aggregateOpsInsights defensively re-bounds declineSpikeRateMultiplier to [1.5, 10]', () => {
  // Defence-in-depth — operator-config validates the same range at
  // write time, but the deepest layer must guard against a corrupt
  // cache entry surfacing a junk multiplier (e.g. 0.001 → never
  // flag anything, 100 → never trigger).
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(
    body,
    /Number\.isFinite\(candidateMultiplier\) && candidateMultiplier >= 1\.5 && candidateMultiplier <= 10/,
  );
});

test('aggregateOpsInsights surfaces EFFECTIVE multiplier in declineSpike.rateMultiplier', () => {
  // The UI + email composers read this — same source-of-truth
  // discipline as sprint-42's stalledQueue.thresholdDays. Without
  // this, the panel could show "Spike: 2.0×" while the SQL
  // actually used 2.5×.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(body, /rateMultiplier: effectiveSpikeMultiplier/);
});

// ── Cron threading ────────────────────────────────────────────────

test('runImportRequestDeclineSpikeAlert loads operator-config + passes declineSpikeRateMultiplier', () => {
  // Alert numbers MUST match what an admin sees on the live
  // cockpit when reading the same config.
  const block = CRON_SRC.match(/async function runImportRequestDeclineSpikeAlert\([\s\S]*?\n\}/);
  assert.ok(block, 'runImportRequestDeclineSpikeAlert body not located');
  const body = block[0];
  assert.match(body, /require\(['"]\.\.\/operator-config['"]\)/);
  assert.match(body, /const orgConfig = await operatorConfig\.getOperatorConfig\(orgIdNumeric\)/);
  assert.match(body, /declineSpikeRateMultiplier: orgConfig\.declineSpikeRateMultiplier/);
});

// ── TS mirror ──────────────────────────────────────────────────────

test('TS OperatorConfig extends with declineSpikeRateMultiplier: number', () => {
  // Cross-layer breadcrumb — a JS widening without TS narrowing
  // would silently weaken the toggle's type-checking.
  assert.match(
    API_TS,
    /export interface OperatorConfig \{[\s\S]*?stallThresholdDays: number;[\s\S]*?declineSpikeRateMultiplier: number;[\s\S]*?\}/,
  );
});

// ── UI ─────────────────────────────────────────────────────────────

test('OperatorConfigPanel accepts BOTH effective values as props', () => {
  // Both currents flow in via props pulled from
  // data.{stalledQueue,declineSpike} so the panel is always in
  // sync with the cohorts above + below.
  assert.match(
    INSIGHTS_TSX,
    /<OperatorConfigPanel\s+currentStallThreshold=\{data\.stalledQueue\.thresholdDays\}\s+currentSpikeMultiplier=\{data\.declineSpike\.rateMultiplier\}/,
  );
});

test('OperatorConfigPanel renders the decline-spike sensitivity field with [1.5, 10] range gates', () => {
  // The HTML input range MIRRORS the server's validation gate so
  // the user can't submit out-of-range values without seeing
  // browser-side feedback first.
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block, 'OperatorConfigPanel body not located');
  const body = block[0];
  // Field exists with the right id + label.
  assert.match(body, /id="declineSpikeRateMultiplier"/);
  assert.match(body, /Decline-spike sensitivity \(multiplier\)/);
  // Range matches the server gate.
  assert.match(body, /min=\{1\.5\}/);
  assert.match(body, /max=\{10\}/);
  assert.match(body, /step=\{0\.1\}/);
});

test('OperatorConfigPanel Save sends ONLY the dirty fields (no spurious PATCH on unchanged knob)', () => {
  // Without this, a user who tweaked only the stall knob would
  // PATCH BOTH fields — including a no-op spike value — generating
  // a noise audit-log entry. Drift-guard pins the dirty-only PATCH
  // build.
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /if \(dirtyStall\) patch\.stallThresholdDays = Number\(pendingStall\)/);
  assert.match(body, /if \(dirtySpike\) patch\.declineSpikeRateMultiplier = Number\(pendingSpike\)/);
});

test('OperatorConfigPanel summary renders the EFFECTIVE multiplier in the collapsed view', () => {
  // The collapsed summary is the "settings overview" — both knobs'
  // current values surface so a user knows whether they need to
  // expand or not.
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  // One-decimal precision in the summary; .toFixed(1) on the
  // effective value.
  assert.match(body, /currentSpikeMultiplier\.toFixed\(1\)/);
  // The "×" symbol marks the multiplier.
  assert.match(body, /×/);
});
