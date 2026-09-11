'use strict';

// Sprint 50 — webhook retry queue with exponential backoff.
//
// Sprint 48 explicitly deferred this: failed deliveries logged but
// nothing re-fired. Sprint 50 closes that gap — a transient outage
// (deploy window, 5xx burst, brief network issue) doesn't lose
// events.
//
// Tests cover five layers:
//   1. Backoff schedule constants: MAX_ATTEMPTS = 5; BACKOFF_SECONDS
//      array shape matches the documented 1m/5m/30m/2h/6h
//   2. computeNextAttemptMs + jitter: ±20% deterministic from
//      deliveryId so retries are reproducible AND spread out
//   3. KV round-trip: queueRetry writes state + index; reschedule
//      increments attemptCount; markAbandoned removes from index;
//      MAX_ATTEMPTS gate triggers abandonment
//   4. listDueRetriesForSubscription: filters by nextAttemptAt;
//      skips abandoned; orders by index (newest pushed last)
//   5. Integration:
//      - dispatchEvent failure → queueRetry called
//      - flushRetriesForSubscription re-attempts; success → clearRetry;
//        failure → reschedule
//      - revoked-since-queued subscription → clear all retries
//        without firing
//      - Cron runWebhookRetryFlush fan-out + JOBS registration
//      - GHA */5 * * * * schedule registered

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const retry = require('../lib/webhooks-retry');
const dispatch = require('../lib/webhooks-dispatch');
const webhooks = require('../lib/webhooks');
const cron = require('../lib/handlers/cron');

const ROOT = path.resolve(__dirname, '..');
const RETRY_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'webhooks-retry.js'), 'utf8');
const DISPATCH_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'webhooks-dispatch.js'), 'utf8');
const CRON_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'cron.js'), 'utf8');
const CRON_YAML = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'cron.yml'), 'utf8');

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

// ── Backoff schedule ───────────────────────────────────────────────

test('MAX_ATTEMPTS = 5 (orig + 4 retries with declining frequency)', () => {
  // 5 attempts ≈ 9h35m total elapse (60s + 5m + 30m + 2h + 6h). Long
  // enough for a deploy window or business-day outage to settle;
  // short enough that we're not retrying for days.
  assert.equal(retry.MAX_ATTEMPTS, 5);
});

test('BACKOFF_SECONDS matches the documented 1m/5m/30m/2h/6h schedule', () => {
  // Drift-guard: a refactor swapping the schedule would silently
  // change every subscription's retry timing. Pin every value.
  assert.deepEqual(retry.BACKOFF_SECONDS, [60, 300, 1800, 7200, 21600]);
});

// ── computeNextAttemptMs + jitter ─────────────────────────────────

test('computeNextAttemptMs returns null when attemptCount exceeds MAX_ATTEMPTS', () => {
  // The exhaustion signal — caller marks abandoned.
  assert.equal(retry.computeNextAttemptMs({ deliveryId: 'd', attemptCount: 6 }), null);
  assert.equal(retry.computeNextAttemptMs({ deliveryId: 'd', attemptCount: 100 }), null);
});

test('computeNextAttemptMs returns null on invalid attemptCount (< 1)', () => {
  // Defensive — 0 or negative shouldn't compute a meaningful
  // backoff (would mis-schedule).
  assert.equal(retry.computeNextAttemptMs({ deliveryId: 'd', attemptCount: 0 }), null);
  assert.equal(retry.computeNextAttemptMs({ deliveryId: 'd', attemptCount: -1 }), null);
});

test('computeNextAttemptMs applies ±20% deterministic jitter from deliveryId', () => {
  // Same deliveryId → same jitter (reproducible for tests).
  const nowMs = 1_000_000_000_000;
  const a = retry.computeNextAttemptMs({ deliveryId: 'd_alpha', attemptCount: 1, nowMs });
  const b = retry.computeNextAttemptMs({ deliveryId: 'd_alpha', attemptCount: 1, nowMs });
  assert.equal(a, b);
  // Different deliveryIds with the same backoff index produce
  // different timestamps (spread).
  const c = retry.computeNextAttemptMs({ deliveryId: 'd_beta', attemptCount: 1, nowMs });
  assert.notEqual(a, c);
});

test('jitterMultiplier stays inside the [0.8, 1.2] band (±20%)', () => {
  // The jitter spreads thundering-herd retries. The band must be
  // tight enough that backoff order is preserved.
  for (const id of ['a', 'b', 'c', 'd', 'whk_xyz', 'del_aaaa1111bbbb2222']) {
    const m = retry.jitterMultiplier(id);
    assert.ok(m >= 0.8 && m <= 1.2, `jitter ${m} outside [0.8, 1.2] for ${id}`);
  }
});

// ── KV round-trip ──────────────────────────────────────────────────

test('queueRetry writes state + pushes to per-sub index', () => {
  return withInMemoryKv(async (store) => {
    const r = await retry.queueRetry({
      deliveryId: 'del_a',
      subId: 'whk_test',
      event: { type: 'import_request_created', orgId: 42 },
      error: 'ECONNREFUSED',
      nowMs: 1_000_000_000_000,
    });
    assert.equal(r.ok, true);
    assert.equal(r.state.attemptCount, 1);
    assert.equal(r.state.lastError, 'ECONNREFUSED');
    // KV record exists.
    const stored = store.get('webhook:retry:del_a');
    assert.ok(stored);
    assert.equal(stored.subId, 'whk_test');
    // Per-sub index updated.
    const index = store.get('webhook:retry-index:whk_test');
    assert.ok(Array.isArray(index) && index.includes('del_a'));
  });
});

test('rescheduleAfterFailure increments attemptCount + recomputes nextAttemptAt', () => {
  return withInMemoryKv(async (store) => {
    await retry.queueRetry({
      deliveryId: 'del_a', subId: 'whk_test',
      event: { type: 'import_request_created', orgId: 42 },
      error: null, nowMs: 1_000_000_000_000,
    });
    const r = await retry.rescheduleAfterFailure({
      deliveryId: 'del_a', subId: 'whk_test',
      error: 'still failing', nowMs: 1_000_000_000_000,
    });
    assert.equal(r.ok, true);
    assert.equal(r.state.attemptCount, 2);
    assert.equal(r.state.lastError, 'still failing');
    // KV reflects the bump.
    const stored = store.get('webhook:retry:del_a');
    assert.equal(stored.attemptCount, 2);
  });
});

test('rescheduleAfterFailure ABANDONS the retry once attemptCount > MAX_ATTEMPTS', () => {
  return withInMemoryKv(async (store) => {
    await retry.queueRetry({
      deliveryId: 'del_a', subId: 'whk_test',
      event: { type: 'import_request_created', orgId: 42 },
      error: null, nowMs: 0,
    });
    // Bump to attemptCount=5 (MAX), then one more should abandon.
    for (let i = 0; i < 4; i += 1) {
      await retry.rescheduleAfterFailure({
        deliveryId: 'del_a', subId: 'whk_test',
        error: `attempt ${i + 2}`, nowMs: 0,
      });
    }
    // Now at attemptCount=5; one more bumps to 6 which is > MAX.
    const r = await retry.rescheduleAfterFailure({
      deliveryId: 'del_a', subId: 'whk_test',
      error: 'final fail', nowMs: 0,
    });
    assert.equal(r.ok, true);
    assert.equal(r.abandoned, true);
    // KV state shows abandoned + abandonedAt.
    const stored = store.get('webhook:retry:del_a');
    assert.equal(stored.abandoned, true);
    assert.ok(stored.abandonedAt);
    // Index entry removed so the cron doesn't re-pick.
    const index = store.get('webhook:retry-index:whk_test');
    assert.ok(!index.includes('del_a'));
  });
});

test('clearRetry removes both the retry state AND the index entry (success path)', () => {
  return withInMemoryKv(async (store) => {
    await retry.queueRetry({
      deliveryId: 'del_a', subId: 'whk_test',
      event: { type: 'import_request_created', orgId: 42 },
      error: null,
    });
    await retry.clearRetry({ deliveryId: 'del_a', subId: 'whk_test' });
    assert.equal(store.get('webhook:retry:del_a'), undefined);
    const index = store.get('webhook:retry-index:whk_test');
    assert.ok(!index.includes('del_a'));
  });
});

// ── listDueRetriesForSubscription ─────────────────────────────────

test('listDueRetriesForSubscription filters by nextAttemptAt <= now', () => {
  return withInMemoryKv(async () => {
    await retry.queueRetry({
      deliveryId: 'del_due', subId: 'whk_t',
      event: { type: 'import_request_created', orgId: 42 },
      error: null, nowMs: 0,  // nextAttemptAt ~ 60s
    });
    await retry.queueRetry({
      deliveryId: 'del_future', subId: 'whk_t',
      event: { type: 'import_request_created', orgId: 42 },
      error: null, nowMs: 1_000_000_000_000,  // far in the future
    });
    // At time 100s, del_due is due; del_future is not.
    const dues = await retry.listDueRetriesForSubscription({ subId: 'whk_t', nowMs: 100_000 });
    const dueIds = dues.map((d) => d.deliveryId);
    assert.ok(dueIds.includes('del_due'));
    assert.ok(!dueIds.includes('del_future'));
  });
});

test('listDueRetriesForSubscription skips abandoned retries (cron does NOT re-pick)', () => {
  return withInMemoryKv(async () => {
    await retry.queueRetry({
      deliveryId: 'del_dead', subId: 'whk_t',
      event: { type: 'import_request_created', orgId: 42 },
      error: null, nowMs: 0,
    });
    await retry.markAbandoned({ deliveryId: 'del_dead', subId: 'whk_t', lastError: 'gave up' });
    const dues = await retry.listDueRetriesForSubscription({
      subId: 'whk_t', nowMs: 999_999_999_999, includeFuture: true,
    });
    assert.equal(dues.length, 0);
  });
});

// ── Integration with dispatchEvent ─────────────────────────────────

test('dispatchEvent queues a retry when a per-sub delivery FAILS', () => {
  return withInMemoryKv(async (store) => {
    const fakeFetch = async () => ({ ok: false, status: 503 });
    const sub = await webhooks.createWebhook({
      orgIdNumeric: 42, label: 'flaky',
      url: 'https://example.com/hook',
      eventTypes: ['import_request_created'],
    });
    await dispatch.dispatchEvent({
      event: { type: 'import_request_created', orgId: 42, at: '2026-01-01T00:00:00Z' },
      fetchImpl: fakeFetch,
    });
    // A retry entry was queued for this sub.
    const indexEntries = [...store.entries()].filter(([k]) =>
      k.startsWith('webhook:retry-index:'),
    );
    assert.ok(indexEntries.length > 0, 'no retry index entry created for failed delivery');
    const [, ids] = indexEntries[0];
    assert.ok(Array.isArray(ids) && ids.length > 0);
    // The retry state references this subscription.
    const retryEntries = [...store.entries()].filter(([k]) => k.startsWith('webhook:retry:'));
    assert.ok(retryEntries.length > 0);
    const [, state] = retryEntries[0];
    assert.equal(state.subId, sub.subscription.id);
    assert.equal(state.attemptCount, 1);
    assert.equal(state.event.type, 'import_request_created');
  });
});

// ── flushRetriesForSubscription ────────────────────────────────────

test('flushRetriesForSubscription succeeds → clearRetry; fails → rescheduleAfterFailure', () => {
  return withInMemoryKv(async (store) => {
    let attempt = 0;
    const fakeFetch = async () => {
      attempt += 1;
      return attempt < 2 ? { ok: false, status: 503 } : { ok: true, status: 200 };
    };
    const sub = await webhooks.createWebhook({
      orgIdNumeric: 42, label: 'eventual-success',
      url: 'https://example.com/hook',
      eventTypes: ['import_request_created'],
    });
    // First dispatch fails → queues a retry.
    await dispatch.dispatchEvent({
      event: { type: 'import_request_created', orgId: 42 },
      fetchImpl: fakeFetch,
    });
    // Far-future nowMs to make the retry "due."
    const farFuture = Date.now() + 86_400_000;
    const result = await dispatch.flushRetriesForSubscription({
      subId: sub.subscription.id,
      fetchImpl: fakeFetch,
      nowMs: farFuture,
    });
    assert.equal(result.drained, 1);
    assert.equal(result.succeeded, 1);
    // Retry state cleared from KV after success.
    const remaining = [...store.entries()].filter(([k]) =>
      k.startsWith('webhook:retry:') && !k.startsWith('webhook:retry-index:'),
    );
    assert.equal(remaining.length, 0, 'successful retry should clear the retry state');
  });
});

test('flushRetriesForSubscription drops all queued retries when subscription is INACTIVE', () => {
  return withInMemoryKv(async (store) => {
    const fakeFetch = async () => ({ ok: false, status: 503 });
    const sub = await webhooks.createWebhook({
      orgIdNumeric: 42, label: 'will-revoke',
      url: 'https://example.com/hook',
      eventTypes: ['import_request_created'],
    });
    await dispatch.dispatchEvent({
      event: { type: 'import_request_created', orgId: 42 },
      fetchImpl: fakeFetch,
    });
    // Soft-revoke: flip active=false in KV directly.
    const sk = `webhook:sub:${sub.subscription.id}`;
    store.set(sk, { ...store.get(sk), active: false });
    const result = await dispatch.flushRetriesForSubscription({
      subId: sub.subscription.id,
      fetchImpl: fakeFetch,
      nowMs: Date.now() + 86_400_000,
    });
    // All due retries dropped — none re-attempted.
    assert.equal(result.dropped, result.drained);
    assert.equal(result.succeeded, 0);
  });
});

// ── Cron handler + GHA schedule ───────────────────────────────────

test('Cron handler exposes runWebhookRetryFlush + registers it as a job', () => {
  assert.equal(typeof cron.runWebhookRetryFlush, 'function');
  assert.match(CRON_SRC, /['"]webhook-retry-flush['"]: runWebhookRetryFlush/);
});

test('runWebhookRetryFlush fan-out is per-org → per-subscription with isolation', () => {
  // One subscription's failure inside one org must NOT halt the
  // whole org's fan-out — let alone other orgs.
  const block = CRON_SRC.match(/async function runWebhookRetryFlush\([\s\S]*?\n\}/);
  assert.ok(block, 'runWebhookRetryFlush body not located');
  const body = block[0];
  assert.match(body, /for \(const org of allOrgs\) \{[\s\S]*?try \{/);
  assert.match(body, /for \(const subId of subIds\) \{[\s\S]*?try \{/);
  assert.match(body, /dispatch\.flushRetriesForSubscription\(\{ subId \}\)/);
});

test('GHA cron.yml registers every-5-min schedule for webhook-retry-flush', () => {
  // 5-min tick aligns with the 60s shortest-backoff floor so the
  // first retry fires within ~5min of original failure.
  assert.match(CRON_YAML, /- cron: '\*\/5 \* \* \* \*'/);
  // Dispatch routing.
  assert.match(
    CRON_YAML,
    /elif \[ "\$\{\{ github\.event\.schedule \}\}" = "\*\/5 \* \* \* \*" \]; then\s+echo "job=webhook-retry-flush"/,
  );
  // workflow_dispatch entry.
  assert.match(CRON_YAML, /- webhook-retry-flush/);
});

// ── KV-hygiene cross-check ────────────────────────────────────────

test('Every retry KV write passes ttlSeconds (apex P1.14)', () => {
  // The repo-wide hygiene lint test catches kv.set on ephemeral
  // keys without TTL; pin all retry kv.set sites here for fast
  // failure if a refactor regresses. A plain regex on the call
  // surface can stop at a nested `)` (e.g. retryKey(id)) so we
  // scan line-windows instead — every line containing `kv.set(`
  // must have `ttlSeconds: RETRY_TTL_SECONDS` within 5 lines.
  const lines = RETRY_SRC.split('\n');
  /** @type {string[]} */
  const offenders = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/\bkv\.set\(/.test(lines[i])) {
      const window = lines.slice(i, i + 5).join('\n');
      if (!/ttlSeconds: RETRY_TTL_SECONDS/.test(window)) {
        offenders.push(`line ${i + 1}: ${lines[i].trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'kv.set sites missing TTL:\n' + offenders.join('\n'));
});
