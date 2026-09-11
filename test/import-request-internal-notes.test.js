'use strict';

// Sprint 55 — per-request internal ops notes.
//
// Sprint 18 ships customer↔ops messaging — both sides see the
// thread. Sprint 55 adds a SECOND channel: ops-only annotations
// that the customer NEVER sees, even when logged in and viewing
// their own request. Classic CRM pattern.
//
// CRITICAL RBAC discipline — pinned at FOUR layers:
//   1. Data layer: appendInternalNote writes the note + audit
//      event BEFORE returning success (ADR-0005)
//   2. Handler write path: requireOpsRole gate before the data
//      layer call
//   3. Handler read path: handleGet REDACTS internalNotes to []
//      when caller isn't ops — even when the customer is reading
//      their own request via /api/imports/<id>
//   4. UI: <InternalNotesPanel> rendered ONLY when isOpsRole
//
// Layer 3 is the load-bearing one — a customer crafting a curl
// directly against the API must not see internal notes. Drift-
// guard pins the source path.
//
// Tests cover five layers:
//   1. Constants + exports: INTERNAL_NOTE_BODY_MAX +
//      INTERNAL_NOTES_MAX_PER_REQUEST + appendInternalNote
//   2. rowToImportRequest projects the column
//   3. Audit allowlist + per-request audit CSV taxonomy include
//      the new event type
//   4. Handler: route registered (POST-only), requireOpsRole
//      gate, GET-path redaction
//   5. TS mirror + UI gate

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequests = require('../lib/db/import-requests');
const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const DETAIL_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', '[externalId]', 'page.tsx'),
  'utf8',
);
const SCHEMA_SQL = fs.readFileSync(
  path.join(ROOT, 'lib', 'db', 'schema-020-import-request-internal-notes.sql'),
  'utf8',
);

// ── Constants + exports ───────────────────────────────────────────

test('appendInternalNote + INTERNAL_NOTE_BODY_MAX + INTERNAL_NOTES_MAX_PER_REQUEST exported', () => {
  // The data-layer surface — the handler calls these by name.
  assert.equal(typeof importRequests.appendInternalNote, 'function');
  assert.equal(importRequests.INTERNAL_NOTE_BODY_MAX, 4000);
  assert.equal(importRequests.INTERNAL_NOTES_MAX_PER_REQUEST, 100);
});

test('Schema migration creates internal_notes jsonb column with default [] + array CHECK', () => {
  // Drift-guard against the column shape changing under us.
  // Default `[]` matters because rowToImportRequest assumes
  // Array.isArray; a missing default would surface as nulls in
  // the read path.
  assert.match(SCHEMA_SQL, /ADD COLUMN IF NOT EXISTS internal_notes jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
  // The CHECK constraint pins the array-typed invariant.
  assert.match(SCHEMA_SQL, /CHECK \(jsonb_typeof\(internal_notes\) = 'array'\)/);
});

// ── rowToImportRequest projection ─────────────────────────────────

test('rowToImportRequest projects internal_notes → internalNotes (array fallback)', () => {
  // Cross-layer: a future widening of the JSONB shape must keep
  // the array-fallback so a NULL or scalar in the column doesn't
  // crash the iteration in the UI.
  assert.match(DB_SRC, /internalNotes: Array\.isArray\(r\.internal_notes\) \? r\.internal_notes : \[\]/);
});

// ── Data layer: appendInternalNote ────────────────────────────────

test('appendInternalNote requires body (validation surface mirrors sprint-18 messages)', () => {
  return importRequests
    .appendInternalNote({
      orgId: 1, externalId: 'ir_x', actorEmailHash: 'h', body: '',
    })
    .then((r) => {
      assert.equal(r.ok, false);
      assert.match(r.errors[0], /empty|required|string/i);
    });
});

test('appendInternalNote validation rejects null body + non-string body + over-limit body', () => {
  return Promise.all([
    importRequests.appendInternalNote({ orgId: 1, externalId: 'ir_x', actorEmailHash: 'h', body: null }),
    importRequests.appendInternalNote({ orgId: 1, externalId: 'ir_x', actorEmailHash: 'h', body: 42 }),
    importRequests.appendInternalNote({
      orgId: 1, externalId: 'ir_x', actorEmailHash: 'h',
      body: 'x'.repeat(importRequests.INTERNAL_NOTE_BODY_MAX + 1),
    }),
  ]).then(([nullR, numR, bigR]) => {
    assert.equal(nullR.ok, false);
    assert.equal(numR.ok, false);
    assert.equal(bigR.ok, false);
    assert.match(bigR.errors[0], /<= 4000/);
  });
});

test('appendInternalNote audit-logs BEFORE returning success (ADR-0005)', () => {
  // The data-layer helper writes events.record(...) BEFORE the
  // function returns. Source-pin the call exists with the right
  // event type + the body length (NOT the body itself) in detail.
  const block = DB_SRC.match(/async function appendInternalNote\([\s\S]*?\n\}/);
  assert.ok(block, 'appendInternalNote body not located');
  const body = block[0];
  assert.match(body, /events\.record\(['"]import_request_internal_note_added['"]/);
  // Audit detail records the note id + length — NOT the body
  // itself. Same privacy posture as sprint 18 messages.
  assert.match(body, /detail: \{ noteId: note\.id, length: trimmed\.length \}/);
  // Drift-guard against a refactor leaking the body into the
  // chain — exhaustive scan, not a presence check.
  const recordCall = body.match(/events\.record\(['"]import_request_internal_note_added['"][\s\S]*?\}\);/);
  assert.ok(recordCall);
  assert.ok(!/body: trimmed/.test(recordCall[0]), 'body leaked into audit detail');
});

// ── Audit allowlist + per-request CSV taxonomy ────────────────────

test('events.ALLOWED_TYPES includes import_request_internal_note_added (silent-drop guard)', () => {
  // Sprint 14 lesson — types not in ALLOWED_TYPES are silently
  // dropped, which would break the data-layer's
  // audit-log-before-success guarantee.
  assert.ok(events.ALLOWED_TYPES.has('import_request_internal_note_added'));
});

test('IMPORT_REQUEST_AUDIT_EVENT_TYPES set in the handler includes the new event', () => {
  // Per-request audit CSV (sprint 35) filters by this set; a new
  // lifecycle event not added would silently disappear from the
  // export.
  const block = HANDLER_SRC.match(/const IMPORT_REQUEST_AUDIT_EVENT_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, 'IMPORT_REQUEST_AUDIT_EVENT_TYPES not located');
  assert.match(block[1], /['"]import_request_internal_note_added['"]/);
});

// ── Handler: write path ───────────────────────────────────────────

test('Handler routes POST /api/imports/<id>/notes → handlePostInternalNote (POST-only)', () => {
  // Drift-guard pins both the action segment match + the
  // method gate + the handler reference.
  assert.match(HANDLER_SRC, /if \(action === ['"]notes['"]\)/);
  assert.match(HANDLER_SRC, /notes requires POST/);
  assert.match(HANDLER_SRC, /return handlePostInternalNote\(req, res, ctx, externalId\)/);
});

test('handlePostInternalNote requires ops role (a customer hitting this gets 403)', () => {
  // The first await is requireOpsRole; without it, ANY signed-in
  // org member could write internal notes that ops would later
  // treat as authoritative.
  const block = HANDLER_SRC.match(/async function handlePostInternalNote\([\s\S]*?\n\}/);
  assert.ok(block, 'handlePostInternalNote body not located');
  const body = block[0];
  assert.match(body, /const guard = await requireOpsRole\(req, res, ctx\)/);
  assert.match(body, /if \(!guard\) return/);
});

test('handlePostInternalNote forwards 400 validation errors from the data layer', () => {
  // The data layer returns ["body cannot be empty"] / ["body must
  // be <= 4000 chars"]; the handler maps these to 400 (not the
  // default 500). Source-pinned.
  const block = HANDLER_SRC.match(/async function handlePostInternalNote\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /required\|must be\|<=\|empty/);
  assert.match(body, /jsonResponse\(res, 400/);
});

// ── Handler: read path REDACTION (the load-bearing guard) ─────────

test('CRITICAL: handleGet REDACTS internalNotes to [] when caller is NOT ops', () => {
  // The load-bearing security guard. A customer hitting their
  // OWN request detail via /api/imports/<id> must NOT receive
  // internal notes. Source-pin the redaction.
  const block = HANDLER_SRC.match(/async function handleGet\([\s\S]*?\n\}/);
  assert.ok(block, 'handleGet body not located');
  const body = block[0];
  // The role resolution happens before the projection.
  assert.match(body, /const callerIsOps = isOpsRole\(role\) \|\| ctx\.isApiKey === true/);
  // The augmented object replaces internalNotes with [] for
  // non-ops readers — NOT undefined (which would let a confused
  // client retain stale data). Sprint 61 wrapped the ops branch
  // in a soft-delete filter; either form satisfies the redaction
  // contract — the gate (callerIsOps ? … : []) is what we pin.
  assert.match(
    body,
    /internalNotes: callerIsOps[\s\S]{0,160}: \[\]/,
  );
});

test('handleGet treats bearer-auth (sprint 45) as ops-equivalent for the redaction gate', () => {
  // Sprint 45 wired bearer tokens to pass requireOpsRole; the
  // sprint-55 redaction must honour the SAME contract — bearer
  // contexts are admin-created so they see internal notes.
  // Drift-guard against a refactor that re-derives the gate
  // and accidentally tightens it for bearers.
  const block = HANDLER_SRC.match(/async function handleGet\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  // The bearer short-circuit before the lookupCtxRole DB call —
  // mirrors the sprint-45 ordering pattern.
  assert.match(body, /if \(ctx\.isApiKey\) \{\s*role = 'api_key';/);
});

// ── TS mirror ──────────────────────────────────────────────────────

test('TS ImportRequestInternalNote interface mirrors the JS shape (NO role field — implicit)', () => {
  // Notes are inherently ops-only — there's no customer-side
  // counterpart, so unlike ImportRequestMessage there's no role
  // field. Drift-guard pins the no-role-field shape.
  const block = API_TS.match(/export interface ImportRequestInternalNote \{[\s\S]*?\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /id: string;/);
  assert.match(body, /body: string;/);
  assert.match(body, /byEmailHash: string;/);
  assert.match(body, /at: string;/);
  assert.ok(!/role:/.test(body), 'ImportRequestInternalNote must NOT have a role field');
});

test('TS ImportRequest extends with optional internalNotes field', () => {
  assert.match(API_TS, /internalNotes\?: ImportRequestInternalNote\[\];/);
});

test('TS IMPORT_REQUEST_INTERNAL_NOTE_BODY_MAX = 4000 exported (matches server)', () => {
  assert.match(API_TS, /export const IMPORT_REQUEST_INTERNAL_NOTE_BODY_MAX = 4000;/);
});

test('TS ImportRequestInternalNoteResponse interface defined', () => {
  // The POST response shape — drift-guard against a refactor
  // that returned a bare note without the wrapper.
  assert.match(API_TS, /export interface ImportRequestInternalNoteResponse \{[\s\S]*?ok: boolean;[\s\S]*?importRequest: ImportRequest;[\s\S]*?note: ImportRequestInternalNote;[\s\S]*?\}/);
});

// ── UI: ops-only render gate ──────────────────────────────────────

test('Detail page renders <InternalNotesPanel> ONLY when isOpsRole is true', () => {
  // The client-side gate is the second layer of defence (the
  // server-side redaction is the first). Pin the conditional —
  // a refactor that always-rendered would let a hand-crafted
  // payload exposing internalNotes leak into the customer view.
  assert.match(DETAIL_TSX, /\{isOpsRole && \(\s*<InternalNotesPanel/);
});

test('InternalNotesPanel POSTs to /imports/<id>/notes with { body }', () => {
  // The wire shape the handler expects. Drift-guard against the
  // path getting renamed.
  const block = DETAIL_TSX.match(/function InternalNotesPanel\([\s\S]*?(?=\nfunction MessageBubble)/);
  assert.ok(block, 'InternalNotesPanel body not located');
  const body = block[0];
  assert.match(
    body,
    /apiPost<ImportRequestInternalNoteResponse>\(\s*`\/imports\/\$\{request\.externalId\}\/notes`/,
  );
  assert.match(body, /\{ body: trimmed \}/);
});

test('InternalNotesPanel caps input body at IMPORT_REQUEST_INTERNAL_NOTE_BODY_MAX (4000 chars)', () => {
  // Server validates anyway, but client-side truncation gives
  // immediate feedback + prevents accidentally pasting a huge
  // doc.
  const block = DETAIL_TSX.match(/function InternalNotesPanel\([\s\S]*?(?=\nfunction MessageBubble)/);
  assert.ok(block);
  assert.match(block[0], /e\.target\.value\.slice\(0, IMPORT_REQUEST_INTERNAL_NOTE_BODY_MAX\)/);
});

test('InternalNotesPanel renders each note with body + actor + timestamp', () => {
  const block = DETAIL_TSX.match(/function InternalNotesPanel\([\s\S]*?(?=\nfunction MessageBubble)/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /\{n\.body\}/);
  // Actor identifier surfaces as truncated emailHash (privacy +
  // readability — full hash is too long to scan).
  assert.match(body, /n\.byEmailHash\.slice\(0, 8\)/);
  assert.match(body, /new Date\(n\.at\)\.toLocaleString\(['"]en-IE['"]\)/);
});

test('InternalNotesPanel surfaces the "INTERNAL · ops-only" eyebrow so ops never confuses these with customer messages', () => {
  // Visual distinction prevents the worst-case bug: an ops admin
  // typing customer-facing content into the wrong panel. Pin
  // the eyebrow copy + the explicit warning paragraph.
  const block = DETAIL_TSX.match(/function InternalNotesPanel\([\s\S]*?(?=\nfunction MessageBubble)/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /Internal notes · ops-only/);
  assert.match(body, /customer never sees these/i);
});
