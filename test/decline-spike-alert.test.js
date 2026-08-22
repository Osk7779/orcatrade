'use strict';

// Sprint 41 — daily decline-spike alert email.
//
// Pairs with the sprint-40 proactive cohort (DeclineSpikeCard on
// /imports/insights). Mirrors sprint 39's stall-alert trifecta:
// composer + sender + pref + cron, but for trends (decline
// reasons accelerating vs the 30-day baseline) instead of state
// (stalled rows).
//
// Tests cover four layers:
//   1. PREF_KEYS: importDeclineSpikeAlertEmails added; TS Prefs
//      mirror carries the new key
//   2. composeDeclineSpikeAlert: subject + body name count + window
//      params + per-spike Nx multiplier (one-decimal precision)
//      OR "NEW" badge for first-time reasons; returns null on
//      empty cohort; XSS-safe (no double-encoded entities)
//   3. sendDeclineSpikeAlert: short-circuits with reason='no-spikes'
//      on empty cohort; pref-gated per-recipient via
//      importDeclineSpikeAlertEmails; fail-soft posture matches
//      sendStalledQueueAlert
//   4. Cron handler integration: runImportRequestDeclineSpikeAlert
//      reuses aggregateOpsInsights (cohort #7 source of truth);
//      skips healthy orgs (spikes.length===0); GHA daily 08:30
//      schedule + workflow_dispatch entry registered (30 min after
//      stall alert so the two stagger)

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

// Fixture mirroring the sprint-40 declineSpike cohort shape so the
// composer tests don't need a live aggregation.
function buildSpikeCohort(over = {}) {
  return {
    currentDays: 7,
    baselineDays: 30,
    minCount: 3,
    rateMultiplier: 2,
    spikes: [
      // First-time reason — surfaces with ratio=null + NEW badge.
      { reason: 'compliance_blocker', currentCount: 4, baselineCount: 0,
        currentRate: 0.57, baselineRate: 0, ratio: null },
      // Accelerating reason — surfaces with Nx multiplier.
      { reason: 'price_target_unrealistic', currentCount: 6, baselineCount: 5,
        currentRate: 0.86, baselineRate: 0.17, ratio: 5.2 },
    ],
    ...over,
  };
}

// ── PREF_KEYS surface ──────────────────────────────────────────────

test('PREF_KEYS includes importDeclineSpikeAlertEmails (14th pref key)', () => {
  assert.ok(
    notificationPrefs.PREF_KEYS.includes('importDeclineSpikeAlertEmails'),
    'new pref key not added to PREF_KEYS',
  );
});

test('TS Prefs mirror carries importDeclineSpikeAlertEmails', () => {
  assert.match(API_TS, /importDeclineSpikeAlertEmails\?: boolean;/);
});

test('Preferences page surfaces the decline-spike toggle in the Ops inbox group', () => {
  // Lands in the Ops inbox group next to the sprint-39 stall toggle
  // so both proactive alerts cluster — ops admin reads them as a
  // pair, can opt out of one without affecting the other.
  assert.match(
    PREFS_TSX,
    /\{ key: 'importDeclineSpikeAlertEmails', label: 'Decline-spike daily alert'/,
  );
});

// ── composeDeclineSpikeAlert ───────────────────────────────────────

test('composeDeclineSpikeAlert returns null on empty cohort (spikes.length === 0)', () => {
  // Empty cohort → no email; the sender short-circuits BEFORE
  // this composer in production, but the composer must be
  // defensive because the cron caller could regress.
  const out = importsEmails.composeDeclineSpikeAlert({
    orgName: 'Acme',
    declineSpike: { currentDays: 7, baselineDays: 30, minCount: 3, rateMultiplier: 2, spikes: [] },
  });
  assert.equal(out, null);
});

test('composeDeclineSpikeAlert returns null on a malformed cohort object', () => {
  // Defensive: if upstream contract drifts (sprint-40 cohort shape
  // change), the composer fails closed rather than emitting a
  // nonsense email.
  assert.equal(importsEmails.composeDeclineSpikeAlert({ declineSpike: null }), null);
  assert.equal(
    importsEmails.composeDeclineSpikeAlert({ declineSpike: { spikes: 'not-an-array' } }),
    null,
  );
});

test('composeDeclineSpikeAlert renders { subject, text, html } for a 2-spike cohort', () => {
  const out = importsEmails.composeDeclineSpikeAlert({
    orgName: 'Acme',
    declineSpike: buildSpikeCohort(),
  });
  assert.ok(out && typeof out === 'object');
  assert.equal(typeof out.subject, 'string');
  assert.equal(typeof out.text, 'string');
  assert.equal(typeof out.html, 'string');
  // Subject names the count + the action.
  assert.match(out.subject, /\[Acme\] 2 decline reasons spiking — investigate the trend/);
  // The window parameters surface (NOT hard-coded — pulled from the
  // cohort object so a future per-org config flows through).
  assert.match(out.text, /prior 30 days/);
  assert.match(out.text, /Last 7 days vs 30-day baseline/);
});

test('composeDeclineSpikeAlert renders singular subject for spikes.length === 1', () => {
  // Plurals matter for the inbox preview line. Drift-guard pins
  // the singular branch.
  const out = importsEmails.composeDeclineSpikeAlert({
    declineSpike: {
      ...buildSpikeCohort(),
      spikes: [buildSpikeCohort().spikes[0]],
    },
  });
  assert.ok(out);
  assert.match(out.subject, /1 decline reason spiking/);
  assert.match(out.text, /^1 decline reason is accelerating/);
});

test('composeDeclineSpikeAlert renders Nx (one-decimal) for non-null ratio + NEW for first-time', () => {
  // The two badge variants from the sprint-40 cohort each render
  // in their email-friendly form. Pin both.
  const out = importsEmails.composeDeclineSpikeAlert({
    declineSpike: buildSpikeCohort(),
  });
  assert.ok(out);
  // The accelerating spike — "5.2× vs 30d baseline".
  assert.match(out.text, /5\.2× vs 30d baseline/);
  // The first-time spike — "NEW (no prior occurrence)".
  assert.match(out.text, /NEW \(no prior occurrence\)/);
});

test('composeDeclineSpikeAlert HTML does NOT double-encode entities (sprint 39 lesson applied)', () => {
  // htmlDl escapes label + value INTERNALLY. The composer must
  // pass RAW strings, not pre-escaped. Sprint 39 caught this
  // exact bug — pin it here so the lesson stays applied.
  const out = importsEmails.composeDeclineSpikeAlert({
    declineSpike: {
      ...buildSpikeCohort(),
      spikes: [
        { reason: 'price_target_unrealistic', currentCount: 5, baselineCount: 1,
          currentRate: 0.71, baselineRate: 0.03, ratio: 21.2 },
      ],
    },
  });
  assert.ok(out);
  // The "×" character lands once-encoded (as itself or &times;),
  // NEVER as "&amp;times;" or "&amp;#xd7;".
  assert.ok(!out.html.includes('&amp;times;'), 'double-encoded entity in HTML');
  assert.ok(!out.html.includes('&amp;#'), 'double-encoded numeric entity in HTML');
});

// ── sendDeclineSpikeAlert ──────────────────────────────────────────

test('sendDeclineSpikeAlert short-circuits with reason="no-spikes" on empty cohort', async () => {
  // Lets the cron caller fire unconditionally. The short-circuit
  // happens BEFORE the recipient lookup so a healthy org never
  // hits the KV/PG layer.
  const out = await importsEmails.sendDeclineSpikeAlert({
    orgIdNumeric: 1,
    declineSpike: { currentDays: 7, baselineDays: 30, minCount: 3, rateMultiplier: 2, spikes: [] },
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'no-spikes');
});

test('sendDeclineSpikeAlert requires orgIdNumeric + declineSpike (defensive guards)', async () => {
  const noOrg = await importsEmails.sendDeclineSpikeAlert({ declineSpike: buildSpikeCohort() });
  assert.equal(noOrg.ok, false);
  assert.match(noOrg.reason, /orgIdNumeric required/);
  const noQueue = await importsEmails.sendDeclineSpikeAlert({ orgIdNumeric: 1 });
  assert.equal(noQueue.ok, false);
  assert.match(noQueue.reason, /declineSpike required/);
});

test('sendDeclineSpikeAlert uses the importDeclineSpikeAlertEmails pref gate', () => {
  // Cross-module drift-guard: a refactor that switched to a
  // different pref key would silently bypass the user-facing
  // toggle. Pin the literal filter argument.
  const block = EMAILS_SRC.match(/async function sendDeclineSpikeAlert\([\s\S]*?\n\}/);
  assert.ok(block, 'sendDeclineSpikeAlert body not located');
  assert.match(
    block[0],
    /filterMutedRecipients\(resolution\.recipients, 'importDeclineSpikeAlertEmails'\)/,
  );
});

test('sendDeclineSpikeAlert preserves the fail-soft posture (no-inbox + all-muted branches)', () => {
  // Same shape as sendStalledQueueAlert + sendLowRatingAlert:
  // returns { ok:false, reason } on every defensible miss.
  const block = EMAILS_SRC.match(/async function sendDeclineSpikeAlert\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /return \{ ok: false, reason: 'no-inbox' \}/);
  assert.match(body, /return \{ ok: false, reason: 'all-muted' \}/);
  assert.match(body, /partial failure/);
  assert.match(body, /return \{ ok: sent > 0, sent, failed \}/);
});

// ── Cron handler integration ──────────────────────────────────────

test('Cron handler exposes runImportRequestDeclineSpikeAlert + registers it as a job', () => {
  assert.equal(typeof cron.runImportRequestDeclineSpikeAlert, 'function');
  assert.match(
    CRON_SRC,
    /'import-request-decline-spike-alert': runImportRequestDeclineSpikeAlert/,
  );
});

test('runImportRequestDeclineSpikeAlert reuses aggregateOpsInsights (cohort source-of-truth)', () => {
  // Drift-guard: the alert's numbers must be the SAME as the
  // /imports/insights live cockpit. Reusing aggregateOpsInsights
  // guarantees that.
  const block = CRON_SRC.match(/async function runImportRequestDeclineSpikeAlert\([\s\S]*?\n\}/);
  assert.ok(block, 'runImportRequestDeclineSpikeAlert body not located');
  const body = block[0];
  assert.match(body, /importRequests\.aggregateOpsInsights\(\{/);
  // Pulls the declineSpike cohort specifically, NOT a re-derived
  // calculation.
  assert.match(body, /const declineSpike = agg\.insights && agg\.insights\.declineSpike/);
});

test('runImportRequestDeclineSpikeAlert skips healthy orgs (spikes.length === 0) silently', () => {
  // Without it, every org gets a daily "0 spikes" email. Pin both
  // the !declineSpike defensive AND the spikes.length===0 gate.
  const block = CRON_SRC.match(/async function runImportRequestDeclineSpikeAlert\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(
    body,
    /if \(!declineSpike \|\| !Array\.isArray\(declineSpike\.spikes\) \|\| declineSpike\.spikes\.length === 0\)/,
  );
  // Healthy orgs increment a counter (for observability) AND
  // continue — they don't fail the org out.
  assert.match(body, /healthyByOrg \+= 1;[\s\S]*?continue;/);
});

test('runImportRequestDeclineSpikeAlert per-org error isolation matches sprint-39 stall pattern', () => {
  // One org's failure (no numeric id, aggregate fail, send fail)
  // MUST NOT halt the per-org fan-out.
  const block = CRON_SRC.match(/async function runImportRequestDeclineSpikeAlert\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /for \(const org of allOrgs\) \{[\s\S]*?try \{/);
  assert.match(body, /errors\.push\(\{[\s\S]*?orgId: String\(org\.id \|\| '\?'\)/);
});

// ── GitHub Actions schedule ───────────────────────────────────────

test('GHA cron.yml registers the daily 08:30 UTC schedule (30 min after the stall alert)', () => {
  // 08:30 UTC = 09:30 BST. Staggered 30 min after the sprint-39
  // 08:00 stall alert so the two morning proactive jobs don't pile
  // onto one function instance.
  assert.match(CRON_YAML, /- cron: '30 8 \* \* \*'/);
});

test('GHA cron.yml routes the 08:30 UTC schedule + workflow_dispatch to the right job', () => {
  assert.match(
    CRON_YAML,
    /elif \[ "\$\{\{ github\.event\.schedule \}\}" = "30 8 \* \* \*" \]; then\s+echo "job=import-request-decline-spike-alert"/,
  );
  assert.match(CRON_YAML, /- import-request-decline-spike-alert/);
});
