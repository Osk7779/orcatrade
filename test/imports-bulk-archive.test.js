'use strict';

// Sprint 74 — bulk archive on the imports list.
//
// The list-page counterpart of sprint-20's bulk-review: select
// rows → one action → per-row report. Wraps the existing per-row
// archiveImportRequest so every invariant (org-scoped WHERE,
// audit-before-success, webhook dispatch per row via events.record,
// already-archived idempotence) is preserved verbatim — the batch
// layer adds no bypass.
//
// Load-bearing contracts:
//   - Parity RBAC: single archive is ungated → bulk archive is
//     ungated. A bulk wrapper must not be more OR less privileged
//     than the action it wraps (bulk-review is gated BECAUSE
//     single review is gated).
//   - Per-row isolation: one row failing must not roll back the
//     rest.
//   - Three-outcome batch report (SAP-GTS batch-log posture):
//     archived / already-archived / failed, never a collapsed
//     "ok". `unchanged` rows are idempotent SUCCESSES reported
//     distinctly, not errors.
//   - Batch-level not-configured fast-fail → handler 503 (N
//     identical per-row failures would masquerade as partial
//     failure and 200).
//   - 50-row cap + Set dedup, server-enforced, UI-mirrored.
//
// Test layers:
//   1. Data layer: input validation runtime + cap + dedup /
//      isolation / report-shape source pins
//   2. Handler: reserved-keyword route, POST-only, parity-RBAC
//      contrast pin, 503/400 branches, response shape
//   3. List UI: cap mirror, selection prune-on-refetch, select-all
//      both-directions, confirm, POST shape, three-outcome report,
//      over-cap warning + disabled state

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

const DB_BLOCK = DB_SRC.match(/async function bulkArchiveImportRequests\([\s\S]*?\n\}/);
const HANDLER_BLOCK = HANDLER_SRC.match(/async function handleBulkArchive\([\s\S]*?\n\}/);

// ── Layer 1: data layer ───────────────────────────────────────────

test('bulkArchiveImportRequests is exported from lib/db/import-requests.js', () => {
  assert.equal(typeof importRequestsDb.bulkArchiveImportRequests, 'function');
});

test('bulkArchiveImportRequests rejects missing orgId', async () => {
  const r = await importRequestsDb.bulkArchiveImportRequests({
    externalIds: ['ir_a'], actorEmailHash: 'h',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /orgId/.test(e)));
});

test('bulkArchiveImportRequests rejects empty and missing externalIds', async () => {
  for (const externalIds of [[], undefined]) {
    const r = await importRequestsDb.bulkArchiveImportRequests({
      orgId: 1, externalIds, actorEmailHash: 'h',
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((/** @type {string} */ e) => /externalIds/.test(e)));
  }
});

test('bulkArchiveImportRequests enforces the 50-row soft cap (server-side)', async () => {
  const externalIds = Array.from({ length: 51 }, (_, i) => `ir_${String(i).padStart(16, '0')}`);
  const r = await importRequestsDb.bulkArchiveImportRequests({
    orgId: 1, externalIds, actorEmailHash: 'h',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /50/.test(e)));
});

test('bulkArchiveImportRequests fails fast at the batch level when the DB is not configured', () => {
  // Without this, a not-configured DB surfaces as N identical
  // per-row failures — the handler can't tell that apart from
  // real partial failure and would 200 instead of 503. Source
  // pin (runtime would depend on the local DATABASE_URL env).
  assert.ok(DB_BLOCK, 'bulkArchiveImportRequests not found');
  assert.match(DB_BLOCK[0], /if \(!db\.isConfigured\(\)\) return notConfigured\(\);/);
  // Positioned BEFORE the per-row loop.
  const cfgIdx = DB_BLOCK[0].indexOf('db.isConfigured()');
  const loopIdx = DB_BLOCK[0].indexOf('for (const externalId of ids)');
  assert.ok(cfgIdx > -1 && loopIdx > -1 && cfgIdx < loopIdx);
});

test('bulkArchiveImportRequests dedupes ids and wraps the EXISTING per-row archive path', () => {
  assert.ok(DB_BLOCK);
  const body = DB_BLOCK[0];
  // Set-based dedup — a double-submit must not fan out duplicate
  // audit events (sprint-20 lesson).
  assert.match(body, /\[\.\.\.new Set\(externalIds\.map\(String\)\)\]/);
  // The loop calls archiveImportRequest — NOT its own UPDATE. Every
  // per-row invariant (audit-before-success, webhook dispatch,
  // idempotence) rides along for free and cannot drift separately.
  assert.match(body, /await archiveImportRequest\(\{ orgId, externalId, actorEmailHash \}\)/);
});

test('bulkArchiveImportRequests reports three outcomes distinctly (archived / unchanged / failed)', () => {
  assert.ok(DB_BLOCK);
  const body = DB_BLOCK[0];
  // unchanged rows are idempotent SUCCESSES carried with a flag…
  assert.match(body, /succeeded\.push\(\{ externalId, unchanged: win\.unchanged === true \}\)/);
  // …and the counts split them from newly-archived rows.
  assert.match(body, /archivedCount: succeeded\.filter\(\(s\) => !s\.unchanged\)\.length/);
  assert.match(body, /unchangedCount: succeeded\.filter\(\(s\) => s\.unchanged\)\.length/);
  // Per-row isolation: failures collect, they don't throw.
  assert.match(body, /failed\.push\(\{\s*externalId,\s*error:/);
});

// ── Layer 2: handler ──────────────────────────────────────────────

test('bulk-archive is a reserved-keyword POST route (405 otherwise)', () => {
  assert.match(
    HANDLER_SRC,
    /if \(externalId === 'bulk-archive' && !action\) \{\s*\n\s*if \(req\.method !== 'POST'\) return jsonResponse\(res, 405, \{ error: 'bulk-archive requires POST' \}\);\s*\n\s*return handleBulkArchive\(req, res, ctx\);/,
  );
  // Documented in the URL-shape header.
  assert.match(HANDLER_SRC, /POST\s+\/api\/imports\/bulk-archive\s+→ archive up to 50/);
});

test('handleBulkArchive has NO ops gate — parity with the ungated single archive (contrast pin)', () => {
  assert.ok(HANDLER_BLOCK, 'handleBulkArchive not found');
  // Parity discipline: the bulk wrapper is exactly as privileged
  // as the per-row action it wraps. bulk-review IS gated because
  // single review is gated — pin the contrast so a future refactor
  // that copies the gate across (or removes bulk-review's) trips.
  assert.ok(!/requireOpsRole/.test(HANDLER_BLOCK[0]), 'bulk archive must stay ungated (single archive is ungated)');
  const reviewBlock = HANDLER_SRC.match(/async function handleBulkReview\([\s\S]*?\n\}/);
  assert.ok(reviewBlock && /requireOpsRole/.test(reviewBlock[0]), 'bulk-review must stay ops-gated');
});

test('handleBulkArchive maps not-configured → 503 and validation → 400', () => {
  assert.ok(HANDLER_BLOCK);
  const body = HANDLER_BLOCK[0];
  assert.match(body, /\/not configured\/i\.test\(result\.errors\[0\]\)\) return jsonResponse\(res, 503/);
  assert.match(body, /return jsonResponse\(res, 400, \{ error: result\.errors\[0\] \}\)/);
});

test('handleBulkArchive returns the full three-outcome batch report', () => {
  assert.ok(HANDLER_BLOCK);
  const body = HANDLER_BLOCK[0];
  for (const field of ['archivedCount', 'unchangedCount', 'failedCount', 'succeeded', 'failed']) {
    assert.match(body, new RegExp(`${field}: result\\.${field}`), `response must carry ${field}`);
  }
});

// ── Layer 3: list UI ──────────────────────────────────────────────

test('BULK_ARCHIVE_CAP mirrors the server cap (50)', () => {
  assert.match(LIST_TSX, /const BULK_ARCHIVE_CAP = 50;/);
});

test('selection is PRUNED (not cleared) on refetch — still-visible rows stay selected', () => {
  assert.match(
    LIST_TSX,
    /const visible = new Set\(rows\.map\(\(r\) => r\.externalId\)\);\s*\n\s*return new Set\(\[\.\.\.prev\]\.filter\(\(id\) => visible\.has\(id\)\)\);/,
  );
});

test('select-all-visible toggles both directions and respects the cap', () => {
  const block = LIST_TSX.match(/function selectAllVisible\(\)[\s\S]*?\n  \}/);
  assert.ok(block, 'selectAllVisible not found');
  assert.match(block[0], /const allSelected = visibleIds\.every\(\(id\) => next\.has\(id\)\)/);
  assert.match(block[0], /visibleIds\.slice\(0, BULK_ARCHIVE_CAP\)/);
});

test('submitBulkArchive confirms, POSTs the selected ids, and reports three outcomes', () => {
  const block = LIST_TSX.match(/async function submitBulkArchive\(\)[\s\S]*?\n  \}/);
  assert.ok(block, 'submitBulkArchive not found');
  const body = block[0];
  assert.match(body, /if \(!confirm\(`Archive \$\{selected\.size\}/);
  assert.match(body, /apiPost<\{[\s\S]*?\}>\('\/imports\/bulk-archive', \{ externalIds: \[\.\.\.selected\] \}\)/);
  // Three-outcome report — "already archived" and per-row failure
  // detail render distinctly, never a collapsed "done".
  assert.match(body, /already archived/);
  assert.match(body, /failed \(/);
  // Refetch is what makes archived rows disappear (server filters
  // archived_at IS NULL by default).
  assert.match(body, /setRefreshNonce\(\(n\) => n \+ 1\)/);
});

test('over-cap selection warns before the click AND disables the archive button', () => {
  assert.match(LIST_TSX, /selected\.size > BULK_ARCHIVE_CAP && \(/);
  assert.match(LIST_TSX, /Server cap is \{BULK_ARCHIVE_CAP\}/);
  assert.match(LIST_TSX, /disabled=\{bulkPending \|\| selected\.size > BULK_ARCHIVE_CAP\}/);
});

test('bulk action bar renders only with a non-empty selection; checkboxes carry aria-labels', () => {
  assert.match(LIST_TSX, /\{state === 'ready' && selected\.size > 0 && \(/);
  assert.match(LIST_TSX, /aria-label=\{`Select all \$\{requests\.length\} visible requests`\}/);
  assert.match(LIST_TSX, /aria-label=\{`Select \$\{r\.label\}`\}/);
});

test('refreshNonce is a dependency of the list fetch effect', () => {
  // Sprint 76 generalised the sprint-74 pin: the dep array gained
  // showArchived, so the tail accepts additional deps after
  // refreshNonce.
  assert.match(
    LIST_TSX,
    /\}, \[filterStatus, cohortReason, supplierPick, urlQ, refreshNonce(?:, \w+)*\]\);/,
  );
});
