'use strict';

// Source-level drift-guard tests for the acknowledge-with-note flow.
// Covers:
//   - ExceptionRow note input shape + character cap + over-limit gate
//   - apiPost body shape: { note } when present, {} when absent
//   - TransitionHistory timeline headline surfaces the note inline
//   - Cross-stack drift: client cap matches lib/db/shipments.js's
//     server-side slice(0, 500)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'shipments', 'page.tsx');
const TIMELINE_PATH = path.join(ROOT, 'app-shell', 'components', 'TransitionHistory.tsx');
const DB_PATH = path.join(ROOT, 'lib', 'db', 'shipments.js');

const PAGE_SRC = fs.readFileSync(PAGE_PATH, 'utf8');
const TIMELINE_SRC = fs.readFileSync(TIMELINE_PATH, 'utf8');
const DB_SRC = fs.readFileSync(DB_PATH, 'utf8');

// ── Note state + input ───────────────────────────────────────────────

test('ExceptionRow carries a note state with a 500-char limit constant', () => {
  // 500 char cap is enforced server-side (lib/db/shipments.js slice(0,500)).
  // Pinning the constant in the source guards against a silent
  // increase that would bypass server truncation.
  assert.match(PAGE_SRC, /const \[note, setNote\] = useState\(''\)/);
  assert.match(PAGE_SRC, /const NOTE_LIMIT = 500/);
});

test('cross-stack drift: client NOTE_LIMIT matches server-side slice(0, 500)', () => {
  // lib/db/shipments.js writes `String(note).slice(0, 500)`. The
  // client cap MUST be ≤ that, else operators see a confusing
  // mismatch where their full note appears in the success path
  // but truncates in the timeline. Drift guard reads both sides.
  assert.match(DB_SRC, /String\(note\)\.slice\(0, 500\)/);
});

test('Note input renders only for unacknowledged rows (no input post-ack)', () => {
  // Once acknowledged, the row collapses to its compact "Done"
  // state — no input lingers as a UX trap.
  assert.match(PAGE_SRC, /\{!acknowledged && \(\s*<div[\s\S]*?<input/);
});

test('Note input is type="text" with placeholder + sr-only label + max length', () => {
  assert.match(PAGE_SRC, /<span className="sr-only">Acknowledgement note \(optional\)<\/span>/);
  assert.match(PAGE_SRC, /placeholder="Add a note \(optional\) — e\.g\./);
  // maxLength is the limit + 50 — the small buffer lets operators
  // PASTE a slightly-too-long string and see the over-limit gate
  // fire rather than have characters silently chopped at input.
  assert.match(PAGE_SRC, /maxLength=\{NOTE_LIMIT \+ 50\}/);
});

test('Note input is disabled while the request is in flight', () => {
  // Locking the input mid-request avoids the "edited note doesn't
  // match persisted note" race.
  assert.match(PAGE_SRC, /disabled=\{busy\}[\s\S]*?className="w-full bg-\[var/);
});

// ── Character counter ────────────────────────────────────────────────

test('Character counter shows note.length/NOTE_LIMIT when typing, hides when empty', () => {
  // Counter visible only when note has characters — empty rows
  // stay visually quiet for the "no note" quick-triage path.
  assert.match(PAGE_SRC, /note\.length > 0 && \(/);
  assert.match(PAGE_SRC, /\{note\.length\}\/\{NOTE_LIMIT\}/);
});

test('Counter turns critical-coloured + shows over-limit warning when exceeded', () => {
  // Visual feedback before the operator hits Acknowledge.
  assert.match(PAGE_SRC, /const overLimit = note\.length > NOTE_LIMIT/);
  assert.match(PAGE_SRC, /overLimit \? \(\s*<span style=\{\{ color: 'var\(--color-critical\)' \}\}/);
  assert.match(PAGE_SRC, /Note exceeds \{NOTE_LIMIT\} characters/);
  assert.match(PAGE_SRC, /role="alert"/);
});

test('Acknowledge button is disabled when note is over the limit', () => {
  // The data layer would truncate at 500, but disabling the button
  // makes the trim-before-submit affordance explicit.
  assert.match(PAGE_SRC, /disabled=\{busy \|\| acknowledged \|\| overLimit\}/);
});

// ── POST body shape ──────────────────────────────────────────────────

test('Acknowledge POST sends { note } when trimmed note is non-empty, {} otherwise', () => {
  // The conditional preserves the status-quo "ack without note" path
  // (empty body) for operators who don't need to capture context.
  assert.match(PAGE_SRC, /const trimmed = note\.trim\(\)/);
  assert.match(PAGE_SRC, /trimmed \? \{ note: trimmed \} : \{\}/);
});

test('Acknowledge clears the local note buffer on success', () => {
  // The row's input collapses post-ack anyway, but clearing the
  // state means a hypothetical un-ack-then-re-ack flow doesn't
  // resurrect a stale note.
  const fnBlock = PAGE_SRC.match(/async function acknowledge\(\)[\s\S]*?\n  \}/);
  assert.ok(fnBlock, 'acknowledge fn not located');
  const block = fnBlock[0];
  // setNote('') called inside the try (after onAcknowledged),
  // before the catch.
  assert.match(block, /onAcknowledged\([\s\S]*?\}\);\s*\/\/[\s\S]*?setNote\(''\);/);
});

test('Acknowledge POST URL is /shipments/<encoded-id>/exception/acknowledge (no regression)', () => {
  // PR #126 only added the body; the URL contract is unchanged.
  assert.match(
    PAGE_SRC,
    /apiPost<\{[^}]*?shipment: Shipment[\s\S]*?\}>\(\s*`\/shipments\/\$\{encodeURIComponent\(item\.externalId\)\}\/exception\/acknowledge`/,
  );
});

// ── Timeline headline surfaces the note ──────────────────────────────

test('TransitionHistory.shipment.headline surfaces the acknowledgement note inline', () => {
  // The note IS the audit value — surface it in the headline so
  // timeline-scanners see WHY the exception was cleared without
  // expanding the row.
  const shipmentBlock = TIMELINE_SRC.match(/shipment:\s*\{[\s\S]*?headline:[\s\S]*?\},\s*tone:/);
  assert.ok(shipmentBlock, 'shipment headline branch not located');
  const block = shipmentBlock[0];
  assert.match(block, /case 'shipment_master_exception_acknowledged':/);
  // Reads e.detail.note (where lib/db/shipments.js writes it).
  assert.match(block, /\(e\.detail as \{ note\?: string \| null \} \| undefined\)\?\.note/);
  // Format: 'Exception acknowledged · "the note text"'
  assert.match(block, /`Exception acknowledged · "\$\{note\}"`/);
});

test('TransitionHistory falls back to "Exception acknowledged" when no note (no regression)', () => {
  // Status-quo behaviour preserved for ack-without-note path.
  const shipmentBlock = TIMELINE_SRC.match(/shipment:\s*\{[\s\S]*?headline:[\s\S]*?\},\s*tone:/);
  assert.ok(shipmentBlock);
  const block = shipmentBlock[0];
  assert.match(block, /if \(note\) return `Exception acknowledged · "\$\{note\}"`;\s*\n\s*return 'Exception acknowledged';/);
});

// ── Regression guards on previously-shipped behaviour ────────────────

test('SLA breach indicator still renders on flagged rows (no regression on PR #125)', () => {
  // The new note input wires up below the row's main grid;
  // ensure the SLA breach badge inside the main grid is untouched.
  assert.match(PAGE_SRC, /item\._queue\.slaBreached && \(\s*<span className="ml-2 text-\[var\(--color-critical\)\]">· SLA breach<\/span>/);
});

test('Acknowledge button label cycle preserved (Open → Acknowledging… → Done)', () => {
  // The label flow tells the operator where they are. Drift guard
  // pins the three states.
  assert.match(PAGE_SRC, /acknowledged \? 'Done' : busy \? 'Acknowledging…' : 'Acknowledge'/);
});

test('exception_state.acknowledgmentNote is still written server-side (data-layer contract)', () => {
  // The client now USES this path; assert the server still writes
  // it so a future refactor can't drop the persistence silently.
  assert.match(DB_SRC, /acknowledgmentNote: note \? String\(note\)\.slice\(0, 500\) : undefined/);
});

test('audit event detail still carries { acknowledgedAt, note }', () => {
  // The shape the timeline reads from. Drift here would silently
  // hide the note in the headline.
  assert.match(DB_SRC, /detail: \{ acknowledgedAt: nowIso, note: nextState\.acknowledgmentNote \|\| null \}/);
});
