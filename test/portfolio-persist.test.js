// Sprint portfolio-v1 (phase 3) — saved-portfolios persistence + endpoints + UI.

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

const sampleLines = [
  { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 50000, weightKg: 2000, hsCode: '610910' },
  { productCategory: 'electronics', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 30000, weightKg: 800 },
];
const sampleSnapshot = {
  lineCount: 2, blendedDutyRatePct: 7.5, consolidationSavingEur: 45,
  totals: { customsValueEur: 80000, dutyEur: 6000, vatEur: 18000, brokerageEur: 110, transportEur: 1300, perShipmentLandedTotal: 105410 },
};

// ── Persistence module ──────────────────────────────────

test('savePortfolio persists + listPortfolios returns it', async () => {
  kv._resetMemoryStore();
  const rec = await sp.savePortfolio({ email: 'u@example.com', lines: sampleLines, label: 'My catalogue', snapshot: sampleSnapshot });
  assert.match(rec.id, /^pf_[a-f0-9]{16}$/);
  assert.equal(rec.label, 'My catalogue');
  assert.equal(rec.lines.length, 2);
  const list = await sp.listPortfolios('u@example.com');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, rec.id);
});

test('savePortfolio drops invalid lines + requires at least one valid', async () => {
  kv._resetMemoryStore();
  const rec = await sp.savePortfolio({
    email: 'u@example.com',
    lines: [sampleLines[0], { productCategory: 'apparel' /* no origin/dest */ }],
  });
  assert.equal(rec.lines.length, 1);
  await assert.rejects(() => sp.savePortfolio({ email: 'u@example.com', lines: [{ productCategory: 'apparel' }] }));
});

test('savePortfolio sanitises line inputs to the allowed key set', async () => {
  kv._resetMemoryStore();
  const rec = await sp.savePortfolio({
    email: 'u@example.com',
    lines: [{ ...sampleLines[0], evilField: 'x', email: 'leak@bad.com' }],
  });
  assert.ok(!('evilField' in rec.lines[0]));
  assert.ok(!('email' in rec.lines[0]));
  assert.equal(rec.lines[0].productCategory, 'apparel');
});

test('autoLabel describes SKU + lane count when no label given', async () => {
  kv._resetMemoryStore();
  const rec = await sp.savePortfolio({ email: 'u@example.com', lines: sampleLines });
  assert.match(rec.label, /2 SKUs · 1 lane/);
});

test('getPortfolio enforces ownership', async () => {
  kv._resetMemoryStore();
  const rec = await sp.savePortfolio({ email: 'owner@example.com', lines: sampleLines });
  assert.ok(await sp.getPortfolio(rec.id, 'owner@example.com'));
  assert.equal(await sp.getPortfolio(rec.id, 'someone@else.com'), null);
});

test('deletePortfolio removes it + is ownership-checked', async () => {
  kv._resetMemoryStore();
  const rec = await sp.savePortfolio({ email: 'owner@example.com', lines: sampleLines });
  assert.equal(await sp.deletePortfolio(rec.id, 'someone@else.com'), false); // not owner
  assert.equal(await sp.deletePortfolio(rec.id, 'owner@example.com'), true);
  assert.equal((await sp.listPortfolios('owner@example.com')).length, 0);
});

test('snapshot is sanitised to aggregate fields only (no email leak)', () => {
  const snap = sp.sanitiseSnapshot({ ...sampleSnapshot, email: 'leak@bad.com', secret: 1 });
  assert.ok(!('email' in snap));
  assert.ok(!('secret' in snap));
  assert.equal(snap.blendedDutyRatePct, 7.5);
  assert.equal(snap.totals.perShipmentLandedTotal, 105410);
});

// ── Endpoints ───────────────────────────────────────────

test('POST /api/portfolio/save: 401 when not signed in', async () => {
  const res = mockRes();
  await portfolioHandler({ method: 'POST', headers: {}, query: { path: 'portfolio/save' }, body: { lines: sampleLines } }, res);
  assert.equal(res.statusCode, 401);
});

test('POST /api/portfolio/save: 200 saves + records portfolio_saved', async () => {
  kv._resetMemoryStore();
  const res = mockRes();
  await portfolioHandler({
    method: 'POST', headers: { cookie: cookieFor('save@example.com') },
    query: { path: 'portfolio/save' },
    body: { lines: sampleLines, label: 'Q3 catalogue', snapshot: sampleSnapshot },
  }, res);
  assert.equal(res.statusCode, 200);
  const body = parse(res);
  assert.equal(body.ok, true);
  assert.match(body.id, /^pf_[a-f0-9]{16}$/);
  await new Promise((r) => setImmediate(r));
  const logRows = await kv.get('events:log');
  assert.ok((logRows || []).some((e) => e.type === 'portfolio_saved'));
});

test('GET /api/portfolio/list: 401 unauthed, 200 lists when authed', async () => {
  kv._resetMemoryStore();
  const anon = mockRes();
  await portfolioHandler({ method: 'GET', headers: {}, query: { path: 'portfolio/list' } }, anon);
  assert.equal(anon.statusCode, 401);

  await sp.savePortfolio({ email: 'list@example.com', lines: sampleLines, label: 'A', snapshot: sampleSnapshot });
  const res = mockRes();
  await portfolioHandler({ method: 'GET', headers: { cookie: cookieFor('list@example.com') }, query: { path: 'portfolio/list' } }, res);
  assert.equal(res.statusCode, 200);
  const body = parse(res);
  assert.equal(body.portfolios.length, 1);
  // List view carries the snapshot but NOT the full line inputs.
  assert.ok(body.portfolios[0].snapshot);
  assert.ok(!('lines' in body.portfolios[0]));
});

test('GET /api/portfolio/item/<id>: returns full record (lines) to owner only', async () => {
  kv._resetMemoryStore();
  const rec = await sp.savePortfolio({ email: 'owner@example.com', lines: sampleLines });
  const owner = mockRes();
  await portfolioHandler({ method: 'GET', headers: { cookie: cookieFor('owner@example.com') }, query: { path: 'portfolio/item/' + rec.id } }, owner);
  assert.equal(owner.statusCode, 200);
  assert.equal(parse(owner).portfolio.lines.length, 2);

  const other = mockRes();
  await portfolioHandler({ method: 'GET', headers: { cookie: cookieFor('other@example.com') }, query: { path: 'portfolio/item/' + rec.id } }, other);
  assert.equal(other.statusCode, 404); // not owner → 404 (no existence leak)
});

test('DELETE /api/portfolio/item/<id>: removes for owner', async () => {
  kv._resetMemoryStore();
  const rec = await sp.savePortfolio({ email: 'owner@example.com', lines: sampleLines });
  const res = mockRes();
  await portfolioHandler({ method: 'DELETE', headers: { cookie: cookieFor('owner@example.com') }, query: { path: 'portfolio/item/' + rec.id } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal((await sp.listPortfolios('owner@example.com')).length, 0);
});

test('unknown /api/portfolio sub-action → 404', async () => {
  const res = mockRes();
  await portfolioHandler({ method: 'GET', headers: {}, query: { path: 'portfolio/nope' } }, res);
  assert.equal(res.statusCode, 404);
});

test('bare POST /api/portfolio still computes (anonymous, unchanged)', async () => {
  kv._resetMemoryStore();
  const res = mockRes();
  await portfolioHandler({ method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, query: { path: 'portfolio' }, body: { lines: sampleLines } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(parse(res).aggregate);
});

test('portfolio_saved is an allowed event type', () => {
  assert.ok(events.ALLOWED_TYPES.has('portfolio_saved'));
});

// ── UI contracts ────────────────────────────────────────

test('/portfolio/ save UI: app.js gates on signedIn + POSTs to /save', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'portfolio', 'app.js'), 'utf8');
  assert.match(js, /\/api\/auth\/me/);
  assert.match(js, /signedIn/);
  assert.match(js, /\/api\/portfolio\/save/);
  // Revisit a saved portfolio via ?id=
  assert.match(js, /\/api\/portfolio\/item\//);
  assert.match(js, /pf_\[a-f0-9\]\{16\}/);
});

test('/account/portfolios/ page lists + opens + deletes', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'portfolios', 'index.html'), 'utf8');
  assert.match(html, /id="list"/);
  assert.match(html, /id="authNeeded"/);
  assert.match(html, /\/account\/portfolios\/app\.js/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'portfolios', 'app.js'), 'utf8');
  assert.match(js, /\/api\/portfolio\/list/);
  assert.match(js, /\/portfolio\/\?id=/);
  assert.match(js, /method: 'DELETE'/);
});

test('/account/ links to saved portfolios', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'index.html'), 'utf8');
  assert.match(html, /href="\/account\/portfolios\/"/);
});
