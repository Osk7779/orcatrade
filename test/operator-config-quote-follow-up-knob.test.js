'use strict';

// Sprint 71 — extends per-org operator-config with the FIFTH
// knob: quoteFollowUpThresholdDays (sprint-69 cohort #11's
// sensitivity gate). Completes the third leg of the trifecta
// for the aging-quotes cohort (sprint 69 = cohort → sprint 70
// = alert → sprint 71 = config knob), matching the trifectas
// already shipped for stall (42), spike (43), concentration
// (60) and rating-drop (64).
//
// Five knobs now cover every dialable proactive cohort:
//   stall (38) · spike (40) · concentration (57) · rating-drop
//   (62) · aging-quotes (69). Presets extend to five values too;
//   balanced === defaults invariant preserved.
//
// Tests cover six layers:
//   1. DEFAULT_OPERATOR_CONFIG: 5th knob present with value 5;
//      previous four defaults unchanged (regression guard).
//   2. validatePartial: accepts integer in [1, 30]; rejects
//      non-integer / out-of-range / non-plain strings; accepts
//      ALL FIVE knobs in a single PATCH.
//   3. PRESETS: strict/balanced/tolerant carry the new knob;
//      balanced === default (identity); monotonic ordering
//      preserved (strict < balanced < tolerant on the new
//      knob).
//   4. aggregateOpsInsights: threads new param; defensive
//      re-bound to [1, 30]; effective value used in SQL query
//      AND surfaced in response.
//   5. Cron: runImportRequestQuoteFollowUpAlert loads config +
//      passes quoteFollowUpThresholdDays.
//   6. TS + UI: OperatorConfig interface extended; panel
//      accepts 5 props; 5th field rendered with [1, 30] step={1};
//      dirty aggregate covers ALL FIVE knobs; label map + format
//      function extended.

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

test('DEFAULT_OPERATOR_CONFIG.quoteFollowUpThresholdDays = 5 (matches sprint-69 default)', () => {
  assert.equal(operatorConfig.DEFAULT_OPERATOR_CONFIG.quoteFollowUpThresholdDays, 5);
});

test('Existing sprint-42/43/60/64 defaults unchanged (no regression)', () => {
  assert.equal(operatorConfig.DEFAULT_OPERATOR_CONFIG.stallThresholdDays, 7);
  assert.equal(operatorConfig.DEFAULT_OPERATOR_CONFIG.declineSpikeRateMultiplier, 2);
  assert.equal(operatorConfig.DEFAULT_OPERATOR_CONFIG.supplierConcentrationThreshold, 0.75);
  assert.equal(operatorConfig.DEFAULT_OPERATOR_CONFIG.ratingTrendDropThreshold, 0.5);
});

// ── validatePartial — integer knob ────────────────────────────────

test('validatePartial accepts integer in [1, 30] for quoteFollowUpThresholdDays', () => {
  for (const v of [1, 2, 5, 10, 30]) {
    const r = operatorConfig.validatePartial({ quoteFollowUpThresholdDays: v });
    assert.equal(r.ok, true, `expected ${v} to pass`);
    assert.equal(r.value.quoteFollowUpThresholdDays, v);
  }
});

test('validatePartial rejects out-of-range for quoteFollowUpThresholdDays', () => {
  for (const v of [0, -1, 31, 100]) {
    const r = operatorConfig.validatePartial({ quoteFollowUpThresholdDays: v });
    assert.equal(r.ok, false, `expected ${v} to fail`);
    assert.match(r.errors[0], /between 1 and 30/i);
  }
});

test('validatePartial rejects non-integer for quoteFollowUpThresholdDays', () => {
  for (const v of [1.5, 5.7, NaN, Infinity, 'abc']) {
    const r = operatorConfig.validatePartial({ quoteFollowUpThresholdDays: v });
    assert.equal(r.ok, false, `expected ${v} to fail`);
  }
});

test('validatePartial accepts ALL FIVE knobs in a single PATCH payload (five-corners coexistence)', () => {
  const r = operatorConfig.validatePartial({
    stallThresholdDays: 14,
    declineSpikeRateMultiplier: 1.5,
    supplierConcentrationThreshold: 0.6,
    ratingTrendDropThreshold: 0.3,
    quoteFollowUpThresholdDays: 7,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    stallThresholdDays: 14,
    declineSpikeRateMultiplier: 1.5,
    supplierConcentrationThreshold: 0.6,
    ratingTrendDropThreshold: 0.3,
    quoteFollowUpThresholdDays: 7,
  });
});

// ── PRESETS ──────────────────────────────────────────────────────

test('PRESETS carry quoteFollowUpThresholdDays on all three profiles', () => {
  assert.equal(typeof operatorConfig.PRESETS.strict.quoteFollowUpThresholdDays, 'number');
  assert.equal(typeof operatorConfig.PRESETS.balanced.quoteFollowUpThresholdDays, 'number');
  assert.equal(typeof operatorConfig.PRESETS.tolerant.quoteFollowUpThresholdDays, 'number');
});

test('PRESETS.balanced.quoteFollowUpThresholdDays === DEFAULT (identity invariant preserved on 5th knob)', () => {
  // Sprint 68 pinned balanced === defaults; sprint 71 must NOT
  // silently break that invariant.
  assert.equal(
    operatorConfig.PRESETS.balanced.quoteFollowUpThresholdDays,
    operatorConfig.DEFAULT_OPERATOR_CONFIG.quoteFollowUpThresholdDays,
  );
});

test('PRESETS monotonic ordering preserved on the 5th knob (strict < balanced < tolerant)', () => {
  // Design invariant per sprint 68 — strict pushes tighter, tolerant
  // looser. New knob follows the same rule.
  assert.ok(
    operatorConfig.PRESETS.strict.quoteFollowUpThresholdDays
    < operatorConfig.PRESETS.balanced.quoteFollowUpThresholdDays,
  );
  assert.ok(
    operatorConfig.PRESETS.balanced.quoteFollowUpThresholdDays
    < operatorConfig.PRESETS.tolerant.quoteFollowUpThresholdDays,
  );
});

test('identifyPreset still resolves to `balanced` for a fresh default config (5-knob identity)', () => {
  // Adding a knob must NOT accidentally break the identity —
  // an untouched org must still identify as balanced, not
  // custom. Runtime check.
  assert.equal(
    operatorConfig.identifyPreset({ ...operatorConfig.DEFAULT_OPERATOR_CONFIG }),
    'balanced',
  );
});

// ── aggregateOpsInsights threading ─────────────────────────────────

test('aggregateOpsInsights accepts quoteFollowUpThresholdDays param', () => {
  const sig = DB_SRC.match(/async function aggregateOpsInsights\(\{[\s\S]*?\}\)/);
  assert.ok(sig);
  assert.match(sig[0], /quoteFollowUpThresholdDays/);
});

test('aggregateOpsInsights defensively re-bounds to [1, 30]', () => {
  // Defence-in-depth — same layered pattern as sprints 42/43/60/64.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(
    body,
    /Number\.isInteger\(candidateQuoteFollowUp\) && candidateQuoteFollowUp >= 1 && candidateQuoteFollowUp <= 30/,
  );
});

test('aggregateOpsInsights uses effectiveQuoteFollowUpThreshold in the SQL binding + surfaces it in the response', () => {
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  // SQL binding uses effective value (not the constant).
  assert.match(body, /String\(effectiveQuoteFollowUpThreshold\)/);
  // Response surfaces effective value under quoteFollowUp.thresholdDays.
  assert.match(body, /quoteFollowUp: \{[\s\S]*?thresholdDays: effectiveQuoteFollowUpThreshold/);
});

// ── Cron threading ────────────────────────────────────────────────

test('runImportRequestQuoteFollowUpAlert loads operator-config + passes quoteFollowUpThresholdDays', () => {
  const block = CRON_SRC.match(/async function runImportRequestQuoteFollowUpAlert\([\s\S]*?\n\}/);
  assert.ok(block, 'runImportRequestQuoteFollowUpAlert body not located');
  const body = block[0];
  assert.match(body, /require\(['"]\.\.\/operator-config['"]\)/);
  assert.match(body, /const orgConfig = await operatorConfig\.getOperatorConfig\(orgIdNumeric\)/);
  assert.match(body, /quoteFollowUpThresholdDays: orgConfig\.quoteFollowUpThresholdDays/);
});

// ── TS mirror ──────────────────────────────────────────────────────

test('TS OperatorConfig extends with quoteFollowUpThresholdDays: number (all FIVE knobs pinned)', () => {
  assert.match(
    API_TS,
    /export interface OperatorConfig \{[\s\S]*?stallThresholdDays: number;[\s\S]*?declineSpikeRateMultiplier: number;[\s\S]*?supplierConcentrationThreshold: number;[\s\S]*?ratingTrendDropThreshold: number;[\s\S]*?quoteFollowUpThresholdDays: number;[\s\S]*?\}/,
  );
});

// ── UI ─────────────────────────────────────────────────────────────

test('OperatorConfigPanel accepts ALL FIVE effective values as props', () => {
  assert.match(
    INSIGHTS_TSX,
    /<OperatorConfigPanel\s+currentStallThreshold=\{data\.stalledQueue\.thresholdDays\}\s+currentSpikeMultiplier=\{data\.declineSpike\.rateMultiplier\}\s+currentConcentrationThreshold=\{data\.supplierConcentration\.threshold\}\s+currentRatingDropThreshold=\{data\.ratingTrend\.dropThreshold\}\s+currentQuoteFollowUpThreshold=\{data\.quoteFollowUp\.thresholdDays\}/,
  );
});

test('OperatorConfigPanel renders the aging-quotes field with [1, 30] range gates + step={1}', () => {
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block, 'OperatorConfigPanel body not located');
  const body = block[0];
  assert.match(body, /id="quoteFollowUpThresholdDays"/);
  assert.match(body, /Aging-quotes follow-up gate \(days\)/);
  assert.match(body, /min=\{1\}[\s\S]*?max=\{30\}[\s\S]*?step=\{1\}/);
});

test('OperatorConfigPanel Save sends the dirty 5th field (no spurious PATCH on unchanged)', () => {
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /if \(dirtyQuoteFollowUp\) patch\.quoteFollowUpThresholdDays = Number\(pendingQuoteFollowUp\)/);
});

test('OperatorConfigPanel dirty aggregate covers ALL FIVE knobs (five-corners pin)', () => {
  // If dirtyQuoteFollowUp is missing from the OR, dirtying only
  // that knob would silently disable Save. Pin the five-way OR.
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  assert.match(
    block[0],
    /const dirty = dirtyStall \|\| dirtySpike \|\| dirtyConcentration \|\| dirtyRatingDrop \|\| dirtyQuoteFollowUp/,
  );
});

test('OperatorConfigPanel summary renders the aging-quotes threshold as integer days', () => {
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /F\/U:\{' '\}[\s\S]*?\{currentQuoteFollowUpThreshold\}d/);
});

test('OPERATOR_CONFIG_KNOB_LABEL map covers ALL FIVE knobs (five-corners pin)', () => {
  const mapBlock = INSIGHTS_TSX.match(
    /const OPERATOR_CONFIG_KNOB_LABEL: Record<keyof OperatorConfig, string> = \{[\s\S]*?\};/,
  );
  assert.ok(mapBlock, 'OPERATOR_CONFIG_KNOB_LABEL map not located');
  assert.match(mapBlock[0], /quoteFollowUpThresholdDays: 'Aging-quotes threshold'/);
});

test('formatKnobValue handles quoteFollowUpThresholdDays with day suffix', () => {
  const fn = INSIGHTS_TSX.match(/function formatKnobValue\([\s\S]*?\n\}\n/);
  assert.ok(fn, 'formatKnobValue body not located');
  assert.match(fn[0], /'quoteFollowUpThresholdDays'[\s\S]*?`\$\{value\}d`/);
});

test('OperatorConfigResetPill wired for the aging-quotes knob (5-corner reset affordance)', () => {
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  assert.match(
    block[0],
    /<OperatorConfigResetPill\s+knob="quoteFollowUpThresholdDays"/,
  );
});
