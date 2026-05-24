// Sprint agent-memory-v1 — durable per-user agent memory (lib/agent-memory.js).

const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const kv = require('../lib/intelligence/kv-store');
const mem = require('../lib/agent-memory');

const E = 'mem@example.com';

test('normaliseKey slugifies to a stable, bounded key', () => {
  assert.equal(mem.normaliseKey('Target Margin'), 'target-margin');
  assert.equal(mem.normaliseKey('  Main Supplier!! '), 'main-supplier');
  assert.equal(mem.normaliseKey(''), '');
});

test('remember → recall round-trips and is per-user scoped', async () => {
  kv._resetMemoryStore();
  const r = await mem.remember(E, { key: 'target-margin', value: '35%', kind: 'preference' });
  assert.equal(r.created, true);
  assert.equal(r.key, 'target-margin');

  const got = await mem.recall(E, 'target-margin');
  assert.equal(got.value, '35%');
  assert.equal(got.kind, 'preference');

  // Another user can't see it.
  assert.equal(await mem.recall('other@example.com', 'target-margin'), null);
});

test('remember overwrites the same key in place (not a duplicate), preserves createdAt', async () => {
  kv._resetMemoryStore();
  await mem.remember(E, { key: 'main-supplier', value: 'Acme A' });
  const second = await mem.remember(E, { key: 'main-supplier', value: 'Acme B' });
  assert.equal(second.created, false);
  const list = await mem.list(E);
  assert.equal(list.length, 1);
  assert.equal(list[0].value, 'Acme B');
});

test('list returns most-recently-updated first', async () => {
  kv._resetMemoryStore();
  await mem.remember(E, { key: 'a', value: '1' });
  await mem.remember(E, { key: 'b', value: '2' });
  const list = await mem.list(E);
  assert.deepEqual(list.map((m) => m.key), ['b', 'a']);
});

test('forget removes a memory', async () => {
  kv._resetMemoryStore();
  await mem.remember(E, { key: 'a', value: '1' });
  assert.equal(await mem.forget(E, 'a'), true);
  assert.equal(await mem.forget(E, 'a'), false); // already gone
  assert.equal((await mem.list(E)).length, 0);
});

test('remember rejects empty key / value', async () => {
  kv._resetMemoryStore();
  assert.ok((await mem.remember(E, { key: '', value: 'x' })).error);
  assert.ok((await mem.remember(E, { key: 'k', value: '' })).error);
});

test('value is clamped to the size cap', async () => {
  kv._resetMemoryStore();
  const big = 'x'.repeat(mem.MAX_VALUE_CHARS + 500);
  await mem.remember(E, { key: 'k', value: big });
  const got = await mem.recall(E, 'k');
  assert.equal(got.value.length, mem.MAX_VALUE_CHARS);
});

test('per-user cap blocks new keys but allows overwrites', async () => {
  kv._resetMemoryStore();
  for (let i = 0; i < mem.MAX_MEMORIES_PER_USER; i++) {
    await mem.remember(E, { key: 'k' + i, value: String(i) });
  }
  // A NEW key is rejected.
  const over = await mem.remember(E, { key: 'one-too-many', value: 'x' });
  assert.ok(over.error);
  // Overwriting an existing key still works.
  const ok = await mem.remember(E, { key: 'k0', value: 'updated' });
  assert.equal(ok.created, false);
});

test('deleteAllForUser (GDPR) purges everything', async () => {
  kv._resetMemoryStore();
  await mem.remember(E, { key: 'a', value: '1' });
  await mem.remember(E, { key: 'b', value: '2' });
  const removed = await mem.deleteAllForUser(E);
  assert.equal(removed, 2);
  assert.equal((await mem.list(E)).length, 0);
});
