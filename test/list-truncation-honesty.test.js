'use strict';

// Sprint 104 — truncation honesty on the primary list.
//
// Every card, email, and console bucket already carries the
// showing-X-of-N discipline ("No silent caps"). The MAIN imports
// list was the last silent cap: a 200-row default page with no
// indication that rows 201+ exist. The fix rides COUNT(*) OVER()
// in the SAME query — the caller learns the true match count with
// the capped page, no second round trip.

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

test('the true count rides the SAME query (COUNT(*) OVER()) — no second round trip, no drift window', () => {
  const block = DB_SRC.match(/async function listImportRequestsForOrg\([\s\S]*?\n\}/)[0];
  assert.match(block, /COUNT\(\*\) OVER\(\)::int AS __total_matching/);
  assert.match(block, /const totalMatching = rows\.length > 0 \? Number\(rows\[0\]\.__total_matching\) \|\| rows\.length : 0;/);
  assert.match(block, /return \{ ok: true, importRequests: rows\.map\(rowToImportRequest\), totalMatching \};/);
});

test('the handler surfaces totalMatching with an honest fallback (never undefined, never a lie)', () => {
  const block = HANDLER_SRC.match(/async function handleList\([\s\S]*?\n\}/)[0];
  assert.match(block, /totalMatching: Number\.isFinite\(Number\(result\.totalMatching\)\)/);
  assert.match(block, /: augmented\.length,/);
});

test('the list renders the banner ONLY when truncated, with the count and the way out', () => {
  assert.match(LIST_TSX, /\{state === 'ready' && totalMatching > requests\.length && \(/);
  assert.match(LIST_TSX, /Showing the \{requests\.length\} most recently updated of \{totalMatching\.toLocaleString\('en-IE'\)\} matching/);
  assert.match(LIST_TSX, /narrow with search or filters/);
});
