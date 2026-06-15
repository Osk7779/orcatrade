'use strict';

// Source-level drift-guard tests for the goods SVHC array editor.
// Closes the deferred-jsonb-fields promise from PR #122.
//
// The editor is the first structured-jsonb editor on the platform —
// pattern that supplier factoryLocations / auditCerts will mirror
// (separate PRs). Drift guards cover:
//   - Always-render Panel (with read-mode "+ Edit" affordance even
//     when no SVHCs are declared)
//   - SvhcDraft → ReachSvhcFlag round-trip (drop empty rows; parse
//     threshold_pct from string)
//   - Per-row name OR cas requirement + threshold 0-100 bounds
//   - Order-insensitive equality check + no-op short-circuit
//   - Sparse PATCH body shape (only reachSvhcFlags sent)
//   - Stable rowKey survives reorders + add/remove
//   - Disabled-state during save (no concurrent edits race)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'goods', '[externalId]', 'page.tsx');
const DB_PATH = path.join(ROOT, 'lib', 'db', 'goods.js');

const SRC = fs.readFileSync(PAGE_PATH, 'utf8');
const DB_SRC = fs.readFileSync(DB_PATH, 'utf8');

// ── Always-render + parent wiring ───────────────────────────────────

test('Page renders <ReachSvhcPanel> unconditionally (no length>0 gate)', () => {
  // PR #129 moved the empty-list check inside the panel so operators
  // can ADD the first SVHC. Previously the panel was hidden when
  // length === 0, which made adding impossible from the UI.
  assert.match(SRC, /<ReachSvhcPanel\s+goods=\{goods\}/);
  // The old conditional render must be gone.
  assert.doesNotMatch(SRC, /goods\.reachSvhcFlags && goods\.reachSvhcFlags\.length > 0 && \(\s*<ReachSvhcPanel/);
});

test('Page passes onSaved callback that lifts updated goods to top-level state', () => {
  assert.match(SRC, /<ReachSvhcPanel[\s\S]*?onSaved=\{\(updated\) => setGoods\(updated\)\}/);
});

// ── Read mode ────────────────────────────────────────────────────────

test('Read mode shows the existing flags list + Edit button (when not archived)', () => {
  // Capture until the next top-level function declaration (the
  // `\n` followed by `function ` at column 0 anchors the boundary).
  const fnBlock = SRC.match(/function ReadModePanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(fnBlock, 'ReadModePanel not located');
  const block = fnBlock[0];
  // Edit button gated on !archived (symmetric with PR #122/#123).
  assert.match(block, /!archived && \(/);
  assert.match(block, /<button\s+type="button"\s+onClick=\{onEditClick\}/);
});

test('Read mode empty state is operator-actionable ("Click Edit to add the first entry")', () => {
  // Honest UX: a goods record with no SVHCs is NOT a broken page;
  // it just hasn't been populated. The empty-state copy guides the
  // operator to the affordance.
  assert.match(SRC, /No SVHCs declared yet/);
  assert.match(SRC, /Click Edit to add the first entry/);
});

test('Read mode border tone is warning only when flags exist (no false-alarm on empty)', () => {
  // The yellow warning border signals "operator attention" — should
  // only appear when there ARE flagged substances. Empty-list goods
  // get the neutral navy-line border.
  assert.match(SRC, /const borderColor = hasFlags \? 'var\(--color-warning\)' : 'var\(--color-navy-line\)'/);
});

// ── Editor: row state + add/remove/update ────────────────────────────

test('SvhcDraft type carries a stable rowKey (survives reorders + remounts)', () => {
  // React reconciliation needs a stable key per row — using the
  // array index would lose focus + remount on insert/delete. The
  // rowKey is a generated string assigned once and threaded through.
  assert.match(SRC, /type SvhcDraft = \{[\s\S]*?rowKey: string;[\s\S]*?\}/);
  assert.match(SRC, /function nextRowKey\(\): string \{/);
});

test('Editor seeds at least one empty draft when goods has no flags', () => {
  // Initial state for an empty-list goods: one blank row so the
  // operator can start typing immediately.
  assert.match(SRC, /initialFlags\.length > 0\s*\?\s*initialFlags\.map\(flagToDraft\)\s*:\s*\[\{ rowKey: nextRowKey\(\),[^}]*?\}\]/);
});

test('addRow appends a fresh blank draft', () => {
  const fnBlock = SRC.match(/function addRow\(\)[\s\S]*?\n  \}/);
  assert.ok(fnBlock, 'addRow not located');
  const block = fnBlock[0];
  assert.match(block, /\[\s*\.\.\.prev,\s*\{ rowKey: nextRowKey\(\)/);
});

test('removeRow filters by rowKey (not index — index would shift after removal)', () => {
  const fnBlock = SRC.match(/function removeRow\(rowKey: string\)[\s\S]*?\n  \}/);
  assert.ok(fnBlock, 'removeRow not located');
  const block = fnBlock[0];
  assert.match(block, /prev\.filter\(\(d\) => d\.rowKey !== rowKey\)/);
});

test('updateRow patches by rowKey (preserves other rows untouched)', () => {
  const fnBlock = SRC.match(/function updateRow\(rowKey: string, patch: Partial<SvhcDraft>\)[\s\S]*?\n  \}/);
  assert.ok(fnBlock, 'updateRow not located');
  const block = fnBlock[0];
  assert.match(block, /d\.rowKey === rowKey \? \{ \.\.\.d, \.\.\.patch \} : d/);
});

// ── Materialisation: drafts → flags ──────────────────────────────────

test('draftToFlag drops completely-empty rows (treats add-then-blank as cancellation)', () => {
  // Empty rows are silently dropped at save — NOT a validation
  // error. This handles the natural workflow: operator clicks
  // "+ Add SVHC" then changes their mind and leaves the row blank.
  const fnBlock = SRC.match(/function draftToFlag\(d: SvhcDraft\): ReachSvhcFlag \| null \{[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /if \(!name && !cas && !thrRaw\) return null;/);
});

test('draftToFlag parses threshold_pct from string but only emits when finite', () => {
  const fnBlock = SRC.match(/function draftToFlag\(d: SvhcDraft\): ReachSvhcFlag \| null \{[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /const n = Number\(thrRaw\)/);
  assert.match(block, /if \(Number\.isFinite\(n\)\) out\.threshold_pct = n;/);
});

test('draftToFlag emits only the fields actually present (sparse output)', () => {
  // A row with just a name should NOT carry empty-string cas /
  // null threshold — the persisted jsonb should be tight. Drift
  // guard reads the conditional assignment.
  const fnBlock = SRC.match(/function draftToFlag\(d: SvhcDraft\): ReachSvhcFlag \| null \{[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /if \(name\) out\.name = name;/);
  assert.match(block, /if \(cas\) out\.cas = cas;/);
  assert.match(block, /if \(thrRaw !== ''\) \{/);
});

// ── Validation rules ────────────────────────────────────────────────

test('clientSideErrors requires at least name OR cas (no anonymous threshold-only rows)', () => {
  const fnBlock = SRC.match(/function clientSideErrors\(materialised: ReachSvhcFlag\[\]\): string\[\] \{[\s\S]*?return out;\s*\}/);
  assert.ok(fnBlock, 'clientSideErrors not located');
  const block = fnBlock[0];
  // Iterates per-row with 1-indexed row numbers in messages.
  assert.match(block, /materialised\.forEach\(\(f, i\)/);
  assert.match(block, /const rowNumber = i \+ 1;/);
  assert.match(block, /Row \$\{rowNumber\}: must have a name or a CAS number/);
});

test('clientSideErrors bounds threshold_pct to 0-100 (matches REACH regulation)', () => {
  // REACH SVHC threshold is expressed as a percentage; anything
  // outside 0-100 is a data-entry error.
  const fnBlock = SRC.match(/function clientSideErrors\(materialised: ReachSvhcFlag\[\]\): string\[\] \{[\s\S]*?return out;\s*\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /f\.threshold_pct < 0 \|\| f\.threshold_pct > 100/);
  assert.match(block, /Row \$\{rowNumber\}: threshold % must be between 0 and 100/);
});

// ── Save flow + no-op short-circuit ──────────────────────────────────

test('flagsEqual is order-insensitive (sort-then-compare)', () => {
  // Operators commonly reorder rows by add-at-bottom-delete-from-
  // middle. Order changes alone shouldn't trigger a PATCH (which
  // would write a noise event to the audit log).
  const fnBlock = SRC.match(/function flagsEqual\(a: ReachSvhcFlag\[\], b: ReachSvhcFlag\[\]\): boolean \{[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /\.map\(norm\)\.sort\(\)/);
});

test('No-op short-circuit: matching arrays exit without firing a PATCH', () => {
  assert.match(SRC, /if \(flagsEqual\(materialised, initialFlags\)\) \{[\s\S]*?onCancel\(\);\s*return;\s*\}/);
});

test('PATCH body sends only reachSvhcFlags (sparse — leaves other goods fields untouched)', () => {
  // Drift guard: the SVHC editor must NOT include displayName /
  // hsCode etc. in the patch — those are EditForm's territory
  // (PR #122). A wider patch here would cause confusing audit
  // events.
  assert.match(
    SRC,
    /apiPatch<\{[^}]*?goods: Goods[^}]*?\}>\(\s*`\/goods\/\$\{encodeURIComponent\(goods\.externalId\)\}`,\s*\{ reachSvhcFlags: materialised \}/,
  );
});

test('Save success calls onSaved with the returned goods record', () => {
  assert.match(SRC, /onSaved\(d\.goods\);/);
});

// ── Server-error surface (matches PR #122/#123 pattern) ──────────────

test('SVHC editor catches ApiError → renders errors[] inline with role="alert"', () => {
  assert.match(SRC, /if \(err instanceof ApiError\) \{/);
  assert.match(SRC, /setErrors\(err\.errors\.length \? err\.errors : \[err\.message\]\)/);
  assert.match(SRC, /role="alert"/);
  assert.match(SRC, /color: 'var\(--color-critical\)'/);
});

test('SVHC editor catches AuthError separately and prompts re-sign-in', () => {
  assert.match(SRC, /else if \(err instanceof AuthError\)/);
  assert.match(SRC, /Sign in required to save SVHC changes/);
});

// ── Disabled-state during save (race protection) ─────────────────────

test('SvhcEditRow inputs + remove button disabled while saving', () => {
  // Same race-protection pattern as the ack-with-note input (PR
  // #126). Prevents "operator changed a row while the request was
  // in flight" desync between local state and persisted state.
  //
  // disabled={disabled} appears in SvhcEditRow (PR #129 — 4 bindings)
  // and RestrictedSubstancesEditRow (PR #148 — 3 bindings: key,
  // value, remove). Total 7 across the page; tighter counts pinned
  // in the per-editor drift-guard tests.
  const matches = SRC.match(/disabled=\{disabled\}/g) || [];
  assert.ok(matches.length >= 7,
    `Expected ≥7 disabled={disabled} bindings (PR #129 + PR #148), got ${matches.length}`);
});

test('Add SVHC + Save + Cancel buttons all carry disabled={saving}', () => {
  // 3 buttons in SvhcEditorPanel (Add SVHC, Cancel, Save) +
  // 2 buttons in EditForm from PR #122 (Cancel, Save) +
  // 1 button in SanctionsPanel from PR #124 on suppliers (doesn't
  // count here) → 5 expected on this page.
  // Counting all matches keeps the test robust to function-block
  // boundary issues with non-greedy regex.
  const matches = SRC.match(/disabled=\{saving\}/g) || [];
  assert.ok(matches.length >= 5,
    `Expected ≥5 disabled={saving} bindings (3 SVHC editor + 2 EditForm), got ${matches.length}`);
});

// ── Accessibility ───────────────────────────────────────────────────

test('Remove button carries an aria-label with the row number', () => {
  // A screen-reader hearing "× × × × ×" would lose track; the
  // aria-label ("Remove SVHC row 3") restores context.
  assert.match(SRC, /aria-label=\{`Remove SVHC row \$\{rowNumber\}`\}/);
});

// ── Cross-stack drift: client validation reflects backend ────────────

test('lib/db/goods.js still accepts reachSvhcFlags as a sparse-array patch (cross-stack drift guard)', () => {
  // The editor's PATCH body relies on the server accepting
  // reachSvhcFlags in validateForUpdate. A future server-side
  // refactor must not silently drop this.
  assert.match(DB_SRC, /if \(input\.reachSvhcFlags !== undefined && !Array\.isArray\(input\.reachSvhcFlags\)\) errors\.push\('reachSvhcFlags must be an array'\)/);
  // And the addSet path in updateGoods includes reachSvhcFlags
  // (JSON.stringify'd).
  assert.match(DB_SRC, /if \(patch\.reachSvhcFlags !== undefined\) addSet\('reach_svhc_flags', JSON\.stringify\(patch\.reachSvhcFlags\)\)/);
});

// ── Regression guards ──────────────────────────────────────────────

test('EditForm scalar fields still NOT touched by the SVHC editor (PR #122 boundary preserved)', () => {
  // PR #122's EditForm doc explicitly excluded jsonb fields. The
  // SVHC editor lives in its own component — drift guard ensures
  // no SVHC state crept into EditForm.
  const editFormBlock = SRC.match(/function EditForm\(\{[\s\S]*?\n\}\n/);
  assert.ok(editFormBlock);
  const block = editFormBlock[0];
  assert.doesNotMatch(block, /reachSvhcFlags|svhc|SVHC/i);
});

test('RestrictedSubstancesPanel ships its own editor (PR #148) and is wired into the page', () => {
  // PR #129 originally pinned this panel as read-only; PR #148 ships
  // its key/value editor. Inverted drift guard (matches the PR #133
  // treatment in the supplier-* editor tests) — protects against an
  // accidental rollback to the read-only stub.
  assert.match(SRC, /function RestrictedSubstancesPanel\(\{\s*goods,\s*onSaved,\s*\}: \{\s*goods: Goods;\s*onSaved: \(updated: Goods\) => void;\s*\}\)/);
  assert.match(SRC, /<RestrictedSubstancesPanel[\s\S]*?onSaved=\{\(updated\) => setGoods\(updated\)\}/);
});
