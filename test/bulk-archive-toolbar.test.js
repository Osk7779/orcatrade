'use strict';

// Source-level drift-guard tests for the shared BulkArchiveToolbar
// component (PR #138). Promoted from three byte-identical inline
// copies on the goods (PR #135), suppliers (PR #136), and shipments
// (PR #137) dashboard list pages.
//
// The promotion preserves the contract exactly — each toolbar
// invariant the three per-page tests previously pinned now lives
// here in one place. Per-page tests still cover selection state,
// state-machine wiring, DELETE flow, and accessibility for the row-
// level checkboxes; this file covers everything inside the toolbar
// itself.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const COMP_PATH = path.join(ROOT, 'app-shell', 'components', 'BulkArchiveToolbar.tsx');
const SRC = fs.readFileSync(COMP_PATH, 'utf8');

// ── Public API ───────────────────────────────────────────────────────

test('BulkArchiveToolbar is exported as a named export', () => {
  // Named export (not default) so callers can import alongside the
  // type via destructuring — the pattern PR #138 set on the three
  // SoR pages: `import { BulkArchiveToolbar, type BulkArchiveState }`.
  assert.match(SRC, /export function BulkArchiveToolbar\(\{/);
});

test('BulkArchiveState is exported as a named type', () => {
  assert.match(
    SRC,
    /export type BulkArchiveState =\s*\|\s*\{ kind: 'idle' \}\s*\|\s*\{ kind: 'confirming' \}\s*\|\s*\{ kind: 'archiving' \}\s*\|\s*\{ kind: 'error'; failures: Map<string, string> \};/,
  );
});

test('Component is a Client Component', () => {
  // Interactive surface (button click handlers) — must be 'use
  // client'. Drift guard against accidentally dropping the directive
  // and breaking the bulk archive flow at runtime.
  assert.match(SRC, /^'use client';/);
});

// ── Props contract ───────────────────────────────────────────────────

test('Component accepts exactly six props (selectedCount, archiveState, four callbacks)', () => {
  // The three call sites pass the same six props in the same order.
  // Pin the destructured shape so a callback rename ripples through
  // the call sites OR fails the test.
  const propsBlock = SRC.match(/export function BulkArchiveToolbar\(\{([\s\S]*?)\}: \{/);
  assert.ok(propsBlock, 'props destructuring block not located');
  const destructured = propsBlock[1].split(',').map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(destructured.sort(), [
    'archiveState',
    'onArchiveClick',
    'onCancel',
    'onClear',
    'onConfirm',
    'selectedCount',
  ]);
});

test('Each callback prop is typed () => void (callers retain state-machine ownership)', () => {
  // The component is purely presentational — it doesn't own the
  // state transitions. Each callback fires when the operator
  // interacts; the caller's runBulkArchive / setArchiveState wiring
  // handles the actual transitions.
  for (const cb of ['onArchiveClick', 'onConfirm', 'onCancel', 'onClear']) {
    assert.match(SRC, new RegExp(`${cb}: \\(\\) => void;`),
      `${cb} must be typed () => void`);
  }
});

// ── State derivation ────────────────────────────────────────────────

test('archiving / confirming / hasErrors derived from archiveState.kind (no internal state)', () => {
  // Drift guard against re-introducing internal state to the
  // toolbar — its presentational status is what makes it shareable.
  assert.match(SRC, /const archiving = archiveState\.kind === 'archiving';/);
  assert.match(SRC, /const confirming = archiveState\.kind === 'confirming';/);
  assert.match(SRC, /const hasErrors = archiveState\.kind === 'error';/);
  // No useState anywhere in the component.
  assert.doesNotMatch(SRC, /useState\(/);
});

// ── Button label adapts (3-way pin) ──────────────────────────────────

test('Archive button label adapts to archiveState: "Archive N" / "Archiving…" / "Retry archive"', () => {
  // Operator UX: the label tells you what's happening. Drift guard
  // pins the three-state label exactly so a copy-tweak in a future
  // PR is visible.
  assert.match(
    SRC,
    /archiving\s*\?\s*'Archiving…'\s*:\s*hasErrors\s*\?\s*'Retry archive'\s*:\s*`Archive \$\{selectedCount\}`/,
  );
});

test('Archive button is disabled while archiving (single in-flight DELETE pass)', () => {
  assert.match(SRC, /disabled=\{archiving\}/);
});

test('Archive button border + colour go critical when hasErrors (retry-after-failure cue)', () => {
  // After a failed pass the operator can retry; the button's border
  // + text colour go critical so the action is visibly "still
  // unresolved" rather than just "available".
  assert.match(
    SRC,
    /style=\{hasErrors \? \{ borderColor: 'var\(--color-critical\)', color: 'var\(--color-critical\)' \} : undefined\}/,
  );
});

// ── Confirm banner ───────────────────────────────────────────────────

test('Confirm banner copy spells out irreversibility ("This is irreversible.")', () => {
  // Two-stage destructive flow must clearly state the consequence.
  // Drift guard against silently softening the copy.
  assert.match(SRC, /Archive \{selectedCount\}\? This is irreversible\./);
});

test('Confirm button is critical-coloured (destructive-action visual cue)', () => {
  // The Confirm button stands out visually as destructive — same
  // brand-variable colour used for ApiError / EUDR / audit-cert
  // validation errors elsewhere on the platform.
  assert.match(
    SRC,
    /onConfirm[\s\S]*?backgroundColor: 'var\(--color-critical\)'/,
  );
});

test('Confirm button text colour is ink (legibility against the critical background)', () => {
  // Critical red over ivory is hard to read; the Confirm button
  // inverts to ink-on-red so the action label stays legible.
  assert.match(SRC, /color: 'var\(--color-ink\)'/);
});

test('Cancel button renders alongside Confirm only in the confirming state', () => {
  // Drift guard: Cancel must be reachable EVERY time Confirm is
  // shown — never let the toolbar enter a state where the only
  // exit is to fire the DELETE pass.
  const block = SRC.match(/\{confirming && \(\s*<>([\s\S]*?)<\/>\s*\)\}/);
  assert.ok(block, 'confirming-state JSX fragment not located');
  assert.match(block[1], /onClick=\{onConfirm\}/);
  assert.match(block[1], /onClick=\{onCancel\}/);
});

// ── Failure summary ─────────────────────────────────────────────────

test('Toolbar carries a role="alert" failure summary in the error state', () => {
  // ARIA alert ensures screen readers surface the failure count
  // immediately after the DELETE pass completes.
  assert.match(SRC, /role="alert"/);
});

test('Failure summary text reads "N of M failed. See per-row errors below."', () => {
  // The exact copy directs operators to the per-row error column
  // (which each per-page test pins separately). Drift guard pins
  // the wording.
  assert.match(
    SRC,
    /\{archiveState\.failures\.size\} of \{selectedCount\} failed\. See per-row errors below\./,
  );
});

test('Failure summary is critical-coloured', () => {
  assert.match(
    SRC,
    /role="alert"[\s\S]*?style=\{\{ color: 'var\(--color-critical\)' \}\}/,
  );
});

// ── Toolbar visibility gates ────────────────────────────────────────

test('Archive button renders when NOT confirming (idle, archiving, error)', () => {
  // The Archive (or Archiving… / Retry archive) button is the
  // single primary action when not in the confirm step.
  assert.match(SRC, /\{!confirming && \(\s*<button[\s\S]*?onClick=\{onArchiveClick\}/);
});

test('Clear button renders when NOT confirming (operator can bail out of the selection)', () => {
  // Clear exits the selection without firing any DELETE. Hidden
  // during the confirm step because Cancel is the operator's exit
  // path there.
  assert.match(SRC, /\{!confirming && \(\s*<button[\s\S]*?onClick=\{onClear\}/);
});

test('Clear button is disabled while archiving (race protection)', () => {
  assert.match(SRC, /onClick=\{onClear\}[\s\S]*?disabled=\{archiving\}/);
});

// ── selectedCount text ──────────────────────────────────────────────

test('Toolbar header shows "{selectedCount} selected"', () => {
  // Operator-glance count: how many rows the destructive action
  // will affect.
  assert.match(SRC, /\{selectedCount\} selected/);
});

// ── Brand consistency ──────────────────────────────────────────────

test('All colours use brand variables (no hard-coded hex in styling contexts)', () => {
  // The styling discipline from the wizard pills + tier-a badges
  // applies here too. Drift guard catches an accidental literal hex
  // sneaking in via a designer paste.
  //
  // Comments reference PRs (e.g. "PR #135"), so we can't naively
  // scan for /#[0-9a-fA-F]{3,6}/. Instead strip comments first
  // (// to end-of-line) and check the styled-content only.
  const stripped = SRC
    // Remove // line comments (this is JSX/TS — JSX expression-syntax
    // doesn't include //, so this stripping is safe).
    .replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(stripped, /[:'"]\s*#[0-9a-fA-F]{3,6}/,
    'hard-coded hex colour found in a styling context');
});

test('Toolbar uses the navy-soft tint background (matches the dashboard banner family)', () => {
  // Same brand-variable tint other inline toolbars on the dashboard
  // pages use (sanctions banner, exception queue card). Drift guard
  // catches accidental palette drift.
  assert.match(SRC, /bg-\[var\(--color-navy-soft\)\]\/20/);
});
