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

// Sprint BG-3.3 phase 1 — org-tier override. When an admin assigns a
// tier to an org (e.g. a Team-plan sales conversation closes), the
// org-tier becomes the effective tier for every member of that org.
// Keyed separately from email tiers so the migration is opt-in: if no
// org-tier is set, members fall back to their per-email tier (free,
// or grandfathered Stripe). Full Stripe-driven org tiers land in
// phase 2 — this sprint is the data + lookup foundation.
const ORG_TIER_KEY_PREFIX = 'tier:org:';

function tierKey(email) {
  return TIER_KEY_PREFIX + String(email || '').toLowerCase().trim();
}

function orgTierKey(orgId) {
  return ORG_TIER_KEY_PREFIX + String(orgId || '').trim();
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

// ── Org-tier CRUD (Sprint BG-3.3 phase 1) ────────────────

async function getOrgTier(orgId) {
  const id = String(orgId || '').trim();
  if (!id) return null;
  const record = await kv.get(orgTierKey(id));
  if (!record || !tiers.isValidTierId(record.tierId)) return null;
  return {
    tierId: record.tierId,
    billingCycle: normalizeBilling(record.billingCycle),
    since: record.since || null,
    source: record.source || 'manual',
  };
}

async function setOrgTier(orgId, { tierId, billingCycle = null, source = 'manual' }) {
  const id = String(orgId || '').trim();
  if (!id) throw new Error('setOrgTier: orgId required');
  if (!tiers.isValidTierId(tierId)) throw new Error('setOrgTier: invalid tierId: ' + tierId);
  const record = {
    tierId,
    billingCycle: normalizeBilling(billingCycle),
    since: new Date().toISOString(),
    source,
  };
  await kv.set(orgTierKey(id), record, { ttlSeconds: TIER_TTL_DAYS * 24 * 60 * 60 });
  return record;
}

async function clearOrgTier(orgId) {
  const id = String(orgId || '').trim();
  if (!id) return false;
  await kv.del(orgTierKey(id));
  return true;
}

// ── Effective-tier resolution ────────────────────────────
//
// resolveTier(email) returns the tier that should govern THIS user's
// request, consulting:
//   1. The HIGHEST tier across all the user's orgs (any org with a
//      tier assigned — BG-3.3 phase 2 "higher wins"). When a user is
//      in two orgs, one on Growth and one on Starter, they see Growth
//      everywhere — matches Slack / Notion / Linear pattern. Phase 1
//      picked just the primary (oldest) org; phase 2 broadens this so
//      any org the user belongs to lifts their effective tier.
//   2. Their per-email tier (Stripe-paid grandfathered users + manual
//      assignments). Phase 2 still writes per-email when a user has
//      no orgs at checkout time, so this branch is the fallback for
//      users without a team.
//   3. The free tier default.
//
// The shape of the return value is unchanged — every caller (gating,
// billing, /api/tiers) keeps working. `origin` is 'org' | 'email' |
// 'default'; when 'org', `orgId` names the winning org (the one whose
// tier rank was highest, ties broken by oldest membership).

async function resolveTier(email) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) {
    const t = tiers.getTier(tiers.DEFAULT_TIER_ID);
    return {
      record: { tierId: t.id, billingCycle: null, since: null, source: 'default' },
      tier: t,
      origin: 'default',
    };
  }

  // 1. Highest-tier org-override across every org the user belongs to.
  // Lazy-require lib/orgs to avoid the circular orgs↔user-tier import.
  let orgs;
  try { orgs = require('./orgs'); } catch (_) { orgs = null; }
  if (orgs && typeof orgs.listOrgsForEmail === 'function') {
    const userOrgs = await orgs.listOrgsForEmail(e);
    if (userOrgs && userOrgs.length > 0) {
      // Sprint BG-3.3 phase 2 — collect every org's tier, pick the
      // highest. Iteration order is insertion order from listOrgsForEmail
      // (oldest first), so equal-rank ties stay deterministic — oldest
      // membership wins, preserving phase-1 behaviour.
      let bestRecord = null;
      let bestOrgId = null;
      let bestRank = -1;
      for (const org of userOrgs) {
        const orgRecord = await getOrgTier(org.id);
        if (!orgRecord) continue;
        const rank = tiers.tierRank(orgRecord.tierId);
        if (rank > bestRank) {
          bestRank = rank;
          bestRecord = orgRecord;
          bestOrgId = org.id;
        }
      }
      if (bestRecord) {
        return {
          record: bestRecord,
          tier: tiers.getTier(bestRecord.tierId) || tiers.getTier(tiers.DEFAULT_TIER_ID),
          origin: 'org',
          orgId: bestOrgId,
        };
      }
    }
  }

  // 2. Per-email tier (Stripe + manual + default fallback).
  const record = await getUserTier(e);
  return {
    record,
    tier: tiers.getTier(record.tierId) || tiers.getTier(tiers.DEFAULT_TIER_ID),
    origin: record.source === 'default' ? 'default' : 'email',
  };
}

module.exports = {
  TIER_KEY_PREFIX,
  TIER_TTL_DAYS,
  ORG_TIER_KEY_PREFIX,
  tierKey,
  orgTierKey,
  getUserTier,
  setUserTier,
  clearUserTier,
  getOrgTier,
  setOrgTier,
  clearOrgTier,
  resolveTier,
};
