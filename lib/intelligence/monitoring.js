'use strict';

// Proactive monitoring rules engine (Sprint monitoring-v1 / apex-plan Pillar I3).
//
// Generalises the one-off compliance-deadline cron into a rules engine that
// watches each user's saved plans + portfolios and emits structured ALERTS:
//   • plan_cost_drift       — a saved plan's landed cost moved ≥5% since saved
//                             (captures tariff changes, AD/CVD, freight moves)
//   • portfolio_cost_drift  — same, for a multi-SKU portfolio
//   • fx_exposure           — an unhedged non-EUR plan with material FX risk
//   • compliance_deadline   — a CBAM/EUDR statutory deadline inside the window
//   • sanctions_list_update — the consolidated lists changed → re-screen
//
// CALCULATOR-GROUNDED, LLM-FREE (lives under lib/intelligence/). Every number
// in an alert comes from a deterministic calculator: plan-diff, fx-quote,
// compliance-calendar, the sanctions store. The AI layer may later narrate an
// alert into prose, but it never invents the figures here.
//
// Handler-free by design: the recompute of a plan/portfolio (which lives in a
// handler) is INJECTED as `recomputePlan` / `recomputePortfolio`, so this
// module never statically requires a handler and stays free of the Anthropic
// SDK import graph. The cron wires the real recompute in; tests inject a stub.

const planDiff = require('../plan-diff');
const fx = require('./fx-quote');
const { comparePortfolioSnapshots } = require('./portfolio-aggregate');
const { aggregateObligations } = require('./compliance-calendar');

// A drift is worth alerting on at the same ≥5% bar plan-diff already uses for
// "significant"; ≥10% bumps the severity to high.
const DRIFT_HIGH_PCT = 10;
// FX: only alert when the deterministic recommendation is "hedge". Vol above
// this (annualised-ish 90d %) makes it high rather than medium.
const FX_HIGH_VOL_PCT = 12;
// Compliance: surface obligations due within this window in the inbox.
const DEADLINE_HORIZON_DAYS = 120;
const KV_SANCTIONS_SEEN = 'monitoring:sanctionsSeen';

function driftSeverity(pct) {
  return Math.abs(pct) >= DRIFT_HIGH_PCT ? 'high' : 'medium';
}

function eur(n) {
  if (n == null || !Number.isFinite(Number(n))) return '€—';
  const v = Math.round(Number(n));
  return (v < 0 ? '−€' : '€') + Math.abs(v).toLocaleString('en-IE');
}

// Map a plan-diff primaryDriver to plain-English cause language. This is the
// signal that turns a generic "cost moved" into "your duty went up" — i.e. a
// tariff change the user needs to know about.
function driverPhrase(driver) {
  switch (driver) {
    case 'duty': return 'duty';
    case 'transport': return 'freight';
    case 'vat': return 'VAT';
    case 'brokerage': return 'brokerage';
    default: return 'landed cost';
  }
}

// ── Rule: plan cost drift ───────────────────────────────
// Needs a baseline snapshot to diff against; plans saved without one are skipped.
async function planCostDriftAlerts(planRecord, { recomputePlan }) {
  if (!planRecord || !planRecord.snapshot || typeof recomputePlan !== 'function') return [];
  let result;
  try { result = await recomputePlan(planRecord.inputs || {}); }
  catch (_) { return []; }
  if (!result || !result.ok) return [];
  const current = planDiff.extractSnapshot(result);
  const drift = planDiff.diffSnapshots(planRecord.snapshot, current, planRecord.savedAt);
  if (!drift || !drift.significant) return [];

  const dir = drift.landedDeltaPct >= 0 ? 'up' : 'down';
  const driver = driverPhrase(drift.primaryDriver);
  const label = planRecord.label || (planRecord.inputs && planRecord.inputs.productCategory) || 'a saved plan';
  return [{
    type: 'plan_cost_drift',
    severity: driftSeverity(drift.landedDeltaPct),
    title: `Landed cost ${dir} ${Math.abs(drift.landedDeltaPct)}% on "${label}"`,
    body: `The per-shipment landed cost has moved ${eur(drift.landedDeltaEur)} (${drift.landedDeltaPct}%) since you saved this plan ${drift.daysSinceSaved} day(s) ago — mostly ${driver}. Re-open the plan to see the new breakdown.`,
    entityType: 'plan',
    entityId: planRecord.id || null,
    dedupeKey: `plan_cost_drift:${planRecord.id}`,
    data: { drift, driver: drift.primaryDriver },
  }];
}

// ── Rule: FX exposure ───────────────────────────────────
function fxExposureAlerts(planRecord) {
  const inp = (planRecord && planRecord.inputs) || {};
  const currency = String(inp.quoteCurrency || '').toUpperCase();
  const value = Number(inp.customsValueEur);
  if (!currency || currency === 'EUR' || !Number.isFinite(value) || value <= 0) return [];
  if (!fx.isSupported || !fx.isSupported(currency)) {
    // fx-quote guards this itself, but skip early when we can.
  }
  let risk;
  try {
    risk = fx.assessFxRisk({ customsValueEur: value, quoteCurrency: currency, paymentTermsDays: Number(inp.paymentTermsDays) || 60 });
  } catch (_) { return []; }
  if (!risk || !risk.ok || risk.recommendation !== 'hedge') return [];

  const label = planRecord.label || inp.productCategory || 'a saved plan';
  const high = Number(risk.vol90dPct) >= FX_HIGH_VOL_PCT;
  return [{
    type: 'fx_exposure',
    severity: high ? 'high' : 'medium',
    title: `Unhedged ${currency} exposure on "${label}"`,
    body: `This plan settles in ${currency}. At ${risk.vol90dPct}% 90-day volatility, a one-sigma adverse move is about ${eur(risk.riskEur1Sigma90d)} on a ${eur(value)} order. The hedge cost is ~${eur(risk.hedgeCostEur)} — the calculator recommends hedging.`,
    entityType: 'plan',
    entityId: planRecord.id || null,
    dedupeKey: `fx_exposure:${planRecord.id}:${currency}`,
    data: { currency, vol90dPct: risk.vol90dPct, riskEur1Sigma90d: risk.riskEur1Sigma90d, hedgeCostEur: risk.hedgeCostEur, recommendation: risk.recommendation },
  }];
}

// ── Rule: portfolio cost drift ──────────────────────────
async function portfolioCostDriftAlerts(portfolioRecord, { recomputePortfolio }) {
  if (!portfolioRecord || !portfolioRecord.snapshot || typeof recomputePortfolio !== 'function') return [];
  let aggregate;
  try { aggregate = await recomputePortfolio(portfolioRecord.lines || []); }
  catch (_) { return []; }
  if (!aggregate) return [];
  const drift = comparePortfolioSnapshots(portfolioRecord.snapshot, aggregate);
  // comparePortfolioSnapshots flags its ≥5% threshold as `material`.
  if (!drift || !drift.material) return [];

  const pct = Number(drift.landedDeltaPct) || 0;
  const dir = pct >= 0 ? 'up' : 'down';
  const label = portfolioRecord.label || 'a saved portfolio';
  return [{
    type: 'portfolio_cost_drift',
    severity: driftSeverity(pct),
    title: `Portfolio landed cost ${dir} ${Math.abs(pct)}% on "${label}"`,
    body: `The total landed cost of this portfolio has moved ${eur(drift.landedDeltaEur)} (${pct}%) since you saved it. Re-open it to see which SKUs moved.`,
    entityType: 'portfolio',
    entityId: portfolioRecord.id || null,
    dedupeKey: `portfolio_cost_drift:${portfolioRecord.id}`,
    data: { drift },
  }];
}

// ── Rule: compliance deadlines ──────────────────────────
// Aggregated across the user's plans (deduped by regime+date). Inbox-only —
// deadline EMAILS are owned by the separate compliance-deadline-reminders cron,
// so the digest builder excludes this type to avoid double-emailing.
function complianceDeadlineAlerts(planInputs, { asOf } = {}) {
  const due = aggregateObligations(planInputs, { asOf, horizonDays: DEADLINE_HORIZON_DAYS });
  return due
    .filter((o) => o.severity === 'critical' || o.severity === 'high')
    .map((o) => ({
      type: 'compliance_deadline',
      severity: o.severity,
      title: `${String(o.regime).toUpperCase()} — ${o.title} due in ${o.daysUntil} day(s)`,
      body: `${o.detail || ''}${o.citation ? ` (${o.citation})` : ''} Due ${o.dueDate}.`.trim(),
      entityType: 'global',
      entityId: null,
      dedupeKey: `compliance_deadline:${o.regime}:${o.dueDate}`,
      data: { obligation: o },
    }));
}

// ── Shared context (computed once per scan) ─────────────
// Detects whether the consolidated sanctions lists changed since the last scan
// by comparing a fingerprint of per-source counts stored in KV. Returns the
// delta so the per-user rule can emit a "re-screen" advisory keyed on the new
// version (so each user gets it once per change, not once per scan).
function sanctionsFingerprint(meta) {
  if (!meta || !meta.authoritative) return null;
  const parts = (meta.sources || []).map((s) => `${s.source}:${s.count}`).sort();
  return `${meta.totalCount}|${parts.join(',')}`;
}

async function buildSharedContext({ kv: kvDep } = {}) {
  const store = require('./sanctions-list-store');
  const kv = kvDep || require('./kv-store');
  let meta = null;
  try { meta = await store.listMeta(); } catch (_) { meta = null; }
  const fingerprint = sanctionsFingerprint(meta);

  let previous = null;
  try { previous = await kv.get(KV_SANCTIONS_SEEN); } catch (_) { previous = null; }
  const prevFp = previous && previous.fingerprint;

  const changed = !!(fingerprint && prevFp && fingerprint !== prevFp);
  return {
    sanctions: meta,
    sanctionsFingerprint: fingerprint,
    sanctionsChanged: changed,
    sanctionsPrevTotal: previous && previous.totalCount,
    // The cron persists this after the scan so the NEXT run can diff.
    _persistSeen: async () => {
      if (!fingerprint) return;
      try { await kv.set(KV_SANCTIONS_SEEN, { fingerprint, totalCount: meta.totalCount, at: new Date().toISOString() }); } catch (_) {}
    },
  };
}

function sanctionsUpdateAlerts(sharedCtx) {
  if (!sharedCtx || !sharedCtx.sanctionsChanged) return [];
  const meta = sharedCtx.sanctions || {};
  return [{
    type: 'sanctions_list_update',
    severity: 'info',
    title: 'Consolidated sanctions lists were updated',
    body: `The OFAC / UK OFSI / UN consolidated lists changed (now ${meta.totalCount} designations). Re-screen any counterparties you're about to transact with on the Screening page.`,
    entityType: 'global',
    entityId: null,
    dedupeKey: `sanctions_list_update:${sharedCtx.sanctionsFingerprint}`,
    data: { totalCount: meta.totalCount, previousTotal: sharedCtx.sanctionsPrevTotal || null, sources: meta.sources || [] },
  }];
}

// ── Per-user evaluation ─────────────────────────────────
// Pure aside from the injected recompute fns + the calculators. Returns alert
// CANDIDATES (not yet persisted); the cron dedupes + stores them.
async function evaluateUser({ plans = [], portfolios = [] }, sharedCtx = {}, opts = {}) {
  const candidates = [];

  for (const plan of plans) {
    candidates.push(...await planCostDriftAlerts(plan, opts));
    candidates.push(...fxExposureAlerts(plan));
  }
  for (const pf of portfolios) {
    candidates.push(...await portfolioCostDriftAlerts(pf, opts));
  }

  const planInputs = plans.map((p) => p && p.inputs).filter(Boolean);
  candidates.push(...complianceDeadlineAlerts(planInputs, opts));
  candidates.push(...sanctionsUpdateAlerts(sharedCtx));

  return candidates;
}

// Types that belong in the proactive monitoring EMAIL digest. Deadlines are
// excluded — they own the compliance-deadline-reminders email stream.
const EMAILABLE_TYPES = new Set(['plan_cost_drift', 'portfolio_cost_drift', 'fx_exposure', 'sanctions_list_update']);

module.exports = {
  DRIFT_HIGH_PCT,
  FX_HIGH_VOL_PCT,
  DEADLINE_HORIZON_DAYS,
  KV_SANCTIONS_SEEN,
  EMAILABLE_TYPES,
  driftSeverity,
  driverPhrase,
  sanctionsFingerprint,
  planCostDriftAlerts,
  fxExposureAlerts,
  portfolioCostDriftAlerts,
  complianceDeadlineAlerts,
  sanctionsUpdateAlerts,
  buildSharedContext,
  evaluateUser,
};
