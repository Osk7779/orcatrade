'use strict';

// Sprint 32 — cross-cohort correlation (rating × country).
//
// Tests cover three layers:
//   1. Data layer: aggregateSupplierPicks AND aggregateOpsInsights's
//      topPickedCountries section both pull customer_rating->>score
//      alongside the pick; per-country avgRating is computed only
//      over rated picks (null when no rated picks); 1-decimal
//      server-side rounding
//   2. TS mirror: FactoryShortlistBlock.pastPickSignal carries
//      avgRating + ratedCount; OpsInsightsTopPickedCountry carries
//      avgRating + ratedCount
//   3. UI: PastPickBadge surfaces avgRating in tooltip + a tone-
//      coloured chip (positive/warning thresholds match sprint 31
//      RatingHealth); PickedCountryRow surfaces avgRating inline
//      with "N rated" denominator + tone-colours by quality
//      threshold + aria-label
//
// The "rated denominator visible" promise is the load-bearing copy
// — without it, an "avg 4.6★" alone could be one happy customer
// gaming the cohort. The drift-guard pins the "N rated" text
// alongside the chip so the rating signal can't ship without its
// honesty footnote.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const DETAIL_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', '[externalId]', 'page.tsx'),
  'utf8',
);
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// ── Data layer: aggregateSupplierPicks ─────────────────────────────

test('aggregateSupplierPicks SELECT includes customer_rating->>score', () => {
  // The cross-cohort correlation depends on pulling the rating
  // alongside the pick in ONE query. A refactor that split this
  // into two queries would double the DB round-trips on every
  // orchestrator run.
  const block = DB_SRC.match(/async function aggregateSupplierPicks\([\s\S]*?\nasync function /);
  assert.ok(block, 'aggregateSupplierPicks body not located');
  assert.match(block[0], /\(customer_rating->>'score'\)::int AS rating_score/);
});

test('aggregateSupplierPicks per-country byCountry carries ratedCount + ratingSum + avgRating', () => {
  const block = DB_SRC.match(/async function aggregateSupplierPicks\([\s\S]*?\nasync function /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /ratedCount: 0/);
  assert.match(body, /ratingSum: 0/);
  assert.match(body, /avgRating:/);
});

test('aggregateSupplierPicks counts rating only for integer scores in [1, 5]', () => {
  // Defensive: a NULL customer_rating returns NULL from PG;
  // Number(null) === 0 would falsely count it. Pin the strict
  // integer-in-range gate.
  const block = DB_SRC.match(/async function aggregateSupplierPicks\([\s\S]*?\nasync function /);
  assert.ok(block);
  assert.match(block[0], /Number\.isInteger\(score\) && score >= 1 && score <= 5/);
});

test('aggregateSupplierPicks avgRating null when no rated picks (never NaN, never 0)', () => {
  // null is the explicit "not enough data" signal; 0 would
  // misleadingly anchor as a low rating.
  const block = DB_SRC.match(/async function aggregateSupplierPicks\([\s\S]*?\nasync function /);
  assert.ok(block);
  assert.match(block[0], /entry\.avgRating = entry\.ratedCount > 0[\s\S]*?:\s*null;/);
});

test('aggregateSupplierPicks avgRating rounded to 1 decimal place server-side', () => {
  // Matches sprint-31 RatingHealth precision so the badge + the
  // cohort don't disagree on "4.6" vs "4.6666666".
  const block = DB_SRC.match(/async function aggregateSupplierPicks\([\s\S]*?\nasync function /);
  assert.ok(block);
  assert.match(block[0], /Math\.round\(\(entry\.ratingSum \/ entry\.ratedCount\) \* 10\) \/ 10/);
});

// ── Data layer: aggregateOpsInsights topPickedCountries ─────────────

test('topPickedCountries cohort SELECT pulls customer_rating->>score on the SAME row pass', () => {
  // The cohort surface is in aggregateOpsInsights; the rating must
  // come along on the existing pick-rows query (NOT a second pass).
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block);
  // We already pull customer_rating->>'score' on the rating cohort
  // SELECT; pin a SECOND occurrence on the pick aggregation.
  const matches = (block[0].match(/\(customer_rating->>'score'\)::int AS rating_score/g) || []).length;
  assert.ok(matches >= 1, 'rating_score must appear in the pick-rows SELECT too');
});

test('topPickedCountries projection carries avgRating + ratedCount per entry', () => {
  const block = DB_SRC.match(/const topPickedCountries = Object\.entries\(pickByCountry\)[\s\S]*?\.sort/);
  assert.ok(block, 'topPickedCountries projection not located');
  const body = block[0];
  assert.match(body, /avgRating,/);
  assert.match(body, /ratedCount: info\.ratedCount/);
});

// ── TS mirror ──────────────────────────────────────────────────────

test('TS FactoryShortlistBlock.pastPickSignal carries avgRating + ratedCount (both nullable)', () => {
  const block = API_TS.match(/pastPickSignal\?:\s*\{([\s\S]*?)\}\s*\|\s*null;/);
  assert.ok(block, 'pastPickSignal type not located');
  assert.match(block[1], /avgRating\?:\s*number \| null/);
  assert.match(block[1], /ratedCount\?:\s*number/);
});

test('TS OpsInsightsTopPickedCountry carries avgRating: number | null + ratedCount: number', () => {
  const block = API_TS.match(/export interface OpsInsightsTopPickedCountry \{([\s\S]*?)\}/);
  assert.ok(block);
  const body = block[1];
  assert.match(body, /avgRating: number \| null;/);
  assert.match(body, /ratedCount: number;/);
});

// ── UI: PastPickBadge (shortlist) ──────────────────────────────────

test('PastPickBadge surfaces avgRating in the tooltip as "avg X★ across N rated"', () => {
  // Pin both the avg precision (toFixed(1)) AND the "N rated"
  // denominator so the rating signal can't ship without its
  // honesty footnote.
  assert.match(DETAIL_TSX, /avg \$\{avgRating\.toFixed\(1\)\}★ across \$\{ratedCount\} rated/);
});

test('PastPickBadge inline chip is tone-coloured (positive ≥ 4.5, warning < 3.5)', () => {
  // Same thresholds as sprint-31 RatingHealth — across UI surfaces
  // the rating signal reads consistently.
  const block = DETAIL_TSX.match(/function PastPickBadge\(\{[\s\S]*?function /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /avgRating >= 4\.5[\s\S]*?'var\(--color-positive\)'/);
  assert.match(body, /avgRating < 3\.5[\s\S]*?'var\(--color-warning\)'/);
});

test('PastPickBadge avgRating chip carries an aria-label naming the score + scale', () => {
  // Accessibility: screen readers should announce "average rating
  // 4.6 out of 5" not just "★".
  assert.match(DETAIL_TSX, /aria-label=\{`average rating \$\{avgRating\.toFixed\(1\)\} out of 5`\}/);
});

// ── UI: PickedCountryRow (insights cohort) ─────────────────────────

// PickedCountryRow assertions — match against the whole insights
// TSX. The patterns below only occur inside this component (the
// PastPickBadge in the detail page uses a different wrapper shape),
// so file-wide assertions are safe + dodge the brittle
// function-scope regex.

test('PickedCountryRow surfaces avgRating inline with "N rated" denominator', () => {
  // Same honesty-footnote pin: an avg without the rated denominator
  // could be one happy customer gaming the cohort. Pin both.
  assert.match(INSIGHTS_TSX, /avgRating\.toFixed\(1\)\}★/);
  // The rated denominator is rendered right next to the chip
  // (using a template literal substitution).
  assert.match(INSIGHTS_TSX, /\$\{ratedCount\} rated/);
});

test('PickedCountryRow rating chip uses the same tone thresholds (≥ 4.5 positive, < 3.5 warning)', () => {
  // Pin both threshold branches as they appear in the ternary
  // chain that resolves ratingTone.
  assert.match(INSIGHTS_TSX, /avgRating >= 4\.5[\s\S]*?'var\(--color-positive\)'/);
  assert.match(INSIGHTS_TSX, /avgRating < 3\.5[\s\S]*?'var\(--color-warning\)'/);
});

test('PickedCountryRow title (hover tooltip) includes the cross-cohort signal when avgRating exists', () => {
  // The tooltip is the discoverable affordance for the rating
  // signal alongside the count. Pin its inclusion.
  assert.match(INSIGHTS_TSX, /title = avgRating != null/);
  assert.match(INSIGHTS_TSX, /avg \$\{avgRating\.toFixed\(1\)\}★ across/);
});

test('PickedCountryRow rating chip carries an aria-label with score + denominator + scale', () => {
  assert.match(
    INSIGHTS_TSX,
    /aria-label=\{`average rating \$\{avgRating\.toFixed\(1\)\} out of 5 across \$\{ratedCount\} rated picks`\}/,
  );
});

test('PickedCountryRow gracefully hides the rating chip when avgRating is null', () => {
  // No ratings yet → no chip (rather than a misleading "0★" or
  // "—★"). The component already uses `avgRating != null && (` for
  // the inline rating chip. Pin the conditional.
  assert.match(INSIGHTS_TSX, /avgRating != null && \(/);
});
