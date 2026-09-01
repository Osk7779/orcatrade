'use strict';

// Sprint 68 — SAP-GTS/ONESOURCE-style policy profiles (presets)
// on operator-config. Three named profiles: strict (tight SLAs,
// high alert volume), balanced (platform defaults), tolerant
// (only obvious cliffs). Server-side expansion means clients
// can't drift preset values; `identifyPreset` reports which
// profile the current effective config matches (or 'custom').
//
// Tests cover six layers:
//   1. Static invariants: PRESET_NAMES + PRESETS shape (three
//      profiles, all four knobs each); balanced === defaults;
//      every preset value falls within its knob's range;
//      all objects frozen (defence against runtime drift).
//   2. identifyPreset semantics: balanced for defaults; strict/
//      tolerant for their respective values; custom for
//      anything else; float-tolerant comparison (IEEE-754
//      lesson).
//   3. Handler GET: response now includes presets + currentPreset.
//   4. Handler PATCH: preset key accepted; unknown preset 400s;
//      preset + knobs 400s; preset + reset 400s; audit event
//      carries preset + auto-reason.
//   5. Events projection: reset[] gains a peer `preset: string
//      | null`; legacy events surface null.
//   6. UI: presets + currentPreset loaded on mount; chips
//      rendered; active preset highlighted (aria-pressed);
//      Custom indicator when no preset matches; onApplyPreset
//      PATCHes with { preset: name }.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const events = require('../lib/events');
const operatorConfig = require('../lib/operator-config');

const ROOT = path.resolve(__dirname, '..');
const OP_CFG_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'operator-config.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(
  path.join(ROOT, 'lib', 'handlers', 'operator-config.js'),
  'utf8',
);
const EVENTS_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'events.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// ── Layer 1: static invariants ───────────────────────────────────

test('PRESET_NAMES exports strict/balanced/tolerant (order-sensitive for UI chip order)', () => {
  assert.deepEqual([...operatorConfig.PRESET_NAMES], ['strict', 'balanced', 'tolerant']);
});

test('PRESETS + PRESET_NAMES are frozen (defence against runtime drift)', () => {
  assert.equal(Object.isFrozen(operatorConfig.PRESET_NAMES), true);
  assert.equal(Object.isFrozen(operatorConfig.PRESETS), true);
  for (const name of operatorConfig.PRESET_NAMES) {
    assert.equal(
      Object.isFrozen(operatorConfig.PRESETS[name]),
      true,
      `PRESETS.${name} must be frozen`,
    );
  }
});

test('every preset carries ALL FOUR knobs (drift-guard against a missing knob)', () => {
  for (const name of operatorConfig.PRESET_NAMES) {
    const preset = operatorConfig.PRESETS[name];
    for (const knob of operatorConfig.KNOB_KEYS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(preset, knob),
        `PRESETS.${name} missing ${knob}`,
      );
      assert.equal(typeof preset[knob], 'number', `PRESETS.${name}.${knob} not numeric`);
    }
  }
});

test('balanced preset === DEFAULT_OPERATOR_CONFIG (identity invariant)', () => {
  // If balanced drifts from defaults, an untouched org would
  // start reporting `custom` — silently breaks the current-
  // preset indicator. Pin the identity.
  for (const knob of operatorConfig.KNOB_KEYS) {
    assert.equal(
      operatorConfig.PRESETS.balanced[knob],
      operatorConfig.DEFAULT_OPERATOR_CONFIG[knob],
      `balanced.${knob} must equal DEFAULT_OPERATOR_CONFIG.${knob}`,
    );
  }
});

test('every preset value validates cleanly under validatePartial (in-range + right type)', () => {
  // Boot-time safety: a typo or a future range narrowing on
  // any knob that would leave a preset out of band surfaces
  // here immediately.
  for (const name of operatorConfig.PRESET_NAMES) {
    const r = operatorConfig.validatePartial(operatorConfig.PRESETS[name]);
    assert.equal(r.ok, true, `PRESETS.${name} failed validation: ${JSON.stringify(r.errors)}`);
  }
});

test('strict is monotonically more sensitive than balanced (design invariant)', () => {
  // Preserve the strict-→-tolerant ordering the panel copy
  // promises. Interpretations per knob:
  //   stall days:  strict < balanced (fewer days = tighter SLA)
  //   spike x:     strict < balanced (lower multiplier = more sensitive)
  //   conc %:      strict < balanced (lower share = flags earlier)
  //   drop stars:  strict < balanced (smaller drop = catches drift earlier)
  assert.ok(operatorConfig.PRESETS.strict.stallThresholdDays < operatorConfig.PRESETS.balanced.stallThresholdDays);
  assert.ok(operatorConfig.PRESETS.strict.declineSpikeRateMultiplier < operatorConfig.PRESETS.balanced.declineSpikeRateMultiplier);
  assert.ok(operatorConfig.PRESETS.strict.supplierConcentrationThreshold < operatorConfig.PRESETS.balanced.supplierConcentrationThreshold);
  assert.ok(operatorConfig.PRESETS.strict.ratingTrendDropThreshold < operatorConfig.PRESETS.balanced.ratingTrendDropThreshold);
});

test('tolerant is monotonically less sensitive than balanced (design invariant)', () => {
  assert.ok(operatorConfig.PRESETS.tolerant.stallThresholdDays > operatorConfig.PRESETS.balanced.stallThresholdDays);
  assert.ok(operatorConfig.PRESETS.tolerant.declineSpikeRateMultiplier > operatorConfig.PRESETS.balanced.declineSpikeRateMultiplier);
  assert.ok(operatorConfig.PRESETS.tolerant.supplierConcentrationThreshold > operatorConfig.PRESETS.balanced.supplierConcentrationThreshold);
  assert.ok(operatorConfig.PRESETS.tolerant.ratingTrendDropThreshold > operatorConfig.PRESETS.balanced.ratingTrendDropThreshold);
});

// ── Layer 2: identifyPreset semantics ────────────────────────────

test('identifyPreset returns balanced for a config that equals defaults', () => {
  assert.equal(
    operatorConfig.identifyPreset({ ...operatorConfig.DEFAULT_OPERATOR_CONFIG }),
    'balanced',
  );
});

test('identifyPreset returns strict / tolerant for matching values', () => {
  assert.equal(
    operatorConfig.identifyPreset({ ...operatorConfig.PRESETS.strict }),
    'strict',
  );
  assert.equal(
    operatorConfig.identifyPreset({ ...operatorConfig.PRESETS.tolerant }),
    'tolerant',
  );
});

test('identifyPreset returns custom when any single knob deviates', () => {
  const nearBalanced = { ...operatorConfig.PRESETS.balanced, stallThresholdDays: 8 };
  assert.equal(operatorConfig.identifyPreset(nearBalanced), 'custom');
});

test('identifyPreset is float-tolerant (IEEE-754 lesson from sprint 60)', () => {
  // A stored 0.75 that comes back through a JSON round-trip
  // as 0.7499999999999999 or 0.7500000000000001 MUST still
  // identify as balanced (0.75 concentration threshold).
  // Source pin: the Math.abs epsilon comparison.
  assert.match(OP_CFG_SRC, /Math\.abs\(a - b\) > 1e-9/);
});

test('identifyPreset handles nullish/non-object input safely (returns custom)', () => {
  assert.equal(operatorConfig.identifyPreset(null), 'custom');
  assert.equal(operatorConfig.identifyPreset(undefined), 'custom');
  assert.equal(operatorConfig.identifyPreset('string'), 'custom');
});

// ── Layer 3: handler GET ─────────────────────────────────────────

test('handler GET response surfaces presets + currentPreset', () => {
  const body = HANDLER_SRC.match(/async function handleGet\([\s\S]*?\n\}/)[0];
  assert.match(body, /presets: operatorConfig\.PRESETS/);
  assert.match(body, /currentPreset: operatorConfig\.identifyPreset\(projection\.effective\)/);
});

// ── Layer 4: handler PATCH threading ─────────────────────────────

test('handlePatch: preset key accepted; unknown preset 400s with expected|got message', () => {
  const body = HANDLER_SRC.match(/async function handlePatch\([\s\S]*?\n\}/)[0];
  assert.match(body, /const rawPreset = body\.preset/);
  assert.match(
    body,
    /!operatorConfig\.PRESET_NAMES\.includes\(rawPreset\)/,
  );
  assert.match(body, /unknown preset: \$\{String\(rawPreset\)\}/);
});

test('handlePatch: preset cannot be combined with individual knob fields (400)', () => {
  const body = HANDLER_SRC.match(/async function handlePatch\([\s\S]*?\n\}/)[0];
  assert.match(
    body,
    /preset cannot be combined with individual knob fields/,
  );
});

test('handlePatch: preset cannot be combined with reset\\[] (400)', () => {
  const body = HANDLER_SRC.match(/async function handlePatch\([\s\S]*?\n\}/)[0];
  assert.match(body, /preset cannot be combined with reset\[\]/);
});

test('handlePatch: preset expansion uses Object.assign(knobPatch, PRESETS[name])', () => {
  const body = HANDLER_SRC.match(/async function handlePatch\([\s\S]*?\n\}/)[0];
  assert.match(body, /Object\.assign\(knobPatch, operatorConfig\.PRESETS\[presetName\]\)/);
});

test('handlePatch: audit event carries preset conditionally (absent when null)', () => {
  const body = HANDLER_SRC.match(/async function handlePatch\([\s\S]*?\n\}/)[0];
  assert.match(
    body,
    /\.\.\.\(presetName !== null \? \{ preset: presetName \} : \{\}\)/,
  );
});

test('handlePatch: finalReason folds in auto-reason for preset (client reason wins)', () => {
  const body = HANDLER_SRC.match(/async function handlePatch\([\s\S]*?\n\}/)[0];
  assert.match(
    body,
    /finalReason = `Applied preset: \$\{presetName\}`/,
  );
  // Client reason wins because we only set finalReason from
  // the preset when reasonResult.value === null (guard pin).
  assert.match(body, /if \(finalReason === null && presetName !== null\)/);
});

// ── Layer 5: events projection ───────────────────────────────────

test('listOperatorConfigHistory projection surfaces preset (null for legacy)', () => {
  const body = EVENTS_SRC.match(
    /async function listOperatorConfigHistory\([\s\S]*?\n\}/,
  )[0];
  assert.match(body, /\bpreset:/);
  assert.match(
    body,
    /typeof e\.detail\.preset === 'string' && e\.detail\.preset\.length > 0/,
  );
  // Fall-through is null (matches TS type).
  assert.match(body, /: null,?\s*$/m);
});

test('listOperatorConfigHistory runtime: preset surfaces when detail.preset populated', async () => {
  const orgId = 999_999_680;
  await events.record('operator_config_updated', {
    orgId,
    entityType: 'operator_config',
    entityId: 'sprint68-smoke',
    actorEmailHash: 'abc123def456ghi7',
    detail: {
      patched: { ...operatorConfig.PRESETS.strict },
      preset: 'strict',
      reason: 'Applied preset: strict',
    },
  });
  const list = await events.listOperatorConfigHistory({ orgId, limit: 5 });
  assert.equal(list.length, 1);
  assert.equal(list[0].preset, 'strict');
});

test('listOperatorConfigHistory runtime: preset === null for sprint-42..67 legacy events', async () => {
  const orgId = 999_999_681;
  await events.record('operator_config_updated', {
    orgId,
    entityType: 'operator_config',
    entityId: 'sprint68-legacy',
    actorEmailHash: 'abc123def456ghi7',
    detail: { patched: { stallThresholdDays: 5 } },
  });
  const list = await events.listOperatorConfigHistory({ orgId, limit: 5 });
  assert.equal(list.length, 1);
  assert.equal(list[0].preset, null);
});

// ── Layer 6: TS + UI wiring ──────────────────────────────────────

test('TS: OperatorConfigResponse extends with presets + currentPreset', () => {
  assert.match(
    API_TS,
    /export interface OperatorConfigResponse \{[\s\S]*?presets: Record<OperatorConfigPresetName, OperatorConfig>;[\s\S]*?currentPreset: OperatorConfigPresetName \| 'custom';[\s\S]*?\}/,
  );
});

test('TS: OperatorConfigPresetName is the strict-balanced-tolerant union', () => {
  assert.match(
    API_TS,
    /export type OperatorConfigPresetName = 'strict' \| 'balanced' \| 'tolerant';/,
  );
});

test('TS: OperatorConfigHistoryEntry extends with preset: string | null', () => {
  assert.match(
    API_TS,
    /export interface OperatorConfigHistoryEntry \{[\s\S]*?reset: string\[\];[\s\S]*?preset: string \| null;[\s\S]*?\}/,
  );
});

test('OperatorConfigPresetChips hoisted ABOVE OperatorConfigPanel (preserves body-extraction regex)', () => {
  const chipsIdx = INSIGHTS_TSX.indexOf('function OperatorConfigPresetChips(');
  const panelIdx = INSIGHTS_TSX.indexOf('function OperatorConfigPanel(');
  assert.ok(chipsIdx > 0, 'OperatorConfigPresetChips not defined');
  assert.ok(chipsIdx < panelIdx, 'chips MUST appear before OperatorConfigPanel');
});

test('OperatorConfigPresetChips hides when presets are still loading (avoid flash)', () => {
  const body = INSIGHTS_TSX.match(/function OperatorConfigPresetChips\([\s\S]*?\n\}\n/)[0];
  assert.match(body, /if \(!presets \|\| currentPreset === null\) return null/);
});

test('OperatorConfigPresetChips renders three chips in strict/balanced/tolerant order', () => {
  const body = INSIGHTS_TSX.match(/function OperatorConfigPresetChips\([\s\S]*?\n\}\n/)[0];
  assert.match(
    body,
    /const names: OperatorConfigPresetName\[\] = \['strict', 'balanced', 'tolerant'\]/,
  );
});

test('OperatorConfigPresetChips uses aria-pressed to mark the active preset', () => {
  const body = INSIGHTS_TSX.match(/function OperatorConfigPresetChips\([\s\S]*?\n\}\n/)[0];
  assert.match(body, /aria-pressed=\{isActive\}/);
  // Active chip is disabled (already applied) so accidental
  // double-click doesn't fire a no-op PATCH.
  assert.match(body, /disabled=\{disabled \|\| isActive\}/);
});

test('OperatorConfigPresetChips renders the Custom indicator only when currentPreset === custom', () => {
  const body = INSIGHTS_TSX.match(/function OperatorConfigPresetChips\([\s\S]*?\n\}\n/)[0];
  assert.match(body, /currentPreset === 'custom' && \(/);
  assert.match(body, /operator-config-preset-custom-indicator/);
});

test('OperatorConfigPanel loads presets + currentPreset on mount', () => {
  const body = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /)[0];
  assert.match(body, /setPresets\(data\.presets \?\? null\)/);
  assert.match(body, /setCurrentPreset\(data\.currentPreset \?\? null\)/);
});

test('OperatorConfigPanel onApplyPreset PATCHes with { preset: name } (server does the expansion)', () => {
  const body = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /)[0];
  assert.match(body, /async function onApplyPreset\(name: OperatorConfigPresetName\)/);
  assert.match(
    body,
    /apiPatch<OperatorConfigResponse>\('\/api\/operator-config', \{ preset: name \}\)/,
  );
});

test('OperatorConfigPanel renders OperatorConfigPresetChips inside the expanded body', () => {
  const body = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /)[0];
  assert.match(body, /<OperatorConfigPresetChips[\s\S]*?onApplyPreset=\{onApplyPreset\}/);
});
