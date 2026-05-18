// Sprint admin-session-auth — tests for lib/admin-auth.js.
//
// Covers the env-driven allowlist parsing, isAdminEmail normalisation,
// isConfigured / 503 path, and the two-path verifyAdmin gate (session
// cookie when email is on the allowlist, OR legacy ORCATRADE_LEADS_TOKEN
// via X-Admin-Token / ?token=).

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');

const auth = require('../lib/auth');
const adminAuth = require('../lib/admin-auth');

function withEnv(overrides, fn) {
  const prev = {};
  for (const k of Object.keys(overrides)) {
    prev[k] = process.env[k];
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  return Promise.resolve(fn()).finally(() => {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });
}

function reqWithCookie(email) {
  const cookie = auth.buildSessionCookie(email);
  return { method: 'GET', headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) } };
}

function reqWithToken(token, { via = 'header' } = {}) {
  if (via === 'header') {
    return { method: 'GET', headers: { 'x-admin-token': token }, url: '/api/leads' };
  }
  return { method: 'GET', headers: {}, url: '/api/leads?token=' + encodeURIComponent(token) };
}

function reqAnon() {
  return { method: 'GET', headers: {}, url: '/api/leads' };
}

// ── Env parsing + isAdminEmail ────────────────────────

test('adminEmailList: empty when env unset', () => withEnv({ ORCATRADE_ADMIN_EMAILS: undefined }, () => {
  assert.deepEqual(adminAuth.adminEmailList(), []);
}));

test('adminEmailList: splits comma-separated list, lowercases, trims, drops empties', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: ' Admin@Orcatrade.PL , other@example.com,,   ' }, () => {
    assert.deepEqual(adminAuth.adminEmailList(), ['admin@orcatrade.pl', 'other@example.com']);
  })
);

test('isAdminEmail: true for listed (case-insensitive), false for unknown', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: 'oskar@orcatrade.pl' }, () => {
    assert.equal(adminAuth.isAdminEmail('oskar@orcatrade.pl'), true);
    assert.equal(adminAuth.isAdminEmail('OSKAR@orcatrade.pl'), true);
    assert.equal(adminAuth.isAdminEmail('  oskar@orcatrade.pl  '), true);
    assert.equal(adminAuth.isAdminEmail('other@example.com'), false);
    assert.equal(adminAuth.isAdminEmail(''), false);
    assert.equal(adminAuth.isAdminEmail(null), false);
    assert.equal(adminAuth.isAdminEmail(undefined), false);
  })
);

test('isAdminEmail: empty env → never admin', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: undefined }, () => {
    assert.equal(adminAuth.isAdminEmail('oskar@orcatrade.pl'), false);
  })
);

// ── isConfigured ──────────────────────────────────────

test('isConfigured: false when neither env var set', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: undefined, ORCATRADE_LEADS_TOKEN: undefined }, () => {
    assert.equal(adminAuth.isConfigured(), false);
  })
);

test('isConfigured: true when admin emails set', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: 'a@b.com', ORCATRADE_LEADS_TOKEN: undefined }, () => {
    assert.equal(adminAuth.isConfigured(), true);
  })
);

test('isConfigured: true when token set', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: undefined, ORCATRADE_LEADS_TOKEN: 'secret' }, () => {
    assert.equal(adminAuth.isConfigured(), true);
  })
);

// ── verifyAdmin: 503 path ─────────────────────────────

test('verifyAdmin: 503 when neither env var set', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: undefined, ORCATRADE_LEADS_TOKEN: undefined }, async () => {
    const v = await adminAuth.verifyAdmin(reqAnon());
    assert.equal(v.ok, false);
    assert.equal(v.statusCode, 503);
    assert.match(v.error, /not configured/i);
  })
);

// ── verifyAdmin: session-cookie path ──────────────────

test('verifyAdmin: session-cookie path succeeds when email on allowlist', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: 'oskar@orcatrade.pl', ORCATRADE_LEADS_TOKEN: undefined }, async () => {
    const v = await adminAuth.verifyAdmin(reqWithCookie('oskar@orcatrade.pl'));
    assert.equal(v.ok, true);
    assert.equal(v.mode, 'session');
    assert.equal(v.email, 'oskar@orcatrade.pl');
  })
);

test('verifyAdmin: session-cookie path rejects when email not on allowlist', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: 'oskar@orcatrade.pl', ORCATRADE_LEADS_TOKEN: undefined }, async () => {
    const v = await adminAuth.verifyAdmin(reqWithCookie('intruder@example.com'));
    assert.equal(v.ok, false);
    assert.equal(v.statusCode, 401);
  })
);

test('verifyAdmin: no cookie, no token → 401', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: 'oskar@orcatrade.pl', ORCATRADE_LEADS_TOKEN: 'secret' }, async () => {
    const v = await adminAuth.verifyAdmin(reqAnon());
    assert.equal(v.ok, false);
    assert.equal(v.statusCode, 401);
  })
);

// ── verifyAdmin: legacy token path ────────────────────

test('verifyAdmin: header token succeeds', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: undefined, ORCATRADE_LEADS_TOKEN: 'secret' }, async () => {
    const v = await adminAuth.verifyAdmin(reqWithToken('secret', { via: 'header' }));
    assert.equal(v.ok, true);
    assert.equal(v.mode, 'token');
  })
);

test('verifyAdmin: query token succeeds', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: undefined, ORCATRADE_LEADS_TOKEN: 'secret' }, async () => {
    const v = await adminAuth.verifyAdmin(reqWithToken('secret', { via: 'query' }));
    assert.equal(v.ok, true);
    assert.equal(v.mode, 'token');
  })
);

test('verifyAdmin: wrong token → 401', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: undefined, ORCATRADE_LEADS_TOKEN: 'secret' }, async () => {
    const v = await adminAuth.verifyAdmin(reqWithToken('wrong', { via: 'header' }));
    assert.equal(v.ok, false);
    assert.equal(v.statusCode, 401);
  })
);

test('verifyAdmin: header wins when both header and query carry tokens', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: undefined, ORCATRADE_LEADS_TOKEN: 'secret' }, async () => {
    // The header is what we check; if it's present but wrong, we DO NOT
    // fall through to the query. Otherwise an attacker who plants
    // ?token=secret could ride past a fixed-header proxy whose value
    // doesn't match. Strict-first-on-header is the safer default.
    const req = {
      method: 'GET',
      headers: { 'x-admin-token': 'wrong' },
      url: '/api/leads?token=secret',
    };
    const v = await adminAuth.verifyAdmin(req);
    assert.equal(v.ok, false);
    assert.equal(v.statusCode, 401);
  })
);

test('verifyAdmin: query token used when header absent', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: undefined, ORCATRADE_LEADS_TOKEN: 'secret' }, async () => {
    const req = { method: 'GET', headers: {}, url: '/api/leads?token=secret' };
    const v = await adminAuth.verifyAdmin(req);
    assert.equal(v.ok, true);
    assert.equal(v.mode, 'token');
  })
);

// ── verifyAdmin: cookie path tried before token path ──

test('verifyAdmin: cookie path runs even when a wrong token is present', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: 'oskar@orcatrade.pl', ORCATRADE_LEADS_TOKEN: 'secret' }, async () => {
    const cookie = auth.buildSessionCookie('oskar@orcatrade.pl');
    const req = {
      method: 'GET',
      headers: {
        cookie: 'orcatrade_session=' + encodeURIComponent(cookie),
        'x-admin-token': 'WRONG-token',
      },
      url: '/api/leads',
    };
    const v = await adminAuth.verifyAdmin(req);
    assert.equal(v.ok, true);
    assert.equal(v.mode, 'session');
  })
);

// ── Module surface ────────────────────────────────────

test('module surface exposes the expected names', () => {
  for (const k of ['ADMIN_EMAILS_ENV', 'ADMIN_TOKEN_ENV', 'adminEmailList', 'isAdminEmail', 'isConfigured', 'verifyAdmin']) {
    assert.ok(adminAuth[k] !== undefined, k + ' exported');
  }
});
