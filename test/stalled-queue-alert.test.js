'use strict';

// Sprint 39 — daily stalled-queue alert email.
//
// Pairs with the sprint-38 proactive cohort (StalledQueueCard on
// /imports/insights). The weekly insights digest (sprint 26) is too
// infrequent for action-NOW signals; sprint 39 fires a separate
// daily fan-out so ops gets the watch list with the start-of-day
// coffee.
//
// Tests cover four layers:
//   1. PREF_KEYS: importStalledQueueAlertEmails added; TS Prefs
//      mirror carries the new key
//   2. composeStalledQueueAlert: subject + body name count +
//      threshold + per-row daysStalled; short-circuits to null
//      when count <= 0; truncation footnote when count > items.length
//   3. sendStalledQueueAlert: short-circuits with reason='no-stalls'
//      when cohort is empty (so the cron can fire unconditionally);
//      pref-gated per-recipient via importStalledQueueAlertEmails;
//      fail-soft posture matches sendLowRatingAlert + sendOpsInsightsDigest
//   4. Cron handler integration: runImportRequestStalledQueueAlert
//      reuses aggregateOpsInsights (cohort #6 source of truth — same
//      numbers as the live cockpit); skips healthy orgs (count===0);
//      GHA daily schedule + workflow_dispatch entry registered
//
// The "healthy orgs skip silently" branch is load-bearing — without
// it, every org would get a daily "0 stalled" email. Drift-guard
// pins both the cron-side healthy-skip + the sender-side no-stalls
// reason so a regression at either layer would surface.

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

// Fixture mirroring the sprint-38 stalledQueue cohort shape so the
// composer tests don't need a live aggregation.
function buildStalledQueue(over = {}) {
  return {
    thresholdDays: 7,
    count: 3,
    items: [
      { externalId: 'ir_aaaa1111aaaa1111', label: 'My order 1', daysStalled: 12.4 },
      { externalId: 'ir_bbbb2222bbbb2222', label: 'My order 2', daysStalled: 9.1 },
      { externalId: 'ir_cccc3333cccc3333', label: '', daysStalled: 7.7 },
    ],
    ...over,
  };
}

// ── PREF_KEYS surface ──────────────────────────────────────────────

test('PREF_KEYS includes importStalledQueueAlertEmails', () => {
  assert.ok(
    notificationPrefs.PREF_KEYS.includes('importStalledQueueAlertEmails'),
    'new pref key not added to PREF_KEYS',
  );
});

test('TS Prefs mirror carries importStalledQueueAlertEmails', () => {
  // Cross-layer: a future widening of the JS pref set without
  // updating the TS mirror would silently break the toggle's
  // type-checking. Pin the optional-boolean shape.
  assert.match(API_TS, /importStalledQueueAlertEmails\?: boolean;/);
});

test('Preferences page surfaces the stalled-queue alert toggle in the Ops inbox group', () => {
  // The toggle MUST land in the Ops inbox group (where the digest +
  // low-rating-alert toggles already live), NOT in the customer-side
  // groups — only ops admins receive these alerts.
  assert.match(
    PREFS_TSX,
    /\{ key: 'importStalledQueueAlertEmails', label: 'Stalled-queue daily alert'/,
  );
});

// ── composeStalledQueueAlert ───────────────────────────────────────

test('composeStalledQueueAlert returns null when cohort is empty (count === 0)', () => {
  // Empty cohort → no email; the sender short-circuits BEFORE this
  // composer in production, but the composer must be defensive
  // because the cron caller could regress.
  const out = importsEmails.composeStalledQueueAlert({
    orgName: 'Acme',
    stalledQueue: { thresholdDays: 7, count: 0, items: [] },
  });
  assert.equal(out, null);
});

test('composeStalledQueueAlert returns null on a malformed cohort object', () => {
  // Defensive: if upstream contract drifts (sprint-38 cohort shape
  // change), the composer fails closed rather than emitting a
  // nonsense email.
  assert.equal(importsEmails.composeStalledQueueAlert({ stalledQueue: null }), null);
  assert.equal(
    importsEmails.composeStalledQueueAlert({ stalledQueue: { count: 'not-a-number' } }),
    null,
  );
});

test('composeStalledQueueAlert renders { subject, text, html } for a 3-row cohort', () => {
  const out = importsEmails.composeStalledQueueAlert({
    orgName: 'Acme',
    stalledQueue: buildStalledQueue(),
  });
  assert.ok(out && typeof out === 'object');
  assert.equal(typeof out.subject, 'string');
  assert.equal(typeof out.text, 'string');
  assert.equal(typeof out.html, 'string');
  // Subject names the count + the action.
  assert.match(out.subject, /\[Acme\] 3 requests stalled in queue — needs your attention/);
  // Threshold surfaces in text.
  assert.match(out.text, /more than 7 days/);
  // Each row's daysStalled is rendered with one-decimal precision.
  assert.match(out.text, /12\.4d/);
  assert.match(out.text, /9\.1d/);
  assert.match(out.text, /7\.7d/);
  // Each row's externalId surfaces too.
  assert.match(out.text, /ir_aaaa1111aaaa1111/);
});

test('composeStalledQueueAlert renders singular subject + body for count === 1', () => {
  // Plurals are small details but they're the ones an investor reads
  // first in the inbox preview. Drift-guard pins the singular branch.
  const out = importsEmails.composeStalledQueueAlert({
    stalledQueue: {
      thresholdDays: 7,
      count: 1,
      items: [{ externalId: 'ir_zzzz', label: 'Solo', daysStalled: 8.0 }],
    },
  });
  assert.ok(out);
  assert.match(out.subject, /1 request stalled in queue/);
  assert.match(out.text, /^1 request has been sitting in awaiting_review/);
});

test('composeStalledQueueAlert surfaces a truncation footnote when count > items.length', () => {
  // Mirror of the sprint-38 card honesty footnote — same threshold,
  // same phrasing. Without it, "47 stalled" + 10 rendered rows in
  // the email would lie about the size of the gap.
  const out = importsEmails.composeStalledQueueAlert({
    stalledQueue: {
      thresholdDays: 7,
      count: 47,
      items: Array.from({ length: 10 }, (_, i) => ({
        externalId: `ir_${'a'.repeat(16 - String(i).length)}${i}`,
        label: `Order ${i}`,
        daysStalled: 30 - i,
      })),
    },
  });
  assert.ok(out);
  assert.match(out.text, /Showing the 10 oldest; 37 more in the queue/);
  assert.match(out.html, /Showing the 10 oldest/);
});

test('composeStalledQueueAlert HTML escapes the request label (XSS guard)', () => {
  // Request labels are user-controlled; an unescaped angle bracket
  // would let a customer inject HTML into the ops email body.
  const out = importsEmails.composeStalledQueueAlert({
    stalledQueue: {
      thresholdDays: 7,
      count: 1,
      items: [{ externalId: 'ir_xss', label: '<script>alert(1)</script>', daysStalled: 8.0 }],
    },
  });
  assert.ok(out);
  // The raw "<script>" must NOT appear in the HTML body.
  assert.ok(!out.html.includes('<script>alert(1)</script>'), 'unescaped <script> tag in HTML body');
  // The escaped form must appear instead.
  assert.match(out.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

// ── sendStalledQueueAlert ──────────────────────────────────────────

test('sendStalledQueueAlert short-circuits with reason="no-stalls" on empty cohort', async () => {
  // This is what lets the cron caller fire unconditionally. The
  // short-circuit happens BEFORE the recipient lookup so a healthy
  // org never hits the KV/PG layer.
  const out = await importsEmails.sendStalledQueueAlert({
    orgIdNumeric: 1,
    stalledQueue: { thresholdDays: 7, count: 0, items: [] },
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'no-stalls');
});

test('sendStalledQueueAlert requires orgIdNumeric + stalledQueue (defensive guards)', async () => {
  const noOrg = await importsEmails.sendStalledQueueAlert({ stalledQueue: buildStalledQueue() });
  assert.equal(noOrg.ok, false);
  assert.match(noOrg.reason, /orgIdNumeric required/);
  const noQueue = await importsEmails.sendStalledQueueAlert({ orgIdNumeric: 1 });
  assert.equal(noQueue.ok, false);
  assert.match(noQueue.reason, /stalledQueue required/);
});

test('sendStalledQueueAlert uses the importStalledQueueAlertEmails pref gate', () => {
  // Cross-module drift-guard: a refactor that switched to a
  // different pref key would silently bypass the user-facing
  // toggle. Pin the literal filter argument.
  const block = EMAILS_SRC.match(/async function sendStalledQueueAlert\([\s\S]*?\n\}/);
  assert.ok(block, 'sendStalledQueueAlert body not located');
  assert.match(block[0], /filterMutedRecipients\(resolution\.recipients, 'importStalledQueueAlertEmails'\)/);
});

test('sendStalledQueueAlert preserves the fail-soft posture (no-inbox + all-muted branches)', () => {
  // Same shape as sendLowRatingAlert + sendOpsInsightsDigest:
  // returns { ok:false, reason } on every defensible miss; logs at
  // info (not error) so a healthy "all team is muted" state doesn't
  // page anyone.
  const block = EMAILS_SRC.match(/async function sendStalledQueueAlert\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /return \{ ok: false, reason: 'no-inbox' \}/);
  assert.match(body, /return \{ ok: false, reason: 'all-muted' \}/);
  // Partial failure (some sent, some not) logs at warn AND still
  // returns ok when sent > 0.
  assert.match(body, /partial failure/);
  assert.match(body, /return \{ ok: sent > 0, sent, failed \}/);
});

// ── Cron handler integration ──────────────────────────────────────

test('Cron handler exposes runImportRequestStalledQueueAlert + registers it as a job', () => {
  // The named export is what the deploy-time smoke test (and the
  // workflow_dispatch via the GHA "Run workflow" button) calls; the
  // JOBS map is what the production /api/cron dispatcher matches on.
  assert.equal(typeof cron.runImportRequestStalledQueueAlert, 'function');
  assert.match(CRON_SRC, /'import-request-stalled-queue-alert': runImportRequestStalledQueueAlert/);
});

test('runImportRequestStalledQueueAlert reuses aggregateOpsInsights for cohort source-of-truth', () => {
  // Drift-guard: the alert's numbers must be the SAME as the
  // /imports/insights live cockpit. Reusing aggregateOpsInsights
  // guarantees that — pinning the call shape prevents a future
  // refactor from duplicating the SQL.
  const block = CRON_SRC.match(/async function runImportRequestStalledQueueAlert\([\s\S]*?\n\}/);
  assert.ok(block, 'runImportRequestStalledQueueAlert body not located');
  const body = block[0];
  assert.match(body, /importRequests\.aggregateOpsInsights\(\{/);
  // Pulls the stalledQueue cohort specifically, NOT a re-derived
  // calculation.
  assert.match(body, /const stalledQueue = agg\.insights && agg\.insights\.stalledQueue/);
});

test('runImportRequestStalledQueueAlert skips healthy orgs (count === 0) silently', () => {
  // The load-bearing branch: without it, every org gets a daily
  // "0 stalled" email. Pin the count === 0 short-circuit.
  const block = CRON_SRC.match(/async function runImportRequestStalledQueueAlert\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /if \(!stalledQueue \|\| stalledQueue\.count === 0\)/);
  // Healthy orgs increment a counter (for observability) AND
  // continue — they don't fail the org out.
  assert.match(body, /healthyByOrg \+= 1;[\s\S]*?continue;/);
});

test('runImportRequestStalledQueueAlert per-org error isolation matches sprint-26 digest', () => {
  // One org's failure (no numeric id, aggregate fail, send fail)
  // MUST NOT halt the per-org fan-out. Drift-guard pins the
  // try/catch wrap inside the per-org loop AND the errors[]
  // accumulator.
  const block = CRON_SRC.match(/async function runImportRequestStalledQueueAlert\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /for \(const org of allOrgs\) \{[\s\S]*?try \{/);
  assert.match(body, /errors\.push\(\{[\s\S]*?orgId: String\(org\.id \|\| '\?'\)/);
});

// ── GitHub Actions schedule ───────────────────────────────────────

test('GHA cron.yml registers the daily 08:00 UTC schedule for the stalled-queue alert', () => {
  // 08:00 UTC = 09:00 BST = UK morning. Distinct slot from the
  // other daily jobs (taric-warm 04:15 / audit-anchor 02:00 /
  // quote-expiry 02:30) so the four don't pile up on the same
  // function instance.
  assert.match(CRON_YAML, /- cron: '0 8 \* \* \*'/);
});

test('GHA cron.yml routes the 08:00 UTC schedule + workflow_dispatch to the right job', () => {
  // The schedule-to-job mapping is what makes the cron actually
  // fire the right handler. Pin both the dispatch routing AND the
  // workflow_dispatch option list.
  assert.match(
    CRON_YAML,
    /elif \[ "\$\{\{ github\.event\.schedule \}\}" = "0 8 \* \* \*" \]; then\s+echo "job=import-request-stalled-queue-alert"/,
  );
  assert.match(CRON_YAML, /- import-request-stalled-queue-alert/);
});
