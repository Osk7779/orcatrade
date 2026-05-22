const test = require('node:test');
const assert = require('node:assert/strict');

const accountHandler = require('../lib/handlers/account');
const auth = require('../lib/auth');
const kv = require('../lib/intelligence/kv-store');
const savedPlans = require('../lib/saved-plans');

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    end(body) { this.body = body || ''; return this; },
  };
}
function parse(res) { try { return JSON.parse(res.body); } catch (_) { return null; } }
function reqFor(email, extraQuery) {
  return {
    method: 'GET',
    headers: { cookie: 'orcatrade_session=' + encodeURIComponent(auth.buildSessionCookie(email)) },
    // Pin asOf so the test is deterministic regardless of the wall-clock date:
    // as-of 2027-05-01, CBAM's 2027-05-31 annual declaration is 30 days out.
    query: Object.assign({ path: 'account/calendar', asOf: '2027-05-01' }, extraQuery || {}),
  };
}

const STEEL = { productCategory: 'steel', originCountry: 'CN', destinationCountry: 'DE', customsValueEur: 250000 };
const APPAREL = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 50000 };

test('calendar: 401 when not signed in', async () => {
  kv._resetMemoryStore();
  const res = mockRes();
  await accountHandler({ method: 'GET', headers: {}, query: { path: 'account/calendar' } }, res);
  assert.equal(res.statusCode, 401);
});

test('calendar: signed-in user with a CBAM-covered plan gets dated obligations', async () => {
  kv._resetMemoryStore();
  await savedPlans.savePlan({ email: 'me@example.com', inputs: STEEL });
  const res = mockRes();
  await accountHandler(reqFor('me@example.com'), res);
  assert.equal(res.statusCode, 200);
  const body = parse(res);
  assert.equal(body.plansScanned, 1);
  assert.ok(body.count >= 1);
  assert.ok(body.obligations.some(o => o.regime === 'cbam'));
  assert.ok(body.obligations.every(o => o.citation && o.dueDate));
  assert.match(body.advisory, /official sources/i);
});

test('calendar: a user whose plans hit no regime gets an empty list (not an error)', async () => {
  kv._resetMemoryStore();
  await savedPlans.savePlan({ email: 'me@example.com', inputs: APPAREL });
  const res = mockRes();
  await accountHandler(reqFor('me@example.com'), res);
  assert.equal(res.statusCode, 200);
  const body = parse(res);
  assert.equal(body.plansScanned, 1);
  assert.equal(body.count, 0);
  assert.deepEqual(body.obligations, []);
});

test('calendar: only the signed-in user\'s plans are scanned (no leak)', async () => {
  kv._resetMemoryStore();
  await savedPlans.savePlan({ email: 'me@example.com', inputs: STEEL });
  await savedPlans.savePlan({ email: 'other@example.com', inputs: STEEL });
  const res = mockRes();
  await accountHandler(reqFor('me@example.com'), res);
  const body = parse(res);
  assert.equal(body.plansScanned, 1);
});
