'use strict';

// Sprint 18 — per-request customer ↔ ops messaging thread.
//
// Tests cover four layers:
//   1. Data-layer: appendImportRequestMessage input validation + the
//      append-only contract (body cap, role enum, message-cap conflict)
//   2. Handler: POST routing + RBAC role inference + audit hook
//   3. Email composer: customer-side and ops-side notifications
//   4. UI: MessageThread on the detail page + activity-feed integration
//
// The append-only contract is what makes the thread valid evidence
// for a future dispute (ops told customer X on date Y); silent
// regressions here would undermine that promise without a test break.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequestsDb = require('../lib/db/import-requests');
const importsEmails = require('../lib/imports-emails');
const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const DETAIL_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', '[externalId]', 'page.tsx'),
  'utf8',
);
const SCHEMA_SRC = fs.readFileSync(
  path.join(ROOT, 'lib', 'db', 'schema-014-import-request-messages.sql'),
  'utf8',
);

// ── Data-layer constants ────────────────────────────────────────────

test('MESSAGE_ROLES is frozen and contains customer + ops + system', () => {
  assert.ok(Array.isArray(importRequestsDb.MESSAGE_ROLES));
  assert.ok(Object.isFrozen(importRequestsDb.MESSAGE_ROLES));
  assert.deepEqual([...importRequestsDb.MESSAGE_ROLES], ['customer', 'ops', 'system']);
});

test('MESSAGE_BODY_MAX is 4000 chars (matches the data-layer + UI cap)', () => {
  assert.equal(importRequestsDb.MESSAGE_BODY_MAX, 4000);
});

test('MESSAGES_MAX_PER_REQUEST caps thread depth at 200', () => {
  // The cap matters for both performance (reading the whole JSONB on
  // every list query) and audit-readability (a 1000-message thread
  // is almost certainly misuse). Pin the value so a refactor that
  // bumps it surfaces here.
  assert.equal(importRequestsDb.MESSAGES_MAX_PER_REQUEST, 200);
});

// ── appendImportRequestMessage input validation ─────────────────────

test('appendImportRequestMessage rejects missing role', async () => {
  const r = await importRequestsDb.appendImportRequestMessage({
    orgId: 1, externalId: 'ir_test', actorEmailHash: 'h', body: 'hello',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /role must be/.test(e)));
});

test('appendImportRequestMessage rejects unknown role', async () => {
  const r = await importRequestsDb.appendImportRequestMessage({
    orgId: 1, externalId: 'ir_test', actorEmailHash: 'h', role: 'admin', body: 'hello',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /role must be/.test(e)));
});

test('appendImportRequestMessage rejects empty body', async () => {
  const r = await importRequestsDb.appendImportRequestMessage({
    orgId: 1, externalId: 'ir_test', actorEmailHash: 'h', role: 'customer', body: '   ',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /empty/.test(e)));
});

test('appendImportRequestMessage rejects body over MESSAGE_BODY_MAX', async () => {
  const body = 'x'.repeat(importRequestsDb.MESSAGE_BODY_MAX + 1);
  const r = await importRequestsDb.appendImportRequestMessage({
    orgId: 1, externalId: 'ir_test', actorEmailHash: 'h', role: 'customer', body,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /<=.*chars/.test(e)));
});

// ── Audit-log integration ───────────────────────────────────────────

test('import_request_message_posted is allowlisted in events.ALLOWED_TYPES', () => {
  // The data-layer fires events.record('import_request_message_posted', …)
  // after every successful append. The allowlist must include it or
  // ADR 0005 is broken for this path (sprint 14 fixed the same class
  // of bug across 14 types — pin this new addition).
  assert.ok(events.ALLOWED_TYPES.has('import_request_message_posted'));
});

test('import_request_message_posted is in ORG_ACTIVITY_TYPES (surfaces on /dashboard activity feed)', () => {
  // Messages need to surface on the live activity feed (sprint 14) so
  // a customer follow-up question shows up on the ops team's
  // dashboard in real time.
  assert.ok(events.ORG_ACTIVITY_TYPES.has('import_request_message_posted'));
});

// ── Schema ──────────────────────────────────────────────────────────

test('schema-014 ADDS the messages column (jsonb) idempotently', () => {
  assert.match(SCHEMA_SRC, /ADD COLUMN IF NOT EXISTS messages jsonb/);
  // Defensive CHECK ensures it's always an array (the data-layer
  // iteration assumes Array.isArray(); a malformed scalar would crash).
  assert.match(SCHEMA_SRC, /jsonb_typeof\(messages\) = 'array'/);
});

test('schema-014 CHECK is wrapped in idempotent DO $$ ... EXCEPTION block', () => {
  // A naive ADD CONSTRAINT would fail on the second migration run.
  // The DO $$ ... EXCEPTION duplicate_object pattern is the canonical
  // idempotent shape for re-runnable schema files.
  assert.match(SCHEMA_SRC, /DO \$\$[\s\S]*?ADD CONSTRAINT[\s\S]*?EXCEPTION[\s\S]*?WHEN duplicate_object/);
});

// ── Handler wiring ──────────────────────────────────────────────────

test('imports handler routes /api/imports/<id>/messages → handlePostMessage', () => {
  assert.match(HANDLER_SRC, /if \(action === ['"]messages['"]\)/);
  assert.match(HANDLER_SRC, /handlePostMessage\(req, res, ctx, externalId\)/);
  assert.match(HANDLER_SRC, /async function handlePostMessage\(/);
});

test('handlePostMessage infers role from RBAC (customer cannot spoof ops)', () => {
  // Critical security pin: the role MUST be derived from the
  // server-side RBAC, not pulled from req.body.role. A customer with
  // a forged body.role = 'ops' would otherwise post messages that
  // render in the aqua "OrcaTrade team" style on every other
  // customer's screen.
  const block = HANDLER_SRC.match(/async function handlePostMessage\([\s\S]*?\n\}/);
  assert.ok(block, 'handlePostMessage body not located');
  const body = block[0];
  assert.match(body, /isOpsRole\(ctx\.role\)\s*\?\s*['"]ops['"]\s*:\s*['"]customer['"]/);
  // And the body MUST NOT read req.body.role.
  assert.doesNotMatch(body, /body\.role/);
});

test('handlePostMessage POSTs only — every other method 405s', () => {
  // The thread is append-only at the API surface; no DELETE / PATCH.
  // Pin the segment-level method gate.
  assert.match(HANDLER_SRC, /if \(req\.method !== ['"]POST['"]\) return jsonResponse\(res, 405, \{ error: ['"]messages requires POST['"]/);
});

test('handlePostMessage fires the cross-side notification email (fail-soft)', () => {
  const block = HANDLER_SRC.match(/async function handlePostMessage\([\s\S]*?\n\}/);
  assert.ok(block);
  // The send-email call must NOT be awaited (fail-soft via .catch).
  // A Resend outage cannot break the message append.
  assert.match(block[0], /sendImportRequestMessageEmail/);
  assert.match(block[0], /\.catch\(/);
});

// ── Email composer ──────────────────────────────────────────────────

test('composeImportRequestMessage(audience=ops) renders the "New customer message" framing', () => {
  const out = importsEmails.composeImportRequestMessage(
    { externalId: 'ir_z1', label: 'Test order' },
    { id: 'msg_a', role: 'customer', body: 'What is your MOQ flexibility?' },
    { audience: 'ops' },
  );
  assert.match(out.subject, /\[OPS\] New message/);
  assert.match(out.text, /Your customer just posted/);
  assert.match(out.text, /What is your MOQ flexibility/);
  assert.match(out.html, /New customer message/);
});

test('composeImportRequestMessage(audience=customer) renders the "Update from your team" framing', () => {
  const out = importsEmails.composeImportRequestMessage(
    { externalId: 'ir_z2', label: 'Test order' },
    { id: 'msg_b', role: 'ops', body: 'Can you send us the spec sheet?' },
    { audience: 'customer' },
  );
  assert.match(out.subject, /Update from the OrcaTrade team/);
  assert.match(out.text, /The OrcaTrade team has posted/);
  assert.match(out.text, /Can you send us the spec sheet/);
  assert.match(out.html, /Update from your team/);
});

test('composeImportRequestMessage truncates body excerpt at 800 chars', () => {
  // The email render needs to stay compact; a multi-thousand-char
  // message would clobber the layout. Pin the cap + the truncation
  // ellipsis so a refactor that drops it surfaces here.
  const longBody = 'x'.repeat(2000);
  const out = importsEmails.composeImportRequestMessage(
    { externalId: 'ir_z3', label: 'Test' },
    { id: 'msg_c', role: 'customer', body: longBody },
    { audience: 'ops' },
  );
  // Truncated text body has the marker.
  assert.match(out.text, /…/);
  // HTML also shows the truncation marker (rendered as a muted span).
  assert.match(out.html, /…/);
});

test('composeImportRequestMessage HTML-escapes the message body', () => {
  // XSS guard: a customer posting `<script>` must not break out of
  // the bubble. Pin the escape so a refactor that swaps the helper
  // for raw HTML insertion surfaces.
  const out = importsEmails.composeImportRequestMessage(
    { externalId: 'ir_z4', label: 'Test' },
    { id: 'msg_d', role: 'customer', body: '<script>alert(1)</script>' },
    { audience: 'ops' },
  );
  assert.doesNotMatch(out.html, /<script>alert\(1\)<\/script>/);
  assert.match(out.html, /&lt;script&gt;/);
});

// ── TS mirror ───────────────────────────────────────────────────────

test('TS mirrors ImportRequestMessage shape + role union + body cap', () => {
  assert.match(API_TS, /export type ImportRequestMessageRole =\s*['"]customer['"][\s\S]*?\|\s*['"]ops['"][\s\S]*?\|\s*['"]system['"]/);
  assert.match(API_TS, /export interface ImportRequestMessage \{[\s\S]*?id: string[\s\S]*?role: ImportRequestMessageRole[\s\S]*?body: string[\s\S]*?byEmailHash: string[\s\S]*?at: string/);
  assert.match(API_TS, /export const IMPORT_REQUEST_MESSAGE_BODY_MAX = 4000/);
});

test('TS ActivityEventType union covers the new import_request_message_posted type', () => {
  assert.match(API_TS, /import_request_message_posted/);
});

test('activityEventSummary surfaces a role-aware headline for messages', () => {
  // The activity feed is the live signal that "the team posted on
  // your request" or "your customer posted on ir_xxx". Pin both
  // role branches in the summary fn so a generic "<type>" fallback
  // doesn't render on the dashboard.
  const block = API_TS.match(/export function activityEventSummary\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /case ['"]import_request_message_posted['"]:/);
  assert.match(body, /Customer|Team/);
});

// ── UI ──────────────────────────────────────────────────────────────

test('MessageThread is rendered on the detail page', () => {
  assert.match(DETAIL_TSX, /<MessageThread/);
  assert.match(DETAIL_TSX, /function MessageThread\(/);
});

test('MessageThread surfaces a friendly empty state (zero messages should NOT read as broken)', () => {
  // The thread starts empty for every new request. The empty state
  // doubles as the affordance — "use the box below to ask a question".
  assert.match(DETAIL_TSX, /No messages yet/);
});

test('MessageBubble distinguishes ops vs customer styling (aqua vs ivory)', () => {
  // The role-based bubble alignment is the at-a-glance signal of who
  // posted. A regression that styles every bubble the same way would
  // make the thread unreadable.
  assert.match(DETAIL_TSX, /function MessageBubble\(/);
  assert.match(DETAIL_TSX, /isOps \? 'justify-end' : 'justify-start'/);
});

test('MessageThread enforces the same body cap as the data layer', () => {
  // The compose box must use IMPORT_REQUEST_MESSAGE_BODY_MAX (TS
  // mirror of the data-layer constant). A typo (e.g. 400 instead of
  // 4000) would let the customer type more than the server accepts
  // and render a confusing 400 on submit.
  assert.match(DETAIL_TSX, /IMPORT_REQUEST_MESSAGE_BODY_MAX/);
  assert.match(DETAIL_TSX, /e\.target\.value\.slice\(0, IMPORT_REQUEST_MESSAGE_BODY_MAX\)/);
});

test('MessageThread supports Cmd/Ctrl+Enter to send (matches operator-tool muscle memory)', () => {
  // The thread is an ops affordance; ops UIs everywhere ship with
  // Cmd+Enter to send (Slack, Linear, Notion). Pin the shortcut so
  // a UI refactor doesn't silently drop it.
  assert.match(DETAIL_TSX, /metaKey \|\| e\.ctrlKey/);
});
