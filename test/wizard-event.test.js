// Sprint wizard-step-funnel-v1 — tests.
//
// Covers:
//   - /api/wizard-event handler: method gate (POST only / 204 on OPTIONS
//     / 405 on GET), step validation (1-6, integer), action validation
//     (next/back/submit/entered), locale fallback to en, rate-limit
//     (429 after 120/min/IP)
//   - events.record: writes a wizard_step_completed row with the right
//     payload shape and no PII
//   - events.ALLOWED_TYPES: wizard_step_completed included
//   - aggregator: counts events per (step, action), totals, empty case
//   - /dashboard/leads/ contract: funnel panel slot present + JS hook
//   - /api/wizard-event registered in the router
//   - start/app.js fires fireWizardStep on next/back/submit

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const kv = require('../lib/intelligence/kv-store');
const events = require('../lib/events');
const wizardEventHandler = require('../lib/handlers/wizard-event');

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}
function reqFor(body, extras = {}) {
  return Object.assign({
    method: 'POST',
    url: '/api/wizard-event',
    headers: {},
    body,
  }, extras);
}

// ── ALLOWED_TYPES surface ─────────────────────────────

test('events.ALLOWED_TYPES contains wizard_step_completed', () => {
  assert.ok(events.ALLOWED_TYPES.has('wizard_step_completed'));
});

// ── Method gate ──────────────────────────────────────

test('wizard-event: 405 on GET', async () => {
  const req = reqFor({ step: 1, action: 'next' }, { method: 'GET' });
  const res = mockRes();
  await wizardEventHandler(req, res);
  assert.equal(res.statusCode, 405);
});

test('wizard-event: 204 on OPTIONS (CORS preflight)', async () => {
  const req = reqFor({}, { method: 'OPTIONS' });
  const res = mockRes();
  await wizardEventHandler(req, res);
  assert.equal(res.statusCode, 204);
});

// ── Validation ───────────────────────────────────────

test('wizard-event: 400 when step is missing', async () => {
  kv._resetMemoryStore();
  const req = reqFor({ action: 'next' });
  const res = mockRes();
  await wizardEventHandler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /step/);
});

test('wizard-event: 400 when step is out of range', async () => {
  kv._resetMemoryStore();
  for (const bad of [0, 7, 100, -1, 1.5, 'one']) {
    const req = reqFor({ step: bad, action: 'next' });
    const res = mockRes();
    await wizardEventHandler(req, res);
    assert.equal(res.statusCode, 400, 'step=' + bad + ' should 400');
  }
});

test('wizard-event: 400 when action is unknown', async () => {
  kv._resetMemoryStore();
  const req = reqFor({ step: 3, action: 'teleport' });
  const res = mockRes();
  await wizardEventHandler(req, res);
  assert.equal(res.statusCode, 400);
});

test('wizard-event: locale falls back to en on unknown', async () => {
  kv._resetMemoryStore();
  const req = reqFor({ step: 1, action: 'next', locale: 'fr' });
  const res = mockRes();
  await wizardEventHandler(req, res);
  assert.equal(res.statusCode, 200);
  // Drain the fire-and-forget events.record call.
  await new Promise((r) => setImmediate(r));
  const log = await events.list({ type: 'wizard_step_completed' });
  assert.equal(log.length, 1);
  assert.equal(log[0].locale, 'en');
});

// ── Happy paths ──────────────────────────────────────

test('wizard-event: 200 + records wizard_step_completed with payload + no PII', async () => {
  kv._resetMemoryStore();
  const req = reqFor({ step: 4, action: 'next', locale: 'pl' });
  const res = mockRes();
  await wizardEventHandler(req, res);
  assert.equal(res.statusCode, 200);
  await new Promise((r) => setImmediate(r));
  const log = await events.list({ type: 'wizard_step_completed' });
  assert.equal(log.length, 1);
  const e = log[0];
  assert.equal(e.step, 4);
  assert.equal(e.action, 'next');
  assert.equal(e.locale, 'pl');
  // No PII — endpoint receives no email, never persists one.
  assert.equal(e.email, undefined);
});

test('wizard-event: each allowed action persists with its label', async () => {
  kv._resetMemoryStore();
  for (const action of ['next', 'back', 'submit', 'entered']) {
    const res = mockRes();
    await wizardEventHandler(reqFor({ step: 2, action, locale: 'en' }), res);
    assert.equal(res.statusCode, 200, 'action=' + action + ' should 200');
  }
  await new Promise((r) => setImmediate(r));
  const log = await events.list({ type: 'wizard_step_completed' });
  const actions = log.map((e) => e.action).sort();
  assert.deepEqual(actions, ['back', 'entered', 'next', 'submit']);
});

// ── Rate limit ────────────────────────────────────────

test('wizard-event: 429 after 120 events from the same IP within a minute', async () => {
  kv._resetMemoryStore();
  let firstLimitedStatus = null;
  let countSent = 0;
  for (let i = 0; i < 125; i++) {
    const req = reqFor({ step: 1, action: 'next' }, { headers: { 'x-forwarded-for': '5.5.5.5' } });
    const res = mockRes();
    await wizardEventHandler(req, res);
    if (res.statusCode === 429 && firstLimitedStatus === null) {
      firstLimitedStatus = i;
    }
    if (res.statusCode === 200) countSent++;
  }
  // The rate limit should kick in before 125 succeed.
  assert.ok(firstLimitedStatus !== null, 'a 429 should fire within 125 attempts');
  assert.ok(countSent <= 120, 'at most 120 should pass through (got ' + countSent + ')');
});

// ── Aggregator ────────────────────────────────────────

test('aggregator: wizardFunnel zero-state on empty input', () => {
  const agg = events.aggregate([]);
  assert.ok(agg.wizardFunnel);
  assert.deepEqual(agg.wizardFunnel.byStep, []);
  assert.equal(agg.wizardFunnel.totalNext, 0);
  assert.equal(agg.wizardFunnel.totalSubmit, 0);
});

test('aggregator: wizardFunnel counts events per (step, action)', () => {
  const now = new Date().toISOString();
  const log = [
    { type: 'wizard_step_completed', step: 1, action: 'next', at: now },
    { type: 'wizard_step_completed', step: 1, action: 'next', at: now },
    { type: 'wizard_step_completed', step: 2, action: 'next', at: now },
    { type: 'wizard_step_completed', step: 2, action: 'back', at: now },
    { type: 'wizard_step_completed', step: 6, action: 'submit', at: now },
    // Non-wizard events should be ignored by the funnel.
    { type: 'plan_saved', at: now },
    // Malformed wizard events (bad step) should be ignored too.
    { type: 'wizard_step_completed', step: 99, action: 'next', at: now },
  ];
  const agg = events.aggregate(log);
  const f = agg.wizardFunnel;
  assert.equal(f.byStep.length, 6);
  assert.equal(f.byStep[0].next, 2);  // step 1 next x2
  assert.equal(f.byStep[0].total, 2);
  assert.equal(f.byStep[1].next, 1);  // step 2 next x1
  assert.equal(f.byStep[1].back, 1);  // step 2 back x1
  assert.equal(f.byStep[1].total, 2);
  assert.equal(f.byStep[5].submit, 1); // step 6 submit x1
  assert.equal(f.byStep[5].total, 1);
  // Totals match.
  assert.equal(f.totalNext, 3);
  assert.equal(f.totalBack, 1);
  assert.equal(f.totalSubmit, 1);
});

// ── Router registration ──────────────────────────────

test('router registers /api/wizard-event', () => {
  const router = fs.readFileSync(path.join(__dirname, '..', 'api', '[...path].js'), 'utf8');
  assert.match(router, /['"]wizard-event['"]\s*:\s*require\(['"]\.\.\/lib\/handlers\/wizard-event['"]\)/);
});

// ── start/app.js fires fireWizardStep ────────────────

test('start/app.js: fireWizardStep helper present + fires on next/back/submit', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'start', 'app.js'), 'utf8');
  assert.match(js, /function fireWizardStep\b/);
  assert.match(js, /\/api\/wizard-event/);
  // Wired into each transition.
  assert.match(js, /fireWizardStep\(cur, ['"]next['"]\)/);
  assert.match(js, /fireWizardStep\(cur, ['"]back['"]\)/);
  assert.match(js, /fireWizardStep\(TOTAL_STEPS, ['"]submit['"]\)/);
  // keepalive set so the submit event survives the page nav.
  assert.match(js, /keepalive:\s*true/);
});

// ── /dashboard/leads/ contract ───────────────────────

test('/dashboard/leads/index.html: wizard-funnel panel slot present + hidden default', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'leads', 'index.html'), 'utf8');
  assert.match(html, /id=["']wizard-funnel-panel["']/);
  assert.match(html, /id=["']wizard-funnel-panel["'][^>]*hidden/);
  assert.match(html, /id=["']wizard-funnel["']/);
});

test('/dashboard/leads/app.js: renderWizardFunnel reads s.wizardFunnel', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'leads', 'app.js'), 'utf8');
  assert.match(js, /renderWizardFunnel\b/);
  assert.match(js, /s\.wizardFunnel/);
  assert.match(js, /wizardFunnelPanel/);
});

// ── Module surface ───────────────────────────────────

test('wizard-event handler exposes constants', () => {
  assert.ok(wizardEventHandler.ALLOWED_ACTIONS instanceof Set);
  assert.equal(wizardEventHandler.MIN_STEP, 1);
  assert.equal(wizardEventHandler.MAX_STEP, 6);
});
