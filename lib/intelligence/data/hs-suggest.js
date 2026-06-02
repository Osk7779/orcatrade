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

  // ── Sprint hs-suggest-expand-v1 — broader common-SME coverage.
  //    HS6 only, restricted to chapters already in the duty table so a
  //    suggested code always has a chapter-fallback rate.

  // Food & beverage (09/17/18/19/21/22)
  { hs6: '090121', label: 'Coffee, roasted (not decaffeinated)', chapter: '09', keywords: ['coffee', 'roasted coffee', 'coffee beans', 'ground coffee'] },
  { hs6: '090230', label: 'Black tea (fermented), packings ≤ 3 kg', chapter: '09', keywords: ['tea', 'black tea', 'loose tea', 'tea bags'] },
  { hs6: '091099', label: 'Spices & seasoning mixtures, other', chapter: '09', keywords: ['spices', 'seasoning', 'spice blend', 'herbs'] },
  { hs6: '170490', label: 'Sugar confectionery (no cocoa) — sweets, gummies', chapter: '17', keywords: ['candy', 'sweets', 'confectionery', 'gummies', 'lollipops', 'jellies'] },
  { hs6: '180690', label: 'Chocolate & cocoa preparations, other', chapter: '18', keywords: ['chocolate', 'cocoa', 'chocolate bar', 'pralines'] },
  { hs6: '190531', label: 'Sweet biscuits', chapter: '19', keywords: ['biscuits', 'cookies', 'sweet biscuits'] },
  { hs6: '210690', label: 'Food preparations, other (supplements, protein powder)', chapter: '21', keywords: ['supplement', 'supplements', 'protein powder', 'vitamins', 'food supplement', 'nutrition'] },
  { hs6: '220300', label: 'Beer made from malt', chapter: '22', keywords: ['beer', 'lager', 'ale', 'craft beer'] },
  { hs6: '220421', label: 'Wine, in containers ≤ 2 litres', chapter: '22', keywords: ['wine', 'red wine', 'white wine', 'bottled wine'] },

  // Bags, leather goods & accessories (42)
  { hs6: '420221', label: 'Handbags with outer surface of leather', chapter: '42', keywords: ['handbag', 'purse', 'leather bag', 'shoulder bag'] },
  { hs6: '420292', label: 'Travel/sports bags, textile or plastic outer (backpacks)', chapter: '42', keywords: ['backpack', 'rucksack', 'sports bag', 'duffel', 'travel bag', 'gym bag'] },
  { hs6: '420231', label: 'Wallets & pocket articles, leather outer', chapter: '42', keywords: ['wallet', 'card holder', 'cardholder', 'coin purse'] },
  { hs6: '420330', label: 'Belts & bandoliers of leather', chapter: '42', keywords: ['belt', 'leather belt'] },
  { hs6: '420100', label: 'Saddlery & harness for animals (collars, leashes)', chapter: '42', keywords: ['pet collar', 'dog collar', 'leash', 'dog harness', 'pet lead'] },

  // Eyewear & watches (90/91)
  { hs6: '900410', label: 'Sunglasses', chapter: '90', keywords: ['sunglasses', 'shades', 'sunnies'] },
  { hs6: '900490', label: 'Spectacles & goggles, other', chapter: '90', keywords: ['glasses', 'eyewear', 'goggles', 'reading glasses', 'safety glasses'] },
  { hs6: '910219', label: 'Wrist-watches, battery, base metal (non-precious)', chapter: '91', keywords: ['watch', 'wristwatch', 'watches'] },

  // Home textiles & furnishings (57/63/94/70)
  { hs6: '570329', label: 'Tufted carpets & rugs, of man-made textiles', chapter: '57', keywords: ['rug', 'carpet', 'mat', 'floor mat', 'area rug'] },
  { hs6: '630392', label: 'Curtains & interior blinds, synthetic fibres', chapter: '63', keywords: ['curtains', 'drapes', 'blinds'] },
  { hs6: '940421', label: 'Mattresses of cellular rubber or plastics', chapter: '94', keywords: ['mattress', 'foam mattress', 'memory foam'] },
  { hs6: '940490', label: 'Bedding — pillows, cushions, duvets, quilts', chapter: '94', keywords: ['pillow', 'cushion', 'duvet', 'quilt', 'comforter', 'bedding'] },
  { hs6: '700992', label: 'Glass mirrors, framed', chapter: '70', keywords: ['mirror', 'wall mirror', 'framed mirror'] },

  // Sport & fitness (95)
  { hs6: '950691', label: 'Gym, fitness & athletics equipment', chapter: '95', keywords: ['gym', 'fitness', 'exercise', 'dumbbells', 'treadmill', 'yoga mat', 'resistance band', 'kettlebell'] },

  // Stationery (48/96)
  { hs6: '482010', label: 'Notebooks, diaries & registers', chapter: '48', keywords: ['notebook', 'diary', 'journal', 'planner', 'notepad'] },
  { hs6: '960810', label: 'Ball-point pens', chapter: '96', keywords: ['pen', 'pens', 'ballpoint', 'biro'] },
  { hs6: '961700', label: 'Vacuum flasks & insulated drinkware', chapter: '96', keywords: ['thermos', 'vacuum flask', 'insulated bottle', 'flask', 'water bottle'] },
  { hs6: '961900', label: 'Sanitary towels, napkins & nappies (diapers)', chapter: '96', keywords: ['diapers', 'nappies', 'sanitary towels', 'tampons'] },

  // Electricals & lighting (85)
  { hs6: '853950', label: 'LED lamps & bulbs', chapter: '85', keywords: ['led bulb', 'light bulb', 'led lamp', 'led light', 'bulb'] },
  { hs6: '854442', label: 'Insulated cables with connectors (USB, charging, HDMI)', chapter: '85', keywords: ['cable', 'usb cable', 'charging cable', 'hdmi cable', 'lead', 'wire'] },
  { hs6: '851810', label: 'Microphones', chapter: '85', keywords: ['microphone', 'mic'] },
  { hs6: '851660', label: 'Electric ovens, cookers & hotplates', chapter: '85', keywords: ['cooker', 'hotplate', 'electric oven', 'hob'] },

  // Tools & cookware (82/84/76)
  { hs6: '821192', label: 'Knives with fixed blade (kitchen / utility)', chapter: '82', keywords: ['kitchen knife', 'chef knife', 'knife', 'utility knife'] },
  { hs6: '820551', label: 'Household hand tools of base metal', chapter: '82', keywords: ['hand tools', 'household tools', 'screwdriver', 'pliers'] },
  { hs6: '846721', label: 'Electric hand-held drills', chapter: '84', keywords: ['power tool', 'drill', 'electric drill', 'cordless drill'] },
  { hs6: '761510', label: 'Aluminium table/kitchen/household articles (pans)', chapter: '76', keywords: ['aluminium cookware', 'frying pan', 'non-stick pan', 'aluminium pan', 'saucepan'] },

  // Apparel additions (61/62) + candles (34)
  { hs6: '611595', label: 'Socks & hosiery, of cotton, knitted', chapter: '61', keywords: ['socks', 'hosiery', 'cotton socks'] },
  { hs6: '611241', label: "Women's swimwear, synthetic fibres, knitted", chapter: '61', keywords: ['swimwear', 'swimsuit', 'bikini', 'bathing suit'] },
  { hs6: '621430', label: 'Scarves & shawls, of synthetic fibres', chapter: '62', keywords: ['scarf', 'shawl', 'scarves', 'wrap'] },
  { hs6: '340600', label: 'Candles & tapers', chapter: '34', keywords: ['candle', 'candles', 'tealight', 'scented candle'] },

  // Vehicle parts (87)
  { hs6: '870829', label: 'Motor-vehicle bodywork parts & accessories', chapter: '87', keywords: ['car parts', 'auto parts', 'car accessories', 'bumper', 'body parts'] },

  // ── ADR 0016 corpus expansion (apex Phase 1, 2026-06-01) ──
  //
  // Fills the most-asked-about gaps the wizard couldn't suggest for.
  // Same discipline as the rest of this file: HS6 only (never CN8),
  // every entry verified against the WCO HS nomenclature + EU CN
  // headings list. New entries grouped by chapter so future review
  // can spot category coverage at a glance.

  // ── Food & beverage breadth (07, 08, 16, 19, 20, 21) ──
  { hs6: '080510', label: 'Oranges, fresh or dried', chapter: '08', keywords: ['oranges', 'fresh fruit', 'citrus'] },
  { hs6: '080620', label: 'Grapes, dried (raisins, sultanas, currants)', chapter: '08', keywords: ['raisins', 'sultanas', 'currants', 'dried grapes', 'dried fruit'] },
  { hs6: '080211', label: 'Almonds in shell', chapter: '08', keywords: ['almonds', 'nuts', 'tree nuts'] },
  { hs6: '080132', label: 'Cashew nuts, shelled', chapter: '08', keywords: ['cashews', 'cashew nuts', 'nuts'] },
  { hs6: '160413', label: 'Sardines, sardinella, brisling — prepared / preserved', chapter: '16', keywords: ['sardines', 'tinned fish', 'canned fish', 'preserved fish'] },
  { hs6: '160414', label: 'Tunas, skipjack — prepared / preserved (incl. tinned tuna)', chapter: '16', keywords: ['tuna', 'tinned tuna', 'canned tuna'] },
  { hs6: '190230', label: 'Pasta, prepared or preserved (ready-to-eat)', chapter: '19', keywords: ['pasta', 'ready-meal', 'noodles', 'instant noodles'] },
  { hs6: '200799', label: 'Jams, fruit jellies, marmalades — other fruit', chapter: '20', keywords: ['jam', 'marmalade', 'fruit jelly', 'preserve', 'conserve'] },
  { hs6: '200580', label: 'Sweet corn, prepared / preserved (not frozen)', chapter: '20', keywords: ['sweet corn', 'tinned corn', 'canned vegetables'] },
  { hs6: '210320', label: 'Tomato ketchup & other tomato sauces', chapter: '21', keywords: ['ketchup', 'tomato sauce', 'sauce', 'condiment'] },
  { hs6: '210390', label: 'Sauces, mixed condiments & seasonings — other', chapter: '21', keywords: ['sauce', 'soy sauce', 'hot sauce', 'condiment', 'seasoning', 'dressing'] },
  { hs6: '210500', label: 'Ice cream and other edible ice', chapter: '21', keywords: ['ice cream', 'gelato', 'sorbet', 'frozen dessert'] },
  { hs6: '210112', label: 'Coffee extracts / instant coffee preparations', chapter: '21', keywords: ['instant coffee', 'coffee extract', 'soluble coffee'] },
  { hs6: '220210', label: 'Sweetened / flavoured waters & soft drinks', chapter: '22', keywords: ['soft drink', 'soda', 'cola', 'lemonade', 'sparkling water'] },
  { hs6: '220290', label: 'Non-alcoholic beverages — other (energy drinks, plant milks)', chapter: '22', keywords: ['energy drink', 'plant milk', 'oat milk', 'almond milk', 'soy milk', 'kombucha'] },
  { hs6: '220870', label: 'Liqueurs & cordials', chapter: '22', keywords: ['liqueur', 'cordial', 'amaretto', 'limoncello'] },

  // ── Cosmetics + personal care fillout (33, 34, 96) ──
  { hs6: '330410', label: 'Lip make-up preparations (lipstick, gloss, balm)', chapter: '33', keywords: ['lipstick', 'lip gloss', 'lip balm', 'lip care', 'makeup'] },
  { hs6: '330420', label: 'Eye make-up preparations (mascara, eyeliner, shadow)', chapter: '33', keywords: ['mascara', 'eyeliner', 'eyeshadow', 'eye makeup', 'makeup'] },
  { hs6: '330741', label: 'Pre-shave, shaving or after-shave preparations', chapter: '33', keywords: ['shaving cream', 'aftershave', 'pre-shave', 'mens grooming'] },
  { hs6: '330720', label: 'Deodorants and antiperspirants — personal', chapter: '33', keywords: ['deodorant', 'antiperspirant'] },
  { hs6: '330610', label: 'Toothpaste, dentifrice', chapter: '33', keywords: ['toothpaste', 'dentifrice', 'oral care'] },
  { hs6: '960321', label: 'Toothbrushes', chapter: '96', keywords: ['toothbrush', 'electric toothbrush', 'oral care'] },

  // ── Pharma + OTC (30) — limited, regulatory caveat is in agent prose ──
  { hs6: '300490', label: 'Medicaments in measured doses — other (OTC tablets, capsules)', chapter: '30', keywords: ['otc medicine', 'tablets', 'capsules', 'vitamins as medicine', 'analgesic'] },
  { hs6: '300510', label: 'Adhesive dressings + plasters with adhesive', chapter: '30', keywords: ['plasters', 'bandages', 'first aid', 'adhesive dressing'] },
  { hs6: '300670', label: 'Lubricants for medical instruments + body cavities', chapter: '30', keywords: ['surgical lubricant', 'medical lube'] },

  // ── PPE, masks, technical textiles (63, 90) ──
  { hs6: '630790', label: 'Made-up textile articles — incl. face masks, non-medical', chapter: '63', keywords: ['face mask', 'fabric mask', 'cloth mask'] },
  { hs6: '901320', label: 'Lasers (other than laser diodes)', chapter: '90', keywords: ['laser', 'laser pointer'] },
  { hs6: '901890', label: 'Medical / surgical instruments — other (thermometers, otoscopes, etc.)', chapter: '90', keywords: ['medical instrument', 'thermometer', 'stethoscope', 'otoscope'] },
  { hs6: '902132', label: 'Artificial joints (prostheses)', chapter: '90', keywords: ['prosthesis', 'artificial joint', 'orthopaedic'] },

  // Chapters 23 (pet food), 71 (jewellery), 92 (musical instruments)
  // would also be common SME categories — but they lack a chapter-
  // level duty-table fallback in lib/intelligence/customs-quote.js,
  // so adding HS6 suggestions for them would create orphan codes
  // (suggested by the wizard, then crash the duty calculator with
  // "no chapter rate"). Hold these for a Phase 1 follow-up that
  // extends the duty fallback table in lockstep.

  // ── Tools, hardware, DIY (82, 84) ──
  { hs6: '820411', label: 'Hand-operated spanners + wrenches, non-adjustable', chapter: '82', keywords: ['spanner', 'wrench', 'hand tool'] },
  { hs6: '820420', label: 'Socket spanners (incl. ratchet)', chapter: '82', keywords: ['socket', 'ratchet', 'socket spanner'] },
  { hs6: '820559', label: 'Hand tools — other (clamps, vices, files, rasps)', chapter: '82', keywords: ['clamps', 'vice', 'file', 'rasp', 'hand tool'] },
  { hs6: '846729', label: 'Electric portable tools — other (sanders, planers, jigsaws)', chapter: '84', keywords: ['sander', 'jigsaw', 'electric planer', 'power tool'] },
  { hs6: '846722', label: 'Electric portable saws (circular, reciprocating)', chapter: '84', keywords: ['circular saw', 'electric saw', 'jigsaw blade', 'reciprocating saw'] },

  // ── Sports & outdoor (95, 87) ──
  { hs6: '950611', label: 'Skis (snow-ski equipment)', chapter: '95', keywords: ['ski', 'skis', 'snow ski', 'winter sports'] },
  { hs6: '950621', label: 'Sailboards (windsurfing)', chapter: '95', keywords: ['sailboard', 'windsurf', 'windsurfing'] },
  { hs6: '950699', label: 'Sports + outdoor equipment — other (camping, hiking, climbing)', chapter: '95', keywords: ['camping', 'hiking', 'tent', 'sleeping bag', 'backpack outdoor', 'climbing'] },
  { hs6: '871494', label: 'Bicycle brakes & parts thereof', chapter: '87', keywords: ['bicycle brake', 'bike brake', 'bike parts'] },
  { hs6: '871495', label: 'Bicycle saddles', chapter: '87', keywords: ['bicycle saddle', 'bike saddle'] },

  // ── Beauty appliances + small home electricals (85) ──
  { hs6: '851631', label: 'Electric hair dryers', chapter: '85', keywords: ['hair dryer', 'blow dryer'] },
  { hs6: '851632', label: 'Electric hair-styling apparatus (straighteners, curlers)', chapter: '85', keywords: ['hair straightener', 'hair curler', 'curling iron', 'flat iron'] },
  { hs6: '851671', label: 'Electric coffee or tea makers', chapter: '85', keywords: ['coffee maker', 'espresso machine', 'tea maker', 'kettle electric'] },
  { hs6: '851672', label: 'Electric toasters', chapter: '85', keywords: ['toaster', 'electric toaster'] },
  { hs6: '852110', label: 'Magnetic video recorders / players', chapter: '85', keywords: ['video player', 'dvd player', 'media player'] },

  // ── Stationery / office (48, 96) ──
  { hs6: '482030', label: 'Binders (other than book covers), folders, file covers', chapter: '48', keywords: ['binder', 'folder', 'file cover', 'office filing'] },
  { hs6: '482359', label: 'Paper + paperboard articles for office use', chapter: '48', keywords: ['office paper', 'printer paper', 'a4 paper'] },
  { hs6: '960820', label: 'Felt-tipped + other porous-tipped pens + markers', chapter: '96', keywords: ['marker', 'felt-tip', 'highlighter', 'sharpie'] },
  { hs6: '960899', label: 'Pen + pencil parts (refills, mechanical-pencil leads)', chapter: '96', keywords: ['pen refill', 'pencil lead', 'mechanical pencil'] },

  // ── Printed matter (49) ──
  { hs6: '490199', label: 'Books, brochures + similar printed matter — other', chapter: '49', keywords: ['books', 'book', 'novels', 'printed books'] },
  { hs6: '490700', label: 'Postage stamps, banknotes (collectible)', chapter: '49', keywords: ['stamps', 'banknotes', 'collectible currency'] },
  { hs6: '491000', label: 'Calendars, printed', chapter: '49', keywords: ['calendar', 'wall calendar', 'printed calendar'] },

  // ── Pottery, art glass, decor (69, 70) ──
  { hs6: '691390', label: 'Statuettes + ornamental ceramic articles', chapter: '69', keywords: ['ceramic figurine', 'pottery decor', 'statuette', 'porcelain ornament'] },
  { hs6: '700991', label: 'Glass mirrors, unframed', chapter: '70', keywords: ['unframed mirror', 'cosmetic mirror', 'glass mirror'] },

  // ── Cookware variety (73, 76, 84) ──
  { hs6: '730711', label: 'Pipe / tube fittings, cast iron — for industrial use (plumbing)', chapter: '73', keywords: ['pipe fitting', 'plumbing fitting', 'iron fitting'] },
  { hs6: '761519', label: 'Aluminium household articles — table / kitchen — other', chapter: '76', keywords: ['aluminium pot', 'aluminium kettle', 'aluminium kitchenware'] },
  { hs6: '841912', label: 'Solar water heaters', chapter: '84', keywords: ['solar water heater', 'solar heater'] },

  // ── Lighting accessories + electrical (94, 85) ──
  { hs6: '940550', label: 'Non-electric lamps + lighting fittings (candleholders)', chapter: '94', keywords: ['candleholder', 'candle holder', 'oil lamp'] },
  { hs6: '853669', label: 'Plugs + sockets (electrical) ≤ 1000V', chapter: '85', keywords: ['plug', 'socket', 'electrical plug', 'wall socket', 'adapter plug'] },
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
