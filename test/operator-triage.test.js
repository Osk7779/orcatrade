'use strict';

// Sprint 87 — cross-org operator triage console (Track E).
//
// One screen, the whole book of business: per-org open work ranked
// by SLA risk → € at stake → review queue. The surface that lets
// one operator run a hundred orgs.
//
// Load-bearing invariants:
//   - AUTH FIRST. The endpoint crosses org boundaries; verifyAdmin
//     (platform-staff allowlist) runs BEFORE any query. Positional
//     pin enforces. Org-scoped sessions get 401 and the page
//     renders its team-only state — no cross-org data ever reaches
//     a customer browser.
//   - Deterministic ranking IN SQL (no LLM anywhere near it):
//     sla_risk DESC, open_quote_value_cents DESC,
//     awaiting_review DESC.
//   - The risk line is DERIVED from the SLA target (75% of 48h =
//     36h), never hand-set — a future target change moves it.
//   - Worklist semantics: archived rows excluded (contrast with
//     the SLA attainment cut, where archived stays in — one is a
//     worklist, the other a track record).
//   - No cache — a stale worklist double-works a row.
//
// Test layers:
//   1. Risk-line derivation runtime
//   2. Aggregation SQL pins
//   3. Handler auth-first + posture pins
//   4. Router + TS + console page pins

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sla = require('../lib/intelligence/sla');
const importRequestsDb = require('../lib/db/import-requests');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'operator-triage.js'), 'utf8');
const ROUTER_SRC = fs.readFileSync(path.join(ROOT, 'api', '[...path].js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const PAGE_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'operator', 'page.tsx'),
  'utf8',
);

// ── Layer 1: risk line ───────────────────────────────────────────

test('the risk line derives from the SLA target: 75% of 48h = 36h (runtime)', () => {
  assert.equal(sla.SLA_RISK_FRACTION, 0.75);
  assert.equal(sla.slaRiskThresholdHours(), 36);
  assert.equal(
    sla.slaRiskThresholdHours(),
    Math.round(sla.SLA_QUOTE_TURNAROUND_TARGET_HOURS * sla.SLA_RISK_FRACTION),
    'the line must move if the target moves',
  );
});

test('aggregateOperatorTriage refuses cleanly when the DB is not configured (runtime)', async () => {
  const r = await importRequestsDb.aggregateOperatorTriage({ slaRiskHours: 36 });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /not configured/i);
});

// ── Layer 2: aggregation SQL ─────────────────────────────────────

test('triage SQL: per-org counts, value at stake in cents, SLA-risk filter over unquoted rows', () => {
  const block = DB_SRC.match(/async function aggregateOperatorTriage\([\s\S]*?\n\}/);
  assert.ok(block, 'aggregateOperatorTriage not found');
  const body = block[0];
  assert.match(body, /COUNT\(\*\) FILTER \(WHERE r\.status = 'awaiting_review'\)::int AS awaiting_review/);
  assert.match(body, /SUM\(\(r\.landed_quote->>'totalLandedCents'\)::bigint\)/);
  // SLA risk: unquoted, pre-quote statuses, past the derived line.
  assert.match(body, /WHERE r\.quoted_at IS NULL/);
  assert.match(body, /AND r\.status IN \('submitted', 'processing', 'awaiting_review'\)/);
  assert.match(body, /AND r\.created_at < now\(\) - \(\$1 \|\| ' hours'\)::interval/);
});

test('ranking is deterministic and IN SQL: sla_risk → value → review queue', () => {
  assert.match(
    DB_SRC,
    /ORDER BY sla_risk DESC, open_quote_value_cents DESC, awaiting_review DESC/,
  );
});

test('worklist semantics: archived rows are OUT (contrast with the SLA track-record cut)', () => {
  const block = DB_SRC.match(/async function aggregateOperatorTriage\([\s\S]*?\n\}/);
  assert.match(block[0], /WHERE r\.archived_at IS NULL/);
});

// ── Layer 3: handler ─────────────────────────────────────────────

test('AUTH FIRST — verifyAdmin runs before the aggregation (positional pin)', () => {
  const authIdx = HANDLER_SRC.indexOf('await adminAuth.verifyAdmin(req)');
  const queryIdx = HANDLER_SRC.indexOf('aggregateOperatorTriage(');
  assert.ok(authIdx > -1, 'verifyAdmin gate missing');
  assert.ok(queryIdx > -1, 'aggregation call missing');
  assert.ok(authIdx < queryIdx, 'nothing cross-org may compute before the staff gate');
  // The verdict's own status code (401 unauthenticated / 503
  // unconfigured) travels through.
  assert.match(HANDLER_SRC, /return json\(res, verdict\.statusCode, \{ error: verdict\.error \}\)/);
});

test('no cache — a stale worklist double-works a row', () => {
  assert.match(HANDLER_SRC, /res\.setHeader\('Cache-Control', 'no-store'\)/);
  assert.ok(!/kv\.set|CACHE_KEY/.test(HANDLER_SRC), 'the triage feed must never be cached');
});

test('the risk line + target travel in the response so the console names its own derivation', () => {
  assert.match(HANDLER_SRC, /slaRiskThresholdHours: slaRiskHours,/);
  assert.match(HANDLER_SRC, /slaTargetHours: slaCalc\.SLA_QUOTE_TURNAROUND_TARGET_HOURS,/);
});

// ── Layer 4: router + TS + page ──────────────────────────────────

test('router registers /api/operator-triage with the admin-gate note', () => {
  assert.match(ROUTER_SRC, /'operator-triage': require\('\.\.\/lib\/handlers\/operator-triage'\),/);
  assert.match(ROUTER_SRC, /ADMIN-GATED \(verifyAdmin\)/);
});

test('TS mirrors: OperatorTriageRow + response shape', () => {
  assert.match(
    API_TS,
    /export interface OperatorTriageRow \{[\s\S]*?openQuoteValueCents: number;[\s\S]*?slaRisk: number;\s*\n\}/,
  );
  assert.match(API_TS, /slaRiskThresholdHours: number;/);
});

test('console page: forbidden state for org-scoped sessions; ranked table; derivation named in copy', () => {
  assert.match(PAGE_TSX, /if \(err instanceof AuthError\) setState\('forbidden'\)/);
  assert.match(PAGE_TSX, /This console is for the OrcaTrade operations team/);
  // The rows render the ranking columns; risk highlighted only
  // when non-zero.
  assert.match(PAGE_TSX, /r\.slaRisk > 0 \? 'text-\[var\(--color-critical\)\]' : 'text-\[var\(--color-ivory-mute\)\]'/);
  assert.match(PAGE_TSX, /eurFromCents\(r\.openQuoteValueCents\)/);
  // The copy names the derived line rather than hardcoding 36.
  assert.match(PAGE_TSX, /unquoted past \{riskHours\}h of the\{' '\}\s*\n\s*\{targetHours\}h budget/);
  // Read-only v1 honesty.
  assert.match(PAGE_TSX, /v1 is read-only/);
});
