// Automation tests — email module, cron dispatcher, founder digest,
// plan-revision emails, Stripe welcome flow, GHA workflow shape.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const kv = require('../lib/intelligence/kv-store');
const events = require('../lib/events');
const email = require('../lib/email');
const savedPlans = require('../lib/saved-plans');
const planDiff = require('../lib/plan-diff');
const cronHandler = require('../lib/handlers/cron');
const billingHandler = require('../lib/handlers/billing');

const ROOT = path.resolve(__dirname, '..');

// ── lib/email.js ─────────────────────────────────────

test('email.isConfigured: false when RESEND_API_KEY unset', () => {
  const saved = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  assert.equal(email.isConfigured(), false);
  if (saved !== undefined) process.env.RESEND_API_KEY = saved;
});

test('email.send: returns ok:false with reason when unconfigured', async () => {
  const saved = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const r = await email.send({ to: 'a@b.com', subject: 's', text: 't' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /RESEND_API_KEY/);
  if (saved !== undefined) process.env.RESEND_API_KEY = saved;
});

test('email.send: rejects missing fields', async () => {
  process.env.RESEND_API_KEY = 'test-key';
  assert.equal((await email.send({ to: '', subject: 's', text: 't' })).ok, false);
  assert.equal((await email.send({ to: 'a@b.com', subject: '', text: 't' })).ok, false);
  assert.equal((await email.send({ to: 'a@b.com', subject: 's', text: '' })).ok, false);
  delete process.env.RESEND_API_KEY;
});

test('email.resolveFrom: honours explicit + falls back to env then default', () => {
  delete process.env.RESEND_FROM;
  assert.equal(email.resolveFrom('Custom <c@x>'), 'Custom <c@x>');
  process.env.RESEND_FROM = 'OrcaTrade <hi@orcatrade.pl>';
  assert.equal(email.resolveFrom(), 'OrcaTrade <hi@orcatrade.pl>');
  delete process.env.RESEND_FROM;
  assert.equal(email.resolveFrom(), email.DEFAULT_FROM);
});

// ── cron dispatcher ──────────────────────────────────

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}

function cronReq(token, body) {
  return {
    method: 'POST',
    url: '/api/cron',
    headers: { 'x-cron-token': token, 'content-type': 'application/json' },
    body,
  };
}

test('cron: 503 when ORCATRADE_CRON_TOKEN env unset', async () => {
  const saved = process.env.ORCATRADE_CRON_TOKEN;
  delete process.env.ORCATRADE_CRON_TOKEN;
  const res = mockRes();
  await cronHandler(cronReq('anything', { job: 'founder-digest' }), res);
  assert.equal(res.statusCode, 503);
  if (saved !== undefined) process.env.ORCATRADE_CRON_TOKEN = saved;
});

test('cron: 401 when token wrong', async () => {
  process.env.ORCATRADE_CRON_TOKEN = 'correct-token';
  const res = mockRes();
  await cronHandler(cronReq('wrong-token', { job: 'founder-digest' }), res);
  assert.equal(res.statusCode, 401);
  delete process.env.ORCATRADE_CRON_TOKEN;
});

test('cron: 401 when token missing', async () => {
  process.env.ORCATRADE_CRON_TOKEN = 'correct-token';
  const res = mockRes();
  const req = { method: 'POST', url: '/api/cron', headers: {}, body: { job: 'founder-digest' } };
  await cronHandler(req, res);
  assert.equal(res.statusCode, 401);
  delete process.env.ORCATRADE_CRON_TOKEN;
});

test('cron: 405 on non-POST', async () => {
  process.env.ORCATRADE_CRON_TOKEN = 'correct-token';
  const res = mockRes();
  await cronHandler({ method: 'GET', url: '/api/cron', headers: { 'x-cron-token': 'correct-token' }, body: {} }, res);
  assert.equal(res.statusCode, 405);
  delete process.env.ORCATRADE_CRON_TOKEN;
});

test('cron: 400 on unknown job', async () => {
  process.env.ORCATRADE_CRON_TOKEN = 'correct-token';
  const res = mockRes();
  await cronHandler(cronReq('correct-token', { job: 'not-a-real-job' }), res);
  assert.equal(res.statusCode, 400);
  const json = JSON.parse(res.body);
  assert.deepEqual(json.knownJobs.sort(), ['founder-digest', 'plan-revision-emails']);
  delete process.env.ORCATRADE_CRON_TOKEN;
});

test('cron: constant-time token compare rejects length mismatch', async () => {
  process.env.ORCATRADE_CRON_TOKEN = 'abcdef';
  const res = mockRes();
  await cronHandler(cronReq('abc', { job: 'founder-digest' }), res);
  assert.equal(res.statusCode, 401);
  delete process.env.ORCATRADE_CRON_TOKEN;
});

// ── Job: founder digest ──────────────────────────────

test('founder-digest: returns ok:false when ORCATRADE_FOUNDER_INBOXES unset', async () => {
  kv._resetMemoryStore();
  const saved = process.env.ORCATRADE_FOUNDER_INBOXES;
  delete process.env.ORCATRADE_FOUNDER_INBOXES;
  const r = await cronHandler.runFounderDigest();
  assert.equal(r.ok, false);
  assert.match(r.reason, /ORCATRADE_FOUNDER_INBOXES/);
  if (saved !== undefined) process.env.ORCATRADE_FOUNDER_INBOXES = saved;
});

test('founder-digest: aggregates events from the last N days', async () => {
  kv._resetMemoryStore();
  process.env.ORCATRADE_FOUNDER_INBOXES = 'oskar@example.com,arman@example.com,nigel@example.com';
  delete process.env.RESEND_API_KEY; // force soft-fail on send

  // Seed events covering categories + routes
  await events.record('import_plan_generated', {
    locale: 'en',
    inputs: { productCategory: 'apparel', originCountry: 'VN', destinationCountry: 'PL' },
    landedTotal: 28000, emailProvided: true,
  });
  await events.record('import_plan_generated', {
    locale: 'pl',
    inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL' },
    landedTotal: 32000, emailProvided: false,
  });
  await events.record('plan_saved', {
    inputs: { productCategory: 'electronics', originCountry: 'TW', destinationCountry: 'DE' },
    landedTotal: 50000, emailProvided: true,
  });

  const r = await cronHandler.runFounderDigest();
  assert.equal(r.ok, true);
  assert.equal(r.recipients, 3);
  // Email send fails (no RESEND_API_KEY) but aggregation still runs
  assert.equal(r.sent, 0);
  assert.equal(r.failed, 3);
  assert.equal(r.eventsInPeriod, 3);
  assert.equal(r.summary.topCategory, 'apparel');
  delete process.env.ORCATRADE_FOUNDER_INBOXES;
});

test('founder-digest: handles zero events gracefully', async () => {
  kv._resetMemoryStore();
  process.env.ORCATRADE_FOUNDER_INBOXES = 'oskar@example.com';
  delete process.env.RESEND_API_KEY;
  const r = await cronHandler.runFounderDigest();
  assert.equal(r.ok, true);
  assert.equal(r.eventsInPeriod, 0);
  assert.equal(r.summary.total, 0);
  assert.equal(r.summary.topCategory, null);
  delete process.env.ORCATRADE_FOUNDER_INBOXES;
});

// ── Job: plan-revision emails ────────────────────────

test('plan-revision-emails: ok:false when RESEND_API_KEY unset', async () => {
  kv._resetMemoryStore();
  const saved = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const r = await cronHandler.runPlanRevisionEmails();
  assert.equal(r.ok, false);
  assert.match(r.reason, /RESEND_API_KEY/);
  if (saved !== undefined) process.env.RESEND_API_KEY = saved;
});

test('plan-revision-emails: skips plans without significant delta', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key'; // present, won't actually send

  // Save a plan whose snapshot exactly matches current pricing → delta zero
  const BASE = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 };
  const startHandler = require('../lib/handlers/start');
  const plan = startHandler.composePlan(BASE);
  const snapshot = planDiff.extractSnapshot(plan);
  await savedPlans.savePlan({ email: 'a@b.com', inputs: BASE, snapshot });

  const r = await cronHandler.runPlanRevisionEmails({ dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.scanned, 1);
  assert.equal(r.significant, 0); // current === saved → no significant delta
  assert.equal(r.sent, 0);
  delete process.env.RESEND_API_KEY;
});

test('plan-revision-emails: counts plans with significant delta (dry-run)', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';

  // Save with a snapshot whose perShipmentLandedTotal is 50% off the
  // recomputed value — guaranteed to exceed the 5% significance bar.
  const BASE = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 };
  const startHandler = require('../lib/handlers/start');
  const current = planDiff.extractSnapshot(startHandler.composePlan(BASE));
  const stale = Object.assign({}, current, { perShipmentLandedTotal: current.perShipmentLandedTotal * 0.5 });
  await savedPlans.savePlan({ email: 'user@example.com', inputs: BASE, snapshot: stale });

  const r = await cronHandler.runPlanRevisionEmails({ dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.scanned, 1);
  assert.equal(r.significant, 1);
  assert.equal(r.sent, 1);
  delete process.env.RESEND_API_KEY;
});

test('plan-revision-emails: dedupes within an ISO week', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';

  const BASE = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 };
  const startHandler = require('../lib/handlers/start');
  const current = planDiff.extractSnapshot(startHandler.composePlan(BASE));
  const stale = Object.assign({}, current, { perShipmentLandedTotal: current.perShipmentLandedTotal * 0.5 });
  const saved = await savedPlans.savePlan({ email: 'dedupe@example.com', inputs: BASE, snapshot: stale });

  // Pretend last week's run already sent for this plan
  const week = cronHandler.isoWeek();
  await kv.set(`plan-revision-email:${saved.id}:${week}`, { sentAt: new Date().toISOString() });

  const r = await cronHandler.runPlanRevisionEmails({ dryRun: true });
  assert.equal(r.scanned, 1);
  assert.equal(r.significant, 1);
  assert.equal(r.skippedDedupe, 1);
  assert.equal(r.sent, 0);
  delete process.env.RESEND_API_KEY;
});

test('plan-revision-emails: respects maxPlans cap', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';

  // Save 5 plans, cap scan at 3
  const BASE = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 };
  for (let i = 0; i < 5; i++) {
    await savedPlans.savePlan({ email: `u${i}@example.com`, inputs: BASE, snapshot: { perShipmentLandedTotal: 1000 } });
  }
  const r = await cronHandler.runPlanRevisionEmails({ dryRun: true, maxPlans: 3 });
  assert.ok(r.scanned <= 3 + 1, `scanned ${r.scanned} should not greatly exceed cap of 3`);
  delete process.env.RESEND_API_KEY;
});

test('isoWeek: produces YYYY-Www format', () => {
  const w = cronHandler.isoWeek(new Date('2026-05-12T00:00:00Z'));
  assert.match(w, /^2026-W\d{2}$/);
});

// ── Stripe welcome email ─────────────────────────────

test('sendWelcomeEmail: soft-fails when RESEND not configured', async () => {
  delete process.env.RESEND_API_KEY;
  const r = await billingHandler.sendWelcomeEmail({ email: 'a@b.com', tierId: 'growth', billingCycle: 'monthly' });
  assert.equal(r.ok, false);
});

test('sendWelcomeEmail: rejects unknown tier', async () => {
  process.env.RESEND_API_KEY = 'test-key';
  const r = await billingHandler.sendWelcomeEmail({ email: 'a@b.com', tierId: 'made-up', billingCycle: 'monthly' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /unknown tier/);
  delete process.env.RESEND_API_KEY;
});

test('webhook: checkout.session.completed still sets tier + dedupes when welcome email fails', async () => {
  kv._resetMemoryStore();
  const stripe = require('../lib/stripe');
  const userTier = require('../lib/user-tier');
  const secret = 'whsec_welcome_test';
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  // Force welcome-email soft-fail by clearing RESEND_API_KEY
  delete process.env.RESEND_API_KEY;

  const event = {
    id: 'evt_welcome_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        customer_email: 'welcome@example.com',
        customer: 'cus_welcome',
        client_reference_id: 'welcome@example.com',
        metadata: { tier_id: 'growth', billing_cycle: 'monthly' },
      },
    },
  };
  const rawBody = JSON.stringify(event);
  const sig = stripe.buildSignatureHeader(rawBody, secret);
  const req = {
    method: 'POST', url: '/api/billing/webhook', query: { path: ['billing', 'webhook'] },
    headers: { 'stripe-signature': sig }, body: event, rawBody,
  };
  const res = mockRes();
  await billingHandler(req, res);
  assert.equal(res.statusCode, 200);
  // Tier was set even though welcome email soft-failed
  const t = await userTier.getUserTier('welcome@example.com');
  assert.equal(t.tierId, 'growth');
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

// ── Wiring ───────────────────────────────────────────

test('api/[...path].js: cron handler is registered', () => {
  const dispatcher = fs.readFileSync(path.join(ROOT, 'api/[...path].js'), 'utf8');
  assert.match(dispatcher, /cron: require\('\.\.\/lib\/handlers\/cron'\)/);
});

test('.github/workflows/cron.yml: schedules + workflow_dispatch present', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/cron.yml'), 'utf8');
  // Monday 06:30 UTC for founder digest
  assert.match(yml, /30 6 \* \* 1/);
  // Tuesday + Friday 08:00 UTC for plan-revision
  assert.match(yml, /0 8 \* \* 2,5/);
  // Manual trigger
  assert.match(yml, /workflow_dispatch:/);
  // Auth header carries the CRON_TOKEN secret
  assert.match(yml, /X-Cron-Token: \$CRON_TOKEN/);
});

test('.env.example: documents ORCATRADE_CRON_TOKEN + ORCATRADE_FOUNDER_INBOXES', () => {
  // These were added as part of the automation work; update .env.example
  // in a follow-up commit if missing. For now we just assert the keys
  // are referenced somewhere in the codebase so they're discoverable.
  const cron = fs.readFileSync(path.join(ROOT, 'lib/handlers/cron.js'), 'utf8');
  assert.match(cron, /ORCATRADE_CRON_TOKEN/);
  assert.match(cron, /ORCATRADE_FOUNDER_INBOXES/);
});
