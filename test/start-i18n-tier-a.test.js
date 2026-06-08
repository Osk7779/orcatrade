'use strict';

// Tier-A badge tests for the plan-email i18n templates (lib/start-i18n.js).
//
// Pins that:
//   - the badge appears in EN/PL/DE userBody only when
//     plan.customs.tier_a.eligible === true
//   - the badge is silent when eligible:false or tier_a is null/undefined
//   - the wording does NOT make a financial-guarantee claim before E&O
//     is bound (per docs/strategic-plan-2026-2031.md §5.1 + the
//     [feedback_corp_standard] + [pre_revenue_stage] memory rules)

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const i18n = require(path.join(ROOT, 'lib', 'start-i18n'));

const ELIGIBLE_VERDICT = Object.freeze({
  eligible: true,
  evaluatedAtIso: '2026-06-08T12:00:00.000Z',
  schemaVersion: 1,
});

const INELIGIBLE_VERDICT = Object.freeze({
  eligible: false,
  failedReason: 'non-primary-source-TA2',
  detail: { snapshotId: 's', actualSourceKind: 'mirror', requiredSourceKind: 'primary_regulator' },
  evaluatedAtIso: '2026-06-08T12:00:00.000Z',
  schemaVersion: 1,
});

// ── Block-level (each locale's helper) ────────────────────────────────

const localeMeta = [
  { name: 'en', fn: i18n.tierABlockEn, headline: 'TIER-A · UNDERWRITER-GRADE CALCULATION' },
  { name: 'pl', fn: i18n.tierABlockPl, headline: 'TIER-A · KALKULACJA POZIOMU UNDERWRITERSKIEGO' },
  { name: 'de', fn: i18n.tierABlockDe, headline: 'TIER-A · UNDERWRITER-GRADE-KALKULATION' },
];

for (const { name, fn, headline } of localeMeta) {
  test(`${name}: tierABlock returns the badge when eligible:true`, () => {
    const out = fn(ELIGIBLE_VERDICT);
    assert.ok(out.includes(headline), `${name} badge missing headline. Got: ${out.slice(0, 80)}…`);
  });

  test(`${name}: tierABlock returns '' when eligible:false`, () => {
    assert.equal(fn(INELIGIBLE_VERDICT), '', `${name} badge must NOT render on ineligible verdict`);
  });

  test(`${name}: tierABlock returns '' when verdict is null`, () => {
    assert.equal(fn(null), '');
  });

  test(`${name}: tierABlock returns '' when verdict is undefined`, () => {
    assert.equal(fn(undefined), '');
  });
}

// ── Wording discipline: NO claim of a bound guarantee ─────────────────

test('all locale badges describe the guarantee as FORTHCOMING, not active', () => {
  // Honesty rule per memory: every claim ships with its enforcement.
  // E&O is not bound until Q1 2027 — until then, the badge must mark
  // the guarantee as forthcoming. A bare "backed by our guarantee"
  // line would be false marketing.
  const forthcomingMarkers = {
    en: /Q1 2027|forthcoming|launches|subject to binding/i,
    pl: /Q1 2027|wystartuje|w trakcie wiązania/i,
    de: /Q1 2027|startet|vorbehaltlich der Bindung/i,
  };
  for (const { name, fn } of localeMeta) {
    const out = fn(ELIGIBLE_VERDICT);
    assert.match(out, forthcomingMarkers[name], `${name} badge must call out the guarantee as forthcoming`);
  }
});

test('no locale badge claims an active financial guarantee', () => {
  // Tight prohibited-phrase list. If a future PR adds phrasing that
  // implies the guarantee is already active, this test catches it.
  const prohibited = [
    /\bguaranteed\b accuracy/i,
    /backed by .* guarantee\b(?! launches| subject to binding| starting Q1 2027)/i,
    /money[- ]back/i,
    /we will refund/i,
  ];
  for (const { name, fn } of localeMeta) {
    const out = fn(ELIGIBLE_VERDICT);
    for (const re of prohibited) {
      assert.doesNotMatch(out, re, `${name} badge contains a prohibited active-guarantee phrase matching ${re}`);
    }
  }
});

// ── Integration with userBody templates ───────────────────────────────

function fakePlan(tierAVerdict) {
  return {
    sourcing: { recommendation: { primary: 'CN' } },
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
      tier_a: tierAVerdict,
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
  productCategory: 'electronics',
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

const localeIntegrationMeta = [
  { name: 'en', headline: 'TIER-A · UNDERWRITER-GRADE CALCULATION' },
  { name: 'pl', headline: 'TIER-A · KALKULACJA POZIOMU UNDERWRITERSKIEGO' },
  { name: 'de', headline: 'TIER-A · UNDERWRITER-GRADE-KALKULATION' },
];

for (const { name, headline } of localeIntegrationMeta) {
  test(`${name}: userBody contains the badge when plan.customs.tier_a.eligible === true`, () => {
    const body = i18n.STRINGS[name].userBody({
      inputs: FAKE_INPUTS,
      plan: fakePlan(ELIGIBLE_VERDICT),
      totals: FAKE_TOTALS,
      name: 'Anna',
      shareUrl: 'https://orcatrade.pl/start/?p=x',
      siteOrigin: 'https://orcatrade.pl',
    });
    assert.ok(body.includes(headline), `${name} userBody missing Tier-A headline on eligible:true`);
  });

  test(`${name}: userBody does NOT contain the badge when eligible:false`, () => {
    const body = i18n.STRINGS[name].userBody({
      inputs: FAKE_INPUTS,
      plan: fakePlan(INELIGIBLE_VERDICT),
      totals: FAKE_TOTALS,
      name: '',
      shareUrl: 'https://orcatrade.pl/start/?p=x',
      siteOrigin: 'https://orcatrade.pl',
    });
    assert.ok(!body.includes(headline), `${name} userBody must NOT include Tier-A headline on eligible:false`);
  });

  test(`${name}: userBody does NOT contain the badge when tier_a is null`, () => {
    const body = i18n.STRINGS[name].userBody({
      inputs: FAKE_INPUTS,
      plan: fakePlan(null),
      totals: FAKE_TOTALS,
      name: '',
      shareUrl: 'https://orcatrade.pl/start/?p=x',
      siteOrigin: 'https://orcatrade.pl',
    });
    assert.ok(!body.includes(headline), `${name} userBody must NOT include Tier-A headline when tier_a is null`);
  });

  test(`${name}: userBody preserves the LANDED COST section regardless of badge state`, () => {
    // Catches the regression where the insert point of the badge swallows
    // adjacent content. Both eligible and ineligible bodies must still
    // contain the landed-cost block headline.
    const landedHeadings = { en: 'LANDED COST', pl: 'KOSZT LANDED', de: 'LANDED COST' };
    for (const verdict of [ELIGIBLE_VERDICT, INELIGIBLE_VERDICT, null]) {
      const body = i18n.STRINGS[name].userBody({
        inputs: FAKE_INPUTS,
        plan: fakePlan(verdict),
        totals: FAKE_TOTALS,
        name: '',
        shareUrl: 'https://orcatrade.pl/start/?p=x',
        siteOrigin: 'https://orcatrade.pl',
      });
      assert.ok(
        body.includes(landedHeadings[name]),
        `${name} userBody dropped its LANDED COST heading when tier_a=${JSON.stringify(verdict && verdict.eligible)}`,
      );
    }
  });
}
