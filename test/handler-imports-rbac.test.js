'use strict';

// RBAC gate on /api/imports/<id>/review — sprint 6 ch 2.
//
// The full handler involves auth + Postgres + KV (org membership), so
// the pure-function gate `isOpsRole` carries the unit-test weight. The
// integration path (Postgres-mirrored org + KV members) is exercised
// by the post-deploy smoke suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const importsHandler = require(path.join(ROOT, 'lib', 'handlers', 'imports'));
const importsEmails = require(path.join(ROOT, 'lib', 'imports-emails'));

// ── Drift-guard: RBAC gate matches the email fan-out role set ────────

test('OPS_REVIEW_ROLES set is exposed for inspection', () => {
  assert.ok(importsHandler.OPS_REVIEW_ROLES instanceof Set);
  assert.equal(importsHandler.OPS_REVIEW_ROLES.size, 2);
});

test('OPS_REVIEW_ROLES stays in lockstep with OPS_NOTIFICATION_ROLES (the same set across the wedge)', () => {
  // Sprint 5 fans out emails to owner/admin. Sprint 6 gates /review on
  // owner/admin. Drift between the two would mean "you got the email
  // but you can't action it" or vice-versa — confusing failure mode.
  // Pin both sides.
  const review = [...importsHandler.OPS_REVIEW_ROLES].sort();
  const email = [...importsEmails.OPS_NOTIFICATION_ROLES].sort();
  assert.deepEqual(review, email);
});

// ── isOpsRole — the pure-function gate ──────────────────────────────

test('isOpsRole returns true for owner + admin (the canonical ops roles)', () => {
  assert.equal(importsHandler.isOpsRole('owner'), true);
  assert.equal(importsHandler.isOpsRole('admin'), true);
});

test('isOpsRole returns false for read-mostly roles (analyst, finance, compliance_officer, viewer)', () => {
  assert.equal(importsHandler.isOpsRole('analyst'), false);
  assert.equal(importsHandler.isOpsRole('finance'), false);
  assert.equal(importsHandler.isOpsRole('compliance_officer'), false);
  assert.equal(importsHandler.isOpsRole('viewer'), false);
});

test('isOpsRole maps the legacy "member" role → "viewer" via rbac.canonicalRole (still false)', () => {
  // lib/rbac.js LEGACY_ROLE_ALIASES { member: 'viewer' }.
  // Pre-RBAC members should NOT gain ops-level access by virtue of
  // their grandfathered role — they map to viewer.
  assert.equal(importsHandler.isOpsRole('member'), false);
});

test('isOpsRole returns false for null / undefined / empty / bogus roles', () => {
  assert.equal(importsHandler.isOpsRole(null), false);
  assert.equal(importsHandler.isOpsRole(undefined), false);
  assert.equal(importsHandler.isOpsRole(''), false);
  assert.equal(importsHandler.isOpsRole('SUPERADMIN'), false);
  assert.equal(importsHandler.isOpsRole('hacker'), false);
});

test('isOpsRole is case-sensitive — does NOT accept "Owner" or "ADMIN"', () => {
  // Canonical roles are lowercase per lib/rbac.js. Accepting other
  // cases would silently broaden the gate.
  assert.equal(importsHandler.isOpsRole('Owner'), false);
  assert.equal(importsHandler.isOpsRole('ADMIN'), false);
});
