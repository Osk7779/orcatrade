'use strict';

// Sprint 100 — first-response breach recording (the claim made true).
//
// Sprint 98 published: "every commitment breach is recorded as
// exactly one audit-chained event." Sprint 97's sweep recorded
// TURNAROUND breaches only — by our own standards, an overclaim.
// Sprint 100 closes it: a symmetric sweep for the first-response
// commitment (past the org's negotiated 24h human-touch target),
// one shared event type discriminated by detail.commitment, so
// the published breach count keeps meaning what /trust/sla says.
//
// Test layers:
//   1. Migration + sweep discipline (mirror of the sprint-97
//      pins: full predicate ×2, oldest-first cap, stamp → event →
//      revert ordering, system actor)
//   2. The discriminator: FR events carry commitment
//      'firstResponse'; the turnaround sweep now stamps
//      'quoteTurnaround'; legacy (no field) renders as turnaround
//   3. Runner: both passes per org, FR against knob 7, per-pass
//      failure isolation
//   4. Renderers branch on the commitment in both surfaces

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequestsDb = require('../lib/db/import-requests');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const CRON_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'cron.js'), 'utf8');
const MIGRATION_SQL = fs.readFileSync(
  path.join(ROOT, 'lib', 'db', 'schema-026-fr-breach-recorded.sql'), 'utf8',
);
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const HISTORY_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'components', 'TransitionHistory.tsx'), 'utf8',
);

const SWEEP = DB_SRC.match(/async function sweepFirstResponseBreachesForOrg\([\s\S]*?\n\}/);

// ── Layer 1: migration + sweep discipline ────────────────────────

test('schema-026: FR stamp column + partial sweep index; the overclaim rationale documented', () => {
  assert.match(MIGRATION_SQL, /ADD COLUMN IF NOT EXISTS fr_breach_recorded_at timestamptz;/);
  assert.match(MIGRATION_SQL, /WHERE fr_breach_recorded_at IS NULL AND first_ops_action_at IS NULL;/);
  assert.match(MIGRATION_SQL, /overclaimed/);
});

test('FR sweep refuses cleanly (runtime) and re-checks the FULL human-touch predicate ×2', async () => {
  const noDb = await importRequestsDb.sweepFirstResponseBreachesForOrg({ orgId: 1, targetHours: 24 });
  assert.equal(noDb.ok, false);
  assert.match(noDb.errors[0], /not configured/i);
  assert.ok(SWEEP, 'FR sweep not found');
  const body = SWEEP[0];
  const touch = body.match(/AND first_ops_action_at IS NULL/g) || [];
  assert.equal(touch.length, 2, 'predicate must guard the UPDATE and the subselect');
  assert.match(body, /AND fr_breach_recorded_at IS NULL/);
  assert.match(body, /ORDER BY created_at ASC\s*\n\s*LIMIT \$3/);
});

test('FR sweep: stamp → event → revert-on-failure ordering; system actor', () => {
  const body = SWEEP[0];
  const stampIdx = body.indexOf('SET fr_breach_recorded_at = now()');
  const eventIdx = body.indexOf("events.record('import_request_sla_breached'");
  const revertIdx = body.indexOf('SET fr_breach_recorded_at = NULL');
  assert.ok(stampIdx > -1 && eventIdx > -1 && revertIdx > -1);
  assert.ok(stampIdx < eventIdx && eventIdx < revertIdx);
  assert.match(body, /actorEmailHash: null,/);
});

// ── Layer 2: the discriminator ───────────────────────────────────

test('one event type, two commitments: FR stamps firstResponse; turnaround now stamps quoteTurnaround', () => {
  assert.match(SWEEP[0], /commitment: 'firstResponse',/);
  const turnSweep = DB_SRC.match(/async function sweepSlaBreachesForOrg\([\s\S]*?\n\}/)[0];
  assert.match(turnSweep, /commitment: 'quoteTurnaround',/);
  // Both go to the SAME registered type — the published count
  // stays one number meaning "commitment breaches".
  const typeUses = DB_SRC.match(/events\.record\('import_request_sla_breached'/g) || [];
  assert.equal(typeUses.length, 2, 'exactly the two sweeps record breaches');
});

// ── Layer 3: runner ──────────────────────────────────────────────

test('the hourly runner executes BOTH passes per org — FR against knob 7 — with per-pass isolation', () => {
  const start = CRON_SRC.indexOf('async function runSlaBreachSweep(');
  const next = CRON_SRC.indexOf('async function ', start + 10);
  const body = CRON_SRC.slice(start, next);
  assert.match(body, /sweepSlaBreachesForOrg\(\{\s*\n\s*orgId: orgIdNumeric,\s*\n\s*targetHours: orgConfig\.slaQuoteTurnaroundTargetHours,/);
  assert.match(body, /sweepFirstResponseBreachesForOrg\(\{\s*\n\s*orgId: orgIdNumeric,\s*\n\s*targetHours: orgConfig\.slaFirstResponseTargetHours,/);
  // The turnaround pass records even when the FR pass fails —
  // recorded/stamped accumulate before the FR call.
  const turnIdx = body.indexOf('sweepSlaBreachesForOrg(');
  const frIdx = body.indexOf('sweepFirstResponseBreachesForOrg(');
  const firstAccumIdx = body.indexOf('recorded += result.recorded;');
  assert.ok(turnIdx < firstAccumIdx && firstAccumIdx < frIdx,
    'turnaround results must accumulate before the FR pass runs');
});

// ── Layer 4: renderers ───────────────────────────────────────────

test('both renderers branch on the commitment; legacy events (no field) read as turnaround', () => {
  assert.match(API_TS, /const fr = d\?\.commitment === 'firstResponse';/);
  assert.match(API_TS, /First-response SLA breached on /);
  assert.match(HISTORY_TSX, /const fr = d\.commitment === 'firstResponse';/);
  assert.match(HISTORY_TSX, /First-response commitment breached — no human action at /);
  // The legacy default is DOCUMENTED at both call sites.
  assert.match(API_TS, /legacy events without the discriminator are/i);
  assert.match(HISTORY_TSX, /legacy = turnaround/);
});
