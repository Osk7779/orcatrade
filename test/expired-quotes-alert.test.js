'use strict';

// Sprint 78 — weekly expired-quotes alert email (trifecta for
// sprint 77's cohort #12). Mirrors the sprint-70 aging-quotes
// alert architecture: composer with strict short-circuit + sender
// with pref gate + cron runner + GHA schedule + preferences toggle
// + TS Prefs mirror.
//
// WEEKLY cadence (Tue 09:00 UTC) — expiry is a retrospective loss
// report, not a same-day chase. Deliberately NOT gated by the
// sprint-75 alertCadence (that covers the three DAILY alerts;
// weekly is precisely what cadence-weekly orgs asked for).
//
// Also carries the sprint-78 COLLISION FIX drift-guard: the
// supplier-concentration alert's original '0 9 * * 4' slot
// collided with monitoring-scan — the router's first-match elif
// meant it NEVER fired by schedule. Every schedule string in
// cron.yml must now be unique; the guard below fails on any
// future duplicate.
//
// Tests cover six layers + the uniqueness guard:
//   1. composeExpiredQuotesAlert: null on count===0; € headline
//      from pre-summed cents; singular/plural; window + count in
//      copy; per-item null-cents → '—' (never €0); truncation
//      footnote; htmlDl not pre-escaped.
//   2. sendExpiredQuotesAlert: 'no-expired' short-circuit; pref
//      gate uses importExpiredQuotesAlertEmails; composer-null
//      defensive guard.
//   3. Cron runner: registered + exported; per-org fan-out;
//      passes the cohort through; NOT alertCadence-gated.
//   4. Pref key in PREF_KEYS (opt-out default TRUE).
//   5. GHA: '0 9 * * 2' schedule → job route; dispatch choice;
//      schedule-uniqueness guard.
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
  windowDays: 30,
  count: 3,
  totalLandedCents: 1234500,
  items: [
    { externalId: 'ir_aaa', label: 'Widgets', expiredAt: '2026-07-01T00:00:00Z', landedCents: 500000 },
    { externalId: 'ir_bbb', label: 'Gadgets', expiredAt: '2026-06-20T00:00:00Z', landedCents: 734500 },
    { externalId: 'ir_ccc', label: 'Legacy row', expiredAt: '2026-06-10T00:00:00Z', landedCents: null },
  ],
};

// ── Layer 1: composer semantics ──────────────────────────────────

test('composeExpiredQuotesAlert returns null when cohort missing / count=0', () => {
  assert.equal(importsEmails.composeExpiredQuotesAlert({ expiredQuotes: null }), null);
  assert.equal(
    importsEmails.composeExpiredQuotesAlert({
      expiredQuotes: { windowDays: 30, count: 0, totalLandedCents: 0, items: [] },
    }),
    null,
  );
});

test('composeExpiredQuotesAlert headlines the € total (pre-summed cents, display-only formatting)', () => {
  const composed = importsEmails.composeExpiredQuotesAlert({ orgName: 'Acme Ltd', expiredQuotes: COHORT });
  assert.ok(composed);
  // 1_234_500 cents = €12,345.
  assert.match(composed.subject, /^\[Acme Ltd\] €12,345 in quotes expired unanswered/);
  assert.match(composed.text, /3 quotes worth €12,345 in total hit expiry with no customer decision in the last 30 days\./);
  assert.match(composed.html, /€12,345 walked away unanswered\./);
});

test('composeExpiredQuotesAlert uses SINGULAR copy when count===1', () => {
  const composed = importsEmails.composeExpiredQuotesAlert({
    expiredQuotes: { ...COHORT, count: 1, totalLandedCents: 500000, items: [COHORT.items[0]] },
  });
  assert.ok(composed);
  assert.match(composed.text, /1 quote worth €5,000 hit expiry/);
});

test('composeExpiredQuotesAlert renders a NULL landedCents row as "—", never €0', () => {
  // eurFromCents coerces null → €0 (Number(null) === 0) — the
  // composer must null-guard BEFORE calling it. A real €0 quote
  // and a missing quote are different truths.
  const composed = importsEmails.composeExpiredQuotesAlert({ expiredQuotes: COHORT });
  assert.ok(composed);
  assert.match(composed.text, /—  ·  Legacy row  \(ir_ccc\)/);
  assert.ok(!/€0\s+·\s+Legacy row/.test(composed.text));
  // Source pin on the guard shape.
  assert.match(
    EMAILS_SRC,
    /\(item\.landedCents === null \|\| item\.landedCents === undefined\)\s*\n\s*\? '—'\s*\n\s*: eurFromCents\(item\.landedCents\)/,
  );
});

test('composeExpiredQuotesAlert adds the truncation footnote only when count > items.length', () => {
  const truncatedComposed = importsEmails.composeExpiredQuotesAlert({
    expiredQuotes: { ...COHORT, count: 12 },
  });
  assert.match(truncatedComposed.text, /Showing the 3 most recent; 9 more expired in the window\./);
  const exactComposed = importsEmails.composeExpiredQuotesAlert({ expiredQuotes: COHORT });
  assert.ok(!/more expired in the window/.test(exactComposed.text));
});

test('composeExpiredQuotesAlert does NOT pre-escape htmlDl rows (sprint-55 double-encoding lesson)', () => {
  const block = EMAILS_SRC.match(/function composeExpiredQuotesAlert\([\s\S]*?\n\}/);
  assert.ok(block, 'composer not found');
  const dlBlock = block[0].match(/const dlRows = items\.map\([\s\S]*?\)\);/);
  assert.ok(dlBlock, 'dlRows map not found');
  assert.ok(!/esc\(/.test(dlBlock[0]), 'htmlDl escapes internally — rows must not be pre-escaped');
});

// ── Layer 2: sender wiring ───────────────────────────────────────

test('sendExpiredQuotesAlert short-circuits: bad org, missing cohort, empty cohort', async () => {
  const noOrg = await importsEmails.sendExpiredQuotesAlert({ orgIdNumeric: NaN, expiredQuotes: COHORT });
  assert.equal(noOrg.ok, false);
  const noCohort = await importsEmails.sendExpiredQuotesAlert({ orgIdNumeric: 1, expiredQuotes: null });
  assert.equal(noCohort.reason, 'expiredQuotes required');
  const empty = await importsEmails.sendExpiredQuotesAlert({
    orgIdNumeric: 1,
    expiredQuotes: { ...COHORT, count: 0 },
  });
  assert.equal(empty.reason, 'no-expired');
});

test('sendExpiredQuotesAlert pref-gates via importExpiredQuotesAlertEmails + guards composer-null', () => {
  const block = EMAILS_SRC.match(/async function sendExpiredQuotesAlert\([\s\S]*?\n\}/);
  assert.ok(block, 'sender not found');
  assert.match(block[0], /filterMutedRecipients\(resolution\.recipients, 'importExpiredQuotesAlertEmails'\)/);
  assert.match(block[0], /reason: 'composer-null'/);
});

// ── Layer 3: cron runner ─────────────────────────────────────────

test('runner registered under import-request-expired-quotes-alert + exported', () => {
  assert.match(CRON_SRC, /'import-request-expired-quotes-alert': runImportRequestExpiredQuotesAlert,/);
  assert.equal(typeof cronHandlers.runImportRequestExpiredQuotesAlert, 'function');
});

test('runner fans out per-org, passes the cohort through, and skips no-expired silently', () => {
  const block = CRON_SRC.match(/async function runImportRequestExpiredQuotesAlert\([\s\S]*?\n\}/);
  assert.ok(block, 'runner not found');
  const body = block[0];
  assert.match(body, /for \(const org of allOrgs\) \{/);
  assert.match(body, /const expiredQuotes = agg\.insights && agg\.insights\.expiredQuotes;/);
  assert.match(body, /sendExpiredQuotesAlert\(\{/);
  assert.match(body, /sendResult\.reason !== 'no-inbox' && sendResult\.reason !== 'no-expired'/);
});

test('runner is NOT alertCadence-gated — weekly is what cadence-weekly orgs asked for', () => {
  const block = CRON_SRC.match(/async function runImportRequestExpiredQuotesAlert\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.ok(
    !/getAlertCadence/.test(block[0]),
    'the sprint-75 cadence gate covers the three DAILY alerts only',
  );
});

// ── Layer 4: pref key ────────────────────────────────────────────

test('importExpiredQuotesAlertEmails is in PREF_KEYS (opt-out — defaults TRUE)', () => {
  assert.ok(notificationPrefs.PREF_KEYS.includes('importExpiredQuotesAlertEmails'));
});

// ── Layer 5: GHA schedule + router + uniqueness ──────────────────

test('GHA cron.yml registers the Tue 09:00 UTC schedule and routes it to the new job', () => {
  assert.match(GHA_SRC, /- cron: '0 9 \* \* 2'/);
  assert.match(
    GHA_SRC,
    /elif \[ "\$\{\{ github\.event\.schedule \}\}" = "0 9 \* \* 2" \]; then\s+echo "job=import-request-expired-quotes-alert"/,
  );
  assert.match(GHA_SRC, /- import-request-expired-quotes-alert/);
});

test('every schedule string in cron.yml is UNIQUE (first-match router — a duplicate is a dead alert)', () => {
  // The sprint-78 collision fix: supplier-concentration's original
  // '0 9 * * 4' collided with monitoring-scan and never fired by
  // schedule (the elif chain resolves first-match). This guard
  // makes the whole class of bug impossible to reintroduce.
  const schedules = [...GHA_SRC.matchAll(/- cron: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(schedules.length >= 15, `expected a full schedule list, got ${schedules.length}`);
  const seen = new Set();
  for (const s of schedules) {
    assert.ok(!seen.has(s), `duplicate cron schedule '${s}' — the first-match router silently kills the second job`);
    seen.add(s);
  }
});

test('the supplier-concentration alert now holds the collision-free Thu 09:15 slot', () => {
  assert.match(GHA_SRC, /- cron: '15 9 \* \* 4'/);
  assert.match(
    GHA_SRC,
    /elif \[ "\$\{\{ github\.event\.schedule \}\}" = "15 9 \* \* 4" \]; then\s+echo "job=import-request-supplier-concentration-alert"/,
  );
});

// ── Layer 6: UI toggle + TS mirror ───────────────────────────────

test('preferences page renders the expired-quotes toggle with matching key', () => {
  assert.match(PREFS_PAGE, /key: 'importExpiredQuotesAlertEmails'/);
  assert.match(PREFS_PAGE, /label: 'Expired-quotes weekly alert'/);
  assert.match(PREFS_PAGE, /Tuesday morning loss report/);
});

test('TS Prefs interface mirrors the new key', () => {
  assert.match(API_TS, /importExpiredQuotesAlertEmails\?: boolean;/);
});
