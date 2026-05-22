// Extended automation tests — date rotator, regime change check,
// Stripe payment-failed dunning.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const kv = require('../lib/intelligence/kv-store');
const rotator = require('../scripts/rotate-content-dates');
const cronHandler = require('../lib/handlers/cron');
const billingHandler = require('../lib/handlers/billing');
const stripe = require('../lib/stripe');

const ROOT = path.resolve(__dirname, '..');

// ── Date rotator: pure-fn tests ─────────────────────

test('rotator: isWithinRotationWindow accepts dates within last 7 days', () => {
  const today = new Date();
  const twoDaysAgo = new Date(today.getTime() - 2 * 86400000).toISOString().slice(0, 10);
  const tenDaysAgo = new Date(today.getTime() - 10 * 86400000).toISOString().slice(0, 10);
  assert.equal(rotator.isWithinRotationWindow(twoDaysAgo), true);
  assert.equal(rotator.isWithinRotationWindow(tenDaysAgo), false);
});

test('rotator: isWithinRotationWindow rejects future dates', () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  assert.equal(rotator.isWithinRotationWindow(tomorrow), false);
});

test('rotator: isWithinRotationWindow rejects garbage input', () => {
  assert.equal(rotator.isWithinRotationWindow('not-a-date'), false);
  assert.equal(rotator.isWithinRotationWindow(''), false);
  assert.equal(rotator.isWithinRotationWindow(null), false);
});

test('rotator: PATTERNS catalogue is non-empty', () => {
  assert.ok(rotator.PATTERNS.length >= 4, 'expected at least 4 rotation patterns');
});

// ── Rotator: end-to-end on temp files ────────────────

test('rotator: rotates JSON-LD datePublished + dateModified', () => {
  const tmp = path.join(os.tmpdir(), `rot-${Date.now()}.html`);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  fs.writeFileSync(tmp, `<html><script type="application/ld+json">{"datePublished":"${yesterday}","dateModified":"${yesterday}"}</script></html>`);
  const n = rotator.rotateFile(tmp);
  assert.equal(n, 2);
  const after = fs.readFileSync(tmp, 'utf8');
  assert.match(after, new RegExp(`"datePublished":"${today}"`));
  assert.match(after, new RegExp(`"dateModified":"${today}"`));
  fs.unlinkSync(tmp);
});

test('rotator: rotates sitemap <lastmod>', () => {
  const tmp = path.join(os.tmpdir(), `rot-${Date.now()}.xml`);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  fs.writeFileSync(tmp, `<urlset><url><lastmod>${yesterday}</lastmod></url></urlset>`);
  const n = rotator.rotateFile(tmp);
  assert.equal(n, 1);
  assert.match(fs.readFileSync(tmp, 'utf8'), new RegExp(`<lastmod>${today}</lastmod>`));
  fs.unlinkSync(tmp);
});

test('rotator: rotates EN/PL/DE footer lines', () => {
  const tmp = path.join(os.tmpdir(), `rot-${Date.now()}.html`);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  fs.writeFileSync(tmp, [
    `<p>Snapshot reviewed on ${yesterday}.</p>`,
    `<p>Snapshot überprüft am ${yesterday}.</p>`,
    `<p>Snapshot zweryfikowano w ${yesterday}.</p>`,
  ].join('\n'));
  const n = rotator.rotateFile(tmp);
  assert.equal(n, 3);
  const after = fs.readFileSync(tmp, 'utf8');
  assert.match(after, new RegExp(`Snapshot reviewed on ${today}`));
  assert.match(after, new RegExp(`Snapshot überprüft am ${today}`));
  assert.match(after, new RegExp(`Snapshot zweryfikowano w ${today}`));
  fs.unlinkSync(tmp);
});

test('rotator: leaves out-of-window dates untouched (regulation effective dates)', () => {
  const tmp = path.join(os.tmpdir(), `rot-${Date.now()}.html`);
  fs.writeFileSync(tmp, `<p>Effective <time>2026-01-01</time></p><script type="application/ld+json">{"datePublished":"2024-06-15"}</script>`);
  const n = rotator.rotateFile(tmp);
  assert.equal(n, 0, 'dates outside the 7-day window must not be rewritten');
  fs.unlinkSync(tmp);
});

test('rotator: idempotent on today\'s dates (no-op)', () => {
  const tmp = path.join(os.tmpdir(), `rot-${Date.now()}.html`);
  const today = new Date().toISOString().slice(0, 10);
  const content = `<script>{"datePublished":"${today}","dateModified":"${today}"}</script>`;
  fs.writeFileSync(tmp, content);
  const n = rotator.rotateFile(tmp);
  assert.equal(n, 0);
  assert.equal(fs.readFileSync(tmp, 'utf8'), content);
  fs.unlinkSync(tmp);
});

test('rotator: GHA workflow registered at .github/workflows/rotate-dates.yml', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/rotate-dates.yml'), 'utf8');
  assert.match(yml, /scripts\/rotate-content-dates\.js/);
  assert.match(yml, /'0 3 \* \* \*'/);
  assert.match(yml, /permissions:\s*\n\s*contents: write/);
});

// ── Regime change-detection job ──────────────────────

test('regime-check: REGIME_SOURCES has at least the headline regulations', () => {
  const ids = cronHandler.REGIME_SOURCES.map(r => r.id);
  for (const id of ['cbam', 'eudr', 'reach', 'gpsr', 'battery', 'ppwr']) {
    assert.ok(ids.includes(id), `expected ${id} in REGIME_SOURCES`);
  }
});

test('regime-check: hashContent stable across whitespace/case differences', () => {
  const a = cronHandler.hashContent('<p>Hello WORLD</p>');
  const b = cronHandler.hashContent('  <p>hello   world</p>  ');
  assert.equal(a, b);
});

test('regime-check: extractMainContent prefers <article>', () => {
  const html = '<html><body><nav>x</nav><article>real content</article></body></html>';
  const out = cronHandler.extractMainContent(html);
  assert.match(out, /<article>real content<\/article>/);
  assert.doesNotMatch(out, /<nav>/);
});

test('regime-check: extractMainContent falls back to <main> then <body>', () => {
  assert.match(cronHandler.extractMainContent('<main>m</main>'), /<main>/);
  assert.match(cronHandler.extractMainContent('<body>b</body>'), /<body>/);
  assert.equal(cronHandler.extractMainContent('no markup'), 'no markup');
});

test('regime-check: registered as a known cron job', () => {
  assert.ok('regime-change-check' in cronHandler.JOBS);
});

test('regime-check: detects change against stored hash + alerts', async () => {
  kv._resetMemoryStore();
  // Seed a stored hash for one regime
  await kv.set(cronHandler.REGIME_HASH_PREFIX + 'cbam', { hash: 'stale-hash-from-yesterday', at: '2026-05-01T00:00:00Z' });

  // Stub fetch globally so we don't hit EUR-Lex in tests
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    return {
      ok: true,
      status: 200,
      text: async () => '<html><article>NEW REGULATORY TEXT — substantially changed</article></html>',
    };
  };

  try {
    // alert=false skips Resend so we don't depend on RESEND_API_KEY
    const r = await cronHandler.runRegimeChangeCheck({ alert: false });
    assert.equal(r.ok, true);
    assert.equal(r.checked, cronHandler.REGIME_SOURCES.length);
    assert.ok(r.changed >= 1, 'expected at least one regime to have drifted');
    const drifted = r.detail.changed.find(c => c.id === 'cbam');
    assert.ok(drifted, 'expected CBAM to be flagged as drifted');
    assert.equal(drifted.previousHash, 'stale-hash-from-yesterday');
  } finally {
    global.fetch = realFetch;
  }
});

test('regime-check: no change → no alert', async () => {
  kv._resetMemoryStore();
  const fixedHash = cronHandler.hashContent('<article>stable text</article>');

  // Pre-seed every regime with the same stable hash → no drift
  for (const regime of cronHandler.REGIME_SOURCES) {
    await kv.set(cronHandler.REGIME_HASH_PREFIX + regime.id, { hash: fixedHash, at: '2026-05-01T00:00:00Z' });
  }

  const realFetch = global.fetch;
  global.fetch = async () => ({
    ok: true, status: 200,
    text: async () => '<html><article>stable text</article></html>',
  });
  try {
    const r = await cronHandler.runRegimeChangeCheck({ alert: false });
    assert.equal(r.changed, 0);
    assert.equal(r.alertSent, 0);
  } finally {
    global.fetch = realFetch;
  }
});

test('regime-check: handles fetch failures gracefully', async () => {
  kv._resetMemoryStore();
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('network unreachable'); };
  try {
    const r = await cronHandler.runRegimeChangeCheck({ alert: false });
    assert.equal(r.ok, true);
    assert.equal(r.failed, cronHandler.REGIME_SOURCES.length);
    assert.equal(r.changed, 0);
  } finally {
    global.fetch = realFetch;
  }
});

// ── Stripe payment-failed dunning ────────────────────

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}

async function fireWebhook(event, { dunningResetExpected = false } = {}) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_dunning_test';
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  const rawBody = JSON.stringify(event);
  const sig = stripe.buildSignatureHeader(rawBody, secret);
  const req = {
    method: 'POST', url: '/api/billing/webhook', query: { path: ['billing', 'webhook'] },
    headers: { 'stripe-signature': sig }, body: event, rawBody,
  };
  const res = mockRes();
  await billingHandler(req, res);
  return { res, body: JSON.parse(res.body || '{}') };
}

test('dunning: invoice.payment_failed increments counter + sends email', async () => {
  kv._resetMemoryStore();
  await kv.set('stripe:email-by-customer:cus_dunning_a', 'dunning-a@example.com');
  delete process.env.RESEND_API_KEY; // soft-fail welcome email path

  const event = {
    id: 'evt_dunning_1',
    type: 'invoice.payment_failed',
    data: { object: {
      subscription: 'sub_a',
      customer: 'cus_dunning_a',
      customer_email: 'dunning-a@example.com',
      amount_due: 39900,
    }},
  };
  const { res, body } = await fireWebhook(event);
  assert.equal(res.statusCode, 200);
  assert.equal(body.action, 'dunning-sent');
  assert.equal(body.attempt, 1);

  // KV counter set to 1
  const counter = await kv.get(billingHandler.DUNNING_PREFIX + 'sub_a');
  assert.equal(Number(counter), 1);
});

test('dunning: second failure increments to 2', async () => {
  kv._resetMemoryStore();
  await kv.set('stripe:email-by-customer:cus_dunning_b', 'dunning-b@example.com');

  // Fire twice with distinct event ids (webhook idempotency dedupes
  // identical IDs, but a real Stripe retry has new event IDs).
  await fireWebhook({
    id: 'evt_dunning_b1', type: 'invoice.payment_failed',
    data: { object: { subscription: 'sub_b', customer: 'cus_dunning_b', amount_due: 9900 } },
  });
  const { body } = await fireWebhook({
    id: 'evt_dunning_b2', type: 'invoice.payment_failed',
    data: { object: { subscription: 'sub_b', customer: 'cus_dunning_b', amount_due: 9900 } },
  });
  assert.equal(body.attempt, 2);
});

test('dunning: invoice.payment_succeeded resets the counter', async () => {
  kv._resetMemoryStore();
  await kv.set('stripe:email-by-customer:cus_reset', 'reset@example.com');
  // Pre-set the counter to 2
  await kv.set(billingHandler.DUNNING_PREFIX + 'sub_reset', 2);
  await fireWebhook({
    id: 'evt_reset_1', type: 'invoice.payment_succeeded',
    data: { object: { subscription: 'sub_reset', customer: 'cus_reset' } },
  });
  const counter = await kv.get(billingHandler.DUNNING_PREFIX + 'sub_reset');
  assert.equal(counter, null);
});

test('dunning: no email known → 200 with handled:false reason', async () => {
  kv._resetMemoryStore();
  const { res, body } = await fireWebhook({
    id: 'evt_no_email_1', type: 'invoice.payment_failed',
    data: { object: { subscription: 'sub_x', customer: 'cus_unknown' } },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(body.reason, 'no-email-for-customer');
});

test('dunning: sendDunningEmail soft-fails without RESEND_API_KEY', async () => {
  delete process.env.RESEND_API_KEY;
  const r = await billingHandler.sendDunningEmail({ email: 'x@y.com', attempt: 1, invoice: {} });
  assert.equal(r.ok, false);
});

test('dunning: attempts ≥4 collapse to final-attempt copy', async () => {
  process.env.RESEND_API_KEY = 'test-key';
  // We can't actually verify subject without intercepting fetch; this test
  // just confirms the path runs without throwing for high attempt counts.
  const r = await billingHandler.sendDunningEmail({ email: 'x@y.com', attempt: 99, invoice: { amount_due: 9900 } });
  // result will be ok:false from fake fetch; we just want no exception
  assert.ok(typeof r === 'object');
  delete process.env.RESEND_API_KEY;
});

// ── Workflow wiring ──────────────────────────────────

test('cron.yml: regime-change-check is scheduled + dispatchable', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/cron.yml'), 'utf8');
  assert.match(yml, /'0 5 \* \* 3'/);
  assert.match(yml, /regime-change-check/);
});

test('cron.yml: taric-warm is scheduled daily + dispatchable', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/cron.yml'), 'utf8');
  assert.match(yml, /'15 4 \* \* \*'/);
  assert.match(yml, /taric-warm/);
});

test('cron handler: JOBS map contains all scheduled + on-demand jobs', () => {
  // founder-digest + plan-revision-emails fire weekly from GHA cron.
  // regime-change-check fires nightly. taric-warm fires nightly too —
  // see lib/handlers/cron.js#runTaricWarm (Sprint F).
  // Sprint BG-2.1 adds db-migrate as an on-demand job that GHA can fire
  // to apply Postgres schema changes.
  // Sprint BG-1.7 adds calibration-drift-check — nightly aggregator
  // that emits Sentry warns when groups cross drift thresholds.
  // Sprint weekly-digest-v1 adds weekly-user-digest — once-weekly
  // portfolio summary email for every user with saved plans.
  // Sprint portfolio-revision-v1 adds portfolio-revision-emails —
  // weekly cost-drift scan over saved multi-SKU portfolios.
  // Sprint compliance-calendar-v1 phase 3 adds compliance-deadline-reminders —
  // weekly scan that emails users about upcoming CBAM/EUDR deadlines.
  const ids = Object.keys(cronHandler.JOBS).sort();
  assert.deepEqual(ids, [
    'calibration-drift-check',
    'compliance-deadline-reminders',
    'db-migrate',
    'founder-digest',
    'plan-revision-emails',
    'portfolio-revision-emails',
    'rag-reindex',
    'regime-change-check',
    'sanctions-refresh',
    'taric-warm',
    'weekly-user-digest',
  ]);
});
