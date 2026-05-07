// Finance-quote calculator tests.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PRICING_SNAPSHOT,
  PAYMENT_INSTRUMENTS,
  INSTRUMENT_KEYS,
  LC_COST_TABLE,
  FX_TABLE,
  WORKING_CAPITAL_BENCHMARKS,
  TRADE_CREDIT_COVER,
  listInstruments,
  listFxPairs,
  comparePaymentInstruments,
  estimateLcCost,
  estimateFxHedgingCost,
  calculateWorkingCapitalCycle,
  assessTradeCreditCover,
} = require('../lib/intelligence/finance-quote');

// ── Snapshot & catalogue ─────────────────────────────────

test('PRICING_SNAPSHOT has asOf, source, notes', () => {
  assert.match(PRICING_SNAPSHOT.asOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(PRICING_SNAPSHOT.source);
  assert.ok(PRICING_SNAPSHOT.notes);
});

test('PAYMENT_INSTRUMENTS includes the 6 expected instruments', () => {
  for (const k of ['tt_advance', 'tt_split_30_70', 'documentary_collection_dp', 'letter_of_credit_unconfirmed', 'letter_of_credit_confirmed', 'open_account_60']) {
    assert.ok(PAYMENT_INSTRUMENTS[k], `${k} present`);
  }
});

test('Each payment instrument has cost, days, risks, description', () => {
  for (const i of Object.values(PAYMENT_INSTRUMENTS)) {
    assert.ok(Number.isFinite(i.costPercent));
    assert.ok(Number.isFinite(i.fixedFeeEur));
    assert.ok(Number.isFinite(i.daysToCollection));
    assert.ok(['high', 'medium', 'low', 'lowest'].includes(i.importerRisk));
    assert.ok(['high', 'medium', 'low', 'lowest'].includes(i.supplierRisk));
    assert.ok(i.description && i.bestFor && Array.isArray(i.cautions));
  }
});

test('FX_TABLE has 7 currency pairs', () => {
  assert.equal(Object.keys(FX_TABLE).length, 7);
  for (const v of Object.values(FX_TABLE)) {
    assert.ok(Number.isFinite(v.annualisedVolatilityPercent));
    assert.ok(Number.isFinite(v.annualForwardPremiumPercent));
  }
});

test('TRY-EUR has the highest volatility (crisis-prone currency)', () => {
  const try_ = FX_TABLE.EUR_TRY.annualisedVolatilityPercent;
  for (const [k, v] of Object.entries(FX_TABLE)) {
    if (k !== 'EUR_TRY') {
      assert.ok(try_ > v.annualisedVolatilityPercent, `EUR_TRY (${try_}) > ${k} (${v.annualisedVolatilityPercent})`);
    }
  }
});

// ── comparePaymentInstruments ────────────────────────────

test('comparePaymentInstruments returns 6 instruments with cost + recommendation', () => {
  const r = comparePaymentInstruments({ amountEur: 40000, supplierRelationshipMonths: 3, importerRiskAppetite: 'balanced' });
  assert.equal(r.ok, true);
  assert.equal(r.instruments.length, 6);
  for (const i of r.instruments) {
    assert.ok(Number.isFinite(i.totalCostEur));
    assert.ok(Number.isFinite(i.costPercentOfAmount));
  }
  assert.ok(r.recommendation.preferredKey);
});

test('comparePaymentInstruments: small order with trusted supplier → TT advance', () => {
  const r = comparePaymentInstruments({ amountEur: 4000, supplierRelationshipMonths: 18, importerRiskAppetite: 'balanced' });
  assert.equal(r.recommendation.preferredKey, 'tt_advance');
});

test('comparePaymentInstruments: mid-tier amount with balanced appetite → D/P', () => {
  const r = comparePaymentInstruments({ amountEur: 60000, supplierRelationshipMonths: 12, importerRiskAppetite: 'balanced' });
  assert.equal(r.recommendation.preferredKey, 'documentary_collection_dp');
});

test('comparePaymentInstruments: large amount with new supplier → confirmed LC', () => {
  const r = comparePaymentInstruments({ amountEur: 200000, supplierRelationshipMonths: 6, importerRiskAppetite: 'balanced' });
  assert.equal(r.recommendation.preferredKey, 'letter_of_credit_confirmed');
});

test('comparePaymentInstruments: very long relationship → open account', () => {
  const r = comparePaymentInstruments({ amountEur: 80000, supplierRelationshipMonths: 48, importerRiskAppetite: 'balanced' });
  assert.equal(r.recommendation.preferredKey, 'open_account_60');
});

test('comparePaymentInstruments rejects malformed input', () => {
  const r = comparePaymentInstruments({});
  assert.equal(r.ok, false);
});

// ── estimateLcCost ────────────────────────────────────────

test('estimateLcCost on €100k 6-month confirmed LC returns reasonable percentage', () => {
  const r = estimateLcCost({ amountEur: 100000, durationMonths: 6, confirmed: true });
  assert.equal(r.ok, true);
  // Issuance 0.15% × 2 quarters × €100k = €300
  // Confirmation 0.10% × 2 quarters × €100k = €200
  // Plus fees ≈ €305
  assert.ok(r.totalEur > 700 && r.totalEur < 900, `got ${r.totalEur}`);
  assert.ok(r.allInPercent < 1.5);
});

test('estimateLcCost: unconfirmed LC is cheaper than confirmed', () => {
  const conf = estimateLcCost({ amountEur: 100000, durationMonths: 6, confirmed: true });
  const unconf = estimateLcCost({ amountEur: 100000, durationMonths: 6, confirmed: false });
  assert.ok(unconf.totalEur < conf.totalEur);
});

test('estimateLcCost: discrepancy charges add to total', () => {
  const clean = estimateLcCost({ amountEur: 100000, durationMonths: 3, confirmed: false, expectedDiscrepancies: 0 });
  const dirty = estimateLcCost({ amountEur: 100000, durationMonths: 3, confirmed: false, expectedDiscrepancies: 3 });
  assert.equal(dirty.totalEur - clean.totalEur, 3 * LC_COST_TABLE.discrepancyEur);
});

// ── estimateFxHedgingCost ────────────────────────────────

test('estimateFxHedgingCost EUR/CNY 90 days returns positive cost', () => {
  const r = estimateFxHedgingCost({ amountEur: 50000, currencyPair: 'EUR_CNY', durationDays: 90 });
  assert.equal(r.ok, true);
  assert.ok(r.hedgingCostEur > 0);
  assert.ok(r.unhedgedRiskOneSigmaEur > r.hedgingCostEur);
});

test('estimateFxHedgingCost EUR/TRY shows the highest premium (volatile currency)', () => {
  const cny = estimateFxHedgingCost({ amountEur: 100000, currencyPair: 'EUR_CNY', durationDays: 90 });
  const try_ = estimateFxHedgingCost({ amountEur: 100000, currencyPair: 'EUR_TRY', durationDays: 90 });
  assert.ok(try_.hedgingCostEur > cny.hedgingCostEur);
});

test('estimateFxHedgingCost rejects unsupported pair', () => {
  const r = estimateFxHedgingCost({ amountEur: 50000, currencyPair: 'EUR_BRL', durationDays: 90 });
  assert.equal(r.ok, false);
});

test('estimateFxHedgingCost: longer duration = larger 1-sigma risk', () => {
  const short = estimateFxHedgingCost({ amountEur: 50000, currencyPair: 'EUR_CNY', durationDays: 30 });
  const long = estimateFxHedgingCost({ amountEur: 50000, currencyPair: 'EUR_CNY', durationDays: 270 });
  assert.ok(long.unhedgedRiskOneSigmaEur > short.unhedgedRiskOneSigmaEur);
});

// ── calculateWorkingCapitalCycle ─────────────────────────

test('calculateWorkingCapitalCycle: cycle = DIO + DSO - DPO', () => {
  const r = calculateWorkingCapitalCycle({ dioDays: 60, dsoDays: 30, dpoDays: 20 });
  assert.equal(r.cycleDays, 70);
});

test('calculateWorkingCapitalCycle: TT advance (negative DPO) extends cycle', () => {
  const cardOnly = calculateWorkingCapitalCycle({ dioDays: 60, dsoDays: 0, dpoDays: 30 });
  const ttAdvance = calculateWorkingCapitalCycle({ dioDays: 60, dsoDays: 0, dpoDays: -30 });
  assert.ok(ttAdvance.cycleDays > cardOnly.cycleDays);
});

test('calculateWorkingCapitalCycle: long cycle interpretation flags concern', () => {
  const r = calculateWorkingCapitalCycle({ dioDays: 90, dsoDays: 60, dpoDays: -20 });
  assert.equal(r.cycleDays, 170);
  assert.match(r.interpretation, /long|levers|shorten/i);
});

test('calculateWorkingCapitalCycle rejects non-numeric inputs', () => {
  const r = calculateWorkingCapitalCycle({ dioDays: 'sixty' });
  assert.equal(r.ok, false);
});

// ── assessTradeCreditCover ───────────────────────────────

test('assessTradeCreditCover returns annualPremium with country + size factors', () => {
  const r = assessTradeCreditCover({ buyerCountry: 'DE', buyerSizeBracket: 'tier1', exposureEur: 100000 });
  assert.equal(r.ok, true);
  assert.ok(r.annualPremiumEur > 0);
  assert.ok(r.ratePercent < 1);
});

test('assessTradeCreditCover: SME buyer is more expensive than tier-1', () => {
  const tier1 = assessTradeCreditCover({ buyerCountry: 'DE', buyerSizeBracket: 'tier1', exposureEur: 100000 });
  const sme = assessTradeCreditCover({ buyerCountry: 'DE', buyerSizeBracket: 'sme', exposureEur: 100000 });
  assert.ok(sme.annualPremiumEur > tier1.annualPremiumEur);
});

test('assessTradeCreditCover: BD buyer is more expensive than DE buyer', () => {
  const de = assessTradeCreditCover({ buyerCountry: 'DE', buyerSizeBracket: 'mid', exposureEur: 100000 });
  const bd = assessTradeCreditCover({ buyerCountry: 'BD', buyerSizeBracket: 'mid', exposureEur: 100000 });
  assert.ok(bd.annualPremiumEur > de.annualPremiumEur);
});

test('assessTradeCreditCover applies minimum premium floor', () => {
  const r = assessTradeCreditCover({ buyerCountry: 'DE', buyerSizeBracket: 'tier1', exposureEur: 5000 });
  assert.equal(r.annualPremiumEur, TRADE_CREDIT_COVER.minPremiumEur);
  assert.equal(r.minPremiumApplied, true);
});

// ── Listing helpers ──────────────────────────────────────

test('listInstruments returns 6 instruments with metadata', () => {
  const list = listInstruments();
  assert.equal(list.length, 6);
  for (const i of list) {
    assert.ok(i.key);
    assert.ok(i.label);
    assert.ok(i.family);
  }
});

test('listFxPairs returns 7 pairs with volatility', () => {
  const list = listFxPairs();
  assert.equal(list.length, 7);
  for (const f of list) {
    assert.ok(f.key);
    assert.ok(f.pair);
    assert.ok(Number.isFinite(f.annualisedVolatilityPercent));
  }
});
