// Sprint BG-9 — Snapshot extractor for the calculator regression harness.
//
// Pulls a deterministic subset of fields out of a composePlan() result.
// Excludes every value that would naturally drift between runs (date
// stamps, asOf timestamps, free-text narratives, sourcing-comparison
// arrays whose ordering depends on tie-breaks). Keeps every headline
// numeric customers see on the result page so a calculator regression
// fails the test loud before it ships.
//
// Each scenario gets ONE JSON file in __snapshots__/<slug>.json keyed
// to the slug. Files are written via JSON.stringify with sorted keys
// (helpers.sortedStringify) so PR diffs read cleanly.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SNAPSHOTS_DIR = path.resolve(__dirname, '__snapshots__');
const SNAPSHOT_VERSION = 1;

// Currency rounding — everything is integer EUR for the snapshot, even
// when the calculator returns sub-euro precision internally. Sub-euro
// drift inside a €100k landed cost is noise; we want the test to flag
// changes a customer would see, not floating-point dust.
function roundEur(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n));
}

function roundPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n) * 10) / 10; // 0.1pp precision
}

function pickStandardCustoms(customs) {
  if (!customs || !customs.ok || !customs.standard) return null;
  const s = customs.standard;
  return {
    dutyEur: roundEur(s.dutyEur),
    dutyRate: roundPct((s.dutyRate || 0) * 100),
    vatEur: roundEur(s.vatEur),
    vatRate: roundPct((s.vatRate || 0) * 100),
    brokerageEur: roundEur(s.brokerageEur),
    entrySummaryDeclarationEur: roundEur(s.entrySummaryDeclarationEur),
    totalEur: roundEur(s.totalEur),
    landedCostEur: roundEur(s.landedCostEur),
    effectiveLandedCostEur: roundEur(s.effectiveLandedCostEur),
    vatRecoverableEur: roundEur(s.vatRecoverableEur),
  };
}

function pickBondedCustoms(customs) {
  if (!customs || !customs.ok || !customs.bonded) return null;
  const b = customs.bonded;
  return {
    dutyEur: roundEur(b.dutyEur),
    vatEur: roundEur(b.vatEur),
    brokerageEur: roundEur(b.brokerageEur),
    totalEur: roundEur(b.totalEur),
    landedCostEur: roundEur(b.landedCostEur),
  };
}

function pickTradeDefence(customs) {
  if (!customs || !Array.isArray(customs.tradeDefenceMeasures)) return [];
  // Sort by type + ratePct desc so the snapshot is order-stable.
  return customs.tradeDefenceMeasures
    .map((m) => ({
      type: m.type || null,
      ratePct: roundPct(m.rateTypicalPct || m.ratePct || 0),
      citation: m.citation || null,
    }))
    .sort((a, b) => {
      const t = String(a.type).localeCompare(String(b.type));
      if (t !== 0) return t;
      return (b.ratePct || 0) - (a.ratePct || 0);
    });
}

function pickPreferential(customs) {
  if (!customs || !customs.preferentialApplied) return null;
  const p = customs.preferentialApplied;
  return {
    code: p.code || null,
    ratePct: roundPct(p.ratePct != null ? p.ratePct : p.rate),
    mfnReplaced: p.mfnReplaced === true,
  };
}

function pickCompliance(compliance) {
  if (!compliance || !Array.isArray(compliance.regimes)) return { count: 0, ids: [] };
  const ids = compliance.regimes
    .map((r) => r.id || r.code || r.key || null)
    .filter((c) => typeof c === 'string')
    .sort();
  return { count: ids.length, ids };
}

function pickRouting(routing) {
  if (!routing || !routing.recommendation) return null;
  return {
    primaryMode: routing.recommendation.primary || null,
  };
}

function pickTotals(totals) {
  if (!totals) return null;
  return {
    transportEur: roundEur(totals.transportEur),
    customsValueEur: roundEur(totals.customsValueEur),
    dutyEur: roundEur(totals.dutyEur),
    vatEur: roundEur(totals.vatEur),
    brokerageEur: roundEur(totals.brokerageEur),
    perShipmentLandedTotal: roundEur(totals.perShipmentLandedTotal),
    effectiveLandedTotal: roundEur(totals.effectiveLandedTotal),
    vatRecoverableEur: roundEur(totals.vatRecoverableEur),
    warehouseMonthlyEur: roundEur(totals.warehouseMonthlyEur),
  };
}

function pickTco(tco) {
  if (!tco || !tco.ok || !tco.main) return null;
  const m = tco.main;
  return {
    annualCustomsValueEur: roundEur(m.annualCustomsValueEur),
    annualDutyEur: roundEur(m.annualDutyEur),
    annualVatEur: roundEur(m.annualVatEur),
    annualTransportEur: roundEur(m.annualTransportEur),
    annualBrokerageEur: roundEur(m.annualBrokerageEur),
    avgInventoryValueEur: roundEur(m.avgInventoryValueEur),
    inventoryCarryingCostEur: roundEur(m.inventoryCarryingCostEur),
    annualNetCost: roundEur(m.annualNetCost),
    annualCashFlowCost: roundEur(m.annualCashFlowCost),
    annualWarehouseEur: roundEur(m.annualWarehouseEur),
  };
}

function pickWorkingCapital(wc) {
  if (!wc || !wc.ok) return null;
  return {
    dio: wc.dio != null ? Number(wc.dio) : null,
    dso: wc.dso != null ? Number(wc.dso) : null,
    dpo: wc.dpo != null ? Number(wc.dpo) : null,
    ccc: wc.ccc != null ? Number(wc.ccc) : null,
    workingCapitalEur: roundEur(wc.workingCapitalEur),
    annualCapitalCostEur: roundEur(wc.annualCapitalCostEur),
    verdict: wc.verdict || null,
  };
}

function pickFx(fx) {
  if (!fx || !fx.ok) return null;
  return {
    currency: fx.currency || null,
    spotRateForeignPerEur: fx.spotRateForeignPerEur != null
      ? Math.round(Number(fx.spotRateForeignPerEur) * 1000) / 1000
      : null, // 3-decimal pin — FX_DISPLAY snapshot is integer-stable
    vol90dPct: roundPct(fx.vol90dPct),
    hedgeCostBp: fx.hedgeCostBp != null ? Number(fx.hedgeCostBp) : null,
    riskEur5pctMove: roundEur(fx.riskEur5pctMove),
    recommendation: fx.recommendation || null,
  };
}

function pickOriginSensitivity(os) {
  if (!os || !Array.isArray(os.matrix)) return null;
  return {
    matrixLength: os.matrix.length,
    cheapestOriginCode: os.cheapestOrigin ? os.cheapestOrigin.country : null,
    userOriginCode: os.userOrigin ? os.userOrigin.country : null,
    savingEurVsUserOrigin: roundEur(os.savingEurVsUserOrigin),
    savingPctVsUserOrigin: roundPct(os.savingPctVsUserOrigin),
  };
}

// Pure, deterministic extractor. No I/O.
function extractSnapshot(plan) {
  if (!plan || plan.ok !== true) {
    return { ok: false, errors: (plan && plan.errors) || ['composePlan returned not-ok'] };
  }
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    ok: true,
    totals: pickTotals(plan.totals),
    routing: pickRouting(plan.routing),
    customs: {
      standard: pickStandardCustoms(plan.customs),
      bonded: pickBondedCustoms(plan.customs),
      tradeDefence: pickTradeDefence(plan.customs),
      preferentialApplied: pickPreferential(plan.customs),
    },
    compliance: pickCompliance(plan.compliance),
    tco: pickTco(plan.tco),
    workingCapital: pickWorkingCapital(plan.workingCapital),
    fx: pickFx(plan.fx),
    originSensitivity: pickOriginSensitivity(plan.originSensitivity),
  };
}

// JSON.stringify with sorted keys + 2-space indent for clean diffs.
function sortedStringify(obj) {
  const seen = new WeakSet();
  function walk(v) {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) throw new Error('Circular reference in snapshot');
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
    return out;
  }
  return JSON.stringify(walk(obj), null, 2) + '\n';
}

function snapshotPath(slug) {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/i.test(slug)) {
    throw new Error('snapshot slug must match [a-z0-9-] and be ≤80 chars: ' + slug);
  }
  return path.join(SNAPSHOTS_DIR, slug + '.json');
}

function loadSnapshot(slug) {
  const file = snapshotPath(slug);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeSnapshot(slug, snapshot) {
  if (!fs.existsSync(SNAPSHOTS_DIR)) fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  fs.writeFileSync(snapshotPath(slug), sortedStringify(snapshot));
}

function listSnapshotFiles() {
  if (!fs.existsSync(SNAPSHOTS_DIR)) return [];
  return fs.readdirSync(SNAPSHOTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}

module.exports = {
  SNAPSHOT_VERSION,
  SNAPSHOTS_DIR,
  extractSnapshot,
  sortedStringify,
  snapshotPath,
  loadSnapshot,
  writeSnapshot,
  listSnapshotFiles,
  // exposed for unit tests
  roundEur,
  roundPct,
};
