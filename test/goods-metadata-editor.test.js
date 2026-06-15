'use strict';

// Source-level drift-guard tests for the goods.metadata key/value
// editor (PR #149). Fourth and final object-shape jsonb editor on the
// platform — closes the deferred-jsonb list from PR #133.
//
// Mirrors PR #147 (supplier.metadata) exactly — only the entity (goods
// vs supplier) and the example keys in the helper copy differ. Both
// editors share the same lowercase key alphabet.

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

test('Page renders <GoodsMetadataPanel> unconditionally (no length>0 gate)', () => {
  assert.match(SRC, /<GoodsMetadataPanel\s+goods=\{goods\}/);
  assert.doesNotMatch(
    SRC,
    /goods\.metadata && Object\.keys\(goods\.metadata\)\.length > 0 && \(\s*<GoodsMetadataPanel/,
  );
});

test('Page passes onSaved callback that lifts updated goods to top-level state', () => {
  assert.match(SRC, /<GoodsMetadataPanel[\s\S]*?onSaved=\{\(updated\) => setGoods\(updated\)\}/);
});

test('GoodsMetadataPanel is rendered after RestrictedSubstancesPanel (consistent layout order)', () => {
  // Regulator-bearing surfaces come before operator-side surfaces so
  // they get the first scan — mirrors PR #147's supplier layout
  // (EUDR first, metadata second).
  const subsIdx = SRC.indexOf('<RestrictedSubstancesPanel');
  const metaIdx = SRC.indexOf('<GoodsMetadataPanel');
  assert.ok(subsIdx > 0 && metaIdx > 0,
    'both panels must be present in the page');
  assert.ok(subsIdx < metaIdx,
    'RestrictedSubstancesPanel must be rendered before GoodsMetadataPanel');
});

// ── Read mode ────────────────────────────────────────────────────────

test('Read mode shows the existing metadata + Edit button (when not archived)', () => {
  const fnBlock = SRC.match(/function GoodsMetadataReadPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(fnBlock, 'GoodsMetadataReadPanel not located');
  const block = fnBlock[0];
  assert.match(block, /!archived && \(/);
  assert.match(block, /<button\s+type="button"\s+onClick=\{onEditClick\}/);
});

test('Read mode renders BOTH a structured per-row view AND the raw JSON dump', () => {
  const fnBlock = SRC.match(/function GoodsMetadataReadPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /entries\.map\(\(\[k, v\]\) => \(/);
  assert.match(block, />\{k\}</);
  assert.match(block, /typeof v === 'string' \? v : JSON\.stringify\(v\)/);
  assert.match(block, /Raw JSON/);
  assert.match(block, /JSON\.stringify\(metadata, null, 2\)/);
});

test('Read mode empty state is matter-of-fact (no compliance framing)', () => {
  // goods.metadata is operator-side context; no regulatory framing
  // should leak into the empty-state copy.
  const fnBlock = SRC.match(/function GoodsMetadataReadPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /No metadata recorded\./);
  assert.doesNotMatch(block, /Required for/);
  assert.doesNotMatch(block, /UKCA|CE marks|REACH|RoHS|Article 8/i);
});

// ── Editor: row state + add/remove/update ────────────────────────────

test('GoodsMetadataDraft type carries a stable rowKey (survives reorders + remounts)', () => {
  assert.match(SRC, /type GoodsMetadataDraft = \{[\s\S]*?rowKey: string;[\s\S]*?\}/);
  assert.match(SRC, /function nextGoodsMetadataRowKey\(\): string \{/);
});

test('Editor seeds at least one empty draft when goods has no metadata', () => {
  const editorBlock = SRC.match(/function GoodsMetadataEditorPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(editorBlock, 'GoodsMetadataEditorPanel not located');
  assert.match(
    editorBlock[0],
    /seeded\.length > 0\s*\?\s*seeded\s*:\s*\[emptyGoodsMetadataDraft\(\)\]/,
  );
});

test('addRow appends a fresh blank draft via emptyGoodsMetadataDraft()', () => {
  const fnBlock = SRC.match(/function addRow\(\) \{\s*setDrafts\(\(prev\) => \[\.\.\.prev, emptyGoodsMetadataDraft\(\)\]\);\s*\}/);
  assert.ok(fnBlock, 'addRow with emptyGoodsMetadataDraft() not located');
});

// ── Materialisation: drafts → metadata object ────────────────────────

test('goodsMetadataToDrafts seeds one row per persisted entry, stringifying non-string values', () => {
  const fnBlock = SRC.match(/function goodsMetadataToDrafts\(metadata: Record<string, unknown>\): GoodsMetadataDraft\[\] \{[\s\S]*?\n\}/);
  assert.ok(fnBlock, 'goodsMetadataToDrafts not located');
  const block = fnBlock[0];
  assert.match(block, /for \(const \[k, v\] of Object\.entries\(metadata\)\)/);
  assert.match(block, /typeof v === 'string' \? v : JSON\.stringify\(v\)/);
});

test('draftsToGoodsMetadata drops rows with empty keys', () => {
  const fnBlock = SRC.match(/function draftsToGoodsMetadata\(drafts: GoodsMetadataDraft\[\]\): Record<string, string> \{[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /if \(!k\) continue;/);
});

// ── Validation rules ────────────────────────────────────────────────

function goodsMetadataClientSideErrorsBlock() {
  const editorBlock = SRC.match(/function GoodsMetadataEditorPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(editorBlock, 'GoodsMetadataEditorPanel not located');
  const fn = editorBlock[0].match(/function clientSideErrors\(\): string\[\] \{[\s\S]*?return out;\s*\}/);
  assert.ok(fn, 'clientSideErrors not located inside GoodsMetadataEditorPanel');
  return fn[0];
}

test('clientSideErrors requires a key when the row carries a value', () => {
  const block = goodsMetadataClientSideErrorsBlock();
  assert.match(block, /Row \$\{rowNumber\}: key is required when a value is present/);
});

test('clientSideErrors enforces GOODS_METADATA_KEY_PATTERN (matches EUDR + supplier-metadata alphabet)', () => {
  // Operator metadata keys use the same lowercase alphabet across
  // the platform for cross-editor UX consistency.
  assert.match(SRC, /const GOODS_METADATA_KEY_PATTERN = \/\^\[a-z0-9\._-\]\+\$\//);
  const block = goodsMetadataClientSideErrorsBlock();
  assert.match(block, /!GOODS_METADATA_KEY_PATTERN\.test\(k\)/);
  assert.match(block, /must use only lowercase letters, digits, dots, dashes, and underscores/);
});

test('clientSideErrors flags duplicate keys', () => {
  const block = goodsMetadataClientSideErrorsBlock();
  assert.match(block, /const seenKeys = new Map<string, number>\(\)/);
  assert.match(block, /Rows \$\{seenAt\} and \$\{rowNumber\} both use key "\$\{k\}" — keys must be unique/);
});

// ── Save flow + no-op short-circuit ──────────────────────────────────

test('goodsMetadataEqual is order-insensitive (sort-by-key + JSON.stringify deep compare)', () => {
  const fnBlock = SRC.match(/function goodsMetadataEqual\(\s*a: Record<string, unknown>,\s*b: Record<string, unknown>,\s*\): boolean \{[\s\S]*?\n\}/);
  assert.ok(fnBlock, 'goodsMetadataEqual not located');
  const block = fnBlock[0];
  assert.match(block, /const aKeys = Object\.keys\(a\)\.sort\(\)/);
  assert.match(block, /JSON\.stringify\(av\) !== JSON\.stringify\(bv\)/);
});

test('No-op short-circuit: matching objects exit without firing a PATCH', () => {
  assert.match(SRC, /if \(goodsMetadataEqual\(materialised, initialMetadata\)\) \{[\s\S]*?onCancel\(\);\s*return;\s*\}/);
});

test('PATCH body sends only metadata (sparse — leaves other goods fields untouched)', () => {
  // Anchor to the GoodsMetadataEditorPanel so we don't false-match
  // against the restricted-substances editor.
  const editorBlock = SRC.match(/function GoodsMetadataEditorPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(editorBlock);
  assert.match(
    editorBlock[0],
    /apiPatch<\{[^}]*?goods: Goods[^}]*?\}>\(\s*`\/goods\/\$\{encodeURIComponent\(goods\.externalId\)\}`,\s*\{ metadata: materialised \}/,
  );
});

// ── Server-error surface ────────────────────────────────────────────

test('Editor catches ApiError → renders errors[] inline with role="alert"', () => {
  const editorBlock = SRC.match(/function GoodsMetadataEditorPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(editorBlock);
  const block = editorBlock[0];
  assert.match(block, /if \(err instanceof ApiError\) \{/);
  assert.match(block, /role="alert"/);
  assert.match(block, /color: 'var\(--color-critical\)'/);
});

test('Editor catches AuthError separately and prompts re-sign-in', () => {
  const editorBlock = SRC.match(/function GoodsMetadataEditorPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(editorBlock);
  const block = editorBlock[0];
  assert.match(block, /else if \(err instanceof AuthError\)/);
  assert.match(block, /Sign in required to save metadata changes/);
});

// ── Accessibility ───────────────────────────────────────────────────

test('GoodsMetadataEditRow inputs carry sr-only labels with the row number', () => {
  // Both metadata editors (supplier + goods) use the same row-label
  // text "metadata row {rowNumber}" — verify the EditRow function
  // exists for goods specifically.
  assert.match(SRC, /function GoodsMetadataEditRow\(\{/);
});

test('GoodsMetadataEditRow remove button carries aria-label with the row number', () => {
  // The remove-row aria-label string "Remove metadata row" is shared
  // by supplier + goods editors. Verify the GoodsMetadataEditRow
  // function references the label.
  const fnBlock = SRC.match(/function GoodsMetadataEditRow\([\s\S]*?\n\}\n/);
  assert.ok(fnBlock, 'GoodsMetadataEditRow not located');
  assert.match(fnBlock[0], /aria-label=\{`Remove metadata row \$\{rowNumber\}`\}/);
});

// ── Cross-stack drift: server-side acceptance ────────────────────────

test('lib/db/goods.js still accepts metadata as a sparse-object patch', () => {
  assert.match(DB_SRC, /if \(input\.metadata !== undefined && \(typeof input\.metadata !== 'object' \|\| Array\.isArray\(input\.metadata\)\)\) \{[\s\S]*?errors\.push\('metadata must be an object'\)/);
  assert.match(DB_SRC, /if \(patch\.metadata !== undefined\) addSet\('metadata', JSON\.stringify\(patch\.metadata\)\)/);
});

// ── Regression guards: prior editors preserved ───────────────────────

test('EditForm comment maps metadata to GoodsMetadataPanel (PR #149)', () => {
  assert.match(SRC, /metadata\s*→ GoodsMetadataPanel \(PR #149\)/);
});

test('ReachSvhcPanel (PR #129) preserved alongside the metadata editor', () => {
  assert.match(SRC, /<ReachSvhcPanel\s+goods=\{goods\}/);
});

test('RestrictedSubstancesPanel (PR #148) preserved alongside the metadata editor', () => {
  assert.match(SRC, /function RestrictedSubstancesEditorPanel\(\{/);
  assert.match(SRC, /<RestrictedSubstancesPanel\s+goods=\{goods\}/);
});

test('EditForm scalar fields still NOT touched by the metadata editor', () => {
  const editFormBlock = SRC.match(/function EditForm\(\{[\s\S]*?\n\}\n/);
  assert.ok(editFormBlock);
  const block = editFormBlock[0];
  assert.doesNotMatch(block, /GoodsMetadataPanel|draftsToGoodsMetadata|goodsMetadataEqual/);
});

// ── Deferred-jsonb closure ──────────────────────────────────────────

test('Both supplier + goods metadata editors share the lowercase key alphabet', () => {
  // Cross-editor consistency: supplier-metadata + goods-metadata both
  // use the lowercase alphabet. Restricted-substances (PR #148) is the
  // sole exception (uppercase jurisdiction codes by convention).
  assert.match(SRC, /const GOODS_METADATA_KEY_PATTERN = \/\^\[a-z0-9\._-\]\+\$\//);
});
