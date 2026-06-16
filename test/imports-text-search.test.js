'use strict';

// Sprint 25 — free-text search across import requests.
//
// Tests cover four layers:
//   1. Data-layer: listImportRequestsForOrg accepts q; ILIKE wildcards
//      in user input are escaped (so "100%" doesn't blow open the
//      query); empty/whitespace q acts as no-filter
//   2. Handler: 200-char cap before passing through to the data layer
//   3. /imports list page: URL-backed ?q=, debounced 300ms, ⌕ icon +
//      × clear, search-empty state distinct from default + cohort
//   4. /imports/queue: same input shape, LOCAL state (no URL backing
//      — queue is a working surface), search-empty state distinct
//      from "queue is empty"
//
// The ILIKE-wildcard-escape is load-bearing: without it, a user
// pasting "100% cotton" would trigger a leading-wildcard ILIKE that
// can't use any index. Pinning the escape at the source.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequestsDb = require('../lib/db/import-requests');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');
const LIST_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'page.tsx'),
  'utf8',
);
const QUEUE_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'queue', 'page.tsx'),
  'utf8',
);

// ── Data layer: q parameter shape ──────────────────────────────────

test('listImportRequestsForOrg accepts the q parameter without throwing', async () => {
  // not-configured branch in the test env — just confirm the call
  // accepts the new param.
  const r = await importRequestsDb.listImportRequestsForOrg({
    orgId: 1, q: 'Shenzhen LED',
  });
  assert.ok('ok' in r);
});

test('listImportRequestsForOrg ILIKE clause covers label + product_description + external_id', () => {
  // Three searchable columns — pin all three. A regression that
  // dropped external_id would mean "ir_abc1" pasted from a Slack
  // link doesn't surface its request.
  const block = DB_SRC.match(/async function listImportRequestsForOrg\([\s\S]*?\nasync function /);
  assert.ok(block, 'listImportRequestsForOrg body not located');
  const body = block[0];
  assert.match(body, /label ILIKE/);
  assert.match(body, /product_description ILIKE/);
  assert.match(body, /external_id ILIKE/);
});

test('listImportRequestsForOrg escapes ILIKE wildcards (% and _) in user input', () => {
  // Without escaping, a user pasting "100% cotton" hits a leading-
  // wildcard ILIKE that bypasses any index (full-table scan). Pin
  // the source replace.
  const block = DB_SRC.match(/async function listImportRequestsForOrg\([\s\S]*?\nasync function /);
  assert.ok(block);
  // The escape regex captures backslash + percent + underscore.
  assert.match(block[0], /\.replace\(\/\[\\\\%_\]\/g/);
});

test('listImportRequestsForOrg treats whitespace-only q as no-filter', () => {
  // .trim() applied before the ILIKE check. A query of "   " must
  // NOT add a WHERE clause matching everything (literal "%   %").
  const block = DB_SRC.match(/async function listImportRequestsForOrg\([\s\S]*?\nasync function /);
  assert.ok(block);
  assert.match(block[0], /const qTrimmed = typeof q === ['"]string['"] \? q\.trim\(\) : ['"]{2}/);
  assert.match(block[0], /if \(qTrimmed\) \{/);
});

test('listImportRequestsForOrg wraps the escaped term in % wildcards', () => {
  // The wildcards turn ILIKE into a substring match. Pin the
  // construction at the source.
  const block = DB_SRC.match(/async function listImportRequestsForOrg\([\s\S]*?\nasync function /);
  assert.ok(block);
  assert.match(block[0], /params\.push\(['"]%['"] \+ safe \+ ['"]%['"]\)/);
});

// ── Handler: 200-char cap ──────────────────────────────────────────

test('handleList caps the q parameter at 200 chars before passing through', () => {
  // A pathological multi-MB query string must not reach the data
  // layer. Pin the slice at the handler.
  const block = HANDLER_SRC.match(/async function handleList\([\s\S]*?\n\}/);
  assert.ok(block, 'handleList body not located');
  assert.match(block[0], /q: q\.q \? String\(q\.q\)\.slice\(0, 200\) : undefined/);
});

// ── /imports list page UI ──────────────────────────────────────────

test('/imports list page reads ?q from URL searchParams', () => {
  // URL-backed search means a shared link reproduces the same
  // view. Pin the read.
  assert.match(LIST_TSX, /sp\.get\(['"]q['"]\)/);
});

test('/imports list page renders a search input with placeholder + clear affordance', () => {
  assert.match(LIST_TSX, /type="search"/);
  assert.match(LIST_TSX, /placeholder="Search by label, product description, or request ID/);
  assert.match(LIST_TSX, /aria-label="Clear search"/);
});

test('/imports list page debounces the URL push by 300ms', () => {
  // Avoid one network request per keystroke. 300ms idle window
  // matches /imports/queue so muscle memory carries.
  const block = LIST_TSX.match(/useEffect\(\(\) => \{\s*if \(searchInput === urlQ\) return;[\s\S]*?\}, \[searchInput\]\);/);
  assert.ok(block, 'debounce useEffect not located');
  assert.match(block[0], /setTimeout\([\s\S]*?, 300\)/);
});

test('/imports list page status chips PRESERVE the active search query', () => {
  // Click "Cancelled" while a search is active → the search MUST
  // survive. A regression that hardcoded /imports?status=X would
  // drop it.
  assert.match(LIST_TSX, /if \(urlQ\) params\.set\(['"]q['"], urlQ\);/);
});

test('/imports list page useEffect re-fires when urlQ changes', () => {
  // The data useEffect dep array must include urlQ; without it the
  // debounce push wouldn't trigger a refetch.
  assert.match(LIST_TSX, /\[filterStatus, cohortReason, urlQ\]/);
});

test('/imports list page shows a search-specific empty state ("No matches for X")', () => {
  // Search-no-match must NOT render the default "submit a new
  // request" CTA. Pin the cohort-style precedence: search → cohort
  // → default.
  assert.match(LIST_TSX, /urlQ \? \(/);
  assert.match(LIST_TSX, /No matches for "\{urlQ\}"/);
});

test('/imports list page search caps the input value at 200 chars on the client too', () => {
  // Defense-in-depth: same 200-char cap as the handler so paste of
  // a multi-MB string doesn't slow the input.
  assert.match(LIST_TSX, /setSearchInput\(e\.target\.value\.slice\(0, 200\)\)/);
});

// ── /imports/queue UI ──────────────────────────────────────────────

test('/imports/queue uses LOCAL search state (no URL backing per the queue working-surface posture)', () => {
  // Sprint 8 ch 2 established: queue filters live in local state
  // because ops uses it as a working surface, not a bookmark.
  // Sprint 25 search follows that posture. Pin the local state +
  // the absence of any sp.get('q') read.
  assert.match(QUEUE_TSX, /const \[searchInput, setSearchInput\] = useState\(''\)/);
  assert.match(QUEUE_TSX, /const \[appliedQ, setAppliedQ\] = useState\(''\)/);
  // The queue should NOT read ?q from the URL.
  assert.doesNotMatch(QUEUE_TSX, /searchParams\.get\(['"]q['"]\)/);
});

test('/imports/queue debounces appliedQ from searchInput with 300ms idle (matches /imports)', () => {
  // Muscle memory: same idle window across surfaces.
  const block = QUEUE_TSX.match(/useEffect\(\(\) => \{\s*if \(searchInput === appliedQ\) return;[\s\S]*?\}, \[searchInput\]\);/);
  assert.ok(block, 'queue debounce useEffect not located');
  assert.match(block[0], /setTimeout\(\(\) => setAppliedQ\(searchInput\), 300\)/);
});

test('/imports/queue buildFetchUrl includes q only when present + trimmed', () => {
  // Centralised URL build so the on-demand load() + the initial
  // useEffect don't drift. Pin the helper + the trim.
  assert.match(QUEUE_TSX, /const buildFetchUrl = useCallback\(/);
  const block = QUEUE_TSX.match(/const buildFetchUrl = useCallback\([\s\S]*?\, \[appliedQ\]\);/);
  assert.ok(block, 'buildFetchUrl body not located');
  assert.match(block[0], /appliedQ\.trim\(\)/);
  assert.match(block[0], /\.slice\(0, 200\)/);
});

test('/imports/queue empty-state diverges when search returned 0 vs queue genuinely empty', () => {
  // Pin the appliedQ branch in the empty state so ops typing an
  // unmatched query sees "no matches" not "queue is empty."
  assert.match(QUEUE_TSX, /appliedQ \? \(/);
  assert.match(QUEUE_TSX, /No queue items match "\{appliedQ\}"/);
});
