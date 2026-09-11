'use strict';

// Sprint 64 — extends per-org operator-config with the FOURTH
// knob: the rating-trend drop threshold (sprint-62 cohort #10's
// sensitivity gate). Sprint 42 made stall dialable; sprint 43
// spike multiplier; sprint 60 concentration threshold; sprint 64
// completes the per-org config story across ALL FIVE proactive
// cohorts (stall + spike + concentration + rating-drop; the
// stalled-queue cohort has no separate sensitivity beyond the
// stall threshold itself).
//
// Tests cover four layers:
//   1. DEFAULT_OPERATOR_CONFIG: new knob present with value 0.5;
//      previous three knobs unchanged (no regression)
//   2. validatePartial: accepts one-decimal floats in [0.2, 2.0];
//      rejects two-decimal precision (0.55), out-of-range,
//      Infinity, NaN; coexists with the sprint-42/43/60 knobs
//   3. aggregateOpsInsights threading: new param flows; defensive
//      [0.2, 2.0] re-bound at the deepest layer; effective value
//      used in the classifier gate AND surfaced in the
//      ratingTrend.dropThreshold response field
//   4. Cron + UI: runImportRequestRatingTrendAlert loads config
//      + passes through; OperatorConfigPanel renders the fourth
//      field with the right range gates + reads the effective
//      threshold from data.ratingTrend.dropThreshold

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const operatorConfig = require('../lib/operator-config');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const CRON_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'cron.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// ── Defaults ──────────────────────────────────────────────────────

test('DEFAULT_OPERATOR_CONFIG.ratingTrendDropThreshold = 0.5 (matches sprint-62 default)', () => {
  // 0.5★ mirrors the sprint-62 RATING_TREND_DROP_THRESHOLD
  // constant so an org that never touches config sees zero
  // behaviour change.
  assert.equal(operatorConfig.DEFAULT_OPERATOR_CONFIG.ratingTrendDropThreshold, 0.5);
});

test('Existing sprint-42/43/60 defaults unchanged (no regression)', () => {
  assert.equal(operatorConfig.DEFAULT_OPERATOR_CONFIG.stallThresholdDays, 7);
  assert.equal(operatorConfig.DEFAULT_OPERATOR_CONFIG.declineSpikeRateMultiplier, 2);
  assert.equal(operatorConfig.DEFAULT_OPERATOR_CONFIG.supplierConcentrationThreshold, 0.75);
});

// ── validatePartial — one-decimal float knob ──────────────────────

test('validatePartial accepts one-decimal floats in [0.2, 2.0] for ratingTrendDropThreshold', () => {
  // Boundary + typical values. Includes "0.3" (IEEE-754 sharp
  // edge — 0.3 * 10 === 3.0000000000000004 — the epsilon check
  // must pass this).
  for (const v of [0.2, 0.3, 0.5, 0.7, 1.0, 1.5, 2.0]) {
    const r = operatorConfig.validatePartial({ ratingTrendDropThreshold: v });
    assert.equal(r.ok, true, `expected ${v} to pass`);
    assert.equal(r.value.ratingTrendDropThreshold, v);
  }
});

test('validatePartial rejects two-or-more-decimal precision (one-decimal is the band)', () => {
  for (const v of [0.55, 0.501, 1.234]) {
    const r = operatorConfig.validatePartial({ ratingTrendDropThreshold: v });
    assert.equal(r.ok, false, `expected ${v} to fail`);
    assert.match(r.errors[0], /at most one decimal place/i);
  }
});

test('validatePartial rejects out-of-range, NaN, Infinity for ratingTrendDropThreshold', () => {
  for (const v of [0, 0.1, 2.1, 5, NaN, Infinity, -Infinity]) {
    const r = operatorConfig.validatePartial({ ratingTrendDropThreshold: v });
    assert.equal(r.ok, false, `expected ${v} to fail`);
  }
});

test('validatePartial accepts ALL FOUR knobs in a single PATCH payload (config coexistence)', () => {
  const r = operatorConfig.validatePartial({
    stallThresholdDays: 14,
    declineSpikeRateMultiplier: 1.5,
    supplierConcentrationThreshold: 0.6,
    ratingTrendDropThreshold: 0.3,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    stallThresholdDays: 14,
    declineSpikeRateMultiplier: 1.5,
    supplierConcentrationThreshold: 0.6,
    ratingTrendDropThreshold: 0.3,
  });
});

// ── aggregateOpsInsights threading ─────────────────────────────────

test('aggregateOpsInsights accepts ratingTrendDropThreshold + uses it in the classifier gate', () => {
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block, 'aggregateOpsInsights body not located');
  const body = block[0];
  assert.match(body, /effectiveRatingDropThreshold/);
  assert.match(
    body,
    /\(ratingTrendBaseline\.avg - ratingTrendCurrent\.avg\) >= effectiveRatingDropThreshold/,
  );
});

test('aggregateOpsInsights defensively re-bounds ratingTrendDropThreshold to [0.2, 2.0]', () => {
  // Defence-in-depth — same layered pattern as sprints 42/43/60.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(
    body,
    /Number\.isFinite\(candidateRatingDrop\) && candidateRatingDrop >= 0\.2 && candidateRatingDrop <= 2\.0/,
  );
});

test('aggregateOpsInsights surfaces EFFECTIVE threshold in ratingTrend.dropThreshold', () => {
  // UI + email composers read this — same source-of-truth
  // discipline as sprints 42/43/60. Without this, the panel
  // could show "Drop: 0.5★" while the SQL actually used 0.3★.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(body, /dropThreshold: effectiveRatingDropThreshold/);
});

// ── Cron threading ────────────────────────────────────────────────

test('runImportRequestRatingTrendAlert loads operator-config + passes ratingTrendDropThreshold', () => {
  const block = CRON_SRC.match(/async function runImportRequestRatingTrendAlert\([\s\S]*?\n\}/);
  assert.ok(block, 'runImportRequestRatingTrendAlert body not located');
  const body = block[0];
  assert.match(body, /require\(['"]\.\.\/operator-config['"]\)/);
  assert.match(body, /const orgConfig = await operatorConfig\.getOperatorConfig\(orgIdNumeric\)/);
  assert.match(body, /ratingTrendDropThreshold: orgConfig\.ratingTrendDropThreshold/);
});

// ── TS mirror ──────────────────────────────────────────────────────

test('TS OperatorConfig extends with ratingTrendDropThreshold: number (all four knobs pinned)', () => {
  assert.match(
    API_TS,
    /export interface OperatorConfig \{[\s\S]*?stallThresholdDays: number;[\s\S]*?declineSpikeRateMultiplier: number;[\s\S]*?supplierConcentrationThreshold: number;[\s\S]*?ratingTrendDropThreshold: number;[\s\S]*?\}/,
  );
});

// ── UI ─────────────────────────────────────────────────────────────

test('OperatorConfigPanel accepts ALL FOUR effective values as props', () => {
  assert.match(
    INSIGHTS_TSX,
    /<OperatorConfigPanel\s+currentStallThreshold=\{data\.stalledQueue\.thresholdDays\}\s+currentSpikeMultiplier=\{data\.declineSpike\.rateMultiplier\}\s+currentConcentrationThreshold=\{data\.supplierConcentration\.threshold\}\s+currentRatingDropThreshold=\{data\.ratingTrend\.dropThreshold\}/,
  );
});

test('OperatorConfigPanel renders the rating-drop field with [0.2, 2.0] range gates + 0.1 step', () => {
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block, 'OperatorConfigPanel body not located');
  const body = block[0];
  assert.match(body, /id="ratingTrendDropThreshold"/);
  assert.match(body, /Rating-trend drop sensitivity \(stars\)/);
  assert.match(body, /min=\{0\.2\}/);
  assert.match(body, /max=\{2\.0\}/);
  assert.match(body, /step=\{0\.1\}/);
});

test('OperatorConfigPanel Save sends ONLY the dirty fields (no spurious PATCH on unchanged knobs)', () => {
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /if \(dirtyStall\) patch\.stallThresholdDays = Number\(pendingStall\)/);
  assert.match(body, /if \(dirtySpike\) patch\.declineSpikeRateMultiplier = Number\(pendingSpike\)/);
  assert.match(body, /if \(dirtyConcentration\) patch\.supplierConcentrationThreshold = Number\(pendingConcentration\)/);
  assert.match(body, /if \(dirtyRatingDrop\) patch\.ratingTrendDropThreshold = Number\(pendingRatingDrop\)/);
});

test('OperatorConfigPanel summary renders the EFFECTIVE threshold as one-decimal stars', () => {
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /currentRatingDropThreshold\.toFixed\(1\)/);
});

test('OperatorConfigPanel dirty aggregate covers ALL FOUR knobs (drift-guard against forgetting one)', () => {
  // If dirtyRatingDrop is missing from the OR, dirtying only
  // that knob would silently disable Save. Pin the four-way OR.
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  assert.match(block[0], /const dirty = dirtyStall \|\| dirtySpike \|\| dirtyConcentration \|\| dirtyRatingDrop/);
});
