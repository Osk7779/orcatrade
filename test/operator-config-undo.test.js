'use strict';

// Sprint 73 — undo last config change (SAP-GTS reversal-document
// pattern on top of the sprint-72 `previous` capture).
//
// An undo is a NEW change that restores prior values through the
// normal mutation + audit path — history is append-only, never
// rewritten. The pieces:
//   - buildUndoPlan (lib/operator-config.js): pure expansion of a
//     history entry's `previous` into { set, reset }. Per-knob
//     null → reset (was at platform default); number → set back.
//   - handler PATCH accepts { undo: { at } }: `at` is the
//     optimistic-concurrency token — must match the LATEST history
//     entry or 409, so a concurrent change is never silently
//     reverted. Mutually exclusive with preset/knobs/reset[].
//     History read is FAIL-CLOSED here (500 on read failure) —
//     unlike the fail-open GET history, this read gates a
//     mutation and must never guess.
//   - Truthful refusal: entries without `previous` (sprint 42..71
//     legacy, or pre-read failed at write time) are NOT undoable.
//   - Because the sprint-72 previous capture runs for the undo
//     PATCH too, an undo is itself undoable (redo comes free).
//   - Audit detail carries undoOf (the reverted entry's `at`) +
//     auto-reason "Undid change from <at>" (client reason wins).
//
// Test layers:
//   1. buildUndoPlan runtime (pure function, five-corners sweep)
//   2. Handler source pins: shape-400, exclusivity, fail-closed
//      history read, 409 + latestAt, positional order (expansion
//      BEFORE the sprint-72 snapshot BEFORE mutations), auto-
//      reason precedence, undoOf detail spread
//   3. Projection: undoOf through listOperatorConfigHistory
//      (runtime: populated / legacy-null)
//   4. TS mirror + UI pins: canUndo guard (newest + previous +
//      at), confirm(), PATCH body shape, ⎌ marker + Undo pill

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const operatorConfig = require('../lib/operator-config');
const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');
const LIB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'operator-config.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'operator-config.js'), 'utf8');
const EVENTS_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'events.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// ── Layer 1: buildUndoPlan (pure) ─────────────────────────────────

test('buildUndoPlan maps per-knob null → reset and number → set', () => {
  const plan = operatorConfig.buildUndoPlan({
    at: '2026-07-07T00:00:00Z',
    previous: { stallThresholdDays: 7, quoteFollowUpThresholdDays: null },
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.set, { stallThresholdDays: 7 });
  assert.deepEqual(plan.reset, ['quoteFollowUpThresholdDays']);
});

test('buildUndoPlan five-corners — every knob restores through the set path', () => {
  // Iterate the CANONICAL knob list (KNOB_KEYS, derived from
  // DEFAULT_OPERATOR_CONFIG) so a sixth knob added later is
  // covered automatically — the sprint-71 five-corners posture,
  // generalised to the source-of-truth list instead of a
  // hardcoded enumeration.
  const previous = {};
  for (const k of operatorConfig.KNOB_KEYS) {
    previous[k] = operatorConfig.DEFAULT_OPERATOR_CONFIG[k];
  }
  const plan = operatorConfig.buildUndoPlan({ previous });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.set, previous);
  assert.deepEqual(plan.reset, []);
  // And the mirror: every knob restores through the reset path.
  const allNull = {};
  for (const k of operatorConfig.KNOB_KEYS) allNull[k] = null;
  const resetPlan = operatorConfig.buildUndoPlan({ previous: allNull });
  assert.equal(resetPlan.ok, true);
  assert.deepEqual(resetPlan.set, {});
  assert.deepEqual([...resetPlan.reset].sort(), [...operatorConfig.KNOB_KEYS].sort());
});

test('buildUndoPlan refuses entries without before-values (truthful refusal, never a guess)', () => {
  for (const entry of [
    null,
    {},
    { previous: null },        // sprint-72 omit-on-unknown / legacy projection
    { previous: [7] },         // malformed array
  ]) {
    const plan = operatorConfig.buildUndoPlan(entry);
    assert.equal(plan.ok, false, `expected refusal for ${JSON.stringify(entry)}`);
  }
  // Legacy wording pinned — the UI surfaces this string verbatim.
  assert.match(
    operatorConfig.buildUndoPlan({ previous: null }).error,
    /predates before-value capture/,
  );
});

test('buildUndoPlan refuses empty, unknown-knob, and malformed-value previous objects', () => {
  assert.equal(operatorConfig.buildUndoPlan({ previous: {} }).ok, false);
  const unknown = operatorConfig.buildUndoPlan({ previous: { notAKnob: 5 } });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /unknown knob in history entry: notAKnob/);
  const malformed = operatorConfig.buildUndoPlan({ previous: { stallThresholdDays: 'seven' } });
  assert.equal(malformed.ok, false);
  assert.match(malformed.error, /malformed before-value for stallThresholdDays/);
});

// ── Layer 2: handler discipline (source pins) ─────────────────────

test('undo shape-validates cheap (400 before any KV mutation) and is stripped from knobPatch', () => {
  assert.match(HANDLER_SRC, /undo must be \{ at: <timestamp of the change to revert> \}/);
  // knobPatch strips ALL four control fields — reason, reset,
  // preset, undo — so none can masquerade as a knob.
  assert.match(
    HANDLER_SRC,
    /delete knobPatch\.reason;\s*\n\s*delete knobPatch\.reset;\s*\n\s*delete knobPatch\.preset;\s*\n\s*delete knobPatch\.undo;/,
  );
});

test('undo is mutually exclusive with preset, knob fields, and reset[] (three 400 pins)', () => {
  assert.match(HANDLER_SRC, /undo cannot be combined with preset/);
  assert.match(HANDLER_SRC, /undo cannot be combined with individual knob fields/);
  assert.match(HANDLER_SRC, /undo cannot be combined with reset\[\]/);
});

test('undo history read is FAIL-CLOSED (500) — unlike the fail-open GET history read', () => {
  // The GET-side read degrades to [] (display-only). The undo-side
  // read gates a MUTATION: if we cannot verify what we would
  // revert, we refuse. Sprint-65 encoded the fail-open/fail-closed
  // distinction; this pin keeps the mutation side closed.
  assert.match(HANDLER_SRC, /could not read config history to verify undo/);
  const block = HANDLER_SRC.match(/operator-config undo history read failed[\s\S]*?jsonResponse\(res, (\d+)/);
  assert.ok(block, 'undo history-read failure path not found');
  assert.equal(block[1], '500');
});

test('stale undo 409s with latestAt so the client can re-sync (optimistic concurrency)', () => {
  const block = HANDLER_SRC.match(/if \(latest\.at !== undoAt\) \{[\s\S]*?\}\);/);
  assert.ok(block, '409 concurrency gate not found');
  assert.match(block[0], /jsonResponse\(res, 409,/);
  assert.match(block[0], /latestAt: latest\.at/);
  assert.match(block[0], /config has changed since you loaded it/);
});

test('undo expansion runs BEFORE the sprint-72 previous snapshot BEFORE mutations (positional pins)', () => {
  // Expansion populates knobPatch/resetResult.keys → the snapshot
  // must see the POST-expansion touched-key union → mutations run
  // last. Any reordering silently breaks redo or records the
  // wrong before-values.
  const expandIdx = HANDLER_SRC.indexOf('operatorConfig.buildUndoPlan(latest)');
  const snapshotIdx = HANDLER_SRC.indexOf('const rawPre = await kvPre.get(operatorConfig.KEY_PREFIX');
  const setIdx = HANDLER_SRC.indexOf('await operatorConfig.setOperatorConfig(ctx.orgIdNumeric, knobPatch)');
  assert.ok(expandIdx > -1 && snapshotIdx > -1 && setIdx > -1);
  assert.ok(expandIdx < snapshotIdx, 'undo expansion MUST precede the previous snapshot');
  assert.ok(snapshotIdx < setIdx, 'previous snapshot MUST precede the mutation');
});

test('undo auto-reason follows the preset precedence (client reason wins)', () => {
  assert.match(HANDLER_SRC, /if \(finalReason === null && undoOf !== null\) \{\s*\n\s*finalReason = `Undid change from \$\{undoOf\}`;/);
  // Ordering: the preset fallback is checked first, then undo —
  // both behind finalReason === null so a client-provided reason
  // always wins.
  const presetIdx = HANDLER_SRC.indexOf('finalReason = `Applied preset: ${presetName}`');
  const undoIdx = HANDLER_SRC.indexOf('finalReason = `Undid change from ${undoOf}`');
  assert.ok(presetIdx > -1 && undoIdx > -1 && presetIdx < undoIdx);
});

test('undoOf travels inside the audit detail via conditional spread', () => {
  const recordBlock = HANDLER_SRC.match(/await events\.record\('operator_config_updated',[\s\S]*?\}\);/);
  assert.ok(recordBlock, 'events.record call not found');
  assert.match(recordBlock[0], /\.\.\.\(undoOf !== null \? \{ undoOf \} : \{\}\),/);
});

// ── Layer 3: history projection ───────────────────────────────────

test('listOperatorConfigHistory projects undoOf with string guard (source pin)', () => {
  const block = EVENTS_SRC.match(/async function listOperatorConfigHistory[\s\S]*?\n\}/);
  assert.ok(block, 'listOperatorConfigHistory not found');
  assert.match(
    block[0],
    /typeof e\.detail\.undoOf === 'string' && e\.detail\.undoOf\.length > 0/,
  );
});

test('listOperatorConfigHistory carries undoOf through for an undo event (runtime)', async () => {
  const orgId = 999_997_301;
  await events.record('operator_config_updated', {
    orgId,
    entityType: 'operator_config',
    entityId: 'sprint73-smoke',
    actorEmailHash: 'abc123def456ghi7',
    detail: {
      patched: { stallThresholdDays: 7 },
      previous: { stallThresholdDays: 3 },
      reason: 'Undid change from 2026-07-07T00:00:00.000Z',
      undoOf: '2026-07-07T00:00:00.000Z',
    },
  });
  const list = await events.listOperatorConfigHistory({ orgId, limit: 5 });
  assert.equal(list.length, 1);
  assert.equal(list[0].undoOf, '2026-07-07T00:00:00.000Z');
  // The undo entry ITSELF carries before-values → redo is free.
  assert.deepEqual(list[0].previous, { stallThresholdDays: 3 });
});

test('listOperatorConfigHistory undoOf is null for non-undo and legacy events (runtime)', async () => {
  const orgId = 999_997_302;
  await events.record('operator_config_updated', {
    orgId,
    entityType: 'operator_config',
    entityId: 'sprint73-nonundo',
    actorEmailHash: 'abc123def456ghi7',
    detail: { patched: { stallThresholdDays: 5 } },
  });
  const list = await events.listOperatorConfigHistory({ orgId, limit: 5 });
  assert.equal(list.length, 1);
  assert.equal(list[0].undoOf, null);
});

// ── Layer 4: TS mirror + UI ───────────────────────────────────────

test('OperatorConfigHistoryEntry TS extends with undoOf: string | null', () => {
  assert.match(
    API_TS,
    /export interface OperatorConfigHistoryEntry \{[\s\S]*?preset: string \| null;[\s\S]*?undoOf: string \| null;[\s\S]*?\}/,
  );
});

test('panel onUndo confirms, sends { undo: { at } }, and reloads on success', () => {
  const body = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /)[0];
  assert.match(body, /async function onUndo\(entry: OperatorConfigHistoryEntry\)/);
  assert.match(body, /if \(!confirm\('Undo the last config change\?/);
  assert.match(body, /undo: \{ at: entry\.at \},/);
  // Guard: entries without an `at` token can never fire (the
  // server would 409-loop on them anyway).
  assert.match(body, /if \(!entry\.at\) return;/);
});

test('undo pill renders on the NEWEST undoable entry only (idx 0 + previous + at guard)', () => {
  const block = INSIGHTS_TSX.match(/function OperatorConfigHistoryList\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block, 'OperatorConfigHistoryList not found');
  const body = block[0];
  assert.match(
    body,
    /const canUndo = idx === 0 && !!entry\.at && entry\.previous !== null;/,
  );
  assert.match(body, /\{canUndo && \(/);
  assert.match(body, /onClick=\{\(\) => onUndo\(entry\)\}/);
  assert.match(body, /disabled=\{undoing\}/);
  assert.match(body, /\{undoing \? 'Undoing…' : '⎌ Undo'\}/);
});

test('reversal entries render the ⎌ marker before the restoration values', () => {
  const block = INSIGHTS_TSX.match(/function OperatorConfigHistoryList\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /\{entry\.undoOf && \(/);
  assert.match(body, /\{'⎌ undid '\}\{formatHistoryTimestamp\(entry\.undoOf\)\}\{': '\}/);
  // Positional: the marker renders BEFORE the set branch so the
  // entry reads "⎌ undid <ts>: set X=…".
  const markerIdx = body.indexOf("{'⎌ undid '}");
  const setIdx = body.indexOf("{'set '}");
  assert.ok(markerIdx > -1 && setIdx > -1 && markerIdx < setIdx);
});
