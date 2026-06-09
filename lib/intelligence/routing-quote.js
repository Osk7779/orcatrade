// Multi-modal routing — sea FCL / sea LCL / air / rail comparison.
// Educates importers on rail viability for China-Europe (the doc's "underused by SMEs because
// nobody understands it"). Indicative rates only — binding quotes follow from forwarder partners.
//
// Money: transport cost computed in integer cents (lib/intelligence/money.js,
// half-even rounding, no float drift).

const M = require('./money');

const PRICING_SNAPSHOT = {
  asOf: '2026-04-15',
  source: 'Indicative spot-rate snapshot for Asia-EU lanes from OrcaTrade partner forwarders. Volatile — refresh quarterly.',
  confidence: 'snapshot',
};

// Per-kg base rates (€/kg), exclusive of customs, doc fees, last-mile, etc.
// FCL is volumetric (priced per container); we use a per-kg-equivalent for comparison
// based on a representative 18-tonne 40' HC payload.
const BASE_RATES = {
  sea_fcl: { eurPerKg: 0.55, label: 'Sea FCL (40\' HC)', note: 'Per-kg equivalent at 18,000 kg payload' },
  sea_lcl: { eurPerKg: 1.40, label: 'Sea LCL', note: 'Per-kg, includes consolidation' },
  air: { eurPerKg: 6.50, label: 'Air freight', note: 'Per chargeable kg (greater of actual or volumetric)' },
  rail: { eurPerKg: 1.85, label: 'Rail (China–EU via Małaszewicze)', note: 'Per chargeable kg, full-train consolidation' },
};

// Door-to-door transit ranges (business days)
const TRANSIT_DAYS = {
  sea_fcl: { min: 30, max: 40, label: '30–40 days door-to-door' },
  sea_lcl: { min: 35, max: 50, label: '35–50 days door-to-door' },
  air: { min: 4, max: 9, label: '4–9 days door-to-door' },
  rail: { min: 18, max: 26, label: '18–26 days door-to-door' },
};

// CO2 emissions in grams per tonne-kilometre (tCO2e × 1000 / tkm)
const CO2_GRAMS_PER_TKM = {
  sea_fcl: 10,
  sea_lcl: 14,
  air: 600,
  rail: 30,
};

// Indicative one-way distances (km) for typical Asia → EU corridors used in CO2 calculation
const CORRIDOR_DISTANCES_KM = {
  CN_to_EU_main: 19500, // sea route Shanghai → Hamburg
  CN_to_EU_rail: 11500, // rail via Khorgos / Małaszewicze
  CN_to_EU_air: 8800,
  VN_to_EU_main: 18000,
  IN_to_EU_main: 12000,
  default: 19000,
};

// Fixed surcharges per mode (handling, brokerage, last-mile)
const FIXED_SURCHARGES = {
  sea_fcl: 480,
  sea_lcl: 220,
  air: 150,
  rail: 280,
};

// Rail is only viable for shipments routed through China-Europe Railway Express via Małaszewicze.
// Origin must be in mainland China (some intermodal works for Vietnam-China-EU, but indicative).
// Destination must be in EU mainland or CEE (Małaszewicze is the gateway).
const RAIL_VIABLE_ORIGINS = ['CN', 'KZ', 'KG'];
const RAIL_VIABLE_DESTINATIONS = ['PL', 'DE', 'CZ', 'SK', 'HU', 'AT', 'NL', 'BE', 'FR', 'IT', 'LT', 'LV', 'EE', 'RO', 'BG', 'SI', 'HR'];

// Origin lane multiplier — adjusts cost across all modes by route distance / port pair
const ORIGIN_MULTIPLIER = {
  CN: 1.00,
  HK: 1.00,
  VN: 1.10,
  IN: 1.20,
  TW: 1.05,
  KR: 1.05,
  JP: 1.10,
  TR: 0.55,
  default: 1.30,
};

function detectOriginMultiplier(country) {
  const code = String(country || '').toUpperCase().slice(0, 2);
  return ORIGIN_MULTIPLIER[code] != null ? ORIGIN_MULTIPLIER[code] : ORIGIN_MULTIPLIER.default;
}

function isRailViable({ originCountry, destinationCountry }) {
  const o = String(originCountry || '').toUpperCase().slice(0, 2);
  const d = String(destinationCountry || '').toUpperCase().slice(0, 2);
  if (!o || !d) return false;
  return RAIL_VIABLE_ORIGINS.includes(o) && RAIL_VIABLE_DESTINATIONS.includes(d);
}

function chargeableWeightKg({ weightKg, volumeCbm }) {
  const w = Number(weightKg) || 0;
  const v = Number(volumeCbm) || 0;
  // Air uses 167 kg/m³ as the standard volumetric divisor (1:6 ratio); sea uses 1000 kg/m³ ratio approx.
  const volumetricForAir = v * 167;
  const volumetricForSea = v * 333;
  return {
    actual: w,
    volumetricAir: volumetricForAir,
    chargeableAir: Math.max(w, volumetricForAir),
    volumetricSea: volumetricForSea,
    chargeableSea: Math.max(w, volumetricForSea),
  };
}

function corridorDistance({ originCountry, mode }) {
  const code = String(originCountry || '').toUpperCase().slice(0, 2);
  if (code === 'CN') {
    if (mode === 'rail') return CORRIDOR_DISTANCES_KM.CN_to_EU_rail;
    if (mode === 'air') return CORRIDOR_DISTANCES_KM.CN_to_EU_air;
    return CORRIDOR_DISTANCES_KM.CN_to_EU_main;
  }
  if (code === 'VN') return CORRIDOR_DISTANCES_KM.VN_to_EU_main;
  if (code === 'IN') return CORRIDOR_DISTANCES_KM.IN_to_EU_main;
  return CORRIDOR_DISTANCES_KM.default;
}

function calcCO2({ totalKg, mode, originCountry }) {
  const grams = CO2_GRAMS_PER_TKM[mode] || 0;
  const km = corridorDistance({ originCountry, mode });
  const tkm = (totalKg / 1000) * km;
  return Math.round(grams * tkm); // grams CO2e total
}

function validateInput(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    errors.push('input must be an object');
    return { ok: false, errors };
  }
  const w = Number(input.weightKg);
  if (!Number.isFinite(w) || w <= 0) errors.push('weightKg must be a positive number');
  if (w > 200000) errors.push('weightKg exceeds 200,000 (contact us for very large freight)');

  if (input.volumeCbm != null) {
    const v = Number(input.volumeCbm);
    if (!Number.isFinite(v) || v < 0) errors.push('volumeCbm must be 0 or higher');
  }

  if (!input.originCountry || String(input.originCountry).length !== 2) errors.push('originCountry (ISO-2) is required');
  if (!input.destinationCountry || String(input.destinationCountry).length !== 2) errors.push('destinationCountry (ISO-2) is required');
  return errors.length ? { ok: false, errors } : { ok: true };
}

function calculateModeQuote(mode, { weightKg, volumeCbm, originCountry, destinationCountry }) {
  const isAir = mode === 'air';
  const cw = chargeableWeightKg({ weightKg, volumeCbm });
  const charge = isAir ? cw.chargeableAir : (mode === 'sea_lcl' ? Math.max(weightKg, (Number(volumeCbm) || 0) * 1000) : weightKg);

  const ratePerKg = BASE_RATES[mode].eurPerKg;
  const originMultiplier = detectOriginMultiplier(originCountry);
  const surcharge = FIXED_SURCHARGES[mode];
  const transportCostCents = M.mulRate(M.fromEuro(ratePerKg), charge * originMultiplier);
  const totalEur = M.toEuro(Math.max(0, M.add(transportCostCents, M.fromEuro(surcharge))));

  const transit = TRANSIT_DAYS[mode];
  const co2grams = calcCO2({ totalKg: weightKg, mode, originCountry });
  const distanceKm = corridorDistance({ originCountry, mode });

  // Viability: rail only viable on CN-to-EU corridors.
  let viable = true;
  let viabilityReason = '';
  if (mode === 'rail' && !isRailViable({ originCountry, destinationCountry })) {
    viable = false;
    viabilityReason = 'Rail viable only on China-Europe corridors via Małaszewicze. Origin or destination outside the rail-network coverage.';
  }
  // Sea FCL becomes inefficient below ~3000kg of dense cargo
  if (mode === 'sea_fcl' && weightKg < 3000) {
    viable = true; // still allow but note caveat
  }

  return {
    mode,
    label: BASE_RATES[mode].label,
    note: BASE_RATES[mode].note,
    viable,
    viabilityReason,
    chargeableWeightKg: Math.round(charge * 100) / 100,
    ratePerKgEur: ratePerKg,
    originMultiplier,
    fixedSurchargeEur: surcharge,
    totalEur,
    transitDaysLabel: transit.label,
    transitMinDays: transit.min,
    transitMaxDays: transit.max,
    co2grams,
    co2kg: Math.round(co2grams / 1000 * 100) / 100,
    co2gramsPerTkm: CO2_GRAMS_PER_TKM[mode],
    distanceKm,
    formula: `${charge.toLocaleString('en-IE')}kg × €${ratePerKg}/kg × ${originMultiplier.toFixed(2)} + €${surcharge} surcharge`,
  };
}

function recommendMode({ quotes, weightKg, urgencyDays, costPriority }) {
  const viable = quotes.filter(q => q.viable);
  if (!viable.length) return { primary: null, reasoning: 'No viable mode detected. Contact us directly.' };

  // If urgency tight (<14 days), force air
  if (Number.isFinite(urgencyDays) && urgencyDays < 14) {
    const air = viable.find(q => q.mode === 'air');
    if (air) return {
      primary: 'air',
      primaryQuote: air,
      reasoning: `Urgency requirement (delivery within ${urgencyDays} days) only achievable via air freight. Sea/rail/FCL all exceed the time window.`,
    };
  }

  // Cost-priority: cheapest viable
  if (costPriority === 'cost') {
    viable.sort((a, b) => a.totalEur - b.totalEur);
    const cheapest = viable[0];
    return {
      primary: cheapest.mode,
      primaryQuote: cheapest,
      reasoning: `Cheapest viable mode: ${cheapest.label} at €${cheapest.totalEur} (${cheapest.transitDaysLabel}).`,
    };
  }

  // Default: balanced (rail wins for China-EU 200kg–10t mid-volume)
  const rail = viable.find(q => q.mode === 'rail');
  const air = viable.find(q => q.mode === 'air');
  const seaFcl = viable.find(q => q.mode === 'sea_fcl');
  const seaLcl = viable.find(q => q.mode === 'sea_lcl');

  if (rail && weightKg >= 200 && weightKg <= 5000) {
    return {
      primary: 'rail',
      primaryQuote: rail,
      reasoning: `Rail (€${rail.totalEur}, ${rail.transitDaysLabel}) is the balanced sweet spot for ${weightKg}kg China-EU shipments — typically 30–50% cheaper than air and 10–15 days faster than sea, with substantially lower CO₂ than air.`,
    };
  }
  // Above 5t, sea FCL almost always wins on cost; rail is the speed alternative.
  if (seaFcl && weightKg > 5000) {
    const railNote = rail ? ` Rail (€${rail.totalEur}) is available as the faster alternative if 10–15 days of transit savings justify the cost premium.` : '';
    return {
      primary: 'sea_fcl',
      primaryQuote: seaFcl,
      reasoning: `Sea FCL (€${seaFcl.totalEur}, ${seaFcl.transitDaysLabel}) is the most cost-efficient for ${weightKg}kg+ shipments.${railNote}`,
    };
  }
  if (seaFcl && weightKg >= 10000) {
    return {
      primary: 'sea_fcl',
      primaryQuote: seaFcl,
      reasoning: `Sea FCL (€${seaFcl.totalEur}, ${seaFcl.transitDaysLabel}) is the most cost-efficient for ${weightKg}kg+ shipments. Transit longer but cost-per-kg materially lower.`,
    };
  }
  if (air && weightKg < 200) {
    return {
      primary: 'air',
      primaryQuote: air,
      reasoning: `Air (€${air.totalEur}, ${air.transitDaysLabel}) is the only practical mode for shipments under ~200kg — sea LCL has minimums and rail has consolidation thresholds.`,
    };
  }
  if (seaLcl) {
    return {
      primary: 'sea_lcl',
      primaryQuote: seaLcl,
      reasoning: `Sea LCL (€${seaLcl.totalEur}, ${seaLcl.transitDaysLabel}) is the balanced choice given current inputs.`,
    };
  }

  // Fallback to cheapest viable
  viable.sort((a, b) => a.totalEur - b.totalEur);
  const cheapest = viable[0];
  return {
    primary: cheapest.mode,
    primaryQuote: cheapest,
    reasoning: `Cheapest viable mode: ${cheapest.label} at €${cheapest.totalEur}.`,
  };
}

function calculateQuote(input) {
  const validation = validateInput(input);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const w = Number(input.weightKg);
  const v = Number(input.volumeCbm) || 0;
  const o = String(input.originCountry).toUpperCase();
  const d = String(input.destinationCountry).toUpperCase();
  const urgencyDays = Number(input.urgencyDays);
  const costPriority = input.costPriority === 'cost' ? 'cost' : 'balanced';

  const modes = ['sea_fcl', 'sea_lcl', 'air', 'rail'];
  const quotes = modes.map(mode => calculateModeQuote(mode, {
    weightKg: w, volumeCbm: v, originCountry: o, destinationCountry: d,
  }));

  const recommendation = recommendMode({ quotes, weightKg: w, urgencyDays, costPriority });

  return {
    ok: true,
    asOf: PRICING_SNAPSHOT.asOf,
    inputs: {
      weightKg: w,
      volumeCbm: v,
      originCountry: o,
      destinationCountry: d,
      urgencyDays: Number.isFinite(urgencyDays) ? urgencyDays : null,
      costPriority,
    },
    quotes,
    recommendation,
    snapshot: PRICING_SNAPSHOT,
    railEducation: {
      whyRailMatters: 'Rail via Małaszewicze (the China-Europe Railway Express terminus on the Polish border) is faster than sea by ~12–15 days and cheaper than air by ~70%. Most SMEs default to sea or air because forwarders rarely propose rail unless asked.',
      bestForRail: 'Best for 200kg–10t shipments from China where transit time matters but air freight cost is prohibitive.',
      whenRailIsWrong: 'Not viable for non-China origins (no continuous rail network from Vietnam / India / SEA). For China-origin shipments under ~200kg, air is more practical due to consolidation overheads.',
    },
    nextSteps: [
      'Quote is indicative based on snapshot rates. Real quotes from partner forwarders refresh every 1–2 weeks.',
      'Submit a routing request — we send the lane to 2-3 partner forwarders and return binding quotes within 24 hours.',
      'Cargo insurance, customs clearance, and EU last-mile are added separately at the next stage.',
    ],
  };
}

function listModes() {
  return Object.entries(BASE_RATES).map(([key, def]) => ({ key, label: def.label, eurPerKg: def.eurPerKg }));
}

// ── Tier-A coverage manifest (ADR 0020) ───────────────────────────────
//
// Universal envelope for routing-quote outputs. The weightKg axis is
// bounded by cargo physics: 1 kg floor (rejects zero/negative) and
// 50,000 kg ceiling (one 40' HC container typically caps at ~26 tonnes;
// 50 t covers the largest practical FCL + room for batch consolidation).
// Above that, ops handles dedicated charter — not a wizard quote.
//
// Honest posture: PRICING_SNAPSHOT is an indicative spot-rate snapshot
// from OrcaTrade partner forwarders (volatile, refreshed quarterly).
// source_kind = 'mirror' today; TA-2 reliably fails. The path to
// primary regulator sources runs through carrier-published rate
// indices (e.g. SCFI for sea, IATA TACT for air, UIC published rates
// for rail) — when those wire in, TA-2 will flip without further
// changes to the Tier-A surface.
const TIER_A_COVERAGE = Object.freeze({
  calculatorName: 'routing-quote',
  version: 1,
  axes: Object.freeze({
    weightKg: { type: 'integer-range', min: 1, max: 50_000 },
  }),
});

// ── Tier-A: build an EligibilityInput from a quote result ─────────────
//
// Same shape as customs-quote / finance-quote / sourcing-quote
// buildTierAInput. Reads result.inputs.weightKg and surfaces it as
// coverageInput.weightKg.

/**
 * @param {object} quoteResult
 */
function buildTierAInput(quoteResult) {
  if (!quoteResult || quoteResult.ok !== true) {
    return {
      calculatorName: TIER_A_COVERAGE.calculatorName,
      snapshots: [],
      escalations: [],
      overrides: [],
      coverageInput: {},
      calculatorCoverage: TIER_A_COVERAGE,
    };
  }

  const snapshots = [{
    id: `routing-quote:pricing@${PRICING_SNAPSHOT.asOf}`,
    source_kind: 'mirror',
    as_of_iso: toIsoStartOfDay(PRICING_SNAPSHOT.asOf),
  }];

  // Round to integer kg for the integer-range axis. validateInput
  // already restricts weightKg to a positive number; the integer
  // rounding matches what shipment_master.weight_kg stores.
  const rawWeight = quoteResult.inputs && Number(quoteResult.inputs.weightKg);
  const weightKg = Number.isFinite(rawWeight) ? Math.round(rawWeight) : 0;

  return {
    calculatorName: TIER_A_COVERAGE.calculatorName,
    snapshots,
    escalations: [],
    overrides: [],
    coverageInput: { weightKg },
    calculatorCoverage: TIER_A_COVERAGE,
  };
}

// Same shape as the helpers in customs-quote.js / finance-quote.js /
// sourcing-quote.js — tolerate the two PRICING_SNAPSHOT.asOf forms
// ('YYYY-MM-DD' + full ISO string).
function toIsoStartOfDay(ymd) {
  if (typeof ymd !== 'string') return new Date(0).toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return `${ymd}T00:00:00.000Z`;
  return toIsoSafe(ymd);
}
function toIsoSafe(maybeIso) {
  if (typeof maybeIso !== 'string') return new Date(0).toISOString();
  const t = Date.parse(maybeIso);
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date(0).toISOString();
}

module.exports = {
  PRICING_SNAPSHOT,
  TIER_A_COVERAGE,
  buildTierAInput,
  BASE_RATES,
  TRANSIT_DAYS,
  CO2_GRAMS_PER_TKM,
  CORRIDOR_DISTANCES_KM,
  FIXED_SURCHARGES,
  RAIL_VIABLE_ORIGINS,
  RAIL_VIABLE_DESTINATIONS,
  ORIGIN_MULTIPLIER,
  detectOriginMultiplier,
  isRailViable,
  chargeableWeightKg,
  corridorDistance,
  calcCO2,
  validateInput,
  calculateModeQuote,
  recommendMode,
  calculateQuote,
  listModes,
};
