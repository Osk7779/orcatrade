'use strict';

// Sprint 34 — CSV export of the imports list.
//
// Tests cover three layers:
//   1. csvEscape pure function: empty/null pass through as ''; quotes
//      doubled; embedded newlines preserved inside quoted fields
//      (RFC-4180); special chars (comma, newline, quote) all safe
//   2. Handler wiring: /api/imports/export.csv routes to handleExportCsv;
//      method gate (GET-only); response headers (Content-Type,
//      Content-Disposition with date-stamped filename, no-store
//      Cache-Control); UTF-8 BOM at top; CRLF line separator;
//      header row + per-row body; filter passthrough (status,
//      declineReason, supplierPick, q, mine); 5000-row cap
//   3. UI: "Export CSV" link on /imports list when state==='ready'
//      AND requests.length > 0; href passes through every active
//      filter; mine=1 dropped in cohort mode; title attribute
//      explains UTF-8 + RFC-4180
//
// The XSS vector here is CSV-injection — a field starting with =,
// +, -, @ would be interpreted as a formula by Excel. The
// quote-wrapping is partial defense; a future PR can add a `'`
// prefix for those four chars but the drift-guard test below
// pins the field-by-field column shape so a regression surfaces.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');
const LIST_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'page.tsx'),
  'utf8',
);

// Extract csvEscape implementation from the handler source so we can
// exercise it without spinning up the whole handler. Same approach as
// some of the earlier source-pinned tests.
function loadCsvEscape() {
  const block = HANDLER_SRC.match(/function csvEscape\(value\)[\s\S]*?\n\}/);
  if (!block) throw new Error('csvEscape body not located');
  // eslint-disable-next-line no-new-func
  return new Function(`${block[0]}; return csvEscape;`)();
}

// ── csvEscape pure function ────────────────────────────────────────

test('csvEscape returns "" for null + undefined + empty string', () => {
  const fn = loadCsvEscape();
  assert.equal(fn(null), '');
  assert.equal(fn(undefined), '');
  assert.equal(fn(''), '');
});

test('csvEscape wraps every non-empty value in double-quotes (defensive — fields might become unsafe)', () => {
  // Defensive quoting: even a safe-today value like "Vietnam" gets
  // wrapped so a future addition of a comma-bearing field doesn't
  // silently break the column shape.
  const fn = loadCsvEscape();
  assert.equal(fn('Vietnam'), '"Vietnam"');
  assert.equal(fn('a,b'), '"a,b"');
});

test('csvEscape doubles embedded double-quotes (RFC-4180)', () => {
  const fn = loadCsvEscape();
  assert.equal(fn('she said "hi"'), '"she said ""hi"""');
});

test('csvEscape preserves embedded newlines inside the quoted field', () => {
  // RFC-4180 allows newlines inside quoted fields; the CSV parser
  // sees them as part of the same logical row.
  const fn = loadCsvEscape();
  assert.equal(fn('line 1\nline 2'), '"line 1\nline 2"');
});

test('csvEscape coerces non-string inputs via String() — never crashes', () => {
  const fn = loadCsvEscape();
  assert.equal(fn(42), '"42"');
  assert.equal(fn(true), '"true"');
  assert.equal(fn({ a: 1 }), '"[object Object]"');
});

// ── EXPORT_COLUMNS shape ──────────────────────────────────────────

test('EXPORT_COLUMNS covers every load-bearing field (status + label + landed + supplier pick + rating)', () => {
  const block = HANDLER_SRC.match(/const EXPORT_COLUMNS = Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert.ok(block, 'EXPORT_COLUMNS not located');
  const body = block[1];
  for (const col of [
    'External ID',
    'Status',
    'Label',
    'Landed total',
    'Decline reason',
    'Supplier pick country',
    'Customer rating',
  ]) {
    assert.match(body, new RegExp(`['"]${col.replace(/[()]/g, '\\$&')}`), `EXPORT_COLUMNS missing: ${col}`);
  }
});

test('exportRowFor renders monetary fields as 2-decimal EUR strings (cents → EUR conversion)', () => {
  // Sprint 30/15 ADR-0004 boundary discipline — money fields in
  // cents go through /100 + toFixed(2) so the CSV reads as
  // "8782.50" not "878250".
  const block = HANDLER_SRC.match(/function exportRowFor\(r\)[\s\S]*?return \[/);
  assert.ok(block);
  // landed and unit price both apply /100 + toFixed(2).
  assert.match(block[0], /Number\(r\.landedQuote\.totalLandedCents\) \/ 100\)\.toFixed\(2\)/);
  assert.match(block[0], /Number\(r\.targetUnitPriceCents\) \/ 100\)\.toFixed\(2\)/);
});

// ── Handler routing + headers ────────────────────────────────────

test('imports handler routes /api/imports/export.csv → handleExportCsv', () => {
  assert.match(HANDLER_SRC, /externalId === ['"]export\.csv['"]/);
  assert.match(HANDLER_SRC, /handleExportCsv\(req, res, ctx\)/);
  assert.match(HANDLER_SRC, /async function handleExportCsv\(/);
});

test('handleExportCsv is GET-only — every other method 405s', () => {
  // The export is a read; pinning the method gate.
  assert.match(
    HANDLER_SRC,
    /if \(req\.method !== ['"]GET['"]\) return jsonResponse\(res, 405, \{ error: ['"]export\.csv requires GET['"]/,
  );
});

test('handleExportCsv response carries the right Content-Type + Disposition + Cache-Control headers', () => {
  const block = HANDLER_SRC.match(/async function handleExportCsv\([\s\S]*?\n\}/);
  assert.ok(block, 'handleExportCsv body not located');
  const body = block[0];
  // RFC-4180 / Excel-compatible: text/csv with explicit utf-8 charset
  // so Excel doesn't fall back to Windows-1252.
  assert.match(body, /Content-Type['"], ['"]text\/csv; charset=utf-8['"]/);
  // attachment + filename forces a browser download (NOT a tab
  // preview, which would mangle a CSV).
  assert.match(body, /Content-Disposition['"], `attachment; filename="\$\{filename\}"`/);
  assert.match(body, /Cache-Control['"], ['"]no-store['"]/);
});

test('handleExportCsv prepends the UTF-8 BOM (Excel diacritic guard)', () => {
  // Without the BOM, Excel opens UTF-8 CSV as Windows-1252 and
  // garbles Vietnamese / Polish / German diacritics. This bit us
  // on the partner brief earlier in the program.
  const block = HANDLER_SRC.match(/async function handleExportCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  // The BOM character (U+FEFF) is concatenated to the first line.
  assert.match(block[0], /['"]﻿['"]\s*\+\s*EXPORT_COLUMNS/);
});

test('handleExportCsv uses CRLF (RFC-4180) as the row terminator', () => {
  const block = HANDLER_SRC.match(/async function handleExportCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  // The lines.join('\r\n') sequence is what RFC-4180 mandates.
  assert.match(block[0], /lines\.join\(['"]\\r\\n['"]\)/);
});

test('handleExportCsv passes through every filter handleList accepts (status, declineReason, supplierPick, q, mine)', () => {
  // The export must mirror exactly the filtered view. Drift-guard
  // pins every filter the list endpoint accepts.
  const block = HANDLER_SRC.match(/async function handleExportCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  for (const field of [
    'status:',
    'declineReason:',
    'supplierPickCountry:',
    'q:',
    'createdByEmailHash:',
  ]) {
    assert.match(body, new RegExp(field.replace(/[*+?^${}()|[\]\\]/g, '\\$&')), `filter missing from passthrough: ${field}`);
  }
});

test('handleExportCsv caps the row count at 5000 (export ceiling)', () => {
  // 5000 keeps in-memory generation well under 50MB even with large
  // product descriptions. Sprint 34 documents this as "well above
  // ops' daily working set; future streaming for 50k+ is a follow-up."
  const block = HANDLER_SRC.match(/async function handleExportCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /limit: 5000/);
});

test('handleExportCsv maps validation errors to 400 (not 500)', () => {
  // Reuses the listImportRequestsForOrg error taxonomy.
  const block = HANDLER_SRC.match(/async function handleExportCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /supplierPickCountry must be|status must be|declineReason must be/);
  assert.match(block[0], /jsonResponse\(res, 400/);
});

// ── UI ─────────────────────────────────────────────────────────────

test('/imports list renders "Export CSV" link ONLY when state==="ready" AND requests.length > 0', () => {
  // Nothing to export = no button. Pin the conditional.
  assert.match(LIST_TSX, /state === ['"]ready['"] && requests\.length > 0/);
  assert.match(LIST_TSX, /Export CSV/);
});

test('/imports Export CSV link href passes through every active filter', () => {
  // The whole point of the export is "what I see is what I get."
  // Pin each filter set call in the href IIFE.
  const block = LIST_TSX.match(/href=\{\(\(\) => \{[\s\S]*?return qs[\s\S]*?\}\)\(\)\}/);
  assert.ok(block, 'Export CSV href builder not located');
  const body = block[0];
  for (const param of ['status', 'declineReason', 'supplierPick', 'q']) {
    assert.match(body, new RegExp(`params\\.set\\(['"]${param}['"]`));
  }
});

test('/imports Export CSV drops mine=1 in cohort mode (parity with handleList behaviour)', () => {
  // The list useEffect drops mine=1 when cohortReason || supplierPick;
  // the export must match so the CSV row set equals the rendered rows.
  const block = LIST_TSX.match(/href=\{\(\(\) => \{[\s\S]*?return qs[\s\S]*?\}\)\(\)\}/);
  assert.ok(block);
  assert.match(block[0], /if \(!cohortReason && !supplierPick\) params\.set\(['"]mine['"], ['"]1['"]\)/);
});

test('/imports Export CSV link surfaces a title explaining the format + scope', () => {
  // The actionable hover hint: format (UTF-8, RFC-4180) tells ops
  // the file opens cleanly in Excel + Numbers. Pin both pieces.
  assert.match(LIST_TSX, /title="Download CSV of the current view \(UTF-8, RFC-4180\)"/);
});
