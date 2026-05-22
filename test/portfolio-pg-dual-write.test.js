// Tests for the Postgres dual-write in lib/saved-portfolios.js
// — Sprint portfolio-pg-dual-write-v1.
//
// Mirrors test/saved-plans-pg-dual-write.test.js (BG-2.4). KV stays the
// authoritative synchronous primary; PG is the durable corpus surviving
// KV's 1-year TTL. Strategy:
//   1. buildPgInsertParams: pure-function tests over the SQL param tuple.
//   2. recordPg / softDeletePg defensive paths (not-configured + DB error).
//   3. savePortfolio integration: KV-only preserved + fire-and-forget proven.
//   4. listFromPg defensive empty paths + module surface.

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');

const portfolios = require('../lib/saved-portfolios');
const kv = require('../lib/intelligence/kv-store');
const db = require('../lib/db/client');
const hash = require('../lib/hash');

async function withEnvAsync(overrides, fn) {
  const prev = {};
  for (const k of Object.keys(overrides)) prev[k] = process.env[k];
  for (const k of Object.keys(overrides)) {
    if (overrides[k] == null) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try { return await fn(); }
  finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    db._resetClient();
  }
}

function baseRecord(overrides = {}) {
  return {
    id: 'pf_abc123def456',
    email: 'alice@example.com',
    label: '3 SKUs · 2 lanes',
    lines: [
      { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000 },
      { productCategory: 'electronics', originCountry: 'VN', destinationCountry: 'DE', customsValueEur: 40000 },
    ],
    snapshot: { lineCount: 2, blendedDutyRatePct: 6.4, totals: { perShipmentLandedTotal: 80000 } },
    savedAt: '2026-05-22T10:00:00.000Z',
    ...overrides,
  };
}

// ── buildPgInsertParams (pure) ─────────────────────────────

test('buildPgInsertParams: hashes the email; raw email never reaches PG', () => {
  const r = portfolios.buildPgInsertParams(baseRecord());
  assert.equal(r.externalId, 'pf_abc123def456');
  assert.match(r.emailHash, /^[a-f0-9]{16}$/);
  assert.equal(r.emailHash, hash.emailHash('alice@example.com'));
  assert.equal(r.label, '3 SKUs · 2 lanes');
  assert.equal(r.linesJson.indexOf('alice'), -1);
  assert.equal(r.snapshotJson.indexOf('alice'), -1);
});

test('buildPgInsertParams: serialises lines + snapshot as jsonb-ready strings', () => {
  const r = portfolios.buildPgInsertParams(baseRecord());
  const lines = JSON.parse(r.linesJson);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].productCategory, 'apparel');
  assert.equal(JSON.parse(r.snapshotJson).totals.perShipmentLandedTotal, 80000);
});

test('buildPgInsertParams: null snapshot → snapshotJson null; missing lines → []', () => {
  const r = portfolios.buildPgInsertParams(baseRecord({ snapshot: null, lines: undefined }));
  assert.equal(r.snapshotJson, null);
  assert.equal(r.linesJson, '[]');
});

test('buildPgInsertParams: clamps label at 100 chars + falsy label → null', () => {
  const r1 = portfolios.buildPgInsertParams(baseRecord({ label: 'x'.repeat(250) }));
  assert.equal(r1.label.length, 100);
  assert.equal(portfolios.buildPgInsertParams(baseRecord({ label: '' })).label, null);
  assert.equal(portfolios.buildPgInsertParams(baseRecord({ label: undefined })).label, null);
});

test('buildPgInsertParams: pseudonymised email (post-Article-17) passes through verbatim', () => {
  const pseudonym = 'deleted-1234567890ab@anonymised.local';
  const r = portfolios.buildPgInsertParams(baseRecord({ email: pseudonym }));
  assert.equal(r.emailHash, pseudonym);
});

test('buildPgInsertParams: defensive — strips any email field that snuck into a line/snapshot', () => {
  const r = portfolios.buildPgInsertParams(baseRecord({
    lines: [{ productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', email: 'leaked@evil.com' }],
    snapshot: { lineCount: 1, email: 'also-leaked@evil.com' },
  }));
  assert.equal(r.linesJson.indexOf('leaked'), -1);
  assert.equal(r.snapshotJson.indexOf('leaked'), -1);
  assert.equal(JSON.parse(r.linesJson)[0].email, undefined);
});

test('buildPgInsertParams: throws when id/email missing', () => {
  assert.throws(() => portfolios.buildPgInsertParams({}), /id.*email/);
  assert.throws(() => portfolios.buildPgInsertParams(baseRecord({ id: undefined })), /id.*email/);
  assert.throws(() => portfolios.buildPgInsertParams(baseRecord({ email: '' })), /id.*email/);
});

// ── recordPg / softDeletePg defensive paths ────────────────

test('recordPg: {written:false, reason:not-configured} when DATABASE_URL unset', async () => {
  await withEnvAsync({ DATABASE_URL: null, DATABASE_URL_UNPOOLED: null }, async () => {
    const r = await portfolios.recordPg(baseRecord());
    assert.equal(r.written, false);
    assert.equal(r.reason, 'not-configured');
  });
});

test('recordPg: {written:false} on DB error (no throw)', async () => {
  await withEnvAsync({ DATABASE_URL: 'postgresql://k:p@h/db?sslmode=require' }, async () => {
    const origFetch = global.fetch;
    global.fetch = async () => { throw new Error('ECONNREFUSED'); };
    try {
      const r = await portfolios.recordPg(baseRecord());
      assert.equal(r.written, false);
      assert.ok(r.err);
    } finally { global.fetch = origFetch; }
  });
});

test('recordPg: malformed record fails before any network round-trip', async () => {
  await withEnvAsync({ DATABASE_URL: 'postgresql://k:p@h/db?sslmode=require' }, async () => {
    let fetchCalled = false;
    const origFetch = global.fetch;
    global.fetch = async () => { fetchCalled = true; return { ok: true }; };
    try {
      const r = await portfolios.recordPg({});
      assert.equal(r.written, false);
      assert.ok(r.err);
      assert.equal(fetchCalled, false);
    } finally { global.fetch = origFetch; }
  });
});

test('softDeletePg: not-configured + bad id return structured failures (no throw)', async () => {
  await withEnvAsync({ DATABASE_URL: null }, async () => {
    const r = await portfolios.softDeletePg('pf_xxx');
    assert.equal(r.written, false);
    assert.equal(r.reason, 'not-configured');
  });
  await withEnvAsync({ DATABASE_URL: 'postgresql://k:p@h/db?sslmode=require' }, async () => {
    assert.equal((await portfolios.softDeletePg('')).written, false);
    assert.equal((await portfolios.softDeletePg(null)).written, false);
  });
});

test('listFromPg: returns [] when unset and on DB error', async () => {
  await withEnvAsync({ DATABASE_URL: null, DATABASE_URL_UNPOOLED: null }, async () => {
    assert.deepEqual(await portfolios.listFromPg(), []);
  });
  await withEnvAsync({ DATABASE_URL: 'postgresql://k:p@h/db?sslmode=require' }, async () => {
    const origFetch = global.fetch;
    global.fetch = async () => { throw new Error('ECONNREFUSED'); };
    try { assert.deepEqual(await portfolios.listFromPg(), []); }
    finally { global.fetch = origFetch; }
  });
});

// ── savePortfolio integration ──────────────────────────────

test('savePortfolio: KV-only mode (no DATABASE_URL) returns intact record + writes to KV', async () => {
  kv._resetMemoryStore();
  await withEnvAsync({ DATABASE_URL: null, DATABASE_URL_UNPOOLED: null }, async () => {
    const r = await portfolios.savePortfolio({
      email: 'alice@example.com',
      lines: [{ productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000 }],
      label: 'kv-only',
    });
    assert.ok(r.id);
    assert.equal(r.label, 'kv-only');
    const refetched = await portfolios.getPortfolio(r.id, 'alice@example.com');
    assert.ok(refetched);
    assert.equal(refetched.id, r.id);
  });
});

test('savePortfolio: fire-and-forget PG write does NOT block the function', async () => {
  kv._resetMemoryStore();
  const origFetch = global.fetch;
  let resolveFetch;
  const pending = new Promise((r) => { resolveFetch = r; });
  global.fetch = () => pending;
  try {
    await withEnvAsync({ DATABASE_URL: 'postgresql://k:p@h/db?sslmode=require' }, async () => {
      const winner = await Promise.race([
        portfolios.savePortfolio({
          email: 'busy@example.com',
          lines: [{ productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000 }],
        }).then((r) => ({ kind: 'save', r })),
        new Promise((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), 500)),
      ]);
      assert.equal(winner.kind, 'save', 'savePortfolio must resolve while the PG fetch is still pending');
      assert.ok(winner.r.id);
    });
  } finally {
    resolveFetch({ ok: false, status: 500, text: async () => 'cleanup' });
    await new Promise((r) => setImmediate(r));
    global.fetch = origFetch;
  }
});

test('savePortfolio: PG write failure does NOT corrupt the KV write or return value', async () => {
  kv._resetMemoryStore();
  const origFetch = global.fetch;
  global.fetch = async () => { throw new Error('PG dead'); };
  try {
    await withEnvAsync({ DATABASE_URL: 'postgresql://k:p@h/db?sslmode=require' }, async () => {
      const r = await portfolios.savePortfolio({
        email: 'pg-down@example.com',
        lines: [{ productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000 }],
      });
      assert.ok(r.id);
      const list = await portfolios.listPortfolios('pg-down@example.com');
      assert.equal(list.length, 1);
      assert.equal(list[0].id, r.id);
    });
  } finally { global.fetch = origFetch; }
});

test('module exports the dual-write surface', () => {
  for (const name of ['buildPgInsertParams', 'recordPg', 'softDeletePg', 'listFromPg']) {
    assert.equal(typeof portfolios[name], 'function', `${name} exported`);
  }
});

// ── Schema parity ──────────────────────────────────────────

test('schema.sql declares the saved_portfolios table with the expected columns', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db', 'schema.sql'), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS saved_portfolios/);
  for (const col of ['external_id', 'email_hash', 'lines_json', 'snapshot_json', 'archived_at']) {
    assert.ok(schema.includes(col), `saved_portfolios should declare ${col}`);
  }
});
