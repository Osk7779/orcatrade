const test = require('node:test');
const assert = require('node:assert/strict');

const { createCacheKey, getCachedValue, setCachedValue } = require('../lib/intelligence/cache-store');

test('cache store returns the same key for stable-equivalent payloads', () => {
  const left = createCacheKey({ b: 2, a: 1 });
  const right = createCacheKey({ a: 1, b: 2 });

  assert.equal(left, right);
});

test('cache store returns a cached value before expiry and drops it after expiry', async () => {
  const payload = { route: 'quick-check', productCategory: 'Steel & Metal', origin: 'India' };
  setCachedValue('test-cache', payload, { ok: true }, 15);

  const hit = getCachedValue('test-cache', payload);
  assert.equal(hit.value.ok, true);

  await new Promise(resolve => setTimeout(resolve, 20));

  const expired = getCachedValue('test-cache', payload);
  assert.equal(expired, null);
});
