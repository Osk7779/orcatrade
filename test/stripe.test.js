// Stripe client + billing-handler tests (Sprint 41).

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const kv = require('../lib/intelligence/kv-store');
const stripe = require('../lib/stripe');
const auth = require('../lib/auth');
const userTier = require('../lib/user-tier');
const billingHandler = require('../lib/handlers/billing');

// ── Stripe client primitives ──────────────────────────

test('encodeFormBody: shallow keys', async () => {
  const body = stripe.encodeFormBody({ mode: 'subscription', success_url: 'https://x.test' });
  assert.match(body, /mode=subscription/);
  assert.match(body, /success_url=https%3A%2F%2Fx\.test/);
});

test('encodeFormBody: nested objects use bracket notation', () => {
  const body = stripe.encodeFormBody({ metadata: { tier_id: 'growth', billing: 'annual' } });
  assert.match(body, /metadata%5Btier_id%5D=growth/);
  assert.match(body, /metadata%5Bbilling%5D=annual/);
});

test('priceIdFor: reads STRIPE_PRICE_<TIER>_<CYCLE> env var', () => {
  process.env.STRIPE_PRICE_GROWTH_MONTHLY = 'price_test_growth_monthly';
  assert.equal(stripe.priceIdFor('growth', 'monthly'), 'price_test_growth_monthly');
  assert.equal(stripe.priceIdFor('not-a-tier', 'monthly'), null);
  delete process.env.STRIPE_PRICE_GROWTH_MONTHLY;
});

test('isConfigured: false without STRIPE_SECRET_KEY', () => {
  const saved = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  assert.equal(stripe.isConfigured(), false);
  if (saved !== undefined) process.env.STRIPE_SECRET_KEY = saved;
});

// ── Webhook signature verification ────────────────────

test('verifyWebhookSignature: round-trip with buildSignatureHeader', () => {
  const body = JSON.stringify({ id: 'evt_test', type: 'checkout.session.completed' });
  const secret = 'whsec_test_secret';
  const header = stripe.buildSignatureHeader(body, secret);
  const r = stripe.verifyWebhookSignature(body, header, secret);
  assert.equal(r.ok, true);
});

test('verifyWebhookSignature: rejects wrong body', () => {
  const body = JSON.stringify({ id: 'evt_a', type: 't' });
  const secret = 'whsec_x';
  const header = stripe.buildSignatureHeader(body, secret);
  const r = stripe.verifyWebhookSignature('{"different":true}', header, secret);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'signature-mismatch');
});

test('verifyWebhookSignature: rejects expired timestamp', () => {
  const body = JSON.stringify({ id: 'evt_a' });
  const secret = 'whsec_x';
  const oldT = Math.floor(Date.now() / 1000) - 10 * 60; // 10 min old
  const header = stripe.buildSignatureHeader(body, secret, { t: oldT });
  const r = stripe.verifyWebhookSignature(body, header, secret);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'timestamp-out-of-tolerance');
});

test('verifyWebhookSignature: rejects missing secret/header/body', () => {
  assert.equal(stripe.verifyWebhookSignature('body', 'header', '').reason, 'no-secret');
  assert.equal(stripe.verifyWebhookSignature('body', '', 'secret').reason, 'no-header');
  assert.equal(stripe.verifyWebhookSignature('', 'header', 'secret').reason, 'no-body');
});

test('verifyWebhookSignature: malformed header', () => {
  const r = stripe.verifyWebhookSignature('body', 'totally-not-a-stripe-sig', 'secret');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'malformed-header');
});

test('parseEvent: returns null for malformed payload', () => {
  assert.equal(stripe.parseEvent('not-json'), null);
  assert.equal(stripe.parseEvent('{}'), null); // missing id+type
  const e = stripe.parseEvent(JSON.stringify({ id: 'evt_x', type: 'checkout.session.completed' }));
  assert.equal(e.id, 'evt_x');
});

// ── /api/billing handler (no live Stripe — exercise gates + 503/401 paths) ─

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}
function authedReq(method, body = {}, sub = 'me') {
  const cookie = auth.buildSessionCookie('billing-user@example.com');
  return {
    method,
    body,
    url: '/api/billing/' + sub,
    query: { path: ['billing', sub] },
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
  };
}

test('handler: GET /api/billing/me 401 without auth', async () => {
  const req = { method: 'GET', headers: {}, url: '/api/billing/me', query: { path: ['billing', 'me'] } };
  const res = mockRes();
  await billingHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test('handler: GET /api/billing/me returns default-free for new user', async () => {
  kv._resetMemoryStore();
  const req = authedReq('GET', null, 'me');
  const res = mockRes();
  await billingHandler(req, res);
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.tierId, 'free');
  assert.equal(json.hasStripeCustomer, false);
});

test('handler: POST /api/billing/checkout 503 when STRIPE_SECRET_KEY missing', async () => {
  kv._resetMemoryStore();
  const saved = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  const req = authedReq('POST', { tierId: 'growth', billingCycle: 'monthly' }, 'checkout');
  const res = mockRes();
  await billingHandler(req, res);
  assert.equal(res.statusCode, 503);
  if (saved !== undefined) process.env.STRIPE_SECRET_KEY = saved;
});

test('handler: POST /api/billing/checkout 400 for invalid tier', async () => {
  kv._resetMemoryStore();
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  const req = authedReq('POST', { tierId: 'made-up', billingCycle: 'monthly' }, 'checkout');
  const res = mockRes();
  await billingHandler(req, res);
  assert.equal(res.statusCode, 400);
  delete process.env.STRIPE_SECRET_KEY;
});

test('handler: POST /api/billing/checkout 400 for free tier', async () => {
  kv._resetMemoryStore();
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  const req = authedReq('POST', { tierId: 'free', billingCycle: 'monthly' }, 'checkout');
  const res = mockRes();
  await billingHandler(req, res);
  assert.equal(res.statusCode, 400);
  delete process.env.STRIPE_SECRET_KEY;
});

test('handler: POST /api/billing/portal 404 without prior checkout', async () => {
  kv._resetMemoryStore();
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  const req = authedReq('POST', null, 'portal');
  const res = mockRes();
  await billingHandler(req, res);
  assert.equal(res.statusCode, 404);
  delete process.env.STRIPE_SECRET_KEY;
});

// ── Webhook idempotency + tier write ──────────────────

test('handler: webhook 503 without STRIPE_WEBHOOK_SECRET', async () => {
  kv._resetMemoryStore();
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const req = { method: 'POST', headers: {}, url: '/api/billing/webhook', query: { path: ['billing', 'webhook'] }, body: {} };
  const res = mockRes();
  await billingHandler(req, res);
  assert.equal(res.statusCode, 503);
});

test('handler: webhook rejects invalid signature', async () => {
  kv._resetMemoryStore();
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const req = {
    method: 'POST',
    url: '/api/billing/webhook',
    query: { path: ['billing', 'webhook'] },
    headers: { 'stripe-signature': 't=999,v1=deadbeef' },
    body: JSON.parse(body),
    rawBody: body,
  };
  const res = mockRes();
  await billingHandler(req, res);
  assert.equal(res.statusCode, 400);
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

test('handler: webhook checkout.session.completed sets tier and dedupes', async () => {
  kv._resetMemoryStore();
  const secret = 'whsec_test';
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  const event = {
    id: 'evt_idem_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        customer_email: 'webhook-user@example.com',
        customer: 'cus_test_123',
        client_reference_id: 'webhook-user@example.com',
        metadata: { tier_id: 'growth', billing_cycle: 'monthly' },
      },
    },
  };
  const rawBody = JSON.stringify(event);
  const sig = stripe.buildSignatureHeader(rawBody, secret);

  // First delivery
  const req1 = {
    method: 'POST', url: '/api/billing/webhook', query: { path: ['billing', 'webhook'] },
    headers: { 'stripe-signature': sig }, body: event, rawBody,
  };
  const res1 = mockRes();
  await billingHandler(req1, res1);
  assert.equal(res1.statusCode, 200);
  const j1 = JSON.parse(res1.body);
  assert.equal(j1.action, 'tier-set');

  // Verify tier was written
  const t = await userTier.getUserTier('webhook-user@example.com');
  assert.equal(t.tierId, 'growth');
  assert.equal(t.billingCycle, 'monthly');
  assert.equal(t.source, 'stripe');

  // Second delivery (same event id) — should be idempotent
  const req2 = {
    method: 'POST', url: '/api/billing/webhook', query: { path: ['billing', 'webhook'] },
    headers: { 'stripe-signature': sig }, body: event, rawBody,
  };
  const res2 = mockRes();
  await billingHandler(req2, res2);
  assert.equal(res2.statusCode, 200);
  const j2 = JSON.parse(res2.body);
  assert.equal(j2.idempotent, true);

  delete process.env.STRIPE_WEBHOOK_SECRET;
});

test('handler: webhook subscription.deleted downgrades to free', async () => {
  kv._resetMemoryStore();
  const secret = 'whsec_test';
  process.env.STRIPE_WEBHOOK_SECRET = secret;

  // Pre-condition: user is on growth and we know their customer-id
  await userTier.setUserTier('cancel-user@example.com', { tierId: 'growth', billingCycle: 'monthly', source: 'stripe' });
  await kv.set('stripe:email-by-customer:cus_cancel', 'cancel-user@example.com');

  const event = {
    id: 'evt_cancel_1',
    type: 'customer.subscription.deleted',
    data: { object: { customer: 'cus_cancel' } },
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

  const t = await userTier.getUserTier('cancel-user@example.com');
  assert.equal(t.tierId, 'free');
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

test('processWebhookEvent: ignores unknown event types', async () => {
  const r = await billingHandler.processWebhookEvent({
    id: 'evt_x',
    type: 'invoice.paid',
    data: { object: {} },
  });
  assert.equal(r.handled, false);
  assert.equal(r.reason, 'event-type-not-handled');
});

test('inferTierFromEvent: prefers metadata.tier_id + surfaces orgId when present', () => {
  const r = billingHandler.inferTierFromEvent({
    data: { object: { metadata: { tier_id: 'starter', billing_cycle: 'annual', org_id: 'org_abc123' } } },
  });
  assert.deepEqual(r, { tierId: 'starter', billingCycle: 'annual', orgId: 'org_abc123' });
});

test('inferTierFromEvent: orgId is null when metadata has no org_id (legacy per-email subscriber)', () => {
  const r = billingHandler.inferTierFromEvent({
    data: { object: { metadata: { tier_id: 'starter', billing_cycle: 'monthly' } } },
  });
  assert.equal(r.tierId, 'starter');
  assert.equal(r.billingCycle, 'monthly');
  assert.equal(r.orgId, null);
});

test('inferTierFromEvent: falls back to subscription_data.metadata for orgId too', () => {
  // The subscription.deleted event fires at period-end cancellation
  // and carries subscription metadata, not session metadata. Phase 2
  // depends on org_id being there.
  const r = billingHandler.inferTierFromEvent({
    data: { object: { subscription_data: { metadata: { tier_id: 'growth', billing_cycle: 'monthly', org_id: 'org_xyz' } } } },
  });
  assert.equal(r.tierId, 'growth');
  assert.equal(r.orgId, 'org_xyz');
});

// ── Static + dispatcher wiring ───────────────────────

test('/account/billing/ page exists', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'account/billing/index.html'), 'utf8');
  assert.match(html, /Your subscription/);
  assert.match(html, /id="state-loaded"/);
  assert.match(html, /id="portal-btn"/);
});

test('/account/billing/app.js calls /api/billing/me + portal', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', 'account/billing/app.js'), 'utf8');
  assert.match(js, /\/api\/billing\/me/);
  assert.match(js, /\/api\/billing\/portal/);
});

test('pricing page wires /api/billing/checkout for subscribe CTAs', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'pricing/index.html'), 'utf8');
  assert.match(html, /\/api\/billing\/checkout/);
  assert.match(html, /data-action="subscribe"/);
});

test('api/[...path].js dispatcher registers billing handler', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dispatcher = fs.readFileSync(path.join(__dirname, '..', 'api/[...path].js'), 'utf8');
  assert.match(dispatcher, /billing: require\('\.\.\/lib\/handlers\/billing'\)/);
});
