// Sprint BG-3.3 phase 2 — Stripe webhook writes tier:org:<id>.
//
// Phase 1 (2026-05-18) shipped the data layer: org-tier KV namespace,
// admin-only manual override. Phase 2 wires the Stripe webhook to
// write tier:org:<id> automatically when a payment lands, so every
// member of the paying org sees the upgrade.
//
// Three design picks codified by these tests:
//   1. Which org gets upgraded → user's PRIMARY org (oldest membership)
//      at checkout time; the orgId travels as Stripe metadata across
//      the subscription lifecycle.
//   2. Multi-org tier conflict → "higher tier wins" — resolveTier
//      looks at every org the user belongs to, picks the highest.
//      Ties broken by oldest membership.
//   3. Cancellation → "at period end" via Stripe's natural event
//      flow. We do NOT downgrade on subscription.updated with
//      cancel_at_period_end=true; we wait for subscription.deleted
//      which Stripe fires at the actual period end.

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');

const kv = require('../lib/intelligence/kv-store');
const tiers = require('../lib/tiers');
const userTier = require('../lib/user-tier');
const orgs = require('../lib/orgs');
const billingHandler = require('../lib/handlers/billing');
const stripe = require('../lib/stripe');
const events = require('../lib/events');

// ── tierRank ─────────────────────────────────────────

test('tierRank: orders free < starter < growth < scale < enterprise', () => {
  assert.equal(tiers.tierRank('free'), 0);
  assert.equal(tiers.tierRank('starter'), 1);
  assert.equal(tiers.tierRank('growth'), 2);
  assert.equal(tiers.tierRank('scale'), 3);
  assert.equal(tiers.tierRank('enterprise'), 4);
});

test('tierRank: unknown / garbage returns -1 (below free, so real tiers always win)', () => {
  assert.equal(tiers.tierRank('unknown'), -1);
  assert.equal(tiers.tierRank(''), -1);
  assert.equal(tiers.tierRank(null), -1);
  assert.equal(tiers.tierRank(undefined), -1);
  assert.equal(tiers.tierRank(42), -1);
});

// ── Stripe Checkout: orgId in metadata ───────────────

test('stripe.createCheckoutSession (offline payload check): orgId surfaces in metadata twice', async () => {
  // We can't actually call Stripe in a test (no STRIPE_SECRET_KEY).
  // Instead we monkey-patch the internal HTTP layer to capture the
  // outgoing payload, then assert org_id is in both session metadata
  // AND subscription_data metadata so it survives the subscription
  // lifecycle.
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.STRIPE_PRICE_STARTER_MONTHLY = 'price_starter_monthly_test';
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, opts) => {
    captured = { url, body: opts.body };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 'cs_test_abc', url: 'https://checkout.stripe.com/c/pay/cs_test_abc' }),
    };
  };
  try {
    await stripe.createCheckoutSession({
      tierId: 'starter',
      billingCycle: 'monthly',
      customerEmail: 'cfo@bigco.com',
      successUrl: 'https://orcatrade.pl/account/billing/?success=1',
      cancelUrl: 'https://orcatrade.pl/pricing/?cancelled=1',
      orgId: 'org_bigco_123',
    });
    assert.ok(captured, 'fetch was called');
    // The body is x-www-form-urlencoded since Stripe takes form-encoded.
    assert.match(captured.body, /metadata%5Borg_id%5D=org_bigco_123/);
    assert.match(captured.body, /subscription_data%5Bmetadata%5D%5Borg_id%5D=org_bigco_123/);
  } finally {
    global.fetch = originalFetch;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_STARTER_MONTHLY;
  }
});

test('stripe.createCheckoutSession: orgId omitted → metadata.org_id absent (legacy per-email path)', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.STRIPE_PRICE_STARTER_MONTHLY = 'price_starter_monthly_test';
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, opts) => {
    captured = { url, body: opts.body };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 'cs_test_abc', url: 'https://checkout.stripe.com/c/pay/cs_test_abc' }),
    };
  };
  try {
    await stripe.createCheckoutSession({
      tierId: 'starter',
      billingCycle: 'monthly',
      customerEmail: 'solo@example.com',
      successUrl: 'https://orcatrade.pl/account/billing/?success=1',
      cancelUrl: 'https://orcatrade.pl/pricing/?cancelled=1',
      // orgId NOT passed
    });
    assert.doesNotMatch(captured.body, /org_id/, 'no org_id when orgId param is absent');
  } finally {
    global.fetch = originalFetch;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_STARTER_MONTHLY;
  }
});

// ── Webhook: checkout.session.completed → org tier ────

test('webhook checkout.session.completed: orgId in metadata → setOrgTier (NOT per-email)', async () => {
  kv._resetMemoryStore();
  const event = {
    type: 'checkout.session.completed',
    data: {
      object: {
        customer_email: 'cfo@bigco.com',
        customer: 'cus_stripe_xyz',
        metadata: { tier_id: 'growth', billing_cycle: 'monthly', org_id: 'org_bigco_123' },
      },
    },
  };
  const r = await billingHandler.processWebhookEvent(event);
  assert.equal(r.handled, true);
  assert.equal(r.action, 'tier-set');
  assert.equal(r.orgId, 'org_bigco_123');
  // Org tier was written.
  const orgRecord = await userTier.getOrgTier('org_bigco_123');
  assert.ok(orgRecord);
  assert.equal(orgRecord.tierId, 'growth');
  // Per-email tier was NOT written (because we have an orgId).
  const userRecord = await userTier.getUserTier('cfo@bigco.com');
  // getUserTier always returns a record — check tierId is the default ('free'), not 'growth'.
  assert.equal(userRecord.tierId, 'free');
});

test('webhook checkout.session.completed: no orgId → falls back to per-email setUserTier', async () => {
  kv._resetMemoryStore();
  const event = {
    type: 'checkout.session.completed',
    data: {
      object: {
        customer_email: 'solo@example.com',
        customer: 'cus_stripe_solo',
        metadata: { tier_id: 'starter', billing_cycle: 'annual' /* no org_id */ },
      },
    },
  };
  const r = await billingHandler.processWebhookEvent(event);
  assert.equal(r.handled, true);
  assert.equal(r.orgId, null);
  // Per-email tier written.
  const userRecord = await userTier.getUserTier('solo@example.com');
  assert.equal(userRecord.tierId, 'starter');
  assert.equal(userRecord.billingCycle, 'annual');
});

test('webhook checkout.session.completed: writes org-by-customer reverse map for cancellation', async () => {
  kv._resetMemoryStore();
  await billingHandler.processWebhookEvent({
    type: 'checkout.session.completed',
    data: {
      object: {
        customer_email: 'pay@org.com',
        customer: 'cus_phase2_1',
        metadata: { tier_id: 'growth', billing_cycle: 'monthly', org_id: 'org_phase2_1' },
      },
    },
  });
  const mapped = await kv.get('stripe:org-by-customer:cus_phase2_1');
  assert.equal(mapped, 'org_phase2_1');
});

// ── Webhook: customer.subscription.deleted → org downgrade ──

test('webhook customer.subscription.deleted: orgId in metadata → org tier set to free', async () => {
  kv._resetMemoryStore();
  // Seed an org on Growth via the checkout path so we have a starting state.
  await userTier.setOrgTier('org_cancel_1', { tierId: 'growth', billingCycle: 'monthly' });
  await kv.set('stripe:email-by-customer:cus_cancel_1', 'cancelled@example.com');

  const r = await billingHandler.processWebhookEvent({
    type: 'customer.subscription.deleted',
    data: {
      object: {
        customer: 'cus_cancel_1',
        metadata: { tier_id: 'growth', org_id: 'org_cancel_1' },
      },
    },
  });
  assert.equal(r.handled, true);
  assert.equal(r.action, 'downgrade-org-to-free');
  assert.equal(r.orgId, 'org_cancel_1');
  const record = await userTier.getOrgTier('org_cancel_1');
  assert.ok(record);
  assert.equal(record.tierId, 'free');
  assert.equal(record.source, 'stripe-cancelled');
});

test('webhook customer.subscription.deleted: falls back to org-by-customer reverse map when metadata missing', async () => {
  // Pre-phase-2 subscriptions don't have org_id in metadata. We wrote
  // stripe:org-by-customer:<id> at checkout.session.completed time, so
  // even legacy events can downgrade the right org.
  kv._resetMemoryStore();
  await userTier.setOrgTier('org_legacy_1', { tierId: 'starter' });
  await kv.set('stripe:org-by-customer:cus_legacy_1', 'org_legacy_1');
  await kv.set('stripe:email-by-customer:cus_legacy_1', 'legacy@example.com');

  const r = await billingHandler.processWebhookEvent({
    type: 'customer.subscription.deleted',
    data: { object: { customer: 'cus_legacy_1' /* no metadata */ } },
  });
  assert.equal(r.handled, true);
  assert.equal(r.action, 'downgrade-org-to-free');
  assert.equal(r.orgId, 'org_legacy_1');
});

test('webhook customer.subscription.deleted: no orgId anywhere → per-email downgrade (legacy)', async () => {
  // Subscribers without an org at checkout time should still get
  // downgraded — this is the phase-0/1 path, preserved as the fallback.
  kv._resetMemoryStore();
  await userTier.setUserTier('soloer@example.com', { tierId: 'starter', source: 'stripe' });
  await kv.set('stripe:email-by-customer:cus_solo_1', 'soloer@example.com');

  const r = await billingHandler.processWebhookEvent({
    type: 'customer.subscription.deleted',
    data: { object: { customer: 'cus_solo_1' /* no metadata, no org map */ } },
  });
  assert.equal(r.handled, true);
  assert.equal(r.action, 'downgrade-to-free');
  assert.equal(r.email, 'soloer@example.com');
  const record = await userTier.getUserTier('soloer@example.com');
  assert.equal(record.tierId, 'free');
});

// ── Cancellation timing — "at period end" semantics ──

test('webhook customer.subscription.updated with cancel_at_period_end:true → no-op (does NOT downgrade)', async () => {
  // The user clicked Cancel in the Stripe portal. Stripe fires
  // customer.subscription.updated with cancel_at_period_end:true RIGHT
  // AWAY, while the subscription is still active. We MUST NOT downgrade
  // — the actual downgrade should happen at period end when Stripe
  // fires customer.subscription.deleted.
  kv._resetMemoryStore();
  await userTier.setOrgTier('org_still_paid', { tierId: 'growth', billingCycle: 'monthly' });

  const r = await billingHandler.processWebhookEvent({
    type: 'customer.subscription.updated',
    data: {
      object: {
        customer: 'cus_still_paid',
        cancel_at_period_end: true,
        metadata: { tier_id: 'growth', org_id: 'org_still_paid' },
      },
    },
  });
  assert.equal(r.action, 'noop-status', 'updated events are not load-bearing — we trust deleted at period-end');
  // Critically: the org is STILL on Growth.
  const record = await userTier.getOrgTier('org_still_paid');
  assert.equal(record.tierId, 'growth');
});

// ── Audit trail ──────────────────────────────────────

test('webhook checkout.session.completed: emits org_tier_assigned audit event with source=stripe', async () => {
  kv._resetMemoryStore();
  await billingHandler.processWebhookEvent({
    type: 'checkout.session.completed',
    data: {
      object: {
        customer_email: 'audit@org.com',
        customer: 'cus_audit_1',
        metadata: { tier_id: 'growth', billing_cycle: 'monthly', org_id: 'org_audit_1' },
      },
    },
  });
  await new Promise((r) => setImmediate(r)); // drain microtasks
  const log = await events.list({ type: 'org_tier_assigned' });
  const row = log.find((e) => e.orgId === 'org_audit_1');
  assert.ok(row);
  assert.equal(row.tierId, 'growth');
  assert.equal(row.source, 'stripe');
  // The audit row must NOT carry the raw email.
  assert.equal(row.email, undefined);
});

test('webhook customer.subscription.deleted: emits org_tier_assigned audit event with source=stripe-cancelled', async () => {
  kv._resetMemoryStore();
  await userTier.setOrgTier('org_cancel_audit', { tierId: 'growth' });
  await kv.set('stripe:org-by-customer:cus_cancel_audit', 'org_cancel_audit');
  await kv.set('stripe:email-by-customer:cus_cancel_audit', 'x@y.com');
  await billingHandler.processWebhookEvent({
    type: 'customer.subscription.deleted',
    data: { object: { customer: 'cus_cancel_audit' } },
  });
  await new Promise((r) => setImmediate(r));
  const log = await events.list({ type: 'org_tier_assigned' });
  const row = log.find((e) => e.orgId === 'org_cancel_audit' && e.tierId === 'free');
  assert.ok(row);
  assert.equal(row.source, 'stripe-cancelled');
});

// ── handleCheckout passes orgId from the user's primary org ──

test('handleCheckout: looks up the user\'s primary org + passes orgId to Stripe', async () => {
  kv._resetMemoryStore();
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.STRIPE_PRICE_STARTER_MONTHLY = 'price_starter_monthly_test';

  // Create a real org so primary-org lookup returns something concrete.
  const org = await orgs.createOrg({ name: 'BigCo', ownerEmail: 'cfo@bigco.com' });

  // Monkey-patch fetch to capture the outgoing Stripe Checkout payload.
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, opts) => {
    captured = { url, body: opts.body };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 'cs_test_handle', url: 'https://checkout.stripe.com/c/pay/cs_test_handle' }),
    };
  };

  const auth = require('../lib/auth');
  const cookie = auth.buildSessionCookie('cfo@bigco.com');
  const req = {
    method: 'POST',
    url: '/api/billing/checkout',
    headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
    query: { path: ['billing', 'checkout'] },
    body: { tierId: 'starter', billingCycle: 'monthly' },
  };
  const res = { statusCode: 200, _h: {}, body: '', setHeader(k, v) { this._h[k] = v; }, end(b) { this.body = b; } };

  try {
    await billingHandler.handleCheckout(req, res, { email: 'cfo@bigco.com' });
    assert.equal(res.statusCode, 200);
    assert.ok(captured, 'Stripe fetch was called');
    // The org_id in the outgoing form body matches the user's primary
    // org (the one they own).
    assert.match(captured.body, new RegExp('metadata%5Borg_id%5D=' + org.id));
  } finally {
    global.fetch = originalFetch;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_STARTER_MONTHLY;
  }
});

test('handleCheckout: user with no org → orgId omitted, falls back to per-email checkout', async () => {
  kv._resetMemoryStore();
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.STRIPE_PRICE_STARTER_MONTHLY = 'price_starter_monthly_test';

  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, opts) => {
    captured = { url, body: opts.body };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 'cs_test_solo', url: 'https://checkout.stripe.com/c/pay/cs_test_solo' }),
    };
  };

  const auth = require('../lib/auth');
  const cookie = auth.buildSessionCookie('soloer@example.com');
  const req = {
    method: 'POST',
    url: '/api/billing/checkout',
    headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
    query: { path: ['billing', 'checkout'] },
    body: { tierId: 'starter', billingCycle: 'monthly' },
  };
  const res = { statusCode: 200, _h: {}, body: '', setHeader(k, v) { this._h[k] = v; }, end(b) { this.body = b; } };

  try {
    await billingHandler.handleCheckout(req, res, { email: 'soloer@example.com' });
    assert.equal(res.statusCode, 200);
    assert.doesNotMatch(captured.body, /org_id/, 'no org_id when user has no orgs');
  } finally {
    global.fetch = originalFetch;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_STARTER_MONTHLY;
  }
});
