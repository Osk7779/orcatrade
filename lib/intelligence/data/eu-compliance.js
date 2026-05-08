// EU compliance regime overlay — maps an import (HS code, product category)
// to the EU regulatory regimes that apply, what the importer must do, and
// where to read deeper.
//
// PURPOSE
// Compliance is the silent killer for SME importers: a plan that nails
// duty + freight is worthless if the goods get held at the border because
// the importer didn't realise CBAM applied to their aluminium frames or
// EUDR applied to their wooden furniture. This module answers
// "what compliance regimes apply to this shipment?" inside the wizard.
//
// SCOPE
// Twelve headline regimes: CBAM, EUDR, REACH, CLP, CE marking (multiple
// directives), RoHS, WEEE, Battery Regulation, Toy Safety, Cosmetics,
// Packaging (PPWR), GPSR, Footwear labelling.
//
// Each regime has triggers (HS prefix, category, or universal),
// severity (high / medium / low — drives display order),
// importerObligation (one-line summary of what the user must do),
// deeperGuide (URL to OrcaTrade's deeper page on the regime).
//
// LIMITS
// Some regimes (e.g. PPE under 2016/425, Construction Products under
// 305/2011) are highly context-dependent — flagged conditionally rather
// than universally for chapters 61-65 / 25-39 to avoid false positives.

const ASOF = '2026-05-08';

// ── Helpers ──────────────────────────────────────────────

function chapterOf(hsCode) {
  if (!hsCode) return null;
  const digits = String(hsCode).replace(/[^0-9]/g, '');
  if (digits.length < 2) return null;
  return digits.slice(0, 2);
}

function hsHasPrefix(hsCode, prefix) {
  if (!hsCode || !prefix) return false;
  const norm = String(hsCode).replace(/[^0-9]/g, '');
  const pref = String(prefix).replace(/[^0-9]/g, '');
  return norm.startsWith(pref);
}

// ── Regimes ──────────────────────────────────────────────

const REGIMES = [
  {
    id: 'CBAM',
    name: 'CBAM — Carbon Border Adjustment Mechanism',
    severity: 'high',
    status: 'Active — definitive period from 1 January 2026',
    triggerType: 'hsPrefix',
    triggers: [
      { hsPrefix: '2523', label: 'Cement' },
      { hsPrefix: '2716', label: 'Electricity' },
      { hsPrefix: '280410', label: 'Hydrogen' },
      { hsPrefix: '281410', label: 'Anhydrous ammonia' },
      { hsPrefix: '281420', label: 'Ammonia in solution' },
      { hsPrefix: '31', label: 'Fertilisers' },
      { hsPrefix: '72', label: 'Iron and steel' },
      { hsPrefix: '7301', label: 'Articles of iron/steel — sheet piling' },
      { hsPrefix: '7302', label: 'Articles of iron/steel — railway track' },
      { hsPrefix: '7303', label: 'Articles of iron/steel — tubes/pipes (cast)' },
      { hsPrefix: '7304', label: 'Articles of iron/steel — seamless tubes' },
      { hsPrefix: '7305', label: 'Articles of iron/steel — large tubes' },
      { hsPrefix: '7306', label: 'Articles of iron/steel — welded tubes' },
      { hsPrefix: '7307', label: 'Tube/pipe fittings of iron/steel' },
      { hsPrefix: '7308', label: 'Structures of iron/steel' },
      { hsPrefix: '7309', label: 'Reservoirs/tanks of iron/steel >300L' },
      { hsPrefix: '7310', label: 'Tanks/casks of iron/steel <300L' },
      { hsPrefix: '7311', label: 'Containers for compressed gas' },
      { hsPrefix: '7318', label: 'Screws/bolts/nuts of iron/steel' },
      { hsPrefix: '76', label: 'Aluminium and articles thereof' },
    ],
    importerObligation: 'Register as authorised CBAM declarant via your national competent authority. From 1 January 2026, purchase CBAM certificates priced against weekly EU ETS settlement to cover embedded emissions of imported goods. Quarterly reporting was transitional (2023-2025); annual declaration now applies.',
    keyDates: '2026-01-01: definitive period began. 2026-05-31: first annual declaration deadline (covering 2025 transitional period).',
    deeperGuide: '/cbam/',
  },

  {
    id: 'EUDR',
    name: 'EUDR — Deforestation Regulation',
    severity: 'high',
    status: 'Active — large operators since 30 December 2025; SMEs from 30 June 2026',
    triggerType: 'hsPrefix',
    triggers: [
      { hsPrefix: '0102', label: 'Live cattle' },
      { hsPrefix: '0201', label: 'Bovine meat (fresh)' },
      { hsPrefix: '0202', label: 'Bovine meat (frozen)' },
      { hsPrefix: '0901', label: 'Coffee' },
      { hsPrefix: '1201', label: 'Soya beans' },
      { hsPrefix: '1208', label: 'Soybean flour' },
      { hsPrefix: '1507', label: 'Soybean oil' },
      { hsPrefix: '1511', label: 'Palm oil' },
      { hsPrefix: '1513', label: 'Palm-kernel oil' },
      { hsPrefix: '1801', label: 'Cocoa beans' },
      { hsPrefix: '1803', label: 'Cocoa paste' },
      { hsPrefix: '1804', label: 'Cocoa butter' },
      { hsPrefix: '1805', label: 'Cocoa powder' },
      { hsPrefix: '1806', label: 'Chocolate and cocoa preparations' },
      { hsPrefix: '4001', label: 'Natural rubber' },
      { hsPrefix: '4011', label: 'Pneumatic rubber tyres' },
      { hsPrefix: '4012', label: 'Retreaded/used pneumatic tyres' },
      { hsPrefix: '4013', label: 'Inner tubes of rubber' },
      { hsPrefix: '41', label: 'Raw hides, skins and leather' },
      { hsPrefix: '4407', label: 'Wood sawn or chipped' },
      { hsPrefix: '4408', label: 'Veneer sheets' },
      { hsPrefix: '4409', label: 'Wood continuously shaped' },
      { hsPrefix: '4410', label: 'Particle board' },
      { hsPrefix: '4411', label: 'Fibreboard' },
      { hsPrefix: '4412', label: 'Plywood' },
      { hsPrefix: '4413', label: 'Densified wood' },
      { hsPrefix: '4414', label: 'Wooden frames' },
      { hsPrefix: '4415', label: 'Cases/boxes of wood' },
      { hsPrefix: '4418', label: 'Wood for construction' },
      { hsPrefix: '4419', label: 'Tableware and kitchenware of wood' },
      { hsPrefix: '4420', label: 'Wood marquetry/inlaid' },
      { hsPrefix: '4421', label: 'Other articles of wood' },
      { hsPrefix: '47', label: 'Wood pulp' },
      { hsPrefix: '48', label: 'Paper and paperboard' },
      { hsPrefix: '4901', label: 'Printed books' },
      { hsPrefix: '4911', label: 'Other printed matter' },
      { hsPrefix: '94', label: 'Furniture (wood-containing)' },
    ],
    importerObligation: 'Submit a Due Diligence Statement (DDS) per consignment via the EU Information System. Must include: geolocation (polygon or point) of plot of origin, supplier identity, evidence goods are deforestation-free (cut-off: 31 December 2020) and produced in compliance with origin-country law.',
    keyDates: '2025-12-30: large operators in force. 2026-06-30: SMEs in force. 2026-12: first European Commission review.',
    deeperGuide: '/eudr/',
  },

  {
    id: 'REACH',
    name: 'REACH — Registration, Evaluation, Authorisation, Restriction of Chemicals',
    severity: 'high',
    status: 'Active since 2007',
    triggerType: 'hsPrefix',
    triggers: [
      { hsPrefix: '28', label: 'Inorganic chemicals' },
      { hsPrefix: '29', label: 'Organic chemicals' },
      { hsPrefix: '32', label: 'Tanning, dyeing extracts; pigments' },
      { hsPrefix: '33', label: 'Essential oils, perfumery, cosmetics' },
      { hsPrefix: '34', label: 'Soap, organic surface-active agents, cleaning preparations' },
      { hsPrefix: '35', label: 'Albuminoidal substances; modified starches; glues' },
      { hsPrefix: '36', label: 'Explosives; pyrotechnic products; matches' },
      { hsPrefix: '37', label: 'Photographic or cinematographic goods' },
      { hsPrefix: '38', label: 'Miscellaneous chemical products' },
      { hsPrefix: '39', label: 'Plastics and articles thereof' },
    ],
    importerObligation: 'Register substances >1 tonne/year with ECHA before import. For articles (any HS chapter): notify ECHA if Substance of Very High Concern (SVHC) is present in concentration >0.1% w/w and total exceeds 1t/year. Annex XVII restrictions (e.g., chrome VI in leather, lead in jewellery) apply universally — non-compliance means the goods cannot be placed on the EU market.',
    keyDates: 'SCIP database notification mandatory since 5 January 2021 for articles containing SVHCs.',
    deeperGuide: '/reach/',
    additionalNote: 'For articles containing chemicals (e.g. textiles dyed in CN, leather treated with chrome, plastics with phthalates), REACH applies even though the HS code is not in chapters 28-39.',
  },

  {
    id: 'CE_MACHINERY',
    name: 'CE marking — Machinery Regulation 2023/1230',
    severity: 'high',
    status: 'Active. Replaces Machinery Directive 2006/42/EC from 14 January 2027',
    triggerType: 'hsChapter',
    triggers: [
      { hsPrefix: '84', label: 'Mechanical machinery' },
      { hsPrefix: '8479', label: 'Machines having individual functions' },
    ],
    importerObligation: 'Verify supplier issued the CE Declaration of Conformity (DoC). Affix CE marking. Maintain technical file for 10 years from last unit placed on market. For Annex IV machinery (e.g. presses, woodworking saws, sawmills), notified-body certification is required. Importer = manufacturer for legal purposes if the supplier is non-EU.',
    deeperGuide: '/ce-marking/',
  },

  {
    id: 'CE_LVD_EMC_RED',
    name: 'CE marking — LVD, EMC, RED for electrical equipment',
    severity: 'high',
    status: 'Active',
    triggerType: 'hsChapter',
    triggers: [
      { hsPrefix: '85', label: 'Electrical machinery and equipment' },
    ],
    importerObligation: 'CE under Low Voltage Directive (LVD 2014/35), Electromagnetic Compatibility (EMC 2014/30), and Radio Equipment Directive (RED 2014/53) where applicable. Verify DoC and technical file. RED requires unique device identifier and reception parameters declaration since 2024.',
    deeperGuide: '/ce-marking/',
  },

  {
    id: 'ROHS',
    name: 'RoHS — Restriction of Hazardous Substances in EEE',
    severity: 'medium',
    status: 'Active since 2011 (recast 2011/65/EU)',
    triggerType: 'hsChapter',
    triggers: [
      { hsPrefix: '85', label: 'Electrical and electronic equipment' },
      { hsPrefix: '8413', label: 'Pumps for liquids' },
      { hsPrefix: '8418', label: 'Refrigerators / freezers' },
      { hsPrefix: '8421', label: 'Centrifuges, filters' },
      { hsPrefix: '8422', label: 'Dishwashing machines' },
      { hsPrefix: '8450', label: 'Washing machines' },
      { hsPrefix: '8451', label: 'Dryers' },
      { hsPrefix: '8470', label: 'Calculating machines' },
      { hsPrefix: '8471', label: 'Computers and units' },
      { hsPrefix: '90', label: 'Optical/medical/measuring instruments' },
    ],
    importerObligation: 'Verify EEE complies with restriction limits on Pb, Cd, Hg, Cr(VI), PBB, PBDE, and four phthalates (DEHP, BBP, DBP, DIBP). DoC must reference RoHS. Technical file retained 10 years. Non-compliance = market withdrawal + fines.',
    deeperGuide: '/rohs/',
  },

  {
    id: 'WEEE',
    name: 'WEEE — Waste Electrical and Electronic Equipment',
    severity: 'medium',
    status: 'Active since 2003 (recast 2012/19/EU)',
    triggerType: 'hsChapter',
    triggers: [
      { hsPrefix: '85', label: 'Electrical and electronic equipment' },
      { hsPrefix: '90', label: 'Optical/measuring instruments' },
    ],
    importerObligation: 'Register as a producer in each EU member state where you place EEE on the market. Pay producer responsibility fees (covers collection + recycling). Mark products with the crossed-out wheelie-bin symbol. Annual reporting of placed-on-market volumes.',
    deeperGuide: '/weee/',
  },

  {
    id: 'BATTERY',
    name: 'EU Battery Regulation 2023/1542',
    severity: 'medium',
    status: 'Active — phased provisions 2024-2027',
    triggerType: 'hsPrefix',
    triggers: [
      { hsPrefix: '8506', label: 'Primary cells and batteries' },
      { hsPrefix: '8507', label: 'Electric accumulators (incl. lithium-ion)' },
      { hsPrefix: '8711.60', label: 'E-bikes (with battery)' },
      { hsPrefix: '8703.80', label: 'Battery electric vehicles' },
    ],
    importerObligation: 'Register as a producer for battery take-back. From August 2025: carbon footprint declaration for industrial/EV batteries. From August 2027: digital battery passport (QR code linked to material composition, recycled content, lifecycle data). Recycled content minimums (16% Co, 85% Pb, 6% Li, 6% Ni) phased in.',
    deeperGuide: '/battery/',
  },

  {
    id: 'TOY_SAFETY',
    name: 'Toy Safety — Directive 2009/48/EC + EN 71 series',
    severity: 'high',
    status: 'Active. New Toy Safety Regulation expected 2026 with stricter chemical limits',
    triggerType: 'hsChapter',
    triggers: [
      { hsPrefix: '95', label: 'Toys, games, sports equipment' },
    ],
    importerObligation: 'Test goods to EN 71 series (mechanical, flammability, chemical migration limits, electrical safety for electric toys). CE marking required. For toys containing electronics, additional CE under LVD/EMC/RED. Maintain technical file. SVHC and CMR substances banned in toy materials.',
    deeperGuide: '/toy-safety/',
  },

  {
    id: 'COSMETICS',
    name: 'Cosmetics Regulation 1223/2009',
    severity: 'high',
    status: 'Active since 2013',
    triggerType: 'hsPrefix',
    triggers: [
      { hsPrefix: '33', label: 'Essential oils, perfumery, cosmetics' },
      { hsPrefix: '3304', label: 'Beauty/make-up preparations' },
      { hsPrefix: '3305', label: 'Hair preparations' },
      { hsPrefix: '3306', label: 'Oral hygiene preparations' },
      { hsPrefix: '3307', label: 'Pre-shave/shaving/depilatories' },
    ],
    importerObligation: 'Designate a Responsible Person (RP) established in the EU. Notify each product on the Cosmetic Product Notification Portal (CPNP). Maintain Product Information File (PIF) including safety assessment by qualified assessor. Comply with Annex II (banned), Annex III (restricted), Annex IV-VI (colorants/preservatives/UV filters) lists.',
    deeperGuide: '/cosmetics/',
  },

  {
    id: 'GPSR',
    name: 'GPSR — General Product Safety Regulation 2023/988',
    severity: 'medium',
    status: 'Active since 13 December 2024 (replaced GPSD 2001/95/EC)',
    triggerType: 'category',
    triggers: [
      { category: 'apparel', label: 'Consumer textiles and apparel' },
      { category: 'electronics', label: 'Consumer electronics' },
      { category: 'furniture', label: 'Consumer furniture' },
      { category: 'toys', label: 'Toys' },
      { category: 'cosmetics', label: 'Cosmetics' },
      { category: 'homeware', label: 'Homeware' },
      { category: 'footwear', label: 'Footwear' },
    ],
    importerObligation: 'Conduct internal risk assessment. Maintain technical documentation for 10 years. Identify the manufacturer and an EU economic operator on the product or packaging. Implement traceability. Cooperate with Safety Gate alerts. Inform consumers via clear instructions and warnings. Record customer complaints and product accidents.',
    deeperGuide: '/gpsr/',
    note: 'Applies to all consumer goods placed on the EU market. Industrial-only goods are out of scope.',
  },

  {
    id: 'PPWR',
    name: 'Packaging and Packaging Waste Regulation (PPWR) 2025/40',
    severity: 'low',
    status: 'In force from 11 February 2026; obligations phase in to 2030',
    triggerType: 'universal',
    triggers: [
      { label: 'All imported goods (packaging material)' },
    ],
    importerObligation: 'Packaging must be recyclable, marked with material composition, and meet recycled-content minimums (phased in: PET 30% by 2030, plastic packaging 35% by 2030). Single-use plastic packaging restrictions apply. Importer responsible for ensuring conformity even if supplier supplied non-compliant packaging.',
    deeperGuide: '/packaging/',
    note: 'Most importers underestimate this — packaging sourced abroad often fails EU recyclability requirements.',
  },

  {
    id: 'FOOTWEAR_LABELLING',
    name: 'Footwear Labelling — Directive 94/11/EC',
    severity: 'low',
    status: 'Active since 1996',
    triggerType: 'hsChapter',
    triggers: [
      { hsPrefix: '64', label: 'Footwear' },
    ],
    importerObligation: 'Each pair must carry a label indicating the material composition of the upper, lining/sock, and outer sole. Pictograms or words in the official language(s) of the destination member state. Information must be visible, legible, durable.',
    deeperGuide: '/footwear-labelling/',
  },
];

// ── Lookup ──────────────────────────────────────────────

function findApplicableRegimes({ hsCode, productCategory }) {
  if (!hsCode && !productCategory) return [];
  const matches = [];

  for (const regime of REGIMES) {
    let hit = false;
    let matchedTrigger = null;

    if (regime.triggerType === 'universal') {
      hit = true;
      matchedTrigger = regime.triggers[0];
    } else if (regime.triggerType === 'category' && productCategory) {
      const t = regime.triggers.find(tr => tr.category === productCategory);
      if (t) { hit = true; matchedTrigger = t; }
    } else if (regime.triggerType === 'hsPrefix' || regime.triggerType === 'hsChapter') {
      if (hsCode) {
        const t = regime.triggers.find(tr => hsHasPrefix(hsCode, tr.hsPrefix));
        if (t) { hit = true; matchedTrigger = t; }
      }
    }

    if (hit) {
      matches.push({
        id: regime.id,
        name: regime.name,
        severity: regime.severity,
        status: regime.status,
        importerObligation: regime.importerObligation,
        keyDates: regime.keyDates || null,
        deeperGuide: regime.deeperGuide,
        note: regime.note || null,
        additionalNote: regime.additionalNote || null,
        matchedTrigger: matchedTrigger ? matchedTrigger.label : null,
      });
    }
  }

  // Sort: high severity first, then medium, then low.
  // Note: must use ?? not || — 'high' maps to 0 which is falsy.
  const order = { high: 0, medium: 1, low: 2 };
  matches.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
  return matches;
}

function listRegimes() {
  return REGIMES.map(r => ({ id: r.id, name: r.name, severity: r.severity }));
}

module.exports = {
  ASOF,
  REGIMES,
  findApplicableRegimes,
  listRegimes,
  chapterOf,
  hsHasPrefix,
};
