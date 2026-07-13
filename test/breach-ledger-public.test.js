'use strict';

// Sprint 98 — the published breach ledger.
//
// /trust/sla now states the recorded-breach count in public:
// "N commitment breaches recorded in the last 90 days — every one
// an audit-chained event." Zero is a provable claim; misses are
// counted where prospects can see them; the trust pack inherits
// the figure through the single-source computeAttainment reuse.
//
// THE LOAD-BEARING DISTINCTION — null vs zero:
//   count 0    = "we recorded zero breaches" (a claim, provable
//                against the event corpus)
//   count null = "the ledger is unreadable right now" (a state)
// countEventsFromPg returns null on PG-unconfigured/error, and
// every surface renders the two differently. Substituting a zero
// for an unreadable ledger would be the exact self-flattery the
// ADR-0021 gates exist to prevent.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');
const EVENTS_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'events.js'), 'utf8');
const SLA_PUBLIC_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'sla-public.js'), 'utf8');
const LIVE_TSX = fs.readFileSync(
  path.join(ROOT, 'marketing-shell', 'components', 'marketing', 'sla-attainment-live.tsx'),
  'utf8',
);

// ── The counter ──────────────────────────────────────────────────

test('countEventsFromPg returns NULL (not 0) when PG is unconfigured — unreadable ≠ zero (runtime)', async () => {
  // Test env has no DATABASE_URL: the ledger is unreadable, and
  // the counter must say so rather than claim a clean record.
  assert.equal(
    await events.countEventsFromPg({ type: 'import_request_sla_breached', sinceDays: 90 }),
    null,
  );
  // Garbage type → null too (never a fabricated count).
  assert.equal(await events.countEventsFromPg({ type: '' }), null);
  assert.equal(await events.countEventsFromPg({}), null);
});

test('the counter is a typed, windowed PG query with a clamped horizon; errors fail to null', () => {
  const block = EVENTS_SRC.match(/async function countEventsFromPg\([\s\S]*?\n\}/);
  assert.ok(block, 'countEventsFromPg not found');
  const body = block[0];
  assert.match(body, /WHERE type = \$1/);
  assert.match(body, /AND created_at >= now\(\) - \(\$2 \|\| ' days'\)::interval/);
  assert.match(body, /Math\.max\(1, Math\.min\(3650, Number\(sinceDays\) \|\| 90\)\)/);
  assert.match(body, /catch \(_\) \{\s*\n\s*return null;/);
  // The null-vs-zero rationale is documented at the source (the
  // banner comment sits above the function declaration).
  assert.match(EVENTS_SRC, /different truths/);
});

// ── /api/sla integration ─────────────────────────────────────────

test('computeAttainment carries breachesRecorded { windowDays, count } — trust pack inherits via reuse', () => {
  assert.match(
    SLA_PUBLIC_SRC,
    /events\.countEventsFromPg\(\{\s*\n\s*type: 'import_request_sla_breached',\s*\n\s*sinceDays: slaCalc\.SLA_WINDOW_DAYS,\s*\n\s*\}\)/,
  );
  assert.match(
    SLA_PUBLIC_SRC,
    /breachesRecorded: \{ windowDays: slaCalc\.SLA_WINDOW_DAYS, count: breachCount \},/,
  );
  // Methodology names the ledger + the null semantics.
  assert.match(SLA_PUBLIC_SRC, /null means the ledger is unreadable right now, never zero/);
});

test('the three reads stay PARALLEL (one Promise.all — the ledger adds no serial latency)', () => {
  assert.match(
    SLA_PUBLIC_SRC,
    /const \[turnRows, frRows, breachCount\] = await Promise\.all\(\[/,
  );
});

// ── /trust/sla rendering ─────────────────────────────────────────

test('the public page renders null as UNREADABLE and never substitutes a zero', () => {
  assert.match(LIVE_TSX, /breachesRecorded\?: \{ windowDays: number; count: number \| null \};/);
  assert.match(LIVE_TSX, /data\.breachesRecorded\.count === null \? \(/);
  assert.match(LIVE_TSX, /we do not substitute a zero for it/);
});

test('the count line makes the brand argument: misses published, singular/plural, chain named', () => {
  assert.match(LIVE_TSX, /commitment breach\{data\.breachesRecorded\.count === 1 \? '' : 'es'\} recorded/);
  assert.match(LIVE_TSX, /every one an audit-chained event/);
  assert.match(LIVE_TSX, /We publish our misses; that is what\s*\n?\s*makes the rest of this page worth believing\./);
});
