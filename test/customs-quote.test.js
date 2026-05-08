const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PRICING_SNAPSHOT,
  EU_VAT,
  HS_CHAPTER_DUTY,
  ORIGIN_OVERLAYS,
  BROKERAGE_BASE_EUR,
  BROKERAGE_PER_LINE_EUR,
  BROKERAGE_CAP_EUR,
  BONDED,
  COST_OF_CAPITAL_ANNUAL,
  listCountries,
  listOrigins,
  listHsChapters,
  detectChapter,
  resolveDutyRate,
  vatForCountry,
  brokerageFee,
  validateInput,
  calculateStandardClearance,
  calculateBondedWarehouse,
  calculateQuote,
} = require('../lib/intelligence/customs-quote');

// ── Snapshot & constants ─────────────────────────────────

test('PRICING_SNAPSHOT exposes asOf, source, notes', () => {
  assert.match(PRICING_SNAPSHOT.asOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(PRICING_SNAPSHOT.source);
  assert.ok(PRICING_SNAPSHOT.notes);
});

test('EU_VAT covers all 27 EU member states', () => {
  assert.equal(Object.keys(EU_VAT).length, 27);
  for (const [code, v] of Object.entries(EU_VAT)) {
    assert.ok(v.rate > 0 && v.rate < 0.4, `${code} VAT rate plausible`);
    assert.ok(v.name);
  }
});

test('HS_CHAPTER_DUTY covers core SME import chapters', () => {
  for (const chapter of ['61', '62', '64', '84', '85', '94', '95']) {
    assert.ok(HS_CHAPTER_DUTY[chapter], `chapter ${chapter} present`);
  }
});

test('Apparel chapter 61/62 duty is 12% MFN', () => {
  assert.equal(HS_CHAPTER_DUTY['61'].rate, 0.12);
  assert.equal(HS_CHAPTER_DUTY['62'].rate, 0.12);
});

test('Pharmaceutical chapter 30 is zero-duty', () => {
  assert.equal(HS_CHAPTER_DUTY['30'].rate, 0.00);
});

test('ORIGIN_OVERLAYS distinguishes preferential vs non', () => {
  assert.equal(ORIGIN_OVERLAYS.VN.preferential, true);
  assert.equal(ORIGIN_OVERLAYS.CN.preferential, false);
  assert.equal(ORIGIN_OVERLAYS.BD.preferentialDiscount, 1.0);
});

test('CN overlay adds anti-dumping on chapter 72/73 (steel)', () => {
  assert.ok(ORIGIN_OVERLAYS.CN.chapterAdjustments['72'] > 0);
  assert.ok(ORIGIN_OVERLAYS.CN.chapterAdjustments['73'] > 0);
});

test('BONDED constants are sane', () => {
  assert.ok(BONDED.setupFeeEur > 0 && BONDED.setupFeeEur < 500);
  assert.ok(BONDED.bondPercentOfCustomsValue > 0 && BONDED.bondPercentOfCustomsValue < 0.05);
  assert.ok(BONDED.storagePerCbmPerDayEur > 0);
});

// ── Helpers ──────────────────────────────────────────────

test('detectChapter strips non-digits and takes first 2', () => {
  assert.equal(detectChapter('6203'), '62');
  assert.equal(detectChapter('62.03.42.10'), '62');
  assert.equal(detectChapter('85.21'), '85');
  assert.equal(detectChapter(''), null);
  assert.equal(detectChapter(null), null);
});

test('vatForCountry returns rate + name', () => {
  const de = vatForCountry('DE');
  assert.equal(de.rate, 0.19);
  assert.equal(de.name, 'Germany');
});

test('vatForCountry returns null for non-EU', () => {
  assert.equal(vatForCountry('UK'), null);
  assert.equal(vatForCountry('US'), null);
});

test('brokerageFee scales with lines and respects cap', () => {
  assert.equal(brokerageFee(1), BROKERAGE_BASE_EUR + BROKERAGE_PER_LINE_EUR);
  assert.equal(brokerageFee(4), BROKERAGE_BASE_EUR + 4 * BROKERAGE_PER_LINE_EUR);
  assert.equal(brokerageFee(1000), BROKERAGE_CAP_EUR); // capped
});

// ── resolveDutyRate ──────────────────────────────────────

test('resolveDutyRate returns MFN for valid chapter without overlay', () => {
  const r = resolveDutyRate({ hsCode: '6203', originCountry: 'TW', claimPreferential: false });
  assert.equal(r.ok, true);
  assert.equal(r.chapter, '62');
  assert.equal(r.rate, 0.12);
});

test('resolveDutyRate adds CN anti-dumping on steel', () => {
  const r = resolveDutyRate({ hsCode: '7308', originCountry: 'CN', claimPreferential: false });
  assert.ok(r.rate > HS_CHAPTER_DUTY['73'].rate, 'rate should exceed MFN');
});

test('resolveDutyRate applies VN EVFTA preferential rate when claimed', () => {
  const noClaim = resolveDutyRate({ hsCode: '6203', originCountry: 'VN', claimPreferential: false });
  const withClaim = resolveDutyRate({ hsCode: '6203', originCountry: 'VN', claimPreferential: true });
  assert.ok(withClaim.rate < noClaim.rate);
  // EVFTA replaces MFN 12% with 0% (with valid origin declaration)
  assert.equal(withClaim.rate, 0);
  assert.equal(withClaim.preferentialApplied?.code, 'EVFTA');
});

test('resolveDutyRate applies BD EBA full duty exemption when claimed', () => {
  const r = resolveDutyRate({ hsCode: '6203', originCountry: 'BD', claimPreferential: true });
  assert.equal(r.rate, 0.00);
});

test('resolveDutyRate fails on invalid chapter', () => {
  const r = resolveDutyRate({ hsCode: '9999', originCountry: 'CN', claimPreferential: false });
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

// ── validateInput ────────────────────────────────────────

test('validateInput rejects missing customsValueEur', () => {
  const r = validateInput({ hsCode: '6203', destinationCountry: 'DE' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('customsValueEur')));
});

test('validateInput rejects missing hsCode', () => {
  const r = validateInput({ customsValueEur: 1000, destinationCountry: 'DE' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('hsCode')));
});

test('validateInput rejects non-EU destinationCountry', () => {
  const r = validateInput({ customsValueEur: 1000, hsCode: '6203', destinationCountry: 'US' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('EU member state')));
});

test('validateInput rejects unknown hsCode chapter', () => {
  const r = validateInput({ customsValueEur: 1000, hsCode: '9999', destinationCountry: 'DE' });
  assert.equal(r.ok, false);
});

test('validateInput accepts complete valid input', () => {
  const r = validateInput({ customsValueEur: 25000, hsCode: '6203', destinationCountry: 'DE', originCountry: 'CN', linesCount: 4 });
  assert.equal(r.ok, true);
});

test('validateInput rejects bondedDays out of range', () => {
  const r = validateInput({ customsValueEur: 1000, hsCode: '6203', destinationCountry: 'DE', bondedDays: 99999 });
  assert.equal(r.ok, false);
});

// ── calculateStandardClearance ───────────────────────────

test('calculateStandardClearance computes duty + VAT + brokerage', () => {
  const r = calculateStandardClearance({
    customsValueEur: 25000,
    dutyRate: 0.12,
    vat: { rate: 0.19, name: 'Germany' },
    linesCount: 4,
  });
  assert.equal(r.dutyEur, 3000); // 12% × 25000
  // VAT = 19% × (25000 + 3000) = 5320
  assert.equal(r.vatEur, 5320);
  assert.equal(r.brokerageEur, BROKERAGE_BASE_EUR + 4 * BROKERAGE_PER_LINE_EUR);
  // total = customs value + duty + vat + brokerage + ENS
  assert.equal(r.totalEur, 25000 + 3000 + 5320 + 77 + 25);
});

test('calculateStandardClearance breakdown lists 5 line items', () => {
  const r = calculateStandardClearance({
    customsValueEur: 10000, dutyRate: 0.05, vat: { rate: 0.20, name: 'France' }, linesCount: 2,
  });
  assert.equal(r.breakdown.length, 5);
});

// ── calculateBondedWarehouse ─────────────────────────────

test('bonded with bondedDays=0 returns unavailable', () => {
  const r = calculateBondedWarehouse({
    customsValueEur: 25000, dutyRate: 0.12, vat: { rate: 0.19, name: 'Germany' },
    linesCount: 4, bondedDays: 0, bondedVolumeCbm: 1, releaseStrategy: 'free_circulation',
  });
  assert.equal(r.unavailable, true);
});

test('bonded re-export skips duty + VAT, leaves only ops cost', () => {
  const r = calculateBondedWarehouse({
    customsValueEur: 25000, dutyRate: 0.12, vat: { rate: 0.19, name: 'Germany' },
    linesCount: 4, bondedDays: 30, bondedVolumeCbm: 3, releaseStrategy: 're_export',
  });
  assert.equal(r.dutyDueEur, 0);
  assert.equal(r.vatDueEur, 0);
  assert.ok(r.cashflowBenefitEur > 5000); // savings = avoided duty + VAT
  assert.ok(r.totalCashOutEur < 1500); // bonded ops cost only
});

test('bonded free-circulation defers but does not avoid duty + VAT', () => {
  const r = calculateBondedWarehouse({
    customsValueEur: 80000, dutyRate: 0.035, vat: { rate: 0.23, name: 'Poland' },
    linesCount: 8, bondedDays: 180, bondedVolumeCbm: 25, releaseStrategy: 'free_circulation',
  });
  assert.ok(r.dutyDueEur > 0);
  assert.ok(r.vatDueEur > 0);
  // Cash-flow benefit should be cost-of-capital × deferred amount × time
  assert.ok(r.cashflowBenefitEur > 0);
  assert.ok(r.cashflowBenefitEur < (r.dutyDueEur + r.vatDueEur)); // can't exceed deferred amount
});

test('bonded breakdown for re-export shows duty and VAT as negative line items', () => {
  const r = calculateBondedWarehouse({
    customsValueEur: 10000, dutyRate: 0.10, vat: { rate: 0.20, name: 'France' },
    linesCount: 2, bondedDays: 7, bondedVolumeCbm: 1, releaseStrategy: 're_export',
  });
  const dutyAvoided = r.breakdown.find(b => /duty AVOIDED/i.test(b.label));
  const vatAvoided = r.breakdown.find(b => /VAT AVOIDED/i.test(b.label));
  assert.ok(dutyAvoided);
  assert.ok(vatAvoided);
  assert.ok(dutyAvoided.eur < 0);
  assert.ok(vatAvoided.eur < 0);
});

// ── calculateQuote integration ───────────────────────────

test('calculateQuote returns 2 quotes (standard + bonded) and a recommendation', () => {
  const r = calculateQuote({
    customsValueEur: 25000, hsCode: '6203', destinationCountry: 'DE', originCountry: 'CN',
    linesCount: 4, bondedDays: 0,
  });
  assert.equal(r.ok, true);
  assert.equal(r.quotes.length, 2);
  assert.ok(r.recommendation.primary);
});

test('calculateQuote: re-export bonded recommended over standard for sample shipments', () => {
  const r = calculateQuote({
    customsValueEur: 15000, hsCode: '95', destinationCountry: 'NL', originCountry: 'CN',
    linesCount: 3, bondedDays: 30, bondedVolumeCbm: 4, releaseStrategy: 're_export',
  });
  assert.equal(r.recommendation.primary, 'bonded_warehouse');
});

test('calculateQuote: short-hold deferral does NOT beat standard', () => {
  // 14-day hold on €25k apparel: cashflow benefit is small compared to bonded fees
  const r = calculateQuote({
    customsValueEur: 25000, hsCode: '6203', destinationCountry: 'DE', originCountry: 'CN',
    linesCount: 4, bondedDays: 14, bondedVolumeCbm: 3, releaseStrategy: 'free_circulation',
  });
  assert.equal(r.recommendation.primary, 'standard_clearance');
});

test('calculateQuote: VN preferential lowers duty rate vs CN baseline', () => {
  const cn = calculateQuote({ customsValueEur: 25000, hsCode: '6203', destinationCountry: 'DE', originCountry: 'CN', linesCount: 4 });
  const vn = calculateQuote({ customsValueEur: 25000, hsCode: '6203', destinationCountry: 'DE', originCountry: 'VN', linesCount: 4, claimPreferential: true });
  assert.ok(vn.duty.rate < cn.duty.rate);
  assert.ok(vn.quotes[0].totalEur < cn.quotes[0].totalEur);
});

test('calculateQuote: VAT differs by destination country', () => {
  const de = calculateQuote({ customsValueEur: 25000, hsCode: '6203', destinationCountry: 'DE', originCountry: 'CN', linesCount: 4 });
  const hu = calculateQuote({ customsValueEur: 25000, hsCode: '6203', destinationCountry: 'HU', originCountry: 'CN', linesCount: 4 });
  // Hungary 27% > Germany 19%, so HU total > DE total
  assert.ok(hu.quotes[0].totalEur > de.quotes[0].totalEur);
});

test('calculateQuote: rejects malformed input with structured errors', () => {
  const r = calculateQuote({});
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.errors));
  assert.ok(r.errors.length >= 2);
});

test('calculateQuote: includes bondedEducation block', () => {
  const r = calculateQuote({ customsValueEur: 25000, hsCode: '6203', destinationCountry: 'DE', originCountry: 'CN', linesCount: 4 });
  assert.ok(r.bondedEducation);
  assert.ok(r.bondedEducation.whatItIs);
  assert.ok(r.bondedEducation.whenItHelps);
  assert.ok(r.bondedEducation.whenItDoesntHelp);
  assert.ok(r.bondedEducation.typicalMix);
});

test('calculateQuote: returns nextSteps array of >=2', () => {
  const r = calculateQuote({ customsValueEur: 25000, hsCode: '6203', destinationCountry: 'DE', originCountry: 'CN', linesCount: 4 });
  assert.ok(Array.isArray(r.nextSteps));
  assert.ok(r.nextSteps.length >= 2);
});

test('calculateQuote: standard clearance landed cost = customs value + duty + vat (excl brokerage)', () => {
  const r = calculateQuote({ customsValueEur: 10000, hsCode: '6203', destinationCountry: 'DE', originCountry: 'TW', linesCount: 1 });
  const standard = r.quotes[0];
  assert.equal(standard.landedCostEur, 10000 + standard.dutyEur + standard.vatEur);
});

// ── Listing helpers ──────────────────────────────────────

test('listCountries returns all 27 EU members', () => {
  const list = listCountries();
  assert.equal(list.length, 27);
  for (const item of list) {
    assert.ok(item.code);
    assert.ok(item.name);
    assert.ok(Number.isFinite(item.vatRate));
  }
});

test('listOrigins includes major Asian sourcing markets', () => {
  const list = listOrigins();
  const codes = list.map(o => o.code);
  for (const c of ['CN', 'VN', 'IN', 'BD', 'PK', 'TR']) {
    assert.ok(codes.includes(c), `${c} present in origins list`);
  }
});

test('listHsChapters includes labels and rates', () => {
  const list = listHsChapters();
  assert.ok(list.length > 30);
  for (const item of list) {
    assert.ok(item.chapter);
    assert.ok(item.label);
    assert.ok(Number.isFinite(item.dutyRate));
  }
});
