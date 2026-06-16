'use strict';

// Sprint 29 — top picked countries cohort + drill-down.
//
// Tests cover four layers:
//   1. Data layer: aggregateOpsInsights returns topPickedCountries +
//      totalPicked; listImportRequestsForOrg accepts supplierPickCountry
//      with ISO-2 validation
//   2. Handler: passes supplierPick through; maps validation error to 400
//   3. TS mirror: OpsInsightsTopPickedCountry shape + OpsInsights extension
//   4. UI: insights renders <TopPickedCountries>; each row becomes a Link
//      to /imports?supplierPick=<ISO-2>; /imports page recognises the
//      cohort + drops mine=1 + surfaces a banner + preserves the cohort
//      across status-chip clicks + has cohort-specific empty state
//
// The sprint-28 promise was "signal, not re-rank." Sprint 29 turns the
// per-request signal into an org-wide cohort surface, BUT must not
// re-rank either — the row order is deterministic count-desc, sorted
// server-side. Drift-guard pins the count-desc sort + the slice(0, 6)
// digest discipline.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequestsDb = require('../lib/db/import-requests');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);
const LIST_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'page.tsx'),
  'utf8',
);

// ── Data layer: aggregateOpsInsights extension ─────────────────────

test('aggregateOpsInsights computes topPickedCountries (server-sorted desc, top 6)', () => {
  // Digest discipline: top 6 keeps the cohort card scannable. A
  // refactor that bumped to 20 would clutter the surface; pin the cap.
  // Likewise the sort must be on the count DESC dimension.
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block, 'aggregateOpsInsights body not located');
  const body = block[0];
  assert.match(body, /\.sort\(\(a, b\) => b\.count - a\.count\)/);
  assert.match(body, /\.slice\(0, 6\)/);
});

test('aggregateOpsInsights derives dominantRationale server-side per country', () => {
  // Same pattern as the per-request PastPickBadge tooltip (sprint
  // 28): "mostly compliance fit." The UI shouldn't redo the work.
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /dominantRationale/);
  assert.match(body, /dominantCount = 0/);
});

test('aggregateOpsInsights uses supplier_pick->>pickedAt for recency (not created_at)', () => {
  // Same rule as aggregateSupplierPicks (sprint 28): pick recency
  // matters, not request creation. Drift-guard so a refactor can't
  // silently shift the temporal dimension.
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block);
  // The pickRows SELECT must filter on pickedAt — appears in BOTH the
  // SELECT projection AND the WHERE clause.
  assert.match(block[0], /supplier_pick->>'pickedAt'/);
  assert.match(block[0], /\(supplier_pick->>'pickedAt'\)::timestamptz/);
});

// ── listImportRequestsForOrg: supplierPickCountry filter ──────────

test('listImportRequestsForOrg accepts supplierPickCountry', async () => {
  // Not-configured branch in the test env; pin the signature.
  const r = await importRequestsDb.listImportRequestsForOrg({
    orgId: 1, supplierPickCountry: 'VN',
  });
  assert.ok('ok' in r);
});

test('listImportRequestsForOrg rejects an invalid (non-ISO-2) country', async () => {
  // A forged ?supplierPick=DROP-TABLE must not reach the JSONB
  // lookup with arbitrary text. Pin the data-layer gate.
  const r = await importRequestsDb.listImportRequestsForOrg({
    orgId: 1, supplierPickCountry: 'Vietnam',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /supplierPickCountry must be ISO-2/.test(e)));
});

test('listImportRequestsForOrg uppercases + trims the country before the WHERE clause', () => {
  // Defensive: a customer linking ?supplierPick=vn should match a
  // row with supplier_pick.country='VN'. The data layer normalises
  // — drift-guard pins it at source so a refactor doesn't
  // accidentally make the comparison case-sensitive.
  const block = DB_SRC.match(/async function listImportRequestsForOrg\([\s\S]*?\nasync function /);
  assert.ok(block, 'listImportRequestsForOrg body not located');
  assert.match(block[0], /supplierPickCountry\.trim\(\)\.toUpperCase\(\)/);
});

test('listImportRequestsForOrg WHERE clause keys on supplier_pick->>country', () => {
  // Drift-guard the lookup path: a refactor that swapped to a
  // different JSONB key would silently return 0 rows.
  const block = DB_SRC.match(/async function listImportRequestsForOrg\([\s\S]*?\nasync function /);
  assert.ok(block);
  assert.match(block[0], /supplier_pick->>'country' = \$\$\{params\.length\}/);
});

// ── Handler ────────────────────────────────────────────────────────

test('handleList passes the supplierPick query param through', () => {
  const block = HANDLER_SRC.match(/async function handleList\([\s\S]*?\n\}/);
  assert.ok(block, 'handleList body not located');
  assert.match(block[0], /supplierPickCountry: q\.supplierPick \? String\(q\.supplierPick\) : undefined/);
});

test('handleList returns 400 on supplierPickCountry validation failure', () => {
  // The data-layer error message starts "supplierPickCountry must be".
  // Handler's 400 predicate must include that prefix; pin it.
  const block = HANDLER_SRC.match(/async function handleList\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /supplierPickCountry must be/);
  assert.match(block[0], /jsonResponse\(res, 400/);
});

// ── TS mirror ──────────────────────────────────────────────────────

test('OpsInsights interface gains topPickedCountries + totalPicked', () => {
  assert.match(API_TS, /export interface OpsInsightsTopPickedCountry \{[\s\S]*?country: string[\s\S]*?count: number[\s\S]*?lastPickedAt: string \| null[\s\S]*?dominantRationale: string \| null[\s\S]*?rationaleCategoryMix: Record<string, number>/);
  // The OpsInsights interface includes the new cohort.
  assert.match(API_TS, /topPickedCountries: OpsInsightsTopPickedCountry\[\];/);
  assert.match(API_TS, /totalPicked: number;/);
});

// ── /imports/insights UI ──────────────────────────────────────────

test('Insights page imports OpsInsightsTopPickedCountry type + renders <TopPickedCountries>', () => {
  assert.match(INSIGHTS_TSX, /type OpsInsightsTopPickedCountry/);
  assert.match(INSIGHTS_TSX, /<TopPickedCountries data=\{data\} \/>/);
  assert.match(INSIGHTS_TSX, /function TopPickedCountries\(\{ data \}/);
});

test('TopPickedCountries empty-state renders a coaching message (not just "empty")', () => {
  // Like sprint 17's cohort cards, the empty state teaches the user
  // about the cohort mechanic — what records here, why, when. A
  // bare "No picks" wouldn't help a brand-new org understand
  // what's missing.
  assert.match(INSIGHTS_TSX, /No materialised picks in this window/);
  assert.match(INSIGHTS_TSX, /your team picked this 4×/);
});

test('Each <PickedCountryRow> is a <Link> to /imports?supplierPick=<country>', () => {
  // The drill-down is the whole point. Pin the href shape AND the
  // encodeURIComponent guard.
  assert.match(
    INSIGHTS_TSX,
    /href=\{`\/imports\?supplierPick=\$\{encodeURIComponent\(row\.country\)\}`\}/,
  );
});

test('PickedCountryRow surfaces the dominantRationale label inline', () => {
  // The badge promise: "12 picks, mostly lead-time" — not just
  // the count. Pin both the dominantLabel derivation and the
  // inline render.
  assert.match(INSIGHTS_TSX, /const dominantLabel = row\.dominantRationale/);
  assert.match(INSIGHTS_TSX, /mostly <span className="text-\[var\(--color-aqua\)\]">\{dominantLabel\}/);
});

test('PICK_RATIONALE_LABELS in the insights page covers every PICK_RATIONALE_CATEGORIES key', () => {
  // Same drift-guard as sprint 28's PastPickBadge: a new enum
  // entry without a UI label would render the raw string.
  const block = INSIGHTS_TSX.match(/const PICK_RATIONALE_LABELS: Record<string, string> = \{([\s\S]*?)\};/);
  assert.ok(block, 'PICK_RATIONALE_LABELS not located in insights page');
  const body = block[1];
  for (const k of importRequestsDb.PICK_RATIONALE_CATEGORIES) {
    assert.match(body, new RegExp(`\\b${k}:`), `PICK_RATIONALE_LABELS missing key: ${k}`);
  }
});

// ── /imports list page: supplier-pick cohort drill-down ──────────

test('/imports list page reads + validates ?supplierPick against ISO-2 shape', () => {
  // Defense-in-depth: data layer rejects bad input with a 400,
  // but the client gate prevents the URL from even hitting the
  // network in malformed form.
  assert.match(LIST_TSX, /sp\.get\(['"]supplierPick['"]\)/);
  assert.match(LIST_TSX, /\/\^\[A-Z\]\{2\}\$\/\.test\(supplierPickRaw\.toUpperCase\(\)\)/);
});

test('/imports list page DROPS mine=1 when in supplier-pick cohort (ops sees org-wide)', () => {
  // Same posture as sprint 23's declineReason cohort — ops should
  // see EVERY request in the org with that pick, not just their
  // own.
  assert.match(LIST_TSX, /const inCohortMode = Boolean\(cohortReason \|\| supplierPick\)/);
  assert.match(LIST_TSX, /if \(!inCohortMode\) params\.set\(['"]mine['"], ['"]1['"]\)/);
});

test('/imports list page renders the supplier-pick cohort banner with a "Back to insights" link', () => {
  assert.match(LIST_TSX, /supplierPick && \(/);
  assert.match(LIST_TSX, /Cohort · picked country/);
  assert.match(LIST_TSX, /Back to insights/);
});

test('/imports list page status chips PRESERVE supplierPick on click', () => {
  // Click "Customer approved" inside a pick cohort → the cohort
  // identity survives. Pin the conditional append in BOTH the
  // "All" chip and the per-status chip.
  // The All chip uses an inline ternary; pin the supplierPick set.
  assert.match(LIST_TSX, /if \(supplierPick\) params\.set\(['"]supplierPick['"], supplierPick\);/);
});

test('/imports list page useEffect re-fires when supplierPick changes', () => {
  // The data useEffect dep array must include supplierPick;
  // without it, navigating between cohorts (e.g. VN → IN)
  // wouldn't refetch.
  assert.match(LIST_TSX, /\[filterStatus, cohortReason, supplierPick, urlQ\]/);
});

test('/imports list page shows a supplier-pick-specific empty state', () => {
  // A user drilling into a country cohort that turned out empty
  // should see "No picks for VN" — not the default "submit a new
  // request" CTA.
  assert.match(LIST_TSX, /No picks for \{supplierPick\} in this cohort\./);
});
