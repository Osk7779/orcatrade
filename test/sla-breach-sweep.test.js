'use strict';

// Sprint 97 — SLA breach recording (every breach becomes a fact).
//
// A blown turnaround commitment was visible everywhere but
// recorded nowhere: no audit-chain entry, no webhook, no timeline
// moment. The hourly sweep stamps each newly-breached request and
// records exactly one import_request_sla_breached event —
// audit-chained, ERP-dispatched, rendered on the request's story.
//
// Load-bearing invariants:
//   - EXACTLY ONCE per request via the sla_breach_recorded_at
//     stamp; the stamping UPDATE re-checks the FULL predicate so a
//     quote landing concurrently drops the row.
//   - AT-LEAST-ONCE events: if the event write throws, the stamp
//     is REVERTED so the next sweep retries — the stamp can never
//     claim a breach the chain doesn't hold (ADR-0005, system
//     actor).
//   - The breach line is the org's NEGOTIATED target (knob 6).
//   - AUDIT RECORDING, NOT AN EMAIL: cadence-independent (a
//     weekly-digests org still gets its breaches on the record),
//     no recipient prefs. Contrast-pinned against the daily
//     alert family.
//   - System actor: actorEmailHash null — no human is blamed for
//     a detection.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequestsDb = require('../lib/db/import-requests');
const events = require('../lib/events');
const webhooks = require('../lib/webhooks');
const cronHandlers = require('../lib/handlers/cron');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const CRON_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'cron.js'), 'utf8');
const GHA_SRC = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'cron.yml'), 'utf8');
const MIGRATION_SQL = fs.readFileSync(
  path.join(ROOT, 'lib', 'db', 'schema-025-sla-breach-recorded.sql'), 'utf8',
);
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const HISTORY_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'components', 'TransitionHistory.tsx'), 'utf8',
);
const IMPORTS_HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');

const SWEEP = DB_SRC.match(/async function sweepSlaBreachesForOrg\([\s\S]*?\n\}/);

// ── Layer 1: migration ───────────────────────────────────────────

test('schema-025: stamp column + partial sweep index; revert semantics documented', () => {
  assert.match(MIGRATION_SQL, /ADD COLUMN IF NOT EXISTS sla_breach_recorded_at timestamptz;/);
  assert.match(MIGRATION_SQL, /WHERE sla_breach_recorded_at IS NULL AND quoted_at IS NULL;/);
  assert.match(MIGRATION_SQL, /REVERTED if the audit event fails/);
});

// ── Layer 2: sweep discipline ────────────────────────────────────

test('sweep refuses cleanly: no DB, no org (runtime)', async () => {
  const noDb = await importRequestsDb.sweepSlaBreachesForOrg({ orgId: 1, targetHours: 48 });
  assert.equal(noDb.ok, false);
  assert.match(noDb.errors[0], /not configured/i);
});

test('the stamping UPDATE re-checks the FULL predicate (concurrent quote drops the row)', () => {
  assert.ok(SWEEP, 'sweep not found');
  const body = SWEEP[0];
  // Both the outer UPDATE and the LIMIT subselect carry the whole
  // predicate — unstamped, unquoted, pre-quote status, unarchived,
  // past the target.
  const predicates = body.match(/AND quoted_at IS NULL/g) || [];
  assert.equal(predicates.length, 2, 'predicate must guard the UPDATE and the subselect');
  assert.match(body, /AND sla_breach_recorded_at IS NULL/);
  assert.match(body, /AND status IN \('submitted', 'processing', 'awaiting_review'\)/);
  assert.match(body, /AND archived_at IS NULL/);
  // Oldest breaches record first; the cap clamps.
  assert.match(body, /ORDER BY created_at ASC\s*\n\s*LIMIT \$3/);
  assert.match(body, /Math\.max\(1, Math\.min\(200, Number\(cap\) \|\| 50\)\)/);
});

test('AT-LEAST-ONCE: event-write failure REVERTS the stamp so the next sweep retries', () => {
  const body = SWEEP[0];
  const stampIdx = body.indexOf('SET sla_breach_recorded_at = now()');
  const eventIdx = body.indexOf("events.record('import_request_sla_breached'");
  const revertIdx = body.indexOf('SET sla_breach_recorded_at = NULL');
  assert.ok(stampIdx > -1 && eventIdx > -1 && revertIdx > -1);
  assert.ok(stampIdx < eventIdx && eventIdx < revertIdx, 'stamp → event → revert-on-failure ordering');
  assert.match(body, /reverted\.push\(externalId\)/);
});

test('system actor + detection facts in the detail (no human blamed, no PII)', () => {
  const body = SWEEP[0];
  assert.match(body, /actorEmailHash: null, \/\/ system detection, not a user action/);
  assert.match(body, /targetHours: target,/);
  assert.match(body, /ageHoursAtDetection: Math\.round\(Number\(row\.age_hours\) \* 10\) \/ 10,/);
});

// ── Layer 3: five-corners registration ───────────────────────────

test('import_request_sla_breached registers across every registry (five-corners)', () => {
  assert.ok(events.ALLOWED_TYPES.has('import_request_sla_breached'));
  assert.ok(events.ORG_ACTIVITY_TYPES.has('import_request_sla_breached'));
  assert.ok(webhooks.WEBHOOK_EVENT_TYPES.includes('import_request_sla_breached'));
  const timelineBlock = IMPORTS_HANDLER_SRC.match(/const IMPORT_REQUEST_TIMELINE_EVENT_TYPES = new Set\(\[[\s\S]*?\]\);/);
  assert.match(timelineBlock[0], /'import_request_sla_breached',/);
  const auditBlock = IMPORTS_HANDLER_SRC.match(/const IMPORT_REQUEST_AUDIT_EVENT_TYPES = new Set\(\[[\s\S]*?\]\);/);
  assert.match(auditBlock[0], /'import_request_sla_breached',/);
  assert.match(API_TS, /\| 'import_request_sla_breached'/);
});

test('renderers narrate the breach with the sweep’s own facts, critical tone', () => {
  assert.match(API_TS, /case 'import_request_sla_breached': \{/);
  assert.match(API_TS, /SLA breached on /);
  assert.match(HISTORY_TSX, /Turnaround commitment breached — unquoted at /);
  assert.match(HISTORY_TSX, /case 'import_request_sla_breached': return 'SLA breach';/);
  assert.match(HISTORY_TSX, /if \(t === 'import_request_sla_breached'\) return 'var\(--color-critical\)';/);
});

// ── Layer 4: runner + schedule ───────────────────────────────────

test('runner registered + exported; the breach line is the NEGOTIATED target', () => {
  assert.match(CRON_SRC, /'sla-breach-sweep': runSlaBreachSweep,/);
  assert.equal(typeof cronHandlers.runSlaBreachSweep, 'function');
  const start = CRON_SRC.indexOf('async function runSlaBreachSweep(');
  const next = CRON_SRC.indexOf('async function ', start + 10);
  const body = CRON_SRC.slice(start, next);
  assert.match(body, /targetHours: orgConfig\.slaQuoteTurnaroundTargetHours,/);
});

test('AUDIT RECORDING, NOT AN EMAIL: cadence-independent, pref-independent (contrast pins)', () => {
  const start = CRON_SRC.indexOf('async function runSlaBreachSweep(');
  const next = CRON_SRC.indexOf('async function ', start + 10);
  const body = CRON_SRC.slice(start, next);
  assert.ok(!/getAlertCadence/.test(body),
    'a weekly-digests org still gets its breaches on the record');
  assert.ok(!/filterMutedRecipients|imports-emails|sendMany/.test(body),
    'the sweep records facts; it sends nothing');
});

test('GHA: hourly at :20, routed, dispatchable (uniqueness guard covers collisions)', () => {
  assert.match(GHA_SRC, /- cron: '20 \* \* \* \*'/);
  assert.match(
    GHA_SRC,
    /elif \[ "\$\{\{ github\.event\.schedule \}\}" = "20 \* \* \* \*" \]; then\s+echo "job=sla-breach-sweep"/,
  );
  assert.match(GHA_SRC, /- sla-breach-sweep/);
});
