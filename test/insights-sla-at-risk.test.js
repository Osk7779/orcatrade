'use strict';

// Sprint 91 — cohort #13: SLA at risk (measurement → prevention).
//
// The attainment blocks (sprints 83/84) report the PAST; cohort
// #13 lists the LIVE requests approaching — or past — the org's
// turnaround promise, so the breach never happens (or at least
// never happens silently).
//
// Load-bearing invariants:
//   - The line follows the ORG'S NEGOTIATED target (knob 6):
//     riskLine = round(effectiveTurnTarget × SLA_RISK_FRACTION).
//     Contrast pinned against the cross-org triage console, which
//     stays on the PLATFORM line by design.
//   - Two truths split honestly: atRisk (recoverable) vs breached
//     (promise already broken, customer still waiting). Both
//     counted; the split comes from ONE query's two FILTERs over
//     the same predicate.
//   - hoursRemaining is server-derived, one derivation; negative
//     = breached. The UI renders the sign, never recomputes.
//   - Same unquoted predicate family as the sprint-87/90 surfaces
//     (quoted_at IS NULL + pre-quote statuses) — the cohort, the
//     console count, and the drill-down describe the same rows.
//   - Worklist semantics: archived out; window-agnostic.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sla = require('../lib/intelligence/sla');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// The 6g block, from its banner to the result assembly.
const COHORT = DB_SRC.match(/── 6g\. SLA-at-risk cohort \(sprint 91[\s\S]*?const slaAtRisk = \{[\s\S]*?\};/);

// ── SQL discipline ────────────────────────────────────────────────

test('the risk line follows the NEGOTIATED target: round(effectiveTurnTarget × SLA_RISK_FRACTION)', () => {
  assert.ok(COHORT, '6g block not found');
  assert.match(
    COHORT[0],
    /const slaRiskLineHours = Math\.round\(effectiveTurnTarget \* slaCalc\.SLA_RISK_FRACTION\);/,
  );
  // The fraction is the shared constant — one definition of "at
  // risk" across the cohort and the (platform-line) console.
  assert.equal(sla.SLA_RISK_FRACTION, 0.75);
});

test('cohort predicate matches the sprint-87/90 unquoted family (same rows everywhere)', () => {
  const body = COHORT[0];
  assert.match(body, /AND quoted_at IS NULL/);
  assert.match(body, /AND status IN \('submitted', 'processing', 'awaiting_review'\)/);
  assert.match(body, /AND archived_at IS NULL/);
  // Window-agnostic: no dashboard-days var anywhere in the block.
  assert.ok(!/String\(days\)/.test(body), 'the days toggle must not move this cohort');
});

test('atRisk vs breached split comes from ONE query with two FILTERs over the same predicate', () => {
  const body = COHORT[0];
  assert.match(body, /COUNT\(\*\) FILTER \(\s*\n\s*WHERE created_at >= now\(\) - \(\$3 \|\| ' hours'\)::interval\s*\n\s*\)::int AS at_risk/);
  assert.match(body, /COUNT\(\*\) FILTER \(\s*\n\s*WHERE created_at < now\(\) - \(\$3 \|\| ' hours'\)::interval\s*\n\s*\)::int AS breached/);
  // $2 = risk line (outer cut), $3 = full target (the split).
  assert.match(body, /\[orgId, String\(slaRiskLineHours\), String\(effectiveTurnTarget\)\]/);
});

test('items: top 10 oldest; hoursRemaining server-derived once, negative = breached', () => {
  const body = COHORT[0];
  assert.match(body, /ORDER BY created_at ASC\s*\n\s*LIMIT 10/);
  assert.match(
    body,
    /hoursRemaining: Math\.round\(\(effectiveTurnTarget - Number\(r\.age_hours\)\) \* 10\) \/ 10,/,
  );
});

test('CONTRAST: the cross-org triage console stays on the PLATFORM line (no negotiated targets)', () => {
  const triageSrc = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'operator-triage.js'), 'utf8');
  assert.match(triageSrc, /slaCalc\.slaRiskThresholdHours\(\)/);
  assert.ok(
    !/effectiveTurnTarget|getOperatorConfig/.test(triageSrc),
    'the operator risk line is platform-wide by design; only the org cohort follows the contract',
  );
});

// ── Surface ───────────────────────────────────────────────────────

test('insights response carries slaAtRisk; TS mirrors both interfaces', () => {
  assert.match(DB_SRC, /\n        slaAtRisk,\n/);
  assert.match(
    API_TS,
    /export interface OpsInsightsSlaAtRiskItem \{[\s\S]*?hoursRemaining: number;\s*\n\}/,
  );
  assert.match(
    API_TS,
    /export interface OpsInsightsSlaAtRiskCohort \{[\s\S]*?atRiskCount: number;\s*\n\s*breachedCount: number;[\s\S]*?\}/,
  );
  assert.match(API_TS, /slaAtRisk: OpsInsightsSlaAtRiskCohort;/);
});

test('card renders FIRST in the proactive band, gated on total > 0, sign-only rendering', () => {
  // First: the at-risk card renders before the aging-quotes card.
  const cardIdx = INSIGHTS_TSX.indexOf('<SlaAtRiskCard data={data.slaAtRisk} />');
  const agingIdx = INSIGHTS_TSX.indexOf('<QuoteFollowUpCard data={data.quoteFollowUp} />');
  assert.ok(cardIdx > -1 && agingIdx > -1 && cardIdx < agingIdx,
    'the most urgent signal renders first');
  assert.match(
    INSIGHTS_TSX,
    /\{\(data\.slaAtRisk\.atRiskCount \+ data\.slaAtRisk\.breachedCount\) > 0 && \(/,
  );
  const card = INSIGHTS_TSX.match(/function SlaAtRiskCard\([\s\S]*?\n\}\n/)[0];
  // Sign-only: the card branches on hoursRemaining < 0 — it never
  // re-derives hours from timestamps.
  assert.match(card, /const breached = item\.hoursRemaining < 0;/);
  assert.ok(!/Date\.now|new Date\(/.test(card), 'the card must not recompute time math');
  assert.match(card, /h over/);
  assert.match(card, /h left/);
  // Honest split in the headline when breaches exist.
  assert.match(card, /\$\{data\.atRiskCount\} at risk · \$\{data\.breachedCount\} breached/);
  assert.match(card, /data-testid="sla-at-risk-card"/);
});
