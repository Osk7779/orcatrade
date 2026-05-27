// Live-TARIC duty pinning for as-of recompute (reproducibility-v2 slice 3c).
// The resolved MFN rate is captured on the plan snapshot and can be pinned so a
// historical plan recomputes its ORIGINAL duty instead of today's rate.

const test = require('node:test');
const assert = require('node:assert/strict');

const planDiff = require('../lib/plan-diff');
const { composePlan } = require('../lib/handlers/start');

const INPUTS = {
  productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL',
  customsValueEur: 50000, weightKg: 800, hsCode: '6109',
};

test('extractSnapshot captures mfnRate + mfnSource (persisted, not diffed)', async () => {
  const plan = await composePlan(INPUTS);
  const snap = planDiff.extractSnapshot(plan);
  assert.ok('mfnRate' in snap, 'mfnRate captured');
  assert.equal(typeof snap.mfnSource, 'string');
  // sanitiseSnapshot persists it…
  const persisted = planDiff.sanitiseSnapshot(snap);
  assert.equal(persisted.mfnRate, snap.mfnRate);
  // …but it is NOT part of the diffed field set (delta semantics unchanged).
  const delta = planDiff.diffSnapshots(snap, { ...snap, mfnRate: snap.mfnRate + 0.5 });
  assert.ok(!('mfnRate' in (delta || {})), 'mfnRate does not appear in the diff');
});

test('composePlan: a pinned mfnRate overrides the resolved duty rate', async () => {
  const live = await composePlan(INPUTS);
  const liveMfn = live.customs.duty.mfnRate;

  // Pin a deliberately different MFN rate (e.g. the original live-TARIC HS10 rate).
  const pinnedRate = liveMfn + 0.05;
  const pinned = await composePlan(INPUTS, { pinnedData: { mfnRate: pinnedRate } });
  assert.equal(pinned.ok, true);
  assert.equal(pinned.customs.duty.mfnRate, pinnedRate);
  assert.notEqual(pinned.customs.duty.mfnRate, liveMfn);
  assert.match(pinned.customs.duty.mfnSource, /pinned/);
});

test('composePlan: no pinned mfnRate → unchanged duty (byte-identical default)', async () => {
  const a = await composePlan(INPUTS);
  const b = await composePlan(INPUTS, {});
  assert.equal(a.customs.duty.mfnRate, b.customs.duty.mfnRate);
});
