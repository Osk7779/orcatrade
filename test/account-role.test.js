'use strict';

// /api/account/role — sprint 7 ch 2.
//
// Returns the signed-in user's role within their primary org plus an
// `isOpsRole` boolean that gates the Sidebar's "Review queue" link.
// The OPS_REVIEW_ROLES set MUST stay in lockstep with the imports
// handler's set of the same name — drift causes "you can see the
// queue but can't action it" or "you can action it but the link is
// hidden" UX bugs. This test pins both sides.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const accountHandler = require(path.join(ROOT, 'lib', 'handlers', 'account'));
const importsHandler = require(path.join(ROOT, 'lib', 'handlers', 'imports'));

// ── Drift-guard: role set matches the imports handler ────────────────

test('OPS_REVIEW_ROLES on account handler matches the same set on imports handler', () => {
  // If a future PR widens "ops" to include analyst on one side but
  // not the other, the queue link becomes inconsistent with what the
  // backend will allow. Drift here = inconsistent UX. Pin both sides.
  const accountSet = [...accountHandler.OPS_REVIEW_ROLES].sort();
  const importsSet = [...importsHandler.OPS_REVIEW_ROLES].sort();
  assert.deepEqual(accountSet, importsSet);
});

test('OPS_REVIEW_ROLES is exactly { owner, admin }', () => {
  const set = [...accountHandler.OPS_REVIEW_ROLES].sort();
  assert.deepEqual(set, ['admin', 'owner']);
});

// ── handleRole — endpoint contract ───────────────────────────────────
//
// We invoke handleRole(req, res, user) directly with a small in-memory
// res mock and verify the response shape. The orgs/KV path is exercised
// at integration time; here we validate the contract.

function makeMockRes() {
  return {
    statusCode: 200,
    _headers: {},
    _body: null,
    setHeader(name, value) { this._headers[name] = value; },
    end(body) { this._body = body; return this; },
  };
}

test('handleRole returns { ok, orgId: null, role: null, isOpsRole: false } for a user with no orgs', async () => {
  // listOrgsForEmail returns [] when the user has no membership;
  // handleRole should return a 200 with a null role + isOpsRole=false
  // so the Sidebar treats it as "non-ops" (hide the queue link).
  // Test by using an email definitely not in KV.
  const res = makeMockRes();
  const fakeUser = { email: `nobody+${Math.floor(Math.random() * 1e9)}@example.test` };
  await accountHandler.handleRole({}, res, fakeUser);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res._body);
  assert.equal(body.ok, true);
  assert.equal(body.orgId, null);
  assert.equal(body.role, null);
  assert.equal(body.isOpsRole, false);
});

test('handleRole response carries the orgName field (null when no org)', async () => {
  const res = makeMockRes();
  await accountHandler.handleRole({}, res, { email: `nobody+${Math.floor(Math.random() * 1e9)}@example.test` });
  const body = JSON.parse(res._body);
  assert.ok('orgName' in body);
  assert.equal(body.orgName, null);
});

test('handleRole sets Content-Type to application/json', async () => {
  const res = makeMockRes();
  await accountHandler.handleRole({}, res, { email: 'x@example.test' });
  assert.equal(res._headers['Content-Type'], 'application/json');
});

test('handleRole sets Cache-Control: no-store (role can change mid-session)', async () => {
  const res = makeMockRes();
  await accountHandler.handleRole({}, res, { email: 'x@example.test' });
  // Cache-Control may be set by jsonResponse — we want no-store so
  // the sidebar always sees the live role, not a stale cached one.
  assert.equal(res._headers['Cache-Control'], 'no-store');
});

test('handleRole never throws — even on malformed user input it returns 200 with safe defaults', async () => {
  // Defensive: the handler runs after auth so user is always shaped
  // correctly in production, but the safe-default DENY branch handles
  // a missing email cleanly via the orgs.listOrgsForEmail([]) path.
  const res = makeMockRes();
  await accountHandler.handleRole({}, res, { email: '' });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res._body);
  assert.equal(body.isOpsRole, false);
});
