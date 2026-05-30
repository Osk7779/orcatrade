'use strict';

// Phase 0 task P0.2 of docs/execution-plan.md.
//
// Writer-vs-schema parity: every table that handler / store code WRITES
// to must be DEFINED in one of the lib/db/schema*.sql migration files.
//
// The 2026-05-30 audit claimed seven tables (agent_memory, monitoring_alerts,
// drafts, corpus_chunks, sanctions_entries, sanctions_refresh, data_snapshots)
// were "written to but undefined in schema.sql." On investigation, those
// tables ARE defined — in the per-feature migration files schema-002 …
// schema-008. The audit was reading lib/db/schema.sql in isolation and
// missed the migration files. This test prevents that mistake going
// forward — it fails if any writer-side table reference doesn't have a
// matching CREATE TABLE in the schema corpus.
//
// Scoping discipline:
//   - Only scan files that actually `require('../db/client')` or import
//     the Neon serverless driver. Anything else can't write to PG.
//   - Within those files, only match SQL patterns inside string literals
//     (backticks + single + double quotes) — not in JS variable names or
//     comments. Avoids the "FROM disk" / "FROM sourcing" false positives
//     a naive grep produces.
//   - Exclude lib/db/* (the plumbing itself) + scripts/db-migrate.js
//     (the runner references schema_versions specially).
//
// What this test catches:
//   - A new handler / store writing to a table no migration created
//   - A migration's CREATE TABLE renamed without updating the consumer
//   - A migration deleted but the consumer still references the table
//
// What this test does NOT catch (yet):
//   - Column-level mismatches (handler writes a field the schema doesn't
//     define). Phase 1 P1.D's integration test infrastructure covers
//     this via real DB execution on a Neon branch.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_DIR = path.join(ROOT, 'lib', 'db');

// Tables that exist in PG out of the box (system / extension tables that
// handler code may legitimately reference). Keep tiny + well-justified.
const SYSTEM_TABLES = new Set([
  'pg_stat_activity',
  'pg_indexes',
  'pg_tables',
  'pg_locks',
  'schema_versions', // created by scripts/db-migrate.js itself
]);

// Things that look like table names in a SQL fragment but aren't:
const SQL_NON_TABLES = new Set([
  'select', 'where', 'group', 'order', 'limit', 'having', 'as', 'on',
  'using', 'returning', 'set', 'values', 'true', 'false', 'null',
  'and', 'or', 'not', 'in', 'is', 'with', 'cte',
]);

/**
 * Walk a directory tree returning every .js file.
 */
function listJsFiles(absDir) {
  const out = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('_') || entry.name === 'node_modules') continue;
        walk(full);
      } else if (entry.isFile() && full.endsWith('.js')) {
        out.push(full);
      }
    }
  }
  walk(absDir);
  return out;
}

/**
 * Files that import the DB client or the Neon serverless driver. These
 * are the only files that can write to PG, so they're the only files
 * the parity test needs to scan.
 */
function findDbConsumerFiles() {
  const out = [];
  const candidates = [
    ...listJsFiles(path.join(ROOT, 'lib')),
    ...listJsFiles(path.join(ROOT, 'scripts')),
  ];
  for (const file of candidates) {
    // Exclude the DB plumbing itself + the migrate runner; both reference
    // schema_versions + dynamic SQL that confuses the parity check.
    const rel = path.relative(ROOT, file);
    if (rel.startsWith('lib/db/')) continue;
    if (rel === 'scripts/db-migrate.js') continue;
    const src = fs.readFileSync(file, 'utf8');
    if (/require\(['"][./]*db\/client['"]\)/.test(src) || /require\(['"]@neondatabase\/serverless['"]\)/.test(src)) {
      out.push(file);
    }
  }
  return out;
}

/**
 * Extract every CREATE TABLE [IF NOT EXISTS] <name> from the schema
 * corpus (lib/db/schema*.sql).
 */
function collectDefinedTables() {
  const defined = new Set();
  const files = fs.readdirSync(SCHEMA_DIR).filter((f) => /^schema(-[a-z0-9-]+)?\.sql$/i.test(f));
  for (const f of files) {
    const sql = fs.readFileSync(path.join(SCHEMA_DIR, f), 'utf8');
    const matches = sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi);
    for (const m of matches) defined.add(m[1].toLowerCase());
  }
  return defined;
}

/**
 * Extract every string-literal value (backtick / single / double quoted)
 * from a JS source file. Naive but sufficient: catches the template
 * literals + simple quoted strings where SQL fragments live; doesn't
 * try to handle nested template-literal expressions perfectly.
 */
function extractStringLiterals(src) {
  const out = [];
  // Backtick template literals — including multi-line. Match non-greedy
  // up to the next unescaped backtick.
  for (const m of src.matchAll(/`([^`\\]*(?:\\.[^`\\]*)*)`/gs)) {
    out.push(m[1]);
  }
  // Single + double quoted on a single line each (avoid line-spanning
  // matches which would erase context).
  for (const m of src.matchAll(/'([^'\n\\]*(?:\\.[^'\n\\]*)*)'/g)) {
    out.push(m[1]);
  }
  for (const m of src.matchAll(/"([^"\n\\]*(?:\\.[^"\n\\]*)*)"/g)) {
    out.push(m[1]);
  }
  return out;
}

/**
 * Pull SQL-mentioned table names out of a fragment of SQL-like text.
 * Returns lowercased names with system / keyword noise filtered.
 */
function tablesInSqlFragment(text) {
  // Case-SENSITIVE: every SQL keyword in this codebase is uppercase
  // (verified by grep — 100% of SELECT/INSERT INTO statements in lib/
  // are uppercase). Case-insensitive matching here would pick up
  // prose like "I never logged in from there" embedded in comments
  // inside string-literal arrays. Drop the `i` flag — the false-
  // positive cost outweighs the false-negative risk for our
  // disciplined uppercase convention.
  const out = new Set();
  const patterns = [
    /\bINSERT\s+INTO\s+([a-z_][a-z0-9_]*)/g,
    /\bUPDATE\s+([a-z_][a-z0-9_]*)\s+SET\b/g,
    /\bDELETE\s+FROM\s+([a-z_][a-z0-9_]*)/g,
    /\bFROM\s+([a-z_][a-z0-9_]*)/g,
    /\bJOIN\s+([a-z_][a-z0-9_]*)/g,
  ];
  for (const pat of patterns) {
    for (const m of text.matchAll(pat)) {
      const name = m[1].toLowerCase();
      if (SYSTEM_TABLES.has(name)) continue;
      if (SQL_NON_TABLES.has(name)) continue;
      if (name.length < 3) continue;
      out.add(name);
    }
  }
  return out;
}

/**
 * Map: table name → [file:line, ...] of references. Used in the error
 * message to direct the author at the violating line.
 */
function collectReferencedTables() {
  const referenced = new Map();
  for (const file of findDbConsumerFiles()) {
    const rel = path.relative(ROOT, file);
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split(/\r?\n/);

    // For each line, extract its string literals + check inside them.
    // We re-extract line-by-line for accurate line-number reporting on
    // multi-line template literals (we report the line where the literal
    // starts, which is the line containing the first SQL keyword).
    for (let i = 0; i < lines.length; i++) {
      const literals = extractStringLiterals(lines[i]);
      for (const lit of literals) {
        for (const table of tablesInSqlFragment(lit)) {
          if (!referenced.has(table)) referenced.set(table, []);
          referenced.get(table).push(`${rel}:${i + 1}`);
        }
      }
    }

    // Also scan multi-line backtick strings (the typical Neon driver
    // pattern), with line-number = line where the template starts.
    const tplPattern = /`([^`\\]*(?:\\.[^`\\]*)*)`/gs;
    let m;
    while ((m = tplPattern.exec(src)) !== null) {
      const fragment = m[1];
      if (!fragment.includes('FROM') && !fragment.includes('INSERT') &&
          !fragment.includes('UPDATE') && !fragment.includes('DELETE') &&
          !fragment.includes('JOIN')) continue;
      const start = m.index;
      const line = src.slice(0, start).split('\n').length;
      for (const table of tablesInSqlFragment(fragment)) {
        if (!referenced.has(table)) referenced.set(table, []);
        const site = `${rel}:${line}`;
        if (!referenced.get(table).includes(site)) referenced.get(table).push(site);
      }
    }
  }
  return referenced;
}

test('every PG table written-to by handler/store code is defined in a schema migration', () => {
  const defined = collectDefinedTables();
  const referenced = collectReferencedTables();

  const undefined_ = [];
  for (const [table, sites] of referenced.entries()) {
    if (!defined.has(table)) {
      undefined_.push({ table, sites: sites.slice(0, 5) });
    }
  }

  if (undefined_.length === 0) return;

  const lines = undefined_.flatMap(({ table, sites }) => [
    `  ${table} — referenced in:`,
    ...sites.map((s) => `      ${s}`),
  ]);

  assert.fail(
    `Tables referenced by handler/store SQL without a CREATE TABLE in any lib/db/schema*.sql:\n` +
    lines.join('\n') + '\n\n' +
    `Add a new migration file (lib/db/schema-NNN-<topic>.sql with ` +
    `CREATE TABLE IF NOT EXISTS) OR remove the orphaned reference. See ` +
    `docs/architecture/03-component-data-layer.md for the data-layer principles.`,
  );
});

test('the seven tables the 2026-05-30 audit flagged are actually defined', () => {
  // Regression guard. The audit named seven tables as "missing"; they are
  // not. This pinned assertion prevents a future migration deletion (e.g.
  // accidental schema-005 removal during a refactor) from re-introducing
  // the gap the audit thought existed.
  const defined = collectDefinedTables();
  const auditFlagged = [
    'agent_memory',
    'monitoring_alerts',
    'drafts',
    'corpus_chunks',
    'sanctions_entries',
    'sanctions_refresh',
    'data_snapshots',
  ];

  const stillMissing = auditFlagged.filter((t) => !defined.has(t));
  assert.deepEqual(
    stillMissing,
    [],
    `The following tables — originally flagged by the 2026-05-30 audit but ` +
    `in fact defined in lib/db/schema-002…008 — are no longer defined: ` +
    `${stillMissing.join(', ')}.\nReinstate the dropped migration or remove ` +
    `the corresponding writer code.`,
  );
});
