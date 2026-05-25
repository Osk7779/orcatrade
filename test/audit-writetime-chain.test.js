// Sprint audit-chain-v2 (Pillar III2) — write-time tamper-evident chain.

const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const kv = require('../lib/intelligence/kv-store');
const events = require('../lib/events');

async function seed(n) {
  kv._resetMemoryStore();
  for (let i = 0; i < n; i += 1) {
    await events.record('import_plan_generated', { category: 'cat' + i, valueEur: (i + 1) * 1000, email: `u${i}@example.com` });
  }
  return events.list({ limit: 100 });
}

test('record() stamps each event with _seq / _prevHash / _hash', async () => {
  const stored = await seed(3);
  assert.equal(stored.length, 3);
  for (const e of stored) {
    assert.equal(typeof e._seq, 'number');
    assert.equal(typeof e._hash, 'string');
    assert.equal(typeof e._prevHash, 'string');
  }
});

test('an untouched stored chain verifies ok', async () => {
  const stored = await seed(4);
  const v = events.verifyStoredChain(stored);
  assert.equal(v.ok, true);
  assert.equal(v.verified, 4);
  assert.ok(v.head);
});

test('editing a substantive field of a stored row breaks the chain', async () => {
  const stored = await seed(4);
  // events.list is newest-first; tamper the middle row's value.
  const target = stored.find((e) => e.category === 'cat1');
  target.valueEur = 999999; // forge the amount
  const v = events.verifyStoredChain(stored);
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, target._seq);
  assert.match(v.reason, /content altered/);
});

test('lawful GDPR pseudonymisation (email/name swap) does NOT break the chain', async () => {
  const stored = await seed(4);
  // Mimic the account-delete pseudonymisation: replace PII fields.
  for (const e of stored) {
    if (e.email) { e.email = 'deleted@pseudonym'; e.pseudonymised = true; }
    if (e.name) e.name = 'deleted';
  }
  const v = events.verifyStoredChain(stored);
  assert.equal(v.ok, true, 'PII fields are excluded from the chain projection, so erasure is not tampering');
});

test('removing a row breaks the prevHash linkage', async () => {
  const stored = await seed(4);
  // Drop the row with _seq === 2 (a middle row).
  const filtered = stored.filter((e) => e._seq !== 2);
  const v = events.verifyStoredChain(filtered);
  assert.equal(v.ok, false);
  assert.match(v.reason, /prevHash mismatch|removed|reordered/);
});

test('verifyStoredChain tolerates legacy un-stamped events', async () => {
  // A mix: real stamped events + a legacy event with no chain fields.
  const stored = await seed(2);
  stored.push({ type: 'import_plan_generated', at: '2020-01-01T00:00:00Z' }); // no _hash/_seq
  const v = events.verifyStoredChain(stored);
  assert.equal(v.ok, true); // legacy rows are skipped, the stamped run verifies
  assert.equal(v.verified, 2);
});

test('chainProjection excludes PII but covers substantive fields', () => {
  const a = events.chainProjection({ type: 't', at: 'x', valueEur: 100, email: 'a@b.com', name: 'Bob' });
  const b = events.chainProjection({ type: 't', at: 'x', valueEur: 100, email: 'different@c.com', name: 'Alice' });
  assert.equal(a, b, 'PII differences must not change the projection');
  const c = events.chainProjection({ type: 't', at: 'x', valueEur: 200 });
  assert.notEqual(a, c, 'a substantive field change must change the projection');
});
