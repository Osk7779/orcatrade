// Sprint first-actual-welcome-v1 — tests for the second milestone email.
//
// Covers:
//   - Template (EN/PL/DE): subject + body shape, interpolates estimate
//     / actual / variance / direction, locale-correct words for
//     "over/under budget"
//   - sendFirstActualWelcomeIfFirst lifecycle: not-configured / no-email
//     / idempotency / case-insensitive / send-failure does NOT write
//     dedupe (retry possible) / KV write of the chosen locale
//   - Plans handler integration: handleSetActual on first actual fires
//     the celebration with the right variance; second-plan actual does
//     NOT re-fire; locale read from prefs; setActual still succeeds
//     when the celebration path throws
//   - Independence from first-plan welcome: both can land on the same
//     user (different KV keys, different templates)

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

test('welcome module exposes first-actual milestone surface', () => {
  for (const name of ['FIRST_ACTUAL_KEY_PREFIX', 'firstActualKey', 'buildFirstActualEmail', 'sendFirstActualWelcomeIfFirst']) {
    assert.ok(welcome[name] !== undefined, name + ' exported');
  }
});

test('firstActualKey: separate namespace from first-plan welcomeKey', () => {
  assert.notEqual(welcome.welcomeKey('x@y.com'), welcome.firstActualKey('x@y.com'));
  // Case-insensitive normalisation matches across both helpers.
  assert.equal(welcome.firstActualKey('A@B.com'), welcome.firstActualKey('a@b.com'));
});

// ── Template builder ──────────────────────────────────

function sampleVariance(over = false) {
  // 25k estimate, 26k actual = +4% (over) by default; flip with over=false → 24k = -4% under.
  if (over) {
    return { estimateEur: 25000, actualEur: 26000, deltaPct: 4, direction: 'over' };
  }
  return { estimateEur: 25000, actualEur: 24000, deltaPct: -4, direction: 'under' };
}

test('buildFirstActualEmail: EN subject + body include the variance line + CTA', () => {
  const { subject, text } = welcome.buildFirstActualEmail({
    locale: 'en', firstName: 'Oskar',
    variance: sampleVariance(false),
    planUrl: 'https://orcatrade.pl/account/plans/',
    wizardUrl: 'https://orcatrade.pl/start/',
    prefsUrl: 'https://orcatrade.pl/account/preferences/',
  });
  assert.match(subject, /Calibration data point/);
  assert.match(subject, /-4%/); // signed pct in subject
  assert.match(text, /^Hi Oskar,/);
  assert.match(text, /Estimate: €25,000/);
  assert.match(text, /Actual: {3}€24,000/);
  assert.match(text, /-4% \(under budget\)/);
  assert.match(text, /\/account\/plans\//);
  assert.match(text, /\/account\/preferences\//);
});

test('buildFirstActualEmail: positive variance renders +N.M% with "over" word', () => {
  const { subject, text } = welcome.buildFirstActualEmail({
    locale: 'en', variance: { estimateEur: 100000, actualEur: 110000, deltaPct: 10, direction: 'over' },
  });
  assert.match(subject, /\+10%/);
  assert.match(text, /\+10% \(over budget\)/);
});

test('buildFirstActualEmail: on-target direction renders "on target"', () => {
  const { text } = welcome.buildFirstActualEmail({
    locale: 'en', variance: { estimateEur: 10000, actualEur: 10050, deltaPct: 0.5, direction: 'onTarget' },
  });
  assert.match(text, /on target budget/);
});

test('buildFirstActualEmail: PL renders Polish direction word + opener', () => {
  const { subject, text } = welcome.buildFirstActualEmail({
    locale: 'pl', variance: sampleVariance(true),
  });
  assert.match(subject, /Punkt kalibracji/);
  assert.match(text, /^Cześć,/);
  assert.match(text, /powyżej budżetu/);
});

test('buildFirstActualEmail: DE renders German direction word + opener', () => {
  const { subject, text } = welcome.buildFirstActualEmail({
    locale: 'de', variance: sampleVariance(false),
  });
  assert.match(subject, /Kalibrierungs-Datenpunkt/);
  assert.match(text, /^Hallo,/);
  assert.match(text, /unter Budget/);
});

test('buildFirstActualEmail: unknown locale falls back to EN', () => {
  const { subject } = welcome.buildFirstActualEmail({ locale: 'fr', variance: sampleVariance() });
  assert.match(subject, /Calibration data point/);
});

test('buildFirstActualEmail: handles missing variance defensively', () => {
  // null/empty variance still produces a body — we just render zeros
  // and an on-target word. The caller is expected to pass variance,
  // but a defensive template means a bug upstream doesn't crash the
  // send.
  const { subject, text } = welcome.buildFirstActualEmail({ locale: 'en' });
  assert.match(subject, /Calibration data point/);
  assert.match(text, /Estimate: €0/);
  assert.match(text, /0% \(on target budget\)/);
});

// ── sendFirstActualWelcomeIfFirst lifecycle ───────────

test('sendFirstActualWelcomeIfFirst: not-configured when RESEND_API_KEY unset', async () => {
  kv._resetMemoryStore();
  const saved = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    const r = await welcome.sendFirstActualWelcomeIfFirst('user@example.com');
    assert.equal(r.sent, false);
    assert.equal(r.reason, 'not-configured');
  } finally {
    if (saved !== undefined) process.env.RESEND_API_KEY = saved;
  }
});

test('sendFirstActualWelcomeIfFirst: empty email → no-email', async () => {
  process.env.RESEND_API_KEY = 'test-key';
  try {
    const r = await welcome.sendFirstActualWelcomeIfFirst('');
    assert.equal(r.sent, false);
    assert.equal(r.reason, 'no-email');
  } finally { delete process.env.RESEND_API_KEY; }
});

test('sendFirstActualWelcomeIfFirst: successful send writes idempotency key + locale', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const email = require('../lib/email');
  const realSend = email.send;
  email.send = async () => ({ ok: true, id: 'test-id' });
  try {
    const r = await welcome.sendFirstActualWelcomeIfFirst('actual-first@example.com', {
      locale: 'pl', variance: sampleVariance(false),
    });
    assert.equal(r.sent, true);
    assert.equal(r.locale, 'pl');
    const stored = await kv.get(welcome.firstActualKey('actual-first@example.com'));
    assert.ok(stored);
    assert.equal(stored.locale, 'pl');
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('sendFirstActualWelcomeIfFirst: idempotent — second call skips', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const email = require('../lib/email');
  const realSend = email.send;
  let sends = 0;
  email.send = async () => { sends++; return { ok: true, id: 'x' }; };
  try {
    await welcome.sendFirstActualWelcomeIfFirst('dupe@example.com', { locale: 'en', variance: sampleVariance() });
    await welcome.sendFirstActualWelcomeIfFirst('dupe@example.com', { locale: 'en', variance: sampleVariance() });
    assert.equal(sends, 1);
    const r2 = await welcome.sendFirstActualWelcomeIfFirst('dupe@example.com');
    assert.equal(r2.sent, false);
    assert.equal(r2.reason, 'already-sent');
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('sendFirstActualWelcomeIfFirst: send-failure does NOT write dedupe (retry allowed)', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const email = require('../lib/email');
  const realSend = email.send;
  email.send = async () => ({ ok: false, reason: 'simulated upstream' });
  try {
    const r = await welcome.sendFirstActualWelcomeIfFirst('retry@example.com', { variance: sampleVariance() });
    assert.equal(r.sent, false);
    const stored = await kv.get(welcome.firstActualKey('retry@example.com'));
    assert.equal(stored, null);
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('sendFirstActualWelcomeIfFirst: independence from sendWelcomeIfFirst (both can fire for the same user)', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const email = require('../lib/email');
  const realSend = email.send;
  email.send = async () => ({ ok: true });
  try {
    // Fire BOTH milestones for the same user; both should land.
    const r1 = await welcome.sendWelcomeIfFirst('lifecycle@example.com', { locale: 'en' });
    const r2 = await welcome.sendFirstActualWelcomeIfFirst('lifecycle@example.com', { locale: 'en', variance: sampleVariance() });
    assert.equal(r1.sent, true);
    assert.equal(r2.sent, true);
    assert.ok(await kv.get(welcome.welcomeKey('lifecycle@example.com')));
    assert.ok(await kv.get(welcome.firstActualKey('lifecycle@example.com')));
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

test('plans handler: first actual fires the celebration (with the right variance)', async () => {
  const plansHandler = require('../lib/handlers/plans');
  const email = require('../lib/email');

  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';

  const realSend = email.send;
  const sent = [];
  email.send = async (msg) => { sent.push(msg); return { ok: true, id: 'mock' }; };

  try {
    const sessionEmail = 'first-actual@example.com';
    const plan = await seedPlan(sessionEmail);
    const cookie = auth.buildSessionCookie(sessionEmail);
    const req = {
      method: 'POST',
      url: '/api/plans/' + plan.id + '/actual',
      headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
      query: { path: ['plans', plan.id, 'actual'] },
      // €31k actual vs the composed apparel-CN-PL snapshot (~€39.8k) →
      // variance is "under" (real cost lower than estimate).
      body: { landedEur: 31000 },
    };
    const res = { statusCode: 200, _h: {}, body: '', setHeader(k, v) { this._h[k] = v; }, end(b) { this.body = b; } };
    await plansHandler(req, res);
    assert.equal(res.statusCode, 200);

    await new Promise((r) => setTimeout(r, 30));

    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /Calibration data point/);
    // The variance copy is in the body — both EUR figures present.
    assert.match(sent[0].text, /€31,000/);
    assert.match(sent[0].text, /\(under budget\)/);

    // Idempotency key landed.
    const stored = await kv.get(welcome.firstActualKey(sessionEmail));
    assert.ok(stored);
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('plans handler: re-reporting an actual on the SAME plan does NOT re-fire', async () => {
  const plansHandler = require('../lib/handlers/plans');
  const email = require('../lib/email');

  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';

  const realSend = email.send;
  const sent = [];
  email.send = async (msg) => { sent.push(msg); return { ok: true, id: 'mock' }; };

  try {
    const sessionEmail = 'rerun@example.com';
    const plan = await seedPlan(sessionEmail);
    const cookie = auth.buildSessionCookie(sessionEmail);
    function reqFor(landedEur) {
      return {
        method: 'POST',
        url: '/api/plans/' + plan.id + '/actual',
        headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
        query: { path: ['plans', plan.id, 'actual'] },
        body: { landedEur },
      };
    }
    function res() {
      return { statusCode: 200, _h: {}, body: '', setHeader(k, v) { this._h[k] = v; }, end(b) { this.body = b; } };
    }

    await plansHandler(reqFor(31000), res());
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(sent.length, 1, 'first actual fires the celebration');

    // User corrects the actual.
    await plansHandler(reqFor(31500), res());
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(sent.length, 1, 'second actual on the same plan does NOT re-fire');
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('plans handler: logging an actual on a SECOND plan (after first) does NOT re-fire', async () => {
  const plansHandler = require('../lib/handlers/plans');
  const email = require('../lib/email');

  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';

  const realSend = email.send;
  const sent = [];
  email.send = async (msg) => { sent.push(msg); return { ok: true, id: 'mock' }; };

  try {
    const sessionEmail = 'two-plans@example.com';
    const plan1 = await seedPlan(sessionEmail);
    const plan2 = await seedPlan(sessionEmail);
    const cookie = auth.buildSessionCookie(sessionEmail);
    function reqFor(planId, landedEur) {
      return {
        method: 'POST',
        url: '/api/plans/' + planId + '/actual',
        headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
        query: { path: ['plans', planId, 'actual'] },
        body: { landedEur },
      };
    }
    function res() {
      return { statusCode: 200, _h: {}, body: '', setHeader(k, v) { this._h[k] = v; }, end(b) { this.body = b; } };
    }

    await plansHandler(reqFor(plan1.id, 31000), res());
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(sent.length, 1);

    // Log an actual on a DIFFERENT plan — not the first one.
    await plansHandler(reqFor(plan2.id, 28000), res());
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(sent.length, 1, 'second-plan actual does NOT re-fire');
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('plans handler: celebration honours stored locale (DE example)', async () => {
  const plansHandler = require('../lib/handlers/plans');
  const email = require('../lib/email');

  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  // User previously set DE on /account/preferences/.
  await notificationPrefs.setPrefs('de-actual@example.com', { locale: 'de' });

  const realSend = email.send;
  const sent = [];
  email.send = async (msg) => { sent.push(msg); return { ok: true, id: 'mock' }; };

  try {
    const sessionEmail = 'de-actual@example.com';
    const plan = await seedPlan(sessionEmail);
    const cookie = auth.buildSessionCookie(sessionEmail);
    const req = {
      method: 'POST',
      url: '/api/plans/' + plan.id + '/actual',
      headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
      query: { path: ['plans', plan.id, 'actual'] },
      body: { landedEur: 31000 },
    };
    const res = { statusCode: 200, _h: {}, body: '', setHeader(k, v) { this._h[k] = v; }, end(b) { this.body = b; } };
    await plansHandler(req, res);
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /Kalibrierungs-Datenpunkt/);
    // Same scenario as the EN test: €31k actual is BELOW the €39.8k
    // composed estimate, so the DE word is "unter", not "über".
    assert.match(sent[0].text, /unter Budget/);
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('plans handler: setActual succeeds even when the celebration path throws', async () => {
  const plansHandler = require('../lib/handlers/plans');
  const email = require('../lib/email');

  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';

  const realSend = email.send;
  email.send = async () => { throw new Error('synthetic Resend failure'); };

  try {
    const sessionEmail = 'resilient-actual@example.com';
    const plan = await seedPlan(sessionEmail);
    const cookie = auth.buildSessionCookie(sessionEmail);
    const req = {
      method: 'POST',
      url: '/api/plans/' + plan.id + '/actual',
      headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
      query: { path: ['plans', plan.id, 'actual'] },
      body: { landedEur: 31000 },
    };
    const res = { statusCode: 200, _h: {}, body: '', setHeader(k, v) { this._h[k] = v; }, end(b) { this.body = b; } };
    await plansHandler(req, res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.ok(body.plan && body.plan.actual);
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});
