// Sprint 44 — per-org API keys (v1, read-only).
//
// The biggest enterprise integration gap: programmatic access. v1
// scope is bearer-token authentication for READ endpoints
// (`Authorization: Bearer ot_<32 hex>`). Write endpoints stay
// session-only until a future sprint extends scope.
//
// Threat model + storage discipline:
//   - 128 bits of entropy via crypto.randomBytes(16).toString('hex') —
//     prefixed with 'ot_' so the format is grep-able + paste-able
//     without confusion
//   - Stored HASHED-AT-REST (SHA-256 of the raw key). The hash is
//     uniformly distributed + collision-resistant; bcrypt-style
//     stretching isn't needed because the key has full entropy.
//   - Raw key is RETURNED ONCE on creation + NEVER readable again.
//     The list endpoint surfaces a `redactedKey` ("ot_xxxx…1234")
//     so the user can identify rows without exposing the secret.
//
// KV namespaces:
//   apikey:hash:<sha256>  → metadata {orgId, label, createdAt,
//                                     lastUsedAt, revoked}
//   apikey:org:<orgId>    → array of hashes (per-org index for the
//                                            list endpoint)
//
// All keys are forward-rotatable: revocation flips `revoked: true`
// + removes the hash from the org's array. A revoked key still
// resolves to its metadata via the hash lookup (so we can render
// "revoked at" in audit views), but lookupByBearer returns null on
// any revoked match.

'use strict';

const crypto = require('crypto');
const kv = require('./intelligence/kv-store');

const PREFIX = 'ot_';
const ENTROPY_BYTES = 16; // 128 bits
const KEY_HASH_PREFIX = 'apikey:hash:';
const ORG_INDEX_PREFIX = 'apikey:org:';

// Bearer header parser. Returns the raw key string (with 'ot_'
// prefix) on success, null on any malformed header. Tolerant of
// case ("Bearer" / "bearer") + whitespace; strict on format.
function parseBearer(authHeader) {
  if (typeof authHeader !== 'string') return null;
  const trimmed = authHeader.trim();
  if (!/^bearer\s+/i.test(trimmed)) return null;
  const raw = trimmed.replace(/^bearer\s+/i, '').trim();
  if (!raw.startsWith(PREFIX)) return null;
  return raw;
}

// Hash a raw key. SHA-256 is the index — collision-resistant +
// deterministic so a bearer can hash → KV lookup in O(1).
function hashKey(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

// Redacted form for the list endpoint. Last 4 chars of the raw key
// preserved so the user can map a row back to a clipboard copy.
function redactKey(raw) {
  if (typeof raw !== 'string' || raw.length < 8) return PREFIX + '???';
  return PREFIX + 'xxxx…' + raw.slice(-4);
}

function generateRaw() {
  const hex = crypto.randomBytes(ENTROPY_BYTES).toString('hex');
  return PREFIX + hex;
}

function hashKvKey(hash) { return KEY_HASH_PREFIX + hash; }
function orgIndexKvKey(orgIdNumeric) { return ORG_INDEX_PREFIX + String(orgIdNumeric); }

// Validate a label payload — UI-supplied free-text describing the
// key's purpose. Required, length-bounded, no control characters
// (XSS / log-injection guard).
function validateLabel(label) {
  if (typeof label !== 'string') return { ok: false, error: 'label must be a string' };
  const trimmed = label.trim();
  if (trimmed.length === 0) return { ok: false, error: 'label required' };
  if (trimmed.length > 120) return { ok: false, error: 'label must be at most 120 characters' };
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return { ok: false, error: 'label must not contain control characters' };
  return { ok: true, value: trimmed };
}

// Create a key for the org. Returns the RAW key string (one-time
// reveal) + the stored metadata. Caller is responsible for echoing
// the raw key to the UI; the helper deliberately doesn't expose a
// path to read it again.
//
// @param {{ orgIdNumeric: number, label: string, actorEmailHash?: string }} input
async function createApiKey({ orgIdNumeric, label, actorEmailHash }) {
  if (!Number.isFinite(orgIdNumeric)) return { ok: false, errors: ['orgIdNumeric required'] };
  const labelCheck = validateLabel(label);
  if (!labelCheck.ok) return { ok: false, errors: [labelCheck.error] };
  const raw = generateRaw();
  const hash = hashKey(raw);
  const meta = {
    orgIdNumeric,
    label: labelCheck.value,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revoked: false,
    revokedAt: null,
    createdByEmailHash: actorEmailHash || null,
    redactedKey: redactKey(raw),
  };
  try {
    await kv.set(hashKvKey(hash), meta);
  } catch (err) {
    return { ok: false, errors: [`kv write failed: ${err instanceof Error ? err.message : String(err)}`] };
  }
  // Update org index — read-merge-write so a concurrent creation
  // doesn't lose a hash. v1 accepts the rare-race trade-off
  // (Upstash is single-writer-per-key) since the alternative is
  // a Lua transaction.
  try {
    const existing = (await kv.get(orgIndexKvKey(orgIdNumeric))) || [];
    const arr = Array.isArray(existing) ? existing : [];
    if (!arr.includes(hash)) arr.push(hash);
    await kv.set(orgIndexKvKey(orgIdNumeric), arr);
  } catch (err) {
    // Index write failed — the hash record exists but won't show in
    // the list. Surface to caller so they can decide to retry; the
    // raw key has NOT been returned yet.
    return { ok: false, errors: [`org index write failed: ${err instanceof Error ? err.message : String(err)}`] };
  }
  return {
    ok: true,
    raw,
    keyId: hash,
    metadata: meta,
  };
}

// List keys for the org. The raw key is NEVER returned here — only
// the metadata + redactedKey. Used by GET /api/api-keys.
//
// @param {number} orgIdNumeric
async function listApiKeysForOrg(orgIdNumeric) {
  if (!Number.isFinite(orgIdNumeric)) return [];
  let hashes = [];
  try {
    hashes = (await kv.get(orgIndexKvKey(orgIdNumeric))) || [];
    if (!Array.isArray(hashes)) hashes = [];
  } catch (_) {
    hashes = [];
  }
  /** @type {Array<{ keyId: string, label: string, createdAt: string, lastUsedAt: string | null, revoked: boolean, redactedKey: string }>} */
  const out = [];
  for (const h of hashes) {
    try {
      const meta = await kv.get(hashKvKey(h));
      if (!meta || typeof meta !== 'object') continue;
      out.push({
        keyId: h,
        label: meta.label,
        createdAt: meta.createdAt,
        lastUsedAt: meta.lastUsedAt,
        revoked: !!meta.revoked,
        redactedKey: meta.redactedKey || PREFIX + '???',
      });
    } catch (_) {
      // Skip rows where the hash record disappeared — index is
      // forgiving, list is best-effort.
      continue;
    }
  }
  // Newest first so the user sees freshly-created keys at the top.
  out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return out;
}

// Revoke a key. Sets revoked=true + revokedAt timestamp, AND removes
// the hash from the org index so the list endpoint no longer shows
// it (clean UX). The hash record itself stays so audit views can
// resolve historical references.
//
// @param {{ orgIdNumeric: number, keyId: string, actorEmailHash?: string }} input
async function revokeApiKey({ orgIdNumeric, keyId, actorEmailHash }) {
  if (!Number.isFinite(orgIdNumeric)) return { ok: false, errors: ['orgIdNumeric required'] };
  if (typeof keyId !== 'string' || !keyId) return { ok: false, errors: ['keyId required'] };
  // Cross-check that this key belongs to the org BEFORE flipping
  // revoked=true. A keyId leak from one org shouldn't let an
  // attacker disable another org's keys.
  let meta = null;
  try {
    meta = await kv.get(hashKvKey(keyId));
  } catch (_) {
    return { ok: false, errors: ['kv read failed'] };
  }
  if (!meta || typeof meta !== 'object') {
    return { ok: false, errors: ['key not found'], notFound: true };
  }
  if (meta.orgIdNumeric !== orgIdNumeric) {
    // Same 404 shape as not-found — never "this exists but isn't
    // yours" (sprint 18 security lesson).
    return { ok: false, errors: ['key not found'], notFound: true };
  }
  if (meta.revoked) {
    // Idempotent — already revoked is success. The audit chain
    // captures the first revocation; a re-revoke is a no-op.
    return { ok: true, alreadyRevoked: true, metadata: meta };
  }
  const updated = {
    ...meta,
    revoked: true,
    revokedAt: new Date().toISOString(),
    revokedByEmailHash: actorEmailHash || null,
  };
  try {
    await kv.set(hashKvKey(keyId), updated);
  } catch (err) {
    return { ok: false, errors: [`kv write failed: ${err instanceof Error ? err.message : String(err)}`] };
  }
  // Remove from the org index. Best-effort — a stale hash in the
  // index is harmless (the list endpoint filters out revoked
  // entries when surfaced).
  try {
    const existing = (await kv.get(orgIndexKvKey(orgIdNumeric))) || [];
    const arr = (Array.isArray(existing) ? existing : []).filter((h) => h !== keyId);
    await kv.set(orgIndexKvKey(orgIdNumeric), arr);
  } catch (_) {
    // Logged at the caller boundary; revocation succeeded.
  }
  return { ok: true, metadata: updated };
}

// Resolve a bearer token to an org context. Returns null on any
// failure (malformed header, no matching hash, revoked key). On a
// hit, returns the metadata + updates lastUsedAt best-effort.
//
// The lastUsedAt update is FIRE-AND-FORGET so a hot read path
// doesn't pay the KV write cost on every API call.
//
// @param {string} authHeader
async function lookupByBearer(authHeader) {
  const raw = parseBearer(authHeader);
  if (!raw) return null;
  const hash = hashKey(raw);
  let meta = null;
  try {
    meta = await kv.get(hashKvKey(hash));
  } catch (_) {
    return null;
  }
  if (!meta || typeof meta !== 'object') return null;
  if (meta.revoked) return null;
  // Fire-and-forget lastUsedAt update — best-effort, never blocks
  // the caller. A miss here just means the "last used" column
  // lags slightly.
  Promise.resolve().then(async () => {
    try {
      await kv.set(hashKvKey(hash), { ...meta, lastUsedAt: new Date().toISOString() });
    } catch (_) { /* swallowed */ }
  });
  return {
    orgIdNumeric: meta.orgIdNumeric,
    label: meta.label,
    keyId: hash,
  };
}

module.exports = {
  PREFIX,
  ENTROPY_BYTES,
  KEY_HASH_PREFIX,
  ORG_INDEX_PREFIX,
  parseBearer,
  hashKey,
  redactKey,
  generateRaw,
  validateLabel,
  createApiKey,
  listApiKeysForOrg,
  revokeApiKey,
  lookupByBearer,
};
