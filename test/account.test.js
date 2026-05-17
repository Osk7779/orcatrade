// Tests for lib/handlers/account.js — Sprint BG-5.1 GDPR endpoints.
//
// Both endpoints require a valid session cookie. The tests construct a
// fake req with a real signed cookie (via auth.buildSessionCookie), seed
// some saved plans + events into the in-memory KV, then assert export
// shape and delete pseudonymisation.

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');

const auth = require('../lib/auth');
const kv = require('../lib/intelligence/kv-store');
const savedPlans = require('../lib/saved-plans');
const events = require('../lib/events');
const account = require('../lib/handlers/account');

// ── Mock req/res helpers ─────────────────────────────────────

function makeReq({ method = 'GET', urlPath = '', email = null, body = {} } = {}) {
  const req = {
    method,
    url: `/api/account/${urlPath}`,
    headers: {},
    body,
    requestId: 'test-req-id',
    query: { path: ['account', urlPath].filter(Boolean) },
  };
  if (email) {
    const cookie = auth.buildSessionCookie(email);
    req.headers.cookie = `orcatrade_session=${encodeURIComponent(cookie)}`;
  }
  return req;
}

function makeRes() {
  const res = {
    statusCode: 200,
    headersSent: false,
    _headers: {},
    body: '',
    setHeader(k, v) { this._headers[k] = v; },
    end(b) { this.body = b || ''; this.headersSent = true; return this; },
  };
  return res;
}

// ── Auth gate ────────────────────────────────────────────────

test('export: 401 when no session cookie', async () => {
  const req = makeReq({ method: 'GET', urlPath: 'export' });
  const res = makeRes();
  await account(req, res);
  assert.equal(res.statusCode, 401);
  const body = JSON.parse(res.body);
  assert.match(body.error, /Not signed in/);
});

test('delete: 401 when no session cookie', async () => {
  const req = makeReq({ method: 'POST', urlPath: 'delete', body: { confirm: true } });
  const res = makeRes();
  await account(req, res);
  assert.equal(res.statusCode, 401);
});

test('export: malformed cookie → 401', async () => {
  const req = makeReq({ method: 'GET', urlPath: 'export' });
  req.headers.cookie = 'orcatrade_session=garbage';
  const res = makeRes();
  await account(req, res);
  assert.equal(res.statusCode, 401);
});

// ── Unknown sub-action ───────────────────────────────────────

test('unknown sub-action under /api/account/* returns 404', async () => {
  const req = makeReq({ method: 'GET', urlPath: 'mystery', email: 'me@example.com' });
  const res = makeRes();
  await account(req, res);
  assert.equal(res.statusCode, 404);
});

// ── Helper: emailHash / pseudonym ────────────────────────────

test('emailHash is deterministic + case-insensitive', () => {
  const a = account.emailHash('Me@Example.Com');
  const b = account.emailHash('me@example.com');
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{16}$/);
});

test('pseudonymForDeletedUser format is deleted-<hash>@anonymised.local', () => {
  const p = account.pseudonymForDeletedUser('user@example.com');
  assert.match(p, /^deleted-[a-f0-9]{16}@anonymised\.local$/);
});

// ── Export end-to-end ────────────────────────────────────────

test('export: returns the user\'s saved plans + matching events + the right shape', async () => {
  kv._resetMemoryStore();
  const email = 'exporter@example.com';

  // Seed: two saved plans for the user.
  await savedPlans.savePlan({
    email,
    inputs: { productCategory: 'apparel', originCountry: 'cn', destinationCountry: 'de', customsValueEur: 25000 },
    label: 'CN apparel pilot',
  });
  await savedPlans.savePlan({
    email,
    inputs: { productCategory: 'electronics', originCountry: 'vn', destinationCountry: 'pl', customsValueEur: 80000 },
    label: 'VN electronics scale-up',
  });

  // Seed: a founding event for this user + one for someone else (must be filtered out).
  await events.record('founding_applied', { name: 'me', email, locale: 'en' });
  await events.record('founding_applied', { name: 'other', email: 'other@example.com', locale: 'en' });

  const req = makeReq({ method: 'GET', urlPath: 'export', email });
  const res = makeRes();
  await account(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res._headers['Content-Type'], 'application/json');
  assert.match(res._headers['Content-Disposition'], /attachment; filename="orcatrade-export-/);

  const body = JSON.parse(res.body);
  assert.equal(body.format, 'orcatrade-gdpr-export-v1');
  assert.equal(body.user.email, email);
  assert.match(body.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(body.savedPlans.length, 2);
  assert.equal(body.events.length, 1, 'only the user\'s event should be exported');
  assert.equal(body.events[0].email, email);
  assert.ok(Array.isArray(body.notes) && body.notes.length >= 3, 'notes section present');
});

test('export: Cache-Control: no-store + Content-Disposition: attachment', async () => {
  kv._resetMemoryStore();
  const req = makeReq({ method: 'GET', urlPath: 'export', email: 'cc@example.com' });
  const res = makeRes();
  await account(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res._headers['Cache-Control'], 'no-store');
  assert.match(res._headers['Content-Disposition'], /attachment/);
});

test('export: empty inbox returns valid file with empty arrays', async () => {
  kv._resetMemoryStore();
  const req = makeReq({ method: 'GET', urlPath: 'export', email: 'empty@example.com' });
  const res = makeRes();
  await account(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.deepEqual(body.savedPlans, []);
  assert.deepEqual(body.events, []);
});

// ── Delete end-to-end ────────────────────────────────────────

test('delete: requires { confirm: true } body', async () => {
  kv._resetMemoryStore();
  const req = makeReq({ method: 'POST', urlPath: 'delete', email: 'nope@example.com', body: { confirm: false } });
  const res = makeRes();
  await account(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /explicit confirmation/);
});

test('delete: pseudonymises events + hard-deletes plans + clears session cookie', async () => {
  kv._resetMemoryStore();
  const email = 'deleter@example.com';

  // Seed: plans + events for this user, plus one other user we must not touch.
  await savedPlans.savePlan({
    email,
    inputs: { productCategory: 'apparel', originCountry: 'cn', destinationCountry: 'de', customsValueEur: 25000 },
    label: 'doomed',
  });
  await events.record('founding_applied', { name: 'me', company: 'ACo', email, locale: 'en' });
  await events.record('founding_applied', { name: 'them', email: 'other@example.com', locale: 'en' });

  const req = makeReq({ method: 'POST', urlPath: 'delete', email, body: { confirm: true } });
  const res = makeRes();
  await account(req, res);

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.deleted.plans, 1);
  assert.equal(body.deleted.eventsScrubbed, 1);
  assert.match(body.pseudonym, /^deleted-[a-f0-9]{16}@anonymised\.local$/);

  // Session cookie cleared.
  assert.match(res._headers['Set-Cookie'] || '', /Max-Age=0/);

  // Plans gone.
  assert.equal((await savedPlans.listPlans(email)).length, 0);

  // The other user's event survives intact; ours is pseudonymised.
  const allEvents = await events.list({ limit: 100 });
  const mine = allEvents.find(e => e.email && e.email.startsWith('deleted-'));
  const theirs = allEvents.find(e => e.email === 'other@example.com');
  assert.ok(mine, 'our event still in log but pseudonymised');
  assert.equal(mine.name, 'deleted');
  assert.equal(mine.company, 'deleted');
  assert.equal(mine.pseudonymised, true);
  assert.match(mine.pseudonymisedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(theirs, 'other user\'s event untouched');
  assert.equal(theirs.name, 'them');
});

test('delete: with no plans/events still returns 200 and signs the user out', async () => {
  kv._resetMemoryStore();
  const req = makeReq({ method: 'POST', urlPath: 'delete', email: 'fresh@example.com', body: { confirm: true } });
  const res = makeRes();
  await account(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.deleted.plans, 0);
  assert.equal(body.deleted.eventsScrubbed, 0);
  assert.match(res._headers['Set-Cookie'] || '', /Max-Age=0/);
});

// ── CORS preflight ───────────────────────────────────────────

test('OPTIONS preflight returns 204', async () => {
  const req = { method: 'OPTIONS', url: '/api/account/export', headers: {}, query: { path: ['account', 'export'] } };
  const res = makeRes();
  await account(req, res);
  assert.equal(res.statusCode, 204);
});

// ── Method gating ────────────────────────────────────────────

test('GET /api/account/delete returns 404 (must be POST)', async () => {
  const req = makeReq({ method: 'GET', urlPath: 'delete', email: 'm@example.com' });
  const res = makeRes();
  await account(req, res);
  assert.equal(res.statusCode, 404);
});
