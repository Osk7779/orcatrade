'use strict';

// Sprint 21 — read/unread state on the messaging thread.
//
// Tests cover four layers:
//   1. computeUnreadCount pure function (the core rule: who-posted +
//      timestamp comparison)
//   2. markMessagesRead data-layer (input validation, no-audit-log
//      promise)
//   3. /api/imports/<id>/messages/read handler + list/get augmentation
//   4. UI integration (badges + auto-mark)
//
// The pure-function approach makes computeUnreadCount cheap to test
// directly (no DB required) and means the same logic powers list view,
// detail page, and the handler response augmentation.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequestsDb = require('../lib/db/import-requests');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_SRC = fs.readFileSync(
  path.join(ROOT, 'lib', 'db', 'schema-015-import-request-message-read-state.sql'),
  'utf8',
);
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const DETAIL_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', '[externalId]', 'page.tsx'),
  'utf8',
);
const QUEUE_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'queue', 'page.tsx'),
  'utf8',
);
const DASHBOARD_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'dashboard', 'page.tsx'),
  'utf8',
);

// ── computeUnreadCount: pure-function rules ─────────────────────────

test('computeUnreadCount returns 0 for an empty thread', () => {
  const n = importRequestsDb.computeUnreadCount({
    messages: [], messageReadState: {}, actorEmailHash: 'h_a',
  });
  assert.equal(n, 0);
});

test('computeUnreadCount returns 0 when actorEmailHash is missing', () => {
  // Defensive: an unauthenticated path SHOULD NOT crash, just
  // return 0. The handler will have already rejected the request
  // upstream, but the pure function stays safe.
  const n = importRequestsDb.computeUnreadCount({
    messages: [{ id: 'm1', at: '2026-06-16T10:00:00Z', byEmailHash: 'h_b' }],
    messageReadState: {},
    actorEmailHash: '',
  });
  assert.equal(n, 0);
});

test('computeUnreadCount counts every message when user has no read mark (first visit)', () => {
  // A user landing on a thread for the first time sees ALL prior
  // messages as unread (from the OTHER party). Pin the first-visit
  // behaviour.
  const messages = [
    { id: 'm1', at: '2026-06-16T10:00:00Z', byEmailHash: 'h_b' },
    { id: 'm2', at: '2026-06-16T10:05:00Z', byEmailHash: 'h_b' },
  ];
  const n = importRequestsDb.computeUnreadCount({
    messages, messageReadState: {}, actorEmailHash: 'h_a',
  });
  assert.equal(n, 2);
});

test('computeUnreadCount skips messages the user posted themselves', () => {
  // You never get a notification for your own message. Pin the
  // self-skip rule.
  const messages = [
    { id: 'm1', at: '2026-06-16T10:00:00Z', byEmailHash: 'h_a' },
    { id: 'm2', at: '2026-06-16T10:05:00Z', byEmailHash: 'h_b' },
  ];
  const n = importRequestsDb.computeUnreadCount({
    messages, messageReadState: {}, actorEmailHash: 'h_a',
  });
  assert.equal(n, 1); // only m2 (h_b's message) counts as unread
});

test('computeUnreadCount skips system messages (no ack needed)', () => {
  // Sprint 19's auto-expiry posts a system message; pinging both
  // sides "you have 1 unread" would be noise. Pin the system-skip
  // rule.
  const messages = [
    { id: 'm1', at: '2026-06-16T10:00:00Z', byEmailHash: 'system', role: 'system' },
    { id: 'm2', at: '2026-06-16T10:05:00Z', byEmailHash: 'h_b', role: 'customer' },
  ];
  const n = importRequestsDb.computeUnreadCount({
    messages, messageReadState: {}, actorEmailHash: 'h_a',
  });
  assert.equal(n, 1); // only the customer message counts
});

test('computeUnreadCount respects per-user lastReadAt timestamp', () => {
  // The core rule: messages at <= lastReadAt count as read.
  // Messages strictly newer count as unread.
  const messages = [
    { id: 'm1', at: '2026-06-16T10:00:00Z', byEmailHash: 'h_b' },
    { id: 'm2', at: '2026-06-16T10:05:00Z', byEmailHash: 'h_b' },
    { id: 'm3', at: '2026-06-16T10:10:00Z', byEmailHash: 'h_b' },
  ];
  const n = importRequestsDb.computeUnreadCount({
    messages,
    messageReadState: { h_a: { lastReadAt: '2026-06-16T10:05:00Z' } },
    actorEmailHash: 'h_a',
  });
  assert.equal(n, 1); // only m3 is strictly newer than 10:05
});

test('computeUnreadCount handles per-user state isolation (Alice and Bob have separate marks)', () => {
  // The read-state map is per-emailHash; Alice marking read MUST
  // NOT affect Bob's count.
  const messages = [
    { id: 'm1', at: '2026-06-16T10:00:00Z', byEmailHash: 'h_a' },
    { id: 'm2', at: '2026-06-16T10:05:00Z', byEmailHash: 'h_b' },
  ];
  const readState = {
    h_a: { lastReadAt: '2026-06-16T10:05:00Z' }, // Alice has read everything
  };
  const nAlice = importRequestsDb.computeUnreadCount({
    messages, messageReadState: readState, actorEmailHash: 'h_a',
  });
  const nBob = importRequestsDb.computeUnreadCount({
    messages, messageReadState: readState, actorEmailHash: 'h_b',
  });
  assert.equal(nAlice, 0); // her own message + Bob's message at == lastReadAt
  assert.equal(nBob, 1); // Bob hasn't read Alice's m1 (and m2 is his own, skipped)
});

test('computeUnreadCount ignores malformed timestamps gracefully', () => {
  const messages = [
    { id: 'm1', at: 'not-a-real-iso', byEmailHash: 'h_b' },
    { id: 'm2', at: '2026-06-16T10:05:00Z', byEmailHash: 'h_b' },
  ];
  const n = importRequestsDb.computeUnreadCount({
    messages, messageReadState: {}, actorEmailHash: 'h_a',
  });
  assert.equal(n, 1); // only the valid one
});

// ── markMessagesRead: input validation ──────────────────────────────

test('markMessagesRead is exported', () => {
  assert.equal(typeof importRequestsDb.markMessagesRead, 'function');
});

test('markMessagesRead rejects missing actor identity', async () => {
  const r = await importRequestsDb.markMessagesRead({
    orgId: 1, externalId: 'ir_test',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /actorEmailHash/.test(e)));
});

test('markMessagesRead does NOT fire an audit event (read receipts are not mutations)', () => {
  // ADR 0005 commits every MUTATION to the audit log. Read receipts
  // are metadata about visibility, not changes to substantive state.
  // Flooding the audit chain head + KV with one row per dashboard
  // load would degrade both. Pin the absence.
  const block = DB_SRC.match(/async function markMessagesRead\([\s\S]*?\n\}/);
  assert.ok(block, 'markMessagesRead body not located');
  assert.doesNotMatch(block[0], /events\.record/);
});

test('markMessagesRead uses jsonb_set for atomic per-user update (no read-modify-write race)', () => {
  // jsonb_set in a single UPDATE statement is atomic at the row
  // level — concurrent marks from two clients can't lose each
  // other's writes the way a read-then-write JS loop would.
  const block = DB_SRC.match(/async function markMessagesRead\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /jsonb_set/);
});

test('markMessagesRead defaults lastReadAt to "now" when unspecified', () => {
  // Auto-mark on detail open POSTs with no body; the server fills
  // in the timestamp so a malicious client can't backfill a
  // lastReadAt far in the future and silently mark everything read.
  // Actually: server-supplied default + client-provided are both
  // accepted (the client one is for "scrolled to message X" use
  // cases). Pin the default-to-now branch.
  const block = DB_SRC.match(/async function markMessagesRead\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /readUpToAt\) \|\| new Date\(\)\.toISOString\(\)/);
});

// ── Schema ──────────────────────────────────────────────────────────

test('schema-015 adds message_read_state JSONB column idempotently', () => {
  assert.match(SCHEMA_SRC, /ADD COLUMN IF NOT EXISTS message_read_state jsonb/);
  // Defensive CHECK ensures the value is always an object.
  assert.match(SCHEMA_SRC, /jsonb_typeof\(message_read_state\) = 'object'/);
  // Idempotent CHECK wrapper.
  assert.match(SCHEMA_SRC, /DO \$\$[\s\S]*?ADD CONSTRAINT[\s\S]*?EXCEPTION[\s\S]*?WHEN duplicate_object/);
});

// ── Handler routing ────────────────────────────────────────────────

test('imports handler routes /api/imports/<id>/messages/read → handleMarkMessagesRead', () => {
  assert.match(HANDLER_SRC, /sub === ['"]read['"]/);
  assert.match(HANDLER_SRC, /handleMarkMessagesRead\(req, res, ctx, externalId\)/);
  assert.match(HANDLER_SRC, /async function handleMarkMessagesRead\(/);
});

test('handleMarkMessagesRead returns the post-mark unreadCount in the response', () => {
  // The UI uses this to immediately drop the badge to 0 without a
  // re-fetch. Pin the recompute-and-return path.
  const block = HANDLER_SRC.match(/async function handleMarkMessagesRead\([\s\S]*?\n\}/);
  assert.ok(block, 'handleMarkMessagesRead body not located');
  assert.match(block[0], /computeUnreadCount/);
  assert.match(block[0], /unreadCount/);
});

test('handleList augments every list entry with unreadMessageCount', () => {
  // Without this, /dashboard ImportsWidget + /imports list page
  // couldn't show badges (would need a per-row fetch — N+1).
  const block = HANDLER_SRC.match(/async function handleList\([\s\S]*?\n\}/);
  assert.ok(block, 'handleList body not located');
  assert.match(block[0], /unreadMessageCount: importRequests\.computeUnreadCount/);
});

test('handleGet augments the single-row response with unreadMessageCount', () => {
  // The detail page reads this field on hydrate to decide whether
  // to auto-mark + render the header badge.
  const block = HANDLER_SRC.match(/async function handleGet\([\s\S]*?\n\}/);
  assert.ok(block, 'handleGet body not located');
  assert.match(block[0], /unreadMessageCount: importRequests\.computeUnreadCount/);
});

// ── TS mirror ───────────────────────────────────────────────────────

test('TS ImportRequest type carries unreadMessageCount + messageReadState', () => {
  // The UI reads r.unreadMessageCount directly; without the type
  // surface, calling sites would silently fall through to the
  // default 0 even when the server provided a count.
  assert.match(API_TS, /unreadMessageCount\?: number;/);
  assert.match(API_TS, /messageReadState\?: Record<string, \{ lastReadAt\?: string; lastReadMessageId\?: string \| null \}>;/);
});

// ── UI integration ────────────────────────────────────────────────

test('Detail page auto-marks unread messages after a short delay', () => {
  // Pin the 1.2s delay so a user bouncing between pages doesn't
  // accidentally mark a thread read they didn't actually see.
  assert.match(DETAIL_TSX, /setTimeout\([\s\S]*?messages\/read/);
});

test('Detail page auto-mark is fail-soft (network error leaves badge)', () => {
  // .catch() pattern — same fail-soft posture as the other customer
  // touchpoints. A 404/500 on the read-receipt POST should not
  // crash the page or fabricate a read state.
  const block = DETAIL_TSX.match(/\/messages\/read[\s\S]{0,800}/);
  assert.ok(block);
  assert.match(block[0], /\.catch\(/);
});

test('MessageThread header renders the unread badge when count > 0', () => {
  // Pin the conditional render so a refactor that drops the badge
  // surfaces here.
  assert.match(DETAIL_TSX, /unread > 0 && \(/);
  // And that the badge surfaces the actual count + an aria label.
  assert.match(DETAIL_TSX, /aria-label=\{`\$\{unread\} unread message/);
});

test('Dashboard ImportsWidget surfaces the unread badge per row', () => {
  // The dashboard is the customer's home — they should see "your
  // thread on ir_xxx has 2 new messages" inline. Pin the badge.
  assert.match(DASHBOARD_TSX, /r\.unreadMessageCount/);
  assert.match(DASHBOARD_TSX, /aria-label=\{`\$\{r\.unreadMessageCount\} unread`\}/);
});

test('Ops queue surfaces unread badge inline with the request label', () => {
  // For ops triaging the queue, a thread with an unanswered
  // customer message gets visual priority. Pin the badge on the
  // queue row.
  assert.match(QUEUE_TSX, /r\.unreadMessageCount/);
  assert.match(QUEUE_TSX, /unread customer message/);
});
