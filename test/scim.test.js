// SCIM 2.0 provisioning tests (apex plan III1 — SCIM slice 1).

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const kv = require('../lib/intelligence/kv-store');
const orgs = require('../lib/orgs');
const hash = require('../lib/hash');
const scimStore = require('../lib/scim-store');
const scimHandler = require('../lib/handlers/scim');

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}
function scimReq({ method, segs, token, body, filter }) {
  const path = ['scim', ...segs];
  let url = '/api/' + path.join('/');
  if (filter) url += `?filter=${encodeURIComponent(filter)}`;
  return {
    method, body, url,
    query: { path, ...(filter ? { filter } : {}) },
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
}

// ── token store ─────────────────────────────────────────

test('scim-store: mint → resolve → rotate invalidates → revoke', async () => {
  kv._resetMemoryStore();
  const { token } = await scimStore.generateToken('org_abc');
  assert.match(token, /^scim_[0-9a-f]{48}$/);
  assert.equal(await scimStore.resolveOrgIdByToken(token), 'org_abc');

  // Rotation invalidates the prior token.
  const { token: token2 } = await scimStore.generateToken('org_abc');
  assert.notEqual(token2, token);
  assert.equal(await scimStore.resolveOrgIdByToken(token), null);
  assert.equal(await scimStore.resolveOrgIdByToken(token2), 'org_abc');

  assert.equal((await scimStore.getStatus('org_abc')).configured, true);
  await scimStore.revoke('org_abc');
  assert.equal(await scimStore.resolveOrgIdByToken(token2), null);
  assert.equal((await scimStore.getStatus('org_abc')).configured, false);
});

// ── handler auth ────────────────────────────────────────

test('scim handler: rejects missing / invalid bearer token (401)', async () => {
  kv._resetMemoryStore();
  const noTok = mockRes();
  await scimHandler(scimReq({ method: 'GET', segs: ['v2', 'Users'] }), noTok);
  assert.equal(noTok.statusCode, 401);

  const badTok = mockRes();
  await scimHandler(scimReq({ method: 'GET', segs: ['v2', 'Users'], token: 'scim_nope' }), badTok);
  assert.equal(badTok.statusCode, 401);
});

// ── provisioning lifecycle ──────────────────────────────

async function setup() {
  kv._resetMemoryStore();
  const org = await orgs.createOrg({ name: 'Acme', ownerEmail: 'owner@acme.test' });
  const { token } = await scimStore.generateToken(org.id);
  return { org, token };
}

test('scim handler: POST provisions a member as viewer; GET/:id returns it', async () => {
  const { org, token } = await setup();
  const res = mockRes();
  await scimHandler(scimReq({ method: 'POST', segs: ['v2', 'Users'], token, body: { userName: 'new@acme.test' } }), res);
  assert.equal(res.statusCode, 201);
  const user = JSON.parse(res.body);
  assert.equal(user.userName, 'new@acme.test');
  assert.equal(user.id, hash.emailHash('new@acme.test'));
  assert.equal(await orgs.getMemberRole(org.id, 'new@acme.test'), 'viewer');

  // GET by id round-trips.
  const getRes = mockRes();
  await scimHandler(scimReq({ method: 'GET', segs: ['v2', 'Users', user.id], token }), getRes);
  assert.equal(getRes.statusCode, 200);
  assert.equal(JSON.parse(getRes.body).userName, 'new@acme.test');
});

test('scim handler: POST is idempotent for an existing member (200)', async () => {
  const { token } = await setup();
  await scimHandler(scimReq({ method: 'POST', segs: ['v2', 'Users'], token, body: { userName: 'dup@acme.test' } }), mockRes());
  const res = mockRes();
  await scimHandler(scimReq({ method: 'POST', segs: ['v2', 'Users'], token, body: { userName: 'dup@acme.test' } }), res);
  assert.equal(res.statusCode, 200);
});

test('scim handler: GET Users supports userName eq filter', async () => {
  const { token } = await setup();
  await scimHandler(scimReq({ method: 'POST', segs: ['v2', 'Users'], token, body: { userName: 'a@acme.test' } }), mockRes());
  await scimHandler(scimReq({ method: 'POST', segs: ['v2', 'Users'], token, body: { userName: 'b@acme.test' } }), mockRes());
  const res = mockRes();
  await scimHandler(scimReq({ method: 'GET', segs: ['v2', 'Users'], token, filter: 'userName eq "a@acme.test"' }), res);
  const list = JSON.parse(res.body);
  assert.equal(list.totalResults, 1);
  assert.equal(list.Resources[0].userName, 'a@acme.test');
});

test('scim handler: PATCH active:false deprovisions (removes the member)', async () => {
  const { org, token } = await setup();
  await scimHandler(scimReq({ method: 'POST', segs: ['v2', 'Users'], token, body: { userName: 'gone@acme.test' } }), mockRes());
  const id = hash.emailHash('gone@acme.test');
  const res = mockRes();
  await scimHandler(scimReq({
    method: 'PATCH', segs: ['v2', 'Users', id], token,
    body: { Operations: [{ op: 'replace', path: 'active', value: false }] },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).active, false);
  assert.equal(await orgs.getMemberRole(org.id, 'gone@acme.test'), null);
});

test('scim handler: DELETE deprovisions and 404s for an unknown id', async () => {
  const { org, token } = await setup();
  await scimHandler(scimReq({ method: 'POST', segs: ['v2', 'Users'], token, body: { userName: 'del@acme.test' } }), mockRes());
  const id = hash.emailHash('del@acme.test');
  const res = mockRes();
  await scimHandler(scimReq({ method: 'DELETE', segs: ['v2', 'Users', id], token }), res);
  assert.equal(res.statusCode, 204);
  assert.equal(await orgs.getMemberRole(org.id, 'del@acme.test'), null);

  const miss = mockRes();
  await scimHandler(scimReq({ method: 'DELETE', segs: ['v2', 'Users', 'deadbeef'], token }), miss);
  assert.equal(miss.statusCode, 404);
});

test('scim handler: ServiceProviderConfig advertises bearer auth + patch', async () => {
  const { token } = await setup();
  const res = mockRes();
  await scimHandler(scimReq({ method: 'GET', segs: ['v2', 'ServiceProviderConfig'], token }), res);
  const cfg = JSON.parse(res.body);
  assert.equal(cfg.patch.supported, true);
  assert.equal(cfg.authenticationSchemes[0].type, 'oauthbearertoken');
});

// ── Groups → roles ──────────────────────────────────────

test('scim handler: GET /Groups lists one group per assignable role', async () => {
  const { token } = await setup();
  const res = mockRes();
  await scimHandler(scimReq({ method: 'GET', segs: ['v2', 'Groups'], token }), res);
  const list = JSON.parse(res.body);
  const ids = list.Resources.map((g) => g.id).sort();
  assert.deepEqual(ids, ['admin', 'analyst', 'compliance_officer', 'finance', 'viewer']);
});

test('scim handler: PATCH /Groups/finance add member sets the role; remove demotes to viewer', async () => {
  const { org, token } = await setup();
  // Provision a member (lands as viewer)…
  await scimHandler(scimReq({ method: 'POST', segs: ['v2', 'Users'], token, body: { userName: 'cfo@acme.test' } }), mockRes());
  const id = hash.emailHash('cfo@acme.test');

  // …push them into the finance group → role becomes finance.
  const addRes = mockRes();
  await scimHandler(scimReq({
    method: 'PATCH', segs: ['v2', 'Groups', 'finance'], token,
    body: { Operations: [{ op: 'add', path: 'members', value: [{ value: id }] }] },
  }), addRes);
  assert.equal(addRes.statusCode, 200);
  assert.equal(await orgs.getMemberRole(org.id, 'cfo@acme.test'), 'finance');

  // Remove from the group → demoted back to viewer.
  await scimHandler(scimReq({
    method: 'PATCH', segs: ['v2', 'Groups', 'finance'], token,
    body: { Operations: [{ op: 'remove', path: 'members', value: [{ value: id }] }] },
  }), mockRes());
  assert.equal(await orgs.getMemberRole(org.id, 'cfo@acme.test'), 'viewer');
});

test('scim handler: GET /Groups/<unknown> → 404', async () => {
  const { token } = await setup();
  const res = mockRes();
  await scimHandler(scimReq({ method: 'GET', segs: ['v2', 'Groups', 'wizard'], token }), res);
  assert.equal(res.statusCode, 404);
});

test('activeFromPatch tolerates both value-object and path forms', () => {
  assert.equal(scimHandler.activeFromPatch({ Operations: [{ op: 'replace', path: 'active', value: false }] }), false);
  assert.equal(scimHandler.activeFromPatch({ Operations: [{ op: 'replace', value: { active: false } }] }), false);
  assert.equal(scimHandler.activeFromPatch({ Operations: [{ op: 'replace', value: { active: true } }] }), true);
  assert.equal(scimHandler.activeFromPatch({ Operations: [] }), null);
});
