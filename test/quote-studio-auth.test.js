// Sprint quote-rebrand-v1 — Quote Studio access gate.
//
// Quote Studio uses its OWN allowlist (ORCATRADE_QUOTE_STUDIO_EMAILS) so the
// team can make quotes without being handed the admin dashboards. Asserted:
//   1. Unconfigured → 503 (distinct from "wrong creds").
//   2. A team-list email (session) → access.
//   3. An admin-list email → access (admins implicitly pass).
//   4. The legacy token → access (headless path).
//   5. A signed-in-but-not-listed user → 401.
//   6. The GET probe on the handler mirrors the verdict.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const auth = require('../lib/auth');

function makeReq({ method = 'GET', cookieEmail = null, token = null } = {}) {
  const headers = {};
  if (token) headers['x-admin-token'] = token;
  const req = { method, headers, query: {}, url: '/api/quote-rebrand' };
  // Stub the session: getCurrentUserStrict reads the cookie; we shortcut by
  // monkeypatching for the duration of the test via the exported function.
  req.__cookieEmail = cookieEmail;
  return req;
}

// Patch getCurrentUserStrict to honour our stub email. Restored per test group.
const realStrict = auth.getCurrentUserStrict;
function patchAuth() {
  auth.getCurrentUserStrict = async (req) => (req.__cookieEmail ? { email: req.__cookieEmail } : null);
}
function restoreAuth() { auth.getCurrentUserStrict = realStrict; }

function freshGate() {
  delete require.cache[require.resolve('../lib/quote-studio-auth')];
  delete require.cache[require.resolve('../lib/admin-auth')];
  // admin-auth captures `auth` at require time; re-require after patching.
  return require('../lib/quote-studio-auth');
}

test('503 when nothing is configured', async () => {
  delete process.env.ORCATRADE_QUOTE_STUDIO_EMAILS;
  delete process.env.ORCATRADE_ADMIN_EMAILS;
  delete process.env.ORCATRADE_LEADS_TOKEN;
  patchAuth();
  const { verifyQuoteStudioAccess } = freshGate();
  const v = await verifyQuoteStudioAccess(makeReq({}));
  assert.equal(v.ok, false);
  assert.equal(v.statusCode, 503);
  restoreAuth();
});

test('team-list email gets session access', async () => {
  process.env.ORCATRADE_QUOTE_STUDIO_EMAILS = 'sales@orcatradegroup.com';
  delete process.env.ORCATRADE_ADMIN_EMAILS;
  delete process.env.ORCATRADE_LEADS_TOKEN;
  patchAuth();
  const { verifyQuoteStudioAccess } = freshGate();
  const v = await verifyQuoteStudioAccess(makeReq({ cookieEmail: 'sales@orcatradegroup.com' }));
  assert.equal(v.ok, true);
  assert.equal(v.mode, 'session');
  assert.equal(v.email, 'sales@orcatradegroup.com');
  restoreAuth();
});

test('admin-list email implicitly has access', async () => {
  delete process.env.ORCATRADE_QUOTE_STUDIO_EMAILS;
  process.env.ORCATRADE_ADMIN_EMAILS = 'founder@orcatradegroup.com';
  delete process.env.ORCATRADE_LEADS_TOKEN;
  patchAuth();
  const { verifyQuoteStudioAccess } = freshGate();
  const v = await verifyQuoteStudioAccess(makeReq({ cookieEmail: 'founder@orcatradegroup.com' }));
  assert.equal(v.ok, true);
  restoreAuth();
});

test('legacy admin token grants access', async () => {
  delete process.env.ORCATRADE_QUOTE_STUDIO_EMAILS;
  delete process.env.ORCATRADE_ADMIN_EMAILS;
  process.env.ORCATRADE_LEADS_TOKEN = 'sekret-token-value';
  patchAuth();
  const { verifyQuoteStudioAccess } = freshGate();
  const v = await verifyQuoteStudioAccess(makeReq({ token: 'sekret-token-value' }));
  assert.equal(v.ok, true);
  assert.equal(v.mode, 'token');
  restoreAuth();
});

test('signed-in but not on any list → 401', async () => {
  process.env.ORCATRADE_QUOTE_STUDIO_EMAILS = 'sales@orcatradegroup.com';
  process.env.ORCATRADE_ADMIN_EMAILS = 'founder@orcatradegroup.com';
  delete process.env.ORCATRADE_LEADS_TOKEN;
  patchAuth();
  const { verifyQuoteStudioAccess } = freshGate();
  const v = await verifyQuoteStudioAccess(makeReq({ cookieEmail: 'random@gmail.com' }));
  assert.equal(v.ok, false);
  assert.equal(v.statusCode, 401);
  restoreAuth();
});

test('handler GET probe returns authed:true for a team member, 401 otherwise', async () => {
  process.env.ORCATRADE_QUOTE_STUDIO_EMAILS = 'sales@orcatradegroup.com';
  delete process.env.ORCATRADE_ADMIN_EMAILS;
  delete process.env.ORCATRADE_LEADS_TOKEN;
  patchAuth();
  // re-require the handler so it binds the freshly-loaded gate
  delete require.cache[require.resolve('../lib/quote-studio-auth')];
  delete require.cache[require.resolve('../lib/admin-auth')];
  delete require.cache[require.resolve('../lib/handlers/quote-rebrand')];
  const handler = require('../lib/handlers/quote-rebrand');

  function mockRes() {
    return {
      statusCode: 200, body: null, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(o) { this.body = o; return this; },
      end() { return this; },
    };
  }

  const okRes = mockRes();
  await handler({ method: 'GET', headers: {}, query: {}, url: '/api/quote-rebrand', __cookieEmail: 'sales@orcatradegroup.com' }, okRes);
  assert.equal(okRes.statusCode, 200);
  assert.equal(okRes.body.authed, true);

  const denyRes = mockRes();
  await handler({ method: 'GET', headers: {}, query: {}, url: '/api/quote-rebrand', __cookieEmail: 'nope@gmail.com' }, denyRes);
  assert.equal(denyRes.statusCode, 401);
  assert.equal(denyRes.body.authed, false);
  restoreAuth();
});
