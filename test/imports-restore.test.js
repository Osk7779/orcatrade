'use strict';

// Sprint 76 — archived view + restore (single & bulk).
//
// The reversibility counterpart to sprint-74's bulk archive:
// archive is never a one-way door (SAP-GTS posture). Restore is
// the EXACT mirror of archive at every layer — data (UPDATE
// archived_at = NULL), audit (import_request_restored pairs with
// import_request_archived), webhooks (subscribers tracking the
// archive lifecycle need both halves or their external state
// drifts), routes (POST /restore + POST /bulk-restore), and UI
// (the same selection bar drives Archive in the live view and
// Restore in the archived view).
//
// Load-bearing contracts:
//   - Idempotence both ways: restoring a live row → unchanged,
//     re-archiving an archived one → unchanged. Never errors.
//   - The new event type registers across EVERY registry —
//     ALLOWED_TYPES, ORG_ACTIVITY_TYPES, WEBHOOK_EVENT_TYPES,
//     the handler's timeline + audit-export sets, the TS unions,
//     and both renderers. A missing corner = silent drops.
//   - Parity RBAC: ungated like the archive it mirrors.
//   - Same 50-cap + dedup + three-outcome report as sprint 74.
//
// Test layers:
//   1. Data layer: exports, validation, SQL mirror pins,
//      idempotence pins, bulk wrapper pins
//   2. Event-type registration five-corners (runtime + source)
//   3. Handler routes: /restore action, /bulk-restore keyword,
//      parity-RBAC, response shape
//   4. List UI: archived view, mode-aware bulk bar, restore flow,
//      export hidden, empty state

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequestsDb = require('../lib/db/import-requests');
const events = require('../lib/events');
const webhooks = require('../lib/webhooks');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const HISTORY_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'components', 'TransitionHistory.tsx'),
  'utf8',
);
const LIST_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'page.tsx'),
  'utf8',
);

const RESTORE_BLOCK = DB_SRC.match(/async function restoreImportRequest\([\s\S]*?\n\}/);
const BULK_RESTORE_BLOCK = DB_SRC.match(/async function bulkRestoreImportRequests\([\s\S]*?\n\}/);

// ── Layer 1: data layer ───────────────────────────────────────────

test('restoreImportRequest + bulkRestoreImportRequests are exported', () => {
  assert.equal(typeof importRequestsDb.restoreImportRequest, 'function');
  assert.equal(typeof importRequestsDb.bulkRestoreImportRequests, 'function');
});

test('bulkRestoreImportRequests validates input and enforces the 50-row cap (runtime)', async () => {
  const noOrg = await importRequestsDb.bulkRestoreImportRequests({
    externalIds: ['ir_a'], actorEmailHash: 'h',
  });
  assert.equal(noOrg.ok, false);
  const empty = await importRequestsDb.bulkRestoreImportRequests({
    orgId: 1, externalIds: [], actorEmailHash: 'h',
  });
  assert.equal(empty.ok, false);
  const over = await importRequestsDb.bulkRestoreImportRequests({
    orgId: 1,
    externalIds: Array.from({ length: 51 }, (_, i) => `ir_${i}`),
    actorEmailHash: 'h',
  });
  assert.equal(over.ok, false);
  assert.ok(over.errors.some((/** @type {string} */ e) => /50/.test(e)));
});

test('restore is the exact SQL mirror of archive (NULL ↔ now(), IS NOT NULL ↔ IS NULL)', () => {
  assert.ok(RESTORE_BLOCK, 'restoreImportRequest not found');
  assert.match(
    RESTORE_BLOCK[0],
    /UPDATE import_requests SET archived_at = NULL, updated_at = now\(\)\s*\n\s*WHERE org_id = \$1 AND external_id = \$2 AND archived_at IS NOT NULL/,
  );
  // The archive side stays the inverse — pinned together so the
  // mirror can't half-drift.
  assert.match(
    DB_SRC,
    /UPDATE import_requests SET archived_at = now\(\), updated_at = now\(\)\s*\n\s*WHERE org_id = \$1 AND external_id = \$2 AND archived_at IS NULL/,
  );
});

test('restore is idempotent — restoring a live row returns unchanged, never an error', () => {
  assert.ok(RESTORE_BLOCK);
  assert.match(
    RESTORE_BLOCK[0],
    /if \(!beforeRow\.archivedAt\) return \{ ok: true, importRequest: beforeRow, unchanged: true \};/,
  );
});

test('restore records import_request_restored with before/after (audit-before-success)', () => {
  assert.ok(RESTORE_BLOCK);
  const body = RESTORE_BLOCK[0];
  assert.match(body, /await events\.record\('import_request_restored', \{/);
  assert.match(body, /before: beforeRow,\s*\n\s*after: importRequest,/);
});

test('bulkRestore mirrors the sprint-74 batch shape (fast-fail, dedup, per-row wrap, three outcomes)', () => {
  assert.ok(BULK_RESTORE_BLOCK, 'bulkRestoreImportRequests not found');
  const body = BULK_RESTORE_BLOCK[0];
  assert.match(body, /if \(!db\.isConfigured\(\)\) return notConfigured\(\);/);
  assert.match(body, /\[\.\.\.new Set\(externalIds\.map\(String\)\)\]/);
  assert.match(body, /await restoreImportRequest\(\{ orgId, externalId, actorEmailHash \}\)/);
  assert.match(body, /restoredCount: succeeded\.filter\(\(s\) => !s\.unchanged\)\.length/);
  assert.match(body, /unchangedCount: succeeded\.filter\(\(s\) => s\.unchanged\)\.length/);
});

// ── Layer 2: event-type registration five-corners ─────────────────

test('import_request_restored registers across every registry (five-corners)', () => {
  // 1. events allowlist (silent-drop guard)
  assert.ok(events.ALLOWED_TYPES.has('import_request_restored'));
  // 2. org activity feed
  assert.ok(events.ORG_ACTIVITY_TYPES.has('import_request_restored'));
  // 3. webhook dispatch — the archive-lifecycle pair stays whole
  assert.ok(webhooks.WEBHOOK_EVENT_TYPES.includes('import_request_restored'));
  assert.ok(webhooks.WEBHOOK_EVENT_TYPES.includes('import_request_archived'));
  // 4. handler timeline + audit-export sets
  const timelineBlock = HANDLER_SRC.match(/const IMPORT_REQUEST_TIMELINE_EVENT_TYPES = new Set\(\[[\s\S]*?\]\);/);
  assert.match(timelineBlock[0], /'import_request_restored',/);
  const auditBlock = HANDLER_SRC.match(/const IMPORT_REQUEST_AUDIT_EVENT_TYPES = new Set\(\[[\s\S]*?\]\);/);
  assert.match(auditBlock[0], /'import_request_restored',/);
  // 5. TS union
  assert.match(API_TS, /export type ImportRequestTimelineEventType =[\s\S]*?\| 'import_request_restored'[\s\S]*?;/);
});

test('both renderers narrate the restore (activity headline + timeline branches)', () => {
  assert.match(API_TS, /case 'import_request_restored':\s*\n\s*return `Import request \$\{entityRef\} restored from archive`;/);
  assert.match(HISTORY_TSX, /case 'import_request_restored':\s*\n\s*return 'Request restored from archive';/);
  assert.match(HISTORY_TSX, /if \(t === 'import_request_restored'\) return 'var\(--color-positive\)';/);
  assert.match(HISTORY_TSX, /case 'import_request_restored': return 'Restored';/);
});

// ── Layer 3: handler routes ───────────────────────────────────────

test('POST /api/imports/<id>/restore routes to handleRestore (405 otherwise, DELETE stays archive-only)', () => {
  assert.match(
    HANDLER_SRC,
    /if \(action === 'restore'\) \{\s*\n\s*if \(req\.method !== 'POST'\) return jsonResponse\(res, 405, \{ error: 'restore requires POST' \}\);\s*\n\s*return handleRestore\(req, res, ctx, externalId\);/,
  );
  assert.match(HANDLER_SRC, /POST\s+\/api\/imports\/<externalId>\/restore\s+→ un-archive/);
});

test('POST /api/imports/bulk-restore is a reserved-keyword route with the mirrored report', () => {
  assert.match(
    HANDLER_SRC,
    /if \(externalId === 'bulk-restore' && !action\) \{\s*\n\s*if \(req\.method !== 'POST'\) return jsonResponse\(res, 405, \{ error: 'bulk-restore requires POST' \}\);/,
  );
  assert.match(HANDLER_SRC, /POST\s+\/api\/imports\/bulk-restore\s+→ un-archive up to 50/);
  const block = HANDLER_SRC.match(/async function handleBulkRestore\([\s\S]*?\n\}/);
  assert.ok(block);
  for (const field of ['restoredCount', 'unchangedCount', 'failedCount', 'succeeded', 'failed']) {
    assert.match(block[0], new RegExp(`${field}: result\\.${field}`));
  }
});

test('restore handlers stay ungated — parity with the ungated archive (contrast preserved)', () => {
  const single = HANDLER_SRC.match(/async function handleRestore\([\s\S]*?\n\}/);
  const bulk = HANDLER_SRC.match(/async function handleBulkRestore\([\s\S]*?\n\}/);
  assert.ok(single && bulk);
  assert.ok(!/requireOpsRole/.test(single[0]));
  assert.ok(!/requireOpsRole/.test(bulk[0]));
});

// ── Layer 4: list UI ──────────────────────────────────────────────

test('archived view is URL-backed and cuts to archived rows client-side', () => {
  assert.match(LIST_TSX, /const showArchived = sp\.get\('archived'\) === '1';/);
  assert.match(LIST_TSX, /if \(showArchived\) params\.set\('includeArchived', '1'\);/);
  assert.match(LIST_TSX, /const rows = showArchived \? all\.filter\(\(r\) => r\.archivedAt\) : all;/);
  // Refetch on view flip.
  assert.match(LIST_TSX, /refreshNonce, showArchived\]\);/);
});

test('the toggle preserves the other view dimensions and reads honestly in both directions', () => {
  assert.match(LIST_TSX, /\{showArchived \? '← Back to active requests' : 'View archived →'\}/);
});

test('one selection bar, two mirrored actions (Archive in live view, Restore in archived view)', () => {
  assert.match(LIST_TSX, /onClick=\{showArchived \? submitBulkRestore : submitBulkArchive\}/);
  assert.match(LIST_TSX, /\(showArchived \? `Restore \$\{selected\.size\}` : `Archive \$\{selected\.size\}`\)/);
});

test('submitBulkRestore confirms, POSTs bulk-restore, reports three outcomes, refetches', () => {
  const block = LIST_TSX.match(/async function submitBulkRestore\(\)[\s\S]*?\n  \}/);
  assert.ok(block, 'submitBulkRestore not found');
  const body = block[0];
  assert.match(body, /if \(!confirm\(`Restore \$\{selected\.size\}/);
  assert.match(body, /apiPost<\{[\s\S]*?\}>\('\/imports\/bulk-restore', \{ externalIds: \[\.\.\.selected\] \}\)/);
  assert.match(body, /already live/);
  assert.match(body, /setRefreshNonce\(\(n\) => n \+ 1\)/);
});

test('CSV export hides in the archived view (server filter cannot express archived-only)', () => {
  assert.match(LIST_TSX, /requests\.length > 0 && !showArchived && \(/);
});

test('archived-empty state outranks the default copy', () => {
  assert.match(LIST_TSX, /\{showArchived && !urlQ \? \(/);
  assert.match(LIST_TSX, /No archived requests\./);
  assert.match(LIST_TSX, /archiving is never a one-way door/);
});
