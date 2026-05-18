// User onboarding progress — Sprint onboarding-v1.
//
// Computes which moat-building actions the signed-in user has
// completed, so /account/ can render a "Getting started" checklist
// that nudges new users toward the actions that compound platform
// value (save a plan → log an actual → create an org → share it).
//
// All five flags are read directly from existing KV indices — no new
// storage. The function is pure-ish (one batch of KV reads per call,
// returns a plain object). Adding a new step is a 3-line change:
// new KV read + flag + STEPS[] entry.

'use strict';

const kv = require('./intelligence/kv-store');
const savedPlans = require('./saved-plans');
const orgs = require('./orgs');

// Source-of-truth list of onboarding steps. The order is the order
// they should be completed; /account/ renders the next-incomplete
// step as the highlighted action. Keys MUST match the property names
// returned by getProgress() so the UI can drive off this list.
const STEPS = Object.freeze([
  Object.freeze({
    key: 'planSaved',
    label: 'Save your first import plan',
    cta: 'Build a plan',
    href: '/start/',
  }),
  Object.freeze({
    key: 'actualLogged',
    label: 'Log a real outcome on one of your plans',
    cta: 'Open saved plans',
    href: '/account/plans/',
  }),
  Object.freeze({
    key: 'orgCreated',
    label: 'Create your organisation',
    cta: 'Create org',
    href: '/account/orgs/',
  }),
  Object.freeze({
    key: 'shareCreated',
    label: 'Share a plan with a teammate or supplier',
    cta: 'Open saved plans',
    href: '/account/plans/',
  }),
]);

// Pure-ish: returns the user's progress flags + a derived summary.
// Each flag is `true` if the user has completed that step.
async function getProgress(email) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) {
    return blankProgress();
  }

  // 1. Saved plans — read their per-user index. Don't fan out to every
  //    plan; the index length alone tells us if they've saved one.
  const planIds = (await kv.get(savedPlans.userPlansKey(e))) || [];
  const planCount = Array.isArray(planIds) ? planIds.length : 0;
  const planSaved = planCount > 0;

  // 2. Actuals — at least one plan with a `.actual` field set. Walk
  //    the first few plans and short-circuit on the first hit. Each
  //    fetch is a KV read so we cap the walk at MAX_PROBE.
  const MAX_PROBE = 10;
  let actualLogged = false;
  let actualCount = 0;
  if (planSaved) {
    const safeIds = Array.isArray(planIds) ? planIds.slice(0, MAX_PROBE) : [];
    for (const planId of safeIds) {
      const rec = await kv.get(savedPlans.planKey(planId));
      if (rec && rec.actual && typeof rec.actual.landedCents === 'number') {
        actualLogged = true;
        actualCount++;
      }
    }
  }

  // 3. Orgs — the user's org index.
  const userOrgs = await orgs.listOrgsForEmail(e);
  const orgCount = Array.isArray(userOrgs) ? userOrgs.length : 0;
  const orgCreated = orgCount > 0;

  // 4. Shares — same first-N walk as actuals; checks for `.share` field.
  let shareCreated = false;
  let shareCount = 0;
  if (planSaved) {
    const safeIds = Array.isArray(planIds) ? planIds.slice(0, MAX_PROBE) : [];
    for (const planId of safeIds) {
      const rec = await kv.get(savedPlans.planKey(planId));
      if (rec && rec.share && rec.share.code) {
        shareCreated = true;
        shareCount++;
      }
    }
  }

  const flags = { planSaved, actualLogged, orgCreated, shareCreated };
  const completed = Object.values(flags).filter(Boolean).length;
  return {
    ...flags,
    completed,
    total: STEPS.length,
    allDone: completed === STEPS.length,
    // Counts surface to the UI for "Saved plans (3)" hints. Approximate
    // — we only walk MAX_PROBE plans for actuals/shares, so on a power
    // user with 50 plans the count is capped. That's fine for an
    // onboarding card.
    counts: {
      plans: planCount,
      actuals: actualCount,
      orgs: orgCount,
      shares: shareCount,
    },
  };
}

function blankProgress() {
  return {
    planSaved: false,
    actualLogged: false,
    orgCreated: false,
    shareCreated: false,
    completed: 0,
    total: STEPS.length,
    allDone: false,
    counts: { plans: 0, actuals: 0, orgs: 0, shares: 0 },
  };
}

// UI helper: given progress, return the FIRST step that isn't yet
// done. The /account/ card highlights this as the "next action".
// Returns null when allDone.
function nextStep(progress) {
  if (!progress) return STEPS[0];
  if (progress.allDone) return null;
  for (const step of STEPS) {
    if (!progress[step.key]) return step;
  }
  return null;
}

module.exports = {
  STEPS,
  getProgress,
  blankProgress,
  nextStep,
};
