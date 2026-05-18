// Sprint weekly-digest-v1 — tests for lib/digest.js + the cron job
// runWeeklyUserDigest. Covers:
//   - The pure aggregator (empty, no-actuals, mixed-drift, value-weighted,
//     no current snapshot)
//   - EN/PL/DE formatter shape + subject lines
//   - Cron-job lifecycle: scan, opt-out, idempotency, no-plans, dry-run
//   - prefs-v1 surface: weeklyDigestEmails default + setPrefs round-trip
//   - /account/preferences/ UI contract: toggle slot + pref-key wiring

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const digest = require('../lib/digest');
const kv = require('../lib/intelligence/kv-store');
const savedPlans = require('../lib/saved-plans');
const planDiff = require('../lib/plan-diff');
const startHandler = require('../lib/handlers/start');
const notificationPrefs = require('../lib/notification-prefs');
const cronHandler = require('../lib/handlers/cron');

// ── buildDigestPayload ────────────────────────────────

test('buildDigestPayload: empty input → planCount=0 + zero everything', () => {
  const p = digest.buildDigestPayload([]);
  assert.equal(p.planCount, 0);
  assert.equal(p.planCountSignificant, 0);
  assert.equal(p.planCountWithActuals, 0);
  assert.equal(p.topMover, null);
  assert.equal(p.calibration.planCount, 0);
});

test('buildDigestPayload: handles missing currentSnapshot (no recompute available)', () => {
  // A user with one saved plan but the cron couldn't recompute the
  // current snapshot (composePlan threw / TARIC down). Should still
  // count the plan in planCount but not crash + not register a mover.
  const p = digest.buildDigestPayload([
    { id: 'a', snapshot: { perShipmentLandedTotal: 100 }, currentSnapshot: null },
  ]);
  assert.equal(p.planCount, 1);
  assert.equal(p.planCountSignificant, 0);
  assert.equal(p.topMover, null);
});

test('buildDigestPayload: plan with significant drift bumps the counter + becomes topMover', () => {
  const snap = {
    perShipmentLandedTotal: 1000, effectiveLandedTotal: 800,
    dutyEur: 100, vatEur: 200, transportEur: 50, brokerageEur: 50, dutyRatePct: 10,
    asOf: '2026-05-01T00:00:00Z',
  };
  const current = Object.assign({}, snap, { perShipmentLandedTotal: 1100, dutyEur: 200, asOf: '2026-05-15T00:00:00Z' });
  const p = digest.buildDigestPayload([
    { id: 'p1', label: 'Apparel CN→PL', snapshot: snap, currentSnapshot: current, savedAt: snap.asOf },
  ]);
  assert.equal(p.planCountSignificant, 1);
  assert.ok(p.topMover);
  assert.equal(p.topMover.planId, 'p1');
  assert.equal(p.topMover.label, 'Apparel CN→PL');
  assert.equal(p.topMover.direction, 'up');
  assert.equal(p.topMover.landedDeltaEur, 100);
});

test('buildDigestPayload: across multiple plans, largest |deltaPct| wins topMover', () => {
  const base = { effectiveLandedTotal: 0, dutyEur: 0, vatEur: 0, transportEur: 0, brokerageEur: 0, dutyRatePct: 0, asOf: '2026-05-01T00:00:00Z' };
  const planA = {
    id: 'A', label: 'small mover',
    snapshot: Object.assign({}, base, { perShipmentLandedTotal: 1000 }),
    currentSnapshot: Object.assign({}, base, { perShipmentLandedTotal: 1060 }), // +6%
    savedAt: base.asOf,
  };
  const planB = {
    id: 'B', label: 'big mover',
    snapshot: Object.assign({}, base, { perShipmentLandedTotal: 1000 }),
    currentSnapshot: Object.assign({}, base, { perShipmentLandedTotal: 1300 }), // +30%
    savedAt: base.asOf,
  };
  const p = digest.buildDigestPayload([planA, planB]);
  assert.equal(p.planCountSignificant, 2);
  assert.equal(p.topMover.planId, 'B');
});

test('buildDigestPayload: drift under 5% does NOT count as significant', () => {
  const base = { effectiveLandedTotal: 0, dutyEur: 0, vatEur: 0, transportEur: 0, brokerageEur: 0, dutyRatePct: 0, asOf: '2026-05-01T00:00:00Z' };
  const p = digest.buildDigestPayload([{
    id: 'p1', label: 'tiny drift',
    snapshot: Object.assign({}, base, { perShipmentLandedTotal: 1000 }),
    currentSnapshot: Object.assign({}, base, { perShipmentLandedTotal: 1030 }), // +3%
    savedAt: base.asOf,
  }]);
  assert.equal(p.planCountSignificant, 0);
  // Still records the largest mover (a label/preview value even if not significant).
  assert.ok(p.topMover);
});

test('buildDigestPayload: actuals roll up via summariseActuals (value-weighted)', () => {
  const p = digest.buildDigestPayload([
    {
      id: 'big', actual: { landedEur: 105000 },
      actualVariance: { estimateEur: 100000, actualEur: 105000, deltaPct: 5, direction: 'over' },
    },
    {
      id: 'small', actual: { landedEur: 95 },
      actualVariance: { estimateEur: 100, actualEur: 95, deltaPct: -5, direction: 'under' },
    },
  ]);
  assert.equal(p.planCountWithActuals, 2);
  assert.equal(p.calibration.withActuals, 2);
  // Value-weighted: the €100k plan completely dominates the €100 one.
  assert.ok(p.calibration.avgVariancePct > 4 && p.calibration.avgVariancePct <= 5);
});

// ── formatDigestText + formatDigestSubject ───────────

function emptyPayload(overrides = {}) {
  return Object.assign({
    asOf: '2026-05-18T00:00:00Z',
    planCount: 0,
    planCountSignificant: 0,
    planCountWithActuals: 0,
    topMover: null,
    calibration: { planCount: 0, withActuals: 0, avgVariancePct: null, byDirection: { over: 0, under: 0, onTarget: 0 } },
  }, overrides);
}

test('formatDigestText: EN body contains the expected core lines', () => {
  const payload = emptyPayload({ planCount: 3, planCountSignificant: 1, topMover: {
    planId: 'p1', label: 'Apparel CN→PL', landedDeltaEur: 1500, landedDeltaPct: 12.5, direction: 'up', primaryDriver: 'duty',
  }});
  const text = digest.formatDigestText(payload, {
    locale: 'en',
    planUrl: 'https://orcatrade.pl/account/plans/',
    unsubUrl: 'https://orcatrade.pl/api/unsubscribe?token=xyz',
    prefsUrl: 'https://orcatrade.pl/account/preferences/',
  });
  assert.match(text, /3 total/);
  assert.match(text, /One plan/);
  assert.match(text, /Top mover.*Apparel CN.PL/);
  assert.match(text, /€1,500/);
  assert.match(text, /\+12\.5%/);
  // Unsubscribe + prefs lines.
  assert.match(text, /unsubscribe/i);
  assert.match(text, /https:\/\/orcatrade\.pl\/api\/unsubscribe\?token=xyz/);
  assert.match(text, /https:\/\/orcatrade\.pl\/account\/preferences\//);
});

test('formatDigestText: PL + DE produce localised headlines', () => {
  const payload = emptyPayload({ planCount: 2, planCountSignificant: 0 });
  const pl = digest.formatDigestText(payload, { locale: 'pl' });
  const de = digest.formatDigestText(payload, { locale: 'de' });
  assert.match(pl, /Oto stan/);
  assert.match(de, /So stehen Ihre/);
});

test('formatDigestText: unknown locale falls back to EN', () => {
  const text = digest.formatDigestText(emptyPayload({ planCount: 1 }), { locale: 'fr' });
  assert.match(text, /Here.s where your saved plans stand/);
});

test('formatDigestText: omits Top mover line when no significant movers', () => {
  // Even if topMover is non-null (largest deltaPct), the line only renders
  // when planCountSignificant > 0 — otherwise it's noise.
  const text = digest.formatDigestText(emptyPayload({
    planCount: 1, planCountSignificant: 0,
    topMover: { planId: 'p1', label: 'tiny', landedDeltaEur: 10, landedDeltaPct: 1, direction: 'up', primaryDriver: 'vat' },
  }), { locale: 'en' });
  assert.doesNotMatch(text, /Top mover/);
});

test('formatDigestText: actuals-none line when withActuals === 0', () => {
  const text = digest.formatDigestText(emptyPayload({ planCount: 1 }), { locale: 'en' });
  assert.match(text, /haven.t logged a real outcome/);
});

test('formatDigestText: actuals-summary line when withActuals > 0', () => {
  const payload = emptyPayload({
    planCount: 1, planCountWithActuals: 1,
    calibration: { planCount: 1, withActuals: 1, avgVariancePct: 4.2, byDirection: { over: 1, under: 0, onTarget: 0 } },
  });
  const text = digest.formatDigestText(payload, { locale: 'en' });
  assert.match(text, /Calibration:.*1 outcome/);
  assert.match(text, /\+4\.2%/);
});

test('formatDigestSubject: includes plan count + pluralises in EN', () => {
  assert.match(digest.formatDigestSubject(emptyPayload({ planCount: 1 })), /1 plan saved$/);
  assert.match(digest.formatDigestSubject(emptyPayload({ planCount: 5 })), /5 plans saved$/);
});

// ── normaliseLocale ────────────────────────────────

test('normaliseLocale: lowercases, returns en for unknowns/missing', () => {
  assert.equal(digest.normaliseLocale('EN'), 'en');
  assert.equal(digest.normaliseLocale('pl'), 'pl');
  assert.equal(digest.normaliseLocale('DE'), 'de');
  assert.equal(digest.normaliseLocale('fr'), 'en');
  assert.equal(digest.normaliseLocale(undefined), 'en');
  assert.equal(digest.normaliseLocale(null), 'en');
});

// ── notification-prefs surface ────────────────────────

test('prefs: PREF_KEYS includes weeklyDigestEmails', () => {
  assert.ok(notificationPrefs.PREF_KEYS.includes('weeklyDigestEmails'));
});

test('prefs: default weeklyDigestEmails is true (opt-out semantics)', async () => {
  kv._resetMemoryStore();
  const p = await notificationPrefs.getPrefs('newbie@example.com');
  assert.equal(p.weeklyDigestEmails, true);
});

test('prefs: setPrefs({ weeklyDigestEmails: false }) persists', async () => {
  kv._resetMemoryStore();
  const stored = await notificationPrefs.setPrefs('user@example.com', { weeklyDigestEmails: false });
  assert.equal(stored.weeklyDigestEmails, false);
  assert.equal((await notificationPrefs.getPrefs('user@example.com')).weeklyDigestEmails, false);
});

test('prefs: planRevisionEmails + weeklyDigestEmails are independent', async () => {
  kv._resetMemoryStore();
  await notificationPrefs.setPrefs('user@example.com', { weeklyDigestEmails: false });
  const p = await notificationPrefs.getPrefs('user@example.com');
  assert.equal(p.weeklyDigestEmails, false);
  assert.equal(p.planRevisionEmails, true);
});

// ── Cron job: runWeeklyUserDigest ─────────────────────

test('weekly-user-digest: ok:false when RESEND_API_KEY unset', async () => {
  kv._resetMemoryStore();
  const saved = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const r = await cronHandler.runWeeklyUserDigest();
  assert.equal(r.ok, false);
  assert.match(r.reason, /RESEND_API_KEY/);
  if (saved !== undefined) process.env.RESEND_API_KEY = saved;
});

test('weekly-user-digest: user with no plans → skippedNoPlans (zero-emails-emitted invariant)', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  // Seed a user-plans index with an empty array. The handler must NOT
  // email a user whose saved-plan list is empty (signal-deprived digest).
  await kv.set('user:empty@example.com:plans', []);
  const r = await cronHandler.runWeeklyUserDigest({ dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.skippedNoPlans, 1);
  assert.equal(r.sent, 0);
  delete process.env.RESEND_API_KEY;
});

test('weekly-user-digest: opt-out (weeklyDigestEmails:false) → skippedOptOut', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const BASE = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 };
  await savedPlans.savePlan({ email: 'optout@example.com', inputs: BASE, snapshot: { perShipmentLandedTotal: 1000 } });
  await notificationPrefs.setPrefs('optout@example.com', { weeklyDigestEmails: false });

  const r = await cronHandler.runWeeklyUserDigest({ dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.skippedOptOut, 1);
  assert.equal(r.sent, 0);
  delete process.env.RESEND_API_KEY;
});

test('weekly-user-digest: counts an eligible user (dry-run, default opted-in)', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const BASE = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 };
  // Save with a real composed snapshot so the cron's currentSnapshot
  // recompute lands on the same value (no drift) — eligible nonetheless.
  const plan = await startHandler.composePlan(BASE);
  const snapshot = planDiff.extractSnapshot(plan);
  await savedPlans.savePlan({ email: 'eligible@example.com', inputs: BASE, snapshot });

  const r = await cronHandler.runWeeklyUserDigest({ dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.scannedUsers, 1);
  assert.equal(r.eligibleUsers, 1);
  assert.equal(r.sent, 1); // dry-run counts the would-send
  delete process.env.RESEND_API_KEY;
});

test('weekly-user-digest: idempotent within DIGEST_MIN_INTERVAL_DAYS — second run skips recently-emailed users', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const BASE = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 };
  const plan = await startHandler.composePlan(BASE);
  const snapshot = planDiff.extractSnapshot(plan);
  await savedPlans.savePlan({ email: 'idem@example.com', inputs: BASE, snapshot });

  // Simulate "yesterday's run already sent". Storage shape matches the
  // cron's own writeback: { sentAt: ISO, planCount: N } with 7-day TTL.
  await kv.set(cronHandler.DIGEST_LAST_SENT_PREFIX + 'idem@example.com', {
    sentAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    planCount: 1,
  });

  const r = await cronHandler.runWeeklyUserDigest({ dryRun: true });
  assert.equal(r.skippedRecent, 1);
  assert.equal(r.sent, 0);
  delete process.env.RESEND_API_KEY;
});

test('weekly-user-digest: re-sends after the 6-day window has passed', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const BASE = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 };
  const plan = await startHandler.composePlan(BASE);
  const snapshot = planDiff.extractSnapshot(plan);
  await savedPlans.savePlan({ email: 'reage@example.com', inputs: BASE, snapshot });

  // Simulate an 8-day-old send — older than DIGEST_MIN_INTERVAL_DAYS=6.
  await kv.set(cronHandler.DIGEST_LAST_SENT_PREFIX + 'reage@example.com', {
    sentAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    planCount: 1,
  });

  const r = await cronHandler.runWeeklyUserDigest({ dryRun: true });
  assert.equal(r.skippedRecent, 0);
  assert.equal(r.sent, 1);
  delete process.env.RESEND_API_KEY;
});

test('weekly-user-digest: registered in JOBS map under the expected name', () => {
  assert.equal(typeof cronHandler.JOBS['weekly-user-digest'], 'function');
  assert.equal(cronHandler.JOBS['weekly-user-digest'], cronHandler.runWeeklyUserDigest);
});

// ── /account/preferences/ UI contract ───────────────

test('/account/preferences/index.html includes a weeklyDigestEmails toggle', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'preferences', 'index.html'), 'utf8');
  assert.match(html, /data-pref=["']weeklyDigestEmails["']/);
  assert.match(html, /data-pref-key=["']weeklyDigestEmails["']/);
  // Headline visible to users.
  assert.match(html, /Weekly digest/i);
});

// ── Module surface ───────────────────────────────────

test('digest module exposes the v1 surface', () => {
  for (const name of ['SIGNIFICANT_PCT', 'LOCALES', 'buildDigestPayload', 'formatDigestText', 'formatDigestSubject', 'normaliseLocale']) {
    assert.ok(digest[name] !== undefined, name + ' exported');
  }
});
