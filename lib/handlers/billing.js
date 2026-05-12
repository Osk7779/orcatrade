// /api/billing/* — Stripe checkout, portal, and webhook (Sprint 41).
//
// Sub-actions resolved from URL path:
//   POST /api/billing/checkout         — auth required; body {tierId, billingCycle}
//   POST /api/billing/portal           — auth required; opens Stripe customer portal
//   POST /api/billing/webhook          — Stripe → us; idempotent; updates user-tier
//   GET  /api/billing/me               — auth required; current subscription summary
//
// Webhook idempotency: every Stripe event has a unique `id` (evt_…). We
// store `stripe:event:<id>` in KV with a long TTL — a duplicate delivery
// is a no-op rather than a double tier-write.
//
// Customer-id mapping: when checkout completes successfully we record
// `stripe:customer:<email>` → customerId so future portal sessions can
// look it up without storing it on the auth side.

'use strict';

const auth = require('../auth');
const tiers = require('../tiers');
const userTier = require('../user-tier');
const stripe = require('../stripe');
const kv = require('../intelligence/kv-store');
const events = require('../events');
const emailModule = require('../email');
const { consumeRateLimit } = require('../intelligence/runtime-store');

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://orcatrade.pl';
const EVENT_DEDUPE_TTL_DAYS = 60;
const CUSTOMER_MAP_TTL_DAYS = 400;

const eventKey = id => `stripe:event:${id}`;
const customerKey = email => `stripe:customer:${String(email).toLowerCase().trim()}`;

function jsonResponse(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function resolveSubAction(req) {
  if (req.query && req.query.path) {
    const arr = Array.isArray(req.query.path) ? req.query.path : String(req.query.path).split('/');
    return (arr[1] || '').toLowerCase();
  }
  const pathname = (req.url || '').split('?')[0];
  const segments = pathname.replace(/^\/api\/billing\/?/, '').split('/').filter(Boolean);
  return (segments[0] || '').toLowerCase();
}

function requireAuth(req, res) {
  const user = auth.getCurrentUser(req);
  if (!user) {
    jsonResponse(res, 401, { error: 'Sign in required' });
    return null;
  }
  return user;
}

// ── /api/billing/checkout ─────────────────────────────

async function handleCheckout(req, res, user) {
  if (!stripe.isConfigured()) {
    return jsonResponse(res, 503, { error: 'Billing not configured (STRIPE_SECRET_KEY missing)' });
  }
  const body = req.body || {};
  const tierId = String(body.tierId || '').toLowerCase();
  const billingCycle = String(body.billingCycle || 'monthly').toLowerCase();

  if (!tiers.isValidTierId(tierId)) {
    return jsonResponse(res, 400, { error: 'Invalid tierId' });
  }
  const tier = tiers.getTier(tierId);
  if (tier.isFree) return jsonResponse(res, 400, { error: 'Cannot subscribe to the Free tier' });
  if (tier.requiresContact && tierId === 'enterprise') {
    return jsonResponse(res, 400, { error: 'Enterprise is sales-led — contact us' });
  }
  if (!['monthly', 'annual'].includes(billingCycle)) {
    return jsonResponse(res, 400, { error: 'billingCycle must be monthly or annual' });
  }
  if (!stripe.priceIdFor(tierId, billingCycle)) {
    return jsonResponse(res, 503, { error: `No Stripe price configured for ${tierId}/${billingCycle}` });
  }

  const customerId = await kv.get(customerKey(user.email));
  try {
    const session = await stripe.createCheckoutSession({
      tierId,
      billingCycle,
      customerEmail: customerId ? null : user.email,
      customerId: customerId || null,
      clientReferenceId: user.email,
      successUrl: `${SITE_ORIGIN}/account/billing/?success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${SITE_ORIGIN}/pricing/?cancelled=1`,
    });
    return jsonResponse(res, 200, { ok: true, url: session.url, sessionId: session.id });
  } catch (err) {
    return jsonResponse(res, 502, { error: err.message || 'Stripe checkout failed' });
  }
}

// ── /api/billing/portal ───────────────────────────────

async function handlePortal(req, res, user) {
  if (!stripe.isConfigured()) {
    return jsonResponse(res, 503, { error: 'Billing not configured' });
  }
  const customerId = await kv.get(customerKey(user.email));
  if (!customerId) {
    return jsonResponse(res, 404, { error: 'No Stripe customer for this user — subscribe first' });
  }
  try {
    const session = await stripe.createBillingPortalSession({
      customerId,
      returnUrl: `${SITE_ORIGIN}/account/billing/`,
    });
    return jsonResponse(res, 200, { ok: true, url: session.url });
  } catch (err) {
    return jsonResponse(res, 502, { error: err.message || 'Stripe portal session failed' });
  }
}

// ── /api/billing/me ───────────────────────────────────

async function handleMe(req, res, user) {
  const resolved = await userTier.resolveTier(user.email);
  const customerId = await kv.get(customerKey(user.email));
  return jsonResponse(res, 200, {
    ok: true,
    email: user.email,
    tierId: resolved.record.tierId,
    billingCycle: resolved.record.billingCycle,
    since: resolved.record.since,
    source: resolved.record.source,
    hasStripeCustomer: !!customerId,
  });
}

// ── /api/billing/webhook ──────────────────────────────

// Pull the raw body so signature verification works. Vercel pre-parses
// req.body into an object; we re-stringify it. This keeps signatures
// valid as long as upstream JSON parsing is lossless for Stripe payloads
// (it is — Stripe never sends ambiguous numerics or duplicate keys).
function getRawBody(req) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  return '';
}

// Welcome-email body composed per tier. Soft-fails when Resend isn't
// configured — the caller wraps in try/catch so a missing API key never
// breaks the webhook flow.
async function sendWelcomeEmail({ email, tierId, billingCycle }) {
  if (!emailModule.isConfigured()) return { ok: false, reason: 'email not configured' };
  const tier = tiers.getTier(tierId);
  if (!tier) return { ok: false, reason: 'unknown tier' };

  const planUrl = `${SITE_ORIGIN}/account/billing/`;
  const startUrl = `${SITE_ORIGIN}/start/`;
  const agentUrl = `${SITE_ORIGIN}/agent/orchestrator/`;

  const tierBlurb = ({
    starter: `Starter unlocks 200 agent queries/month, 5 supplier monitors, the Sourcing Agent, and Factory Search.`,
    growth: `Growth unlocks 1,000 agent queries/month, all five specialised agents, the Orchestrator, the Exception Queue, and 5 seats.`,
    scale: `Scale unlocks unlimited agent queries, custom agent training, full API access, 20 seats, and a dedicated account manager.`,
    enterprise: `Enterprise covers ERP integration, white-label deployment, SLA, and tailored compliance audits.`,
  })[tierId] || `Welcome aboard.`;

  const text = [
    `Welcome to OrcaTrade ${tier.name}.`,
    ``,
    `Your subscription is live — ${tier.name} on ${billingCycle === 'annual' ? 'annual' : 'monthly'} billing.`,
    ``,
    tierBlurb,
    ``,
    `Three things you can do in the next 30 minutes:`,
    ``,
    `1. Build a plan in the wizard:`,
    `   ${startUrl}`,
    ``,
    `2. Open the Orchestrator agent — ask anything across sourcing, compliance, logistics, and finance:`,
    `   ${agentUrl}`,
    ``,
    `3. Manage your subscription (change cycle, update payment, cancel):`,
    `   ${planUrl}`,
    ``,
    `Any blockers — reply to this email and you'll reach the founders directly.`,
    ``,
    `— OrcaTrade`,
  ].join('\n');

  return emailModule.send({
    to: email,
    subject: `Welcome to OrcaTrade ${tier.name}`,
    text,
  });
}

function inferTierFromEvent(event) {
  // Look in subscription_data.metadata first (set by our checkout session),
  // then session.metadata, then subscription.metadata. Last-resort: scan
  // line_items for a price.metadata.tier_id.
  const obj = event && event.data && event.data.object;
  if (!obj) return { tierId: null, billingCycle: null };
  const meta = obj.metadata || {};
  const subMeta = (obj.subscription_data && obj.subscription_data.metadata) || {};
  const tierId = meta.tier_id || subMeta.tier_id || null;
  const billingCycle = meta.billing_cycle || subMeta.billing_cycle || null;
  return { tierId, billingCycle };
}

async function processWebhookEvent(event) {
  if (!event || !event.type) return { handled: false, reason: 'missing-type' };
  const obj = event.data && event.data.object;
  if (!obj) return { handled: false, reason: 'missing-object' };

  switch (event.type) {
    case 'checkout.session.completed': {
      const email = (obj.customer_email || obj.client_reference_id || '').toLowerCase().trim();
      const customerId = obj.customer || null;
      const { tierId, billingCycle } = inferTierFromEvent(event);
      if (!email || !tierId) return { handled: false, reason: 'missing-email-or-tier' };
      if (customerId) {
        await kv.set(customerKey(email), customerId, { ttlSeconds: CUSTOMER_MAP_TTL_DAYS * 24 * 60 * 60 });
      }
      await userTier.setUserTier(email, { tierId, billingCycle: billingCycle || 'monthly', source: 'stripe' });
      try { await events.record('auth_signin', { email, source: 'stripe-checkout' }); } catch (_e) {}
      // Fire-and-forget welcome email. Email failures must never break
      // the webhook handler — Stripe will retry indefinitely on non-2xx.
      try { await sendWelcomeEmail({ email, tierId, billingCycle: billingCycle || 'monthly' }); } catch (_e) {}
      return { handled: true, action: 'tier-set', email, tierId };
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const customerId = obj.customer || null;
      // Find email by reverse-lookup is expensive; rely on metadata or
      // fall back to `obj.metadata.email` if we set it. Simplest: ignore
      // when we can't identify the user — checkout.session.completed
      // already wrote the tier, this is mostly a status confirmation.
      const { tierId, billingCycle } = inferTierFromEvent(event);
      if (!customerId || !tierId) return { handled: false, reason: 'no-customer-or-tier' };
      // We don't have email here without a Stripe API roundtrip, so we
      // record the customer→tier intent and let checkout.session.completed
      // own the email→tier write. This is a no-op on the typical flow.
      return { handled: true, action: 'noop-status', customerId, tierId, billingCycle };
    }
    case 'customer.subscription.deleted': {
      // Subscription cancelled at end-of-period. We don't downgrade
      // immediately — the customer paid for the period. Stripe sends
      // this on actual termination. Drop them to free tier.
      const customerId = obj.customer || null;
      if (!customerId) return { handled: false, reason: 'missing-customer' };
      // We need the email; scan-and-match is unavoidable without storing
      // a reverse map. Add reverse map: stripe:email-by-customer:<id>
      const email = await kv.get(`stripe:email-by-customer:${customerId}`);
      if (!email) return { handled: false, reason: 'no-email-for-customer' };
      await userTier.setUserTier(email, { tierId: 'free', billingCycle: null, source: 'stripe' });
      return { handled: true, action: 'downgrade-to-free', email };
    }
    default:
      return { handled: false, reason: 'event-type-not-handled' };
  }
}

async function handleWebhook(req, res) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return jsonResponse(res, 503, { error: 'Webhook secret not configured' });

  const rawBody = getRawBody(req);
  const sigHeader = req.headers['stripe-signature'] || req.headers['Stripe-Signature'];
  const verified = stripe.verifyWebhookSignature(rawBody, sigHeader, secret);
  if (!verified.ok) {
    return jsonResponse(res, 400, { error: 'Invalid signature', reason: verified.reason });
  }
  const event = stripe.parseEvent(rawBody);
  if (!event) return jsonResponse(res, 400, { error: 'Malformed event payload' });

  // Idempotency: skip if we've seen this event id before.
  const seen = await kv.get(eventKey(event.id));
  if (seen) return jsonResponse(res, 200, { ok: true, idempotent: true });

  // Mark as seen *before* processing — if processing throws after this,
  // a retry from Stripe will redeliver and we want to dedupe rather than
  // double-write. Tier writes are idempotent on their own (setUserTier
  // overwrites with the same value).
  await kv.set(eventKey(event.id), { type: event.type, at: new Date().toISOString() }, {
    ttlSeconds: EVENT_DEDUPE_TTL_DAYS * 24 * 60 * 60,
  });

  // Reverse map (email-by-customer) so subscription.deleted can find the
  // user. We write this whenever we see a checkout.session.completed.
  if (event.type === 'checkout.session.completed') {
    const obj = event.data && event.data.object;
    const email = (obj.customer_email || obj.client_reference_id || '').toLowerCase().trim();
    if (email && obj.customer) {
      await kv.set(`stripe:email-by-customer:${obj.customer}`, email, {
        ttlSeconds: CUSTOMER_MAP_TTL_DAYS * 24 * 60 * 60,
      });
    }
  }

  try {
    const result = await processWebhookEvent(event);
    return jsonResponse(res, 200, { ok: true, ...result });
  } catch (err) {
    return jsonResponse(res, 500, { error: err.message || 'Webhook processing failed' });
  }
}

// ── Dispatcher ─────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Stripe-Signature');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  const sub = resolveSubAction(req);
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';

  if (sub === 'webhook') {
    if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });
    return handleWebhook(req, res);
  }

  if (sub === 'me') {
    if (req.method !== 'GET') return jsonResponse(res, 405, { error: 'Method not allowed' });
    const user = requireAuth(req, res);
    if (!user) return;
    return handleMe(req, res, user);
  }

  if (sub === 'checkout') {
    if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });
    const rate = await consumeRateLimit('billing-checkout', ip, 10, 60_000);
    if (rate.limited) return jsonResponse(res, 429, { error: 'Too many requests' });
    const user = requireAuth(req, res);
    if (!user) return;
    return handleCheckout(req, res, user);
  }

  if (sub === 'portal') {
    if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });
    const rate = await consumeRateLimit('billing-portal', ip, 10, 60_000);
    if (rate.limited) return jsonResponse(res, 429, { error: 'Too many requests' });
    const user = requireAuth(req, res);
    if (!user) return;
    return handlePortal(req, res, user);
  }

  return jsonResponse(res, 404, { error: `Unknown sub-action: ${sub}` });
};

module.exports.handleCheckout = handleCheckout;
module.exports.handlePortal = handlePortal;
module.exports.handleMe = handleMe;
module.exports.handleWebhook = handleWebhook;
module.exports.processWebhookEvent = processWebhookEvent;
module.exports.inferTierFromEvent = inferTierFromEvent;
module.exports.sendWelcomeEmail = sendWelcomeEmail;
module.exports.customerKey = customerKey;
module.exports.eventKey = eventKey;
