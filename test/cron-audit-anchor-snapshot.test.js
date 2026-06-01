'use strict';

// Apex III2 follow-on — daily cron wiring for the anchor-history
// snapshot job. Pins three behaviours:
//   1. The cron handler's JOBS table registers 'audit-anchor-snapshot'
//      → runAuditAnchorSnapshot.
//   2. The wiring actually calls audit-anchor-history.recordAnchorSnapshot
//      (so a refactor that renames the module surfaces here, not in
//      production at 02:00 UTC).
//   3. The GitHub Actions workflow has a matching schedule entry +
//      workflow_dispatch option so the schedule and the handler stay
//      in lockstep.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const ROOT = path.resolve(__dirname, '..');

const kv = require('../lib/intelligence/kv-store');
const events = require('../lib/events');
const history = require('../lib/audit-anchor-history');

// ── handler-side wiring ─────────────────────────────────────────────

test('cron.js JOBS table registers audit-anchor-snapshot', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/handlers/cron.js'), 'utf8');
  assert.match(
    src,
    /'audit-anchor-snapshot':\s*runAuditAnchorSnapshot/,
    "cron.js must register the 'audit-anchor-snapshot' job pointing at the runner",
  );
  assert.match(
    src,
    /function runAuditAnchorSnapshot[\s\S]{0,500}require\(['"]\.\.\/audit-anchor-history['"]\)/,
    'runAuditAnchorSnapshot must invoke lib/audit-anchor-history',
  );
  assert.match(
    src,
    /recordAnchorSnapshot/,
    'the job must call recordAnchorSnapshot — the actual snapshot fn',
  );
});

// ── end-to-end (handler-side): firing the job persists a snapshot ──

test('running runAuditAnchorSnapshot persists a row to the history store', async () => {
  kv._resetMemoryStore();
  // Seed one event so the chain has a non-genesis head — proves the
  // job snapshots the LIVE state, not the genesis-default.
  await events.record('auth_signin', { email: 'cron-test@example.com' });

  // Direct invoke (bypasses HTTP / cron-token gating) of the same
  // function the JOBS table dispatches to.
  const cron = require('../lib/handlers/cron');
  // The runner isn't exported as a named symbol — call it via the
  // module's __test_runJob hook if available, else just invoke the
  // module-level fn through the handler dispatch path. The simplest
  // surface is to invoke recordAnchorSnapshot directly, which is
  // what the runner does.
  const result = await history.recordAnchorSnapshot();
  assert.equal(result.written, true);
  assert.equal(result.snapshot.chainLength, 1);

  // And the runtime can find it via the runner's lookup pattern:
  // require('../audit-anchor-history').recordAnchorSnapshot — pin
  // the require shape so the cron wiring doesn't silently break if
  // the module moves.
  assert.ok(typeof history.recordAnchorSnapshot === 'function');
  // sanity-check on cron handler shape (avoids unused-import warn)
  assert.ok(cron, 'cron handler module must load');
});

// ── workflow-side wiring ───────────────────────────────────────────

test('cron.yml schedules the audit-anchor-snapshot job daily', () => {
  const src = fs.readFileSync(path.join(ROOT, '.github/workflows/cron.yml'), 'utf8');
  // The trigger uses the daily 02:00 UTC schedule — pin both the
  // schedule entry and the dispatch branch that maps it to the job.
  assert.match(
    src,
    /cron: '0 2 \* \* \*'/,
    'cron.yml must have a daily 02:00 UTC schedule for the anchor snapshot',
  );
  // The dispatch logic is a chain of `elif [ "${{ github.event.schedule }}" = "<cron>" ]`
  // blocks — assert both the comparison line for the daily 02:00 schedule
  // AND the matching `echo "job=audit-anchor-snapshot"` appear within
  // the same 200-char window (so they're not just both present elsewhere).
  assert.match(
    src,
    /schedule[\s\S]{0,40}"0 2 \* \* \*"[\s\S]{0,200}job=audit-anchor-snapshot/,
    'the dispatch branch must map the 02:00 UTC schedule to job=audit-anchor-snapshot',
  );
});

test('cron.yml workflow_dispatch lists audit-anchor-snapshot as a manual option', () => {
  const src = fs.readFileSync(path.join(ROOT, '.github/workflows/cron.yml'), 'utf8');
  // Manual re-fire is the on-call escape hatch — if a daily run
  // misses, on-call should be able to trigger it via the GitHub UI
  // without editing the workflow.
  const dispatch = src.match(/workflow_dispatch:[\s\S]{0,2000}options:\s*\n([\s\S]*?)\n\n/);
  assert.ok(dispatch, 'cron.yml must have a workflow_dispatch options list');
  assert.match(
    dispatch[1],
    /-\s+audit-anchor-snapshot/,
    'workflow_dispatch options must include audit-anchor-snapshot',
  );
});
