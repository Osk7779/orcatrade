'use strict';

// Sprint 67 — per-knob "Reset to platform default" affordance. The
// sprint-42 handler comment planned this ("...show a 'Reset'
// affordance only when needed"); sprint-65 surfaced source[knob]
// via GET; sprint-67 ships it. New `reset: string[]` field on
// the PATCH body carries knob names to unset back to defaults.
// Distinct from the numeric knob patch — the audit event carries
// both fields (patched + reset) so a single PATCH can set-and-
// reset (though the handler rejects overlap).
//
// Tests cover six layers:
//   1. operator-config.KNOB_KEYS: derived from DEFAULT_OPERATOR_
//      CONFIG (single source of truth) + frozen.
//   2. operator-config.unsetKnobs: happy path deletes key from
//      stored partial (next read gets default); empty [] no-op;
//      unknown key 400s; deduplication; kv write failure returns
//      { ok: false, errors }.
//   3. Handler PATCH: reset[] validated BEFORE any KV mutation;
//      overlap between patched + reset 400s; no-op PATCH 400s;
//      audit event carries reset[] conditionally.
//   4. events.listOperatorConfigHistory projection surfaces
//      reset[] (empty on legacy events; filters out non-string
//      entries).
//   5. TS mirror: OperatorConfigHistoryEntry.reset: string[].
//   6. UI: source loaded on mount; Reset pill visible ONLY when
//      source[knob] === 'custom'; pill click PATCHes with the
//      auto-reason; HistoryList renders reset entries with
//      distinct label + colour.

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

// ── Layer 1: KNOB_KEYS ───────────────────────────────────────────

test('operatorConfig.KNOB_KEYS is exported + covers all four defaults', () => {
  assert.ok(Array.isArray(operatorConfig.KNOB_KEYS));
  assert.deepEqual(
    [...operatorConfig.KNOB_KEYS].sort(),
    [
      'declineSpikeRateMultiplier',
      'ratingTrendDropThreshold',
      'stallThresholdDays',
      'supplierConcentrationThreshold',
    ],
  );
});

test('KNOB_KEYS is frozen (mutation would drift the reset allowlist)', () => {
  assert.equal(Object.isFrozen(operatorConfig.KNOB_KEYS), true);
});

test('KNOB_KEYS source: derived from DEFAULT_OPERATOR_CONFIG (single source of truth)', () => {
  assert.match(
    OP_CFG_SRC,
    /const KNOB_KEYS = Object\.freeze\(Object\.keys\(DEFAULT_OPERATOR_CONFIG\)\)/,
  );
});

// ── Layer 2: unsetKnobs behaviour ────────────────────────────────

test('unsetKnobs is exported', () => {
  assert.equal(typeof operatorConfig.unsetKnobs, 'function');
});

test('unsetKnobs rejects non-array keys with { ok: false }', async () => {
  const r = await operatorConfig.unsetKnobs(999_999_601, 'stallThresholdDays');
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /keys must be an array/);
});

test('unsetKnobs rejects orgIdNumeric NaN with { ok: false }', async () => {
  const r = await operatorConfig.unsetKnobs(NaN, ['stallThresholdDays']);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /orgIdNumeric required/);
});

test('unsetKnobs [] is a no-op success (returns current effective config unchanged)', async () => {
  const orgId = 999_999_602;
  await operatorConfig.setOperatorConfig(orgId, { stallThresholdDays: 5 });
  const r = await operatorConfig.unsetKnobs(orgId, []);
  assert.equal(r.ok, true);
  assert.equal(r.config.stallThresholdDays, 5); // untouched
});

test('unsetKnobs unknown knob 400s (out-of-date client cannot wipe unknown state)', async () => {
  const r = await operatorConfig.unsetKnobs(999_999_603, ['stallThresholdDays', 'nonexistent']);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /unknown knob key: nonexistent/);
});

test('unsetKnobs valid keys delete from stored partial (next read gets default)', async () => {
  const orgId = 999_999_604;
  await operatorConfig.setOperatorConfig(orgId, {
    stallThresholdDays: 3,
    declineSpikeRateMultiplier: 5,
  });
  // Sanity: both customised now.
  const before = await operatorConfig.getOperatorConfig(orgId);
  assert.equal(before.stallThresholdDays, 3);
  assert.equal(before.declineSpikeRateMultiplier, 5);
  // Reset the stall only.
  const r = await operatorConfig.unsetKnobs(orgId, ['stallThresholdDays']);
  assert.equal(r.ok, true);
  // Effective config: stall reverts to default (7), spike stays customised.
  const after = await operatorConfig.getOperatorConfig(orgId);
  assert.equal(after.stallThresholdDays, 7);
  assert.equal(after.declineSpikeRateMultiplier, 5);
});

test('unsetKnobs deduplicates repeated keys before writing', async () => {
  const orgId = 999_999_605;
  await operatorConfig.setOperatorConfig(orgId, { stallThresholdDays: 4 });
  const r = await operatorConfig.unsetKnobs(orgId, [
    'stallThresholdDays',
    'stallThresholdDays',
    'stallThresholdDays',
  ]);
  assert.equal(r.ok, true);
  const after = await operatorConfig.getOperatorConfig(orgId);
  assert.equal(after.stallThresholdDays, 7); // default
});

// ── Layer 3: handler PATCH threading ─────────────────────────────

test('handler defines extractResetKeys helper (source pin: derived from KNOB_KEYS)', () => {
  assert.match(HANDLER_SRC, /function extractResetKeys\(raw\) \{/);
  const fn = HANDLER_SRC.match(/function extractResetKeys\([\s\S]*?\n\}/)[0];
  assert.match(fn, /new Set\(operatorConfig\.KNOB_KEYS\)/);
});

test('extractResetKeys source: undefined resolves to { ok: true, keys: [] }', () => {
  const fn = HANDLER_SRC.match(/function extractResetKeys\([\s\S]*?\n\}/)[0];
  assert.match(fn, /if \(raw === undefined\) return \{ ok: true, keys: \[\] \}/);
});

test('extractResetKeys source: non-array raw 400s', () => {
  const fn = HANDLER_SRC.match(/function extractResetKeys\([\s\S]*?\n\}/)[0];
  assert.match(fn, /if \(!Array\.isArray\(raw\)\)[\s\S]*?reset must be an array/);
});

test('extractResetKeys source: unknown key 400s', () => {
  const fn = HANDLER_SRC.match(/function extractResetKeys\([\s\S]*?\n\}/)[0];
  assert.match(fn, /unknown reset knob: \$\{String\(k\)\}/);
});

test('extractResetKeys source: deduplicates via a seen Set', () => {
  const fn = HANDLER_SRC.match(/function extractResetKeys\([\s\S]*?\n\}/)[0];
  assert.match(fn, /const seen = new Set\(\)/);
});

test('handlePatch: reset extraction runs BEFORE any KV mutation (positional pin)', () => {
  const body = HANDLER_SRC.match(/async function handlePatch\([\s\S]*?\n\}/)[0];
  const resetIdx = body.indexOf('extractResetKeys(body.reset)');
  const setIdx = body.indexOf('operatorConfig.setOperatorConfig(');
  const unsetIdx = body.indexOf('operatorConfig.unsetKnobs(');
  assert.ok(resetIdx > 0, 'extractResetKeys call not found');
  assert.ok(setIdx > 0, 'setOperatorConfig call not found');
  assert.ok(unsetIdx > 0, 'unsetKnobs call not found');
  assert.ok(resetIdx < setIdx, 'reset extraction MUST run before setOperatorConfig');
  assert.ok(resetIdx < unsetIdx, 'reset extraction MUST run before unsetKnobs');
});

test('handlePatch: rejects PATCH where a knob is both set and reset (unambiguous audit trail)', () => {
  const body = HANDLER_SRC.match(/async function handlePatch\([\s\S]*?\n\}/)[0];
  assert.match(body, /const overlap = resetResult\.keys\.filter\([\s\S]*?knobPatch, k\)/);
  assert.match(body, /knob cannot be both set and reset in the same PATCH: \$\{overlap\.join\(', '\)\}/);
});

test('handlePatch: rejects no-op PATCH (neither knob change nor reset)', () => {
  const body = HANDLER_SRC.match(/async function handlePatch\([\s\S]*?\n\}/)[0];
  assert.match(
    body,
    /Object\.keys\(knobPatch\)\.length === 0 && resetResult\.keys\.length === 0/,
  );
  assert.match(body, /PATCH must include at least one knob change or reset/);
});

test('handlePatch: audit event carries reset conditionally (absent when empty)', () => {
  const body = HANDLER_SRC.match(/async function handlePatch\([\s\S]*?\n\}/)[0];
  assert.match(
    body,
    /\.\.\.\(resetResult\.keys\.length > 0 \? \{ reset: resetResult\.keys \} : \{\}\)/,
  );
});

test('handlePatch: unsetKnobs failure surfaces its own errors (fresh binding, no shadowed `result`)', () => {
  // Sprint 67 wired a resetOutcome binding (not `result`) so the
  // sprint-66 error-propagation shape stays valid. Pin the fresh
  // binding + the errors[0]/errors surface.
  const body = HANDLER_SRC.match(/async function handlePatch\([\s\S]*?\n\}/)[0];
  assert.match(body, /const resetOutcome = await operatorConfig\.unsetKnobs/);
  assert.match(body, /if \(!resetOutcome\.ok\)/);
  assert.match(body, /error: resetOutcome\.errors\[0\],/);
  assert.match(body, /errors: resetOutcome\.errors/);
});

// ── Layer 4: events projection ───────────────────────────────────

test('listOperatorConfigHistory projection surfaces reset (empty [] on legacy events)', () => {
  const body = EVENTS_SRC.match(
    /async function listOperatorConfigHistory\([\s\S]*?\n\}/,
  )[0];
  assert.match(body, /reset:/);
  assert.match(body, /Array\.isArray\(e\.detail\.reset\)/);
  // Filter defensively — a stray non-string entry never survives.
  assert.match(body, /\.filter\(\(k\) => typeof k === 'string'\)/);
  // Fall-through is [] (not null) — the TS type is string[].
  assert.match(body, /: \[\],\s*$/m);
});

test('listOperatorConfigHistory runtime: reset[] surfaces when detail.reset populated', async () => {
  const orgId = 999_999_620;
  await events.record('operator_config_updated', {
    orgId,
    entityType: 'operator_config',
    entityId: 'sprint67-smoke',
    actorEmailHash: 'abc123def456ghi7',
    detail: {
      patched: {},
      reset: ['stallThresholdDays'],
      reason: 'reset smoke',
    },
  });
  const list = await events.listOperatorConfigHistory({ orgId, limit: 5 });
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].reset, ['stallThresholdDays']);
  assert.deepEqual(list[0].patched, {});
});

test('listOperatorConfigHistory runtime: reset[] is [] for sprint-42..66 legacy events', async () => {
  const orgId = 999_999_621;
  await events.record('operator_config_updated', {
    orgId,
    entityType: 'operator_config',
    entityId: 'sprint67-legacy',
    actorEmailHash: 'abc123def456ghi7',
    detail: { patched: { stallThresholdDays: 6 } },
  });
  const list = await events.listOperatorConfigHistory({ orgId, limit: 5 });
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].reset, []);
});

test('listOperatorConfigHistory runtime: filters non-string entries out of detail.reset', async () => {
  const orgId = 999_999_622;
  await events.record('operator_config_updated', {
    orgId,
    entityType: 'operator_config',
    entityId: 'sprint67-malformed',
    actorEmailHash: 'abc123def456ghi7',
    // Malformed — mix of good and bad entries.
    detail: {
      patched: {},
      reset: ['stallThresholdDays', 42, null, undefined, { evil: true }, 'ratingTrendDropThreshold'],
    },
  });
  const list = await events.listOperatorConfigHistory({ orgId, limit: 5 });
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].reset, ['stallThresholdDays', 'ratingTrendDropThreshold']);
});

// ── Layer 5: TS mirror ───────────────────────────────────────────

test('OperatorConfigHistoryEntry TS interface extends with reset: string[]', () => {
  assert.match(
    API_TS,
    /export interface OperatorConfigHistoryEntry \{[\s\S]*?reason: string \| null;[\s\S]*?reset: string\[\];[\s\S]*?\}/,
  );
});

// ── Layer 6: UI wiring ───────────────────────────────────────────

test('OperatorConfigResetPill hoisted ABOVE OperatorConfigPanel (preserves sprint-64/65 body regex)', () => {
  const pillIdx = INSIGHTS_TSX.indexOf('function OperatorConfigResetPill(');
  const panelIdx = INSIGHTS_TSX.indexOf('function OperatorConfigPanel(');
  assert.ok(pillIdx > 0, 'OperatorConfigResetPill not defined');
  assert.ok(panelIdx > 0, 'OperatorConfigPanel not defined');
  assert.ok(
    pillIdx < panelIdx,
    'OperatorConfigResetPill MUST appear BEFORE OperatorConfigPanel so the sprint-64 body-extraction regex still terminates on }\\n\\n/*',
  );
});

test('OperatorConfigResetPill hides when source is null OR knob is not custom', () => {
  const block = INSIGHTS_TSX.match(/function OperatorConfigResetPill\([\s\S]*?\n\}\n/);
  assert.ok(block, 'OperatorConfigResetPill body not located');
  const body = block[0];
  assert.match(body, /if \(!source \|\| source\[knob\] !== 'custom'\) return null/);
});

test('OperatorConfigResetPill renders ↻ Reset (Resetting… during isBusy)', () => {
  const body = INSIGHTS_TSX.match(/function OperatorConfigResetPill\([\s\S]*?\n\}\n/)[0];
  assert.match(body, /↻ Reset/);
  assert.match(body, /Resetting…/);
  assert.match(body, /disabled=\{busy\}/);
});

test('OperatorConfigPanel loads source on mount (drives Reset pill visibility)', () => {
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /const \[source, setSource\] = useState<OperatorConfigSource \| null>\(null\)/);
  assert.match(body, /setSource\(data\.source \?\? null\)/);
});

test('OperatorConfigPanel onReset PATCHes with reset: [knob] + auto-reason', () => {
  const body = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /)[0];
  assert.match(body, /async function onReset\(knob: keyof OperatorConfig\)/);
  assert.match(body, /reset: \[knob\]/);
  assert.match(body, /reason: 'Reset to platform default'/);
});

test('OperatorConfigPanel renders Reset pill for ALL FOUR knobs (four-corners pin)', () => {
  const body = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /)[0];
  for (const knob of [
    'stallThresholdDays',
    'declineSpikeRateMultiplier',
    'supplierConcentrationThreshold',
    'ratingTrendDropThreshold',
  ]) {
    const re = new RegExp(`<OperatorConfigResetPill\\s+knob="${knob}"`);
    assert.match(body, re, `Reset pill missing for ${knob}`);
  }
});

test('OperatorConfigHistoryList renders reset entries with distinct label (↻ reset in warning colour)', () => {
  const body = INSIGHTS_TSX.match(
    /function OperatorConfigHistoryList\([\s\S]*?\n\}\n/,
  )[0];
  // Reset entries filter to known-knob shape.
  assert.match(body, /const resetKeys = \(entry\.reset \|\| \[\]\)\.filter\(/);
  // Distinct visual — the ↻ reset label uses --color-warning
  // (amber) vs the mono --color-aqua used for numeric knob
  // values. Deliberate: reset is a policy reversal, not a data
  // update.
  assert.match(body, /↻ reset/);
  assert.match(body, /--color-warning/);
});

test('OperatorConfigHistoryList handles set+reset in the same entry (semicolon separator)', () => {
  const body = INSIGHTS_TSX.match(
    /function OperatorConfigHistoryList\([\s\S]*?\n\}\n/,
  )[0];
  assert.match(body, /const hasSet = patchedKeys\.length > 0/);
  assert.match(body, /const hasReset = resetKeys\.length > 0/);
  // Separator between the two clauses when both present.
  assert.match(body, /\{hasSet && hasReset && '; '\}/);
});
