'use strict';

// Sprint 102 — the self-healing intake pipeline.
//
// The intake flow is client-driven: /imports/new POSTs create,
// then POSTs process. If the tab dies between the two, the row
// sits in 'submitted' with its SLA clock running and nothing
// moving until a human opens the page. The hourly rescue sweep
// closes that hole: orphaned rows get run through the SAME
// orchestrator the button runs.
//
// Load-bearing invariants:
//   - ACTOR = THE REQUEST'S CREATOR. The rescue completes the
//     customer's own submit action, so the audit trail reads
//     exactly as it would have had the tab survived. No system
//     sentinel leaks into actor fields; rows without a creator
//     hash are SKIPPED (they still surface on the at-risk
//     cohort), never processed under a borrowed identity.
//   - 10-minute grace: the sweep can never race a live slow tab.
//   - Wrong-state races are tolerated silently — the state
//     machine is the arbiter; a human clicking Process first is
//     success by another name.
//   - Real pipeline failures are NOT retried blindly — the
//     orchestrator already transitioned those rows to 'failed'
//     with the reason recorded, and the customer-visible
//     recovery path owns them.
//   - Not an email: cadence- and pref-independent.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequestsDb = require('../lib/db/import-requests');
const cronHandlers = require('../lib/handlers/cron');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const CRON_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'cron.js'), 'utf8');
const GHA_SRC = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'cron.yml'), 'utf8');

const READER = DB_SRC.match(/async function listOrphanedSubmittedRequests\([\s\S]*?\n\}/);
const runnerBody = (() => {
  const start = CRON_SRC.indexOf('async function runIntakeRescueSweep(');
  const next = CRON_SRC.indexOf('async function ', start + 10);
  return CRON_SRC.slice(start, next === -1 ? CRON_SRC.length : next);
})();

// ── Reader ───────────────────────────────────────────────────────

test('orphan cut: submitted only, graced, oldest first, capped, archived out (fail-open runtime)', async () => {
  assert.deepEqual(await importRequestsDb.listOrphanedSubmittedRequests({}), [],
    'unconfigured DB → empty, the sweep just finds nothing');
  assert.ok(READER, 'reader not found');
  const body = READER[0];
  assert.match(body, /WHERE status = 'submitted'/);
  assert.match(body, /AND archived_at IS NULL/);
  assert.match(body, /AND created_at < now\(\) - \(\$1 \|\| ' minutes'\)::interval/);
  assert.match(body, /ORDER BY created_at ASC/);
  // Grace default 10 min, clamped; cap default 20, clamped ≤50
  // (each orchestrator run is ~1s — the cap bounds the runner's
  // wall clock inside the function budget).
  assert.match(body, /Math\.max\(1, Math\.min\(1440, Number\(olderThanMinutes\) \|\| 10\)\)/);
  assert.match(body, /Math\.max\(1, Math\.min\(50, Number\(cap\) \|\| 20\)\)/);
});

// ── Runner ───────────────────────────────────────────────────────

test('the rescue acts AS THE CREATOR — and skips rows without one rather than borrow an identity', () => {
  assert.match(runnerBody, /actorEmailHash: orphan\.createdByEmailHash,/);
  assert.match(runnerBody, /if \(!orphan\.createdByEmailHash\) \{\s*\n\s*skippedNoActor \+= 1;\s*\n\s*continue;/);
  // The rationale is on the record (banner sits above the fn).
  assert.match(CRON_SRC, /completes the customer's own submit action/);
  // No sentinel identities anywhere in the runner.
  assert.ok(!/system:|'system'/.test(runnerBody), 'no borrowed/sentinel actor identities');
});

test('it runs the SAME orchestrator the button runs — no second processing path', () => {
  assert.match(runnerBody, /importRequestOrchestrator\.runOrchestrator\(\{/);
  assert.ok(!/composePlan|attachShortlistAndQuote/.test(runnerBody),
    'the rescue must never grow its own pipeline');
});

test('races are success by another name; real failures are counted, not blindly retried', () => {
  assert.match(runnerBody, /result\.code === 'wrong_state' \|\| result\.code === 'concurrent_modification'/);
  assert.match(runnerBody, /raced \+= 1;/);
  assert.match(runnerBody, /errors\.push\(\{ externalId: orphan\.externalId, code: result\.code \|\| 'unknown' \}\)/);
  // Not an email: no cadence gate, no prefs, no send paths.
  assert.ok(!/getAlertCadence|filterMutedRecipients|sendMany|imports-emails/.test(runnerBody));
});

// ── Registration + schedule ──────────────────────────────────────

test('runner registered + exported; GHA hourly at :40, routed, dispatchable', () => {
  assert.match(CRON_SRC, /'intake-rescue-sweep': runIntakeRescueSweep,/);
  assert.equal(typeof cronHandlers.runIntakeRescueSweep, 'function');
  assert.match(GHA_SRC, /- cron: '40 \* \* \* \*'/);
  assert.match(
    GHA_SRC,
    /elif \[ "\$\{\{ github\.event\.schedule \}\}" = "40 \* \* \* \*" \]; then\s+echo "job=intake-rescue-sweep"/,
  );
  assert.match(GHA_SRC, /- intake-rescue-sweep/);
});
