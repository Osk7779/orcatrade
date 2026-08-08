'use strict';

// Sprint 27 — compliance evidence attachments.
//
// Tests cover four layers:
//   1. Data layer: COMPLIANCE_REGIMES enum, appendEvidenceAttachment
//      input validation (regime, label, https URL, notes cap, soft
//      cap of 50 per request)
//   2. Audit: import_request_evidence_attached event allowlisted +
//      activity-feed-allowlisted; detail payload pins urlHost
//      (NOT the full URL — signed-link leakage protection)
//   3. Handler: routes /api/imports/<id>/evidence, returns 400 on
//      validation errors, 404 on not-found, 409 on cap, 201 on success
//   4. UI: EvidencePanel mounted above MessageThread, grouped by
//      regime, inline add form with regime select + label + URL +
//      notes, only enables submit when URL is https://, safe host
//      extraction in URL render
//
// The URL validation is load-bearing — the panel renders the URL as
// a clickable link. Without https-only enforcement, a "javascript:"
// or "data:" URL would XSS every viewer of the request. Pinning both
// the data-layer regex AND the UI's canSubmit gate.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequestsDb = require('../lib/db/import-requests');
const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');
const SCHEMA_SRC = fs.readFileSync(
  path.join(ROOT, 'lib', 'db', 'schema-017-import-request-evidence.sql'),
  'utf8',
);
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const DETAIL_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', '[externalId]', 'page.tsx'),
  'utf8',
);
const HISTORY_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'components', 'TransitionHistory.tsx'),
  'utf8',
);

// ── Data layer constants ────────────────────────────────────────────

test('COMPLIANCE_REGIMES is frozen and covers the 5 v1 buckets', () => {
  assert.ok(Object.isFrozen(importRequestsDb.COMPLIANCE_REGIMES));
  assert.deepEqual(
    [...importRequestsDb.COMPLIANCE_REGIMES],
    ['CBAM', 'EUDR', 'REACH', 'origin', 'other'],
  );
});

test('Evidence caps mirror the canonical values (label 200, notes 1000, 50 per request, url 2000)', () => {
  assert.equal(importRequestsDb.EVIDENCE_LABEL_MAX, 200);
  assert.equal(importRequestsDb.EVIDENCE_NOTES_MAX, 1000);
  assert.equal(importRequestsDb.EVIDENCE_MAX_PER_REQUEST, 50);
  assert.equal(importRequestsDb.EVIDENCE_URL_MAX, 2000);
});

// ── appendEvidenceAttachment input validation ─────────────────────

test('appendEvidenceAttachment rejects an unknown regime', async () => {
  const r = await importRequestsDb.appendEvidenceAttachment({
    orgId: 1, externalId: 'ir_test', actorEmailHash: 'h',
    regime: 'CITES', label: 'x', url: 'https://example.com/a',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /regime must be one of/.test(e)));
});

test('appendEvidenceAttachment rejects an empty label', async () => {
  const r = await importRequestsDb.appendEvidenceAttachment({
    orgId: 1, externalId: 'ir_test', actorEmailHash: 'h',
    regime: 'CBAM', label: '   ', url: 'https://example.com/a',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /label required/.test(e)));
});

test('appendEvidenceAttachment rejects a non-https URL (XSS guard)', async () => {
  // A javascript: or data: URL would XSS every viewer of the request
  // when the panel renders it as a clickable link. The data layer is
  // the chokepoint; pin the protocol gate.
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://example.com/insecure',
    'ftp://example.com/file',
    '/just/a/path',
  ]) {
    const r = await importRequestsDb.appendEvidenceAttachment({
      orgId: 1, externalId: 'ir_test', actorEmailHash: 'h',
      regime: 'CBAM', label: 'x', url,
    });
    assert.equal(r.ok, false, `URL "${url}" should be rejected`);
    assert.ok(r.errors.some((/** @type {string} */ e) => /https/.test(e)));
  }
});

test('appendEvidenceAttachment rejects URL containing whitespace (no header injection)', async () => {
  const r = await importRequestsDb.appendEvidenceAttachment({
    orgId: 1, externalId: 'ir_test', actorEmailHash: 'h',
    regime: 'CBAM', label: 'x', url: 'https://example.com/a b',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /https/.test(e)));
});

test('appendEvidenceAttachment rejects oversized notes', async () => {
  const r = await importRequestsDb.appendEvidenceAttachment({
    orgId: 1, externalId: 'ir_test', actorEmailHash: 'h',
    regime: 'CBAM', label: 'x', url: 'https://example.com/a',
    notes: 'x'.repeat(importRequestsDb.EVIDENCE_NOTES_MAX + 1),
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /notes must be <=/.test(e)));
});

// ── Audit-log integration ──────────────────────────────────────────

test('import_request_evidence_attached is allowlisted in events.ALLOWED_TYPES', () => {
  assert.ok(events.ALLOWED_TYPES.has('import_request_evidence_attached'));
});

test('import_request_evidence_attached is in ORG_ACTIVITY_TYPES (dashboard feed)', () => {
  assert.ok(events.ORG_ACTIVITY_TYPES.has('import_request_evidence_attached'));
});

test('appendEvidenceAttachment audit detail records urlHost (NOT the full URL)', () => {
  // Signed cloud-share links carry one-shot credentials. The audit
  // record must not leak the full URL — only the host so the reader
  // sees "evidence from drive.google.com" without the share token.
  // Pin the source.
  const block = DB_SRC.match(/async function appendEvidenceAttachment\([\s\S]*?\n\}/);
  assert.ok(block, 'appendEvidenceAttachment body not located');
  assert.match(block[0], /new URL\(trimmedUrl\)\.host/);
  assert.match(block[0], /detail:\s*\{\s*evidenceId[\s\S]*?urlHost/);
});

// ── Schema ──────────────────────────────────────────────────────────

test('schema-017 adds evidence_attachments JSONB array idempotently', () => {
  assert.match(SCHEMA_SRC, /ADD COLUMN IF NOT EXISTS evidence_attachments jsonb/);
  // Defensive CHECK ensures the value is always an array (data-layer
  // iteration code assumes Array.isArray()).
  assert.match(SCHEMA_SRC, /jsonb_typeof\(evidence_attachments\) = 'array'/);
  assert.match(SCHEMA_SRC, /DO \$\$[\s\S]*?ADD CONSTRAINT[\s\S]*?EXCEPTION[\s\S]*?WHEN duplicate_object/);
});

// ── Handler routing ────────────────────────────────────────────────

test('imports handler routes /api/imports/<id>/evidence → handlePostEvidence', () => {
  assert.match(HANDLER_SRC, /if \(action === ['"]evidence['"]\)/);
  assert.match(HANDLER_SRC, /handlePostEvidence\(req, res, ctx, externalId\)/);
  assert.match(HANDLER_SRC, /async function handlePostEvidence\(/);
});

test('handlePostEvidence maps validation errors to 400 (not 500)', () => {
  // "https" / "required" / "must be" / "<=" / "one of" all hit the
  // 400 branch. Pin the predicate so a refactor that swaps these
  // for 500s surfaces here.
  const block = HANDLER_SRC.match(/async function handlePostEvidence\([\s\S]*?\n\}/);
  assert.ok(block, 'handlePostEvidence body not located');
  const body = block[0];
  assert.match(body, /jsonResponse\(res, 400/);
  assert.match(body, /required|must be|<=|one of|https/);
});

test('handlePostEvidence maps cap-reached (conflict) to 409', () => {
  // Cap exhaustion is a client-actionable error (attach an index
  // doc instead). 409 lets the client distinguish it from a generic
  // 400 validation failure.
  const block = HANDLER_SRC.match(/async function handlePostEvidence\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /result\.conflict[\s\S]*?jsonResponse\(res, 409/);
});

test('handlePostEvidence is POST-only — every other method 405s', () => {
  assert.match(
    HANDLER_SRC,
    /if \(req\.method !== ['"]POST['"]\) return jsonResponse\(res, 405, \{ error: ['"]evidence requires POST['"]/,
  );
});

// ── TS mirror ───────────────────────────────────────────────────────

test('TS mirrors ComplianceRegime + EvidenceAttachment shape', () => {
  assert.match(API_TS, /export type ComplianceRegime =\s*['"]CBAM['"][\s\S]*?\|\s*['"]EUDR['"][\s\S]*?\|\s*['"]REACH['"][\s\S]*?\|\s*['"]origin['"][\s\S]*?\|\s*['"]other['"]/);
  assert.match(API_TS, /export interface EvidenceAttachment \{[\s\S]*?id: string[\s\S]*?regime: ComplianceRegime[\s\S]*?label: string[\s\S]*?url: string[\s\S]*?uploadedByEmailHash: string[\s\S]*?uploadedAt: string/);
  assert.match(API_TS, /export const EVIDENCE_LABEL_MAX = 200/);
});

test('TS ActivityEventType union covers import_request_evidence_attached', () => {
  assert.match(API_TS, /import_request_evidence_attached/);
});

test('activityEventSummary surfaces the regime tag for evidence attachments', () => {
  const block = API_TS.match(/export function activityEventSummary\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /case ['"]import_request_evidence_attached['"]:/);
  // The summary surfaces the regime tag, NOT the URL host (host
  // exposure belongs in the audit timeline panel).
  assert.match(body, /regime/);
});

test('TransitionHistory has a headline branch for the new event type (sprint-7 drift-guard composes)', () => {
  // The sprint-7 polymorphic component requires every emitted
  // import_request_* event to have a switch case. Without this,
  // the timeline drift-guard test fails.
  assert.match(HISTORY_TSX, /case ['"]import_request_evidence_attached['"]:/);
});

// ── UI ──────────────────────────────────────────────────────────────

test('EvidencePanel is mounted on the detail page', () => {
  assert.match(DETAIL_TSX, /<EvidencePanel/);
  assert.match(DETAIL_TSX, /function EvidencePanel\(/);
});

test('EvidencePanel is mounted BEFORE MessageThread (sprint-27 placement)', () => {
  // The evidence affordance sits above the thread because the
  // decline-with-reason path commonly asks for evidence ("attach
  // your EUDR DDS, then revise"); having it prominent shortens
  // that loop.
  const evIdx = DETAIL_TSX.indexOf('<EvidencePanel');
  const msgIdx = DETAIL_TSX.indexOf('<MessageThread');
  assert.ok(evIdx > -1 && msgIdx > -1);
  assert.ok(evIdx < msgIdx, 'EvidencePanel must be mounted BEFORE MessageThread');
});

test('EvidencePanel renders an empty-state coaching message when no attachments', () => {
  // The empty state should TEACH the user how the panel works
  // (URL-based, regime-tagged, picked up by the dossier) — not
  // just say "empty."
  assert.match(DETAIL_TSX, /No evidence attached yet/);
  assert.match(DETAIL_TSX, /SharePoint, Google Drive, DropBox/);
});

test('EvidencePanel inline add form enforces https URL on submit (client-side XSS guard)', () => {
  // Defense-in-depth: data layer rejects non-https, but the client
  // gate prevents the submit button from firing in the first place.
  // Pin the regex used in canSubmit.
  assert.match(DETAIL_TSX, /\/\^https:\\\/\\\/\[\^\\s\]\+\$\/i\.test\(url\.trim\(\)\)/);
});

test('EvidencePanel URL render uses safeHostFromUrl (try/catch guard) — never crashes on malformed entries', () => {
  // A historical bad row (legacy migration, manual KV-edit) must
  // not crash the panel when new URL() throws. Pin the try/catch.
  const block = DETAIL_TSX.match(/function safeHostFromUrl\([\s\S]*?\n\}/);
  assert.ok(block, 'safeHostFromUrl helper not located');
  assert.match(block[0], /try \{\s*return new URL\(rawUrl\)\.host;\s*\} catch/);
});

test('EvidencePanel link uses rel="noopener noreferrer nofollow" + target="_blank"', () => {
  // External cloud-share URLs go through a tab break. noopener +
  // noreferrer protect against tabnabbing + Referer leakage;
  // nofollow signals to search bots not to follow signed links
  // they might somehow encounter.
  assert.match(DETAIL_TSX, /target="_blank"\s+rel="noopener noreferrer nofollow"/);
});

test('EvidencePanel groups attachments by regime (single render pass via useMemo)', () => {
  // The render groups by regime BEFORE mapping to UI rows — avoids
  // re-filtering the array N×regimes times. Pin the useMemo + the
  // groupBy shape so a refactor doesn't accidentally degrade
  // render perf on a request with 50 attachments.
  assert.match(DETAIL_TSX, /const grouped = useMemo\(\(\) => \{/);
  assert.match(DETAIL_TSX, /Partial<Record<ComplianceRegime, EvidenceAttachment\[\]>>/);
});
