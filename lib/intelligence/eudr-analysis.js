// Money: penalty ceiling computed in integer cents (lib/intelligence/money.js,
// half-even rounding, no float drift).
const M = require('./money');

const EUDR_DATES = {
  entryIntoForce: '2023-06-29',
  applicationStandard: '2026-12-30',
  applicationSME: '2027-06-30',
  cutOffDate: '2020-12-31',
};

const COVERED_COMMODITIES = {
  cattle: {
    label: 'Cattle (live, hides, leather, beef)',
    keywords: ['cattle', 'beef', 'leather', 'hides', 'cowhide'],
    geolocationNote: 'Plots > 4 ha used for cattle require polygon coordinates per Art. 9.',
  },
  cocoa: {
    label: 'Cocoa (beans, paste, butter, chocolate)',
    keywords: ['cocoa', 'cacao', 'chocolate'],
    geolocationNote: 'Geolocation of all plots where the cocoa was produced.',
  },
  coffee: {
    label: 'Coffee (green, roasted, ground)',
    keywords: ['coffee', 'espresso', 'arabica', 'robusta'],
    geolocationNote: 'Geolocation of plots — for smallholder coffee, supplier-aggregated polygons may apply.',
  },
  oil_palm: {
    label: 'Oil palm (palm oil, palm kernel oil and derivatives)',
    keywords: ['palm oil', 'oil palm', 'palm kernel'],
    geolocationNote: 'High-risk commodity — additional scrutiny required.',
  },
  rubber: {
    label: 'Rubber (natural rubber, tyres, articles)',
    keywords: ['rubber', 'latex', 'tyre', 'tire'],
    geolocationNote: 'Plantation polygons required.',
  },
  soya: {
    label: 'Soya (beans, meal, oil, animal feed)',
    keywords: ['soya', 'soybean', 'soy bean'],
    geolocationNote: 'Plot polygons required; co-mingling with non-compliant origins is a known risk.',
  },
  wood: {
    label: 'Wood (timber, paper, pulp, furniture, charcoal, plywood)',
    keywords: ['wood', 'timber', 'paper', 'pulp', 'furniture', 'plywood', 'charcoal', 'lumber'],
    geolocationNote: 'Forest concession polygons; "forest degradation" definition applies in addition to deforestation.',
  },
};

const COUNTRY_RISK_INDICATIVE = {
  BR: { likely: 'standard-or-high', note: 'Strong commodity exporter (soya, beef, leather, coffee). Final classification awaits Commission designation.' },
  ID: { likely: 'standard-or-high', note: 'Major palm oil and rubber exporter. Final classification awaits Commission designation.' },
  CI: { likely: 'standard', note: "Côte d'Ivoire — major cocoa exporter. Smallholder traceability is the operational challenge." },
  GH: { likely: 'standard', note: 'Ghana — major cocoa exporter. Cooperative-level due diligence is workable.' },
  VN: { likely: 'standard', note: 'Vietnam — significant coffee, wood, and rubber exports.' },
  CN: { likely: 'standard', note: 'China — wood and processed-product exports relevant to EUDR scope.' },
  IN: { likely: 'standard', note: 'India — coffee, rubber, and wood-based products.' },
  ET: { likely: 'standard', note: 'Ethiopia — coffee origin; data-completeness varies by region.' },
  CO: { likely: 'standard', note: 'Colombia — coffee and beef. Risk varies by region.' },
  EU: { likely: 'low', note: 'EU production benefits from simplified due diligence under Art. 13(1).' },
};

function detectEudrCommodity(productCategory, productDescription) {
  const haystack = [productCategory, productDescription]
    .map(text => String(text || '').toLowerCase())
    .join(' ');
  for (const [key, def] of Object.entries(COVERED_COMMODITIES)) {
    if (def.keywords.some(keyword => haystack.includes(keyword))) {
      return key;
    }
  }
  return null;
}

function determineEudrApplicability({ productCategory, productDescription, originCountry, importerEntity }) {
  const commodityKey = detectEudrCommodity(productCategory, productDescription);

  if (!commodityKey) {
    return {
      applies: false,
      reason: 'Product does not match any EUDR Annex I commodity in the snapshot mapping (cattle, cocoa, coffee, oil palm, rubber, soya, wood). Confirm against the official Annex I CN code list before concluding non-applicability.',
      commodityKey: null,
      citation: 'Regulation (EU) 2023/1115, Annex I',
      confidence: 'amber',
    };
  }

  const commodity = COVERED_COMMODITIES[commodityKey];
  const isEuOrigin = String(originCountry || '').toUpperCase() === 'EU';

  return {
    applies: true,
    reason: `Product matches EUDR Annex I commodity (${commodity.label}). Placing on the EU market or exporting requires a due diligence statement covering deforestation-free status, legal compliance in the country of production, and geolocation of all plots where the commodity was produced.`,
    commodityKey,
    commodityLabel: commodity.label,
    geolocationNote: commodity.geolocationNote,
    cutOffDate: EUDR_DATES.cutOffDate,
    citation: 'Regulation (EU) 2023/1115, Art. 1, Art. 3, and Annex I',
    confidence: isEuOrigin ? 'green' : 'amber',
    confidenceNote: isEuOrigin
      ? 'EU production benefits from simplified due diligence under Art. 13(1).'
      : 'Country risk classification under Art. 29 will determine whether full or simplified due diligence applies. Until the Commission designates the country, assume standard-risk and prepare full due diligence.',
  };
}

function getCountryRiskIndicative(originCountry) {
  if (!originCountry) return null;
  const code = String(originCountry).toUpperCase();
  if (code === 'EU') return { code, likely: 'low', note: 'EU origin — simplified due diligence may apply per Art. 13(1).' };
  return COUNTRY_RISK_INDICATIVE[code]
    ? { code, ...COUNTRY_RISK_INDICATIVE[code] }
    : { code, likely: 'standard', note: 'No specific EUDR risk indicator on file. Assume standard-risk pending Commission designation.' };
}

function buildEudrTimeline({ asOfDate = new Date().toISOString().slice(0, 10), isSME = false } = {}) {
  const events = [
    {
      date: EUDR_DATES.entryIntoForce,
      regulationId: 'eudr',
      milestone: 'EUDR entered into force',
      detail: 'Regulation (EU) 2023/1115 entered into force 20 days after publication in the Official Journal.',
      citation: 'Regulation (EU) 2023/1115, Art. 38',
    },
    {
      date: EUDR_DATES.cutOffDate,
      regulationId: 'eudr',
      milestone: 'Cut-off date for deforestation-free status',
      detail: 'Land subject to deforestation or forest degradation after this date cannot supply EUDR-compliant covered commodities.',
      citation: 'Regulation (EU) 2023/1115, Art. 2',
    },
    {
      date: EUDR_DATES.applicationStandard,
      regulationId: 'eudr',
      milestone: 'Application date — non-SME operators',
      detail: 'From this date, only deforestation-free covered products may be placed on or made available on the EU market by non-SME operators and traders.',
      citation: 'Regulation (EU) 2023/1115, Art. 38',
    },
    {
      date: EUDR_DATES.applicationSME,
      regulationId: 'eudr',
      milestone: 'Application date — micro and small operators',
      detail: 'Application date for micro and small enterprises within the meaning of Directive 2013/34/EU.',
      citation: 'Regulation (EU) 2023/1115, Art. 38',
    },
  ];

  return events.map(event => ({
    ...event,
    status: event.date < asOfDate ? 'past' : (event.date === asOfDate ? 'today' : 'upcoming'),
    daysFromAsOf: Math.round((new Date(event.date) - new Date(asOfDate)) / 86400000),
    relevantToImporter: event.date === EUDR_DATES.applicationStandard ? !isSME : event.date === EUDR_DATES.applicationSME ? isSME : true,
  }));
}

function buildEudrEvidenceGaps({ commodityKey, importerEntity, supplier, originCountry, isSME = false }) {
  if (!commodityKey) return [];

  const standardDeadline = isSME ? EUDR_DATES.applicationSME : EUDR_DATES.applicationStandard;
  const commodity = COVERED_COMMODITIES[commodityKey];
  const isEuOrigin = String(originCountry || '').toUpperCase() === 'EU';

  const gaps = [];

  gaps.push({
    type: 'geolocation',
    title: `Geolocation of all plots where the ${commodity.label.toLowerCase()} was produced`,
    severity: 'blocker',
    owner: supplier ? `Supplier ${supplier} — production-side coordinator` : 'Supplier production-side coordinator',
    description: `Latitude and longitude with at least six decimal places per plot; polygon coordinates required for plots above 4 hectares (and for cattle in all cases). ${commodity.geolocationNote}`,
    citation: 'Regulation (EU) 2023/1115, Art. 9',
    deadline: standardDeadline,
  });

  gaps.push({
    type: 'due_diligence_statement',
    title: 'Due diligence statement registered in the EU information system',
    severity: 'blocker',
    owner: importerEntity ? `${importerEntity} — operator under Art. 4` : 'Operator under Art. 4',
    description: 'Before placing covered products on the EU market, the operator must submit a due diligence statement in the Commission information system (TRACES). The reference number must be communicated to customs authorities for release.',
    citation: 'Regulation (EU) 2023/1115, Art. 4 and Art. 33',
    deadline: standardDeadline,
  });

  gaps.push({
    type: 'risk_assessment',
    title: 'Documented risk assessment',
    severity: isEuOrigin ? 'medium' : 'high',
    owner: importerEntity ? `${importerEntity} — internal compliance` : 'Internal compliance',
    description: isEuOrigin
      ? 'EU origin allows simplified due diligence — full Art. 10 risk assessment may not be required for purely EU-sourced material. Verify no co-mingling with non-EU origin.'
      : 'Verify and analyse the information collected. Consider country risk classification under Art. 29, presence of forests, prevalence of deforestation, supply-chain complexity, and risk of mixing with unknown-origin material.',
    citation: 'Regulation (EU) 2023/1115, Art. 10',
    deadline: standardDeadline,
  });

  gaps.push({
    type: 'legal_compliance_evidence',
    title: 'Evidence of compliance with relevant legislation in the country of production',
    severity: 'high',
    owner: supplier ? `Supplier ${supplier} — legal documentation` : 'Supplier legal documentation',
    description: 'Land-use rights, environmental protection, third-party rights, labour rights, human rights, free prior informed consent, tax/anti-corruption, trade and customs regulations of the country of production.',
    citation: 'Regulation (EU) 2023/1115, Art. 9(1)(h)',
    deadline: standardDeadline,
  });

  gaps.push({
    type: 'supplier_chain',
    title: 'Full supplier chain mapping with names, addresses, and email contacts',
    severity: 'high',
    owner: 'Procurement / sourcing lead',
    description: 'Names and contact details of suppliers and downstream customers. Required for both operators and SME traders (5-year retention for SME traders).',
    citation: 'Regulation (EU) 2023/1115, Art. 9 and Art. 13',
    deadline: standardDeadline,
  });

  return gaps;
}

function getEudrSizeImplication(globalTurnoverEur) {
  if (!globalTurnoverEur) return null;
  const turnover = Number(globalTurnoverEur);
  if (!Number.isFinite(turnover) || turnover <= 0) return null;

  // Directive 2013/34/EU thresholds (rough indicative):
  // Micro: ≤ €700k turnover · ≤ 10 employees
  // Small: ≤ €8m turnover · ≤ 50 employees
  // Medium: ≤ €40m turnover · ≤ 250 employees
  // Large: above the medium threshold
  if (turnover <= 700000) return { size: 'micro', applicationDate: EUDR_DATES.applicationSME, citation: 'Directive 2013/34/EU + EUDR Art. 38' };
  if (turnover <= 8000000) return { size: 'small', applicationDate: EUDR_DATES.applicationSME, citation: 'Directive 2013/34/EU + EUDR Art. 38' };
  if (turnover <= 40000000) return { size: 'medium', applicationDate: EUDR_DATES.applicationStandard, citation: 'Directive 2013/34/EU + EUDR Art. 38' };
  return { size: 'large', applicationDate: EUDR_DATES.applicationStandard, citation: 'Directive 2013/34/EU + EUDR Art. 38' };
}

function buildEudrPenaltyExposure({ globalTurnoverEur }) {
  if (!globalTurnoverEur) return null;
  const turnover = Number(globalTurnoverEur);
  if (!Number.isFinite(turnover) || turnover <= 0) return null;

  const ceilingEur = Math.round(M.toEuro(M.mulRate(M.fromEuro(turnover), 0.04)));

  return {
    scenario: 'Maximum financial penalty under Art. 25',
    penaltyCeilingEur: ceilingEur,
    rate: '4% of EU annual turnover',
    note: 'Penalties must be effective, proportionate, and dissuasive. Member States set the actual fine within the floor of "at least 4% of EU annual turnover" plus confiscation of products and revenues, public-procurement exclusion, and temporary market-placing prohibition for serious or repeated infringement.',
    citation: 'Regulation (EU) 2023/1115, Art. 25',
    nonFinancialConsequences: [
      'Confiscation of relevant commodities and products',
      'Confiscation of revenues gained from the transaction',
      'Temporary exclusion from public procurement and EU public funding',
      'Temporary prohibition from placing or making available covered products on the market',
    ],
  };
}

module.exports = {
  EUDR_DATES,
  COVERED_COMMODITIES,
  detectEudrCommodity,
  determineEudrApplicability,
  getCountryRiskIndicative,
  buildEudrTimeline,
  buildEudrEvidenceGaps,
  getEudrSizeImplication,
  buildEudrPenaltyExposure,
};
