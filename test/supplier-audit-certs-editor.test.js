'use strict';

// Source-level drift-guard tests for the supplier audit-certifications
// array editor. Closes more of the deferred-jsonb work from PR #122/
// #123; pattern mirrors PR #129 (goods SVHC editor):
//   - Always-render Panel with read-mode "+ Edit" affordance even
//     when no certs declared
//   - Draft → AuditCert round-trip (drop empty rows; sparse output)
//   - Per-row standard required + date plausibility + expires-after-
//     issued + URL scheme on evidenceUrl
//   - Order-insensitive equality check + no-op short-circuit
//   - Sparse PATCH body shape (only auditCerts sent)
//   - Stable rowKey survives reorders + add/remove

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

test('Page renders <AuditCertsPanel> unconditionally (no length>0 gate)', () => {
  // PR #130 moved the empty-list check inside the panel so operators
  // can ADD the first cert. Previously the panel was hidden when
  // length === 0, which made adding impossible from the UI.
  assert.match(SRC, /<AuditCertsPanel\s+supplier=\{supplier\}/);
  assert.doesNotMatch(
    SRC,
    /supplier\.auditCerts && supplier\.auditCerts\.length > 0 && \(\s*<AuditCertsPanel/,
  );
});

test('Page passes onSaved callback that lifts updated supplier to top-level state', () => {
  assert.match(SRC, /<AuditCertsPanel[\s\S]*?onSaved=\{\(updated\) => setSupplier\(updated\)\}/);
});

// ── Read mode ────────────────────────────────────────────────────────

test('Read mode shows the existing certs + Edit button (when not archived)', () => {
  const fnBlock = SRC.match(/function AuditCertsReadPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(fnBlock, 'AuditCertsReadPanel not located');
  const block = fnBlock[0];
  assert.match(block, /!archived && \(/);
  assert.match(block, /<button\s+type="button"\s+onClick=\{onEditClick\}/);
});

test('Read mode empty state is operator-actionable ("Click Edit to add the first entry")', () => {
  assert.match(SRC, /No audit certifications on file yet/);
  assert.match(SRC, /Click Edit to add the first entry/);
});

test('Read mode preserves the cert-expiry tone signal (PR #123 invariant)', () => {
  // The expiry-tone badge (Valid until / Expires (NNd) / Expired)
  // is the operator's primary glance signal. PR #130 must not lose
  // it during the refactor.
  const fnBlock = SRC.match(/function AuditCertsReadPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /borderColor: certExpiryTone\(c\.expiresAt\)/);
  assert.match(block, /color: certExpiryTone\(c\.expiresAt\)/);
  assert.match(block, /\{certExpiryLabel\(c\.expiresAt\)\}/);
});

// ── Editor: row state + add/remove/update ────────────────────────────

test('AuditCertDraft type carries a stable rowKey (survives reorders + remounts)', () => {
  // React reconciliation needs this — using the array index would
  // remount on insert/delete and lose focus.
  assert.match(SRC, /type AuditCertDraft = \{[\s\S]*?rowKey: string;[\s\S]*?\}/);
  assert.match(SRC, /function nextAuditCertRowKey\(\): string \{/);
});

test('Editor seeds at least one empty draft when supplier has no certs', () => {
  assert.match(
    SRC,
    /initialCerts\.length > 0\s*\?\s*initialCerts\.map\(auditCertToDraft\)\s*:\s*\[emptyAuditCertDraft\(\)\]/,
  );
});

test('addRow appends a fresh blank draft via emptyAuditCertDraft()', () => {
  const fnBlock = SRC.match(/function addRow\(\) \{\s*setDrafts\(\(prev\) => \[\.\.\.prev, emptyAuditCertDraft\(\)\]\);\s*\}/);
  assert.ok(fnBlock, 'addRow not located');
});

test('removeRow filters by rowKey (not index)', () => {
  // Filtering by index would mis-target rows after deletion of a
  // mid-list row (the index shifts). Filter by rowKey instead.
  // (Same invariant as PR #129's SVHC editor.)
  assert.match(SRC, /prev\.filter\(\(d\) => d\.rowKey !== rowKey\)/);
});

// ── Materialisation: drafts → audit certs ────────────────────────────

test('draftToAuditCert drops completely-empty rows (treats add-then-blank as cancellation)', () => {
  const fnBlock = SRC.match(/function draftToAuditCert\(d: AuditCertDraft\): AuditCert \| null \{[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  // Check for the empty-row early return.
  assert.match(block, /if \(!standard && !issuer && !certNumber && !issuedAt && !expiresAt && !evidenceUrl\)/);
  assert.match(block, /return null;/);
});

test('draftToAuditCert emits sparse output (only populated fields)', () => {
  // No empty strings in the persisted jsonb — matches the SVHC
  // editor's sparse-output discipline.
  const fnBlock = SRC.match(/function draftToAuditCert\(d: AuditCertDraft\): AuditCert \| null \{[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  for (const field of ['standard', 'issuer', 'certNumber', 'issuedAt', 'expiresAt', 'evidenceUrl']) {
    assert.match(
      block,
      new RegExp(`if \\(${field}\\) out\\.${field} = ${field};`),
      `Sparse-output discipline missing for "${field}"`,
    );
  }
});

// ── Validation rules ─────────────────────────────────────────────────

test('clientSideErrors requires "standard" on each row (no anonymous certifications)', () => {
  // The certification standard is the audit value — a row carrying
  // only a cert number is not auditable.
  const fnBlock = SRC.match(/function clientSideErrors\(materialised: AuditCert\[\]\): string\[\] \{[\s\S]*?return out;\s*\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /materialised\.forEach\(\(c, i\)/);
  assert.match(block, /const rowNumber = i \+ 1;/);
  assert.match(block, /Row \$\{rowNumber\}: standard is required/);
});

test('clientSideErrors rejects implausible issued / expiry dates', () => {
  const fnBlock = SRC.match(/function clientSideErrors\(materialised: AuditCert\[\]\): string\[\] \{[\s\S]*?return out;\s*\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /issued date is not a valid date/);
  assert.match(block, /expiry date is not a valid date/);
  assert.match(block, /isPlausibleDateInput/);
});

test('clientSideErrors enforces expiry > issued (no zero-day certs)', () => {
  // Temporal sanity. A cert expiring on or before its issue date
  // is a data-entry error.
  const fnBlock = SRC.match(/function clientSideErrors\(materialised: AuditCert\[\]\): string\[\] \{[\s\S]*?return out;\s*\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /expires <= issued/);
  assert.match(block, /expiry date must be after the issued date/);
});

test('clientSideErrors validates evidence URL has a scheme', () => {
  // `new URL(value)` throws on schemeless input — catches the common
  // "www.bsci…" paste error before the server rejects it.
  const fnBlock = SRC.match(/function clientSideErrors\(materialised: AuditCert\[\]\): string\[\] \{[\s\S]*?return out;\s*\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /new URL\(String\(c\.evidenceUrl\)\)/);
  assert.match(block, /evidence URL must include a scheme/);
});

test('isPlausibleDateInput accepts YYYY-MM-DD and Date.parse-recognisable strings', () => {
  // Drift guard reads the helper's body. Pinning the accepted forms
  // matters because the HTML5 <input type="date"> emits YYYY-MM-DD;
  // a more restrictive check would silently reject valid input.
  const fnBlock = SRC.match(/function isPlausibleDateInput\(s: string\): boolean \{[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/);
  assert.match(block, /Date\.parse\(s\)/);
  assert.match(block, /Number\.isFinite\(t\)/);
});

// ── Save flow + no-op short-circuit ──────────────────────────────────

test('auditCertsEqual is order-insensitive (sort-then-compare)', () => {
  // Same logic as PR #129's flagsEqual. Order-only changes don't
  // trigger a PATCH (which would write a noise event to the audit
  // log).
  const fnBlock = SRC.match(/function auditCertsEqual\([\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /\.map\(norm\)\.sort\(\)/);
});

test('No-op short-circuit: matching arrays exit without firing a PATCH', () => {
  assert.match(SRC, /if \(auditCertsEqual\(materialised, initialCerts\)\) \{[\s\S]*?onCancel\(\);\s*return;\s*\}/);
});

test('PATCH body sends only auditCerts (sparse — leaves other supplier fields untouched)', () => {
  // Drift guard: the audit-certs editor must NOT include
  // entityName / hqCountry / sanctions fields in the patch.
  // EditForm (PR #123) owns those.
  assert.match(
    SRC,
    /apiPatch<\{[^}]*?supplier: Supplier[^}]*?\}>\(\s*`\/suppliers\/\$\{encodeURIComponent\(supplier\.externalId\)\}`,\s*\{ auditCerts: materialised \}/,
  );
});

test('Save success calls onSaved with the returned supplier', () => {
  assert.match(SRC, /onSaved\(d\.supplier\);/);
});

// ── Server-error surface (matches PR #122/#123/#124/#129 pattern) ────

test('Editor catches ApiError → renders errors[] inline with role="alert"', () => {
  // Counting all role="alert" + critical-coloured + ApiError catches
  // — the SVHC editor (none on this page) shares the pattern; here
  // the targeted check ensures THIS editor uses it.
  const editorBlock = SRC.match(/function AuditCertsEditorPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(editorBlock);
  const block = editorBlock[0];
  assert.match(block, /if \(err instanceof ApiError\) \{/);
  assert.match(block, /role="alert"/);
  assert.match(block, /color: 'var\(--color-critical\)'/);
});

test('Editor catches AuthError separately and prompts re-sign-in', () => {
  const editorBlock = SRC.match(/function AuditCertsEditorPanel\([\s\S]*?(?=\nfunction )/);
  assert.ok(editorBlock);
  const block = editorBlock[0];
  assert.match(block, /else if \(err instanceof AuthError\)/);
  assert.match(block, /Sign in required to save audit cert changes/);
});

// ── Disabled-state during save (race protection) ─────────────────────

test('AuditCertEditRow inputs + remove button disabled while saving', () => {
  // 6 input fields + remove button × 1 row = 7 expected disabled
  // bindings inside the row component. Counted across the whole
  // source so non-greedy regex bounds don't matter.
  const matches = SRC.match(/disabled=\{disabled\}/g) || [];
  // PR #129 added 4 disabled={disabled} bindings inside SvhcEditRow
  // on goods (different page); on THIS page (suppliers) the count
  // is the audit-cert editor's 7 bindings (6 fields + remove).
  assert.ok(matches.length >= 7,
    `Expected ≥7 disabled={disabled} bindings (6 AuditCertField + remove), got ${matches.length}`);
});

test('Add + Save + Cancel buttons all carry disabled={saving}', () => {
  // 3 buttons in the audit-cert editor PLUS the existing EditForm
  // buttons from PR #123 (2 more). Allow ≥5.
  const matches = SRC.match(/disabled=\{saving\}/g) || [];
  assert.ok(matches.length >= 5,
    `Expected ≥5 disabled={saving} bindings, got ${matches.length}`);
});

// ── Accessibility ───────────────────────────────────────────────────

test('Remove button carries aria-label with the row number', () => {
  assert.match(SRC, /aria-label=\{`Remove certification row \$\{rowNumber\}`\}/);
});

test('Date inputs use type="date" so the native picker fires', () => {
  // Issued + Expires are both <input type="date"> — operators get
  // the OS-native date picker AND the input emits YYYY-MM-DD which
  // matches isPlausibleDateInput's preferred format.
  const fieldBlock = SRC.match(/function AuditCertField\([\s\S]*?(?=\n\}|\n\nfunction )/);
  // Pin the type prop's default + presence in the input.
  assert.match(SRC, /type=\{type \|\| 'text'\}/);
  // The two date-field call sites must use type="date".
  assert.match(SRC, /label="Issued"[\s\S]*?type="date"/);
  assert.match(SRC, /label="Expires"[\s\S]*?type="date"/);
});

// ── Cross-stack drift: server-side acceptance ────────────────────────

test('lib/db/suppliers.js still accepts auditCerts as a sparse-array patch', () => {
  assert.match(DB_SRC, /if \(input\.auditCerts !== undefined && !Array\.isArray\(input\.auditCerts\)\) errors\.push\('auditCerts must be an array'\)/);
  assert.match(DB_SRC, /if \(patch\.auditCerts !== undefined\) addSet\('audit_certs', JSON\.stringify\(patch\.auditCerts\)\)/);
});

// ── Regression guards ──────────────────────────────────────────────

test('EditForm scalar fields still NOT touched by the audit-certs editor (PR #123 boundary preserved)', () => {
  const editFormBlock = SRC.match(/function EditForm\(\{[\s\S]*?\n\}\n/);
  assert.ok(editFormBlock);
  const block = editFormBlock[0];
  assert.doesNotMatch(block, /auditCerts|certNumber|certExpiry/i);
});

test('FactoryLocationsPanel is now editable (PR #131 shipped — drift guard against accidental rollback)', () => {
  // PR #130 deferred this; PR #131 shipped it. Drift guard against
  // a future refactor accidentally collapsing the editor back to a
  // read-only panel.
  assert.match(SRC, /function FactoryLocationsPanel\(\{\s*supplier,\s*onSaved,/);
  assert.match(SRC, /function FactoryLocationsEditorPanel/);
});

test('EudrPanel still renders read-only (deferred)', () => {
  assert.match(SRC, /function EudrPanel\(\{ supplier \}: \{ supplier: Supplier \}\)/);
});

test('SanctionsPanel re-screen flow preserved (PR #124 regression guard)', () => {
  // The PR #124 re-screen flow must not regress through this PR's
  // touches in the same file.
  assert.match(SRC, /async function runRescreen\(\)/);
  assert.match(SRC, /apiPost<\{[\s\S]*?supplier: Supplier[\s\S]*?\}>\(\s*`\/suppliers\/\$\{encodeURIComponent\(supplier\.externalId\)\}\/screen`/);
});
