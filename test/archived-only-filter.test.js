'use strict';

// Sprint 103 — archivedOnly becomes a server-side cut.
//
// THE BUG IT FIXES: the sprint-76 archived view filtered
// client-side over includeArchived — but the server LIMIT (200)
// applied BEFORE the client cut, so an org with 200+ live rows
// could see an EMPTY archived view while archived rows existed.
// The limit ate them. And the CSV export honestly hid in that
// view because the server taxonomy couldn't express the cut.
//
// The fix: archivedOnly in the data layer (wins over
// includeArchived), mapped in BOTH the list and the export
// handlers (the CSV mirrors the view exactly — the sprint-34
// contract), the page fetches the server cut, and the export
// link works in both views.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');
const LIST_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'page.tsx'),
  'utf8',
);

test('data layer: archivedOnly WINS over includeArchived; the default stays live-only', () => {
  const block = DB_SRC.match(/async function listImportRequestsForOrg\([\s\S]*?\n\}/);
  assert.ok(block, 'list reader not found');
  const body = block[0];
  assert.match(
    body,
    /if \(archivedOnly\) where\.push\('archived_at IS NOT NULL'\);\s*\n\s*else if \(!includeArchived\) where\.push\('archived_at IS NULL'\);/,
  );
  // The scale-bug rationale is on the record at the decision site.
  assert.match(body, /wrong at scale/);
});

test('BOTH handlers map the param — the CSV mirrors the view exactly (sprint-34 contract preserved)', () => {
  const mappings = HANDLER_SRC.match(/archivedOnly: q\.archivedOnly === '1' \|\| q\.archivedOnly === 'true',/g) || [];
  assert.equal(mappings.length, 2, 'list AND export.csv must both map archivedOnly');
});

test('the page fetches the server cut and the export link carries it', () => {
  assert.match(LIST_TSX, /if \(showArchived\) params\.set\('archivedOnly', '1'\);/);
  // Twice: once in the data fetch, once in the export href builder.
  const uses = LIST_TSX.match(/params\.set\('archivedOnly', '1'\)/g) || [];
  assert.equal(uses.length, 2, 'fetch AND export href must both carry the cut');
});
