// Sprint monitoring-v1 — GET/POST /api/account/alerts (the monitoring inbox
// API) + the /account/alerts/ UI contract.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const kv = require('../lib/intelligence/kv-store');
const alertStore = require('../lib/alert-store');
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

const USER = { email: 'alerts-api@example.com' };

async function seedAlert(overrides = {}) {
  return alertStore.recordAlert(Object.assign({
    email: USER.email,
    type: 'plan_cost_drift',
    severity: 'high',
    title: 'Landed cost up 9%',
    body: 'Duty rose.',
    entityType: 'plan',
    entityId: 'pl_1',
    dedupeKey: 'plan_cost_drift:pl_1',
    data: {},
  }, overrides));
}

test('GET /api/account/alerts returns the user\'s alerts + open count', async () => {
  kv._resetMemoryStore();
  await seedAlert();
  await seedAlert({ dedupeKey: 'fx_exposure:pl_1:TRY', type: 'fx_exposure', title: 'FX' });

  const res = mockRes();
  await accountHandler.handleAlerts({ method: 'GET', query: {} }, res, USER);
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.count, 2);
  assert.equal(payload.openCount, 2);
  assert.ok(payload.advisory);
});

test('GET filters by ?status', async () => {
  kv._resetMemoryStore();
  const { id } = await seedAlert();
  await seedAlert({ dedupeKey: 'k2', entityId: 'pl_2' });
  await alertStore.setStatus(id, USER.email, 'dismissed');

  const res = mockRes();
  await accountHandler.handleAlerts({ method: 'GET', query: { status: 'open' } }, res, USER);
  assert.equal(JSON.parse(res.body).count, 1);
});

test('POST markRead flips one alert', async () => {
  kv._resetMemoryStore();
  const { id } = await seedAlert();
  const res = mockRes();
  await accountHandler.handlePostAlerts({ method: 'POST', body: { action: 'markRead', id } }, res, USER);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).alert.status, 'read');
});

test('POST markAllRead clears the open count', async () => {
  kv._resetMemoryStore();
  await seedAlert();
  await seedAlert({ dedupeKey: 'k2', entityId: 'pl_2' });
  const res = mockRes();
  await accountHandler.handlePostAlerts({ method: 'POST', body: { action: 'markAllRead' } }, res, USER);
  assert.equal(JSON.parse(res.body).changed, 2);
  assert.equal(await alertStore.countOpen(USER.email), 0);
});

test('POST with a bad action is a 400; unknown id is a 404', async () => {
  kv._resetMemoryStore();
  const res1 = mockRes();
  await accountHandler.handlePostAlerts({ method: 'POST', body: { action: 'nope' } }, res1, USER);
  assert.equal(res1.statusCode, 400);

  const res2 = mockRes();
  await accountHandler.handlePostAlerts({ method: 'POST', body: { action: 'dismiss', id: 'al_nope' } }, res2, USER);
  assert.equal(res2.statusCode, 404);
});

// ── UI contract ─────────────────────────────────────────

test('/account/alerts/ page exists, noindex, fetches the alerts endpoint', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'alerts', 'index.html'), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex/i);
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'alerts', 'app.js'), 'utf8');
  assert.match(js, /fetch\(['"]\/api\/account\/alerts['"]/);
  assert.match(js, /credentials:\s*['"]same-origin['"]/);
});

test('/account/ quick-links includes the monitoring alerts page', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'index.html'), 'utf8');
  assert.match(html, /href=["']\/account\/alerts\/["']/);
  assert.match(html, /Monitoring alerts/i);
});
