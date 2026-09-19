'use strict';

// Sprint 61 — internal-notes edit + soft-delete.
//
// Sprint 55 ships append-only. Real-world ops needs to fix typos
// and remove a wrong note. Sprint 61 adds PATCH (edit) + DELETE
// (soft-delete) with OWNER-ONLY RBAC: only the note's original
// author can mutate. Admins can write internal notes but cannot
// rewrite another ops member's note — prevents silent revisionism
// on the per-request side-channel.
//
// CRITICAL RBAC discipline — pinned at FOUR layers:
//   1. Data layer: editInternalNote / deleteInternalNote both
//      check byEmailHash === actorEmailHash; return forbidden:true
//      on mismatch
//   2. Handler: maps forbidden → 403, forwards owner-only error
//      copy to the client
//   3. GET projection: soft-deleted notes filtered OUT of the
//      visible list (the deletedAt row stays in KV for audit
//      reconstruction)
//   4. UI: edit + delete buttons rendered ONLY when the note's
//      byEmailHash matches the caller's currentEmailHash
//
// Layer 4 is the second line of defence — the server-side
// enforcement (layer 1) is the actual gate. Drift-guard pins
// both.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequests = require('../lib/db/import-requests');
const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');
const ACCOUNT_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'account.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const DETAIL_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', '[externalId]', 'page.tsx'),
  'utf8',
);

// ── Helper surface ────────────────────────────────────────────────

test('editInternalNote + deleteInternalNote exported', () => {
  assert.equal(typeof importRequests.editInternalNote, 'function');
  assert.equal(typeof importRequests.deleteInternalNote, 'function');
});

// ── editInternalNote — owner-only RBAC + validation ──────────────

test('editInternalNote rejects missing args / invalid body / over-limit body (defensive)', () => {
  return Promise.all([
    importRequests.editInternalNote({ orgId: 1, externalId: 'ir_x', actorEmailHash: 'h', body: '' }),
    importRequests.editInternalNote({ orgId: 1, externalId: 'ir_x', actorEmailHash: 'h', body: '   ' }),
    importRequests.editInternalNote({ orgId: 1, externalId: 'ir_x', actorEmailHash: 'h', body: null }),
    importRequests.editInternalNote({ orgId: 1, externalId: 'ir_x', actorEmailHash: 'h', body: 'x'.repeat(importRequests.INTERNAL_NOTE_BODY_MAX + 1) }),
    importRequests.editInternalNote({ orgId: 1, externalId: '', noteId: 'note_x', actorEmailHash: 'h', body: 'ok' }),
  ]).then((results) => {
    for (const r of results) {
      assert.equal(r.ok, false, `expected ${JSON.stringify(r)} to fail`);
    }
  });
});

// ── Source-pin: editInternalNote owner-only gate ─────────────────

test('CRITICAL: editInternalNote returns forbidden:true when byEmailHash !== actorEmailHash', () => {
  // The load-bearing security invariant. Without it, ANY ops
  // user could rewrite anyone else's note silently. Pin the
  // gate as a source-level check.
  const block = DB_SRC.match(/async function editInternalNote\([\s\S]*?\n\}/);
  assert.ok(block, 'editInternalNote body not located');
  const body = block[0];
  assert.match(body, /if \(current\.byEmailHash !== actorEmailHash\)/);
  assert.match(body, /forbidden: true/);
  assert.match(body, /only the note author can edit/);
});

test('editInternalNote returns notFound when noteId is absent from the array', () => {
  // findIndex returns -1; the helper translates to a notFound
  // shape (NOT 500). Source-pinned.
  const block = DB_SRC.match(/async function editInternalNote\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /idx === -1/);
  assert.match(body, /notFound: true/);
});

test('editInternalNote refuses to edit a soft-deleted note (conflict shape)', () => {
  // Once deleted, the note is "done." Re-editing would
  // resurrect content the author chose to remove. Pin the
  // conflict branch.
  const block = DB_SRC.match(/async function editInternalNote\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /if \(current\.deletedAt\)/);
  assert.match(body, /conflict: true/);
  assert.match(body, /deleted and cannot be edited/);
});

test('editInternalNote short-circuits on a no-op (same body) — does NOT audit-log', () => {
  // Same body → noOp; preserves the audit chain from noise.
  const block = DB_SRC.match(/async function editInternalNote\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /if \(current\.body === trimmed\)/);
  assert.match(body, /noOp: true/);
});

test('editInternalNote stamps editedAt on success', () => {
  const block = DB_SRC.match(/async function editInternalNote\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /editedAt: new Date\(\)\.toISOString\(\)/);
});

test('editInternalNote audits BEFORE return (ADR-0005); body NEVER in detail', () => {
  const block = DB_SRC.match(/async function editInternalNote\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /events\.record\(['"]import_request_internal_note_edited['"]/);
  // Detail records noteId + length only — paranoid scan against
  // `body:` in the events.record call (sprint-55 lesson).
  const recordCall = body.match(/events\.record\(['"]import_request_internal_note_edited['"][\s\S]*?\}\);/);
  assert.ok(recordCall);
  assert.match(recordCall[0], /detail: \{ noteId, length: trimmed\.length \}/);
  assert.ok(!/body:/.test(recordCall[0]), 'body leaked into audit detail');
});

// ── deleteInternalNote — owner-only RBAC + soft-delete ───────────

test('CRITICAL: deleteInternalNote returns forbidden:true when byEmailHash !== actorEmailHash', () => {
  const block = DB_SRC.match(/async function deleteInternalNote\([\s\S]*?\n\}/);
  assert.ok(block, 'deleteInternalNote body not located');
  const body = block[0];
  assert.match(body, /if \(current\.byEmailHash !== actorEmailHash\)/);
  assert.match(body, /forbidden: true/);
  assert.match(body, /only the note author can delete/);
});

test('deleteInternalNote is idempotent — re-delete returns noOp:true (no duplicate audit)', () => {
  // Re-delete of a soft-deleted note is a no-op; the audit
  // chain captures the first deletion only.
  const block = DB_SRC.match(/async function deleteInternalNote\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /if \(current\.deletedAt\)/);
  assert.match(body, /noOp: true/);
});

test('deleteInternalNote is SOFT (sets deletedAt + deletedByEmailHash; keeps row in array)', () => {
  // CRITICAL: the row stays for audit-history reconstruction.
  // A hard delete would lose the row + the audit chain entry
  // would dangle. Pin both stamp fields + the array-update
  // pattern (NOT array filter).
  const block = DB_SRC.match(/async function deleteInternalNote\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /deletedAt: new Date\(\)\.toISOString\(\)/);
  assert.match(body, /deletedByEmailHash: actorEmailHash/);
  // The update writes the WHOLE array back (nextArr[idx] = updatedNote);
  // it does NOT splice the row out.
  assert.match(body, /nextArr\[idx\] = updatedNote/);
  assert.ok(!/nextArr\.splice/.test(body), 'splice would hard-delete');
});

test('deleteInternalNote audits BEFORE return (ADR-0005)', () => {
  const block = DB_SRC.match(/async function deleteInternalNote\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /events\.record\(['"]import_request_internal_note_deleted['"]/);
});

// ── Events allowlist ────────────────────────────────────────────

test('events.ALLOWED_TYPES includes both new lifecycle types (silent-drop guard)', () => {
  assert.ok(events.ALLOWED_TYPES.has('import_request_internal_note_edited'));
  assert.ok(events.ALLOWED_TYPES.has('import_request_internal_note_deleted'));
});

test('IMPORT_REQUEST_AUDIT_EVENT_TYPES in the handler includes both new types (per-request CSV stays exhaustive)', () => {
  const block = HANDLER_SRC.match(/const IMPORT_REQUEST_AUDIT_EVENT_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block);
  assert.match(block[1], /['"]import_request_internal_note_edited['"]/);
  assert.match(block[1], /['"]import_request_internal_note_deleted['"]/);
});

// ── Handler routing ─────────────────────────────────────────────

test('Handler routes PATCH /api/imports/<id>/notes/<noteId> → handleEditInternalNote', () => {
  assert.match(HANDLER_SRC, /const noteId = segments\[3\] \|\| ''/);
  assert.match(HANDLER_SRC, /if \(req\.method === ['"]PATCH['"]\)[\s\S]*?return handleEditInternalNote/);
});

test('Handler routes DELETE /api/imports/<id>/notes/<noteId> → handleDeleteInternalNote', () => {
  assert.match(HANDLER_SRC, /if \(req\.method === ['"]DELETE['"]\)[\s\S]*?return handleDeleteInternalNote/);
});

test('Handler 405s notes/<id> on methods other than PATCH/DELETE', () => {
  assert.match(HANDLER_SRC, /notes\/<id> requires PATCH or DELETE/);
});

test('Handler enforces requireOpsRole on both edit + delete (defence layer 2 before the data-layer RBAC)', () => {
  // Even before the owner-only check fires at the data layer,
  // the requireOpsRole gate stops a customer in their tracks.
  // Pin the gate at the top of each handler body.
  const editBlock = HANDLER_SRC.match(/async function handleEditInternalNote\([\s\S]*?\n\}/);
  const deleteBlock = HANDLER_SRC.match(/async function handleDeleteInternalNote\([\s\S]*?\n\}/);
  assert.ok(editBlock);
  assert.ok(deleteBlock);
  assert.match(editBlock[0], /const guard = await requireOpsRole/);
  assert.match(deleteBlock[0], /const guard = await requireOpsRole/);
});

test('Handler maps forbidden:true → 403 + forwards owner-only error copy', () => {
  // The owner-only error is the customer-facing message — pin
  // both the status mapping and the message passthrough.
  const editBlock = HANDLER_SRC.match(/async function handleEditInternalNote\([\s\S]*?\n\}/);
  const deleteBlock = HANDLER_SRC.match(/async function handleDeleteInternalNote\([\s\S]*?\n\}/);
  assert.ok(editBlock);
  assert.ok(deleteBlock);
  assert.match(editBlock[0], /if \(result\.forbidden\) return jsonResponse\(res, 403, \{ error: result\.errors\[0\] \}\)/);
  assert.match(deleteBlock[0], /if \(result\.forbidden\) return jsonResponse\(res, 403, \{ error: result\.errors\[0\] \}\)/);
});

// ── GET projection: soft-deleted notes filtered out ──────────────

test('CRITICAL: handleGet projection FILTERS OUT soft-deleted notes (deletedAt row never surfaces)', () => {
  // The CSV / audit can still see them via the events chain;
  // the visible panel filters them out so the UI looks clean.
  // Drift-guard pins the filter callback shape — a refactor
  // that returned the raw array would surface deleted notes
  // in the panel.
  const block = HANDLER_SRC.match(/async function handleGet\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(
    body,
    /internalNotes: callerIsOps[\s\S]*?r\.internalNotes\.filter\(\(n\) => n && !n\.deletedAt\)/,
  );
});

// ── /api/account/role surfaces emailHash ─────────────────────────

test('/api/account/role response now includes emailHash (for owner-check rendering)', () => {
  // Without this, the UI can't tell "is this note mine"; the
  // owner-only buttons would never render.
  assert.match(ACCOUNT_SRC, /const userHash = emailHash\(user\.email\)/);
  assert.match(ACCOUNT_SRC, /emailHash: userHash/);
});

// ── TS mirror ────────────────────────────────────────────────────

test('TS ImportRequestInternalNote extends with editedAt / deletedAt / deletedByEmailHash', () => {
  assert.match(API_TS, /editedAt\?: string \| null;/);
  assert.match(API_TS, /deletedAt\?: string \| null;/);
  assert.match(API_TS, /deletedByEmailHash\?: string \| null;/);
});

test('TS ImportRequestInternalNoteResponse extends with noOp? (mirrors the data-layer shape)', () => {
  assert.match(API_TS, /export interface ImportRequestInternalNoteResponse \{[\s\S]*?noOp\?: boolean;[\s\S]*?\}/);
});

// ── UI: owner-only edit + delete affordances ─────────────────────

test('Detail page threads currentEmailHash from /api/account/role to <InternalNotesPanel>', () => {
  // The whole owner-only render rests on this — drift-guard
  // pins the wire-through.
  assert.match(DETAIL_TSX, /const \[currentEmailHash, setCurrentEmailHash\] = useState<string>/);
  assert.match(DETAIL_TSX, /if \(typeof d\.emailHash === ['"]string['"]\) setCurrentEmailHash\(d\.emailHash\)/);
  assert.match(DETAIL_TSX, /currentEmailHash=\{currentEmailHash\}/);
});

test('InternalNotesPanel edit + delete buttons render ONLY when the note byEmailHash matches caller', () => {
  // The load-bearing UI-side defence. Pin the isOwner check +
  // the gated render.
  const block = DETAIL_TSX.match(/function InternalNotesPanel\([\s\S]*?(?=\nfunction MessageBubble)/);
  assert.ok(block, 'InternalNotesPanel body not located');
  const body = block[0];
  assert.match(body, /const isOwner = !!currentEmailHash && n\.byEmailHash === currentEmailHash/);
  assert.match(body, /\{isOwner && !isEditing && \(/);
});

test('InternalNotesPanel edit affordance PATCHes /api/imports/<id>/notes/<noteId>', () => {
  const block = DETAIL_TSX.match(/function InternalNotesPanel\([\s\S]*?(?=\nfunction MessageBubble)/);
  assert.ok(block);
  assert.match(
    block[0],
    /apiPatch<ImportRequestInternalNoteResponse>\(\s*`\/imports\/\$\{request\.externalId\}\/notes\/\$\{encodeURIComponent\(noteId\)\}`/,
  );
});

test('InternalNotesPanel delete affordance confirms + DELETEs (soft-delete via the same URL)', () => {
  const block = DETAIL_TSX.match(/function InternalNotesPanel\([\s\S]*?(?=\nfunction MessageBubble)/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /confirm\(['"]Delete this internal note/);
  assert.match(
    body,
    /apiDelete<ImportRequestInternalNoteResponse>\(\s*`\/imports\/\$\{request\.externalId\}\/notes\/\$\{encodeURIComponent\(noteId\)\}`/,
  );
});

test('InternalNotesPanel surfaces an "edited" badge when n.editedAt is set', () => {
  // The badge tells other ops members the note has been
  // revised since they last read it. Pin the rendering.
  const block = DETAIL_TSX.match(/function InternalNotesPanel\([\s\S]*?(?=\nfunction MessageBubble)/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /\{n\.editedAt && \(/);
  assert.match(body, /edited/);
});
