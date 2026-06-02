// /api/slo — public read-only SLO snapshot (apex P1.A).
//
// Returns per-handler latency percentiles + error rate over the last
// 24-hour rolling window, as collected by the dispatcher's
// instrumentation (lib/slo.js). No PII; numbers + timing only.
//
// Cache: no-store. The status page consumes this on a 60-second
// interval; a stale CDN response would lie about current behaviour.

'use strict';

const slo = require('../slo');

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  return res.end(JSON.stringify(body));
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

  try {
    const snap = await slo.snapshotAll();
    return json(res, 200, {
      ok: true,
      ...snap,
      docs: 'https://github.com/Osk7779/orcatrade/blob/main/lib/slo.js',
    });
  } catch (err) {
    // KV outage shouldn't 5xx — return an empty snapshot with a flag.
    return json(res, 200, {
      ok: false,
      reason: 'slo snapshot unavailable',
      err: err && err.message ? err.message : null,
      generatedAt: new Date().toISOString(),
      handlers: {},
    });
  }
};
