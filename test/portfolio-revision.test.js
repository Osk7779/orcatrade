// Sprint portfolio-revision-v1 — weekly portfolio cost-drift email cron.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ORCATRADE_DISABLE_LIVE_TARIC = '1';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const pr = require('../lib/portfolio-revision');
const sp = require('../lib/saved-portfolios');
const kv = require('../lib/intelligence/kv-store');
const notificationPrefs = require('../lib/notification-prefs');
const cronHandler = require('../lib/handlers/cron');

const lines = [
  { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 50000, weightKg: 2000 },
  { productCategory: 'electronics', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 30000, weightKg: 800 },
];
// Deliberately-low baseline so a fresh recompute drifts up materially.
const staleSnapshot = {
  lineCount: 2, blendedDutyRatePct: 4, consolidationSavingEur: 0,
  totals: { customsValueEur: 80000, dutyEur: 1000, vatEur: 1, brokerageEur: 1, transportEur: 1, perShipmentLandedTotal: 50000 },
};

// ── Email builder (pure) ────────────────────────────────

test('buildPortfolioRevisionEmail: null when no movers', () => {
  assert.equal(pr.buildPortfolioRevisionEmail('en', []), null);
  assert.equal(pr.buildPortfolioRevisionEmail('en', null), null);
});

test('buildPortfolioRevisionEmail: EN body lists movers with direction + delta', () => {
  const out = pr.buildPortfolioRevisionEmail('en', [
    { label: 'Q3 catalogue', landedDeltaEur: 12000, landedDeltaPct: 12, direction: 'up', savedAt: '2026-04-01T00:00:00Z' },
    { label: 'Spring line', landedDeltaEur: -8000, landedDeltaPct: -8, direction: 'down', savedAt: '2026-04-10T00:00:00Z' },
  ], { portfolioUrl: 'https://x/p', prefsUrl: 'https://x/prefs', unsubUrl: 'https://x/u' });
  assert.match(out.subject, /2 of your saved portfolios have moved/);
  assert.match(out.text, /Q3 catalogue: up €12,000 \(\+12\.0%\) since 2026-04-01/);
  assert.match(out.text, /Spring line: down €8,000 \(-8\.0%\) since 2026-04-10/);
  assert.match(out.text, /https:\/\/x\/p/);
  assert.match(out.text, /https:\/\/x\/u/);
});

test('buildPortfolioRevisionEmail: PL + DE localisation', () => {
  const movers = [{ label: 'Kat', landedDeltaEur: 5000, landedDeltaPct: 6, direction: 'up', savedAt: '2026-04-01' }];
  assert.match(pr.buildPortfolioRevisionEmail('pl', movers).subject, /portfeli/);
  assert.match(pr.buildPortfolioRevisionEmail('de', movers).subject, /Portfolios/);
});

test('buildPortfolioRevisionEmail: unknown locale falls back to EN', () => {
  const out = pr.buildPortfolioRevisionEmail('fr', [{ label: 'X', landedDeltaEur: 5000, landedDeltaPct: 6, direction: 'up', savedAt: '2026-04-01' }]);
  assert.match(out.subject, /moved on cost/);
});

test('singular subject for one mover', () => {
  const out = pr.buildPortfolioRevisionEmail('en', [{ label: 'X', landedDeltaEur: 5000, landedDeltaPct: 6, direction: 'up', savedAt: '2026-04-01' }]);
  assert.match(out.subject, /1 of your saved portfolio has moved/);
});

// ── Cron lifecycle ──────────────────────────────────────

test('portfolio-revision: ok:false when RESEND_API_KEY unset', async () => {
  const saved = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const r = await cronHandler.runPortfolioRevisionEmails();
  assert.equal(r.ok, false);
  assert.match(r.reason, /RESEND_API_KEY/);
  if (saved !== undefined) process.env.RESEND_API_KEY = saved;
});

test('portfolio-revision: material mover counts in dry-run', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  await sp.savePortfolio({ email: 'mover@example.com', lines, label: 'Cat', snapshot: staleSnapshot });
  const r = await cronHandler.runPortfolioRevisionEmails({ dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.usersWithMovers, 1);
  assert.equal(r.sent, 1); // dry-run counts as "would send"
  assert.ok(r.portfoliosChecked >= 1);
  delete process.env.RESEND_API_KEY;
});

test('portfolio-revision: no material drift → skippedNoMovers', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  // Save with a snapshot that matches the fresh recompute (no drift):
  // compose first, save that exact aggregate as the snapshot.
  const portfolioHandler = require('../lib/handlers/portfolio');
  const { aggregate } = await portfolioHandler.composeAndAggregate(lines);
  await sp.savePortfolio({ email: 'flat@example.com', lines, label: 'Flat', snapshot: aggregate });
  const r = await cronHandler.runPortfolioRevisionEmails({ dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.usersWithMovers, 0);
  assert.equal(r.skippedNoMovers, 1);
  delete process.env.RESEND_API_KEY;
});

test('portfolio-revision: opt-out (planRevisionEmails:false) → skippedOptOut', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  await sp.savePortfolio({ email: 'optout@example.com', lines, label: 'Cat', snapshot: staleSnapshot });
  await notificationPrefs.setPrefs('optout@example.com', { planRevisionEmails: false });
  const r = await cronHandler.runPortfolioRevisionEmails({ dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.skippedOptOut, 1);
  assert.equal(r.sent, 0);
  delete process.env.RESEND_API_KEY;
});

test('portfolio-revision: 6-day dedupe → skippedRecent', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  await sp.savePortfolio({ email: 'dupe@example.com', lines, label: 'Cat', snapshot: staleSnapshot });
  // Pretend we emailed them yesterday.
  await kv.set(cronHandler.PORTFOLIO_REVISION_DEDUPE_PREFIX + 'dupe@example.com', { sentAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() });
  const r = await cronHandler.runPortfolioRevisionEmails({ dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.skippedRecent, 1);
  assert.equal(r.sent, 0);
  delete process.env.RESEND_API_KEY;
});

test('portfolio-revision: only scans :portfolios index keys, not :plans', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  // A plans index for a user with no portfolios must be ignored.
  await kv.set('user:plansonly@example.com:plans', ['pl_dead']);
  await sp.savePortfolio({ email: 'mover@example.com', lines, label: 'Cat', snapshot: staleSnapshot });
  const r = await cronHandler.runPortfolioRevisionEmails({ dryRun: true });
  // Only the portfolios user is scanned.
  assert.equal(r.scannedUsers, 1);
  assert.equal(r.usersWithMovers, 1);
  delete process.env.RESEND_API_KEY;
});

test('portfolio-revision-emails is registered in the JOBS map', () => {
  assert.equal(typeof cronHandler.JOBS['portfolio-revision-emails'], 'function');
});

test('GHA cron workflow schedules + dispatches portfolio-revision-emails', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'cron.yml'), 'utf8');
  assert.match(wf, /30 8 \* \* 4/);                          // schedule slot
  assert.match(wf, /portfolio-revision-emails/);             // dispatch option + resolver
});
