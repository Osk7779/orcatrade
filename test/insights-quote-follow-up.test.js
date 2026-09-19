'use strict';

// Sprint 69 — cohort #11, sixth proactive signal. Sibling of the
// sprint-38 stalled-queue cohort: same "no activity past N days"
// architecture applied to the customer-decision side of the
// workflow. Detects individual quotes sitting in `quoted` status
// waiting for customer_approved / customer_declined to fire.
//
// Distinct from:
//   - sprint 38 (stalled awaiting_review): team-side stall
//   - sprint 53 (quote-acceptance rate): population statistic on
//     approved / (approved+declined), not aging rows
//
// Tests cover five layers:
//   1. Constants: threshold + cap exported, sensible defaults
//   2. SQL discipline: status='quoted' filter; window-agnostic
//      (NOT bound by windowDays); COUNT and LIST use identical
//      predicates; oldest-first sort; LIMIT $3 = CAP; server-
//      side one-decimal rounding on daysPending.
//   3. Response surface: cohort included; thresholdDays surfaced;
//      count separate from items.length (headline is org-wide).
//   4. TS mirror: OpsInsightsAgingQuoteItem + cohort interface
//      + OpsInsights.quoteFollowUp field.
//   5. UI: card gated on count > 0; imports the TS type; renders
//      daysPending; oldest-first display; truncation footnote.

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

// ── Layer 1: constants ───────────────────────────────────────────

test('QUOTE_FOLLOWUP_THRESHOLD_DAYS = 5 (typical B2B follow-up cadence)', () => {
  assert.equal(importRequests.QUOTE_FOLLOWUP_THRESHOLD_DAYS, 5);
});

test('QUOTE_FOLLOWUP_CAP = 10 (mirrors STALLED_QUEUE_CAP)', () => {
  assert.equal(importRequests.QUOTE_FOLLOWUP_CAP, 10);
  // Design invariant: the two individual-row proactive cohorts
  // use the same CAP so the two amber cards render consistently.
  assert.equal(
    importRequests.QUOTE_FOLLOWUP_CAP,
    importRequests.STALLED_QUEUE_CAP,
    'aging-quotes cohort MUST share the same top-N cap as sprint-38 stalled-queue',
  );
});

// ── Layer 2: SQL discipline ──────────────────────────────────────

test('aging-quotes COUNT + LIST queries filter status = quoted (case-exact, quoted literal)', () => {
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block);
  const body = block[0];
  // COUNT query pins.
  assert.match(
    body,
    /agingQuoteCountRows[\s\S]*?FROM import_requests[\s\S]*?status = 'quoted'[\s\S]*?updated_at < now\(\) - \(\$2 \|\| ' days'\)::interval/,
  );
  // LIST query pins.
  assert.match(
    body,
    /agingQuoteListRows[\s\S]*?FROM import_requests[\s\S]*?status = 'quoted'[\s\S]*?updated_at < now\(\) - \(\$2 \|\| ' days'\)::interval/,
  );
});

test('aging-quotes queries filter archived_at IS NULL (dead rows never populate the cohort)', () => {
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  // Both queries share this predicate — sprint-38 discipline.
  const countBlock = body.match(/agingQuoteCountRows[\s\S]*?(QUOTE_FOLLOWUP_THRESHOLD_DAYS|effectiveQuoteFollowUpThreshold)/);
  const listBlock = body.match(/agingQuoteListRows[\s\S]*?QUOTE_FOLLOWUP_CAP\],/);
  assert.ok(countBlock, 'agingQuoteCountRows query not located');
  assert.ok(listBlock, 'agingQuoteListRows query not located');
  assert.match(countBlock[0], /archived_at IS NULL/);
  assert.match(listBlock[0], /archived_at IS NULL/);
});

test('aging-quotes query is window-agnostic (NOT bound by windowDays / `days` var)', () => {
  // The dashboard's `days` toggle changes the retrospective window
  // but MUST NOT stop the cohort from seeing stalls older than
  // that window. Sprint 71 generalisation — per-org config
  // threading replaced the constant with `effectiveQuoteFollowUp
  // Threshold` at the query binding. Accept either shape.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(
    body,
    /agingQuoteCountRows[\s\S]*?(QUOTE_FOLLOWUP_THRESHOLD_DAYS|effectiveQuoteFollowUpThreshold)/,
  );
  assert.match(
    body,
    /agingQuoteListRows[\s\S]*?(QUOTE_FOLLOWUP_THRESHOLD_DAYS|effectiveQuoteFollowUpThreshold)/,
  );
});

test('aging-quotes LIST sorts oldest first + LIMIT $3 = QUOTE_FOLLOWUP_CAP', () => {
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  const listBlock = body.match(/agingQuoteListRows[\s\S]*?QUOTE_FOLLOWUP_CAP\],/);
  assert.ok(listBlock, 'agingQuoteListRows query args block not located');
  assert.match(listBlock[0], /ORDER BY updated_at ASC/);
  assert.match(listBlock[0], /LIMIT \$3/);
  assert.match(listBlock[0], /QUOTE_FOLLOWUP_CAP/);
});

test('aging-quotes items round daysPending to one decimal server-side (matches sprint-38 precision)', () => {
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(
    body,
    /daysPending: Math\.round\(Number\(r\.days_pending\) \* 10\) \/ 10/,
  );
});

// ── Layer 3: response surface ────────────────────────────────────

test('aggregateOpsInsights response includes quoteFollowUp cohort', () => {
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  // Sprint 71 generalisation — per-org config threading replaced
  // the constant with `effectiveQuoteFollowUpThreshold` at the
  // response surface. Accept either shape.
  assert.match(
    body,
    /quoteFollowUp: \{[\s\S]*?thresholdDays: (QUOTE_FOLLOWUP_THRESHOLD_DAYS|effectiveQuoteFollowUpThreshold)/,
  );
  assert.match(body, /quoteFollowUp: \{[\s\S]*?count: agingQuoteCount/);
  assert.match(body, /quoteFollowUp: \{[\s\S]*?items: agingQuoteItems/);
});

test('aging-quotes count is org-wide (separate query) — headline honesty', () => {
  // COUNT(*)::int comes from its own query (not derived from
  // items.length). This lets the card show "47 aging" while the
  // list truncates to CAP=10 rows.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(body, /agingQuoteCountRows = await db\.query\(/);
  assert.match(body, /const agingQuoteCount = Number/);
});

test('aging-quotes LIST is skipped when count === 0 (short-circuit avoids empty query)', () => {
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(body, /if \(agingQuoteCount > 0\) \{[\s\S]*?agingQuoteListRows/);
});

// ── Layer 4: TS mirror ───────────────────────────────────────────

test('TS OpsInsightsAgingQuoteItem carries externalId + label + updatedAt + daysPending', () => {
  assert.match(
    API_TS,
    /export interface OpsInsightsAgingQuoteItem \{[\s\S]*?externalId: string;[\s\S]*?label: string;[\s\S]*?updatedAt: string;[\s\S]*?daysPending: number;[\s\S]*?\}/,
  );
});

test('TS OpsInsightsQuoteFollowUpCohort has thresholdDays + count + items', () => {
  assert.match(
    API_TS,
    /export interface OpsInsightsQuoteFollowUpCohort \{[\s\S]*?thresholdDays: number;[\s\S]*?count: number;[\s\S]*?items: OpsInsightsAgingQuoteItem\[\];[\s\S]*?\}/,
  );
});

test('TS OpsInsights extends with quoteFollowUp field (drift-guard against silent-drop)', () => {
  assert.match(
    API_TS,
    /ratingTrend: OpsInsightsRatingTrendCohort;[\s\S]*?quoteFollowUp: OpsInsightsQuoteFollowUpCohort;/,
  );
});

// ── Layer 5: UI ──────────────────────────────────────────────────

test('insights page imports OpsInsightsQuoteFollowUpCohort (drift-guard against silent-drop)', () => {
  assert.match(INSIGHTS_TSX, /type OpsInsightsQuoteFollowUpCohort,/);
});

test('insights page gates QuoteFollowUpCard render on count > 0 (no empty card on healthy days)', () => {
  assert.match(
    INSIGHTS_TSX,
    /\{data\.quoteFollowUp\.count > 0 && \(\s*<QuoteFollowUpCard data=\{data\.quoteFollowUp\} \/>\s*\)\}/,
  );
});

test('QuoteFollowUpCard renders as an amber-tinged section (proactive visual language)', () => {
  const block = INSIGHTS_TSX.match(/function QuoteFollowUpCard\([\s\S]*?\n\}\n/);
  assert.ok(block, 'QuoteFollowUpCard body not located');
  const body = block[0];
  // Same border treatment as sprint-38 stalled-queue card — the
  // two proactive individual-row cards read as a matched pair.
  assert.match(body, /border-\[var\(--color-warning\)\]\/\[0\.35\]/);
});

test('QuoteFollowUpCard names the status filter + threshold in the copy (transparency)', () => {
  const body = INSIGHTS_TSX.match(/function QuoteFollowUpCard\([\s\S]*?\n\}\n/)[0];
  // Copy references the exact status name so the reader
  // understands what SQL bucket they're looking at.
  assert.match(body, /quoted</);
  assert.match(body, /\{data\.thresholdDays\} days/);
});

test('QuoteFollowUpCard renders daysPending with one-decimal precision (mirrors StalledQueueCard)', () => {
  const body = INSIGHTS_TSX.match(/function QuoteFollowUpCard\([\s\S]*?\n\}\n/)[0];
  assert.match(body, /item\.daysPending\.toFixed\(1\)/);
});

test('QuoteFollowUpCard links each row to the request detail page (/imports/[externalId])', () => {
  const body = INSIGHTS_TSX.match(/function QuoteFollowUpCard\([\s\S]*?\n\}\n/)[0];
  assert.match(body, /href=\{`\/imports\/\$\{item\.externalId\}`\}/);
});

test('QuoteFollowUpCard shows truncation footnote when count > items.length', () => {
  const body = INSIGHTS_TSX.match(/function QuoteFollowUpCard\([\s\S]*?\n\}\n/)[0];
  assert.match(body, /const truncated = data\.count > data\.items\.length/);
  assert.match(body, /Showing the \{data\.items\.length\} oldest of \{data\.count\}/);
});
