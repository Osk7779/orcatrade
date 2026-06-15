'use strict';

// Source-level drift-guard tests for the supplier factory-locations
// array editor. Closes more of the deferred-jsonb work from PR #122/
// #123; pattern mirrors PR #129 (goods SVHC editor) and PR #130
// (supplier audit-cert editor):
//   - Always-render Panel with read-mode "+ Edit" affordance even
//     when no locations declared
//   - Draft → FactoryLocation round-trip (drop empty rows; sparse
//     output)
//   - Per-row countryCode required + ISO-2 + floorAreaSqm ≥ 0
//   - Order-insensitive equality check + no-op short-circuit
//   - Sparse PATCH body shape (only factoryLocations sent)
//   - Stable rowKey survives reorders + add/remove
//
// EUDR-bearing surface: Article 9 due diligence requires supply-
// chain mapping for relevant commodities. The empty-state copy
// surfaces that requirement to the operator.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'suppliers', '[externalId]', 'page.tsx');
const DB_PATH = path.join(ROOT, 'lib', 'db', 'suppliers.js');

const SRC = fs.readFileSync(PAGE_PATH, 'utf8');
const DB_SRC = fs.readFileSync(DB_PATH, 'utf8');

// ── Always-render + parent wiring ───────────────────────────────────

test('Page renders <FactoryLocationsPanel> unconditionally (no length>0 gate)', () => {
  // PR #131 moved the empty-list check inside the panel so operators
  // can ADD the first location. Previously the panel was hidden when
  // length === 0, blocking the add-first-entry workflow.
  assert.match(SRC, /<FactoryLocationsPanel\s+supplier=\{supplier\}/);
  assert.doesNotMatch(
    SRC,
    /supplier\.factoryLocations && supplier\.factoryLocations\.length > 0 && \(\s*<FactoryLocationsPanel/,
  );
});

test('Page passes onSaved callback that lifts updated supplier to top-level state', () => {
  assert.match(SRC, /<FactoryLocationsPanel[\s\S]*?onSaved=\{\(updated\) => setSupplier\(updated\)\}/);
});

// ── Read mode ────────────────────────────────────────────────────────

test('Read mode shows the existing locations + Edit button (when not archived)', () => {
  const fnBlock = SRC.match(/function FactoryLocationsReadPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(fnBlock, 'FactoryLocationsReadPanel not located');
  const block = fnBlock[0];
  assert.match(block, /!archived && \(/);
  assert.match(block, /<button\s+type="button"\s+onClick=\{onEditClick\}/);
});

test('Read mode empty state surfaces the EUDR Article 9 requirement', () => {
  // Honest UX: the empty state isn't just "no data" — it explains
  // WHY this matters. EUDR Article 9 requires supply-chain mapping
  // for relevant commodities; operators landing on an empty panel
  // should understand they're looking at a compliance gap, not a
  // broken page.
  assert.match(SRC, /No factory locations on file yet/);
  assert.match(SRC, /Required for EUDR Article 9 due diligence/);
});

// ── Editor: row state + add/remove/update ────────────────────────────

test('FactoryLocationDraft type carries a stable rowKey (survives reorders + remounts)', () => {
  assert.match(SRC, /type FactoryLocationDraft = \{[\s\S]*?rowKey: string;[\s\S]*?\}/);
  assert.match(SRC, /function nextFactoryLocRowKey\(\): string \{/);
});

test('Editor seeds at least one empty draft when supplier has no locations', () => {
  assert.match(
    SRC,
    /initialLocs\.length > 0\s*\?\s*initialLocs\.map\(factoryLocationToDraft\)\s*:\s*\[emptyFactoryLocationDraft\(\)\]/,
  );
});

test('addRow appends a fresh blank draft via emptyFactoryLocationDraft()', () => {
  const fnBlock = SRC.match(/function addRow\(\) \{\s*setDrafts\(\(prev\) => \[\.\.\.prev, emptyFactoryLocationDraft\(\)\]\);\s*\}/);
  assert.ok(fnBlock, 'addRow not located');
});

test('removeRow filters by rowKey (not index)', () => {
  assert.match(SRC, /prev\.filter\(\(d\) => d\.rowKey !== rowKey\)/);
});

// ── Materialisation: drafts → factory locations ──────────────────────

test('draftToFactoryLocation drops completely-empty rows (treats add-then-blank as cancellation)', () => {
  const fnBlock = SRC.match(/function draftToFactoryLocation\(d: FactoryLocationDraft\): FactoryLocation \| null \{[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /if \(!countryCode && !city && !role && !areaRaw\) return null;/);
});

test('draftToFactoryLocation uppercases countryCode at the boundary', () => {
  // The input handler also uppercases (so the operator sees the
  // canonical form while typing), but the materialiser must
  // re-normalise in case state was set programmatically.
  const fnBlock = SRC.match(/function draftToFactoryLocation\(d: FactoryLocationDraft\): FactoryLocation \| null \{[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /const countryCode = d\.countryCode\.trim\(\)\.toUpperCase\(\)/);
});

test('draftToFactoryLocation parses floorAreaSqm from string only when finite', () => {
  const fnBlock = SRC.match(/function draftToFactoryLocation\(d: FactoryLocationDraft\): FactoryLocation \| null \{[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /const n = Number\(areaRaw\)/);
  assert.match(block, /if \(Number\.isFinite\(n\)\) out\.floorAreaSqm = n;/);
});

test('draftToFactoryLocation emits sparse output (only populated fields)', () => {
  // No empty strings in the persisted jsonb — matches the SVHC +
  // audit-cert editors' sparse-output discipline.
  const fnBlock = SRC.match(/function draftToFactoryLocation\(d: FactoryLocationDraft\): FactoryLocation \| null \{[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  for (const field of ['countryCode', 'city', 'role']) {
    assert.match(
      block,
      new RegExp(`if \\(${field}\\) out\\.${field} = ${field};`),
      `Sparse-output discipline missing for "${field}"`,
    );
  }
});

// ── Validation rules ─────────────────────────────────────────────────

test('clientSideErrors requires countryCode (EUDR Article 9 supply-chain mapping)', () => {
  // Without countryCode the row has no supply-chain-mapping value.
  const fnBlock = SRC.match(/function clientSideErrors\(materialised: FactoryLocation\[\]\): string\[\] \{[\s\S]*?return out;\s*\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /materialised\.forEach\(\(l, i\)/);
  assert.match(block, /const rowNumber = i \+ 1;/);
  assert.match(block, /Row \$\{rowNumber\}: country code is required/);
});

test('clientSideErrors enforces ISO-2 uppercase on countryCode', () => {
  const fnBlock = SRC.match(/function clientSideErrors\(materialised: FactoryLocation\[\]\): string\[\] \{[\s\S]*?return out;\s*\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /\^\[A-Z\]\{2\}\$/);
  assert.match(block, /country code must be ISO-2 uppercase/);
});

test('clientSideErrors bounds floorAreaSqm to non-negative finite', () => {
  // Negative floor area is a data-entry error; non-finite (NaN /
  // Infinity) likewise.
  const fnBlock = SRC.match(/function clientSideErrors\(materialised: FactoryLocation\[\]\): string\[\] \{[\s\S]*?return out;\s*\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /!Number\.isFinite\(l\.floorAreaSqm\) \|\| l\.floorAreaSqm < 0/);
  assert.match(block, /Row \$\{rowNumber\}: floor area must be a non-negative number/);
});

// ── Save flow + no-op short-circuit ──────────────────────────────────

test('factoryLocationsEqual is order-insensitive (sort-then-compare)', () => {
  // Same logic as PR #129's flagsEqual and PR #130's
  // auditCertsEqual. A reorder-then-undo cycle exits without firing
  // a PATCH (which would write a noise audit event).
  const fnBlock = SRC.match(/function factoryLocationsEqual\([\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /\.map\(norm\)\.sort\(\)/);
});

test('No-op short-circuit: matching arrays exit without firing a PATCH', () => {
  assert.match(SRC, /if \(factoryLocationsEqual\(materialised, initialLocs\)\) \{[\s\S]*?onCancel\(\);\s*return;\s*\}/);
});

test('PATCH body sends only factoryLocations (sparse — leaves other supplier fields untouched)', () => {
  // Drift guard: the factory-locations editor must NOT include
  // entityName / hqCountry / sanctions / audit-cert fields in the
  // patch. EditForm (PR #123) and the other editors own those.
  assert.match(
    SRC,
    /apiPatch<\{[^}]*?supplier: Supplier[^}]*?\}>\(\s*`\/suppliers\/\$\{encodeURIComponent\(supplier\.externalId\)\}`,\s*\{ factoryLocations: materialised \}/,
  );
});

test('Save success calls onSaved with the returned supplier', () => {
  // The factory-locations editor + audit-certs editor + sanctions
  // re-screen flow all call onSaved(d.supplier). Counting matches
  // is the cleanest assertion across the whole file.
  const matches = SRC.match(/onSaved\(d\.supplier\);/g) || [];
  assert.ok(matches.length >= 2,
    `Expected ≥2 onSaved(d.supplier) call sites (audit-certs + factory-locations), got ${matches.length}`);
});

// ── Server-error surface (matches PR #122/#123/#124/#129/#130 pattern) ─

test('Editor catches ApiError → renders errors[] inline with role="alert"', () => {
  const editorBlock = SRC.match(/function FactoryLocationsEditorPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(editorBlock);
  const block = editorBlock[0];
  assert.match(block, /if \(err instanceof ApiError\) \{/);
  assert.match(block, /role="alert"/);
  assert.match(block, /color: 'var\(--color-critical\)'/);
});

test('Editor catches AuthError separately and prompts re-sign-in', () => {
  const editorBlock = SRC.match(/function FactoryLocationsEditorPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(editorBlock);
  const block = editorBlock[0];
  assert.match(block, /else if \(err instanceof AuthError\)/);
  assert.match(block, /Sign in required to save factory location changes/);
});

// ── Disabled-state during save (race protection) ─────────────────────

test('FactoryLocationEditRow inputs + remove button disabled while saving', () => {
  // 4 input fields + remove button × 1 row = 5 expected disabled
  // bindings inside the factory-location row component. The total
  // grows because of PR #130's audit-cert row bindings (7) on the
  // same page — count both editors' contributions in one assertion.
  const matches = SRC.match(/disabled=\{disabled\}/g) || [];
  // PR #130 contributes 7 (6 AuditCertField + remove)
  // PR #131 contributes 5 (4 FactoryLocationField + remove)
  // Total expected: ≥12. Using minimum to be robust to refactors.
  assert.ok(matches.length >= 12,
    `Expected ≥12 disabled={disabled} bindings (PR #130 + PR #131), got ${matches.length}`);
});

test('Add + Save + Cancel buttons all carry disabled={saving}', () => {
  // Each editor (audit-certs + factory-locations) contributes 3
  // disabled={saving} bindings + EditForm (PR #123) contributes 2.
  // Total ≥8.
  const matches = SRC.match(/disabled=\{saving\}/g) || [];
  assert.ok(matches.length >= 8,
    `Expected ≥8 disabled={saving} bindings (PR #123 + #130 + #131), got ${matches.length}`);
});

// ── Accessibility ───────────────────────────────────────────────────

test('Remove button carries aria-label with the row number', () => {
  assert.match(SRC, /aria-label=\{`Remove factory location row \$\{rowNumber\}`\}/);
});

test('Country input handler auto-uppercases as the operator types', () => {
  // Same UX cue as the supplier hqCountry input from PR #123 —
  // the operator sees the canonical form immediately.
  assert.match(SRC, /onChange=\{\(v\) => onChange\(\{ countryCode: v\.toUpperCase\(\) \}\)\}/);
});

// ── Cross-stack drift: server-side acceptance ────────────────────────

test('lib/db/suppliers.js still accepts factoryLocations as a sparse-array patch', () => {
  assert.match(DB_SRC, /if \(input\.factoryLocations !== undefined && !Array\.isArray\(input\.factoryLocations\)\) errors\.push\('factoryLocations must be an array'\)/);
  assert.match(DB_SRC, /if \(patch\.factoryLocations !== undefined\) addSet\('factory_locations', JSON\.stringify\(patch\.factoryLocations\)\)/);
});

// ── Regression guards ──────────────────────────────────────────────

test('EditForm scalar fields still NOT touched by the factory-locations editor (PR #123 boundary preserved)', () => {
  const editFormBlock = SRC.match(/function EditForm\(\{[\s\S]*?\n\}\n/);
  assert.ok(editFormBlock);
  const block = editFormBlock[0];
  assert.doesNotMatch(block, /factoryLocations|countryCode|floorAreaSqm/i);
});

test('EudrPanel is now editable (PR #133 shipped — drift guard against accidental rollback)', () => {
  // PR #131 deferred this; PR #133 shipped it. Drift guard against
  // a future refactor accidentally collapsing the editor back to a
  // read-only panel.
  assert.match(SRC, /function EudrPanel\(\{\s*supplier,\s*onSaved,/);
  assert.match(SRC, /function EudrEvidenceEditorPanel/);
});

test('TrustComponentsPanel still renders read-only (calculator-grounded per ADR 0002)', () => {
  // Trust score is calculator-grounded — never editable from the UI.
  assert.match(SRC, /function TrustComponentsPanel\(\{ supplier \}: \{ supplier: Supplier \}\)/);
});

test('AuditCertsPanel editor (PR #130) preserved alongside the new factory-locations editor', () => {
  assert.match(SRC, /function AuditCertsEditorPanel\(\{/);
  assert.match(SRC, /<AuditCertsPanel\s+supplier=\{supplier\}/);
});

test('SanctionsPanel re-screen flow preserved (PR #124 regression guard)', () => {
  assert.match(SRC, /async function runRescreen\(\)/);
  assert.match(SRC, /apiPost<\{[\s\S]*?supplier: Supplier[\s\S]*?\}>\(\s*`\/suppliers\/\$\{encodeURIComponent\(supplier\.externalId\)\}\/screen`/);
});
