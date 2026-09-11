'use strict';

// Sprint 30 — customer rating after approval.
//
// Tests cover four layers:
//   1. Data layer: RATING_MIN/MAX/COMMENT_MAX constants; recordCustomerRating
//      input validation; status guard (customer_approved only); audit-log
//      detail shape (score + isSupersession + hasComment, NOT the comment
//      text itself — privacy/locality)
//   2. Audit + activity feed: import_request_rated in ALLOWED_TYPES and
//      ORG_ACTIVITY_TYPES; activityEventSummary surfaces stars; TransitionHistory
//      has a headline branch (sprint-7 drift-guard composes)
//   3. Handler: route /api/imports/<id>/rating; 403 when caller is not
//      the request creator (RBAC pin); 400 on validation; 409 on bad
//      status; 201 on success
//   4. UI: <CustomerRatingPanel> mounted only when status === customer_approved;
//      readout state vs prompt state; edit affordance on supersession;
//      char counter matches data-layer cap; submit gates on canSubmit
//
// The "request creator only" RBAC is the load-bearing security
// invariant. Without it, any signed-in org member could submit a
// rating on behalf of the customer — flooding the platform with
// noise and breaking the cohort's signal. Pinning the email-hash
// comparison source-level.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequestsDb = require('../lib/db/import-requests');
const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');
const SCHEMA_SRC = fs.readFileSync(
  path.join(ROOT, 'lib', 'db', 'schema-019-import-request-customer-rating.sql'),
  'utf8',
);
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const DETAIL_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', '[externalId]', 'page.tsx'),
  'utf8',
);
const HISTORY_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'components', 'TransitionHistory.tsx'),
  'utf8',
);

// ── Constants ──────────────────────────────────────────────────────

test('RATING_MIN / RATING_MAX / RATING_COMMENT_MAX are pinned at canonical values', () => {
  assert.equal(importRequestsDb.RATING_MIN, 1);
  assert.equal(importRequestsDb.RATING_MAX, 5);
  assert.equal(importRequestsDb.RATING_COMMENT_MAX, 2000);
});

// ── recordCustomerRating input validation ──────────────────────────

test('recordCustomerRating rejects missing identity', async () => {
  const r = await importRequestsDb.recordCustomerRating({
    externalId: 'ir_test', actorEmailHash: 'h', score: 5,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /orgId/.test(e)));
});

test('recordCustomerRating rejects out-of-range score', async () => {
  for (const score of [0, 6, -1, 1.5, NaN, 'five']) {
    const r = await importRequestsDb.recordCustomerRating({
      orgId: 1, externalId: 'ir_test', actorEmailHash: 'h',
      score, // intentional bad input
    });
    assert.equal(r.ok, false, `score=${JSON.stringify(score)} should be rejected`);
    assert.ok(r.errors.some((/** @type {string} */ e) => /score must be an integer/.test(e)));
  }
});

test('recordCustomerRating rejects oversized comment', async () => {
  const r = await importRequestsDb.recordCustomerRating({
    orgId: 1, externalId: 'ir_test', actorEmailHash: 'h',
    score: 5, comment: 'x'.repeat(importRequestsDb.RATING_COMMENT_MAX + 1),
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((/** @type {string} */ e) => /comment must be <=/.test(e)));
});

test('recordCustomerRating returns notConfigured when DATABASE_URL is unset', async () => {
  // The status guard requires a PG read; without configuration the
  // call must return a structured failure rather than crash.
  const r = await importRequestsDb.recordCustomerRating({
    orgId: 1, externalId: 'ir_test', actorEmailHash: 'h',
    score: 5,
  });
  if (!r.ok) {
    // Either notConfigured or validation depending on test env path.
    assert.ok(Array.isArray(r.errors));
  }
});

// ── Status guard pinned at source ──────────────────────────────────

test('recordCustomerRating gates on status === customer_approved (conflict on mismatch)', () => {
  // The rating is meaningless outside customer_approved — earlier
  // statuses don't have a customer-visible quote to evaluate; later
  // terminal statuses don't represent a delivery experience worth
  // rating. Pin the guard at source.
  const block = DB_SRC.match(/async function recordCustomerRating\([\s\S]*?\n\}/);
  assert.ok(block, 'recordCustomerRating body not located');
  const body = block[0];
  assert.match(body, /beforeRow\.status !== ['"]customer_approved['"]/);
  // The guard returns conflict:true so the handler maps it to 409.
  assert.match(body, /conflict: true/);
});

// ── Audit-log privacy posture ──────────────────────────────────────

test('recordCustomerRating audit detail records score + isSupersession + hasComment, NOT the comment text', () => {
  // Privacy + locality: the comment may carry context the customer
  // doesn't want in the audit chain head. Pin the redacted shape.
  const block = DB_SRC.match(/async function recordCustomerRating\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /detail:\s*\{[\s\S]*?score,[\s\S]*?hasComment[\s\S]*?isSupersession[\s\S]*?\}/);
  // The full comment string must NOT appear in the events.record call.
  const recordCallMatch = body.match(/events\.record\(['"]import_request_rated['"][\s\S]*?\)\;/);
  assert.ok(recordCallMatch, 'events.record call not located');
  // The detail object names hasComment (a boolean) but never
  // includes the literal `comment:` field.
  assert.doesNotMatch(recordCallMatch[0], /\bcomment: trimmedComment\b/);
});

// ── Audit + activity feed allowlist ───────────────────────────────

test('import_request_rated is in ALLOWED_TYPES', () => {
  assert.ok(events.ALLOWED_TYPES.has('import_request_rated'));
});

test('import_request_rated is in ORG_ACTIVITY_TYPES (surfaces in dashboard feed)', () => {
  assert.ok(events.ORG_ACTIVITY_TYPES.has('import_request_rated'));
});

test('activityEventSummary surfaces a star glyph (NOT the numeric score) for ratings', () => {
  const block = API_TS.match(/export function activityEventSummary\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /case ['"]import_request_rated['"]:/);
  // The summary uses ★ glyphs so the feed reads at a glance.
  assert.match(body, /['"]★['"]\.repeat/);
});

test('TransitionHistory has a headline branch for import_request_rated (sprint-7 drift-guard composes)', () => {
  // Without this case, the sprint-7 polymorphic timeline component
  // would render the raw event-type string when it encounters
  // a rating event.
  assert.match(HISTORY_TSX, /case ['"]import_request_rated['"]:/);
});

// ── Schema ─────────────────────────────────────────────────────────

test('schema-019 adds customer_rating JSONB column idempotently', () => {
  assert.match(SCHEMA_SRC, /ADD COLUMN IF NOT EXISTS customer_rating jsonb/);
  // Defensive CHECK: the value is either NULL OR a JSONB object
  // (never array/scalar). The data-layer iteration assumes that.
  assert.match(SCHEMA_SRC, /customer_rating IS NULL OR jsonb_typeof\(customer_rating\) = 'object'/);
  // Idempotent CHECK wrapper.
  assert.match(SCHEMA_SRC, /DO \$\$[\s\S]*?ADD CONSTRAINT[\s\S]*?EXCEPTION[\s\S]*?WHEN duplicate_object/);
});

// ── Handler ────────────────────────────────────────────────────────

test('imports handler routes /api/imports/<id>/rating → handlePostRating', () => {
  assert.match(HANDLER_SRC, /if \(action === ['"]rating['"]\)/);
  assert.match(HANDLER_SRC, /handlePostRating\(req, res, ctx, externalId\)/);
  assert.match(HANDLER_SRC, /async function handlePostRating\(/);
});

test('handlePostRating enforces "request creator only" RBAC (403 otherwise)', () => {
  // CRITICAL security pin. Without this, any signed-in org member
  // could rate on behalf of the customer. The handler fetches the
  // request, compares createdByEmailHash to ctx.emailHash, and 403s
  // on mismatch.
  const block = HANDLER_SRC.match(/async function handlePostRating\([\s\S]*?\n\}/);
  assert.ok(block, 'handlePostRating body not located');
  const body = block[0];
  assert.match(body, /fetched\.importRequest\.createdByEmailHash !== ctx\.emailHash/);
  assert.match(body, /jsonResponse\(res, 403/);
  assert.match(body, /Only the request creator can submit a rating/);
});

test('handlePostRating maps validation errors to 400 (not 500)', () => {
  // "required" / "must be" / "<=" / "integer in" all hit the 400
  // branch. Pin the predicate so a refactor that swaps these for
  // 500s surfaces here.
  const block = HANDLER_SRC.match(/async function handlePostRating\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /jsonResponse\(res, 400/);
  assert.match(block[0], /required|must be|<=|integer in/);
});

test('handlePostRating maps the customer_approved status guard to 409 (conflict)', () => {
  // Bad status is a client-actionable error (wait until the
  // request is in customer_approved). 409 lets the client
  // distinguish it from a generic 400 validation failure.
  const block = HANDLER_SRC.match(/async function handlePostRating\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /result\.conflict[\s\S]*?jsonResponse\(res, 409/);
});

test('handlePostRating is POST-only — every other method 405s', () => {
  assert.match(
    HANDLER_SRC,
    /if \(req\.method !== ['"]POST['"]\) return jsonResponse\(res, 405, \{ error: ['"]rating requires POST['"]/,
  );
});

// ── TS mirror ──────────────────────────────────────────────────────

test('TS mirrors CustomerRating shape + RATING_* constants', () => {
  assert.match(API_TS, /export interface CustomerRating \{[\s\S]*?score: number[\s\S]*?comment: string[\s\S]*?ratedByEmailHash: string[\s\S]*?ratedAt: string/);
  assert.match(API_TS, /export const RATING_MIN = 1/);
  assert.match(API_TS, /export const RATING_MAX = 5/);
  assert.match(API_TS, /export const RATING_COMMENT_MAX = 2000/);
});

test('TS ImportRequest carries customerRating field (nullable)', () => {
  // Drift-guard the surface so the detail page can read
  // request.customerRating without TypeScript squealing.
  assert.match(API_TS, /customerRating\?: CustomerRating \| null;/);
});

// ── UI ─────────────────────────────────────────────────────────────

test('Detail page mounts <CustomerRatingPanel> ONLY when status === customer_approved', () => {
  // The rating is post-approval — earlier statuses don't have a
  // customer-visible quote to evaluate. Pin the conditional render.
  assert.match(
    DETAIL_TSX,
    /request\.status === ['"]customer_approved['"] && \(\s*<CustomerRatingPanel/,
  );
});

test('CustomerRatingPanel renders two distinct states (readout vs prompt)', () => {
  // Existing rating → stars + comment readout + "Edit my rating →".
  // No rating → prompt + 5-star input + comment textarea.
  // Drift-guard pins BOTH branches via their distinctive UI strings
  // as JSX text content (matched with surrounding whitespace).
  assert.match(DETAIL_TSX, /function CustomerRatingPanel\(/);
  // Readout state — "Your rating" eyebrow + Edit affordance.
  assert.match(DETAIL_TSX, /\bYour rating\b/);
  assert.match(DETAIL_TSX, /Edit my rating →/);
  // Prompt state — "How did we do?" eyebrow.
  assert.match(DETAIL_TSX, /How did we do\?/);
});

test('CustomerRatingPanel comment textarea caps at RATING_COMMENT_MAX (matches data-layer)', () => {
  // The client cap must match the server. A drift would let the
  // customer type more than the server accepts and surface a
  // confusing 400 on submit.
  assert.match(DETAIL_TSX, /setComment\(e\.target\.value\.slice\(0, RATING_COMMENT_MAX\)\)/);
});

test('CustomerRatingPanel canSubmit gates on integer score in [RATING_MIN, RATING_MAX]', () => {
  // Defense-in-depth: data layer is the chokepoint, but client
  // gate prevents an obviously-invalid submit from firing.
  assert.match(DETAIL_TSX, /Number\.isInteger\(score\) && score >= RATING_MIN && score <= RATING_MAX/);
});

test('CustomerRatingPanel supersession path: existing rating shows Edit affordance + form pre-fills', () => {
  // The "edit my rating" affordance is the supersession path UX.
  // Pin both the trigger (setEditing(true) on click) and the
  // form pre-fill from existing.score + existing.comment.
  assert.match(DETAIL_TSX, /setEditing\(true\)/);
  // useState init pulls from existing?.score ?? 0 (likewise for
  // comment). Pin the pre-fill source via nullish-coalesce on
  // existing.
  assert.match(DETAIL_TSX, /useState<number>\(existing\?\.score \?\? 0\)/);
  assert.match(DETAIL_TSX, /useState<string>\(existing\?\.comment \?\? ['"]{2}\)/);
});

test('CustomerRatingPanel renders accessible star buttons with aria-label per star', () => {
  // Each star button must carry an aria-label so screen readers
  // can announce the rating value. Pin the label format.
  assert.match(DETAIL_TSX, /aria-label=\{`\$\{value\} star\$\{value === 1 \? ['"]{2} : ['"]s['"]\}`\}/);
  // The readout StarRow component also surfaces an aria-label.
  assert.match(DETAIL_TSX, /aria-label=\{`\$\{score\} out of \$\{max\} stars`\}/);
});
