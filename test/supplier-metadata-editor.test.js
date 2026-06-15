'use strict';

// Source-level drift-guard tests for the supplier.metadata key/value
// editor (PR #147). Second object-shape jsonb editor on the
// platform — mirrors the PR #133 EUDR DDS evidence editor shape:
//   - Each row is a (key, value) pair
//   - Keys must be unique within the object
//   - draftsToMetadata flattens drafts to { [key]: value }
//   - metadataEqual is sort-by-key key/value pair comparison
//   - PATCH sends the full materialised object on the metadata field
//
// Unlike the EUDR editor, metadata is operator-side context (notes,
// integration handles, CRM cross-references) — not a regulator-
// bearing surface. The UX copy reflects the lower stakes.

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

test('Page renders <SupplierMetadataPanel> unconditionally (no length>0 gate)', () => {
  // PR #147 follows PR #133's pattern: panel always renders so
  // operators can ADD the first metadata entry to a supplier with
  // none on file.
  assert.match(SRC, /<SupplierMetadataPanel\s+supplier=\{supplier\}/);
  assert.doesNotMatch(
    SRC,
    /supplier\.metadata && Object\.keys\(supplier\.metadata\)\.length > 0 && \(\s*<SupplierMetadataPanel/,
  );
});

test('Page passes onSaved callback that lifts updated supplier to top-level state', () => {
  assert.match(SRC, /<SupplierMetadataPanel[\s\S]*?onSaved=\{\(updated\) => setSupplier\(updated\)\}/);
});

test('SupplierMetadataPanel is rendered after EudrPanel (consistent layout order)', () => {
  // Visual + accessibility: regulator-bearing surfaces come before
  // operator-side surfaces so they get the first scan.
  const eudrIdx = SRC.indexOf('<EudrPanel');
  const metaIdx = SRC.indexOf('<SupplierMetadataPanel');
  assert.ok(eudrIdx > 0 && metaIdx > 0,
    'both panels must be present in the page');
  assert.ok(eudrIdx < metaIdx,
    'EudrPanel must be rendered before SupplierMetadataPanel');
});

// ── Read mode ────────────────────────────────────────────────────────

test('Read mode shows the existing metadata + Edit button (when not archived)', () => {
  const fnBlock = SRC.match(/function SupplierMetadataReadPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(fnBlock, 'SupplierMetadataReadPanel not located');
  const block = fnBlock[0];
  assert.match(block, /!archived && \(/);
  assert.match(block, /<button\s+type="button"\s+onClick=\{onEditClick\}/);
});

test('Read mode renders BOTH a structured per-row view AND the raw JSON dump', () => {
  // Operator workflow: scan the (key, value) pairs at a glance;
  // expand raw JSON when integrating with downstream tools.
  const fnBlock = SRC.match(/function SupplierMetadataReadPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /entries\.map\(\(\[k, v\]\) => \(/);
  assert.match(block, />\{k\}</);
  assert.match(block, /typeof v === 'string' \? v : JSON\.stringify\(v\)/);
  assert.match(block, /Raw JSON/);
  assert.match(block, /JSON\.stringify\(metadata, null, 2\)/);
});

test('Read mode empty state is matter-of-fact (no compliance framing)', () => {
  // Unlike PR #133's "Required for EUDR Article 8" copy, metadata
  // is freeform — the empty-state must not invoke regulatory framing
  // that would mislead the operator.
  const fnBlock = SRC.match(/function SupplierMetadataReadPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /No metadata recorded\./);
  assert.doesNotMatch(block, /Required for/);
  assert.doesNotMatch(block, /Article 8|EUDR|compliance gap/i);
});

// ── Editor: row state + add/remove/update ────────────────────────────

test('SupplierMetadataDraft type carries a stable rowKey (survives reorders + remounts)', () => {
  assert.match(SRC, /type SupplierMetadataDraft = \{[\s\S]*?rowKey: string;[\s\S]*?\}/);
  assert.match(SRC, /function nextSupplierMetadataRowKey\(\): string \{/);
});

test('Editor seeds at least one empty draft when supplier has no metadata', () => {
  // Anchor to the SupplierMetadataEditorPanel block specifically —
  // EUDR uses the same shape with different identifiers.
  const editorBlock = SRC.match(/function SupplierMetadataEditorPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(editorBlock, 'SupplierMetadataEditorPanel not located');
  assert.match(
    editorBlock[0],
    /seeded\.length > 0\s*\?\s*seeded\s*:\s*\[emptySupplierMetadataDraft\(\)\]/,
  );
});

test('addRow appends a fresh blank draft via emptySupplierMetadataDraft()', () => {
  const fnBlock = SRC.match(/function addRow\(\) \{\s*setDrafts\(\(prev\) => \[\.\.\.prev, emptySupplierMetadataDraft\(\)\]\);\s*\}/);
  assert.ok(fnBlock, 'addRow with emptySupplierMetadataDraft() not located');
});

// ── Materialisation: drafts → metadata object ────────────────────────

test('metadataToDrafts seeds one row per persisted entry, stringifying non-string values', () => {
  const fnBlock = SRC.match(/function metadataToDrafts\(metadata: Record<string, unknown>\): SupplierMetadataDraft\[\] \{[\s\S]*?\n\}/);
  assert.ok(fnBlock, 'metadataToDrafts not located');
  const block = fnBlock[0];
  assert.match(block, /for \(const \[k, v\] of Object\.entries\(metadata\)\)/);
  assert.match(block, /typeof v === 'string' \? v : JSON\.stringify\(v\)/);
});

test('draftsToMetadata drops rows with empty keys (treats add-then-blank as cancellation)', () => {
  const fnBlock = SRC.match(/function draftsToMetadata\(drafts: SupplierMetadataDraft\[\]\): Record<string, string> \{[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /if \(!k\) continue;/);
});

test('draftsToMetadata emits a flat string-valued object', () => {
  const fnBlock = SRC.match(/function draftsToMetadata\(drafts: SupplierMetadataDraft\[\]\): Record<string, string> \{[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /Record<string, string>/);
  assert.match(block, /out\[k\] = d\.value;/);
});

// ── Validation rules ────────────────────────────────────────────────

function metadataClientSideErrorsBlock() {
  const editorBlock = SRC.match(/function SupplierMetadataEditorPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(editorBlock, 'SupplierMetadataEditorPanel not located');
  const fn = editorBlock[0].match(/function clientSideErrors\(\): string\[\] \{[\s\S]*?return out;\s*\}/);
  assert.ok(fn, 'clientSideErrors not located inside SupplierMetadataEditorPanel');
  return fn[0];
}

test('clientSideErrors requires a key when the row carries a value', () => {
  const block = metadataClientSideErrorsBlock();
  assert.match(block, /Row \$\{rowNumber\}: key is required when a value is present/);
});

test('clientSideErrors enforces SUPPLIER_METADATA_KEY_PATTERN (matches EUDR alphabet)', () => {
  // Same alphabet as EUDR (PR #133) — consistent operator UX.
  assert.match(SRC, /const SUPPLIER_METADATA_KEY_PATTERN = \/\^\[a-z0-9\._-\]\+\$\//);
  const block = metadataClientSideErrorsBlock();
  assert.match(block, /!SUPPLIER_METADATA_KEY_PATTERN\.test\(k\)/);
  assert.match(block, /must use only lowercase letters, digits, dots, dashes, and underscores/);
});

test('clientSideErrors flags duplicate keys (uniqueness invariant for object shape)', () => {
  const block = metadataClientSideErrorsBlock();
  assert.match(block, /const seenKeys = new Map<string, number>\(\)/);
  assert.match(block, /Rows \$\{seenAt\} and \$\{rowNumber\} both use key "\$\{k\}" — keys must be unique/);
});

// ── Save flow + no-op short-circuit ──────────────────────────────────

test('metadataEqual is order-insensitive (sort-by-key + JSON.stringify deep compare)', () => {
  const fnBlock = SRC.match(/function metadataEqual\(\s*a: Record<string, unknown>,\s*b: Record<string, unknown>,\s*\): boolean \{[\s\S]*?\n\}/);
  assert.ok(fnBlock, 'metadataEqual not located');
  const block = fnBlock[0];
  assert.match(block, /const aKeys = Object\.keys\(a\)\.sort\(\)/);
  assert.match(block, /JSON\.stringify\(av\) !== JSON\.stringify\(bv\)/);
});

test('No-op short-circuit: matching objects exit without firing a PATCH', () => {
  assert.match(SRC, /if \(metadataEqual\(materialised, initialMetadata\)\) \{[\s\S]*?onCancel\(\);\s*return;\s*\}/);
});

test('PATCH body sends only metadata (sparse — leaves other supplier fields untouched)', () => {
  // The PR #122/#123/#133 boundary stays intact: EditForm owns the
  // scalar fields; each jsonb editor touches only its own field.
  assert.match(
    SRC,
    /apiPatch<\{[^}]*?supplier: Supplier[^}]*?\}>\(\s*`\/suppliers\/\$\{encodeURIComponent\(supplier\.externalId\)\}`,\s*\{ metadata: materialised \}/,
  );
});

// ── Server-error surface ────────────────────────────────────────────

test('Editor catches ApiError → renders errors[] inline with role="alert"', () => {
  const editorBlock = SRC.match(/function SupplierMetadataEditorPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(editorBlock);
  const block = editorBlock[0];
  assert.match(block, /if \(err instanceof ApiError\) \{/);
  assert.match(block, /role="alert"/);
  assert.match(block, /color: 'var\(--color-critical\)'/);
});

test('Editor catches AuthError separately and prompts re-sign-in', () => {
  const editorBlock = SRC.match(/function SupplierMetadataEditorPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(editorBlock);
  const block = editorBlock[0];
  assert.match(block, /else if \(err instanceof AuthError\)/);
  assert.match(block, /Sign in required to save metadata changes/);
});

// ── Accessibility ───────────────────────────────────────────────────

test('Inputs carry sr-only labels with the row number', () => {
  assert.match(SRC, /<span className="sr-only">Key for metadata row \{rowNumber\}<\/span>/);
  assert.match(SRC, /<span className="sr-only">Value for metadata row \{rowNumber\}<\/span>/);
});

test('Remove button carries aria-label with the row number', () => {
  assert.match(SRC, /aria-label=\{`Remove metadata row \$\{rowNumber\}`\}/);
});

// ── Cross-stack drift: server-side acceptance ────────────────────────

test('lib/db/suppliers.js still accepts metadata as a sparse-object patch', () => {
  // The editor's PATCH body relies on the server accepting metadata
  // in validateForUpdate. Drift guard reads the server-side
  // validation.
  assert.match(DB_SRC, /if \(input\.metadata !== undefined && \(typeof input\.metadata !== 'object' \|\| Array\.isArray\(input\.metadata\)\)\) \{[\s\S]*?errors\.push\('metadata must be an object'\)/);
  // updateSupplier's addSet path stringifies the object for jsonb
  // storage.
  assert.match(DB_SRC, /if \(patch\.metadata !== undefined\) addSet\('metadata', JSON\.stringify\(patch\.metadata\)\)/);
});

// ── Regression guards: prior editors preserved ───────────────────────

test('EditForm comment marks metadata as having its own jsonb editor (PR #147)', () => {
  // The EditForm guidance block previously listed metadata as
  // "deferred"; PR #147 ships it. The block must reflect that or
  // future operators will think metadata is unreachable.
  const block = SRC.match(/factoryLocations \/ auditCerts \/ eudrDdsEvidence \/ metadata[\s\S]{0,300}/);
  assert.ok(block, 'EditForm jsonb-fields comment block not located');
  // The comment uses shorthand "PR #130 / #131 / #133 / #147" so we
  // match on the standalone token #147.
  assert.match(block[0], /#147/);
  assert.doesNotMatch(block[0], /deferred/i);
});

test('EUDR editor (PR #133) preserved alongside the metadata editor', () => {
  assert.match(SRC, /function EudrEvidenceEditorPanel\(\{/);
  assert.match(SRC, /<EudrPanel\s+supplier=\{supplier\}/);
});

test('AuditCertsPanel editor (PR #130) preserved alongside the metadata editor', () => {
  assert.match(SRC, /function AuditCertsEditorPanel\(\{/);
  assert.match(SRC, /<AuditCertsPanel\s+supplier=\{supplier\}/);
});

test('FactoryLocationsPanel editor (PR #131) preserved alongside the metadata editor', () => {
  assert.match(SRC, /function FactoryLocationsEditorPanel\(\{/);
  assert.match(SRC, /<FactoryLocationsPanel\s+supplier=\{supplier\}/);
});

test('EditForm scalar fields still NOT touched by the metadata editor', () => {
  const editFormBlock = SRC.match(/function EditForm\(\{[\s\S]*?\n\}\n/);
  assert.ok(editFormBlock);
  const block = editFormBlock[0];
  assert.doesNotMatch(block, /SupplierMetadata|draftsToMetadata|metadataEqual/);
});
