'use strict';

// Sprint 70 — daily aging-quotes alert email (trifecta for sprint
// 69's cohort #11). Mirrors sprint 39's stalled-queue alert
// architecture: composer with strict-boolean short-circuit +
// sender with pref gate + cron runner + GHA schedule + preferences
// toggle + TS Prefs mirror.
//
// Tests cover six layers:
//   1. composeQuoteFollowUpAlert semantics: null on count===0;
//      singular vs plural copy; threshold + count in subject/
//      body; truncation footnote; oldest-first list; per-item
//      daysPending formatting.
//   2. sendQuoteFollowUpAlert wiring: 'no-aging' short-circuit;
//      resolveOpsRecipients gate; filterMutedRecipients uses the
//      NEW pref key (importQuoteFollowUpAlertEmails).
//   3. Cron runner: registered under
//      'import-request-quote-follow-up-alert'; per-org fan-out;
//      passes quoteFollowUp cohort through; 'no-aging' skipped
//      silently (not surfaced as an error).
//   4. Pref key: added to notification-prefs.PREF_KEYS; defaults
//      to true on new prefs (opt-out semantics).
//   5. GHA workflow: schedule entry '45 8 * * *' → routes to
//      the new job name; workflow_dispatch choice list includes
//      the job.
//   6. UI + TS mirror: Prefs interface extends; preferences
//      page renders the toggle with matching key + copy.

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

// ── Layer 1: composer semantics ──────────────────────────────────

test('composeQuoteFollowUpAlert returns null when quoteFollowUp is missing / count=0 (matches sprint-39 short-circuit)', () => {
  assert.equal(importsEmails.composeQuoteFollowUpAlert({ quoteFollowUp: null }), null);
  assert.equal(
    importsEmails.composeQuoteFollowUpAlert({ quoteFollowUp: { count: 0, items: [], thresholdDays: 5 } }),
    null,
  );
  assert.equal(
    importsEmails.composeQuoteFollowUpAlert({ quoteFollowUp: { count: -1, items: [], thresholdDays: 5 } }),
    null,
  );
});

test('composeQuoteFollowUpAlert subject uses SINGULAR "1 quote" when count===1', () => {
  const composed = importsEmails.composeQuoteFollowUpAlert({
    orgName: 'Acme Ltd',
    quoteFollowUp: {
      thresholdDays: 5,
      count: 1,
      items: [{ externalId: 'ir_abc', label: 'Widgets', updatedAt: '2026-06-01T00:00:00Z', daysPending: 8.3 }],
    },
  });
  assert.ok(composed);
  assert.match(composed.subject, /\[Acme Ltd\]/);
  assert.match(composed.subject, /1 quote awaiting customer decision/);
});

test('composeQuoteFollowUpAlert subject uses PLURAL when count > 1', () => {
  const composed = importsEmails.composeQuoteFollowUpAlert({
    quoteFollowUp: {
      thresholdDays: 5,
      count: 12,
      items: [{ externalId: 'ir_x', label: 'A', updatedAt: '2026-06-01T00:00:00Z', daysPending: 15 }],
    },
  });
  assert.ok(composed);
  assert.match(composed.subject, /12 quotes awaiting customer decision/);
});

test('composeQuoteFollowUpAlert text body opens with count + threshold + status name (transparency)', () => {
  const composed = importsEmails.composeQuoteFollowUpAlert({
    quoteFollowUp: {
      thresholdDays: 7,
      count: 3,
      items: [
        { externalId: 'ir_a', label: 'A', updatedAt: '2026-05-25T00:00:00Z', daysPending: 20.4 },
      ],
    },
  });
  assert.ok(composed);
  assert.match(composed.text, /3 quotes have been sitting in 'quoted' for more than 7 days/);
});

test('composeQuoteFollowUpAlert text body includes each item formatted "N.Nd · label (id)"', () => {
  const composed = importsEmails.composeQuoteFollowUpAlert({
    quoteFollowUp: {
      thresholdDays: 5,
      count: 2,
      items: [
        { externalId: 'ir_a', label: 'Widget', updatedAt: '2026-06-01T00:00:00Z', daysPending: 8.35 },
        { externalId: 'ir_b', label: '', updatedAt: '2026-06-02T00:00:00Z', daysPending: 6.1 },
      ],
    },
  });
  assert.ok(composed);
  // toFixed(1) rounds 8.35 → 8.4 (banker's rounding on some
  // platforms; but JS toFixed(1) uses IEEE-754 nearest-half; 8.35
  // may round to 8.3 or 8.4 depending on binary rep). Just check
  // both forms are acceptable.
  assert.match(composed.text, /8\.[34]d/);
  assert.match(composed.text, /Widget/);
  assert.match(composed.text, /ir_a/);
  // Empty label falls back to externalId only (no leading empty
  // string · then id).
  assert.match(composed.text, /6\.1d\s+·\s+ir_b/);
});

test('composeQuoteFollowUpAlert truncation footnote fires when count > items.length', () => {
  const composed = importsEmails.composeQuoteFollowUpAlert({
    quoteFollowUp: {
      thresholdDays: 5,
      count: 47,
      items: [
        { externalId: 'ir_a', label: 'A', updatedAt: '2026-06-01T00:00:00Z', daysPending: 8 },
      ],
    },
  });
  assert.ok(composed);
  assert.match(composed.text, /Showing the 1 oldest; 46 more aging/);
  assert.match(composed.html, /Showing the 1 oldest\./);
  assert.match(composed.html, /46 more aging/);
});

test('composeQuoteFollowUpAlert HTML does NOT pre-escape label/value (htmlDl owns escaping)', () => {
  // Sprint 55's double-encoding lesson: htmlDl escapes internally,
  // so passing a raw label like "A & B" must produce "A &amp; B"
  // (single entity) NOT "A &amp;amp; B" (double).
  const composed = importsEmails.composeQuoteFollowUpAlert({
    quoteFollowUp: {
      thresholdDays: 5,
      count: 1,
      items: [{ externalId: 'ir_x', label: 'A & B', updatedAt: '2026-06-01T00:00:00Z', daysPending: 6 }],
    },
  });
  assert.ok(composed);
  assert.match(composed.html, /A &amp; B/);
  assert.doesNotMatch(composed.html, /A &amp;amp; B/);
});

// ── Layer 2: sender wiring ───────────────────────────────────────

test('sendQuoteFollowUpAlert short-circuits on count===0 with reason=no-aging', async () => {
  const r = await importsEmails.sendQuoteFollowUpAlert({
    orgIdNumeric: 42,
    quoteFollowUp: { thresholdDays: 5, count: 0, items: [] },
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-aging');
});

test('sendQuoteFollowUpAlert rejects missing quoteFollowUp with reason=quoteFollowUp required', async () => {
  const r = await importsEmails.sendQuoteFollowUpAlert({
    orgIdNumeric: 42,
    quoteFollowUp: null,
  });
  assert.equal(r.ok, false);
  assert.match(String(r.reason), /quoteFollowUp required/);
});

test('sendQuoteFollowUpAlert rejects non-numeric orgIdNumeric', async () => {
  const r = await importsEmails.sendQuoteFollowUpAlert({
    orgIdNumeric: NaN,
    quoteFollowUp: { thresholdDays: 5, count: 1, items: [] },
  });
  assert.equal(r.ok, false);
  assert.match(String(r.reason), /orgIdNumeric required/);
});

test('sendQuoteFollowUpAlert source uses filterMutedRecipients with the NEW pref key', () => {
  // Pin the exact pref-key name so a rename regression can't
  // silently break per-recipient muting.
  assert.match(
    EMAILS_SRC,
    /filterMutedRecipients\(resolution\.recipients, 'importQuoteFollowUpAlertEmails'\)/,
  );
});

// ── Layer 3: cron runner ─────────────────────────────────────────

test('runImportRequestQuoteFollowUpAlert is exported', () => {
  assert.equal(typeof cronHandlers.runImportRequestQuoteFollowUpAlert, 'function');
});

test('cron dispatch registry includes import-request-quote-follow-up-alert', () => {
  assert.match(
    CRON_SRC,
    /'import-request-quote-follow-up-alert': runImportRequestQuoteFollowUpAlert/,
  );
});

test('runImportRequestQuoteFollowUpAlert source: reuses aggregateOpsInsights (no separate SQL path)', () => {
  const block = CRON_SRC.match(/async function runImportRequestQuoteFollowUpAlert\([\s\S]*?\n\}/);
  assert.ok(block, 'runner body not located');
  const body = block[0];
  // Reuses the same cohort helper as the live cockpit.
  assert.match(body, /importRequests\.aggregateOpsInsights\(\{/);
  // Reads insights.quoteFollowUp.
  assert.match(body, /agg\.insights && agg\.insights\.quoteFollowUp/);
  // Calls sendQuoteFollowUpAlert.
  assert.match(body, /importsEmails\.sendQuoteFollowUpAlert\(\{/);
});

test('runImportRequestQuoteFollowUpAlert source: no-aging + no-inbox skipped silently (NOT surfaced as errors)', () => {
  const body = CRON_SRC.match(/async function runImportRequestQuoteFollowUpAlert\([\s\S]*?\n\}/)[0];
  // The reason filter mirrors sprint 39/41 discipline — 'all-muted'
  // is a mute counter (not an error), and 'no-inbox' / 'no-aging'
  // are silent skips.
  assert.match(body, /sendResult\.reason !== 'no-inbox' && sendResult\.reason !== 'no-aging'/);
});

// ── Layer 4: pref key ────────────────────────────────────────────

test('importQuoteFollowUpAlertEmails is in PREF_KEYS + defaults to true', () => {
  assert.ok(
    notificationPrefs.PREF_KEYS.includes('importQuoteFollowUpAlertEmails'),
    'importQuoteFollowUpAlertEmails must be in PREF_KEYS',
  );
  const defaults = notificationPrefs.defaultPrefs();
  assert.equal(
    defaults.importQuoteFollowUpAlertEmails, true,
    'importQuoteFollowUpAlertEmails must default to true (opt-out semantics)',
  );
});

// ── Layer 5: GHA workflow ────────────────────────────────────────

test('GHA cron schedule 45 8 * * * routes to import-request-quote-follow-up-alert (drift-guard against slot ambiguity)', () => {
  // Pin BOTH the schedule string AND the router mapping so a
  // silent time change or router mismatch fails the test.
  assert.match(GHA_SRC, /- cron: '45 8 \* \* \*'/);
  assert.match(
    GHA_SRC,
    /"\$\{\{ github\.event\.schedule \}\}" = "45 8 \* \* \*"[\s\S]*?job=import-request-quote-follow-up-alert/,
  );
});

test('GHA workflow_dispatch choice list includes import-request-quote-follow-up-alert', () => {
  assert.match(GHA_SRC, /- import-request-quote-follow-up-alert/);
});

test('GHA schedule 45 8 * * * does NOT collide with any existing schedule (drift-guard against a copy-paste)', () => {
  // Enumerate every "- cron:" entry and assert 45 8 * * * appears
  // exactly once. If someone accidentally duplicated a slot,
  // both jobs would fire and confuse the audit.
  const matches = [...GHA_SRC.matchAll(/- cron: '(45 8 \* \* \*)'/g)];
  assert.equal(matches.length, 1, 'expected exactly one 45 8 * * * cron entry');
});

// ── Layer 6: UI + TS mirror ──────────────────────────────────────

test('TS Prefs extends with importQuoteFollowUpAlertEmails (drift-guard against silent-drop)', () => {
  assert.match(
    API_TS,
    /importRatingTrendAlertEmails\?: boolean;[\s\S]*?importQuoteFollowUpAlertEmails\?: boolean;/,
  );
});

test('preferences page renders importQuoteFollowUpAlertEmails toggle with matching key + label', () => {
  assert.match(PREFS_PAGE, /key: 'importQuoteFollowUpAlertEmails'/);
  assert.match(PREFS_PAGE, /label: 'Aging-quotes daily alert'/);
});

test('preferences page description names the sibling relationship + threshold (transparency)', () => {
  assert.match(
    PREFS_PAGE,
    /Sibling of the stalled-queue alert but on the customer side/,
  );
  assert.match(PREFS_PAGE, /more than 5 days/);
});
