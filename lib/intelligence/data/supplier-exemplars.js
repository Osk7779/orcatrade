// Supplier directory — anonymised exemplars (Sprint H4).
//
// Why anonymised:
//   - We do not yet operate a live marketplace; the directory is a shell
//     that signals what a future curated network will look like.
//   - Listing real suppliers without their consent + a vetting pipeline
//     would be a credibility liability if any one of them disappointed.
//   - Importers want to see *the shape* of the network (categories, regions,
//     vetting depth, MOQ range) before committing to an introduction
//     request — that's what these exemplars deliver.
//
// Each entry is a composite drawn from publicly-known industry profiles
// — ranges and certifications are typical of vetted Asian manufacturers
// in that vertical. Country distribution roughly reflects the EU import
// flow we model elsewhere (CN ~50%, VN ~15%, IN ~10%, BD ~10%, KR ~5%, etc.)

'use strict';

const EXEMPLARS = Object.freeze([
  Object.freeze({
    id: 'ex_001',
    category: 'Apparel — woven',
    country: 'VN',
    region: 'Ho Chi Minh City + Long An',
    yearsOperating: 15,
    moqRange: '1,000 – 50,000 units',
    leadTimeWeeks: '8 – 12',
    certifications: ['OEKO-TEX 100', 'BSCI', 'WRAP'],
    capabilities: ['Cut-and-sew', 'Sublimation print', 'In-house QC'],
    preferentialOriginEligible: true,
    notes: 'Eligible for EVFTA preferential origin with EUR.1; track record on EU-bound shipments.',
  }),
  Object.freeze({
    id: 'ex_002',
    category: 'Apparel — knitwear',
    country: 'BD',
    region: 'Dhaka',
    yearsOperating: 22,
    moqRange: '3,000 – 100,000 units',
    leadTimeWeeks: '10 – 14',
    certifications: ['OEKO-TEX 100', 'GOTS', 'BSCI', 'Accord/RSC'],
    capabilities: ['Circular knit', 'Reactive dye', 'Compliance lab in-house'],
    preferentialOriginEligible: true,
    notes: 'EBA preferential — duty-free entry to EU under GSP+; LDC graduation 2026 will impact this.',
  }),
  Object.freeze({
    id: 'ex_003',
    category: 'Footwear — leather',
    country: 'IN',
    region: 'Chennai + Ambur',
    yearsOperating: 30,
    moqRange: '500 – 20,000 pairs',
    leadTimeWeeks: '10 – 14',
    certifications: ['LWG (Leather Working Group)', 'Sedex'],
    capabilities: ['Goodyear welt', 'Cement construction', 'Custom lasts'],
    preferentialOriginEligible: true,
    notes: 'EU GSP standard rate applies; CHEM/REACH compliance for leather aniline dyes.',
  }),
  Object.freeze({
    id: 'ex_004',
    category: 'Electronics — consumer',
    country: 'CN',
    region: 'Shenzhen + Dongguan',
    yearsOperating: 18,
    moqRange: '500 – 10,000 units',
    leadTimeWeeks: '6 – 10',
    certifications: ['ISO 9001', 'ISO 14001', 'CE/FCC compliance'],
    capabilities: ['SMT line', 'Plastic injection', 'Tooling'],
    preferentialOriginEligible: false,
    notes: 'Standard MFN duty for HS 85; assess RoHS + WEEE for EU placement.',
  }),
  Object.freeze({
    id: 'ex_005',
    category: 'Electronics — components (PCBA)',
    country: 'TW',
    region: 'Taipei + Hsinchu',
    yearsOperating: 25,
    moqRange: '1,000 – 50,000 units',
    leadTimeWeeks: '4 – 8',
    certifications: ['ISO 9001', 'IATF 16949 (automotive)', 'IPC-A-610 Class 3'],
    capabilities: ['HDI PCB', 'Auto-pick-and-place', 'AOI + X-ray'],
    preferentialOriginEligible: false,
    notes: 'Higher cost, lower defect rate; preferred for safety-critical end-use.',
  }),
  Object.freeze({
    id: 'ex_006',
    category: 'Cosmetics — skincare',
    country: 'KR',
    region: 'Gyeonggi-do',
    yearsOperating: 12,
    moqRange: '500 – 10,000 units',
    leadTimeWeeks: '6 – 10',
    certifications: ['ISO 22716 (GMP)', 'CPNP-aware', 'Cruelty-free'],
    capabilities: ['Private label', 'Custom formulation', 'Stability + challenge testing'],
    preferentialOriginEligible: true,
    notes: 'EU-Korea FTA preferential origin; CPNP notification required before sale.',
  }),
  Object.freeze({
    id: 'ex_007',
    category: 'Furniture — case goods',
    country: 'VN',
    region: 'Binh Duong',
    yearsOperating: 17,
    moqRange: '50 – 2,000 units (per SKU)',
    leadTimeWeeks: '10 – 14',
    certifications: ['FSC', 'BSCI', 'Fumigation cert'],
    capabilities: ['Solid wood + veneer', 'Hand-finish', 'Container loading optimisation'],
    preferentialOriginEligible: true,
    notes: 'EVFTA preferential origin; EUDR scope from 2025 — geolocation polygons required.',
  }),
  Object.freeze({
    id: 'ex_008',
    category: 'Toys — plush',
    country: 'CN',
    region: 'Yangzhou',
    yearsOperating: 20,
    moqRange: '1,000 – 30,000 units',
    leadTimeWeeks: '8 – 12',
    certifications: ['EN-71 lab partner', 'ICTI Care'],
    capabilities: ['Custom plush', 'Embroidery', 'BB/POM stuffing'],
    preferentialOriginEligible: false,
    notes: 'EN-71 mechanical + chemical; CE marking required for toys.',
  }),
  Object.freeze({
    id: 'ex_009',
    category: 'Homeware — ceramics',
    country: 'CN',
    region: 'Jiangsu',
    yearsOperating: 28,
    moqRange: '500 – 20,000 units',
    leadTimeWeeks: '8 – 12',
    certifications: ['LFGB / FDA food-contact', 'BSCI'],
    capabilities: ['Bone china + porcelain', 'Hand-paint', 'Decal'],
    preferentialOriginEligible: false,
    notes: 'AD measures may apply (table-and-kitchenware ceramics) — confirm rate per manufacturer.',
  }),
  Object.freeze({
    id: 'ex_010',
    category: 'Machinery — small engineered',
    country: 'CN',
    region: 'Zhejiang',
    yearsOperating: 16,
    moqRange: '10 – 500 units',
    leadTimeWeeks: '12 – 16',
    certifications: ['ISO 9001', 'CE Machinery Directive 2006/42/EC ready'],
    capabilities: ['CNC machining', 'Welding', 'Custom assembly'],
    preferentialOriginEligible: false,
    notes: 'CE Machinery declaration of conformity + technical file required.',
  }),
  Object.freeze({
    id: 'ex_011',
    category: 'Machinery — small engineered',
    country: 'KR',
    region: 'Daegu + Ulsan',
    yearsOperating: 35,
    moqRange: '5 – 200 units',
    leadTimeWeeks: '14 – 20',
    certifications: ['ISO 9001', 'KS Mark', 'CE Machinery'],
    capabilities: ['Precision CNC', 'In-house tooling', 'After-sales service network in EU'],
    preferentialOriginEligible: true,
    notes: 'EU-Korea FTA; higher unit price, EU-grade documentation maturity.',
  }),
  Object.freeze({
    id: 'ex_012',
    category: 'Steel — cold-rolled',
    country: 'TR',
    region: 'Marmara',
    yearsOperating: 40,
    moqRange: '20 – 500 t',
    leadTimeWeeks: '6 – 10',
    certifications: ['ISO 9001', 'CE EN 10130'],
    capabilities: ['Cold-rolling + slitting', 'Galvanising'],
    preferentialOriginEligible: true,
    notes: 'A.TR Customs Union — does NOT waive AD on Türkiye-origin CR steel; check current measure.',
  }),
  Object.freeze({
    id: 'ex_013',
    category: 'Cosmetics — colour',
    country: 'IT',
    region: 'Lombardy + Crema',
    yearsOperating: 22,
    moqRange: '500 – 10,000 units',
    leadTimeWeeks: '6 – 8',
    certifications: ['ISO 22716', 'CPNP-ready'],
    capabilities: ['Lipstick + mascara filling', 'Custom shades', 'EU-resident Responsible Person'],
    preferentialOriginEligible: false,
    notes: 'Intra-EU; no customs friction. Often the right hub for "made-in-EU" positioning.',
  }),
  Object.freeze({
    id: 'ex_014',
    category: 'Apparel — performance / activewear',
    country: 'VN',
    region: 'Hanoi + Hung Yen',
    yearsOperating: 11,
    moqRange: '500 – 20,000 units',
    leadTimeWeeks: '10 – 14',
    certifications: ['OEKO-TEX 100', 'Bluesign', 'Higg FEM'],
    capabilities: ['Bonded seams', 'Sublimation', 'Stretch fabric expertise'],
    preferentialOriginEligible: true,
    notes: 'EVFTA preferential; rule of origin requires fabric forming in VN or another EVFTA-eligible origin.',
  }),
  Object.freeze({
    id: 'ex_015',
    category: 'E-bike + e-scooter',
    country: 'VN',
    region: 'Haiphong',
    yearsOperating: 8,
    moqRange: '50 – 2,000 units',
    leadTimeWeeks: '10 – 14',
    certifications: ['ISO 9001', 'EN 15194 ready', 'UN 38.3 (battery)'],
    capabilities: ['Frame welding', 'Battery pack assembly', 'Final QC line'],
    preferentialOriginEligible: true,
    notes: 'EVFTA preferential; battery pack origin matters for AD/CVD on completed e-bikes.',
  }),
]);

const COUNTRIES = Array.from(new Set(EXEMPLARS.map(e => e.country))).sort();
const CATEGORIES = Array.from(new Set(EXEMPLARS.map(e => e.category))).sort();

function listExemplars({ category = null, country = null } = {}) {
  return EXEMPLARS.filter(e =>
    (!category || e.category === category) &&
    (!country || e.country === country)
  );
}

module.exports = {
  EXEMPLARS,
  COUNTRIES,
  CATEGORIES,
  listExemplars,
};
