// Stripe REST client (Sprint 41) — zero-dep, serverless-friendly.
//
// We deliberately don't use the `stripe` npm package: keeps cold starts
// fast and avoids the npm dep on Vercel Hobby. Stripe's REST API is
// stable enough that a thin fetch wrapper is more reliable than an SDK
// version pin.
//
// Public API:
//   createCheckoutSession({ tierId, billingCycle, customerEmail, successUrl, cancelUrl })
//   createBillingPortalSession({ customerId, returnUrl })
//   verifyWebhookSignature(rawBody, signatureHeader, secret)  // sync, sig-only
//   parseEvent(rawBody)                                       // JSON.parse + minimal validation
//   priceIdFor(tierId, billingCycle)                          // env-var lookup
//
// Env-var contract:
//   STRIPE_SECRET_KEY            — Bearer for REST calls (sk_test_… or sk_live_…)
//   STRIPE_WEBHOOK_SECRET        — endpoint-secret for HMAC verification
//   STRIPE_PRICE_<TIER>_<CYCLE>  — Stripe price IDs, e.g. STRIPE_PRICE_GROWTH_MONTHLY
//
// Designed to no-op cleanly when keys are missing: handlers return 503,
// tests can stub fetch.

'use strict';

const crypto = require('node:crypto');

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

function isConfigured() {
  return !!process.env.STRIPE_SECRET_KEY;
}

function priceIdFor(tierId, billingCycle) {
  if (!tierId || !billingCycle) return null;
  const envKey = `STRIPE_PRICE_${String(tierId).toUpperCase()}_${String(billingCycle).toUpperCase()}`;
  return process.env[envKey] || null;
}

// Stripe accepts application/x-www-form-urlencoded with PHP-style nested keys
// (eg. line_items[0][price]=…). Our needs are shallow enough that we hand-roll.
function encodeFormBody(obj, prefix = '') {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object') {
          parts.push(encodeFormBody(item, `${key}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof v === 'object') {
      parts.push(encodeFormBody(v, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.filter(Boolean).join('&');
}

async function stripePost(pathname, payload, { idempotencyKey } = {}) {
  if (!isConfigured()) throw new Error('Stripe not configured (STRIPE_SECRET_KEY missing)');
  const headers = {
    Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const response = await fetch(`${STRIPE_API_BASE}${pathname}`, {
    method: 'POST',
    headers,
    body: encodeFormBody(payload),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_e) { /* keep null */ }
  if (!response.ok) {
    const message = (parsed && parsed.error && parsed.error.message) || text || `Stripe ${pathname} failed`;
    const err = new Error(`Stripe ${pathname} ${response.status}: ${message}`);
    err.status = response.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

// ── Checkout / portal ─────────────────────────────────

async function createCheckoutSession({ tierId, billingCycle, customerEmail, successUrl, cancelUrl, customerId = null, clientReferenceId = null, orgId = null }) {
  const priceId = priceIdFor(tierId, billingCycle);
  if (!priceId) throw new Error(`No Stripe price configured for ${tierId}/${billingCycle}`);
  const payload = {
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': 1,
    'metadata[tier_id]': tierId,
    'metadata[billing_cycle]': billingCycle,
    'subscription_data[metadata][tier_id]': tierId,
    'subscription_data[metadata][billing_cycle]': billingCycle,
    allow_promotion_codes: 'true',
    billing_address_collection: 'auto',
    automatic_tax: { enabled: 'true' },
  };
  // Sprint BG-3.3 phase 2 — when the subscriber belongs to an org we
  // persist org_id in BOTH the session metadata AND the subscription
  // metadata. The session copy lets the checkout.session.completed
  // event identify which org gets upgraded; the subscription copy
  // travels with the subscription forever, so the
  // customer.subscription.deleted event at period-end cancellation
  // can also identify the org to downgrade — even if the user's org
  // memberships have changed in the meantime.
  if (orgId) {
    payload['metadata[org_id]'] = orgId;
    payload['subscription_data[metadata][org_id]'] = orgId;
  }
  if (customerEmail) payload.customer_email = customerEmail;
  if (customerId) payload.customer = customerId;
  if (clientReferenceId) payload.client_reference_id = clientReferenceId;
  return stripePost('/checkout/sessions', payload, { idempotencyKey: 'checkout_' + crypto.randomUUID() });
}

async function createBillingPortalSession({ customerId, returnUrl }) {
  if (!customerId) throw new Error('createBillingPortalSession: customerId required');
  return stripePost('/billing_portal/sessions', {
    customer: customerId,
    return_url: returnUrl,
  });
}

// ── Webhook signature verification ────────────────────

// Stripe-Signature header looks like: "t=1614170000,v1=<hex>,v0=<hex>"
function parseSignatureHeader(header) {
  const out = { t: null, v1: [] };
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(',')) {
    const [k, v] = part.split('=');
    if (k === 't') out.t = Number(v);
    else if (k === 'v1' && v) out.v1.push(v);
  }
  return out;
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function verifyWebhookSignature(rawBody, signatureHeader, secret, { tolerance = SIGNATURE_TOLERANCE_SECONDS, now = Math.floor(Date.now() / 1000) } = {}) {
  if (!secret) return { ok: false, reason: 'no-secret' };
  if (!signatureHeader) return { ok: false, reason: 'no-header' };
  if (!rawBody) return { ok: false, reason: 'no-body' };
  const { t, v1 } = parseSignatureHeader(signatureHeader);
  if (!t || !v1.length) return { ok: false, reason: 'malformed-header' };
  if (Math.abs(now - t) > tolerance) return { ok: false, reason: 'timestamp-out-of-tolerance' };
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  for (const sig of v1) {
    if (constantTimeEqual(expected, sig)) return { ok: true, t };
  }
  return { ok: false, reason: 'signature-mismatch' };
}

// Helper: produce a valid Stripe-Signature header (used by tests).
function buildSignatureHeader(rawBody, secret, { t = Math.floor(Date.now() / 1000) } = {}) {
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${sig}`;
}

function parseEvent(rawBody) {
  if (!rawBody) return null;
  try {
    const event = JSON.parse(rawBody);
    if (!event || typeof event !== 'object' || !event.id || !event.type) return null;
    return event;
  } catch (_err) {
    return null;
  }
}

module.exports = {
  STRIPE_API_BASE,
  SIGNATURE_TOLERANCE_SECONDS,
  isConfigured,
  priceIdFor,
  encodeFormBody,
  createCheckoutSession,
  createBillingPortalSession,
  verifyWebhookSignature,
  buildSignatureHeader,
  parseSignatureHeader,
  parseEvent,
};
