// FX pinning for as-of recompute (Sprint reproducibility-v2, slice 3a / III3).
// The FX calculator can be pinned to a historical rate table so an old plan's
// ORIGINAL euros reproduce exactly, even after the live rates have moved.

const test = require('node:test');
const assert = require('node:assert/strict');

const fxData = require('../lib/intelligence/data/fx-snapshot');
const fx = require('../lib/intelligence/fx-quote');
const ds = require('../lib/intelligence/data-snapshot');
const { composePlan } = require('../lib/handlers/start');

// An "old" FX snapshot block where USD was materially weaker than live.
function oldFxBlock() {
  const snap = ds.captureDataSnapshot().fx;
  const old = JSON.parse(JSON.stringify(snap));
  old.rates.USD = 1.40;                 // vs live ~1.08 — a big, unmistakable move
  old.volatility90dPct.USD = 9.0;       // and a different vol so hedge/risk differ
  old.asOf = '2024-01-01';
  return old;
}

test('resolveFxSource: no pin → the live module', () => {
  assert.equal(fx.resolveFxSource(null), fxData);
});

test('assessFxRisk: pinned rates reproduce the historical numbers, not the live ones', () => {
  const args = { customsValueEur: 50000, quoteCurrency: 'USD', paymentTermsDays: 60 };
  const live = fx.assessFxRisk(args);
  const pinned = fx.assessFxRisk({ ...args, pinnedFx: oldFxBlock() });

  assert.equal(pinned.ok, true);
  assert.equal(pinned.asOf, '2024-01-01');
  assert.equal(pinned.spotRateForeignPerEur, 1.40);
  assert.notEqual(pinned.spotRateForeignPerEur, live.spotRateForeignPerEur);
  // €50k at 1.40 USD/EUR = $70,000 supplier-side.
  assert.equal(pinned.equivalentForeign, 70000);
  // Higher pinned vol → different (larger) 1-sigma risk than the live figure.
  assert.notEqual(pinned.riskEur1Sigma90d, live.riskEur1Sigma90d);
});

test('assessFxRisk: pinning is deterministic — same pin → same numbers', () => {
  const args = { customsValueEur: 50000, quoteCurrency: 'USD', paymentTermsDays: 60, pinnedFx: oldFxBlock() };
  assert.deepEqual(fx.assessFxRisk(args), fx.assessFxRisk(args));
});

test('composePlan: pinnedData.fx flows into the plan FX block', async () => {
  const inputs = {
    productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL',
    customsValueEur: 50000, weightKg: 800, quoteCurrency: 'USD', paymentTermsDays: 60,
  };
  const live = await composePlan(inputs);
  const pinned = await composePlan(inputs, { pinnedData: { fx: oldFxBlock() } });

  assert.equal(pinned.ok, true);
  assert.equal(pinned.fx.spotRateForeignPerEur, 1.40);
  assert.notEqual(pinned.fx.spotRateForeignPerEur, live.fx.spotRateForeignPerEur);
});

test('composePlan: no pinnedData → identical to the default call (no behaviour drift)', async () => {
  const inputs = {
    productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL',
    customsValueEur: 50000, weightKg: 800, quoteCurrency: 'USD',
  };
  const a = await composePlan(inputs);
  const b = await composePlan(inputs, {});
  assert.deepEqual(a.fx, b.fx);
});
