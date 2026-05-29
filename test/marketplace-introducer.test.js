// Trade-finance / insurance introducer (apex II7) — handler + event tests.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const kv = require('../lib/intelligence/kv-store');
const auth = require('../lib/auth');
const events = require('../lib/events');
const marketplaceHandler = require('../lib/handlers/marketplace');
const { listProviders, getProvider, PROVIDERS, PRODUCTS } = require('../lib/intelligence/marketplace-providers');

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}
function authedReq(method, body, query) {
  const cookie = auth.buildSessionCookie('me@acme.test');
  return { method, body, query: query || {}, headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) } };
}
async function call(req) { const res = mockRes(); await marketplaceHandler(req, res); return res; }

// ── provider catalog ────────────────────────────────────

test('PROVIDERS catalog covers LC, SCF, TCI, INVOICE and CARGO', () => {
  const products = new Set(PROVIDERS.flatMap((p) => p.products));
  for (const p of [PRODUCTS.LC, PRODUCTS.SCF, PRODUCTS.TCI, PRODUCTS.INVOICE, PRODUCTS.CARGO]) {
    assert.ok(products.has(p), `at least one provider should cover ${p}`);
  }
});

test('listProviders filters by product + region', () => {
  const lc = listProviders({ product: 'lc' });
  assert.ok(lc.length >= 1);
  for (const p of lc) assert.ok(p.products.includes('lc'));
  const eu = listProviders({ region: 'EU' });
  assert.ok(eu.length >= 1);
  for (const p of eu) assert.ok(/EU/i.test(p.region));
});

// ── handler ────────────────────────────────────────────

test('GET /api/marketplace returns providers + disclaimer (no auth)', async () => {
  const res = await call({ method: 'GET', headers: {}, query: { path: ['marketplace'] } });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.providers) && body.providers.length >= 5);
  assert.match(body.disclaimer, /introducer/);
});

test('GET /api/marketplace?product=lc filters server-side', async () => {
  const res = await call({ method: 'GET', headers: {}, query: { path: ['marketplace'], product: 'lc' } });
  const body = JSON.parse(res.body);
  for (const p of body.providers) assert.ok(p.products.includes('lc'));
});

test('POST /api/marketplace/intro without a session → 401', async () => {
  const res = await call({ method: 'POST', headers: {}, query: { path: ['marketplace', 'intro'] }, body: { providerId: PROVIDERS[0].id } });
  assert.equal(res.statusCode, 401);
});

test('POST /api/marketplace/intro records an audit event + returns contact', async () => {
  kv._resetMemoryStore();
  const target = PROVIDERS[0];
  const res = await call({ ...authedReq('POST', { providerId: target.id, note: 'Q3 imports' }), query: { path: ['marketplace', 'intro'] } });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.provider.id, target.id);
  assert.equal(body.provider.introContact, target.introContact);
  // audit row present
  const all = await events.list({ limit: 50 });
  const hit = all.find((e) => e.type === 'marketplace_intro_requested' && e.providerId === target.id);
  assert.ok(hit, 'marketplace_intro_requested event recorded');
  assert.equal(hit.takeRatePct, target.takeRatePct);
});

test('POST /api/marketplace/intro with an unknown providerId → 404', async () => {
  const res = await call({ ...authedReq('POST', { providerId: 'no-such-thing' }), query: { path: ['marketplace', 'intro'] } });
  assert.equal(res.statusCode, 404);
});
