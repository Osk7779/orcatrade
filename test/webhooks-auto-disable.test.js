'use strict';

// Sprint 51 — webhook auto-disable + reactivation.
//
// Sprint 50 ships retry-with-backoff, but a permanently broken
// endpoint keeps every retry cycle eating budget + log noise.
// Sprint 51 closes the loop: after N=5 consecutive abandoned
// deliveries (each = 5 failed attempts spanning ~9h35m), the
// subscription auto-disables (active=false). A success along the
// way resets the counter. Admins reactivate via a new endpoint
// after investigating their receiver.
//
// Tests cover four layers:
//   1. Constants + subscription metadata: AUTO_DISABLE_THRESHOLD=5;
//      createWebhook seeds the new bookkeeping fields
//   2. bumpAbandonmentCounter: increments; flips active=false +
//      populates autoDisabledAt/Reason at the threshold;
//      idempotent on already-disabled
//   3. resetAbandonmentCounter: resets to 0 on success; does NOT
//      un-disable a currently auto-disabled sub (requires explicit
//      reactivation)
//   4. reactivateWebhook + handler + UI:
//      - Cross-org isolated (404 on foreign org)
//      - Idempotent on already-active sub (noOp:true)
//      - Audit-log-before-success (ADR-0005), skipped on noOp
//      - Dispatch retry-flush path fires the auto-disable audit
//        event when the threshold trips
//      - UI surfaces auto-disabled banner + Reactivate button

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const webhooks = require('../lib/webhooks');
const dispatch = require('../lib/webhooks-dispatch');
const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');
const HELPER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'webhooks.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'webhooks.js'), 'utf8');
const DISPATCH_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'webhooks-dispatch.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

function withInMemoryKv(fn) {
  const kv = require('../lib/intelligence/kv-store');
  const store = new Map();
  const originalGet = kv.get;
  const originalSet = kv.set;
  const originalDel = kv.del;
  kv.get = async (k) => store.get(k);
  kv.set = async (k, v) => { store.set(k, v); };
  kv.del = async (k) => { store.delete(k); };
  return Promise.resolve()
    .then(() => fn(store))
    .finally(() => {
      kv.get = originalGet;
      kv.set = originalSet;
      kv.del = originalDel;
    });
}

// ── Constants + metadata ──────────────────────────────────────────

test('AUTO_DISABLE_THRESHOLD = 5 (after 5 abandoned deliveries, flip active=false)', () => {
  // 5 abandonments × ~9h35m worst-case = ~48h; in practice
  // failures cluster (deploy-broke-the-receiver) so auto-disable
  // typically fires within a single business day.
  assert.equal(webhooks.AUTO_DISABLE_THRESHOLD, 5);
});

test('createWebhook seeds consecutiveAbandonments=0 + null bookkeeping fields', () => {
  return withInMemoryKv(async () => {
    const r = await webhooks.createWebhook({
      orgIdNumeric: 42, label: 'k',
      url: 'https://example.com/hook',
      eventTypes: ['import_request_created'],
    });
    assert.equal(r.subscription.consecutiveAbandonments, 0);
    assert.equal(r.subscription.autoDisabledAt, null);
    assert.equal(r.subscription.autoDisabledReason, null);
    assert.equal(r.subscription.active, true);
  });
});

// ── bumpAbandonmentCounter ─────────────────────────────────────────

test('bumpAbandonmentCounter increments below the threshold (no disable yet)', () => {
  return withInMemoryKv(async (store) => {
    const c = await webhooks.createWebhook({
      orgIdNumeric: 42, label: 'k',
      url: 'https://example.com/hook',
      eventTypes: ['import_request_created'],
    });
    const r = await webhooks.bumpAbandonmentCounter({
      subId: c.subscription.id, lastError: 'first failure',
    });
    assert.equal(r.ok, true);
    assert.equal(r.autoDisabled, false);
    assert.equal(r.subscription.consecutiveAbandonments, 1);
    assert.equal(r.subscription.active, true);
    const stored = store.get(`webhook:sub:${c.subscription.id}`);
    assert.equal(stored.consecutiveAbandonments, 1);
    assert.equal(stored.autoDisabledAt, null);
  });
});

test('bumpAbandonmentCounter flips active=false at AUTO_DISABLE_THRESHOLD with reason populated', () => {
  return withInMemoryKv(async (store) => {
    const c = await webhooks.createWebhook({
      orgIdNumeric: 42, label: 'doomed',
      url: 'https://example.com/hook',
      eventTypes: ['import_request_created'],
    });
    // Push to threshold-1.
    for (let i = 0; i < webhooks.AUTO_DISABLE_THRESHOLD - 1; i += 1) {
      await webhooks.bumpAbandonmentCounter({ subId: c.subscription.id, lastError: `err ${i}` });
    }
    // One more crosses the threshold.
    const r = await webhooks.bumpAbandonmentCounter({
      subId: c.subscription.id, lastError: 'final straw',
    });
    assert.equal(r.ok, true);
    assert.equal(r.autoDisabled, true);
    assert.equal(r.subscription.active, false);
    assert.ok(r.subscription.autoDisabledAt);
    assert.match(r.subscription.autoDisabledReason, /5 consecutive abandonments/);
    assert.match(r.subscription.autoDisabledReason, /final straw/);
    // KV reflects the state.
    const stored = store.get(`webhook:sub:${c.subscription.id}`);
    assert.equal(stored.active, false);
  });
});

test('bumpAbandonmentCounter is idempotent on an already-auto-disabled subscription (noOp)', () => {
  return withInMemoryKv(async () => {
    const c = await webhooks.createWebhook({
      orgIdNumeric: 42, label: 'already-dead',
      url: 'https://example.com/hook',
      eventTypes: ['import_request_created'],
    });
    // Force-disable.
    for (let i = 0; i < webhooks.AUTO_DISABLE_THRESHOLD; i += 1) {
      await webhooks.bumpAbandonmentCounter({ subId: c.subscription.id, lastError: 'x' });
    }
    // Another bump after disable.
    const r = await webhooks.bumpAbandonmentCounter({
      subId: c.subscription.id, lastError: 'still failing',
    });
    assert.equal(r.ok, true);
    assert.equal(r.autoDisabled, true);
    assert.equal(r.noOp, true);
    // Counter stayed at the tripped value (didn't go to 6).
    assert.equal(r.subscription.consecutiveAbandonments, webhooks.AUTO_DISABLE_THRESHOLD);
  });
});

// ── resetAbandonmentCounter ────────────────────────────────────────

test('resetAbandonmentCounter wipes the counter on success', () => {
  return withInMemoryKv(async () => {
    const c = await webhooks.createWebhook({
      orgIdNumeric: 42, label: 'k',
      url: 'https://example.com/hook',
      eventTypes: ['import_request_created'],
    });
    await webhooks.bumpAbandonmentCounter({ subId: c.subscription.id, lastError: 'x' });
    await webhooks.bumpAbandonmentCounter({ subId: c.subscription.id, lastError: 'y' });
    const r = await webhooks.resetAbandonmentCounter(c.subscription.id);
    assert.equal(r.ok, true);
  });
});

test('resetAbandonmentCounter does NOT un-disable a currently auto-disabled sub', () => {
  // Critical invariant — reactivation requires explicit admin
  // action (not just a single successful retry on a different
  // event). Pin the source path.
  const body = HELPER_SRC.match(/async function resetAbandonmentCounter\([\s\S]*?\n\}/);
  assert.ok(body, 'resetAbandonmentCounter body not located');
  // The updated state explicitly omits autoDisabledAt — it's not
  // touched, leaving any disable in place.
  assert.match(body[0], /consecutiveAbandonments: 0/);
  // No assignment of active or autoDisabledAt to "true"/null —
  // those stay at their stored values.
  assert.ok(!/active: true/.test(body[0]), 'resetAbandonmentCounter must NOT un-disable');
});

// ── reactivateWebhook ──────────────────────────────────────────────

test('reactivateWebhook is cross-org isolated (notFound shape on foreign org)', () => {
  return withInMemoryKv(async () => {
    const c = await webhooks.createWebhook({
      orgIdNumeric: 42, label: 'k',
      url: 'https://example.com/hook',
      eventTypes: ['import_request_created'],
    });
    const r = await webhooks.reactivateWebhook({
      orgIdNumeric: 999, id: c.subscription.id,
    });
    assert.equal(r.ok, false);
    assert.equal(r.notFound, true);
  });
});

test('reactivateWebhook is idempotent (noOp:true on an already-active subscription)', () => {
  return withInMemoryKv(async () => {
    const c = await webhooks.createWebhook({
      orgIdNumeric: 42, label: 'k',
      url: 'https://example.com/hook',
      eventTypes: ['import_request_created'],
    });
    const r = await webhooks.reactivateWebhook({
      orgIdNumeric: 42, id: c.subscription.id, actorEmailHash: 'h',
    });
    assert.equal(r.ok, true);
    assert.equal(r.noOp, true);
  });
});

test('reactivateWebhook flips active=true + resets counter + clears autoDisabledAt/Reason', () => {
  return withInMemoryKv(async (store) => {
    const c = await webhooks.createWebhook({
      orgIdNumeric: 42, label: 'k',
      url: 'https://example.com/hook',
      eventTypes: ['import_request_created'],
    });
    // Force-disable.
    for (let i = 0; i < webhooks.AUTO_DISABLE_THRESHOLD; i += 1) {
      await webhooks.bumpAbandonmentCounter({ subId: c.subscription.id, lastError: 'x' });
    }
    const r = await webhooks.reactivateWebhook({
      orgIdNumeric: 42, id: c.subscription.id, actorEmailHash: 'admin_hash',
    });
    assert.equal(r.ok, true);
    assert.equal(r.subscription.active, true);
    assert.equal(r.subscription.consecutiveAbandonments, 0);
    assert.equal(r.subscription.autoDisabledAt, null);
    assert.equal(r.subscription.autoDisabledReason, null);
    assert.ok(r.subscription.reactivatedAt);
    assert.equal(r.subscription.reactivatedByEmailHash, 'admin_hash');
    // KV reflects.
    const stored = store.get(`webhook:sub:${c.subscription.id}`);
    assert.equal(stored.active, true);
  });
});

// ── Dispatch integration ──────────────────────────────────────────

test('Dispatch success path resets the per-sub abandonment counter', () => {
  // Source-pin: on the !ok branch we call bumpAbandonmentCounter;
  // on the .ok branch we call resetAbandonmentCounter.
  assert.match(DISPATCH_SRC, /webhooks\.resetAbandonmentCounter\(r\.subId\)/);
});

test('Dispatch retry-flush ABANDONED path fires the webhook_subscription_auto_disabled audit event', () => {
  // Drift-guard against a refactor that bumps the counter but
  // skips the audit write — admins reviewing the chain need to
  // see WHEN + WHY the sub got auto-disabled.
  assert.match(
    DISPATCH_SRC,
    /bump\.autoDisabled && !bump\.noOp[\s\S]*?events\.record\(['"]webhook_subscription_auto_disabled['"]/,
  );
});

test('events.ALLOWED_TYPES includes auto_disabled + reactivated lifecycle types', () => {
  assert.ok(events.ALLOWED_TYPES.has('webhook_subscription_auto_disabled'));
  assert.ok(events.ALLOWED_TYPES.has('webhook_subscription_reactivated'));
});

// ── Handler ────────────────────────────────────────────────────────

test('Handler routes POST /api/webhooks/<id>/reactivate → handleReactivate', () => {
  assert.match(HANDLER_SRC, /second === ['"]reactivate['"]/);
  assert.match(HANDLER_SRC, /handleReactivate\(req, res, ctx, first\)/);
  assert.match(HANDLER_SRC, /reactivate requires POST/);
});

test('Handler handleReactivate writes webhook_subscription_reactivated audit BEFORE 200 (ADR-0005)', () => {
  const block = HANDLER_SRC.match(/async function handleReactivate\([\s\S]*?\n\}/);
  assert.ok(block, 'handleReactivate body not located');
  const body = block[0];
  assert.match(body, /events\.record\(['"]webhook_subscription_reactivated['"]/);
  assert.match(body, /Could not record audit event for webhook reactivate/);
  assert.match(body, /jsonResponse\(res, 500/);
});

test('Handler handleReactivate skips the audit write on noOp (already-active sub)', () => {
  // Without the noOp gate, a retry-safe reactivate call would
  // spam the chain with duplicate "reactivated" events. Pin the
  // gate AND the if-not-noOp wrapping.
  const block = HANDLER_SRC.match(/async function handleReactivate\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /if \(!result\.noOp\) \{[\s\S]*?events\.record\(['"]webhook_subscription_reactivated['"]/);
});

test('Handler handleReactivate strips the secret from the response', () => {
  // Same posture as the list endpoint — secret is one-time-reveal
  // material, never echoed outside create.
  const block = HANDLER_SRC.match(/async function handleReactivate\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /const \{ secret: _omit, \.\.\.safe \} = result\.subscription/);
});

// ── TS mirror ──────────────────────────────────────────────────────

test('TS WebhookSubscription carries the sprint-51 auto-disable bookkeeping fields', () => {
  assert.match(API_TS, /consecutiveAbandonments\?: number;[\s\S]*?autoDisabledAt\?: string \| null;[\s\S]*?autoDisabledReason\?: string \| null;[\s\S]*?reactivatedAt\?: string \| null;/);
});

test('TS WebhookReactivateResponse interface defined', () => {
  assert.match(API_TS, /export interface WebhookReactivateResponse \{[\s\S]*?subscription: WebhookSubscription;[\s\S]*?noOp\?: boolean;[\s\S]*?\}/);
});

// ── UI ─────────────────────────────────────────────────────────────

test('WebhooksPanel surfaces the Auto-disabled banner ONLY when s.autoDisabledAt is set', () => {
  // Healthy subs show no banner. Pin the conditional + the
  // visible "Auto-disabled" label + the reason copy.
  const block = INSIGHTS_TSX.match(/function WebhooksPanel\(\)[\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block, 'WebhooksPanel body not located');
  const body = block[0];
  assert.match(body, /\{s\.autoDisabledAt && \(/);
  assert.match(body, /Auto-disabled/);
  assert.match(body, /\{s\.autoDisabledReason \|\| 'Repeated delivery failures\./);
});

test('WebhooksPanel Reactivate button POSTs to /api/webhooks/<id>/reactivate', () => {
  const block = INSIGHTS_TSX.match(/function WebhooksPanel\(\)[\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  assert.match(
    block[0],
    /apiPost<WebhookReactivateResponse>\(`\/api\/webhooks\/\$\{encodeURIComponent\(id\)\}\/reactivate`/,
  );
});
