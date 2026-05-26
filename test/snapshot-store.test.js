// Content-addressed snapshot store tests (Sprint reproducibility-v2, slice 2).

const test = require('node:test');
const assert = require('node:assert/strict');

// KV in memory mode (no external KV configured).
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const kv = require('../lib/intelligence/kv-store');
const store = require('../lib/snapshot-store');
const ds = require('../lib/intelligence/data-snapshot');

test('isValidId only accepts ds_ + 16 hex', () => {
  assert.equal(store.isValidId('ds_0123456789abcdef'), true);
  assert.equal(store.isValidId('ds_short'), false);
  assert.equal(store.isValidId('xx_0123456789abcdef'), false);
  assert.equal(store.isValidId(''), false);
  assert.equal(store.isValidId(null), false);
});

test('captureAndStore persists the current snapshot and it round-trips', async () => {
  kv._resetMemoryStore();
  const rec = await store.captureAndStore();
  assert.match(rec.id, /^ds_[0-9a-f]{16}$/);
  const got = await store.getSnapshot(rec.id);
  assert.ok(got, 'snapshot retrievable by content address');
  assert.equal(got.id, rec.id);
  assert.equal(ds.dataSnapshotId(got.snapshot), rec.id, 'stored snapshot still hashes to its id');
});

test('putSnapshot is idempotent — same content address stores once', async () => {
  kv._resetMemoryStore();
  const current = ds.currentDataSnapshot();
  const first = await store.putSnapshot(current);
  assert.deepEqual(first, { id: current.id, stored: true });
  const second = await store.putSnapshot(current);
  assert.deepEqual(second, { id: current.id, stored: false });
});

test('putSnapshot rejects a malformed record', async () => {
  await assert.rejects(() => store.putSnapshot({ id: 'nope', snapshot: {} }), /valid/);
  await assert.rejects(() => store.putSnapshot({ id: 'ds_0123456789abcdef' }), /valid/);
});

test('getSnapshot returns null for unknown / invalid ids', async () => {
  kv._resetMemoryStore();
  assert.equal(await store.getSnapshot('ds_ffffffffffffffff'), null);
  assert.equal(await store.getSnapshot('garbage'), null);
});
