'use strict';

// Sprint 81 — actual outcome on import requests (Track B phase 2).
//
// The wedge's half of the Quote Accuracy Ledger loop: quotes had
// no capture of what the customer ACTUALLY paid; now post-approval
// the outcome lands as actual_outcome jsonb, the audit chain
// carries the deterministic variance, and /api/accuracy merges
// this corpus with the saved-plan actuals.
//
// Load-bearing contracts:
//   - Integer cents at the boundary (ADR 0004): landedEur →
//     Math.round(eur*100) once; variance is integer-cent delta +
//     1dp display pct.
//   - Status gate customer_approved (mirrors sprint-30 rating —
//     no fulfilled outcome exists earlier); conflict → 409.
//   - BOTH customer and ops can report (contrast with the
//     creator-only rating): ops often learns the outcome first.
//   - notes stay on the ROW; the audit detail carries cents +
//     variance + flags only.
//   - Event registered across EVERY registry (five-corners) —
//     the sprint-76 lesson.
//   - Ledger merge: scoreRow prefers integer estimateCents (no
//     float round-trip); the accuracy handler reads BOTH corpora
//     in parallel, each failing open independently.
//
// Test layers:
//   1. Data-layer validation runtime + recorder source pins
//   2. Ledger corpus reader + scoreRow generalisation runtime
//   3. Event five-corners
//   4. Handler route + RBAC-contrast + accuracy merge
//   5. Migration + TS + UI pins

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequestsDb = require('../lib/db/import-requests');
const ledger = require('../lib/intelligence/accuracy-ledger');
const events = require('../lib/events');
const webhooks = require('../lib/webhooks');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');
const ACCURACY_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'accuracy.js'), 'utf8');
const MIGRATION_SQL = fs.readFileSync(
  path.join(ROOT, 'lib', 'db', 'schema-022-import-request-actual-outcome.sql'),
  'utf8',
);
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const HISTORY_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'components', 'TransitionHistory.tsx'),
  'utf8',
);
const DETAIL_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', '[externalId]', 'page.tsx'),
  'utf8',
);

const RECORDER = DB_SRC.match(/async function recordImportRequestActual\([\s\S]*?\n\}/);

// ── Layer 1: data layer ───────────────────────────────────────────

test('recordImportRequestActual validates inputs before any DB work (runtime)', async () => {
  const missing = await importRequestsDb.recordImportRequestActual({
    externalId: 'ir_x', actorEmailHash: 'h', landedEur: 100,
  });
  assert.equal(missing.ok, false);
  for (const badEur of [0, -5, 1e10, 'forty-two', NaN, null]) {
    const r = await importRequestsDb.recordImportRequestActual({
      orgId: 1, externalId: 'ir_x', actorEmailHash: 'h', landedEur: badEur,
    });
    assert.equal(r.ok, false, `landedEur ${String(badEur)} must refuse`);
    assert.match(r.errors[0], /landedEur must be a positive number/);
  }
  const longNotes = await importRequestsDb.recordImportRequestActual({
    orgId: 1, externalId: 'ir_x', actorEmailHash: 'h', landedEur: 100,
    notes: 'x'.repeat(501),
  });
  assert.equal(longNotes.ok, false);
  assert.match(longNotes.errors[0], /notes must be <= 500/);
});

test('recorder: cents at the boundary, customer_approved gate, supersession flag, audit-before-success', () => {
  assert.ok(RECORDER, 'recordImportRequestActual not found');
  const body = RECORDER[0];
  // One conversion, at the boundary — integer arithmetic after.
  assert.match(body, /landedCents: Math\.round\(eur \* 100\),/);
  // Status gate mirrors sprint 30 (conflict → handler 409).
  assert.match(body, /if \(beforeRow\.status !== 'customer_approved'\) \{/);
  assert.match(body, /conflict: true,/);
  // Supersession preserved for the audit chain.
  assert.match(body, /const isSupersession = Boolean\(/);
  // The write + the audit event, in that order, before success.
  const updateIdx = body.indexOf('SET actual_outcome = $1::jsonb');
  const auditIdx = body.indexOf("events.record('import_request_actual_reported'");
  const returnIdx = body.indexOf('return { ok: true, importRequest, actual, variance');
  assert.ok(updateIdx > -1 && auditIdx > -1 && returnIdx > -1);
  assert.ok(updateIdx < auditIdx && auditIdx < returnIdx, 'ADR-0005 ordering');
});

test('variance is integer-cent delta + 1dp pct; audit detail carries cents + flags, NEVER the notes', () => {
  assert.ok(RECORDER);
  const body = RECORDER[0];
  assert.match(body, /deltaCents: actual\.landedCents - quoteCents,/);
  assert.match(body, /deltaPct: Math\.round\(\(\(actual\.landedCents - quoteCents\) \/ quoteCents\) \* 1000\) \/ 10,/);
  const detailBlock = body.match(/detail: \{[\s\S]*?\},\s*\n\s*\}\);/);
  assert.ok(detailBlock, 'audit detail block not found');
  assert.match(detailBlock[0], /landedCents: actual\.landedCents,/);
  assert.match(detailBlock[0], /hasNotes: trimmedNotes\.length > 0,/);
  assert.match(detailBlock[0], /isSupersession,/);
  assert.match(detailBlock[0], /\.\.\.\(variance !== null \? \{ variance \} : \{\}\),/);
  assert.ok(!/notes:/.test(detailBlock[0]), 'notes stay on the row, never in the chain');
});

// ── Layer 2: ledger corpus + scoreRow ─────────────────────────────

test('listActualOutcomesForLedger cuts rows with BOTH actual and quote, mapped to integer estimateCents', () => {
  const block = DB_SRC.match(/async function listActualOutcomesForLedger\([\s\S]*?\n\}/);
  assert.ok(block, 'corpus reader not found');
  const body = block[0];
  assert.match(body, /WHERE actual_outcome IS NOT NULL\s*\n\s*AND landed_quote->>'totalLandedCents' IS NOT NULL/);
  assert.match(body, /\(actual_outcome->>'landedCents'\)::bigint/);
  assert.match(body, /\(landed_quote->>'totalLandedCents'\)::bigint/);
  assert.match(body, /estimateCents: Number\(r\.estimate_cents\)/);
  // Fail-open: the ledger degrades to the plans corpus alone.
  assert.match(body, /catch \(_\) \{[\s\S]*?return \[\];/);
});

test('scoreRow prefers integer estimateCents (no float round-trip) and still refuses garbage (runtime)', () => {
  // Wedge-shape row: no snapshot at all.
  const s = ledger.scoreRow({ landedCents: 10750, estimateCents: 10000 });
  assert.ok(s);
  assert.equal(s.estimateCents, 10000);
  assert.equal(s.absErrorPct, 7.5);
  // estimateCents WINS over a contradictory snapshot.
  const both = ledger.scoreRow({
    landedCents: 10750,
    estimateCents: 10000,
    snapshot: { perShipmentLandedTotal: 999 },
  });
  assert.equal(both.estimateCents, 10000);
  // Garbage estimateCents falls through to the snapshot path…
  const fallthrough = ledger.scoreRow({
    landedCents: 10750,
    estimateCents: 0,
    snapshot: { perShipmentLandedTotal: 100 },
  });
  assert.equal(fallthrough.estimateCents, 10000);
  // …and with neither source the row refuses.
  assert.equal(ledger.scoreRow({ landedCents: 10750, estimateCents: -1 }), null);
});

// ── Layer 3: event five-corners ───────────────────────────────────

test('import_request_actual_reported registers across every registry (five-corners)', () => {
  assert.ok(events.ALLOWED_TYPES.has('import_request_actual_reported'));
  assert.ok(events.ORG_ACTIVITY_TYPES.has('import_request_actual_reported'));
  assert.ok(webhooks.WEBHOOK_EVENT_TYPES.includes('import_request_actual_reported'));
  const timelineBlock = HANDLER_SRC.match(/const IMPORT_REQUEST_TIMELINE_EVENT_TYPES = new Set\(\[[\s\S]*?\]\);/);
  assert.match(timelineBlock[0], /'import_request_actual_reported',/);
  const auditBlock = HANDLER_SRC.match(/const IMPORT_REQUEST_AUDIT_EVENT_TYPES = new Set\(\[[\s\S]*?\]\);/);
  assert.match(auditBlock[0], /'import_request_actual_reported',/);
  assert.match(API_TS, /\| 'import_request_actual_reported'/);
});

test('both renderers narrate the closed loop with the server variance verbatim', () => {
  assert.match(API_TS, /case 'import_request_actual_reported': \{/);
  assert.match(API_TS, /% vs quote/);
  assert.match(HISTORY_TSX, /case 'import_request_actual_reported': \{/);
  assert.match(HISTORY_TSX, /Actual outcome reported/);
  assert.match(HISTORY_TSX, /case 'import_request_actual_reported': return 'Actual';/);
  assert.match(HISTORY_TSX, /if \(t === 'import_request_actual_reported'\) return 'var\(--color-aqua\)';/);
});

// ── Layer 4: handler + accuracy merge ─────────────────────────────

test('POST /api/imports/<id>/actual routes to handleReportActual (405 otherwise, documented)', () => {
  assert.match(
    HANDLER_SRC,
    /if \(action === 'actual'\) \{\s*\n\s*if \(req\.method !== 'POST'\) return jsonResponse\(res, 405, \{ error: 'actual requires POST' \}\);/,
  );
  assert.match(HANDLER_SRC, /POST\s+\/api\/imports\/<externalId>\/actual\s+→ report actual landed outcome/);
});

test('handleReportActual: both sides can report (RBAC contrast with creator-only rating) + full status mapping', () => {
  const block = HANDLER_SRC.match(/async function handleReportActual\([\s\S]*?\n\}/);
  assert.ok(block, 'handleReportActual not found');
  const body = block[0];
  assert.ok(!/requireOpsRole/.test(body), 'ops must be able to report');
  assert.ok(!/creator/i.test(body), 'no creator-only gate — contrast with the rating handler');
  assert.match(body, /result\.conflict\) return jsonResponse\(res, 409/);
  assert.match(body, /result\.notFound\) return jsonResponse\(res, 404/);
  assert.match(body, /jsonResponse\(res, 400, \{ error: result\.errors\[0\] \}\)/);
});

test('/api/accuracy merges BOTH corpora in parallel, each failing open independently', () => {
  assert.match(
    ACCURACY_SRC,
    /const \[planRows, wedgeRows\] = await Promise\.all\(\[\s*\n\s*actuals\.listFromPg\(\{ limit: 10000 \}\),\s*\n\s*importRequests\.listActualOutcomesForLedger\(\{ limit: 10000 \}\),\s*\n\s*\]\);/,
  );
  assert.match(ACCURACY_SRC, /computeAccuracyLedger\(\[\.\.\.planRows, \.\.\.wedgeRows\]\)/);
  assert.match(ACCURACY_SRC, /corpus spans saved plans and fulfilled import requests/);
});

// ── Layer 5: migration + TS + UI ──────────────────────────────────

test('schema-022: jsonb column + object CHECK + partial ledger index', () => {
  assert.match(MIGRATION_SQL, /ADD COLUMN IF NOT EXISTS actual_outcome jsonb;/);
  assert.match(MIGRATION_SQL, /jsonb_typeof\(actual_outcome\) = 'object'/);
  assert.match(MIGRATION_SQL, /import_requests_actual_outcome_idx/);
  assert.match(MIGRATION_SQL, /WHERE actual_outcome IS NOT NULL;/);
});

test('rowToImportRequest projects actualOutcome with the object-shape guard', () => {
  assert.match(
    DB_SRC,
    /actualOutcome: \(r\.actual_outcome && typeof r\.actual_outcome === 'object' && !Array\.isArray\(r\.actual_outcome\)\)/,
  );
});

test('TS mirrors: ImportRequestActualOutcome + variance interfaces + ImportRequest field', () => {
  assert.match(API_TS, /export interface ImportRequestActualOutcome \{\s*\n\s*landedCents: number;/);
  assert.match(API_TS, /export interface ImportRequestActualVariance \{\s*\n\s*quoteCents: number;/);
  assert.match(API_TS, /actualOutcome\?: ImportRequestActualOutcome \| null;/);
});

test('detail page: panel gated on customer_approved, POSTs landedEur, caps notes, names the ledger', () => {
  assert.match(DETAIL_TSX, /\{request\.status === 'customer_approved' && \(\s*\n\s*<ActualOutcomePanel/);
  assert.match(DETAIL_TSX, /apiPost<\{ ok: boolean; importRequest: ImportRequest \}>\(\s*\n\s*`\/imports\/\$\{request\.externalId\}\/actual`,/);
  assert.match(DETAIL_TSX, /setNotes\(e\.target\.value\.slice\(0, 500\)\)/);
  assert.match(DETAIL_TSX, /Quote Accuracy Ledger/);
  // Revise affordance — supersession is a supported flow, not a hack.
  assert.match(DETAIL_TSX, /Revise\s*<\/button>/);
});
