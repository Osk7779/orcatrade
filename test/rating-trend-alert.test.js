'use strict';

// Sprint 63 — weekly rating-trend alert email.
//
// Pairs with the sprint-62 fifth proactive cohort (cohort #10 +
// RatingTrendCard on /imports/insights). Mirrors sprints
// 39 / 41 / 54 / 58's alert trifecta shape with the WEEKLY
// Friday cadence — slow-cook customer-satisfaction signal,
// end-of-week wrap so ops can plan investigation Mon AM.
//
// Tests cover four layers:
//   1. PREF_KEYS: importRatingTrendAlertEmails added (17th key);
//      TS Prefs mirror carries the new key; /preferences page
//      surfaces the toggle
//   2. composeRatingTrendAlert: subject + body name the avg +
//      delta + threshold; strict-boolean fail-closed on
//      isDeclining (sprint-54 lesson); defensive null-guards on
//      currentAvg/baselineAvg; XSS-safe (no double-encoded
//      entities)
//   3. sendRatingTrendAlert: short-circuits with
//      reason='not-declining' on healthy cohort; pref-gated
//      per-recipient via importRatingTrendAlertEmails; fail-soft
//      posture matches sprint-58 pattern
//   4. Cron handler integration:
//      runImportRequestRatingTrendAlert reuses
//      aggregateOpsInsights (cohort #10 source of truth); skips
//      healthy orgs (!isDeclining); GHA Fri 09:00 UTC schedule +
//      workflow_dispatch entry registered

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importsEmails = require('../lib/imports-emails');
const notificationPrefs = require('../lib/notification-prefs');
const cron = require('../lib/handlers/cron');

const ROOT = path.resolve(__dirname, '..');
const EMAILS_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'imports-emails.js'), 'utf8');
const CRON_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'cron.js'), 'utf8');
const CRON_YAML = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'cron.yml'),
  'utf8',
);
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const PREFS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'preferences', 'page.tsx'),
  'utf8',
);

function buildTrendCohort(over = {}) {
  return {
    currentDays: 7,
    baselineDays: 30,
    minCount: 3,
    dropThreshold: 0.5,
    currentCount: 5,
    currentAvg: 3.4,
    baselineCount: 18,
    baselineAvg: 4.6,
    delta: 1.2,           // positive = decline (baseline - current)
    isDeclining: true,
    ...over,
  };
}

// ── PREF_KEYS surface ──────────────────────────────────────────────

test('PREF_KEYS includes importRatingTrendAlertEmails (17th key)', () => {
  assert.ok(
    notificationPrefs.PREF_KEYS.includes('importRatingTrendAlertEmails'),
    'new pref key not added to PREF_KEYS',
  );
});

test('TS Prefs mirror carries importRatingTrendAlertEmails', () => {
  assert.match(API_TS, /importRatingTrendAlertEmails\?: boolean;/);
});

test('Preferences page surfaces the rating-trend toggle in the Ops inbox group', () => {
  assert.match(
    PREFS_TSX,
    /\{ key: 'importRatingTrendAlertEmails', label: 'Rating-trend weekly alert'/,
  );
});

// ── composeRatingTrendAlert ────────────────────────────────────────

test('composeRatingTrendAlert returns null when cohort is NOT declining (healthy short-circuit)', () => {
  const out = importsEmails.composeRatingTrendAlert({
    orgName: 'Acme',
    ratingTrend: buildTrendCohort({ isDeclining: false }),
  });
  assert.equal(out, null);
});

test('composeRatingTrendAlert returns null on non-boolean isDeclining (sprint-54 lesson — fail closed)', () => {
  // Strict-boolean check. Sprint-54 caught a string-truthy
  // value passing through producing partially-undefined email
  // bodies. Pin the strict-true gate.
  assert.equal(importsEmails.composeRatingTrendAlert({ ratingTrend: null }), null);
  assert.equal(
    importsEmails.composeRatingTrendAlert({
      ratingTrend: { isDeclining: 'truthy-but-not-bool' },
    }),
    null,
  );
});

test('composeRatingTrendAlert returns null when isDeclining:true but avgs are null (upstream broken)', () => {
  // Defensive: isDeclining=true should imply both currentAvg
  // + baselineAvg are non-null. If they're not, upstream is
  // broken; fail closed rather than stringifying nulls.
  assert.equal(
    importsEmails.composeRatingTrendAlert({
      ratingTrend: buildTrendCohort({ currentAvg: null }),
    }),
    null,
  );
  assert.equal(
    importsEmails.composeRatingTrendAlert({
      ratingTrend: buildTrendCohort({ baselineAvg: null }),
    }),
    null,
  );
});

test('composeRatingTrendAlert renders { subject, text, html } for a declining cohort', () => {
  const out = importsEmails.composeRatingTrendAlert({
    orgName: 'Acme',
    ratingTrend: buildTrendCohort(),
  });
  assert.ok(out && typeof out === 'object');
  assert.equal(typeof out.subject, 'string');
  assert.equal(typeof out.text, 'string');
  assert.equal(typeof out.html, 'string');
  // Subject names BOTH avgs so the inbox preview tells the story.
  assert.match(out.subject, /\[Acme\] Rating 3\.4★ \(was 4\.6★\) — investigate drift/);
  // Body opening explicitly states the two windows + the delta.
  assert.match(out.text, /Over the last 7 days/);
  assert.match(out.text, /prior 30 days/);
  assert.match(out.text, /-1\.2★ drift/);
});

test('composeRatingTrendAlert surfaces the triple-gate explanation (drop + min count + sprint-33 contrast)', () => {
  const out = importsEmails.composeRatingTrendAlert({
    ratingTrend: buildTrendCohort(),
  });
  assert.ok(out);
  assert.match(out.text, /crossed 0\.5★ AND there are >= 3 ratings/);
  // Sprint-33 contrast surfaces in both text + HTML.
  assert.match(out.text, /Sprint-33 per-event alerts only fire on 1-2★/);
});

test('composeRatingTrendAlert HTML does NOT double-encode entities (sprint 39 lesson)', () => {
  const out = importsEmails.composeRatingTrendAlert({
    ratingTrend: buildTrendCohort(),
  });
  assert.ok(out);
  assert.ok(!out.html.includes('&amp;times;'), 'double-encoded entity in HTML');
  assert.ok(!out.html.includes('&amp;#'), 'double-encoded numeric entity in HTML');
  assert.ok(!out.html.includes('&amp;ge;'), 'double-encoded &ge; in HTML');
});

// ── sendRatingTrendAlert ──────────────────────────────────────────

test('sendRatingTrendAlert short-circuits with reason="not-declining" on healthy cohort', async () => {
  const out = await importsEmails.sendRatingTrendAlert({
    orgIdNumeric: 1,
    ratingTrend: buildTrendCohort({ isDeclining: false }),
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'not-declining');
});

test('sendRatingTrendAlert requires orgIdNumeric + ratingTrend (defensive guards)', async () => {
  const noOrg = await importsEmails.sendRatingTrendAlert({
    ratingTrend: buildTrendCohort(),
  });
  assert.equal(noOrg.ok, false);
  assert.match(noOrg.reason, /orgIdNumeric required/);
  const noCohort = await importsEmails.sendRatingTrendAlert({ orgIdNumeric: 1 });
  assert.equal(noCohort.ok, false);
  assert.match(noCohort.reason, /ratingTrend required/);
});

test('sendRatingTrendAlert uses the importRatingTrendAlertEmails pref gate', () => {
  const block = EMAILS_SRC.match(/async function sendRatingTrendAlert\([\s\S]*?\n\}/);
  assert.ok(block, 'sendRatingTrendAlert body not located');
  assert.match(
    block[0],
    /filterMutedRecipients\(resolution\.recipients, 'importRatingTrendAlertEmails'\)/,
  );
});

test('sendRatingTrendAlert preserves the fail-soft posture (no-inbox + all-muted branches)', () => {
  const block = EMAILS_SRC.match(/async function sendRatingTrendAlert\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /return \{ ok: false, reason: 'no-inbox' \}/);
  assert.match(body, /return \{ ok: false, reason: 'all-muted' \}/);
  assert.match(body, /partial failure/);
  assert.match(body, /return \{ ok: sent > 0, sent, failed \}/);
});

// ── Cron handler integration ─────────────────────────────────────

test('Cron handler exposes runImportRequestRatingTrendAlert + registers it as a job', () => {
  assert.equal(typeof cron.runImportRequestRatingTrendAlert, 'function');
  assert.match(
    CRON_SRC,
    /'import-request-rating-trend-alert': runImportRequestRatingTrendAlert/,
  );
});

test('runImportRequestRatingTrendAlert reuses aggregateOpsInsights (cohort #10 source-of-truth)', () => {
  const block = CRON_SRC.match(/async function runImportRequestRatingTrendAlert\([\s\S]*?\n\}/);
  assert.ok(block, 'runImportRequestRatingTrendAlert body not located');
  const body = block[0];
  assert.match(body, /importRequests\.aggregateOpsInsights\(\{/);
  assert.match(body, /const ratingTrend = agg\.insights && agg\.insights\.ratingTrend/);
});

test('runImportRequestRatingTrendAlert skips healthy orgs (!isDeclining) silently', () => {
  const block = CRON_SRC.match(/async function runImportRequestRatingTrendAlert\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /if \(!ratingTrend \|\| !ratingTrend\.isDeclining\)/);
  assert.match(body, /healthyByOrg \+= 1;[\s\S]*?continue;/);
});

test('runImportRequestRatingTrendAlert per-org error isolation matches sprint-58 pattern', () => {
  const block = CRON_SRC.match(/async function runImportRequestRatingTrendAlert\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /for \(const org of allOrgs\) \{[\s\S]*?try \{/);
  assert.match(body, /errors\.push\(\{[\s\S]*?orgId: String\(org\.id \|\| '\?'\)/);
});

// ── GitHub Actions schedule ──────────────────────────────────────

test('GHA cron.yml registers the Fri 09:00 UTC schedule for the rating-trend alert', () => {
  // Friday = the 5th weekly slot (after Mon insights, Wed quote-
  // acceptance, Thu supplier-concentration) — end-of-week wrap
  // so ops can plan investigation Mon AM.
  assert.match(CRON_YAML, /- cron: '0 9 \* \* 5'/);
});

test('GHA cron.yml routes the Fri 09:00 schedule + workflow_dispatch to the right job', () => {
  assert.match(
    CRON_YAML,
    /elif \[ "\$\{\{ github\.event\.schedule \}\}" = "0 9 \* \* 5" \]; then\s+echo "job=import-request-rating-trend-alert"/,
  );
  assert.match(CRON_YAML, /- import-request-rating-trend-alert/);
});
