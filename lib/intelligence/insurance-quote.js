// Marine cargo insurance quote calculator.
// Based on indicative market rates for European cargo insurance brokers handling
// Asia → Europe SME flows. Real binding quotes come from partner brokers
// (PZU / Warta / Allianz Trade / Atradius / Lloyd's brokers).
//
// Rates as of: 2026-04 (snapshot).
// Last reviewed: 2026-05-07.
//
// Money: premium / commission / net computed in integer cents
// (lib/intelligence/money.js, half-even rounding) so premium = commission +
// net reconciles exactly and there's no float drift.

const M = require('./money');

const RATE_SNAPSHOT = {
  asOf: '2026-04-15',
  source: 'Indicative European broker rates for SME Asia-EU cargo insurance flows. Refresh quarterly.',
  confidence: 'snapshot',
};

// Base premium rate as a percentage of insured value, by transport mode.
// Single-trip Institute Cargo Clauses (A) — all-risks.
const BASE_RATES_PCT = {
  sea_fcl: 0.06,
  sea_lcl: 0.10,
  air: 0.12,
  rail: 0.09,
};

// Goods-type loading multipliers applied to the base rate.
const GOODS_LOADING = {
  general: { multiplier: 1.0, label: 'General cargo' },
  electronics: { multiplier: 1.2, label: 'Electronics & electrical equipment' },
  textiles: { multiplier: 0.9, label: 'Textiles & apparel' },
  furniture: { multiplier: 1.0, label: 'Furniture & wood products' },
  machinery: { multiplier: 1.1, label: 'Machinery & industrial equipment' },
  food_dry: { multiplier: 1.0, label: 'Food (dry / shelf-stable)' },
  food_refrigerated: { multiplier: 1.5, label: 'Food (refrigerated / temperature-controlled)' },
  cosmetics: { multiplier: 1.1, label: 'Cosmetics & personal care' },
  toys: { multiplier: 1.0, label: 'Toys & childcare' },
  fragile: { multiplier: 1.4, label: 'Fragile goods (glass, ceramics, art)' },
  hazardous: { multiplier: 2.0, label: 'Hazardous goods (DG class)' },
  high_value: { multiplier: 1.6, label: 'High-value goods (jewellery, watches, electronics > €1k unit)' },
};

// Route-corridor loading multipliers (origin → destination corridor risk).
const ROUTE_LOADING = {
  asia_to_eu_mainline: { multiplier: 1.0, label: 'Asia → EU mainline (CN / VN / IN → DE / NL / PL / BE)', countries: { origin: ['CN', 'VN', 'IN', 'KR', 'JP', 'TW'], destination: ['DE', 'NL', 'PL', 'BE', 'FR', 'IT', 'ES', 'AT'] } },
  asia_to_eu_periphery: { multiplier: 1.15, label: 'Asia → EU periphery (CN / VN / IN → CEE / Baltics)', countries: { origin: ['CN', 'VN', 'IN', 'KR', 'JP', 'TW'], destination: ['CZ', 'SK', 'HU', 'RO', 'BG', 'LT', 'LV', 'EE', 'HR', 'SI'] } },
  africa_to_eu: { multiplier: 1.4, label: 'Africa → EU' },
  middle_east_to_eu: { multiplier: 1.3, label: 'Middle East → EU' },
  americas_to_eu: { multiplier: 1.1, label: 'Americas → EU' },
  intra_eu: { multiplier: 0.7, label: 'Intra-EU' },
  default: { multiplier: 1.2, label: 'Other corridor (default loading)' },
};

const MIN_PREMIUM_EUR = 35;
const COMMISSION_PCT = 0.12; // 12% — within the doc's 10-15% range

const COVERAGE_OPTIONS = {
  icc_a: { label: 'Institute Cargo Clauses (A) — all-risks', multiplier: 1.00, recommended: true },
  icc_b: { label: 'Institute Cargo Clauses (B) — named perils', multiplier: 0.75, recommended: false },
  icc_c: { label: 'Institute Cargo Clauses (C) — major casualties only', multiplier: 0.55, recommended: false },
};

function detectCorridor(originCountry, destinationCountry) {
  const o = String(originCountry || '').toUpperCase().slice(0, 2);
  const d = String(destinationCountry || '').toUpperCase().slice(0, 2);
  if (!o || !d) return ROUTE_LOADING.default;

  // Intra-EU short-circuit
  const euCodes = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'];
  if (euCodes.includes(o) && euCodes.includes(d)) return ROUTE_LOADING.intra_eu;

  // Check Asia-EU mainline / periphery
  const asia = ROUTE_LOADING.asia_to_eu_mainline.countries.origin;
  if (asia.includes(o)) {
    if (ROUTE_LOADING.asia_to_eu_mainline.countries.destination.includes(d)) return ROUTE_LOADING.asia_to_eu_mainline;
    if (ROUTE_LOADING.asia_to_eu_periphery.countries.destination.includes(d)) return ROUTE_LOADING.asia_to_eu_periphery;
  }

  // Other regions (very approximate)
  const africa = ['EG', 'MA', 'TN', 'DZ', 'NG', 'ZA', 'KE', 'ET', 'GH', 'CI'];
  if (africa.includes(o)) return ROUTE_LOADING.africa_to_eu;

  const middleEast = ['TR', 'IL', 'AE', 'SA', 'QA', 'JO'];
  if (middleEast.includes(o)) return ROUTE_LOADING.middle_east_to_eu;

  const americas = ['US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE'];
  if (americas.includes(o)) return ROUTE_LOADING.americas_to_eu;

  return ROUTE_LOADING.default;
}

function validateInput(input) {
  const errors = [];
  const value = Number(input.cargoValueEur);
  if (!Number.isFinite(value) || value <= 0) errors.push('cargoValueEur must be a positive number');
  if (value > 100000000) errors.push('cargoValueEur exceeds maximum supported value (€100m)');
  if (!input.transportMode || !BASE_RATES_PCT[input.transportMode]) {
    errors.push(`transportMode must be one of: ${Object.keys(BASE_RATES_PCT).join(', ')}`);
  }
  if (input.goodsType && !GOODS_LOADING[input.goodsType]) {
    errors.push(`goodsType must be one of: ${Object.keys(GOODS_LOADING).join(', ')}`);
  }
  if (input.coverage && !COVERAGE_OPTIONS[input.coverage]) {
    errors.push(`coverage must be one of: ${Object.keys(COVERAGE_OPTIONS).join(', ')}`);
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

function calculateQuote(input) {
  const validation = validateInput(input);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const value = Number(input.cargoValueEur);
  const mode = input.transportMode;
  const goodsKey = input.goodsType || 'general';
  const coverageKey = input.coverage || 'icc_a';

  const baseRatePct = BASE_RATES_PCT[mode];
  const goods = GOODS_LOADING[goodsKey];
  const route = detectCorridor(input.originCountry, input.destinationCountry);
  const coverage = COVERAGE_OPTIONS[coverageKey];

  const effectiveRatePct = baseRatePct * goods.multiplier * route.multiplier * coverage.multiplier;
  const calculatedPremium = (value * effectiveRatePct) / 100;
  const premiumCents = Math.max(M.mulRate(M.fromEuro(value), effectiveRatePct / 100), M.fromEuro(MIN_PREMIUM_EUR));
  const premiumEur = M.toEuro(premiumCents);
  const minPremiumApplied = calculatedPremium < MIN_PREMIUM_EUR;
  const commissionCents = M.mulRate(premiumCents, COMMISSION_PCT);
  const commissionEur = M.toEuro(commissionCents);
  // net = premium − commission in cents, so the breakdown reconciles exactly.
  const netToInsurerEur = M.toEuro(M.sub(premiumCents, commissionCents));

  // Indicative retail premium (what an SME would pay buying directly without group leverage)
  const retailPremiumCents = M.mulRate(premiumCents, 1.35);
  const retailPremiumEur = M.toEuro(retailPremiumCents);
  const savingsVsRetailEur = M.toEuro(M.sub(retailPremiumCents, premiumCents));

  return {
    ok: true,
    asOf: RATE_SNAPSHOT.asOf,
    inputs: {
      cargoValueEur: value,
      transportMode: mode,
      transportModeLabel: { sea_fcl: 'Sea FCL', sea_lcl: 'Sea LCL', air: 'Air', rail: 'Rail' }[mode],
      goodsType: goodsKey,
      goodsLabel: goods.label,
      coverage: coverageKey,
      coverageLabel: coverage.label,
      originCountry: input.originCountry || null,
      destinationCountry: input.destinationCountry || null,
    },
    calc: {
      baseRatePct: { value: baseRatePct, label: `${baseRatePct.toFixed(3)}% (${input.transportMode} base rate)` },
      goodsMultiplier: { value: goods.multiplier, label: `× ${goods.multiplier} (${goods.label})` },
      routeMultiplier: { value: route.multiplier, label: `× ${route.multiplier} (${route.label})` },
      coverageMultiplier: { value: coverage.multiplier, label: `× ${coverage.multiplier} (${coverage.label})` },
      effectiveRatePct,
      formula: `${value.toLocaleString('en-IE')} × ${effectiveRatePct.toFixed(4)}% = €${calculatedPremium.toFixed(2)}`,
    },
    premium: {
      eur: premiumEur,
      minPremiumApplied,
      ratePct: effectiveRatePct,
    },
    retailComparison: {
      retailPremiumEur,
      savingsVsRetailEur,
      savingsPct: Math.round((savingsVsRetailEur / retailPremiumEur) * 100),
      note: 'Indicative retail premium reflects what an SME without group leverage typically pays.',
    },
    breakdown: {
      premiumEur,
      orcaTradeCommissionEur: commissionEur,
      netToInsurerEur,
      commissionPct: COMMISSION_PCT * 100,
    },
    coverage: {
      key: coverageKey,
      label: coverage.label,
      recommended: coverage.recommended,
      whatIsCovered: coverageKey === 'icc_a'
        ? 'All risks of physical loss or damage from external cause, except specified exclusions (e.g. wilful misconduct, ordinary leakage, war and strikes — separate war/strikes cover available).'
        : coverageKey === 'icc_b'
          ? 'Named perils only: fire, vessel/conveyance casualty, jettison, washing overboard, total loss of any package lost overboard or dropped during loading/discharge, plus specified casualties.'
          : 'Major casualties only: fire, explosion, vessel sinking/stranding, collision, jettison, general average sacrifice. Significantly narrower than (A) or (B).',
    },
    snapshot: RATE_SNAPSHOT,
    nextSteps: [
      'Quote is indicative. A binding quote is issued by the partner broker following customer details and cargo specifics.',
      'Cover effective from the moment goods leave the named place of origin (warehouse-to-warehouse, ICC A).',
      'Pay-on-claim is via the partner broker. OrcaTrade is the marketplace, not the insurer.',
      'Premium can be added to the shipment invoice or paid separately at quote acceptance.',
    ],
  };
}

function listGoodsTypes() {
  return Object.entries(GOODS_LOADING).map(([key, def]) => ({ key, label: def.label, multiplier: def.multiplier }));
}

function listTransportModes() {
  return Object.entries(BASE_RATES_PCT).map(([key, ratePct]) => ({
    key,
    label: { sea_fcl: 'Sea FCL', sea_lcl: 'Sea LCL', air: 'Air', rail: 'Rail (China–Europe)' }[key] || key,
    baseRatePct: ratePct,
  }));
}

function listCoverageOptions() {
  return Object.entries(COVERAGE_OPTIONS).map(([key, def]) => ({ key, label: def.label, multiplier: def.multiplier, recommended: def.recommended }));
}

module.exports = {
  RATE_SNAPSHOT,
  BASE_RATES_PCT,
  GOODS_LOADING,
  ROUTE_LOADING,
  COVERAGE_OPTIONS,
  MIN_PREMIUM_EUR,
  COMMISSION_PCT,
  detectCorridor,
  validateInput,
  calculateQuote,
  listGoodsTypes,
  listTransportModes,
  listCoverageOptions,
};
