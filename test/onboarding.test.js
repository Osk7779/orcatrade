// Sprint onboarding-v1 — Getting-started progress checklist.
//
// Layers:
//   1. lib/onboarding.js — pure getProgress(email) over existing KV
//   2. GET /api/account/onboarding — auth-gated handler
//   3. /account/ markup contract (card slot + JS renderer)

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auth = require('../lib/auth');
const onboarding = require('../lib/onboarding');
const savedPlans = require('../lib/saved-plans');
const orgs = require('../lib/orgs');
const actuals = require('../lib/actuals');
const kv = require('../lib/intelligence/kv-store');
const accountHandler = require('../lib/handlers/account');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(body) { this.body = body || ''; return this; },
  };
}

function reqWithCookie(method, email, extras = {}) {
  const cookie = auth.buildSessionCookie(email);
  return {
    method,
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
    body: {},
    ...extras,
  };
}

// ── STEPS contract ────────────────────────────────────

test('STEPS list is non-empty + every step has the required shape', () => {
  assert.ok(Array.isArray(onboarding.STEPS));
  assert.ok(onboarding.STEPS.length > 0);
  for (const s of onboarding.STEPS) {
    assert.equal(typeof s.key, 'string');
    assert.equal(typeof s.label, 'string');
    assert.equal(typeof s.cta, 'string');
    assert.equal(typeof s.href, 'string');
  }
});

test('STEPS includes the four moat-building actions', () => {
  const keys = onboarding.STEPS.map((s) => s.key);
  for (const k of ['planSaved', 'actualLogged', 'orgCreated', 'shareCreated']) {
    assert.ok(keys.includes(k), `${k} present in STEPS`);
  }
});

// ── getProgress ────────────────────────────────────────

test('getProgress: empty email → blank progress', async () => {
  kv._resetMemoryStore();
  const p = await onboarding.getProgress('');
  assert.equal(p.planSaved, false);
  assert.equal(p.actualLogged, false);
  assert.equal(p.orgCreated, false);
  assert.equal(p.shareCreated, false);
  assert.equal(p.completed, 0);
  assert.equal(p.allDone, false);
});

test('getProgress: brand-new user → all flags false', async () => {
  kv._resetMemoryStore();
  const p = await onboarding.getProgress('newbie@example.com');
  assert.equal(p.planSaved, false);
  assert.equal(p.actualLogged, false);
  assert.equal(p.orgCreated, false);
  assert.equal(p.shareCreated, false);
  assert.equal(p.completed, 0);
});

test('getProgress: planSaved=true after first savePlan', async () => {
  kv._resetMemoryStore();
  await savedPlans.savePlan({
    email: 'planner@example.com',
    inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000 },
    label: 'first plan',
    snapshot: { perShipmentLandedTotal: 30000, schemaVersion: 1 },
  });
  const p = await onboarding.getProgress('planner@example.com');
  assert.equal(p.planSaved, true);
  assert.equal(p.actualLogged, false);
  assert.equal(p.completed, 1);
  assert.equal(p.counts.plans, 1);
});

test('getProgress: actualLogged=true after logging an actual on any plan', async () => {
  kv._resetMemoryStore();
  const plan = await savedPlans.savePlan({
    email: 'logger@example.com',
    inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000 },
    label: 'with actual',
    snapshot: { perShipmentLandedTotal: 30000, schemaVersion: 1 },
  });
  await actuals.setActual(plan.id, 'logger@example.com', { landedEur: 31000 });
  const p = await onboarding.getProgress('logger@example.com');
  assert.equal(p.planSaved, true);
  assert.equal(p.actualLogged, true);
  assert.equal(p.completed, 2);
});

test('getProgress: orgCreated=true after createOrg', async () => {
  kv._resetMemoryStore();
  await orgs.createOrg({ name: 'Acme', ownerEmail: 'founder@example.com' });
  const p = await onboarding.getProgress('founder@example.com');
  assert.equal(p.orgCreated, true);
  assert.equal(p.counts.orgs, 1);
});

test('getProgress: shareCreated=true after createShare', async () => {
  kv._resetMemoryStore();
  const plan = await savedPlans.savePlan({
    email: 'sharer@example.com',
    inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000 },
    label: 'shared plan',
    snapshot: { perShipmentLandedTotal: 30000, schemaVersion: 1 },
  });
  await savedPlans.createShare(plan.id, 'sharer@example.com');
  const p = await onboarding.getProgress('sharer@example.com');
  assert.equal(p.shareCreated, true);
});

test('getProgress: allDone=true after completing every step', async () => {
  kv._resetMemoryStore();
  const e = 'power@example.com';
  // Step 1 + 2 + 4: save + actual + share on one plan
  const plan = await savedPlans.savePlan({
    email: e,
    inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000 },
    label: 'do-it-all',
    snapshot: { perShipmentLandedTotal: 30000, schemaVersion: 1 },
  });
  await actuals.setActual(plan.id, e, { landedEur: 31000 });
  await savedPlans.createShare(plan.id, e);
  // Step 3: create an org
  await orgs.createOrg({ name: 'PowerCo', ownerEmail: e });

  const p = await onboarding.getProgress(e);
  assert.equal(p.planSaved, true);
  assert.equal(p.actualLogged, true);
  assert.equal(p.orgCreated, true);
  assert.equal(p.shareCreated, true);
  assert.equal(p.completed, 4);
  assert.equal(p.allDone, true);
});

// ── nextStep ──────────────────────────────────────────

test('nextStep: returns null when allDone', () => {
  const p = onboarding.blankProgress();
  p.planSaved = true; p.actualLogged = true; p.orgCreated = true; p.shareCreated = true;
  p.completed = 4; p.allDone = true;
  assert.equal(onboarding.nextStep(p), null);
});

test('nextStep: returns first incomplete step in STEPS order', () => {
  // Brand-new user → planSaved is the first uncompleted step
  const blank = onboarding.blankProgress();
  assert.equal(onboarding.nextStep(blank).key, 'planSaved');
  // After saving a plan → actualLogged is next
  blank.planSaved = true; blank.completed = 1;
  assert.equal(onboarding.nextStep(blank).key, 'actualLogged');
  // After saving plan + logging actual → orgCreated is next
  blank.actualLogged = true; blank.completed = 2;
  assert.equal(onboarding.nextStep(blank).key, 'orgCreated');
});

test('nextStep: undefined/null progress → defaults to first step', () => {
  assert.equal(onboarding.nextStep(null).key, 'planSaved');
  assert.equal(onboarding.nextStep(undefined).key, 'planSaved');
});

// ── /api/account/onboarding handler ────────────────────

test('GET /api/account/onboarding: 401 without session', async () => {
  const req = {
    method: 'GET', headers: {},
    query: { path: ['account', 'onboarding'] },
    url: '/api/account/onboarding',
  };
  const res = mockRes();
  await accountHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test('GET /api/account/onboarding: returns progress + steps + nextStep', async () => {
  kv._resetMemoryStore();
  const req = reqWithCookie('GET', 'newbie@example.com', {
    query: { path: ['account', 'onboarding'] },
    url: '/api/account/onboarding',
  });
  const res = mockRes();
  await accountHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.progress.planSaved, false);
  assert.equal(body.progress.completed, 0);
  assert.ok(Array.isArray(body.steps));
  assert.equal(body.steps.length, onboarding.STEPS.length);
  assert.ok(body.nextStep);
  assert.equal(body.nextStep.key, 'planSaved');
});

test('GET /api/account/onboarding: reflects state changes from other handlers', async () => {
  kv._resetMemoryStore();
  // Save a plan via the storage layer (mimicking what handlePlanSave does)
  await savedPlans.savePlan({
    email: 'evolving@example.com',
    inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000 },
    label: 'first',
    snapshot: { perShipmentLandedTotal: 30000, schemaVersion: 1 },
  });
  const req = reqWithCookie('GET', 'evolving@example.com', {
    query: { path: ['account', 'onboarding'] },
    url: '/api/account/onboarding',
  });
  const res = mockRes();
  await accountHandler(req, res);
  const body = JSON.parse(res.body);
  assert.equal(body.progress.planSaved, true);
  assert.equal(body.progress.completed, 1);
  // nextStep advances to the next incomplete one.
  assert.equal(body.nextStep.key, 'actualLogged');
});

// ── /account/ markup contract ──────────────────────────

test('/account/index.html includes the onboarding-card slot (hidden by default)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'index.html'), 'utf8');
  assert.match(html, /id=["']onboarding-card["']/);
  assert.match(html, /id=["']onboarding-card["'][^>]*hidden/);
});

test('/account/app.js fetches /api/account/onboarding + renders the card', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'app.js'), 'utf8');
  assert.match(js, /fetch\(['"]\/api\/account\/onboarding['"]/);
  assert.match(js, /function renderOnboarding/);
  // The renderer hides the card when allDone (avoid clutter).
  assert.match(js, /p\.allDone/);
});

test('/account/app.js loads onboarding only AFTER successful auth-me', () => {
  // The render call must happen inside the .then() of /api/auth/me,
  // not on cold page load — otherwise a signed-out visitor would
  // hit /api/account/onboarding and get a 401 (visible in the
  // network tab + Sentry).
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'app.js'), 'utf8');
  // Find the position of "loadOnboarding()" call AND the auth-me block.
  // We assert loadOnboarding is referenced inside the auth-me promise chain.
  assert.match(js, /showState\(['"]signedin['"]\);\s*\n[\s\S]{0,800}?loadOnboarding\(\)/);
});

// ── Sprint admin-session-auth: /account/ admin card ──

test('/account/index.html declares the admin-card slot (hidden by default)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'index.html'), 'utf8');
  assert.match(html, /id=["']admin-card["']/);
  assert.match(html, /id=["']admin-card["'][^>]*hidden/);
  // The card links to all five admin dashboards.
  for (const dashboard of ['/dashboard/leads/', '/dashboard/calibration/', '/dashboard/orgs/', '/dashboard/audit/', '/dashboard/ai/']) {
    assert.match(html, new RegExp(`href=["']${dashboard.replace(/\//g, '\\/')}["']`), 'admin card links to ' + dashboard);
  }
});

test('/account/app.js reveals admin-card only when /api/auth/me returns isAdmin', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'app.js'), 'utf8');
  // The check happens inside the auth-me .then() — same gating pattern
  // as loadOnboarding(). Drift here would expose admin links to every
  // signed-in user.
  assert.match(js, /data\.isAdmin/);
  assert.match(js, /getElementById\(['"]admin-card['"]\)/);
  // Set .hidden = false, not removed — keeps the DOM structure consistent.
  assert.match(js, /adminCard\.hidden\s*=\s*false/);
});

// ── Module surface ────────────────────────────────────

test('lib/onboarding exports the v1 surface', () => {
  for (const name of ['STEPS', 'getProgress', 'blankProgress', 'nextStep']) {
    assert.ok(onboarding[name], `${name} exported`);
  }
});
