const test = require('node:test');
const assert = require('node:assert/strict');

const kv = require('../lib/intelligence/kv-store');
const savedPlans = require('../lib/saved-plans');
const notificationPrefs = require('../lib/notification-prefs');
const cronHandler = require('../lib/handlers/cron');

// CBAM applies to steel from a non-EEA origin; its nearest statutory milestone
// is the 2027-05-31 annual declaration. Evaluating as-of 2027-05-01 puts that
// 30 days out — inside the 45-day reminder horizon — so it deterministically
// triggers a reminder regardless of the real wall-clock date.
const STEEL_PLAN = { productCategory: 'steel', originCountry: 'CN', destinationCountry: 'DE', customsValueEur: 250000 };

test('the job is registered in the cron dispatch table', () => {
  assert.equal(typeof cronHandler.JOBS['compliance-deadline-reminders'], 'function');
  assert.equal(typeof cronHandler.runComplianceDeadlineReminders, 'function');
});

test('complianceDeadlineEmails is an opt-out pref (default true)', async () => {
  kv._resetMemoryStore();
  assert.ok(notificationPrefs.PREF_KEYS.includes('complianceDeadlineEmails'));
  const p = await notificationPrefs.getPrefs('fresh@example.com');
  assert.equal(p.complianceDeadlineEmails, true);
});

test('a user with an in-window deadline gets one reminder (dry-run)', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  await savedPlans.savePlan({ email: 'importer@example.com', inputs: STEEL_PLAN });

  const r = await cronHandler.runComplianceDeadlineReminders({ dryRun: true, asOf: '2027-05-01' });
  assert.equal(r.ok, true);
  assert.equal(r.scannedUsers, 1);
  assert.equal(r.scannedPlans, 1);
  assert.equal(r.usersWithDeadlines, 1);
  assert.equal(r.sent, 1);
  delete process.env.RESEND_API_KEY;
});

test('no in-window deadline → no reminder', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  await savedPlans.savePlan({ email: 'importer@example.com', inputs: STEEL_PLAN });

  // As-of mid-2026 the CBAM deadline is ~364 days out — outside the 45-day window.
  const r = await cronHandler.runComplianceDeadlineReminders({ dryRun: true, asOf: '2026-06-01' });
  assert.equal(r.ok, true);
  assert.equal(r.usersWithDeadlines, 0);
  assert.equal(r.sent, 0);
  delete process.env.RESEND_API_KEY;
});

test('a product covered by neither regime produces no reminder', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  await savedPlans.savePlan({
    email: 'importer@example.com',
    inputs: { productCategory: 'consumer electronics', originCountry: 'CN', destinationCountry: 'DE', customsValueEur: 50000 },
  });

  const r = await cronHandler.runComplianceDeadlineReminders({ dryRun: true, asOf: '2027-05-01' });
  assert.equal(r.usersWithDeadlines, 0);
  assert.equal(r.sent, 0);
  delete process.env.RESEND_API_KEY;
});

test('opt-out is respected', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  await savedPlans.savePlan({ email: 'optout@example.com', inputs: STEEL_PLAN });
  await notificationPrefs.setPrefs('optout@example.com', { complianceDeadlineEmails: false });

  const r = await cronHandler.runComplianceDeadlineReminders({ dryRun: true, asOf: '2027-05-01' });
  assert.equal(r.usersWithDeadlines, 1);
  assert.equal(r.skippedOptOut, 1);
  assert.equal(r.sent, 0);
  delete process.env.RESEND_API_KEY;
});

test('missing RESEND key short-circuits gracefully', async () => {
  kv._resetMemoryStore();
  delete process.env.RESEND_API_KEY;
  const r = await cronHandler.runComplianceDeadlineReminders({ dryRun: true, asOf: '2027-05-01' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /RESEND/);
});

test('complianceDeadlineEmails pref round-trips (default true → false persists)', async () => {
  kv._resetMemoryStore();
  assert.equal((await notificationPrefs.getPrefs('p@example.com')).complianceDeadlineEmails, true);
  await notificationPrefs.setPrefs('p@example.com', { complianceDeadlineEmails: false });
  assert.equal((await notificationPrefs.getPrefs('p@example.com')).complianceDeadlineEmails, false);
  // independent of the other streams
  assert.equal((await notificationPrefs.getPrefs('p@example.com')).planRevisionEmails, true);
});

// ── localised email body (EN / PL / DE) ─────────────────

const SAMPLE = {
  obligations: [
    { regime: 'eudr', title: 'Application date — non-SME operators', citation: 'Regulation (EU) 2023/1115, Art. 38', dueDate: '2026-12-30', daysUntil: 29, severity: 'high' },
    { regime: 'cbam', title: 'First annual CBAM declaration due', citation: 'Regulation (EU) 2023/956, Art. 6 and Art. 22', dueDate: '2027-05-31', daysUntil: 152, severity: 'low' },
  ],
  planUrl: 'https://orcatrade.pl/account/plans/',
  unsubUrl: 'https://orcatrade.pl/api/unsubscribe?token=t&stream=complianceDeadlineEmails',
  prefsUrl: 'https://orcatrade.pl/account/preferences/',
};

test('EN email: subject + body carry the soonest deadline and citations', () => {
  const { subject, text } = cronHandler.buildDeadlineEmail('en', SAMPLE);
  assert.match(subject, /Compliance deadlines:/); // plural (2 obligations)
  assert.match(subject, /in 29 days/);
  assert.match(text, /Regulation \(EU\) 2023\/1115, Art\. 38/);
  assert.match(text, /Regulation \(EU\) 2023\/956/);
  assert.ok(text.includes(SAMPLE.planUrl));
  assert.match(text, /Unsubscribe from deadline reminders/);
});

test('PL email is in Polish', () => {
  const { subject, text } = cronHandler.buildDeadlineEmail('pl', SAMPLE);
  assert.match(subject, /Termin zgodności/);
  assert.match(subject, /za 29 dni/);
  assert.match(text, /Wypisz się/);
});

test('DE email is in German', () => {
  const { subject, text } = cronHandler.buildDeadlineEmail('de', SAMPLE);
  assert.match(subject, /Compliance-Frist/);
  assert.match(subject, /in 29 Tagen/);
  assert.match(text, /abmelden/);
});

test('unknown locale falls back to EN', () => {
  const { subject } = cronHandler.buildDeadlineEmail('xx', SAMPLE);
  assert.match(subject, /Compliance deadlines:/);
});

test('single obligation drops the plural in the EN subject', () => {
  const { subject } = cronHandler.buildDeadlineEmail('en', { ...SAMPLE, obligations: [SAMPLE.obligations[0]] });
  assert.match(subject, /Compliance deadline:/);
  assert.doesNotMatch(subject, /Compliance deadlines:/);
});
