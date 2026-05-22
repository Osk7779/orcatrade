'use strict';

// Postgres-backed store for consolidated sanctions-list entries (Sprint
// sanctions-lists-v1). Read by the screening engine via getActiveList(),
// written by the `sanctions-refresh` cron.
//
// Degrades safely: with no DATABASE_URL (tests, local dev) isAvailable() is
// false and loadActiveList() returns null, so the engine falls back to the
// bundled illustrative sample. A read error never throws to the caller —
// screening must keep working even if Postgres is down.

const db = require('../db/client');
const log = require('../log').withContext({ module: 'sanctions-store' });

const MAX_LOAD = 50000;     // safety cap on rows pulled into memory per screen
const INSERT_BATCH = 500;   // rows per multi-row INSERT during a refresh

function isAvailable() {
  return db.isConfigured();
}

// Map a DB row to the engine's entry shape.
function toEntry(row) {
  let aliases = [];
  if (Array.isArray(row.aliases)) aliases = row.aliases;
  else if (typeof row.aliases === 'string') {
    try { const p = JSON.parse(row.aliases); if (Array.isArray(p)) aliases = p; } catch (_) { /* ignore */ }
  }
  return {
    id: (row.source || 'LIST') + ':' + (row.external_id || row.id),
    type: row.entry_type || null,
    name: row.name,
    aliases,
    programme: row.programme || null,
    listSource: row.source || null,
  };
}

// Return the active consolidated list as { source, authoritative:true,
// entries:[...] }, or null when no real data is available (→ caller falls
// back to the sample). Never throws.
async function loadActiveList() {
  if (!isAvailable()) return null;
  try {
    const rows = await db.query(
      'SELECT source, external_id, entry_type, name, aliases, programme FROM sanctions_entries LIMIT $1',
      [MAX_LOAD],
    );
    if (!rows || !rows.length) return null;
    return {
      source: 'CONSOLIDATED',
      authoritative: true,
      entries: rows.map(toEntry),
      count: rows.length,
    };
  } catch (err) {
    log.error('loadActiveList failed; falling back to sample', { err: err.message });
    return null;
  }
}

// Replace all entries for one source with a fresh set (used by the refresh
// cron). Batched inserts keep us within the serverless time budget. Returns
// { ok, count }.
async function replaceEntries(source, entries) {
  if (!isAvailable()) return { ok: false, reason: 'DATABASE_URL not set', count: 0 };
  const list = Array.isArray(entries) ? entries : [];
  await db.query('DELETE FROM sanctions_entries WHERE source = $1', [source]);

  let inserted = 0;
  for (let i = 0; i < list.length; i += INSERT_BATCH) {
    const batch = list.slice(i, i + INSERT_BATCH);
    const values = [];
    const params = [];
    batch.forEach((e, j) => {
      const base = j * 6;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
      params.push(
        source,
        e.externalId || null,
        e.type || null,
        String(e.name || '').slice(0, 512),
        JSON.stringify(Array.isArray(e.aliases) ? e.aliases : []),
        e.programme || null,
      );
    });
    if (!values.length) continue;
    await db.query(
      `INSERT INTO sanctions_entries (source, external_id, entry_type, name, aliases, programme) VALUES ${values.join(', ')}`,
      params,
    );
    inserted += batch.length;
  }

  await db.query(
    'INSERT INTO sanctions_refresh (source, entry_count, refreshed_at) VALUES ($1, $2, now()) ' +
    'ON CONFLICT (source) DO UPDATE SET entry_count = EXCLUDED.entry_count, refreshed_at = now()',
    [source, inserted],
  );
  return { ok: true, count: inserted };
}

async function totalCount() {
  if (!isAvailable()) return 0;
  try {
    const rows = await db.query('SELECT count(*)::int AS n FROM sanctions_entries');
    return (rows && rows[0] && rows[0].n) || 0;
  } catch (_) {
    return 0;
  }
}

module.exports = {
  isAvailable,
  loadActiveList,
  replaceEntries,
  totalCount,
  toEntry,
  MAX_LOAD,
  INSERT_BATCH,
};
