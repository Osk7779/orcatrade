'use strict';

// Sprint 28 — supplier-pick learning loop.
//
// Tests cover five layers:
//   1. Data-layer: recordSupplierPick input validation; PICK_RATIONALE
//      enum + cap; hsPrefix6 derivation; audit event allowlisted
//   2. Aggregation: aggregateSupplierPicks shape + JSONB read path;
//      window clamping; per-country accumulation rule
//   3. Schema-018: column + partial index that powers the aggregate
//   4. Orchestrator: buildFactoryShortlist accepts pastPicksByCountry
//      + surfaces pastPickSignal on each entry; orchestrator pulls
//      from aggregateSupplierPicks before building the shortlist;
//      recordSupplierPick fires on materialise (fail-soft)
//   5. UI: PastPickBadge renders only when signal.count > 0; surfaces
//      count + 90d window; tooltip names the dominant rationale
//
// The "this is a signal, NOT a re-ranking input" promise is the
// most important property to preserve. A regression that
// silently re-ordered the shortlist based on past picks would
// shake customer trust in the calculator-grounded ranking. Drift-
// guard pins the comment + the absence of any sort/rank logic on
// pastPicksByCountry in buildFactoryShortlist.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequestsDb = require('../lib/db/import-requests');
const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const ORCH_SRC = fs.readFileSync(
  path.join(ROOT, 'lib', 'ai', 'import-request-orchestrator.js'),
  'utf8',
);
const SCHEMA_SRC = fs.readFileSync(
  path.join(ROOT, 'lib', 'db', 'schema-018-import-request-supplier-pick.sql'),
  'utf8',
);
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const DETAIL_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', '[externalId]', 'page.tsx'),
  'utf8',
);

// ── PICK_RATIONALE_CATEGORIES enum ─────────────────────────────────

test('PICK_RATIONALE_CATEGORIES is frozen and covers the v1 6-bucket taxonomy', () => {
  assert.ok(Object.isFrozen(importRequestsDb.PICK_RATIONALE_CATEGORIES));
  assert.deepEqual(
    [...importRequestsDb.PICK_RATIONALE_CATEGORIES],
    ['cost', 'lead_time', 'compliance', 'past_relationship', 'capacity', 'other'],
  );
});

test('PICK_RATIONALE_MAX caps the free-text rationale at 500 chars', () => {
  assert.equal(importRequestsDb.PICK_RATIONALE_MAX, 500);
});

// ── recordSupplierPick input validation ────────────────────────────

test('recordSupplierPick rejects missing identity', async () => {
  const r = await importRequestsDb.recordSupplierPick({
    externalId: 'ir_test', actorEmailHash: 'h',
    country: 'CN', rationaleCategory: 'cost',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /orgId/.test(e)));
});

test('recordSupplierPick rejects a non-ISO-2 country', async () => {
  const r = await importRequestsDb.recordSupplierPick({
    orgId: 1, externalId: 'ir_test', actorEmailHash: 'h',
    country: 'China', rationaleCategory: 'cost',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /country required \(ISO-2\)/.test(e)));
});

test('recordSupplierPick rejects unknown rationaleCategory', async () => {
  const r = await importRequestsDb.recordSupplierPick({
    orgId: 1, externalId: 'ir_test', actorEmailHash: 'h',
    country: 'CN', rationaleCategory: 'spite',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /rationaleCategory must be one of/.test(e)));
});

test('recordSupplierPick rejects oversized rationale', async () => {
  const r = await importRequestsDb.recordSupplierPick({
    orgId: 1, externalId: 'ir_test', actorEmailHash: 'h',
    country: 'CN', rationaleCategory: 'cost',
    rationale: 'x'.repeat(importRequestsDb.PICK_RATIONALE_MAX + 1),
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /rationale must be <=/.test(e)));
});

test('recordSupplierPick derives hsPrefix6 from a longer HS code', () => {
  // The 6-digit prefix is what the aggregate index keys on. A
  // refactor that passes the full HS code unchanged would tank
  // index utility on requests with 8 or 10-digit codes.
  const block = DB_SRC.match(/async function recordSupplierPick\([\s\S]*?\n\}/);
  assert.ok(block, 'recordSupplierPick body not located');
  assert.match(block[0], /hsCode\.slice\(0, 6\)/);
});

// ── Audit + activity feed allowlist ────────────────────────────────

test('import_request_supplier_picked is in ALLOWED_TYPES', () => {
  assert.ok(events.ALLOWED_TYPES.has('import_request_supplier_picked'));
});

test('import_request_supplier_picked is in ORG_ACTIVITY_TYPES (surfaces on dashboard feed)', () => {
  assert.ok(events.ORG_ACTIVITY_TYPES.has('import_request_supplier_picked'));
});

test('recordSupplierPick audit detail records country + hsPrefix6 + rationaleCategory, NOT the rationale text', () => {
  // Free-text rationale could carry customer-sensitive context
  // (supplier names, negotiation details) — keep it on the row, not
  // in the audit chain head. Pin the redacted detail shape.
  const block = DB_SRC.match(/async function recordSupplierPick\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /detail:\s*\{[\s\S]*?country: pick\.country[\s\S]*?hsPrefix6[\s\S]*?rationaleCategory[\s\S]*?\}/);
  // The free-text rationale must NOT appear in the events.record call.
  // It's already on the row.
  const recordCallMatch = body.match(/events\.record\(['"]import_request_supplier_picked['"][\s\S]*?\)/);
  assert.ok(recordCallMatch);
  assert.doesNotMatch(recordCallMatch[0], /rationale:/);
});

// ── aggregateSupplierPicks ─────────────────────────────────────────

test('aggregateSupplierPicks is exported + accepts hsPrefix6 + windowDays', async () => {
  assert.equal(typeof importRequestsDb.aggregateSupplierPicks, 'function');
  const r = await importRequestsDb.aggregateSupplierPicks({
    orgId: 1, hsPrefix6: '853941', windowDays: 90,
  });
  assert.ok('ok' in r); // not-configured branch in test env, but signature accepted
});

test('aggregateSupplierPicks clamps windowDays to [1, 365]', () => {
  // Anything shorter is noisy; anything longer is stale picks
  // shaping the next quote. Pin the clamp at the source.
  const block = DB_SRC.match(/async function aggregateSupplierPicks\([\s\S]*?\n\}/);
  assert.ok(block, 'aggregateSupplierPicks body not located');
  assert.match(block[0], /Math\.max\(1,\s*Math\.min\(365,/);
});

test('aggregateSupplierPicks queries on supplier_pick->>pickedAt for recency (NOT created_at)', () => {
  // Pick recency is what matters — a request created long ago but
  // materialised recently still counts. Pin the JSONB recency
  // dimension so a refactor that switches back to created_at can't
  // silently make stale picks shape next quote's shortlist.
  const block = DB_SRC.match(/async function aggregateSupplierPicks\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /supplier_pick->>'pickedAt'/);
});

test('aggregateSupplierPicks accumulates per-country count + lastPickedAt + rationaleCategoryMix', () => {
  // The aggregate shape powers the UI badge — both the count chip
  // and the tooltip's "mostly cost" dimension. Pin the three fields.
  const block = DB_SRC.match(/async function aggregateSupplierPicks\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /count:/);
  assert.match(body, /lastPickedAt:/);
  assert.match(body, /rationaleCategoryMix:/);
});

// ── Schema-018 ─────────────────────────────────────────────────────

test('schema-018 adds the supplier_pick column + partial covering index', () => {
  assert.match(SCHEMA_SRC, /ADD COLUMN IF NOT EXISTS supplier_pick jsonb/);
  // Covering index (org_id, hsPrefix6) partial WHERE supplier_pick
  // IS NOT NULL keeps the index compact + the aggregate query fast.
  assert.match(SCHEMA_SRC, /CREATE INDEX IF NOT EXISTS import_requests_supplier_pick_lookup_idx/);
  assert.match(SCHEMA_SRC, /supplier_pick->>'hsPrefix6'/);
  assert.match(SCHEMA_SRC, /WHERE supplier_pick IS NOT NULL/);
});

// ── Orchestrator integration ──────────────────────────────────────

test('buildFactoryShortlist accepts pastPicksByCountry as an explicit param (NOT mutated state)', () => {
  // Pure function discipline — a refactor that read picks from
  // module-level state would make the function untestable. Pin the
  // signature including the new param.
  assert.match(ORCH_SRC, /function buildFactoryShortlist\(\{ recommendation, productCategory, classifierHits, classifierSource, pastPicksByCountry \}\)/);
});

test('buildFactoryShortlist surfaces pastPickSignal on each entry (NOT used for re-ranking)', () => {
  // Drift-guard the load-bearing promise: signal, not re-ranking.
  // The shortlist iteration must NOT sort by pastPicksByCountry —
  // pin the absence of any sort/rank logic referencing picks.
  const block = ORCH_SRC.match(/function buildFactoryShortlist\([\s\S]*?return \{\s*shortlist,/);
  assert.ok(block, 'buildFactoryShortlist body not located');
  const body = block[0];
  // The output carries pastPickSignal per entry.
  assert.match(body, /pastPickSignal:/);
  // BUT the iteration itself must NOT sort by picks — pin the
  // existing topCountries.slice(0, 3).map shape (no .sort that
  // would re-rank).
  assert.doesNotMatch(body, /\.sort\(\([\s\S]*?pastPicks/);
});

test('orchestrator fetches pastPicksByCountry BEFORE buildFactoryShortlist (fail-soft)', () => {
  // The aggregation runs in a try/catch and the shortlist build
  // works without it. Pin both the fetch ordering and the try/catch
  // so a refactor doesn't silently make the orchestrator hard-fail
  // on a missing aggregate (which would block customer quotes).
  assert.match(ORCH_SRC, /aggregateSupplierPicks[\s\S]*?buildFactoryShortlist\(\{/);
  // The try/catch envelope around the aggregate call.
  assert.match(
    ORCH_SRC,
    /try \{[\s\S]*?aggregateSupplierPicks[\s\S]*?\}\s*catch \(err\) \{[\s\S]*?log\.warn\(/,
  );
});

test('materialiseApprovedRequest records the supplier pick AFTER successful link (fail-soft)', () => {
  // The pick is feedback for FUTURE quotes; a one-row miss is
  // acceptable. But the pick fire MUST come after the link succeeds —
  // recording for a failed materialisation would pollute the
  // aggregation with picks that never actually happened.
  //
  // The function body is long; rather than scope-match the whole
  // body (regex backtracking gets messy), pin the structural
  // properties at the source level:
  //   1. The link-success path exists at the end with `linkResult`
  //   2. recordSupplierPick is called from inside materialise (the
  //      only place in the orchestrator that calls it)
  //   3. recordSupplierPick is wrapped in try/catch (fail-soft)
  //   4. The catch logs via log.warn (NOT thrown)
  assert.match(ORCH_SRC, /linkResult\.importRequest/);
  // Pin the recordSupplierPick call inside the orchestrator (only
  // one place calls it).
  const recordCalls = (ORCH_SRC.match(/recordSupplierPick\(/g) || []).length;
  assert.ok(recordCalls >= 1, 'orchestrator must call recordSupplierPick');
  // Pin the try/catch envelope around it.
  assert.match(
    ORCH_SRC,
    /try \{[\s\S]*?recordSupplierPick\([\s\S]*?\}\s*catch \(err\) \{[\s\S]*?log\.warn\(/,
  );
});

// ── TS mirror + UI ────────────────────────────────────────────────

test('TS FactoryShortlistBlock carries pastPickSignal with count + lastPickedAt + rationaleCategoryMix', () => {
  const block = API_TS.match(/export interface FactoryShortlistBlock \{[\s\S]*?\n\}/);
  assert.ok(block, 'FactoryShortlistBlock interface not located');
  const body = block[0];
  assert.match(body, /pastPickSignal\?:/);
  assert.match(body, /count: number/);
  assert.match(body, /lastPickedAt: string/);
  assert.match(body, /rationaleCategoryMix: Record<string, number>/);
});

test('ShortlistPanel renders PastPickBadge only when count > 0', () => {
  // No badge on countries the org has never picked — those entries
  // are about to BE the first pick. Pin the count guard.
  assert.match(DETAIL_TSX, /b\.pastPickSignal && b\.pastPickSignal\.count > 0 && \(\s*<PastPickBadge/);
});

test('PastPickBadge surfaces the 90-day window in the label copy', () => {
  // The window length is part of the platform's learning-loop story.
  // Hardcoded "90d" in the copy means a future windowDays change
  // would surface here as a needed UI update.
  assert.match(DETAIL_TSX, /Picked \{signal\.count\}× in 90d/);
});

test('PastPickBadge tooltip names the dominant rationale category', () => {
  // The tooltip turns the badge from "you picked this 4 times" into
  // "you picked this 4 times mostly because of compliance fit" —
  // the actionable signal that justifies surfacing past picks at
  // all. Pin the topCategory derivation logic.
  assert.match(DETAIL_TSX, /let topCategory: string \| null = null;/);
  assert.match(DETAIL_TSX, /Mostly \$\{PAST_PICK_RATIONALE_LABELS\[topCategory\] \|\| topCategory\}/);
});

test('PAST_PICK_RATIONALE_LABELS covers every PICK_RATIONALE_CATEGORIES key', () => {
  // A future enum addition that lands without a UI label would
  // render the raw enum string in the tooltip ("past_relationship"
  // instead of "past relationship"). Cross-check every key.
  const block = DETAIL_TSX.match(/const PAST_PICK_RATIONALE_LABELS: Record<string, string> = \{([\s\S]*?)\};/);
  assert.ok(block);
  const body = block[1];
  for (const k of importRequestsDb.PICK_RATIONALE_CATEGORIES) {
    assert.match(body, new RegExp(`\\b${k}:`), `PAST_PICK_RATIONALE_LABELS missing key: ${k}`);
  }
});
