// /api/tiers — public catalogue + signed-in user's current tier (Sprint 40).
//
//   GET /api/tiers          → public catalogue (no auth)
//   GET /api/tiers/me       → current user's tier (auth required)
//
// The catalogue is the source of truth shared by the pricing page,
// upgrade-prompt UI, and the Stripe webhook (Sprint 41) when it maps a
// `price.id` back to a tierId via metadata.tier_id.

'use strict';

const auth = require('../auth');
const tiers = require('../tiers');
const userTier = require('../user-tier');

function jsonResponse(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function resolveSubAction(req) {
  if (req.query && req.query.path) {
    const arr = Array.isArray(req.query.path) ? req.query.path : String(req.query.path).split('/');
    return (arr[1] || '').toLowerCase();
  }
  const pathname = (req.url || '').split('?')[0];
  const segments = pathname.replace(/^\/api\/tiers\/?/, '').split('/').filter(Boolean);
  return (segments[0] || '').toLowerCase();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }
  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  const sub = resolveSubAction(req);

  if (sub === 'me') {
    const user = auth.getCurrentUser(req);
    if (!user) return jsonResponse(res, 401, { error: 'Sign in required' });
    const resolved = await userTier.resolveTier(user.email);
    return jsonResponse(res, 200, {
      ok: true,
      email: user.email,
      tierId: resolved.record.tierId,
      billingCycle: resolved.record.billingCycle,
      since: resolved.record.since,
      source: resolved.record.source,
      tier: {
        id: resolved.tier.id,
        name: resolved.tier.name,
        features: resolved.tier.features,
      },
    });
  }

  // Public catalogue
  return jsonResponse(res, 200, {
    ok: true,
    catalog: tiers.toCatalog(),
    defaultTierId: tiers.DEFAULT_TIER_ID,
  });
};
