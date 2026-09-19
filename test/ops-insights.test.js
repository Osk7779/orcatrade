'use strict';

// Sprint 17 — Ops Insights cohort drift-guard.
//
// Pins the contract between:
//   1. aggregateOpsInsights (data-layer aggregation function)
//   2. /api/imports/insights handler
//   3. TS mirror types
//   4. /imports/insights page (the cohort cards)
//
// The cohort math is the headline number for a learning system, so a
// silent shape regression here (e.g. server returns revisionRate as
// 0.4 not 40, or as a fraction when the UI expects a percentage)
// would make the dashboard read wrong without crashing — exactly the
// kind of regression a drift-guard catches.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const importRequestsDb = require('../lib/db/import-requests');

const ROOT = path.resolve(__dirname, '..');
const HANDLER_SRC = fs.readFileSync(
  path.join(ROOT, 'lib', 'handlers', 'imports.js'),
  'utf8',
);
const API_TS = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'lib', 'api.ts'),
  'utf8',
);
const PAGE_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);
const QUEUE_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'queue', 'page.tsx'),
  'utf8',
);

// ── aggregateOpsInsights: input validation ──────────────────────────

test('aggregateOpsInsights is exported from lib/db/import-requests.js', () => {
  assert.equal(typeof importRequestsDb.aggregateOpsInsights, 'function');
});

test('aggregateOpsInsights rejects missing orgId', async () => {
  const r = await importRequestsDb.aggregateOpsInsights({});
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /orgId/.test(e)));
});

test('aggregateOpsInsights returns notConfigured when DATABASE_URL is unset', async () => {
  // The test env runs without a real Postgres; the function must
  // report a structured "not configured" rather than crash. Pinning
  // this path because the handler maps it to 503, not 500.
  const r = await importRequestsDb.aggregateOpsInsights({ orgId: 12345, windowDays: 30 });
  // Either fails configured-check (test env) OR succeeds (when a CI
  // test PG is wired up). Both shapes are valid; pin the union.
  if (r.ok) {
    assert.ok(r.insights, 'success shape must include insights');
  } else {
    assert.ok(r.errors.length > 0);
  }
});

// ── Handler wiring ──────────────────────────────────────────────────

test('imports handler routes the "insights" segment to handleInsights', () => {
  // Pin both the segment match AND the gate. A refactor that moves
  // the route check below the externalId-fetch path would silently
  // 404 the endpoint.
  assert.match(HANDLER_SRC, /externalId === ['"]insights['"]/);
  assert.match(HANDLER_SRC, /handleInsights\(req, res, ctx\)/);
  assert.match(HANDLER_SRC, /async function handleInsights\(/);
});

test('handleInsights is ops-only (requireOpsRole gate)', () => {
  // The funnel + decline-reason breakdown is org-wide aggregate data
  // that customers shouldn't see for their own org. Pin the RBAC gate
  // so a refactor that drops it surfaces here.
  const block = HANDLER_SRC.match(/async function handleInsights\([\s\S]*?\n\}/);
  assert.ok(block, 'handleInsights body not located');
  assert.match(block[0], /requireOpsRole\(req, res, ctx\)/);
});

test('handleInsights clamps the windowDays query param to a number default', () => {
  const block = HANDLER_SRC.match(/async function handleInsights\([\s\S]*?\n\}/);
  assert.ok(block);
  // The data layer clamps to [1, 365]; the handler just needs to pass
  // a number through (Number.isFinite gate prevents NaN injection).
  assert.match(block[0], /windowDays/);
  assert.match(block[0], /Number\.isFinite/);
});

// ── TS mirror parity ────────────────────────────────────────────────

test('OpsInsights type union exposes the three cohorts', () => {
  // Funnel, decline reasons, revision cohort — the three blocks the
  // page renders. A future addition (e.g. lead time) needs to extend
  // BOTH the TS interface AND the data-layer return shape; this
  // pins the current contract.
  assert.match(API_TS, /export interface OpsInsights \{[\s\S]*?funnelByStatus[\s\S]*?declineReasons[\s\S]*?revisionCohort/);
});

test('OpsInsightsRevisionCohort includes the percentage fields the UI renders', () => {
  // The page renders revisionRate + progressionRate as percentages
  // (0–100). The server computes them so the UI never divides by
  // zero — both fields are nullable to express "no data yet".
  const block = API_TS.match(/export interface OpsInsightsRevisionCohort \{([\s\S]*?)\}/);
  assert.ok(block, 'OpsInsightsRevisionCohort not located');
  for (const f of ['recoverableDeclined', 'revisions', 'revisionsProgressed', 'revisionRate', 'progressionRate']) {
    assert.match(block[1], new RegExp(`\\b${f}\\b`), `OpsInsightsRevisionCohort missing field: ${f}`);
  }
  // The rate fields MUST be number | null (server-side null when
  // denominator is 0 — UI renders em-dash). Pin the nullability.
  assert.match(block[1], /revisionRate:\s*number \| null/);
  assert.match(block[1], /progressionRate:\s*number \| null/);
});

test('OpsInsightsResponse wraps insights in { ok, windowDays, insights }', () => {
  // The wrapper shape is what apiGet<OpsInsightsResponse> consumes.
  // Pin both the windowDays echo (so the page can show "30-day window"
  // even if the user passed a non-clamped value) and the insights
  // sub-object.
  assert.match(API_TS, /export interface OpsInsightsResponse \{[\s\S]*?windowDays:[\s\S]*?insights: OpsInsights/);
});

// ── Page wiring ─────────────────────────────────────────────────────

test('Page fetches GET /imports/insights with the windowDays query param', () => {
  assert.match(PAGE_TSX, /apiGet<OpsInsightsResponse>\(`\/imports\/insights\?windowDays=\$\{windowDays\}`\)/);
});

test('Page renders ALL three cohort sections (RevisionCohort, Funnel, DeclineBreakdown)', () => {
  // The whole point of the page is the three cohorts. Drift-guard
  // against a "simplification" that removes one of them.
  assert.match(PAGE_TSX, /function RevisionCohort\(/);
  assert.match(PAGE_TSX, /function Funnel\(/);
  assert.match(PAGE_TSX, /function DeclineBreakdown\(/);
  // And that each is mounted in the default page.
  assert.match(PAGE_TSX, /<RevisionCohort/);
  assert.match(PAGE_TSX, /<Funnel/);
  assert.match(PAGE_TSX, /<DeclineBreakdown/);
});

test('Page handles 403 forbidden separately from 401 auth (ops-only message)', () => {
  // A non-ops customer hitting the URL gets a 403; surface that with
  // a meaningful "Ops-only" message rather than the generic
  // "Sign in" auth gate. Pin both branches.
  assert.match(PAGE_TSX, /setState\(['"]auth['"]\)/);
  assert.match(PAGE_TSX, /setState\(['"]forbidden['"]\)/);
  assert.match(PAGE_TSX, /Ops-only/);
});

test('Page exposes the 7d / 30d / 90d window toggles', () => {
  // Sprint 17 sets a tight UX promise: ops can switch between three
  // canonical windows. Pin the option list so a future "simplify"
  // that drops one of them surfaces here.
  assert.match(PAGE_TSX, /days:\s*7/);
  assert.match(PAGE_TSX, /days:\s*30/);
  assert.match(PAGE_TSX, /days:\s*90/);
});

test('Page DeclineBreakdown handles the zero-declines case gracefully', () => {
  // No structured declines in the window must NOT render an empty
  // bars chart; pin the fallback copy.
  assert.match(PAGE_TSX, /No structured declines in this window\./);
});

test('Page RevisionCohort handles the zero-recoverable-declines case gracefully', () => {
  // The headline metric panel must NOT show "0 / 0 (NaN%)" when there
  // are no recoverable declines yet; pin the fallback copy.
  assert.match(PAGE_TSX, /No recoverable declines in this window yet\./);
});

test('Queue page links to /imports/insights (ops discovers the page from where they live)', () => {
  // Without this nav link, ops doesn't know the insights page
  // exists. The link lives in the queue hero so it's visible the
  // moment ops lands on their daily desk.
  assert.match(QUEUE_TSX, /href="\/imports\/insights"/);
  assert.match(QUEUE_TSX, /See ops insights/);
});

// ── Funnel grouping covers the closed taxonomy ──────────────────────

test('FUNNEL_GROUPS + TERMINAL_GROUP together cover every status in the schema', () => {
  // A status added to schema-012 without surfacing in the funnel
  // grouping would render as a silent zero (request stuck in a
  // bucket the page doesn't render). Pin the cover.
  const fnGroups = PAGE_TSX.match(/FUNNEL_GROUPS: ReadonlyArray<[\s\S]*?\}> = \[([\s\S]*?)\];/);
  assert.ok(fnGroups, 'FUNNEL_GROUPS not located');
  const termGroup = PAGE_TSX.match(/TERMINAL_GROUP = \{[\s\S]*?statuses:\s*\[([\s\S]*?)\]/);
  assert.ok(termGroup, 'TERMINAL_GROUP not located');
  const covered = new Set();
  for (const m of (fnGroups[1] + termGroup[1]).matchAll(/['"]([a-z_]+)['"]/g)) {
    covered.add(m[1]);
  }
  // Read the schema's authoritative status list from the data layer.
  for (const s of importRequestsDb.STATUSES) {
    assert.ok(
      covered.has(s),
      `status "${s}" is in the schema but not in FUNNEL_GROUPS ∪ TERMINAL_GROUP`,
    );
  }
});
