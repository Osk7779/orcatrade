// Organisation + seat model — Sprint BG-3.1 foundation.
//
// What it gives us
// ────────────────
// Today the tier system keys off `tier:<email>`. That means one user
// per subscription, no seats, no team-plan story. Every conversation
// with a company larger than 5 people hits this wall — Track 3 of
// backend-grade-plan.md exists to solve it.
//
// This module is the FOUNDATION layer:
//   - createOrg(name, ownerEmail)       → { id, name, ownerEmail, ... }
//   - getOrg(id)                        → record or null
//   - addMember(orgId, email, role)     → membership record
//   - removeMember(orgId, email)
//   - listMembers(orgId)                → array
//   - listOrgsForEmail(email)           → array of orgs the user belongs to
//   - transferOwnership(orgId, fromEmail, toEmail)
//
// Tier migration (tier:<email> → tier:<orgId>) is a SEPARATE follow-up
// sprint with bigger blast radius — billing, plan ownership, gating
// all need updates in lockstep. This module is shaped so that migration
// is a re-key operation, not a re-design.
//
// Storage layout
// ──────────────
//   org:<orgId>              → { id, name, ownerEmail, createdAt, updatedAt }
//   org:members:<orgId>      → [ { email, role, invitedAt, joinedAt }, … ]
//   org:byEmail:<email>      → [ orgId, … ]  (denormalised index for fast listOrgsForEmail)
//
// All TTLs are 5 years — orgs don't disappear; deletion is explicit.

'use strict';

const crypto = require('node:crypto');
const kv = require('./intelligence/kv-store');

const ORG_TTL_SECONDS = 5 * 365 * 24 * 60 * 60;
const ALLOWED_ROLES = new Set(['owner', 'admin', 'member']);

function generateOrgId() {
  return 'org_' + crypto.randomBytes(8).toString('hex');
}

function normaliseEmail(email) {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

function isValidName(name) {
  return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 100;
}

function orgKey(orgId) { return `org:${orgId}`; }
function membersKey(orgId) { return `org:members:${orgId}`; }
function emailIndexKey(email) { return `org:byEmail:${email}`; }

// ── Create / read ────────────────────────────────────────────

async function createOrg({ name, ownerEmail }) {
  const email = normaliseEmail(ownerEmail);
  if (!email) throw new Error('createOrg: ownerEmail required');
  if (!isValidName(name)) throw new Error('createOrg: name must be 1-100 chars');

  const orgId = generateOrgId();
  const now = new Date().toISOString();
  const record = {
    id: orgId,
    name: name.trim(),
    ownerEmail: email,
    createdAt: now,
    updatedAt: now,
  };
  const ownerMembership = {
    email,
    role: 'owner',
    invitedAt: now,
    joinedAt: now,
  };

  await kv.set(orgKey(orgId), record, { ttlSeconds: ORG_TTL_SECONDS });
  await kv.set(membersKey(orgId), [ownerMembership], { ttlSeconds: ORG_TTL_SECONDS });

  // Update the per-email index.
  const existing = (await kv.get(emailIndexKey(email))) || [];
  if (!existing.includes(orgId)) existing.push(orgId);
  await kv.set(emailIndexKey(email), existing, { ttlSeconds: ORG_TTL_SECONDS });

  return record;
}

async function getOrg(orgId) {
  if (!orgId || typeof orgId !== 'string') return null;
  return await kv.get(orgKey(orgId));
}

async function listMembers(orgId) {
  if (!orgId) return [];
  const m = await kv.get(membersKey(orgId));
  return Array.isArray(m) ? m : [];
}

async function listOrgsForEmail(email) {
  const e = normaliseEmail(email);
  if (!e) return [];
  const ids = (await kv.get(emailIndexKey(e))) || [];
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const orgs = [];
  for (const id of ids) {
    const o = await getOrg(id);
    if (o) orgs.push(o);
  }
  return orgs;
}

// ── Membership ───────────────────────────────────────────────

async function addMember(orgId, { email, role = 'member' }) {
  const e = normaliseEmail(email);
  if (!e) throw new Error('addMember: email required');
  if (!ALLOWED_ROLES.has(role)) throw new Error(`addMember: role must be one of ${[...ALLOWED_ROLES].join(', ')}`);
  // Only one owner per org — enforce at the addMember layer too.
  if (role === 'owner') throw new Error('addMember: cannot add a second owner; use transferOwnership instead');

  const org = await getOrg(orgId);
  if (!org) throw new Error(`addMember: org ${orgId} not found`);

  const members = await listMembers(orgId);
  if (members.find(m => m.email === e)) {
    return { alreadyMember: true, member: members.find(m => m.email === e) };
  }

  const now = new Date().toISOString();
  const membership = { email: e, role, invitedAt: now, joinedAt: now };
  const updated = [...members, membership];
  await kv.set(membersKey(orgId), updated, { ttlSeconds: ORG_TTL_SECONDS });

  // Update the per-email index.
  const idx = (await kv.get(emailIndexKey(e))) || [];
  if (!idx.includes(orgId)) idx.push(orgId);
  await kv.set(emailIndexKey(e), idx, { ttlSeconds: ORG_TTL_SECONDS });

  return { alreadyMember: false, member: membership };
}

async function removeMember(orgId, email) {
  const e = normaliseEmail(email);
  const members = await listMembers(orgId);
  const target = members.find(m => m.email === e);
  if (!target) return { removed: false, reason: 'not-a-member' };
  if (target.role === 'owner') return { removed: false, reason: 'cannot-remove-owner' };

  const updated = members.filter(m => m.email !== e);
  await kv.set(membersKey(orgId), updated, { ttlSeconds: ORG_TTL_SECONDS });

  // Drop from the per-email index.
  const idx = (await kv.get(emailIndexKey(e))) || [];
  const newIdx = idx.filter(id => id !== orgId);
  if (newIdx.length) await kv.set(emailIndexKey(e), newIdx, { ttlSeconds: ORG_TTL_SECONDS });
  else await kv.del(emailIndexKey(e));

  return { removed: true };
}

async function transferOwnership(orgId, { fromEmail, toEmail }) {
  const from = normaliseEmail(fromEmail);
  const to = normaliseEmail(toEmail);
  if (!from || !to) throw new Error('transferOwnership: fromEmail + toEmail required');
  if (from === to) throw new Error('transferOwnership: from and to are the same email');

  const org = await getOrg(orgId);
  if (!org) throw new Error(`transferOwnership: org ${orgId} not found`);
  if (org.ownerEmail !== from) throw new Error('transferOwnership: fromEmail is not the current owner');

  const members = await listMembers(orgId);
  const toMember = members.find(m => m.email === to);
  if (!toMember) throw new Error('transferOwnership: new owner must already be a member of the org');

  const updatedMembers = members.map(m => {
    if (m.email === from) return { ...m, role: 'admin' };  // demote old owner to admin
    if (m.email === to) return { ...m, role: 'owner' };
    return m;
  });
  await kv.set(membersKey(orgId), updatedMembers, { ttlSeconds: ORG_TTL_SECONDS });

  const updatedOrg = { ...org, ownerEmail: to, updatedAt: new Date().toISOString() };
  await kv.set(orgKey(orgId), updatedOrg, { ttlSeconds: ORG_TTL_SECONDS });

  return updatedOrg;
}

// ── Authorisation helpers (consumed by handlers) ─────────────

async function hasRole(orgId, email, requiredRole) {
  const e = normaliseEmail(email);
  const members = await listMembers(orgId);
  const member = members.find(m => m.email === e);
  if (!member) return false;
  // Role precedence: owner > admin > member.
  const ranks = { owner: 3, admin: 2, member: 1 };
  return (ranks[member.role] || 0) >= (ranks[requiredRole] || 0);
}

// ── Admin: list every org on the platform (Sprint BG-3.6) ──
//
// Scans every `org:<id>` KV key, skipping the index keys
// (`org:members:*`, `org:byEmail:*`). Returns records sorted newest-
// first by createdAt so the /dashboard/orgs/ admin view surfaces
// recent activity at the top. Each record is the bare org object;
// member counts + tier lookups happen in the admin handler so a
// future change in shape doesn't require rewriting this storage-
// layer function.
async function listAllOrgs({ limit = 1000 } = {}) {
  const allKeys = (await kv.listKeys('org:')) || [];
  const orgIdKeys = allKeys.filter((k) => {
    if (!k.startsWith('org:')) return false;
    // Skip the two index namespaces — they're not org records.
    if (k.startsWith('org:members:')) return false;
    if (k.startsWith('org:byEmail:')) return false;
    return true;
  });
  const safeLimit = Math.max(1, Math.min(10000, Number(limit) || 1000));
  const records = [];
  for (const key of orgIdKeys) {
    const rec = await kv.get(key);
    if (rec && rec.id) records.push(rec);
    if (records.length >= safeLimit) break;
  }
  // Newest-first; missing createdAt sinks to the bottom.
  records.sort((a, b) => {
    const at = a.createdAt || '';
    const bt = b.createdAt || '';
    return bt.localeCompare(at);
  });
  return records;
}

module.exports = {
  ORG_TTL_SECONDS,
  ALLOWED_ROLES,
  generateOrgId,
  normaliseEmail,
  isValidName,
  createOrg,
  getOrg,
  listMembers,
  listOrgsForEmail,
  listAllOrgs,
  addMember,
  removeMember,
  transferOwnership,
  hasRole,
  orgKey,
  membersKey,
  emailIndexKey,
};
