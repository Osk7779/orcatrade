// Sprint 48 — production webhook firing.
//
// Sprint 47 shipped the management surface + /test endpoint;
// sprint 48 wires SUBSCRIPTIONS into the live event stream so a
// lifecycle event (`import_request_status_transition`,
// `_message_posted`, etc.) automatically POSTs to every subscriber
// that asked for it.
//
// Architecture:
//   - events.record(type, payload) calls dispatchEvent in the
//     background (Promise.resolve().then(...).catch swallow)
//   - dispatchEvent looks up the org's subscriptions, filters by
//     eventTypes, fans out via Promise.all so one slow customer
//     endpoint can't block another
//   - Per-delivery KV log entry (`webhook:delivery:<id>`) with
//     7-day TTL — observable history for ops + a future
//     /deliveries surface
//   - Each subscription's lastDeliveryAt + lastDeliveryStatus is
//     updated so the UI reflects current health without a refresh
//
// What this v1 does NOT do (sprint 49+):
//   - Retry queue. A failed delivery records `ok:false` in the log
//     + status on the subscription; nothing re-fires. Customers
//     missing a delivery use the cohort cards to reconcile.
//   - Per-event ordering guarantees. Promise.all parallelises
//     deliveries; subscribers seeing two events arrive out-of-order
//     MUST use the `event.at` timestamp.
//   - DNS rebinding mitigation (resolve + re-check at delivery
//     time). Sprint 47's URL-time gate stays the SSRF defence.

'use strict';

const crypto = require('crypto');
const kv = require('./intelligence/kv-store');
const webhooks = require('./webhooks');
const log = require('./log');

const DELIVERY_PREFIX = 'webhook:delivery:';
const DELIVERY_INDEX_PREFIX = 'webhook:delivery-index:';
const DELIVERY_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const DELIVERY_INDEX_CAP = 100;  // newest-first, oldest dropped
const DELIVERY_TIMEOUT_MS = 5_000;

function generateDeliveryId() {
  return 'del_' + crypto.randomBytes(8).toString('hex');
}

// Project the recorded event into the public webhook envelope.
// Internal chain-stamp fields (_seq, _hash, _prevHash) are STRIPPED
// — they're tamper-detection metadata, not customer content.
// `email` is also stripped if present (the actor identity is the
// hashed form, never raw PII).
function projectEvent(event) {
  if (!event || typeof event !== 'object') return event;
  const { _seq, _hash, _prevHash, email, ...keep } = event;
  return keep;
}

// Build the JSON envelope sent to the subscriber. Versioned ("v":
// 1) so a future contract change can be additive — subscribers
// pinning to v:1 keep working. deliveryId is included so a
// receiver building idempotency keys has a stable identifier.
function buildEnvelope({ event, subscription, deliveryId, nowIso }) {
  return {
    v: 1,
    type: event.type,
    deliveryId,
    deliveredAt: nowIso,
    subscriptionId: subscription.id,
    event: projectEvent(event),
  };
}

// One subscription's delivery. Signs, POSTs, captures result, never
// throws — all failure modes (timeout, network, non-2xx) surface as
// the returned object's `ok: false`. The caller (dispatchEvent)
// fans out via Promise.all + uses these results to write the log +
// update the subscription state.
async function deliverEvent({ subscription, event, nowMs, fetchImpl }) {
  const deliveryId = generateDeliveryId();
  const nowIso = new Date(typeof nowMs === 'number' ? nowMs : Date.now()).toISOString();
  const envelope = buildEnvelope({ event, subscription, deliveryId, nowIso });
  const body = JSON.stringify(envelope);
  const signature = webhooks.signPayload(subscription.secret, body);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  const startMs = Date.now();
  let ok = false;
  let status = 0;
  let error = null;
  let timedOut = false;
  const doFetch = fetchImpl || fetch;
  try {
    const response = await doFetch(subscription.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'OrcaTrade-Webhook/1.0',
        'X-OrcaTrade-Signature': signature,
        'X-OrcaTrade-Event': event.type,
        'X-OrcaTrade-Subscription': subscription.id,
        'X-OrcaTrade-Delivery': deliveryId,
      },
      body,
      signal: controller.signal,
    });
    status = response.status;
    ok = response.ok;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      timedOut = true;
      error = `timeout (>${DELIVERY_TIMEOUT_MS / 1000}s)`;
    } else {
      error = err instanceof Error ? err.message : String(err);
    }
  } finally {
    clearTimeout(timeoutId);
  }
  const durationMs = Date.now() - startMs;
  return {
    deliveryId,
    subId: subscription.id,
    ok,
    status,
    error,
    timedOut,
    durationMs,
    deliveredAt: nowIso,
  };
}

// Per-delivery KV log entry. TTL'd so a chatty org doesn't fill
// KV. The entry shape mirrors the deliverEvent return so the
// /api/webhooks/<id>/deliveries surface (sprint 49) has a stable
// contract.
//
// Sprint 49 — also pushes the delivery ID to a per-subscription
// index (`webhook:delivery-index:<subId>`) capped at 100 newest-
// first so a chatty subscription doesn't grow the index unbounded.
// The index is what lets listDeliveriesForSubscription iterate
// without a SCAN over the whole webhook:delivery: keyspace.
async function recordDeliveryLog(result, eventType) {
  try {
    await kv.set(
      DELIVERY_PREFIX + result.deliveryId,
      {
        deliveryId: result.deliveryId,
        subscriptionId: result.subId,
        eventType,
        deliveredAt: result.deliveredAt,
        ok: result.ok,
        status: result.status,
        error: result.error,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
      },
      { ttlSeconds: DELIVERY_TTL_SECONDS },
    );
  } catch (_) {
    // KV log write best-effort. The lastDeliveryStatus update on
    // the subscription is more durable signal.
  }
  // Push to the per-subscription delivery index — newest-first +
  // capped. Same read-merge-write race trade-off as the sprint-44
  // api-key org index (acceptable for the single-writer-per-key
  // Upstash model).
  try {
    const indexKey = DELIVERY_INDEX_PREFIX + String(result.subId);
    const existing = (await kv.get(indexKey)) || [];
    const arr = Array.isArray(existing) ? existing : [];
    arr.unshift(result.deliveryId);
    const capped = arr.slice(0, DELIVERY_INDEX_CAP);
    await kv.set(indexKey, capped, { ttlSeconds: DELIVERY_TTL_SECONDS });
  } catch (_) {
    /* index write best-effort */
  }
}

// Sprint 49 — read recent deliveries for one subscription. Reads
// the per-sub index, then each log entry in parallel. Returns
// newest-first (index already maintains that order). Entries that
// have aged out via TTL but are still in the index surface as nulls
// and get filtered — drift-guard pins that.
//
// @param {{ subscriptionId: string, limit?: number }} input
async function listDeliveriesForSubscription({ subscriptionId, limit = 25 }) {
  if (typeof subscriptionId !== 'string' || !subscriptionId) return [];
  const capped = Math.max(1, Math.min(DELIVERY_INDEX_CAP, Number(limit) || 25));
  let ids = [];
  try {
    ids = (await kv.get(DELIVERY_INDEX_PREFIX + subscriptionId)) || [];
    if (!Array.isArray(ids)) ids = [];
  } catch (_) {
    return [];
  }
  const slice = ids.slice(0, capped);
  const entries = await Promise.all(
    slice.map((id) => kv.get(DELIVERY_PREFIX + id).catch(() => null)),
  );
  return entries.filter((e) => e && typeof e === 'object');
}

// Update the subscription's lastDelivery* fields so the UI reflects
// current health without a refresh. Best-effort — KV blip leaves
// the value stale.
async function updateSubscriptionStatus(subscription, result) {
  try {
    const subKey = webhooks.SUB_PREFIX + subscription.id;
    const fresh = await kv.get(subKey);
    if (!fresh || typeof fresh !== 'object') return;
    const statusText = result.ok
      ? `delivered (${result.status})`
      : result.timedOut
        ? `timeout (>${DELIVERY_TIMEOUT_MS / 1000}s)`
        : result.error
          ? `error: ${result.error}`
          : `non-2xx: ${result.status}`;
    await kv.set(subKey, {
      ...fresh,
      lastDeliveryAt: result.deliveredAt,
      lastDeliveryStatus: statusText,
    });
  } catch (_) {
    /* best-effort */
  }
}

// Main entry point. Dispatch a recorded event to every subscriber
// in the org that asked for this event type. Fan-out via Promise.all
// so one slow customer can't block another.
//
// Returns { attempted, succeeded } so the caller (typically
// fire-and-forget from events.record) can log scale. NEVER throws —
// every failure path is captured per-subscription.
//
// @param {{ event: any, fetchImpl?: any, nowMs?: number }} input
async function dispatchEvent({ event, fetchImpl, nowMs }) {
  if (!event || typeof event !== 'object') {
    return { attempted: 0, succeeded: 0, reason: 'no-event' };
  }
  if (!Number.isInteger(event.orgId)) {
    return { attempted: 0, succeeded: 0, reason: 'no-org' };
  }
  if (!webhooks.WEBHOOK_EVENT_TYPES.includes(event.type)) {
    return { attempted: 0, succeeded: 0, reason: 'type-not-dispatched' };
  }
  let ids = [];
  try {
    ids = (await kv.get(webhooks.ORG_INDEX_PREFIX + String(event.orgId))) || [];
    if (!Array.isArray(ids)) ids = [];
  } catch (_) {
    return { attempted: 0, succeeded: 0, reason: 'kv-read-failed' };
  }
  if (ids.length === 0) return { attempted: 0, succeeded: 0 };
  // Read full subscription records (including secret) in parallel.
  const subs = await Promise.all(
    ids.map((id) => kv.get(webhooks.SUB_PREFIX + id).catch(() => null)),
  );
  const matching = subs.filter(
    (s) => s
      && typeof s === 'object'
      && s.active
      && Array.isArray(s.eventTypes)
      && s.eventTypes.includes(event.type),
  );
  if (matching.length === 0) return { attempted: 0, succeeded: 0 };
  const results = await Promise.all(
    matching.map((sub) =>
      deliverEvent({ subscription: sub, event, nowMs, fetchImpl })
        .catch((err) => ({
          deliveryId: 'unknown',
          subId: sub.id,
          ok: false,
          status: 0,
          error: err instanceof Error ? err.message : String(err),
          timedOut: false,
          durationMs: 0,
          deliveredAt: new Date().toISOString(),
        })),
    ),
  );
  // Record log entries + update subscription status. Done in
  // parallel + each best-effort wrapped so one KV blip doesn't lose
  // every result.
  await Promise.all([
    ...results.map((r) => recordDeliveryLog(r, event.type)),
    ...results.map((r) => {
      const sub = matching.find((s) => s.id === r.subId);
      return sub ? updateSubscriptionStatus(sub, r) : Promise.resolve();
    }),
  ]);
  // Sprint 50 — queue failed deliveries for retry. NEW deliveries
  // (no existing retry state) get queueRetry; the cron drain path
  // handles in-flight retries separately. Same fail-soft posture
  // as the audit + lastDeliveryStatus updates above.
  const retry = require('./webhooks-retry');
  await Promise.all(
    results
      .filter((r) => !r.ok)
      .map((r) => retry.queueRetry({
        deliveryId: r.deliveryId,
        subId: r.subId,
        event,
        error: r.error || (r.timedOut ? 'timeout' : `non-2xx: ${r.status}`),
      }).catch(() => null)),
  );
  const succeeded = results.filter((r) => r.ok).length;
  if (succeeded < results.length) {
    log.info('webhook dispatch partial', {
      type: event.type, orgId: event.orgId,
      attempted: results.length, succeeded,
    });
  }
  return { attempted: results.length, succeeded };
}

// Sprint 50 — drain due retries for ONE subscription. Used by the
// webhook-retry-flush cron + by the test path. Reads
// listDueRetriesForSubscription, re-attempts each via deliverEvent
// using the FRESH subscription (so a revoked-since-queued sub is
// dropped), reschedules on failure / clears on success.
//
// Returns { drained, succeeded, abandoned } so the cron can log
// aggregate scale per subscription.
//
// @param {{ subId: string, fetchImpl?: any, nowMs?: number }} input
async function flushRetriesForSubscription({ subId, fetchImpl, nowMs }) {
  const retry = require('./webhooks-retry');
  const dues = await retry.listDueRetriesForSubscription({ subId, nowMs });
  if (dues.length === 0) return { drained: 0, succeeded: 0, abandoned: 0 };
  // Re-fetch the FRESH subscription. A subscription revoked since
  // the retry was queued MUST NOT receive further deliveries — drop
  // the queued retries silently.
  const freshSub = await kv.get(webhooks.SUB_PREFIX + subId).catch(() => null);
  if (!freshSub || !freshSub.active) {
    await Promise.all(dues.map((d) => retry.clearRetry({ deliveryId: d.deliveryId, subId })));
    return { drained: dues.length, succeeded: 0, abandoned: 0, dropped: dues.length };
  }
  let succeeded = 0;
  let abandoned = 0;
  for (const due of dues) {
    const result = await deliverEvent({
      subscription: freshSub,
      event: due.event,
      nowMs,
      fetchImpl,
    }).catch((err) => ({
      ok: false, status: 0,
      error: err instanceof Error ? err.message : String(err),
      timedOut: false, durationMs: 0,
      deliveredAt: new Date().toISOString(),
    }));
    // Log the attempt + update lastDelivery* like fresh dispatches.
    await recordDeliveryLog(
      { ...result, deliveryId: due.deliveryId, subId },
      due.event.type,
    );
    await updateSubscriptionStatus(freshSub, { ...result, subId });
    if (result.ok) {
      await retry.clearRetry({ deliveryId: due.deliveryId, subId });
      succeeded += 1;
    } else {
      const reschedule = await retry.rescheduleAfterFailure({
        deliveryId: due.deliveryId,
        subId,
        error: result.error || (result.timedOut ? 'timeout' : `non-2xx: ${result.status}`),
        nowMs,
      });
      if (reschedule.abandoned) abandoned += 1;
    }
  }
  return { drained: dues.length, succeeded, abandoned };
}

module.exports = {
  DELIVERY_PREFIX,
  DELIVERY_INDEX_PREFIX,
  DELIVERY_TTL_SECONDS,
  DELIVERY_INDEX_CAP,
  DELIVERY_TIMEOUT_MS,
  generateDeliveryId,
  projectEvent,
  buildEnvelope,
  deliverEvent,
  recordDeliveryLog,
  updateSubscriptionStatus,
  dispatchEvent,
  listDeliveriesForSubscription,
  flushRetriesForSubscription,
};
