'use strict';

// Sprint 38 — Stalled-request watch (cohort #6 + first PROACTIVE signal).
//
// Every other cohort in the Ops Insights page summarises past data
// (funnel, decline reasons, revision recovery, top picked countries,
// rating health). Sprint 38 adds the first cohort that names the
// requests sitting in 'awaiting_review' for > STALL_THRESHOLD_DAYS
// days WITH NO ACTIVITY (updated_at proxy). It's the first thing the
// dashboard tells you to ACT on, not read.
//
// Tests cover three layers:
//   1. Data layer: STALL_THRESHOLD_DAYS = 7 + STALLED_QUEUE_CAP = 10
//      constants exported; aggregateOpsInsights includes stalledQueue
//      with the right shape; SQL filters status='awaiting_review' AND
//      updated_at < now() - threshold AND archived_at IS NULL; sort
//      is oldest-first; count is org-wide (NOT capped)
//   2. TS mirror: OpsInsightsStalledQueue + OpsInsightsStalledItem
//      shapes pinned; OpsInsights extension carries stalledQueue
//   3. UI: <StalledQueueCard> renders ONLY when count > 0 (no empty
//      card on healthy days); deep-links each row to the detail page;
//      surfaces the threshold + the org-wide count; truncation
//      footnote when count > items.length (honesty)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequests = require('../lib/db/import-requests');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// ── Data layer: constants + exports ────────────────────────────────

test('STALL_THRESHOLD_DAYS exported as 7 (the documented SLA threshold)', () => {
  // The constant is the single source of truth for the stall window.
  // Drift-guard pins 7 specifically — a silent change would skew
  // every dashboard comparing windows.
  assert.equal(importRequests.STALL_THRESHOLD_DAYS, 7);
});

test('STALLED_QUEUE_CAP exported as 10 (cohort list cap)', () => {
  // 10 keeps the card scannable; ops can scroll through 10 before
  // the cognitive load tips over. Headline count is uncapped so the
  // truncation footnote can show "showing 10 of N".
  assert.equal(importRequests.STALLED_QUEUE_CAP, 10);
});

// ── Data layer: SQL shape ──────────────────────────────────────────

test('aggregateOpsInsights includes a stalledQueue block in the response', () => {
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block, 'aggregateOpsInsights body not located');
  const body = block[0];
  assert.match(body, /stalledQueue:/);
  // The block must surface thresholdDays + count + items per the TS
  // mirror; drift-guard pins each field name.
  // Sprint 42 — the surfaced threshold became dynamic (effective
  // value after per-org config + the [1, 90] defensive re-bound).
  // The shape pin stays — the field is present and pulls from the
  // resolved variable rather than the static constant.
  assert.match(body, /thresholdDays: (?:STALL_THRESHOLD_DAYS|effectiveStallThreshold)/);
  assert.match(body, /count: stalledCount/);
  assert.match(body, /items: stalledItems/);
});

test('Stalled-count SQL filters on status=awaiting_review AND updated_at threshold', () => {
  // The proactive signal needs three clauses, all required:
  //   - status='awaiting_review' (the stall state)
  //   - updated_at < now() - threshold (the time gate; activity
  //     resets the clock — message + evidence + supplier pick all
  //     touch updated_at, so an engaged request is correctly NOT
  //     stalled)
  //   - archived_at IS NULL (every aggregate excludes archived)
  // The COUNT(*) query is the headline; pinning the exact predicates
  // catches a refactor that silently widened or narrowed the cohort.
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block);
  const body = block[0];
  // Anchor on the stalledCountRows variable so an earlier
  // COUNT(*) query (decline cohort) can't false-match.
  const countQuery = body.match(/stalledCountRows = await db\.query\(\s*`([\s\S]*?)`/);
  assert.ok(countQuery, 'stalled count query not located');
  const sql = countQuery[1];
  assert.match(sql, /SELECT COUNT\(\*\)::int AS n/);
  assert.match(sql, /status = 'awaiting_review'/);
  assert.match(sql, /updated_at < now\(\) - \(\$2 \|\| ' days'\)::interval/);
  assert.match(sql, /archived_at IS NULL/);
});

test('Stalled-list SQL is sorted oldest-first AND limited to STALLED_QUEUE_CAP', () => {
  // Two requirements that pair: oldest-first (because "stuck 31 days"
  // is more urgent than "just crossed 7 days") + a hard cap (so a
  // long-tail stall list never blows up the response). Drift-guard
  // pins both — a silent swap to DESC would push the recently-stalled
  // forward and bury the dire ones at the bottom.
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block);
  const body = block[0];
  // Anchor on stalledListRows for the same false-match-proofing.
  const listQuery = body.match(/stalledListRows = await db\.query\(\s*`([\s\S]*?)`/);
  assert.ok(listQuery, 'stalled list query not located');
  const sql = listQuery[1];
  assert.match(sql, /ORDER BY updated_at ASC/);
  assert.match(sql, /LIMIT \$3/);
  // The LIMIT param binds to STALLED_QUEUE_CAP. Sprint 42 — the
  // threshold bind became the effective-after-config variable, so
  // either name is acceptable for the threshold slot.
  assert.match(
    body,
    /\[orgId, String\((?:STALL_THRESHOLD_DAYS|effectiveStallThreshold)\), STALLED_QUEUE_CAP\]/,
  );
});

test('Stalled-count is org-wide (NOT capped by STALLED_QUEUE_CAP)', () => {
  // The headline number is the uncapped total — a "47 stalled"
  // headline with a 10-row card is informative ("there are more
  // than the card shows"); a "10 stalled" capped headline would
  // hide the iceberg under the visible tip.
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block);
  const body = block[0];
  // The count query has NO LIMIT clause + uses COUNT(*).
  const countQuery = body.match(/stalledCountRows = await db\.query\(\s*`([\s\S]*?)`/);
  assert.ok(countQuery);
  const sql = countQuery[1];
  assert.match(sql, /SELECT COUNT\(\*\)::int AS n/);
  assert.ok(!/LIMIT/i.test(sql), 'count query must NOT have a LIMIT clause');
});

test('Stalled-list runs ONLY when stalledCount > 0 (avoid the empty query)', () => {
  // Micro-perf: a healthy day has 0 stalled requests; the LIMIT
  // query in that case is pure waste. The if-guard wraps the second
  // query so the per-aggregation cost stays flat on the common case.
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /if \(stalledCount > 0\) \{[\s\S]*?const stalledListRows = await db\.query/);
});

test('Stalled-list daysStalled is server-side rounded to one decimal', () => {
  // Matches the rating cohort's display precision (also one decimal).
  // UI doesn't re-round, so a refactor that returned the raw float
  // would surface as "13.273245... days" in the card.
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block);
  assert.match(block[0], /daysStalled: Math\.round\(Number\(r\.days_stalled\) \* 10\) \/ 10/);
});

// ── TS mirror ──────────────────────────────────────────────────────

test('OpsInsightsStalledItem TS shape carries externalId, label, updatedAt, daysStalled', () => {
  // Server-side projection mirrors directly; the UI binds against
  // this shape. A drift would surface as a TS compile error in
  // page.tsx but the source-pin makes the contract explicit.
  assert.match(API_TS, /export interface OpsInsightsStalledItem \{[\s\S]*?externalId: string;[\s\S]*?label: string;[\s\S]*?updatedAt: string;[\s\S]*?daysStalled: number;[\s\S]*?\}/);
});

test('OpsInsightsStalledQueue TS shape carries thresholdDays + count + items', () => {
  assert.match(API_TS, /export interface OpsInsightsStalledQueue \{[\s\S]*?thresholdDays: number;[\s\S]*?count: number;[\s\S]*?items: OpsInsightsStalledItem\[\];[\s\S]*?\}/);
});

test('OpsInsights TS shape extends with stalledQueue field', () => {
  // The TS extension is the cross-layer breadcrumb: a future
  // refactor that drops the field would fail to compile here AND
  // in the page render.
  assert.match(API_TS, /stalledQueue: OpsInsightsStalledQueue;/);
});

// ── UI ─────────────────────────────────────────────────────────────

test('Ops Insights page imports OpsInsightsStalledQueue type', () => {
  // The named import is the TS link between server contract +
  // component prop.
  assert.match(INSIGHTS_TSX, /type OpsInsightsStalledQueue/);
});

test('Ops Insights page mounts <StalledQueueCard> ABOVE the retrospective cohorts (RevisionCohort + below)', () => {
  // The proactive card sits between the hero + the retrospective
  // stack so the user's eye lands on it first. Drift-guard pins
  // both the mount AND the position — a refactor that moved it
  // below Funnel would bury the actionable signal under chart
  // noise.
  assert.match(INSIGHTS_TSX, /<StalledQueueCard data=\{data\.stalledQueue\} \/>/);
  const stalledIdx = INSIGHTS_TSX.indexOf('<StalledQueueCard');
  const revisionIdx = INSIGHTS_TSX.indexOf('<RevisionCohort');
  assert.ok(stalledIdx >= 0 && stalledIdx < revisionIdx, 'StalledQueueCard must mount BEFORE RevisionCohort');
});

test('Ops Insights page renders <StalledQueueCard> ONLY when count > 0', () => {
  // Healthy days don't show an empty card; ops eyes don't have to
  // skim past "0 stalled" every time they open the dashboard.
  assert.match(INSIGHTS_TSX, /\{data\.stalledQueue\.count > 0 && \(\s*<StalledQueueCard/);
});

test('StalledQueueCard renders each row as a Next Link to /imports/<externalId>', () => {
  // Deep-link is the whole point — one click from the cohort
  // headline to the request that needs attention.
  const block = INSIGHTS_TSX.match(/function StalledQueueCard\(\{ data \}: \{ data: OpsInsightsStalledQueue \}\)[\s\S]*?\n\}/);
  assert.ok(block, 'StalledQueueCard body not located');
  const body = block[0];
  assert.match(body, /<Link\s+href=\{`\/imports\/\$\{item\.externalId\}`\}/);
  // Per-row daysStalled rendered with .toFixed(1) (matches server
  // rounding precision).
  assert.match(body, /item\.daysStalled\.toFixed\(1\)/);
});

test('StalledQueueCard surfaces the threshold + the headline count from the data', () => {
  // thresholdDays from the cohort (NOT a hard-coded "7 days" in
  // the JSX) so the card can never lie about the threshold the
  // server enforced. count from the cohort (NOT items.length) so
  // the headline reflects the org-wide total.
  const block = INSIGHTS_TSX.match(/function StalledQueueCard\(\{ data \}: \{ data: OpsInsightsStalledQueue \}\)[\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /data\.thresholdDays/);
  assert.match(body, /data\.count\.toLocaleString\(['"]en-IE['"]\)/);
});

test('StalledQueueCard renders the truncation footnote when count > items.length (honesty)', () => {
  // Without the footnote, ops sees "47 stalled" headline + 10 rows
  // and assumes the 37 hidden are noise. The footnote names the
  // gap and points at the workflow.
  const block = INSIGHTS_TSX.match(/function StalledQueueCard\(\{ data \}: \{ data: OpsInsightsStalledQueue \}\)[\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /const truncated = data\.count > data\.items\.length/);
  assert.match(body, /\{truncated && \(/);
  assert.match(body, /Showing the \{data\.items\.length\} oldest of \{data\.count\}/);
});
