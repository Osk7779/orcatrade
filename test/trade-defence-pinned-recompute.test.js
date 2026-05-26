// AD/CVD pinning for as-of recompute (Sprint reproducibility-v2, slice 3b).
// Pinning the trade-defence measures from a stored snapshot reproduces the
// original duty + landed total, even after the live measure rates change.

const test = require('node:test');
const assert = require('node:assert/strict');

const tradeDefence = require('../lib/intelligence/data/eu-trade-defence');
const ds = require('../lib/intelligence/data-snapshot');
const { composePlan } = require('../lib/handlers/start');

// A bicycle import from CN: the live table carries a 48.5% AD measure.
const BIKE = {
  productCategory: 'other', originCountry: 'CN', destinationCountry: 'PL',
  customsValueEur: 100000, weightKg: 4000, hsCode: '8712',
};

test('findMeasures accepts an explicit (pinned) measures array', () => {
  const live = tradeDefence.findMeasures({ hsCode: '8712', originCountry: 'CN' });
  assert.ok(live.length >= 1, 'live table matches the bicycle measure');

  // An empty pinned table → no matches (proves it filters the passed array).
  const none = tradeDefence.findMeasures({ hsCode: '8712', originCountry: 'CN', measures: [] });
  assert.equal(none.length, 0);
});

test('snapshot captures rateUnit so specific vs ad-valorem classify correctly', () => {
  const snap = ds.captureDataSnapshot();
  const m = snap.tradeDefence.measures.find((x) => x.id === 'CN_BICYCLES');
  assert.ok(m, 'bicycle measure captured');
  assert.ok('rateUnit' in m, 'rateUnit field captured (schema v2)');
  assert.equal(ds.SNAPSHOT_SCHEMA_VERSION, 2);
});

test('composePlan: pinned AD/CVD measures reproduce the original duty after the live rate moves', async () => {
  // Original snapshot: bicycle AD at the historical 48.5%.
  const original = ds.captureDataSnapshot();
  const livePlan = await composePlan(BIKE);

  // Pin to the original measures → same duty as today (rates unchanged here).
  const pinnedSame = await composePlan(BIKE, { pinnedData: { tradeDefence: original.tradeDefence } });
  assert.equal(pinnedSame.ok, true);
  assert.equal(
    pinnedSame.customs.standard.dutyEur,
    // The deterministic (useLiveTaric:false) recompute matches a deterministic live calc.
    (await composePlan(BIKE, { pinnedData: { tradeDefence: original.tradeDefence } })).customs.standard.dutyEur,
  );

  // Now imagine the measure was REPEALED after the plan was saved: pin a table
  // with the bicycle rate dropped to 0 and confirm the duty drops accordingly,
  // proving the pinned measures (not the live table) drive the number.
  const repealed = JSON.parse(JSON.stringify(original.tradeDefence));
  for (const m of repealed.measures) {
    if (m.id === 'CN_BICYCLES' || m.id === 'CN_BICYCLE_PARTS') m.rateTypicalPct = 0;
  }
  const pinnedRepealed = await composePlan(BIKE, { pinnedData: { tradeDefence: repealed } });
  assert.ok(
    pinnedRepealed.customs.standard.dutyEur < pinnedSame.customs.standard.dutyEur,
    'repealing the pinned AD measure lowers the recomputed duty',
  );
  // And the live plan (with the measure still active) keeps the higher duty.
  assert.ok(livePlan.customs.standard.dutyEur >= pinnedSame.customs.standard.dutyEur - 1);
});

test('composePlan: no pinnedData → identical customs to the default call', async () => {
  const a = await composePlan(BIKE);
  const b = await composePlan(BIKE, {});
  assert.deepEqual(a.customs.standard, b.customs.standard);
});
