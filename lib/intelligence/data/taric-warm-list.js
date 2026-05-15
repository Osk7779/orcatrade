// Curated list of HS×origin combinations to pre-warm in the TARIC KV
// cache. Picked from the categories the wizard already lets users pick,
// and from the AD/CVD measure database (those are the cases where the
// landed-cost answer changes the most when we get a precise rate).
//
// Goal: the first real user who supplies an 8+ digit HS code for any
// reasonable common product sees a cache HIT and renders the result
// without the 200–300ms upstream fetch.
//
// Approx 30 entries. Each is small (~1KB written to KV) so the total
// warm pass writes <50KB. Keep this list aligned with the eight wizard
// categories — if a new one is added, add representative HS codes here.

'use strict';

const WARM_LIST = [
  // ── Apparel & textiles (chapter 61 knitted / 62 woven) ──────────────
  { hs: '62034235', origin: 'CN', label: "Men's cotton trousers" },
  { hs: '62034235', origin: 'VN', label: "Men's cotton trousers · VN" },
  { hs: '62034235', origin: 'BD', label: "Men's cotton trousers · BD (EBA)" },
  { hs: '61091000', origin: 'CN', label: 'Cotton T-shirts' },
  { hs: '61091000', origin: 'BD', label: 'Cotton T-shirts · BD (EBA)' },
  { hs: '62019100', origin: 'CN', label: "Men's outerwear · wool" },

  // ── Consumer electronics (chapter 85) ───────────────────────────────
  { hs: '85171300', origin: 'CN', label: 'Smartphones' },
  { hs: '85285200', origin: 'CN', label: 'Monitors capable of data processing' },
  { hs: '85198100', origin: 'CN', label: 'Other sound-recording apparatus' },
  { hs: '85183000', origin: 'VN', label: 'Headphones / earbuds' },

  // ── Furniture & wood (chapter 94) ───────────────────────────────────
  { hs: '94036000', origin: 'CN', label: 'Wooden furniture · other' },
  { hs: '94036000', origin: 'VN', label: 'Wooden furniture · VN' },
  { hs: '94032000', origin: 'CN', label: 'Metal office / industrial furniture' },

  // ── Toys & childcare (chapter 95) ───────────────────────────────────
  { hs: '95030070', origin: 'CN', label: 'Other toys' },
  { hs: '95030049', origin: 'CN', label: 'Toy vehicles · scale models' },

  // ── Cosmetics & personal care (chapter 33) ──────────────────────────
  { hs: '33049900', origin: 'CN', label: 'Beauty / makeup preparations' },
  { hs: '33049900', origin: 'IN', label: 'Beauty / makeup preparations · IN' },
  { hs: '33051000', origin: 'CN', label: 'Shampoos' },

  // ── Homeware & kitchen (chapter 69/70/73) ───────────────────────────
  { hs: '69111000', origin: 'CN', label: 'Ceramic tableware (porcelain)' },
  { hs: '70133700', origin: 'CN', label: 'Glassware for table' },
  { hs: '73239300', origin: 'CN', label: 'Stainless steel kitchenware' },

  // ── Footwear (chapter 64) ───────────────────────────────────────────
  { hs: '64031900', origin: 'VN', label: 'Leather sports footwear' },
  { hs: '64041100', origin: 'CN', label: 'Sports footwear · textile upper' },

  // ── Machinery & industrial (chapter 84) ─────────────────────────────
  { hs: '84713000', origin: 'CN', label: 'Portable data processing machines' },
  { hs: '84818099', origin: 'CN', label: 'Taps, cocks, valves · other' },
  { hs: '84212100', origin: 'DE', label: 'Water-purifying machinery · DE' },

  // ── AD/CVD hot spots — where precise rates matter most ──────────────
  { hs: '87120030', origin: 'CN', label: 'Bicycles ex-CN (AD 48.5%)' },
  { hs: '87149110', origin: 'CN', label: 'Bicycle frames ex-CN (AD)' },
  { hs: '76042100', origin: 'CN', label: 'Aluminium extrusions · hollow profiles' },
  { hs: '76101090', origin: 'CN', label: 'Aluminium structures' },
  { hs: '73079200', origin: 'CN', label: 'Iron/steel pipe fittings' },
];

module.exports = { WARM_LIST };
