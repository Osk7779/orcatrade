// /api/plans/* — saved-plan CRUD for signed-in users.
//
// Sub-actions resolved from URL path:
//   POST   /api/plans                 → save a plan (body: {inputs, label?})
//   GET    /api/plans                 → list user's plans
//   GET    /api/plans/<id>            → get a single plan (ownership-checked)
//   DELETE /api/plans/<id>            → delete a plan (ownership-checked)
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
  const share = await savedPlans.createShare(planId, user.email);
  if (!share) return jsonResponse(res, 404, { error: 'Plan not found' });
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
module.exports.withActualVariance = withActualVariance;
