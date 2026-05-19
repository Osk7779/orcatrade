// /api/share/<code> — public read-only share handler (shares-v1).
//
// Anyone (no auth) hitting /share/<code> (rewritten to /api/share/<code>
// by vercel.json) gets:
//   1. Lookup: code → plan record (owner email stripped).
//   2. View counter increments.
//   3. Audit event `plan_share_opened` emitted with code + planId
//      (NO email — the audit row never re-introduces the owner's
//      identity since shares are public).
//   4. 302 redirect to /start/?p=<base64-of-inputs>&from=share so
//      the wizard pre-fills with the shared plan's inputs and shows
//      a fresh re-computation against current pricing.
//
// 404 when the code is unknown OR the share was revoked OR the
// underlying plan was deleted.
//
// Rate limit: 30 opens per IP per minute. A naive bot trying to
// guess codes would burn through its budget on the first batch of
// invalid codes (which all return 404).

'use strict';

const savedPlans = require('../saved-plans');
const events = require('../events');
const { consumeRateLimit } = require('../intelligence/runtime-store');
const log = require('../log').withContext({ handler: 'share' });

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://orcatrade.pl';

// Match the wizard's encodeShareInputs from account/plans/app.js +
// start/app.js. Keep this list in sync — a future audit test pins
// the equivalence.
const SHARE_KEYS = [
  'productCategory', 'originCountry', 'destinationCountry',
  'customsValueEur', 'weightKg', 'linesCount', 'urgencyWeeks',
  'monthlyOrders', 'avgUnitsPerOrder', 'avgPalletsHeld', 'avgOrderWeightKg',
  'claimPreferential', 'hsCode', 'moq', 'targetFobUnitEur',
  'quoteCurrency', 'paymentTermsDays',
  'shipmentsPerYear', 'waccPct', 'daysInInventory', 'daysReceivable',
];

function encodeShareInputs(inputs) {
  const minimal = {};
  for (const k of SHARE_KEYS) {
    if (inputs[k] !== undefined && inputs[k] !== null && inputs[k] !== '') {
      minimal[k] = inputs[k];
    }
  }
  const json = JSON.stringify(minimal);
  // base64url
  return Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function jsonResponse(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

// Extract the share code from the URL. Three forms supported:
//   /api/share/<code>            ← direct
//   /share/<code>                ← via vercel.json rewrite
//   ?code=<code>                 ← fallback (testing)
function readCode(req) {
  if (req.query && req.query.path) {
    const parts = Array.isArray(req.query.path) ? req.query.path : String(req.query.path).split('/');
    // path = ['share', '<code>']
    const code = parts[1] || '';
    if (code) return code;
  }
  if (req.query && req.query.code) return String(req.query.code);
  const pathname = (req.url || '').split('?')[0];
  const m = pathname.match(/\/share\/([a-f0-9]{4,32})/i);
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

  // Rate-limit on IP. 30 opens per minute is plenty for a human +
  // expensive for a guessing bot.
  const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || 'unknown';
  const rate = await consumeRateLimit('share-open', ip, 30, 60_000);
  if (rate.limited) {
    return jsonResponse(res, 429, { error: 'Too many requests' });
  }

  const code = readCode(req);
  if (!code || !/^[a-f0-9]{4,32}$/i.test(code)) {
    return jsonResponse(res, 400, { error: 'Invalid share code' });
  }

  const record = await savedPlans.getByShareCode(code);
  if (!record || !record.inputs) {
    log.info('share lookup miss', { requestId: req.requestId, code });
    return jsonResponse(res, 404, { error: 'Share link not found or revoked' });
  }

  // Sprint share-render-v1 — view increment + audit moved to
  // /api/share-check/<code> so every wizard load (including
  // bookmarked revisits) counts as a view, not just the first click.
  // /share/<code> is just the redirect gate now; the wizard's
  // share-check is what makes revocation truly invalidate a bookmark.

  // Redirect to the wizard with the encoded inputs AND the share
  // code so the wizard can fail-soft when the owner later revokes.
  const encoded = encodeShareInputs(record.inputs);
  const target = '/start/?p=' + encoded + '&from=share&share=' + code;
  res.statusCode = 302;
  res.setHeader('Location', target);
  res.setHeader('Cache-Control', 'no-store');
  return res.end();
};

// Test surface
module.exports.encodeShareInputs = encodeShareInputs;
module.exports.SHARE_KEYS = SHARE_KEYS;
module.exports.readCode = readCode;
