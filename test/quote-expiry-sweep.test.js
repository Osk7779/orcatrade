'use strict';

// Sprint 19 — quote-expiry sweep.
//
// Tests cover four layers:
//   1. Data-layer expireStaleQuotes (input validation, not-configured branch)
//   2. Cron handler integration (JOBS map + GHA workflow schedule)
//   3. UI countdown badge (4 tones: distant, near, imminent, expired)
//   4. Schema partial index hits the sweep's WHERE clause
//
// The quote-expiry path is correctness debt that's been sitting since
// sprint 1 — schema-012 declared the 'expired' status but no
// automation drove the transition. A regression here that quietly
// breaks the cron would be invisible until someone notices stale
// "quoted" requests piling up in the funnel.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequestsDb = require('../lib/db/import-requests');
const cron = require('../lib/handlers/cron');
const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_012 = fs.readFileSync(
  path.join(ROOT, 'lib', 'db', 'schema-012-import-requests.sql'),
  'utf8',
);
const CRON_YAML = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'cron.yml'),
  'utf8',
);
const DETAIL_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', '[externalId]', 'page.tsx'),
  'utf8',
);

// ── Data layer ──────────────────────────────────────────────────────

test('expireStaleQuotes is exported from lib/db/import-requests.js', () => {
  assert.equal(typeof importRequestsDb.expireStaleQuotes, 'function');
});

test('expireStaleQuotes returns not-configured when DATABASE_URL is unset', async () => {
  // Defensive: the test env runs without Postgres. The function must
  // report structured 503-shape errors rather than crash so the cron
  // dispatcher surfaces "PG not configured" cleanly in the dashboard.
  const r = await importRequestsDb.expireStaleQuotes();
  if (r.ok) {
    assert.ok(typeof r.expiredCount === 'number');
  } else {
    assert.ok(Array.isArray(r.errors));
  }
});

test('expireStaleQuotes accepts an optional orgId scope', async () => {
  // Same notConfigured branch, but with orgId — the scoped path is
  // used by admin tooling + tests. Pin that the call signature
  // accepts it without throwing.
  const r = await importRequestsDb.expireStaleQuotes({ orgId: 1, limit: 50 });
  assert.ok('ok' in r);
});

test('expireStaleQuotes clamps limit to [1, 1000]', () => {
  // Source-pin the clamp so a refactor that drops it can't
  // accidentally let a 100k-row sweep run in one batch (memory
  // spike + multi-minute cron timeout).
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
  const block = src.match(/async function expireStaleQuotes\([\s\S]*?\n\}/);
  assert.ok(block, 'expireStaleQuotes body not located');
  assert.match(block[0], /Math\.max\(1,\s*Math\.min\(1000,/);
});

test('expireStaleQuotes posts a system message on every transition', () => {
  // The system message is the customer-facing record of the auto-
  // expiry. Without it, a customer revisiting their request would
  // see the status flip with no explanation.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
  const block = src.match(/async function expireStaleQuotes\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /role:\s*['"]system['"]/);
  assert.match(block[0], /Quote expired automatically/);
});

test('expireStaleQuotes fires BOTH the status-transition audit event AND the message-posted event', () => {
  // ADR 0005 — every mutation gets audit-logged. The expiry touches
  // TWO mutations (status flip + thread append) so it needs TWO
  // events. Pin both calls.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
  const block = src.match(/async function expireStaleQuotes\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /events\.record\(['"]import_request_status_transition['"]/);
  assert.match(block[0], /events\.record\(['"]import_request_message_posted['"]/);
});

test('expireStaleQuotes uses subtype="auto_expired" so the timeline reads as a story', () => {
  // The TransitionHistory polymorphic component (sprint 7) surfaces
  // subtype-aware headlines. Pin "auto_expired" so a future timeline
  // copy update has a single source of truth.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
  const block = src.match(/async function expireStaleQuotes\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /subtype:\s*['"]auto_expired['"]/);
});

// ── Atomic transition gate ──────────────────────────────────────────

test('expireStaleQuotes UPDATE re-asserts status="quoted" in the WHERE (concurrent-safe)', () => {
  // Two parallel cron runs MUST NOT double-fire on the same row. The
  // candidate query selects rows where status='quoted'; the UPDATE
  // also requires status='quoted' so a concurrent flipper makes the
  // second run's UPDATE touch 0 rows and skip cleanly.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
  const block = src.match(/async function expireStaleQuotes\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /WHERE id = \$2 AND status = ['"]quoted['"]/);
});

// ── Cron handler integration ────────────────────────────────────────

test('runImportRequestQuoteExpiry is exposed on the cron module', () => {
  assert.equal(typeof cron.runImportRequestQuoteExpiry, 'function');
});

test('JOBS map registers "import-request-quote-expiry" → runImportRequestQuoteExpiry', () => {
  // Without this, the GHA workflow firing { job: 'import-request-quote-expiry' }
  // would 400 with "Unknown job".
  assert.ok(cron.JOBS, 'JOBS map should be exported');
  assert.equal(cron.JOBS['import-request-quote-expiry'], cron.runImportRequestQuoteExpiry);
});

test('runImportRequestQuoteExpiry returns the cron-dashboard summary shape', async () => {
  const r = await cron.runImportRequestQuoteExpiry({});
  // Either succeeds with expiredCount, or returns ok:false with an
  // error (the not-configured branch in the test env).
  if (r.ok) {
    assert.ok('expiredCount' in r, 'success shape must carry expiredCount');
    assert.ok('processedAt' in r, 'success shape must carry processedAt');
  } else {
    assert.ok('error' in r, 'failure shape must carry error');
  }
});

// ── GHA workflow schedule ───────────────────────────────────────────

test('GHA workflow schedules import-request-quote-expiry at 02:30 UTC daily', () => {
  // 02:30 lives right after the audit-anchor snapshot (02:00) so the
  // snapshot reflects yesterday's state before the sweep modifies
  // anything. Pin the cron expression so a refactor that moves it
  // into a noisy slot surfaces here.
  assert.match(CRON_YAML, /'30 2 \* \* \*'/);
  assert.match(CRON_YAML, /job=import-request-quote-expiry/);
});

test('GHA workflow_dispatch lists import-request-quote-expiry in manual-fire options', () => {
  // Without the option, the "Run workflow" button in the Actions tab
  // can't fire this job manually — meaning ops can never trigger an
  // off-cycle sweep (e.g. after fixing a corrupted quote_expires_at).
  assert.match(CRON_YAML, /- import-request-quote-expiry/);
});

// ── Event allowlist (sprint 14 ADR-0005 drift-guard composes) ──────

test('Audit events fired by expireStaleQuotes are in the allowlist', () => {
  // Both event types must be allowlisted or events.record returns
  // false silently (the sprint-14 drift-guard would catch this for
  // novel types, but pinning explicitly makes the contract clear).
  assert.ok(events.ALLOWED_TYPES.has('import_request_status_transition'));
  assert.ok(events.ALLOWED_TYPES.has('import_request_message_posted'));
});

// ── Countdown UI ────────────────────────────────────────────────────

test('QuoteExpiryRow renders 4 distinct tones (distant / near / imminent / expired)', () => {
  // Pin the 4-state taxonomy so a "simpler" refactor doesn't collapse
  // them and lose the urgency signal. The labels themselves are
  // copy that may change; the tone branches are what we pin.
  const block = DETAIL_TSX.match(/function QuoteExpiryRow\([\s\S]*?\n\}/);
  assert.ok(block, 'QuoteExpiryRow not located');
  const body = block[0];
  // Critical (expired), warning (near + imminent), neutral (distant).
  assert.match(body, /tone = ['"]critical['"]/);
  // Both warning paths (sub-24h and sub-3d) set the same tone.
  assert.match(body, /tone = ['"]warning['"]/);
  // The default neutral path is the implicit initial value — no
  // explicit assignment, but pin the variable's initial declaration.
  assert.match(body, /tone: ['"]neutral['"] \| ['"]warning['"] \| ['"]critical['"] = ['"]neutral['"]/);
});

test('QuoteExpiryRow shifts to "warning" tone when < 24h remain', () => {
  // The 24h threshold is the customer urgency signal. Pin it so a
  // change to a more conservative threshold (e.g. 72h) is a
  // conscious decision, not an accidental tweak.
  const block = DETAIL_TSX.match(/function QuoteExpiryRow\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /hoursRemaining < 24/);
});

test('QuoteExpiryRow handles a malformed expires string gracefully', () => {
  // Defensive: a bad ISO string must NOT render "NaN days remaining"
  // or crash the QuotePanel. Pin the fallback copy so a refactor
  // that drops it surfaces here.
  const block = DETAIL_TSX.match(/function QuoteExpiryRow\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /Number\.isFinite\(ts\)/);
  assert.match(block[0], /Quote validity unknown/);
});

// ── Schema index covers the sweep WHERE clause ─────────────────────

test('schema-012 has the partial index that powers expireStaleQuotes', () => {
  // The sweep query is:
  //   WHERE status = 'quoted'
  //     AND quote_expires_at IS NOT NULL
  //     AND quote_expires_at < now()
  //     AND archived_at IS NULL
  // The import_requests_quote_expiry_idx index in schema-012 is
  // exactly this query's covering index — without it, the sweep
  // becomes a full-table scan on every cron run.
  assert.match(SCHEMA_012, /CREATE INDEX IF NOT EXISTS import_requests_quote_expiry_idx[\s\S]*?WHERE status = ['"]quoted['"][\s\S]*?quote_expires_at IS NOT NULL[\s\S]*?archived_at IS NULL/);
});
