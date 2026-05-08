// Implementation roadmap (Sprint AI).
//
// Takes the structured output of composePlan() and turns it into an
// actionable, week-by-week sequence of steps. The wizard renders a plan
// (numbers + recommendations); the roadmap converts those recommendations
// into "what to do, when, who owns it, what artefact you should produce."
//
// PHASES
//   1. Pre-departure        T-12w → T-8w   Sourcing finalised, contracts signed
//   2. Production & QC      T-8w  → T-4w   Manufacturing, inspections, samples
//   3. Logistics & customs  T-4w  → T-0    Booking, docs, declarations
//   4. Arrival & inland     T-0   → T+1w   Port arrival, clearance, delivery
//   5. Post-arrival         T+1w  → T+4w   Reporting, settlement, lessons
//
// Tasks are conditionally added based on plan content:
//   - Bonded warehouse recommended → adds bonded-entry sub-tasks
//   - Preferential origin claimed → adds EUR.1 / GSP form prep
//   - Trade defence measures present → adds surveillance / TARIC checks
//   - CBAM/EUDR/REACH applicable → adds quarterly reporting cadence
//   - FX risk advisory present → adds hedge-execution decision point
//   - Cheaper alternative origin in matrix → flags re-sourcing exploration

'use strict';

const PHASES = Object.freeze([
  { id: 'pre_departure',     name: 'Pre-departure',        windowWeeks: [-12, -8] },
  { id: 'production_qc',     name: 'Production & QC',      windowWeeks: [-8,  -4] },
  { id: 'logistics_customs', name: 'Logistics & customs',  windowWeeks: [-4,   0] },
  { id: 'arrival_inland',    name: 'Arrival & inland',     windowWeeks: [ 0,   1] },
  { id: 'post_arrival',      name: 'Post-arrival',         windowWeeks: [ 1,   4] },
]);

const OWNERS = Object.freeze({
  IMPORTER: 'importer',
  SUPPLIER: 'supplier',
  FORWARDER: 'forwarder',
  BROKER: 'customs broker',
  INSPECTION: 'inspection agency',
});

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function task(phaseId, when, action, owner, opts = {}) {
  return Object.assign({ phaseId, when, action, owner }, opts);
}

// ── Default backbone tasks (always present) ──────────

function backboneTasks(plan) {
  const inputs = plan.inputs || {};
  const tasks = [];

  // Pre-departure
  tasks.push(task('pre_departure', 'T-12w', 'Confirm supplier and lock specifications', OWNERS.IMPORTER, {
    deliverable: 'Signed PO + tech-pack',
    evidence: 'PO PDF, bill of materials, agreed AQL',
  }));
  tasks.push(task('pre_departure', 'T-10w', 'Finalise commercial terms (Incoterms, payment terms, currency)', OWNERS.IMPORTER, {
    deliverable: 'Pro-forma invoice from supplier',
    evidence: `Currency: ${inputs.quoteCurrency || 'EUR'}, Payment: ${inputs.paymentTermsDays || 60}d`,
  }));
  tasks.push(task('pre_departure', 'T-9w', 'Provisional booking with forwarder for sea/air leg', OWNERS.FORWARDER, {
    deliverable: 'Provisional booking confirmation',
    evidence: 'Booking ref, target sailing date',
  }));

  // Production & QC
  tasks.push(task('production_qc', 'T-8w', 'Production start — supplier confirms WIP cadence', OWNERS.SUPPLIER, {
    deliverable: 'Weekly WIP photo updates',
    evidence: 'WIP report 1, 2, 3',
  }));
  tasks.push(task('production_qc', 'T-5w', 'Mid-production inspection (DUPRO)', OWNERS.INSPECTION, {
    deliverable: 'DUPRO inspection report',
    evidence: 'AQL pass/fail, defect breakdown',
  }));
  tasks.push(task('production_qc', 'T-4w', 'Pre-shipment inspection (PSI) at 100% packed', OWNERS.INSPECTION, {
    deliverable: 'PSI report — pass to release',
    evidence: 'Final inspection cert, packing photos',
  }));

  // Logistics & customs
  tasks.push(task('logistics_customs', 'T-4w', 'Confirm vessel and book containers', OWNERS.FORWARDER, {
    deliverable: 'Booking confirmation with B/L draft',
    evidence: 'Container count, ETA destination port',
  }));
  tasks.push(task('logistics_customs', 'T-3w', 'Prepare shipping documents — commercial invoice, packing list, B/L', OWNERS.SUPPLIER, {
    deliverable: 'Commercial invoice, packing list, draft B/L',
    evidence: 'Document set 1 of 2',
  }));
  tasks.push(task('logistics_customs', 'T-2w', 'Customs broker briefed; HS code confirmed', OWNERS.BROKER, {
    deliverable: 'Pre-clearance brief',
    evidence: `HS ${plan.customs && plan.customs.hsChapterLabel ? plan.customs.hsChapterLabel : 'TBC'}`,
  }));
  tasks.push(task('logistics_customs', 'T-1w', 'Pay supplier per agreed terms; secure originals (B/L, CO if needed)', OWNERS.IMPORTER, {
    deliverable: 'Payment evidence + courier-tracked originals',
  }));

  // Arrival & inland
  tasks.push(task('arrival_inland', 'T+0', 'Container arrival at destination port', OWNERS.FORWARDER, {
    deliverable: 'Arrival notice',
    evidence: 'Discharge confirmation',
  }));
  tasks.push(task('arrival_inland', 'T+1d', 'Customs declaration submitted (entry summary)', OWNERS.BROKER, {
    deliverable: 'EAD / customs entry MRN',
    evidence: 'Declaration ref, duty/VAT figures matching plan',
  }));
  tasks.push(task('arrival_inland', 'T+3d', 'Release and inland transport to warehouse', OWNERS.FORWARDER, {
    deliverable: 'Delivery confirmation',
  }));

  // Post-arrival
  tasks.push(task('post_arrival', 'T+1w', 'Receiving check at destination warehouse', OWNERS.IMPORTER, {
    deliverable: 'Receiving report — counts, damage, variances',
    evidence: 'Photos, count sheet, claims if needed',
  }));
  tasks.push(task('post_arrival', 'T+2w', 'Reconcile actual landed cost vs plan', OWNERS.IMPORTER, {
    deliverable: 'Variance memo (planned vs actual EUR/unit)',
    evidence: 'Plan PDF + invoice copies',
  }));
  tasks.push(task('post_arrival', 'T+4w', 'Supplier post-mortem — what to keep, what to change', OWNERS.IMPORTER, {
    deliverable: 'Supplier scorecard updated',
  }));

  return tasks;
}

// ── Conditional tasks driven by plan content ─────────

function conditionalTasks(plan) {
  const tasks = [];
  const inputs = plan.inputs || {};
  const customs = plan.customs || {};
  const compliance = plan.compliance || { regimes: [] };
  const totals = plan.totals || {};

  // Bonded warehouse path: split duty/VAT payment from inland release
  const bondedRecommended = customs.recommendation && customs.recommendation.primary === 'bonded_warehouse';
  if (bondedRecommended) {
    tasks.push(task('logistics_customs', 'T-3w', 'Confirm bonded-warehouse facility booking + ENS pre-arrival', OWNERS.BROKER, {
      deliverable: 'Bonded-WH booking ref',
      evidence: 'Reason: planned cash-flow optimisation vs immediate clearance',
    }));
    tasks.push(task('arrival_inland', 'T+0', 'Goods enter bonded warehouse — duty/VAT deferred', OWNERS.BROKER, {
      deliverable: 'Bonded entry confirmation',
    }));
    tasks.push(task('post_arrival', 'T+1w', 'Plan ex-bond release schedule based on customer demand', OWNERS.IMPORTER, {
      deliverable: 'Release schedule (units/week)',
      evidence: 'Defer duty + VAT until ex-bond date',
    }));
  }

  // Preferential origin claimed: add cert prep and verification windows
  const claimedPref = !!inputs.claimPreferential || (customs.preferentialApplied && customs.preferentialApplied.code);
  if (claimedPref) {
    const code = (customs.preferentialApplied && customs.preferentialApplied.code) || 'preferential';
    tasks.push(task('pre_departure', 'T-10w', `Confirm origin certificate type required (${code})`, OWNERS.SUPPLIER, {
      deliverable: 'Cert template (EUR.1 / EUR-MED / Form A / Statement on Origin)',
      evidence: `Regime: ${code}`,
    }));
    tasks.push(task('production_qc', 'T-5w', 'Supplier prepares origin declaration with HS-level breakdown', OWNERS.SUPPLIER, {
      deliverable: 'Draft origin declaration',
    }));
    tasks.push(task('logistics_customs', 'T-2w', `Original ${code} certificate stamped + couriered to importer`, OWNERS.SUPPLIER, {
      deliverable: 'Original cert in importer hand 5 days before clearance',
      evidence: 'Courier tracking ref',
    }));
  }

  // Trade defence measures (AD/CVD/safeguard): need surveillance documentation
  const tdMeasures = customs.tradeDefenceMeasures || [];
  if (tdMeasures.length) {
    tasks.push(task('logistics_customs', 'T-3w', 'TARIC consultation — confirm AD/CVD rate by manufacturer/exporter', OWNERS.BROKER, {
      deliverable: 'TARIC printout with current rates',
      evidence: tdMeasures.map(m => `${m.id} (${m.type})`).join(', '),
    }));
    tasks.push(task('logistics_customs', 'T-2w', 'Surveillance form (if applicable) submitted via national portal', OWNERS.BROKER, {
      deliverable: 'Surveillance form licence ref',
    }));
  }

  // CBAM / EUDR / REACH: ongoing reporting cadence
  for (const regime of compliance.regimes || []) {
    const id = (regime && regime.id) || '';
    if (/cbam/i.test(id)) {
      tasks.push(task('post_arrival', 'T+4w', 'CBAM quarterly report data captured (embedded emissions)', OWNERS.IMPORTER, {
        deliverable: 'Embedded-emissions worksheet for the quarter',
        evidence: 'Default values OK in transitional period (until 2026); actuals from supplier preferred',
      }));
    }
    if (/eudr/i.test(id)) {
      tasks.push(task('pre_departure', 'T-12w', 'EUDR due-diligence statement prepared (geolocation, deforestation-free)', OWNERS.IMPORTER, {
        deliverable: 'DDS submitted to TRACES NT',
        evidence: 'Geolocation polygons, supplier risk score',
      }));
    }
    if (/reach/i.test(id)) {
      tasks.push(task('production_qc', 'T-6w', 'REACH SVHC declaration from supplier', OWNERS.SUPPLIER, {
        deliverable: 'SVHC list ≤ 0.1% w/w confirmed',
      }));
    }
  }

  // FX risk: hedge decision point
  const fx = plan.fx || null;
  if (fx && fx.recommendation === 'hedge') {
    tasks.push(task('pre_departure', 'T-10w', `Execute ${fx.currency} forward to lock supplier-payment cost`, OWNERS.IMPORTER, {
      deliverable: 'Forward contract booked with bank/broker',
      evidence: `Hedge cost ≈ €${num(fx.hedgeCostEur).toLocaleString('en-IE')} (${fx.hedgeCostBp}bp)`,
    }));
  }

  // Origin-sensitivity: cheaper alternative discovered
  const origin = plan.originSensitivity || null;
  if (origin && origin.cheapestOrigin && origin.cheapestOrigin !== origin.userOrigin && num(origin.savingPctVsUserOrigin) >= 5) {
    tasks.push(task('pre_departure', 'T-12w', `Re-source feasibility — ${origin.cheapestOrigin} saves ${origin.savingPctVsUserOrigin}% vs ${origin.userOrigin}`, OWNERS.IMPORTER, {
      deliverable: 'Decision memo: re-source or stay',
      evidence: `Saving ≈ €${num(origin.savingEurVsUserOrigin).toLocaleString('en-IE')}/shipment`,
    }));
  }

  // Working capital: payment-terms negotiation, if hostile WC
  const wc = plan.workingCapital || null;
  if (wc && wc.workingCapitalEur > num(totals.perShipmentLandedTotal) * 0.8) {
    tasks.push(task('pre_departure', 'T-10w', 'Negotiate longer payment terms (DPO+30) with supplier', OWNERS.IMPORTER, {
      deliverable: 'Updated payment schedule in PO',
      evidence: 'Working-capital tied up roughly equal to one shipment\'s landed cost',
    }));
  }

  return tasks;
}

// ── Top-level: build a phase-grouped roadmap ─────────

const PHASE_ORDER_MAP = Object.fromEntries(PHASES.map((p, i) => [p.id, i]));
const TASK_ORDER_RE = /^T([+-])?(\d+)([dw])?/i;

function tasksort(a, b) {
  // Stable order: phase index, then T-12w < T-8w < T-1w < T+0 < T+1d < T+1w
  const pa = PHASE_ORDER_MAP[a.phaseId] ?? 99;
  const pb = PHASE_ORDER_MAP[b.phaseId] ?? 99;
  if (pa !== pb) return pa - pb;
  const va = parseWhen(a.when);
  const vb = parseWhen(b.when);
  return va - vb;
}

function parseWhen(when) {
  if (!when) return 0;
  const m = String(when).match(TASK_ORDER_RE);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  const n = Number(m[2]) || 0;
  const unit = (m[3] || 'w').toLowerCase();
  const days = unit === 'd' ? n : n * 7;
  return sign * days;
}

function buildRoadmap(plan) {
  if (!plan || !plan.ok) {
    return { ok: false, phases: [], tasksTotal: 0 };
  }
  const all = [...backboneTasks(plan), ...conditionalTasks(plan)];
  // Dedupe: same phase + same when + same action → keep one
  const seen = new Set();
  const unique = [];
  for (const t of all) {
    const k = `${t.phaseId}|${t.when}|${t.action}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(t);
  }
  unique.sort(tasksort);

  const phases = PHASES.map(p => ({
    id: p.id,
    name: p.name,
    windowWeeks: p.windowWeeks,
    tasks: unique.filter(t => t.phaseId === p.id),
  }));

  return {
    ok: true,
    asOf: new Date().toISOString().slice(0, 10),
    tasksTotal: unique.length,
    phases,
  };
}

module.exports = {
  PHASES,
  OWNERS,
  buildRoadmap,
  backboneTasks,
  conditionalTasks,
  parseWhen,
};
