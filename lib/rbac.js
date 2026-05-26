// Role-based access control — the permission contract (apex plan III1, slice 1).
//
// The org/seat model shipped with three roles (owner | admin | member). An
// enterprise org chart needs more: an analyst who runs the tools, a finance
// lead who owns billing, a compliance officer who can see the audit trail, and
// read-only viewers. This module is the single source of truth for *what each
// role may do* — a capability matrix, not scattered `role === 'admin'` checks.
//
// Pure + LLM-free + no I/O. Handlers consult `can(role, permission)`; the admin
// UI renders `assignableRoles()`; SCIM (slice 3) maps IdP groups onto ROLES.
// Adding a permission here + listing it per role is the whole change — every
// call site stays a one-liner.

'use strict';

// ── Roles (ordered by privilege, most → least) ──────────
const ROLES = ['owner', 'admin', 'analyst', 'finance', 'compliance_officer', 'viewer'];

// 'member' is the pre-RBAC role still on existing memberships. It maps to
// viewer-level access so legacy seats keep working; new seats are assigned one
// of the six canonical ROLES (assignableRoles never offers 'member').
const LEGACY_ROLE_ALIASES = { member: 'viewer' };

function canonicalRole(role) {
  return (role && LEGACY_ROLE_ALIASES[role]) || role;
}

// ── Permissions (resource.action) ───────────────────────
const PERMISSIONS = {
  ORG_MANAGE: 'org.manage',                 // rename, SSO config, delete, enforce-SSO
  ORG_MEMBERS_MANAGE: 'org.members.manage', // invite / remove / change roles
  BILLING_MANAGE: 'billing.manage',         // tier, payment method, invoices
  PLANS_READ: 'plans.read',
  PLANS_WRITE: 'plans.write',
  PLANS_DELETE: 'plans.delete',
  PORTFOLIOS_READ: 'portfolios.read',
  PORTFOLIOS_WRITE: 'portfolios.write',
  DOCUMENTS_READ: 'documents.read',
  DOCUMENTS_WRITE: 'documents.write',       // upload / audit / draft
  SCREENING_RUN: 'screening.run',
  COMPLIANCE_READ: 'compliance.read',
  ALERTS_MANAGE: 'alerts.manage',
  AUDIT_READ: 'audit.read',                 // view the org audit log
  AGENT_USE: 'agent.use',                   // run AI agents (costs money, drafts artifacts)
};

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

const P = PERMISSIONS;

// Every read permission — the floor for any seat that can open the app.
const READ_PERMISSIONS = [
  P.PLANS_READ, P.PORTFOLIOS_READ, P.DOCUMENTS_READ, P.COMPLIANCE_READ,
];

// The full operational set short of org/billing administration.
const OPERATOR_PERMISSIONS = [
  ...READ_PERMISSIONS,
  P.PLANS_WRITE, P.PLANS_DELETE, P.PORTFOLIOS_WRITE, P.DOCUMENTS_WRITE,
  P.SCREENING_RUN, P.ALERTS_MANAGE, P.AGENT_USE,
];

// ── Role → permissions matrix ───────────────────────────
// Owner is the wildcard super-set (see `can`). The rest are explicit so the
// table reads as the access-review artifact an auditor will ask for.
const ROLE_PERMISSIONS = {
  owner: ALL_PERMISSIONS,
  admin: [
    ...OPERATOR_PERMISSIONS,
    P.ORG_MANAGE, P.ORG_MEMBERS_MANAGE, P.BILLING_MANAGE, P.AUDIT_READ,
  ],
  analyst: [
    ...OPERATOR_PERMISSIONS,
  ],
  finance: [
    ...READ_PERMISSIONS,
    P.BILLING_MANAGE, P.AGENT_USE,
  ],
  compliance_officer: [
    ...READ_PERMISSIONS,
    P.DOCUMENTS_WRITE, P.SCREENING_RUN, P.ALERTS_MANAGE, P.AUDIT_READ, P.AGENT_USE,
  ],
  viewer: [
    ...READ_PERMISSIONS,
  ],
};

// Pre-compute Sets for O(1) lookup; freeze so the matrix can't be mutated.
const ROLE_PERMISSION_SETS = Object.freeze(
  Object.fromEntries(ROLES.map((r) => [r, new Set(ROLE_PERMISSIONS[r] || [])])),
);

// Accepts the six canonical roles AND the legacy 'member' alias.
function isRole(role) {
  return typeof role === 'string' && (ROLES.includes(role) || role in LEGACY_ROLE_ALIASES);
}

function isPermission(permission) {
  return typeof permission === 'string' && ALL_PERMISSIONS.includes(permission);
}

// The one check every handler calls. Unknown role or permission → false
// (fail-closed). Owner short-circuits to true (super-set by definition).
function can(role, permission) {
  const r = canonicalRole(role);
  if (!ROLES.includes(r) || !isPermission(permission)) return false;
  if (r === 'owner') return true;
  return ROLE_PERMISSION_SETS[r].has(permission);
}

// Every permission a role holds (sorted, for display / audit export).
function permissionsFor(role) {
  const r = canonicalRole(role);
  if (!ROLES.includes(r)) return [];
  return [...ROLE_PERMISSION_SETS[r]].sort();
}

// Which roles an actor may assign to others. You can never grant a role at or
// above your own privilege except: an owner may grant any non-owner role; a
// second owner is created only via explicit ownership transfer, never here.
function assignableRoles(actorRole) {
  if (!isRole(actorRole)) return [];
  // Owner is created only via explicit ownership transfer, never granted here.
  // Owner and admin may both assign any non-owner role; everyone else cannot
  // manage members at all (gated separately by ORG_MEMBERS_MANAGE).
  if (actorRole === 'owner' || actorRole === 'admin') {
    return ROLES.filter((r) => r !== 'owner');
  }
  return [];
}

module.exports = {
  ROLES,
  PERMISSIONS,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  LEGACY_ROLE_ALIASES,
  canonicalRole,
  isRole,
  isPermission,
  can,
  permissionsFor,
  assignableRoles,
};
