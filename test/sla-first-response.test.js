'use strict';

// Sprint 84 — first-response SLA (Track C phase 2).
//
// Created → first HUMAN ops action, 24h target. The load-bearing
// definitional invariant: the clock stops ONLY on human actions —
// a team review decision or an ops-role message. The automated
// orchestrator transition must NEVER stamp it (an instant machine
// response would make the metric trivially 100% — marketing, not
// measurement). Customer messages must not stamp it either (the
// customer answering themselves is not our response).
//
// Test layers:
//   1. Stamp discipline: review path unconditional COALESCE;
//      message path CASE-gated on role='ops'; the generic
//      transition writer does NOT touch the column (absence pin)
//   2. Reader + insights wiring (same calculator, same window,
//      24h constant)
//   3. Migration + projection + TS + card pins

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sla = require('../lib/intelligence/sla');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const MIGRATION_SQL = fs.readFileSync(
  path.join(ROOT, 'lib', 'db', 'schema-024-import-request-first-ops-action.sql'),
  'utf8',
);
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// ── Layer 1: stamp discipline ────────────────────────────────────

test('team-review writer stamps first_ops_action_at unconditionally (any decision IS a human response)', () => {
  const reviewBlock = DB_SRC.match(/SET status = \$1,\s*\n\s*team_review_state = \$2::jsonb,[\s\S]*?RETURNING \*/);
  assert.ok(reviewBlock, 'team-review UPDATE not found');
  assert.match(reviewBlock[0], /first_ops_action_at = COALESCE\(first_ops_action_at, now\(\)\),/);
});

test('message writer stamps ONLY on role=ops (CASE-gated in SQL, role as a bind param)', () => {
  const msgBlock = DB_SRC.match(/SET messages = messages \|\| \$1::jsonb,[\s\S]*?\);/);
  assert.ok(msgBlock, 'message UPDATE not found');
  assert.match(
    msgBlock[0],
    /first_ops_action_at = CASE WHEN \$4 = 'ops' THEN COALESCE\(first_ops_action_at, now\(\)\) ELSE first_ops_action_at END,/,
  );
  // role travels as the bind — never string-interpolated.
  assert.match(msgBlock[0], /\[JSON\.stringify\(\[message\]\), orgId, externalId, role\],/);
});

test('the AUTOMATED transition writer never touches the column (absence pin — the definitional invariant)', () => {
  // transitionImportRequestStatus is the orchestrator's path; an
  // instant machine transition stamping the clock would make the
  // first-response SLA trivially 100%.
  const genericBlock = DB_SRC.match(/metadata = COALESCE\(metadata, '\{\}'::jsonb\) \|\| \$2::jsonb,[\s\S]*?RETURNING \*/);
  assert.ok(genericBlock, 'generic transition UPDATE not found');
  assert.ok(
    !/first_ops_action_at/.test(genericBlock[0]),
    'automated transitions must NEVER stop the first-response clock',
  );
});

test('COALESCE everywhere — the clock stops at the FIRST human touch, later activity never moves it', () => {
  const stamps = DB_SRC.match(/first_ops_action_at = (?:CASE WHEN \$4 = 'ops' THEN )?COALESCE\(first_ops_action_at, now\(\)\)/g) || [];
  assert.equal(stamps.length, 2, 'exactly the two human-action writers stamp, both first-write-only');
});

// ── Layer 2: reader + wiring ─────────────────────────────────────

test('first-response cut mirrors the turnaround cut (window on the stamp, archived stays in, fail-open)', () => {
  const block = DB_SRC.match(/async function listFirstResponsesForSla\([\s\S]*?\n\}/);
  assert.ok(block, 'reader not found');
  const body = block[0];
  assert.match(body, /AND first_ops_action_at IS NOT NULL/);
  assert.match(body, /AND first_ops_action_at >= now\(\) - \(\$2 \|\| ' days'\)::interval/);
  assert.ok(!/archived_at/.test(body), 'archiving a slow response must not launder the SLA');
  assert.match(body, /catch \(_\) \{[\s\S]*?return \[\];/);
  // Mapped to the calculator's generic clock-pair shape.
  assert.match(body, /quotedAt: r\.first_ops_action_at instanceof Date/);
});

test('24h target constant + insights wiring through the calculator (no inline numbers)', () => {
  assert.equal(sla.SLA_FIRST_RESPONSE_TARGET_HOURS, 24);
  assert.match(DB_SRC, /const firstResponseRows = await listFirstResponsesForSla\(\{/);
  assert.match(DB_SRC, /targetHours: slaCalc\.SLA_FIRST_RESPONSE_TARGET_HOURS,/);
  assert.match(DB_SRC, /\n        slaFirstResponse,\n/);
});

test('the shared calculator scores first-response rows identically (runtime)', () => {
  // 24h target: hours 6,12,20,25,30,48,50,60,70,100 → within: 3/10.
  const mk = (h) => {
    const created = Date.parse('2026-07-01T00:00:00Z');
    return { createdAt: new Date(created).toISOString(), quotedAt: new Date(created + h * 3_600_000).toISOString() };
  };
  const out = sla.computeSlaAttainment(
    [6, 12, 20, 25, 30, 48, 50, 60, 70, 100].map(mk),
    { targetHours: sla.SLA_FIRST_RESPONSE_TARGET_HOURS },
  );
  assert.equal(out.targetHours, 24);
  assert.equal(out.sampleSize, 10);
  assert.equal(out.withinTargetPct, 30);
});

// ── Layer 3: migration + projection + TS + card ──────────────────

test('schema-024: column + partial index; the human-only definition is documented in the migration', () => {
  assert.match(MIGRATION_SQL, /ADD COLUMN IF NOT EXISTS first_ops_action_at timestamptz;/);
  assert.match(MIGRATION_SQL, /ON import_requests \(org_id, first_ops_action_at\)\s*\n\s*WHERE first_ops_action_at IS NOT NULL;/);
  assert.match(MIGRATION_SQL, /NOT the automated\s*\n?-*\s*orchestrator status transition/);
});

test('rowToImportRequest projects firstOpsActionAt', () => {
  assert.match(DB_SRC, /firstOpsActionAt: r\.first_ops_action_at instanceof Date/);
});

test('TS mirror: slaFirstResponse reuses the SLA shape (one shape, N commitments)', () => {
  assert.match(API_TS, /slaFirstResponse: OpsInsightsSlaQuoteTurnaround;/);
});

test('first-response card is ALWAYS rendered and names the automated-transition exclusion', () => {
  assert.match(INSIGHTS_TSX, /<SlaFirstResponseCard data=\{data\.slaFirstResponse\} \/>/);
  assert.ok(
    !/slaFirstResponse\.sampleSize > 0 && \(\s*<SlaFirstResponseCard/.test(INSIGHTS_TSX),
    'the card must not hide at sampleSize 0',
  );
  const card = INSIGHTS_TSX.match(/function SlaFirstResponseCard\([\s\S]*?\n\}\n/)[0];
  assert.match(card, /Automated\s*\n?\s*transitions never stop this clock\./);
  assert.match(card, /data-testid="sla-first-response-card"/);
});
