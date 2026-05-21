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

const MAX_ITEMS = 50;

// ── Tool schemas (Anthropic tool-use format) ────────────

const personalTools = [
  {
    name: 'listMySavedPlans',
    description: "List the signed-in user's OWN saved import plans (single-product). Returns a summary per plan: label, product category, origin→destination route, per-shipment landed total, and when it was saved. Use this when the user refers to 'my plans', 'my saved plans', or asks you to compare/prioritise across the plans they've saved. Read-only.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'listMyPortfolios',
    description: "List the signed-in user's OWN saved multi-SKU portfolios. Returns a summary per portfolio: label, number of SKUs, blended duty rate, total landed cost, consolidation saving, and when it was saved. Use this when the user refers to 'my portfolios' or 'my catalogue', or asks which of their portfolios is most exposed/expensive/duty-heavy. Read-only.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

// ── Summaries (trim records to what the model needs) ────

function summarisePlan(rec) {
  const inp = rec.inputs || {};
  const snap = rec.snapshot || {};
  return {
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
    listMyPortfolios: async () => {
      if (!e) return { count: 0, portfolios: [] };
      const records = await savedPortfolios.listPortfolios(e);
      const portfolios = (records || []).slice(0, MAX_ITEMS).map(summarisePortfolio);
      return { count: portfolios.length, portfolios };
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
