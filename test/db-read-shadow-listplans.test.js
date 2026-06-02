'use strict';

// Apex A2 step 2 — read-shadow on saved-plans.listPlans (multi-row).
//
// Companion to test/db-read-shadow.test.js (the module-level contract)
// and the getPlan shadow in PR #33. These tests exercise the
// projector that turns a list of records into a comparable shape,
// and pin three list-specific behaviours:
//
//   - Matching lists (KV + PG project to the same sorted shape) →
//     db_shadow_match
//   - Single-row divergence (one field differs in one record) →
//     db_shadow_divergence
//   - Length mismatch (PG has fewer rows than KV, e.g. PG missed a
//     dual-write) → db_shadow_divergence with `length` in
//     divergedKeys
//   - Ordering tolerance — KV is "newest first" via the index array;
//     PG is ORDER BY created_at DESC; the projector sorts by id so
//     clock-skew that swaps two adjacent records doesn't fire a
//     false-positive divergence

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const shadow = require(path.join(ROOT, 'lib', 'db', 'read-shadow'));

// In-process log capture — same shape as test/db-read-shadow.test.js.
function makeCapture() {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  console.log = console.warn = console.error = console.info = (...args) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  return { lines, restore() { Object.assign(console, orig); } };
}
function eventsFrom(lines) {
  const events = [];
  for (const line of lines) {
    const start = line.indexOf('{');
    if (start < 0) continue;
    try {
      const obj = JSON.parse(line.slice(start));
      if (obj && obj.event) events.push(obj);
    } catch (_) { /* skip */ }
  }
  return events;
}

async function withShadowOn(fn) {
  const prev = process.env.ORCATRADE_SHADOW_PG;
  process.env.ORCATRADE_SHADOW_PG = '1';
  const cap = makeCapture();
  try {
    return await fn(cap);
  } finally {
    cap.restore();
    if (prev === undefined) delete process.env.ORCATRADE_SHADOW_PG;
    else process.env.ORCATRADE_SHADOW_PG = prev;
  }
}

// The projector under test lives inside lib/saved-plans.js (not
// exported as a public API). We replicate it here as the test
// fixture — if the in-handler version diverges from this, the
// matching/divergence/length tests below will surface the change
// as a test-suite signal (the comparison shape is the contract).

function projectPlan(r) {
  if (!r || typeof r !== 'object') return r;
  return {
    id: r.id,
    label: r.label || '',
    inputs: r.inputs || {},
    snapshot: r.snapshot || null,
    dataSnapshotId: r.dataSnapshotId || null,
  };
}
function projectList(records) {
  if (!Array.isArray(records)) return records;
  return {
    length: records.length,
    rows: records
      .map((r) => r && projectPlan(r))
      .filter(Boolean)
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  };
}

// ── matching lists ──────────────────────────────────────────────────

test('listPlans shadow → match when KV and PG agree on every projected field', () => withShadowOn(async (cap) => {
  const kv = [
    { id: 'pl_a', email: 'u@x', label: 'A', inputs: { x: 1 }, snapshot: { t: 1 }, dataSnapshotId: 'ds_1' },
    { id: 'pl_b', email: 'u@x', label: 'B', inputs: { x: 2 }, snapshot: { t: 2 }, dataSnapshotId: 'ds_2' },
  ];
  const pg = [
    { id: 'pl_a', label: 'A', inputs: { x: 1 }, snapshot: { t: 1 }, dataSnapshotId: 'ds_1' },
    { id: 'pl_b', label: 'B', inputs: { x: 2 }, snapshot: { t: 2 }, dataSnapshotId: 'ds_2' },
  ];
  await shadow.shadowCompare({
    name: 'saved-plans.listPlans',
    kvValue: kv,
    pgFetcher: async () => pg,
    projector: projectList,
  });
  const events = eventsFrom(cap.lines);
  const match = events.filter((e) => e.event === 'db_shadow_match');
  assert.equal(match.length, 1, 'exactly one db_shadow_match');
}));

test('listPlans shadow → match when row order differs between KV (newest first) and PG (created_at DESC) but contents align', () => withShadowOn(async (cap) => {
  const kv = [
    { id: 'pl_b', email: 'u@x', label: 'B', inputs: {}, snapshot: null, dataSnapshotId: null },
    { id: 'pl_a', email: 'u@x', label: 'A', inputs: {}, snapshot: null, dataSnapshotId: null },
  ];
  const pg = [
    { id: 'pl_a', label: 'A', inputs: {}, snapshot: null, dataSnapshotId: null },
    { id: 'pl_b', label: 'B', inputs: {}, snapshot: null, dataSnapshotId: null },
  ];
  await shadow.shadowCompare({
    name: 'saved-plans.listPlans',
    kvValue: kv,
    pgFetcher: async () => pg,
    projector: projectList,
  });
  const events = eventsFrom(cap.lines);
  assert.equal(events.filter((e) => e.event === 'db_shadow_match').length, 1);
  assert.equal(events.filter((e) => e.event === 'db_shadow_divergence').length, 0);
}));

// ── single-row divergence ──────────────────────────────────────────

test('listPlans shadow → divergence when one row\'s label differs', () => withShadowOn(async (cap) => {
  const kv = [
    { id: 'pl_a', email: 'u@x', label: 'A-new', inputs: {}, snapshot: null, dataSnapshotId: null },
    { id: 'pl_b', email: 'u@x', label: 'B', inputs: {}, snapshot: null, dataSnapshotId: null },
  ];
  const pg = [
    { id: 'pl_a', label: 'A-stale', inputs: {}, snapshot: null, dataSnapshotId: null },
    { id: 'pl_b', label: 'B', inputs: {}, snapshot: null, dataSnapshotId: null },
  ];
  await shadow.shadowCompare({
    name: 'saved-plans.listPlans',
    kvValue: kv,
    pgFetcher: async () => pg,
    projector: projectList,
  });
  const events = eventsFrom(cap.lines);
  const diverge = events.filter((e) => e.event === 'db_shadow_divergence');
  assert.equal(diverge.length, 1);
  // The `rows` field is the one that differs (the row objects are
  // not equal because pl_a's label differs).
  assert.ok(diverge[0].divergedKeys.includes('rows'));
}));

// ── length mismatch ────────────────────────────────────────────────

test('listPlans shadow → divergence with `length` in divergedKeys when PG missed a dual-write', () => withShadowOn(async (cap) => {
  const kv = [
    { id: 'pl_a', email: 'u@x', label: 'A', inputs: {}, snapshot: null, dataSnapshotId: null },
    { id: 'pl_b', email: 'u@x', label: 'B', inputs: {}, snapshot: null, dataSnapshotId: null },
  ];
  // PG missed pl_b — the dual-write failed for that record at save time.
  const pg = [
    { id: 'pl_a', label: 'A', inputs: {}, snapshot: null, dataSnapshotId: null },
  ];
  await shadow.shadowCompare({
    name: 'saved-plans.listPlans',
    kvValue: kv,
    pgFetcher: async () => pg,
    projector: projectList,
  });
  const events = eventsFrom(cap.lines);
  const diverge = events.filter((e) => e.event === 'db_shadow_divergence');
  assert.equal(diverge.length, 1);
  assert.ok(diverge[0].divergedKeys.includes('length'), 'length must be flagged as a diverged key');
  // Both projections should be in the log so the divergence is
  // reproducible without re-running the query.
  assert.equal(diverge[0].kvProjection.length, 2);
  assert.equal(diverge[0].pgProjection.length, 1);
}));

// ── both-empty + KV-empty + PG-null ────────────────────────────────

test('listPlans shadow → match when both sides return empty lists', () => withShadowOn(async (cap) => {
  await shadow.shadowCompare({
    name: 'saved-plans.listPlans',
    kvValue: [],
    pgFetcher: async () => [],
    projector: projectList,
  });
  const events = eventsFrom(cap.lines);
  assert.equal(events.filter((e) => e.event === 'db_shadow_match').length, 1);
}));

test('listPlans shadow → unavailable when KV has rows but pgFetcher returns null', () => withShadowOn(async (cap) => {
  await shadow.shadowCompare({
    name: 'saved-plans.listPlans',
    kvValue: [
      { id: 'pl_a', email: 'u@x', label: 'A', inputs: {}, snapshot: null, dataSnapshotId: null },
    ],
    pgFetcher: async () => null,
    projector: projectList,
  });
  const events = eventsFrom(cap.lines);
  const unavail = events.filter((e) => e.event === 'db_shadow_unavailable');
  assert.equal(unavail.length, 1);
}));

// ── empty-vs-non-empty is a divergence, not unavailable ──────────
//
// An empty PG list is a real signal — different from "PG returned
// null because the read failed." If KV has rows but PG legitimately
// returned an empty list (e.g. the user's email_hash never landed
// in PG, or every row was archived) the right log is divergence,
// not unavailable.

test('listPlans shadow → divergence (NOT unavailable) when KV has rows but PG returns []', () => withShadowOn(async (cap) => {
  await shadow.shadowCompare({
    name: 'saved-plans.listPlans',
    kvValue: [
      { id: 'pl_a', email: 'u@x', label: 'A', inputs: {}, snapshot: null, dataSnapshotId: null },
    ],
    pgFetcher: async () => [],
    projector: projectList,
  });
  const events = eventsFrom(cap.lines);
  assert.equal(events.filter((e) => e.event === 'db_shadow_divergence').length, 1);
  assert.equal(events.filter((e) => e.event === 'db_shadow_unavailable').length, 0);
}));

// ── source-pin: the in-handler projector matches the one we test against
//
// The projector logic lives inside lib/saved-plans.js as a private
// helper. If a future refactor changes its shape, the matching test
// fixtures above will still pass against the local copy but the
// real comparison in production will silently change. Pin the
// in-handler source so the two stay in lockstep.

const savedPlansSrc = require('node:fs').readFileSync(path.join(ROOT, 'lib', 'saved-plans.js'), 'utf8');

test('lib/saved-plans.js exposes projectPlanListForShadow with the same shape used in this test', () => {
  // The handler-side projector must reference these keys in order
  // for the comparison to be meaningful. We pin the names rather
  // than the implementation so an implementation tweak can land
  // without test churn.
  assert.match(savedPlansSrc, /function projectPlanListForShadow/);
  assert.match(savedPlansSrc, /length:\s*records\.length/);
  assert.match(savedPlansSrc, /localeCompare/);
});

test('lib/saved-plans.js listPlans wires shadowCompare with the new name', () => {
  assert.match(savedPlansSrc, /name:\s*'saved-plans\.listPlans'/);
  assert.match(savedPlansSrc, /fetchPlansFromPgByEmailHash/);
});

test('lib/saved-plans.js fetchPlansFromPgByEmailHash exists + scopes to one user', () => {
  assert.match(savedPlansSrc, /async function fetchPlansFromPgByEmailHash/);
  // The scoping clause is the load-bearing detail — without it the
  // shadow read would compare KV's one-user list against PG's
  // all-users list and divergence would fire constantly.
  assert.match(savedPlansSrc, /WHERE email_hash = \$1/);
});
