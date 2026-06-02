// Apex P1.1 — TARIC duty pinning per quote.
//
// Tests cover:
//   - data-snapshot.captureDataSnapshot accepts opts.pinnedTaric + emits
//     it under taric.pinned with deterministic ordering
//   - dataSnapshotId differs when pinned rates differ
//   - diffDataSnapshots flags per-rate drift
//   - taric-drift.extractPinnedRates pulls rates from a customs-quote result
//   - taric-drift.extractPinnedRatesFromPortfolio dedupes by (hs, origin)
//   - taric-drift.checkTaricDrift compares pinned vs live (mocked)

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const dataSnapshot = require('../lib/intelligence/data-snapshot');
const taricDrift = require('../lib/intelligence/taric-drift');

// ── captureDataSnapshot: pinnedTaric handling ────────────────

test('captureDataSnapshot: no pinnedTaric → taric.mode is live/snapshot, no .pinned', () => {
  const snap = dataSnapshot.captureDataSnapshot();
  assert.ok(snap.taric);
  assert.ok(['live', 'snapshot', 'pinned'].includes(snap.taric.mode));
  // Without pinning, mode must NOT be 'pinned'.
  assert.notEqual(snap.taric.mode, 'pinned');
  assert.deepEqual(snap.taric.pinned, []);
});

test('captureDataSnapshot: pinnedTaric → mode=pinned + rates in .pinned (sorted)', () => {
  const snap = dataSnapshot.captureDataSnapshot({
    pinnedTaric: [
      { hsCode: '870321', originCountry: 'CN', rate: 10.0, source: 'TARIC', asOf: '2026-06-01' },
      { hsCode: '730830', originCountry: 'VN', rate: 0.0, source: 'TARIC', asOf: '2026-06-01' },
    ],
  });
  // ORCATRADE_DISABLE_LIVE_TARIC env var may flip mode to 'snapshot' — accept both
  // 'pinned' and 'snapshot' here. The key invariant is the pinned array.
  assert.ok(['pinned', 'snapshot'].includes(snap.taric.mode));
  assert.equal(snap.taric.pinned.length, 2);
  // Sort order: hsCode then originCountry — '730830|VN' < '870321|CN' lexically
  assert.equal(snap.taric.pinned[0].hsCode, '730830');
  assert.equal(snap.taric.pinned[1].hsCode, '870321');
});

test('captureDataSnapshot: invalid pinned entries are dropped (defensive)', () => {
  const snap = dataSnapshot.captureDataSnapshot({
    pinnedTaric: [
      { hsCode: '870321', originCountry: 'CN', rate: 10.0 },
      { hsCode: null, originCountry: 'VN', rate: 5.0 }, // dropped: missing hsCode
      { hsCode: '730830', originCountry: 'VN', rate: 'not a number' }, // dropped: non-finite rate
    ],
  });
  assert.equal(snap.taric.pinned.length, 1);
  assert.equal(snap.taric.pinned[0].hsCode, '870321');
});

test('captureDataSnapshot: originCountry normalised to uppercase', () => {
  const snap = dataSnapshot.captureDataSnapshot({
    pinnedTaric: [{ hsCode: '870321', originCountry: 'cn', rate: 10.0 }],
  });
  assert.equal(snap.taric.pinned[0].originCountry, 'CN');
});

// ── dataSnapshotId determinism ───────────────────────────────

test('dataSnapshotId: changes when a pinned rate changes', () => {
  const snapA = dataSnapshot.captureDataSnapshot({
    pinnedTaric: [{ hsCode: '870321', originCountry: 'CN', rate: 10.0 }],
  });
  const snapB = dataSnapshot.captureDataSnapshot({
    pinnedTaric: [{ hsCode: '870321', originCountry: 'CN', rate: 14.0 }],
  });
  assert.notEqual(dataSnapshot.dataSnapshotId(snapA), dataSnapshot.dataSnapshotId(snapB));
});

test('dataSnapshotId: stable when pinned array order differs (sorted internally)', () => {
  const snapA = dataSnapshot.captureDataSnapshot({
    pinnedTaric: [
      { hsCode: '870321', originCountry: 'CN', rate: 10.0 },
      { hsCode: '730830', originCountry: 'VN', rate: 0.0 },
    ],
  });
  const snapB = dataSnapshot.captureDataSnapshot({
    pinnedTaric: [
      { hsCode: '730830', originCountry: 'VN', rate: 0.0 },
      { hsCode: '870321', originCountry: 'CN', rate: 10.0 },
    ],
  });
  assert.equal(dataSnapshot.dataSnapshotId(snapA), dataSnapshot.dataSnapshotId(snapB),
    'id must be stable across input ordering');
});

// ── diffDataSnapshots: TARIC drift ───────────────────────────

test('diffDataSnapshots: surfaces per-pair pinned-rate drift', () => {
  const snapA = dataSnapshot.captureDataSnapshot({
    pinnedTaric: [{ hsCode: '870321', originCountry: 'CN', rate: 10.0 }],
  });
  const snapB = dataSnapshot.captureDataSnapshot({
    pinnedTaric: [{ hsCode: '870321', originCountry: 'CN', rate: 14.0 }],
  });
  const diff = dataSnapshot.diffDataSnapshots(snapA, snapB);
  assert.ok(diff.changed);
  const rateChange = diff.changes.find(c => c.field === 'taric.pinned.870321|CN.rate');
  assert.ok(rateChange, 'per-pair rate change must be in the diff');
  assert.equal(rateChange.from, 10.0);
  assert.equal(rateChange.to, 14.0);
});

test('diffDataSnapshots: no spurious drift when rates match', () => {
  const snap = dataSnapshot.captureDataSnapshot({
    pinnedTaric: [{ hsCode: '870321', originCountry: 'CN', rate: 10.0 }],
  });
  const diff = dataSnapshot.diffDataSnapshots(snap, snap);
  const rateChanges = diff.changes.filter(c => c.field.startsWith('taric.pinned.'));
  assert.deepEqual(rateChanges, []);
});

// ── extractPinnedRates from a quote result ───────────────────

test('extractPinnedRates: customs-quote with liveRateMeta → 1 entry', () => {
  const quote = {
    input: { hsCode: '870321', originCountry: 'CN' },
    liveRateMeta: {
      source: 'taric.gov.uk',
      sourceLabel: 'UK TARIC live',
      rate: 10.0,
      asOf: '2026-06-01',
      fromCache: false,
    },
  };
  const pinned = taricDrift.extractPinnedRates(quote);
  assert.equal(pinned.length, 1);
  assert.equal(pinned[0].hsCode, '870321');
  assert.equal(pinned[0].originCountry, 'CN');
  assert.equal(pinned[0].rate, 10.0);
});

test('extractPinnedRates: no liveRateMeta → empty array (deterministic path)', () => {
  const quote = { input: { hsCode: '870321', originCountry: 'CN' } /* no liveRateMeta */ };
  assert.deepEqual(taricDrift.extractPinnedRates(quote), []);
});

test('extractPinnedRates: missing hsCode → empty (defensive)', () => {
  const quote = { liveRateMeta: { rate: 10.0 } };
  assert.deepEqual(taricDrift.extractPinnedRates(quote), []);
});

test('extractPinnedRatesFromPortfolio: dedupes by (hsCode, originCountry)', () => {
  const portfolio = [
    { input: { hsCode: '870321', originCountry: 'CN' }, liveRateMeta: { rate: 10.0 } },
    { input: { hsCode: '870321', originCountry: 'CN' }, liveRateMeta: { rate: 10.0 } }, // dup
    { input: { hsCode: '730830', originCountry: 'VN' }, liveRateMeta: { rate: 0.0 } },
  ];
  const pinned = taricDrift.extractPinnedRatesFromPortfolio(portfolio);
  assert.equal(pinned.length, 2, 'duplicate (870321, CN) must collapse');
});

// ── pinnedRatesFromSnapshot ──────────────────────────────────

test('pinnedRatesFromSnapshot: reads from a full snapshot', () => {
  const snap = dataSnapshot.captureDataSnapshot({
    pinnedTaric: [{ hsCode: '870321', originCountry: 'CN', rate: 10.0 }],
  });
  const rates = taricDrift.pinnedRatesFromSnapshot(snap);
  assert.equal(rates.length, 1);
});

test('pinnedRatesFromSnapshot: reads from a taric sub-block', () => {
  const snap = dataSnapshot.captureDataSnapshot({
    pinnedTaric: [{ hsCode: '870321', originCountry: 'CN', rate: 10.0 }],
  });
  const rates = taricDrift.pinnedRatesFromSnapshot(snap.taric);
  assert.equal(rates.length, 1);
});

test('pinnedRatesFromSnapshot: tolerates missing/null input', () => {
  assert.deepEqual(taricDrift.pinnedRatesFromSnapshot(null), []);
  assert.deepEqual(taricDrift.pinnedRatesFromSnapshot({}), []);
  assert.deepEqual(taricDrift.pinnedRatesFromSnapshot({ taric: {} }), []);
});

// ── checkTaricDrift ──────────────────────────────────────────

test('checkTaricDrift: empty input → allInTolerance:true, zero counters', async () => {
  const r = await taricDrift.checkTaricDrift([]);
  assert.equal(r.totalChecked, 0);
  assert.equal(r.allInTolerance, true);
  assert.deepEqual(r.drifted, []);
});

test('checkTaricDrift: live rate matches pinned → unchanged++', async () => {
  // Mock the taric module via require cache so the live lookup is deterministic.
  const taricModulePath = require.resolve('../lib/intelligence/taric-client');
  const original = require.cache[taricModulePath].exports.lookupHsRate;
  require.cache[taricModulePath].exports.lookupHsRate = async () => ({
    rate: 10.0, source: 'mock', sourceLabel: 'mock live', asOf: '2026-06-02',
  });
  try {
    const r = await taricDrift.checkTaricDrift([
      { hsCode: '870321', originCountry: 'CN', rate: 10.0, asOf: '2026-06-01' },
    ]);
    assert.equal(r.unchanged, 1);
    assert.equal(r.drifted.length, 0);
    assert.equal(r.allInTolerance, true);
  } finally {
    require.cache[taricModulePath].exports.lookupHsRate = original;
  }
});

test('checkTaricDrift: live rate differs → drifted entry with delta', async () => {
  const taricModulePath = require.resolve('../lib/intelligence/taric-client');
  const original = require.cache[taricModulePath].exports.lookupHsRate;
  require.cache[taricModulePath].exports.lookupHsRate = async () => ({
    rate: 14.0, source: 'mock', sourceLabel: 'mock live', asOf: '2026-06-02',
  });
  try {
    const r = await taricDrift.checkTaricDrift([
      { hsCode: '870321', originCountry: 'CN', rate: 10.0, asOf: '2026-06-01' },
    ]);
    assert.equal(r.unchanged, 0);
    assert.equal(r.drifted.length, 1);
    assert.equal(r.drifted[0].pinned, 10.0);
    assert.equal(r.drifted[0].current, 14.0);
    assert.ok(r.drifted[0].deltaPct > 3.9);
    assert.equal(r.allInTolerance, false);
  } finally {
    require.cache[taricModulePath].exports.lookupHsRate = original;
  }
});

test('checkTaricDrift: lookup error → unreachable++ (drift not flagged)', async () => {
  const taricModulePath = require.resolve('../lib/intelligence/taric-client');
  const original = require.cache[taricModulePath].exports.lookupHsRate;
  require.cache[taricModulePath].exports.lookupHsRate = async () => { throw new Error('upstream timeout'); };
  try {
    const r = await taricDrift.checkTaricDrift([
      { hsCode: '870321', originCountry: 'CN', rate: 10.0 },
    ]);
    assert.equal(r.unreachable, 1);
    assert.equal(r.drifted.length, 0);
    // allInTolerance is true because no drift was DETECTED — the upstream
    // didn't respond. The UI should surface "unreachable" separately.
    assert.equal(r.allInTolerance, true);
  } finally {
    require.cache[taricModulePath].exports.lookupHsRate = original;
  }
});

test('checkTaricDrift: tolerance band — sub-0.1pp drift counted as unchanged', async () => {
  const taricModulePath = require.resolve('../lib/intelligence/taric-client');
  const original = require.cache[taricModulePath].exports.lookupHsRate;
  // 10.0005 vs 10.0 — 0.0005 absolute, below default 0.001 tolerance.
  require.cache[taricModulePath].exports.lookupHsRate = async () => ({
    rate: 10.0005, source: 'mock', asOf: '2026-06-02',
  });
  try {
    const r = await taricDrift.checkTaricDrift([
      { hsCode: '870321', originCountry: 'CN', rate: 10.0 },
    ]);
    assert.equal(r.unchanged, 1, 'sub-tolerance noise must not flag');
  } finally {
    require.cache[taricModulePath].exports.lookupHsRate = original;
  }
});
