'use strict';

// Reproducibility provenance (Sprint provenance-v1).
//
// The apex plan's headline trust promise: every euro shown to a customer is
// reproducible. This stamps each plan with the calculator version + the
// data-snapshot dates in effect when it was computed, so a result can be
// audited / reproduced later — same (inputs, calculatorVersion, dataAsOf)
// deterministically yields the same numbers.
//
// Pure read of existing data-module constants — no I/O, no LLM. Defensive
// (every source guarded) so a missing field degrades to null, never throws.

const fx = require('./data/fx-snapshot');
const cbam = require('./cbam-analysis');
const tradeDefence = require('./data/eu-trade-defence');

// Bump this whenever a change alters the money math (so two results with
// different versions are knowingly not comparable). Date-stamped for humans.
const CALCULATOR_VERSION = 'calc-2026-05-22';

function currentProvenance() {
  return {
    calculatorVersion: CALCULATOR_VERSION,
    generatedAt: new Date().toISOString(),
    // The snapshot dates the deterministic calculators read from. TARIC is
    // 'live' unless explicitly disabled (the test/offline path).
    dataAsOf: {
      fx: (fx && fx.ASOF) || null,
      cbamEtsPrice: (cbam && cbam.ETS_PRICE_SNAPSHOT && cbam.ETS_PRICE_SNAPSHOT.asOf) || null,
      tradeDefence: (tradeDefence && tradeDefence.ASOF) || null,
    },
    taricMode: process.env.ORCATRADE_DISABLE_LIVE_TARIC ? 'snapshot' : 'live',
  };
}

module.exports = {
  CALCULATOR_VERSION,
  currentProvenance,
};
