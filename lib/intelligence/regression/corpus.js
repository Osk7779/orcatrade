// Sprint BG-9 — Calculator regression corpus.
//
// Canonical input scenarios pinned alongside frozen expected outputs in
// `__snapshots__/<slug>.json`. The first eight scenarios MIRROR the
// inputs of the eight customer-visible worked examples shipped under
// /examples/* (Sprint Y), so any drift between this corpus and the
// public pages fails the regression test loud. The remaining entries
// extend coverage into calculator branches the public examples do not
// exercise (FX hedge, severe working-capital cycle, bonded warehouse).
//
// Adding a scenario:
//   1. Append an entry below with a stable slug + fully-specified inputs.
//   2. Run: node scripts/regression-snapshot.js --scenario <slug>
//   3. Inspect the resulting __snapshots__/<slug>.json — every number
//      there is now part of the contract.
//   4. Commit corpus + snapshot together.
//
// Changing an existing scenario's inputs is a CONTRACT BREAK. Either
// add a new slug, or regenerate the snapshot and explain why in the
// commit message.

'use strict';

const CORPUS = Object.freeze([
  // ── /examples/* sentinel set (mirrors generate-example-plans.js) ──
  Object.freeze({
    slug: 'polish-apparel-importer-from-china',
    description: 'Apparel CN→PL — full MFN, no preferential, no trade defence.',
    inputs: Object.freeze({
      productCategory: 'apparel',
      originCountry: 'CN',
      destinationCountry: 'PL',
      customsValueEur: 25000,
      weightKg: 800,
      linesCount: 4,
      shipmentsPerYear: 12,
      monthlyOrders: 500,
    }),
  }),
  Object.freeze({
    slug: 'bangladesh-apparel-eba-zero-duty',
    description: 'Apparel BD→PL under EBA — REX statement drops duty to 0%.',
    inputs: Object.freeze({
      productCategory: 'apparel',
      originCountry: 'BD',
      destinationCountry: 'PL',
      customsValueEur: 50000,
      weightKg: 1500,
      linesCount: 4,
      claimPreferential: true,
      shipmentsPerYear: 12,
      monthlyOrders: 800,
    }),
  }),
  Object.freeze({
    slug: 'vietnam-electronics-evfta-zero-duty',
    description: 'Electronics VN→DE — EVFTA + CE/RoHS/WEEE stack.',
    inputs: Object.freeze({
      productCategory: 'electronics',
      originCountry: 'VN',
      destinationCountry: 'DE',
      customsValueEur: 50000,
      weightKg: 200,
      linesCount: 2,
      claimPreferential: true,
      shipmentsPerYear: 6,
      monthlyOrders: 200,
    }),
  }),
  Object.freeze({
    slug: 'chinese-ebike-importer-87pct-combined-ad-cvd',
    description: 'E-bikes CN→PL — AD 70.1% + CVD 17.2% stacked on 10% MFN.',
    inputs: Object.freeze({
      productCategory: 'machinery',
      originCountry: 'CN',
      destinationCountry: 'PL',
      customsValueEur: 100000,
      weightKg: 1500,
      hsCode: '8711.60',
      linesCount: 1,
      shipmentsPerYear: 6,
    }),
  }),
  Object.freeze({
    slug: 'cn-aluminium-cbam-plus-32pct-ad',
    description: 'Aluminium extrusions CN→DE — 32% AD layered with CBAM applicability.',
    inputs: Object.freeze({
      productCategory: 'machinery',
      originCountry: 'CN',
      destinationCountry: 'DE',
      customsValueEur: 75000,
      weightKg: 5000,
      hsCode: '7610.10',
      linesCount: 2,
      shipmentsPerYear: 8,
    }),
  }),
  Object.freeze({
    slug: 'turkey-cold-rolled-steel-atr-with-ad',
    description: 'Cold-rolled steel TR→DE — A.TR drops MFN to 0% but 23.3% AD remains.',
    inputs: Object.freeze({
      productCategory: 'machinery',
      originCountry: 'TR',
      destinationCountry: 'DE',
      customsValueEur: 100000,
      weightKg: 8000,
      hsCode: '7209.16',
      linesCount: 2,
      claimPreferential: true,
      shipmentsPerYear: 12,
    }),
  }),
  Object.freeze({
    slug: 'cosmetics-india-reach-cosmetics-regulation',
    description: 'Cosmetics IN→DE — GSP standard + Cosmetics Reg + REACH.',
    inputs: Object.freeze({
      productCategory: 'cosmetics',
      originCountry: 'IN',
      destinationCountry: 'DE',
      customsValueEur: 30000,
      weightKg: 600,
      hsCode: '3304.99',
      linesCount: 6,
      claimPreferential: true,
      shipmentsPerYear: 6,
    }),
  }),
  Object.freeze({
    slug: 'south-korea-machinery-eukfta-zero-duty',
    description: 'Machinery KR→PL — EUKFTA 0% duty + CE Machinery Regulation.',
    inputs: Object.freeze({
      productCategory: 'machinery',
      originCountry: 'KR',
      destinationCountry: 'PL',
      customsValueEur: 80000,
      weightKg: 4000,
      hsCode: '8479.89',
      linesCount: 1,
      claimPreferential: true,
      shipmentsPerYear: 4,
    }),
  }),
  // ── Edge-case scenarios beyond /examples/* ──
  Object.freeze({
    slug: 'fx-hedge-vn-usd-extended-payment-terms',
    description: 'VN apparel quoted USD with 120-day payment terms + 90 inventory days — exercises fx + working-capital severity path.',
    inputs: Object.freeze({
      productCategory: 'apparel',
      originCountry: 'VN',
      destinationCountry: 'DE',
      customsValueEur: 60000,
      weightKg: 1200,
      linesCount: 3,
      claimPreferential: true,
      shipmentsPerYear: 12,
      quoteCurrency: 'USD',
      paymentTermsDays: 120,
      daysInInventory: 90,
      daysReceivable: 45,
    }),
  }),
]);

const SLUGS = Object.freeze(CORPUS.map((s) => s.slug));

function findBySlug(slug) {
  return CORPUS.find((s) => s.slug === slug) || null;
}

module.exports = { CORPUS, SLUGS, findBySlug };
