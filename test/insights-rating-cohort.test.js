'use strict';

// Sprint 31 — Rating Health cohort + UI.
//
// Tests cover three layers:
//   1. Data layer: aggregateOpsInsights includes ratingCohort with
//      the expected shape; SQL reads customer_rating->>score on
//      customer_approved rows in the window
//   2. TS mirror: OpsInsightsRatingCohort shape pinned; OpsInsights
//      extension carries ratingCohort
//   3. UI: <RatingHealth> renders empty state when no ratings;
//      surfaces average (1-decimal rounding), rated-of-approved
//      counts, distribution histogram (top-down 5★→1★), "needs
//      follow-up" callout when lowScoreCount > 0, average tone
//      thresholds (positive ≥ 4.5, warning < 3.5)
//
// The ratedPercentage denominator is window-honest (customer_approved
// in window only) — drift-guard pins the SQL filter so a refactor
// that read the global approval count would silently make the
// rated-% number lie.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// ── Data layer ──────────────────────────────────────────────────────

test('aggregateOpsInsights includes a ratingCohort block in the response', () => {
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block, 'aggregateOpsInsights body not located');
  const body = block[0];
  assert.match(body, /ratingCohort:/);
});

test('Rating SQL filters on customer_rating->>ratedAt (recency dimension) AND status=customer_approved', () => {
  // Same recency-dimension rule as sprint 29's pick aggregation:
  // pick the timestamp that matters (ratedAt, not created_at).
  // The customer_approved filter is what makes ratedPercentage
  // window-honest (denominator = customer_approved IN window, NOT
  // global approval count).
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /customer_rating->>'ratedAt'/);
  // The SQL must constrain on status='customer_approved'.
  assert.match(body, /AND status = 'customer_approved'/);
});

test('Rating cohort rounds averageScore server-side to one decimal', () => {
  // The UI renders .toFixed(1) but the server must produce a
  // round number first (otherwise floating-point noise like
  // 4.166666666 hits the wire). Pin the server-side rounding.
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block);
  assert.match(block[0], /Math\.round\(\(scoreSum \/ totalRated\) \* 10\) \/ 10/);
});

test('Rating cohort averageScore is null when no ratings (never NaN)', () => {
  // Defensive: a NaN landing on the wire would crash the UI.
  // Pin the null fallback.
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block);
  assert.match(block[0], /const averageScore = totalRated > 0[\s\S]*?:\s*null;/);
});

test('Rating cohort ratedPercentage is null when no approvals (never division-by-zero)', () => {
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block);
  assert.match(block[0], /const ratedPercentage = approvedInWindow > 0[\s\S]*?:\s*null;/);
});

test('Rating cohort lowScoreCount accumulates scores in [1, 2]', () => {
  // "Needs follow-up" callout is the load-bearing actionable signal.
  // Pin the threshold so a refactor that bumped to ≤ 3 (silently
  // making 3-star ratings count as low) surfaces here.
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block);
  assert.match(block[0], /if \(score <= 2\) lowScoreCount \+= 1;/);
});

test('Rating cohort scoreDistribution is a fixed-length 5-element array', () => {
  // The UI maps over [1★, 2★, 3★, 4★, 5★] without sparsity guards.
  // Pin the array initialization shape.
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block);
  assert.match(block[0], /scoreDistribution = \[0, 0, 0, 0, 0\]/);
});

// ── TS mirror ──────────────────────────────────────────────────────

test('TS OpsInsightsRatingCohort carries averageScore + totalRated + totalApproved + ratedPercentage + scoreDistribution + lowScoreCount', () => {
  const block = API_TS.match(/export interface OpsInsightsRatingCohort \{([\s\S]*?)\}/);
  assert.ok(block, 'OpsInsightsRatingCohort interface not located');
  const body = block[1];
  for (const field of [
    'averageScore: number \\| null',
    'totalRated: number',
    'totalApproved: number',
    'ratedPercentage: number \\| null',
    'scoreDistribution: \\[number, number, number, number, number\\]',
    'lowScoreCount: number',
  ]) {
    assert.match(body, new RegExp(field), `field missing or wrong type: ${field}`);
  }
});

test('TS OpsInsights extends with ratingCohort: OpsInsightsRatingCohort', () => {
  assert.match(API_TS, /ratingCohort: OpsInsightsRatingCohort;/);
});

// ── UI ─────────────────────────────────────────────────────────────

test('Insights page imports OpsInsightsRatingCohort type + renders <RatingHealth>', () => {
  assert.match(INSIGHTS_TSX, /type OpsInsightsRatingCohort/);
  assert.match(INSIGHTS_TSX, /<RatingHealth data=\{data\.ratingCohort\} \/>/);
  assert.match(INSIGHTS_TSX, /function RatingHealth\(/);
});

test('RatingHealth renders a distinct empty state when no ratings + no approvals', () => {
  // The empty state branches on whether totalApproved > 0 to nudge
  // ops in the right direction: chase ratings (if approvals exist)
  // vs wait for approvals to land.
  assert.match(INSIGHTS_TSX, /data\.totalApproved > 0/);
  assert.match(INSIGHTS_TSX, /none rated yet/);
  assert.match(INSIGHTS_TSX, /No customer-approved requests in this window/);
});

test('RatingHealth distribution histogram iterates top-down (5★ first, 1★ last)', () => {
  // The high-rating buckets are the positive signal — they read
  // first. A reversed order would bury the good news under the
  // outliers.
  assert.match(INSIGHTS_TSX, /\[5, 4, 3, 2, 1\]\.map\(\(star\)/);
});

test('RatingHealth surfaces a "Needs follow-up" callout when lowScoreCount > 0', () => {
  // The actionable hook: ops can see at a glance how many low-star
  // ratings need outreach. Pin both the conditional render and the
  // "reach out" copy that frames it as actionable.
  assert.match(INSIGHTS_TSX, /data\.lowScoreCount > 0 && \(/);
  assert.match(INSIGHTS_TSX, /reach out to those customers/);
});

test('RatingHealth surfaces the average score with a 1-decimal toFixed', () => {
  // The server rounds to 1 decimal; the UI must render the same
  // precision (a refactor that switched to toFixed(0) would
  // misrepresent 4.3 as 4).
  assert.match(INSIGHTS_TSX, /data\.averageScore\.toFixed\(1\)/);
});

test('RatingHealth average color tone shifts on quality thresholds (≥4.5 positive, <3.5 warning)', () => {
  // The colour signal at a glance: green for healthy, amber for
  // needs-work. Pin the thresholds so a refactor doesn't silently
  // shift them.
  assert.match(INSIGHTS_TSX, /data\.averageScore >= 4\.5/);
  assert.match(INSIGHTS_TSX, /data\.averageScore < 3\.5/);
});

test('RatingHealth header surfaces "N rated · M approved" + percentage', () => {
  // The window-honest denominator is the load-bearing copy:
  // without it, a "18 rated" number alone wouldn't tell ops if
  // they're hitting 75% or 25% capture rate.
  assert.match(INSIGHTS_TSX, /data\.totalRated\}/);
  assert.match(INSIGHTS_TSX, /data\.totalApproved\}/);
  assert.match(INSIGHTS_TSX, /data\.ratedPercentage != null/);
});

test('RatingHealth histogram bars use warning colour for low-star (1-2) buckets, aqua for high-star', () => {
  // Visual reinforcement of the lowScoreCount actionable signal:
  // the histogram bars themselves shift colour for low buckets so
  // ops's eye lands on the 1★/2★ rows first.
  assert.match(INSIGHTS_TSX, /const isLow = star <= 2;/);
  assert.match(INSIGHTS_TSX, /isLow \? 'var\(--color-warning\)' : 'var\(--color-aqua\)'/);
});
