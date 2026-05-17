// Neon Postgres client — Sprint BG-2.1.
//
// Architectural decision (committed 2026-05-17):
// We add @neondatabase/serverless as OrcaTrade's second runtime dependency
// (alongside @anthropic-ai/sdk). The dev-plan rule "pure-JS, zero npm,
// stay deployable on Vercel Hobby" was about the function-count limit
// + no-build-pipeline + no-React — not literal zero deps. The Neon
// serverless driver is ~50kB, pre-compiled, no native code, designed
// for Vercel functions over WebSockets/HTTP. The alternative — raw
// fetch against an undocumented HTTP SQL endpoint — would couple us to
// a non-public contract and force us to reimplement TLS + retry logic
// the driver already gets right.
//
// What lives here
// ───────────────
//   query(sql, params)        → returns rows[]
//   queryOne(sql, params)     → returns first row or null
//   transaction(async (tx) => …) → wraps multi-statement work in a tx
//   isConfigured()            → true iff DATABASE_URL env is set
//   probe()                   → returns { ok, latencyMs, err? } for /api/health
//
// Usage:
//   const db = require('../db/client');
//   const orgs = await db.query('SELECT id, name FROM organisations WHERE owner_email = $1', [email]);
//
// Two URLs are honoured:
//   DATABASE_URL           → pooled. Used for every request-path query.
//                            Connection pooling handles the serverless
//                            fan-in (every cold start opens its own
//                            connection; the pooler multiplexes).
//   DATABASE_URL_UNPOOLED  → direct. Used by scripts/db-migrate.js for
//                            schema changes that need transactional DDL.
//                            NEVER called from request handlers.
//
// In test / dev with neither set, isConfigured() returns false and
// every other function throws or returns a documented fallback. The
// existing test suite is unaffected — no live DB needed.

'use strict';

const log = require('../log').withContext({ module: 'db' });

function poolUrl() {
  return process.env.DATABASE_URL || '';
}
function directUrl() {
  return process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '';
}

function isConfigured() {
  return !!poolUrl();
}

// Lazy-require the Neon driver so this module loads cleanly in
// environments without the package (older test envs, future migrations
// before npm install). The driver itself is fetch-based — no
// long-lived sockets, no cleanup needed on cold-start exit.
let _sql = null;
function sqlClient() {
  if (_sql) return _sql;
  if (!isConfigured()) {
    throw new Error('db.client: DATABASE_URL not set');
  }
  const { neon } = require('@neondatabase/serverless');
  _sql = neon(poolUrl());
  return _sql;
}

// Reset cached client — used in tests so a fresh DATABASE_URL is
// picked up between test cases. Not part of the public API.
function _resetClient() {
  _sql = null;
}

// Run a parameterised query. The Neon HTTP driver uses positional
// parameters ($1, $2, …) the same as native postgres. Returns an
// array of rows.
async function query(sql, params = []) {
  const start = Date.now();
  try {
    const client = sqlClient();
    // @neondatabase/serverless: the client function itself accepts
    // (text, params) — there is no `.query()` method. Returns rows array
    // directly (not a { rows } wrapper).
    const result = await client(sql, params);
    const rows = Array.isArray(result) ? result : (result && result.rows) || [];
    const latencyMs = Date.now() - start;
    if (latencyMs > 1000) {
      log.warn('slow query', { latencyMs, sqlPrefix: sql.slice(0, 80) });
    }
    return rows;
  } catch (err) {
    log.error('query failed', { err: err.message, sqlPrefix: sql.slice(0, 120), params: params.length });
    throw err;
  }
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Light transaction wrapper. The Neon HTTP driver supports multi-
// statement transactions via the .transaction() method. For callers
// that don't need a transaction we just give them the regular client.
//
// Usage:
//   await db.transaction(async (tx) => {
//     await tx('INSERT INTO orgs (...) VALUES ($1, $2)', [id, name]);
//     await tx('INSERT INTO memberships (...) VALUES ($1, $2)', [id, email]);
//   });
async function transaction(fn) {
  const client = sqlClient();
  // Neon's serverless driver exposes .transaction() that returns the
  // results of an array of queries atomically. For an imperative fn(tx)
  // shape we synthesise a `tx(sql, params)` that buffers calls + flushes
  // them at the end. This is simplistic but matches our actual usage
  // (handful of inserts in a single user-initiated mutation).
  const buffered = [];
  const tx = (sql, params = []) => {
    buffered.push(client(sql, params));
    return Promise.resolve();
  };
  await fn(tx);
  if (buffered.length === 0) return [];
  return await client.transaction(buffered);
}

// Health probe — surfaces { ok, latencyMs, mode } for /api/health.
// Never throws; returns a structured error instead so the health
// endpoint stays responsive even when Postgres is down.
async function probe() {
  if (!isConfigured()) {
    return { ok: false, status: 'not-configured', err: 'DATABASE_URL not set' };
  }
  const start = Date.now();
  try {
    const rows = await query('SELECT 1 AS ok');
    const latencyMs = Date.now() - start;
    return {
      ok: rows.length === 1 && rows[0].ok === 1,
      latencyMs,
      mode: 'pooled',
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      err: err.message,
    };
  }
}

module.exports = {
  isConfigured,
  query,
  queryOne,
  transaction,
  probe,
  poolUrl,
  directUrl,
  _resetClient,
};
