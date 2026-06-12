'use strict';

// Source-level drift-guard tests for the supplier EUDR DDS evidence
// key/value editor. First object-shape jsonb editor on the platform —
// pattern adapts PRs #129-#131 (array editors) for the OBJECT shape:
//   - Each row is a (key, value) pair instead of a multi-field object
//   - Keys must be unique within the object (validation flag)
//   - draftsToEvidence flattens drafts to { [key]: value }
//   - evidenceEqual is sort-by-key key/value pair comparison
//   - PATCH sends the full materialised object on the
//     eudrDdsEvidence field
//
// EUDR Article 8 due-diligence-bearing surface: importers of
// relevant commodities (timber, cocoa, coffee, palm oil, rubber,
// soy, cattle, derived products) must hold a DDS backed by
// documented evidence.

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

test('Page renders <EudrPanel> unconditionally (no length>0 gate)', () => {
  // PR #133 moved the empty-list check inside the panel so operators
  // can ADD the first DDS evidence entry. Previously the panel was
  // hidden when the evidence object was empty, blocking the add-
  // first-entry workflow.
  assert.match(SRC, /<EudrPanel\s+supplier=\{supplier\}/);
  assert.doesNotMatch(
    SRC,
    /supplier\.eudrDdsEvidence && Object\.keys\(supplier\.eudrDdsEvidence\)\.length > 0 && \(\s*<EudrPanel/,
  );
});

test('Page passes onSaved callback that lifts updated supplier to top-level state', () => {
  assert.match(SRC, /<EudrPanel[\s\S]*?onSaved=\{\(updated\) => setSupplier\(updated\)\}/);
});

// ── Read mode ────────────────────────────────────────────────────────

test('Read mode shows the existing evidence + Edit button (when not archived)', () => {
  const fnBlock = SRC.match(/function EudrEvidenceReadPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(fnBlock, 'EudrEvidenceReadPanel not located');
  const block = fnBlock[0];
  assert.match(block, /!archived && \(/);
  assert.match(block, /<button\s+type="button"\s+onClick=\{onEditClick\}/);
});

test('Read mode renders BOTH a structured per-row view AND the raw JSON dump', () => {
  // Auditor due diligence: power users want to see the raw object
  // structure (the existing JSON dump). Operators want to scan the
  // (key, value) pairs at a glance. Read mode serves both.
  const fnBlock = SRC.match(/function EudrEvidenceReadPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  // Structured rows: iterates entries with the key on one side and
  // the value on the other.
  assert.match(block, /entries\.map\(\(\[k, v\]\) => \(/);
  assert.match(block, />\{k\}</);
  // Non-string values JSON-stringified inline so they render
  // sensibly even when the operator stored a complex value.
  assert.match(block, /typeof v === 'string' \? v : JSON\.stringify\(v\)/);
  // Raw JSON dump preserved under a <details> summary.
  assert.match(block, /Raw JSON/);
  assert.match(block, /JSON\.stringify\(evidence, null, 2\)/);
});

test('Read mode empty state surfaces the EUDR Article 8 requirement', () => {
  // Honest UX: an empty panel isn't a "no data" page; it's a
  // compliance gap. The copy makes that explicit so operators
  // landing here understand the urgency.
  assert.match(SRC, /No EUDR evidence on file yet/);
  assert.match(SRC, /Required for EUDR Article 8 due diligence/);
});

// ── Editor: row state + add/remove/update ────────────────────────────

test('EudrEvidenceDraft type carries a stable rowKey (survives reorders + remounts)', () => {
  // Same React-reconciliation invariant as PRs #129-#131. Object-
  // shape editors face the same key-stability concern that array
  // editors do.
  assert.match(SRC, /type EudrEvidenceDraft = \{[\s\S]*?rowKey: string;[\s\S]*?\}/);
  assert.match(SRC, /function nextEudrRowKey\(\): string \{/);
});

test('Editor seeds at least one empty draft when supplier has no evidence', () => {
  // When the operator opens edit mode on a brand-new supplier they
  // see a blank (key, value) row ready to type into.
  assert.match(
    SRC,
    /seeded\.length > 0\s*\?\s*seeded\s*:\s*\[emptyEudrEvidenceDraft\(\)\]/,
  );
});

test('addRow appends a fresh blank draft via emptyEudrEvidenceDraft()', () => {
  const fnBlock = SRC.match(/function addRow\(\) \{\s*setDrafts\(\(prev\) => \[\.\.\.prev, emptyEudrEvidenceDraft\(\)\]\);\s*\}/);
  assert.ok(fnBlock, 'addRow not located');
});

test('removeRow filters by rowKey (not index)', () => {
  // Index-based deletion mis-targets after a mid-list removal —
  // same trap PRs #129/#130/#131 avoided.
  assert.match(SRC, /prev\.filter\(\(d\) => d\.rowKey !== rowKey\)/);
});

// ── Materialisation: drafts → evidence object ────────────────────────

test('evidenceToDrafts seeds one row per persisted entry, stringifying non-string values', () => {
  const fnBlock = SRC.match(/function evidenceToDrafts\(evidence: Record<string, unknown>\): EudrEvidenceDraft\[\] \{[\s\S]*?\n\}/);
  assert.ok(fnBlock, 'evidenceToDrafts not located');
  const block = fnBlock[0];
  assert.match(block, /for \(const \[k, v\] of Object\.entries\(evidence\)\)/);
  // Non-string values are JSON-stringified so the operator gets a
  // round-trippable form.
  assert.match(block, /typeof v === 'string' \? v : JSON\.stringify\(v\)/);
});

test('draftsToEvidence drops rows with empty keys (treats add-then-blank as cancellation)', () => {
  // Same UX invariant as PR #129-#131: adding a row and then
  // changing your mind isn't a validation error — it's a silent
  // no-op at materialisation time.
  const fnBlock = SRC.match(/function draftsToEvidence\(drafts: EudrEvidenceDraft\[\]\): Record<string, string> \{[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /if \(!k\) continue;/);
});

test('draftsToEvidence emits a flat string-valued object (operator can JSON-encode complex values)', () => {
  // v1 keeps values as strings. Auditors typically capture URLs,
  // dates, and short attestations — all string-shaped. Structured
  // values get JSON-encoded by the operator; the read view's
  // raw-JSON dump shows the stored form.
  const fnBlock = SRC.match(/function draftsToEvidence\(drafts: EudrEvidenceDraft\[\]\): Record<string, string> \{[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  // The output type is Record<string, string>, so values aren't
  // re-parsed.
  assert.match(block, /Record<string, string>/);
  assert.match(block, /out\[k\] = d\.value;/);
});

// ── Validation rules ────────────────────────────────────────────────

// Helper: extract the EUDR editor's clientSideErrors body. The page
// has multiple clientSideErrors functions (one per editor), so we
// anchor inside EudrEvidenceEditorPanel before matching the inner
// function.
function eudrClientSideErrorsBlock() {
  const editorBlock = SRC.match(/function EudrEvidenceEditorPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(editorBlock, 'EudrEvidenceEditorPanel not located');
  const fn = editorBlock[0].match(/function clientSideErrors\(\): string\[\] \{[\s\S]*?return out;\s*\}/);
  assert.ok(fn, 'clientSideErrors not located inside EudrEvidenceEditorPanel');
  return fn[0];
}

test('clientSideErrors requires a key when the row carries a value', () => {
  // An anonymous value row is unusable — it can't be reconstituted
  // into the jsonb object on read.
  const block = eudrClientSideErrorsBlock();
  assert.match(block, /Row \$\{rowNumber\}: key is required when a value is present/);
});

test('clientSideErrors enforces the EUDR_KEY_PATTERN (lowercase + digits + dots + dashes + underscores)', () => {
  // Locking the key alphabet keeps the evidence keys parseable
  // across the EU compliance toolchain (forwarders, brokers,
  // customs systems often inspect them directly).
  assert.match(SRC, /const EUDR_KEY_PATTERN = \/\^\[a-z0-9\._-\]\+\$\//);
  const block = eudrClientSideErrorsBlock();
  assert.match(block, /!EUDR_KEY_PATTERN\.test\(k\)/);
  assert.match(block, /must use only lowercase letters, digits, dots, dashes, and underscores/);
});

test('clientSideErrors flags duplicate keys (uniqueness invariant for object shape)', () => {
  // Unlike arrays, an object can't carry two entries with the same
  // key — the second would overwrite the first at materialisation.
  // Flag the conflict instead of silently dropping data.
  const block = eudrClientSideErrorsBlock();
  assert.match(block, /const seenKeys = new Map<string, number>\(\)/);
  assert.match(block, /Rows \$\{seenAt\} and \$\{rowNumber\} both use key "\$\{k\}" — keys must be unique/);
});

// ── Save flow + no-op short-circuit ──────────────────────────────────

test('evidenceEqual is order-insensitive (sort-by-key + JSON.stringify deep compare)', () => {
  // Same goal as PR #129's flagsEqual: reorder-then-undo doesn't
  // trigger a PATCH or noise audit event. The implementation
  // adapts to object shape via Object.keys().sort() + per-key
  // JSON.stringify comparison.
  const fnBlock = SRC.match(/function evidenceEqual\(\s*a: Record<string, unknown>,\s*b: Record<string, unknown>,\s*\): boolean \{[\s\S]*?\n\}/);
  assert.ok(fnBlock, 'evidenceEqual not located');
  const block = fnBlock[0];
  assert.match(block, /const aKeys = Object\.keys\(a\)\.sort\(\)/);
  assert.match(block, /JSON\.stringify\(av\) !== JSON\.stringify\(bv\)/);
});

test('No-op short-circuit: matching objects exit without firing a PATCH', () => {
  assert.match(SRC, /if \(evidenceEqual\(materialised, initialEvidence\)\) \{[\s\S]*?onCancel\(\);\s*return;\s*\}/);
});

test('PATCH body sends only eudrDdsEvidence (sparse — leaves other supplier fields untouched)', () => {
  // The PR #122/#123 boundary stays intact: EditForm owns
  // entityName / hqCountry / sanctions / etc.; the EUDR editor
  // touches only eudrDdsEvidence.
  assert.match(
    SRC,
    /apiPatch<\{[^}]*?supplier: Supplier[^}]*?\}>\(\s*`\/suppliers\/\$\{encodeURIComponent\(supplier\.externalId\)\}`,\s*\{ eudrDdsEvidence: materialised \}/,
  );
});

// ── Server-error surface (matches PR #122-#131 pattern) ──────────────

test('Editor catches ApiError → renders errors[] inline with role="alert"', () => {
  const editorBlock = SRC.match(/function EudrEvidenceEditorPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(editorBlock);
  const block = editorBlock[0];
  assert.match(block, /if \(err instanceof ApiError\) \{/);
  assert.match(block, /role="alert"/);
  assert.match(block, /color: 'var\(--color-critical\)'/);
});

test('Editor catches AuthError separately and prompts re-sign-in', () => {
  const editorBlock = SRC.match(/function EudrEvidenceEditorPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(editorBlock);
  const block = editorBlock[0];
  assert.match(block, /else if \(err instanceof AuthError\)/);
  assert.match(block, /Sign in required to save EUDR evidence changes/);
});

// ── Disabled-state during save (race protection) ─────────────────────

test('EudrEvidenceEditRow inputs + remove button disabled while saving', () => {
  // 2 inputs (key + value) + remove button × 1 row = 3 bindings
  // inside the row. Combined with PR #130 (7) + PR #131 (5) =
  // ≥15 disabled={disabled} bindings on this page.
  const matches = SRC.match(/disabled=\{disabled\}/g) || [];
  assert.ok(matches.length >= 15,
    `Expected ≥15 disabled={disabled} bindings (PR #130 + #131 + #133), got ${matches.length}`);
});

test('Add + Save + Cancel buttons all carry disabled={saving}', () => {
  // Each editor contributes 3 (Add, Cancel, Save) + EditForm
  // (PR #123) contributes 2. Three editors × 3 + 2 = 11.
  const matches = SRC.match(/disabled=\{saving\}/g) || [];
  assert.ok(matches.length >= 11,
    `Expected ≥11 disabled={saving} bindings (PR #123 + 3 editors), got ${matches.length}`);
});

// ── Accessibility ───────────────────────────────────────────────────

test('Inputs carry sr-only labels with the row number', () => {
  // Key + value inputs each get a screen-reader label so an SR
  // user knows which row's field they're editing.
  assert.match(SRC, /<span className="sr-only">Key for evidence row \{rowNumber\}<\/span>/);
  assert.match(SRC, /<span className="sr-only">Value for evidence row \{rowNumber\}<\/span>/);
});

test('Remove button carries aria-label with the row number', () => {
  assert.match(SRC, /aria-label=\{`Remove EUDR evidence row \$\{rowNumber\}`\}/);
});

// ── Cross-stack drift: server-side acceptance ────────────────────────

test('lib/db/suppliers.js still accepts eudrDdsEvidence as a sparse-object patch', () => {
  // The editor's PATCH body relies on the server accepting
  // eudrDdsEvidence in validateForUpdate. Drift guard reads the
  // server-side validation.
  assert.match(DB_SRC, /if \(input\.eudrDdsEvidence !== undefined && \(typeof input\.eudrDdsEvidence !== 'object' \|\| Array\.isArray\(input\.eudrDdsEvidence\)\)\) \{[\s\S]*?errors\.push\('eudrDdsEvidence must be an object'\)/);
  // updateSupplier's addSet path stringifies the object for jsonb
  // storage.
  assert.match(DB_SRC, /if \(patch\.eudrDdsEvidence !== undefined\) addSet\('eudr_dds_evidence', JSON\.stringify\(patch\.eudrDdsEvidence\)\)/);
});

// ── Regression guards ──────────────────────────────────────────────

test('EditForm scalar fields still NOT touched by the EUDR editor (PR #123 boundary preserved)', () => {
  const editFormBlock = SRC.match(/function EditForm\(\{[\s\S]*?\n\}\n/);
  assert.ok(editFormBlock);
  const block = editFormBlock[0];
  assert.doesNotMatch(block, /eudrDdsEvidence|EudrEvidence/i);
});

test('AuditCertsPanel editor (PR #130) preserved alongside the EUDR editor', () => {
  assert.match(SRC, /function AuditCertsEditorPanel\(\{/);
  assert.match(SRC, /<AuditCertsPanel\s+supplier=\{supplier\}/);
});

test('FactoryLocationsPanel editor (PR #131) preserved alongside the EUDR editor', () => {
  assert.match(SRC, /function FactoryLocationsEditorPanel\(\{/);
  assert.match(SRC, /<FactoryLocationsPanel\s+supplier=\{supplier\}/);
});

test('TrustComponentsPanel still renders read-only (calculator-grounded per ADR 0002)', () => {
  // Trust score is calculator-grounded — never editable from the UI.
  assert.match(SRC, /function TrustComponentsPanel\(\{ supplier \}: \{ supplier: Supplier \}\)/);
});

test('SanctionsPanel re-screen flow preserved (PR #124 regression guard)', () => {
  assert.match(SRC, /async function runRescreen\(\)/);
  assert.match(SRC, /apiPost<\{[\s\S]*?supplier: Supplier[\s\S]*?\}>\(\s*`\/suppliers\/\$\{encodeURIComponent\(supplier\.externalId\)\}\/screen`/);
});
