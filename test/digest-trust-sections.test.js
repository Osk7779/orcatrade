'use strict';

// Sprint 94 — the weekly digest gains the trust-era sections +
// the standing INVERSE knob-threading guard.
//
// The Monday digest predated sprints 80-92: orgs got funnel /
// declines / revision recovery but none of the measured-trust
// signals. Now a "Service commitments (measured)" section carries
// SLA attainment (both commitments), the accuracy ledger line,
// and the live at-risk snapshot — all tier-aware per ADR 0021
// (below the shared gates a line reads the accruing state, never
// a null%).
//
// The digest renders knob-dependent numbers now, so its runner
// threads the FULL org config exactly like handleInsights — the
// sprint-88 lesson applied BEFORE the bug this time. And the
// sprint-88 guard family gains its inverse: every cron runner
// that reads a knobbed cohort must thread that cohort's knob
// (sprint 88 guarded cron ⊆ cockpit; this guards runner-per-
// cohort completeness).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importsEmails = require('../lib/imports-emails');
const operatorConfig = require('../lib/operator-config');

const ROOT = path.resolve(__dirname, '..');
const CRON_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'cron.js'), 'utf8');

const MEASURED = {
  totalInWindow: 12,
  funnelByStatus: { submitted: 2, quoted: 4, customer_approved: 3 },
  declineReasons: {},
  totalDeclined: 0,
  revisionCohort: {},
  slaQuoteTurnaround: { windowDays: 90, targetHours: 48, sampleSize: 60, tier: 'measured', withinTargetPct: 92, medianHours: 31, p95Hours: 47 },
  slaFirstResponse: { windowDays: 90, targetHours: 24, sampleSize: 60, tier: 'measured', withinTargetPct: 97, medianHours: 5.5, p95Hours: 21 },
  accuracyLedger: { sampleSize: 55, tier: 'measured', within5Pct: 60, within10Pct: 85, within20Pct: 96, medianAbsErrorPct: 4.2, valueWeightedBiasPct: 1.1, totalEstimateCents: 1, totalActualCents: 1, oldestReportedAt: null, newestReportedAt: null },
  slaAtRisk: { riskThresholdHours: 36, targetHours: 48, atRiskCount: 2, breachedCount: 1, items: [] },
};

// ── Composer: tier-aware sections ─────────────────────────────────

test('measured tiers render the full commitment lines (both SLAs + accuracy + at-risk with breach)', () => {
  const composed = importsEmails.composeOpsInsightsDigest({
    orgName: 'Acme', windowDays: 7, insights: MEASURED,
  });
  assert.match(composed.text, /Service commitments \(measured\)/);
  assert.match(composed.text, /Quote turnaround: 92% within 48h · median 31h/);
  assert.match(composed.text, /First response: 97% within 24h · median 5\.5h/);
  assert.match(composed.text, /Quote accuracy: 85% within ±10% · median error 4\.2%/);
  assert.match(composed.text, /SLA at risk RIGHT NOW: 3 \(1 already breached\)/);
  assert.match(composed.html, /Service commitments \(measured\)/);
});

test('insufficient tiers read the ACCRUING state — never a null% (ADR 0021 gates honoured in email)', () => {
  const composed = importsEmails.composeOpsInsightsDigest({
    windowDays: 7,
    insights: {
      ...MEASURED,
      slaQuoteTurnaround: { ...MEASURED.slaQuoteTurnaround, tier: 'insufficient', sampleSize: 3, withinTargetPct: null, medianHours: null },
      accuracyLedger: { ...MEASURED.accuracyLedger, tier: 'insufficient', sampleSize: 1, within10Pct: null, medianAbsErrorPct: null },
      slaAtRisk: { ...MEASURED.slaAtRisk, atRiskCount: 0, breachedCount: 0 },
    },
  });
  assert.match(composed.text, /Quote turnaround: accruing \(3 in sample\)/);
  assert.match(composed.text, /Quote accuracy: accruing \(1 outcome reported\)/);
  assert.match(composed.text, /SLA at risk right now: none/);
  assert.ok(!/null/.test(composed.text), 'no null may ever reach the email body');
});

test('indicative tier carries the early-sample label', () => {
  const composed = importsEmails.composeOpsInsightsDigest({
    windowDays: 7,
    insights: {
      ...MEASURED,
      slaQuoteTurnaround: { ...MEASURED.slaQuoteTurnaround, tier: 'indicative', sampleSize: 12 },
    },
  });
  assert.match(composed.text, /Quote turnaround: 92% within 48h · median 31h · early sample/);
});

test('LEGACY insights objects (no trust-era fields) render the classic digest — no section, no crash', () => {
  const composed = importsEmails.composeOpsInsightsDigest({
    windowDays: 7,
    insights: { totalInWindow: 5, funnelByStatus: {}, declineReasons: {}, revisionCohort: {} },
  });
  assert.ok(composed, 'composer must survive the pre-94 shape');
  assert.ok(!/Service commitments/.test(composed.text), 'no section without the data');
});

// ── Runner threading ─────────────────────────────────────────────

test('the digest runner threads EVERY knob (knob-derived — an 8th knob fails this until threaded)', () => {
  const start = CRON_SRC.indexOf('async function runImportRequestInsightsDigest(');
  const next = CRON_SRC.indexOf('async function ', start + 10);
  const body = CRON_SRC.slice(start, next);
  assert.match(body, /const orgConfig = await operatorConfig\.getOperatorConfig\(orgIdNumeric\);/);
  for (const knob of operatorConfig.KNOB_KEYS) {
    assert.match(
      body,
      new RegExp(`${knob}: orgConfig\\.${knob},`),
      `the digest renders the whole cockpit — it must thread ${knob}`,
    );
  }
});

// ── Standing INVERSE guard: runner-per-cohort completeness ───────

test('every cron runner that reads a knobbed cohort threads that cohort knob (inverse of sprint 88)', () => {
  // The cohort → knob dependency map. Extend when a cohort gains a
  // knob — the sprint-89 knob-derived pins force the cockpit side;
  // this forces the runner side.
  const COHORT_KNOBS = {
    stalledQueue: ['stallThresholdDays'],
    quoteFollowUp: ['quoteFollowUpThresholdDays'],
    declineSpike: ['declineSpikeRateMultiplier'],
    supplierConcentration: ['supplierConcentrationThreshold'],
    ratingTrend: ['ratingTrendDropThreshold'],
    slaAtRisk: ['slaQuoteTurnaroundTargetHours'],
    slaQuoteTurnaround: ['slaQuoteTurnaroundTargetHours'],
    slaFirstResponse: ['slaFirstResponseTargetHours'],
    accuracyLedger: [],       // no knob — always org-scoped by orgId
    expiredQuotes: [],        // fixed 30-day window, no knob
    quoteAcceptance: [],      // sprint-53 constants, no knob
    totalInWindow: [],        // scalar, no knob
  };
  const runnerNames = [...CRON_SRC.matchAll(/async function (runImportRequest\w+)\(/g)].map((m) => m[1]);
  for (const name of runnerNames) {
    const start = CRON_SRC.indexOf(`async function ${name}(`);
    const next = CRON_SRC.indexOf('async function ', start + 10);
    const body = CRON_SRC.slice(start, next === -1 ? CRON_SRC.length : next);
    if (!/aggregateOpsInsights/.test(body)) continue;
    // Comment-stripped: the next runner's banner comment sits inside
    // this slice; only CODE reads count as cohort consumption.
    const codeOnly = body
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    const cohortsRead = [...codeOnly.matchAll(/insights\.(\w+)/g)].map((m) => m[1]);
    for (const cohort of new Set(cohortsRead)) {
      const needed = COHORT_KNOBS[cohort];
      assert.ok(
        needed !== undefined,
        `${name} reads insights.${cohort} — add it to the COHORT_KNOBS map (with its knob deps, or [])`,
      );
      for (const knob of needed) {
        assert.match(
          body,
          new RegExp(`${knob}: orgConfig\\.${knob}`),
          `${name} reads insights.${cohort} but does not thread ${knob} — its email would use platform defaults while the cockpit uses the org's (the sprint-88 bug, runner side)`,
        );
      }
    }
  }
});
