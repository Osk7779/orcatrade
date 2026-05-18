// Tests for the Postgres dual-write in lib/actuals.js
// — Sprint BG-1.4 phase 1.5.
//
// Mirrors test/events-pg-dual-write.test.js (BG-2.2) and
// test/saved-plans-pg-dual-write.test.js (BG-2.4). Same shape:
//   1. buildPgInsertParams pure-function tests.
//   2. recordPg / clearPg defensive paths (not-configured + DB error).
//   3. setActual integration: KV-only behaviour preserved + fire-and-
//      forget proven against a hung fetch.
//   4. listFromPg defensive empty paths.

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');

const actuals = require('../lib/actuals');
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

async function seedPlan(email = 'me@example.com') {
  return savedPlans.savePlan({
    email,
    inputs: {
      productCategory: 'apparel',
      originCountry: 'CN',
      destinationCountry: 'PL',
      customsValueEur: 25000,
    },
    label: 'seed',
    snapshot: { perShipmentLandedTotal: 30000, schemaVersion: 1 },
  });
}

// ── buildPgInsertParams (pure) ─────────────────────────────

test('buildPgInsertParams: hashes the owner email; raw email never reaches PG', () => {
  const actual = actuals.buildActualRecord({ landedEur: 30000, notes: '' });
  const p = actuals.buildPgInsertParams('pl_abc123', actual, 'alice@example.com');
  assert.equal(p.planExternalId, 'pl_abc123');
  assert.equal(p.landedCents, 3000000);
  assert.match(p.emailHash, /^[a-f0-9]{16}$/);
  assert.equal(p.emailHash, hash.emailHash('alice@example.com'));
  // v1 doesn't capture duty/freight breakdown — must be null.
  assert.equal(p.dutyCents, null);
  assert.equal(p.freightCents, null);
});

test('buildPgInsertParams: empty notes → null (cleaner column), non-empty preserved', () => {
  const actual = actuals.buildActualRecord({ landedEur: 30000, notes: '' });
  const empty = actuals.buildPgInsertParams('pl_1', actual, 'a@b.c');
  assert.equal(empty.notes, null);

  const withNotes = actuals.buildPgInsertParams('pl_1',
    actuals.buildActualRecord({ landedEur: 30000, notes: 'duty surprise' }),
    'a@b.c');
  assert.equal(withNotes.notes, 'duty surprise');
});

test('buildPgInsertParams: pseudonymised post-Article-17 email passes through verbatim', () => {
  const pseudonym = 'deleted-1234567890ab@anonymised.local';
  const actual = actuals.buildActualRecord({ landedEur: 30000, notes: '' });
  const p = actuals.buildPgInsertParams('pl_1', actual, pseudonym);
  assert.equal(p.emailHash, pseudonym);
});

test('buildPgInsertParams: throws on missing required fields', () => {
  const actual = actuals.buildActualRecord({ landedEur: 30000, notes: '' });
  assert.throws(() => actuals.buildPgInsertParams('', actual, 'a@b.c'), /planExternalId/);
  assert.throws(() => actuals.buildPgInsertParams('pl_1', null, 'a@b.c'), /landedCents/);
  assert.throws(() => actuals.buildPgInsertParams('pl_1', {}, 'a@b.c'), /landedCents/);
  assert.throws(() => actuals.buildPgInsertParams('pl_1', actual, ''), /ownerEmail/);
  assert.throws(() => actuals.buildPgInsertParams('pl_1', actual, null), /ownerEmail/);
});

// ── recordPg: not-configured + db-error paths ──────────────

test('recordPg: returns {written:false, reason:not-configured} when DATABASE_URL unset', async () => {
  await withEnvAsync({ DATABASE_URL: null, DATABASE_URL_UNPOOLED: null }, async () => {
    const actual = actuals.buildActualRecord({ landedEur: 30000, notes: '' });
    const r = await actuals.recordPg('pl_1', actual, 'a@b.c');
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
        const actual = actuals.buildActualRecord({ landedEur: 30000, notes: '' });
        const r = await actuals.recordPg('pl_1', actual, 'a@b.c');
        assert.equal(r.written, false);
        assert.ok(r.err);
      } finally {
        global.fetch = origFetch;
      }
    }
  );
});

test('recordPg: short-circuits before any network call on malformed input', async () => {
  await withEnvAsync(
    { DATABASE_URL: 'postgresql://k:p@h/db?sslmode=require' },
    async () => {
      let fetchCalled = false;
      const origFetch = global.fetch;
      global.fetch = async () => { fetchCalled = true; return { ok: true }; };
      try {
        // Missing owner email — buildPgInsertParams throws synchronously.
        const r = await actuals.recordPg('pl_1', { landedCents: 1000 }, '');
        assert.equal(r.written, false);
        assert.ok(r.err);
        assert.equal(fetchCalled, false, 'malformed input must not reach the network');
      } finally {
        global.fetch = origFetch;
      }
    }
  );
});

// ── clearPg ────────────────────────────────────────────────

test('clearPg: not-configured returns structured failure', async () => {
  await withEnvAsync({ DATABASE_URL: null }, async () => {
    const r = await actuals.clearPg('pl_1');
    assert.equal(r.written, false);
    assert.equal(r.reason, 'not-configured');
  });
});

test('clearPg: refuses bad external id', async () => {
  await withEnvAsync(
    { DATABASE_URL: 'postgresql://k:p@h/db?sslmode=require' },
    async () => {
      const r1 = await actuals.clearPg('');
      assert.equal(r1.written, false);
      const r2 = await actuals.clearPg(null);
      assert.equal(r2.written, false);
    }
  );
});

// ── listFromPg: defensive empty paths ──────────────────────

test('listFromPg: returns [] when DATABASE_URL unset', async () => {
  await withEnvAsync({ DATABASE_URL: null, DATABASE_URL_UNPOOLED: null }, async () => {
    const r = await actuals.listFromPg();
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
        const r = await actuals.listFromPg();
        assert.deepEqual(r, []);
      } finally {
        global.fetch = origFetch;
      }
    }
  );
});

// ── setActual integration ──────────────────────────────────

test('setActual: KV-only mode (no DATABASE_URL) returns the updated record', async () => {
  kv._resetMemoryStore();
  await withEnvAsync({ DATABASE_URL: null, DATABASE_URL_UNPOOLED: null }, async () => {
    const plan = await seedPlan('me@example.com');
    const updated = await actuals.setActual(plan.id, 'me@example.com', { landedEur: 31000 });
    assert.equal(updated.actual.landedCents, 3100000);
  });
});

test('setActual: fire-and-forget PG write does NOT block the function', async () => {
  kv._resetMemoryStore();
  // Hang the PG fetch indefinitely. Promise.race against a 500ms
  // timeout: if setActual awaits the PG write, the timeout wins
  // (proving the regression). The seedPlan() above also fires a
  // PG write, so use a flag to only hang the SECOND fetch (the
  // actuals INSERT) — the first one (saved_plans INSERT) we let
  // resolve fast.
  let resolveSecondFetch;
  let fetchCount = 0;
  const origFetch = global.fetch;
  global.fetch = (...args) => {
    fetchCount++;
    if (fetchCount === 1) {
      // First call: the saved_plans PG INSERT. Reject quickly so it
      // doesn't sit pending and confuse the rest of the test.
      return Promise.resolve({ ok: false, status: 500, text: async () => '' });
    }
    // Second + subsequent: the actuals PG INSERT. Hang.
    return new Promise((r) => { resolveSecondFetch = r; });
  };
  try {
    await withEnvAsync(
      { DATABASE_URL: 'postgresql://k:p@h/db?sslmode=require' },
      async () => {
        const plan = await seedPlan('me@example.com');
        const winner = await Promise.race([
          actuals.setActual(plan.id, 'me@example.com', { landedEur: 31000 })
            .then((r) => ({ kind: 'setActual', r })),
          new Promise((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), 500)),
        ]);
        assert.equal(winner.kind, 'setActual',
          'setActual must resolve while the PG fetch is still pending');
        assert.ok(winner.r.actual);
        assert.equal(winner.r.actual.landedCents, 3100000);
      }
    );
  } finally {
    if (typeof resolveSecondFetch === 'function') {
      resolveSecondFetch({ ok: false, status: 500, text: async () => 'cleanup' });
    }
    await new Promise((r) => setImmediate(r));
    global.fetch = origFetch;
  }
});

test('setActual: PG failure does NOT corrupt the KV write or affect the return value', async () => {
  kv._resetMemoryStore();
  const origFetch = global.fetch;
  global.fetch = async () => { throw new Error('PG dead'); };
  try {
    await withEnvAsync(
      { DATABASE_URL: 'postgresql://k:p@h/db?sslmode=require' },
      async () => {
        const plan = await seedPlan('me@example.com');
        const updated = await actuals.setActual(plan.id, 'me@example.com', { landedEur: 31000 });
        assert.ok(updated.actual, 'KV write succeeds even when PG is down');
        // Re-fetch via KV — value persisted.
        const refetched = await savedPlans.getPlan(plan.id, 'me@example.com');
        assert.equal(refetched.actual.landedCents, 3100000);
      }
    );
  } finally {
    global.fetch = origFetch;
  }
});

// ── clearActual integration ────────────────────────────────

test('clearActual: KV-only mode removes the actual; PG path skipped silently', async () => {
  kv._resetMemoryStore();
  await withEnvAsync({ DATABASE_URL: null, DATABASE_URL_UNPOOLED: null }, async () => {
    const plan = await seedPlan('me@example.com');
    await actuals.setActual(plan.id, 'me@example.com', { landedEur: 31000 });
    const cleared = await actuals.clearActual(plan.id, 'me@example.com');
    assert.equal(cleared.actual, undefined);
  });
});

// ── Module surface ─────────────────────────────────────────

test('module exports the BG-1.4-phase-1.5 surface', () => {
  for (const name of ['buildPgInsertParams', 'recordPg', 'clearPg', 'listFromPg']) {
    assert.equal(typeof actuals[name], 'function', `${name} exported`);
  }
});
