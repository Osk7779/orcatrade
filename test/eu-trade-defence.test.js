// EU trade defence (anti-dumping + countervailing) tests.

const test = require('node:test');
const assert = require('node:assert/strict');

const td = require('../lib/intelligence/data/eu-trade-defence');
const customs = require('../lib/intelligence/customs-quote');
const { composePlan } = require('../lib/handlers/start');

// ── HS prefix matching ────────────────────────────────

test('hsMatchesPrefix handles dotted and undotted forms equally', () => {
  assert.equal(td.hsMatchesPrefix('8712.00', '8712'), true);
  assert.equal(td.hsMatchesPrefix('871200', '8712'), true);
  assert.equal(td.hsMatchesPrefix('8712.00.30', '8712'), true);
  assert.equal(td.hsMatchesPrefix('8712.00.30', '8712.00'), true);
  assert.equal(td.hsMatchesPrefix('87120030', '8712.00.30'), true);
});

test('hsMatchesPrefix rejects non-matching prefixes', () => {
  assert.equal(td.hsMatchesPrefix('8711.60', '8712'), false);
  assert.equal(td.hsMatchesPrefix('6907', '6911'), false);
  assert.equal(td.hsMatchesPrefix('', '8712'), false);
});

// ── Known measures ────────────────────────────────────

test('CN bicycles (HS 8712) match the AD measure', () => {
  const matches = td.findMeasures({ hsCode: '8712.00', originCountry: 'CN' });
  assert.ok(matches.length >= 1);
  const bikes = matches.find(m => m.id === 'CN_BICYCLES');
  assert.ok(bikes, 'CN_BICYCLES present');
  assert.equal(bikes.type, 'AD');
  assert.equal(bikes.rateTypicalPct, 48.5);
});

test('CN e-bikes (HS 8711.60) match BOTH AD and CVD', () => {
  const matches = td.findMeasures({ hsCode: '8711.60', originCountry: 'CN' });
  const types = matches.map(m => m.type).sort();
  assert.deepEqual(types, ['AD', 'CVD']);
  const total = td.aggregateRate(matches).totalPct;
  // AD typical 70.1 + CVD typical 17.2 = 87.3
  assert.ok(total > 80 && total < 90, `expected ~87%, got ${total}%`);
});

test('CN aluminum extrusions match across multiple HS prefixes', () => {
  for (const hs of ['7604.10', '7608.20', '7610.10']) {
    const matches = td.findMeasures({ hsCode: hs, originCountry: 'CN' });
    assert.ok(matches.some(m => m.id === 'CN_ALUMINUM_EXTRUSIONS'), `CN extrusions match ${hs}`);
  }
});

test('CN steel fasteners (HS 7318) carry the 86.5% country-wide rate', () => {
  const matches = td.findMeasures({ hsCode: '7318.15', originCountry: 'CN' });
  const fasteners = matches.find(m => m.id === 'CN_STEEL_FASTENERS');
  assert.ok(fasteners);
  assert.equal(fasteners.rateTypicalPct, 86.5);
});

test('TR cold-rolled steel triggers the Türkiye AD measure', () => {
  const matches = td.findMeasures({ hsCode: '7209.16', originCountry: 'TR' });
  const tr = matches.find(m => m.id === 'TR_COLD_ROLLED_STEEL');
  assert.ok(tr, 'TR cold-rolled measure matches');
  assert.equal(tr.type, 'AD');
});

test('CN BEV passenger cars (8703.80) match the 2024 CVD measure', () => {
  const matches = td.findMeasures({ hsCode: '8703.80', originCountry: 'CN' });
  const bev = matches.find(m => m.id === 'CN_BEV_PASSENGER_CARS');
  assert.ok(bev);
  assert.equal(bev.type, 'CVD');
});

test('VN apparel (HS 6109) does NOT match any AD measure', () => {
  // Vietnam apparel is largely preferential under EVFTA, not AD-measured.
  const matches = td.findMeasures({ hsCode: '6109.10', originCountry: 'VN' });
  assert.equal(matches.length, 0);
});

test('CN apparel (HS 6109) does NOT trigger AD (no measure for that combination)', () => {
  const matches = td.findMeasures({ hsCode: '6109.10', originCountry: 'CN' });
  assert.equal(matches.length, 0);
});

test('aggregateRate sums AD + CVD on same goods (cumulative duties)', () => {
  const matches = td.findMeasures({ hsCode: '7019.39', originCountry: 'CN' });
  // Fiberglass fabric: AD 55.8% + CVD 30.7% = 86.5%
  const agg = td.aggregateRate(matches);
  assert.ok(agg.totalPct > 85 && agg.totalPct < 88, `expected ~86%, got ${agg.totalPct}%`);
  assert.equal(agg.components.length, 2);
});

test('aggregateRate excludes per-unit specific duties from ad-valorem total', () => {
  const matches = td.findMeasures({ hsCode: '9613.10', originCountry: 'CN' });
  const lighters = matches.find(m => m.id === 'CN_DISPOSABLE_LIGHTERS');
  assert.ok(lighters, 'CN lighters measure exists');
  assert.equal(lighters.rateUnit, 'EUR_PER_UNIT');
  const agg = td.aggregateRate(matches);
  // Specific duty should NOT be summed into totalPct (it's per-unit, not %)
  assert.equal(agg.totalPct, 0);
  assert.ok(agg.specificDuties && agg.specificDuties.length > 0);
});

// ── Customs calculator integration ────────────────────

test('customs calculator surfaces ADD on bicycles ex-CN in duty rate', () => {
  const quote = customs.calculateQuote({
    customsValueEur: 50000,
    hsCode: '8712.00',
    destinationCountry: 'PL',
    originCountry: 'CN',
    linesCount: 4,
  });
  assert.equal(quote.ok, true);
  // MFN for chapter 87 is 10%; ADD adds 48.5%; expect rate ≈ 58.5%
  assert.ok(quote.duty.ratePercent > 55, `expected duty > 55%, got ${quote.duty.ratePercent}%`);
  assert.ok(quote.duty.ratePercent < 62, `expected duty < 62%, got ${quote.duty.ratePercent}%`);
  assert.ok(quote.duty.tradeDefenceMeasures.length >= 1);
  assert.ok(
    quote.duty.tradeDefenceMeasures.some(m => m.id === 'CN_BICYCLES'),
    'CN_BICYCLES measure present on result'
  );
});

test('customs calculator: e-bikes ex-CN combine AD + CVD on top of MFN', () => {
  const quote = customs.calculateQuote({
    customsValueEur: 100000,
    hsCode: '8711.60',
    destinationCountry: 'DE',
    originCountry: 'CN',
    linesCount: 1,
  });
  assert.equal(quote.ok, true);
  // chapter 87 MFN = 10%; AD 70.1 + CVD 17.2 = 87.3% extra; total ~97.3%
  assert.ok(quote.duty.ratePercent > 90, `e-bike total duty > 90%, got ${quote.duty.ratePercent}%`);
  assert.equal(quote.duty.tradeDefenceMeasures.length, 2);
});

test('customs calculator: VN apparel quotes plain MFN (no AD)', () => {
  const quote = customs.calculateQuote({
    customsValueEur: 25000,
    hsCode: '6109.10',
    destinationCountry: 'PL',
    originCountry: 'VN',
    linesCount: 4,
  });
  assert.equal(quote.ok, true);
  // chapter 61 MFN = 12%; no AD on VN apparel
  assert.ok(quote.duty.ratePercent < 13, `expected ~12%, got ${quote.duty.ratePercent}%`);
  assert.equal(quote.duty.tradeDefenceMeasures.length, 0);
});

test('originNotes prepends a trade-defence summary line when measures match', () => {
  const quote = customs.calculateQuote({
    customsValueEur: 50000,
    hsCode: '6907',
    destinationCountry: 'PL',
    originCountry: 'CN',
    linesCount: 4,
  });
  assert.equal(quote.ok, true);
  assert.ok(quote.duty.originNotes.length >= 1);
  assert.match(quote.duty.originNotes[0], /trade-defence/i);
  assert.match(quote.duty.originNotes[0], /TARIC/i);
});

// ── End-to-end through composePlan ────────────────────

test('composePlan surfaces tradeDefenceMeasures on bicycles ex-CN', async () => {
  const plan = await composePlan({
    productCategory: 'machinery',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 50000,
    weightKg: 1500,
    hsCode: '8712.00',
  });
  assert.equal(plan.ok, true);
  assert.ok(Array.isArray(plan.customs.tradeDefenceMeasures));
  assert.ok(plan.customs.tradeDefenceMeasures.length >= 1);
  assert.equal(plan.customs.tradeDefenceMeasures[0].type, 'AD');
});

// ── Catalogue ─────────────────────────────────────────

test('listMeasures returns at least 45 curated measures', () => {
  const measures = td.listMeasures();
  assert.ok(measures.length >= 45, `expected >= 45, got ${measures.length}`);
});

// ── Expanded coverage (sprint trade-defence-expand-v1) ──

test('no duplicate measure ids', () => {
  const ids = td.MEASURES.map(m => m.id);
  const seen = new Set();
  for (const id of ids) {
    assert.ok(!seen.has(id), 'duplicate id: ' + id);
    seen.add(id);
  }
});

test('expanded measures match the right HS+origin with correct aggregate duty', () => {
  const cases = [
    // [hsCode, origin, expectTotalPct, expectIds]
    ['85447000', 'CN', 54.3, ['CN_OPTICAL_FIBRE_CABLES_AD', 'CN_OPTICAL_FIBRE_CABLES_CVD']],
    ['85451100', 'CN', 74.9, ['CN_GRAPHITE_ELECTRODES']],
    ['72107000', 'CN', 70.8, ['CN_ORGANIC_COATED_STEEL_AD', 'CN_ORGANIC_COATED_STEEL_CVD']],
    ['72104100', 'CN', 27.9, ['CN_CORROSION_RESISTANT_STEEL']],
    ['29336100', 'CN', 65.2, ['CN_MELAMINE']],
    ['29181600', 'CN', 53.2, ['CN_SODIUM_GLUCONATE']],
    ['73042400', 'CN', 71.9, ['CN_SEAMLESS_STAINLESS_PIPES']],
  ];
  for (const [hs, origin, total, ids] of cases) {
    const m = td.findMeasures({ hsCode: hs, originCountry: origin });
    assert.deepEqual(m.map(x => x.id).sort(), [...ids].sort(), `wrong measures for ${hs}/${origin}`);
    const agg = td.aggregateRate(m);
    assert.ok(Math.abs(agg.totalPct - total) < 0.01, `${hs}/${origin} total ${agg.totalPct} != ${total}`);
  }
});

test('new chemical/steel measures do not cross-match adjacent subheadings (no false double-count)', () => {
  // citric acid (2918.14/.15) must NOT also pull sodium gluconate (2918.16)
  // or tartaric acid (2918.12).
  const citric = td.findMeasures({ hsCode: '29181400', originCountry: 'CN' });
  assert.deepEqual(citric.map(m => m.id), ['CN_CITRIC_ACID']);
  // organic-coated steel (7210.70) must NOT also pull corrosion-resistant (7210.41).
  const ocs = td.findMeasures({ hsCode: '72107000', originCountry: 'CN' }).map(m => m.id);
  assert.ok(!ocs.includes('CN_CORROSION_RESISTANT_STEEL'), 'OCS should not match CRS subheadings');
});

test('every measure has the required fields', () => {
  for (const m of td.MEASURES) {
    assert.ok(m.id, `measure missing id`);
    assert.ok(m.description, `${m.id} missing description`);
    assert.ok(m.hsPrefix, `${m.id} missing hsPrefix`);
    assert.ok(Array.isArray(m.origins) && m.origins.length, `${m.id} missing origins`);
    assert.ok(['AD', 'CVD', 'BOTH'].includes(m.type), `${m.id} bad type`);
    assert.ok(typeof m.rateTypicalPct === 'number', `${m.id} bad rateTypicalPct`);
    assert.ok(m.citation, `${m.id} missing citation`);
    assert.match(m.asOf, /^\d{4}-\d{2}-\d{2}$/, `${m.id} bad asOf`);
  }
});
