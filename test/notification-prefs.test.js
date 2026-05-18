// Sprint prefs-v1 — user notification preferences + one-click unsubscribe.
//
// Five layers:
//   1. lib/notification-prefs.js pure helpers (defaults + CRUD + isEnabled).
//   2. HMAC unsubscribe-token sign/verify round-trip + tamper rejection.
//   3. /api/account/preferences (user-session gated GET + POST + audit).
//   4. /api/unsubscribe?token=… (public, HTML response, flips pref).
//   5. cron runPlanRevisionEmails skips opted-out users + email body
//      includes the unsubscribe URL.

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auth = require('../lib/auth');
const notificationPrefs = require('../lib/notification-prefs');
const events = require('../lib/events');
const kv = require('../lib/intelligence/kv-store');
const accountHandler = require('../lib/handlers/account');
const unsubscribeHandler = require('../lib/handlers/unsubscribe');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(body) { this.body = body || ''; return this; },
  };
}

function reqWithCookie(method, email, extras = {}) {
  const cookie = auth.buildSessionCookie(email);
  return {
    method,
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
    body: {},
    ...extras,
  };
}

// ── Pure helpers ──────────────────────────────────────

test('defaultPrefs: every shipping pref defaults to true (opt-out semantics)', () => {
  const d = notificationPrefs.defaultPrefs();
  for (const k of notificationPrefs.PREF_KEYS) {
    assert.equal(d[k], true, `${k} default must be true`);
  }
});

test('getPrefs: missing record → default (true) for every key', async () => {
  kv._resetMemoryStore();
  const p = await notificationPrefs.getPrefs('new@example.com');
  assert.equal(p.planRevisionEmails, true);
});

test('getPrefs: empty/null email → defaults (no crash)', async () => {
  assert.equal((await notificationPrefs.getPrefs('')).planRevisionEmails, true);
  assert.equal((await notificationPrefs.getPrefs(null)).planRevisionEmails, true);
});

test('setPrefs: writes + returns merged record', async () => {
  kv._resetMemoryStore();
  const r = await notificationPrefs.setPrefs('me@example.com', { planRevisionEmails: false });
  assert.equal(r.planRevisionEmails, false);
  assert.match(r.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  const refetched = await notificationPrefs.getPrefs('me@example.com');
  assert.equal(refetched.planRevisionEmails, false);
});

test('setPrefs: rejects empty email', async () => {
  await assert.rejects(() => notificationPrefs.setPrefs('', { planRevisionEmails: false }), /email required/);
});

test('setPrefs: silently drops unknown pref keys (forward-compat shape guard)', async () => {
  kv._resetMemoryStore();
  await notificationPrefs.setPrefs('me@example.com', {
    planRevisionEmails: false,
    bogusKey: true,                       // unknown — must be dropped
    anotherUnknownPref: 'sneaky',
  });
  const stored = await kv.get(notificationPrefs.prefsKey('me@example.com'));
  assert.equal(stored.planRevisionEmails, false);
  assert.equal(stored.bogusKey, undefined);
  assert.equal(stored.anotherUnknownPref, undefined);
});

test('isEnabled: true by default, false after setPrefs(...false)', async () => {
  kv._resetMemoryStore();
  assert.equal(await notificationPrefs.isEnabled('a@x.c', 'planRevisionEmails'), true);
  await notificationPrefs.setPrefs('a@x.c', { planRevisionEmails: false });
  assert.equal(await notificationPrefs.isEnabled('a@x.c', 'planRevisionEmails'), false);
});

test('isEnabled: unknown pref key returns false (no guessable behaviour)', async () => {
  assert.equal(await notificationPrefs.isEnabled('a@x.c', 'unknownKey'), false);
});

// ── Unsubscribe-token round-trip ──────────────────────

test('generateUnsubscribeToken: produces verifiable token', () => {
  const t = notificationPrefs.generateUnsubscribeToken('me@example.com');
  assert.match(t, /^[A-Za-z0-9_-]+\.[a-f0-9]+$/);
  assert.equal(notificationPrefs.verifyUnsubscribeToken(t), 'me@example.com');
});

test('generateUnsubscribeToken: case + trim normalised in result', () => {
  const t1 = notificationPrefs.generateUnsubscribeToken('  ME@Example.COM  ');
  assert.equal(notificationPrefs.verifyUnsubscribeToken(t1), 'me@example.com');
});

test('verifyUnsubscribeToken: tampered signature → null', () => {
  const t = notificationPrefs.generateUnsubscribeToken('me@example.com');
  const [encoded, sig] = t.split('.');
  // Flip one hex char in the sig.
  const flipped = sig.slice(0, -1) + (sig.slice(-1) === '0' ? '1' : '0');
  assert.equal(notificationPrefs.verifyUnsubscribeToken(encoded + '.' + flipped), null);
});

test('verifyUnsubscribeToken: malformed shapes → null', () => {
  assert.equal(notificationPrefs.verifyUnsubscribeToken(null), null);
  assert.equal(notificationPrefs.verifyUnsubscribeToken(''), null);
  assert.equal(notificationPrefs.verifyUnsubscribeToken('garbage'), null);
  assert.equal(notificationPrefs.verifyUnsubscribeToken('one.two.three'), null);
});

test('verifyUnsubscribeToken: empty parts → null', () => {
  assert.equal(notificationPrefs.verifyUnsubscribeToken('.abcdef'), null);
  assert.equal(notificationPrefs.verifyUnsubscribeToken('encoded.'), null);
});

// ── /api/account/preferences (user-session gated) ─────

test('GET /api/account/preferences: 401 without session', async () => {
  const req = {
    method: 'GET', headers: {},
    query: { path: ['account', 'preferences'] },
    url: '/api/account/preferences',
  };
  const res = mockRes();
  await accountHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test('GET /api/account/preferences: returns defaults for new user + keys list', async () => {
  kv._resetMemoryStore();
  const req = reqWithCookie('GET', 'fresh@example.com', {
    query: { path: ['account', 'preferences'] },
    url: '/api/account/preferences',
  });
  const res = mockRes();
  await accountHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.prefs.planRevisionEmails, true);
  // The keys list lets a future UI render new prefs without a client redeploy.
  assert.ok(Array.isArray(body.keys));
  assert.ok(body.keys.includes('planRevisionEmails'));
});

test('POST /api/account/preferences: writes + audit-emits the diff', async () => {
  kv._resetMemoryStore();
  const req = reqWithCookie('POST', 'me@example.com', {
    body: { planRevisionEmails: false },
    query: { path: ['account', 'preferences'] },
    url: '/api/account/preferences',
  });
  const res = mockRes();
  await accountHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.prefs.planRevisionEmails, false);
  // Audit row carries ONLY the changed key.
  const hits = (await events.list({})).filter((e) => e.type === 'notification_prefs_updated');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].email, 'me@example.com');
  assert.deepEqual(hits[0].changes, { planRevisionEmails: false });
});

test('POST /api/account/preferences: no-op (already opted out) emits NO audit row', async () => {
  kv._resetMemoryStore();
  await notificationPrefs.setPrefs('me@example.com', { planRevisionEmails: false });
  const req = reqWithCookie('POST', 'me@example.com', {
    body: { planRevisionEmails: false },          // already off
    query: { path: ['account', 'preferences'] },
    url: '/api/account/preferences',
  });
  const res = mockRes();
  await accountHandler(req, res);
  assert.equal(res.statusCode, 200);
  const hits = (await events.list({})).filter((e) => e.type === 'notification_prefs_updated');
  assert.equal(hits.length, 0, 'no-op POST should not emit an audit row');
});

// ── /api/unsubscribe (public, HMAC-token gated) ───────

test('unsubscribe: 405 on non-GET', async () => {
  const req = { method: 'POST', headers: {}, query: {}, url: '/api/unsubscribe' };
  const res = mockRes();
  await unsubscribeHandler(req, res);
  assert.equal(res.statusCode, 405);
});

test('unsubscribe: 400 + HTML page on missing/invalid token', async () => {
  const req = { method: 'GET', headers: {}, query: { token: '' }, url: '/api/unsubscribe' };
  const res = mockRes();
  await unsubscribeHandler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /could not be verified|invalid/i);
});

test('unsubscribe: 400 on tampered token', async () => {
  const valid = notificationPrefs.generateUnsubscribeToken('me@example.com');
  const tampered = valid.replace(/.$/, valid.endsWith('0') ? '1' : '0');
  const req = { method: 'GET', headers: {}, query: { token: tampered }, url: '/api/unsubscribe?token=' + tampered };
  const res = mockRes();
  await unsubscribeHandler(req, res);
  assert.equal(res.statusCode, 400);
});

test('unsubscribe: valid token flips pref + emits audit + renders confirmation', async () => {
  kv._resetMemoryStore();
  const token = notificationPrefs.generateUnsubscribeToken('opt-out@example.com');
  const req = { method: 'GET', headers: {}, query: { token }, url: '/api/unsubscribe?token=' + token };
  const res = mockRes();
  await unsubscribeHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /unsubscribed/i);
  // Pref was flipped.
  const prefs = await notificationPrefs.getPrefs('opt-out@example.com');
  assert.equal(prefs.planRevisionEmails, false);
  // Audit row emitted.
  const hits = (await events.list({})).filter((e) => e.type === 'plan_revision_emails_unsubscribed');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].email, 'opt-out@example.com');
});

test('unsubscribe: idempotent (re-clicking still succeeds)', async () => {
  kv._resetMemoryStore();
  const token = notificationPrefs.generateUnsubscribeToken('again@example.com');
  await notificationPrefs.setPrefs('again@example.com', { planRevisionEmails: false });
  const req = { method: 'GET', headers: {}, query: { token }, url: '/api/unsubscribe?token=' + token };
  const res = mockRes();
  await unsubscribeHandler(req, res);
  assert.equal(res.statusCode, 200);
});

// ── Cron skip behaviour ───────────────────────────────

// Pure source-level assertions on the cron wiring. A full integration
// test would need composePlan to return a snapshot in the test env —
// but TARIC is disabled in tests, so composePlan returns null and the
// loop short-circuits before reaching the opt-out check. The behaviour
// we want to pin is "the wiring exists" + "the result schema includes
// skippedOptOut" + "the email body has the unsubscribe URL". Those
// three together rule out the regression mode (someone dropping the
// opt-out check from the cron in a future refactor).

test('cron: source wires isEnabled("planRevisionEmails") + skippedOptOut counter + unsubscribe URL', () => {
  const cron = fs.readFileSync(path.join(__dirname, '..', 'lib', 'handlers', 'cron.js'), 'utf8');
  // The opt-out check is wired.
  assert.match(cron, /notificationPrefs\.isEnabled\([^,]+,\s*['"]planRevisionEmails['"]\)/);
  // The counter is initialised AND surfaced on the result.
  assert.match(cron, /let skippedOptOut\s*=\s*0/);
  assert.match(cron, /skippedOptOut(?:,|\s*\})/);
  // Email body carries the unsubscribe URL placeholder.
  assert.match(cron, /\/api\/unsubscribe\?token=/);
});

test('cron: runPlanRevisionEmails result schema includes skippedOptOut', async () => {
  // Confirm the new counter shows up in the returned object even when
  // there are no plans to scan. Avoids the TARIC-dependent snapshot path
  // entirely.
  const cron = require('../lib/handlers/cron');
  const prev = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  kv._resetMemoryStore();
  try {
    const r = await cron.runPlanRevisionEmails({ dryRun: true, maxPlans: 1 });
    assert.equal(r.ok, true);
    assert.ok('skippedOptOut' in r,
      'result must include skippedOptOut so dashboards + audits can read it');
    assert.equal(r.skippedOptOut, 0);
  } finally {
    if (prev === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prev;
  }
});

// ── ALLOWED_TYPES surface ─────────────────────────────

test('events.ALLOWED_TYPES includes notification_prefs_updated + plan_revision_emails_unsubscribed', () => {
  assert.ok(events.ALLOWED_TYPES.has('notification_prefs_updated'));
  assert.ok(events.ALLOWED_TYPES.has('plan_revision_emails_unsubscribed'));
});

// ── /account/preferences/ UI markup ───────────────────

test('/account/preferences/ page exists, noindex, with a toggle for planRevisionEmails', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'preferences', 'index.html'), 'utf8');
  assert.ok(html.length > 1200);
  assert.match(html, /<meta name="robots" content="noindex,\s*nofollow"/i);
  assert.match(html, /data-pref-key=["']planRevisionEmails["']/);
});

test('/account/preferences/app.js GETs + POSTs the prefs endpoint', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'preferences', 'app.js'), 'utf8');
  assert.match(js, /fetch\(['"]\/api\/account\/preferences['"]/);
  assert.match(js, /method:\s*['"]POST['"]/);
  // Reverts the switch on failure (UX: never claim a save we didn't make).
  assert.match(js, /input\.checked\s*=\s*!nextValue/);
});

test('/account/ quick-links includes the preferences page', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'index.html'), 'utf8');
  assert.match(html, /href=["']\/account\/preferences\/["']/);
  assert.match(html, /Email preferences/i);
});

test('api/[...path].js dispatcher registers the unsubscribe handler', () => {
  const dispatcher = fs.readFileSync(path.join(__dirname, '..', 'api/[...path].js'), 'utf8');
  assert.match(dispatcher, /unsubscribe: require\('\.\.\/lib\/handlers\/unsubscribe'\)/);
});

// ── Module surface ────────────────────────────────────

test('lib/notification-prefs.js exports the v1 surface', () => {
  for (const name of [
    'PREFS_KEY_PREFIX', 'PREF_KEYS', 'getPrefs', 'setPrefs',
    'isEnabled', 'generateUnsubscribeToken', 'verifyUnsubscribeToken',
  ]) {
    assert.ok(notificationPrefs[name], `${name} exported`);
  }
});
