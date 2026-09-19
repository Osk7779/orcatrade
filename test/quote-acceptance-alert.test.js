'use strict';

// Sprint 54 — weekly quote-acceptance rate alert email.
//
// Pairs with the sprint-53 third proactive cohort (cohort #8 +
// QuoteAcceptanceCard on /imports/insights). Mirrors sprints 39 /
// 41's alert trifecta shape but with a WEEKLY cadence — the 30d
// window vs 60d baseline is a slow-moving signal, so daily would
// be noise.
//
// Tests cover four layers:
//   1. PREF_KEYS: importQuoteAcceptanceAlertEmails added; TS Prefs
//      mirror carries the new key; /preferences page surfaces the
//      toggle
//   2. composeQuoteAcceptanceAlert: subject + body name the rates
//      + delta + threshold; returns null when !isDegraded (caller
//      can fire unconditionally); XSS-safe (no double-encoded
//      entities)
//   3. sendQuoteAcceptanceAlert: short-circuits with
//      reason='not-degraded' on healthy cohort; pref-gated per-
//      recipient via importQuoteAcceptanceAlertEmails; fail-soft
//      posture matches sendStalledQueueAlert + sendDeclineSpikeAlert
//   4. Cron handler integration:
//      runImportRequestQuoteAcceptanceAlert reuses
//      aggregateOpsInsights (cohort #8 source of truth); skips
//      healthy orgs (!isDegraded); GHA Wed 09:00 UTC schedule +
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

// Fixture mirroring the sprint-53 quoteAcceptance cohort shape.
function buildAcceptanceCohort(over = {}) {
  return {
    currentDays: 30,
    baselineDays: 60,
    minCount: 5,
    degradationThreshold: 0.75,
    currentApproved: 8,
    currentQuoted: 20,
    currentRate: 0.4,
    baselineApproved: 36,
    baselineQuoted: 50,
    baselineRate: 0.72,
    delta: -0.32,
    isDegraded: true,
    ...over,
  };
}

// ── PREF_KEYS surface ──────────────────────────────────────────────

test('PREF_KEYS includes importQuoteAcceptanceAlertEmails (15th key)', () => {
  assert.ok(
    notificationPrefs.PREF_KEYS.includes('importQuoteAcceptanceAlertEmails'),
    'new pref key not added to PREF_KEYS',
  );
});

test('TS Prefs mirror carries importQuoteAcceptanceAlertEmails', () => {
  assert.match(API_TS, /importQuoteAcceptanceAlertEmails\?: boolean;/);
});

test('Preferences page surfaces the quote-acceptance toggle in the Ops inbox group', () => {
  assert.match(
    PREFS_TSX,
    /\{ key: 'importQuoteAcceptanceAlertEmails', label: 'Quote-acceptance weekly alert'/,
  );
});

// ── composeQuoteAcceptanceAlert ────────────────────────────────────

test('composeQuoteAcceptanceAlert returns null when cohort is NOT degraded (healthy short-circuit)', () => {
  const out = importsEmails.composeQuoteAcceptanceAlert({
    orgName: 'Acme',
    quoteAcceptance: buildAcceptanceCohort({ isDegraded: false }),
  });
  assert.equal(out, null);
});

test('composeQuoteAcceptanceAlert returns null on a malformed cohort object (defensive)', () => {
  assert.equal(importsEmails.composeQuoteAcceptanceAlert({ quoteAcceptance: null }), null);
  assert.equal(
    importsEmails.composeQuoteAcceptanceAlert({ quoteAcceptance: { isDegraded: 'truthy-but-not-bool' } }),
    null,
  );
});

test('composeQuoteAcceptanceAlert renders { subject, text, html } for a degraded cohort', () => {
  const out = importsEmails.composeQuoteAcceptanceAlert({
    orgName: 'Acme',
    quoteAcceptance: buildAcceptanceCohort(),
  });
  assert.ok(out && typeof out === 'object');
  assert.equal(typeof out.subject, 'string');
  assert.equal(typeof out.text, 'string');
  assert.equal(typeof out.html, 'string');
  // Subject names BOTH rates so the inbox preview tells the story
  // without opening.
  assert.match(out.subject, /\[Acme\] Quote acceptance 40% \(was 72%\)/);
  // Body opening explicitly states both windows.
  assert.match(out.text, /Over the last 30 days/);
  assert.match(out.text, /prior 60 days/);
});

test('composeQuoteAcceptanceAlert renders signed Δ (pp) so direction reads instantly', () => {
  // -32pp on a degraded cohort; the leading sign is what makes
  // the direction unambiguous in plain text.
  const out = importsEmails.composeQuoteAcceptanceAlert({
    quoteAcceptance: buildAcceptanceCohort(),
  });
  assert.ok(out);
  // The delta string lands in the opening — pin the leading '-'.
  assert.match(out.text, /-32pp swing/);
  // Eyebrow in HTML.
  assert.match(out.html, /-32pp vs 60d baseline/);
});

test('composeQuoteAcceptanceAlert surfaces both numerator + denominator + threshold', () => {
  // The supporting copy gives ops the scale + the trigger
  // explanation in one read.
  const out = importsEmails.composeQuoteAcceptanceAlert({
    quoteAcceptance: buildAcceptanceCohort(),
  });
  assert.ok(out);
  // "8 of 20" / "36 of 50" per-window scale.
  assert.match(out.text, /Approved: 8 of 20 decisions/);
  assert.match(out.text, /Approved: 36 of 50 decisions/);
  // Threshold explanation.
  assert.match(out.text, /fell below 75% of the prior baseline/);
  assert.match(out.text, />= 5 decisions/);
});

test('composeQuoteAcceptanceAlert HTML does NOT double-encode entities (sprint 39 lesson)', () => {
  // htmlDl escapes label + value INTERNALLY. The composer MUST
  // pass RAW strings; sprint 39 caught this bug. Drift-guard
  // pins the no-double-encoded form.
  const out = importsEmails.composeQuoteAcceptanceAlert({
    quoteAcceptance: buildAcceptanceCohort(),
  });
  assert.ok(out);
  assert.ok(!out.html.includes('&amp;times;'), 'double-encoded entity in HTML');
  assert.ok(!out.html.includes('&amp;#'), 'double-encoded numeric entity in HTML');
});

// ── sendQuoteAcceptanceAlert ──────────────────────────────────────

test('sendQuoteAcceptanceAlert short-circuits with reason="not-degraded" on a healthy cohort', async () => {
  // Lets the cron caller fire unconditionally. The short-circuit
  // happens BEFORE the recipient lookup so a healthy org never
  // hits the KV/PG layer.
  const out = await importsEmails.sendQuoteAcceptanceAlert({
    orgIdNumeric: 1,
    quoteAcceptance: buildAcceptanceCohort({ isDegraded: false }),
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'not-degraded');
});

test('sendQuoteAcceptanceAlert requires orgIdNumeric + quoteAcceptance (defensive guards)', async () => {
  const noOrg = await importsEmails.sendQuoteAcceptanceAlert({
    quoteAcceptance: buildAcceptanceCohort(),
  });
  assert.equal(noOrg.ok, false);
  assert.match(noOrg.reason, /orgIdNumeric required/);
  const noCohort = await importsEmails.sendQuoteAcceptanceAlert({ orgIdNumeric: 1 });
  assert.equal(noCohort.ok, false);
  assert.match(noCohort.reason, /quoteAcceptance required/);
});

test('sendQuoteAcceptanceAlert uses the importQuoteAcceptanceAlertEmails pref gate', () => {
  // Cross-module drift-guard: a refactor that switched to a
  // different pref key would silently bypass the user-facing
  // toggle. Pin the literal filter argument.
  const block = EMAILS_SRC.match(/async function sendQuoteAcceptanceAlert\([\s\S]*?\n\}/);
  assert.ok(block, 'sendQuoteAcceptanceAlert body not located');
  assert.match(
    block[0],
    /filterMutedRecipients\(resolution\.recipients, 'importQuoteAcceptanceAlertEmails'\)/,
  );
});

test('sendQuoteAcceptanceAlert preserves the fail-soft posture (no-inbox + all-muted branches)', () => {
  const block = EMAILS_SRC.match(/async function sendQuoteAcceptanceAlert\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /return \{ ok: false, reason: 'no-inbox' \}/);
  assert.match(body, /return \{ ok: false, reason: 'all-muted' \}/);
  assert.match(body, /partial failure/);
  assert.match(body, /return \{ ok: sent > 0, sent, failed \}/);
});

// ── Cron handler integration ──────────────────────────────────────

test('Cron handler exposes runImportRequestQuoteAcceptanceAlert + registers it as a job', () => {
  assert.equal(typeof cron.runImportRequestQuoteAcceptanceAlert, 'function');
  assert.match(
    CRON_SRC,
    /'import-request-quote-acceptance-alert': runImportRequestQuoteAcceptanceAlert/,
  );
});

test('runImportRequestQuoteAcceptanceAlert reuses aggregateOpsInsights (cohort #8 source-of-truth)', () => {
  // Drift-guard: the alert's numbers must be the SAME as the
  // /imports/insights live cockpit. Reusing aggregateOpsInsights
  // guarantees that.
  const block = CRON_SRC.match(/async function runImportRequestQuoteAcceptanceAlert\([\s\S]*?\n\}/);
  assert.ok(block, 'runImportRequestQuoteAcceptanceAlert body not located');
  const body = block[0];
  assert.match(body, /importRequests\.aggregateOpsInsights\(\{/);
  assert.match(body, /const quoteAcceptance = agg\.insights && agg\.insights\.quoteAcceptance/);
});

test('runImportRequestQuoteAcceptanceAlert skips healthy orgs (!isDegraded) silently', () => {
  // Without it, every org gets a weekly "rate is fine" email.
  const block = CRON_SRC.match(/async function runImportRequestQuoteAcceptanceAlert\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /if \(!quoteAcceptance \|\| !quoteAcceptance\.isDegraded\)/);
  assert.match(body, /healthyByOrg \+= 1;[\s\S]*?continue;/);
});

test('runImportRequestQuoteAcceptanceAlert per-org error isolation matches sprint-41 decline-spike pattern', () => {
  const block = CRON_SRC.match(/async function runImportRequestQuoteAcceptanceAlert\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /for \(const org of allOrgs\) \{[\s\S]*?try \{/);
  assert.match(body, /errors\.push\(\{[\s\S]*?orgId: String\(org\.id \|\| '\?'\)/);
});

// ── GitHub Actions schedule ───────────────────────────────────────

test('GHA cron.yml registers the Wed 09:00 UTC schedule for the quote-acceptance alert', () => {
  // Wed mid-week lands between Monday's batch and Friday's wrap,
  // giving ops time to act on a slow-moving signal.
  assert.match(CRON_YAML, /- cron: '0 9 \* \* 3'/);
});

test('GHA cron.yml routes the Wed 09:00 schedule + workflow_dispatch to the right job', () => {
  assert.match(
    CRON_YAML,
    /elif \[ "\$\{\{ github\.event\.schedule \}\}" = "0 9 \* \* 3" \]; then\s+echo "job=import-request-quote-acceptance-alert"/,
  );
  assert.match(CRON_YAML, /- import-request-quote-acceptance-alert/);
});
