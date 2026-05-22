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
