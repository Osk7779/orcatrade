const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PRICING_SNAPSHOT,
  HUBS,
  REGIONS,
  OUTBOUND_RATES,
  VALUE_ADDED_SERVICES,
  SETUP_AMORTISATION_MONTHS,
  regionOf,
  listHubs,
  listValueAddedServices,
  validateInput,
  calculateValueAddedServiceCost,
  calculateHubMonthly,
  recommendHub,
  calculateQuote,
} = require('../lib/intelligence/warehouse-quote');

// ── Snapshot & catalogue ─────────────────────────────────

test('PRICING_SNAPSHOT exposes asOf, source, notes', () => {
  assert.match(PRICING_SNAPSHOT.asOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(PRICING_SNAPSHOT.source);
  assert.ok(PRICING_SNAPSHOT.notes);
});

test('HUBS catalogue covers 6 hubs across 4 countries', () => {
  assert.equal(Object.keys(HUBS).length, 6);
  const countries = new Set(Object.values(HUBS).map(h => h.country));
  for (const c of ['NL', 'DE', 'PL', 'CZ', 'ES']) {
    assert.ok(countries.has(c), `${c} hub present`);
  }
});

test('Each hub has the required pricing fields', () => {
  for (const [key, hub] of Object.entries(HUBS)) {
    assert.ok(Number.isFinite(hub.storagePerPalletPerMonthEur), `${key} storagePerPalletPerMonthEur`);
    assert.ok(Number.isFinite(hub.inboundReceiptPerPalletEur), `${key} inboundReceiptPerPalletEur`);
    assert.ok(Number.isFinite(hub.pickBaseEur), `${key} pickBaseEur`);
    assert.ok(Number.isFinite(hub.pickPerLineEur), `${key} pickPerLineEur`);
    assert.ok(Number.isFinite(hub.pickPerUnitEur), `${key} pickPerUnitEur`);
    assert.ok(Number.isFinite(hub.setupFeeEur), `${key} setupFeeEur`);
    assert.ok(Array.isArray(hub.pros) && hub.pros.length > 0);
    assert.ok(Array.isArray(hub.cons) && hub.cons.length > 0);
  }
});

test('Eastern hubs are cheaper than Western hubs on storage', () => {
  assert.ok(HUBS.PL_POZ.storagePerPalletPerMonthEur < HUBS.NL_ROT.storagePerPalletPerMonthEur);
  assert.ok(HUBS.CZ_PRG.storagePerPalletPerMonthEur < HUBS.DE_HAM.storagePerPalletPerMonthEur);
});

test('Setup amortisation is 12 months', () => {
  assert.equal(SETUP_AMORTISATION_MONTHS, 12);
});

// ── Regions ───────────────────────────────────────────────

test('regionOf classifies major countries correctly', () => {
  assert.equal(regionOf('DE'), 'CENTRAL');
  assert.equal(regionOf('FR'), 'CENTRAL');
  assert.equal(regionOf('ES'), 'IBERIAN');
  assert.equal(regionOf('IT'), 'MEDITERRANEAN');
  assert.equal(regionOf('SE'), 'NORDIC');
  assert.equal(regionOf('PL'), 'CENTRAL');
  assert.equal(regionOf('RO'), 'EAST');
});

test('regionOf falls back to CENTRAL for unknown', () => {
  assert.equal(regionOf('ZZ'), 'CENTRAL');
  assert.equal(regionOf(''), 'CENTRAL');
});

test('OUTBOUND_RATES covers every (region, region) pair', () => {
  const allRegions = ['CENTRAL', 'NORDIC', 'IBERIAN', 'MEDITERRANEAN', 'EAST'];
  for (const from of allRegions) {
    assert.ok(OUTBOUND_RATES[from], `${from} hub-region present`);
    for (const to of allRegions) {
      const rate = OUTBOUND_RATES[from][to];
      assert.ok(rate, `${from} → ${to} rate present`);
      assert.ok(rate.base > 0);
      assert.ok(rate.perKg > 0);
      assert.ok(rate.transitDays);
    }
  }
});

test('Within-region outbound is cheaper than cross-region', () => {
  // CENTRAL → CENTRAL should be cheaper than CENTRAL → IBERIAN
  assert.ok(OUTBOUND_RATES.CENTRAL.CENTRAL.base < OUTBOUND_RATES.CENTRAL.IBERIAN.base);
});

// ── Value-added services ─────────────────────────────────

test('VALUE_ADDED_SERVICES includes the core 6 services', () => {
  for (const k of ['qc_inspection', 'labelling', 'kitting', 'photography', 'returns', 'gift_wrapping']) {
    assert.ok(VALUE_ADDED_SERVICES[k], `${k} VAS present`);
    assert.ok(VALUE_ADDED_SERVICES[k].name);
  }
});

test('calculateValueAddedServiceCost: empty list returns 0', () => {
  const r = calculateValueAddedServiceCost({ services: [], monthlyOrders: 1500, avgUnitsPerOrder: 1.5, avgPalletsHeld: 50, returnsRate: 0, skuCount: 0 });
  assert.equal(r.total, 0);
  assert.equal(r.breakdown.length, 0);
});

test('calculateValueAddedServiceCost: per-unit labelling scales with units', () => {
  const r = calculateValueAddedServiceCost({ services: ['labelling'], monthlyOrders: 1000, avgUnitsPerOrder: 2, avgPalletsHeld: 30, returnsRate: 0, skuCount: 0 });
  // 1000 orders × 2 units × €0.15/unit = €300
  assert.equal(r.total, 300);
});

test('calculateValueAddedServiceCost: returns processing scales with returns rate', () => {
  const r = calculateValueAddedServiceCost({ services: ['returns'], monthlyOrders: 1000, avgUnitsPerOrder: 1, avgPalletsHeld: 30, returnsRate: 0.10, skuCount: 0 });
  // 1000 orders × 10% = 100 returns × €4.20 = €420
  assert.equal(r.total, 420);
});

test('calculateValueAddedServiceCost: photography amortises one-off SKU cost over 12 months', () => {
  const r = calculateValueAddedServiceCost({ services: ['photography'], monthlyOrders: 1000, avgUnitsPerOrder: 1, avgPalletsHeld: 30, returnsRate: 0, skuCount: 240 });
  // 240 SKUs × €18 / 12 = €360/month
  assert.equal(r.total, 360);
});

// ── validateInput ────────────────────────────────────────

test('validateInput rejects missing monthlyOrders', () => {
  const r = validateInput({ avgUnitsPerOrder: 1, avgLinesPerOrder: 1, avgPalletsHeld: 10, avgOrderWeightKg: 1, primaryDestination: 'DE' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('monthlyOrders')));
});

test('validateInput rejects missing primaryDestination', () => {
  const r = validateInput({ monthlyOrders: 1000, avgUnitsPerOrder: 1, avgLinesPerOrder: 1, avgPalletsHeld: 10, avgOrderWeightKg: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('primaryDestination')));
});

test('validateInput rejects unknown valueAddedServices key', () => {
  const r = validateInput({ monthlyOrders: 1000, avgUnitsPerOrder: 1, avgLinesPerOrder: 1, avgPalletsHeld: 10, avgOrderWeightKg: 1, primaryDestination: 'DE', valueAddedServices: ['flying_unicorns'] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /unknown key/.test(e)));
});

test('validateInput rejects extreme order weight', () => {
  const r = validateInput({ monthlyOrders: 1000, avgUnitsPerOrder: 1, avgLinesPerOrder: 1, avgPalletsHeld: 10, avgOrderWeightKg: 500, primaryDestination: 'DE' });
  assert.equal(r.ok, false);
});

test('validateInput accepts complete valid input', () => {
  const r = validateInput({ monthlyOrders: 1500, avgUnitsPerOrder: 1.5, avgLinesPerOrder: 1.2, avgPalletsHeld: 50, avgOrderWeightKg: 2, primaryDestination: 'DE' });
  assert.equal(r.ok, true);
});

// ── calculateHubMonthly ──────────────────────────────────

test('calculateHubMonthly returns expected fields', () => {
  const r = calculateHubMonthly({
    hub: HUBS.NL_ROT,
    monthlyOrders: 1000, avgUnitsPerOrder: 1.5, avgLinesPerOrder: 1.2,
    avgPalletsHeld: 30, avgOrderWeightKg: 2, primaryDestination: 'DE',
    valueAddedServiceCost: 0, vasBreakdown: [],
  });
  assert.equal(r.hubKey, 'NL_ROT');
  assert.ok(r.totalMonthlyEur > 0);
  assert.ok(r.costPerOrderEur > 0);
  assert.ok(r.transitToDestination);
  assert.ok(r.breakdown.length >= 5);
});

test('calculateHubMonthly: PL hub is cheaper than NL hub for the same profile', () => {
  const profile = {
    monthlyOrders: 1500, avgUnitsPerOrder: 1.5, avgLinesPerOrder: 1.2,
    avgPalletsHeld: 50, avgOrderWeightKg: 2, primaryDestination: 'DE',
    valueAddedServiceCost: 0, vasBreakdown: [],
  };
  const nl = calculateHubMonthly({ hub: HUBS.NL_ROT, ...profile });
  const pl = calculateHubMonthly({ hub: HUBS.PL_POZ, ...profile });
  assert.ok(pl.totalMonthlyEur < nl.totalMonthlyEur);
});

test('calculateHubMonthly: storage line scales with pallets held', () => {
  const profile = {
    monthlyOrders: 1000, avgUnitsPerOrder: 1, avgLinesPerOrder: 1,
    avgOrderWeightKg: 1, primaryDestination: 'DE',
    valueAddedServiceCost: 0, vasBreakdown: [],
  };
  const small = calculateHubMonthly({ hub: HUBS.DE_HAM, avgPalletsHeld: 10, ...profile });
  const large = calculateHubMonthly({ hub: HUBS.DE_HAM, avgPalletsHeld: 100, ...profile });
  // Storage on 100 pallets = 10× storage on 10 pallets
  assert.equal(large.storageEur, 10 * small.storageEur);
});

// ── recommendHub ─────────────────────────────────────────

test('recommendHub: picks cheapest in destination region when in same region', () => {
  const profile = {
    monthlyOrders: 1500, avgUnitsPerOrder: 1.5, avgLinesPerOrder: 1.2,
    avgPalletsHeld: 50, avgOrderWeightKg: 2, primaryDestination: 'DE',
    valueAddedServiceCost: 0, vasBreakdown: [],
  };
  const hubs = Object.values(HUBS).map(hub => calculateHubMonthly({ hub, ...profile }));
  const r = recommendHub({ hubs, primaryDestination: 'DE' });
  // PL_POZ is in CENTRAL (same as DE) and is cheapest
  assert.equal(r.primary, 'PL_POZ');
});

test('recommendHub: picks Iberian hub for ES customers', () => {
  const profile = {
    monthlyOrders: 1500, avgUnitsPerOrder: 1.5, avgLinesPerOrder: 1.2,
    avgPalletsHeld: 50, avgOrderWeightKg: 2, primaryDestination: 'ES',
    valueAddedServiceCost: 0, vasBreakdown: [],
  };
  const hubs = Object.values(HUBS).map(hub => calculateHubMonthly({ hub, ...profile }));
  const r = recommendHub({ hubs, primaryDestination: 'ES' });
  assert.equal(r.primary, 'ES_BCN');
});

// ── calculateQuote integration ───────────────────────────

test('calculateQuote returns 6 hubs and a recommendation', () => {
  const r = calculateQuote({ monthlyOrders: 1500, avgUnitsPerOrder: 1.5, avgLinesPerOrder: 1.2, avgPalletsHeld: 50, avgOrderWeightKg: 2, primaryDestination: 'DE' });
  assert.equal(r.ok, true);
  assert.equal(r.quotes.length, 6);
  assert.ok(r.recommendation.primary);
  assert.ok(r.recommendation.rationale);
});

test('calculateQuote: includes threePLEducation block', () => {
  const r = calculateQuote({ monthlyOrders: 1000, avgUnitsPerOrder: 1, avgLinesPerOrder: 1, avgPalletsHeld: 30, avgOrderWeightKg: 1, primaryDestination: 'FR' });
  assert.ok(r.threePLEducation);
  assert.ok(r.threePLEducation.whatThis);
  assert.ok(r.threePLEducation.hubChoice);
  assert.ok(r.threePLEducation.multiHub);
  assert.ok(r.threePLEducation.negotiation);
});

test('calculateQuote: returns nextSteps array of >=3', () => {
  const r = calculateQuote({ monthlyOrders: 1000, avgUnitsPerOrder: 1, avgLinesPerOrder: 1, avgPalletsHeld: 30, avgOrderWeightKg: 1, primaryDestination: 'FR' });
  assert.ok(Array.isArray(r.nextSteps));
  assert.ok(r.nextSteps.length >= 3);
});

test('calculateQuote: rejects malformed input with errors array', () => {
  const r = calculateQuote({});
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.errors));
});

test('calculateQuote: VAS additions raise total cost across all hubs', () => {
  const without = calculateQuote({ monthlyOrders: 2000, avgUnitsPerOrder: 1.5, avgLinesPerOrder: 1.2, avgPalletsHeld: 60, avgOrderWeightKg: 2, primaryDestination: 'DE' });
  const withVas = calculateQuote({ monthlyOrders: 2000, avgUnitsPerOrder: 1.5, avgLinesPerOrder: 1.2, avgPalletsHeld: 60, avgOrderWeightKg: 2, primaryDestination: 'DE', valueAddedServices: ['labelling', 'returns'], returnsRate: 0.05 });
  for (let i = 0; i < without.quotes.length; i++) {
    assert.ok(withVas.quotes[i].totalMonthlyEur > without.quotes[i].totalMonthlyEur, `${withVas.quotes[i].hubKey} VAS adds cost`);
  }
});

test('calculateQuote: enterprise volume scales linearly with orders for variable costs', () => {
  const small = calculateQuote({ monthlyOrders: 1000, avgUnitsPerOrder: 1, avgLinesPerOrder: 1, avgPalletsHeld: 10, avgOrderWeightKg: 1, primaryDestination: 'DE' });
  const big = calculateQuote({ monthlyOrders: 10000, avgUnitsPerOrder: 1, avgLinesPerOrder: 1, avgPalletsHeld: 10, avgOrderWeightKg: 1, primaryDestination: 'DE' });
  // pickPack scales with orders; 10× orders should give ~10× pickPack (storage and setup are flat)
  for (let i = 0; i < small.quotes.length; i++) {
    const ratio = big.quotes[i].pickPackEur / small.quotes[i].pickPackEur;
    assert.ok(Math.abs(ratio - 10) < 0.1, `${small.quotes[i].hubKey} pickPack scales 10×`);
  }
});

// ── Listing helpers ──────────────────────────────────────

test('listHubs returns 6 hubs with key/name/country/storage rate', () => {
  const list = listHubs();
  assert.equal(list.length, 6);
  for (const h of list) {
    assert.ok(h.key);
    assert.ok(h.name);
    assert.ok(h.country);
    assert.ok(Number.isFinite(h.storagePerPalletPerMonthEur));
    assert.ok(Array.isArray(h.pros));
  }
});

test('listValueAddedServices returns 6 services with names', () => {
  const list = listValueAddedServices();
  assert.equal(list.length, 6);
  for (const s of list) {
    assert.ok(s.key);
    assert.ok(s.name);
  }
});
