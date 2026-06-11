'use strict';

// Source-level drift-guard tests for the inline edit-mode form on
// the Supplier detail page. Parallel to test/goods-edit-form.test.js
// (PR #122). Closes the read-only gap on the second SoR entity.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'suppliers', '[externalId]', 'page.tsx');
const API_PATH = path.join(ROOT, 'app-shell', 'lib', 'api.ts');
const DB_PATH = path.join(ROOT, 'lib', 'db', 'suppliers.js');
const SRC = fs.readFileSync(PAGE_PATH, 'utf8');
const API_SRC = fs.readFileSync(API_PATH, 'utf8');
const DB_SRC = fs.readFileSync(DB_PATH, 'utf8');

// ── Edit-mode wiring ─────────────────────────────────────────────────

test('SupplierDetailPage carries an editing state toggle', () => {
  assert.match(SRC, /const \[editing, setEditing\] = useState\(false\)/);
});

test('Header receives editing + onEdit props and renders an "Edit" button when applicable', () => {
  // The button is conditional on !editing AND !archivedAt — archived
  // records shouldn't expose mutation affordances, mirrors PR #122.
  assert.match(SRC, /!editing && !supplier\.archivedAt && \(/);
  assert.match(SRC, /<button\s+type="button"\s+onClick=\{onEdit\}/);
});

test('Page renders EditForm when editing===true, FactsGrid otherwise', () => {
  assert.match(SRC, /editing \? \(\s*<EditForm/);
  assert.match(SRC, /\) : \(\s*<FactsGrid supplier=\{supplier\} \/>/);
});

// ── EditForm contract ────────────────────────────────────────────────

test('EditForm imports apiPatch + ApiError + SUPPLIER_LEGAL_FORMS from @/lib/api', () => {
  assert.match(SRC, /import \{[\s\S]*?apiPatch,[\s\S]*?ApiError,[\s\S]*?SUPPLIER_LEGAL_FORMS,[\s\S]*?\} from '@\/lib\/api';/);
});

test('EditForm PATCHes /suppliers/<encoded-externalId>', () => {
  assert.match(
    SRC,
    /apiPatch<\{[^}]*?supplier: Supplier[^}]*?\}>\(\s*`\/suppliers\/\$\{encodeURIComponent\(supplier\.externalId\)\}`/,
  );
});

test('EditForm calls onSaved with the returned supplier record and the parent flips editing off', () => {
  assert.match(SRC, /onSaved=\{[\s\S]*?setSupplier\(updated\)[\s\S]*?setEditing\(false\)[\s\S]*?\}\}/);
});

// ── Editable fields enumerated ───────────────────────────────────────

test('EditForm exposes exactly the scalar identifying fields', () => {
  // Six scalar fields. legalForm uses the closed taxonomy from
  // SUPPLIER_LEGAL_FORMS via a <select>; the rest are text inputs.
  assert.match(SRC, /const \[entityName, setEntityName\] = useState\(supplier\.entityName\)/);
  assert.match(SRC, /const \[legalForm, setLegalForm\] = useState\(supplier\.legalForm \|\| ''\)/);
  assert.match(SRC, /const \[hqCountry, setHqCountry\] = useState\(supplier\.hqCountry\)/);
  assert.match(SRC, /const \[registrationNumber, setRegistrationNumber\] = useState\(supplier\.registrationNumber \|\| ''\)/);
  assert.match(SRC, /const \[registrationAuthority, setRegistrationAuthority\] = useState\(supplier\.registrationAuthority \|\| ''\)/);
  assert.match(SRC, /const \[website, setWebsite\] = useState\(supplier\.website \|\| ''\)/);
});

test('EditForm does NOT edit sanctions / trust / jsonb / PII fields (each has its own flow)', () => {
  // Sanctions surfaces have a separate re-screen flow (next pick).
  // Trust score is calculator-grounded per ADR 0002 — never hand-edited.
  // jsonb (factoryLocations, auditCerts, eudrDdsEvidence, metadata) need
  // structured editors, deferred. primaryContactEmailHash is PII.
  const formBlock = SRC.match(/function EditForm\(\{[\s\S]*?\n\}\n/);
  assert.ok(formBlock, 'EditForm function block not located');
  const block = formBlock[0];
  // None of these may appear as useState bindings in the form.
  assert.doesNotMatch(block, /useState\([^)]*?supplier\.sanctionsLastStatus/);
  assert.doesNotMatch(block, /useState\([^)]*?supplier\.sanctionsLastScreenedAt/);
  assert.doesNotMatch(block, /useState\([^)]*?supplier\.trustScore[^A-Za-z]/);
  assert.doesNotMatch(block, /useState\([^)]*?supplier\.factoryLocations/);
  assert.doesNotMatch(block, /useState\([^)]*?supplier\.auditCerts/);
  assert.doesNotMatch(block, /useState\([^)]*?supplier\.eudrDdsEvidence/);
  assert.doesNotMatch(block, /useState\([^)]*?supplier\.metadata/);
  assert.doesNotMatch(block, /useState\([^)]*?supplier\.primaryContactEmailHash/);
});

// ── Client-side validation matches lib/db/suppliers.js ───────────────

test('client-side validation enforces the rules from lib/db/suppliers.js validateForUpdate', () => {
  const fnBlock = SRC.match(/function clientSideErrors\(\)[\s\S]*?return out;\s*\}/);
  assert.ok(fnBlock, 'clientSideErrors fn not located');
  const block = fnBlock[0];
  assert.match(block, /entityName must be a non-empty string/);
  assert.match(block, /entityName must be ≤200 chars/);
  assert.match(block, /hqCountry must be ISO-2 uppercase/);
  // legalForm: checked against SUPPLIER_LEGAL_FORMS closed taxonomy.
  assert.match(block, /SUPPLIER_LEGAL_FORMS\.includes\(legalForm\)/);
  assert.match(block, /legalForm must be one of:/);
});

// ── Sparse-patch discipline ──────────────────────────────────────────

test('EditForm builds a SPARSE patch — only fields that actually changed are sent', () => {
  // Mirrors the goods edit form's discipline + the no-op short-
  // circuit. Each field gated by an equality check against the
  // loaded supplier record.
  assert.match(SRC, /if \(entityTrim !== supplier\.entityName\) patch\.entityName/);
  assert.match(SRC, /if \(legalForm !== lfCurrent\) patch\.legalForm = legalForm \|\| null/);
  assert.match(SRC, /const hqNorm = hqCountry\.trim\(\)\.toUpperCase\(\)/);
  assert.match(SRC, /if \(hqNorm !== supplier\.hqCountry\) patch\.hqCountry = hqNorm/);
  // Blank-string-clears: registration{Number,Authority} and website
  // each send null when cleared.
  assert.match(SRC, /patch\.registrationNumber = registrationNumber\.trim\(\) \|\| null/);
  assert.match(SRC, /patch\.registrationAuthority = registrationAuthority\.trim\(\) \|\| null/);
  assert.match(SRC, /patch\.website = website\.trim\(\) \|\| null/);
});

test('EditForm short-circuits the no-change save (no patch keys → exit edit mode without API call)', () => {
  assert.match(SRC, /if \(Object\.keys\(patch\)\.length === 0\) \{/);
});

// ── Server-side errors surface inline ────────────────────────────────

test('EditForm catches ApiError and renders the errors[] inline as critical-coloured items', () => {
  assert.match(SRC, /if \(err instanceof ApiError\) \{/);
  assert.match(SRC, /setErrors\(err\.errors\.length \? err\.errors : \[err\.message\]\)/);
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

// ── Cross-stack drift: SUPPLIER_LEGAL_FORMS mirrors lib/db/suppliers
//                       LEGAL_FORMS exactly ─────────────────────────

test('SUPPLIER_LEGAL_FORMS in api.ts mirrors LEGAL_FORMS in lib/db/suppliers.js (both directions)', () => {
  // Each direction. Drift here would silently let an operator pick
  // a legalForm the database rejects (or worse, validate against an
  // outdated closed set).
  const tsBlock = API_SRC.match(/SUPPLIER_LEGAL_FORMS:[\s\S]*?Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert.ok(tsBlock, 'SUPPLIER_LEGAL_FORMS export not located in api.ts');
  const tsValues = (tsBlock[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();

  const dbBlock = DB_SRC.match(/LEGAL_FORMS = Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert.ok(dbBlock, 'LEGAL_FORMS not located in lib/db/suppliers.js');
  const dbValues = (dbBlock[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();

  assert.deepEqual(
    tsValues,
    dbValues,
    `Cross-stack drift: api.ts SUPPLIER_LEGAL_FORMS=${JSON.stringify(tsValues)} vs lib/db/suppliers.js LEGAL_FORMS=${JSON.stringify(dbValues)}`,
  );
});

// ── Cross-stack drift: client validation messages match server ───────

test('the three client-validated error messages exist verbatim in lib/db/suppliers.js validateForUpdate', () => {
  // Mirror of the same drift guard in PR #122's goods-edit-form
  // test. Wording drift breaks the in-form preview silently.
  for (const msg of [
    'entityName must be a non-empty string',
    'entityName must be ≤200 chars',
    'hqCountry must be ISO-2 uppercase',
  ]) {
    assert.ok(DB_SRC.includes(msg), `lib/db/suppliers.js validateForUpdate must emit "${msg}" (client preview drift guard)`);
  }
  // legalForm message is interpolated — pin the prefix only.
  assert.match(DB_SRC, /legalForm must be one of: \$\{LEGAL_FORMS\.join\(', '\)\}/);
});
