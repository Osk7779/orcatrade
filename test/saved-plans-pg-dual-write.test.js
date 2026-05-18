// Tests for the Postgres dual-write in lib/saved-plans.js — Sprint BG-2.4.
//
// Mirrors test/events-pg-dual-write.test.js (BG-2.2). KV stays the
// authoritative primary; PG is the durable corpus that unblocks the
// future actuals FK + cross-user calibration analytics.
//
// Strategy:
//   1. buildPgInsertParams: pure-function tests over the SQL params tuple.
//   2. recordPg: not-configured path + configured-but-failing path,
//      both must return structured failures, never throw.
//   3. savePlan: KV-only mode (no DATABASE_URL) preserves existing
//      behaviour; PG dual-write is fire-and-forget (no blocking).
//   4. softDeletePg + listFromPg: same defensive shape.

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');

const savedPlans = require('../lib/saved-plans');
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
    id: 'pl_abc123def456',
    email: 'alice@example.com',
    inputs: {
      productCategory: 'apparel',
      originCountry: 'CN',
      destinationCountry: 'PL',
      customsValueEur: 25000,
    },
    label: 'CN→PL test',
    savedAt: '2026-05-18T10:00:00.000Z',
    snapshot: { perShipmentLandedTotal: 30000, schemaVersion: 1 },
    ...overrides,
  };
}

// ── buildPgInsertParams (pure) ─────────────────────────────

test('buildPgInsertParams: hashes the email; raw email never reaches PG', () => {
  const r = savedPlans.buildPgInsertParams(baseRecord());
  assert.equal(r.externalId, 'pl_abc123def456');
  assert.match(r.emailHash, /^[a-f0-9]{16}$/);
  assert.equal(r.emailHash, hash.emailHash('alice@example.com'));
  assert.equal(r.label, 'CN→PL test');
  // jsonb columns are stringified — never contain the email.
  assert.equal(r.inputsJson.indexOf('alice'), -1);
  assert.equal(r.snapshotJson.indexOf('alice'), -1);
});

test('buildPgInsertParams: serialises inputs + snapshot as jsonb-ready strings', () => {
  const r = savedPlans.buildPgInsertParams(baseRecord());
  const parsedInputs = JSON.parse(r.inputsJson);
  assert.equal(parsedInputs.productCategory, 'apparel');
  assert.equal(parsedInputs.customsValueEur, 25000);
  const parsedSnap = JSON.parse(r.snapshotJson);
  assert.equal(parsedSnap.perShipmentLandedTotal, 30000);
});

test('buildPgInsertParams: null snapshot → snapshotJson null', () => {
  const r = savedPlans.buildPgInsertParams(baseRecord({ snapshot: null }));
  assert.equal(r.snapshotJson, null);
});

test('buildPgInsertParams: clamps label at 100 chars + falsy label → null', () => {
  const long = 'x'.repeat(250);
  const r1 = savedPlans.buildPgInsertParams(baseRecord({ label: long }));
  assert.equal(r1.label.length, 100);
  const r2 = savedPlans.buildPgInsertParams(baseRecord({ label: '' }));
  assert.equal(r2.label, null);
  const r3 = savedPlans.buildPgInsertParams(baseRecord({ label: undefined }));
  assert.equal(r3.label, null);
});

test('buildPgInsertParams: pseudonymised email (post-Article-17) passes through verbatim', () => {
  const pseudonym = 'deleted-1234567890ab@anonymised.local';
  const r = savedPlans.buildPgInsertParams(baseRecord({ email: pseudonym }));
  assert.equal(r.emailHash, pseudonym, 'pseudonym becomes the identity column');
});

test('buildPgInsertParams: defensive — strips any email field that snuck into inputs/snapshot', () => {
  const r = savedPlans.buildPgInsertParams(baseRecord({
    inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', email: 'leaked@evil.com' },
    snapshot: { perShipmentLandedTotal: 1000, email: 'also-leaked@evil.com' },
  }));
  assert.equal(JSON.parse(r.inputsJson).email, undefined);
  assert.equal(JSON.parse(r.snapshotJson).email, undefined);
  assert.equal(r.inputsJson.indexOf('leaked'), -1);
  assert.equal(r.snapshotJson.indexOf('leaked'), -1);
});

test('buildPgInsertParams: throws when id/email missing', () => {
  assert.throws(() => savedPlans.buildPgInsertParams({}), /id.*email/);
  assert.throws(() => savedPlans.buildPgInsertParams(baseRecord({ id: undefined })), /id.*email/);
  assert.throws(() => savedPlans.buildPgInsertParams(baseRecord({ email: '' })), /id.*email/);
});

// ── recordPg: not-configured path ──────────────────────────

test('recordPg: returns {written:false, reason:not-configured} when DATABASE_URL unset', async () => {
  await withEnvAsync({ DATABASE_URL: null, DATABASE_URL_UNPOOLED: null }, async () => {
    const r = await savedPlans.recordPg(baseRecord());
    assert.equal(r.written, false);
    assert.equal(r.reason, 'not-configured');
  });
});

test('recordPg: returns {written:false} on DB error (no throw)', async () => {
  await withEnvAsync(
    { DATABASE_URL: 'postgresql://nope:nope@localhost:1/none?sslmode=require' },
    async () => {
      const origFetch = global.fetch;
      global.fetch = async () => { throw new Error('ECONNREFUSED'); };
      try {
        const r = await savedPlans.recordPg(baseRecord());
        assert.equal(r.written, false);
        assert.ok(r.err);
      } finally {
        global.fetch = origFetch;
      }
    }
  );
});

test('recordPg: returns {written:false} on a malformed record (no PG round-trip)', async () => {
  await withEnvAsync(
    { DATABASE_URL: 'postgresql://k:p@h/db?sslmode=require' },
    async () => {
      // Don't stub fetch — the param-build phase should fail before
      // any network call is made.
      let fetchCalled = false;
      const origFetch = global.fetch;
      global.fetch = async () => { fetchCalled = true; return { ok: true }; };
      try {
        const r = await savedPlans.recordPg({});
        assert.equal(r.written, false);
        assert.ok(r.err);
        assert.equal(fetchCalled, false, 'malformed record must not reach the network');
      } finally {
        global.fetch = origFetch;
      }
    }
  );
});

// ── softDeletePg ───────────────────────────────────────────

test('softDeletePg: not-configured returns structured failure (no throw)', async () => {
  await withEnvAsync({ DATABASE_URL: null }, async () => {
    const r = await savedPlans.softDeletePg('pl_xxx');
    assert.equal(r.written, false);
    assert.equal(r.reason, 'not-configured');
  });
});

test('softDeletePg: refuses bad external id', async () => {
  await withEnvAsync(
    { DATABASE_URL: 'postgresql://k:p@h/db?sslmode=require' },
    async () => {
      const r1 = await savedPlans.softDeletePg('');
      assert.equal(r1.written, false);
      const r2 = await savedPlans.softDeletePg(null);
      assert.equal(r2.written, false);
    }
  );
});

// ── listFromPg: defensive empty paths ──────────────────────

test('listFromPg: returns [] when DATABASE_URL unset', async () => {
  await withEnvAsync({ DATABASE_URL: null, DATABASE_URL_UNPOOLED: null }, async () => {
    const r = await savedPlans.listFromPg();
    assert.deepEqual(r, []);
  });
});

test('listFromPg: returns [] on DB error (defensive)', async () => {
  await withEnvAsync(
    { DATABASE_URL: 'postgresql://k:p@h/db?sslmode=require' },
    async () => {
      const origFetch = global.fetch;
      global.fetch = async () => { throw new Error('ECONNREFUSED'); };
      try {
        const r = await savedPlans.listFromPg();
        assert.deepEqual(r, []);
      } finally {
        global.fetch = origFetch;
      }
    }
  );
});

// ── savePlan integration: KV-only mode, fire-and-forget PG ─

test('savePlan: KV-only mode (no DATABASE_URL) returns intact record + writes to KV', async () => {
  kv._resetMemoryStore();
  await withEnvAsync({ DATABASE_URL: null, DATABASE_URL_UNPOOLED: null }, async () => {
    const r = await savedPlans.savePlan({
      email: 'alice@example.com',
      inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000 },
      label: 'kv-only',
    });
    assert.ok(r.id);
    assert.equal(r.email, 'alice@example.com');
    assert.equal(r.label, 'kv-only');
    // KV record exists.
    const refetched = await savedPlans.getPlan(r.id, 'alice@example.com');
    assert.ok(refetched);
    assert.equal(refetched.id, r.id);
  });
});

test('savePlan: fire-and-forget PG write does NOT block the function', async () => {
  kv._resetMemoryStore();
  const origFetch = global.fetch;
  // Hang the fetch INDEFINITELY via a deferred promise. If savePlan
  // awaits the PG write, this test will time out (proving the bug).
  // If savePlan correctly fire-and-forgets, savePlan resolves while
  // the fetch is still pending — and we win the Promise.race.
  let resolveFetch;
  const neverResolvesUntilWeSayItDoes = new Promise((r) => { resolveFetch = r; });
  global.fetch = () => neverResolvesUntilWeSayItDoes;
  try {
    await withEnvAsync(
      { DATABASE_URL: 'postgresql://k:p@h/db?sslmode=require' },
      async () => {
        const winner = await Promise.race([
          savedPlans.savePlan({
            email: 'busy@example.com',
            inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000 },
          }).then((r) => ({ kind: 'savePlan', r })),
          new Promise((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), 500)),
        ]);
        assert.equal(winner.kind, 'savePlan',
          'savePlan must resolve while the PG fetch is still pending (fire-and-forget)');
        assert.ok(winner.r.id, 'savePlan returned a record');
      }
    );
  } finally {
    // Let the orphaned recordPg promise complete (it will fail when
    // we resolve the fetch with an error, but the .catch() in savePlan
    // swallows it).
    resolveFetch({ ok: false, status: 500, text: async () => 'cleanup' });
    await new Promise((r) => setImmediate(r));
    global.fetch = origFetch;
  }
});

test('savePlan: PG write failure does NOT corrupt the KV write or affect the return value', async () => {
  kv._resetMemoryStore();
  const origFetch = global.fetch;
  global.fetch = async () => { throw new Error('PG dead'); };
  try {
    await withEnvAsync(
      { DATABASE_URL: 'postgresql://k:p@h/db?sslmode=require' },
      async () => {
        const r = await savedPlans.savePlan({
          email: 'pg-down@example.com',
          inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000 },
        });
        assert.ok(r.id, 'KV write succeeds even when PG is down');
        // The UI still works — list returns the plan.
        const list = await savedPlans.listPlans('pg-down@example.com');
        assert.equal(list.length, 1);
        assert.equal(list[0].id, r.id);
      }
    );
  } finally {
    global.fetch = origFetch;
  }
});

// ── Module surface ─────────────────────────────────────────

test('module exports the BG-2.4 surface', () => {
  for (const name of ['buildPgInsertParams', 'recordPg', 'softDeletePg', 'listFromPg']) {
    assert.equal(typeof savedPlans[name], 'function', `${name} exported`);
  }
});
