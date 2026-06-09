'use strict';

// Routing tier_a email-block tests. Parallel to test/start-i18n-tier-a
// (customs PR #92) and test/start-i18n-sourcing-tier-a (sourcing
// PR #111). Same wording discipline.

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

const routingLocaleMeta = [
  { name: 'en', fn: i18n.tierABlockRoutingEn, headline: 'TIER-A · UNDERWRITER-GRADE FREIGHT QUOTE' },
  { name: 'pl', fn: i18n.tierABlockRoutingPl, headline: 'TIER-A · WYCENA FRACHTU POZIOMU UNDERWRITERSKIEGO' },
  { name: 'de', fn: i18n.tierABlockRoutingDe, headline: 'TIER-A · UNDERWRITER-GRADE-FRACHTANGEBOT' },
];

for (const { name, fn, headline } of routingLocaleMeta) {
  test(`${name} routing: returns the badge when eligible:true`, () => {
    const out = fn(ELIGIBLE_VERDICT);
    assert.ok(out.includes(headline), `${name} routing badge missing headline. Got: ${out.slice(0, 80)}…`);
  });

  test(`${name} routing: returns '' when eligible:false`, () => {
    assert.equal(fn(INELIGIBLE_VERDICT), '');
  });

  test(`${name} routing: returns '' when verdict is null or undefined`, () => {
    assert.equal(fn(null), '');
    assert.equal(fn(undefined), '');
  });
}

// ── Wording discipline ──────────────────────────────────────────────

test('all routing locale badges describe the guarantee as FORTHCOMING, not active', () => {
  const forthcomingMarkers = {
    en: /Q1 2027|forthcoming|launches|subject to binding/i,
    pl: /Q1 2027|wystartuje|w trakcie wiązania/i,
    de: /Q1 2027|startet|vorbehaltlich der Bindung/i,
  };
  for (const { name, fn } of routingLocaleMeta) {
    const out = fn(ELIGIBLE_VERDICT);
    assert.match(out, forthcomingMarkers[name], `${name} routing badge must call out the guarantee as forthcoming`);
  }
});

test('no routing locale badge claims an active financial guarantee', () => {
  const prohibited = [
    /\bguaranteed\b accuracy/i,
    /backed by .* guarantee\b(?! launches| subject to binding| starting Q1 2027)/i,
    /money[- ]back/i,
    /we will refund/i,
  ];
  for (const { name, fn } of routingLocaleMeta) {
    const out = fn(ELIGIBLE_VERDICT);
    for (const re of prohibited) {
      assert.doesNotMatch(out, re, `${name} routing badge contains prohibited phrase matching ${re}`);
    }
  }
});

test('routing-specific subject is named (not generic "duty calculation" or "sourcing recommendation")', () => {
  const routingSubjects = {
    en: /routing recommendation/i,
    pl: /rekomendacja routingu|rekomendacj[ąa] routing/i,
    de: /Routing-Empfehlung/,
  };
  for (const { name, fn } of routingLocaleMeta) {
    const out = fn(ELIGIBLE_VERDICT);
    assert.match(out, routingSubjects[name], `${name} routing badge must name its calculator-specific subject`);
  }
});

// ── Integration with userBody templates ───────────────────────────────

function fakePlan({ customsVerdict, sourcingVerdict, routingVerdict }) {
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
  { name: 'en', routingHeadline: 'TIER-A · UNDERWRITER-GRADE FREIGHT QUOTE', sourcingHeadline: 'TIER-A · UNDERWRITER-GRADE SOURCING COMPARISON', customsHeadline: 'TIER-A · UNDERWRITER-GRADE CALCULATION' },
  { name: 'pl', routingHeadline: 'TIER-A · WYCENA FRACHTU POZIOMU UNDERWRITERSKIEGO', sourcingHeadline: 'TIER-A · PORÓWNANIE ŹRÓDEŁ POZIOMU UNDERWRITERSKIEGO', customsHeadline: 'TIER-A · KALKULACJA POZIOMU UNDERWRITERSKIEGO' },
  { name: 'de', routingHeadline: 'TIER-A · UNDERWRITER-GRADE-FRACHTANGEBOT', sourcingHeadline: 'TIER-A · UNDERWRITER-GRADE-SOURCING-VERGLEICH', customsHeadline: 'TIER-A · UNDERWRITER-GRADE-KALKULATION' },
];

for (const { name, routingHeadline, sourcingHeadline, customsHeadline } of integrationMeta) {
  test(`${name}: userBody contains the routing badge when plan.routing.tier_a.eligible === true`, () => {
    const body = i18n.STRINGS[name].userBody({
      inputs: FAKE_INPUTS,
      plan: fakePlan({ customsVerdict: null, sourcingVerdict: null, routingVerdict: ELIGIBLE_VERDICT }),
      totals: FAKE_TOTALS,
      name: '',
      shareUrl: 'https://orcatrade.pl/start/?p=x',
      siteOrigin: 'https://orcatrade.pl',
    });
    assert.ok(body.includes(routingHeadline), `${name} userBody missing routing headline`);
  });

  test(`${name}: userBody does NOT contain the routing badge when routing eligible:false`, () => {
    const body = i18n.STRINGS[name].userBody({
      inputs: FAKE_INPUTS,
      plan: fakePlan({ customsVerdict: null, sourcingVerdict: null, routingVerdict: INELIGIBLE_VERDICT }),
      totals: FAKE_TOTALS,
      name: '',
      shareUrl: 'https://orcatrade.pl/start/?p=x',
      siteOrigin: 'https://orcatrade.pl',
    });
    assert.ok(!body.includes(routingHeadline));
  });

  test(`${name}: userBody contains ALL THREE badges when all three eligible (wedge compounds)`, () => {
    const body = i18n.STRINGS[name].userBody({
      inputs: FAKE_INPUTS,
      plan: fakePlan({ customsVerdict: ELIGIBLE_VERDICT, sourcingVerdict: ELIGIBLE_VERDICT, routingVerdict: ELIGIBLE_VERDICT }),
      totals: FAKE_TOTALS,
      name: '',
      shareUrl: 'https://orcatrade.pl/start/?p=x',
      siteOrigin: 'https://orcatrade.pl',
    });
    assert.ok(body.includes(customsHeadline), `${name} userBody missing customs headline (PR #92 regression)`);
    assert.ok(body.includes(sourcingHeadline), `${name} userBody missing sourcing headline (PR #111 regression)`);
    assert.ok(body.includes(routingHeadline), `${name} userBody missing routing headline`);
    // Document order: customs first, then sourcing, then routing —
    // matches the financial-impact ordering (duty + sourcing decisions
    // are the largest line items; routing is the third).
    assert.ok(
      body.indexOf(customsHeadline) < body.indexOf(sourcingHeadline) &&
        body.indexOf(sourcingHeadline) < body.indexOf(routingHeadline),
      `${name}: badges must render in customs → sourcing → routing order`,
    );
  });
}
