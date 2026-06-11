'use strict';

// Source-level drift-guard tests for the inline edit-mode form on
// the Goods detail page. Pattern mirrors test/transition-history-
// component.test.js (PR #108) / test/wizard-*-tier-a-pill.test.js
// (PR #98 onward).
//
// Why source-level: the form runs in the browser. Without a full
// React test runner we pin the shape via the .tsx source — every
// editable field appears, validation rules match the data layer,
// PATCH uses the right URL, ApiError validation surfaces inline.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'goods', '[externalId]', 'page.tsx');
const SRC = fs.readFileSync(PAGE_PATH, 'utf8');

// ── Edit-mode wiring ─────────────────────────────────────────────────

test('GoodsDetailPage carries an editing state toggle', () => {
  assert.match(SRC, /const \[editing, setEditing\] = useState\(false\)/);
});

test('Header receives editing + onEdit props and renders an "Edit" button when applicable', () => {
  // The button is conditional on !editing AND !archivedAt — archived
  // records shouldn't expose mutation affordances.
  assert.match(SRC, /!editing && !goods\.archivedAt && \(/);
  assert.match(SRC, /<button\s+type="button"\s+onClick=\{onEdit\}/);
});

test('Page renders EditForm when editing===true, FactsGrid otherwise', () => {
  // The JSX ternary is the canonical "swap component" pattern.
  assert.match(SRC, /editing \? \(\s*<EditForm/);
  assert.match(SRC, /\) : \(\s*<FactsGrid goods=\{goods\} \/>/);
});

// ── EditForm contract ────────────────────────────────────────────────

test('EditForm imports apiPatch + ApiError from @/lib/api', () => {
  assert.match(SRC, /import \{[\s\S]*?apiPatch,[\s\S]*?ApiError,[\s\S]*?\} from '@\/lib\/api';/);
});

test('EditForm PATCHes /goods/<encoded-externalId>', () => {
  assert.match(
    SRC,
    /apiPatch<\{[^}]*?goods: Goods[^}]*?\}>\(\s*`\/goods\/\$\{encodeURIComponent\(goods\.externalId\)\}`/,
  );
});

test('EditForm calls onSaved with the returned goods record and the parent flips editing off', () => {
  // The page wires onSaved=(updated)=>{ setGoods(updated); setEditing(false); }
  // so the audit timeline below re-reads naturally on its next render.
  assert.match(SRC, /onSaved=\{[\s\S]*?setGoods\(updated\)[\s\S]*?setEditing\(false\)[\s\S]*?\}\}/);
});

// ── Editable fields enumerated ───────────────────────────────────────

test('EditForm exposes exactly the scalar fields (displayName, hsCode, originCountry, typicalUnitValueEur, cbamInScope)', () => {
  // Each is a useState in the form body. Pinning all five guards
  // against accidental field drops in a future refactor.
  assert.match(SRC, /const \[displayName, setDisplayName\] = useState\(goods\.displayName\)/);
  assert.match(SRC, /const \[hsCode, setHsCode\] = useState\(goods\.hsCode\)/);
  assert.match(SRC, /const \[originCountry, setOriginCountry\] = useState\(goods\.originCountry \|\| ''\)/);
  assert.match(SRC, /const \[typicalUnitValueEur, setTypicalUnitValueEur\] = useState\(initialEur\)/);
  assert.match(SRC, /const \[cbamInScope, setCbamInScope\] = useState\(goods\.cbamInScope\)/);
});

test('EditForm does NOT edit the immutable SKU or the complex jsonb fields (deferred)', () => {
  // SKU is immutable post-create; the form must not surface it as
  // an editable field. The jsonb fields (reachSvhcFlags,
  // restrictedSubstances, metadata) are deferred to a follow-up PR
  // — they need structured editors that aren't worth the surface
  // area here. Drift guard: no useState for any of them inside the
  // form.
  const formBlock = SRC.match(/function EditForm\(\{[\s\S]*?\n\}/);
  assert.ok(formBlock, 'EditForm function block not located');
  const block = formBlock[0];
  assert.doesNotMatch(block, /useState\([^)]*?goods\.sku/);
  assert.doesNotMatch(block, /useState\([^)]*?goods\.reachSvhcFlags/);
  assert.doesNotMatch(block, /useState\([^)]*?goods\.restrictedSubstances/);
  assert.doesNotMatch(block, /useState\([^)]*?goods\.metadata/);
});

// ── Client-side validation matches lib/db/goods.js validateForUpdate ─

test('client-side validation enforces the same rules as lib/db/goods.js validateForUpdate', () => {
  const formBlock = SRC.match(/function clientSideErrors\(\)[\s\S]*?return out;\s*\}/);
  assert.ok(formBlock, 'clientSideErrors fn not located');
  const block = formBlock[0];
  // displayName non-empty (matches "must be a non-empty string")
  assert.match(block, /displayName must be a non-empty string/);
  // displayName ≤200 chars (matches data-layer cap)
  assert.match(block, /displayName must be ≤200 chars/);
  // hsCode 6-10 digits
  assert.match(block, /hsCode must be 6-10 digits/);
  assert.match(block, /\^\\d\{6,10\}\$/);
  // ISO-2 uppercase
  assert.match(block, /originCountry must be ISO-2 uppercase/);
  assert.match(block, /\^\[A-Z\]\{2\}\$/);
  // typicalUnitValueCents non-negative integer
  assert.match(block, /typicalUnitValueCents must be a non-negative integer/);
});

// ── Sparse-patch discipline ──────────────────────────────────────────

test('EditForm builds a SPARSE patch — only fields that actually changed are sent', () => {
  // This both shrinks the payload AND lets the server compute a
  // tight audit-log diff. Drift guard: each field's inclusion is
  // gated by an equality check against the loaded goods record.
  assert.match(SRC, /if \(displayName !== goods\.displayName\) patch\.displayName/);
  assert.match(SRC, /if \(hsCode !== goods\.hsCode\) patch\.hsCode/);
  // originCountry compares the uppercased trimmed value against the
  // current value (also uppercased) so case-only edits don't fire.
  assert.match(SRC, /const ocNorm = originCountry\.trim\(\)\.toUpperCase\(\)/);
  assert.match(SRC, /const ocCurrent = \(goods\.originCountry \|\| ''\)\.toUpperCase\(\)/);
  assert.match(SRC, /if \(ocNorm !== ocCurrent\) patch\.originCountry = ocNorm \|\| null/);
  // typicalUnitValueCents: euro → cents conversion at the boundary
  assert.match(SRC, /Math\.round\(Number\(typicalUnitValueEur\) \* 100\)/);
  // cbamInScope diff
  assert.match(SRC, /if \(cbamInScope !== goods\.cbamInScope\) patch\.cbamInScope/);
});

test('EditForm short-circuits the no-change save (no patch keys → exit edit mode without API call)', () => {
  // Matches the handler's own no-op: lib/db/goods.js returns
  // { ok: true, unchanged: true } when setClauses is empty. The
  // client mirrors that — exits edit mode without firing a network
  // request, which is faster AND avoids a noise event in the audit
  // log.
  assert.match(SRC, /if \(Object\.keys\(patch\)\.length === 0\) \{/);
});

// ── Server-side errors surface inline ────────────────────────────────

test('EditForm catches ApiError and renders the errors[] inline as critical-coloured items', () => {
  assert.match(SRC, /if \(err instanceof ApiError\) \{/);
  assert.match(SRC, /setErrors\(err\.errors\.length \? err\.errors : \[err\.message\]\)/);
  // Render path: a <ul> with role="alert" and each error in
  // var(--color-critical). Reading "errors" via .map and styling
  // through the brand variable matches the brand-only discipline
  // from the wizard pills.
  assert.match(SRC, /role="alert"/);
  assert.match(SRC, /color: 'var\(--color-critical\)'/);
});

test('EditForm catches AuthError separately and prompts re-sign-in', () => {
  assert.match(SRC, /else if \(err instanceof AuthError\)/);
  assert.match(SRC, /Sign in required to save changes\./);
});

// ── Save/Cancel actions ──────────────────────────────────────────────

test('EditForm renders Save + Cancel actions; Save is disabled while saving', () => {
  const formBlock = SRC.match(/function EditForm\(\{[\s\S]*?\n\}\n/);
  assert.ok(formBlock);
  const block = formBlock[0];
  assert.match(block, /Save changes/);
  assert.match(block, /Cancel/);
  assert.match(block, /disabled=\{saving\}/);
  assert.match(block, /\{saving \? 'Saving…' : 'Save changes'\}/);
});

// ── Cross-stack drift: client validation rules trace lib/db/goods.js ─

test('the four client-validated error messages exist verbatim in lib/db/goods.js validateForUpdate', () => {
  // Pin the wording cross-stack so a server-side message change
  // doesn't silently desync from the client-side preview.
  const dbSrc = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'goods.js'), 'utf8');
  for (const msg of [
    'displayName must be a non-empty string',
    'displayName must be ≤200 chars',
    'hsCode must be 6-10 digits',
    'originCountry must be ISO-2 uppercase',
    'typicalUnitValueCents must be a non-negative integer',
  ]) {
    assert.ok(dbSrc.includes(msg), `lib/db/goods.js validateForUpdate must emit "${msg}" (client preview drift guard)`);
  }
});
