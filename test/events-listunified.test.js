// Tests for events.listUnified + aggregator-on-PG-shape — Sprint BG-2.3.

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');

const events = require('../lib/events');
const kv = require('../lib/intelligence/kv-store');
const db = require('../lib/db/client');

function withEnv(overrides, fn) {
  const prev = {};
  for (const k of Object.keys(overrides)) prev[k] = process.env[k];
  for (const k of Object.keys(overrides)) {
    if (overrides[k] == null) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try { return fn(); }
  finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    db._resetClient();
  }
}

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

// ── listUnified routing ─────────────────────────────────────

test('listUnified: KV-only mode (no DATABASE_URL) → reads from KV', async () => {
  kv._resetMemoryStore();
  await events.record('founding_applied', { name: 'kv-only', email: 'kv@example.com' });

  await withEnvAsync({ DATABASE_URL: null, DATABASE_URL_UNPOOLED: null }, async () => {
    const rows = await events.listUnified({});
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'kv-only');
    // KV rows still carry raw email (this path is unchanged).
    assert.equal(rows[0].email, 'kv@example.com');
  });
});

test('listUnified: DATABASE_URL set + PG empty + KV has data → falls back to KV', async () => {
  kv._resetMemoryStore();
  await events.record('founding_applied', { name: 'fallback', email: 'f@e.c' });

  // Stub fetch so the Neon driver returns no rows.
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ rows: [], rowCount: 0 }),
    text: async () => '{"rows":[]}',
  });

  try {
    await withEnvAsync(
      { DATABASE_URL: 'postgresql://k:p@h/db?sslmode=require' },
      async () => {
        const rows = await events.listUnified({});
        // Fell back to KV because PG returned []
        assert.equal(rows.length, 1);
        assert.equal(rows[0].name, 'fallback');
      }
    );
  } finally {
    global.fetch = origFetch;
  }
});

test('listUnified: DATABASE_URL set + PG errors silently → falls back to KV', async () => {
  kv._resetMemoryStore();
  await events.record('founding_applied', { name: 'pg-down', email: 'p@e.c' });

  const origFetch = global.fetch;
  global.fetch = async () => { throw new Error('ECONNREFUSED'); };

  try {
    await withEnvAsync(
      { DATABASE_URL: 'postgresql://k:p@h/db?sslmode=require' },
      async () => {
        const rows = await events.listUnified({});
        // listFromPg swallows the error and returns []; listUnified
        // sees empty + KV-has-data → falls back to KV.
        assert.equal(rows.length, 1);
        assert.equal(rows[0].name, 'pg-down');
      }
    );
  } finally {
    global.fetch = origFetch;
  }
});

test('listUnified: passes type filter through', async () => {
  kv._resetMemoryStore();
  await events.record('founding_applied', { name: 'fa' });
  await events.record('plan_saved', { planId: 'p1' });

  await withEnvAsync({ DATABASE_URL: null, DATABASE_URL_UNPOOLED: null }, async () => {
    const rows = await events.listUnified({ type: 'plan_saved' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, 'plan_saved');
  });
});

// ── Aggregator handles PG-shape events (with emailHash, no email) ─

test('aggregate: works on PG-shape events with emailHash', () => {
  // Simulate what listFromPg would return after the BG-2.2 strip.
  // listFromPg returns rows newest-first (ORDER BY created_at DESC),
  // so the array here is in that order: newest first.
  const pgEvents = [
    {
      type: 'import_plan_generated',
      at: '2026-05-17T18:10:00Z',
      inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'DE' },
      landedTotal: 12000,
      emailProvided: false,
      locale: 'en',
    },
    {
      type: 'founding_applied',
      at: '2026-05-17T18:05:00Z',
      name: 'B',
      company: 'BCo',
      locale: 'pl',
      emailProvided: true,
      waitlist: true,
      emailHash: 'abc123def456abcd', // newest founding event
    },
    {
      type: 'founding_applied',
      at: '2026-05-17T18:00:00Z',
      name: 'A',
      company: 'ACo',
      role: 'CEO',
      locale: 'en',
      emailProvided: true,
      waitlist: false,
      emailHash: '16acf697a3ef599c', // older founding event
      // NOTE: no raw email field — stripped before pg INSERT
    },
  ];
  const r = events.aggregate(pgEvents);
  assert.equal(r.total, 3);
  assert.equal(r.foundingApplied, 2);
  assert.equal(r.foundingWaitlist, 1);
  assert.equal(r.foundingRecent.length, 2);
  // PG events carry emailHash but no raw email — aggregator surfaces both.
  // foundingRecent preserves input order (which is newest-first per the
  // list() / listFromPg() contract).
  assert.equal(r.foundingRecent[0].email, null);
  assert.equal(r.foundingRecent[0].emailHash, 'abc123def456abcd'); // newest
  assert.equal(r.foundingRecent[1].email, null);
  assert.equal(r.foundingRecent[1].emailHash, '16acf697a3ef599c'); // older
  // Other agg fields work the same regardless of source.
  assert.equal(r.emailCaptured, 2);
  assert.equal(r.meanLandedEur, 12000);
});

test('aggregate: mixed KV + PG events compose cleanly', () => {
  // First event is KV-shape (has raw email), second is PG-shape (has emailHash).
  const mixed = [
    {
      type: 'founding_applied',
      at: '2026-05-17T18:00:00Z',
      name: 'old-kv',
      email: 'old@example.com',
      emailProvided: true,
      waitlist: false,
    },
    {
      type: 'founding_applied',
      at: '2026-05-17T18:05:00Z',
      name: 'new-pg',
      emailHash: 'abc123def456abcd',
      emailProvided: true,
      waitlist: false,
    },
  ];
  const r = events.aggregate(mixed);
  assert.equal(r.foundingApplied, 2);
  // foundingRecent surfaces whichever identity exists per row.
  const pgRow = r.foundingRecent.find(x => x.name === 'new-pg');
  const kvRow = r.foundingRecent.find(x => x.name === 'old-kv');
  assert.equal(pgRow.email, null);
  assert.equal(pgRow.emailHash, 'abc123def456abcd');
  assert.equal(kvRow.email, 'old@example.com');
  assert.equal(kvRow.emailHash, null);
});

// ── Handlers call listUnified (not list()) ──────────────────

test('lib/handlers/audit.js reads via events.listUnified, not events.list', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const text = fs.readFileSync(path.join(__dirname, '..', 'lib', 'handlers', 'audit.js'), 'utf8');
  assert.match(text, /events\.listUnified\(/, 'audit handler must call listUnified');
});

test('lib/handlers/leads.js reads via events.listUnified, not events.list', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const text = fs.readFileSync(path.join(__dirname, '..', 'lib', 'handlers', 'leads.js'), 'utf8');
  assert.match(text, /events\.listUnified\(/, 'leads handler must call listUnified');
});

// ── Export surface stable ──────────────────────────────────

test('module exports listUnified alongside list + listFromPg', () => {
  assert.equal(typeof events.listUnified, 'function');
  assert.equal(typeof events.list, 'function');
  assert.equal(typeof events.listFromPg, 'function');
});
