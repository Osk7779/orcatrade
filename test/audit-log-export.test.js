'use strict';

// Sprint 35 — per-request audit log CSV export.
//
// Tests cover three layers:
//   1. IMPORT_REQUEST_AUDIT_EVENT_TYPES: exhaustive taxonomy (8 types
//      across the operator-wedge lifecycle); cross-checked against
//      events.js ALLOWED_TYPES so a future event type can't ship
//      without showing up in the audit export
//   2. Handler: route /api/imports/<id>/audit.csv; same org-gate as
//      handleHistory (row-fetch first); response headers
//      (Content-Type, Disposition, BOM, CRLF); detail JSON keeps
//      before + after + detail (the audit chain's load-bearing
//      fields)
//   3. UI: "Export audit (CSV)" link in the Activity section of the
//      detail page; href targets /api/imports/<id>/audit.csv;
//      title attribute names the format
//
// The "exhaustive taxonomy" promise is load-bearing. The on-screen
// TransitionHistory (sprint 7) is RESTRICTIVE (4 types) so the
// narrative reads cleanly; the export is EXHAUSTIVE because that's
// the entire point — an auditor downloading the trail wants every
// recorded action. Drift-guard pins the divergence between the two
// sets.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');
const DETAIL_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', '[externalId]', 'page.tsx'),
  'utf8',
);

// ── Audit event-type taxonomy ─────────────────────────────────────

test('IMPORT_REQUEST_AUDIT_EVENT_TYPES set carries all 8 operator-wedge lifecycle types', () => {
  // Exhaustive taxonomy: every import_request_* event we've added
  // across 30 sprints must appear in the export. A new lifecycle
  // event introduced without extending this set would be silently
  // omitted from the audit trail.
  const block = HANDLER_SRC.match(/const IMPORT_REQUEST_AUDIT_EVENT_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, 'IMPORT_REQUEST_AUDIT_EVENT_TYPES not located');
  const body = block[1];
  for (const type of [
    'import_request_created',
    'import_request_updated',
    'import_request_status_transition',
    'import_request_archived',
    'import_request_message_posted',          // sprint 18
    'import_request_evidence_attached',       // sprint 27
    'import_request_supplier_picked',         // sprint 28
    'import_request_rated',                   // sprint 30
  ]) {
    assert.match(body, new RegExp(`['"]${type}['"]`), `IMPORT_REQUEST_AUDIT_EVENT_TYPES missing: ${type}`);
  }
});

test('IMPORT_REQUEST_AUDIT_EVENT_TYPES is a STRICT SUPERSET of the timeline-narrative subset', () => {
  // Cross-check: every type in the narrative subset must also
  // appear in the audit export. The audit export is exhaustive;
  // the timeline is restrictive. A type that lives in the
  // timeline but NOT the audit set would be a contradiction (the
  // narrative would show events the auditor's CSV doesn't).
  const timelineBlock = HANDLER_SRC.match(/const IMPORT_REQUEST_TIMELINE_EVENT_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  const auditBlock = HANDLER_SRC.match(/const IMPORT_REQUEST_AUDIT_EVENT_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(timelineBlock && auditBlock);
  const timelineTypes = [...timelineBlock[1].matchAll(/['"]([a-z_]+)['"]/g)].map((m) => m[1]);
  const auditTypes = new Set(
    [...auditBlock[1].matchAll(/['"]([a-z_]+)['"]/g)].map((m) => m[1]),
  );
  for (const t of timelineTypes) {
    assert.ok(auditTypes.has(t), `timeline type "${t}" missing from audit set`);
  }
});

test('Every IMPORT_REQUEST_AUDIT_EVENT_TYPES entry is allowlisted in events.ALLOWED_TYPES', () => {
  // Cross-check across modules: the audit export filters by type;
  // a type that's in the audit set but NOT in events.ALLOWED_TYPES
  // would silently filter to 0 rows (a regression that produces an
  // empty CSV).
  const auditBlock = HANDLER_SRC.match(/const IMPORT_REQUEST_AUDIT_EVENT_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(auditBlock);
  const auditTypes = [...auditBlock[1].matchAll(/['"]([a-z_]+)['"]/g)].map((m) => m[1]);
  for (const t of auditTypes) {
    assert.ok(events.ALLOWED_TYPES.has(t), `audit-set type "${t}" missing from events.ALLOWED_TYPES`);
  }
});

// ── Handler routing + behaviour ────────────────────────────────────

test('imports handler routes /api/imports/<id>/audit.csv → handleAuditCsv', () => {
  assert.match(HANDLER_SRC, /if \(action === ['"]audit\.csv['"]\)/);
  assert.match(HANDLER_SRC, /handleAuditCsv\(req, res, ctx, externalId\)/);
  assert.match(HANDLER_SRC, /async function handleAuditCsv\(/);
});

test('handleAuditCsv is GET-only — every other method 405s', () => {
  assert.match(
    HANDLER_SRC,
    /if \(req\.method !== ['"]GET['"]\) return jsonResponse\(res, 405, \{ error: ['"]audit\.csv requires GET['"]/,
  );
});

test('handleAuditCsv enforces the same org gate as handleHistory (row-fetch first)', () => {
  // The row-fetch is the security boundary: a non-owner sees 404,
  // never a "this exists but isn\'t yours". Pin the
  // getImportRequestByExternalId call BEFORE the events fetch.
  const block = HANDLER_SRC.match(/async function handleAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block, 'handleAuditCsv body not located');
  const body = block[0];
  // The fetch is the first await
  assert.match(body, /getImportRequestByExternalId/);
  assert.match(body, /fetched\.notFound\) return jsonResponse\(res, 404/);
  // Then events.listForEntity
  assert.match(body, /events\.listForEntity/);
});

test('handleAuditCsv filters events to IMPORT_REQUEST_AUDIT_EVENT_TYPES (NOT the timeline subset)', () => {
  // The whole point: the export is exhaustive. Drift-guard pins
  // the audit-set filter (NOT the timeline subset which would
  // silently lose messages, evidence, picks, ratings).
  const block = HANDLER_SRC.match(/async function handleAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /IMPORT_REQUEST_AUDIT_EVENT_TYPES\.has\(e\.type\)/);
});

test('handleAuditCsv strips chain-stamp internals via redactTimelineEvent', () => {
  // The audit chain's _seq + _hash + _prevHash are tamper-detection
  // metadata, NOT audit-reader content. Pin the redaction.
  const block = HANDLER_SRC.match(/async function handleAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /\.map\(redactTimelineEvent\)/);
});

test('handleAuditCsv response carries CSV headers + UTF-8 BOM + CRLF', () => {
  // Same posture as sprint-34's imports/export.csv: UTF-8 charset,
  // attachment disposition with date-stamped filename, no-store
  // cache control, BOM prepended for Excel, CRLF row terminator.
  const block = HANDLER_SRC.match(/async function handleAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /Content-Type['"], ['"]text\/csv; charset=utf-8['"]/);
  assert.match(body, /Content-Disposition['"], `attachment; filename="\$\{filename\}"`/);
  assert.match(body, /Cache-Control['"], ['"]no-store['"]/);
  // BOM (U+FEFF) prepended to first line
  assert.match(body, /['"]﻿['"]\s*\+\s*columns/);
  // CRLF
  assert.match(body, /lines\.join\(['"]\\r\\n['"]\)/);
});

test('handleAuditCsv export filename includes the request external ID + date stamp', () => {
  // Filename pattern: orcatrade-audit-<externalId>-YYYY-MM-DD.csv
  // so a downloaded file is unambiguous on disk.
  const block = HANDLER_SRC.match(/async function handleAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /orcatrade-audit-\$\{externalId\}-/);
});

test('handleAuditCsv CSV body carries timestamp + type + actor + JSON detail per row', () => {
  // The 4-column shape: enough for an auditor to reconstruct
  // "who did what when, and what state changed." Pin the column
  // names + the JSON-stringify of before/after/detail.
  const block = HANDLER_SRC.match(/async function handleAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /columns = \['Timestamp', 'Event type', 'Actor email hash', 'Detail \(JSON\)'\]/);
  // The per-row detail JSON preserves before + after + detail.
  assert.match(body, /before: ev\.before,[\s\S]*?after: ev\.after,[\s\S]*?detail: ev\.detail/);
});

test('handleAuditCsv caps the per-request event count at 2000', () => {
  // Exhaustive ceiling: 2000 events is well above any real request
  // (the operator-wedge timeline tops out at ~50 events for a
  // chatty thread + many evidence attachments). Streaming for the
  // long-tail case is a follow-up.
  const block = HANDLER_SRC.match(/async function handleAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /limit: 2000/);
});

// ── UI ─────────────────────────────────────────────────────────────

test('Detail page Activity section renders an "Export audit (CSV)" link', () => {
  // Renders inside the Activity section's flex header next to the
  // "Activity" heading. Pin the text label + href shape.
  assert.match(DETAIL_TSX, /Export audit \(CSV\)/);
  assert.match(DETAIL_TSX, /href=\{`\/api\/imports\/\$\{request\.externalId\}\/audit\.csv`\}/);
});

test('Detail page Export audit link surfaces a title explaining the format + exhaustive scope', () => {
  // The actionable hint: "every recorded action" sets expectations
  // (auditor receives the full chain, not the narrative subset).
  assert.match(DETAIL_TSX, /title="Download full audit log as CSV \(every recorded action, UTF-8, RFC-4180\)"/);
});
