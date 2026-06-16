'use strict';

// Sprint 23 — Ops Insights → cohort drill-down.
//
// Tests cover four layers:
//   1. Data layer — listImportRequestsForOrg accepts + validates the
//      new declineReason filter; the JSONB ->> query shape is pinned
//      so a refactor that breaks the cohort lookup surfaces here
//   2. Handler — handleList passes the query param through; rejects
//      unknown reasons with 400
//   3. Insights UI — DeclineRow becomes a Link to the cohort when
//      the count is > 0; empty rows stay non-clickable (no cohort)
//   4. /imports list page — recognises ?declineReason, drops mine=1
//      for the cohort view, renders cohort banner, preserves cohort
//      across status-chip clicks, distinct empty-state copy
//
// Drilling INTO a cohort and then OUT (via filter changes or status
// chip) is the load-bearing UX. A regression that loses the cohort
// identity on chip click would force ops to start from /insights
// every time — destroying the productivity win.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequestsDb = require('../lib/db/import-requests');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);
const LIST_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'page.tsx'),
  'utf8',
);

// ── Data layer: declineReason filter ────────────────────────────────

test('listImportRequestsForOrg accepts declineReason filter', async () => {
  // Not-configured branch in the test env — just confirm the call
  // doesn't throw and accepts the new param without a TypeError.
  const r = await importRequestsDb.listImportRequestsForOrg({
    orgId: 1, declineReason: 'price_target_unrealistic',
  });
  assert.ok('ok' in r);
});

test('listImportRequestsForOrg rejects an unknown declineReason at the data layer', async () => {
  // A forged query param can't hit the JSONB lookup with arbitrary
  // text. Pin the enum gate at the data layer (the same defense
  // sprint 16's attachTeamReview added for the write path).
  const r = await importRequestsDb.listImportRequestsForOrg({
    orgId: 1, declineReason: 'made_up_reason_that_isnt_in_the_enum',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /declineReason must be/.test(e)));
});

test('listImportRequestsForOrg ignores empty-string declineReason (no false 400)', async () => {
  // The handler default for a missing query-param is the empty
  // string. The data layer must treat that as "no filter" rather
  // than reject it as an invalid reason.
  const r = await importRequestsDb.listImportRequestsForOrg({
    orgId: 1, declineReason: '',
  });
  // Either succeeds (real PG) or fails with notConfigured (test env).
  // Either way, the validation must NOT fire.
  if (!r.ok) {
    assert.doesNotMatch(r.errors[0] || '', /declineReason must be/);
  }
});

test('listImportRequestsForOrg WHERE clause uses JSONB ->> on team_review_state', () => {
  // Pin the JSONB-text lookup shape: a refactor that swaps to ->
  // (JSONB) or a different column would silently return 0 rows
  // (or hit a runtime error). Sprint 16 stored the reason at
  // team_review_state.declineReason; pin the lookup path.
  const block = DB_SRC.match(/async function listImportRequestsForOrg\([\s\S]*?\n\}/);
  assert.ok(block, 'listImportRequestsForOrg body not located');
  assert.match(block[0], /team_review_state->>'declineReason' = \$\$\{params\.length\}/);
});

// ── Handler ────────────────────────────────────────────────────────

test('handleList passes the declineReason query param through to the data layer', () => {
  const block = HANDLER_SRC.match(/async function handleList\([\s\S]*?\n\}/);
  assert.ok(block, 'handleList body not located');
  assert.match(block[0], /declineReason: q\.declineReason \? String\(q\.declineReason\) : undefined/);
});

test('handleList returns 400 (not 500) on an unknown declineReason', () => {
  // The data layer returns a structured "declineReason must be"
  // error; the handler must surface it as a 400 (client error)
  // rather than fall through to the 500 catchall.
  const block = HANDLER_SRC.match(/async function handleList\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /declineReason must be/);
  // And the surrounding response shape is 400.
  assert.match(block[0], /jsonResponse\(res, 400/);
});

// ── /imports/insights UI: bars become clickable ────────────────────

test('DeclineRow becomes a <Link> to /imports?status=cancelled&declineReason=<reason> when count > 0', () => {
  // The whole point of the drill-down is the click. Pin both:
  // (a) the Link wrapper exists only for present rows
  // (b) the href shape is exactly what /imports reads
  assert.match(INSIGHTS_TSX, /tone === ['"]empty['"]/);
  assert.match(
    INSIGHTS_TSX,
    /href=\{`\/imports\?status=cancelled&declineReason=\$\{encodeURIComponent\(reason\)\}`\}/,
  );
});

test('DeclineRow empty-state stays a plain div (no cohort to drill into)', () => {
  // Empty rows exist to teach the closed taxonomy. They have no
  // cohort to drill into; clicking them would lead to an empty
  // cohort view which is worse than no click at all. Pin the
  // empty branch returning a div not a Link. Pin the literal
  // statement rather than a wider block (the function body has
  // multiple nested } that break naive function-close matching).
  assert.match(
    INSIGHTS_TSX,
    /if \(tone === ['"]empty['"]\) \{\s*return <div className="space-y-1\.5 opacity-50">\{body\}<\/div>;\s*\}/,
  );
});

test('DeclineRow Link carries a descriptive title for accessibility', () => {
  // A pixel-precision bar without context is unfriendly to screen
  // readers + keyboard users. Pin the title attribute that
  // describes what the click drills into.
  assert.match(INSIGHTS_TSX, /title=\{`Drill into the \$\{n\} request/);
});

// ── /imports list page: cohort drill-down view ─────────────────────

test('/imports list page reads + validates ?declineReason against DECLINE_REASONS', () => {
  // A forged URL must not blow up the page or pass arbitrary text
  // to the server. Pin both the read AND the enum validation.
  assert.match(LIST_TSX, /sp\.get\(['"]declineReason['"]\)/);
  assert.match(
    LIST_TSX,
    /\(DECLINE_REASONS as ReadonlyArray<string>\)\.includes\(declineReasonRaw\)/,
  );
});

test('/imports list page DROPS mine=1 when in cohort mode (ops sees org-wide)', () => {
  // The customer-facing /imports is scoped to mine=1. The cohort
  // drill-down (reachable only from /insights, ops-only) shows
  // EVERY request in the org with the reason. Pin the
  // conditional so a refactor that always sets mine=1 surfaces
  // here.
  assert.match(LIST_TSX, /if \(!cohortReason\) params\.set\(['"]mine['"], ['"]1['"]\)/);
});

test('/imports list page renders the cohort header with a "Back to insights" link', () => {
  // The header tells ops what cohort they're in + offers an
  // escape hatch back to /insights. Pin both.
  assert.match(LIST_TSX, /cohortReason && \(/);
  assert.match(LIST_TSX, /DECLINE_REASON_LABELS\[cohortReason\]/);
  assert.match(LIST_TSX, /Back to insights/);
  assert.match(LIST_TSX, /href="\/imports\/insights"/);
});

test('/imports cohort header points ops at /imports/queue for bulk action', () => {
  // The cohort is a list of declined requests. If ops decides
  // any of them deserve a second look, they bulk-action from
  // the queue. Pin the cross-link so the productivity loop is
  // discoverable from the cohort view.
  assert.match(LIST_TSX, /href="\/imports\/queue"/);
});

test('/imports status chips PRESERVE the cohort across navigations', () => {
  // Clicking "Cancelled" inside a cohort drill should NOT drop
  // the cohort identity. A refactor that hardcoded /imports?status=X
  // would break the productivity flow. Pin the conditional
  // append of declineReason to the chip's onClick URL.
  assert.match(LIST_TSX, /if \(cohortReason\) params\.set\(['"]declineReason['"], cohortReason\);/);
});

test('/imports empty state diverges in cohort mode (no "submit a new request" prompt)', () => {
  // The default empty-state CTA is "submit a new request". That's
  // wrong for an ops drilling into an empty cohort (they're not
  // looking to create a new request; they want to know if the
  // cohort is empty). Pin the cohort-specific copy.
  assert.match(LIST_TSX, /No requests in this cohort\./);
  assert.match(LIST_TSX, /that's actually good news/);
});

test('/imports cohort mode useEffect re-fires when cohortReason changes', () => {
  // The useEffect dep array must include cohortReason — otherwise
  // navigating between cohorts (e.g. "Price target unrealistic" →
  // "Compliance blocker") wouldn't refetch.
  assert.match(LIST_TSX, /\[filterStatus, cohortReason\]/);
});
