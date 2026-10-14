'use strict';

// Sprint 53 — quote-acceptance rate degradation (cohort #8 + the
// THIRD proactive signal).
//
// Sprint 38 detected STATE stalls (rows sitting too long);
// sprint 40 detected TREND decline-reason spikes (acceleration);
// sprint 53 detects ACCEPTANCE-RATE drift — of requests that
// EXITED `quoted` in the current window, what % went to
// customer_approved? Compare against the prior baseline window.
//
// Tests cover three layers:
//   1. Constants: 30d current / 60d baseline / >=5 minCount /
//      75% degradation threshold + EXITED status set
//   2. SQL shape: current + baseline queries mirror each other;
//      baseline window is created_at IN [now-90d, now-30d] (i.e.
//      PRIOR to the current window, NOT including it); FILTER
//      clause counts customer_approved as numerator; archived
//      excluded
//   3. Math + flag: rates rounded to 3 decimals; null when
//      denominator=0; delta = current - baseline; isDegraded
//      requires count gate + non-null baseline + threshold check;
//      response surfaces all comparison parameters from constants
//   4. TS mirror + UI: shape pinned; <QuoteAcceptanceCard> renders
//      ONLY when isDegraded; reads all parameters from data
//      (NOT hardcoded literals — a future per-org config can
//      flow through automatically)

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

test('QUOTE_ACCEPTANCE_CURRENT_DAYS = 30 (last month is the "current" window)', () => {
  assert.equal(importRequests.QUOTE_ACCEPTANCE_CURRENT_DAYS, 30);
});

test('QUOTE_ACCEPTANCE_BASELINE_DAYS = 60 (prior two months as baseline)', () => {
  // 60d baseline gives 2× the window-size for a more stable
  // comparison. Drift-guard pinned so the math stays predictable
  // when a refactor changes the schedule.
  assert.equal(importRequests.QUOTE_ACCEPTANCE_BASELINE_DAYS, 60);
});

test('QUOTE_ACCEPTANCE_MIN_COUNT = 5 (denominator noise floor)', () => {
  // 1 of 1 = 100%; 0 of 1 = 0%. Single-digit denominators are
  // noise. 5 is the smallest reliable threshold.
  assert.equal(importRequests.QUOTE_ACCEPTANCE_MIN_COUNT, 5);
});

test('QUOTE_ACCEPTANCE_DEGRADATION_THRESHOLD = 0.75 (current < 75% of baseline triggers)', () => {
  // 75% picks up a 25-percentage-point drop on a healthy 70%
  // baseline (down to ~52%); tight enough that small noise
  // doesn't trigger, loose enough that a real shift surfaces.
  assert.equal(importRequests.QUOTE_ACCEPTANCE_DEGRADATION_THRESHOLD, 0.75);
});

// ── Data layer: aggregateOpsInsights extension ─────────────────────

test('aggregateOpsInsights includes a quoteAcceptance block in the response', () => {
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block, 'aggregateOpsInsights body not located');
  const body = block[0];
  assert.match(body, /quoteAcceptance:/);
  // All 4 comparison parameters surface so the UI can describe
  // what was measured.
  assert.match(body, /currentDays: QUOTE_ACCEPTANCE_CURRENT_DAYS/);
  assert.match(body, /baselineDays: QUOTE_ACCEPTANCE_BASELINE_DAYS/);
  assert.match(body, /minCount: QUOTE_ACCEPTANCE_MIN_COUNT/);
  assert.match(body, /degradationThreshold: QUOTE_ACCEPTANCE_DEGRADATION_THRESHOLD/);
});

test('SQL filters to EXITED statuses (customer_approved / customer_rejected / expired) — open quoted excluded', () => {
  // The denominator is rows that ACTUALLY had a decision —
  // open-and-undecided rows would falsely depress the rate.
  // Sprint 38 stalled-queue cohort covers those separately.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  // Pin the status set constant.
  assert.match(body, /const exitedStatuses = Array\.from\(QUOTE_ACCEPTANCE_EXITED_STATUSES\)/);
  // And SQL binds use it via ANY($N::text[]).
  const currentQuery = body.match(/currentRows = await db\.query\(\s*`([\s\S]*?)`/);
  assert.ok(currentQuery, 'currentRows query not located');
  assert.match(currentQuery[1], /status = ANY\(\$3::text\[\]\)/);
});

test('current SQL window is created_at >= now() - 30d', () => {
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  const currentQuery = body.match(/currentRows = await db\.query\(\s*`([\s\S]*?)`/);
  assert.ok(currentQuery);
  assert.match(currentQuery[1], /created_at >= now\(\) - \(\$2 \|\| ' days'\)::interval/);
});

test('baseline SQL window is created_at IN [now-90d, now-30d] (PRIOR to current, NOT including)', () => {
  // CRITICAL: the baseline window must be DISJOINT from the
  // current window. Including the current window in the baseline
  // would smooth the signal and hide real degradation. Pin both
  // bounds explicitly.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  const baselineQuery = body.match(/baselineRows = await db\.query\(\s*`([\s\S]*?)`/);
  assert.ok(baselineQuery, 'baselineRows query not located');
  const sql = baselineQuery[1];
  // Upper bound: created_at < now() - 30d (excludes current window).
  assert.match(sql, /created_at < now\(\) - \(\$2 \|\| ' days'\)::interval/);
  // Lower bound: created_at >= now() - (30 + 60)d = now() - 90d.
  assert.match(sql, /created_at >= now\(\) - \(\(\$2::int \+ \$3::int\) \|\| ' days'\)::interval/);
});

test('SQL FILTER clause counts customer_approved as the numerator', () => {
  // The numerator in both windows is the same FILTER clause —
  // a refactor that diverged the two would silently break the
  // rate comparison.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  const filterMatches = body.match(/COUNT\(\*\) FILTER \(WHERE status = 'customer_approved'\)::int AS approved/g);
  assert.ok(filterMatches && filterMatches.length === 2,
    `expected 2 FILTER clauses (current + baseline), found ${filterMatches ? filterMatches.length : 0}`);
});

test('Rates are server-rounded to 3 decimals (0.1pp resolution); null when denominator = 0', () => {
  // 3-decimal rounding gives 0.1 percentage-point stability so
  // the UI's "Math.round(rate * 100)" math is stable across
  // reads. Null on 0-denominator so the UI can render "no
  // baseline yet" instead of NaN%.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  // currentRate ternary.
  assert.match(body, /currentRate = currentQuoted > 0[\s\S]*?Math\.round\(\(currentApproved \/ currentQuoted\) \* 1000\) \/ 1000[\s\S]*?: null/);
  // baselineRate ternary.
  assert.match(body, /baselineRate = baselineQuoted > 0[\s\S]*?Math\.round\(\(baselineApproved \/ baselineQuoted\) \* 1000\) \/ 1000[\s\S]*?: null/);
});

test('isDegraded requires ALL of: count gate + baseline > 0 + current < threshold × baseline', () => {
  // The triple gate is what kills false positives. Pin all three
  // conditions so a refactor can't accidentally drop one.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(body, /currentQuoted >= QUOTE_ACCEPTANCE_MIN_COUNT/);
  assert.match(body, /baselineRate !== null/);
  assert.match(body, /baselineRate > 0/);
  assert.match(body, /currentRate < QUOTE_ACCEPTANCE_DEGRADATION_THRESHOLD \* baselineRate/);
});

// ── TS mirror ──────────────────────────────────────────────────────

test('TS OpsInsightsQuoteAcceptanceCohort interface mirrors the JS shape', () => {
  assert.match(API_TS, /export interface OpsInsightsQuoteAcceptanceCohort \{[\s\S]*?currentDays: number;[\s\S]*?baselineDays: number;[\s\S]*?minCount: number;[\s\S]*?degradationThreshold: number;[\s\S]*?currentApproved: number;[\s\S]*?currentQuoted: number;[\s\S]*?currentRate: number \| null;[\s\S]*?baselineApproved: number;[\s\S]*?baselineQuoted: number;[\s\S]*?baselineRate: number \| null;[\s\S]*?delta: number \| null;[\s\S]*?isDegraded: boolean;[\s\S]*?\}/);
});

test('TS OpsInsights extends with quoteAcceptance field', () => {
  assert.match(API_TS, /quoteAcceptance: OpsInsightsQuoteAcceptanceCohort;/);
});

// ── UI ─────────────────────────────────────────────────────────────

test('Ops Insights page imports the OpsInsightsQuoteAcceptanceCohort type', () => {
  assert.match(INSIGHTS_TSX, /type OpsInsightsQuoteAcceptanceCohort/);
});

test('QuoteAcceptanceCard mounts AFTER DeclineSpikeCard + BEFORE RevisionCohort (proactive band order)', () => {
  // Three proactive cards in a band: stalled → decline-spike →
  // quote-acceptance. Drift-guard pins the order so a refactor
  // can't bury the third cohort under chart noise.
  assert.match(INSIGHTS_TSX, /<QuoteAcceptanceCard data=\{data\.quoteAcceptance\} \/>/);
  const stalledIdx = INSIGHTS_TSX.indexOf('<StalledQueueCard');
  const spikeIdx = INSIGHTS_TSX.indexOf('<DeclineSpikeCard');
  const qaIdx = INSIGHTS_TSX.indexOf('<QuoteAcceptanceCard');
  const revisionIdx = INSIGHTS_TSX.indexOf('<RevisionCohort');
  assert.ok(stalledIdx < spikeIdx, 'StalledQueueCard must precede DeclineSpikeCard');
  assert.ok(spikeIdx < qaIdx, 'DeclineSpikeCard must precede QuoteAcceptanceCard');
  assert.ok(qaIdx < revisionIdx, 'QuoteAcceptanceCard must precede RevisionCohort');
});

test('Ops Insights page renders <QuoteAcceptanceCard> ONLY when data.quoteAcceptance.isDegraded', () => {
  // Healthy orgs see no card. Pin the gate.
  assert.match(INSIGHTS_TSX, /\{data\.quoteAcceptance\.isDegraded && \(\s*<QuoteAcceptanceCard/);
});

test('QuoteAcceptanceCard renders comparison parameters from data (NOT hardcoded literals)', () => {
  // The card describes "drops below 75% of the prior baseline AND
  // at least 5 decisions" — both numbers come from data so a
  // future per-org config can change them without re-coding JSX.
  const block = INSIGHTS_TSX.match(/function QuoteAcceptanceCard\(\{ data \}: \{ data: OpsInsightsQuoteAcceptanceCohort \}\)[\s\S]*?\n\}/);
  assert.ok(block, 'QuoteAcceptanceCard body not located');
  const body = block[0];
  assert.match(body, /\{data\.currentDays\}/);
  assert.match(body, /\{data\.baselineDays\}/);
  assert.match(body, /\{data\.minCount\}/);
  assert.match(body, /data\.degradationThreshold/);
});

test('QuoteAcceptanceCard shows currentRate / baselineRate as integer percentages with — fallback for null', () => {
  // The rate display is the headline. Render with rounded
  // percentage; null → "—" so a no-baseline-yet case doesn't show
  // "NaN%" or "0%".
  const block = INSIGHTS_TSX.match(/function QuoteAcceptanceCard\(\{ data \}: \{ data: OpsInsightsQuoteAcceptanceCohort \}\)[\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /data\.currentRate !== null[\s\S]*?Math\.round\(data\.currentRate \* 100\)[\s\S]*?'—'/);
  assert.match(body, /data\.baselineRate !== null[\s\S]*?Math\.round\(data\.baselineRate \* 100\)[\s\S]*?'—'/);
});

test('QuoteAcceptanceCard shows delta as signed percentage-points (e.g. -18pp) with null fallback', () => {
  // Delta is the headline summary. Signed display so the
  // direction reads instantly; "pp" suffix because we're
  // showing the difference of two percentages, not a percentage
  // of a percentage.
  const block = INSIGHTS_TSX.match(/function QuoteAcceptanceCard\(\{ data \}: \{ data: OpsInsightsQuoteAcceptanceCohort \}\)[\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /deltaPp = data\.delta !== null \? Math\.round\(data\.delta \* 100\) : null/);
  assert.match(body, /deltaPp !== null \? `\$\{deltaPp > 0 \? '\+' : ''\}\$\{deltaPp\}pp` : '—'/);
});

test('QuoteAcceptanceCard surfaces both numerator + denominator for each window', () => {
  // "N of M decisions" supporting copy gives the reader scale.
  // Pin both fields appear in the JSX.
  const block = INSIGHTS_TSX.match(/function QuoteAcceptanceCard\(\{ data \}: \{ data: OpsInsightsQuoteAcceptanceCohort \}\)[\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /\{data\.currentApproved\} of \{data\.currentQuoted\} decisions/);
  assert.match(body, /\{data\.baselineApproved\} of \{data\.baselineQuoted\} decisions/);
});
