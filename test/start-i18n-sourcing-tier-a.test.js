'use strict';

// Sourcing tier_a email-block tests. Parallel to
// test/start-i18n-tier-a.test.js (which covers the customs blocks
// from PR #92). Same wording discipline: forthcoming-guarantee
// language present, prohibited active-guarantee phrases absent.

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

// ── Block-level (each locale's helper) ────────────────────────────────

const sourcingLocaleMeta = [
  { name: 'en', fn: i18n.tierABlockSourcingEn, headline: 'TIER-A · UNDERWRITER-GRADE SOURCING COMPARISON' },
  { name: 'pl', fn: i18n.tierABlockSourcingPl, headline: 'TIER-A · PORÓWNANIE ŹRÓDEŁ POZIOMU UNDERWRITERSKIEGO' },
  { name: 'de', fn: i18n.tierABlockSourcingDe, headline: 'TIER-A · UNDERWRITER-GRADE-SOURCING-VERGLEICH' },
];

for (const { name, fn, headline } of sourcingLocaleMeta) {
  test(`${name} sourcing: returns the badge when eligible:true`, () => {
    const out = fn(ELIGIBLE_VERDICT);
    assert.ok(out.includes(headline), `${name} sourcing badge missing headline. Got: ${out.slice(0, 80)}…`);
  });

  test(`${name} sourcing: returns '' when eligible:false`, () => {
    assert.equal(fn(INELIGIBLE_VERDICT), '');
  });

  test(`${name} sourcing: returns '' when verdict is null or undefined`, () => {
    assert.equal(fn(null), '');
    assert.equal(fn(undefined), '');
  });
}

// ── Wording discipline: NO claim of a bound guarantee ─────────────────

test('all sourcing locale badges describe the guarantee as FORTHCOMING, not active', () => {
  const forthcomingMarkers = {
    en: /Q1 2027|forthcoming|launches|subject to binding/i,
    pl: /Q1 2027|wystartuje|w trakcie wiązania/i,
    de: /Q1 2027|startet|vorbehaltlich der Bindung/i,
  };
  for (const { name, fn } of sourcingLocaleMeta) {
    const out = fn(ELIGIBLE_VERDICT);
    assert.match(out, forthcomingMarkers[name], `${name} sourcing badge must call out the guarantee as forthcoming`);
  }
});

test('no sourcing locale badge claims an active financial guarantee', () => {
  const prohibited = [
    /\bguaranteed\b accuracy/i,
    /backed by .* guarantee\b(?! launches| subject to binding| starting Q1 2027)/i,
    /money[- ]back/i,
    /we will refund/i,
  ];
  for (const { name, fn } of sourcingLocaleMeta) {
    const out = fn(ELIGIBLE_VERDICT);
    for (const re of prohibited) {
      assert.doesNotMatch(out, re, `${name} sourcing badge contains a prohibited active-guarantee phrase matching ${re}`);
    }
  }
});

test('sourcing-specific subject is named (not generic "duty calculation" reused)', () => {
  // Cross-language phrases that name sourcing-specific subjects in
  // each locale.
  const sourcingSubjects = {
    en: /sourcing recommendation/i,
    pl: /rekomendacja sourcingowa|rekomendacj[ąa] sourcingow/i,
    de: /Sourcing-Empfehlung/,
  };
  for (const { name, fn } of sourcingLocaleMeta) {
    const out = fn(ELIGIBLE_VERDICT);
    assert.match(out, sourcingSubjects[name], `${name} sourcing badge must name its calculator-specific subject`);
  }
});

// ── Integration with userBody templates ───────────────────────────────

function fakePlan({ customsVerdict, sourcingVerdict }) {
  return {
    sourcing: {
      recommendation: { primary: 'CN' },
      yourOriginRisk: null,
      comparison: [],
      tier_a: sourcingVerdict,
    },
    routing: { recommendation: { primary: 'sea_fcl' } },
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
  { name: 'en', sourcingHeadline: 'TIER-A · UNDERWRITER-GRADE SOURCING COMPARISON', customsHeadline: 'TIER-A · UNDERWRITER-GRADE CALCULATION' },
  { name: 'pl', sourcingHeadline: 'TIER-A · PORÓWNANIE ŹRÓDEŁ POZIOMU UNDERWRITERSKIEGO', customsHeadline: 'TIER-A · KALKULACJA POZIOMU UNDERWRITERSKIEGO' },
  { name: 'de', sourcingHeadline: 'TIER-A · UNDERWRITER-GRADE-SOURCING-VERGLEICH', customsHeadline: 'TIER-A · UNDERWRITER-GRADE-KALKULATION' },
];

for (const { name, sourcingHeadline, customsHeadline } of integrationMeta) {
  test(`${name}: userBody contains the sourcing badge when plan.sourcing.tier_a.eligible === true`, () => {
    const body = i18n.STRINGS[name].userBody({
      inputs: FAKE_INPUTS,
      plan: fakePlan({ customsVerdict: null, sourcingVerdict: ELIGIBLE_VERDICT }),
      totals: FAKE_TOTALS,
      name: 'Anna',
      shareUrl: 'https://orcatrade.pl/start/?p=x',
      siteOrigin: 'https://orcatrade.pl',
    });
    assert.ok(body.includes(sourcingHeadline), `${name} userBody missing sourcing headline`);
  });

  test(`${name}: userBody does NOT contain the sourcing badge when sourcing eligible:false`, () => {
    const body = i18n.STRINGS[name].userBody({
      inputs: FAKE_INPUTS,
      plan: fakePlan({ customsVerdict: null, sourcingVerdict: INELIGIBLE_VERDICT }),
      totals: FAKE_TOTALS,
      name: '',
      shareUrl: 'https://orcatrade.pl/start/?p=x',
      siteOrigin: 'https://orcatrade.pl',
    });
    assert.ok(!body.includes(sourcingHeadline));
  });

  test(`${name}: userBody contains BOTH badges when both eligible (the wedge compounds)`, () => {
    const body = i18n.STRINGS[name].userBody({
      inputs: FAKE_INPUTS,
      plan: fakePlan({ customsVerdict: ELIGIBLE_VERDICT, sourcingVerdict: ELIGIBLE_VERDICT }),
      totals: FAKE_TOTALS,
      name: 'Anna',
      shareUrl: 'https://orcatrade.pl/start/?p=x',
      siteOrigin: 'https://orcatrade.pl',
    });
    assert.ok(body.includes(customsHeadline), `${name} userBody missing customs headline (PR #92 regression)`);
    assert.ok(body.includes(sourcingHeadline), `${name} userBody missing sourcing headline`);
    // Customs comes first (immediately after CASH CONVERSION CYCLE
    // section), then sourcing. Ordering check guards against an
    // accidental reorder.
    assert.ok(
      body.indexOf(customsHeadline) < body.indexOf(sourcingHeadline),
      `${name}: customs badge must come before sourcing badge`,
    );
  });

  test(`${name}: userBody preserves the LANDED COST section regardless of any combination of badge states`, () => {
    const landedHeadings = { en: 'LANDED COST', pl: 'KOSZT LANDED', de: 'LANDED COST' };
    const combos = [
      { customs: null, sourcing: null },
      { customs: ELIGIBLE_VERDICT, sourcing: null },
      { customs: null, sourcing: ELIGIBLE_VERDICT },
      { customs: ELIGIBLE_VERDICT, sourcing: ELIGIBLE_VERDICT },
    ];
    for (const { customs, sourcing } of combos) {
      const body = i18n.STRINGS[name].userBody({
        inputs: FAKE_INPUTS,
        plan: fakePlan({ customsVerdict: customs, sourcingVerdict: sourcing }),
        totals: FAKE_TOTALS,
        name: '',
        shareUrl: 'https://orcatrade.pl/start/?p=x',
        siteOrigin: 'https://orcatrade.pl',
      });
      assert.ok(
        body.includes(landedHeadings[name]),
        `${name} userBody dropped LANDED COST heading on customs=${customs?.eligible}/sourcing=${sourcing?.eligible}`,
      );
    }
  });
}
