// Sprint account-overview-v1 — operations cockpit endpoint + UI.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
process.env.ORCATRADE_DISABLE_LIVE_TARIC = '1';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const accountHandler = require('../lib/handlers/account');
const auth = require('../lib/auth');
const kv = require('../lib/intelligence/kv-store');
const savedPlans = require('../lib/saved-plans');
const savedPortfolios = require('../lib/saved-portfolios');

function mockRes() {
  const res = {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    end(body) { this.body = body || ''; return this; },
  };
  return res;
}
function parse(res) { try { return JSON.parse(res.body); } catch (_) { return null; } }
function reqFor(email) {
  return { method: 'GET', headers: { cookie: 'orcatrade_session=' + encodeURIComponent(auth.buildSessionCookie(email)) }, query: { path: 'account/overview' } };
}

const planInput = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 50000, weightKg: 2000 };
const portfolioLines = [{ productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 50000, weightKg: 2000 }];
const portfolioSnapshot = { lineCount: 1, blendedDutyRatePct: 9, consolidationSavingEur: 0, totals: { perShipmentLandedTotal: 62000 } };

// ── Endpoint ────────────────────────────────────────────

test('overview: 401 when not signed in', async () => {
  kv._resetMemoryStore();
  const res = mockRes();
  await accountHandler({ method: 'GET', headers: {}, query: { path: 'account/overview' } }, res);
  assert.equal(res.statusCode, 401);
});

test('overview: empty footprint → zero counts', async () => {
  kv._resetMemoryStore();
  const res = mockRes();
  await accountHandler(reqFor('empty@example.com'), res);
  assert.equal(res.statusCode, 200);
  const body = parse(res);
  assert.equal(body.plans.count, 0);
  assert.equal(body.portfolios.count, 0);
  assert.deepEqual(body.plans.recent, []);
});

test('overview: counts + recent items for plans and portfolios (own only)', async () => {
  kv._resetMemoryStore();
  await savedPlans.savePlan({ email: 'me@example.com', inputs: planInput, label: 'CN apparel', snapshot: { perShipmentLandedTotal: 62000 } });
  await savedPortfolios.savePortfolio({ email: 'me@example.com', lines: portfolioLines, label: 'My cat', snapshot: portfolioSnapshot });
  // Another user's items must not appear.
  await savedPlans.savePlan({ email: 'other@example.com', inputs: planInput, label: 'Theirs', snapshot: { perShipmentLandedTotal: 1 } });

  const res = mockRes();
  await accountHandler(reqFor('me@example.com'), res);
  const body = parse(res);
  assert.equal(body.plans.count, 1);
  assert.equal(body.plans.recent[0].label, 'CN apparel');
  assert.equal(body.plans.recent[0].route, 'CN→PL');
  assert.equal(body.plans.recent[0].landedEur, 62000);
  assert.equal(body.portfolios.count, 1);
  assert.equal(body.portfolios.recent[0].label, 'My cat');
  assert.equal(body.portfolios.recent[0].skuCount, 1);
  // Onboarding summary present.
  assert.ok(body.onboarding && typeof body.onboarding.completed === 'number');
});

test('overview: recent lists cap at 3', async () => {
  kv._resetMemoryStore();
  for (let i = 0; i < 5; i++) {
    await savedPlans.savePlan({ email: 'many@example.com', inputs: planInput, label: 'P' + i, snapshot: { perShipmentLandedTotal: 1000 + i } });
  }
  const res = mockRes();
  await accountHandler(reqFor('many@example.com'), res);
  const body = parse(res);
  assert.equal(body.plans.count, 5);
  assert.equal(body.plans.recent.length, 3);
});

test('overview: response carries no other-user email (no PII leak)', async () => {
  kv._resetMemoryStore();
  await savedPlans.savePlan({ email: 'me@example.com', inputs: planInput, label: 'Mine', snapshot: { perShipmentLandedTotal: 1000 } });
  const res = mockRes();
  await accountHandler(reqFor('me@example.com'), res);
  // The summary should not echo the email at all.
  assert.ok(!/me@example\.com/.test(res.body));
});

// ── UI contract ─────────────────────────────────────────

test('/account/ has the overview card slot (hidden default) + JS wiring', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'index.html'), 'utf8');
  assert.match(html, /id="overview-card"/);
  assert.match(html, /id="overview-card"[^>]*\shidden/);
  assert.match(html, /\.overview-card/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'app.js'), 'utf8');
  assert.match(js, /\/api\/account\/overview/);
  assert.match(js, /function loadOverview/);
  assert.match(js, /function renderOverview/);
  // Loaded inside the auth-me success branch (not for signed-out visitors).
  assert.match(js, /loadOverview\(\);/);
});

// ── compliance snapshot on the overview ─────────────────

test('overview: carries a compliance snapshot (count + next) shape', async () => {
  kv._resetMemoryStore();
  await savedPlans.savePlan({ email: 'me@example.com', inputs: planInput });
  const res = mockRes();
  await accountHandler(reqFor('me@example.com'), res);
  const body = parse(res);
  assert.ok(body.compliance, 'compliance field present');
  assert.equal(typeof body.compliance.count, 'number');
  assert.ok(body.compliance.next === null || typeof body.compliance.next === 'object');
});

test('overview: a no-regime plan (apparel) yields zero deadlines', async () => {
  kv._resetMemoryStore();
  await savedPlans.savePlan({ email: 'me@example.com', inputs: planInput }); // apparel ex-CN
  const res = mockRes();
  await accountHandler(reqFor('me@example.com'), res);
  const body = parse(res);
  assert.equal(body.compliance.count, 0);
  assert.equal(body.compliance.next, null);
});

test('overview UI renders the next-deadline block', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'app.js'), 'utf8');
  assert.match(js, /data\.compliance/);
  assert.match(js, /Next compliance deadline/);
  assert.match(js, /\/account\/calendar\//);
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'index.html'), 'utf8');
  assert.match(html, /\.ov-deadline/);
});
