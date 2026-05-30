// /api/scim/v2/* — SCIM 2.0 user provisioning (apex plan III1 — SCIM slice 1).
//
// An enterprise IdP (Okta / Entra ID / OneLogin) provisions and deprovisions
// org members here, authenticating with the per-org bearer token minted by
// lib/scim-store.js. SCIM Users map 1:1 onto OrcaTrade org memberships:
//   provision (POST / PATCH active:true) → orgs.addMember(role: viewer)
//   deprovision (DELETE / PATCH active:false) → orgs.removeMember
//
//   GET    /api/scim/v2/ServiceProviderConfig   → capability discovery
//   GET    /api/scim/v2/Users[?filter=userName eq "x"]
//   POST   /api/scim/v2/Users          { userName }       → provision
//   GET    /api/scim/v2/Users/<id>
//   PATCH  /api/scim/v2/Users/<id>     { Operations: [...] }  → (de)activate
//   DELETE /api/scim/v2/Users/<id>     → deprovision
//   GET    /api/scim/v2/Groups         → one group per RBAC role (id = role)
//   GET    /api/scim/v2/Groups/<role>
//   PATCH  /api/scim/v2/Groups/<role>  { Operations: [...] }  → add/remove sets a member's role
//
// The SCIM `id` is the member's email_hash — stable, opaque, and resolvable by
// scanning the org's members. Default provisioned role is viewer; group→role
// mapping + enforced-SSO are later slices.

'use strict';

const scimStore = require('../scim-store');
const orgs = require('../orgs');
const rbac = require('../rbac');
const hash = require('../hash');
const events = require('../events');
const log = require('../log').withContext({ handler: 'scim' });

const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const DEFAULT_PROVISION_ROLE = 'viewer';

// Each assignable RBAC role is exposed as a SCIM Group (id = displayName =
// role). An IdP admin maps their directory group to e.g. the "finance" group;
// pushing a user into it sets that member's role. Owner is never a group
// (ownership transfers explicitly, not via the IdP).
const ROLE_GROUPS = rbac.ROLES.filter((r) => r !== 'owner');

function scimResponse(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/scim+json');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(body == null ? '' : JSON.stringify(body));
}

function scimError(res, status, detail) {
  return scimResponse(res, status, { schemas: [SCIM_ERROR_SCHEMA], status: String(status), detail });
}

function segmentsFromReq(req) {
  if (req.query && req.query.path) {
    const parts = Array.isArray(req.query.path) ? req.query.path : String(req.query.path).split('/');
    return parts.slice(1); // drop leading 'scim'
  }
  const url = (req.url || '').split('?')[0];
  return url.replace(/^\/api\/scim\/?/, '').split('/').filter(Boolean);
}

// Map an org membership record to a SCIM User resource.
function toScimUser(member) {
  const id = hash.emailHash(member.email);
  return {
    schemas: [SCIM_USER_SCHEMA],
    id,
    userName: member.email,
    active: true, // present in the member list ⇒ active; deprovision removes the row
    name: { formatted: member.email },
    emails: [{ value: member.email, primary: true, type: 'work' }],
    roles: member.role ? [{ value: member.role, primary: true }] : [],
    meta: { resourceType: 'User', location: `/api/scim/v2/Users/${id}` },
  };
}

async function findMemberByScimId(orgId, scimId) {
  const members = await orgs.listMembers(orgId);
  return members.find((m) => hash.emailHash(m.email) === scimId) || null;
}

function emailFromCreateBody(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.userName) return String(body.userName).toLowerCase().trim();
  if (Array.isArray(body.emails) && body.emails[0] && body.emails[0].value) {
    return String(body.emails[0].value).toLowerCase().trim();
  }
  return null;
}

// Extract an `active` boolean from a SCIM PATCH Operations array, tolerating
// both shapes IdPs send: { op:'replace', path:'active', value:false } and
// { op:'replace', value:{ active:false } }.
function activeFromPatch(body) {
  const ops = body && Array.isArray(body.Operations) ? body.Operations : [];
  for (const op of ops) {
    if (!op || String(op.op || '').toLowerCase() !== 'replace') continue;
    if (String(op.path || '').toLowerCase() === 'active') return op.value === false || op.value === 'false' ? false : true;
    if (op.value && typeof op.value === 'object' && 'active' in op.value) {
      return op.value.active === false || op.value.active === 'false' ? false : true;
    }
  }
  return null; // no active change in this patch
}

// Build a SCIM Group resource for a role from the current member list.
function toScimGroup(role, members) {
  const inRole = members.filter((m) => rbac.canonicalRole(m.role) === role);
  return {
    schemas: [SCIM_GROUP_SCHEMA],
    id: role,
    displayName: role,
    members: inRole.map((m) => ({ value: hash.emailHash(m.email), display: m.email })),
    meta: { resourceType: 'Group', location: `/api/scim/v2/Groups/${role}` },
  };
}

// Pull the member-value list out of a SCIM Group PATCH op (Okta sends
// value: [{ value: <userId> }]; some send a single object or a bare string).
function memberValuesFromOp(op) {
  const v = op && op.value;
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => (x && typeof x === 'object' ? x.value : x)).filter(Boolean).map(String);
}

// ── Sub-handlers ────────────────────────────────────────

function serviceProviderConfig(res) {
  return scimResponse(res, 200, {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: 'oauthbearertoken', name: 'OAuth Bearer Token', description: 'Per-org SCIM token' }],
  });
}

async function listUsers(req, res, orgId) {
  const members = await orgs.listMembers(orgId);
  // Minimal `userName eq "x"` filter support — IdPs query before provisioning.
  let resources = members.map(toScimUser);
  const filter = (req.query && req.query.filter) || (new URL(req.url, 'http://x').searchParams.get('filter'));
  if (filter) {
    const m = /userName\s+eq\s+"([^"]+)"/i.exec(String(filter));
    if (m) {
      const wanted = m[1].toLowerCase().trim();
      resources = resources.filter((u) => u.userName.toLowerCase() === wanted);
    }
  }
  return scimResponse(res, 200, {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: resources.length,
    startIndex: 1,
    itemsPerPage: resources.length,
    Resources: resources,
  });
}

async function provisionUser(req, res, orgId) {
  const email = emailFromCreateBody(req.body);
  if (!email) return scimError(res, 400, 'userName (email) is required');

  const existing = (await orgs.listMembers(orgId)).find((m) => m.email === email);
  if (existing) {
    // Idempotent create: return the existing resource rather than 409, so IdPs
    // that POST-before-check don't error on re-provisioning.
    return scimResponse(res, 200, toScimUser(existing));
  }
  try {
    const result = await orgs.addMember(orgId, { email, role: DEFAULT_PROVISION_ROLE });
    // ADR 0005 — audit-log write propagates; dispatcher returns 5xx on failure.
    // Phase 1 reorders to audit-FIRST + explicit 503.
    await events.record('scim_user_provisioned', { orgId, targetEmail: email, role: DEFAULT_PROVISION_ROLE });
    log.info('scim user provisioned', { requestId: req.requestId, orgId });
    return scimResponse(res, 201, toScimUser(result.member));
  } catch (err) {
    return scimError(res, 400, err.message || 'provision failed');
  }
}

async function patchUser(req, res, orgId, scimId) {
  const member = await findMemberByScimId(orgId, scimId);
  if (!member) return scimError(res, 404, 'user not found');
  const active = activeFromPatch(req.body);
  if (active === false) {
    await orgs.removeMember(orgId, member.email);
    // ADR 0005 — audit-log write propagates.
    await events.record('scim_user_deprovisioned', { orgId, targetEmail: member.email, via: 'patch' });
    return scimResponse(res, 200, { ...toScimUser(member), active: false });
  }
  // active:true or no-op → user already present; echo current state.
  return scimResponse(res, 200, toScimUser(member));
}

async function deleteUser(req, res, orgId, scimId) {
  const member = await findMemberByScimId(orgId, scimId);
  if (!member) return scimError(res, 404, 'user not found');
  await orgs.removeMember(orgId, member.email);
  // ADR 0005 — audit-log write propagates.
  await events.record('scim_user_deprovisioned', { orgId, targetEmail: member.email, via: 'delete' });
  return scimResponse(res, 204, null);
}

async function listGroups(req, res, orgId) {
  const members = await orgs.listMembers(orgId);
  const resources = ROLE_GROUPS.map((role) => toScimGroup(role, members));
  return scimResponse(res, 200, {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: resources.length,
    startIndex: 1,
    itemsPerPage: resources.length,
    Resources: resources,
  });
}

async function getGroup(req, res, orgId, role) {
  if (!ROLE_GROUPS.includes(role)) return scimError(res, 404, 'group not found');
  const members = await orgs.listMembers(orgId);
  return scimResponse(res, 200, toScimGroup(role, members));
}

// PATCH a role-group's membership: 'add' → set those members to this role;
// 'remove' → demote to viewer. 'replace' on members is treated as the new
// complete set for the group (added → role, previously-in-role → viewer).
async function patchGroup(req, res, orgId, role) {
  if (!ROLE_GROUPS.includes(role)) return scimError(res, 404, 'group not found');
  const ops = req.body && Array.isArray(req.body.Operations) ? req.body.Operations : [];
  let changed = 0;

  async function setRoleByScimId(scimId, newRole) {
    const member = await findMemberByScimId(orgId, scimId);
    if (!member) return;
    const r = await orgs.changeMemberRole(orgId, { email: member.email, role: newRole });
    if (r.changed) {
      changed++;
      // ADR 0005 — audit-log write propagates.
      await events.record('scim_group_role_applied', { orgId, targetEmail: member.email, role: newRole, group: role });
    }
  }

  for (const op of ops) {
    const verb = String(op.op || '').toLowerCase();
    const onMembers = !op.path || String(op.path).toLowerCase().startsWith('members');
    if (!onMembers) continue;
    const values = memberValuesFromOp(op);
    if (verb === 'add') {
      for (const id of values) await setRoleByScimId(id, role);
    } else if (verb === 'remove') {
      for (const id of values) await setRoleByScimId(id, DEFAULT_PROVISION_ROLE);
    } else if (verb === 'replace') {
      const wanted = new Set(values);
      const members = await orgs.listMembers(orgId);
      // Add the listed members to this role…
      for (const id of wanted) await setRoleByScimId(id, role);
      // …and demote anyone currently in this role who isn't in the new set.
      for (const m of members) {
        if (rbac.canonicalRole(m.role) === role && !wanted.has(hash.emailHash(m.email))) {
          await setRoleByScimId(hash.emailHash(m.email), DEFAULT_PROVISION_ROLE);
        }
      }
    }
  }
  const members = await orgs.listMembers(orgId);
  log.info('scim group patched', { requestId: req.requestId, orgId, group: role, changed });
  return scimResponse(res, 200, toScimGroup(role, members));
}

// ── Dispatcher ──────────────────────────────────────────

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  // Bearer-token auth, scoped to one org. No session cookie — this is a
  // machine-to-machine endpoint the customer's IdP calls.
  const token = scimStore.bearerFromReq(req);
  if (!token) return scimError(res, 401, 'Missing bearer token');
  const orgId = await scimStore.resolveOrgIdByToken(token);
  if (!orgId) return scimError(res, 401, 'Invalid SCIM token');

  const segments = segmentsFromReq(req);      // ['v2','Users', <id>?]
  const version = segments[0] || '';
  const resource = segments[1] || '';
  const resourceId = segments[2] || '';
  if (version !== 'v2') return scimError(res, 404, 'unsupported SCIM version');

  if (resource === 'ServiceProviderConfig') {
    if (req.method === 'GET') return serviceProviderConfig(res);
    return scimError(res, 405, 'method not allowed');
  }

  if (resource === 'Users') {
    if (!resourceId) {
      if (req.method === 'GET') return listUsers(req, res, orgId);
      if (req.method === 'POST') return provisionUser(req, res, orgId);
      return scimError(res, 405, 'method not allowed');
    }
    if (req.method === 'GET') {
      const member = await findMemberByScimId(orgId, resourceId);
      return member ? scimResponse(res, 200, toScimUser(member)) : scimError(res, 404, 'user not found');
    }
    if (req.method === 'PATCH') return patchUser(req, res, orgId, resourceId);
    if (req.method === 'PUT') return patchUser(req, res, orgId, resourceId); // treat PUT like PATCH for active
    if (req.method === 'DELETE') return deleteUser(req, res, orgId, resourceId);
    return scimError(res, 405, 'method not allowed');
  }

  if (resource === 'Groups') {
    if (!resourceId) {
      if (req.method === 'GET') return listGroups(req, res, orgId);
      return scimError(res, 405, 'method not allowed');
    }
    if (req.method === 'GET') return getGroup(req, res, orgId, resourceId);
    if (req.method === 'PATCH' || req.method === 'PUT') return patchGroup(req, res, orgId, resourceId);
    return scimError(res, 405, 'method not allowed');
  }

  return scimError(res, 404, `unknown SCIM resource: ${resource || '(none)'}`);
};

// Exposed for tests.
module.exports.toScimUser = toScimUser;
module.exports.activeFromPatch = activeFromPatch;
module.exports.emailFromCreateBody = emailFromCreateBody;
