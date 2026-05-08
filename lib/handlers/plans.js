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
const planDiff = require('../plan-diff');
const startHandler = require('./start');
const { consumeRateLimit } = require('../intelligence/runtime-store');

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
function computeSnapshot(inputs) {
  try {
    const result = startHandler.composePlan(inputs);
    if (!result || !result.ok) return null;
    return planDiff.extractSnapshot(result);
  } catch (_err) {
    return null;
  }
}

// POST /api/plans  body: { inputs, label? }
async function handleSave(req, res, user) {
  const body = req.body || {};
  if (!body.inputs || typeof body.inputs !== 'object') {
    return jsonResponse(res, 400, { error: 'inputs object required' });
  }
  try {
    const snapshot = computeSnapshot(body.inputs);
    const record = await savedPlans.savePlan({
      email: user.email,
      inputs: body.inputs,
      label: body.label || '',
      snapshot,
    });
    return jsonResponse(res, 200, { ok: true, plan: record });
  } catch (err) {
    return jsonResponse(res, 400, { error: err.message || 'savePlan failed' });
  }
}

// GET /api/plans
async function handleList(req, res, user) {
  const records = await savedPlans.listPlans(user.email);
  const enriched = records.map(r => planDiff.enrichRecord(r, computeSnapshot(r.inputs)));
  return jsonResponse(res, 200, { ok: true, plans: enriched });
}

// GET /api/plans/<id>
async function handleGet(req, res, user, planId) {
  const record = await savedPlans.getPlan(planId, user.email);
  if (!record) return jsonResponse(res, 404, { error: 'Plan not found' });
  const enriched = planDiff.enrichRecord(record, computeSnapshot(record.inputs));
  return jsonResponse(res, 200, { ok: true, plan: enriched });
}

// DELETE /api/plans/<id>
async function handleDelete(req, res, user, planId) {
  const ok = await savedPlans.deletePlan(planId, user.email);
  if (!ok) return jsonResponse(res, 404, { error: 'Plan not found' });
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

  // Resolve the second URL segment (the plan ID, if any)
  let planId = '';
  if (req.query && req.query.path) {
    const arr = Array.isArray(req.query.path) ? req.query.path : String(req.query.path).split('/');
    planId = arr[1] || '';
  } else {
    const pathname = (req.url || '').split('?')[0];
    const segments = pathname.replace(/^\/api\/plans\/?/, '').split('/').filter(Boolean);
    planId = segments[0] || '';
  }

  if (planId) {
    // /api/plans/<id>
    if (req.method === 'GET') return handleGet(req, res, user, planId);
    if (req.method === 'DELETE') return handleDelete(req, res, user, planId);
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  // /api/plans
  if (req.method === 'GET') return handleList(req, res, user);
  if (req.method === 'POST') return handleSave(req, res, user);
  return jsonResponse(res, 405, { error: 'Method not allowed' });
};

module.exports.handleSave = handleSave;
module.exports.handleList = handleList;
module.exports.handleGet = handleGet;
module.exports.handleDelete = handleDelete;
