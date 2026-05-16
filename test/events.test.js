// Events log + leads-handler tests (Sprint 36).

const test = require('node:test');
const assert = require('node:assert/strict');

// Pin secret + run KV in memory mode
process.env.ORCATRADE_LEADS_TOKEN = 'test-leads-token';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const kv = require('../lib/intelligence/kv-store');
const events = require('../lib/events');
const leadsHandler = require('../lib/handlers/leads');

// ── lib/events.js primitives ──────────────────────────

test('record: stores event under EVENT_LOG_KEY', async () => {
  kv._resetMemoryStore();
  const ok = await events.record('import_plan_generated', {
    locale: 'en',
    inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL' },
    landedTotal: 28000,
    emailProvided: true,
  });
  assert.equal(ok, true);
  const log = await events.list({});
  assert.equal(log.length, 1);
  assert.equal(log[0].type, 'import_plan_generated');
  assert.equal(log[0].locale, 'en');
});

test('record: rejects unknown event types', async () => {
  kv._resetMemoryStore();
  const ok = await events.record('not_a_real_type', {});
  assert.equal(ok, false);
});

test('record: prepends — newest first', async () => {
  kv._resetMemoryStore();
  await events.record('import_plan_generated', { inputs: { productCategory: 'A' } });
  await events.record('import_plan_generated', { inputs: { productCategory: 'B' } });
  await events.record('import_plan_generated', { inputs: { productCategory: 'C' } });
  const log = await events.list({});
  assert.deepEqual(log.map(e => e.inputs.productCategory), ['C', 'B', 'A']);
});

test('record: caps at MAX_EVENTS', async () => {
  kv._resetMemoryStore();
  // Stub list with one above-cap item to validate cap logic without 5k inserts
  const oversized = Array.from({ length: events.MAX_EVENTS + 10 }, (_, i) => ({
    type: 'import_plan_generated', at: new Date().toISOString(), idx: i,
  }));
  await kv.set(events.EVENT_LOG_KEY, oversized);
  await events.record('import_plan_generated', { inputs: { productCategory: 'NEW' } });
  const log = await events.list({ limit: events.MAX_EVENTS });
  assert.equal(log.length, events.MAX_EVENTS);
  // Newest is at index 0
  assert.equal(log[0].inputs.productCategory, 'NEW');
});

test('list: filters by type', async () => {
  kv._resetMemoryStore();
  await events.record('import_plan_generated', { inputs: { productCategory: 'apparel' } });
  await events.record('plan_saved', { inputs: { productCategory: 'electronics' } });
  const planned = await events.list({ type: 'import_plan_generated' });
  const saved = await events.list({ type: 'plan_saved' });
  assert.equal(planned.length, 1);
  assert.equal(saved.length, 1);
  assert.equal(planned[0].inputs.productCategory, 'apparel');
  assert.equal(saved[0].inputs.productCategory, 'electronics');
});

test('list: filters by since timestamp', async () => {
  kv._resetMemoryStore();
  // Manually seed two events with different times
  const old = { type: 'import_plan_generated', at: '2025-01-01T00:00:00Z', inputs: {} };
  const recent = { type: 'import_plan_generated', at: new Date().toISOString(), inputs: {} };
  await kv.set(events.EVENT_LOG_KEY, [recent, old]);
  const log = await events.list({ since: '2026-01-01' });
  assert.equal(log.length, 1);
  assert.equal(log[0].at, recent.at);
});

// ── aggregate ────────────────────────────────────────

test('aggregate: empty input yields zero summary', () => {
  const s = events.aggregate([]);
  assert.equal(s.total, 0);
  assert.equal(s.meanLandedEur, null);
  assert.deepEqual(s.byCategory, []);
});

test('aggregate: counts categories, origins, routes, locales', () => {
  const log = [
    { type: 'import_plan_generated', at: '2026-05-08T10:00:00Z', locale: 'en',
      inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL' }, landedTotal: 28000, emailProvided: true },
    { type: 'import_plan_generated', at: '2026-05-08T11:00:00Z', locale: 'en',
      inputs: { productCategory: 'apparel', originCountry: 'VN', destinationCountry: 'PL' }, landedTotal: 22000, emailProvided: false },
    { type: 'import_plan_generated', at: '2026-05-08T12:00:00Z', locale: 'pl',
      inputs: { productCategory: 'electronics', originCountry: 'CN', destinationCountry: 'DE' }, landedTotal: 50000, emailProvided: true },
  ];
  const s = events.aggregate(log);
  assert.equal(s.total, 3);
  assert.equal(s.byCategory.find(c => c.key === 'apparel').count, 2);
  assert.equal(s.byOrigin.find(c => c.key === 'CN').count, 2);
  assert.equal(s.topRoutes.find(c => c.key === 'CN→PL').count, 1);
  assert.equal(s.byLocale.find(c => c.key === 'en').count, 2);
  assert.equal(s.emailCaptured, 2);
  assert.equal(s.emailCaptureRate, 66.7);
  assert.equal(s.meanLandedEur, Math.round((28000 + 22000 + 50000) / 3));
  // recent[0] is newest first (mirroring stored order)
  assert.equal(s.recent.length, 3);
});

test('aggregate: ignores invalid landed totals', () => {
  const log = [
    { type: 'import_plan_generated', at: '2026-05-08T10:00:00Z', inputs: { productCategory: 'A' }, landedTotal: NaN },
    { type: 'import_plan_generated', at: '2026-05-08T11:00:00Z', inputs: { productCategory: 'A' }, landedTotal: 10000 },
  ];
  const s = events.aggregate(log);
  assert.equal(s.meanLandedEur, 10000); // Only the valid total counted
});

// ── Sprint G: HS code engagement ─────────────────────

test('aggregate: counts hsCodeProvided + provided-rate against plan events only', () => {
  const log = [
    { type: 'import_plan_generated', at: '2026-05-16T09:00:00Z', hsCodeProvided: true,  dutyMfnSource: 'UK Trade Tariff' },
    { type: 'import_plan_generated', at: '2026-05-16T09:01:00Z', hsCodeProvided: false, dutyMfnSource: 'chapter-estimator' },
    { type: 'import_plan_generated', at: '2026-05-16T09:02:00Z', hsCodeProvided: true,  dutyMfnSource: 'UK Trade Tariff' },
    { type: 'import_plan_generated', at: '2026-05-16T09:03:00Z', hsCodeProvided: false, dutyMfnSource: 'chapter-estimator' },
    // plan_saved should NOT affect the rate denominator
    { type: 'plan_saved', at: '2026-05-16T09:04:00Z', hsCodeProvided: false },
  ];
  const s = events.aggregate(log);
  assert.equal(s.hsCodeProvided, 2);
  assert.equal(s.hsCodeProvidedRate, 50);              // 2 of 4 plan events
  assert.equal(s.byDutyMfnSource.length, 2);
  const labels = s.byDutyMfnSource.map(r => r.key).sort();
  assert.deepEqual(labels, ['UK Trade Tariff', 'chapter-estimator']);
});

test('aggregate: missing hsCodeProvided is treated as false', () => {
  const log = [
    { type: 'import_plan_generated', at: '2026-05-16T09:00:00Z' },             // legacy event, no hs fields
    { type: 'import_plan_generated', at: '2026-05-16T09:01:00Z', hsCodeProvided: true, dutyMfnSource: 'UK Trade Tariff' },
  ];
  const s = events.aggregate(log);
  assert.equal(s.hsCodeProvided, 1);
  assert.equal(s.hsCodeProvidedRate, 50);
});

test('aggregate: empty input returns hs-code zeros (no NaN)', () => {
  const s = events.aggregate([]);
  assert.equal(s.hsCodeProvided, 0);
  assert.equal(s.hsCodeProvidedRate, 0);
  assert.deepEqual(s.byDutyMfnSource, []);
});

// ── /api/leads handler ───────────────────────────────

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}

test('handler: 401 when token missing', async () => {
  kv._resetMemoryStore();
  const req = { method: 'GET', headers: {}, url: '/api/leads', query: {} };
  const res = mockRes();
  await leadsHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test('handler: 401 when token wrong', async () => {
  kv._resetMemoryStore();
  const req = { method: 'GET', headers: {}, url: '/api/leads?token=wrong', query: { token: 'wrong' } };
  const res = mockRes();
  await leadsHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test('handler: 503 when ORCATRADE_LEADS_TOKEN env not set', async () => {
  kv._resetMemoryStore();
  const saved = process.env.ORCATRADE_LEADS_TOKEN;
  delete process.env.ORCATRADE_LEADS_TOKEN;
  const req = { method: 'GET', headers: {}, url: '/api/leads?token=x', query: { token: 'x' } };
  const res = mockRes();
  await leadsHandler(req, res);
  assert.equal(res.statusCode, 503);
  process.env.ORCATRADE_LEADS_TOKEN = saved;
});

test('handler: 200 with summary when token correct', async () => {
  kv._resetMemoryStore();
  await events.record('import_plan_generated', {
    locale: 'en',
    inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL' },
    landedTotal: 28000, emailProvided: true,
  });
  const req = {
    method: 'GET',
    headers: {},
    url: '/api/leads?token=test-leads-token',
    query: { token: 'test-leads-token' },
  };
  const res = mockRes();
  await leadsHandler(req, res);
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.ok, true);
  assert.equal(json.summary.total, 1);
  assert.equal(json.summary.byCategory[0].key, 'apparel');
});

test('handler: 405 on non-GET', async () => {
  kv._resetMemoryStore();
  const req = { method: 'POST', headers: {}, url: '/api/leads?token=test-leads-token', query: { token: 'test-leads-token' } };
  const res = mockRes();
  await leadsHandler(req, res);
  assert.equal(res.statusCode, 405);
});

// ── Static + dispatcher wiring ───────────────────────

test('/dashboard/leads/ page exists', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard/leads/index.html'), 'utf8');
  assert.match(html, /Conversion analytics/);
  assert.match(html, /id="token-form"/);
  assert.match(html, /id="dashboard"/);
});

test('/dashboard/leads/app.js fetches /api/leads', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', 'dashboard/leads/app.js'), 'utf8');
  assert.match(js, /fetch\('\/api\/leads/);
});

test('api/[...path].js dispatcher registers leads handler', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dispatcher = fs.readFileSync(path.join(__dirname, '..', 'api/[...path].js'), 'utf8');
  assert.match(dispatcher, /leads: require\('\.\.\/lib\/handlers\/leads'\)/);
});
