// Sprint monitoring-v1 — the alert inbox store (lib/alert-store.js).
// KV-only mode (no DATABASE_URL/KV creds in tests → in-memory KV).

const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const kv = require('../lib/intelligence/kv-store');
const store = require('../lib/alert-store');

const EMAIL = 'inbox@example.com';

function baseAlert(overrides = {}) {
  return Object.assign({
    email: EMAIL,
    type: 'plan_cost_drift',
    severity: 'high',
    title: 'Landed cost up 8% on "CN bikes"',
    body: 'Duty rose.',
    entityType: 'plan',
    entityId: 'pl_1',
    dedupeKey: 'plan_cost_drift:pl_1',
    data: { drift: { landedDeltaPct: 8 } },
  }, overrides);
}

test('recordAlert creates, then upserts on the same dedupeKey (no duplicate)', async () => {
  kv._resetMemoryStore();
  const first = await store.recordAlert(baseAlert());
  assert.equal(first.created, true);

  // Same signal again — refresh, not a new row.
  const second = await store.recordAlert(baseAlert({ title: 'Landed cost up 11% on "CN bikes"', severity: 'high' }));
  assert.equal(second.created, false);
  assert.equal(second.id, first.id);

  const all = await store.listAlerts(EMAIL);
  assert.equal(all.length, 1);
  assert.equal(all[0].title, 'Landed cost up 11% on "CN bikes"');
});

test('a different dedupeKey creates a separate alert', async () => {
  kv._resetMemoryStore();
  await store.recordAlert(baseAlert());
  await store.recordAlert(baseAlert({ dedupeKey: 'fx_exposure:pl_1:TRY', type: 'fx_exposure', entityId: 'pl_1', title: 'FX' }));
  const all = await store.listAlerts(EMAIL);
  assert.equal(all.length, 2);
});

test('setStatus marks read / dismissed, scoped to owner', async () => {
  kv._resetMemoryStore();
  const { id } = await store.recordAlert(baseAlert());
  const read = await store.setStatus(id, EMAIL, 'read');
  assert.equal(read.status, 'read');
  // A non-owner cannot touch it.
  assert.equal(await store.setStatus(id, 'someone@else.com', 'dismissed'), null);
});

test('a refreshed signal re-opens a previously read alert', async () => {
  kv._resetMemoryStore();
  const { id } = await store.recordAlert(baseAlert());
  await store.setStatus(id, EMAIL, 'read');
  await store.recordAlert(baseAlert({ title: 'moved again' }));
  const a = await store.getAlert(id, EMAIL);
  assert.equal(a.status, 'open');
});

test('a dismissed alert is NOT resurrected by the same signal (a new one is created)', async () => {
  kv._resetMemoryStore();
  const { id } = await store.recordAlert(baseAlert());
  await store.setStatus(id, EMAIL, 'dismissed');
  const again = await store.recordAlert(baseAlert());
  assert.equal(again.created, true);
  assert.notEqual(again.id, id);
});

test('countOpen + markAllRead', async () => {
  kv._resetMemoryStore();
  await store.recordAlert(baseAlert());
  await store.recordAlert(baseAlert({ dedupeKey: 'k2', entityId: 'pl_2' }));
  assert.equal(await store.countOpen(EMAIL), 2);
  const changed = await store.markAllRead(EMAIL);
  assert.equal(changed, 2);
  assert.equal(await store.countOpen(EMAIL), 0);
});

test('listAlerts filters by status', async () => {
  kv._resetMemoryStore();
  const { id } = await store.recordAlert(baseAlert());
  await store.recordAlert(baseAlert({ dedupeKey: 'k2', entityId: 'pl_2' }));
  await store.setStatus(id, EMAIL, 'dismissed');
  assert.equal((await store.listAlerts(EMAIL, { status: 'open' })).length, 1);
  assert.equal((await store.listAlerts(EMAIL, { status: 'dismissed' })).length, 1);
});

test('deleteAllForUser (GDPR) clears the inbox', async () => {
  kv._resetMemoryStore();
  await store.recordAlert(baseAlert());
  await store.recordAlert(baseAlert({ dedupeKey: 'k2', entityId: 'pl_2' }));
  const removed = await store.deleteAllForUser(EMAIL);
  assert.equal(removed, 2);
  assert.equal((await store.listAlerts(EMAIL)).length, 0);
});

test('recordAlert requires email + type + title', async () => {
  kv._resetMemoryStore();
  await assert.rejects(() => store.recordAlert({ type: 't', title: 'x' }), /email required/);
  await assert.rejects(() => store.recordAlert({ email: EMAIL, title: 'x' }), /type \+ title required/);
});
