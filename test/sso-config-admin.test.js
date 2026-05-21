// Sprint sso-oidc-v1 phase 3 — self-serve SSO: owner config endpoints,
// email-domain discovery, and the domain→org index.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
process.env.SITE_ORIGIN = 'https://orcatrade.pl';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const ssoConfig = require('../lib/sso-config');
const orgsHandler = require('../lib/handlers/orgs');
const authHandler = require('../lib/handlers/auth');
const orgs = require('../lib/orgs');
const auth = require('../lib/auth');
const kv = require('../lib/intelligence/kv-store');
const events = require('../lib/events');

function mockRes() {
  const res = {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    end(body) { this.body = body || ''; return this; },
  };
  return res;
}
function parse(res) { try { return JSON.parse(res.body); } catch (_) { return null; } }
function cookie(email) { return 'orcatrade_session=' + encodeURIComponent(auth.buildSessionCookie(email)); }

const CFG = {
  issuer: 'https://idp.acme.test', clientId: 'c1', clientSecret: 'shh',
  authorizationEndpoint: 'https://idp.acme.test/authorize',
  tokenEndpoint: 'https://idp.acme.test/token',
  jwksUri: 'https://idp.acme.test/jwks',
  allowedDomains: ['acme.test'],
};

async function makeOrg(ownerEmail) {
  const org = await orgs.createOrg({ name: 'Acme', ownerEmail });
  return org.id;
}

// ── Domain index + discovery ────────────────────────────

test('setConfig writes a domain→org index; findOrgByDomain resolves it', async () => {
  kv._resetMemoryStore();
  await ssoConfig.setConfig('orgA', CFG);
  assert.equal(await ssoConfig.findOrgByDomain('jo@acme.test'), 'orgA');
  assert.equal(await ssoConfig.findOrgByDomain('acme.test'), 'orgA');
  assert.equal(await ssoConfig.findOrgByDomain('nobody@elsewhere.com'), null);
});

test('changing allowedDomains reconciles the index (drops stale, adds new)', async () => {
  kv._resetMemoryStore();
  await ssoConfig.setConfig('orgA', CFG); // acme.test
  await ssoConfig.setConfig('orgA', Object.assign({}, CFG, { allowedDomains: ['acme.io'] }));
  assert.equal(await ssoConfig.findOrgByDomain('x@acme.test'), null); // stale dropped
  assert.equal(await ssoConfig.findOrgByDomain('x@acme.io'), 'orgA');
});

test('deleteConfig clears the domain index', async () => {
  kv._resetMemoryStore();
  await ssoConfig.setConfig('orgA', CFG);
  await ssoConfig.deleteConfig('orgA');
  assert.equal(await ssoConfig.findOrgByDomain('x@acme.test'), null);
  assert.equal(await ssoConfig.getConfig('orgA'), null);
});

test('reconcile does not wipe a domain re-claimed by another org', async () => {
  kv._resetMemoryStore();
  await ssoConfig.setConfig('orgA', CFG);                 // acme.test → orgA
  await ssoConfig.setConfig('orgB', CFG);                 // acme.test → orgB (re-claim)
  await ssoConfig.deleteConfig('orgA');                   // must NOT clear orgB's claim
  assert.equal(await ssoConfig.findOrgByDomain('x@acme.test'), 'orgB');
});

// ── Owner-gated config endpoints ────────────────────────

test('GET/POST/DELETE /api/orgs/<id>/sso require the owner', async () => {
  kv._resetMemoryStore();
  const orgId = await makeOrg('owner@acme.test');
  // Non-owner (a different user) → 403.
  const forbidden = mockRes();
  await orgsHandler({ method: 'GET', headers: { cookie: cookie('intruder@x.com') }, query: { path: 'orgs/' + orgId + '/sso' } }, forbidden);
  assert.equal(forbidden.statusCode, 403);
  // Anonymous → 401.
  const anon = mockRes();
  await orgsHandler({ method: 'GET', headers: {}, query: { path: 'orgs/' + orgId + '/sso' } }, anon);
  assert.equal(anon.statusCode, 401);
});

test('owner can POST config then GET it back WITHOUT the secret', async () => {
  kv._resetMemoryStore();
  const orgId = await makeOrg('owner@acme.test');
  const c = cookie('owner@acme.test');

  const save = mockRes();
  await orgsHandler({ method: 'POST', headers: { cookie: c }, query: { path: 'orgs/' + orgId + '/sso' }, body: CFG }, save);
  assert.equal(save.statusCode, 200);
  assert.match(parse(save).initiateUrl, new RegExp('/api/auth/sso/initiate\\?org=' + orgId));

  const get = mockRes();
  await orgsHandler({ method: 'GET', headers: { cookie: c }, query: { path: 'orgs/' + orgId + '/sso' } }, get);
  const body = parse(get);
  assert.equal(body.configured, true);
  assert.equal(body.config.clientId, 'c1');
  assert.equal(body.config.clientSecretSet, true);
  assert.ok(!('clientSecret' in body.config), 'secret must never be returned');
  // No raw secret value anywhere in the response.
  assert.ok(!/shh/.test(get.body));
});

test('POST incomplete config → 400', async () => {
  kv._resetMemoryStore();
  const orgId = await makeOrg('owner@acme.test');
  const res = mockRes();
  await orgsHandler({ method: 'POST', headers: { cookie: cookie('owner@acme.test') }, query: { path: 'orgs/' + orgId + '/sso' }, body: { issuer: 'x' } }, res);
  assert.equal(res.statusCode, 400);
});

test('owner DELETE removes config + emits audit; emits configured audit on save', async () => {
  kv._resetMemoryStore();
  const orgId = await makeOrg('owner@acme.test');
  const c = cookie('owner@acme.test');
  await orgsHandler({ method: 'POST', headers: { cookie: c }, query: { path: 'orgs/' + orgId + '/sso' }, body: CFG }, mockRes());
  const del = mockRes();
  await orgsHandler({ method: 'DELETE', headers: { cookie: c }, query: { path: 'orgs/' + orgId + '/sso' } }, del);
  assert.equal(del.statusCode, 200);
  assert.equal(await ssoConfig.getConfig(orgId), null);
  await new Promise((r) => setImmediate(r));
  const logRows = await kv.get('events:log');
  assert.ok((logRows || []).some((e) => e.type === 'org_sso_configured'));
  assert.ok((logRows || []).some((e) => e.type === 'org_sso_removed'));
});

// ── Discover endpoint ───────────────────────────────────

test('GET /api/auth/sso/discover: resolves a configured domain to its initiate URL', async () => {
  kv._resetMemoryStore();
  await ssoConfig.setConfig('orgA', CFG);
  const res = mockRes();
  await authHandler({ method: 'GET', headers: { 'x-forwarded-for': '1.1.1.1' }, query: { path: 'auth/sso/discover', email: 'jo@acme.test' } }, res);
  const body = parse(res);
  assert.equal(body.ssoAvailable, true);
  assert.match(body.initiateUrl, /\/api\/auth\/sso\/initiate\?org=orgA/);
});

test('GET /api/auth/sso/discover: unknown domain → ssoAvailable:false, no leak', async () => {
  kv._resetMemoryStore();
  const res = mockRes();
  await authHandler({ method: 'GET', headers: { 'x-forwarded-for': '2.2.2.2' }, query: { path: 'auth/sso/discover', email: 'x@nowhere.com' } }, res);
  const body = parse(res);
  assert.equal(body.ssoAvailable, false);
  assert.ok(!('initiateUrl' in body));
});

test('sso event types are allowed', () => {
  assert.ok(events.ALLOWED_TYPES.has('org_sso_configured'));
  assert.ok(events.ALLOWED_TYPES.has('org_sso_removed'));
});

// ── UI contracts ────────────────────────────────────────

test('/account/ sign-in has an SSO entry wired to /api/auth/sso/discover', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'index.html'), 'utf8');
  assert.match(html, /id="sso-link"/);
  assert.match(html, /data-i18n="ssoSignin"/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'app.js'), 'utf8');
  assert.match(js, /\/api\/auth\/sso\/discover\?email=/);
  assert.match(js, /d\.initiateUrl/);
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'js', 'auth-i18n.js'), 'utf8');
  assert.ok((i18n.match(/ssoSignin:/g) || []).length >= 3, 'ssoSignin in all 3 locales');
});

test('/account/orgs/sso/ owner config page reads ?org + POSTs config + masks secret', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'orgs', 'sso', 'index.html'), 'utf8');
  assert.match(html, /id="ssoForm"/);
  assert.match(html, /id="clientSecret"/);
  assert.match(html, /id="jwksUri"/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'orgs', 'sso', 'app.js'), 'utf8');
  assert.match(js, /\/api\/orgs\//);
  assert.match(js, /\/sso/);
  assert.match(js, /method: 'DELETE'/);
  assert.match(js, /clientSecretSet/);
});
