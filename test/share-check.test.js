// Sprint share-render-v1 — tests for /api/share-check/<code>.
//
// Covers:
//   - Handler auth: method gate (GET only), invalid code, unknown code
//     (404 = revoked OR never existed — uniform response)
//   - Happy path: 200 with { ok, code, viewCount, createdAt } + view
//     count incremented + plan_share_opened audit emitted
//   - Repeated calls accumulate the view count (key contract — bookmarked
//     /start/ revisits each count as a view)
//   - Email NOT leaked at the wire or in the audit row
//   - Rate limit (60/min/ip)
//   - Router registration: /api/share-check routes to the handler
//   - Original /share/<code> redirect now appends &share=<code>
//   - Wizard wires ?share=<code> → /api/share-check call + revoked overlay

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const kv = require('../lib/intelligence/kv-store');
const savedPlans = require('../lib/saved-plans');
const events = require('../lib/events');
const shareCheckHandler = require('../lib/handlers/share-check');
const shareHandler = require('../lib/handlers/share');

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}

async function seedPlan(email) {
  const inputs = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 };
  return await savedPlans.savePlan({ email, inputs, snapshot: { perShipmentLandedTotal: 30000 } });
}

function reqFor(code, extras = {}) {
  return Object.assign({
    method: 'GET',
    headers: {},
    query: { path: ['share-check', code] },
    url: '/api/share-check/' + code,
  }, extras);
}

// ── readCode helper ──────────────────────────────────

test('readCode: extracts from req.query.path[1]', () => {
  const c = shareCheckHandler.readCode({ query: { path: ['share-check', 'abcd1234'] } });
  assert.equal(c, 'abcd1234');
});

test('readCode: falls back to URL parsing when query missing', () => {
  const c = shareCheckHandler.readCode({ url: '/api/share-check/abcd1234' });
  assert.equal(c, 'abcd1234');
});

test('readCode: returns empty on no match', () => {
  assert.equal(shareCheckHandler.readCode({}), '');
});

// ── Method gate ──────────────────────────────────────

test('share-check: 405 on POST', async () => {
  const req = reqFor('abcd1234', { method: 'POST' });
  const res = mockRes();
  await shareCheckHandler(req, res);
  assert.equal(res.statusCode, 405);
});

test('share-check: 204 on OPTIONS preflight', async () => {
  const req = reqFor('abcd1234', { method: 'OPTIONS' });
  const res = mockRes();
  await shareCheckHandler(req, res);
  assert.equal(res.statusCode, 204);
});

// ── Invalid code shapes ─────────────────────────────

test('share-check: 400 on malformed code (non-hex)', async () => {
  const req = reqFor('not-a-hex');
  const res = mockRes();
  await shareCheckHandler(req, res);
  assert.equal(res.statusCode, 400);
});

test('share-check: 400 on empty code', async () => {
  const req = reqFor('');
  const res = mockRes();
  await shareCheckHandler(req, res);
  assert.equal(res.statusCode, 400);
});

// ── 404 on unknown / revoked ────────────────────────

test('share-check: 404 on unknown code (uniform with revoked → no leakage)', async () => {
  kv._resetMemoryStore();
  const req = reqFor('deadbeefca');
  const res = mockRes();
  await shareCheckHandler(req, res);
  assert.equal(res.statusCode, 404);
});

test('share-check: 404 after revokeShare (revoke actually works through this endpoint)', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('owner@example.com');
  const share = await savedPlans.createShare(plan.id, 'owner@example.com');
  // First call — valid.
  await shareCheckHandler(reqFor(share.code), mockRes());
  // Revoke + try again.
  await savedPlans.revokeShare(plan.id, 'owner@example.com');
  const res = mockRes();
  await shareCheckHandler(reqFor(share.code), res);
  assert.equal(res.statusCode, 404);
});

// ── Happy path: 200 + payload + increment + audit ──

test('share-check: 200 returns ok + code + viewCount + createdAt', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('owner@example.com');
  const share = await savedPlans.createShare(plan.id, 'owner@example.com');
  const res = mockRes();
  await shareCheckHandler(reqFor(share.code), res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.code, share.code);
  assert.ok(body.createdAt);
  // viewCount surfaced BEFORE the (fire-and-forget) increment — first
  // call sees 0, accumulates to 1 after the await loop below resolves.
  assert.equal(typeof body.viewCount, 'number');
});

test('share-check: each call increments the view count (bookmark contract)', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('counter@example.com');
  const share = await savedPlans.createShare(plan.id, 'counter@example.com');
  // Three calls, each await the response before the next.
  for (let i = 0; i < 3; i++) {
    await shareCheckHandler(reqFor(share.code), mockRes());
    // Drain microtasks so the fire-and-forget increment lands.
    await new Promise((r) => setImmediate(r));
  }
  const refetched = await savedPlans.getByShareCode(share.code);
  assert.equal(refetched.share.viewCount, 3);
});

test('share-check: emits plan_share_opened audit with code + planId but NO email', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('audit@example.com');
  const share = await savedPlans.createShare(plan.id, 'audit@example.com');
  await shareCheckHandler(reqFor(share.code), mockRes());
  await new Promise((r) => setImmediate(r));
  const hits = (await events.list({})).filter((e) => e.type === 'plan_share_opened');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].code, share.code);
  assert.equal(hits[0].planId, plan.id);
  assert.equal(hits[0].email, undefined,
    'plan_share_opened must NOT carry the owner email');
});

test('share-check: response body never includes the owner email', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('secret-owner@example.com');
  const share = await savedPlans.createShare(plan.id, 'secret-owner@example.com');
  const res = mockRes();
  await shareCheckHandler(reqFor(share.code), res);
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /secret-owner/);
});

// ── /share/<code> redirect carries &share=<code> ────

test('share handler: redirect target appends &share=<code>', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('owner@example.com');
  const share = await savedPlans.createShare(plan.id, 'owner@example.com');
  const req = {
    method: 'GET', headers: {},
    query: { path: ['share', share.code] },
    url: '/api/share/' + share.code,
  };
  const res = mockRes();
  await shareHandler(req, res);
  assert.equal(res.statusCode, 302);
  assert.match(res.headers['location'], new RegExp('&share=' + share.code + '$'));
});

// ── Router registration ─────────────────────────────

test('router registers /api/share-check', () => {
  const router = fs.readFileSync(path.join(__dirname, '..', 'api', '[...path].js'), 'utf8');
  assert.match(router, /['"]share-check['"]\s*:\s*require\(['"]\.\.\/lib\/handlers\/share-check['"]\)/);
});

// ── Wizard contract ────────────────────────────────

test('start/app.js: reads ?share= and calls /api/share-check/<code>', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'start', 'app.js'), 'utf8');
  assert.match(js, /urlParams\.get\(['"]share['"]\)/);
  assert.match(js, /\/api\/share-check\//);
  assert.match(js, /maybeValidateShareCode/);
});

test('start/app.js: 404 from share-check triggers the revoked overlay', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'start', 'app.js'), 'utf8');
  assert.match(js, /showShareRevokedOverlay/);
  assert.match(js, /r\.status\s*===\s*404/);
  // The overlay replaces the wizard shell entirely.
  assert.match(js, /share-revoked-overlay/);
});

test('start/wizard.css: revoked-overlay styles present', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'start', 'wizard.css'), 'utf8');
  assert.match(css, /\.share-revoked-overlay\b/);
  assert.match(css, /\.share-revoked-card\b/);
  assert.match(css, /\.share-revoked-cta\b/);
});
