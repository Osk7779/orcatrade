'use strict';

// Sprint 20 — bulk team review on the queue.
//
// Tests cover four layers:
//   1. Data-layer bulkAttachTeamReview: input validation, soft cap,
//      per-row isolation contract
//   2. Handler routing + ops-only gate + per-row email fan-out
//   3. Queue UI: multi-select state, "Select all visible", bulk
//      action bar, inline decline form
//   4. Composition with sprint 16 (DECLINE_REASONS reuse)
//
// The per-row-isolation contract is the core promise: a single row
// failing (status drift, missing reason) MUST NOT roll back the
// rows that succeeded. A regression here would either silently lose
// successful approvals or surface a misleading "0 succeeded" when
// rows actually went through.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequestsDb = require('../lib/db/import-requests');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');
const QUEUE_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'queue', 'page.tsx'),
  'utf8',
);

// ── Data layer: input validation ────────────────────────────────────

test('bulkAttachTeamReview is exported from lib/db/import-requests.js', () => {
  assert.equal(typeof importRequestsDb.bulkAttachTeamReview, 'function');
});

test('bulkAttachTeamReview rejects missing orgId', async () => {
  const r = await importRequestsDb.bulkAttachTeamReview({
    externalIds: ['ir_a'], actorEmailHash: 'h', decision: 'approved',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /orgId/.test(e)));
});

test('bulkAttachTeamReview rejects an empty externalIds array', async () => {
  const r = await importRequestsDb.bulkAttachTeamReview({
    orgId: 1, externalIds: [], actorEmailHash: 'h', decision: 'approved',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /externalIds.*required/.test(e)));
});

test('bulkAttachTeamReview rejects a missing externalIds field', async () => {
  const r = await importRequestsDb.bulkAttachTeamReview({
    orgId: 1, actorEmailHash: 'h', decision: 'approved',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /externalIds/.test(e)));
});

test('bulkAttachTeamReview enforces the 50-row soft cap (server-side)', async () => {
  // The cap is what prevents an accidental "select all" on a 200-
  // row queue from running a 200-row sequential UPDATE loop. Pin
  // the threshold so a refactor that bumps it surfaces here.
  const externalIds = Array.from({ length: 51 }, (_, i) => `ir_${String(i).padStart(16, '0')}`);
  const r = await importRequestsDb.bulkAttachTeamReview({
    orgId: 1, externalIds, actorEmailHash: 'h', decision: 'approved',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /50/.test(e)));
});

test('bulkAttachTeamReview dedupes the externalIds set', () => {
  // A double-submit (network hiccup, double-click) must NOT fan out
  // duplicate audit events. Pin the Set-based dedup at the source
  // so a refactor that drops it surfaces here.
  const block = DB_SRC.match(/async function bulkAttachTeamReview\([\s\S]*?\n\}/);
  assert.ok(block, 'bulkAttachTeamReview body not located');
  assert.match(block[0], /new Set\(externalIds\.map\(String\)\)/);
});

// ── Per-row isolation contract ──────────────────────────────────────

test('bulkAttachTeamReview returns BOTH succeeded[] AND failed[] (per-row isolation)', () => {
  // The contract: a single row's failure does NOT roll back others.
  // The return shape carries both arrays + counts so the UI can
  // render "12 succeeded, 3 failed" with per-row error detail.
  const block = DB_SRC.match(/async function bulkAttachTeamReview\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /succeededCount: succeeded\.length/);
  assert.match(body, /failedCount: failed\.length/);
  assert.match(body, /succeeded,/);
  assert.match(body, /failed,/);
});

test('bulkAttachTeamReview surfaces conflict + notFound flags on failed rows', () => {
  // The handler maps these to 409 / 404 in the single-row path; the
  // bulk path returns them in the failed[] entries so the UI can
  // tell a "status drifted" failure (conflict) from a "row gone"
  // failure (notFound) and react accordingly.
  const block = DB_SRC.match(/async function bulkAttachTeamReview\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /conflict: fail\.conflict \|\| false/);
  assert.match(block[0], /notFound: fail\.notFound \|\| false/);
});

test('bulkAttachTeamReview wraps the existing attachTeamReview per row (no DIY validation)', () => {
  // The existing function enforces every invariant: RBAC at the
  // handler layer, status='awaiting_review' precondition, DECLINE_REASONS
  // enum gate, audit-before-success. The bulk path MUST reuse it so
  // future invariant additions land in one place.
  const block = DB_SRC.match(/async function bulkAttachTeamReview\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /await attachTeamReview\(\s*\{/);
});

// ── Handler routing ────────────────────────────────────────────────

test('imports handler routes /api/imports/bulk-review → handleBulkReview', () => {
  assert.match(HANDLER_SRC, /externalId === ['"]bulk-review['"]/);
  assert.match(HANDLER_SRC, /handleBulkReview\(req, res, ctx\)/);
  assert.match(HANDLER_SRC, /async function handleBulkReview\(/);
});

test('handleBulkReview is ops-only (requireOpsRole gate)', () => {
  // Same RBAC as the single-row /review path. Without the gate, a
  // signed-in customer could call /imports/bulk-review with any
  // externalIds[] and trigger mass approvals on requests they
  // don't own (though the same-org WHERE would still scope them).
  const block = HANDLER_SRC.match(/async function handleBulkReview\([\s\S]*?\n\}/);
  assert.ok(block, 'handleBulkReview body not located');
  assert.match(block[0], /requireOpsRole\(req, res, ctx\)/);
});

test('handleBulkReview is POST-only — every other method 405s', () => {
  // The bulk-review action is a mutation. Pin the segment-level
  // method gate so a refactor that adds GET / DELETE doesn't
  // accidentally surface read-only versions of the data.
  assert.match(
    HANDLER_SRC,
    /if \(req\.method !== ['"]POST['"]\) return jsonResponse\(res, 405, \{ error: ['"]bulk-review requires POST['"]/,
  );
});

test('handleBulkReview fires per-row emails for approved + rejected (fail-soft)', () => {
  // Customer for row N hears about row N (no cross-row leakage).
  // Approved → quote-ready email; rejected → customer-rejected email
  // (with the structured decline reason). Both are fail-soft via
  // .catch() so a Resend outage cannot block any data-layer write.
  const block = HANDLER_SRC.match(/async function handleBulkReview\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /for \(const \{ importRequest \} of result\.succeeded\)/);
  assert.match(body, /sendQuoteReadyEmail/);
  assert.match(body, /sendCustomerRejectedEmail/);
  // Both emails wrapped in .catch() (fail-soft).
  const matches = body.match(/\.catch\(/g) || [];
  assert.ok(matches.length >= 2, 'expected at least two .catch wrappers (approved + rejected paths)');
});

// ── Queue UI: multi-select state ───────────────────────────────────

test('Queue page tracks selected externalIds in a Set (O(1) toggle)', () => {
  // The selection set lives in component state; Set gives O(1)
  // has() + add() + delete() which matters at the 200-row scale
  // ops will actually use. An Array-backed implementation would be
  // O(n) per toggle.
  assert.match(QUEUE_TSX, /useState<Set<string>>\(new Set\(\)\)/);
});

test('Queue page exposes BULK_CAP that matches the server (50)', () => {
  // The client-side cap must match the server. A drift here would
  // either silently let ops queue 100 rows the server rejects, or
  // pessimistically block selections the server would accept.
  assert.match(QUEUE_TSX, /const BULK_CAP = 50/);
});

test('Queue page renders "Select all visible" affordance', () => {
  // Without it, ops has to click each row's checkbox one-by-one
  // to get to bulk actions — the cap-friendly version of the
  // pre-sprint-20 workflow.
  assert.match(QUEUE_TSX, /Select all/);
  assert.match(QUEUE_TSX, /selectAllVisible/);
});

test('Queue page renders the bulk action bar ONLY when selection is non-empty', () => {
  // At rest the queue looks clean — no permanent action bar
  // clobbering the scroll surface. Pin the conditional render.
  assert.match(QUEUE_TSX, /selected\.size > 0 && \(\s*<BulkActionBar/);
});

test('BulkActionBar exposes Approve / Send back / Decline (3 primary actions)', () => {
  assert.match(QUEUE_TSX, /function BulkActionBar\(/);
  assert.match(QUEUE_TSX, /onApprove/);
  assert.match(QUEUE_TSX, /onSendBack/);
  assert.match(QUEUE_TSX, /onDecline/);
});

test('BulkActionBar uses the sprint-16 DECLINE_REASONS taxonomy', () => {
  // The bulk decline reuses the same reason picker — drift-guard
  // pins the import so a refactor that imports a local enum surface
  // here. (Sprint 16's structured taxonomy is the single source.)
  assert.match(QUEUE_TSX, /DECLINE_REASONS\.map/);
  assert.match(QUEUE_TSX, /DECLINE_REASON_LABELS\[r\]/);
});

test('BulkActionBar surfaces the soft-cap warning when count > cap', () => {
  // "Server cap is 50 — drop X before sending" makes the limit
  // explicit BEFORE the user clicks (which is the only way the
  // server gives back a useful error). Pin the warning copy.
  assert.match(QUEUE_TSX, /Server cap is/);
  assert.match(QUEUE_TSX, /overCap/);
});

test('BulkActionBar inline decline form caps notes at 4000 chars (matches data-layer)', () => {
  // Same MESSAGE_BODY_MAX / notes cap as the single-row decline form
  // (sprint 16). Pin the slice so a typo (400 vs 4000) doesn't make
  // ops type a note the server rejects.
  assert.match(QUEUE_TSX, /setDeclineNotes\(e\.target\.value\.slice\(0,\s*4000\)\)/);
});

test('Queue page clears selection + resets decline form on successful bulk action', () => {
  // After a bulk send, the queue reloads + the selection state
  // resets to empty so the action bar disappears. Pin clearSelection
  // being called in the submit flow.
  assert.match(QUEUE_TSX, /function clearSelection\(\)/);
  assert.match(QUEUE_TSX, /clearSelection\(\);\s*load\(\);/);
});

test('Queue page surfaces per-row failure detail (first 3 errors) on partial bulk failure', () => {
  // Partial-success is the realistic outcome — the bulk path is
  // designed for it. The UI must surface enough detail that ops
  // can act on the failures (re-fan from /imports/<id> or skip).
  // First-3-errors keeps the chip readable at the 50-row scale.
  assert.match(QUEUE_TSX, /result\.failed\.slice\(0, 3\)/);
});
