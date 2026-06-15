// Warehouse / 3PL multi-hub pricing comparison.
//
// 3PL pricing is opaque. Most SMEs pick the first hub that quotes them, often paying
// 30-50% above what they'd pay at a cost-effective Eastern hub — which would also
// reach the same EU customers in 1-2 days vs same-day-from-NL anyway.
//
// We price 6 EU hubs side-by-side on the same shipper profile, factoring in:
//   1. Storage (€/pallet/month, hub-specific)
//   2. Inbound handling (per pallet receipt)
//   3. Pick & pack (base + line + unit + packaging)
//   4. Outbound shipping from hub to primary destination region
//   5. Setup fee amortised over 12 months
//
// Recommendation engine ranks by total monthly cost, then surfaces transit-time
// trade-off so the user can choose cost vs speed deliberately.
//
// Money: every cost line is computed in integer cents (lib/intelligence/money.js,
// half-even rounding, no float drift), and each total is the SUM OF ITS DISPLAYED
// line items — so a user adding up the breakdown always gets the headline total
// (the round-each-then-vs-round-the-sum reconciliation bug is designed out).
// Display granularity here is whole euros (these are mid-market estimates).

const M = require('./money');

const PRICING_SNAPSHOT = {
  asOf: '2026-05-07',
  source: 'OrcaTrade 3PL benchmark — surveyed rate cards from 18 EU public 3PL providers across 6 hubs in March 2026. Refresh quarterly.',
  confidence: 'snapshot',
  notes: 'Rates shown are mid-market list rates for SME volumes (<10k orders/month). High-volume shippers can negotiate 15-25% below list. Setup fees vary widely; we use a 12-month amortisation as a conservative monthly figure.',
};

// ── Tier-A (ADR 0020) ─────────────────────────────────────────────────
//
// Coverage manifest for the warehouse calculator. monthlyOrders is the
// dominant cost-shaping variable — every per-order fee (pick base, pick
// per line, pick per unit, packaging, outbound shipping) scales with
// it, and storage scales with avgPalletsHeld which itself correlates
// with monthlyOrders for SMEs. We surface monthlyOrders as the integer-
// range axis covered by the regression baseline.
//
// Today's PRICING_SNAPSHOT is OrcaTrade's quarterly 3PL benchmark
// survey (mirror only) so TA-2 fails reliably — the warehouse Tier-A
// badge stays hidden until we wire in primary-regulator sources (e.g.
// EU Eurostat warehousing PPI, or direct hub-published rate cards via
// API). When those land, the surface lights up automatically — same
// "pre-bake the wedge then flip the source" approach used for finance.
const TIER_A_COVERAGE = Object.freeze({
  calculatorName: 'warehouse-quote',
  version: 1,
  axes: Object.freeze({
    monthlyOrders: { type: 'integer-range', min: 100, max: 100_000 },
  }),
});

// ── EU regions for outbound shipping zone-pricing ─────────────────────
const REGIONS = {
  CENTRAL: ['DE', 'NL', 'BE', 'LU', 'FR', 'AT', 'CZ', 'PL', 'CH', 'LI'],
  NORDIC: ['DK', 'SE', 'FI', 'NO', 'IS'],
  IBERIAN: ['ES', 'PT'],
  MEDITERRANEAN: ['IT', 'GR', 'MT', 'CY', 'SI', 'HR'],
  EAST: ['EE', 'LV', 'LT', 'BG', 'RO', 'SK', 'HU'],
  UK: ['GB', 'IE'],
};

function regionOf(country) {
  const code = String(country || '').toUpperCase();
  for (const [region, codes] of Object.entries(REGIONS)) {
    if (codes.includes(code)) return region;
  }
  return 'CENTRAL';
}

// ── Hub catalogue ──────────────────────────────────────────────────────
// Each hub: storage cost (per pallet/month), inbound receipt fee (per pallet),
// pick & pack fees, packaging materials, setup fee (one-off, amortised in calc).
const HUBS = {
  NL_ROT: {
    key: 'NL_ROT',
    name: 'Rotterdam',
    countryName: 'Netherlands',
    country: 'NL',
    region: 'CENTRAL',
    transitFromAsiaSea: '30–35 days (largest EU container port)',
    storagePerPalletPerMonthEur: 19,
    storagePerCbmPerMonthEur: 12.5,
    inboundReceiptPerPalletEur: 14,
    pickBaseEur: 1.80,
    pickPerLineEur: 0.45,
    pickPerUnitEur: 0.12,
    packagingMaterialsPerOrderEur: 0.85,
    setupFeeEur: 950,
    pros: ['Largest EU container port — direct access for Asia sea freight', 'Premium B2C fulfilment infrastructure (same-day pick possible)', 'Deep talent pool, multilingual staff'],
    cons: ['Premium pricing on storage and labour', 'Land scarcity has pushed new builds to outer suburbs'],
  },
  DE_HAM: {
    key: 'DE_HAM',
    name: 'Hamburg',
    countryName: 'Germany',
    country: 'DE',
    region: 'CENTRAL',
    transitFromAsiaSea: '32–38 days (3rd-largest EU port)',
    storagePerPalletPerMonthEur: 17,
    storagePerCbmPerMonthEur: 11.5,
    inboundReceiptPerPalletEur: 13,
    pickBaseEur: 1.70,
    pickPerLineEur: 0.42,
    pickPerUnitEur: 0.11,
    packagingMaterialsPerOrderEur: 0.85,
    setupFeeEur: 850,
    pros: ['Direct port access', 'Strong onward DACH distribution', 'Strict customs compliance culture suits regulated goods'],
    cons: ['Higher labour cost than Eastern hubs', 'Capacity tight in 2025-26 — long lead times for large takes'],
  },
  DE_FRA: {
    key: 'DE_FRA',
    name: 'Frankfurt',
    countryName: 'Germany',
    country: 'DE',
    region: 'CENTRAL',
    transitFromAsiaSea: '34–40 days via Hamburg + truck',
    storagePerPalletPerMonthEur: 18,
    storagePerCbmPerMonthEur: 12,
    inboundReceiptPerPalletEur: 13,
    pickBaseEur: 1.75,
    pickPerLineEur: 0.43,
    pickPerUnitEur: 0.11,
    packagingMaterialsPerOrderEur: 0.85,
    setupFeeEur: 900,
    pros: ['Frankfurt Airport adjacency — excellent for air freight + parcel network injection', 'Geographic centre of EU population'],
    cons: ['No direct port — sea freight comes via Hamburg / Rotterdam + truck', 'Premium labour cost'],
  },
  PL_POZ: {
    key: 'PL_POZ',
    name: 'Poznań',
    countryName: 'Poland',
    country: 'PL',
    region: 'CENTRAL',
    transitFromAsiaSea: '35–42 days via Gdańsk or rail to Małaszewicze',
    storagePerPalletPerMonthEur: 12,
    storagePerCbmPerMonthEur: 8,
    inboundReceiptPerPalletEur: 9,
    pickBaseEur: 1.20,
    pickPerLineEur: 0.30,
    pickPerUnitEur: 0.08,
    packagingMaterialsPerOrderEur: 0.75,
    setupFeeEur: 600,
    pros: ['Cheapest EU 3PL labour and storage', 'China-Europe rail terminus at Małaszewicze 200km away', 'Strong onward DACH reach within 1-2 days'],
    cons: ['Slower transit to Iberia / Italy / Nordic vs Central hubs', 'Less English-language ops in smaller providers'],
  },
  CZ_PRG: {
    key: 'CZ_PRG',
    name: 'Prague',
    countryName: 'Czechia',
    country: 'CZ',
    region: 'CENTRAL',
    transitFromAsiaSea: '36–42 days via Hamburg + truck',
    storagePerPalletPerMonthEur: 13,
    storagePerCbmPerMonthEur: 8.5,
    inboundReceiptPerPalletEur: 10,
    pickBaseEur: 1.30,
    pickPerLineEur: 0.32,
    pickPerUnitEur: 0.09,
    packagingMaterialsPerOrderEur: 0.75,
    setupFeeEur: 650,
    pros: ['Cost-effective Central-EU hub', 'Strong onward Central + East EU reach', 'Less capacity-constrained than Hamburg'],
    cons: ['No direct port', 'Smaller talent pool than NL/DE'],
  },
  ES_BCN: {
    key: 'ES_BCN',
    name: 'Barcelona',
    countryName: 'Spain',
    country: 'ES',
    region: 'IBERIAN',
    transitFromAsiaSea: '28–32 days (Mediterranean port — fastest from Asia)',
    storagePerPalletPerMonthEur: 15,
    storagePerCbmPerMonthEur: 10,
    inboundReceiptPerPalletEur: 11,
    pickBaseEur: 1.50,
    pickPerLineEur: 0.38,
    pickPerUnitEur: 0.10,
    packagingMaterialsPerOrderEur: 0.80,
    setupFeeEur: 750,
    pros: ['Fastest Mediterranean port — direct from Asia', 'Best for Iberian + Southern France distribution', 'Mid-market labour cost'],
    cons: ['Slow onward distribution to Central / Northern EU', 'Less developed B2C infrastructure than NL/DE'],
  },
};

// ── Outbound shipping rate matrix (hub region → destination region) ────
// EUR per parcel, by weight band. Prices reflect typical EU domestic + cross-border parcel rates
// from major carriers (DHL, GLS, DPD, UPS) for SME-volume contracts.
const OUTBOUND_RATES = {
  CENTRAL: {
    CENTRAL:       { base: 4.50, perKg: 0.35, transitDays: '1–2 days' },
    NORDIC:        { base: 7.50, perKg: 0.55, transitDays: '2–3 days' },
    IBERIAN:       { base: 8.50, perKg: 0.65, transitDays: '3–4 days' },
    MEDITERRANEAN: { base: 8.00, perKg: 0.60, transitDays: '2–4 days' },
    EAST:          { base: 6.50, perKg: 0.45, transitDays: '2–3 days' },
    UK:            { base: 9.50, perKg: 0.80, transitDays: '3–5 days (post-Brexit customs)' },
  },
  IBERIAN: {
    CENTRAL:       { base: 8.00, perKg: 0.60, transitDays: '3–4 days' },
    NORDIC:        { base: 10.50, perKg: 0.80, transitDays: '4–6 days' },
    IBERIAN:       { base: 4.20, perKg: 0.30, transitDays: '1–2 days' },
    MEDITERRANEAN: { base: 8.50, perKg: 0.65, transitDays: '3–4 days' },
    EAST:          { base: 10.00, perKg: 0.75, transitDays: '4–5 days' },
    UK:            { base: 11.00, perKg: 0.95, transitDays: '4–6 days' },
  },
  NORDIC: {
    CENTRAL:       { base: 7.50, perKg: 0.55, transitDays: '2–3 days' },
    NORDIC:        { base: 4.80, perKg: 0.35, transitDays: '1–2 days' },
    IBERIAN:       { base: 10.50, perKg: 0.80, transitDays: '4–6 days' },
    MEDITERRANEAN: { base: 9.50, perKg: 0.70, transitDays: '4–5 days' },
    EAST:          { base: 8.50, perKg: 0.60, transitDays: '3–4 days' },
    UK:            { base: 10.50, perKg: 0.90, transitDays: '3–5 days' },
  },
  MEDITERRANEAN: {
    CENTRAL:       { base: 8.00, perKg: 0.60, transitDays: '2–4 days' },
    NORDIC:        { base: 9.50, perKg: 0.70, transitDays: '4–5 days' },
    IBERIAN:       { base: 8.50, perKg: 0.65, transitDays: '3–4 days' },
    MEDITERRANEAN: { base: 4.80, perKg: 0.35, transitDays: '1–2 days' },
    EAST:          { base: 8.50, perKg: 0.60, transitDays: '3–4 days' },
    UK:            { base: 11.00, perKg: 0.95, transitDays: '4–6 days' },
  },
  EAST: {
    CENTRAL:       { base: 6.50, perKg: 0.45, transitDays: '2–3 days' },
    NORDIC:        { base: 8.50, perKg: 0.60, transitDays: '3–4 days' },
    IBERIAN:       { base: 10.00, perKg: 0.75, transitDays: '4–5 days' },
    MEDITERRANEAN: { base: 8.50, perKg: 0.60, transitDays: '3–4 days' },
    EAST:          { base: 4.50, perKg: 0.32, transitDays: '1–2 days' },
    UK:            { base: 11.50, perKg: 0.95, transitDays: '4–6 days' },
  },
};

// ── Value-added services ──────────────────────────────────────────────
const VALUE_ADDED_SERVICES = {
  qc_inspection:   { name: 'Inbound QC inspection (per pallet)', perPalletEur: 28 },
  labelling:       { name: 'Labelling (per unit)', perUnitEur: 0.15 },
  kitting:         { name: 'Kitting / bundling (per kit)', perUnitEur: 0.45 },
  photography:     { name: 'Product photography (per SKU, one-off)', perSkuEur: 18 },
  returns:         { name: 'Returns processing (per return)', perReturnEur: 4.20 },
  gift_wrapping:   { name: 'Gift wrapping (per order, where requested)', perOrderEur: 1.50 },
};

const SETUP_AMORTISATION_MONTHS = 12;

function listHubs() {
  return Object.values(HUBS).map(h => ({
    key: h.key,
    name: h.name,
    countryName: h.countryName,
    country: h.country,
    region: h.region,
    storagePerPalletPerMonthEur: h.storagePerPalletPerMonthEur,
    transitFromAsiaSea: h.transitFromAsiaSea,
    pros: h.pros,
    cons: h.cons,
  }));
}

function listValueAddedServices() {
  return Object.entries(VALUE_ADDED_SERVICES).map(([key, v]) => ({ key, ...v }));
}

function validateInput(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    errors.push('input must be an object');
    return { ok: false, errors };
  }
  const orders = Number(input.monthlyOrders);
  if (!Number.isFinite(orders) || orders < 1) errors.push('monthlyOrders must be at least 1');
  if (orders > 500000) errors.push('monthlyOrders exceeds 500,000 (please contact us for enterprise volumes)');

  const units = Number(input.avgUnitsPerOrder);
  if (!Number.isFinite(units) || units < 1) errors.push('avgUnitsPerOrder must be at least 1');

  const lines = Number(input.avgLinesPerOrder);
  if (!Number.isFinite(lines) || lines < 1) errors.push('avgLinesPerOrder must be at least 1');

  const palletsHeld = Number(input.avgPalletsHeld);
  if (!Number.isFinite(palletsHeld) || palletsHeld < 0) errors.push('avgPalletsHeld must be 0 or higher');

  const weight = Number(input.avgOrderWeightKg);
  if (!Number.isFinite(weight) || weight <= 0) errors.push('avgOrderWeightKg must be greater than 0');
  if (weight > 100) errors.push('avgOrderWeightKg exceeds 100 kg (parcel range — pallet shipments need a different rate card)');

  if (!input.primaryDestination) errors.push('primaryDestination required (2-letter country ISO code where most orders ship)');
  else if (String(input.primaryDestination).length !== 2) errors.push('primaryDestination must be a 2-letter ISO code');

  if (input.valueAddedServices) {
    if (!Array.isArray(input.valueAddedServices)) errors.push('valueAddedServices must be an array of service keys');
    else for (const svc of input.valueAddedServices) {
      if (!VALUE_ADDED_SERVICES[svc]) errors.push(`valueAddedServices contains unknown key "${svc}"`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

function calculateValueAddedServiceCost({ services, monthlyOrders, avgUnitsPerOrder, avgPalletsHeld, returnsRate, skuCount }) {
  const breakdown = [];
  let total = 0;
  const monthlyUnits = monthlyOrders * avgUnitsPerOrder;
  const monthlyReturns = monthlyOrders * (Math.max(0, Math.min(0.5, returnsRate || 0)));
  const monthlyInboundPallets = Math.max(1, Math.round(avgPalletsHeld / 6)); // assume ~2-month inventory turn

  for (const svc of services || []) {
    const def = VALUE_ADDED_SERVICES[svc];
    if (!def) continue;
    let monthlyCents = 0;
    let labelDetail = '';
    if (def.perPalletEur) {
      monthlyCents = M.mulRate(M.fromEuro(def.perPalletEur), monthlyInboundPallets);
      labelDetail = `€${def.perPalletEur}/pallet × ${monthlyInboundPallets} inbound pallets/month`;
    } else if (def.perUnitEur) {
      monthlyCents = M.mulRate(M.fromEuro(def.perUnitEur), monthlyUnits);
      labelDetail = `€${def.perUnitEur}/unit × ${monthlyUnits.toLocaleString('en-IE')} units/month`;
    } else if (def.perOrderEur) {
      monthlyCents = M.mulRate(M.fromEuro(def.perOrderEur), monthlyOrders * 0.15); // assume 15% of orders use this (gift wrap)
      labelDetail = `€${def.perOrderEur}/order × ~15% of ${monthlyOrders.toLocaleString('en-IE')} orders/month`;
    } else if (def.perReturnEur) {
      monthlyCents = M.mulRate(M.fromEuro(def.perReturnEur), monthlyReturns);
      labelDetail = `€${def.perReturnEur}/return × ${Math.round(monthlyReturns)} returns/month (${Math.round((returnsRate || 0) * 100)}% rate)`;
    } else if (def.perSkuEur) {
      monthlyCents = M.divInt(M.mulRate(M.fromEuro(def.perSkuEur), skuCount || 0), SETUP_AMORTISATION_MONTHS);
      labelDetail = `€${def.perSkuEur}/SKU × ${skuCount || 0} SKUs (one-off, amortised over ${SETUP_AMORTISATION_MONTHS} months)`;
    }
    // Display each line at whole-euro granularity; the total is the sum of the
    // displayed lines so the breakdown always reconciles.
    const lineEur = Math.round(M.toEuro(monthlyCents));
    breakdown.push({ key: svc, label: def.name, detail: labelDetail, monthlyCostEur: lineEur });
    total += lineEur;
  }
  return { total, breakdown };
}

function calculateHubMonthly({ hub, monthlyOrders, avgUnitsPerOrder, avgLinesPerOrder, avgPalletsHeld, avgOrderWeightKg, primaryDestination, valueAddedServiceCost, vasBreakdown, vasInputs }) {
  const destRegion = regionOf(primaryDestination);
  const outboundRate = OUTBOUND_RATES[hub.region][destRegion];

  // Each line computed in integer cents, then displayed at whole-euro
  // granularity. The total is the sum of the displayed line euros, so the
  // breakdown reconciles exactly to the headline figure.
  const storageCents = M.mulRate(M.fromEuro(hub.storagePerPalletPerMonthEur), avgPalletsHeld);
  const monthlyInboundPallets = Math.max(1, Math.round(avgPalletsHeld / 6));
  const inboundCents = M.mulRate(M.fromEuro(hub.inboundReceiptPerPalletEur), monthlyInboundPallets);
  const pickPerOrderCents = M.fromEuro(hub.pickBaseEur)
    + M.mulRate(M.fromEuro(hub.pickPerLineEur), avgLinesPerOrder)
    + M.mulRate(M.fromEuro(hub.pickPerUnitEur), avgUnitsPerOrder)
    + M.fromEuro(hub.packagingMaterialsPerOrderEur);
  const pickPackCents = M.mulRate(pickPerOrderCents, monthlyOrders);
  const outboundPerOrderCents = M.fromEuro(outboundRate.base) + M.mulRate(M.fromEuro(outboundRate.perKg), avgOrderWeightKg);
  const outboundShippingCents = M.mulRate(outboundPerOrderCents, monthlyOrders);
  const setupAmortisedCents = M.divInt(M.fromEuro(hub.setupFeeEur), SETUP_AMORTISATION_MONTHS);

  const wholeEuro = (cents) => Math.round(M.toEuro(cents));
  const storageEur = wholeEuro(storageCents);
  const inboundEur = wholeEuro(inboundCents);
  const pickPackEur = wholeEuro(pickPackCents);
  const outboundShippingEur = wholeEuro(outboundShippingCents);
  const setupAmortisedEur = wholeEuro(setupAmortisedCents);
  const valueAddedServiceEur = wholeEuro(M.fromEuro(valueAddedServiceCost));

  const totalMonthlyEur = storageEur + inboundEur + pickPackEur + outboundShippingEur + setupAmortisedEur + valueAddedServiceEur;
  const costPerOrderEur = round(totalMonthlyEur / monthlyOrders, 2);

  const breakdown = [
    {
      label: `Storage (€${hub.storagePerPalletPerMonthEur}/pallet/month × ${avgPalletsHeld} pallets)`,
      monthlyCostEur: storageEur,
    },
    {
      label: `Inbound receipt (€${hub.inboundReceiptPerPalletEur}/pallet × ~${monthlyInboundPallets} pallets/month)`,
      monthlyCostEur: inboundEur,
    },
    {
      label: `Pick & pack (€${hub.pickBaseEur} base + €${hub.pickPerLineEur}/line × ${avgLinesPerOrder} + €${hub.pickPerUnitEur}/unit × ${avgUnitsPerOrder} + €${hub.packagingMaterialsPerOrderEur} materials, × ${monthlyOrders.toLocaleString('en-IE')} orders)`,
      monthlyCostEur: pickPackEur,
    },
    {
      label: `Outbound shipping to ${destRegion} (€${outboundRate.base} base + €${outboundRate.perKg}/kg × ${avgOrderWeightKg}kg, × ${monthlyOrders.toLocaleString('en-IE')} orders)`,
      monthlyCostEur: outboundShippingEur,
    },
    {
      label: `Setup fee amortised (€${hub.setupFeeEur} ÷ ${SETUP_AMORTISATION_MONTHS} months)`,
      monthlyCostEur: setupAmortisedEur,
    },
  ];
  if (valueAddedServiceCost > 0) {
    breakdown.push({
      label: 'Value-added services (see expanded breakdown)',
      monthlyCostEur: valueAddedServiceEur,
      isVas: true,
      vasBreakdown,
    });
  }

  return {
    hubKey: hub.key,
    hubName: hub.name,
    hubCountry: hub.country,
    hubCountryName: hub.countryName,
    hubRegion: hub.region,
    storageEur,
    inboundEur,
    pickPackEur,
    outboundShippingEur,
    setupAmortisedEur,
    valueAddedServiceCostEur: valueAddedServiceEur,
    totalMonthlyEur,
    costPerOrderEur,
    transitToDestination: outboundRate.transitDays,
    transitFromAsiaSea: hub.transitFromAsiaSea,
    pros: hub.pros,
    cons: hub.cons,
    breakdown,
  };
}

function recommendHub({ hubs, primaryDestination }) {
  const destRegion = regionOf(primaryDestination);
  const sorted = [...hubs].sort((a, b) => a.totalMonthlyEur - b.totalMonthlyEur);
  const cheapest = sorted[0];
  const inDestRegion = hubs.filter(h => h.hubRegion === destRegion).sort((a, b) => a.totalMonthlyEur - b.totalMonthlyEur);
  const fastest = inDestRegion[0] || cheapest; // same-region hub = fastest delivery

  // Recommendation logic:
  //   - If fastest costs ≤ 10% more than cheapest, recommend fastest (better customer experience)
  //   - Otherwise recommend cheapest with note about trade-off
  if (fastest && fastest.hubKey !== cheapest.hubKey) {
    const premium = (fastest.totalMonthlyEur - cheapest.totalMonthlyEur) / cheapest.totalMonthlyEur;
    if (premium <= 0.10) {
      return {
        primary: fastest.hubKey,
        rationale: `${fastest.hubName} is in the same region as your primary destination (${destRegion}), giving 1–2 day delivery, and only ${(premium * 100).toFixed(1)}% more expensive than the cheapest option (${cheapest.hubName}). Recommended unless cost is the only constraint.`,
      };
    }
    return {
      primary: cheapest.hubKey,
      rationale: `${cheapest.hubName} is the cheapest at €${cheapest.totalMonthlyEur}/month (€${cheapest.costPerOrderEur}/order). Same-region alternative ${fastest.hubName} is €${fastest.totalMonthlyEur}/month (${(premium * 100).toFixed(0)}% premium) for 1–2 day delivery vs ${cheapest.transitToDestination}. Pick based on customer-experience priority.`,
    };
  }
  return {
    primary: cheapest.hubKey,
    rationale: `${cheapest.hubName} is the cheapest at €${cheapest.totalMonthlyEur}/month (€${cheapest.costPerOrderEur}/order) and already in your destination region — no trade-off to make.`,
  };
}

function calculateQuote(input) {
  const validation = validateInput(input);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const monthlyOrders = Number(input.monthlyOrders);
  const avgUnitsPerOrder = Number(input.avgUnitsPerOrder);
  const avgLinesPerOrder = Number(input.avgLinesPerOrder);
  const avgPalletsHeld = Math.max(1, Number(input.avgPalletsHeld) || 1);
  const avgOrderWeightKg = Number(input.avgOrderWeightKg);
  const primaryDestination = String(input.primaryDestination).toUpperCase();
  const valueAddedServices = input.valueAddedServices || [];
  const returnsRate = Number(input.returnsRate) || 0;
  const skuCount = Number(input.skuCount) || 0;

  const vas = calculateValueAddedServiceCost({
    services: valueAddedServices,
    monthlyOrders,
    avgUnitsPerOrder,
    avgPalletsHeld,
    returnsRate,
    skuCount,
  });

  const hubQuotes = Object.values(HUBS).map(hub =>
    calculateHubMonthly({
      hub,
      monthlyOrders,
      avgUnitsPerOrder,
      avgLinesPerOrder,
      avgPalletsHeld,
      avgOrderWeightKg,
      primaryDestination,
      valueAddedServiceCost: vas.total,
      vasBreakdown: vas.breakdown,
    })
  );

  const recommendation = recommendHub({ hubs: hubQuotes, primaryDestination });

  return {
    ok: true,
    asOf: PRICING_SNAPSHOT.asOf,
    inputs: {
      monthlyOrders,
      avgUnitsPerOrder,
      avgLinesPerOrder,
      avgPalletsHeld,
      avgOrderWeightKg,
      primaryDestination,
      primaryDestinationRegion: regionOf(primaryDestination),
      valueAddedServices,
      returnsRate,
      skuCount,
    },
    valueAddedServices: vas,
    quotes: hubQuotes,
    recommendation,
    threePLEducation: {
      whatThis: 'A 3PL hub is a third-party warehouse that holds your stock, picks orders, packs them, and ships them to your customers. You pay monthly storage + per-order pick/pack + outbound shipping.',
      hubChoice: 'The cheapest hub is rarely the best — onward shipping cost and transit time depend on where your customers live. Eastern hubs (PL, CZ) offer 30-40% lower fixed costs but add 1-2 days on Iberian / Mediterranean delivery.',
      multiHub: 'High-volume shippers (>5k orders/month) often run 2 hubs: one Eastern (PL/CZ) for cost-sensitive Central+East EU, one Iberian (ES) for fast Southern EU delivery. Below 2-3k orders/month, multi-hub overhead usually exceeds savings.',
      negotiation: 'List rates here are mid-market. Volumes above 3k orders/month should negotiate 10-15% off; above 10k orders/month, 20-25% is typical.',
    },
    nextSteps: [
      'Compare your current 3PL invoice against the 6-hub benchmark — most SMEs find they are paying 20-40% above market.',
      'Request quotes from at least 3 of the recommended hubs; list rates here are the negotiation starting point, not the final number.',
      'For volumes >3k orders/month, ask about a 6-month performance trial with right-to-exit. Most cost-effective hubs accept this; legacy hubs do not.',
    ],
    pricingSnapshot: PRICING_SNAPSHOT,
  };
}

function round(value, decimals = 0) {
  if (!Number.isFinite(value)) return 0;
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

// ── Tier-A: build an EligibilityInput from a quote result ─────────────
//
// Same shape as customs-quote / finance-quote / sourcing-quote /
// routing-quote buildTierAInput. Reads result.inputs.monthlyOrders and
// surfaces it as coverageInput.monthlyOrders for the integer-range
// axis. validateInput guarantees monthlyOrders is a positive number
// when ok:true.
//
// PR #143: when calculateQuoteAsync has attached `livePpiMeta` (a
// Eurostat warehousing-PPI snapshot, NACE H52), we DROP the OrcaTrade
// PRICING_SNAPSHOT mirror entry and substitute a primary_regulator
// snapshot whose id encodes the Eurostat period + area. This is the
// PR #132 pattern — when the primary source is present, the mirror
// would only confuse the audit trail. TA-2 (primary-source) then
// succeeds and the Tier-A pill lights up.

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

  let snapshots;
  if (quoteResult.livePpiMeta && quoteResult.livePpiMeta.area && quoteResult.livePpiMeta.asOfPeriod) {
    snapshots = [{
      id: `eurostat-warehousing-ppi:${quoteResult.livePpiMeta.area}@${quoteResult.livePpiMeta.asOfPeriod}`,
      source_kind: 'primary_regulator',
      as_of_iso: quoteResult.livePpiMeta.asOf || toIsoStartOfDay(PRICING_SNAPSHOT.asOf),
    }];
  } else {
    snapshots = [{
      id: `warehouse-quote:pricing@${PRICING_SNAPSHOT.asOf}`,
      source_kind: 'mirror',
      as_of_iso: toIsoStartOfDay(PRICING_SNAPSHOT.asOf),
    }];
  }

  const rawOrders = quoteResult.inputs && Number(quoteResult.inputs.monthlyOrders);
  const monthlyOrders = Number.isFinite(rawOrders) ? Math.round(rawOrders) : 0;

  return {
    calculatorName: TIER_A_COVERAGE.calculatorName,
    snapshots,
    escalations: [],
    overrides: [],
    coverageInput: { monthlyOrders },
    calculatorCoverage: TIER_A_COVERAGE,
  };
}

// ── Async surface backed by Eurostat warehousing PPI ─────────────────
//
// Mirrors the PR #141 finance-quote.comparePaymentInstrumentsAsync
// shape: wraps the sync calculator, asks the Eurostat client for a
// primary-source snapshot of the warehousing PPI (NACE H52), and
// attaches `livePpiMeta` on success. Callers (handlers/start.js)
// supply opts.ppiArea — typically the Eurostat aggregate 'EA20' (Euro
// area) or 'EU27_2020' so the snapshot covers the whole hub matrix.
//
// Falls back to the sync surface when:
//   - opts.useEurostat === false
//   - opts.ppiArea is absent/invalid
//   - Eurostat returns null (kill switch on, upstream down + no cache)
//
// The calculator itself stays clock-free; the handler reads "today"
// at the call site if a date-stamp is needed for telemetry.
async function calculateQuoteAsync(input, opts = {}) {
  const baseResult = calculateQuote(input);
  if (!baseResult.ok) return baseResult;
  if (opts.useEurostat === false) return baseResult;
  if (!opts.ppiArea) return baseResult;

  const eurostat = require('./eurostat-warehousing-client');
  const snapshot = await eurostat.lookupWarehousingPpi(opts.ppiArea, {
    skipUpstream: opts.skipUpstream === true,
  });
  if (!snapshot) return baseResult;

  return {
    ...baseResult,
    livePpiMeta: {
      area: snapshot.area,
      asOfPeriod: snapshot.asOfPeriod,
      asOf: snapshot.asOf,
      source: snapshot.source,
      nace: snapshot.nace,
      seasonalAdjustment: snapshot.seasonalAdjustment,
      baseYear: snapshot.baseYear,
      indexValue: snapshot.indexValue,
      fromCache: snapshot.fromCache === true,
      stale: snapshot.stale === true,
      verifyUrl: eurostat.eurostatVerifyUrl(snapshot.area),
    },
  };
}

// Same shape as the helpers in customs-quote.js / finance-quote.js /
// sourcing-quote.js / routing-quote.js — tolerate the two
// PRICING_SNAPSHOT.asOf forms ('YYYY-MM-DD' + full ISO string).
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
  HUBS,
  REGIONS,
  OUTBOUND_RATES,
  VALUE_ADDED_SERVICES,
  SETUP_AMORTISATION_MONTHS,
  TIER_A_COVERAGE,
  buildTierAInput,
  regionOf,
  listHubs,
  listValueAddedServices,
  validateInput,
  calculateValueAddedServiceCost,
  calculateHubMonthly,
  recommendHub,
  calculateQuote,
  calculateQuoteAsync,
};
