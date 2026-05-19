// Sprint first-plan-welcome-v1 — tests for lib/welcome.js + the
// integration with the plans handler.
//
// Covers:
//   - Template surface (EN/PL/DE bodies + subject lines, unknown-locale
//     EN-fallback, optional first-name personalisation)
//   - sendWelcomeIfFirst lifecycle (not-configured, idempotency,
//     successful send writes dedupe, send-failure does NOT write dedupe,
//     unconfigured KV doesn't crash)
//   - Plans-handler integration (first save fires welcome, second save
//     does not, locale carried through, save still succeeds when
//     welcome path fails)
//   - Wizard contract (start/app.js POSTs locale alongside inputs)

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const welcome = require('../lib/welcome');
const kv = require('../lib/intelligence/kv-store');

// ── normaliseLocale ───────────────────────────────────

test('normaliseLocale: known locales pass through (lowercased)', () => {
  assert.equal(welcome.normaliseLocale('en'), 'en');
  assert.equal(welcome.normaliseLocale('PL'), 'pl');
  assert.equal(welcome.normaliseLocale('De'), 'de');
});

test('normaliseLocale: unknowns fall back to en', () => {
  assert.equal(welcome.normaliseLocale('fr'), 'en');
  assert.equal(welcome.normaliseLocale(''), 'en');
  assert.equal(welcome.normaliseLocale(null), 'en');
  assert.equal(welcome.normaliseLocale(undefined), 'en');
});

// ── buildWelcomeEmail ────────────────────────────────

test('buildWelcomeEmail: EN body includes the three CTAs + first-name personalisation', () => {
  const { subject, text } = welcome.buildWelcomeEmail({
    locale: 'en', firstName: 'Oskar',
    planUrl: 'https://orcatrade.pl/account/plans/',
    wizardUrl: 'https://orcatrade.pl/start/',
    prefsUrl: 'https://orcatrade.pl/account/preferences/',
  });
  assert.match(subject, /first plan/i);
  assert.match(text, /Hi Oskar,/);
  assert.match(text, /Log a real outcome/);
  assert.match(text, /Save more plans/);
  assert.match(text, /Share a plan/);
  assert.match(text, /https:\/\/orcatrade\.pl\/account\/plans\//);
  assert.match(text, /https:\/\/orcatrade\.pl\/start\//);
  assert.match(text, /https:\/\/orcatrade\.pl\/account\/preferences\//);
});

test('buildWelcomeEmail: omits first-name space when missing', () => {
  const { text } = welcome.buildWelcomeEmail({ locale: 'en' });
  assert.match(text, /^Hi,/);
  assert.doesNotMatch(text, /Hi\s+,/);
});

test('buildWelcomeEmail: PL + DE produce localised subjects', () => {
  const pl = welcome.buildWelcomeEmail({ locale: 'pl' });
  const de = welcome.buildWelcomeEmail({ locale: 'de' });
  assert.match(pl.subject, /pierwszy plan/i);
  assert.match(de.subject, /erster Plan/i);
  // Locale-specific opener phrasing.
  assert.match(pl.text, /Cześć/);
  assert.match(de.text, /Hallo/);
});

test('buildWelcomeEmail: unknown locale falls back to EN', () => {
  const r = welcome.buildWelcomeEmail({ locale: 'fr' });
  assert.match(r.subject, /first plan/i);
});

// ── sendWelcomeIfFirst lifecycle ──────────────────────

test('sendWelcomeIfFirst: not-configured when RESEND_API_KEY unset', async () => {
  kv._resetMemoryStore();
  const saved = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    const r = await welcome.sendWelcomeIfFirst('user@example.com');
    assert.equal(r.sent, false);
    assert.equal(r.reason, 'not-configured');
  } finally {
    if (saved !== undefined) process.env.RESEND_API_KEY = saved;
  }
});

test('sendWelcomeIfFirst: empty email → no-email', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  try {
    const r = await welcome.sendWelcomeIfFirst('');
    assert.equal(r.sent, false);
    assert.equal(r.reason, 'no-email');
  } finally {
    delete process.env.RESEND_API_KEY;
  }
});

test('sendWelcomeIfFirst: successful send writes idempotency key', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const email = require('../lib/email');
  const realSend = email.send;
  email.send = async () => ({ ok: true, id: 'test-id' });
  try {
    const r = await welcome.sendWelcomeIfFirst('first@example.com', { locale: 'pl' });
    assert.equal(r.sent, true);
    assert.equal(r.locale, 'pl');
    // Idempotency key persisted with the chosen locale.
    const stored = await kv.get(welcome.welcomeKey('first@example.com'));
    assert.ok(stored);
    assert.equal(stored.locale, 'pl');
    assert.ok(stored.sentAt);
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('sendWelcomeIfFirst: idempotent — second call with the same email skips', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const email = require('../lib/email');
  const realSend = email.send;
  let sendCount = 0;
  email.send = async () => { sendCount++; return { ok: true, id: 'x' }; };
  try {
    await welcome.sendWelcomeIfFirst('dupe@example.com', { locale: 'en' });
    await welcome.sendWelcomeIfFirst('dupe@example.com', { locale: 'pl' });
    assert.equal(sendCount, 1);
    // The second call returns the dedupe reason — caller treats it
    // identically to a success (the welcome IS handled).
    const second = await welcome.sendWelcomeIfFirst('dupe@example.com');
    assert.equal(second.sent, false);
    assert.equal(second.reason, 'already-sent');
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('sendWelcomeIfFirst: case-insensitive idempotency (Email → email)', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const email = require('../lib/email');
  const realSend = email.send;
  let sendCount = 0;
  email.send = async () => { sendCount++; return { ok: true }; };
  try {
    await welcome.sendWelcomeIfFirst('Mixed@Case.com');
    const second = await welcome.sendWelcomeIfFirst('mixed@case.com');
    assert.equal(sendCount, 1);
    assert.equal(second.sent, false);
    assert.equal(second.reason, 'already-sent');
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('sendWelcomeIfFirst: send-failure does NOT write dedupe (allows retry)', async () => {
  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const email = require('../lib/email');
  const realSend = email.send;
  email.send = async () => ({ ok: false, reason: 'simulated upstream error' });
  try {
    const r = await welcome.sendWelcomeIfFirst('retry@example.com');
    assert.equal(r.sent, false);
    // No idempotency key written — a future call can retry.
    const stored = await kv.get(welcome.welcomeKey('retry@example.com'));
    assert.equal(stored, null);
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

// ── Plans handler integration ─────────────────────────

test('plans handler: first save triggers welcome (mocked Resend)', async () => {
  const savedPlans = require('../lib/saved-plans');
  const plansHandler = require('../lib/handlers/plans');
  const auth = require('../lib/auth');
  const email = require('../lib/email');

  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';

  const realSend = email.send;
  const sent = [];
  email.send = async (msg) => { sent.push(msg); return { ok: true, id: 'mock' }; };

  try {
    const sessionEmail = 'newbie@example.com';
    const cookie = auth.buildSessionCookie(sessionEmail);
    const req = {
      method: 'POST',
      url: '/api/plans',
      headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
      query: { path: ['plans'] },
      body: {
        inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 },
        locale: 'pl',
      },
    };
    const res = { statusCode: 200, _h: {}, body: '', setHeader(k, v) { this._h[k] = v; }, end(b) { this.body = b; } };
    await plansHandler(req, res);
    assert.equal(res.statusCode, 200);

    // Drain microtasks so the fire-and-forget welcome resolves.
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(sent.length, 1);
    // Locale carried through.
    assert.match(sent[0].subject, /pierwszy plan/i);
    assert.equal(sent[0].to, sessionEmail);

    // Idempotency key landed.
    const stored = await kv.get(welcome.welcomeKey(sessionEmail));
    assert.ok(stored);
    assert.equal(stored.locale, 'pl');
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('plans handler: second save does NOT re-trigger welcome', async () => {
  const plansHandler = require('../lib/handlers/plans');
  const auth = require('../lib/auth');
  const email = require('../lib/email');

  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';

  const realSend = email.send;
  const sent = [];
  email.send = async (msg) => { sent.push(msg); return { ok: true, id: 'mock' }; };

  try {
    const sessionEmail = 'twice@example.com';
    const cookie = auth.buildSessionCookie(sessionEmail);
    function req(body) {
      return {
        method: 'POST',
        url: '/api/plans',
        headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
        query: { path: ['plans'] },
        body,
      };
    }
    function res() {
      return { statusCode: 200, _h: {}, body: '', setHeader(k, v) { this._h[k] = v; }, end(b) { this.body = b; } };
    }
    const inputs = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 };

    const res1 = res();
    await plansHandler(req({ inputs, locale: 'en' }), res1);
    assert.equal(res1.statusCode, 200);

    const res2 = res();
    await plansHandler(req({ inputs, locale: 'en', label: 'second' }), res2);
    assert.equal(res2.statusCode, 200);

    await new Promise((r) => setTimeout(r, 20));
    assert.equal(sent.length, 1, 'welcome must fire exactly once across two saves');
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('plans handler: save succeeds even when welcome path throws', async () => {
  const plansHandler = require('../lib/handlers/plans');
  const auth = require('../lib/auth');
  const email = require('../lib/email');

  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';

  const realSend = email.send;
  // Simulate a Resend network failure. The plan must still save + the
  // 200 response must reach the user; the welcome simply doesn't fire.
  email.send = async () => { throw new Error('simulated network error'); };

  try {
    const sessionEmail = 'resilient@example.com';
    const cookie = auth.buildSessionCookie(sessionEmail);
    const req = {
      method: 'POST',
      url: '/api/plans',
      headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
      query: { path: ['plans'] },
      body: {
        inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 },
        locale: 'en',
      },
    };
    const res = { statusCode: 200, _h: {}, body: '', setHeader(k, v) { this._h[k] = v; }, end(b) { this.body = b; } };
    await plansHandler(req, res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.ok(body.plan);
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

// ── Wizard contract ───────────────────────────────────

test('start/app.js POSTs locale alongside inputs on /api/plans', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'start', 'app.js'), 'utf8');
  // The save-plan fetch carries both inputs + locale in the body.
  assert.match(js, /fetch\('\/api\/plans'/);
  assert.match(js, /JSON\.stringify\(\{ inputs: plan\.inputs, locale: LOCALE \}\)/);
});

// ── Module surface ────────────────────────────────────

test('welcome module exposes the v1 surface', () => {
  for (const name of ['WELCOME_KEY_PREFIX', 'LOCALES', 'ALLOWED_LOCALES', 'welcomeKey', 'normaliseLocale', 'buildWelcomeEmail', 'sendWelcomeIfFirst']) {
    assert.ok(welcome[name] !== undefined, name + ' exported');
  }
});
