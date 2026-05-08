// KV-store primitives — the abstraction layer that upcoming H2 sprints
// (auth tokens, saved plans, event log, analytics) build against.
//
// Two backends with identical API:
//   1. Durable — Vercel KV (Upstash Redis) via REST API. Active when
//      KV_REST_API_URL + KV_REST_API_TOKEN env vars are set (or the
//      UPSTASH_REDIS_REST_* aliases).
//   2. Memory — in-process Map keyed by global namespace. Active when no
//      durable backend is configured.
//
// The memory backend is single-instance and cleared on cold start; it is
// suitable for local dev and short-lived rate-limit windows but NOT for
// anything requiring durability across deploys (auth tokens, saved plans).
// Production traffic should always run against KV.
//
// Why this is separate from runtime-store.js:
//   runtime-store has battle-tested business logic (compliance report
//   persistence, evidence bundles, workspace profiles, rate limiting).
//   It works and ships. This module is a *primitives* layer used by the
//   newer sprints to avoid re-deriving mode detection.

'use strict';

// ── Mode detection ─────────────────────────────────────

function kvUrl() {
  return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
}

function kvToken() {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
}

function isConfigured() {
  return !!(kvUrl() && kvToken());
}

function getMode() {
  return isConfigured() ? 'durable' : 'memory';
}

// ── In-memory backend ──────────────────────────────────

const memoryStore = new Map(); // key → { value, expiresAt }

function purgeExpired() {
  const now = Date.now();
  for (const [k, v] of memoryStore.entries()) {
    if (v.expiresAt && v.expiresAt <= now) memoryStore.delete(k);
  }
}

function memSet(key, value, ttlSeconds) {
  const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
  memoryStore.set(key, { value, expiresAt });
}

function memGet(key) {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

function memDel(key) {
  return memoryStore.delete(key);
}

function memIncr(key, ttlSeconds) {
  const existing = memGet(key);
  const next = (Number(existing) || 0) + 1;
  // Preserve existing TTL on subsequent increments; set on first
  const entry = memoryStore.get(key);
  const expiresAt = entry && entry.expiresAt
    ? entry.expiresAt
    : (ttlSeconds ? Date.now() + ttlSeconds * 1000 : null);
  memoryStore.set(key, { value: next, expiresAt });
  return next;
}

function memKeys(prefix) {
  purgeExpired();
  const out = [];
  for (const k of memoryStore.keys()) {
    if (!prefix || k.startsWith(prefix)) out.push(k);
  }
  return out;
}

// Test helper — clear the whole memory store. Not exported in production
// API but used by test code.
function _resetMemoryStore() {
  memoryStore.clear();
}

// ── Durable backend (Upstash REST) ─────────────────────
//
// Upstash supports both URL-path-style commands (POST /set/key/value)
// and POST-body-style commands ([command, ...args] JSON). We use the
// body-style for consistency with runtime-store.js.

async function runRedis(args) {
  const baseUrl = kvUrl();
  const token = kvToken();
  if (!baseUrl || !token) throw new Error('KV not configured');

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    throw new Error(`KV ${args[0]} failed: HTTP ${response.status}`);
  }
  const data = await response.json();
  if (data && data.error) throw new Error(`KV ${args[0]}: ${data.error}`);
  return data ? data.result : null;
}

async function durSet(key, value, ttlSeconds) {
  const serialised = typeof value === 'string' ? value : JSON.stringify(value);
  if (ttlSeconds) {
    await runRedis(['SET', key, serialised, 'EX', String(ttlSeconds)]);
  } else {
    await runRedis(['SET', key, serialised]);
  }
}

async function durGet(key) {
  const raw = await runRedis(['GET', key]);
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function durDel(key) {
  const result = await runRedis(['DEL', key]);
  return Number(result) > 0;
}

async function durIncr(key, ttlSeconds) {
  const result = Number(await runRedis(['INCR', key])) || 0;
  if (ttlSeconds && result === 1) {
    // Set TTL only on first increment so subsequent increments don't reset it
    await runRedis(['EXPIRE', key, String(ttlSeconds)]);
  }
  return result;
}

async function durKeys(prefix) {
  // Use SCAN to avoid blocking on KEYS (which is fine at our scale but
  // unnecessary cost). Pattern: <prefix>* — Upstash supports glob.
  const pattern = (prefix || '') + '*';
  let cursor = '0';
  const out = [];
  let safety = 0;
  do {
    const result = await runRedis(['SCAN', cursor, 'MATCH', pattern, 'COUNT', '100']);
    if (!Array.isArray(result) || result.length < 2) break;
    cursor = String(result[0]);
    const batch = Array.isArray(result[1]) ? result[1] : [];
    for (const k of batch) out.push(k);
    if (++safety > 100) break; // hard cap on iterations
  } while (cursor !== '0');
  return out;
}

// ── Public API ─────────────────────────────────────────

async function set(key, value, { ttlSeconds } = {}) {
  if (!key) throw new Error('kv.set: key required');
  if (isConfigured()) {
    await durSet(key, value, ttlSeconds);
  } else {
    memSet(key, value, ttlSeconds);
  }
  return true;
}

async function get(key) {
  if (!key) return null;
  return isConfigured() ? durGet(key) : memGet(key);
}

async function del(key) {
  if (!key) return false;
  return isConfigured() ? durDel(key) : memDel(key);
}

async function incr(key, { ttlSeconds } = {}) {
  if (!key) throw new Error('kv.incr: key required');
  return isConfigured() ? durIncr(key, ttlSeconds) : memIncr(key, ttlSeconds);
}

async function listKeys(prefix = '') {
  return isConfigured() ? durKeys(prefix) : memKeys(prefix);
}

// Convenience wrapper for simple JSON storage with TTL
async function setJson(key, value, ttlSeconds) {
  return set(key, value, { ttlSeconds });
}

async function getJson(key) {
  return get(key);
}

module.exports = {
  set, get, del, incr, listKeys,
  setJson, getJson,
  isConfigured, getMode,
  // Test helpers (not part of the stable API)
  _resetMemoryStore,
};
