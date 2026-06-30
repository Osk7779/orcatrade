'use strict';

// Sprint 40 — Decline-reason spike detection (cohort #7 + the SECOND
// proactive signal). Sprint 38 detected STATE stalls (rows sitting
// too long); sprint 40 detects TREND signals (which decline reasons
// are accelerating vs the 30-day baseline).
//
// Tests cover three layers:
//   1. Data layer: 4 constants exported with the right values; both
//      SQL queries shape correctly; spike-classification logic
//      (count gate, rate-multiplier gate, baseline-zero "NEW"
//      branch); sort order biggest-spike-first with first-time
//      reasons at the top; rate-rounding precision
//   2. TS mirror: OpsInsightsDeclineSpike + OpsInsightsDeclineSpikeCohort
//      shapes pinned; OpsInsights extension carries declineSpike
//   3. UI: <DeclineSpikeCard> renders ONLY when spikes.length > 0;
//      mounts between StalledQueueCard and RevisionCohort (proactive
//      band); names the comparison parameters from data (not
//      hard-coded literals); NEW badge for first-time reasons,
//      multiplier badge for ratio'd ones
//
// The baseline-zero branch is load-bearing — without it a first-time
// decline reason would either silently divide-by-zero (NaN ratio) or
// fall through the rate gate entirely (no signal). Drift-guard pins
// the "no occurrence in the prior baseline" copy + the NEW badge.

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

test('DECLINE_SPIKE_CURRENT_DAYS exported as 7', () => {
  assert.equal(importRequests.DECLINE_SPIKE_CURRENT_DAYS, 7);
});

test('DECLINE_SPIKE_BASELINE_DAYS exported as 30', () => {
  assert.equal(importRequests.DECLINE_SPIKE_BASELINE_DAYS, 30);
});

test('DECLINE_SPIKE_MIN_COUNT exported as 3 (noise floor)', () => {
  // 1 or 2 declines isn't a trend, it's noise. 3 is the smallest
  // count where "this is happening more often" reads as a signal.
  assert.equal(importRequests.DECLINE_SPIKE_MIN_COUNT, 3);
});

test('DECLINE_SPIKE_RATE_MULT exported as 2 (doubled-rate threshold)', () => {
  // 2x is the cleanest "things accelerated" threshold — too high
  // misses real spikes, too low catches noise. Pin specifically.
  assert.equal(importRequests.DECLINE_SPIKE_RATE_MULT, 2);
});

// ── Data layer: aggregateOpsInsights extension ─────────────────────

test('aggregateOpsInsights includes a declineSpike block in the response', () => {
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block, 'aggregateOpsInsights body not located');
  const body = block[0];
  assert.match(body, /declineSpike:/);
  // The block surfaces all 4 comparison parameters so the UI can
  // describe what was measured.
  assert.match(body, /currentDays: DECLINE_SPIKE_CURRENT_DAYS/);
  assert.match(body, /baselineDays: DECLINE_SPIKE_BASELINE_DAYS/);
  assert.match(body, /minCount: DECLINE_SPIKE_MIN_COUNT/);
  // Sprint 43 — surfaced field became dynamic (effective value after
  // per-org config + the [1.5, 10] defensive re-bound). Either form
  // satisfies the contract — the surfaced field exists, sourced from
  // the same variable the classifier reads.
  assert.match(body, /rateMultiplier: (?:DECLINE_SPIKE_RATE_MULT|effectiveSpikeMultiplier)/);
  assert.match(body, /spikes,/);
});

test('Current + baseline SQL queries each group by team_review_state declineReason', () => {
  // Both windows share the same SQL shape so the comparison is
  // apples-to-apples. The window difference is purely the $2
  // bind. Anchor on the query variable names to avoid false-match
  // against the sprint-17 declineRows query.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  const currentQuery = body.match(/spikeCurrentRows = await db\.query\(\s*`([\s\S]*?)`/);
  const baselineQuery = body.match(/spikeBaselineRows = await db\.query\(\s*`([\s\S]*?)`/);
  assert.ok(currentQuery, 'spikeCurrentRows query not located');
  assert.ok(baselineQuery, 'spikeBaselineRows query not located');
  for (const q of [currentQuery[1], baselineQuery[1]]) {
    assert.match(q, /team_review_state->>'declineReason' AS reason/);
    assert.match(q, /team_review_state \? 'declineReason'/);
    assert.match(q, /archived_at IS NULL/);
    assert.match(q, /GROUP BY team_review_state->>'declineReason'/);
  }
});

test('Spike windows are bound to the constants (NOT the user windowDays)', () => {
  // Window-agnostic by design — the spike doesn't stop being a
  // spike just because the dashboard toggle changes. Both queries
  // bind their constant directly, not `days`.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(body, /\[orgId, String\(DECLINE_SPIKE_CURRENT_DAYS\)\]/);
  assert.match(body, /\[orgId, String\(DECLINE_SPIKE_BASELINE_DAYS\)\]/);
});

test('Spike classifier enforces the MIN_COUNT gate (kills noise)', () => {
  // Without the count gate, a single "other" decline would
  // surface as a "Nx vs baseline" spike when the baseline was 1.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(body, /if \(currentCount < DECLINE_SPIKE_MIN_COUNT\) continue/);
});

test('Spike classifier enforces the rate-multiplier gate (catches genuine acceleration)', () => {
  // Without the rate gate, a reason at the count floor would
  // surface even if it was already at that level last month.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  // Sprint 43 — gate now reads the effective (per-org-config) value
  // instead of the static constant. Either name is acceptable for
  // the rate-multiplier slot.
  assert.match(
    body,
    /if \(currentRate < (?:DECLINE_SPIKE_RATE_MULT|effectiveSpikeMultiplier) \* baselineRate\) continue/,
  );
});

test('Baseline-zero branch surfaces first-time reasons as ratio=null (NOT NaN, NOT silent skip)', () => {
  // Critical correctness: when baselineRate === 0, currentRate /
  // baselineRate is Infinity. The classifier MUST short-circuit
  // BEFORE the rate gate (which uses multiplication, not
  // division) so a first-time reason hitting the count floor
  // surfaces with a meaningful ratio=null, NOT a silent skip.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(body, /if \(baselineRate === 0\) \{[\s\S]*?ratio: null/);
});

test('Spike sort puts null-ratio (first-time) reasons AT THE TOP', () => {
  // First-time decline reasons are the most striking signal — a
  // reason that wasn't happening at all last month is more
  // urgent than one that's 5x its prior pace. Pin the sort
  // priority.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(body, /spikes\.sort\(\(a, b\) => \{[\s\S]*?if \(a\.ratio === null\) return -1;[\s\S]*?if \(b\.ratio === null\) return 1;[\s\S]*?return Number\(b\.ratio\) - Number\(a\.ratio\)/);
});

test('Per-spike rates are server-rounded (two decimals, ratio one decimal)', () => {
  // Rate precision matches "events per day" granularity (two
  // decimals = 0.01/day = ~1/100 days minimum). Ratio precision
  // matches the rating cohort's one-decimal display.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(body, /currentRate: Math\.round\(currentRate \* 100\) \/ 100/);
  assert.match(body, /baselineRate: Math\.round\(baselineRate \* 100\) \/ 100/);
  assert.match(body, /ratio: Math\.round\(\(currentRate \/ baselineRate\) \* 10\) \/ 10/);
});

// ── TS mirror ──────────────────────────────────────────────────────

test('OpsInsightsDeclineSpike TS shape carries reason + counts + rates + nullable ratio', () => {
  // The data-layer projection mirrors directly to the TS row
  // shape; pin every field so a contract drift surfaces.
  assert.match(API_TS, /export interface OpsInsightsDeclineSpike \{[\s\S]*?reason: string;[\s\S]*?currentCount: number;[\s\S]*?baselineCount: number;[\s\S]*?currentRate: number;[\s\S]*?baselineRate: number;[\s\S]*?ratio: number \| null;[\s\S]*?\}/);
});

test('OpsInsightsDeclineSpikeCohort TS shape carries 4 comparison params + spikes array', () => {
  assert.match(API_TS, /export interface OpsInsightsDeclineSpikeCohort \{[\s\S]*?currentDays: number;[\s\S]*?baselineDays: number;[\s\S]*?minCount: number;[\s\S]*?rateMultiplier: number;[\s\S]*?spikes: OpsInsightsDeclineSpike\[\];[\s\S]*?\}/);
});

test('OpsInsights TS shape extends with declineSpike field', () => {
  assert.match(API_TS, /declineSpike: OpsInsightsDeclineSpikeCohort;/);
});

// ── UI ─────────────────────────────────────────────────────────────

test('Ops Insights page imports the OpsInsightsDeclineSpikeCohort type', () => {
  assert.match(INSIGHTS_TSX, /type OpsInsightsDeclineSpikeCohort/);
});

test('Ops Insights page mounts <DeclineSpikeCard> in the proactive band (between StalledQueueCard + RevisionCohort)', () => {
  // Both proactive cards form a band above the retrospective
  // stack. Pin the mount AND the relative position so a refactor
  // can't bury the decline-spike card under chart noise.
  assert.match(INSIGHTS_TSX, /<DeclineSpikeCard data=\{data\.declineSpike\} \/>/);
  const stalledIdx = INSIGHTS_TSX.indexOf('<StalledQueueCard');
  const spikeIdx = INSIGHTS_TSX.indexOf('<DeclineSpikeCard');
  const revisionIdx = INSIGHTS_TSX.indexOf('<RevisionCohort');
  assert.ok(stalledIdx < spikeIdx, 'DeclineSpikeCard must mount AFTER StalledQueueCard');
  assert.ok(spikeIdx < revisionIdx, 'DeclineSpikeCard must mount BEFORE RevisionCohort');
});

test('Ops Insights page renders <DeclineSpikeCard> ONLY when spikes.length > 0', () => {
  // Healthy weeks (no acceleration) show no card. Pin the gate.
  assert.match(INSIGHTS_TSX, /\{data\.declineSpike\.spikes\.length > 0 && \(\s*<DeclineSpikeCard/);
});

test('DeclineSpikeCard surfaces the comparison parameters from data (NOT hard-coded literals)', () => {
  // The card describes "≥ 2× the 30-day baseline" — both numbers
  // come from data so a future per-org config can change them
  // without re-coding the JSX.
  const block = INSIGHTS_TSX.match(/function DeclineSpikeCard\(\{ data \}: \{ data: OpsInsightsDeclineSpikeCohort \}\)[\s\S]*?\n\}/);
  assert.ok(block, 'DeclineSpikeCard body not located');
  const body = block[0];
  assert.match(body, /\{data\.rateMultiplier\}/);
  assert.match(body, /\{data\.baselineDays\}/);
  assert.match(body, /\{data\.currentDays\}/);
  assert.match(body, /\{data\.minCount\}/);
});

test('DeclineSpikeCard renders a NEW badge + dedicated copy for ratio===null (first-time reasons)', () => {
  // The baseline-zero branch lands as visually distinct content
  // because "first-time reason" is a different signal than "Nx
  // accelerating." Pin both the badge AND the no-occurrence copy.
  const block = INSIGHTS_TSX.match(/function DeclineSpikeCard\(\{ data \}: \{ data: OpsInsightsDeclineSpikeCohort \}\)[\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /const isNew = spike\.ratio === null/);
  // The NEW badge.
  assert.match(body, /NEW/);
  // The supporting copy.
  assert.match(body, /no occurrence in the prior baseline/);
  // The first-time eyebrow.
  assert.match(body, /first-time/);
});

test('DeclineSpikeCard renders the Nx multiplier for non-null ratio (with one-decimal precision)', () => {
  const block = INSIGHTS_TSX.match(/function DeclineSpikeCard\(\{ data \}: \{ data: OpsInsightsDeclineSpikeCohort \}\)[\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  // toFixed(1) matches server-side one-decimal rounding.
  assert.match(body, /spike\.ratio\?\.toFixed\(1\)/);
  // The "Nx" suffix is the visual marker.
  assert.match(body, /×/);
});

test('DeclineSpikeCard uses DECLINE_REASON_LABELS for human-readable copy (NOT raw enum)', () => {
  // Raw enum values ("price_target_unrealistic") look terrible in
  // a customer-facing card; the existing labels map turns them
  // into "Price target unrealistic" etc.
  const block = INSIGHTS_TSX.match(/function DeclineSpikeCard\(\{ data \}: \{ data: OpsInsightsDeclineSpikeCohort \}\)[\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /DECLINE_REASON_LABELS\[spike\.reason as DeclineReason\] \|\| spike\.reason/);
});
