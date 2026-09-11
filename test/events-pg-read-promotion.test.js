'use strict';

// Sprint 79 — events read promotion (Track A of the billion-dollar
// program: the unbounded audit spine).
//
// Two inert seams closed:
//   1. The events.org_id COLUMN existed since the base schema —
//      with an index on it — but the dual-write writer never
//      populated it. Fixed at the writer + backfilled in
//      schema-021 (FK-guarded).
//   2. The three SCOPED readers under the operator wedge
//      (listForEntity timelines, listForOrg activity,
//      listOperatorConfigHistory) were KV-bound 5000-row scans —
//      every org's audit horizon capped at the KV eviction line.
//      A licensed counterparty cannot lose audit history: each
//      reader is now PG-first over indexed cuts, KV-fallback.
//
// Fallback discipline (pinned): PG-unavailable/throw → null →
// KV; PG empty-but-KV-nonempty → KV (dual-write only covers
// post-BG-2.2 events); PG rows → PG. Reads stay fail-OPEN.
// The tamper-evident chain readers are deliberately NOT promoted
// (the _seq/_prevHash/_hash chain is a KV-log property).
//
// Test layers:
//   1. Writer: orgId → org_id column (integer-gated, payload
//      parity kept), INSERT shape
//   2. flattenPgEventRow runtime semantics
//   3. PG helpers return null when unconfigured; scoped readers
//      fall back to KV end-to-end (runtime, in-memory KV)
//   4. Source pins: PG-first positional order in all three
//      readers; SQL shapes (entity tuple ASC, org DESC,
//      allowlist in SQL); KV fallback calls preserved verbatim
//   5. Migration: FK-guarded backfill + entity index in BOTH
//      schema-021 and the base schema (two-corners)
//   6. Chain integrity stays KV (absence pin)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');
const EVENTS_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'events.js'), 'utf8');
const MIGRATION_SQL = fs.readFileSync(
  path.join(ROOT, 'lib', 'db', 'schema-021-events-read-promotion.sql'),
  'utf8',
);
const BASE_SCHEMA = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'schema.sql'), 'utf8');

// ── Layer 1: writer ──────────────────────────────────────────────

test('buildPgInsertParams extracts integer orgId to the column AND keeps it in payload (KV parity)', () => {
  const r = events.buildPgInsertParams('import_request_created', {
    orgId: 42, entityType: 'import_request', entityId: 'ir_x',
  });
  assert.equal(r.orgId, 42);
  const parsed = JSON.parse(r.payloadJson);
  assert.equal(parsed.orgId, 42, 'orgId must STAY in payload — readers spread it');
});

test('buildPgInsertParams gates org_id to plain integers (garbage lands NULL, never a failed insert)', () => {
  for (const bad of ['42', 4.2, null, undefined, { id: 1 }, NaN]) {
    const r = events.buildPgInsertParams('t', { orgId: bad });
    assert.equal(r.orgId, null, `orgId ${String(bad)} must land NULL`);
  }
});

test('recordPg INSERT populates the org_id column (source pin)', () => {
  assert.match(
    EVENTS_SRC,
    /INSERT INTO events \(type, org_id, email_hash, payload\) VALUES \(\$1, \$2, \$3, \$4::jsonb\)/,
  );
});

// ── Layer 2: flatten semantics ───────────────────────────────────

test('flattenPgEventRow: Date→ISO, payload spread, email_hash→emailHash, payload `at` wins', () => {
  const flat = events.flattenPgEventRow({
    type: 'import_request_created',
    email_hash: 'abc123def456ghi7',
    payload: { orgId: 7, entityId: 'ir_x', detail: { a: 1 } },
    created_at: new Date('2026-07-08T10:00:00Z'),
  });
  assert.equal(flat.type, 'import_request_created');
  assert.equal(flat.at, '2026-07-08T10:00:00.000Z');
  assert.equal(flat.orgId, 7);
  assert.deepEqual(flat.detail, { a: 1 });
  assert.equal(flat.emailHash, 'abc123def456ghi7');
  // A payload-carried `at` (the original event stamp) overrides
  // the insert timestamp.
  const stamped = events.flattenPgEventRow({
    type: 't',
    payload: { at: '2026-01-01T00:00:00.000Z' },
    created_at: new Date('2026-07-08T10:00:00Z'),
  });
  assert.equal(stamped.at, '2026-01-01T00:00:00.000Z');
  // String payload (driver variance) parses.
  const str = events.flattenPgEventRow({
    type: 't', payload: '{"x":1}', created_at: '2026-07-08T10:00:00Z',
  });
  assert.equal(str.x, 1);
});

// ── Layer 3: fallback runtime (PG unconfigured in unit tests) ────

test('PG helpers return null (not []) when the DB is not configured — callers can tell "no PG" from "empty"', async () => {
  assert.equal(await events.listForEntityFromPg({ entityType: 'x', entityId: 'y', limit: 5 }), null);
  assert.equal(await events.listForOrgFromPg({ orgId: 1, types: ['a'], limit: 5 }), null);
});

test('listForEntity falls back to KV end-to-end when PG is unavailable (runtime)', async () => {
  const orgId = 999_997_901;
  await events.record('import_request_created', {
    orgId, entityType: 'import_request', entityId: 'ir_pgread_1',
  });
  await events.record('import_request_archived', {
    orgId, entityType: 'import_request', entityId: 'ir_pgread_1',
  });
  const timeline = await events.listForEntity({
    entityType: 'import_request', entityId: 'ir_pgread_1',
  });
  assert.equal(timeline.length, 2);
  // Oldest-first (timeline contract survives the promotion).
  assert.equal(timeline[0].type, 'import_request_created');
  assert.equal(timeline[1].type, 'import_request_archived');
});

test('listOperatorConfigHistory falls back to KV and projects identically (runtime)', async () => {
  const orgId = 999_997_902;
  await events.record('operator_config_updated', {
    orgId,
    entityType: 'operator_config',
    entityId: 'sprint79-smoke',
    actorEmailHash: 'abc123def456ghi7',
    detail: { patched: { stallThresholdDays: 3 }, previous: { stallThresholdDays: null } },
  });
  const history = await events.listOperatorConfigHistory({ orgId, limit: 5 });
  assert.equal(history.length, 1);
  assert.deepEqual(history[0].patched, { stallThresholdDays: 3 });
  assert.deepEqual(history[0].previous, { stallThresholdDays: null });
});

// ── Layer 4: source pins ─────────────────────────────────────────

test('all three scoped readers are PG-FIRST — the PG attempt precedes the KV scan (positional pins)', () => {
  for (const [fn, pgCall] of [
    ['listForEntity', 'listForEntityFromPg'],
    ['listForOrg', 'listForOrgFromPg'],
    ['listOperatorConfigHistory', 'listForOrgFromPg'],
  ]) {
    const block = EVENTS_SRC.match(new RegExp(`async function ${fn}\\(\\{[\\s\\S]*?\\n\\}`));
    assert.ok(block, `${fn} not found`);
    const pgIdx = block[0].indexOf(pgCall);
    const kvIdx = block[0].indexOf('await list({');
    assert.ok(pgIdx > -1, `${fn} must attempt ${pgCall}`);
    assert.ok(kvIdx > -1, `${fn} must keep the KV fallback`);
    assert.ok(pgIdx < kvIdx, `${fn}: PG attempt must precede the KV scan`);
    // Empty-PG falls through: rows are only used when non-empty.
    assert.match(block[0], /pgRows && pgRows\.length > 0/);
  }
});

test('SQL shapes: entity tuple ASC (timeline), org cut DESC (stream), allowlist applied IN SQL', () => {
  const entityBlock = EVENTS_SRC.match(/async function listForEntityFromPg\([\s\S]*?\n\}/)[0];
  assert.match(entityBlock, /WHERE payload->>'entityType' = \$1\s*\n\s*AND payload->>'entityId' = \$2/);
  assert.match(entityBlock, /ORDER BY created_at ASC/);
  const orgBlock = EVENTS_SRC.match(/async function listForOrgFromPg\([\s\S]*?\n\}/)[0];
  assert.match(orgBlock, /WHERE org_id = \$1\s*\n\s*AND type = ANY\(\$2::text\[\]\)/);
  assert.match(orgBlock, /ORDER BY created_at DESC/);
});

test('KV fallback calls preserved verbatim (sprint-65 pin compatibility)', () => {
  // The config-history fallback keeps the exact typed KV cut the
  // sprint-65 drift-guard pins.
  assert.match(EVENTS_SRC, /await list\(\{ type: 'operator_config_updated', limit: MAX_EVENTS \}\)/);
});

test('listForOrg passes the FULL activity allowlist to SQL; config history passes the single type', () => {
  assert.match(EVENTS_SRC, /types: Array\.from\(ORG_ACTIVITY_TYPES\),/);
  assert.match(EVENTS_SRC, /types: \['operator_config_updated'\],/);
});

// ── Layer 5: migration ───────────────────────────────────────────

test('schema-021 backfills org_id with integer + FK-existence guards (never a violated FK)', () => {
  assert.match(MIGRATION_SQL, /SET org_id = \(e\.payload->>'orgId'\)::bigint/);
  assert.match(MIGRATION_SQL, /WHERE e\.org_id IS NULL/);
  assert.match(MIGRATION_SQL, /e\.payload->>'orgId' ~ '\^\[0-9\]\+\$'/);
  assert.match(MIGRATION_SQL, /AND EXISTS \(\s*\n\s*SELECT 1 FROM organisations o/);
});

test('entity index lands in BOTH schema-021 (existing DBs) and schema.sql (fresh installs) — partial', () => {
  for (const [name, src] of [['schema-021', MIGRATION_SQL], ['schema.sql', BASE_SCHEMA]]) {
    assert.match(
      src,
      /CREATE INDEX IF NOT EXISTS events_entity_created_idx\s*\n\s*ON events \(\(payload->>'entityType'\), \(payload->>'entityId'\), created_at\)\s*\n\s*WHERE payload->>'entityType' IS NOT NULL;/,
      `${name} must carry the partial entity index`,
    );
  }
});

// ── Layer 6: chain integrity stays KV ────────────────────────────

test('tamper-evident chain verification is NOT promoted to PG (the chain is a KV-log property)', () => {
  const block = EVENTS_SRC.match(/function verifyStoredChain\([\s\S]*?\n\}/);
  assert.ok(block, 'verifyStoredChain not found');
  assert.ok(!/FromPg|db\/client/.test(block[0]), 'chain verification must keep reading the KV log');
});
