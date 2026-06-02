// Content-addressed data-snapshot store — reproducibility-v2, slice 2
// (apex plan III3). The durable home for the volatile-data snapshots captured
// by lib/intelligence/data-snapshot.js, so a saved plan's numbers can be
// reproduced / drift-checked against the exact market data behind them.
//
// Snapshots are IMMUTABLE and GLOBAL — they hold market data (FX rates, ETS
// price, AD/CVD measure rates), never user data, so there is no per-user index
// and no GDPR delete path. The id IS a sha256 content address, so two writes of
// the same data are the same row; put is idempotent by construction.
//
// Storage layout:
//   datasnap:<id>  → { id, schemaVersion, capturedAt, snapshot }
//
// KV is the synchronous primary (mirrors saved-plans / alert-store); Postgres
// is the best-effort dual-write that outlives KV's TTL — "reproducible forever"
// lives in PG. getSnapshot reads KV first, falls back to PG and rehydrates KV.

'use strict';

const kv = require('./intelligence/kv-store');
const dataSnapshot = require('./intelligence/data-snapshot');

const SNAP_KEY_PREFIX = 'datasnap:';
// Long TTL — snapshots must outlive the plans that reference them. PG is the
// forever-home; KV is a (long) cache that gets rehydrated on miss.
const SNAP_TTL_DAYS = 730;

function snapKey(id) {
  return SNAP_KEY_PREFIX + id;
}

function ttlSeconds() {
  return SNAP_TTL_DAYS * 24 * 60 * 60;
}

function isValidId(id) {
  return typeof id === 'string'
    && id.startsWith(dataSnapshot.ID_PREFIX)
    && new RegExp(`^${dataSnapshot.ID_PREFIX}[0-9a-f]{${dataSnapshot.ID_HEX_LENGTH}}$`).test(id);
}

function toRecord(snapshotRecord) {
  return {
    id: snapshotRecord.id,
    schemaVersion: snapshotRecord.snapshot && snapshotRecord.snapshot.schemaVersion != null
      ? snapshotRecord.snapshot.schemaVersion
      : dataSnapshot.SNAPSHOT_SCHEMA_VERSION,
    capturedAt: snapshotRecord.capturedAt || new Date().toISOString(),
    snapshot: snapshotRecord.snapshot,
  };
}

// Idempotent put. Accepts a record shaped like dataSnapshot.currentDataSnapshot()
// ({ id, capturedAt, snapshot }). Returns { id, stored } — stored:false when the
// content address was already present (no-op write avoided). KV write is awaited
// (fast primary); PG mirror is fire-and-forget and never throws.
async function putSnapshot(snapshotRecord) {
  if (!snapshotRecord || !isValidId(snapshotRecord.id) || !snapshotRecord.snapshot) {
    throw new Error('putSnapshot: a valid { id, snapshot } record is required');
  }
  const id = snapshotRecord.id;
  const existing = await kv.get(snapKey(id));
  if (existing) {
    // Already content-addressed in KV — nothing to do (immutable).
    return { id, stored: false };
  }
  const record = toRecord(snapshotRecord);
  await kv.set(snapKey(id), record, { ttlSeconds: ttlSeconds() });
  recordPg(record).catch(() => { /* never propagate */ });
  return { id, stored: true };
}

// Read a snapshot by content address. KV first; on miss, PG; rehydrate KV.
async function getSnapshot(id) {
  if (!isValidId(id)) return null;
  const fromKv = await kv.get(snapKey(id));
  if (fromKv) return fromKv;
  const fromPg = await readPg(id);
  if (fromPg) {
    await kv.set(snapKey(id), fromPg, { ttlSeconds: ttlSeconds() }).catch(() => {});
    return fromPg;
  }
  return null;
}

// Capture the current volatile data + persist it. Returns the stored record
// ({ id, capturedAt, snapshot }) so callers can stamp the id onto their entity.
// opts forwarded to dataSnapshot.currentDataSnapshot — e.g. { pinnedTaric }
// per apex P1.1.
async function captureAndStore(opts = {}) {
  const current = dataSnapshot.currentDataSnapshot(opts);
  await putSnapshot(current);
  return current;
}

// ── Postgres dual-write (best-effort, immutable) ────────

async function recordPg(record) {
  let db;
  try { db = require('./db/client'); } catch (_) { return; }
  if (!db.isConfigured()) return;
  try {
    await db.query(
      `INSERT INTO data_snapshots (snapshot_id, schema_version, captured_at, snapshot_json)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (snapshot_id) DO NOTHING`,
      [record.id, record.schemaVersion, record.capturedAt, JSON.stringify(record.snapshot)],
    );
  } catch (_) { /* never propagate */ }
}

async function readPg(id) {
  let db;
  try { db = require('./db/client'); } catch (_) { return null; }
  if (!db.isConfigured()) return null;
  try {
    const rows = await db.query(
      'SELECT snapshot_id, schema_version, captured_at, snapshot_json FROM data_snapshots WHERE snapshot_id = $1 LIMIT 1',
      [id],
    );
    const r = rows && rows[0];
    if (!r) return null;
    return {
      id: r.snapshot_id,
      schemaVersion: r.schema_version,
      capturedAt: r.captured_at instanceof Date ? r.captured_at.toISOString() : r.captured_at,
      snapshot: r.snapshot_json || null,
    };
  } catch (_) {
    return null;
  }
}

module.exports = {
  SNAP_KEY_PREFIX,
  SNAP_TTL_DAYS,
  snapKey,
  isValidId,
  putSnapshot,
  getSnapshot,
  captureAndStore,
};
