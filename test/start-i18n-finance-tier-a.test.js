'use strict';

// Finance tier_a email-block tests. Parallel to test/start-i18n-tier-a
// (customs PR #92), test/start-i18n-sourcing-tier-a (sourcing PR #111),
// and test/start-i18n-routing-tier-a (routing PR #115). Same wording
// discipline.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const i18n = require(path.join(ROOT, 'lib', 'start-i18n'));

const ELIGIBLE_VERDICT = Object.freeze({
  eligible: true,
  evaluatedAtIso: '2026-06-09T12:00:00.000Z',
  schemaVersion: 1,
});

const INELIGIBLE_VERDICT = Object.freeze({
  eligible: false,
  failedReason: 'non-primary-source-TA2',
  evaluatedAtIso: '2026-06-09T12:00:00.000Z',
  schemaVersion: 1,
});

const financeLocaleMeta = [
  { name: 'en', fn: i18n.tierABlockFinanceEn, headline: 'TIER-A · UNDERWRITER-GRADE FINANCING RECOMMENDATION' },
  { name: 'pl', fn: i18n.tierABlockFinancePl, headline: 'TIER-A · REKOMENDACJA FINANSOWANIA POZIOMU UNDERWRITERSKIEGO' },
  { name: 'de', fn: i18n.tierABlockFinanceDe, headline: 'TIER-A · UNDERWRITER-GRADE-FINANZIERUNGSEMPFEHLUNG' },
];

for (const { name, fn, headline } of financeLocaleMeta) {
  test(`${name} finance: returns the badge when eligible:true`, () => {
    const out = fn(ELIGIBLE_VERDICT);
    assert.ok(out.includes(headline), `${name} finance badge missing headline. Got: ${out.slice(0, 80)}…`);
  });

  test(`${name} finance: returns '' when eligible:false`, () => {
    assert.equal(fn(INELIGIBLE_VERDICT), '');
  });

  test(`${name} finance: returns '' when verdict is null or undefined`, () => {
    assert.equal(fn(null), '');
    assert.equal(fn(undefined), '');
  });
}

// ── Wording discipline ──────────────────────────────────────────────

test('all finance locale badges describe the guarantee as FORTHCOMING, not active', () => {
  const forthcomingMarkers = {
    en: /Q1 2027|forthcoming|launches|subject to binding/i,
    pl: /Q1 2027|wystartuje|w trakcie wiązania/i,
    de: /Q1 2027|startet|vorbehaltlich der Bindung/i,
  };
  for (const { name, fn } of financeLocaleMeta) {
    const out = fn(ELIGIBLE_VERDICT);
    assert.match(out, forthcomingMarkers[name], `${name} finance badge must call out the guarantee as forthcoming`);
  }
});

test('no finance locale badge claims an active financial guarantee', () => {
  const prohibited = [
    /\bguaranteed\b accuracy/i,
    /backed by .* guarantee\b(?! launches| subject to binding| starting Q1 2027)/i,
    /money[- ]back/i,
    /we will refund/i,
  ];
  for (const { name, fn } of financeLocaleMeta) {
    const out = fn(ELIGIBLE_VERDICT);
    for (const re of prohibited) {
      assert.doesNotMatch(out, re, `${name} finance badge contains prohibited phrase matching ${re}`);
    }
  }
});

test('finance-specific subject is named (not generic "duty calculation" / "sourcing" / "routing")', () => {
  const financeSubjects = {
    en: /financing recommendation/i,
    pl: /rekomendacja finansowania|rekomendacj[ąa] finansowania/i,
    de: /Finanzierungsempfehlung/,
  };
  for (const { name, fn } of financeLocaleMeta) {
    const out = fn(ELIGIBLE_VERDICT);
    assert.match(out, financeSubjects[name], `${name} finance badge must name its calculator-specific subject`);
  }
});

test('finance badges cite central-bank rate tables (not carrier indices / TARIC / trade indices)', () => {
  // Sanity guard: the finance badge must not copy/paste the routing
  // ("carrier-published rate indices") or customs ("EU TARIC live
  // rates") subject. Each calculator's eligibility narrative names
  // its own primary-regulator source.
  const rateSubject = {
    en: /central-bank rate tables/i,
    pl: /tabele kursowe banków centralnych/i,
    de: /zentralbankseitige Kurstabellen/,
  };
  for (const { name, fn } of financeLocaleMeta) {
    const out = fn(ELIGIBLE_VERDICT);
    assert.match(out, rateSubject[name], `${name} finance badge must cite central-bank rate tables`);
    assert.doesNotMatch(out, /carrier-published rate indices/i, `${name}: must not borrow routing's subject`);
    assert.doesNotMatch(out, /TARIC live rates/i, `${name}: must not borrow customs's subject`);
  }
});

// ── Integration with userBody templates ───────────────────────────────

function fakePlan({ customsVerdict, sourcingVerdict, routingVerdict, financeVerdict }) {
  return {
    sourcing: {
      recommendation: { primary: 'CN' },
      yourOriginRisk: null,
      comparison: [],
      tier_a: sourcingVerdict,
    },
    routing: {
      recommendation: { primary: 'sea_fcl' },
      modes: [],
      tier_a: routingVerdict,
    },
    customs: {
      ok: true,
      duty: {},
      vat: {},
      standard: {},
      bonded: {},
      recommendation: { primary: 'standard_clearance' },
      tradeDefenceMeasures: [],
      preferentialApplied: null,
      preferentialAvailable: null,
      preferentialSavingEur: 0,
      tier_a: customsVerdict,
    },
    finance: {
      ok: true,
      recommendation: { preferredKey: 'tt_split_30_70', instrument: {}, reason: 'fake' },
      instruments: [],
      paymentEducation: {},
      tier_a: financeVerdict,
    },
    warehouse: null,
    compliance: { regimes: [] },
    fx: null,
    tco: null,
    workingCapital: null,
    originSensitivity: { savingEurVsUserOrigin: 0, savingPctVsUserOrigin: 0, matrix: [] },
  };
}

const FAKE_INPUTS = Object.freeze({
  productCategory: 'apparel',
  originCountry: 'CN',
  destinationCountry: 'DE',
  customsValueEur: 50000,
  weightKg: 800,
});

const FAKE_TOTALS = Object.freeze({
  transportEur: 1200,
  dutyEur: 1300,
  vatEur: 9800,
  brokerageEur: 70,
  perShipmentLandedTotal: 62370,
});

const integrationMeta = [
  { name: 'en', financeHeadline: 'TIER-A · UNDERWRITER-GRADE FINANCING RECOMMENDATION', routingHeadline: 'TIER-A · UNDERWRITER-GRADE FREIGHT QUOTE', sourcingHeadline: 'TIER-A · UNDERWRITER-GRADE SOURCING COMPARISON', customsHeadline: 'TIER-A · UNDERWRITER-GRADE CALCULATION' },
  { name: 'pl', financeHeadline: 'TIER-A · REKOMENDACJA FINANSOWANIA POZIOMU UNDERWRITERSKIEGO', routingHeadline: 'TIER-A · WYCENA FRACHTU POZIOMU UNDERWRITERSKIEGO', sourcingHeadline: 'TIER-A · PORÓWNANIE ŹRÓDEŁ POZIOMU UNDERWRITERSKIEGO', customsHeadline: 'TIER-A · KALKULACJA POZIOMU UNDERWRITERSKIEGO' },
  { name: 'de', financeHeadline: 'TIER-A · UNDERWRITER-GRADE-FINANZIERUNGSEMPFEHLUNG', routingHeadline: 'TIER-A · UNDERWRITER-GRADE-FRACHTANGEBOT', sourcingHeadline: 'TIER-A · UNDERWRITER-GRADE-SOURCING-VERGLEICH', customsHeadline: 'TIER-A · UNDERWRITER-GRADE-KALKULATION' },
];

for (const { name, financeHeadline, routingHeadline, sourcingHeadline, customsHeadline } of integrationMeta) {
  test(`${name}: userBody contains the finance badge when plan.finance.tier_a.eligible === true`, () => {
    const body = i18n.STRINGS[name].userBody({
      inputs: FAKE_INPUTS,
      plan: fakePlan({ customsVerdict: null, sourcingVerdict: null, routingVerdict: null, financeVerdict: ELIGIBLE_VERDICT }),
      totals: FAKE_TOTALS,
      name: '',
      shareUrl: 'https://orcatrade.pl/start/?p=x',
      siteOrigin: 'https://orcatrade.pl',
    });
    assert.ok(body.includes(financeHeadline), `${name} userBody missing finance headline`);
  });

  test(`${name}: userBody does NOT contain the finance badge when finance eligible:false`, () => {
    const body = i18n.STRINGS[name].userBody({
      inputs: FAKE_INPUTS,
      plan: fakePlan({ customsVerdict: null, sourcingVerdict: null, routingVerdict: null, financeVerdict: INELIGIBLE_VERDICT }),
      totals: FAKE_TOTALS,
      name: '',
      shareUrl: 'https://orcatrade.pl/start/?p=x',
      siteOrigin: 'https://orcatrade.pl',
    });
    assert.ok(!body.includes(financeHeadline));
  });

  test(`${name}: userBody contains ALL FOUR badges when all four eligible (wedge compounds)`, () => {
    const body = i18n.STRINGS[name].userBody({
      inputs: FAKE_INPUTS,
      plan: fakePlan({
        customsVerdict: ELIGIBLE_VERDICT,
        sourcingVerdict: ELIGIBLE_VERDICT,
        routingVerdict: ELIGIBLE_VERDICT,
        financeVerdict: ELIGIBLE_VERDICT,
      }),
      totals: FAKE_TOTALS,
      name: '',
      shareUrl: 'https://orcatrade.pl/start/?p=x',
      siteOrigin: 'https://orcatrade.pl',
    });
    assert.ok(body.includes(customsHeadline), `${name} userBody missing customs headline (PR #92 regression)`);
    assert.ok(body.includes(sourcingHeadline), `${name} userBody missing sourcing headline (PR #111 regression)`);
    assert.ok(body.includes(routingHeadline), `${name} userBody missing routing headline (PR #115 regression)`);
    assert.ok(body.includes(financeHeadline), `${name} userBody missing finance headline`);
    // Document order: customs → sourcing → routing → finance. Matches
    // the largest-line-item ordering — duty + sourcing + freight are
    // the three biggest landed-cost drivers; finance follows.
    assert.ok(
      body.indexOf(customsHeadline) < body.indexOf(sourcingHeadline) &&
        body.indexOf(sourcingHeadline) < body.indexOf(routingHeadline) &&
        body.indexOf(routingHeadline) < body.indexOf(financeHeadline),
      `${name}: badges must render in customs → sourcing → routing → finance order`,
    );
  });
}
