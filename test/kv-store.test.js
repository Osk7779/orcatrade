// KV-store primitives tests.
//
// Tests run against the in-memory backend by ensuring KV env vars are not
// set during the test run. The durable (Upstash REST) path is exercised
// indirectly via runtime-store integration tests when a real KV is
// connected; here we just verify the routing logic detects mode correctly.

const test = require('node:test');
const assert = require('node:assert/strict');

// Ensure we run against in-memory by stripping env vars before requiring
// the module (mode is captured at function-call time, not module-load).
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const kv = require('../lib/intelligence/kv-store');

test('mode detection: returns "memory" with no env vars', () => {
  assert.equal(kv.getMode(), 'memory');
  assert.equal(kv.isConfigured(), false);
});

test('mode detection: returns "durable" when KV_REST_API_URL + TOKEN both set', () => {
  process.env.KV_REST_API_URL = 'https://example.upstash.io';
  process.env.KV_REST_API_TOKEN = 'test-token';
  assert.equal(kv.getMode(), 'durable');
  assert.equal(kv.isConfigured(), true);
  // Restore
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
});

test('mode detection: returns "durable" when UPSTASH_REDIS_REST_* aliases set', () => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  assert.equal(kv.getMode(), 'durable');
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

test('mode detection: only URL or only TOKEN → still memory', () => {
  process.env.KV_REST_API_URL = 'https://example.upstash.io';
  assert.equal(kv.getMode(), 'memory');
  delete process.env.KV_REST_API_URL;

  process.env.KV_REST_API_TOKEN = 'test-token';
  assert.equal(kv.getMode(), 'memory');
  delete process.env.KV_REST_API_TOKEN;
});

// ── set + get round-trip ──────────────────────────────

test('set + get: string value', async () => {
  kv._resetMemoryStore();
  await kv.set('test:str', 'hello');
  assert.equal(await kv.get('test:str'), 'hello');
});

test('set + get: object value (JSON serialised in durable, raw in memory)', async () => {
  kv._resetMemoryStore();
  await kv.set('test:obj', { name: 'Oskar', tier: 'pro' });
  const got = await kv.get('test:obj');
  assert.deepEqual(got, { name: 'Oskar', tier: 'pro' });
});

test('set + get: number value', async () => {
  kv._resetMemoryStore();
  await kv.set('test:num', 42);
  assert.equal(await kv.get('test:num'), 42);
});

test('set + get: array value', async () => {
  kv._resetMemoryStore();
  await kv.set('test:arr', [1, 2, 3]);
  assert.deepEqual(await kv.get('test:arr'), [1, 2, 3]);
});

test('get: missing key returns null', async () => {
  kv._resetMemoryStore();
  assert.equal(await kv.get('test:missing'), null);
});

// ── del ───────────────────────────────────────────────

test('del: removes key', async () => {
  kv._resetMemoryStore();
  await kv.set('test:gone', 'value');
  assert.equal(await kv.get('test:gone'), 'value');
  await kv.del('test:gone');
  assert.equal(await kv.get('test:gone'), null);
});

test('del: missing key is no-op (returns false)', async () => {
  kv._resetMemoryStore();
  const result = await kv.del('test:never-existed');
  assert.equal(result, false);
});

// ── TTL expiry ────────────────────────────────────────

test('TTL: value expires after ttlSeconds elapsed', async () => {
  kv._resetMemoryStore();
  await kv.set('test:ttl', 'short-lived', { ttlSeconds: 1 });
  assert.equal(await kv.get('test:ttl'), 'short-lived');

  // Wait 1.2s — guaranteed past the 1s TTL
  await new Promise(r => setTimeout(r, 1200));
  assert.equal(await kv.get('test:ttl'), null);
});

test('TTL: no ttlSeconds → value persists', async () => {
  kv._resetMemoryStore();
  await kv.set('test:permanent', 'forever');
  await new Promise(r => setTimeout(r, 100));
  assert.equal(await kv.get('test:permanent'), 'forever');
});

// ── incr ──────────────────────────────────────────────

test('incr: starts from 1 for missing key', async () => {
  kv._resetMemoryStore();
  const v1 = await kv.incr('test:counter');
  assert.equal(v1, 1);
});

test('incr: increments existing counter', async () => {
  kv._resetMemoryStore();
  await kv.incr('test:counter');
  await kv.incr('test:counter');
  const v3 = await kv.incr('test:counter');
  assert.equal(v3, 3);
});

test('incr: TTL applied only on first increment', async () => {
  kv._resetMemoryStore();
  // First incr sets TTL
  await kv.incr('test:rate', { ttlSeconds: 1 });
  // Second incr should NOT reset TTL
  await new Promise(r => setTimeout(r, 500));
  await kv.incr('test:rate', { ttlSeconds: 1 });
  // Wait so total elapsed > original TTL
  await new Promise(r => setTimeout(r, 700));
  // Counter should have expired (elapsed > original 1s TTL)
  assert.equal(await kv.get('test:rate'), null);
});

// ── listKeys ──────────────────────────────────────────

test('listKeys: returns all keys when no prefix', async () => {
  kv._resetMemoryStore();
  await kv.set('a', 1);
  await kv.set('b', 2);
  await kv.set('c', 3);
  const keys = (await kv.listKeys()).sort();
  assert.deepEqual(keys, ['a', 'b', 'c']);
});

test('listKeys: filters by prefix', async () => {
  kv._resetMemoryStore();
  await kv.set('plan:abc', 'a');
  await kv.set('plan:def', 'b');
  await kv.set('user:xyz', 'c');
  const planKeys = (await kv.listKeys('plan:')).sort();
  assert.deepEqual(planKeys, ['plan:abc', 'plan:def']);
  const userKeys = await kv.listKeys('user:');
  assert.deepEqual(userKeys, ['user:xyz']);
});

test('listKeys: skips expired keys', async () => {
  kv._resetMemoryStore();
  await kv.set('keep', 'permanent');
  await kv.set('gone', 'short', { ttlSeconds: 1 });
  await new Promise(r => setTimeout(r, 1200));
  const keys = await kv.listKeys();
  assert.ok(keys.includes('keep'));
  assert.ok(!keys.includes('gone'));
});

// ── Convenience wrappers ──────────────────────────────

test('setJson + getJson: round-trip with TTL', async () => {
  kv._resetMemoryStore();
  await kv.setJson('test:json', { foo: 'bar' }, 60);
  assert.deepEqual(await kv.getJson('test:json'), { foo: 'bar' });
});

// ── Edge cases ────────────────────────────────────────

test('set: empty key throws', async () => {
  await assert.rejects(() => kv.set('', 'v'), /key required/);
});

test('incr: empty key throws', async () => {
  await assert.rejects(() => kv.incr(''), /key required/);
});

test('get: empty key returns null (not throws)', async () => {
  assert.equal(await kv.get(''), null);
});

test('del: empty key returns false (not throws)', async () => {
  assert.equal(await kv.del(''), false);
});

test('public API surface is stable', () => {
  const expected = ['set', 'get', 'del', 'incr', 'listKeys', 'setJson', 'getJson', 'isConfigured', 'getMode'];
  for (const fn of expected) {
    assert.equal(typeof kv[fn], 'function', `${fn} exported`);
  }
});
