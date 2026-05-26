// /api/plans/* — saved-plan CRUD for signed-in users.
//
// Sub-actions resolved from URL path:
//   POST   /api/plans                 → save a plan (body: {inputs, label?})
//   GET    /api/plans                 → list user's plans
//   GET    /api/plans/<id>            → get a single plan (ownership-checked)
//   DELETE /api/plans/<id>            → delete a plan (ownership-checked)
//   GET    /api/plans/<id>/reproduce  → reproducibility / data-drift check
//
// All endpoints require the user to be signed in (auth cookie present).
// 401 returned otherwise.

'use strict';

const auth = require('../auth');
const savedPlans = require('../saved-plans');
const actuals = require('../actuals');
const planDiff = require('../plan-diff');
const startHandler = require('./start');
const events = require('../events');
const gating = require('../gating');
const welcome = require('../welcome');
const notificationPrefs = require('../notification-prefs');
const snapshotStore = require('../snapshot-store');
const dataSnapshot = require('../intelligence/data-snapshot');
const { consumeRateLimit } = require('../intelligence/runtime-store');

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://orcatrade.pl';

function jsonResponse(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function requireAuth(req, res) {
  const user = auth.getCurrentUser(req);
  if (!user) {
    jsonResponse(res, 401, { error: 'Sign in required' });
    return null;
  }
  return user;
}

// Recompute totals against current pricing so we can snapshot at save and
// diff at read. composePlan returns {ok:false} on validation failure — we
// swallow that here because the inputs were already validated by savePlan.
async function computeSnapshot(inputs) {
  try {
    const result = await startHandler.composePlan(inputs);
    if (!result || !result.ok) return null;
    return planDiff.extractSnapshot(result);
  } catch (_err) {
    return null;
  }
}

// Annotate a plan record with the variance between its reported actual
// (if any) and the saved snapshot — exactly the answer to "did my call
// match reality?" Returns the record untouched when no actual is set.
function withActualVariance(record) {
  if (!record || !record.actual) return record;
  const variance = actuals.computeVariance(record.actual, record.snapshot);
  return variance ? { ...record, actualVariance: variance } : record;
}

// POST /api/plans  body: { inputs, label? }
async function handleSave(req, res, user) {
  const body = req.body || {};
  if (!body.inputs || typeof body.inputs !== 'object') {
    return jsonResponse(res, 400, { error: 'inputs object required' });
  }
  // Sprint 42: per-tier saved-plan quota. Free tier gets 5 plans/month —
  // enough to evaluate, not enough to run an operation on.
  const quotaGate = await gating.checkQuota(req, 'savedPlans', 1);
  if (!quotaGate.allowed) return gating.gate(res, quotaGate);
  try {
    // Sprint first-plan-welcome-v1 — read pre-save plan count so we
    // can detect a 0→1 transition and fire the one-shot welcome email.
    // Cheap: a single KV read on the user's plans index. Done BEFORE
    // savePlan so we know "this save IS their first" without racing
    // against a parallel save (no concurrent saves expected per user;
    // even if there were, the welcome.sendWelcomeIfFirst dedupe key
    // covers the race).
    const priorPlanCount = (await savedPlans.listPlans(user.email)).length;

    const snapshot = await computeSnapshot(body.inputs);
    const record = await savedPlans.savePlan({
      email: user.email,
      inputs: body.inputs,
      label: body.label || '',
      snapshot,
    });
    try {
      await events.record('plan_saved', {
        inputs: record.inputs,
        landedTotal: snapshot ? snapshot.perShipmentLandedTotal : null,
        planId: record.id,
        emailProvided: true,
      });
    } catch (_e) {}

    // Sprint first-plan-welcome-v1 — fire-and-forget welcome email on
    // 0→1 transition. The wizard passes its current locale; we honour
    // it with EN-fallback. welcome.js handles idempotency, circuit
    // wrapping, and silent-fail; nothing here can break the save.
    //
    // Sprint email-locale-v1 — also persist the locale to prefs on
    // first save so future plan-revision + weekly-digest emails go
    // out in the same language the wizard was used in. Only writes
    // if the user has never explicitly set a locale on
    // /account/preferences/, so an admin who reset their preference
    // doesn't get it overwritten by a stray PL/DE save.
    if (priorPlanCount === 0) {
      const locale = welcome.normaliseLocale(body.locale);
      const localePrefix = locale === 'en' ? '' : '/' + locale;
      welcome.sendWelcomeIfFirst(user.email, {
        locale,
        planUrl: `${SITE_ORIGIN}/account/plans/`,
        wizardUrl: `${SITE_ORIGIN}${localePrefix}/start/`,
        prefsUrl: `${SITE_ORIGIN}/account/preferences/`,
      }).catch(() => { /* silent — welcome is non-load-bearing */ });
      notificationPrefs.setLocaleIfMissing(user.email, locale)
        .catch(() => { /* silent — locale persistence is non-load-bearing */ });
    }

    return jsonResponse(res, 200, { ok: true, plan: record });
  } catch (err) {
    return jsonResponse(res, 400, { error: err.message || 'savePlan failed' });
  }
}

// GET /api/plans
async function handleList(req, res, user) {
  const records = await savedPlans.listPlans(user.email);
  const enriched = await Promise.all(
    records.map(async r => withActualVariance(planDiff.enrichRecord(r, await computeSnapshot(r.inputs))))
  );
  return jsonResponse(res, 200, { ok: true, plans: enriched });
}

// GET /api/plans/<id>
async function handleGet(req, res, user, planId) {
  const record = await savedPlans.getPlan(planId, user.email);
  if (!record) return jsonResponse(res, 404, { error: 'Plan not found' });
  const enriched = withActualVariance(planDiff.enrichRecord(record, await computeSnapshot(record.inputs)));
  return jsonResponse(res, 200, { ok: true, plan: enriched });
}

// DELETE /api/plans/<id>
async function handleDelete(req, res, user, planId) {
  const ok = await savedPlans.deletePlan(planId, user.email);
  if (!ok) return jsonResponse(res, 404, { error: 'Plan not found' });
  return jsonResponse(res, 200, { ok: true });
}

// POST /api/plans/<id>/actual  body: { landedEur, notes? }  (Sprint BG-1.4)
//   Upserts the actual outcome for the plan. One actual per plan (re-
//   reporting overwrites). Returns the updated record with the freshly
//   computed variance vs the saved snapshot.
async function handleSetActual(req, res, user, planId) {
  const body = req.body || {};

  // Sprint first-actual-welcome-v1 — count actuals across the user's
  // plans BEFORE this call so we can detect the 0→1 transition. A
  // re-report on the same plan still bumps priorActualCount to ≥1, so
  // re-fires get filtered here even before welcome.js's idempotency
  // key trips. listPlans is the same KV read we'd do for /api/plans
  // anyway — no extra cost.
  let priorActualCount = 0;
  try {
    const allPlans = await savedPlans.listPlans(user.email);
    priorActualCount = allPlans.filter((p) => p && p.actual).length;
  } catch (_) { /* listing failure shouldn't block the actual write */ }

  let updated;
  try {
    updated = await actuals.setActual(planId, user.email, body);
  } catch (err) {
    return jsonResponse(res, 400, { error: err.message || 'setActual failed' });
  }
  if (!updated) return jsonResponse(res, 404, { error: 'Plan not found' });
  // Sprint BG-5.5-style audit row. Stores landed cents + variance %
  // (not raw EUR) so the audit dashboard shows the signal directly.
  const variance = actuals.computeVariance(updated.actual, updated.snapshot);
  try {
    await events.record('actual_reported', {
      email: user.email,
      planId,
      landedCents: updated.actual.landedCents,
      deltaPct: variance ? variance.deltaPct : null,
    });
  } catch (_) {}

  // Sprint first-actual-welcome-v1 — fire-and-forget celebration email
  // on 0→1 transition. Locale comes from the user's stored prefs (set
  // on first plan save by email-locale-v1). welcome.js handles
  // idempotency, circuit-wrapping, and silent-fail; nothing here can
  // break the actual write.
  if (priorActualCount === 0 && variance) {
    (async () => {
      const locale = await notificationPrefs.getLocale(user.email);
      const localePrefix = locale === 'en' ? '' : '/' + locale;
      return welcome.sendFirstActualWelcomeIfFirst(user.email, {
        locale,
        planUrl: `${SITE_ORIGIN}/account/plans/`,
        wizardUrl: `${SITE_ORIGIN}${localePrefix}/start/`,
        prefsUrl: `${SITE_ORIGIN}/account/preferences/`,
        variance: {
          estimateEur: variance.estimateEur,
          actualEur: variance.actualEur,
          deltaPct: variance.deltaPct,
          direction: variance.direction,
        },
      });
    })().catch(() => { /* silent — celebration is non-load-bearing */ });
  }

  return jsonResponse(res, 200, { ok: true, plan: withActualVariance(updated) });
}

// DELETE /api/plans/<id>/actual — remove the actual (e.g. logged by mistake)
async function handleClearActual(req, res, user, planId) {
  const updated = await actuals.clearActual(planId, user.email);
  if (!updated) return jsonResponse(res, 404, { error: 'Plan not found' });
  try {
    await events.record('actual_cleared', { email: user.email, planId });
  } catch (_) {}
  return jsonResponse(res, 200, { ok: true, plan: withActualVariance(updated) });
}

// POST /api/plans/<id>/share — mint a share code (owner only).
//   Idempotent — re-calling returns the existing code rather than
//   minting a fresh one. The share URL the UI surfaces is built off
//   SITE_ORIGIN so the same code works locally + in production.
async function handleCreateShare(req, res, user, planId) {
  // Sprint first-share-welcome-v1 — count shares across the user's
  // plans BEFORE this call so we can detect the 0→1 transition. Counts
  // only plans where .share.code is already set; a re-call on the same
  // plan keeps priorShareCount ≥ 1, so the welcome doesn't re-fire on
  // an idempotent re-mint.
  let priorShareCount = 0;
  try {
    const allPlans = await savedPlans.listPlans(user.email);
    priorShareCount = allPlans.filter((p) => p && p.share && p.share.code).length;
  } catch (_) { /* listing failure shouldn't block the share mint */ }

  const share = await savedPlans.createShare(planId, user.email);
  if (!share) return jsonResponse(res, 404, { error: 'Plan not found' });

  // Fire-and-forget welcome on 0→1 transition. Locale + URLs come from
  // the same plumbing as first-plan-welcome + first-actual-welcome.
  // Nothing here can break the share mint — silent-fail caught with
  // .catch on the IIFE.
  if (priorShareCount === 0) {
    (async () => {
      const locale = await notificationPrefs.getLocale(user.email);
      const localePrefix = locale === 'en' ? '' : '/' + locale;
      const shareUrl = `${SITE_ORIGIN}/share/${share.code}`;
      return welcome.sendFirstShareWelcomeIfFirst(user.email, {
        locale,
        shareUrl,
        planUrl: `${SITE_ORIGIN}/account/plans/`,
        wizardUrl: `${SITE_ORIGIN}${localePrefix}/start/`,
        prefsUrl: `${SITE_ORIGIN}/account/preferences/`,
      });
    })().catch(() => { /* silent — share-welcome is non-load-bearing */ });
  }

  return jsonResponse(res, 200, { ok: true, share });
}

// DELETE /api/plans/<id>/share — revoke the share. The link returns
// 404 on subsequent opens; anyone who already followed it stays where
// they are (the redirected /start/?p=… URL still works because the
// inputs are encoded inline).
async function handleRevokeShare(req, res, user, planId) {
  const ok = await savedPlans.revokeShare(planId, user.email);
  if (!ok) return jsonResponse(res, 404, { error: 'No active share for this plan' });
  try {
    await events.record('plan_share_revoked', { email: user.email, planId });
  } catch (_) {}
  return jsonResponse(res, 200, { ok: true });
}

// GET /api/plans/<id>/reproduce  (Sprint reproducibility-v2 / apex III3)
//   The enterprise-trust answer to "is this quote still reproducible, and if
//   not, why?" Compares the data snapshot bound to the plan at save time
//   against today's market data:
//     • dataUnchanged → the numbers reproduce identically (recompute proves it).
//     • drifted       → returns exactly which money-driving values moved
//                       (FX rate, ETS price, AD/CVD rate, …) so the change is
//                       explainable, not mysterious.
//   The recomputed current totals are always returned for context.
async function handleReproduce(req, res, user, planId) {
  const record = await savedPlans.getPlan(planId, user.email);
  if (!record) return jsonResponse(res, 404, { error: 'Plan not found' });

  const current = dataSnapshot.currentDataSnapshot();
  const recomputed = await computeSnapshot(record.inputs); // current headline numbers
  const storedId = record.dataSnapshotId || null;

  const base = {
    ok: true,
    planId,
    storedSnapshotId: storedId,
    currentSnapshotId: current.id,
    recomputed,
  };

  // Plans saved before snapshot-binding shipped have no stored id.
  if (!storedId) {
    return jsonResponse(res, 200, {
      ...base,
      reproducible: false,
      status: 'no-snapshot-bound',
      message: 'This plan was saved before reproducibility binding; no data snapshot is recorded. Re-save it to bind one.',
    });
  }

  // Data unchanged since save → guaranteed identical reproduction.
  if (storedId === current.id) {
    return jsonResponse(res, 200, {
      ...base,
      reproducible: true,
      status: 'data-unchanged',
      dataUnchanged: true,
      message: 'The market data behind this plan is unchanged since it was saved — its numbers reproduce identically.',
    });
  }

  // Data drifted — report exactly what moved.
  const stored = await snapshotStore.getSnapshot(storedId);
  if (!stored || !stored.snapshot) {
    return jsonResponse(res, 200, {
      ...base,
      reproducible: false,
      status: 'drift-snapshot-unavailable',
      dataUnchanged: false,
      message: 'Market data has changed since save, but the original snapshot is no longer retrievable to itemise the drift.',
    });
  }

  const diff = dataSnapshot.diffDataSnapshots(stored.snapshot, current.snapshot);
  return jsonResponse(res, 200, {
    ...base,
    reproducible: false,
    status: 'data-drifted',
    dataUnchanged: false,
    drift: diff.changes,
    message: `Market data has changed since save (${diff.changes.length} value${diff.changes.length === 1 ? '' : 's'} moved). Recomputing today would differ; the original numbers remain reproducible from the stored snapshot.`,
  });
}

// ── Dispatcher ─────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  // Light rate limit on writes
  if (req.method === 'POST' || req.method === 'DELETE') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    const rate = await consumeRateLimit('plans-write', ip, 30, 60_000);
    if (rate.limited) {
      return jsonResponse(res, 429, { error: 'Too many requests. Please wait a moment.' });
    }
  }

  const user = requireAuth(req, res);
  if (!user) return; // 401 already sent

  // Resolve URL segments after /api/plans/
  let segments = [];
  if (req.query && req.query.path) {
    const arr = Array.isArray(req.query.path) ? req.query.path : String(req.query.path).split('/');
    segments = arr.slice(1).filter(Boolean);  // drop the leading 'plans'
  } else {
    const pathname = (req.url || '').split('?')[0];
    segments = pathname.replace(/^\/api\/plans\/?/, '').split('/').filter(Boolean);
  }
  const planId = segments[0] || '';
  const subResource = segments[1] || '';

  if (planId) {
    // /api/plans/<id>/actual  (Sprint BG-1.4)
    if (subResource === 'actual') {
      if (req.method === 'POST')   return handleSetActual(req, res, user, planId);
      if (req.method === 'DELETE') return handleClearActual(req, res, user, planId);
      return jsonResponse(res, 405, { error: 'Method not allowed' });
    }
    // /api/plans/<id>/share  (Sprint shares-v1)
    if (subResource === 'share') {
      if (req.method === 'POST')   return handleCreateShare(req, res, user, planId);
      if (req.method === 'DELETE') return handleRevokeShare(req, res, user, planId);
      return jsonResponse(res, 405, { error: 'Method not allowed' });
    }
    // /api/plans/<id>/reproduce  (Sprint reproducibility-v2 / apex III3)
    if (subResource === 'reproduce') {
      if (req.method === 'GET') return handleReproduce(req, res, user, planId);
      return jsonResponse(res, 405, { error: 'Method not allowed' });
    }
    // /api/plans/<id>
    if (req.method === 'GET')    return handleGet(req, res, user, planId);
    if (req.method === 'DELETE') return handleDelete(req, res, user, planId);
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  // /api/plans
  if (req.method === 'GET')  return handleList(req, res, user);
  if (req.method === 'POST') return handleSave(req, res, user);
  return jsonResponse(res, 405, { error: 'Method not allowed' });
};

module.exports.handleSave = handleSave;
module.exports.handleList = handleList;
module.exports.handleGet = handleGet;
module.exports.handleDelete = handleDelete;
module.exports.handleSetActual = handleSetActual;
module.exports.handleClearActual = handleClearActual;
module.exports.handleCreateShare = handleCreateShare;
module.exports.handleRevokeShare = handleRevokeShare;
module.exports.handleReproduce = handleReproduce;
module.exports.withActualVariance = withActualVariance;
