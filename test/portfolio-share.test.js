// Sprint portfolio-v1 (phase 4) — shareable portfolios (public read-only).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
process.env.ORCATRADE_DISABLE_LIVE_TARIC = '1';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const sp = require('../lib/saved-portfolios');
const auth = require('../lib/auth');
const kv = require('../lib/intelligence/kv-store');
const events = require('../lib/events');
const portfolioHandler = require('../lib/handlers/portfolio');

function mockRes() {
  const res = {
    statusCode: 200, headers: {}, body: '', _json: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this._json = obj; this.body = JSON.stringify(obj); return this; },
    end(body) { this.body = body || ''; return this; },
  };
  return res;
}
function parse(res) { try { return res._json || JSON.parse(res.body); } catch (_) { return null; } }
function cookieFor(email) { return 'orcatrade_session=' + encodeURIComponent(auth.buildSessionCookie(email)); }

const lines = [
  { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 50000, weightKg: 2000 },
];

// ── Share helpers ───────────────────────────────────────

test('createShare mints a 10-hex code + getByShareCode resolves it (email stripped)', async () => {
  kv._resetMemoryStore();
  const rec = await sp.savePortfolio({ email: 'owner@example.com', lines, label: 'Catalogue' });
  const share = await sp.createShare(rec.id, 'owner@example.com');
  assert.match(share.code, /^[a-f0-9]{10}$/);
  const resolved = await sp.getByShareCode(share.code);
  assert.ok(resolved);
  assert.equal(resolved.label, 'Catalogue');
  assert.equal(resolved.lines.length, 1);
  // Owner email + raw share block must NOT be in the public payload.
  assert.ok(!('email' in resolved));
  assert.ok(!('share' in resolved));
  assert.ok(!/@/.test(JSON.stringify(resolved)));
});

test('createShare is idempotent + ownership-checked', async () => {
  kv._resetMemoryStore();
  const rec = await sp.savePortfolio({ email: 'owner@example.com', lines });
  const s1 = await sp.createShare(rec.id, 'owner@example.com');
  const s2 = await sp.createShare(rec.id, 'owner@example.com');
  assert.equal(s1.code, s2.code); // same code re-used
  assert.equal(await sp.createShare(rec.id, 'intruder@example.com'), null); // not owner
});

test('revokeShare invalidates the code', async () => {
  kv._resetMemoryStore();
  const rec = await sp.savePortfolio({ email: 'owner@example.com', lines });
  const share = await sp.createShare(rec.id, 'owner@example.com');
  assert.equal(await sp.revokeShare(rec.id, 'intruder@example.com'), false); // not owner
  assert.equal(await sp.revokeShare(rec.id, 'owner@example.com'), true);
  assert.equal(await sp.getByShareCode(share.code), null); // dead
});

test('incrementShareViews bumps the counter', async () => {
  kv._resetMemoryStore();
  const rec = await sp.savePortfolio({ email: 'owner@example.com', lines });
  const share = await sp.createShare(rec.id, 'owner@example.com');
  assert.equal(await sp.incrementShareViews(share.code), 1);
  assert.equal(await sp.incrementShareViews(share.code), 2);
  assert.equal(await sp.incrementShareViews('deadbeef00'), 0); // unknown code
});

// ── Endpoints ───────────────────────────────────────────

test('POST /api/portfolio/item/<id>/share: 401 unauthed, 200 + code authed', async () => {
  kv._resetMemoryStore();
  const rec = await sp.savePortfolio({ email: 'owner@example.com', lines });
  const anon = mockRes();
  await portfolioHandler({ method: 'POST', headers: {}, query: { path: 'portfolio/item/' + rec.id + '/share' } }, anon);
  assert.equal(anon.statusCode, 401);

  const res = mockRes();
  await portfolioHandler({ method: 'POST', headers: { cookie: cookieFor('owner@example.com') }, query: { path: 'portfolio/item/' + rec.id + '/share' } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(parse(res).code, /^[a-f0-9]{10}$/);
});

test('DELETE /api/portfolio/item/<id>/share revokes', async () => {
  kv._resetMemoryStore();
  const rec = await sp.savePortfolio({ email: 'owner@example.com', lines });
  await sp.createShare(rec.id, 'owner@example.com');
  const res = mockRes();
  await portfolioHandler({ method: 'DELETE', headers: { cookie: cookieFor('owner@example.com') }, query: { path: 'portfolio/item/' + rec.id + '/share' } }, res);
  assert.equal(res.statusCode, 200);
});

test('GET /api/portfolio/shared/<code>: public, returns lines (no PII), 404 when revoked', async () => {
  kv._resetMemoryStore();
  const rec = await sp.savePortfolio({ email: 'owner@example.com', lines, label: 'Shared cat' });
  const share = await sp.createShare(rec.id, 'owner@example.com');

  const res = mockRes();
  await portfolioHandler({ method: 'GET', headers: { 'x-forwarded-for': '1.1.1.1' }, query: { path: 'portfolio/shared/' + share.code } }, res);
  assert.equal(res.statusCode, 200);
  const body = parse(res);
  assert.equal(body.label, 'Shared cat');
  assert.equal(body.lines.length, 1);
  assert.ok(!/@/.test(res.body), 'shared payload must carry no email');

  // Revoke → 404
  await sp.revokeShare(rec.id, 'owner@example.com');
  const gone = mockRes();
  await portfolioHandler({ method: 'GET', headers: { 'x-forwarded-for': '1.1.1.1' }, query: { path: 'portfolio/shared/' + share.code } }, gone);
  assert.equal(gone.statusCode, 404);
});

test('GET /api/portfolio/shared/<unknown>: 404', async () => {
  kv._resetMemoryStore();
  const res = mockRes();
  await portfolioHandler({ method: 'GET', headers: { 'x-forwarded-for': '2.2.2.2' }, query: { path: 'portfolio/shared/deadbeef00' } }, res);
  assert.equal(res.statusCode, 404);
});

test('shared read records portfolio_share_opened (code only, no PII)', async () => {
  kv._resetMemoryStore();
  const rec = await sp.savePortfolio({ email: 'owner@example.com', lines });
  const share = await sp.createShare(rec.id, 'owner@example.com');
  const res = mockRes();
  await portfolioHandler({ method: 'GET', headers: { 'x-forwarded-for': '3.3.3.3' }, query: { path: 'portfolio/shared/' + share.code } }, res);
  await new Promise((r) => setImmediate(r));
  const logRows = await kv.get('events:log');
  const row = (logRows || []).find((e) => e.type === 'portfolio_share_opened');
  assert.ok(row);
  assert.ok(!/@/.test(JSON.stringify(row)));
});

test('share event types are allowed', () => {
  assert.ok(events.ALLOWED_TYPES.has('portfolio_share_created'));
  assert.ok(events.ALLOWED_TYPES.has('portfolio_share_opened'));
});

// ── UI contracts ────────────────────────────────────────

test('/portfolio/ handles ?share=<code> via the public endpoint + banner', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'portfolio', 'app.js'), 'utf8');
  assert.match(js, /\/api\/portfolio\/shared\//);
  assert.match(js, /\[a-f0-9\]\{10\}/);          // share-code shape gate
  assert.match(js, /showSharedBanner/);
});

test('/account/portfolios/ has Share (mint + copy + revoke) wiring', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'portfolios', 'app.js'), 'utf8');
  assert.match(js, /\/share/);
  assert.match(js, /wireShares/);
  assert.match(js, /\/portfolio\/\?share=/);
  assert.match(js, /method: 'DELETE'/); // revoke
});
