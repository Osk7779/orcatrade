'use strict';

// Sprint 36 — org-wide audit log CSV export.
//
// Extends the sprint-35 per-request audit (one request → one file) to
// the org-scope (every request → one file). Same IMPORT_REQUEST_AUDIT_
// EVENT_TYPES taxonomy, same chain-stamp redaction, same RFC-4180
// format. Different scope:
//   - reuses events.listForOrg (newest-first, org-scoped) instead of
//     listForEntity
//   - adds an "External ID" column because rows span requests
//   - 5000-event ceiling (vs the per-request 2000) — same posture as
//     the sprint-34 list CSV export
//   - filename = orcatrade-audit-org-YYYY-MM-DD.csv
//   - ops-only via requireOpsRole (same gate as sprint-17 Insights)
//
// The two audit exports MUST share the same event taxonomy + the same
// chain-stamp redaction so the per-request CSV and the org-wide CSV
// agree on every row that spans both. Drift-guard pins both.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// ── Handler routing + reserved-keyword discipline ─────────────────

test('imports handler routes /api/imports/audit.csv (org-wide) → handleOrgAuditCsv', () => {
  // Reserved-keyword pattern: external IDs are 'ir_<16hex>' and never
  // collide with the literal "audit.csv". Same dispatch shape as the
  // sprint-34 export.csv route + sprint-17 insights route.
  assert.match(HANDLER_SRC, /externalId === ['"]audit\.csv['"] && !action/);
  assert.match(HANDLER_SRC, /handleOrgAuditCsv\(req, res, ctx\)/);
  assert.match(HANDLER_SRC, /async function handleOrgAuditCsv\(/);
});

test('handleOrgAuditCsv is GET-only — every other method 405s', () => {
  assert.match(
    HANDLER_SRC,
    /if \(req\.method !== ['"]GET['"]\) return jsonResponse\(res, 405, \{ error: ['"]audit\.csv \(org\) requires GET['"]/,
  );
});

test('handleOrgAuditCsv is ops-only (requireOpsRole gate same as sprint-17 Insights)', () => {
  // The org-wide perspective is for ops/admin/auditors. A non-ops org
  // member still gets the per-request audit via the detail page. Drift-
  // guard pins the requireOpsRole call as the FIRST await of the body
  // so the gate runs before any data fetch (no data leak via timing).
  const block = HANDLER_SRC.match(/async function handleOrgAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block, 'handleOrgAuditCsv body not located');
  const body = block[0];
  assert.match(body, /const guard = await requireOpsRole\(req, res, ctx\)/);
  assert.match(body, /if \(!guard\) return/);
  // Guard precedes the events.listForOrg call (drift-guard against
  // accidental reordering that would expose org events to non-ops).
  const guardIdx = body.indexOf('requireOpsRole');
  const fetchIdx = body.indexOf('events.listForOrg');
  assert.ok(guardIdx >= 0 && fetchIdx >= 0 && guardIdx < fetchIdx, 'requireOpsRole must precede events.listForOrg');
});

// ── Event taxonomy reuse (shared with sprint 35) ──────────────────

test('handleOrgAuditCsv reuses the sprint-35 IMPORT_REQUEST_AUDIT_EVENT_TYPES taxonomy', () => {
  // Both exports MUST agree on row inclusion. Sharing the set is the
  // ONLY way to guarantee that a per-request CSV row and an org-wide
  // CSV row spanning the same event are bit-identical (modulo column
  // shape). Drift-guard pins the filter expression.
  const block = HANDLER_SRC.match(/async function handleOrgAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /IMPORT_REQUEST_AUDIT_EVENT_TYPES\.has\(e\.type\)/);
});

test('handleOrgAuditCsv reuses redactTimelineEvent (same chain-stamp stripping as sprint 35)', () => {
  // _seq + _hash + _prevHash are tamper-detection metadata. NOT
  // audit-reader content. The two exports must redact identically so
  // a customer comparing the two never sees a divergence.
  const block = HANDLER_SRC.match(/async function handleOrgAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /\.map\(redactTimelineEvent\)/);
});

test('Every IMPORT_REQUEST_AUDIT_EVENT_TYPES entry is also in events.ORG_ACTIVITY_TYPES', () => {
  // listForOrg pre-filters by ORG_ACTIVITY_TYPES; an audit-set type
  // that's NOT in ORG_ACTIVITY_TYPES would be silently dropped by the
  // listForOrg helper before the handler's IMPORT_REQUEST_AUDIT_
  // EVENT_TYPES filter ever sees it. Cross-module drift-guard pins
  // the relationship: AUDIT ⊆ ORG_ACTIVITY.
  const auditBlock = HANDLER_SRC.match(/const IMPORT_REQUEST_AUDIT_EVENT_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(auditBlock);
  const auditTypes = [...auditBlock[1].matchAll(/['"]([a-z_]+)['"]/g)].map((m) => m[1]);
  for (const t of auditTypes) {
    assert.ok(
      events.ORG_ACTIVITY_TYPES.has(t),
      `audit-set type "${t}" missing from events.ORG_ACTIVITY_TYPES — listForOrg would silently drop it`,
    );
  }
});

// ── Data fetch posture ────────────────────────────────────────────

test('handleOrgAuditCsv uses events.listForOrg scoped to ctx.orgIdNumeric', () => {
  // The fetch MUST be org-scoped via the numeric DB id. A bug that
  // omitted orgId would leak the entire global event log to the
  // requesting org. Pin the orgIdNumeric pass-through.
  const block = HANDLER_SRC.match(/async function handleOrgAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /events\.listForOrg\(\{[\s\S]*?orgId: ctx\.orgIdNumeric/);
});

test('handleOrgAuditCsv caps the event count at 5000 (vs per-request 2000)', () => {
  // 5000 mirrors the sprint-34 list CSV ceiling — the org-wide row
  // set is wider than per-request, but well below the 50k+ that
  // would warrant streaming.
  const block = HANDLER_SRC.match(/async function handleOrgAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /limit: 5000/);
});

// ── CSV response headers + shape ──────────────────────────────────

test('handleOrgAuditCsv response carries CSV headers + UTF-8 BOM + CRLF', () => {
  // Same RFC-4180 + Excel-compat posture as sprint-34 (list CSV) and
  // sprint-35 (per-request audit CSV).
  const block = HANDLER_SRC.match(/async function handleOrgAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /Content-Type['"], ['"]text\/csv; charset=utf-8['"]/);
  assert.match(body, /Content-Disposition['"], `attachment; filename="\$\{filename\}"`/);
  assert.match(body, /Cache-Control['"], ['"]no-store['"]/);
  // BOM (U+FEFF) prepended to first line.
  assert.match(body, /['"]﻿['"]\s*\+\s*columns/);
  // CRLF.
  assert.match(body, /lines\.join\(['"]\\r\\n['"]\)/);
});

test('handleOrgAuditCsv filename uses the org-wide pattern (no externalId, date-stamped)', () => {
  // Filename = orcatrade-audit-org-YYYY-MM-DD.csv. The "-org-" infix
  // disambiguates from the sprint-35 per-request filename
  // (orcatrade-audit-<externalId>-...).
  const block = HANDLER_SRC.match(/async function handleOrgAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /orcatrade-audit-org-\$\{new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\}\.csv/);
});

test('handleOrgAuditCsv adds an "External ID" column (new vs sprint-35 per-request)', () => {
  // Rows span requests, so the entityId becomes a load-bearing
  // column. Drift-guard pins the 5-column shape + the entityId
  // source. Also asserts the column ordering puts External ID
  // after Event type but before Actor — the natural read order.
  const block = HANDLER_SRC.match(/async function handleOrgAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(
    body,
    /columns = \['Timestamp', 'Event type', 'External ID', 'Actor email hash', 'Detail \(JSON\)'\]/,
  );
  // The entityId source per row.
  assert.match(body, /ev\.entityId \|\| ['"]['"]/);
});

test('handleOrgAuditCsv per-row detail JSON preserves before + after + detail', () => {
  // Same load-bearing projection as sprint-35 per-request audit
  // (audit chain's state-change reconstruction fields). The free-text
  // bodies (messages, rating comments) STAY ON THE ROW, never in
  // detail — same privacy posture as sprint-35.
  const block = HANDLER_SRC.match(/async function handleOrgAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /before: ev\.before,[\s\S]*?after: ev\.after,[\s\S]*?detail: ev\.detail/);
});

// ── UI ────────────────────────────────────────────────────────────

test('Ops Insights header renders an "Export org audit (CSV)" link', () => {
  // Sits in the window-size toggle row, right-aligned via ml-auto.
  // The link is the only natural placement: insights is the ops
  // cockpit's reporting surface, and the export is a reporting tool.
  assert.match(INSIGHTS_TSX, /Export org audit \(CSV\)/);
  assert.match(INSIGHTS_TSX, /href="\/api\/imports\/audit\.csv"/);
});

test('Ops Insights export link surfaces a title explaining the format + exhaustive scope', () => {
  // The actionable hint: "every recorded action across every request"
  // sets expectations — the audit spans the whole org, not the
  // current window or the rendered cohorts.
  assert.match(
    INSIGHTS_TSX,
    /title="Download the org's full audit log as CSV \(every recorded action across every request, UTF-8, RFC-4180\)"/,
  );
});
