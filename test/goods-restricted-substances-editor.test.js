'use strict';

// Source-level drift-guard tests for the goods.restrictedSubstances
// key/value editor (PR #148). Third object-shape jsonb editor on the
// platform after PR #133 (EUDR) and PR #147 (supplier.metadata).
//
// Restricted substances are per-jurisdiction notes (UK_REACH, EU_RoHS,
// CA_Prop65, etc.) that feed customs declarations + UKCA/CE marking
// documentation — regulator-bearing surface; the read-mode empty state
// surfaces the coverage gap.

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

test('Page renders <RestrictedSubstancesPanel> unconditionally (no length>0 gate)', () => {
  // PR #148 follows PR #129/#133/#147's pattern: panel always renders
  // so operators can ADD the first jurisdiction note to a goods record
  // with none on file.
  assert.match(SRC, /<RestrictedSubstancesPanel\s+goods=\{goods\}/);
  assert.doesNotMatch(
    SRC,
    /goods\.restrictedSubstances && Object\.keys\(goods\.restrictedSubstances\)\.length > 0 && \(\s*<RestrictedSubstancesPanel/,
  );
});

test('Page passes onSaved callback that lifts updated goods to top-level state', () => {
  assert.match(SRC, /<RestrictedSubstancesPanel[\s\S]*?onSaved=\{\(updated\) => setGoods\(updated\)\}/);
});

// ── Read mode ────────────────────────────────────────────────────────

test('Read mode shows the existing substances + Edit button (when not archived)', () => {
  const fnBlock = SRC.match(/function RestrictedSubstancesReadPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(fnBlock, 'RestrictedSubstancesReadPanel not located');
  const block = fnBlock[0];
  assert.match(block, /!archived && \(/);
  assert.match(block, /<button\s+type="button"\s+onClick=\{onEditClick\}/);
});

test('Read mode renders BOTH a structured per-jurisdiction view AND the raw JSON dump', () => {
  const fnBlock = SRC.match(/function RestrictedSubstancesReadPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /entries\.map\(\(\[k, v\]\) => \(/);
  assert.match(block, />\{k\}</);
  assert.match(block, /typeof v === 'string' \? v : JSON\.stringify\(v\)/);
  assert.match(block, /Raw JSON/);
  assert.match(block, /JSON\.stringify\(subs, null, 2\)/);
});

test('Read mode empty state surfaces the customs / UKCA / CE coverage gap', () => {
  // The empty state can't just say "no data" — restricted-substance
  // notes feed customs declarations + UKCA / CE marks. An operator
  // landing here on an empty record needs to understand the
  // implication for downstream paperwork.
  const fnBlock = SRC.match(/function RestrictedSubstancesReadPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /No restricted-substance notes on file/);
  assert.match(block, /UKCA \/ CE marks/);
  assert.match(block, /REACH \/ RoHS jurisdictions/);
});

// ── Editor: row state + add/remove/update ────────────────────────────

test('RestrictedSubstancesDraft type carries a stable rowKey (survives reorders + remounts)', () => {
  assert.match(SRC, /type RestrictedSubstancesDraft = \{[\s\S]*?rowKey: string;[\s\S]*?\}/);
  assert.match(SRC, /function nextRestrictedSubstancesRowKey\(\): string \{/);
});

test('Editor seeds at least one empty draft when goods has no substances', () => {
  const editorBlock = SRC.match(/function RestrictedSubstancesEditorPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(editorBlock, 'RestrictedSubstancesEditorPanel not located');
  assert.match(
    editorBlock[0],
    /seeded\.length > 0\s*\?\s*seeded\s*:\s*\[emptyRestrictedSubstancesDraft\(\)\]/,
  );
});

test('addRow appends a fresh blank draft via emptyRestrictedSubstancesDraft()', () => {
  const fnBlock = SRC.match(/function addRow\(\) \{\s*setDrafts\(\(prev\) => \[\.\.\.prev, emptyRestrictedSubstancesDraft\(\)\]\);\s*\}/);
  assert.ok(fnBlock, 'addRow with emptyRestrictedSubstancesDraft() not located');
});

// ── Materialisation: drafts → substances object ──────────────────────

test('substancesToDrafts seeds one row per persisted jurisdiction, stringifying non-string values', () => {
  const fnBlock = SRC.match(/function substancesToDrafts\(subs: Record<string, unknown>\): RestrictedSubstancesDraft\[\] \{[\s\S]*?\n\}/);
  assert.ok(fnBlock, 'substancesToDrafts not located');
  const block = fnBlock[0];
  assert.match(block, /for \(const \[k, v\] of Object\.entries\(subs\)\)/);
  assert.match(block, /typeof v === 'string' \? v : JSON\.stringify\(v\)/);
});

test('draftsToSubstances drops rows with empty keys (treats add-then-blank as cancellation)', () => {
  const fnBlock = SRC.match(/function draftsToSubstances\(drafts: RestrictedSubstancesDraft\[\]\): Record<string, string> \{[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /if \(!k\) continue;/);
});

// ── Validation rules ────────────────────────────────────────────────

function substancesClientSideErrorsBlock() {
  const editorBlock = SRC.match(/function RestrictedSubstancesEditorPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(editorBlock, 'RestrictedSubstancesEditorPanel not located');
  const fn = editorBlock[0].match(/function clientSideErrors\(\): string\[\] \{[\s\S]*?return out;\s*\}/);
  assert.ok(fn, 'clientSideErrors not located inside RestrictedSubstancesEditorPanel');
  return fn[0];
}

test('clientSideErrors requires a jurisdiction when the row carries a note', () => {
  const block = substancesClientSideErrorsBlock();
  assert.match(block, /Row \$\{rowNumber\}: jurisdiction is required when a note is present/);
});

test('clientSideErrors enforces RESTRICTED_SUBSTANCES_KEY_PATTERN (allows uppercase jurisdiction codes)', () => {
  // Jurisdiction codes are conventionally uppercase (UK_REACH,
  // EU_RoHS, CA_Prop65). The alphabet allows both cases, plus
  // digits/dots/dashes/underscores. Spaces + Unicode still rejected
  // for round-trippability.
  assert.match(SRC, /const RESTRICTED_SUBSTANCES_KEY_PATTERN = \/\^\[A-Za-z0-9\._-\]\+\$\//);
  const block = substancesClientSideErrorsBlock();
  assert.match(block, /!RESTRICTED_SUBSTANCES_KEY_PATTERN\.test\(k\)/);
  assert.match(block, /must use only letters, digits, dots, dashes, and underscores/);
});

test('clientSideErrors flags duplicate jurisdictions', () => {
  const block = substancesClientSideErrorsBlock();
  assert.match(block, /const seenKeys = new Map<string, number>\(\)/);
  assert.match(block, /Rows \$\{seenAt\} and \$\{rowNumber\} both use jurisdiction "\$\{k\}" — jurisdictions must be unique/);
});

// ── Save flow + no-op short-circuit ──────────────────────────────────

test('substancesEqual is order-insensitive (sort-by-key + JSON.stringify deep compare)', () => {
  const fnBlock = SRC.match(/function substancesEqual\(\s*a: Record<string, unknown>,\s*b: Record<string, unknown>,\s*\): boolean \{[\s\S]*?\n\}/);
  assert.ok(fnBlock, 'substancesEqual not located');
  const block = fnBlock[0];
  assert.match(block, /const aKeys = Object\.keys\(a\)\.sort\(\)/);
  assert.match(block, /JSON\.stringify\(av\) !== JSON\.stringify\(bv\)/);
});

test('No-op short-circuit: matching objects exit without firing a PATCH', () => {
  assert.match(SRC, /if \(substancesEqual\(materialised, initialSubs\)\) \{[\s\S]*?onCancel\(\);\s*return;\s*\}/);
});

test('PATCH body sends only restrictedSubstances (sparse — leaves other goods fields untouched)', () => {
  assert.match(
    SRC,
    /apiPatch<\{[^}]*?goods: Goods[^}]*?\}>\(\s*`\/goods\/\$\{encodeURIComponent\(goods\.externalId\)\}`,\s*\{ restrictedSubstances: materialised \}/,
  );
});

// ── Server-error surface ────────────────────────────────────────────

test('Editor catches ApiError → renders errors[] inline with role="alert"', () => {
  const editorBlock = SRC.match(/function RestrictedSubstancesEditorPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(editorBlock);
  const block = editorBlock[0];
  assert.match(block, /if \(err instanceof ApiError\) \{/);
  assert.match(block, /role="alert"/);
  assert.match(block, /color: 'var\(--color-critical\)'/);
});

test('Editor catches AuthError separately and prompts re-sign-in', () => {
  const editorBlock = SRC.match(/function RestrictedSubstancesEditorPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(editorBlock);
  const block = editorBlock[0];
  assert.match(block, /else if \(err instanceof AuthError\)/);
  assert.match(block, /Sign in required to save restricted-substance changes/);
});

// ── Accessibility ───────────────────────────────────────────────────

test('Inputs carry sr-only labels with the row number', () => {
  assert.match(SRC, /<span className="sr-only">Jurisdiction code for restricted-substance row \{rowNumber\}<\/span>/);
  assert.match(SRC, /<span className="sr-only">Notes for restricted-substance row \{rowNumber\}<\/span>/);
});

test('Remove button carries aria-label with the row number', () => {
  assert.match(SRC, /aria-label=\{`Remove restricted-substance row \$\{rowNumber\}`\}/);
});

// ── Cross-stack drift: server-side acceptance ────────────────────────

test('lib/db/goods.js still accepts restrictedSubstances as a sparse-object patch', () => {
  assert.match(DB_SRC, /if \(input\.restrictedSubstances !== undefined && \(typeof input\.restrictedSubstances !== 'object' \|\| Array\.isArray\(input\.restrictedSubstances\)\)\) \{[\s\S]*?errors\.push\('restrictedSubstances must be an object'\)/);
  assert.match(DB_SRC, /if \(patch\.restrictedSubstances !== undefined\) addSet\('restricted_substances', JSON\.stringify\(patch\.restrictedSubstances\)\)/);
});

// ── Regression guards ──────────────────────────────────────────────

test('EditForm comment marks restrictedSubstances as having its own panel (PR #148)', () => {
  const block = SRC.match(/restrictedSubstances\s*→ RestrictedSubstancesPanel \(PR #148\)/);
  assert.ok(block, 'EditForm comment must list restrictedSubstances → RestrictedSubstancesPanel (PR #148)');
});

test('ReachSvhcPanel (PR #129) preserved alongside the restricted-substances editor', () => {
  assert.match(SRC, /<ReachSvhcPanel\s+goods=\{goods\}/);
});

test('EditForm scalar fields still NOT touched by the restricted-substances editor', () => {
  const editFormBlock = SRC.match(/function EditForm\(\{[\s\S]*?\n\}\n/);
  assert.ok(editFormBlock);
  const block = editFormBlock[0];
  assert.doesNotMatch(block, /RestrictedSubstances|draftsToSubstances|substancesEqual/);
});
