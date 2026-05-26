// RBAC permission-matrix tests (apex plan III1, slice 1).

const test = require('node:test');
const assert = require('node:assert/strict');

const rbac = require('../lib/rbac');
const orgs = require('../lib/orgs');

const P = rbac.PERMISSIONS;

test('the six canonical roles are defined, ordered most→least privilege', () => {
  assert.deepEqual(rbac.ROLES, ['owner', 'admin', 'analyst', 'finance', 'compliance_officer', 'viewer']);
});

test('owner is the wildcard super-set — holds every permission', () => {
  for (const perm of rbac.ALL_PERMISSIONS) {
    assert.equal(rbac.can('owner', perm), true, `owner should hold ${perm}`);
  }
  assert.deepEqual(rbac.permissionsFor('owner').sort(), [...rbac.ALL_PERMISSIONS].sort());
});

test('viewer is read-only — no writes, no agent, no admin', () => {
  assert.equal(rbac.can('viewer', P.PLANS_READ), true);
  assert.equal(rbac.can('viewer', P.PORTFOLIOS_READ), true);
  assert.equal(rbac.can('viewer', P.PLANS_WRITE), false);
  assert.equal(rbac.can('viewer', P.DOCUMENTS_WRITE), false);
  assert.equal(rbac.can('viewer', P.AGENT_USE), false);
  assert.equal(rbac.can('viewer', P.ORG_MEMBERS_MANAGE), false);
  assert.equal(rbac.can('viewer', P.BILLING_MANAGE), false);
});

test('analyst runs the tools but cannot manage org, members or billing', () => {
  assert.equal(rbac.can('analyst', P.PLANS_WRITE), true);
  assert.equal(rbac.can('analyst', P.AGENT_USE), true);
  assert.equal(rbac.can('analyst', P.SCREENING_RUN), true);
  assert.equal(rbac.can('analyst', P.ORG_MANAGE), false);
  assert.equal(rbac.can('analyst', P.ORG_MEMBERS_MANAGE), false);
  assert.equal(rbac.can('analyst', P.BILLING_MANAGE), false);
});

test('finance owns billing + reads, but cannot write plans', () => {
  assert.equal(rbac.can('finance', P.BILLING_MANAGE), true);
  assert.equal(rbac.can('finance', P.PLANS_READ), true);
  assert.equal(rbac.can('finance', P.PLANS_WRITE), false);
  assert.equal(rbac.can('finance', P.ORG_MEMBERS_MANAGE), false);
});

test('compliance_officer can see the audit trail + run screening; not billing/members', () => {
  assert.equal(rbac.can('compliance_officer', P.AUDIT_READ), true);
  assert.equal(rbac.can('compliance_officer', P.SCREENING_RUN), true);
  assert.equal(rbac.can('compliance_officer', P.DOCUMENTS_WRITE), true);
  assert.equal(rbac.can('compliance_officer', P.BILLING_MANAGE), false);
  assert.equal(rbac.can('compliance_officer', P.ORG_MEMBERS_MANAGE), false);
});

test('admin can manage members + billing + audit, but only owner can do everything', () => {
  assert.equal(rbac.can('admin', P.ORG_MEMBERS_MANAGE), true);
  assert.equal(rbac.can('admin', P.BILLING_MANAGE), true);
  assert.equal(rbac.can('admin', P.AUDIT_READ), true);
  // Admin lacks nothing among today's permissions except by-design owner reserve;
  // the distinction is enforced at ownership-transfer, not the matrix.
});

test('can() fails closed on unknown role or permission', () => {
  assert.equal(rbac.can('wizard', P.PLANS_READ), false);
  assert.equal(rbac.can('owner', 'plans.teleport'), false);
  assert.equal(rbac.can(null, P.PLANS_READ), false);
  assert.equal(rbac.can('admin', undefined), false);
});

test("legacy 'member' role maps to viewer-level access (back-compat)", () => {
  assert.equal(rbac.canonicalRole('member'), 'viewer');
  assert.equal(rbac.can('member', P.PLANS_READ), true);
  assert.equal(rbac.can('member', P.PLANS_WRITE), false);
  assert.deepEqual(rbac.permissionsFor('member'), rbac.permissionsFor('viewer'));
});

test('assignableRoles: owner/admin may grant any non-owner role; others none', () => {
  const ownerGrants = rbac.assignableRoles('owner');
  assert.ok(!ownerGrants.includes('owner'), 'owner not directly grantable (transfer only)');
  assert.ok(ownerGrants.includes('admin') && ownerGrants.includes('viewer'));
  assert.deepEqual(rbac.assignableRoles('admin'), ownerGrants);
  assert.deepEqual(rbac.assignableRoles('analyst'), []);
  assert.deepEqual(rbac.assignableRoles('viewer'), []);
  // Legacy 'member' is never offered for new assignments.
  assert.ok(!ownerGrants.includes('member'));
});

// ── orgs.js accepts the new vocabulary ──────────────────

test('orgs.addMember accepts the new enterprise roles', async () => {
  const kv = require('../lib/intelligence/kv-store');
  kv._resetMemoryStore();
  const org = await orgs.createOrg({ name: 'Acme Imports', ownerEmail: 'owner@acme.test' });
  for (const role of ['analyst', 'finance', 'compliance_officer', 'viewer']) {
    const res = await orgs.addMember(org.id, { email: `${role}@acme.test`, role });
    assert.equal(res.member.role, role, `${role} accepted`);
  }
  // owner still cannot be granted via addMember.
  await assert.rejects(() => orgs.addMember(org.id, { email: 'x@acme.test', role: 'owner' }), /owner/);
});
