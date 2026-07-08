// /api/accuracy — public Quote Accuracy Ledger (sprint 80, Track B).
//
// The measured version of the accuracy guarantee: median absolute
// error, ±5/±10/±20% bands, value-weighted bias — computed from
// customer-reported actuals vs the estimate snapshotted at save
// time. Deterministic end to end (lib/intelligence/accuracy-ledger
// — LLM-free, integer-cents); an auditor can recompute every
// number from the corpus.
//
// Public + PII-free BY CONSTRUCTION: the response is built ONLY
// from the ledger aggregate + methodology copy. Row-level fields
// (emailHash, planId, notes) never reach the response object.
//
// Honesty gates live in the calculator, not here: below 10
// scoreable actuals the headline metrics ship as null and the
// surface says "instrument live, N reported so far" — the ledger
// never flatters itself (pre-revenue truthfulness directive).
//
// Cache: 5-minute KV snapshot. The corpus changes at
// human-reporting cadence, not request cadence; a public page must
// not fan a PG query per pageview. Cache failures are fail-open
// (compute fresh); PG-unconfigured yields the truthful empty
// ledger (sampleSize 0, tier 'insufficient').

'use strict';

const actuals = require('../actuals');
const ledgerCalc = require('../intelligence/accuracy-ledger');

const CACHE_KEY = 'accuracy:ledger:v1';
const CACHE_TTL_SECONDS = 5 * 60;

const METHODOLOGY = Object.freeze({
  comparison: 'customer-reported actual landed cost vs the estimate frozen at quote/plan time (not re-priced later); corpus spans saved plans and fulfilled import requests',
  money: 'integer euro-cents end to end; percentages derive from cent totals',
  gates: `headline metrics withheld below ${ledgerCalc.INDICATIVE_MIN} scoreable actuals ('insufficient'); 'indicative' to ${ledgerCalc.MEASURED_MIN - 1}; 'measured' at ${ledgerCalc.MEASURED_MIN}+`,
  reproducibility: 'stateless recomputation over the actuals corpus — no stored, hand-adjustable figure',
});

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  // Short public cache — the KV snapshot already bounds compute;
  // s-maxage lets the CDN absorb bursts without a function call.
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  return res.end(JSON.stringify(body));
}

async function computeLedger() {
  // Sprint 81 — the corpus spans BOTH loops: saved-plan actuals
  // (BG-1.4, legacy EUR-float snapshot estimates) and fulfilled
  // import-request outcomes (integer-cent quote estimates). Each
  // cut fails open to [] so one corpus outage degrades the sample,
  // never the endpoint.
  const importRequests = require('../db/import-requests');
  const [planRows, wedgeRows] = await Promise.all([
    actuals.listFromPg({ limit: 10000 }),
    importRequests.listActualOutcomesForLedger({ limit: 10000 }),
  ]);
  return ledgerCalc.computeAccuracyLedger([...planRows, ...wedgeRows]);
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end();
  }

  // KV snapshot first — fail-open on any cache trouble.
  const kv = require('../intelligence/kv-store');
  try {
    const cached = await kv.get(CACHE_KEY);
    if (cached && typeof cached === 'object' && cached.ledger) {
      return json(res, 200, { ...cached, cached: true });
    }
  } catch (_) { /* cache read is best-effort */ }

  try {
    const ledger = await computeLedger();
    const body = {
      ok: true,
      ledger,
      methodology: METHODOLOGY,
      generatedAt: new Date().toISOString(),
    };
    try {
      await kv.set(CACHE_KEY, body, { ttlSeconds: CACHE_TTL_SECONDS });
    } catch (_) { /* cache write is best-effort */ }
    return json(res, 200, body);
  } catch (err) {
    // Degrade to the truthful empty ledger rather than 5xx a
    // public trust surface.
    return json(res, 200, {
      ok: false,
      reason: 'ledger unavailable',
      ledger: ledgerCalc.computeAccuracyLedger([]),
      methodology: METHODOLOGY,
      generatedAt: new Date().toISOString(),
    });
  }
};
