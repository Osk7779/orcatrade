// Subscription tiers — the canonical source of truth (Sprint 40).
//
// Five tiers, three concerns each: identity (id, name, who),
// commercial (priceMonthlyEur, priceAnnualEur), and entitlements
// (quotas + features). Sprint 41 (Stripe) consumes the commercial
// fields; Sprint 42 (tier gating) consumes the entitlement fields.
//
// IDs are stable strings — never rename without a migration. They appear in:
//   - KV: tier:<email> → '<id>'
//   - Stripe price metadata: tier_id=<id>
//   - data-tier="<id>" on pricing page CTAs
//   - feature-flag lookups across handlers
//
// The pricing page (/pricing/index.html) renders the marketing copy. This
// module owns the *machine-readable* contract.

'use strict';

const TIERS = Object.freeze([
  Object.freeze({
    id: 'free',
    name: 'Free',
    who: 'Lead-gen · evaluators',
    priceMonthlyEur: 0,
    priceAnnualEur: 0,
    isFree: true,
    requiresContact: false,
    quotas: Object.freeze({
      agentQueriesPerMonth: 20,
      supplierMonitors: 0,
      supplierViewsPerMonth: 10,
      documentsPerMonth: 5,
      hsLookupsPerMonth: 5,
      savedPlans: 5,
      seats: 1,
      apiCallsPerMonth: 0,
      // Per-month Anthropic-inference spend cap, in integer cents
      // (apex P1.7 bill-protection). Defensive floor that fires
      // alongside agentQueriesPerMonth — a pathological prompt
      // (very long context on Opus 4.7) can blow past the query
      // quota's implicit cost assumption. €1 = 100 cents.
      monthlyAnthropicSpendCapCents: 100,
    }),
    features: Object.freeze({
      // Agents
      sourcingAgent: false,
      complianceAgent: true,        // free EU compliance brief
      logisticsAgent: false,
      financeAgent: false,
      operationsAgent: false,
      orchestratorAgent: false,
      // Modules
      factorySearch: false,
      shipmentDashboard: false,
      exceptionQueue: false,
      apiAccess: false,
      customAgentTraining: false,
      whiteLabel: false,
      erpIntegration: false,
      // Discounts on transactional
      shipmentFeeDiscountPct: 0,
    }),
  }),

  Object.freeze({
    id: 'starter',
    name: 'Starter',
    who: 'Solo importers · FBA sellers',
    priceMonthlyEur: 99,
    priceAnnualEur: 990,
    isFree: false,
    requiresContact: false,
    quotas: Object.freeze({
      agentQueriesPerMonth: 200,
      supplierMonitors: 5,
      supplierViewsPerMonth: 100,
      documentsPerMonth: 50,
      hsLookupsPerMonth: 50,
      savedPlans: 50,
      seats: 1,
      apiCallsPerMonth: 0,
      monthlyAnthropicSpendCapCents: 1500, // €15
    }),
    features: Object.freeze({
      sourcingAgent: true,
      complianceAgent: true,
      logisticsAgent: false,
      financeAgent: false,
      operationsAgent: false,
      orchestratorAgent: false,
      factorySearch: true,
      shipmentDashboard: true,
      exceptionQueue: false,
      apiAccess: false,
      customAgentTraining: false,
      whiteLabel: false,
      erpIntegration: false,
      shipmentFeeDiscountPct: 5,
    }),
  }),

  Object.freeze({
    id: 'growth',
    name: 'Growth',
    who: 'Established SMEs · 5–50 shipments / yr',
    priceMonthlyEur: 399,
    priceAnnualEur: 3990,
    popular: true,
    isFree: false,
    requiresContact: false,
    quotas: Object.freeze({
      agentQueriesPerMonth: 1000,
      supplierMonitors: 20,
      supplierViewsPerMonth: 500,
      documentsPerMonth: 250,
      hsLookupsPerMonth: 500,
      savedPlans: 250,
      seats: 5,
      apiCallsPerMonth: 1000,
      monthlyAnthropicSpendCapCents: 10000, // €100
    }),
    features: Object.freeze({
      sourcingAgent: true,
      complianceAgent: true,
      logisticsAgent: true,
      financeAgent: true,
      operationsAgent: true,
      orchestratorAgent: true,
      factorySearch: true,
      shipmentDashboard: true,
      exceptionQueue: true,
      apiAccess: false,
      customAgentTraining: false,
      whiteLabel: false,
      erpIntegration: false,
      shipmentFeeDiscountPct: 10,
    }),
  }),

  Object.freeze({
    id: 'scale',
    name: 'Scale',
    who: 'Mid-market · 50+ shipments / yr',
    priceMonthlyEur: 999,
    priceAnnualEur: 9990,
    isFree: false,
    requiresContact: true, // sales-led close
    quotas: Object.freeze({
      agentQueriesPerMonth: Infinity,
      supplierMonitors: 100,
      supplierViewsPerMonth: 5000,
      documentsPerMonth: 2500,
      hsLookupsPerMonth: 5000,
      savedPlans: 1000,
      seats: 20,
      apiCallsPerMonth: 10000,
      monthlyAnthropicSpendCapCents: 50000, // €500 — sales-led tier; cap fires only on pathological runaway
    }),
    features: Object.freeze({
      sourcingAgent: true,
      complianceAgent: true,
      logisticsAgent: true,
      financeAgent: true,
      operationsAgent: true,
      orchestratorAgent: true,
      factorySearch: true,
      shipmentDashboard: true,
      exceptionQueue: true,
      apiAccess: true,
      customAgentTraining: true,
      whiteLabel: false,
      erpIntegration: false,
      shipmentFeeDiscountPct: 15,
    }),
  }),

  Object.freeze({
    id: 'enterprise',
    name: 'Enterprise',
    who: 'Manufacturers · distributors · retail chains',
    priceMonthlyEur: null, // custom
    priceAnnualEur: null,
    priceFromEur: 2500,
    isFree: false,
    requiresContact: true,
    quotas: Object.freeze({
      agentQueriesPerMonth: Infinity,
      supplierMonitors: Infinity,
      supplierViewsPerMonth: Infinity,
      documentsPerMonth: Infinity,
      hsLookupsPerMonth: Infinity,
      savedPlans: Infinity,
      seats: Infinity,
      apiCallsPerMonth: Infinity,
      monthlyAnthropicSpendCapCents: Infinity, // negotiated per contract
    }),
    features: Object.freeze({
      sourcingAgent: true,
      complianceAgent: true,
      logisticsAgent: true,
      financeAgent: true,
      operationsAgent: true,
      orchestratorAgent: true,
      factorySearch: true,
      shipmentDashboard: true,
      exceptionQueue: true,
      apiAccess: true,
      customAgentTraining: true,
      whiteLabel: true,
      erpIntegration: true,
      shipmentFeeDiscountPct: null, // negotiated
    }),
  }),
]);

const TIER_BY_ID = Object.freeze(Object.fromEntries(TIERS.map(t => [t.id, t])));
const TIER_IDS = Object.freeze(TIERS.map(t => t.id));
const DEFAULT_TIER_ID = 'free';

function getTier(id) {
  return TIER_BY_ID[id] || null;
}

function isValidTierId(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(TIER_BY_ID, id);
}

// Sprint BG-3.3 phase 2 — numeric rank for "higher tier wins" comparisons.
// TIERS is intentionally ordered from least-to-most-capable, so the
// index is a stable rank. Unknown tiers rank as -1 (below free) so any
// real tier always wins over a typo/garbage value.
function tierRank(tierId) {
  if (typeof tierId !== 'string') return -1;
  const i = TIER_IDS.indexOf(tierId);
  return i;
}

// Feature gate: does this tier have access to a named feature?
function hasFeature(tierId, featureName) {
  const tier = TIER_BY_ID[tierId] || TIER_BY_ID[DEFAULT_TIER_ID];
  return !!(tier.features && tier.features[featureName] === true);
}

// Quota lookup: how many <thing> per <period>? Returns Infinity for
// unlimited, 0 for "feature unavailable on this tier".
function getQuota(tierId, quotaName) {
  const tier = TIER_BY_ID[tierId] || TIER_BY_ID[DEFAULT_TIER_ID];
  const q = tier.quotas && tier.quotas[quotaName];
  return q == null ? 0 : q;
}

// Annual savings disclosure (used by pricing page + Stripe price seeding).
function annualSavingPct(tierId) {
  const tier = TIER_BY_ID[tierId];
  if (!tier || !tier.priceMonthlyEur || !tier.priceAnnualEur) return 0;
  const monthlyTotal = tier.priceMonthlyEur * 12;
  return Math.round(((monthlyTotal - tier.priceAnnualEur) / monthlyTotal) * 100);
}

// JSON-safe catalogue (no functions, no Infinity which JSON.stringify drops).
// Used by the public /api/tiers endpoint so the pricing page can render
// from a single source of truth.
function toCatalog() {
  return TIERS.map(t => ({
    id: t.id,
    name: t.name,
    who: t.who,
    priceMonthlyEur: t.priceMonthlyEur,
    priceAnnualEur: t.priceAnnualEur,
    priceFromEur: t.priceFromEur || null,
    popular: !!t.popular,
    requiresContact: !!t.requiresContact,
    isFree: !!t.isFree,
    quotas: Object.fromEntries(
      Object.entries(t.quotas).map(([k, v]) => [k, v === Infinity ? 'unlimited' : v])
    ),
    features: { ...t.features },
    annualSavingPct: annualSavingPct(t.id),
  }));
}

module.exports = {
  TIERS,
  TIER_BY_ID,
  TIER_IDS,
  DEFAULT_TIER_ID,
  getTier,
  isValidTierId,
  tierRank,
  hasFeature,
  getQuota,
  annualSavingPct,
  toCatalog,
};
