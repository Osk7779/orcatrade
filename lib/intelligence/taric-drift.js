// TARIC pinning + drift detection — apex plan P1.1.
//
// Two complementary surfaces:
//
//   1. extractPinnedRates(snapshot) — pulls the rate-bearing TARIC
//      look-ups out of a quote-result snapshot (the shape that
//      customs-quote.js produces) so they can be passed to
//      data-snapshot.captureDataSnapshot({ pinnedTaric }).
//
//   2. checkTaricDrift(plan) — given a saved plan that carries
//      pinned TARIC rates in its dataSnapshot, re-runs the live
//      TARIC lookup for each (hsCode, originCountry) pair and
//      reports the drift. The result is what the reproducibility
//      verdict UI badges as "duty rate moved since you saved this".
//
// Why this matters: TARIC schedules are amended frequently
// (quarterly + ad-hoc for anti-dumping). Without pinning, a saved
// plan's duty figure is silently rebuildable to a different number
// six months later. With pinning, the saved figure is the source of
// truth AND the drift is observable.

'use strict';

const taric = require('./taric-client');

// Pure: given a customs-quote result (the object returned by
// calculateQuoteAsync), extract the [{ hsCode, originCountry, rate,
// source, asOf }] entries suitable for pinning. Returns an empty
// array when the quote used the deterministic (non-live) path, so
// callers can pass the result through unconditionally.
function extractPinnedRates(quoteResult) {
  if (!quoteResult || typeof quoteResult !== 'object') return [];
  const meta = quoteResult.liveRateMeta;
  if (!meta || !Number.isFinite(meta.rate)) return [];
  // The quote may carry input echoes; fall back to alternate shapes.
  const hsCode = (quoteResult.input && quoteResult.input.hsCode)
    || quoteResult.hsCode
    || (quoteResult.duty && quoteResult.duty.hsCode);
  const originCountry = (quoteResult.input && quoteResult.input.originCountry)
    || quoteResult.originCountry
    || (quoteResult.duty && quoteResult.duty.originCountry);
  if (!hsCode) return [];
  return [{
    hsCode: String(hsCode),
    originCountry: originCountry ? String(originCountry).toUpperCase() : null,
    rate: Number(meta.rate),
    source: meta.sourceLabel || meta.source || null,
    asOf: meta.asOf || null,
  }];
}

// Pure: same shape, but extract from an array of per-line quote
// results (a portfolio). Deduplicated by (hsCode, originCountry) so
// portfolios with repeating lines don't bloat the snapshot.
function extractPinnedRatesFromPortfolio(quoteResults) {
  if (!Array.isArray(quoteResults)) return [];
  const seen = new Map();
  for (const r of quoteResults) {
    for (const e of extractPinnedRates(r)) {
      const key = `${e.hsCode}|${e.originCountry || ''}`;
      if (!seen.has(key)) seen.set(key, e);
    }
  }
  return [...seen.values()];
}

// Default rate-equality tolerance. TARIC ad-valorem rates are
// quoted to 1-2 decimal places of a percent (e.g. 14.0%, 17.5%).
// A 0.001 (0.1pp) tolerance treats trivial floating-point noise as
// "no drift" but flags a genuine schedule change.
const DRIFT_TOLERANCE_PCT = 0.001;

// Live drift check. Given the pinned rates from a saved plan's
// snapshot, re-fetches each via the live TARIC client and reports
// the diff. The caller (typically the reproducibility verdict
// endpoint) renders this as a per-rate badge.
//
// Returns:
//   {
//     checkedAt: '<ISO>',
//     totalChecked: <int>,
//     drifted: [{ hsCode, originCountry, pinned, current, deltaPct, asOfThen, asOfNow }],
//     unchanged: <int>,
//     unreachable: <int>,                // upstream timed out / unparseable
//     allInTolerance: <bool>,
//   }
async function checkTaricDrift(pinnedRates, opts = {}) {
  const checkedAt = new Date().toISOString();
  if (!Array.isArray(pinnedRates) || pinnedRates.length === 0) {
    return { checkedAt, totalChecked: 0, drifted: [], unchanged: 0, unreachable: 0, allInTolerance: true };
  }
  const tolerance = Number.isFinite(opts.tolerancePct) ? opts.tolerancePct : DRIFT_TOLERANCE_PCT;
  const drifted = [];
  let unchanged = 0;
  let unreachable = 0;
  for (const p of pinnedRates) {
    let live = null;
    try {
      live = await taric.lookupHsRate(p.hsCode, p.originCountry, {
        skipUpstream: opts.skipUpstream === true,
      });
    } catch (_) {
      live = null;
    }
    if (!live || !Number.isFinite(live.rate)) {
      unreachable += 1;
      continue;
    }
    const deltaPct = Math.abs(live.rate - p.rate);
    if (deltaPct <= tolerance) {
      unchanged += 1;
      continue;
    }
    drifted.push({
      hsCode: p.hsCode,
      originCountry: p.originCountry,
      pinned: p.rate,
      current: live.rate,
      deltaPct,
      asOfThen: p.asOf || null,
      asOfNow: live.asOf || null,
      sourceThen: p.source || null,
      sourceNow: live.sourceLabel || live.source || null,
    });
  }
  return {
    checkedAt,
    totalChecked: pinnedRates.length,
    drifted,
    unchanged,
    unreachable,
    allInTolerance: drifted.length === 0,
  };
}

// Pure: given a data-snapshot's `taric.pinned` array (or the entire
// snapshot, we'll dig in), return just the rates suitable for
// re-checking. Defensive on missing branches so the caller never
// has to know the snapshot shape.
function pinnedRatesFromSnapshot(snapshotOrTaric) {
  if (!snapshotOrTaric) return [];
  // Accept either a full data-snapshot or the inner `taric` block.
  const taricBlock = snapshotOrTaric.taric || snapshotOrTaric;
  if (!taricBlock || !Array.isArray(taricBlock.pinned)) return [];
  return taricBlock.pinned.slice();
}

module.exports = {
  extractPinnedRates,
  extractPinnedRatesFromPortfolio,
  pinnedRatesFromSnapshot,
  checkTaricDrift,
  DRIFT_TOLERANCE_PCT,
};
