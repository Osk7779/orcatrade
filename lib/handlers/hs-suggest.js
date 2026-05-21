// GET /api/hs-suggest?q=<description> — Sprint hs-suggest-v1.
//
// Plain-language → candidate HS6 commodity codes for the wizard's
// "look up your code" helper. Public + anonymous (the wizard is used
// signed-out too), rate-limited, no PII at the wire. Pure lookup over
// the curated lib/intelligence/data/hs-suggest dataset — no LLM, no
// upstream call. The duty RATE still comes from live TARIC once the
// user picks a code; this endpoint only helps them find the code.

'use strict';

const hsSuggest = require('../intelligence/data/hs-suggest');
const { consumeRateLimit } = require('../intelligence/runtime-store');
const baseLog = require('../log');
const log = baseLog.withContext({ handler: 'hs-suggest' });

const MAX_QUERY_LEN = 80;
const RATE_LIMIT = 60;            // 60 lookups…
const RATE_WINDOW_MS = 60 * 1000; // …per minute per IP (debounced typing)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('hs-suggest', ip, RATE_LIMIT, RATE_WINDOW_MS);
  if (rate.limited) {
    res.statusCode = 429;
    return res.end(JSON.stringify({ error: 'Too many lookups. Please wait a moment.' }));
  }

  // Pull q from query (req.query.q) or parse the URL as a fallback.
  let q = '';
  if (req.query && req.query.q != null) {
    q = Array.isArray(req.query.q) ? req.query.q[0] : String(req.query.q);
  } else {
    try {
      const url = new URL(req.url || '/', 'https://orcatrade.pl');
      q = url.searchParams.get('q') || '';
    } catch (_) { q = ''; }
  }
  q = String(q || '').slice(0, MAX_QUERY_LEN);

  if (!q.trim()) {
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, query: '', candidates: [] }));
  }

  const candidates = hsSuggest.suggest(q, { limit: 6 });
  log.info('hs-suggest', { len: q.length, hits: candidates.length });
  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: true, query: q, candidates }));
};

module.exports.MAX_QUERY_LEN = MAX_QUERY_LEN;
