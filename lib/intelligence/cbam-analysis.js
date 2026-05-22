// Money: certificate / penalty exposure computed in integer cents
// (lib/intelligence/money.js, half-even rounding, no float drift).
const M = require('./money');

const ETS_PRICE_SNAPSHOT = {
  priceEurPerTonne: 75,
  asOf: '2026-04-15',
  source: 'Indicative EUA front-month price (snapshot). CBAM certificates are priced at the weekly average EUA price under Reg. (EU) 2023/956, Art. 21.',
  confidence: 'snapshot',
  scenarioRange: { lowEur: 60, highEur: 95 },
};

const DEFAULT_EMISSIONS_INTENSITIES = {
  cement: {
    label: 'Cement',
    valueTco2ePerTonne: 0.79,
    rangeTco2ePerTonne: [0.55, 0.95],
    annexCategory: 'cement',
    note: 'Indicative default for clinker-rich cement. Actual value depends on clinker share, fuel mix, and country of production.',
    source: 'EU Commission default values for the CBAM transitional period (published Dec 2023)',
    confidence: 'indicative',
  },
  iron_and_steel: {
    label: 'Iron and steel',
    valueTco2ePerTonne: 1.99,
    rangeTco2ePerTonne: [0.4, 2.6],
    annexCategory: 'iron_and_steel',
    note: 'Wide range driven by production route. Blast furnace / basic oxygen ~2.0, electric arc ~0.35–0.6.',
    source: 'EU Commission default values for the CBAM transitional period (published Dec 2023)',
    confidence: 'indicative',
  },
  aluminium: {
    label: 'Aluminium',
    valueTco2ePerTonne: 8.6,
    rangeTco2ePerTonne: [1.5, 16.5],
    annexCategory: 'aluminium',
    note: 'Strongly dependent on grid mix at smelter location. Hydro-rich grids ~1.5, coal-heavy grids >15.',
    source: 'EU Commission default values for the CBAM transitional period (published Dec 2023)',
    confidence: 'indicative',
  },
  fertilisers: {
    label: 'Fertilisers',
    valueTco2ePerTonne: 1.2,
    rangeTco2ePerTonne: [0.8, 2.5],
    annexCategory: 'fertilisers',
    note: 'Indicative for urea / ammonium nitrate. Varies by feedstock and process.',
    source: 'EU Commission default values for the CBAM transitional period (published Dec 2023)',
    confidence: 'indicative',
  },
  hydrogen: {
    label: 'Hydrogen',
    valueTco2ePerTonne: 10.6,
    rangeTco2ePerTonne: [0.5, 12.0],
    annexCategory: 'hydrogen',
    note: 'Default reflects grey hydrogen via steam methane reforming. Green hydrogen approaches zero direct emissions.',
    source: 'EU Commission default values for the CBAM transitional period (published Dec 2023)',
    confidence: 'indicative',
  },
  electricity: {
    label: 'Electricity',
    valueTco2ePerTonne: 0.0,
    rangeTco2ePerTonne: [0.0, 1.0],
    unit: 'tCO2e/MWh',
    annexCategory: 'electricity',
    note: 'For electricity, embedded emissions are reported per MWh. Default values vary by country grid carbon intensity.',
    source: 'EU Commission default values for the CBAM transitional period (published Dec 2023)',
    confidence: 'indicative',
  },
};

const CATEGORY_KEYWORDS = {
  cement: ['cement', 'clinker', 'portland'],
  iron_and_steel: ['steel', 'iron', 'rebar', 'wire rod', 'sheet', 'coil', 'pipe', 'tube', 'bolt', 'screw', 'fastener', 'structural'],
  aluminium: ['aluminium', 'aluminum', 'alloy wheel', 'extrusion', 'foil'],
  fertilisers: ['fertiliser', 'fertilizer', 'urea', 'ammonia', 'nitrate', 'ammonium'],
  hydrogen: ['hydrogen', 'h2'],
  electricity: ['electricity', 'power import', 'electric power'],
};

const COUNTRY_CARBON_PRICE_PAID = {
  CN: { hasPrice: true, scheme: 'China National ETS', noteEur: 'Effective price ~€10–15/tCO2e (2025), credit limited to documented payment per Art. 9.', confidence: 'indicative' },
  KR: { hasPrice: true, scheme: 'Korea ETS (K-ETS)', noteEur: 'Credit limited to documented payment per Art. 9.', confidence: 'indicative' },
  GB: { hasPrice: true, scheme: 'UK ETS', noteEur: 'Credit limited to documented payment per Art. 9.', confidence: 'indicative' },
  TR: { hasPrice: false, scheme: null, noteEur: 'No operational mandatory ETS as of snapshot date.', confidence: 'indicative' },
  IN: { hasPrice: false, scheme: null, noteEur: 'No mandatory carbon price as of snapshot date.', confidence: 'indicative' },
  VN: { hasPrice: false, scheme: null, noteEur: 'No mandatory carbon price as of snapshot date.', confidence: 'indicative' },
  US: { hasPrice: false, scheme: 'Sub-national only (e.g. RGGI, California)', noteEur: 'Sub-national schemes; federal carbon price absent.', confidence: 'indicative' },
};

function detectCategory(productCategory, productDescription) {
  const haystack = [productCategory, productDescription]
    .map(text => String(text || '').toLowerCase())
    .join(' ');
  for (const [key, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(keyword => haystack.includes(keyword))) {
      return key;
    }
  }
  return null;
}

function getDefaultIntensity(categoryKey) {
  return DEFAULT_EMISSIONS_INTENSITIES[categoryKey] || null;
}

function calculateCertificateExposure({ tonnesGoods, categoryKey, etsPriceEur = ETS_PRICE_SNAPSHOT.priceEurPerTonne }) {
  const intensity = getDefaultIntensity(categoryKey);
  if (!intensity || !tonnesGoods) {
    return null;
  }

  const tonnesEmissions = tonnesGoods * intensity.valueTco2ePerTonne;
  const certificateCost = tonnesEmissions * etsPriceEur;
  const lowTonnes = tonnesGoods * intensity.rangeTco2ePerTonne[0];
  const highTonnes = tonnesGoods * intensity.rangeTco2ePerTonne[1];

  return {
    tonnesGoods,
    intensity: {
      value: intensity.valueTco2ePerTonne,
      rangeLow: intensity.rangeTco2ePerTonne[0],
      rangeHigh: intensity.rangeTco2ePerTonne[1],
      unit: intensity.unit || 'tCO2e/t',
      source: intensity.source,
      confidence: intensity.confidence,
      note: intensity.note,
    },
    tonnesEmissions: { central: tonnesEmissions, low: lowTonnes, high: highTonnes },
    etsPrice: {
      eurPerTonne: etsPriceEur,
      asOf: ETS_PRICE_SNAPSHOT.asOf,
      source: ETS_PRICE_SNAPSHOT.source,
      scenarioRange: ETS_PRICE_SNAPSHOT.scenarioRange,
    },
    certificateCostEur: {
      central: Math.round(M.toEuro(M.mulRate(M.fromEuro(etsPriceEur), tonnesEmissions))),
      low: Math.round(M.toEuro(M.mulRate(M.fromEuro(ETS_PRICE_SNAPSHOT.scenarioRange.lowEur), lowTonnes))),
      high: Math.round(M.toEuro(M.mulRate(M.fromEuro(ETS_PRICE_SNAPSHOT.scenarioRange.highEur), highTonnes))),
    },
    calc: [
      { step: 'goods', label: 'Annual covered goods', value: `${tonnesGoods.toLocaleString()} t` },
      { step: 'intensity', label: 'Default emissions intensity', value: `${intensity.valueTco2ePerTonne} ${intensity.unit || 'tCO2e/t'}`, source: intensity.source },
      { step: 'tonnesEmissions', label: 'Embedded emissions', value: `${Math.round(tonnesEmissions).toLocaleString()} tCO2e`, formula: `${tonnesGoods.toLocaleString()} × ${intensity.valueTco2ePerTonne}` },
      { step: 'etsPrice', label: 'CBAM certificate price', value: `€${etsPriceEur}/tCO2e`, source: ETS_PRICE_SNAPSHOT.source },
      { step: 'cost', label: 'Annual certificate cost (central)', value: `€${Math.round(certificateCost).toLocaleString()}`, formula: `${Math.round(tonnesEmissions).toLocaleString()} × ${etsPriceEur}` },
    ],
  };
}

function calculatePenaltyExposure({ tonnesEmissions, isAuthorisedDeclarant = true }) {
  if (!tonnesEmissions || tonnesEmissions <= 0) return null;
  const baseRateEur = 100;
  const indexedNote = 'Base €100/tCO2e under Art. 26, indexed to the European Index of Consumer Prices since 2013.';

  if (isAuthorisedDeclarant) {
    return {
      scenario: 'Authorised declarant fails to surrender certificates by 31 May',
      ratePerTonneEur: baseRateEur,
      penaltyEur: Math.round(M.toEuro(M.mulRate(M.fromEuro(baseRateEur), tonnesEmissions))),
      cumulativeWithCertificateObligation: true,
      citation: 'Regulation (EU) 2023/956, Art. 26(1)',
      note: indexedNote + ' Penalty payment does not relieve the obligation to surrender certificates.',
    };
  }

  return {
    scenario: 'Goods imported by a non-authorised CBAM declarant',
    ratePerTonneEur: baseRateEur * 4,
    rangeMultiplier: '3× to 5× the Art. 26(1) penalty',
    penaltyEur: Math.round(M.toEuro(M.mulRate(M.fromEuro(baseRateEur * 4), tonnesEmissions))),
    cumulativeWithCertificateObligation: true,
    citation: 'Regulation (EU) 2023/956, Art. 26(2)',
    note: 'Where goods enter the customs territory without an authorised CBAM declarant, the penalty is three to five times the base rate per tonne.',
  };
}

function buildCbamTimeline({ asOfDate = new Date().toISOString().slice(0, 10) } = {}) {
  const events = [
    { date: '2023-10-01', regulationId: 'cbam', milestone: 'CBAM transitional period begins', detail: 'First quarterly reporting obligation under Implementing Reg. (EU) 2023/1773.', citation: 'Regulation (EU) 2023/956, Art. 36' },
    { date: '2025-12-31', regulationId: 'cbam', milestone: 'Transitional period ends', detail: 'Last quarterly report due by 31 January 2026 covering Q4 2025.', citation: 'Implementing Regulation (EU) 2023/1773' },
    { date: '2026-01-01', regulationId: 'cbam', milestone: 'Definitive period begins', detail: 'Only authorised CBAM declarants may import covered goods. Certificate obligation begins.', citation: 'Regulation (EU) 2023/956, Art. 36' },
    { date: '2027-05-31', regulationId: 'cbam', milestone: 'First annual CBAM declaration due', detail: 'Declaration covers goods imported in calendar year 2026, including verified embedded emissions and certificate surrender.', citation: 'Regulation (EU) 2023/956, Art. 6 and Art. 22' },
  ];

  return events.map(event => ({
    ...event,
    status: event.date < asOfDate ? 'past' : (event.date === asOfDate ? 'today' : 'upcoming'),
    daysFromAsOf: Math.round((new Date(event.date) - new Date(asOfDate)) / 86400000),
  }));
}

function buildCarbonPriceCredit(originCountryCode, tonnesEmissions) {
  if (!originCountryCode) return null;
  const country = COUNTRY_CARBON_PRICE_PAID[String(originCountryCode).toUpperCase()];
  if (!country) {
    return {
      countryCode: originCountryCode,
      hasScheme: null,
      note: 'No carbon-price record on file for this country in the snapshot table. Verify via Art. 9 documentation before claiming a credit.',
      citation: 'Regulation (EU) 2023/956, Art. 9',
    };
  }
  return {
    countryCode: originCountryCode,
    hasScheme: country.hasPrice,
    scheme: country.scheme,
    note: country.noteEur,
    citation: 'Regulation (EU) 2023/956, Art. 9',
    confidence: country.confidence,
    instruction: country.hasPrice
      ? 'Collect documentation of carbon price paid in country of origin, verified by an independent person, to claim a credit reducing certificates to surrender.'
      : null,
  };
}

function buildEvidenceGaps({ categoryKey, importerEntity, supplier, originCountry, asOfDate, authorisedDeclarant }) {
  const gaps = [];
  const dueByMay31 = '2027-05-31';

  if (!authorisedDeclarant) {
    gaps.push({
      type: 'authorisation',
      title: 'Authorised CBAM declarant status not confirmed',
      severity: 'blocker',
      owner: 'Trade compliance / customs lead',
      description: 'From 1 January 2026, only persons holding authorised CBAM declarant status may import covered goods into the Union. Apply via the competent authority of the Member State of establishment.',
      citation: 'Regulation (EU) 2023/956, Art. 5',
      deadline: '2025-12-31 (apply before definitive period begins)',
    });
  }

  if (categoryKey) {
    gaps.push({
      type: 'emissions_data',
      title: `Verified embedded emissions data for ${DEFAULT_EMISSIONS_INTENSITIES[categoryKey].label.toLowerCase()}`,
      severity: 'high',
      owner: supplier ? `Supplier ${supplier} — installation operator` : 'Supplier installation operator',
      description: 'Each installation supplying covered goods must provide actual embedded emissions data per Annex IV methodology. In the absence of installation-specific data, default values apply with a mark-up.',
      citation: 'Regulation (EU) 2023/956, Art. 7 and Annex IV',
      deadline: dueByMay31,
    });
    gaps.push({
      type: 'verification',
      title: 'Verifier report from accredited verifier',
      severity: 'high',
      owner: importerEntity ? `${importerEntity} — engages verifier` : 'Importer-engaged verifier',
      description: 'Embedded emissions declared in the annual CBAM declaration must be verified by a verifier accredited under Annex VI. The verifier issues a report concluding whether declarations are free from material misstatement.',
      citation: 'Regulation (EU) 2023/956, Art. 8 and Annex VI',
      deadline: dueByMay31,
    });
  }

  if (originCountry) {
    const credit = buildCarbonPriceCredit(originCountry, 0);
    if (credit && credit.hasScheme) {
      gaps.push({
        type: 'carbon_price_credit',
        title: `Documentation of ${credit.scheme} payments for Art. 9 credit`,
        severity: 'medium',
        owner: 'Supplier / installation operator + independent verifier',
        description: 'A reduction in CBAM certificates may be claimed for a carbon price effectively paid in the country of origin, supported by documentation verified by an independent person.',
        citation: 'Regulation (EU) 2023/956, Art. 9',
        deadline: dueByMay31,
      });
    }
  }

  return gaps;
}

function determineCbamApplicability({ productCategory, productDescription, originCountry, hsCode }) {
  const categoryKey = detectCategory(productCategory, productDescription);
  const isEeaOrigin = ['IS', 'LI', 'NO', 'CH'].includes(String(originCountry || '').toUpperCase());

  if (!categoryKey) {
    return {
      applies: false,
      reason: 'Product does not match any Annex I CBAM category in the snapshot mapping. Confirm against the official Annex I CN code list before concluding non-applicability.',
      categoryKey: null,
      citation: 'Regulation (EU) 2023/956, Annex I',
      confidence: 'amber',
    };
  }

  if (isEeaOrigin) {
    return {
      applies: false,
      reason: 'Goods originating in EEA EFTA states (Iceland, Liechtenstein, Norway) and Switzerland are excluded under Art. 2.',
      categoryKey,
      citation: 'Regulation (EU) 2023/956, Art. 2(3)',
      confidence: 'green',
    };
  }

  return {
    applies: true,
    reason: `Product category matches CBAM Annex I (${DEFAULT_EMISSIONS_INTENSITIES[categoryKey].label}). Goods originating outside the EEA fall within scope when imported into the customs territory of the Union.`,
    categoryKey,
    citation: 'Regulation (EU) 2023/956, Art. 2 and Annex I',
    hsCode: hsCode || null,
    confidence: hsCode ? 'green' : 'amber',
    confidenceNote: hsCode ? null : 'Provide the CN/HS code to upgrade the applicability check from category-match to CN-level.',
  };
}

module.exports = {
  ETS_PRICE_SNAPSHOT,
  DEFAULT_EMISSIONS_INTENSITIES,
  CATEGORY_KEYWORDS,
  detectCategory,
  getDefaultIntensity,
  calculateCertificateExposure,
  calculatePenaltyExposure,
  buildCbamTimeline,
  buildCarbonPriceCredit,
  buildEvidenceGaps,
  determineCbamApplicability,
};
