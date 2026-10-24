// /api/sla — public SLA attainment (sprint 85, Track D phase 1).
//
// The public half of the Track C SLA engine: platform-wide
// measured attainment for both commitments — quote turnaround
// (48h) and first human response (24h) — over the rolling 90-day
// window. Deterministic (lib/intelligence/sla.js), stateless
// recomputation, shared honesty gates with the accuracy ledger.
//
// A published SLA nobody can verify is a slogan; this endpoint is
// what makes /trust/sla checkable. PII-free BY CONSTRUCTION: the
// response is attainment aggregates + methodology only.
//
// Same cache + degrade posture as /api/accuracy: 5-minute KV
// snapshot, CDN s-maxage, cache fail-open, corpus failure
// degrades to the truthful accruing state — never a 5xx on a
// trust surface.

'use strict';

const importRequests = require('../db/import-requests');
const slaCalc = require('../intelligence/sla');

const CACHE_KEY = 'sla:attainment:v1';
const CACHE_TTL_SECONDS = 5 * 60;

const METHODOLOGY = Object.freeze({
  quoteTurnaround: 'submitted → customer-visible quote; first-quote times only (a rework never launders a slow first answer)',
  firstResponse: 'submitted → first HUMAN ops action (review decision or ops message); automated transitions never stop the clock',
  window: `rolling ${slaCalc.SLA_WINDOW_DAYS}-day window; attainment accrues from measurement go-live — nothing back-filled`,
  gates: 'headline figures withheld below 10 scoreable rows; indicative to 49; measured at 50+ — shared with the accuracy ledger',
  breaches: 'every commitment breach is recorded as exactly one audit-chained event by an hourly sweep; the published count is a live query over that record — null means the ledger is unreadable right now, never zero',
  reproducibility: 'stateless recomputation over the stamped timestamps — no stored, hand-adjustable figure',
});

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  return res.end(JSON.stringify(body));
}

async function computeAttainment() {
  // Platform-wide cuts (orgId omitted); each reader fails open to
  // [] so one cut's trouble degrades its sample, not the endpoint.
  const events = require('../events');
  const [turnRows, frRows, breachCount] = await Promise.all([
    importRequests.listQuoteTurnaroundsForSla({ windowDays: slaCalc.SLA_WINDOW_DAYS }),
    importRequests.listFirstResponsesForSla({ windowDays: slaCalc.SLA_WINDOW_DAYS }),
    // Sprint 98 — the published breach ledger. NULL (not 0) when
    // the PG spine is unreadable: 'zero breaches' is a claim,
    // 'ledger unavailable' is a state, and the surface renders
    // them differently.
    events.countEventsFromPg({
      type: 'import_request_sla_breached',
      sinceDays: slaCalc.SLA_WINDOW_DAYS,
    }),
  ]);
  return {
    windowDays: slaCalc.SLA_WINDOW_DAYS,
    quoteTurnaround: slaCalc.computeSlaAttainment(turnRows, {
      targetHours: slaCalc.SLA_QUOTE_TURNAROUND_TARGET_HOURS,
    }),
    firstResponse: slaCalc.computeSlaAttainment(frRows, {
      targetHours: slaCalc.SLA_FIRST_RESPONSE_TARGET_HOURS,
    }),
    // count: number | null. Every recorded breach is an audit-
    // chained event (sprint 97) — this figure is recomputable at
    // /api/audit-anchor + the events corpus, like everything else
    // on the trust surfaces.
    breachesRecorded: { windowDays: slaCalc.SLA_WINDOW_DAYS, count: breachCount },
  };
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end();
  }

  const kv = require('../intelligence/kv-store');
  try {
    const cached = await kv.get(CACHE_KEY);
    if (cached && typeof cached === 'object' && cached.sla) {
      return json(res, 200, { ...cached, cached: true });
    }
  } catch (_) { /* cache read is best-effort */ }

  try {
    const sla = await computeAttainment();
    const body = {
      ok: true,
      sla,
      methodology: METHODOLOGY,
      generatedAt: new Date().toISOString(),
    };
    try {
      await kv.set(CACHE_KEY, body, { ttlSeconds: CACHE_TTL_SECONDS });
    } catch (_) { /* cache write is best-effort */ }
    return json(res, 200, body);
  } catch (err) {
    // Degrade to the truthful accruing state, never a 5xx.
    return json(res, 200, {
      ok: false,
      reason: 'sla attainment unavailable',
      sla: {
        windowDays: slaCalc.SLA_WINDOW_DAYS,
        quoteTurnaround: slaCalc.computeSlaAttainment([], {
          targetHours: slaCalc.SLA_QUOTE_TURNAROUND_TARGET_HOURS,
        }),
        firstResponse: slaCalc.computeSlaAttainment([], {
          targetHours: slaCalc.SLA_FIRST_RESPONSE_TARGET_HOURS,
        }),
      },
      methodology: METHODOLOGY,
      generatedAt: new Date().toISOString(),
    });
  }
};

// Sprint 86 — the trust pack reuses the exact same computation
// (single source of truth: the bundle can never disagree with the
// live endpoint).
module.exports = handler;
module.exports.computeAttainment = computeAttainment;
module.exports.METHODOLOGY = METHODOLOGY;
