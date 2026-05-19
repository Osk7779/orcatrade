// /api/wizard-event — Sprint wizard-step-funnel-v1.
//
// Records per-step funnel events the wizard fires as the user clicks
// Next / Back / Submit. No auth, no PII — just { step, action, locale }
// so we can compute "how many users reached step 4?" without traffic
// analytics tools.
//
// Rate limited 120/min/IP (each user fires up to ~12 events through a
// full round-trip, so the cap accommodates Forward+Back navigation
// without burning the budget).
//
//   POST /api/wizard-event
//   Body: { step: 1-6, action: 'next' | 'back' | 'submit', locale: 'en'|'pl'|'de' }
//   200: { ok: true } (or just 204 to avoid response overhead)
//   400: invalid step or action
//   429: rate-limited

'use strict';

const events = require('../events');
const { consumeRateLimit } = require('../intelligence/runtime-store');
const log = require('../log').withContext({ handler: 'wizard-event' });

const ALLOWED_ACTIONS = new Set(['next', 'back', 'submit', 'entered']);
const ALLOWED_LOCALES = new Set(['en', 'pl', 'de']);
const MIN_STEP = 1;
const MAX_STEP = 6;

function jsonResponse(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

function normaliseLocale(l) {
  const v = String(l || '').toLowerCase().trim();
  return ALLOWED_LOCALES.has(v) ? v : 'en';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || 'unknown';
  const rate = await consumeRateLimit('wizard-event', ip, 120, 60_000);
  if (rate.limited) {
    return jsonResponse(res, 429, { error: 'Too many requests' });
  }

  const body = req.body || {};
  const step = Number(body.step);
  if (!Number.isInteger(step) || step < MIN_STEP || step > MAX_STEP) {
    return jsonResponse(res, 400, { error: 'step required (1-' + MAX_STEP + ')' });
  }
  const action = String(body.action || '').toLowerCase();
  if (!ALLOWED_ACTIONS.has(action)) {
    return jsonResponse(res, 400, {
      error: 'action required (one of: ' + [...ALLOWED_ACTIONS].join(', ') + ')',
    });
  }
  const locale = normaliseLocale(body.locale);

  // Fire-and-forget so a slow KV write doesn't delay the user's next
  // step. Failure is silently dropped — telemetry must never break a
  // user flow.
  events.record('wizard_step_completed', {
    step,
    action,
    locale,
  }).catch(() => { /* tolerable */ });

  log.info('wizard step', { step, action, locale, ip: ip === 'unknown' ? null : ip });

  return jsonResponse(res, 200, { ok: true });
};

// Test surface
module.exports.ALLOWED_ACTIONS = ALLOWED_ACTIONS;
module.exports.ALLOWED_LOCALES = ALLOWED_LOCALES;
module.exports.MIN_STEP = MIN_STEP;
module.exports.MAX_STEP = MAX_STEP;
