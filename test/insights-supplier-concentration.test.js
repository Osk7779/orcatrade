'use strict';

// Sprint 57 — supplier-concentration risk (cohort #9 + FOURTH
// proactive signal).
//
// Sprint 38 watched STATE stalls; sprint 40 watched TREND on
// rejections; sprint 53 watched TREND on approvals; sprint 57
// watches RISK on sourcing exposure — of all picks in the last
// 30d, what share went to ONE dominant country? A tariff shift
// or sanctions update on that origin would take a large share
// of the team's sourcing offline.
//
// Tests cover three layers:
//   1. Constants: 30d window / >=5 minCount / 75% threshold
//   2. SQL shape + math:
//      - GROUP BY supplier_pick->>'country' (same projection as
//        sprint 29 picks cohort — drift-guard against divergence)
//      - WINDOW_DAYS binds via $2
//      - In-process aggregation (total, top, top count, share)
//      - share is rounded to 3 decimals (precision matches
//        sprint-53 quote-acceptance) + null on 0-denominator
//      - isConcentrated triple gate: total >= MIN_COUNT AND
//        share !== null AND share >= THRESHOLD
//   3. TS mirror + UI: <SupplierConcentrationCard> mounts in the
//      proactive band (AFTER QuoteAcceptance + BEFORE
//      RevisionCohort); reads all parameters from data; renders
//      sharePct/topCountry/threshold copy as the headline

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

test('SUPPLIER_CONCENTRATION_WINDOW_DAYS = 30 (last month of picks is the rolling sample)', () => {
  assert.equal(importRequests.SUPPLIER_CONCENTRATION_WINDOW_DAYS, 30);
});

test('SUPPLIER_CONCENTRATION_MIN_COUNT = 5 (denominator noise floor)', () => {
  // 1 of 1 = 100% would fire the gate spuriously. 5 is the
  // smallest denominator where "75% to CN" is a real signal.
  assert.equal(importRequests.SUPPLIER_CONCENTRATION_MIN_COUNT, 5);
});

test('SUPPLIER_CONCENTRATION_THRESHOLD = 0.75 (one country crosses 75% triggers)', () => {
  // 75% is the textbook "dominant supplier" line — enough that a
  // disruption to that country meaningfully damages sourcing, not
  // so high that genuine concentrations slip through.
  assert.equal(importRequests.SUPPLIER_CONCENTRATION_THRESHOLD, 0.75);
});

// ── Data layer: aggregateOpsInsights extension ─────────────────────

test('aggregateOpsInsights includes a supplierConcentration block in the response', () => {
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block, 'aggregateOpsInsights body not located');
  const body = block[0];
  assert.match(body, /supplierConcentration:/);
  // All 3 comparison parameters surface so the UI can describe
  // what was measured.
  assert.match(body, /windowDays: SUPPLIER_CONCENTRATION_WINDOW_DAYS/);
  assert.match(body, /minCount: SUPPLIER_CONCENTRATION_MIN_COUNT/);
  // Sprint 60 — surfaced field became dynamic (effective value
  // after per-org config + the [0.50, 0.95] defensive re-bound).
  // Either form satisfies the contract — the surfaced field
  // exists, sourced from the same variable the classifier
  // reads.
  assert.match(body, /threshold: (?:SUPPLIER_CONCENTRATION_THRESHOLD|effectiveConcentrationThreshold)/);
});

test('SQL projects supplier_pick->>country + count, GROUPing by country (matches sprint-29 pattern)', () => {
  // Drift-guard against the projection diverging from the
  // sprint-29 topPickedCountries SQL — both queries read the
  // same JSONB key.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  const query = body.match(/concentrationRows = await db\.query\(\s*`([\s\S]*?)`/);
  assert.ok(query, 'concentrationRows query not located');
  const sql = query[1];
  assert.match(sql, /supplier_pick->>'country' AS country/);
  assert.match(sql, /COUNT\(\*\)::int AS n/);
  assert.match(sql, /GROUP BY supplier_pick->>'country'/);
});

test('SQL window binds SUPPLIER_CONCENTRATION_WINDOW_DAYS via $2 (NOT user windowDays)', () => {
  // Window-agnostic: a concentration signal doesn't stop being
  // a risk just because the user toggled the dashboard. Bind
  // the constant directly, like sprints 38/40.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(body, /\[orgId, String\(SUPPLIER_CONCENTRATION_WINDOW_DAYS\)\]/);
});

test('SQL filters to last-window picks via (supplier_pick->>pickedAt)::timestamptz >= now() - Nd', () => {
  // The cohort measures RECENT concentration. Drift-guard against
  // a refactor that swapped pickedAt for created_at (which would
  // include never-picked rows in the denominator falsely).
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  const query = body.match(/concentrationRows = await db\.query\(\s*`([\s\S]*?)`/);
  assert.ok(query);
  const sql = query[1];
  assert.match(sql, /\(supplier_pick->>'pickedAt'\)::timestamptz >= now\(\) - \(\$2 \|\| ' days'\)::interval/);
});

test('Aggregation tracks total + top country + top count by iterating the grouped rows', () => {
  // The in-process aggregation pin: total is sum of counts; top
  // is the country with the highest count. A refactor that
  // assumed the SQL returned one row already sorted would break
  // silently.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(body, /concentrationTotal \+= count/);
  assert.match(body, /if \(count > concentrationTopCount\)/);
  assert.match(body, /concentrationTop = country/);
  assert.match(body, /concentrationTopCount = count/);
});

test('Aggregation upper-cases country + skips empty values (matches sprint-29 cleanup)', () => {
  // Two defensive measures lifted from sprint-29 picks:
  //   - .toUpperCase() normalises ISO-2 strings
  //   - empty country falls through (no pickedAt without country)
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(body, /String\(r\.country \|\| ''\)\.toUpperCase\(\)/);
  assert.match(body, /if \(!country\) continue;/);
});

test('Share is server-rounded to 3 decimals (0.1pp precision) + null on 0-denominator', () => {
  // Same precision posture as sprint-53 quote-acceptance. Null
  // avoids NaN% in the UI when no picks landed.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(body, /concentrationShare = concentrationTotal > 0[\s\S]*?Math\.round\(\(concentrationTopCount \/ concentrationTotal\) \* 1000\) \/ 1000[\s\S]*?: null/);
});

test('isConcentrated requires ALL of: total >= MIN_COUNT + share !== null + share >= THRESHOLD', () => {
  // The triple gate. A refactor that dropped the share-null
  // check would surface NaN-driven concentrations on first runs.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(body, /concentrationTotal >= SUPPLIER_CONCENTRATION_MIN_COUNT/);
  assert.match(body, /concentrationShare !== null/);
  // Sprint 60 — gate now reads the effective (per-org-config)
  // value instead of the static constant. Either name is
  // acceptable for the threshold slot.
  assert.match(
    body,
    /concentrationShare >= (?:SUPPLIER_CONCENTRATION_THRESHOLD|effectiveConcentrationThreshold)/,
  );
});

// ── TS mirror ──────────────────────────────────────────────────────

test('TS OpsInsightsSupplierConcentrationCohort mirrors the JS shape', () => {
  assert.match(API_TS, /export interface OpsInsightsSupplierConcentrationCohort \{[\s\S]*?windowDays: number;[\s\S]*?minCount: number;[\s\S]*?threshold: number;[\s\S]*?totalPicks: number;[\s\S]*?topCountry: string \| null;[\s\S]*?topCountryCount: number;[\s\S]*?topCountryShare: number \| null;[\s\S]*?isConcentrated: boolean;[\s\S]*?\}/);
});

test('TS OpsInsights extends with supplierConcentration field', () => {
  assert.match(API_TS, /supplierConcentration: OpsInsightsSupplierConcentrationCohort;/);
});

// ── UI ─────────────────────────────────────────────────────────────

test('Ops Insights page imports the OpsInsightsSupplierConcentrationCohort type', () => {
  assert.match(INSIGHTS_TSX, /type OpsInsightsSupplierConcentrationCohort/);
});

test('SupplierConcentrationCard mounts AFTER QuoteAcceptanceCard + BEFORE RevisionCohort (proactive band order)', () => {
  // Four proactive cards in order: stalled → decline-spike →
  // quote-acceptance → supplier-concentration. Drift-guard pins
  // the relative order so a refactor can't break the proactive
  // band's intentional priority.
  assert.match(INSIGHTS_TSX, /<SupplierConcentrationCard data=\{data\.supplierConcentration\} \/>/);
  const qaIdx = INSIGHTS_TSX.indexOf('<QuoteAcceptanceCard');
  const scIdx = INSIGHTS_TSX.indexOf('<SupplierConcentrationCard');
  const revisionIdx = INSIGHTS_TSX.indexOf('<RevisionCohort');
  assert.ok(qaIdx < scIdx, 'SupplierConcentrationCard must mount AFTER QuoteAcceptanceCard');
  assert.ok(scIdx < revisionIdx, 'SupplierConcentrationCard must mount BEFORE RevisionCohort');
});

test('Ops Insights page renders <SupplierConcentrationCard> ONLY when isConcentrated', () => {
  assert.match(INSIGHTS_TSX, /\{data\.supplierConcentration\.isConcentrated && \(\s*<SupplierConcentrationCard/);
});

test('SupplierConcentrationCard reads all comparison parameters from data (NOT hardcoded literals)', () => {
  const block = INSIGHTS_TSX.match(/function SupplierConcentrationCard\(\{ data \}: \{ data: OpsInsightsSupplierConcentrationCohort \}\)[\s\S]*?\n\}/);
  assert.ok(block, 'SupplierConcentrationCard body not located');
  const body = block[0];
  assert.match(body, /\{data\.windowDays\}/);
  assert.match(body, /\{data\.minCount\}/);
  assert.match(body, /data\.threshold/);
  assert.match(body, /\{data\.totalPicks\}/);
  assert.match(body, /\{data\.topCountry/);
  assert.match(body, /\{data\.topCountryCount\}/);
});

test('SupplierConcentrationCard renders share as integer percentage with — fallback for null', () => {
  const block = INSIGHTS_TSX.match(/function SupplierConcentrationCard\(\{ data \}: \{ data: OpsInsightsSupplierConcentrationCohort \}\)[\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /data\.topCountryShare !== null[\s\S]*?Math\.round\(data\.topCountryShare \* 100\)[\s\S]*?'—'/);
});

test('SupplierConcentrationCard surfaces a — fallback for the topCountry headline (defensive)', () => {
  // topCountry CAN be null when the COHORT isn't concentrated and
  // no picks exist; the parent gates render but the card itself
  // should fail-soft on a transient null.
  const block = INSIGHTS_TSX.match(/function SupplierConcentrationCard\(\{ data \}: \{ data: OpsInsightsSupplierConcentrationCohort \}\)[\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /data\.topCountry \|\| '—'/);
});
