'use strict';

// Data snapshot — reproducibility-v2 (apex plan III3).
//
// provenance-v1 stamped each plan with the *dates* of the volatile data the
// calculators read. That is not enough to reproduce a euro: if the FX table
// or an AD/CVD rate changes next quarter, recomputing an old plan would
// silently use today's values. This module captures the actual *values* and
// content-addresses them into a stable `dataSnapshotId`, so the apex tuple
//
//     (inputs, calculatorVersion, dataSnapshotId)  →  identical output, forever
//
// holds. `calculatorVersion` pins the code + structural defaults (duty logic,
// emissions-intensity defaults baked into a release); `dataSnapshotId` pins the
// volatile market data that moves independently of code: FX rates/volatility,
// the CBAM ETS market price, and the live EU AD/CVD measure rates. The two are
// orthogonal coordinates — the id deliberately does NOT fold in the calculator
// version so each can be reasoned about separately.
//
// Pure: reads existing data-module constants, no I/O, no LLM. Defensive — a
// missing field degrades to null, never throws — so capture can't break a quote.

const crypto = require('node:crypto');

const fx = require('./data/fx-snapshot');
const cbam = require('./cbam-analysis');
const tradeDefence = require('./data/eu-trade-defence');

// Bump only when the *shape* of a captured snapshot changes (so two ids built
// under different shapes are knowingly not comparable). Value changes do not
// bump this — they change the id, which is the point.
const SNAPSHOT_SCHEMA_VERSION = 1;

const ID_PREFIX = 'ds_';
const ID_HEX_LENGTH = 16; // 64 bits — collision-safe at platform scale (see hash.js)

// Stable, sorted-key JSON so the same data always serialises byte-identically
// regardless of object key insertion order. Mirrors the regression harness's
// sortedStringify but lives here to keep this module self-contained.
function canonicalStringify(value) {
  const seen = new WeakSet();
  function walk(v) {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) throw new Error('Circular reference in data snapshot');
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
    return out;
  }
  return JSON.stringify(walk(value));
}

// Capture the volatile market data the calculators read at quote time. Only
// the fields that drive a customer-facing number are pulled — not source notes
// or confidence prose — so the id changes when (and only when) a number would.
function captureDataSnapshot() {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    fx: {
      asOf: (fx && fx.ASOF) || null,
      rates: (fx && fx.RATES) ? { ...fx.RATES } : null,
      volatility90dPct: (fx && fx.VOLATILITY_90D_PCT) ? { ...fx.VOLATILITY_90D_PCT } : null,
      hedgeCostBpPer30d: (fx && fx.HEDGE_COST_BP_PER_30D) ? { ...fx.HEDGE_COST_BP_PER_30D } : null,
    },
    cbamEts: cbam && cbam.ETS_PRICE_SNAPSHOT
      ? {
          asOf: cbam.ETS_PRICE_SNAPSHOT.asOf || null,
          priceEurPerTonne: cbam.ETS_PRICE_SNAPSHOT.priceEurPerTonne != null
            ? cbam.ETS_PRICE_SNAPSHOT.priceEurPerTonne
            : null,
          scenarioRange: cbam.ETS_PRICE_SNAPSHOT.scenarioRange
            ? { ...cbam.ETS_PRICE_SNAPSHOT.scenarioRange }
            : null,
        }
      : null,
    tradeDefence: {
      asOf: (tradeDefence && tradeDefence.ASOF) || null,
      // Capture the rate-bearing fields of every measure — these are the
      // numbers that land in a duty line. Sorted by id for a stable id.
      measures: Array.isArray(tradeDefence && tradeDefence.MEASURES)
        ? tradeDefence.MEASURES
            .map((m) => ({
              id: m.id || null,
              hsPrefix: m.hsPrefix || null,
              origins: Array.isArray(m.origins) ? [...m.origins].sort() : null,
              type: m.type || null,
              rateTypicalPct: m.rateTypicalPct != null ? m.rateTypicalPct : null,
              rateMinPct: m.rateMinPct != null ? m.rateMinPct : null,
              rateMaxPct: m.rateMaxPct != null ? m.rateMaxPct : null,
              citation: m.citation || null,
            }))
            .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        : null,
    },
    // TARIC duty rates are fetched live (or read from the offline snapshot in
    // tests). When live, the fetched rates are NOT pinned by this id — pinning
    // them requires storing the per-quote fetched rates, which is the next
    // slice. We record the mode so a recompute knows whether the snapshot is
    // authoritative for duty or must re-fetch.
    taric: {
      mode: process.env.ORCATRADE_DISABLE_LIVE_TARIC ? 'snapshot' : 'live',
    },
  };
}

// Content-addressed id over the captured data. Deterministic: identical data
// ⇒ identical id; any captured value changing ⇒ a different id.
function dataSnapshotId(snapshot) {
  const digest = crypto
    .createHash('sha256')
    .update(canonicalStringify(snapshot))
    .digest('hex')
    .slice(0, ID_HEX_LENGTH);
  return ID_PREFIX + digest;
}

// The current snapshot + its id, ready to bind into a plan's provenance and
// (slice 2) to persist in the content-addressed snapshot store.
function currentDataSnapshot() {
  const snapshot = captureDataSnapshot();
  return {
    id: dataSnapshotId(snapshot),
    capturedAt: new Date().toISOString(), // metadata only — NOT part of the id
    snapshot,
  };
}

// Human/machine-readable diff of the money-driving fields between two captured
// snapshots — the honest answer to "would a quote from snapshot A differ if
// recomputed under snapshot B, and why?". Pure; defensive on missing branches.
// Only fields that move a customer-facing number are reported.
function diffDataSnapshots(oldSnap, newSnap) {
  const changes = [];
  const a = oldSnap || {};
  const b = newSnap || {};

  function cmp(field, label, from, to) {
    if (from === undefined && to === undefined) return;
    if (from !== to) changes.push({ field, label, from: from == null ? null : from, to: to == null ? null : to });
  }

  // FX
  const fxA = a.fx || {}; const fxB = b.fx || {};
  cmp('fx.asOf', 'FX snapshot date', fxA.asOf, fxB.asOf);
  const ratesA = fxA.rates || {}; const ratesB = fxB.rates || {};
  for (const cur of new Set([...Object.keys(ratesA), ...Object.keys(ratesB)])) {
    cmp(`fx.rates.${cur}`, `FX rate EUR→${cur}`, ratesA[cur], ratesB[cur]);
  }

  // CBAM ETS price
  const etsA = a.cbamEts || {}; const etsB = b.cbamEts || {};
  cmp('cbamEts.priceEurPerTonne', 'CBAM ETS price (€/tCO₂e)', etsA.priceEurPerTonne, etsB.priceEurPerTonne);
  cmp('cbamEts.asOf', 'CBAM ETS snapshot date', etsA.asOf, etsB.asOf);

  // AD/CVD measure rates, keyed by measure id
  const tdA = a.tradeDefence || {}; const tdB = b.tradeDefence || {};
  cmp('tradeDefence.asOf', 'Trade-defence snapshot date', tdA.asOf, tdB.asOf);
  const byIdA = new Map((tdA.measures || []).map((m) => [m.id, m]));
  const byIdB = new Map((tdB.measures || []).map((m) => [m.id, m]));
  for (const id of new Set([...byIdA.keys(), ...byIdB.keys()])) {
    const mA = byIdA.get(id); const mB = byIdB.get(id);
    cmp(`tradeDefence.${id}.rateTypicalPct`, `AD/CVD rate ${id}`,
      mA ? mA.rateTypicalPct : undefined, mB ? mB.rateTypicalPct : undefined);
  }

  // TARIC mode (live vs snapshot)
  cmp('taric.mode', 'TARIC mode', (a.taric || {}).mode, (b.taric || {}).mode);

  return { changed: changes.length > 0, changes };
}

module.exports = {
  SNAPSHOT_SCHEMA_VERSION,
  ID_PREFIX,
  ID_HEX_LENGTH,
  canonicalStringify,
  captureDataSnapshot,
  dataSnapshotId,
  currentDataSnapshot,
  diffDataSnapshots,
};
