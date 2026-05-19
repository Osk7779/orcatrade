// Sprint first-share-welcome-v1 — tests for the third milestone email.
//
// Covers:
//   - Template (EN/PL/DE): subject + body shape, interpolates the
//     share URL prominently, first-name optional
//   - sendFirstShareWelcomeIfFirst lifecycle: not-configured /
//     no-email / no-share-url / idempotency / case-insensitive /
//     send-failure does NOT write dedupe / KV write of chosen locale
//   - Plans handler integration: handleCreateShare on first share
//     fires the welcome with the right URL; second-plan share does
//     NOT re-fire; idempotent re-call on same plan does NOT re-fire;
//     locale read from prefs; mint still succeeds when send throws
//   - Independence from the other two welcomes (all three can land
//     on the same user, three different KV keys)

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');

const welcome = require('../lib/welcome');
const kv = require('../lib/intelligence/kv-store');
const auth = require('../lib/auth');
const savedPlans = require('../lib/saved-plans');
const notificationPrefs = require('../lib/notification-prefs');

// ── Module surface ────────────────────────────────────

test('welcome module exposes first-share milestone surface', () => {
  for (const name of ['FIRST_SHARE_KEY_PREFIX', 'firstShareKey', 'buildFirstShareEmail', 'sendFirstShareWelcomeIfFirst']) {
    assert.ok(welcome[name] !== undefined, name + ' exported');
  }
});

test('firstShareKey: separate namespace from welcomeKey + firstActualKey', () => {
  const e = 'x@y.com';
  const w = welcome.welcomeKey(e);
  const a = welcome.firstActualKey(e);
  const s = welcome.firstShareKey(e);
  assert.notEqual(w, a);
  assert.notEqual(w, s);
  assert.notEqual(a, s);
});

// ── Template builder ──────────────────────────────────

test('buildFirstShareEmail: EN subject + body include the share URL prominently + key concepts', () => {
  const { subject, text } = welcome.buildFirstShareEmail({
    locale: 'en', firstName: 'Oskar',
    shareUrl: 'https://orcatrade.pl/share/abc123def456',
    planUrl: 'https://orcatrade.pl/account/plans/',
    wizardUrl: 'https://orcatrade.pl/start/',
    prefsUrl: 'https://orcatrade.pl/account/preferences/',
  });
  assert.match(subject, /share link/i);
  assert.match(subject, /CFO/);
  assert.match(text, /^Hi Oskar,/);
  assert.match(text, /https:\/\/orcatrade\.pl\/share\/abc123def456/);
  // The three points the body promises: durability + revocation + today's-numbers.
  assert.match(text, /view counter/i);
  assert.match(text, /Revocation works/i);
  assert.match(text, /TODAY\'s numbers/);
});

test('buildFirstShareEmail: PL renders Polish opener + same URL', () => {
  const { subject, text } = welcome.buildFirstShareEmail({
    locale: 'pl',
    shareUrl: 'https://orcatrade.pl/share/xyz',
  });
  assert.match(subject, /link do udostępnienia/);
  assert.match(text, /^Cześć,/);
  assert.match(text, /https:\/\/orcatrade\.pl\/share\/xyz/);
});

test('buildFirstShareEmail: DE renders German opener + same URL', () => {
  const { subject, text } = welcome.buildFirstShareEmail({
    locale: 'de',
    shareUrl: 'https://orcatrade.pl/share/xyz',
  });
  assert.match(subject, /Share-Link/);
  assert.match(text, /^Hallo,/);
  assert.match(text, /https:\/\/orcatrade\.pl\/share\/xyz/);
});

test('buildFirstShareEmail: unknown locale falls back to EN', () => {
  const { subject } = welcome.buildFirstShareEmail({ locale: 'fr', shareUrl: '/share/x' });
  assert.match(subject, /share link/i);
});

test('buildFirstShareEmail: missing shareUrl renders the placeholder rather than crashing', () => {
  const { text } = welcome.buildFirstShareEmail({ locale: 'en' });
  assert.match(text, /share URL missing/);
});

// ── sendFirstShareWelcomeIfFirst lifecycle ────────────

test('sendFirstShareWelcomeIfFirst: not-configured when RESEND_API_KEY unset', async () => {
  kv._resetMemoryStore();
  const saved = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    const r = await welcome.sendFirstShareWelcomeIfFirst('x@y.com', { shareUrl: '/share/x' });
    assert.equal(r.sent, false);
    assert.equal(r.reason, 'not-configured');
  } finally {
    if (saved !== undefined) process.env.RESEND_API_KEY = saved;
  }
});

test('sendFirstShareWelcomeIfFirst: no-share-url short-circuits', async () => {
  process.env.RESEND_API_KEY = 'test-key';
  try {
    const r = await welcome.sendFirstShareWelcomeIfFirst('x@y.com');
    assert.equal(r.sent, false);
    assert.equal(r.reason, 'no-share-url');
  } finally { delete process.env.RESEND_API_KEY; }
});

test('sendFirstShareWelcomeIfFirst: empty email → no-email', async () => {
  process.env.RESEND_API_KEY = 'test-key';
  try {
    const r = await welcome.sendFirstShareWelcomeIfFirst('', { shareUrl: '/share/x' });
    assert.equal(r.sent, false);
    assert.equal(r.reason, 'no-email');
  } finally { delete process.env.RESEND_API_KEY; }
});

test('sendFirstShareWelcomeIfFirst: successful send writes idempotency key + locale', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const email = require('../lib/email');
  const realSend = email.send;
  email.send = async () => ({ ok: true, id: 'test-id' });
  try {
    const r = await welcome.sendFirstShareWelcomeIfFirst('first-share@example.com', {
      locale: 'pl', shareUrl: 'https://orcatrade.pl/share/abc',
    });
    assert.equal(r.sent, true);
    assert.equal(r.locale, 'pl');
    const stored = await kv.get(welcome.firstShareKey('first-share@example.com'));
    assert.ok(stored);
    assert.equal(stored.locale, 'pl');
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('sendFirstShareWelcomeIfFirst: idempotent — second call skips', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const email = require('../lib/email');
  const realSend = email.send;
  let sends = 0;
  email.send = async () => { sends++; return { ok: true }; };
  try {
    await welcome.sendFirstShareWelcomeIfFirst('dupe@example.com', { shareUrl: '/share/a' });
    await welcome.sendFirstShareWelcomeIfFirst('dupe@example.com', { shareUrl: '/share/b' });
    assert.equal(sends, 1);
    const r2 = await welcome.sendFirstShareWelcomeIfFirst('dupe@example.com', { shareUrl: '/share/c' });
    assert.equal(r2.sent, false);
    assert.equal(r2.reason, 'already-sent');
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('sendFirstShareWelcomeIfFirst: send-failure does NOT write dedupe (retry allowed)', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const email = require('../lib/email');
  const realSend = email.send;
  email.send = async () => ({ ok: false, reason: 'simulated' });
  try {
    const r = await welcome.sendFirstShareWelcomeIfFirst('retry@example.com', { shareUrl: '/share/x' });
    assert.equal(r.sent, false);
    const stored = await kv.get(welcome.firstShareKey('retry@example.com'));
    assert.equal(stored, null);
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('sendFirstShareWelcomeIfFirst: independence from the other two milestones', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const email = require('../lib/email');
  const realSend = email.send;
  email.send = async () => ({ ok: true });
  try {
    // Fire all three lifecycle emails for the same user; all should land.
    const r1 = await welcome.sendWelcomeIfFirst('trio@example.com', { locale: 'en' });
    const r2 = await welcome.sendFirstActualWelcomeIfFirst('trio@example.com', {
      locale: 'en', variance: { estimateEur: 10000, actualEur: 9500, deltaPct: -5, direction: 'under' },
    });
    const r3 = await welcome.sendFirstShareWelcomeIfFirst('trio@example.com', {
      locale: 'en', shareUrl: 'https://orcatrade.pl/share/trio',
    });
    assert.equal(r1.sent, true);
    assert.equal(r2.sent, true);
    assert.equal(r3.sent, true);
    assert.ok(await kv.get(welcome.welcomeKey('trio@example.com')));
    assert.ok(await kv.get(welcome.firstActualKey('trio@example.com')));
    assert.ok(await kv.get(welcome.firstShareKey('trio@example.com')));
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

// ── Plans handler integration ─────────────────────────

async function seedPlan(emailAddr) {
  const startHandler = require('../lib/handlers/start');
  const planDiff = require('../lib/plan-diff');
  const inputs = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 };
  const snapshot = planDiff.extractSnapshot(await startHandler.composePlan(inputs));
  return await savedPlans.savePlan({ email: emailAddr, inputs, snapshot });
}

function shareReq(sessionEmail, planId) {
  const cookie = auth.buildSessionCookie(sessionEmail);
  return {
    method: 'POST',
    url: '/api/plans/' + planId + '/share',
    headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
    query: { path: ['plans', planId, 'share'] },
    body: {},
  };
}
function mockRes() {
  return { statusCode: 200, _h: {}, body: '', setHeader(k, v) { this._h[k] = v; }, end(b) { this.body = b; } };
}

test('plans handler: first share fires the welcome with the right URL', async () => {
  const plansHandler = require('../lib/handlers/plans');
  const email = require('../lib/email');

  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const realSend = email.send;
  const sent = [];
  email.send = async (msg) => { sent.push(msg); return { ok: true, id: 'mock' }; };

  try {
    const sessionEmail = 'first-share@example.com';
    const plan = await seedPlan(sessionEmail);

    const res = mockRes();
    await plansHandler(shareReq(sessionEmail, plan.id), res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.share && body.share.code, 'share record returned');

    await new Promise((r) => setTimeout(r, 30));

    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /first share link/i);
    // The body includes the actual share URL with this user's code.
    assert.match(sent[0].text, new RegExp('/share/' + body.share.code));

    const stored = await kv.get(welcome.firstShareKey(sessionEmail));
    assert.ok(stored);
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('plans handler: idempotent re-call on the SAME plan does NOT re-fire', async () => {
  const plansHandler = require('../lib/handlers/plans');
  const email = require('../lib/email');

  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const realSend = email.send;
  const sent = [];
  email.send = async (msg) => { sent.push(msg); return { ok: true }; };

  try {
    const sessionEmail = 'idempotent@example.com';
    const plan = await seedPlan(sessionEmail);

    await plansHandler(shareReq(sessionEmail, plan.id), mockRes());
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(sent.length, 1);

    // Re-call: same plan, savedPlans.createShare returns the existing
    // record (idempotent). priorShareCount is now 1, so the welcome
    // gate filters it out.
    await plansHandler(shareReq(sessionEmail, plan.id), mockRes());
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(sent.length, 1, 'idempotent re-call must not re-fire');
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('plans handler: sharing a SECOND plan after the first does NOT re-fire', async () => {
  const plansHandler = require('../lib/handlers/plans');
  const email = require('../lib/email');

  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const realSend = email.send;
  const sent = [];
  email.send = async (msg) => { sent.push(msg); return { ok: true }; };

  try {
    const sessionEmail = 'two-shares@example.com';
    const planA = await seedPlan(sessionEmail);
    const planB = await seedPlan(sessionEmail);

    await plansHandler(shareReq(sessionEmail, planA.id), mockRes());
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(sent.length, 1);

    await plansHandler(shareReq(sessionEmail, planB.id), mockRes());
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(sent.length, 1, 'second-plan share must not re-fire');
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('plans handler: share welcome honours stored locale (DE example)', async () => {
  const plansHandler = require('../lib/handlers/plans');
  const email = require('../lib/email');

  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  await notificationPrefs.setPrefs('de-share@example.com', { locale: 'de' });

  const realSend = email.send;
  const sent = [];
  email.send = async (msg) => { sent.push(msg); return { ok: true }; };

  try {
    const sessionEmail = 'de-share@example.com';
    const plan = await seedPlan(sessionEmail);
    await plansHandler(shareReq(sessionEmail, plan.id), mockRes());
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /Share-Link/);
    assert.match(sent[0].text, /Hallo/);
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('plans handler: createShare succeeds even when the welcome path throws', async () => {
  const plansHandler = require('../lib/handlers/plans');
  const email = require('../lib/email');

  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const realSend = email.send;
  email.send = async () => { throw new Error('synthetic Resend failure'); };

  try {
    const sessionEmail = 'resilient-share@example.com';
    const plan = await seedPlan(sessionEmail);
    const res = mockRes();
    await plansHandler(shareReq(sessionEmail, plan.id), res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.share && body.share.code);
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});
