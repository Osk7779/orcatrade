'use strict';

// Sprint 82 — per-org quote-accuracy view (Track B phase 3 — the
// track closes here).
//
// The org's own slice of the public Quote Accuracy Ledger: THEIR
// reported outcomes vs THEIR quotes, computed by the SAME
// calculator with the SAME honesty gates. The load-bearing
// invariant is single-source-of-truth: the org view and the public
// view can never disagree about methodology, because both call
// computeAccuracyLedger — there is no second implementation to
// drift.
//
// Test layers:
//   1. Corpus reader: optional orgId narrows the SQL cut (indexed
//      via schema-022 partial index); omitted stays platform-wide
//   2. aggregateOpsInsights wires the SAME calculator (require
//      pin + shared-gates runtime equivalence)
//   3. TS mirror + insights card pins (gate on sampleSize > 0,
//      withheld copy, public-ledger link, early-sample label)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ledger = require('../lib/intelligence/accuracy-ledger');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// ── Layer 1: corpus reader org cut ────────────────────────────────

test('listActualOutcomesForLedger: orgId narrows the cut in SQL; omitted stays platform-wide', () => {
  const block = DB_SRC.match(/async function listActualOutcomesForLedger\([\s\S]*?\n\}/);
  assert.ok(block, 'corpus reader not found');
  const body = block[0];
  // Integer-gated org scope — a string orgId never reaches SQL.
  assert.match(body, /const orgScoped = Number\.isInteger\(orgId\);/);
  assert.match(body, /\$\{orgScoped \? 'AND org_id = \$2' : ''\}/);
  assert.match(body, /orgScoped \? \[cap, orgId\] : \[cap\]/);
});

// ── Layer 2: single source of truth ───────────────────────────────

test('aggregateOpsInsights scores the org cut with THE SAME calculator as the public ledger', () => {
  // Require pin — the org view must never grow a second
  // implementation that could drift from /api/accuracy.
  assert.match(DB_SRC, /const accuracyLedgerCalc = require\('\.\.\/intelligence\/accuracy-ledger'\);/);
  assert.match(DB_SRC, /const orgOutcomeRows = await listActualOutcomesForLedger\(\{ orgId \}\);/);
  assert.match(DB_SRC, /const accuracyLedger = accuracyLedgerCalc\.computeAccuracyLedger\(orgOutcomeRows\);/);
  // Surfaced on the insights response.
  assert.match(DB_SRC, /accuracyLedger,\s*\n\s*\/\/ Sprint 40 — cohort #7\./);
});

test('the shared honesty gates hold for an org-sized sample (runtime equivalence)', () => {
  // 3 outcomes → withheld, exactly as the public ledger behaves.
  const rows = [
    { landedCents: 10100, estimateCents: 10000 },
    { landedCents: 10200, estimateCents: 10000 },
    { landedCents: 9900, estimateCents: 10000 },
  ];
  const out = ledger.computeAccuracyLedger(rows);
  assert.equal(out.sampleSize, 3);
  assert.equal(out.tier, 'insufficient');
  assert.equal(out.medianAbsErrorPct, null);
});

// ── Layer 3: TS + card ────────────────────────────────────────────

test('TS mirrors: OpsInsightsAccuracyLedger shape + OpsInsights.accuracyLedger field', () => {
  assert.match(
    API_TS,
    /export interface OpsInsightsAccuracyLedger \{[\s\S]*?tier: 'insufficient' \| 'indicative' \| 'measured';[\s\S]*?medianAbsErrorPct: number \| null;[\s\S]*?\}/,
  );
  assert.match(API_TS, /accuracyLedger: OpsInsightsAccuracyLedger;/);
});

test('insights card gates on sampleSize > 0 and renders the withheld state honestly', () => {
  assert.match(
    INSIGHTS_TSX,
    /\{data\.accuracyLedger\.sampleSize > 0 && \(\s*\n\s*<OrgAccuracyCard data=\{data\.accuracyLedger\} \/>\s*\n\s*\)\}/,
  );
  const card = INSIGHTS_TSX.match(/function OrgAccuracyCard\([\s\S]*?\n\}\n/)[0];
  assert.match(card, /const withheld = data\.tier === 'insufficient';/);
  assert.match(card, /we withhold it here exactly as we do publicly/);
  // Links the public ledger — one methodology, two views.
  assert.match(card, /href="\/trust\/accuracy\/"/);
  // Early-sample label for the indicative tier.
  assert.match(card, /Early sample — figures firm up at 50 outcomes\./);
  assert.match(card, /data-testid="org-accuracy-card"/);
});
