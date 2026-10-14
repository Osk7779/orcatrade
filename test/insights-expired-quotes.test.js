'use strict';

// Sprint 77 — cohort #12, seventh proactive signal. The lost-deal
// mirror of sprint 69's aging quotes: #11 catches silent customers
// BEFORE the quote lapses; #12 catches the ones that fell through
// — quotes flipped to 'expired' by the sprint-19 auto-expiry cron
// with no customer decision, within the last 30 days.
//
// Value-weighted: the cohort's headline is the € at stake
// (SUM of landed_quote totalLandedCents in POSTGRES — integer
// cents end to end per ADR-0004, never JS float math), not just a
// count. Each row is a re-quote candidate, most recently expired
// first ("just lost" is the most recoverable).
//
// Tests cover five layers:
//   1. Constants: window + cap exported, cap shared with the
//      sibling individual-row cohorts
//   2. SQL discipline: status='expired'; recency dimension is
//      quote_expires_at (NOT updated_at — a later archive/note
//      must not move a row); window-agnostic (the CONSTANT, never
//      the dashboard days var); SUM in Postgres; COUNT and LIST
//      use identical predicates; newest-first; LIMIT = CAP;
//      null-safe landedCents (missing quote ≠ €0).
//   3. Response surface: cohort present with windowDays + count +
//      totalLandedCents + items.
//   4. TS mirror: item + cohort interfaces + OpsInsights field.
//   5. UI: card gated on count > 0; € headline from cents via a
//      display-only formatter; null renders as "—"; drill-down
//      link to ?status=expired; truncation footnote.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequests = require('../lib/db/import-requests');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// The 6c block — from its banner comment to the next section banner.
const COHORT_BLOCK = DB_SRC.match(/── 6c\. Expired quotes \(sprint 77\) ──[\s\S]*?── 7\./);

// ── Layer 1: constants ───────────────────────────────────────────

test('EXPIRED_QUOTES_WINDOW_DAYS = 30 and EXPIRED_QUOTES_CAP = 10 (exported)', () => {
  assert.equal(importRequests.EXPIRED_QUOTES_WINDOW_DAYS, 30);
  assert.equal(importRequests.EXPIRED_QUOTES_CAP, 10);
  // Design invariant: every individual-row proactive cohort shares
  // the same top-N cap so the cards render consistently.
  assert.equal(importRequests.EXPIRED_QUOTES_CAP, importRequests.STALLED_QUEUE_CAP);
  assert.equal(importRequests.EXPIRED_QUOTES_CAP, importRequests.QUOTE_FOLLOWUP_CAP);
});

// ── Layer 2: SQL discipline ──────────────────────────────────────

test('cohort filters status=expired with quote_expires_at as the recency dimension', () => {
  assert.ok(COHORT_BLOCK, '6c block not found');
  const body = COHORT_BLOCK[0];
  assert.match(body, /AND status = 'expired'/);
  // quote_expires_at, NOT updated_at — archiving/noting a row later
  // must not move it in or out of the cohort.
  assert.match(body, /AND quote_expires_at >= now\(\) - \(\$2 \|\| ' days'\)::interval/);
  assert.ok(!/updated_at </.test(body), 'recency must never key off updated_at');
});

test('cohort is window-agnostic — binds the CONSTANT, never the dashboard days var', () => {
  assert.ok(COHORT_BLOCK);
  const body = COHORT_BLOCK[0];
  const binds = body.match(/String\(EXPIRED_QUOTES_WINDOW_DAYS\)/g) || [];
  assert.equal(binds.length, 2, 'both the COUNT and LIST queries bind the constant');
  assert.ok(!/String\(days\)/.test(body), 'the dashboard days toggle must not move this cohort');
});

test('the € total is summed in POSTGRES as integer cents (ADR-0004 — no JS float math)', () => {
  assert.ok(COHORT_BLOCK);
  assert.match(
    COHORT_BLOCK[0],
    /COALESCE\(SUM\(\(landed_quote->>'totalLandedCents'\)::bigint\), 0\)::bigint AS total_cents/,
  );
  // No JS-side arithmetic on the money — the block may Number()
  // the pre-summed value but never adds/multiplies cents itself.
  assert.ok(!/landedCents\s*[+*]/.test(COHORT_BLOCK[0]));
});

test('COUNT and LIST use identical predicates; newest-first; LIMIT = CAP', () => {
  assert.ok(COHORT_BLOCK);
  const body = COHORT_BLOCK[0];
  const predicates = body.match(/AND archived_at IS NULL\s*\n\s*AND status = 'expired'\s*\n\s*AND quote_expires_at >= now\(\) - \(\$2 \|\| ' days'\)::interval/g) || [];
  assert.equal(predicates.length, 2, 'COUNT and LIST predicates must be identical');
  assert.match(body, /ORDER BY quote_expires_at DESC/);
  assert.match(body, /LIMIT \$3/);
  assert.match(body, /EXPIRED_QUOTES_CAP\]/);
});

test('landedCents is null-safe — a missing quote is "—", never €0', () => {
  assert.ok(COHORT_BLOCK);
  assert.match(
    COHORT_BLOCK[0],
    /landedCents: \(r\.landed_cents === null \|\| r\.landed_cents === undefined\)\s*\n\s*\? null\s*\n\s*: Number\(r\.landed_cents\),/,
  );
});

// ── Layer 3: response surface ────────────────────────────────────

test('aggregateOpsInsights surfaces the expiredQuotes cohort with the full shape', () => {
  assert.match(
    DB_SRC,
    /expiredQuotes: \{\s*\n\s*windowDays: EXPIRED_QUOTES_WINDOW_DAYS,\s*\n\s*count: expiredQuoteCount,\s*\n\s*totalLandedCents: expiredQuoteTotalCents,\s*\n\s*items: expiredQuoteItems,\s*\n\s*\},/,
  );
});

// ── Layer 4: TS mirror ───────────────────────────────────────────

test('TS mirrors: item (nullable cents) + cohort interface + OpsInsights field', () => {
  assert.match(
    API_TS,
    /export interface OpsInsightsExpiredQuoteItem \{\s*\n\s*externalId: string;\s*\n\s*label: string;\s*\n\s*expiredAt: string;\s*\n\s*landedCents: number \| null;\s*\n\}/,
  );
  assert.match(
    API_TS,
    /export interface OpsInsightsExpiredQuotesCohort \{\s*\n\s*windowDays: number;\s*\n\s*count: number;\s*\n\s*totalLandedCents: number;\s*\n\s*items: OpsInsightsExpiredQuoteItem\[\];\s*\n\}/,
  );
  assert.match(API_TS, /expiredQuotes: OpsInsightsExpiredQuotesCohort;/);
});

// ── Layer 5: UI ──────────────────────────────────────────────────

test('insights page gates ExpiredQuotesCard on count > 0 (no empty card on clean months)', () => {
  assert.match(
    INSIGHTS_TSX,
    /\{data\.expiredQuotes\.count > 0 && \(\s*<ExpiredQuotesCard data=\{data\.expiredQuotes\} \/>\s*\)\}/,
  );
});

test('ExpiredQuotesCard headlines the € at stake via a display-only cents formatter', () => {
  const body = INSIGHTS_TSX.match(/function ExpiredQuotesCard\([\s\S]*?\n\}\n/)[0];
  assert.match(body, /eurFromCentsDisplay\(data\.totalLandedCents\)/);
  assert.match(body, /eurFromCentsDisplay\(item\.landedCents\)/);
  // Formatter: whole-EUR display rounding only; null → "—".
  const fmt = INSIGHTS_TSX.match(/function eurFromCentsDisplay\([\s\S]*?\n\}/)[0];
  assert.match(fmt, /if \(cents == null \|\| !Number\.isFinite\(cents\)\) return '—';/);
  assert.match(fmt, /Math\.round\(cents \/ 100\)\.toLocaleString\('en-IE'\)/);
});

test('ExpiredQuotesCard names the window, links each row, and offers the status=expired drill-down', () => {
  const body = INSIGHTS_TSX.match(/function ExpiredQuotesCard\([\s\S]*?\n\}\n/)[0];
  assert.match(body, /in the last \{data\.windowDays\} days/);
  assert.match(body, /href=\{`\/imports\/\$\{item\.externalId\}`\}/);
  assert.match(body, /href="\/imports\?status=expired"/);
  assert.match(body, /View all expired →/);
  // Truncation footnote when count > items.length.
  assert.match(body, /const truncated = data\.count > data\.items\.length;/);
  assert.match(body, /most recent of \{data\.count\} expired quotes/);
});

test('ExpiredQuotesCard uses the critical (red) visual language — lost value, not a nudge', () => {
  const body = INSIGHTS_TSX.match(/function ExpiredQuotesCard\([\s\S]*?\n\}\n/)[0];
  // Contrast with the amber aging-quotes card: aging = recoverable
  // nudge (warning); expired = value already walked (critical).
  assert.match(body, /border-\[var\(--color-critical\)\]/);
  assert.match(body, /data-testid="expired-quotes-card"/);
});
