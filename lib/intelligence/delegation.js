'use strict';

// Multi-agent delegation planner + merger (Sprint delegation-v1 / Pillar I6).
//
// The orchestrator already exposes every specialist's tools in one merged
// toolset. This module gives it the COORDINATION layer: decompose a multi-
// domain request into focused sub-tasks routed to the right specialist
// (compliance / logistics / sourcing / finance), in the natural import order,
// and deterministically MERGE the specialists' results into one structure —
// deduping shared citations and ordering by domain.
//
// Deterministic + LLM-free. The orchestrator's LLM still does the reasoning and
// the actual tool calls; this tells it WHICH specialist owns each sub-task and
// in what order, and assembles the combined answer — so delegation is
// repeatable and inspectable rather than ad-hoc.

// Keyword signals per specialist domain. Lowercased substring/word matching.
const DOMAIN_SIGNALS = {
  sourcing: ['supplier', 'factory', 'manufacturer', 'vendor', 'moq', 'fob', 'sample', 'sourcing', 'shortlist', 'lead time', 'lead-time', 'production'],
  compliance: ['duty', 'duties', 'tariff', 'hs code', 'hs-code', 'classification', 'cbam', 'eudr', 'reach', 'ce mark', 'ce marking', 'rohs', 'customs', 'anti-dumping', 'anti dumping', 'countervailing', 'sanction', 'sanctions', 'denied party', 'origin', 'preferential', 'rules of origin', 'compliance', 'regulation', 'restricted', 'licence', 'license'],
  logistics: ['freight', 'shipping', 'ship', 'sea', 'air freight', 'container', 'route', 'routing', 'port', 'warehouse', '3pl', 'bonded', 'transit', 'incoterm', 'clearance', 'delivery', 'logistics'],
  finance: ['payment', 'letter of credit', 'lc', 'fx', 'currency', 'hedge', 'hedging', 'working capital', 'cash conversion', 'credit', 'insurance', 'tco', 'total cost of ownership', 'financing', 'margin', 'cash flow'],
};

// The natural import workflow order — a delegation plan follows it so the
// specialists build on each other (you source, then classify/comply, then
// move, then finance).
const DOMAIN_ORDER = ['sourcing', 'compliance', 'logistics', 'finance'];

const DOMAIN_FOCUS = {
  sourcing: 'supplier economics, MOQ/FOB, samples and sourcing risk',
  compliance: 'duty, anti-dumping, preferential origin, and compliance regimes (CBAM/EUDR/REACH/CE)',
  logistics: 'mode choice, routing, warehousing and customs clearance',
  finance: 'payment terms, FX, working capital, insurance and total cost of ownership',
};

function norm(text) {
  return String(text == null ? '' : text).toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary match so e.g. "import" doesn't trigger the logistics signal
// "port", and "season" doesn't trigger "sea".
function signalHit(text, signal) {
  return new RegExp('\\b' + escapeRe(signal) + '\\b').test(text);
}

// Which specialist domains a task touches, scored by signal hits.
function classifyDomains(task) {
  const t = norm(task);
  const scores = {};
  for (const [domain, signals] of Object.entries(DOMAIN_SIGNALS)) {
    let score = 0;
    for (const sig of signals) if (signalHit(t, sig)) score += 1;
    if (score > 0) scores[domain] = score;
  }
  const domains = Object.keys(scores).sort((a, b) => DOMAIN_ORDER.indexOf(a) - DOMAIN_ORDER.indexOf(b));
  return { domains, scores };
}

// Decompose a task into an ordered delegation plan.
function planDelegation(task) {
  const { domains, scores } = classifyDomains(task);
  // Nothing matched → a single general step handled by the orchestrator itself.
  if (!domains.length) {
    return {
      task: String(task || ''),
      multiDomain: false,
      steps: [{ specialist: 'orchestrator', focus: 'general import question', rationale: 'No single specialist domain dominates; the orchestrator answers directly.' }],
    };
  }
  const steps = domains.map((domain) => ({
    specialist: domain,
    focus: DOMAIN_FOCUS[domain],
    signalStrength: scores[domain],
    rationale: `The request references ${domain} concerns; route this sub-task to the ${domain} specialist toolset.`,
  }));
  return {
    task: String(task || ''),
    multiDomain: domains.length > 1,
    domainCount: domains.length,
    order: domains,
    steps,
    note: 'Execute the steps in order, calling each specialist\'s tools, then merge with mergeSpecialistFindings. Cite every number to its tool and every regulatory claim to a chunk id.',
  };
}

// Merge specialist results into one ordered, deduped structure. Each result:
//   { specialist, summary, citations?: string[], numbers?: [{label,value,tool}], escalate?: bool }
function mergeSpecialistFindings(results) {
  const list = Array.isArray(results) ? results.filter(Boolean) : [];
  const ordered = list.slice().sort((a, b) => DOMAIN_ORDER.indexOf(a.specialist) - DOMAIN_ORDER.indexOf(b.specialist));
  const citations = [];
  const seenCite = new Set();
  const numbers = [];
  let escalate = false;
  const sections = [];

  for (const r of ordered) {
    if (r.escalate) escalate = true;
    for (const c of (Array.isArray(r.citations) ? r.citations : [])) {
      if (!seenCite.has(c)) { seenCite.add(c); citations.push(c); }
    }
    for (const n of (Array.isArray(r.numbers) ? r.numbers : [])) numbers.push({ ...n, specialist: r.specialist });
    sections.push({ specialist: r.specialist, summary: String(r.summary || '').trim() });
  }

  return {
    specialistsConsulted: ordered.map((r) => r.specialist),
    sections,
    citations,
    numbers,
    needsHumanReview: escalate,
    note: escalate ? 'At least one specialist flagged an item for human review before any irreversible action.' : null,
  };
}

module.exports = {
  DOMAIN_SIGNALS,
  DOMAIN_ORDER,
  DOMAIN_FOCUS,
  classifyDomains,
  planDelegation,
  mergeSpecialistFindings,
};
