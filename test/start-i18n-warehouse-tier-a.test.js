'use strict';

// Warehouse tier_a email-block tests. Parallel to test/start-i18n-
// tier-a (customs PR #92), test/start-i18n-sourcing-tier-a (sourcing
// PR #111), test/start-i18n-routing-tier-a (routing PR #115), and
// test/start-i18n-finance-tier-a (finance PR #117). Closes the
// email-layer wedge at 5/5. Same wording discipline.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const i18n = require(path.join(ROOT, 'lib', 'start-i18n'));

const ELIGIBLE_VERDICT = Object.freeze({
  eligible: true,
  evaluatedAtIso: '2026-06-11T12:00:00.000Z',
  schemaVersion: 1,
});

const INELIGIBLE_VERDICT = Object.freeze({
  eligible: false,
  failedReason: 'non-primary-source-TA2',
  evaluatedAtIso: '2026-06-11T12:00:00.000Z',
  schemaVersion: 1,
});

const warehouseLocaleMeta = [
  { name: 'en', fn: i18n.tierABlockWarehouseEn, headline: 'TIER-A · UNDERWRITER-GRADE WAREHOUSE QUOTE' },
  { name: 'pl', fn: i18n.tierABlockWarehousePl, headline: 'TIER-A · WYCENA MAGAZYNU POZIOMU UNDERWRITERSKIEGO' },
  { name: 'de', fn: i18n.tierABlockWarehouseDe, headline: 'TIER-A · UNDERWRITER-GRADE-LAGERANGEBOT' },
];

for (const { name, fn, headline } of warehouseLocaleMeta) {
  test(`${name} warehouse: returns the badge when eligible:true`, () => {
    const out = fn(ELIGIBLE_VERDICT);
    assert.ok(out.includes(headline), `${name} warehouse badge missing headline. Got: ${out.slice(0, 80)}…`);
  });

  test(`${name} warehouse: returns '' when eligible:false`, () => {
    assert.equal(fn(INELIGIBLE_VERDICT), '');
  });

  test(`${name} warehouse: returns '' when verdict is null or undefined`, () => {
    assert.equal(fn(null), '');
    assert.equal(fn(undefined), '');
  });
}

// ── Wording discipline ──────────────────────────────────────────────

test('all warehouse locale badges describe the guarantee as FORTHCOMING, not active', () => {
  const forthcomingMarkers = {
    en: /Q1 2027|forthcoming|launches|subject to binding/i,
    pl: /Q1 2027|wystartuje|w trakcie wiązania/i,
    de: /Q1 2027|startet|vorbehaltlich der Bindung/i,
  };
  for (const { name, fn } of warehouseLocaleMeta) {
    const out = fn(ELIGIBLE_VERDICT);
    assert.match(out, forthcomingMarkers[name], `${name} warehouse badge must call out the guarantee as forthcoming`);
  }
});

test('no warehouse locale badge claims an active financial guarantee', () => {
  const prohibited = [
    /\bguaranteed\b accuracy/i,
    /backed by .* guarantee\b(?! launches| subject to binding| starting Q1 2027)/i,
    /money[- ]back/i,
    /we will refund/i,
  ];
  for (const { name, fn } of warehouseLocaleMeta) {
    const out = fn(ELIGIBLE_VERDICT);
    for (const re of prohibited) {
      assert.doesNotMatch(out, re, `${name} warehouse badge contains prohibited phrase matching ${re}`);
    }
  }
});

test('warehouse-specific subject is named (not duty/sourcing/routing/finance)', () => {
  const warehouseSubjects = {
    en: /warehouse recommendation/i,
    pl: /rekomendacja magazynu|rekomendacj[ąa] magazynu/i,
    de: /Lager-Empfehlung/,
  };
  for (const { name, fn } of warehouseLocaleMeta) {
    const out = fn(ELIGIBLE_VERDICT);
    assert.match(out, warehouseSubjects[name], `${name} warehouse badge must name its calculator-specific subject`);
  }
});

test('warehouse badges cite Eurostat warehousing PPI (not central-bank tables / TARIC / carrier indices)', () => {
  // Sanity guard: warehouse must not borrow another calculator's
  // primary-regulator narrative. Each calculator's eligibility names
  // its own source.
  // The DE phrase wraps across lines in the body
  // (`EU-Eurostat-Lagerhaltungs-\nProduzentenpreisindizes`). The `\s*`
  // tolerates that line break without coupling the test to the exact
  // wrap column.
  const rateSubject = {
    en: /Eurostat warehousing producer-price indices/i,
    pl: /indeksy cen producenckich magazynowania/i,
    de: /Eurostat-Lagerhaltungs-\s*Produzentenpreisindizes/,
  };
  for (const { name, fn } of warehouseLocaleMeta) {
    const out = fn(ELIGIBLE_VERDICT);
    assert.match(out, rateSubject[name], `${name} warehouse badge must cite Eurostat warehousing PPI`);
    assert.doesNotMatch(out, /carrier-published rate indices/i, `${name}: must not borrow routing's subject`);
    assert.doesNotMatch(out, /TARIC live rates/i, `${name}: must not borrow customs's subject`);
    assert.doesNotMatch(out, /central-bank rate tables/i, `${name}: must not borrow finance's subject`);
  }
});

// ── Integration with userBody templates ───────────────────────────────

function fakePlan({ customsVerdict, sourcingVerdict, routingVerdict, financeVerdict, warehouseVerdict }) {
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
    warehouse: warehouseVerdict !== undefined
      ? { ok: true, recommendation: { primary: 'NL_ROT' }, recommendedHub: {}, hubs: [], tier_a: warehouseVerdict }
      : { skipped: true, reason: 'Monthly order volume not provided — warehouse leg omitted from plan.' },
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
  { name: 'en', warehouseHeadline: 'TIER-A · UNDERWRITER-GRADE WAREHOUSE QUOTE', financeHeadline: 'TIER-A · UNDERWRITER-GRADE FINANCING RECOMMENDATION', routingHeadline: 'TIER-A · UNDERWRITER-GRADE FREIGHT QUOTE', sourcingHeadline: 'TIER-A · UNDERWRITER-GRADE SOURCING COMPARISON', customsHeadline: 'TIER-A · UNDERWRITER-GRADE CALCULATION' },
  { name: 'pl', warehouseHeadline: 'TIER-A · WYCENA MAGAZYNU POZIOMU UNDERWRITERSKIEGO', financeHeadline: 'TIER-A · REKOMENDACJA FINANSOWANIA POZIOMU UNDERWRITERSKIEGO', routingHeadline: 'TIER-A · WYCENA FRACHTU POZIOMU UNDERWRITERSKIEGO', sourcingHeadline: 'TIER-A · PORÓWNANIE ŹRÓDEŁ POZIOMU UNDERWRITERSKIEGO', customsHeadline: 'TIER-A · KALKULACJA POZIOMU UNDERWRITERSKIEGO' },
  { name: 'de', warehouseHeadline: 'TIER-A · UNDERWRITER-GRADE-LAGERANGEBOT', financeHeadline: 'TIER-A · UNDERWRITER-GRADE-FINANZIERUNGSEMPFEHLUNG', routingHeadline: 'TIER-A · UNDERWRITER-GRADE-FRACHTANGEBOT', sourcingHeadline: 'TIER-A · UNDERWRITER-GRADE-SOURCING-VERGLEICH', customsHeadline: 'TIER-A · UNDERWRITER-GRADE-KALKULATION' },
];

for (const { name, warehouseHeadline, financeHeadline, routingHeadline, sourcingHeadline, customsHeadline } of integrationMeta) {
  test(`${name}: userBody contains the warehouse badge when plan.warehouse.tier_a.eligible === true`, () => {
    const body = i18n.STRINGS[name].userBody({
      inputs: FAKE_INPUTS,
      plan: fakePlan({ customsVerdict: null, sourcingVerdict: null, routingVerdict: null, financeVerdict: null, warehouseVerdict: ELIGIBLE_VERDICT }),
      totals: FAKE_TOTALS,
      name: '',
      shareUrl: 'https://orcatrade.pl/start/?p=x',
      siteOrigin: 'https://orcatrade.pl',
    });
    assert.ok(body.includes(warehouseHeadline), `${name} userBody missing warehouse headline`);
  });

  test(`${name}: userBody does NOT contain the warehouse badge when warehouse eligible:false`, () => {
    const body = i18n.STRINGS[name].userBody({
      inputs: FAKE_INPUTS,
      plan: fakePlan({ customsVerdict: null, sourcingVerdict: null, routingVerdict: null, financeVerdict: null, warehouseVerdict: INELIGIBLE_VERDICT }),
      totals: FAKE_TOTALS,
      name: '',
      shareUrl: 'https://orcatrade.pl/start/?p=x',
      siteOrigin: 'https://orcatrade.pl',
    });
    assert.ok(!body.includes(warehouseHeadline));
  });

  test(`${name}: userBody does NOT contain the warehouse badge when warehouse is in skipped state`, () => {
    // Skipped state edge case unique to warehouse: when the wizard
    // caller leaves monthlyOrders blank, plan.warehouse has the
    // shape { skipped: true, reason: '...' } — no tier_a key. The
    // helper must handle this gracefully (returns '').
    const body = i18n.STRINGS[name].userBody({
      inputs: FAKE_INPUTS,
      plan: fakePlan({ customsVerdict: null, sourcingVerdict: null, routingVerdict: null, financeVerdict: null }),
      totals: FAKE_TOTALS,
      name: '',
      shareUrl: 'https://orcatrade.pl/start/?p=x',
      siteOrigin: 'https://orcatrade.pl',
    });
    assert.ok(!body.includes(warehouseHeadline));
  });

  test(`${name}: userBody contains ALL FIVE badges when all five eligible (wedge fully compounds)`, () => {
    const body = i18n.STRINGS[name].userBody({
      inputs: FAKE_INPUTS,
      plan: fakePlan({
        customsVerdict: ELIGIBLE_VERDICT,
        sourcingVerdict: ELIGIBLE_VERDICT,
        routingVerdict: ELIGIBLE_VERDICT,
        financeVerdict: ELIGIBLE_VERDICT,
        warehouseVerdict: ELIGIBLE_VERDICT,
      }),
      totals: FAKE_TOTALS,
      name: '',
      shareUrl: 'https://orcatrade.pl/start/?p=x',
      siteOrigin: 'https://orcatrade.pl',
    });
    assert.ok(body.includes(customsHeadline), `${name} userBody missing customs headline (PR #92 regression)`);
    assert.ok(body.includes(sourcingHeadline), `${name} userBody missing sourcing headline (PR #111 regression)`);
    assert.ok(body.includes(routingHeadline), `${name} userBody missing routing headline (PR #115 regression)`);
    assert.ok(body.includes(financeHeadline), `${name} userBody missing finance headline (PR #117 regression)`);
    assert.ok(body.includes(warehouseHeadline), `${name} userBody missing warehouse headline`);
    // Document order: customs → sourcing → routing → finance →
    // warehouse. Matches the financial-impact ordering and the
    // sequence the calculators run in start.js.
    assert.ok(
      body.indexOf(customsHeadline) < body.indexOf(sourcingHeadline) &&
        body.indexOf(sourcingHeadline) < body.indexOf(routingHeadline) &&
        body.indexOf(routingHeadline) < body.indexOf(financeHeadline) &&
        body.indexOf(financeHeadline) < body.indexOf(warehouseHeadline),
      `${name}: badges must render in customs → sourcing → routing → finance → warehouse order`,
    );
  });
}
