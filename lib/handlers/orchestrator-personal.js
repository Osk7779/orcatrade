// Orchestrator personal tools — Sprint orchestrator-personal-v1.
//
// Read-only tools that let the Operations Orchestrator reason over the
// SIGNED-IN user's own saved plans + portfolios. They're merged into the
// orchestrator's toolset per-request, only when the request carries a
// valid session (the orchestrator is already Growth-tier gated, so the
// caller is authed). The impls are deterministic KV reads — the AI value
// is the LLM reasoning over the returned data ("which of my portfolios
// is most exposed to X?"), never a number invented by the model.
//
// Privacy: impls are closured over the authenticated email; there is no
// way for the model to pass an arbitrary email — it can only see the
// current user's items.

'use strict';

const savedPlans = require('../saved-plans');
const savedPortfolios = require('../saved-portfolios');
const planDiff = require('../plan-diff');
const { comparePortfolioSnapshots } = require('../intelligence/portfolio-aggregate');
const { aggregateObligations } = require('../intelligence/compliance-calendar');

const MAX_ITEMS = 50;

// ── Tool schemas (Anthropic tool-use format) ────────────

const personalTools = [
  {
    name: 'listMySavedPlans',
    description: "List the signed-in user's OWN saved import plans (single-product). Returns a summary per plan INCLUDING its id, label, product category, origin→destination route, per-shipment landed total, and when it was saved. Use this when the user refers to 'my plans', 'my saved plans', or asks you to compare/prioritise across the plans they've saved. To see how a specific plan's cost has moved since it was saved, take its id from here and call getMySavedPlanDrift. Read-only.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'getMySavedPlanDrift',
    description: "For ONE of the signed-in user's saved single-product plans (identified by the id from listMySavedPlans), recompute it against today's tariff + freight data and return how its landed cost has moved since it was saved. Returns the current landed total plus the drift (€ and % change, days since saved, the biggest cost driver, and whether the move is significant ≥5%). Use this to answer 'what changed', 'has my cost gone up', or 'is this plan still accurate'. Read-only.",
    input_schema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: "The plan id (pl_…) from listMySavedPlans." },
      },
      required: ['planId'],
      additionalProperties: false,
    },
  },
  {
    name: 'listMyPortfolios',
    description: "List the signed-in user's OWN saved multi-SKU portfolios. Returns a summary per portfolio INCLUDING its id, label, number of SKUs, blended duty rate, total landed cost, consolidation saving, and when it was saved. Use this when the user refers to 'my portfolios' or 'my catalogue', or asks which of their portfolios is most exposed/expensive/duty-heavy. To see how a specific portfolio's cost has moved since it was saved, take its id from here and call getMyPortfolioDrift. Read-only.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'getMyPortfolioDrift',
    description: "For ONE of the signed-in user's saved portfolios (identified by the id from listMyPortfolios), recompute it against today's tariff + freight data and return how its total landed cost has moved since it was saved. Returns the current figures plus the drift (€ and % change, direction, and whether the move is material ≥5%). Use this to answer 'what changed', 'has my cost gone up', or 'is this still accurate' about a saved portfolio. Read-only.",
    input_schema: {
      type: 'object',
      properties: {
        portfolioId: { type: 'string', description: "The portfolio id (pf_…) from listMyPortfolios." },
      },
      required: ['portfolioId'],
      additionalProperties: false,
    },
  },
  {
    name: 'getMyComplianceDeadlines',
    description: "Aggregate the upcoming statutory compliance deadlines (CBAM, EUDR) across ALL of the signed-in user's saved plans, soonest first and deduped so the same date isn't repeated per plan. Each entry has the regime, due date, days remaining, urgency, and the regulation citation. Use when the user asks 'what compliance deadlines do I have', 'what's due across my plans', or to prioritise filings. Read-only.",
    input_schema: {
      type: 'object',
      properties: {
        horizonDays: { type: 'integer', description: 'Only include deadlines due within this many days. Default 365.' },
      },
      additionalProperties: false,
    },
  },
];

// ── Summaries (trim records to what the model needs) ────

function summarisePlan(rec) {
  const inp = rec.inputs || {};
  const snap = rec.snapshot || {};
  return {
    id: rec.id || null,
    label: rec.label || null,
    category: inp.productCategory || null,
    route: `${inp.originCountry || '?'}→${inp.destinationCountry || '?'}`,
    customsValueEur: Number(inp.customsValueEur) || null,
    landedEur: Number(snap.perShipmentLandedTotal) || null,
    hsCode: inp.hsCode || null,
    savedAt: rec.savedAt || null,
    hasActual: !!rec.actual,
  };
}

function summarisePortfolio(rec) {
  const snap = rec.snapshot || {};
  const t = snap.totals || {};
  return {
    id: rec.id || null,
    label: rec.label || null,
    skuCount: Array.isArray(rec.lines) ? rec.lines.length : 0,
    blendedDutyRatePct: Number(snap.blendedDutyRatePct) || 0,
    landedEur: Number(t.perShipmentLandedTotal) || null,
    consolidationSavingEur: Number(snap.consolidationSavingEur) || 0,
    savedAt: rec.savedAt || null,
  };
}

// Build the per-request impls, closured over the authenticated email.
function buildPersonalImpls(email) {
  const e = String(email || '').toLowerCase().trim();
  return {
    listMySavedPlans: async () => {
      if (!e) return { count: 0, plans: [] };
      const records = await savedPlans.listPlans(e);
      const plans = (records || []).slice(0, MAX_ITEMS).map(summarisePlan);
      return { count: plans.length, plans };
    },
    getMySavedPlanDrift: async (input) => {
      const id = String((input && input.planId) || '').trim();
      if (!e || !id) return { error: 'planId required' };
      // getPlan is ownership-checked against the closured email.
      const rec = await savedPlans.getPlan(id, e);
      if (!rec) return { error: 'Plan not found' };
      const startHandler = require('./start'); // lazy — avoid load-time cycle
      const result = await startHandler.composePlan(rec.inputs || {});
      if (!result || !result.ok) return { error: 'Could not recompute this plan' };
      const current = planDiff.extractSnapshot(result);
      const inp = rec.inputs || {};
      return {
        label: rec.label || null,
        route: `${inp.originCountry || '?'}→${inp.destinationCountry || '?'}`,
        savedAt: rec.savedAt || null,
        current: { landedEur: Number(current && current.perShipmentLandedTotal) || null },
        // diffSnapshots returns null when there's no saved baseline snapshot.
        drift: planDiff.diffSnapshots(rec.snapshot, current, rec.savedAt),
      };
    },
    listMyPortfolios: async () => {
      if (!e) return { count: 0, portfolios: [] };
      const records = await savedPortfolios.listPortfolios(e);
      const portfolios = (records || []).slice(0, MAX_ITEMS).map(summarisePortfolio);
      return { count: portfolios.length, portfolios };
    },
    getMyPortfolioDrift: async (input) => {
      const id = String((input && input.portfolioId) || '').trim();
      if (!e || !id) return { error: 'portfolioId required' };
      // getPortfolio is ownership-checked against the closured email, so
      // the model can only ever drift the caller's own portfolios.
      const rec = await savedPortfolios.getPortfolio(id, e);
      if (!rec) return { error: 'Portfolio not found' };
      // Lazy-require the handler's shared fan-out to avoid a load-time
      // cycle (portfolio handler → start handler, neither needs us).
      const portfolioHandler = require('./portfolio');
      const { aggregate } = await portfolioHandler.composeAndAggregate(rec.lines || []);
      if (!aggregate) return { error: 'Could not recompute this portfolio' };
      const drift = comparePortfolioSnapshots(rec.snapshot, aggregate);
      return {
        label: rec.label || null,
        savedAt: rec.savedAt || null,
        current: {
          landedEur: Number(aggregate.totals.perShipmentLandedTotal) || null,
          blendedDutyRatePct: Number(aggregate.blendedDutyRatePct) || 0,
        },
        drift, // null when the portfolio had no baseline snapshot
      };
    },
    getMyComplianceDeadlines: async (input) => {
      if (!e) return { plansScanned: 0, count: 0, obligations: [] };
      const horizonDays = Number.isInteger(input && input.horizonDays) ? input.horizonDays : undefined;
      // asOf is accepted (reproducible / as-of answers + tests) but not in the
      // schema — the model always reasons as-of "now".
      const asOf = (input && typeof input.asOf === 'string') ? input.asOf : undefined;
      const records = await savedPlans.listPlans(e);
      const planInputs = (records || []).slice(0, MAX_ITEMS).map((r) => r.inputs).filter(Boolean);
      const obligations = aggregateObligations(planInputs, { asOf, horizonDays });
      return { plansScanned: planInputs.length, count: obligations.length, obligations };
    },
  };
}

// Tool names exposed here — used by classifyTool to tag them 'account'.
const PERSONAL_TOOL_NAMES = personalTools.map((t) => t.name);

module.exports = {
  personalTools,
  buildPersonalImpls,
  summarisePlan,
  summarisePortfolio,
  PERSONAL_TOOL_NAMES,
  MAX_ITEMS,
};
