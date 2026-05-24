// Agent memory & continuity (Sprint agent-memory-v1 / apex-plan Pillar I2).
//
// Durable per-user memory the personal orchestrator reads/writes across
// sessions, so the agent can carry context forward: "our supplier is in
// Shenzhen", "target margin 35%", "we always ship via Rotterdam". The agent
// decides what's worth remembering; this module just stores + retrieves it,
// scoped to one user.
//
// Storage layout (KV is the synchronous primary, mirrors saved-plans):
//   agentmem:<email>:<key>   → { key, value, kind, createdAt, updatedAt }
//   agentmem:index:<email>   → array of keys (most-recently-updated first)
//
// Postgres dual-write (best-effort, never throws) keeps the durable corpus;
// raw email NEVER lands in PG (email_hash only). Caps bound the blast radius:
// at most MAX_MEMORIES_PER_USER keys, each value clamped to MAX_VALUE_CHARS.

'use strict';

const kv = require('./intelligence/kv-store');
const hash = require('./hash');

const MEM_KEY_PREFIX = 'agentmem:';
const MEM_INDEX_PREFIX = 'agentmem:index:';
const MAX_MEMORIES_PER_USER = 100;
const MAX_VALUE_CHARS = 2000;
const MAX_KEY_CHARS = 80;
const MEM_TTL_DAYS = 730; // 2 years; refreshed on every write
const ALLOWED_KINDS = ['preference', 'fact', 'context'];

function normaliseEmail(email) {
  return String(email || '').toLowerCase().trim();
}

// Slugify a memory key: lowercase, alnum + dashes, bounded. Keeps keys stable
// and KV-safe ("Target Margin" → "target-margin").
function normaliseKey(key) {
  return String(key || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_KEY_CHARS);
}

function memKey(email, key) {
  return MEM_KEY_PREFIX + normaliseEmail(email) + ':' + key;
}

function indexKey(email) {
  return MEM_INDEX_PREFIX + normaliseEmail(email);
}

function ttlSeconds() {
  return MEM_TTL_DAYS * 24 * 60 * 60;
}

function clampValue(value) {
  if (typeof value === 'string') return value.slice(0, MAX_VALUE_CHARS);
  // Non-string values are JSON-stringified for the size check, stored as-is
  // when within budget.
  try {
    const s = JSON.stringify(value);
    if (s && s.length <= MAX_VALUE_CHARS) return value;
    return String(s).slice(0, MAX_VALUE_CHARS);
  } catch (_) {
    return String(value).slice(0, MAX_VALUE_CHARS);
  }
}

// Upsert a memory. Returns { key, created } or { error }.
async function remember(email, { key, value, kind = 'fact' } = {}) {
  const e = normaliseEmail(email);
  const k = normaliseKey(key);
  if (!e) return { error: 'email required' };
  if (!k) return { error: 'a non-empty key is required' };
  if (value === undefined || value === null || value === '') return { error: 'value required' };
  const kindSafe = ALLOWED_KINDS.includes(kind) ? kind : 'fact';

  const ids = (await kv.get(indexKey(e))) || [];
  const existing = await kv.get(memKey(e, k));
  // Enforce the per-user cap on NEW keys only (overwrites are always allowed).
  if (!existing && ids.length >= MAX_MEMORIES_PER_USER) {
    return { error: `memory is full (${MAX_MEMORIES_PER_USER} keys); forget something first` };
  }

  const now = new Date().toISOString();
  const record = {
    key: k,
    value: clampValue(value),
    kind: kindSafe,
    createdAt: existing && existing.createdAt ? existing.createdAt : now,
    updatedAt: now,
  };
  await kv.set(memKey(e, k), record, { ttlSeconds: ttlSeconds() });
  const updatedIds = [k, ...ids.filter((x) => x !== k)].slice(0, MAX_MEMORIES_PER_USER);
  await kv.set(indexKey(e), updatedIds, { ttlSeconds: ttlSeconds() });

  recordPg(e, record).catch(() => {});
  return { key: k, created: !existing };
}

// Recall one memory by key, or null.
async function recall(email, key) {
  const e = normaliseEmail(email);
  const k = normaliseKey(key);
  if (!e || !k) return null;
  return (await kv.get(memKey(e, k))) || null;
}

// List all of a user's memories (most-recently-updated first).
async function list(email) {
  const e = normaliseEmail(email);
  if (!e) return [];
  const ids = (await kv.get(indexKey(e))) || [];
  if (!Array.isArray(ids) || !ids.length) return [];
  const out = [];
  for (const k of ids) {
    const r = await kv.get(memKey(e, k));
    if (r) out.push(r);
  }
  return out;
}

// Forget one memory. Returns true when something was removed.
async function forget(email, key) {
  const e = normaliseEmail(email);
  const k = normaliseKey(key);
  if (!e || !k) return false;
  const existing = await kv.get(memKey(e, k));
  if (!existing) return false;
  await kv.del(memKey(e, k));
  const ids = (await kv.get(indexKey(e))) || [];
  await kv.set(indexKey(e), ids.filter((x) => x !== k), { ttlSeconds: ttlSeconds() });
  deletePgKey(e, k).catch(() => {});
  return true;
}

// GDPR — purge every memory for a user (account deletion). Returns the count.
async function deleteAllForUser(email) {
  const e = normaliseEmail(email);
  if (!e) return 0;
  const ids = (await kv.get(indexKey(e))) || [];
  let removed = 0;
  for (const k of ids) { await kv.del(memKey(e, k)); removed++; }
  await kv.del(indexKey(e));
  purgePg(e).catch(() => {});
  return removed;
}

// ── Postgres dual-write (best-effort) ───────────────────

function emailHashFor(email) {
  return hash.isAlreadyPseudonym(email) ? String(email) : hash.emailHash(email);
}

async function recordPg(email, record) {
  let db;
  try { db = require('./db/client'); } catch (_) { return; }
  if (!db.isConfigured()) return;
  try {
    await db.query(
      `INSERT INTO agent_memory (email_hash, mem_key, kind, value_json, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, now())
       ON CONFLICT (email_hash, mem_key) DO UPDATE
         SET kind = EXCLUDED.kind,
             value_json = EXCLUDED.value_json,
             updated_at = now()`,
      [emailHashFor(email), record.key, record.kind, JSON.stringify({ value: record.value })],
    );
  } catch (_) { /* never propagate */ }
}

async function deletePgKey(email, key) {
  let db;
  try { db = require('./db/client'); } catch (_) { return; }
  if (!db.isConfigured()) return;
  try {
    await db.query('DELETE FROM agent_memory WHERE email_hash = $1 AND mem_key = $2', [emailHashFor(email), key]);
  } catch (_) { /* never propagate */ }
}

async function purgePg(email) {
  let db;
  try { db = require('./db/client'); } catch (_) { return; }
  if (!db.isConfigured()) return;
  try {
    await db.query('DELETE FROM agent_memory WHERE email_hash = $1', [emailHashFor(email)]);
  } catch (_) { /* never propagate */ }
}

module.exports = {
  MEM_KEY_PREFIX,
  MEM_INDEX_PREFIX,
  MAX_MEMORIES_PER_USER,
  MAX_VALUE_CHARS,
  MAX_KEY_CHARS,
  ALLOWED_KINDS,
  normaliseEmail,
  normaliseKey,
  memKey,
  indexKey,
  remember,
  recall,
  list,
  forget,
  deleteAllForUser,
};
