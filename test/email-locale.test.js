// Sprint email-locale-v1 — locale plumbing tests for transactional emails.
//
// Covers:
//   - notification-prefs: locale defaults to 'en', round-trips, accepts
//     PL/DE, rejects/normalises unknowns, setLocaleIfMissing semantics,
//     getLocale fallback
//   - /api/account/preferences: locale surfaces in GET, POST writes,
//     allowedLocales returned, audit row carries locale change
//   - origin-suggest.formatLine: EN/PL/DE phrasing differs, falls back
//     to EN on unknown locale
//   - plan-revision cron: PL user gets PL subject + body
//   - weekly-digest cron: locale read from prefs
//   - plans handler: first plan save writes locale through
//   - /account/preferences/ UI: locale select renders + JS wires it

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const kv = require('../lib/intelligence/kv-store');
const notificationPrefs = require('../lib/notification-prefs');
const originSuggest = require('../lib/origin-suggest');

// ── notification-prefs locale surface ─────────────────

test('prefs: ALLOWED_LOCALES + DEFAULT_LOCALE exported', () => {
  assert.deepEqual([...notificationPrefs.ALLOWED_LOCALES], ['en', 'pl', 'de']);
  assert.equal(notificationPrefs.DEFAULT_LOCALE, 'en');
});

test('prefs: default getPrefs returns locale=en', async () => {
  kv._resetMemoryStore();
  const p = await notificationPrefs.getPrefs('newbie@example.com');
  assert.equal(p.locale, 'en');
});

test('prefs: setPrefs({ locale: "pl" }) round-trips', async () => {
  kv._resetMemoryStore();
  const stored = await notificationPrefs.setPrefs('user@example.com', { locale: 'pl' });
  assert.equal(stored.locale, 'pl');
  assert.equal((await notificationPrefs.getPrefs('user@example.com')).locale, 'pl');
});

test('prefs: setPrefs normalises case (DE → de) + falls back on unknown (fr → en)', async () => {
  kv._resetMemoryStore();
  await notificationPrefs.setPrefs('a@b.com', { locale: 'DE' });
  assert.equal((await notificationPrefs.getPrefs('a@b.com')).locale, 'de');
  await notificationPrefs.setPrefs('a@b.com', { locale: 'fr' });
  assert.equal((await notificationPrefs.getPrefs('a@b.com')).locale, 'en');
});

test('prefs: setPrefs preserves locale when omitted from partial', async () => {
  kv._resetMemoryStore();
  await notificationPrefs.setPrefs('combo@example.com', { locale: 'pl' });
  await notificationPrefs.setPrefs('combo@example.com', { planRevisionEmails: false });
  const p = await notificationPrefs.getPrefs('combo@example.com');
  assert.equal(p.locale, 'pl');
  assert.equal(p.planRevisionEmails, false);
});

test('prefs: setLocaleIfMissing writes when no prior record exists', async () => {
  kv._resetMemoryStore();
  const stored = await notificationPrefs.setLocaleIfMissing('first@example.com', 'de');
  assert.equal(stored.locale, 'de');
  assert.equal((await notificationPrefs.getPrefs('first@example.com')).locale, 'de');
});

test('prefs: setLocaleIfMissing does NOT overwrite an explicitly-set locale', async () => {
  kv._resetMemoryStore();
  await notificationPrefs.setPrefs('explicit@example.com', { locale: 'pl' });
  await notificationPrefs.setLocaleIfMissing('explicit@example.com', 'de'); // should no-op
  assert.equal((await notificationPrefs.getPrefs('explicit@example.com')).locale, 'pl');
});

test('prefs: setLocaleIfMissing is a no-op when wizard-locale is EN AND no record exists', async () => {
  kv._resetMemoryStore();
  // EN user with no prefs record — writing { locale: 'en' } would just
  // crystallise the default. Skip it; the user already gets the EN
  // behaviour from the default fallback.
  await notificationPrefs.setLocaleIfMissing('en-user@example.com', 'en');
  const raw = await kv.get(notificationPrefs.prefsKey('en-user@example.com'));
  assert.equal(raw, null, 'no KV record should be written for the EN-default path');
});

test('prefs: getLocale convenience returns the same as getPrefs(...).locale', async () => {
  kv._resetMemoryStore();
  await notificationPrefs.setPrefs('conv@example.com', { locale: 'pl' });
  assert.equal(await notificationPrefs.getLocale('conv@example.com'), 'pl');
  assert.equal(await notificationPrefs.getLocale('unknown@example.com'), 'en');
});

// ── /api/account/preferences ──────────────────────────

test('GET /api/account/preferences: returns locale + allowedLocales', async () => {
  const auth = require('../lib/auth');
  const accountHandler = require('../lib/handlers/account');
  kv._resetMemoryStore();
  const cookie = auth.buildSessionCookie('locale-get@example.com');
  const req = {
    method: 'GET',
    url: '/api/account/preferences',
    headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
    query: { path: ['account', 'preferences'] },
  };
  const res = { statusCode: 200, _h: {}, body: '', setHeader(k, v) { this._h[k] = v; }, end(b) { this.body = b; } };
  await accountHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.prefs.locale, 'en');
  assert.deepEqual(body.allowedLocales, ['en', 'pl', 'de']);
});

test('POST /api/account/preferences: { locale: "pl" } persists + emits audit row', async () => {
  const auth = require('../lib/auth');
  const accountHandler = require('../lib/handlers/account');
  const events = require('../lib/events');
  kv._resetMemoryStore();
  const cookie = auth.buildSessionCookie('locale-set@example.com');
  const req = {
    method: 'POST',
    url: '/api/account/preferences',
    headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
    query: { path: ['account', 'preferences'] },
    body: { locale: 'pl' },
  };
  const res = { statusCode: 200, _h: {}, body: '', setHeader(k, v) { this._h[k] = v; }, end(b) { this.body = b; } };
  await accountHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.prefs.locale, 'pl');
  // Audit row carries the locale change.
  const log = await events.list({ type: 'notification_prefs_updated' });
  const row = log.find((e) => e.email === 'locale-set@example.com');
  assert.ok(row, 'audit row written');
  assert.equal(row.changes.locale, 'pl');
});

// ── origin-suggest.formatLine PL/DE ──────────────────

function makeSuggestion() {
  return {
    origin: 'VN', userOrigin: 'CN',
    savingEur: 4200, savingPct: 32,
    preferential: 'EVFTA', transportMode: 'sea',
    perShipmentLandedTotal: 8900, annualSavingEur: null,
  };
}

test('origin-suggest.formatLine: EN phrasing (default)', () => {
  const line = originSuggest.formatLine(makeSuggestion());
  assert.match(line, /By the way/);
  assert.match(line, /from VN under EVFTA/);
  assert.match(line, /alternatives matrix/);
});

test('origin-suggest.formatLine: PL phrasing', () => {
  const line = originSuggest.formatLine(makeSuggestion(), { locale: 'pl' });
  assert.match(line, /Przy okazji/);
  assert.match(line, /z VN w ramach EVFTA/);
  assert.match(line, /macierz alternatyw/);
});

test('origin-suggest.formatLine: DE phrasing', () => {
  const line = originSuggest.formatLine(makeSuggestion(), { locale: 'de' });
  assert.match(line, /Übrigens/);
  assert.match(line, /von VN unter EVFTA/);
  assert.match(line, /Alternativen-Matrix/);
});

test('origin-suggest.formatLine: unknown locale falls back to EN', () => {
  const line = originSuggest.formatLine(makeSuggestion(), { locale: 'fr' });
  assert.match(line, /By the way/);
});

test('origin-suggest.formatLine: null suggestion stays empty regardless of locale', () => {
  for (const locale of ['en', 'pl', 'de', 'fr', '']) {
    assert.equal(originSuggest.formatLine(null, { locale }), '');
  }
});

// ── plan-revision cron: PL user gets PL subject + body ─

test('plan-revision-emails: PL-locale user receives Polish subject + body', async () => {
  const savedPlans = require('../lib/saved-plans');
  const planDiff = require('../lib/plan-diff');
  const startHandler = require('../lib/handlers/start');
  const cronHandler = require('../lib/handlers/cron');
  const email = require('../lib/email');

  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';

  const BASE = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 };
  const current = planDiff.extractSnapshot(await startHandler.composePlan(BASE));
  const stale = Object.assign({}, current, { perShipmentLandedTotal: current.perShipmentLandedTotal * 0.5 });
  await savedPlans.savePlan({ email: 'pl-user@example.com', inputs: BASE, snapshot: stale });
  await notificationPrefs.setPrefs('pl-user@example.com', { locale: 'pl' });

  const realSend = email.send;
  const sent = [];
  email.send = async (msg) => { sent.push(msg); return { ok: true, id: 'mock' }; };
  try {
    const r = await cronHandler.runPlanRevisionEmails();
    assert.equal(r.sent, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /Rewizja planu/);
    assert.match(sent[0].text, /Twój zapisany plan/);
    assert.match(sent[0].text, /Wypisz się jednym kliknięciem/);
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('plan-revision-emails: DE-locale user receives German subject + body', async () => {
  const savedPlans = require('../lib/saved-plans');
  const planDiff = require('../lib/plan-diff');
  const startHandler = require('../lib/handlers/start');
  const cronHandler = require('../lib/handlers/cron');
  const email = require('../lib/email');

  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';

  const BASE = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 };
  const current = planDiff.extractSnapshot(await startHandler.composePlan(BASE));
  const stale = Object.assign({}, current, { perShipmentLandedTotal: current.perShipmentLandedTotal * 0.5 });
  await savedPlans.savePlan({ email: 'de-user@example.com', inputs: BASE, snapshot: stale });
  await notificationPrefs.setPrefs('de-user@example.com', { locale: 'de' });

  const realSend = email.send;
  const sent = [];
  email.send = async (msg) => { sent.push(msg); return { ok: true, id: 'mock' }; };
  try {
    const r = await cronHandler.runPlanRevisionEmails();
    assert.equal(r.sent, 1);
    assert.match(sent[0].subject, /Plan-Revision/);
    assert.match(sent[0].text, /Ihr gespeicherter Plan/);
    assert.match(sent[0].text, /Mit einem Klick abmelden/);
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

// ── weekly-digest cron: locale read from prefs ────────

test('weekly-user-digest: PL-locale user receives Polish subject', async () => {
  const savedPlans = require('../lib/saved-plans');
  const planDiff = require('../lib/plan-diff');
  const startHandler = require('../lib/handlers/start');
  const cronHandler = require('../lib/handlers/cron');
  const email = require('../lib/email');

  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';

  const BASE = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 };
  const snapshot = planDiff.extractSnapshot(await startHandler.composePlan(BASE));
  await savedPlans.savePlan({ email: 'pl-digest@example.com', inputs: BASE, snapshot });
  await notificationPrefs.setPrefs('pl-digest@example.com', { locale: 'pl' });

  const realSend = email.send;
  const sent = [];
  email.send = async (msg) => { sent.push(msg); return { ok: true, id: 'mock' }; };
  try {
    const r = await cronHandler.runWeeklyUserDigest();
    assert.equal(r.sent, 1);
    assert.match(sent[0].subject, /OrcaTrade tygodniowo/);
    assert.match(sent[0].text, /Oto stan Twoich zapisanych planów/);
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

// ── plans handler: first save writes locale through ──

test('plans handler: first save with locale="pl" persists prefs.locale=pl', async () => {
  const auth = require('../lib/auth');
  const plansHandler = require('../lib/handlers/plans');
  const email = require('../lib/email');

  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const realSend = email.send;
  email.send = async () => ({ ok: true, id: 'mock' });

  try {
    const sessionEmail = 'first-save-pl@example.com';
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

    // Drain microtasks so the fire-and-forget setLocaleIfMissing resolves.
    await new Promise((r) => setTimeout(r, 20));

    const locale = await notificationPrefs.getLocale(sessionEmail);
    assert.equal(locale, 'pl');
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

test('plans handler: locale write-through respects existing explicit locale', async () => {
  const auth = require('../lib/auth');
  const plansHandler = require('../lib/handlers/plans');
  const email = require('../lib/email');

  kv._resetMemoryStore();
  process.env.RESEND_API_KEY = 'test-key';
  const realSend = email.send;
  email.send = async () => ({ ok: true, id: 'mock' });

  try {
    const sessionEmail = 'pre-set@example.com';
    // User already chose DE on /account/preferences/.
    await notificationPrefs.setPrefs(sessionEmail, { locale: 'de' });

    const cookie = auth.buildSessionCookie(sessionEmail);
    const req = {
      method: 'POST',
      url: '/api/plans',
      headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
      query: { path: ['plans'] },
      body: {
        inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 },
        locale: 'pl', // wizard run on the PL homepage — should NOT overwrite DE.
      },
    };
    const res = { statusCode: 200, _h: {}, body: '', setHeader(k, v) { this._h[k] = v; }, end(b) { this.body = b; } };
    await plansHandler(req, res);
    assert.equal(res.statusCode, 200);
    await new Promise((r) => setTimeout(r, 20));

    const locale = await notificationPrefs.getLocale(sessionEmail);
    assert.equal(locale, 'de', 'explicit user-set locale must be preserved');
  } finally {
    email.send = realSend;
    delete process.env.RESEND_API_KEY;
  }
});

// ── /account/preferences/ UI contract ─────────────────

test('/account/preferences/index.html includes the locale selector', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'preferences', 'index.html'), 'utf8');
  assert.match(html, /data-pref=["']locale["']/);
  assert.match(html, /<select[^>]*data-pref-key=["']locale["']/);
  assert.match(html, /<option value=["']en["']/);
  assert.match(html, /<option value=["']pl["']/);
  assert.match(html, /<option value=["']de["']/);
});

test('/account/preferences/app.js wires the locale select to a POST', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'preferences', 'app.js'), 'utf8');
  assert.match(js, /data-pref-key=["']locale["']/);
  assert.match(js, /saveLocale/);
  // POSTs the locale alongside the boolean toggles in the same body shape.
  assert.match(js, /JSON\.stringify\(\{ locale: nextValue \}\)/);
});
