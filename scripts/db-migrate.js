#!/usr/bin/env node
// Postgres migration runner — Sprint BG-2.1.
//
// Applies every lib/db/schema*.sql file in alphabetical order. Records
// each applied file in the schema_versions table with a SHA-256 of the
// file content so re-runs are idempotent + content drift is detected.
//
// Usage:
//   DATABASE_URL_UNPOOLED=postgresql://… node scripts/db-migrate.js
//   DATABASE_URL_UNPOOLED=postgresql://… node scripts/db-migrate.js --dry-run
//
// The runner uses DATABASE_URL_UNPOOLED (or DATABASE_URL as fallback)
// because schema changes need stable connections that survive longer
// than the pooler's session lifetime.
//
// Also callable via the cron handler as `db-migrate` — that's the
// path GHA uses in production. The CLI path is for local + first-run
// bootstrap.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA_DIR = path.resolve(__dirname, '..', 'lib', 'db');

function dbUrl() {
  return process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '';
}

function color(text, c) {
  if (!process.stdout.isTTY) return String(text);
  const codes = { red: 31, green: 32, yellow: 33, cyan: 36, dim: 2 };
  return `\x1b[${codes[c] || 0}m${text}\x1b[0m`;
}

function findMigrationFiles() {
  if (!fs.existsSync(SCHEMA_DIR)) return [];
  return fs.readdirSync(SCHEMA_DIR)
    .filter(f => /^schema(-[a-z0-9-]+)?\.sql$/i.test(f))
    .sort();
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function ensureSchemaVersionsTable(sql) {
  // The first migration creates schema_versions itself; this guard
  // makes sure even an empty database can pre-check applied versions.
  await sql(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now(),
      sha256     text NOT NULL
    )
  `);
}

async function alreadyApplied(sql, filename) {
  // @neondatabase/serverless: the `sql` function itself accepts
  // (text, params) — there is no `.query()` method.
  const result = await sql('SELECT filename, sha256 FROM schema_versions WHERE filename = $1', [filename]);
  const rows = Array.isArray(result) ? result : (result && result.rows) || [];
  return rows.length > 0 ? rows[0] : null;
}

async function recordApplied(sql, filename, hash) {
  await sql(
    'INSERT INTO schema_versions (filename, sha256) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING',
    [filename, hash],
  );
}

// Run a single migration file. Returns one of: 'applied' | 'skipped' | 'drift'.
async function applyMigration(sql, filename, opts = {}) {
  const filePath = path.join(SCHEMA_DIR, filename);
  const content = fs.readFileSync(filePath, 'utf8');
  const hash = sha256(content);

  const existing = await alreadyApplied(sql, filename);
  if (existing) {
    if (existing.sha256 !== hash) {
      return { status: 'drift', filename, expectedSha: existing.sha256, currentSha: hash };
    }
    return { status: 'skipped', filename };
  }

  if (opts.dryRun) {
    return { status: 'would-apply', filename };
  }

  // The Neon HTTP driver doesn't support multi-statement strings in a
  // single .query() call. Split on the `;` at end-of-statement (naive
  // but works for our schema — no embedded semicolons in our SQL).
  // Strip line comments first.
  const cleaned = content
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
  const statements = cleaned
    .split(/;\s*$/m)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const stmt of statements) {
    try {
      await sql(stmt);
    } catch (err) {
      // Re-throw with context so the caller can see WHICH statement broke.
      const preview = stmt.replace(/\s+/g, ' ').slice(0, 120);
      throw new Error(`Migration ${filename} failed at "${preview}…": ${err.message}`);
    }
  }
  await recordApplied(sql, filename, hash);
  return { status: 'applied', filename, statementCount: statements.length };
}

// Programmatic entry — used by the cron handler.
async function runMigrations(opts = {}) {
  if (!dbUrl()) {
    return { ok: false, error: 'DATABASE_URL not set' };
  }
  const { neon } = require('@neondatabase/serverless');
  const sql = neon(dbUrl());

  await ensureSchemaVersionsTable(sql);

  const files = findMigrationFiles();
  const results = [];
  for (const f of files) {
    try {
      const result = await applyMigration(sql, f, opts);
      results.push(result);
    } catch (err) {
      results.push({ status: 'error', filename: f, error: err.message });
      break; // halt on first error — never apply downstream migrations on a half-migrated DB
    }
  }

  const applied = results.filter(r => r.status === 'applied').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const drift   = results.filter(r => r.status === 'drift').length;
  const errors  = results.filter(r => r.status === 'error').length;

  return {
    ok: errors === 0,
    summary: { total: files.length, applied, skipped, drift, errors },
    results,
  };
}

// CLI entry — prints a coloured report and exits non-zero on error.
async function mainCli() {
  const dryRun = process.argv.includes('--dry-run');

  if (!dbUrl()) {
    console.error(color('DATABASE_URL_UNPOOLED (or DATABASE_URL) is required.', 'red'));
    process.exit(2);
  }

  console.log(color('\n  OrcaTrade DB migration', 'cyan'));
  console.log(color(`  Target: ${dbUrl().replace(/:\/\/[^:]+:[^@]+@/, '://***:***@').slice(0, 90)}…`, 'dim'));
  console.log(color(`  Schema dir: ${path.relative(process.cwd(), SCHEMA_DIR)}\n`, 'dim'));

  const result = await runMigrations({ dryRun });

  for (const r of result.results) {
    const tag = {
      applied:      color('✓ applied   ', 'green'),
      skipped:      color('· skipped   ', 'dim'),
      'would-apply': color('+ would-apply', 'yellow'),
      drift:        color('! drift      ', 'yellow'),
      error:        color('✗ error     ', 'red'),
    }[r.status] || r.status;
    let detail = '';
    if (r.status === 'applied') detail = color(` (${r.statementCount} statements)`, 'dim');
    if (r.status === 'drift') detail = color(` — content hash changed since first apply`, 'yellow');
    if (r.status === 'error') detail = color(`\n      ${r.error}`, 'red');
    console.log(`  ${tag} ${r.filename}${detail}`);
  }

  const s = result.summary;
  console.log('');
  console.log(color(`  Summary: ${s.applied} applied · ${s.skipped} skipped · ${s.drift} drift · ${s.errors} errors`, 'cyan'));
  if (!result.ok) process.exit(1);
}

module.exports = {
  runMigrations,
  applyMigration,
  findMigrationFiles,
  sha256,
  ensureSchemaVersionsTable,
  SCHEMA_DIR,
};

if (require.main === module) {
  mainCli().catch(err => {
    console.error(color(`Fatal: ${err && err.stack ? err.stack : err}`, 'red'));
    process.exit(2);
  });
}
