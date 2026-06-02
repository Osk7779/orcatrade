// Retention module tests — apex plan P1.I.
//
// Pure-function coverage of lib/retention.js. The live runtime path
// (runPurge / runVerify against an actual Neon branch) is exercised
// by the integration suite when DATABASE_URL is set; this file pins
// the deterministic behaviour without touching a DB.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const retention = require('../lib/retention');

// ── Pure: cutoff math ────────────────────────────────────────

test('ageBasedCutoff: subtracts maxAgeDays from now', () => {
  const now = new Date('2026-06-02T12:00:00.000Z');
  const policy = { maxAgeDays: 30 };
  const cutoff = retention.ageBasedCutoff(now, policy);
  assert.equal(cutoff, '2026-05-03T12:00:00.000Z');
});

test('ageBasedCutoff: throws without maxAgeDays', () => {
  assert.throws(() => retention.ageBasedCutoff(new Date(), {}), /maxAgeDays/);
  assert.throws(() => retention.ageBasedCutoff(new Date()), /maxAgeDays/);
});

test('ageBasedVerifyCutoff: adds the 1-day grace', () => {
  // Verifier cutoff is older than purge cutoff by exactly VERIFY_GRACE_DAYS,
  // so a row that just became purge-eligible doesn't flag the verifier
  // before the next purge run.
  const now = new Date('2026-06-02T12:00:00.000Z');
  const policy = { maxAgeDays: 365 };
  const purgeCutoff = retention.ageBasedCutoff(now, policy);
  const verifyCutoff = retention.ageBasedVerifyCutoff(now, policy);
  const purgeTs = Date.parse(purgeCutoff);
  const verifyTs = Date.parse(verifyCutoff);
  const diffDays = (purgeTs - verifyTs) / (24 * 60 * 60 * 1000);
  assert.equal(diffDays, retention.VERIFY_GRACE_DAYS);
});

// ── Pure: SQL builders ───────────────────────────────────────

test('buildPurgeSql (age cutoff only): simple DELETE', () => {
  const policy = { table: 'events', timeColumn: 'created_at', maxAgeDays: 365 };
  const { sql, params } = retention.buildPurgeSql(policy, '2025-06-02T00:00:00.000Z');
  assert.match(sql, /DELETE FROM events WHERE created_at < \$1/);
  assert.deepEqual(params, ['2025-06-02T00:00:00.000Z']);
});

test('buildPurgeSql (with keepNewest): window-function-based DELETE', () => {
  const policy = {
    table: 'saved_plans',
    timeColumn: 'created_at',
    maxAgeDays: 365,
    keepNewest: 50,
    userColumn: 'email_hash',
  };
  const { sql, params } = retention.buildPurgeSql(policy, '2025-06-02T00:00:00.000Z');
  assert.match(sql, /ROW_NUMBER\(\)\s+OVER\s+\(\s*PARTITION BY email_hash/i);
  assert.match(sql, /ranked\.rn > \$1/);
  assert.match(sql, /created_at < \$2/);
  assert.deepEqual(params, [50, '2025-06-02T00:00:00.000Z']);
});

test('buildPurgeSql: rejects unsafe table / column names (SQL injection guard)', () => {
  // Postgres parameterised queries don't bind identifiers, so we
  // must validate them ourselves. Pin the rejection so a future
  // "config-driven" addition can't slip a malicious table name in.
  assert.throws(
    () => retention.buildPurgeSql({ table: 'events; DROP TABLE users; --', timeColumn: 'c', maxAgeDays: 1 }, 'x'),
    /Unsafe table name/,
  );
  assert.throws(
    () => retention.buildPurgeSql({ table: 'events', timeColumn: 'c; --', maxAgeDays: 1 }, 'x'),
    /Unsafe time column/,
  );
});

test('buildPurgeSql: rejects unsafe userColumn when keepNewest is set', () => {
  assert.throws(
    () => retention.buildPurgeSql({
      table: 'plans', timeColumn: 'created_at', maxAgeDays: 1,
      keepNewest: 50, userColumn: 'email_hash; --',
    }, 'x'),
    /Unsafe user column/,
  );
});

test('buildPurgeSql: rejects non-positive keepNewest', () => {
  for (const bad of [0, -1, 'fifty', 1.5, NaN]) {
    assert.throws(
      () => retention.buildPurgeSql({
        table: 'plans', timeColumn: 'created_at', maxAgeDays: 1,
        keepNewest: bad, userColumn: 'email_hash',
      }, 'x'),
      /keepNewest must be a positive integer/,
      `bad keepNewest ${bad} should throw`,
    );
  }
});

test('buildVerifySql: COUNT query against the time column', () => {
  const policy = { table: 'events', timeColumn: 'created_at', maxAgeDays: 365 };
  const { sql, params } = retention.buildVerifySql(policy, '2025-06-02T00:00:00.000Z');
  assert.match(sql, /SELECT COUNT\(\*\)::int AS overdue FROM events WHERE created_at < \$1/);
  assert.deepEqual(params, ['2025-06-02T00:00:00.000Z']);
});

test('buildVerifySql: same injection guards apply', () => {
  assert.throws(
    () => retention.buildVerifySql({ table: 'evil`; DROP', timeColumn: 'c', maxAgeDays: 1 }, 'x'),
    /Unsafe table name/,
  );
});

// ── Configuration shape ──────────────────────────────────────

test('RETENTION_POLICIES covers every retention-bound PG table from data-flow.md', () => {
  const have = Object.keys(retention.RETENTION_POLICIES);
  // Pin the policy set so a future addition of a new persistent table
  // requires a matching policy entry. data-flow.md is the canonical
  // list; these are the tables it covers.
  for (const expected of [
    'events',
    'saved_plans',
    'saved_portfolios',
    'actuals',
    'monitoring_alerts',
  ]) {
    assert.ok(have.includes(expected),
      `RETENTION_POLICIES must include "${expected}" — data-flow.md retention table`);
  }
});

test('every policy entry carries a non-trivial reason', () => {
  for (const [name, policy] of Object.entries(retention.RETENTION_POLICIES)) {
    assert.equal(typeof policy.reason, 'string', `${name}: reason must be a string`);
    assert.ok(policy.reason.length >= 30,
      `${name}: reason must be ≥30 chars (got ${policy.reason.length}). A one-word "needed" is not a justification.`);
  }
});

test('every policy entry sets safe maxAgeDays + valid keepNewest if used', () => {
  for (const [name, policy] of Object.entries(retention.RETENTION_POLICIES)) {
    assert.ok(Number.isInteger(policy.maxAgeDays) && policy.maxAgeDays > 0,
      `${name}: maxAgeDays must be a positive integer`);
    assert.ok(policy.maxAgeDays <= 365 * 7,
      `${name}: maxAgeDays ${policy.maxAgeDays} is > 7 years — implausibly long, check the policy`);
    if (policy.keepNewest !== undefined) {
      assert.ok(Number.isInteger(policy.keepNewest) && policy.keepNewest > 0,
        `${name}: keepNewest must be a positive integer when set`);
      assert.ok(policy.userColumn, `${name}: userColumn required when keepNewest is set`);
    }
  }
});

// ── Live-mode degradation ────────────────────────────────────

test('runPurge: returns db-not-configured when DATABASE_URL is unset', async () => {
  // Without a DB, the live path is a no-op rather than a crash.
  // (The KV-only / dev / test environments hit this path.)
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_UNPOOLED;
  const result = await retention.runPurge();
  // Either module-unavailable (no @neondatabase/serverless installed)
  // or not-configured (installed but no URL) is acceptable.
  assert.equal(result.ok, false);
  assert.ok(['db-not-configured', 'db-module-unavailable'].includes(result.reason),
    `unexpected reason: ${result.reason}`);
});

test('runVerify: same graceful degradation', async () => {
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_UNPOOLED;
  const result = await retention.runVerify();
  assert.equal(result.ok, false);
  assert.ok(['db-not-configured', 'db-module-unavailable'].includes(result.reason));
});

// ── Policy doc sync ──────────────────────────────────────────

test('docs/security/retention-policy.md exists and lists each policy', () => {
  // The published policy and the code-side policy must stay in sync.
  // If a new policy is added in code, the doc must reference its table.
  const docPath = path.join(__dirname, '..', 'docs', 'security', 'retention-policy.md');
  assert.ok(fs.existsSync(docPath), 'retention-policy.md must exist');
  const body = fs.readFileSync(docPath, 'utf8');
  for (const tableName of Object.values(retention.RETENTION_POLICIES).map(p => p.table)) {
    assert.match(body, new RegExp(tableName, 'i'),
      `retention-policy.md must mention the "${tableName}" table`);
  }
});

test('retention-policy.md links lib/retention.js as the enforcement source', () => {
  const docPath = path.join(__dirname, '..', 'docs', 'security', 'retention-policy.md');
  const body = fs.readFileSync(docPath, 'utf8');
  assert.match(body, /lib\/retention\.js/, 'enforcement module referenced');
});

test('retention-policy.md carries the standard doc spine', () => {
  const docPath = path.join(__dirname, '..', 'docs', 'security', 'retention-policy.md');
  const body = fs.readFileSync(docPath, 'utf8');
  assert.match(body, /Last updated:\s+\d{4}-\d{2}-\d{2}/, 'YYYY-MM-DD date');
  assert.match(body, /\| v\d+\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|/, 'revision row');
  assert.match(body, /Limitations of this document/i, 'Limitations section');
});
