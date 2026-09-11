'use strict';

// Sprint 46 — per-API-key rate limiting.
//
// A leaked sprint-44 key is a DoS amplifier without limits.
// Sprint 46 caps per-key usage at REQUESTS_PER_MINUTE via
// fixed-window 60-second buckets — atomic INCR, predictable Reset
// header semantics, fail-open on KV blip (a rate limiter that
// hard-fails turns a brief Upstash hiccup into a global outage).
//
// Tests cover three layers:
//   1. Pure helpers: bucket math (floor seconds / 60); key shape;
//      env-override of DEFAULT_LIMIT with bounds [1, 100k]
//   2. checkAndRecord + KV round-trip via in-memory stub: increments
//      atomic per bucket; rolls over at the boundary; 429 once
//      count > limit; remaining stays >=0; resetAt is the next
//      bucket start; fail-open on KV throw
//   3. Imports handler wiring: rate-limit check runs AFTER bearer
//      resolves + BEFORE ctx return; 429 short-circuits the auth
//      path; RateLimit-* headers always emitted; setHeaders called
//      whether or not the request was rate-limited

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rateLimit = require('../lib/api-key-rate-limit');

const ROOT = path.resolve(__dirname, '..');
const HELPER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'api-key-rate-limit.js'), 'utf8');
const IMPORTS_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');

// ── Pure helpers ───────────────────────────────────────────────────

test('DEFAULT_LIMIT exported as 600 (10 req/sec — accommodates ERP batch sync)', () => {
  // 600/min = 10/sec — comfortable for ERP read-sync hitting
  // /api/imports?status=quoted&limit=50 repeatedly without burning
  // the orchestrator. Tighter would force enterprise clients to
  // request increases on day one.
  assert.equal(rateLimit.DEFAULT_LIMIT, 600);
});

test('WINDOW_SECONDS = 60 + BUCKET_TTL_SECONDS = 65 (boundary-spanning request safe)', () => {
  // 60-second windows match the "per minute" mental model. TTL of
  // 65s leaves 5s for a slow request hitting the boundary so the
  // bucket doesn't roll over mid-increment.
  assert.equal(rateLimit.WINDOW_SECONDS, 60);
  assert.equal(rateLimit.BUCKET_TTL_SECONDS, 65);
  assert.ok(rateLimit.BUCKET_TTL_SECONDS > rateLimit.WINDOW_SECONDS,
    'BUCKET_TTL_SECONDS must outlive WINDOW_SECONDS so an in-flight request at the boundary doesn\'t see a vanished counter');
});

test('currentBucket returns floor(seconds / 60)', () => {
  // Boundary maths. Bucket changes at the 60-second mark.
  assert.equal(rateLimit.currentBucket(0), 0);
  assert.equal(rateLimit.currentBucket(59_999), 0);
  assert.equal(rateLimit.currentBucket(60_000), 1);
  assert.equal(rateLimit.currentBucket(119_999), 1);
  assert.equal(rateLimit.currentBucket(120_000), 2);
});

test('bucketKey produces the documented ratelimit:apikey:<keyId>:<bucket> shape', () => {
  // Drift-guard: a refactor that changed the prefix would silently
  // start counting fresh from zero on every request (effectively
  // disabling the limiter).
  assert.equal(rateLimit.bucketKey('abc123', 42), 'ratelimit:apikey:abc123:42');
});

test('getLimit reads ORCATRADE_API_KEY_RATE_LIMIT env override within [1, 100000]', () => {
  // Bounded so a fat-fingered "999999999" can't drive an effective
  // no-limit. Out-of-range or non-integer values fall back to default.
  const original = process.env.ORCATRADE_API_KEY_RATE_LIMIT;
  process.env.ORCATRADE_API_KEY_RATE_LIMIT = '5';
  assert.equal(rateLimit.getLimit(), 5);
  process.env.ORCATRADE_API_KEY_RATE_LIMIT = '0';
  assert.equal(rateLimit.getLimit(), 600);
  process.env.ORCATRADE_API_KEY_RATE_LIMIT = '999999';
  assert.equal(rateLimit.getLimit(), 600);
  process.env.ORCATRADE_API_KEY_RATE_LIMIT = '1.5';
  assert.equal(rateLimit.getLimit(), 600);
  process.env.ORCATRADE_API_KEY_RATE_LIMIT = 'abc';
  assert.equal(rateLimit.getLimit(), 600);
  if (original === undefined) delete process.env.ORCATRADE_API_KEY_RATE_LIMIT;
  else process.env.ORCATRADE_API_KEY_RATE_LIMIT = original;
});

// ── checkAndRecord — KV round-trip ─────────────────────────────────

function withInMemoryKv(fn) {
  const kv = require('../lib/intelligence/kv-store');
  let counter = 0;
  const store = new Map();
  const originalGet = kv.get;
  const originalSet = kv.set;
  const originalDel = kv.del;
  const originalIncr = kv.incr;
  kv.get = async (k) => store.get(k);
  kv.set = async (k, v) => { store.set(k, v); };
  kv.del = async (k) => { store.delete(k); };
  kv.incr = async (k) => {
    counter += 1;
    const v = (Number(store.get(k)) || 0) + 1;
    store.set(k, v);
    return v;
  };
  return Promise.resolve()
    .then(() => fn(store, () => counter))
    .finally(() => {
      kv.get = originalGet;
      kv.set = originalSet;
      kv.del = originalDel;
      kv.incr = originalIncr;
    });
}

test('checkAndRecord rejects empty/missing keyId without touching KV (fail-open default)', () => {
  return withInMemoryKv(async (store) => {
    const r = await rateLimit.checkAndRecord({ keyId: '' });
    assert.equal(r.ok, true);
    assert.equal(store.size, 0);
  });
});

test('checkAndRecord increments the bucket counter atomically per request', () => {
  return withInMemoryKv(async (store) => {
    const opts = { keyId: 'k1', nowMs: 0 };
    const r1 = await rateLimit.checkAndRecord(opts);
    assert.equal(r1.count, 1);
    assert.equal(r1.remaining, r1.limit - 1);
    const r2 = await rateLimit.checkAndRecord(opts);
    assert.equal(r2.count, 2);
    assert.equal(r2.remaining, r2.limit - 2);
    // Same bucket key (window-0).
    assert.equal(r1.bucket, r2.bucket);
    assert.equal(store.get('ratelimit:apikey:k1:0'), 2);
  });
});

test('checkAndRecord rolls over the bucket at the 60-second boundary', () => {
  return withInMemoryKv(async () => {
    const a = await rateLimit.checkAndRecord({ keyId: 'k1', nowMs: 59_999 });
    const b = await rateLimit.checkAndRecord({ keyId: 'k1', nowMs: 60_000 });
    // a was bucket 0, b is bucket 1 — counts reset.
    assert.equal(a.bucket, 0);
    assert.equal(b.bucket, 1);
    assert.equal(b.count, 1);
  });
});

test('checkAndRecord returns ok=false (429-able) once count > limit', () => {
  return withInMemoryKv(async () => {
    // Tighten the limit via env so this test doesn't have to fire
    // 600+ requests.
    const original = process.env.ORCATRADE_API_KEY_RATE_LIMIT;
    process.env.ORCATRADE_API_KEY_RATE_LIMIT = '3';
    try {
      const r1 = await rateLimit.checkAndRecord({ keyId: 'k1', nowMs: 0 });
      const r2 = await rateLimit.checkAndRecord({ keyId: 'k1', nowMs: 0 });
      const r3 = await rateLimit.checkAndRecord({ keyId: 'k1', nowMs: 0 });
      const r4 = await rateLimit.checkAndRecord({ keyId: 'k1', nowMs: 0 });
      assert.equal(r1.ok, true);
      assert.equal(r2.ok, true);
      assert.equal(r3.ok, true);
      assert.equal(r4.ok, false, 'fourth request should exceed limit of 3');
      assert.equal(r4.remaining, 0, 'remaining must stay >= 0 even when count > limit');
    } finally {
      if (original === undefined) delete process.env.ORCATRADE_API_KEY_RATE_LIMIT;
      else process.env.ORCATRADE_API_KEY_RATE_LIMIT = original;
    }
  });
});

test('checkAndRecord resetAt is the START of the NEXT bucket (clients can backoff against it)', () => {
  return withInMemoryKv(async () => {
    // Bucket 0 → resetAt = 60s (start of bucket 1, in epoch seconds).
    const r = await rateLimit.checkAndRecord({ keyId: 'k1', nowMs: 5_000 });
    assert.equal(r.bucket, 0);
    assert.equal(r.resetAt, 60);
    // Bucket 1 (nowMs=70_000 → bucket 1, resetAt = 120s).
    const r2 = await rateLimit.checkAndRecord({ keyId: 'k2', nowMs: 70_000 });
    assert.equal(r2.bucket, 1);
    assert.equal(r2.resetAt, 120);
  });
});

test('checkAndRecord fails OPEN on KV blip (returns ok=true so a brief Upstash hiccup does NOT page everyone)', () => {
  // A rate limiter that hard-fails turns a brief outage into a
  // global one. The safe-default is to allow the request through
  // when storage is unavailable + log at the caller.
  return withInMemoryKv(async () => {
    const kv = require('../lib/intelligence/kv-store');
    const originalIncr = kv.incr;
    kv.incr = async () => { throw new Error('KV down'); };
    try {
      const r = await rateLimit.checkAndRecord({ keyId: 'k1', nowMs: 0 });
      assert.equal(r.ok, true);
      // remaining defaults to the full limit so headers stay sane.
      assert.equal(r.remaining, r.limit);
    } finally {
      kv.incr = originalIncr;
    }
  });
});

// ── setHeaders ─────────────────────────────────────────────────────

test('setHeaders writes BOTH RateLimit-* (IETF draft) AND X-RateLimit-* (legacy)', () => {
  // Forward-compat with the IETF draft + back-compat for clients
  // that haven't adopted it. Pin both sets.
  /** @type {Record<string,string>} */
  const headers = {};
  const fakeRes = { setHeader: (k, v) => { headers[k] = String(v); } };
  rateLimit.setHeaders(fakeRes, { limit: 600, remaining: 47, resetAt: 1700000060 });
  // IETF draft naming.
  assert.equal(headers['RateLimit-Limit'], '600');
  assert.equal(headers['RateLimit-Remaining'], '47');
  assert.equal(headers['RateLimit-Reset'], '1700000060');
  // Legacy.
  assert.equal(headers['X-RateLimit-Limit'], '600');
  assert.equal(headers['X-RateLimit-Remaining'], '47');
  assert.equal(headers['X-RateLimit-Reset'], '1700000060');
});

test('setHeaders is defensive — null result + missing setHeader silently no-op', () => {
  // Belt-and-braces. The handler calls setHeaders BEFORE returning
  // a 429; a refactor that accidentally passes a null result must
  // not throw and cascade into a 500.
  assert.doesNotThrow(() => rateLimit.setHeaders(null, { limit: 1, remaining: 1, resetAt: 1 }));
  assert.doesNotThrow(() => rateLimit.setHeaders({}, { limit: 1, remaining: 1, resetAt: 1 }));
  assert.doesNotThrow(() => rateLimit.setHeaders({ setHeader: () => {} }, null));
});

// ── Imports handler wiring ─────────────────────────────────────────

// Capture from `ensureAuthedOrg(` up to the next top-level `async
// function` declaration — the function body has nested `\n}` for
// inner if-blocks, so `[\s\S]*?\n\}` matches WAY too early. The
// next-function boundary is the safe terminator.
function ensureAuthedOrgBody() {
  const m = IMPORTS_SRC.match(
    /async function ensureAuthedOrg\([\s\S]*?(?=\nasync function )/,
  );
  if (!m) throw new Error('ensureAuthedOrg body not located');
  return m[0];
}

test('Imports handler runs rate-limit check AFTER bearer resolves + BEFORE returning ctx', () => {
  // Critical ordering: limit must be enforced AFTER we know the
  // key is valid (so an invalid bearer doesn't waste a bucket
  // increment), but BEFORE we hand the ctx back to the dispatcher
  // (so the per-action handlers don't have to repeat the check).
  // Pin all three positions.
  const body = ensureAuthedOrgBody();
  // Search for the FUNCTION CALL forms, not the bare identifier
  // (the comment at the top of the function mentions "isApiKey:
  // true" without a comma — indexOf on the bare identifier would
  // match the comment first + invert the ordering).
  const lookupIdx = body.indexOf('apiKeys.lookupByBearer');
  const checkIdx = body.indexOf('rateLimit.checkAndRecord');
  // The actual return object literal — trailing comma distinguishes
  // it from any comment narration.
  const returnIdx = body.indexOf('isApiKey: true,');
  assert.ok(lookupIdx >= 0, 'lookupByBearer call not located');
  assert.ok(checkIdx >= 0, 'rateLimit.checkAndRecord call not located');
  assert.ok(returnIdx >= 0, 'bearer ctx return literal not located');
  assert.ok(lookupIdx < checkIdx, 'rate-limit must run AFTER lookupByBearer');
  assert.ok(checkIdx < returnIdx, 'rate-limit must run BEFORE the bearer ctx return');
});

test('Imports handler emits RateLimit-* headers via setHeaders on EVERY bearer request (200 + 429)', () => {
  // The setHeaders call is positioned BEFORE the !rl.ok 429
  // branch + before the success return so a client always gets
  // the headers. Pin the unconditional call.
  const body = ensureAuthedOrgBody();
  // setHeaders is called RIGHT AFTER checkAndRecord, BEFORE the
  // !rl.ok branch. Pin both expressions.
  assert.match(body, /const rl = await rateLimit\.checkAndRecord\(\{ keyId: bearer\.keyId \}\);\s*rateLimit\.setHeaders\(res, rl\);/);
});

test('Imports handler 429s with body that includes limit + retryAfter when rate-limited', () => {
  // The response shape MUST give the client enough to backoff
  // (retryAfter from resetAt). Pin all three fields.
  const body = ensureAuthedOrgBody();
  assert.match(body, /jsonResponse\(res, 429, \{[\s\S]*?error: ['"]Rate limit exceeded for this API key['"]/);
  assert.match(body, /limit: rl\.limit/);
  assert.match(body, /retryAfter: rl\.resetAt/);
});
