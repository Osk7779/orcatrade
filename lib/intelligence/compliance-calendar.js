'use strict';

// Compliance obligations calendar (Sprint compliance-calendar-v1).
//
// Turns the scattered per-regime statutory milestones into one user-scoped,
// horizon-filtered, urgency-sorted "here are YOUR upcoming obligations" view —
// the deterministic core of the obligations tracker (docs/billion-dollar-plan.md
// §Pillar II, II6).
//
// Calculator-grounded: this module invents NO dates. It consumes the existing
// timeline builders in cbam-analysis.js / eudr-analysis.js (the single source
// of truth for the dates + citations) and only aggregates, filters, and ranks
// them. If a statutory date moves, it moves in one place and flows through here.
//
// No LLM. Deterministic given (regimes, asOf, horizonDays, isSME).

const { buildCbamTimeline, determineCbamApplicability } = require('./cbam-analysis');
const { buildEudrTimeline, determineEudrApplicability, getEudrSizeImplication } = require('./eudr-analysis');

const DEFAULT_HORIZON_DAYS = 365;

// Regime id → timeline builder. Builders return events shaped
// { date, regulationId, milestone, detail, citation, daysFromAsOf, ... }.
// EUDR additionally sets relevantToImporter (SME vs non-SME application date).
const TIMELINE_BUILDERS = {
  cbam: ({ asOfDate }) => buildCbamTimeline({ asOfDate }),
  eudr: ({ asOfDate, isSME }) => buildEudrTimeline({ asOfDate, isSME }),
};

const SUPPORTED_REGIMES = Object.keys(TIMELINE_BUILDERS);

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Accept an ISO string or a Date; anything else → null (caller falls back to today).
function normaliseAsOf(asOf) {
  if (asOf instanceof Date && !Number.isNaN(asOf.getTime())) {
    return asOf.toISOString().slice(0, 10);
  }
  if (isIsoDate(asOf)) return asOf;
  return null;
}

// Urgency band by days remaining. Mirrors the thresholds used elsewhere for
// drift/anomaly severity so the UI can colour them consistently.
function severityFor(daysUntil) {
  if (daysUntil <= 14) return 'critical';
  if (daysUntil <= 30) return 'high';
  if (daysUntil <= 90) return 'medium';
  return 'low';
}

// Normalise the caller's `regimes` (ids, or objects carrying a regulationId /
// id / regime) into a deduped set of lowercase regime ids we support.
function resolveRegimes(regimes) {
  const out = new Set();
  for (const entry of Array.isArray(regimes) ? regimes : []) {
    const raw = typeof entry === 'string'
      ? entry
      : (entry && (entry.regulationId || entry.regime || entry.id)) || '';
    const id = String(raw).toLowerCase().trim();
    if (TIMELINE_BUILDERS[id]) out.add(id);
  }
  return out;
}

// Return the importer's upcoming statutory obligations, soonest first.
//
// regimes      array of regime ids (or applicability-like objects) the importer
//              is subject to — e.g. ['cbam', 'eudr']. Unknown ids are ignored.
// asOf         ISO date or Date to measure "today" from (defaults to now). Pass
//              an explicit value for reproducible / as-of recompute.
// horizonDays  only return obligations due within this many days (default 365).
// isSME        flips EUDR's relevant application date (SME vs non-SME).
function getUpcomingObligations({ regimes = [], asOf, horizonDays = DEFAULT_HORIZON_DAYS, isSME = false } = {}) {
  const asOfDate = normaliseAsOf(asOf) || todayIso();
  const horizon = Number.isFinite(horizonDays) && horizonDays >= 0 ? horizonDays : DEFAULT_HORIZON_DAYS;
  const ids = resolveRegimes(regimes);

  const events = [];
  for (const id of ids) {
    for (const event of TIMELINE_BUILDERS[id]({ asOfDate, isSME })) {
      events.push(event);
    }
  }

  return events
    // Upcoming or due today; drop milestones already in the past.
    .filter(event => event.daysFromAsOf >= 0)
    .filter(event => event.daysFromAsOf <= horizon)
    // EUDR marks the application date that doesn't apply to this operator size
    // as relevantToImporter:false; CBAM events carry no flag (kept).
    .filter(event => event.relevantToImporter !== false)
    .map(event => ({
      regime: event.regulationId,
      title: event.milestone,
      detail: event.detail,
      citation: event.citation,
      dueDate: event.date,
      daysUntil: event.daysFromAsOf,
      severity: severityFor(event.daysFromAsOf),
    }))
    .sort((a, b) => (a.daysUntil - b.daysUntil) || a.regime.localeCompare(b.regime));
}

// Convenience: the single most-urgent obligation (or null). Handy for a
// dashboard badge or a one-line agent answer.
function getNextObligation(opts) {
  return getUpcomingObligations(opts)[0] || null;
}

// Derive which regimes apply to a shipment, resolve SME status from turnover,
// then return the upcoming obligations. This is the shared derivation path used
// by BOTH the compliance agent's getComplianceCalendar tool and the cron
// deadline-reminder job, so the two never diverge. Still calculator-grounded:
// applicability + dates all come from cbam-analysis / eudr-analysis.
function obligationsForShipment({
  productCategory,
  productDescription,
  originCountry,
  hsCode,
  importerEntity,
  globalTurnoverEur,
  asOf,
  horizonDays,
} = {}) {
  const cbam = determineCbamApplicability({ productCategory, productDescription, originCountry, hsCode });
  const eudr = determineEudrApplicability({ productCategory, productDescription, originCountry, importerEntity });
  const regimesInScope = [];
  if (cbam.applies) regimesInScope.push('cbam');
  if (eudr.applies) regimesInScope.push('eudr');

  const sizeImplication = getEudrSizeImplication(globalTurnoverEur);
  const isSME = sizeImplication ? ['micro', 'small'].includes(sizeImplication.size) : false;

  return {
    regimesInScope,
    isSME,
    obligations: getUpcomingObligations({ regimes: regimesInScope, isSME, horizonDays, asOf }),
  };
}

// Aggregate obligations across many shipments/plans, deduped by regime+dueDate
// (the same statutory date appearing on two plans is one entry) and sorted
// soonest-first. Shared by the cron deadline-reminder job and the orchestrator's
// per-user "all my deadlines" tool.
function aggregateObligations(planInputsList, { asOf, horizonDays } = {}) {
  const byKey = new Map();
  for (const inputs of Array.isArray(planInputsList) ? planInputsList : []) {
    if (!inputs) continue;
    let result;
    try {
      result = obligationsForShipment({
        productCategory: inputs.productCategory,
        productDescription: inputs.productDescription,
        originCountry: inputs.originCountry,
        hsCode: inputs.hsCode,
        asOf,
        horizonDays,
      });
    } catch (_) { continue; }
    for (const o of result.obligations) {
      const k = o.regime + '|' + o.dueDate;
      if (!byKey.has(k)) byKey.set(k, o);
    }
  }
  return [...byKey.values()].sort((a, b) => (a.daysUntil - b.daysUntil) || a.regime.localeCompare(b.regime));
}

module.exports = {
  DEFAULT_HORIZON_DAYS,
  SUPPORTED_REGIMES,
  severityFor,
  getUpcomingObligations,
  getNextObligation,
  obligationsForShipment,
  aggregateObligations,
};
