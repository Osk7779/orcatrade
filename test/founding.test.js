// Founding 10 handler tests (Sprint J).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Run KV in memory mode + force Resend off so no email side-effects fire.
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.RESEND_API_KEY;

const kv = require('../lib/intelligence/kv-store');
const events = require('../lib/events');
const foundingHandler = require('../lib/handlers/founding');

// Minimal Express-shaped response stub. Captures statusCode + body so we can
// assert against it without spinning up a real HTTP server.
function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(body) { this.body = body; this.ended = true; },
  };
  return res;
}

function makeReq(method, body = {}) {
  return { method, body };
}

test('GET /api/founding returns starting counter when none applied', async () => {
  kv._resetMemoryStore();
  const res = makeRes();
  await foundingHandler(makeReq('GET'), res);
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.ok, true);
  assert.equal(json.total, 10);
  assert.equal(json.taken, 0);
  assert.equal(json.remaining, 10);
});

test('POST with valid payload records event and emits remaining=9', async () => {
  kv._resetMemoryStore();
  const res = makeRes();
  await foundingHandler(
    makeReq('POST', {
      name: 'Test Importer',
      email: 'test@example.com',
      company: 'Test Co',
      role: 'Founder / owner',
      monthlyValueEur: '50000',
      message: 'Importing apparel from BD',
    }),
    res,
  );
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.ok, true);
  assert.equal(json.taken, 1);
  assert.equal(json.remaining, 9);
  assert.equal(json.waitlist, false);
  assert.equal(json.emailed, false); // No RESEND_API_KEY in test env

  const log = await events.list({ type: 'founding_applied' });
  assert.equal(log.length, 1);
  assert.equal(log[0].name, 'Test Importer');
  assert.equal(log[0].email, 'test@example.com');
  assert.equal(log[0].emailProvided, true);
  assert.equal(log[0].waitlist, false);
});

test('POST without name returns 400', async () => {
  kv._resetMemoryStore();
  const res = makeRes();
  await foundingHandler(makeReq('POST', { email: 'a@b.co' }), res);
  assert.equal(res.statusCode, 400);
  const json = JSON.parse(res.body);
  assert.match(json.error, /name/i);
});

test('POST with invalid email returns 400', async () => {
  kv._resetMemoryStore();
  const res = makeRes();
  await foundingHandler(makeReq('POST', { name: 'X', email: 'not-an-email' }), res);
  assert.equal(res.statusCode, 400);
  const json = JSON.parse(res.body);
  assert.match(json.error, /email/i);
});

test('POST past 10 applications flips waitlist=true and remaining stays 0', async () => {
  kv._resetMemoryStore();
  // Seed exactly 10 founding_applied events
  for (let i = 0; i < 10; i++) {
    await events.record('founding_applied', {
      name: `Founder ${i}`,
      email: `f${i}@example.com`,
      emailProvided: true,
      waitlist: false,
    });
  }
  const res = makeRes();
  await foundingHandler(
    makeReq('POST', { name: 'Eleventh', email: 'eleventh@example.com' }),
    res,
  );
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.waitlist, true);
  assert.equal(json.remaining, 0);
  assert.equal(json.taken, 11);

  const log = await events.list({ type: 'founding_applied' });
  assert.equal(log.length, 11);
  // Newest first; the 11th was the waitlisted submission
  assert.equal(log[0].waitlist, true);
});

test('OPTIONS preflight returns 200', async () => {
  const res = makeRes();
  await foundingHandler(makeReq('OPTIONS'), res);
  assert.equal(res.statusCode, 200);
});

test('PUT returns 405', async () => {
  const res = makeRes();
  await foundingHandler(makeReq('PUT'), res);
  assert.equal(res.statusCode, 405);
});

test('founding_applied is an allowed event type', () => {
  assert.equal(events.ALLOWED_TYPES.has('founding_applied'), true);
});
