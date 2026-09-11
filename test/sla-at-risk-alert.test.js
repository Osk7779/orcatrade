'use strict';

// Sprint 92 — daily SLA-at-risk alert email (trifecta for the
// sprint-91 cohort #13). The breach-prevention alert: unquoted
// requests past 75% of the org's NEGOTIATED turnaround target,
// split at-risk vs breached. Daily 08:15 UTC — the morning sweep
// reads stall (08:00) → SLA risk (08:15) → spike (08:30) →
// aging (08:45).
//
// Tests cover six layers:
//   1. Composer: null-on-empty; subject carries the breach split;
//      opening + breach line honesty (recoverable vs waiting);
//      sign-only clock rendering ("Xh left" / "Xh OVER" from the
//      server's hoursRemaining — never recomputed); truncation;
//      no pre-escaping of htmlDl rows.
//   2. Sender: 'no-at-risk' short-circuit over the SUMMED counts;
//      pref gate importSlaAtRiskAlertEmails; composer-null guard.
//   3. Cron runner: registered + exported; cadence-gated (daily
//      family); loads org config and threads the NEGOTIATED
//      target into the aggregation; healthy-skip.
//   4. Pref key (opt-out TRUE).
//   5. GHA: '15 8 * * *' schedule → route; dispatch choice; the
//      sprint-78 uniqueness guard covers collisions automatically.
//   6. UI toggle + TS Prefs mirror.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importsEmails = require('../lib/imports-emails');
const notificationPrefs = require('../lib/notification-prefs');
const cronHandlers = require('../lib/handlers/cron');

const ROOT = path.resolve(__dirname, '..');
const EMAILS_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'imports-emails.js'), 'utf8');
const CRON_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'cron.js'), 'utf8');
const GHA_SRC = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'cron.yml'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const PREFS_PAGE = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'preferences', 'page.tsx'),
  'utf8',
);

const COHORT = {
  riskThresholdHours: 36,
  targetHours: 48,
  atRiskCount: 2,
  breachedCount: 1,
  items: [
    { externalId: 'ir_aaa', label: 'Widgets', status: 'awaiting_review', ageHours: 50.0, hoursRemaining: -2.0 },
    { externalId: 'ir_bbb', label: 'Gadgets', status: 'processing', ageHours: 40.0, hoursRemaining: 8.0 },
    { externalId: 'ir_ccc', label: 'Gizmos', status: 'submitted', ageHours: 37.5, hoursRemaining: 10.5 },
  ],
};

// ── Layer 1: composer ────────────────────────────────────────────

test('composeSlaAtRiskAlert returns null when cohort missing / total 0', () => {
  assert.equal(importsEmails.composeSlaAtRiskAlert({ slaAtRisk: null }), null);
  assert.equal(
    importsEmails.composeSlaAtRiskAlert({
      slaAtRisk: { ...COHORT, atRiskCount: 0, breachedCount: 0, items: [] },
    }),
    null,
  );
});

test('subject carries the breach split; body names the negotiated line and the honest breach truth', () => {
  const composed = importsEmails.composeSlaAtRiskAlert({ orgName: 'Acme Ltd', slaAtRisk: COHORT });
  assert.ok(composed);
  assert.equal(composed.subject, '[Acme Ltd] 3 requests at SLA risk — 1 already breached');
  assert.match(composed.text, /3 requests are unquoted past 36h of your 48h turnaround target\./);
  assert.match(composed.text, /1 of them is already past the full target — those customers are still waiting\./);
  // No breaches → the recoverable framing instead.
  const clean = importsEmails.composeSlaAtRiskAlert({
    slaAtRisk: { ...COHORT, breachedCount: 0, atRiskCount: 2, items: COHORT.items.slice(1) },
  });
  assert.match(clean.text, /None have breached yet — every one of these is recoverable if quoted today\./);
  assert.ok(!/already breached/.test(clean.subject));
});

test('clock rendering is SIGN-ONLY from the server hoursRemaining ("2.0h OVER" / "8.0h left")', () => {
  const composed = importsEmails.composeSlaAtRiskAlert({ slaAtRisk: COHORT });
  assert.match(composed.text, /2\.0h OVER\s+·\s+Widgets\s+\(ir_aaa\)/);
  assert.match(composed.text, /8\.0h left\s+·\s+Gadgets\s+\(ir_bbb\)/);
  // The composer never recomputes time.
  const block = EMAILS_SRC.match(/function composeSlaAtRiskAlert\([\s\S]*?\n\}/)[0];
  assert.ok(!/Date\.now|new Date\(/.test(block), 'the composer must not recompute time math');
});

test('truncation footnote only when total > items.length; htmlDl rows not pre-escaped (sprint-55 lesson)', () => {
  const truncatedComposed = importsEmails.composeSlaAtRiskAlert({
    slaAtRisk: { ...COHORT, atRiskCount: 10, breachedCount: 2 },
  });
  assert.match(truncatedComposed.text, /Showing the 3 oldest; 9 more on the cockpit\./);
  const exact = importsEmails.composeSlaAtRiskAlert({ slaAtRisk: COHORT });
  assert.ok(!/more on the cockpit/.test(exact.text));
  const block = EMAILS_SRC.match(/function composeSlaAtRiskAlert\([\s\S]*?\n\}/)[0];
  const dlBlock = block.match(/const dlRows = items\.map\([\s\S]*?\)\);/);
  assert.ok(dlBlock, 'dlRows map not found');
  assert.ok(!/esc\(/.test(dlBlock[0]), 'htmlDl escapes internally');
});

// ── Layer 2: sender ──────────────────────────────────────────────

test('sendSlaAtRiskAlert short-circuits on bad org / missing / empty cohort (summed counts)', async () => {
  const noOrg = await importsEmails.sendSlaAtRiskAlert({ orgIdNumeric: NaN, slaAtRisk: COHORT });
  assert.equal(noOrg.ok, false);
  const missing = await importsEmails.sendSlaAtRiskAlert({ orgIdNumeric: 1, slaAtRisk: null });
  assert.equal(missing.reason, 'slaAtRisk required');
  const empty = await importsEmails.sendSlaAtRiskAlert({
    orgIdNumeric: 1,
    slaAtRisk: { ...COHORT, atRiskCount: 0, breachedCount: 0 },
  });
  assert.equal(empty.reason, 'no-at-risk');
});

test('sender pref-gates via importSlaAtRiskAlertEmails + guards composer-null', () => {
  const block = EMAILS_SRC.match(/async function sendSlaAtRiskAlert\([\s\S]*?\n\}/)[0];
  assert.match(block, /filterMutedRecipients\(resolution\.recipients, 'importSlaAtRiskAlertEmails'\)/);
  assert.match(block, /reason: 'composer-null'/);
});

// ── Layer 3: cron runner ─────────────────────────────────────────

test('runner registered + exported; threads the NEGOTIATED target into the aggregation', () => {
  assert.match(CRON_SRC, /'import-request-sla-at-risk-alert': runImportRequestSlaAtRiskAlert,/);
  assert.equal(typeof cronHandlers.runImportRequestSlaAtRiskAlert, 'function');
  const start = CRON_SRC.indexOf('async function runImportRequestSlaAtRiskAlert(');
  const next = CRON_SRC.indexOf('async function ', start + 10);
  const body = CRON_SRC.slice(start, next);
  // The whole point of cohort #13: the alert line follows the
  // contract, so the runner loads config and threads knob 6.
  assert.match(body, /const orgConfig = await operatorConfig\.getOperatorConfig\(orgIdNumeric\);/);
  assert.match(body, /slaQuoteTurnaroundTargetHours: orgConfig\.slaQuoteTurnaroundTargetHours,/);
  // Daily family: cadence-gated (the operator-config-cadence
  // four-corners sweep also covers this).
  assert.match(body, /if \(alertCadence === 'weekly'\)/);
  // Healthy-skip over the SUMMED counts.
  assert.match(body, /const total = slaAtRisk\s*\n\s*\? \(Number\(slaAtRisk\.atRiskCount\) \|\| 0\) \+ \(Number\(slaAtRisk\.breachedCount\) \|\| 0\)/);
  assert.match(body, /sendResult\.reason !== 'no-inbox' && sendResult\.reason !== 'no-at-risk'/);
});

// ── Layer 4: pref key ────────────────────────────────────────────

test('importSlaAtRiskAlertEmails is in PREF_KEYS (opt-out — defaults TRUE)', () => {
  assert.ok(notificationPrefs.PREF_KEYS.includes('importSlaAtRiskAlertEmails'));
});

// ── Layer 5: GHA ─────────────────────────────────────────────────

test('GHA registers the daily 08:15 UTC schedule and routes it to the new job', () => {
  assert.match(GHA_SRC, /- cron: '15 8 \* \* \*'/);
  assert.match(
    GHA_SRC,
    /elif \[ "\$\{\{ github\.event\.schedule \}\}" = "15 8 \* \* \*" \]; then\s+echo "job=import-request-sla-at-risk-alert"/,
  );
  assert.match(GHA_SRC, /- import-request-sla-at-risk-alert/);
});

// ── Layer 6: UI + TS ─────────────────────────────────────────────

test('preferences page renders the toggle; TS Prefs mirrors the key', () => {
  assert.match(PREFS_PAGE, /key: 'importSlaAtRiskAlertEmails'/);
  assert.match(PREFS_PAGE, /label: 'SLA-at-risk daily alert'/);
  assert.match(API_TS, /importSlaAtRiskAlertEmails\?: boolean;/);
});
