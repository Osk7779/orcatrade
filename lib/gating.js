// Tier gating (Sprint 42).
//
// Runs at the top of premium handlers to enforce feature flags and per-user
// monthly quotas. Two primitives:
//
//   checkFeature(req, featureName)
//     → { allowed: true, tierId }
//     → { allowed: false, status: 402, body: { error, code, currentTier,
//                                             requiredFeature, minimumTier,
//                                             upgradeUrl } }
//
//   checkQuota(req, quotaName, increment)
//     → { allowed: true, used, limit, remaining }
//     → { allowed: false, status: 429, body: { error, code, currentTier,
//                                             quota, used, limit,
//                                             period, upgradeUrl } }
//
// Both return verdicts; the caller writes the response (handlers in this
// codebase use a mix of res.status().json() and res.statusCode + res.end —
// returning verdicts decouples gating from response style).
//
// Quota counters key by email-or-IP + month, so:
//   - Signed-in users get scoped counters
//   - Anonymous users hit the free-tier counter against their IP (rough,
//     but sufficient for the only public-but-gated path: composePlan via
//     /api/start, which we *don't* gate today — kept here for parity)
//
// Convenience: gate(res, gateResult) writes the standard response in either
// style, so handlers using either pattern can do `if (!verdict.allowed) return gate(res, verdict)`.

'use strict';

const auth = require('./auth');
const tiers = require('./tiers');
const userTier = require('./user-tier');
const kv = require('./intelligence/kv-store');

const QUOTA_KEY_PREFIX = 'quota:';

function currentMonthBucket(now = new Date()) {
  return now.toISOString().slice(0, 7); // YYYY-MM
}

function quotaKey(identity, quotaName, bucket) {
  return `${QUOTA_KEY_PREFIX}${identity}:${quotaName}:${bucket}`;
}

function clientIp(req) {
  const fwd = req && req.headers && req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return 'unknown';
}

// Return the identity used for both tier resolution and quota tracking.
// Signed-in users → email; anonymous → ip:<address>.
function resolveIdentity(req) {
  const user = auth.getCurrentUser(req);
  if (user && user.email) return { kind: 'email', identity: user.email };
  return { kind: 'ip', identity: 'ip:' + clientIp(req) };
}

async function resolveTierForRequest(req) {
  const id = resolveIdentity(req);
  if (id.kind === 'email') {
    const r = await userTier.resolveTier(id.identity);
    return { tierId: r.record.tierId, tier: r.tier, identity: id.identity, kind: id.kind };
  }
  const tier = tiers.getTier(tiers.DEFAULT_TIER_ID);
  return { tierId: tiers.DEFAULT_TIER_ID, tier, identity: id.identity, kind: id.kind };
}

// Find the lowest-priced tier that grants a given feature — used in upgrade
// prompts so the user knows the cheapest path to unlock.
function minimumTierForFeature(featureName) {
  for (const tier of tiers.TIERS) {
    if (tier.features && tier.features[featureName] === true) return tier.id;
  }
  return null;
}

async function checkFeature(req, featureName) {
  const resolved = await resolveTierForRequest(req);
  if (tiers.hasFeature(resolved.tierId, featureName)) {
    return { allowed: true, tierId: resolved.tierId };
  }
  return {
    allowed: false,
    status: 402,
    body: {
      error: `This feature requires a higher subscription tier (${featureName}).`,
      code: 'tier_gate',
      currentTier: resolved.tierId,
      requiredFeature: featureName,
      minimumTier: minimumTierForFeature(featureName),
      upgradeUrl: '/pricing/',
    },
  };
}

async function checkQuota(req, quotaName, increment = 1) {
  const resolved = await resolveTierForRequest(req);
  const limit = tiers.getQuota(resolved.tierId, quotaName);
  if (limit === Infinity) {
    return { allowed: true, used: null, limit: 'unlimited', remaining: 'unlimited', tierId: resolved.tierId };
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    return {
      allowed: false,
      status: 402,
      body: {
        error: `${quotaName} not available on the ${resolved.tierId} tier.`,
        code: 'tier_gate',
        currentTier: resolved.tierId,
        quota: quotaName,
        upgradeUrl: '/pricing/',
      },
    };
  }

  const bucket = currentMonthBucket();
  const key = quotaKey(resolved.identity, quotaName, bucket);
  const used = (await kv.get(key)) || 0;
  if (used >= limit) {
    return {
      allowed: false,
      status: 429,
      body: {
        error: `Monthly ${quotaName} quota reached (${used}/${limit}).`,
        code: 'tier_quota',
        currentTier: resolved.tierId,
        quota: quotaName,
        used, limit,
        period: bucket,
        upgradeUrl: '/pricing/',
      },
    };
  }
  // Increment counter — TTL = end of next month so old buckets fall off.
  const next = used + Math.max(1, Number(increment) || 1);
  // 62-day TTL is enough to span any month boundary without losing the bucket
  // mid-period; freshly-used quotas reset cleanly when bucket flips.
  await kv.set(key, next, { ttlSeconds: 62 * 24 * 60 * 60 });
  return { allowed: true, used: next, limit, remaining: Math.max(0, limit - next), tierId: resolved.tierId };
}

// Write a 402/429 response in either Vercel-Express style or the
// raw-Node style used by the newer handlers.
function gate(res, verdict) {
  if (!verdict || verdict.allowed) return false;
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(verdict.status).json(verdict.body);
    return true;
  }
  res.statusCode = verdict.status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(verdict.body));
  return true;
}

module.exports = {
  QUOTA_KEY_PREFIX,
  currentMonthBucket,
  quotaKey,
  clientIp,
  resolveIdentity,
  resolveTierForRequest,
  minimumTierForFeature,
  checkFeature,
  checkQuota,
  gate,
};
