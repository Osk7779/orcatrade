// User-tier persistence — maps signed-in users to their subscription tier
// (Sprint 40). Lookups happen on every gated request, so reads must be cheap.
//
// Storage:
//   tier:<email> → { tierId, billingCycle: 'monthly'|'annual'|null, since, source: 'manual'|'stripe' }
//
// Sprint 41 (Stripe webhook) writes here on subscription.created /
// subscription.updated / subscription.deleted. Sprint 42 (gating) reads
// here in handler middleware.
//
// Defaults: any user not in the store is treated as 'free'. Never read
// raw tier strings from elsewhere — go through getUserTier() so the
// default + sanitisation apply uniformly.

'use strict';

const kv = require('./intelligence/kv-store');
const tiers = require('./tiers');

const TIER_KEY_PREFIX = 'tier:';
const TIER_TTL_DAYS = 400; // refresh annually-billed tiers without churn

function tierKey(email) {
  return TIER_KEY_PREFIX + String(email || '').toLowerCase().trim();
}

function normalizeBilling(b) {
  return b === 'monthly' || b === 'annual' ? b : null;
}

async function getUserTier(email) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return { tierId: tiers.DEFAULT_TIER_ID, billingCycle: null, since: null, source: 'default' };
  const record = await kv.get(tierKey(e));
  if (!record || !tiers.isValidTierId(record.tierId)) {
    return { tierId: tiers.DEFAULT_TIER_ID, billingCycle: null, since: null, source: 'default' };
  }
  return {
    tierId: record.tierId,
    billingCycle: normalizeBilling(record.billingCycle),
    since: record.since || null,
    source: record.source || 'manual',
  };
}

async function setUserTier(email, { tierId, billingCycle = null, source = 'manual' }) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) throw new Error('setUserTier: email required');
  if (!tiers.isValidTierId(tierId)) throw new Error('setUserTier: invalid tierId: ' + tierId);
  const record = {
    tierId,
    billingCycle: normalizeBilling(billingCycle),
    since: new Date().toISOString(),
    source,
  };
  await kv.set(tierKey(e), record, { ttlSeconds: TIER_TTL_DAYS * 24 * 60 * 60 });
  return record;
}

async function clearUserTier(email) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return false;
  await kv.del(tierKey(e));
  return true;
}

// Convenience: resolve email → full tier object (for handlers that need to
// check both features and quotas without a second module import).
async function resolveTier(email) {
  const record = await getUserTier(email);
  return {
    record,
    tier: tiers.getTier(record.tierId) || tiers.getTier(tiers.DEFAULT_TIER_ID),
  };
}

module.exports = {
  TIER_KEY_PREFIX,
  TIER_TTL_DAYS,
  tierKey,
  getUserTier,
  setUserTier,
  clearUserTier,
  resolveTier,
};
