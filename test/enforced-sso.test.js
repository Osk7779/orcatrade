// Enforced-SSO per org (apex plan III1).
// When an org has a complete OIDC config + enforceSso, magic-link sign-in for
// its claimed email domain is refused — members must use the IdP.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const kv = require('../lib/intelligence/kv-store');
const ssoConfig = require('../lib/sso-config');
const authHandler = require('../lib/handlers/auth');

const ISSUER = 'https://idp.acme.test';
const COMPLETE = {
  issuer: ISSUER, clientId: 'cid', clientSecret: 'shh',
  authorizationEndpoint: ISSUER + '/authorize',
  tokenEndpoint: ISSUER + '/token',
  jwksUri: ISSUER + '/jwks',
  allowedDomains: ['acme.test'],
};

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}
const reqFor = (email) => ({ method: 'POST', headers: {}, body: { email }, query: { path: ['auth', 'request'] }, url: '/api/auth/request' });

// ── isEnforcedForEmail ──────────────────────────────────

test('isEnforcedForEmail: false when no org claims the domain', async () => {
  kv._resetMemoryStore();
  assert.equal((await ssoConfig.isEnforcedForEmail('x@nowhere.test')).enforced, false);
});

test('isEnforcedForEmail: false when SSO configured but enforceSso not set', async () => {
  kv._resetMemoryStore();
  await ssoConfig.setConfig('org_a', COMPLETE);
  assert.equal((await ssoConfig.isEnforcedForEmail('jo@acme.test')).enforced, false);
});

test('isEnforcedForEmail: true when complete + enforceSso + domain claimed', async () => {
  kv._resetMemoryStore();
  await ssoConfig.setConfig('org_a', { ...COMPLETE, enforceSso: true });
  const r = await ssoConfig.isEnforcedForEmail('jo@acme.test');
  assert.equal(r.enforced, true);
  assert.equal(r.orgId, 'org_a');
});

test('isEnforcedForEmail: enforceSso ignored if OIDC config is incomplete', async () => {
  kv._resetMemoryStore();
  // setConfig rejects incomplete, so simulate a partial record directly.
  await kv.set(ssoConfig.configKey('org_b'), { issuer: ISSUER, enforceSso: true, allowedDomains: ['b.test'] });
  await kv.set(ssoConfig.domainKey('b.test'), 'org_b');
  assert.equal((await ssoConfig.isEnforcedForEmail('p@b.test')).enforced, false);
});

// ── magic-link request enforcement ──────────────────────

test('handleRequest: blocks magic link (403 ssoRequired) for an enforced domain', async () => {
  kv._resetMemoryStore();
  await ssoConfig.setConfig('org_a', { ...COMPLETE, enforceSso: true });
  const res = mockRes();
  await authHandler.handleRequest(reqFor('jo@acme.test'), res);
  assert.equal(res.statusCode, 403);
  const body = JSON.parse(res.body);
  assert.equal(body.ssoRequired, true);
  assert.match(body.ssoInitiateUrl, /\/api\/auth\/sso\/initiate\?org=org_a/);
});

test('handleRequest: still sends a link (202) for a non-enforced domain', async () => {
  kv._resetMemoryStore();
  await ssoConfig.setConfig('org_a', { ...COMPLETE, enforceSso: true });
  const res = mockRes();
  await authHandler.handleRequest(reqFor('someone@other.test'), res);
  assert.equal(res.statusCode, 202);
});
