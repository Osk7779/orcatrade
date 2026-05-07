// Sample Management Service — pricing for HK consolidated sample shipping.
// Customer requests samples from N suppliers → OrcaTrade HK office collects → one consolidated parcel → Europe.

const PRICING_SNAPSHOT = {
  asOf: '2026-04-15',
  source: 'OrcaTrade HK office consolidation rates and partner courier rates (DHL Express, FedEx Economy). Refresh quarterly.',
  confidence: 'snapshot',
};

// Base consolidation fee (HK office handling)
const BASE_CONSOLIDATION_FEE_EUR = 40;
const PER_SUPPLIER_FEE_EUR = 15;
const RUSH_TURNAROUND_FEE_EUR = 30;

// Tiered shipping by total weight band, in EUR. Standard courier (DHL Economy or partner consolidator).
const SHIPPING_BANDS = [
  { maxWeightKg: 1, eur: 25, label: 'Up to 1 kg' },
  { maxWeightKg: 5, eur: 40, label: '1 to 5 kg' },
  { maxWeightKg: 10, eur: 60, label: '5 to 10 kg' },
  { maxWeightKg: 20, eur: 90, label: '10 to 20 kg' },
  { maxWeightKg: 35, eur: 130, label: '20 to 35 kg' },
  { maxWeightKg: Infinity, eur: 180, label: 'Over 35 kg (palletised)' },
];

// Express courier surcharge (DHL Express / FedEx Priority — typically saves 3-5 days)
const EXPRESS_SURCHARGE_EUR = 35;

// Destination-region surcharge on top of standard shipping
const DESTINATION_SURCHARGE = {
  EU_MAINLAND: { multiplier: 1.0, label: 'EU mainland' },
  CEE_BALTICS: { multiplier: 1.05, label: 'CEE / Baltic states' },
  UK: { multiplier: 1.10, label: 'United Kingdom' },
  NORDICS: { multiplier: 1.15, label: 'Nordic countries' },
  SOUTHERN_EU: { multiplier: 1.10, label: 'Southern EU + islands' },
  SWITZERLAND: { multiplier: 1.20, label: 'Switzerland (non-EU)' },
  OTHER: { multiplier: 1.30, label: 'Other / non-EU' },
};

const COUNTRY_TO_REGION = {
  PL: 'CEE_BALTICS', CZ: 'CEE_BALTICS', SK: 'CEE_BALTICS', HU: 'CEE_BALTICS',
  RO: 'CEE_BALTICS', BG: 'CEE_BALTICS', LT: 'CEE_BALTICS', LV: 'CEE_BALTICS',
  EE: 'CEE_BALTICS', SI: 'CEE_BALTICS', HR: 'CEE_BALTICS',
  DE: 'EU_MAINLAND', NL: 'EU_MAINLAND', BE: 'EU_MAINLAND', FR: 'EU_MAINLAND',
  AT: 'EU_MAINLAND', LU: 'EU_MAINLAND',
  IT: 'SOUTHERN_EU', ES: 'SOUTHERN_EU', PT: 'SOUTHERN_EU', GR: 'SOUTHERN_EU',
  MT: 'SOUTHERN_EU', CY: 'SOUTHERN_EU',
  SE: 'NORDICS', DK: 'NORDICS', FI: 'NORDICS', IE: 'NORDICS',
  GB: 'UK',
  CH: 'SWITZERLAND', NO: 'SWITZERLAND',
};

function detectDestinationRegion(country) {
  const code = String(country || '').toUpperCase().slice(0, 2);
  if (!code) return DESTINATION_SURCHARGE.OTHER;
  const region = COUNTRY_TO_REGION[code];
  return DESTINATION_SURCHARGE[region] || DESTINATION_SURCHARGE.OTHER;
}

function pickShippingBand(totalWeightKg) {
  const w = Math.max(0, Number(totalWeightKg) || 0);
  for (const band of SHIPPING_BANDS) {
    if (w <= band.maxWeightKg) return band;
  }
  return SHIPPING_BANDS[SHIPPING_BANDS.length - 1];
}

function validateInput(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    errors.push('input must be an object');
    return { ok: false, errors };
  }
  const supplierCount = Number(input.supplierCount);
  if (!Number.isFinite(supplierCount) || supplierCount < 1) errors.push('supplierCount must be at least 1');
  if (supplierCount > 25) errors.push('supplierCount exceeds 25 (contact us for bulk consolidation)');

  const weight = Number(input.totalWeightKg);
  if (!Number.isFinite(weight) || weight < 0) errors.push('totalWeightKg must be 0 or higher');
  if (weight > 100) errors.push('totalWeightKg exceeds 100 kg (samples consolidation cap; for production volume use Logistics tier)');

  if (!input.destinationCountry || String(input.destinationCountry).length !== 2) {
    errors.push('destinationCountry (ISO-2) is required');
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

function calculateQuote(input) {
  const validation = validateInput(input);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const supplierCount = Number(input.supplierCount);
  const totalWeightKg = Number(input.totalWeightKg);
  const region = detectDestinationRegion(input.destinationCountry);
  const band = pickShippingBand(totalWeightKg);
  const isExpress = input.express === true;
  const isRush = input.rushTurnaround === true;

  const consolidationFeeEur = Math.round((BASE_CONSOLIDATION_FEE_EUR + (PER_SUPPLIER_FEE_EUR * supplierCount)) * 100) / 100;
  const baseShippingEur = Math.round(band.eur * region.multiplier * 100) / 100;
  const expressSurchargeEur = isExpress ? EXPRESS_SURCHARGE_EUR : 0;
  const rushSurchargeEur = isRush ? RUSH_TURNAROUND_FEE_EUR : 0;

  const subtotalEur = consolidationFeeEur + baseShippingEur + expressSurchargeEur + rushSurchargeEur;
  const totalEur = Math.round(subtotalEur * 100) / 100;

  const estimatedTransitDays = isExpress ? '3–5 business days' : '7–10 business days';
  const estimatedConsolidationDays = isRush ? '2 business days at HK office' : '5–7 business days at HK office';

  return {
    ok: true,
    asOf: PRICING_SNAPSHOT.asOf,
    inputs: {
      supplierCount,
      totalWeightKg,
      destinationCountry: String(input.destinationCountry).toUpperCase(),
      destinationRegion: region.label,
      express: isExpress,
      rushTurnaround: isRush,
    },
    breakdown: {
      consolidationFee: {
        eur: consolidationFeeEur,
        formula: `€${BASE_CONSOLIDATION_FEE_EUR} base + (€${PER_SUPPLIER_FEE_EUR} × ${supplierCount} suppliers)`,
        label: 'HK office consolidation handling',
      },
      shipping: {
        eur: baseShippingEur,
        bandLabel: band.label,
        regionLabel: region.label,
        formula: `€${band.eur} × ${region.multiplier} (${region.label})`,
        label: `Standard courier · ${band.label}`,
      },
      expressSurcharge: isExpress ? {
        eur: expressSurchargeEur,
        label: 'DHL Express / FedEx Priority upgrade',
      } : null,
      rushSurcharge: isRush ? {
        eur: rushSurchargeEur,
        label: 'Rush 2-day consolidation at HK office',
      } : null,
      totalEur,
    },
    timeline: {
      consolidation: estimatedConsolidationDays,
      transit: estimatedTransitDays,
      totalEstimate: isExpress && isRush ? '5–7 business days end-to-end' : isExpress ? '8–12 business days' : isRush ? '9–12 business days' : '12–17 business days',
    },
    snapshot: PRICING_SNAPSHOT,
    nextSteps: [
      'Submit a sample request — we contact each supplier and arrange collection at our HK office.',
      'We consolidate, photo-log, and weigh the parcel, then issue you a final quote.',
      'On approval, we ship via the courier and tier you selected.',
      'Final invoice on dispatch; tracking link emailed when the parcel leaves HK.',
    ],
    inclusions: [
      'Supplier contact and collection coordination',
      'Photo logging of every received sample',
      'Re-packaging into one consolidated parcel',
      'Standard or express courier dispatch',
      'EU customs clearance via Polish broker partner (samples typically zero-rated for duty when properly declared)',
    ],
    exclusions: [
      'Sample purchase cost (paid directly by customer to supplier)',
      'EU duty / VAT if samples exceed €22 declared value (rare — most samples are zero-value for customs)',
      'Specialist handling: dangerous goods, food samples requiring chilled transport, hazardous materials',
    ],
  };
}

function listShippingBands() {
  return SHIPPING_BANDS.map(b => ({ label: b.label, eur: b.eur }));
}

function listDestinationRegions() {
  return Object.entries(DESTINATION_SURCHARGE).map(([key, def]) => ({
    key, label: def.label, multiplier: def.multiplier,
  }));
}

module.exports = {
  PRICING_SNAPSHOT,
  BASE_CONSOLIDATION_FEE_EUR,
  PER_SUPPLIER_FEE_EUR,
  RUSH_TURNAROUND_FEE_EUR,
  EXPRESS_SURCHARGE_EUR,
  SHIPPING_BANDS,
  DESTINATION_SURCHARGE,
  COUNTRY_TO_REGION,
  detectDestinationRegion,
  pickShippingBand,
  validateInput,
  calculateQuote,
  listShippingBands,
  listDestinationRegions,
};
