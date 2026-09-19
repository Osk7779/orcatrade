'use strict';

// Sprint 89 — negotiated SLA targets as knobs 6 & 7
// (slaQuoteTurnaroundTargetHours [4,168] def 48;
//  slaFirstResponseTargetHours [1,72] def 24).
//
// The negotiated-SLA pattern: a contract may commit tighter or
// looser than the platform defaults, and the org's cockpit
// attainment measures against THEIR numbers. SCOPE INVARIANT:
// the public /api/sla page and the cross-org triage risk line
// stay on the PLATFORM targets — the published commitment and
// the operator's risk line never move per-org.
//
// This is the first knob addition since the sprint-88 guards
// landed; the knob-derived threading pin + call-site parity guard
// forced completeness by construction. The machinery absorbed the
// rest: KNOB_KEYS (derived), reset allowlist, preset validation,
// identifyPreset, history rendering, undo — all automatic.
//
// Test layers:
//   1. Defaults + validation runtime (both knobs, both bounds)
//   2. Preset bands + the balanced === defaults identity (knob-
//      derived — the seven-corners sweep iterates KNOB_KEYS)
//   3. Aggregation: effective-value re-bounds; scope invariant
//      (public /api/sla + triage untouched by org knobs)
//   4. UI seven-corners: label map, formatter, panel fields,
//      dirty aggregate, save patch, reset pills

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const operatorConfig = require('../lib/operator-config');
const sla = require('../lib/intelligence/sla');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const SLA_PUBLIC_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'sla-public.js'), 'utf8');
const TRIAGE_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'operator-triage.js'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

const NEW_KNOBS = ['slaQuoteTurnaroundTargetHours', 'slaFirstResponseTargetHours'];

// ── Layer 1: defaults + validation ───────────────────────────────

test('defaults match the platform SLA constants (the knob defaults ARE the published commitments)', () => {
  assert.equal(
    operatorConfig.DEFAULT_OPERATOR_CONFIG.slaQuoteTurnaroundTargetHours,
    sla.SLA_QUOTE_TURNAROUND_TARGET_HOURS,
  );
  assert.equal(
    operatorConfig.DEFAULT_OPERATOR_CONFIG.slaFirstResponseTargetHours,
    sla.SLA_FIRST_RESPONSE_TARGET_HOURS,
  );
});

test('validation: integers only, both bounds enforced, both knobs (runtime corpus)', () => {
  const ok = operatorConfig.validatePartial({
    slaQuoteTurnaroundTargetHours: 24,
    slaFirstResponseTargetHours: 8,
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { slaQuoteTurnaroundTargetHours: 24, slaFirstResponseTargetHours: 8 });
  for (const [knob, low, high] of [
    ['slaQuoteTurnaroundTargetHours', 3, 169],
    ['slaFirstResponseTargetHours', 0, 73],
  ]) {
    assert.equal(operatorConfig.validatePartial({ [knob]: low }).ok, false, `${knob} below range`);
    assert.equal(operatorConfig.validatePartial({ [knob]: high }).ok, false, `${knob} above range`);
    assert.equal(operatorConfig.validatePartial({ [knob]: 24.5 }).ok, false, `${knob} non-integer`);
    assert.equal(operatorConfig.validatePartial({ [knob]: '24.5' }).ok, false, `${knob} string float`);
  }
});

// ── Layer 2: presets ─────────────────────────────────────────────

test('preset bands: strict 24/8, balanced 48/24, tolerant 72/48 — all inside validation ranges', () => {
  assert.equal(operatorConfig.PRESETS.strict.slaQuoteTurnaroundTargetHours, 24);
  assert.equal(operatorConfig.PRESETS.strict.slaFirstResponseTargetHours, 8);
  assert.equal(operatorConfig.PRESETS.tolerant.slaQuoteTurnaroundTargetHours, 72);
  assert.equal(operatorConfig.PRESETS.tolerant.slaFirstResponseTargetHours, 48);
  for (const name of operatorConfig.PRESET_NAMES) {
    const r = operatorConfig.validatePartial(operatorConfig.PRESETS[name]);
    assert.equal(r.ok, true, `preset ${name} must validate whole`);
  }
});

test('balanced === DEFAULT_OPERATOR_CONFIG across ALL SEVEN knobs (knob-derived identity sweep)', () => {
  // The sprint-68 invariant, swept over the DERIVED key list so an
  // eighth knob is covered automatically: if balanced drifts from
  // defaults, untouched orgs silently identify as `custom`.
  for (const knob of operatorConfig.KNOB_KEYS) {
    assert.equal(
      operatorConfig.PRESETS.balanced[knob],
      operatorConfig.DEFAULT_OPERATOR_CONFIG[knob],
      `balanced.${knob} must equal the platform default`,
    );
  }
  assert.equal(operatorConfig.identifyPreset({ ...operatorConfig.DEFAULT_OPERATOR_CONFIG }), 'balanced');
  assert.equal(operatorConfig.identifyPreset({ ...operatorConfig.PRESETS.strict }), 'strict');
  assert.equal(operatorConfig.identifyPreset({ ...operatorConfig.PRESETS.tolerant }), 'tolerant');
});

// ── Layer 3: aggregation + scope invariant ───────────────────────

test('aggregation re-bounds both targets defensively onto the platform constants', () => {
  assert.match(
    DB_SRC,
    /const effectiveTurnTarget = Number\.isInteger\(candidateTurnTarget\) && candidateTurnTarget >= 4 && candidateTurnTarget <= 168/,
  );
  assert.match(
    DB_SRC,
    /const effectiveFrTarget = Number\.isInteger\(candidateFrTarget\) && candidateFrTarget >= 1 && candidateFrTarget <= 72/,
  );
  assert.match(DB_SRC, /targetHours: effectiveTurnTarget,/);
  assert.match(DB_SRC, /targetHours: effectiveFrTarget,/);
});

test('SCOPE INVARIANT: the public /api/sla and the triage risk line NEVER read org knobs', () => {
  // The published commitment and the cross-org risk line stay on
  // the platform targets — a per-org contract must not move what
  // the website promises everyone or where the operator's risk
  // line sits. Absence pins on both handlers.
  for (const [name, src] of [['sla-public', SLA_PUBLIC_SRC], ['operator-triage', TRIAGE_SRC]]) {
    assert.ok(
      !/operator-config|getOperatorConfig|slaQuoteTurnaroundTargetHours|slaFirstResponseTargetHours/.test(src),
      `${name} must stay on the platform targets`,
    );
  }
});

// ── Layer 4: UI seven-corners ────────────────────────────────────

test('panel wires both knobs end to end (fields, dirty, save patch, reset pills — knob-derived where possible)', () => {
  for (const knob of NEW_KNOBS) {
    assert.match(INSIGHTS_TSX, new RegExp(`htmlFor="${knob}"`), `${knob}: input field`);
    assert.match(INSIGHTS_TSX, new RegExp(`knob="${knob}"`), `${knob}: reset pill`);
    assert.match(INSIGHTS_TSX, new RegExp(`patch\\.${knob} = Number\\(`), `${knob}: save patch`);
  }
  assert.match(INSIGHTS_TSX, /const dirtySlaTurnaround = Number\(pendingSlaTurnaround\)/);
  assert.match(INSIGHTS_TSX, /\|\| dirtySlaTurnaround \|\| dirtySlaFirstResponse;/);
  // Current values come from the SERVER's effective targets (the
  // attainment blocks), not a hardcoded default.
  assert.match(INSIGHTS_TSX, /currentSlaTurnaroundTarget=\{data\.slaQuoteTurnaround\.targetHours\}/);
  assert.match(INSIGHTS_TSX, /currentSlaFirstResponseTarget=\{data\.slaFirstResponse\.targetHours\}/);
});

test('label map + formatter cover the new knobs; collapsed summary names both', () => {
  assert.match(INSIGHTS_TSX, /slaQuoteTurnaroundTargetHours: 'Quote-SLA target',/);
  assert.match(INSIGHTS_TSX, /slaFirstResponseTargetHours: 'Response-SLA target',/);
  assert.match(INSIGHTS_TSX, /if \(key === 'slaQuoteTurnaroundTargetHours'\) return `\$\{value\}h`;/);
  assert.match(INSIGHTS_TSX, /\{currentSlaTurnaroundTarget\}h\/\{currentSlaFirstResponseTarget\}h/);
  // The field copy states the scope invariant to the customer.
  assert.match(INSIGHTS_TSX, /this dial changes YOUR contract view only/);
});
