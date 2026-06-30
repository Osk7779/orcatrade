'use strict';

// Sprint 62 — rating-trend drift (cohort #10 + FIFTH proactive
// signal).
//
// Sprint 33 alerts on individual 1-2★ ratings as they happen;
// sprint 62 watches the TREND — current 7-day avg vs prior 23-day
// baseline. Catches process-degradation that per-event misses
// (a streak of 3★ ratings — none low enough for sprint 33 —
// quietly drops the avg from 4.5 to 3.5).
//
// Tests cover three layers:
//   1. Constants: 7d current / 30d baseline / >=3 minCount /
//      0.5 dropThreshold
//   2. SQL shape + math:
//      - Both queries filter customer_approved + non-null
//        customer_rating (matches sprint-31 ratingCohort)
//      - DISJOINT windows: current >= now - 7d; baseline IN
//        [now-37d, now-7d] (NOT overlapping — drift-guard pins
//        the disjointness)
//      - averageScore pure helper: skips invalid scores, returns
//        { count, avg } with one-decimal rounding + null on 0
//      - delta = baselineAvg - currentAvg (positive when current
//        dropped)
//      - isDeclining triple gate: currentCount >= MIN + non-null
//        baselineAvg + delta >= DROP_THRESHOLD
//   3. TS mirror + UI: <RatingTrendCard> mounts AFTER
//      SupplierConcentrationCard + BEFORE RevisionCohort; reads
//      all parameters from data; renders one-decimal star
//      averages + signed delta

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

// ── Constants ──────────────────────────────────────────────────────

test('RATING_TREND_CURRENT_DAYS = 7 (last week is the "current" window)', () => {
  assert.equal(importRequests.RATING_TREND_CURRENT_DAYS, 7);
});

test('RATING_TREND_BASELINE_DAYS = 30 (prior month as baseline)', () => {
  // Baseline window-size matches sprint-40 spike + sprint-31
  // rating-cohort defaults. Drift-guard pinned so the math
  // stays predictable.
  assert.equal(importRequests.RATING_TREND_BASELINE_DAYS, 30);
});

test('RATING_TREND_MIN_COUNT = 3 (denominator noise floor for the avg)', () => {
  // 1-2 ratings can swing the avg by 1-2★. 3 is the smallest
  // count where the avg is meaningful + alert-worthy.
  assert.equal(importRequests.RATING_TREND_MIN_COUNT, 3);
});

test('RATING_TREND_DROP_THRESHOLD = 0.5 (half-star drop fires the gate)', () => {
  // Half-star = smallest reliably-detectable degradation on
  // 1-5 scale. Below that the signal is rounding noise.
  assert.equal(importRequests.RATING_TREND_DROP_THRESHOLD, 0.5);
});

// ── SQL shape ─────────────────────────────────────────────────────

test('aggregateOpsInsights includes a ratingTrend block in the response', () => {
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block, 'aggregateOpsInsights body not located');
  const body = block[0];
  assert.match(body, /ratingTrend:/);
  // All 4 comparison parameters surface.
  assert.match(body, /currentDays: RATING_TREND_CURRENT_DAYS/);
  assert.match(body, /baselineDays: RATING_TREND_BASELINE_DAYS/);
  assert.match(body, /minCount: RATING_TREND_MIN_COUNT/);
  assert.match(body, /dropThreshold: RATING_TREND_DROP_THRESHOLD/);
});

test('Both SQL queries filter customer_approved + non-null customer_rating (matches sprint-31)', () => {
  // Same gate as sprint-31 ratingCohort — only ratings on the
  // approved-state row count toward the trend. A refactor that
  // dropped these would surface ratings on cancelled/declined
  // rows and falsify the avg.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  const currentQuery = body.match(/ratingTrendCurrentRows = await db\.query\(\s*`([\s\S]*?)`/);
  const baselineQuery = body.match(/ratingTrendBaselineRows = await db\.query\(\s*`([\s\S]*?)`/);
  assert.ok(currentQuery, 'ratingTrendCurrentRows query not located');
  assert.ok(baselineQuery, 'ratingTrendBaselineRows query not located');
  for (const sql of [currentQuery[1], baselineQuery[1]]) {
    assert.match(sql, /customer_rating IS NOT NULL/);
    assert.match(sql, /status = 'customer_approved'/);
    assert.match(sql, /\(customer_rating->>'score'\)::int AS score/);
  }
});

test('CRITICAL: windows are DISJOINT — current >= now - 7d, baseline IN [now-37d, now-7d]', () => {
  // Disjointness is the load-bearing math invariant. Overlap
  // would smooth real degradation by including the current
  // (declining) window in the baseline.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  const currentQuery = body.match(/ratingTrendCurrentRows = await db\.query\(\s*`([\s\S]*?)`/);
  const baselineQuery = body.match(/ratingTrendBaselineRows = await db\.query\(\s*`([\s\S]*?)`/);
  assert.ok(currentQuery && baselineQuery);
  // Current: >= now - 7d (just one bound).
  assert.match(
    currentQuery[1],
    /\(customer_rating->>'ratedAt'\)::timestamptz >= now\(\) - \(\$2 \|\| ' days'\)::interval/,
  );
  // Baseline: < now - 7d (upper) AND >= now - 37d (lower).
  // Drift-guard pins BOTH bounds — half the disjointness would
  // surface as the wrong direction (e.g. including current
  // would over-smooth).
  assert.match(
    baselineQuery[1],
    /\(customer_rating->>'ratedAt'\)::timestamptz < now\(\) - \(\$2 \|\| ' days'\)::interval/,
  );
  assert.match(
    baselineQuery[1],
    /\(customer_rating->>'ratedAt'\)::timestamptz >= now\(\) - \(\(\$2::int \+ \$3::int\) \|\| ' days'\)::interval/,
  );
});

test('computeRatingTrendAverage helper skips invalid scores (NaN, < 1, > 5) + null on 0-denominator', () => {
  // The defensive defaults matter — corrupted JSONB or a future
  // schema change wouldn't pollute the avg. Source-pinned.
  // Helper named `computeRatingTrendAverage` (NOT averageScore —
  // sprint-31 ratingCohort already has a const-bound
  // `averageScore` in the same scope; re-declaring would throw
  // `Identifier already declared` at module load).
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(body, /function computeRatingTrendAverage\(rows\)/);
  // Range gate.
  assert.match(body, /!Number\.isInteger\(s\) \|\| s < 1 \|\| s > 5/);
  // One-decimal rounding + null on 0.
  assert.match(body, /count > 0 \? Math\.round\(\(sum \/ count\) \* 10\) \/ 10\s*: null/);
});

test('delta = baselineAvg - currentAvg (positive when current dropped); null on either-side-null', () => {
  // Convention: positive delta = decline (matches the
  // dropThreshold semantics — "trigger when delta >= 0.5"
  // reads naturally).
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(
    body,
    /ratingTrendDelta = \(ratingTrendCurrent\.avg !== null && ratingTrendBaseline\.avg !== null\)[\s\S]*?Math\.round\(\(ratingTrendBaseline\.avg - ratingTrendCurrent\.avg\) \* 10\) \/ 10[\s\S]*?: null/,
  );
});

test('isDeclining requires ALL of: count >= MIN + non-null baselineAvg + delta >= DROP_THRESHOLD', () => {
  // The triple gate kills false positives on first-run orgs
  // (no baseline data) AND small-denominator noise.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(body, /ratingTrendCurrent\.count >= RATING_TREND_MIN_COUNT/);
  assert.match(body, /ratingTrendBaseline\.avg !== null/);
  assert.match(body, /ratingTrendCurrent\.avg !== null/);
  assert.match(body, /\(ratingTrendBaseline\.avg - ratingTrendCurrent\.avg\) >= RATING_TREND_DROP_THRESHOLD/);
});

// ── TS mirror ──────────────────────────────────────────────────────

test('TS OpsInsightsRatingTrendCohort mirrors the JS shape', () => {
  assert.match(
    API_TS,
    /export interface OpsInsightsRatingTrendCohort \{[\s\S]*?currentDays: number;[\s\S]*?baselineDays: number;[\s\S]*?minCount: number;[\s\S]*?dropThreshold: number;[\s\S]*?currentCount: number;[\s\S]*?currentAvg: number \| null;[\s\S]*?baselineCount: number;[\s\S]*?baselineAvg: number \| null;[\s\S]*?delta: number \| null;[\s\S]*?isDeclining: boolean;[\s\S]*?\}/,
  );
});

test('TS OpsInsights extends with ratingTrend field', () => {
  assert.match(API_TS, /ratingTrend: OpsInsightsRatingTrendCohort;/);
});

// ── UI ─────────────────────────────────────────────────────────────

test('Ops Insights page imports the OpsInsightsRatingTrendCohort type', () => {
  assert.match(INSIGHTS_TSX, /type OpsInsightsRatingTrendCohort/);
});

test('RatingTrendCard mounts AFTER SupplierConcentrationCard + BEFORE RevisionCohort (proactive band order)', () => {
  // Five proactive cards in band-order: stalled → decline-spike
  // → quote-acceptance → supplier-concentration → rating-trend.
  // Drift-guard pins the relative position.
  assert.match(INSIGHTS_TSX, /<RatingTrendCard data=\{data\.ratingTrend\} \/>/);
  const scIdx = INSIGHTS_TSX.indexOf('<SupplierConcentrationCard');
  const rtIdx = INSIGHTS_TSX.indexOf('<RatingTrendCard');
  const revisionIdx = INSIGHTS_TSX.indexOf('<RevisionCohort');
  assert.ok(scIdx < rtIdx, 'RatingTrendCard must mount AFTER SupplierConcentrationCard');
  assert.ok(rtIdx < revisionIdx, 'RatingTrendCard must mount BEFORE RevisionCohort');
});

test('Ops Insights page renders <RatingTrendCard> ONLY when isDeclining', () => {
  assert.match(INSIGHTS_TSX, /\{data\.ratingTrend\.isDeclining && \(\s*<RatingTrendCard/);
});

test('RatingTrendCard reads all comparison parameters from data (NOT hardcoded literals)', () => {
  const block = INSIGHTS_TSX.match(/function RatingTrendCard\(\{ data \}: \{ data: OpsInsightsRatingTrendCohort \}\)[\s\S]*?\n\}/);
  assert.ok(block, 'RatingTrendCard body not located');
  const body = block[0];
  assert.match(body, /\{data\.currentDays\}/);
  assert.match(body, /\{data\.baselineDays\}/);
  assert.match(body, /\{data\.minCount\}/);
  assert.match(body, /data\.dropThreshold/);
  assert.match(body, /\{data\.currentCount\}/);
  assert.match(body, /\{data\.baselineCount\}/);
});

test('RatingTrendCard renders averages as one-decimal stars with — fallback for null', () => {
  // .toFixed(1) matches the server-side rounding precision.
  // Null → "—" so a first-run org doesn't see "0.0★" headlines.
  const block = INSIGHTS_TSX.match(/function RatingTrendCard\(\{ data \}: \{ data: OpsInsightsRatingTrendCohort \}\)[\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /data\.currentAvg !== null \? `\$\{data\.currentAvg\.toFixed\(1\)\}★` : '—'/);
  assert.match(body, /data\.baselineAvg !== null \? `\$\{data\.baselineAvg\.toFixed\(1\)\}★` : '—'/);
});

test('RatingTrendCard renders delta with leading "-" (direction reads instantly) + null fallback', () => {
  // delta is positive when current has DROPPED; the UI shows
  // "-0.5★" so the direction reads at a glance.
  const block = INSIGHTS_TSX.match(/function RatingTrendCard\(\{ data \}: \{ data: OpsInsightsRatingTrendCohort \}\)[\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /deltaStars = data\.delta !== null \? data\.delta\.toFixed\(1\) : null/);
  assert.match(body, /deltaStars !== null \? `-\$\{deltaStars\}★` : '—'/);
});
