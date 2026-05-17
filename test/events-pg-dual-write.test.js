// Tests for the Postgres dual-write in lib/events.js + lib/hash.js
// — Sprint BG-2.2.
//
// Strategy:
//   1. lib/hash.js: pure-function unit tests (determinism + normalisation)
//   2. lib/events.js#buildPgInsertParams: pure-function tests (the SQL
//      params tuple for INSERT INTO events). No live DB needed.
//   3. lib/events.js#recordPg: tests in BOTH not-configured (DATABASE_URL
//      unset) and configured-but-failing (mocked driver) modes.
//   4. lib/events.js#record: confirms KV-only behaviour is unchanged
//      when DATABASE_URL is unset; PG dual-write is fire-and-forget.

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');

const hash = require('../lib/hash');
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

// ── lib/hash.js ─────────────────────────────────────────────

test('emailHash: returns 16-hex lowercase string', () => {
  const h = hash.emailHash('hello@example.com');
  assert.match(h, /^[a-f0-9]{16}$/);
});

test('emailHash: deterministic across calls', () => {
  assert.equal(hash.emailHash('user@example.com'), hash.emailHash('user@example.com'));
});

test('emailHash: case-insensitive (User@Example.com == user@example.com)', () => {
  assert.equal(hash.emailHash('User@Example.COM'), hash.emailHash('user@example.com'));
});

test('emailHash: trim-stable', () => {
  assert.equal(hash.emailHash('  user@example.com  '), hash.emailHash('user@example.com'));
});

test('emailHash: distinct emails → distinct hashes', () => {
  assert.notEqual(hash.emailHash('a@example.com'), hash.emailHash('b@example.com'));
});

test('emailHash: empty/null/undefined → null', () => {
  assert.equal(hash.emailHash(null), null);
  assert.equal(hash.emailHash(undefined), null);
  assert.equal(hash.emailHash(''), null);
  assert.equal(hash.emailHash('   '), null);
});

test('isAlreadyPseudonym: detects post-Article-17 emails', () => {
  assert.equal(hash.isAlreadyPseudonym('deleted-abc123def456@anonymised.local'), true);
  assert.equal(hash.isAlreadyPseudonym('user@example.com'), false);
  assert.equal(hash.isAlreadyPseudonym(''), false);
  assert.equal(hash.isAlreadyPseudonym(null), false);
});

// Matches lib/handlers/account.js + lib/handlers/audit.js (which both
// declared their own emailHash). The shared module returns the same
// values so we don't fork the hashing space.
test('emailHash compatible with audit handler hashEmail (same algorithm)', () => {
  const audit = require('../lib/handlers/audit');
  const expected = hash.emailHash('alice@example.com');
  const actual = audit.hashEmail('alice@example.com');
  // audit.hashEmail returns 12 hex; lib/hash.emailHash returns 16.
  // Both are sha256 prefixes — assert the first 12 chars match.
  assert.equal(expected.slice(0, 12), actual);
});

// ── buildPgInsertParams (pure) ─────────────────────────────

test('buildPgInsertParams: hashes the email + strips it from payload', () => {
  const r = events.buildPgInsertParams('founding_applied', {
    name: 'Alice', email: 'alice@example.com', company: 'ACo', locale: 'en',
  });
  assert.equal(r.type, 'founding_applied');
  assert.match(r.emailHash, /^[a-f0-9]{16}$/);
  const parsed = JSON.parse(r.payloadJson);
  assert.equal(parsed.email, undefined, 'raw email must NOT appear in payload');
  assert.equal(parsed.name, 'Alice');
  assert.equal(parsed.company, 'ACo');
});

test('buildPgInsertParams: no email field → emailHash null, payload intact', () => {
  const r = events.buildPgInsertParams('ai_call', {
    agent: 'orchestrator', costCents: 42, model: 'claude-sonnet-4-7',
  });
  assert.equal(r.emailHash, null);
  const parsed = JSON.parse(r.payloadJson);
  assert.equal(parsed.agent, 'orchestrator');
  assert.equal(parsed.costCents, 42);
});

test('buildPgInsertParams: already-pseudonymised email passes through unchanged', () => {
  const pseudonym = 'deleted-1234567890ab@anonymised.local';
  const r = events.buildPgInsertParams('founding_applied', {
    name: 'deleted', email: pseudonym, locale: 'en',
  });
  // We store the pseudonym verbatim in the email_hash column — it's
  // already the user's post-Article-17 identity, not raw PII.
  assert.equal(r.emailHash, pseudonym);
  assert.equal(JSON.parse(r.payloadJson).email, undefined);
});

test('buildPgInsertParams: defensive against null/empty payload', () => {
  // Both null + undefined fall through to the safePayload = {} branch in
  // buildPgInsertParams. The jsonb column then stores "{}" not "null".
  const r1 = events.buildPgInsertParams('import_plan_generated', null);
  assert.equal(r1.emailHash, null);
  assert.deepEqual(JSON.parse(r1.payloadJson), {});

  const r2 = events.buildPgInsertParams('import_plan_generated', undefined);
  assert.equal(r2.emailHash, null);
  assert.deepEqual(JSON.parse(r2.payloadJson), {});
});

// ── recordPg: not-configured path ──────────────────────────

test('recordPg: returns {written:false, reason:not-configured} when DATABASE_URL unset', async () => {
  await withEnvAsync({ DATABASE_URL: null, DATABASE_URL_UNPOOLED: null }, async () => {
    const r = await events.recordPg('founding_applied', { name: 'x', email: 'x@e.c' });
    assert.equal(r.written, false);
    assert.equal(r.reason, 'not-configured');
  });
});

test('recordPg: returns {written:false} on DB error (no throw)', async () => {
  // Set DATABASE_URL to a value that will fail at fetch time. The
  // serverless driver throws on the first request — we want recordPg
  // to absorb that and return a structured failure.
  await withEnvAsync(
    { DATABASE_URL: 'postgresql://nope:nope@localhost:1/none?sslmode=require' },
    async () => {
      // Stub global.fetch so the driver's HTTP call fails immediately
      // (no 4s timeout in tests).
      const origFetch = global.fetch;
      global.fetch = async () => { throw new Error('ECONNREFUSED'); };
      try {
        const r = await events.recordPg('founding_applied', { name: 'x' });
        assert.equal(r.written, false);
        assert.ok(r.err);
      } finally {
        global.fetch = origFetch;
      }
    }
  );
});

// ── record(): KV stays primary; PG dual-write is fire-and-forget ──

test('record: KV-only mode (no DATABASE_URL) still returns true, writes to KV', async () => {
  kv._resetMemoryStore();
  await withEnvAsync({ DATABASE_URL: null, DATABASE_URL_UNPOOLED: null }, async () => {
    const ok = await events.record('founding_applied', { name: 'a', email: 'a@e.c' });
    assert.equal(ok, true);
    const list = await events.list({ type: 'founding_applied' });
    assert.equal(list.length, 1);
  });
});

test('record: fire-and-forget PG write does NOT block the function or affect return value', async () => {
  kv._resetMemoryStore();
  // Stub fetch to a slow path; record() should still return promptly
  // because the PG write is .catch()-detached.
  const origFetch = global.fetch;
  let pgFetchCalled = false;
  global.fetch = async () => {
    pgFetchCalled = true;
    // Hang for 100ms, then 500. record() should return well before this.
    await new Promise(r => setTimeout(r, 100));
    return { ok: false, status: 500, text: async () => 'simulated' };
  };
  try {
    await withEnvAsync(
      { DATABASE_URL: 'postgresql://k:p@h/db?sslmode=require' },
      async () => {
        const start = Date.now();
        const ok = await events.record('ai_call', {
          agent: 'orchestrator', model: 'claude-sonnet-4-7', costCents: 5,
        });
        const elapsed = Date.now() - start;
        assert.equal(ok, true);
        // record() must NOT have waited on the slow PG write.
        // (KV memory write is microseconds; PG fetch stub takes 100ms.)
        assert.ok(elapsed < 80, `record() blocked on PG dual-write — took ${elapsed}ms`);
      }
    );
  } finally {
    global.fetch = origFetch;
  }
});

// ── listFromPg: not-configured path ────────────────────────

test('listFromPg: returns [] when DATABASE_URL unset', async () => {
  await withEnvAsync({ DATABASE_URL: null, DATABASE_URL_UNPOOLED: null }, async () => {
    const r = await events.listFromPg();
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
        const r = await events.listFromPg();
        assert.deepEqual(r, []);
      } finally {
        global.fetch = origFetch;
      }
    }
  );
});

// ── ALLOWED_TYPES still includes everything previously valid ─

test('ALLOWED_TYPES preserves the pre-BG-2.2 event vocabulary', () => {
  for (const t of [
    'import_plan_generated',
    'plan_saved',
    'plan_share_opened',
    'auth_signin',
    'auth_signup',
    'founding_applied',
    'ai_call',
  ]) {
    assert.ok(events.ALLOWED_TYPES.has(t), `${t} still allowed`);
  }
});
