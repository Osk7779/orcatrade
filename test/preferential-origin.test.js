// Preferential origin regime tests.

const test = require('node:test');
const assert = require('node:assert/strict');

const pref = require('../lib/intelligence/data/preferential-origin');
const customs = require('../lib/intelligence/customs-quote');
const { composePlan } = require('../lib/handlers/start');

// ── findBestRegime — origin lookups ───────────────────

test('BD (Bangladesh) → EBA on apparel chapter 62', () => {
  const r = pref.findBestRegime({ origin: 'BD', hsCode: '6203.42', mfnRatePct: 12 });
  assert.equal(r.code, 'EBA');
  assert.equal(r.rate, 0);
  assert.equal(r.mfnReplaced, true);
  assert.equal(r.saving, 12);
});

test('BD → no EBA on arms chapter 93 (excluded)', () => {
  const r = pref.findBestRegime({ origin: 'BD', hsCode: '9301.10', mfnRatePct: 0 });
  assert.equal(r, null);
});

test('VN → EVFTA on electronics', () => {
  const r = pref.findBestRegime({ origin: 'VN', hsCode: '8517.62', mfnRatePct: 3.5 });
  assert.equal(r.code, 'EVFTA');
  assert.equal(r.rate, 0);
  assert.equal(r.mfnReplaced, true);
});

test('VN apparel triggers EVFTA but flags sensitive textile origin rules', () => {
  const r = pref.findBestRegime({ origin: 'VN', hsCode: '6203.42', mfnRatePct: 12 });
  assert.equal(r.code, 'EVFTA');
  assert.match(r.notes, /stricter rules of origin/i);
});

test('KR (South Korea) → EUKFTA at 0%', () => {
  const r = pref.findBestRegime({ origin: 'KR', hsCode: '8528.72', mfnRatePct: 14 });
  assert.equal(r.code, 'EUKFTA');
  assert.equal(r.rate, 0);
});

test('JP → EUJEPA at 0%', () => {
  const r = pref.findBestRegime({ origin: 'JP', hsCode: '8703.23', mfnRatePct: 10 });
  assert.equal(r.code, 'EUJEPA');
});

test('IN (India) → GSP standard (partial reduction)', () => {
  const r = pref.findBestRegime({ origin: 'IN', hsCode: '6203.42', mfnRatePct: 12 });
  assert.equal(r.code, 'GSP_STANDARD');
  assert.ok(r.rate > 0, 'partial reduction, not zero');
  assert.ok(r.rate < 0.12, 'rate is below MFN');
  assert.equal(r.approximate, true);
  assert.ok(r.saving > 0);
});

test('TR industrial → ATR Customs Union at 0%', () => {
  const r = pref.findBestRegime({ origin: 'TR', hsCode: '7318.15', mfnRatePct: 2.7 });
  assert.equal(r.code, 'ATR');
  assert.equal(r.rate, 0);
  assert.equal(r.mfnReplaced, true);
  assert.equal(r.type, 'CU');
});

test('TR agricultural → EXCLUDED (no Customs Union for ch. 01-24)', () => {
  const r = pref.findBestRegime({ origin: 'TR', hsCode: '0805.10', mfnRatePct: 16 });
  assert.equal(r.code, 'TR_AGRI_EXCLUDED');
  assert.equal(r.mfnReplaced, false);
});

test('PK (Pakistan) → GSP+ at 0%', () => {
  const r = pref.findBestRegime({ origin: 'PK', hsCode: '6203.42', mfnRatePct: 12 });
  assert.equal(r.code, 'GSP_PLUS');
  assert.equal(r.rate, 0);
});

test('CN → no regime (no preferential coverage with EU)', () => {
  const r = pref.findBestRegime({ origin: 'CN', hsCode: '6203.42', mfnRatePct: 12 });
  assert.equal(r, null);
});

test('TW (Taiwan) → no regime', () => {
  const r = pref.findBestRegime({ origin: 'TW', hsCode: '8517.62', mfnRatePct: 0 });
  assert.equal(r, null);
});

// ── Customs calculator integration ────────────────────

test('BD apparel: claimPreferential=true → 0% duty applied', () => {
  const quote = customs.calculateQuote({
    customsValueEur: 25000,
    hsCode: '6203.42',
    destinationCountry: 'PL',
    originCountry: 'BD',
    linesCount: 4,
    claimPreferential: true,
  });
  assert.equal(quote.ok, true);
  assert.equal(quote.duty.ratePercent, 0);
  assert.ok(quote.duty.preferentialApplied);
  assert.equal(quote.duty.preferentialApplied.code, 'EBA');
  assert.equal(quote.duty.preferentialAvailable, null);
});

test('BD apparel: claimPreferential=false → 12% MFN, but savings preview surfaced', () => {
  const quote = customs.calculateQuote({
    customsValueEur: 25000,
    hsCode: '6203.42',
    destinationCountry: 'PL',
    originCountry: 'BD',
    linesCount: 4,
    claimPreferential: false,
  });
  assert.equal(quote.ok, true);
  assert.ok(quote.duty.ratePercent > 11 && quote.duty.ratePercent < 13);
  assert.equal(quote.duty.preferentialApplied, null);
  assert.ok(quote.duty.preferentialAvailable);
  assert.equal(quote.duty.preferentialAvailable.code, 'EBA');
});

test('VN electronics: claimPreferential=true → EVFTA 0% applied', () => {
  const quote = customs.calculateQuote({
    customsValueEur: 50000,
    hsCode: '8517.62',
    destinationCountry: 'DE',
    originCountry: 'VN',
    linesCount: 2,
    claimPreferential: true,
  });
  assert.equal(quote.ok, true);
  assert.equal(quote.duty.ratePercent, 0);
  assert.equal(quote.duty.preferentialApplied.code, 'EVFTA');
});

test('TR fasteners: claimPreferential=true → ATR 0% (replaces 2.7% MFN)', () => {
  const quote = customs.calculateQuote({
    customsValueEur: 30000,
    hsCode: '7318.15',
    destinationCountry: 'PL',
    originCountry: 'TR',
    linesCount: 3,
    claimPreferential: true,
  });
  assert.equal(quote.ok, true);
  assert.equal(quote.duty.preferentialApplied.code, 'ATR');
  // MFN 2.7% replaced by 0%; no AD on TR fasteners
  assert.ok(quote.duty.ratePercent < 1);
});

test('TR cold-rolled steel: claimPreferential=true → ATR 0% MFN, but AD still applies', () => {
  // Critical case: trade defence is NOT waived by preferential origin.
  const quote = customs.calculateQuote({
    customsValueEur: 100000,
    hsCode: '7209.16',
    destinationCountry: 'DE',
    originCountry: 'TR',
    linesCount: 1,
    claimPreferential: true,
  });
  assert.equal(quote.ok, true);
  // ATR replaces MFN; but TR_COLD_ROLLED_STEEL AD adds ~23.3%
  assert.ok(quote.duty.ratePercent > 20, `expected duty > 20%, got ${quote.duty.ratePercent}%`);
  assert.equal(quote.duty.preferentialApplied.code, 'ATR');
  assert.ok(quote.duty.tradeDefenceMeasures.length >= 1);
});

test('CN apparel: no regime available, no savings preview', () => {
  const quote = customs.calculateQuote({
    customsValueEur: 25000,
    hsCode: '6203.42',
    destinationCountry: 'PL',
    originCountry: 'CN',
    linesCount: 4,
    claimPreferential: false,
  });
  assert.equal(quote.ok, true);
  assert.equal(quote.duty.preferentialApplied, null);
  assert.equal(quote.duty.preferentialAvailable, null);
});

test('IN apparel: GSP standard surfaced (not zero, but better than MFN)', () => {
  const quote = customs.calculateQuote({
    customsValueEur: 25000,
    hsCode: '6203.42',
    destinationCountry: 'PL',
    originCountry: 'IN',
    linesCount: 4,
    claimPreferential: true,
  });
  assert.equal(quote.ok, true);
  // 12% × 0.7 - 1 = 7.4% approx
  assert.ok(quote.duty.ratePercent > 5 && quote.duty.ratePercent < 10);
  assert.equal(quote.duty.preferentialApplied.code, 'GSP_STANDARD');
});

// ── End-to-end through composePlan ────────────────────

test('composePlan: BD apparel surfaces preferentialSavingEur > 0', () => {
  const plan = composePlan({
    productCategory: 'apparel',
    originCountry: 'BD',
    destinationCountry: 'PL',
    customsValueEur: 50000,
    weightKg: 1500,
    claimPreferential: false,
  });
  assert.equal(plan.ok, true);
  assert.ok(plan.customs.preferentialAvailable);
  assert.equal(plan.customs.preferentialAvailable.code, 'EBA');
  // 12% MFN × €50K = €6,000 saving
  assert.ok(plan.customs.preferentialSavingEur > 5500 && plan.customs.preferentialSavingEur < 6500);
});

test('composePlan: VN electronics with claim → preferentialApplied EVFTA', () => {
  const plan = composePlan({
    productCategory: 'electronics',
    originCountry: 'VN',
    destinationCountry: 'DE',
    customsValueEur: 50000,
    weightKg: 200,
    claimPreferential: true,
  });
  assert.equal(plan.ok, true);
  assert.ok(plan.customs.preferentialApplied);
  assert.equal(plan.customs.preferentialApplied.code, 'EVFTA');
  assert.equal(plan.customs.preferentialSavingEur, 0); // already applied, no preview
});

// ── Catalogue ─────────────────────────────────────────

test('listRegimes returns the headline regimes', () => {
  const regimes = pref.listRegimes();
  const codes = regimes.map(r => r.code);
  for (const expected of ['EBA', 'GSP_PLUS', 'GSP_STANDARD', 'EVFTA', 'EUKFTA', 'EUJEPA', 'ATR']) {
    assert.ok(codes.includes(expected), `${expected} listed`);
  }
});

test('isOriginCovered returns true for known origins', () => {
  for (const origin of ['BD', 'VN', 'KR', 'JP', 'IN', 'TR', 'PK']) {
    assert.equal(pref.isOriginCovered(origin), true, `${origin} covered`);
  }
});

test('isOriginCovered returns false for non-preferential origins', () => {
  for (const origin of ['CN', 'TW', 'HK', 'RU']) {
    assert.equal(pref.isOriginCovered(origin), false, `${origin} not covered`);
  }
});
