// /api/share-check/<code> — Sprint share-render-v1.
//
// The wizard calls this on every cold load when ?share=<code> is in
// the URL. It validates the code AND increments the view counter so
// bookmarked revisits count, then returns one of:
//
//   200 { ok: true, viewCount, createdAt }       valid share
//   404 { error: 'Share link not found or revoked' }
//   400 { error: 'Invalid share code' }
//   429 { error: 'Too many requests' }
//
// Privacy: owner email never reaches the wire. The endpoint exists
// purely so /share/<code> + /start/?p=…&share=<code> become equivalent
// from a "revocation actually works" standpoint — without this, the
// resolved /start/ URL stays viewable forever even after the owner
// hits Revoke.

'use strict';

const savedPlans = require('../saved-plans');
const events = require('../events');
const { consumeRateLimit } = require('../intelligence/runtime-store');
const log = require('../log').withContext({ handler: 'share-check' });

function jsonResponse(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

function readCode(req) {
  if (req.query && req.query.path) {
    const parts = Array.isArray(req.query.path) ? req.query.path : String(req.query.path).split('/');
    // path = ['share-check', '<code>']
    const code = parts[1] || '';
    if (code) return code;
  }
  if (req.query && req.query.code) return String(req.query.code);
  const pathname = (req.url || '').split('?')[0];
  const m = pathname.match(/\/share-check\/([a-f0-9]{4,32})/i);
  if (m) return m[1];
  return '';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  // Slightly more permissive than /share/<code> (60/min vs 30/min)
  // because the wizard hits this on EVERY load — a user who reloads
  // a few times shouldn't get rate-limited.
  const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || 'unknown';
  const rate = await consumeRateLimit('share-check', ip, 60, 60_000);
  if (rate.limited) {
    return jsonResponse(res, 429, { error: 'Too many requests' });
  }

  const code = readCode(req);
  if (!code || !/^[a-f0-9]{4,32}$/i.test(code)) {
    return jsonResponse(res, 400, { error: 'Invalid share code' });
  }

  const record = await savedPlans.getByShareCode(code);
  if (!record || !record.inputs) {
    log.info('share check miss', { requestId: req.requestId, code });
    return jsonResponse(res, 404, { error: 'Share link not found or revoked' });
  }

  // Fire-and-forget view increment + audit. KV writes are fast; the
  // 404 path above means we only ever count valid visits.
  savedPlans.incrementShareViews(code).catch(() => { /* noop */ });
  try {
    await events.record('plan_share_opened', {
      code,
      planId: record.id,
      // No owner email — shares are public, the audit row mustn't
      // reintroduce identity to a public-traffic event.
      ip,
    });
  } catch (_) { /* tolerable */ }

  return jsonResponse(res, 200, {
    ok: true,
    code,
    viewCount: (record.share && record.share.viewCount) || 0,
    createdAt: (record.share && record.share.createdAt) || null,
  });
};

// Test surface
module.exports.readCode = readCode;
