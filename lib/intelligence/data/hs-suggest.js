// HS-code suggestion — Sprint hs-suggest-v1.
//
// Most SME importers don't know their 8-digit commodity code, so they
// leave the wizard's HS field blank and get the chapter-level duty
// estimate. This curated keyword→HS6 map lets them describe their
// product in plain words and pick a suggested commodity code, which
// then flows into the live-TARIC-refined duty path (the system already
// fetches the real heading rate when a 6+ digit code is present).
//
// Design rules:
//   - HS6 only. The first 6 digits are the globally-harmonised System
//     level — stable, well-documented, verifiable. We deliberately do
//     NOT invent EU CN8 suffixes (less stable, easy to get wrong). The
//     TARIC client resolves an HS6 to its heading MFN rate via the
//     /headings/<4-digit> fallback, so HS6 is enough to beat the
//     chapter estimate.
//   - This is a SUGGESTION aid, not a binding classification. The user
//     confirms the pick (they see the label), and the duty rate still
//     comes from live TARIC — never from a number in this file.
//   - Coverage targets the 8 wizard categories + the worked-example
//     specials (bicycles/e-bikes, steel, aluminium).
//
// Each entry: { hs6, label, chapter, keywords:[...] }. Matching is a
// pure token-overlap scorer (suggest()) — no LLM, no I/O.

'use strict';

const HS_ENTRIES = Object.freeze([
  // ── Apparel & textiles (50–63) ──
  { hs6: '610910', label: 'T-shirts & vests, knitted, of cotton', chapter: '61', keywords: ['t-shirt', 'tshirt', 'tee', 'vest', 'singlet', 'cotton', 'knitted', 'top'] },
  { hs6: '610990', label: 'T-shirts & vests, knitted, other textiles', chapter: '61', keywords: ['t-shirt', 'tshirt', 'tee', 'vest', 'polyester', 'synthetic', 'knitted'] },
  { hs6: '611020', label: 'Jerseys, pullovers, sweaters, knitted, of cotton', chapter: '61', keywords: ['sweater', 'jumper', 'pullover', 'jersey', 'hoodie', 'sweatshirt', 'cardigan', 'cotton', 'knitted'] },
  { hs6: '620342', label: "Men's/boys' trousers & shorts, of cotton (woven)", chapter: '62', keywords: ['trousers', 'pants', 'jeans', 'shorts', 'chinos', 'mens', 'cotton', 'woven'] },
  { hs6: '620462', label: "Women's/girls' trousers & shorts, of cotton (woven)", chapter: '62', keywords: ['trousers', 'pants', 'jeans', 'shorts', 'womens', 'ladies', 'cotton', 'woven'] },
  { hs6: '620520', label: "Men's/boys' shirts, of cotton (woven)", chapter: '62', keywords: ['shirt', 'mens', 'cotton', 'woven', 'dress shirt'] },
  { hs6: '620640', label: "Women's blouses & shirts, of man-made fibres", chapter: '62', keywords: ['blouse', 'shirt', 'womens', 'ladies', 'synthetic', 'polyester'] },
  { hs6: '620193', label: 'Anoraks, windcheaters, jackets, of man-made fibres', chapter: '62', keywords: ['jacket', 'coat', 'anorak', 'windbreaker', 'outerwear', 'parka'] },
  { hs6: '611120', label: "Babies' garments & clothing, of cotton, knitted", chapter: '61', keywords: ['baby', 'babies', 'infant', 'romper', 'onesie', 'cotton'] },
  { hs6: '630260', label: 'Toilet & kitchen linen, of cotton (towels)', chapter: '63', keywords: ['towel', 'towels', 'kitchen linen', 'bath', 'cotton'] },
  { hs6: '630231', label: 'Bed linen, of cotton', chapter: '63', keywords: ['bed linen', 'bedsheet', 'sheets', 'duvet', 'pillowcase', 'bedding', 'cotton'] },
  { hs6: '611610', label: 'Gloves, knitted, impregnated/coated', chapter: '61', keywords: ['gloves', 'glove', 'mittens'] },
  { hs6: '650500', label: 'Hats & headgear, knitted or made up from textile', chapter: '65', keywords: ['hat', 'cap', 'beanie', 'headgear', 'headwear'] },

  // ── Footwear (64) ──
  { hs6: '640299', label: 'Footwear, rubber/plastic uppers, other', chapter: '64', keywords: ['shoes', 'sandals', 'flip-flops', 'sliders', 'rubber', 'plastic', 'footwear'] },
  { hs6: '640411', label: 'Sports footwear, textile uppers (trainers/sneakers)', chapter: '64', keywords: ['trainers', 'sneakers', 'sports shoes', 'running shoes', 'textile', 'footwear'] },
  { hs6: '640419', label: 'Footwear, textile uppers, other', chapter: '64', keywords: ['shoes', 'canvas shoes', 'textile', 'espadrilles', 'footwear'] },
  { hs6: '640399', label: 'Footwear, leather uppers, other', chapter: '64', keywords: ['leather shoes', 'boots', 'leather', 'footwear', 'loafers'] },
  { hs6: '640351', label: 'Footwear covering the ankle, leather (boots)', chapter: '64', keywords: ['boots', 'leather boots', 'ankle boots', 'footwear'] },

  // ── Consumer electronics (84/85) ──
  { hs6: '851713', label: 'Smartphones', chapter: '85', keywords: ['smartphone', 'phone', 'mobile', 'iphone', 'android', 'cellphone'] },
  { hs6: '847130', label: 'Portable computers (laptops, tablets) < 10 kg', chapter: '84', keywords: ['laptop', 'notebook', 'tablet', 'ipad', 'computer', 'macbook', 'portable computer'] },
  { hs6: '847180', label: 'Computer units & peripherals, other', chapter: '84', keywords: ['computer', 'desktop', 'pc', 'peripheral', 'keyboard', 'mouse'] },
  { hs6: '851830', label: 'Headphones, earphones & headsets', chapter: '85', keywords: ['headphones', 'earphones', 'earbuds', 'headset', 'airpods', 'audio'] },
  { hs6: '851762', label: 'Routers, switches, network apparatus', chapter: '85', keywords: ['router', 'switch', 'network', 'wifi', 'modem', 'access point'] },
  { hs6: '850440', label: 'Static converters (chargers, power supplies, adapters)', chapter: '85', keywords: ['charger', 'power supply', 'adapter', 'psu', 'power bank', 'converter'] },
  { hs6: '850760', label: 'Lithium-ion accumulators (batteries)', chapter: '85', keywords: ['battery', 'batteries', 'lithium', 'li-ion', 'accumulator', 'cell'] },
  { hs6: '852580', label: 'Cameras (television, digital, video camera recorders)', chapter: '85', keywords: ['camera', 'webcam', 'video camera', 'cctv', 'security camera'] },
  { hs6: '852872', label: 'Television receivers, colour (TVs, monitors)', chapter: '85', keywords: ['tv', 'television', 'monitor', 'display', 'screen'] },
  { hs6: '851829', label: 'Loudspeakers', chapter: '85', keywords: ['speaker', 'speakers', 'loudspeaker', 'bluetooth speaker', 'soundbar'] },
  { hs6: '950450', label: 'Video game consoles & machines', chapter: '95', keywords: ['console', 'playstation', 'xbox', 'nintendo', 'game console', 'gaming'] },

  // ── Furniture & wood (94/44) ──
  { hs6: '940161', label: 'Seats with wooden frames, upholstered (sofas, armchairs)', chapter: '94', keywords: ['sofa', 'couch', 'armchair', 'upholstered', 'seat', 'chair', 'wooden'] },
  { hs6: '940360', label: 'Wooden furniture, other (tables, shelving)', chapter: '94', keywords: ['table', 'desk', 'shelf', 'shelving', 'cabinet', 'wooden furniture', 'wood'] },
  { hs6: '940350', label: 'Wooden bedroom furniture (beds, wardrobes)', chapter: '94', keywords: ['bed', 'bedframe', 'wardrobe', 'dresser', 'nightstand', 'bedroom', 'wooden'] },
  { hs6: '940330', label: 'Wooden office furniture', chapter: '94', keywords: ['office furniture', 'office desk', 'filing cabinet', 'wooden'] },
  { hs6: '940370', label: 'Furniture of plastics', chapter: '94', keywords: ['plastic furniture', 'plastic chair', 'plastic table', 'garden furniture'] },
  { hs6: '940540', label: 'Lamps & lighting fittings, electric, other', chapter: '94', keywords: ['lamp', 'light', 'lighting', 'led light', 'fixture', 'luminaire'] },
  { hs6: '441900', label: 'Tableware & kitchenware, of wood', chapter: '44', keywords: ['wooden tableware', 'cutting board', 'wooden spoon', 'wood kitchenware'] },

  // ── Toys & childcare (95) ──
  { hs6: '950300', label: 'Toys (dolls, models, puzzles, tricycles, kits)', chapter: '95', keywords: ['toy', 'toys', 'doll', 'puzzle', 'model', 'tricycle', 'building blocks', 'lego', 'plush', 'figurine'] },
  { hs6: '950662', label: 'Inflatable balls (sports)', chapter: '95', keywords: ['ball', 'football', 'basketball', 'inflatable ball'] },
  { hs6: '871500', label: "Baby carriages (prams, strollers) & parts", chapter: '87', keywords: ['pram', 'stroller', 'pushchair', 'buggy', 'baby carriage'] },
  { hs6: '940190', label: 'Parts of seats (incl. child car seats components)', chapter: '94', keywords: ['car seat', 'child seat', 'booster seat'] },

  // ── Cosmetics & personal care (33/34) ──
  { hs6: '330499', label: 'Beauty / skincare preparations, other (creams, lotions)', chapter: '33', keywords: ['cream', 'skincare', 'lotion', 'moisturiser', 'serum', 'cosmetic', 'beauty', 'face cream'] },
  { hs6: '330491', label: 'Make-up powders (incl. compacts)', chapter: '33', keywords: ['powder', 'makeup', 'foundation', 'blusher', 'compact', 'cosmetic'] },
  { hs6: '330300', label: 'Perfumes & toilet waters', chapter: '33', keywords: ['perfume', 'fragrance', 'cologne', 'eau de toilette', 'scent'] },
  { hs6: '330510', label: 'Shampoos', chapter: '33', keywords: ['shampoo', 'hair wash'] },
  { hs6: '330590', label: 'Hair preparations, other (conditioner, gel, spray)', chapter: '33', keywords: ['conditioner', 'hair gel', 'hairspray', 'hair product'] },
  { hs6: '340130', label: 'Organic surface-active products (liquid soap, body wash)', chapter: '34', keywords: ['soap', 'body wash', 'shower gel', 'hand wash', 'liquid soap'] },

  // ── Homeware & kitchen (39/69/70/73/82) ──
  { hs6: '691200', label: 'Ceramic tableware & kitchenware', chapter: '69', keywords: ['ceramic', 'plates', 'bowls', 'mug', 'crockery', 'porcelain', 'dinnerware', 'tableware'] },
  { hs6: '701337', label: 'Glassware for table/kitchen, other (glasses, jars)', chapter: '70', keywords: ['glass', 'glassware', 'drinking glass', 'tumbler', 'jar', 'wine glass'] },
  { hs6: '732393', label: 'Table/kitchen articles of stainless steel', chapter: '73', keywords: ['stainless steel', 'pots', 'pans', 'cookware', 'steel kitchenware', 'saucepan'] },
  { hs6: '392410', label: 'Tableware & kitchenware, of plastics', chapter: '39', keywords: ['plastic tableware', 'plastic plates', 'plastic containers', 'tupperware', 'lunchbox'] },
  { hs6: '821599', label: 'Spoons, forks, ladles & similar kitchen/tableware', chapter: '82', keywords: ['cutlery', 'spoon', 'fork', 'knife set', 'flatware', 'utensils'] },

  // ── Machinery & industrial / appliances (84/85) ──
  { hs6: '841810', label: 'Combined refrigerator-freezers', chapter: '84', keywords: ['fridge', 'refrigerator', 'freezer', 'fridge-freezer'] },
  { hs6: '845011', label: 'Washing machines, automatic, dry linen ≤ 10 kg', chapter: '84', keywords: ['washing machine', 'washer', 'laundry machine'] },
  { hs6: '850811', label: 'Vacuum cleaners, ≤ 1500 W', chapter: '85', keywords: ['vacuum', 'hoover', 'vacuum cleaner'] },
  { hs6: '841451', label: 'Table/floor/wall fans, electric, ≤ 125 W', chapter: '84', keywords: ['fan', 'electric fan', 'desk fan', 'cooling fan'] },
  { hs6: '850980', label: 'Electro-mechanical domestic appliances, other', chapter: '85', keywords: ['blender', 'mixer', 'food processor', 'kitchen appliance', 'kettle', 'toaster'] },
  { hs6: '847989', label: 'Machines & mechanical appliances, other', chapter: '84', keywords: ['machine', 'machinery', 'mechanical', 'industrial equipment', 'apparatus'] },

  // ── Worked-example specials (trade defence) ──
  { hs6: '871200', label: 'Bicycles & cycles, non-motorised', chapter: '87', keywords: ['bicycle', 'bike', 'cycle', 'pushbike'] },
  { hs6: '871160', label: 'Electric bicycles (e-bikes), with auxiliary motor', chapter: '87', keywords: ['e-bike', 'ebike', 'electric bicycle', 'electric bike', 'pedelec'] },
  { hs6: '720839', label: 'Flat-rolled iron/steel, hot-rolled, coils', chapter: '72', keywords: ['steel', 'flat-rolled steel', 'hot-rolled', 'steel coil', 'hr coil'] },
  { hs6: '721049', label: 'Flat-rolled steel, coated/galvanised', chapter: '72', keywords: ['galvanised steel', 'coated steel', 'cold-rolled', 'steel sheet'] },
  { hs6: '760429', label: 'Aluminium bars, rods & profiles', chapter: '76', keywords: ['aluminium', 'aluminum', 'aluminium profile', 'extrusion', 'aluminium bar'] },
  { hs6: '761010', label: 'Aluminium doors, windows & frames', chapter: '76', keywords: ['aluminium window', 'aluminium door', 'window frame', 'aluminium frame'] },
]);

// Tokenise a free-text query into lowercase word tokens (length ≥ 2).
function tokenise(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

// Score one entry against the query tokens. A token "hits" an entry when
// it appears as a substring of any keyword OR of the label. Multi-word
// keywords (e.g. "washing machine") count when the whole query contains
// them. Returns an integer score (higher = better).
function scoreEntry(entry, queryTokens, rawQuery) {
  let score = 0;
  const hay = entry.keywords.concat([entry.label.toLowerCase()]);
  for (const token of queryTokens) {
    for (const kw of hay) {
      if (kw === token) { score += 3; break; }          // exact token match
      if (kw.includes(token) || token.includes(kw)) { score += 1; break; } // partial
    }
  }
  // Bonus when a full multi-word keyword phrase appears in the raw query.
  for (const kw of entry.keywords) {
    if (kw.includes(' ') && rawQuery.includes(kw)) score += 2;
  }
  return score;
}

// Suggest commodity codes for a plain-language product description OR a
// partial HS-digit query. Returns up to `limit` candidates, best first:
//   [{ hs6, label, chapter, score }]
function suggest(query, { limit = 6 } = {}) {
  const raw = String(query || '').toLowerCase().trim();
  if (!raw) return [];

  // Digit query: if the user typed ≥ 2 digits, match by HS prefix. Since
  // every hs6 starts with its 2-digit chapter, a pure prefix match covers
  // both a 2-digit chapter query ("85") and a longer heading query
  // ("6109") without polluting the latter with whole-chapter matches.
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 2 && /^[\d\s.]+$/.test(raw)) {
    return HS_ENTRIES
      .filter((e) => e.hs6.startsWith(digits))
      .slice(0, limit)
      .map((e) => ({ hs6: e.hs6, label: e.label, chapter: e.chapter, score: 0 }));
  }

  const tokens = tokenise(raw);
  if (!tokens.length) return [];
  const scored = HS_ENTRIES
    .map((e) => ({ entry: e, score: scoreEntry(e, tokens, raw) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.label.length - b.entry.label.length);
  return scored.slice(0, limit).map((s) => ({
    hs6: s.entry.hs6, label: s.entry.label, chapter: s.entry.chapter, score: s.score,
  }));
}

module.exports = { HS_ENTRIES, tokenise, scoreEntry, suggest };
