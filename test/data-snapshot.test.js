const test = require('node:test');
const assert = require('node:assert/strict');

const ds = require('../lib/intelligence/data-snapshot');
const fx = require('../lib/intelligence/data/fx-snapshot');
const tradeDefence = require('../lib/intelligence/data/eu-trade-defence');

// ── capture pulls the actual VALUES, not just dates ─────

test('captureDataSnapshot pins the real volatile values behind a quote', () => {
  const snap = ds.captureDataSnapshot();
  assert.equal(snap.schemaVersion, ds.SNAPSHOT_SCHEMA_VERSION);

  // FX: the actual rate table, not merely its asOf date.
  assert.ok(snap.fx.rates, 'fx rates captured');
  assert.equal(snap.fx.rates.USD, fx.RATES.USD);
  assert.equal(snap.fx.asOf, fx.ASOF);

  // CBAM ETS market price.
  assert.equal(typeof snap.cbamEts.priceEurPerTonne, 'number');

  // AD/CVD measures: the rate-bearing fields that land in a duty line.
  assert.ok(Array.isArray(snap.tradeDefence.measures));
  assert.equal(snap.tradeDefence.measures.length, tradeDefence.MEASURES.length);
  const bike = snap.tradeDefence.measures.find((m) => m.id === 'CN_BICYCLES');
  assert.ok(bike, 'bicycle measure captured');
  assert.equal(bike.rateTypicalPct, 48.5);

  // TARIC mode is recorded (snapshot in the test env).
  assert.equal(snap.taric.mode, 'snapshot');
});

test('captured snapshot is JSON round-trippable', () => {
  const snap = ds.captureDataSnapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
});

// ── the id is a deterministic content address ───────────

test('dataSnapshotId is deterministic for unchanged data', () => {
  const id1 = ds.dataSnapshotId(ds.captureDataSnapshot());
  const id2 = ds.dataSnapshotId(ds.captureDataSnapshot());
  assert.equal(id1, id2);
  assert.match(id1, /^ds_[0-9a-f]{16}$/);
});

test('dataSnapshotId changes when any captured value changes', () => {
  const base = ds.captureDataSnapshot();
  const baseId = ds.dataSnapshotId(base);

  // Perturb a single FX rate on a clone — the id must move.
  const perturbed = JSON.parse(JSON.stringify(base));
  perturbed.fx.rates.USD = base.fx.rates.USD + 0.01;
  assert.notEqual(ds.dataSnapshotId(perturbed), baseId);

  // Perturb an AD/CVD rate — also must move.
  const perturbed2 = JSON.parse(JSON.stringify(base));
  perturbed2.tradeDefence.measures[0].rateTypicalPct += 1;
  assert.notEqual(ds.dataSnapshotId(perturbed2), baseId);
});

test('dataSnapshotId is insensitive to key ordering (canonical form)', () => {
  const a = { schemaVersion: 1, fx: { asOf: 'x', rates: { USD: 1, EUR: 1 } } };
  const b = { fx: { rates: { EUR: 1, USD: 1 }, asOf: 'x' }, schemaVersion: 1 };
  assert.equal(ds.dataSnapshotId(a), ds.dataSnapshotId(b));
});

test('capturedAt is metadata only — it does NOT affect the id', () => {
  const a = ds.currentDataSnapshot();
  const b = ds.currentDataSnapshot();
  // capturedAt differs between calls, the id must not.
  assert.equal(a.id, b.id);
  assert.match(a.capturedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(ds.dataSnapshotId(a.snapshot), a.id);
});

// ── guard: canonicalStringify rejects cycles loudly ─────

test('canonicalStringify throws on circular structures', () => {
  const o = {};
  o.self = o;
  assert.throws(() => ds.canonicalStringify(o), /Circular/);
});

// ── diffDataSnapshots: the honest drift report ──────────

test('diffDataSnapshots: identical snapshots → no change', () => {
  const snap = ds.captureDataSnapshot();
  const clone = JSON.parse(JSON.stringify(snap));
  const d = ds.diffDataSnapshots(snap, clone);
  assert.equal(d.changed, false);
  assert.deepEqual(d.changes, []);
});

test('diffDataSnapshots: a moved FX rate is itemised with from/to', () => {
  const a = ds.captureDataSnapshot();
  const b = JSON.parse(JSON.stringify(a));
  b.fx.rates.USD = a.fx.rates.USD + 0.05;
  const d = ds.diffDataSnapshots(a, b);
  assert.equal(d.changed, true);
  const usd = d.changes.find((c) => c.field === 'fx.rates.USD');
  assert.ok(usd, 'USD change reported');
  assert.equal(usd.from, a.fx.rates.USD);
  assert.equal(usd.to, a.fx.rates.USD + 0.05);
});

test('diffDataSnapshots: ETS price, AD/CVD rate and TARIC mode changes are caught', () => {
  const a = ds.captureDataSnapshot();
  const b = JSON.parse(JSON.stringify(a));
  b.cbamEts.priceEurPerTonne = a.cbamEts.priceEurPerTonne + 10;
  b.tradeDefence.measures[0].rateTypicalPct += 2;
  b.taric.mode = a.taric.mode === 'live' ? 'snapshot' : 'live';
  const fields = ds.diffDataSnapshots(a, b).changes.map((c) => c.field);
  assert.ok(fields.includes('cbamEts.priceEurPerTonne'));
  assert.ok(fields.some((f) => f.startsWith('tradeDefence.') && f.endsWith('.rateTypicalPct')));
  assert.ok(fields.includes('taric.mode'));
});
