// Sprint monitoring-v1 — the monitoring-scan cron job end-to-end over KV
// (lib/handlers/cron.js#runMonitoringScan). Uses the REAL recompute
// (composePlan) so this is an integration test of the whole pipeline.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
process.env.ORCATRADE_DISABLE_LIVE_TARIC = '1';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const kv = require('../lib/intelligence/kv-store');
const savedPlans = require('../lib/saved-plans');
const alertStore = require('../lib/alert-store');
const cron = require('../lib/handlers/cron');

// A real, calculable plan. We save it with a deliberately stale snapshot
// (landed total = €1) so any honest recompute is a massive upward drift →
// guarantees a plan_cost_drift alert without depending on live data moving.
const PLAN_INPUT = {
  productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL',
  customsValueEur: 50000, weightKg: 2000, hsCode: '610910',
};
const STALE_SNAPSHOT = {
  asOf: '2026-01-01', perShipmentLandedTotal: 1,
  dutyEur: 0, vatEur: 0, transportEur: 0, brokerageEur: 0, dutyRatePct: 0,
};

test('runMonitoringScan is registered', () => {
  assert.equal(typeof cron.JOBS['monitoring-scan'], 'function');
  assert.equal(typeof cron.runMonitoringScan, 'function');
});

test('dryRun: scans a user with a drifting plan and reports a candidate without persisting', async () => {
  kv._resetMemoryStore();
  await savedPlans.savePlan({ email: 'drift@example.com', inputs: PLAN_INPUT, snapshot: STALE_SNAPSHOT });

  const r = await cron.runMonitoringScan({ dryRun: true });
  assert.equal(r.ok, true);
  assert.ok(r.scannedUsers >= 1);
  assert.ok(r.alertsCreated >= 1, 'a massive stale-snapshot drift should surface ≥1 candidate');

  // dryRun must not write to the inbox.
  const inbox = await alertStore.listAlerts('drift@example.com');
  assert.equal(inbox.length, 0);
});

test('non-dry run persists alerts to the inbox (deduped on re-run)', async () => {
  kv._resetMemoryStore();
  await savedPlans.savePlan({ email: 'drift2@example.com', inputs: PLAN_INPUT, snapshot: STALE_SNAPSHOT });

  const first = await cron.runMonitoringScan({ dryRun: false });
  assert.equal(first.ok, true);
  const inbox = await alertStore.listAlerts('drift2@example.com');
  assert.ok(inbox.length >= 1);
  const driftAlert = inbox.find((a) => a.type === 'plan_cost_drift');
  assert.ok(driftAlert, 'a plan_cost_drift alert should be in the inbox');

  // Re-running refreshes (upserts) rather than duplicating.
  const before = (await alertStore.listAlerts('drift2@example.com')).length;
  await cron.runMonitoringScan({ dryRun: false });
  const after = (await alertStore.listAlerts('drift2@example.com')).length;
  assert.equal(after, before);
});

test('email digest is skipped when RESEND is not configured', async () => {
  kv._resetMemoryStore();
  delete process.env.RESEND_API_KEY;
  await savedPlans.savePlan({ email: 'drift3@example.com', inputs: PLAN_INPUT, snapshot: STALE_SNAPSHOT });
  const r = await cron.runMonitoringScan({ dryRun: false });
  assert.equal(r.digestsSent, 0);
});
