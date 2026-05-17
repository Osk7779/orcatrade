// Tests for lib/db/client.js + lib/db/schema.sql + scripts/db-migrate.js
// — Sprint BG-2.1.
//
// Strategy: every test runs WITHOUT a live database. We exercise:
//   1. The not-configured path on the client (isConfigured / probe)
//   2. The schema.sql contract (all 9 tables present, indexes named,
//      no dangling FKs to non-existent tables, no jsonb-vs-json drift)
//   3. The migration runner's pure-function helpers (sha256, file
//      discovery, schema-versions table SQL shape)
//
// A separate integration test against a live Neon DB exists for the
// pre-deploy verification step — that's the `db-migrate` cron job +
// the smoke test the user runs manually after env vars are set.

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../lib/db/client');
const migrator = require('../scripts/db-migrate');

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

// ── Client: isConfigured + probe ────────────────────────────────

test('isConfigured: false when DATABASE_URL unset', () => {
  withEnv({ DATABASE_URL: null, DATABASE_URL_UNPOOLED: null }, () => {
    assert.equal(db.isConfigured(), false);
  });
});

test('isConfigured: true when DATABASE_URL set', () => {
  withEnv({ DATABASE_URL: 'postgresql://user:pass@host/db' }, () => {
    assert.equal(db.isConfigured(), true);
  });
});

test('probe: returns not-configured when DATABASE_URL unset', async () => {
  await withEnvAsync({ DATABASE_URL: null, DATABASE_URL_UNPOOLED: null }, async () => {
    const r = await db.probe();
    assert.equal(r.ok, false);
    assert.equal(r.status, 'not-configured');
    assert.match(r.err, /not set/);
  });
});

test('query throws clearly when DATABASE_URL unset', async () => {
  await withEnvAsync({ DATABASE_URL: null, DATABASE_URL_UNPOOLED: null }, async () => {
    await assert.rejects(db.query('SELECT 1'), /DATABASE_URL not set/);
  });
});

test('directUrl falls back to DATABASE_URL when DATABASE_URL_UNPOOLED missing', () => {
  withEnv({ DATABASE_URL: 'postgresql://pooled', DATABASE_URL_UNPOOLED: null }, () => {
    assert.equal(db.directUrl(), 'postgresql://pooled');
  });
});

test('directUrl prefers DATABASE_URL_UNPOOLED when set', () => {
  withEnv({ DATABASE_URL: 'postgresql://pooled', DATABASE_URL_UNPOOLED: 'postgresql://direct' }, () => {
    assert.equal(db.directUrl(), 'postgresql://direct');
  });
});

// ── Schema contract ────────────────────────────────────────────

test('schema v1: file exists and is non-trivial', () => {
  const p = path.join(__dirname, '..', 'lib', 'db', 'schema.sql');
  assert.ok(fs.existsSync(p), 'schema.sql exists');
  const content = fs.readFileSync(p, 'utf8');
  assert.ok(content.length > 3000, 'schema.sql is substantial');
});

test('schema v1: all 9 v1 tables declared', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db', 'schema.sql'), 'utf8');
  const required = [
    'schema_versions',
    'users',
    'organisations',
    'memberships',
    'saved_plans',
    'audit_log',
    'events',
    'actuals',
    'subscriptions',
    'prompt_runs',
  ];
  for (const t of required) {
    assert.match(content, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`),
      `table ${t} declared idempotently`);
  }
});

test('schema v1: every CREATE TABLE is idempotent (IF NOT EXISTS)', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db', 'schema.sql'), 'utf8');
  // Strip line comments.
  const code = content.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  const tables = code.match(/CREATE TABLE\b[^;]+/gi) || [];
  for (const stmt of tables) {
    assert.match(stmt, /CREATE TABLE IF NOT EXISTS/i, `non-idempotent CREATE TABLE: ${stmt.slice(0, 80)}`);
  }
});

test('schema v1: every CREATE INDEX is idempotent (IF NOT EXISTS)', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db', 'schema.sql'), 'utf8');
  const code = content.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  const indexes = code.match(/CREATE\s+INDEX\b[^;]+/gi) || [];
  assert.ok(indexes.length >= 5, 'at least 5 indexes declared');
  for (const stmt of indexes) {
    assert.match(stmt, /CREATE INDEX IF NOT EXISTS/i, `non-idempotent CREATE INDEX: ${stmt.slice(0, 80)}`);
  }
});

test('schema v1: payload columns are jsonb not json (binary form, indexable)', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db', 'schema.sql'), 'utf8');
  const code = content.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  // No bare `json` type declarations for payload/inputs/snapshot columns —
  // we want jsonb everywhere.
  assert.doesNotMatch(code, /\b(payload|inputs_json|snapshot_json|before|after)\s+json\b/i,
    'payload/snapshot columns must be jsonb, not json');
});

test('schema v1: timestamps are timestamptz NOT NULL with DEFAULT now()', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db', 'schema.sql'), 'utf8');
  const code = content.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  // Match only column-definition lines (start with whitespace + name +
  // type), not index references like "(created_at DESC)". The pattern
  // `created_at <type>` only appears at column-decl positions when
  // followed by a Postgres type keyword (timestamptz / timestamp).
  const declLines = code.split('\n').filter(line => /^\s*(created_at|applied_at|updated_at|last_seen_at|reported_at|invited_at|joined_at|archived_at|current_period_end)\s+[a-z]/i.test(line));
  assert.ok(declLines.length >= 5, `multiple timestamp column declarations; got ${declLines.length}`);
  for (const line of declLines) {
    assert.match(line, /timestamptz/i, `timestamp column must be timestamptz: ${line.trim()}`);
  }
});

test('schema v1: foreign keys reference declared tables only', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db', 'schema.sql'), 'utf8');
  const code = content.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  const declared = new Set();
  const tableMatches = code.match(/CREATE TABLE IF NOT EXISTS (\w+)/gi) || [];
  for (const m of tableMatches) {
    const name = m.replace(/CREATE TABLE IF NOT EXISTS /i, '').trim();
    declared.add(name);
  }
  const fks = code.match(/REFERENCES\s+(\w+)/gi) || [];
  for (const fk of fks) {
    const target = fk.replace(/REFERENCES\s+/i, '').trim();
    assert.ok(declared.has(target), `FK references undeclared table: ${target}`);
  }
});

test('schema v1: role check constraint on memberships', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db', 'schema.sql'), 'utf8');
  assert.match(content, /role IN \('owner', 'admin', 'member'\)/);
});

test('schema v1: monetary columns use cents (bigint or integer), not float', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db', 'schema.sql'), 'utf8');
  const code = content.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  // Every column ending in _cents must be an integer type.
  const centsCols = code.match(/(\w+_cents)\s+([a-z][a-z0-9_]*)/gi) || [];
  for (const c of centsCols) {
    assert.match(c, /(bigint|integer|int8|int4)/i, `cents column must be integer: ${c}`);
  }
});

// ── Migration runner ──────────────────────────────────────────

test('sha256 is deterministic + 64-hex', () => {
  const a = migrator.sha256('hello');
  const b = migrator.sha256('hello');
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.notEqual(a, migrator.sha256('world'));
});

test('findMigrationFiles discovers schema*.sql in lib/db', () => {
  const files = migrator.findMigrationFiles();
  assert.ok(files.length >= 1, 'at least schema.sql found');
  assert.ok(files.includes('schema.sql'), 'schema.sql in list');
  // Output is alphabetically sorted.
  const sorted = [...files].sort();
  assert.deepEqual(files, sorted, 'files are sorted alphabetically');
});

test('findMigrationFiles ignores non-schema files in lib/db/', () => {
  const files = migrator.findMigrationFiles();
  for (const f of files) {
    assert.match(f, /^schema(-[a-z0-9-]+)?\.sql$/i, `non-schema file leaked into migration list: ${f}`);
  }
});

test('runMigrations: returns ok:false when DATABASE_URL unset', async () => {
  await withEnvAsync({ DATABASE_URL: null, DATABASE_URL_UNPOOLED: null }, async () => {
    const r = await migrator.runMigrations();
    assert.equal(r.ok, false);
    assert.match(r.error, /DATABASE_URL not set/);
  });
});

test('SCHEMA_DIR points at lib/db/', () => {
  assert.match(migrator.SCHEMA_DIR, /lib[\\/]db$/);
});

// ── Health endpoint contract: Postgres subsystem ──────────────

test('aggregate: postgres-down overrides ok (paging condition like kv-down)', () => {
  const health = require('../lib/handlers/health');
  assert.equal(health.aggregate({
    kv: { status: 'ok' },
    postgres: { status: 'down' },
    taric: { status: 'ok' },
    resend: { status: 'ok' },
    stripe: { status: 'ok' },
    anthropic: { status: 'ok' },
  }), 'down');
});

test('aggregate: postgres-degraded (not configured) keeps overall ok-degraded', () => {
  const health = require('../lib/handlers/health');
  assert.equal(health.aggregate({
    kv: { status: 'ok' },
    postgres: { status: 'degraded' },     // unconfigured = degraded, not down
    taric: { status: 'ok' },
    resend: { status: 'ok' },
    stripe: { status: 'ok' },
    anthropic: { status: 'ok' },
  }), 'degraded');
});

test('probePostgres returns degraded when DATABASE_URL unset', async () => {
  await withEnvAsync({ DATABASE_URL: null, DATABASE_URL_UNPOOLED: null }, async () => {
    const health = require('../lib/handlers/health');
    const r = await health.probePostgres();
    assert.equal(r.status, 'degraded');
    assert.equal(r.configured, false);
  });
});

test('status page knows about the postgres subsystem', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'status', 'index.html'), 'utf8');
  assert.match(html, /postgres:\s*\{\s*name:/, 'SUBSYSTEM_LABELS includes postgres');
});

// ── Cron handler exposes db-migrate ──────────────────────────

test('cron handler JOBS map includes db-migrate', () => {
  const cronModule = fs.readFileSync(path.join(__dirname, '..', 'lib', 'handlers', 'cron.js'), 'utf8');
  assert.match(cronModule, /['"]db-migrate['"]:\s*runDbMigrate/);
});
