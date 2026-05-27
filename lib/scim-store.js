// SCIM provisioning token store (apex plan III1 — SCIM slice 1).
//
// Enterprise IdPs (Okta, Entra ID, OneLogin) provision/deprovision users into
// an org over SCIM 2.0, authenticating with a long-lived bearer token the org
// admin pastes into the IdP. This module mints, resolves, and revokes that
// per-org token. We store only a SHA-256 of the token (never the raw value) —
// the raw token is shown once at creation, exactly like an API key.
//
// Storage layout (KV):
//   scim:token:<sha256(token)>  → orgId          (reverse lookup for auth)
//   scim:org:<orgId>            → { tokenHash, createdAt, lastUsedAt }
//
// No PII: the token is random, the org id is opaque. KV-only (no PG mirror) —
// it's credential state, regenerated on rotation, not durable corpus.

'use strict';

const crypto = require('node:crypto');
const kv = require('./intelligence/kv-store');

const TOKEN_PREFIX = 'scim:token:';
const ORG_PREFIX = 'scim:org:';
const TTL_SECONDS = 5 * 365 * 24 * 60 * 60; // tokens are long-lived (rotated explicitly)

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

function tokenKey(hash) { return TOKEN_PREFIX + hash; }
function orgKey(orgId) { return ORG_PREFIX + String(orgId).trim(); }

// Mint (or rotate) the SCIM token for an org. Returns { token, createdAt } with
// the RAW token — shown once; only its hash is persisted. Rotating invalidates
// the previous token (its hash row is deleted).
async function generateToken(orgId) {
  const id = String(orgId || '').trim();
  if (!id) throw new Error('generateToken: orgId required');

  // Invalidate any existing token first.
  const prior = await kv.get(orgKey(id));
  if (prior && prior.tokenHash) {
    try { await kv.del(tokenKey(prior.tokenHash)); } catch (_) { /* best effort */ }
  }

  const token = 'scim_' + crypto.randomBytes(24).toString('hex');
  const tokenHash = hashToken(token);
  const createdAt = new Date().toISOString();

  await kv.set(tokenKey(tokenHash), id, { ttlSeconds: TTL_SECONDS });
  await kv.set(orgKey(id), { tokenHash, createdAt, lastUsedAt: null }, { ttlSeconds: TTL_SECONDS });
  return { token, createdAt };
}

// Resolve a presented bearer token to its org id, or null. Stamps lastUsedAt
// (best-effort) so the admin UI can show recent provisioning activity.
async function resolveOrgIdByToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const orgId = await kv.get(tokenKey(hashToken(rawToken)));
  if (!orgId) return null;
  try {
    const meta = await kv.get(orgKey(orgId));
    if (meta) await kv.set(orgKey(orgId), { ...meta, lastUsedAt: new Date().toISOString() }, { ttlSeconds: TTL_SECONDS });
  } catch (_) { /* lastUsedAt is non-load-bearing */ }
  return orgId;
}

// Non-secret status for the admin UI: whether SCIM is configured + timestamps.
async function getStatus(orgId) {
  const meta = await kv.get(orgKey(orgId));
  if (!meta || !meta.tokenHash) return { configured: false };
  return { configured: true, createdAt: meta.createdAt || null, lastUsedAt: meta.lastUsedAt || null };
}

async function revoke(orgId) {
  const id = String(orgId || '').trim();
  const meta = await kv.get(orgKey(id));
  if (meta && meta.tokenHash) {
    try { await kv.del(tokenKey(meta.tokenHash)); } catch (_) { /* best effort */ }
  }
  await kv.del(orgKey(id));
  return { revoked: true };
}

// Parse a bearer token out of the Authorization header.
function bearerFromReq(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(h).trim());
  return m ? m[1].trim() : null;
}

module.exports = {
  TOKEN_PREFIX,
  ORG_PREFIX,
  hashToken,
  generateToken,
  resolveOrgIdByToken,
  getStatus,
  revoke,
  bearerFromReq,
};
