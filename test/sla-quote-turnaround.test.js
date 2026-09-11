'use strict';

// Sprint 83 — quote-turnaround SLA (Track C phase 1).
//
// The measured commitment: submitted → customer-visible 'quoted',
// 48h target, rolling 90-day window. The load-bearing invariants:
//
//   - quoted_at is FIRST-WRITE-ONLY (COALESCE) in BOTH paths that
//     land status='quoted' (team review + generic transition) — a
//     rework can never launder a slow first answer.
//   - Attainment accrues from deploy: pre-deploy rows have no
//     quoted_at and truthfully stay out of the sample (the
//     accuracy-ledger accrual posture; nothing back-filled).
//   - Honesty gates are SHARED with the accuracy ledger (imported
//     constants — two trust instruments with two definitions of
//     "enough data" would be a credibility bug).
//   - Archived rows stay IN the SLA cut — archiving a slow quote
//     must not launder attainment.
//   - Clock-skewed negative durations are DROPPED, never counted
//     as instant.
//
// Test layers:
//   1. Calculator runtime with exact numbers (median, nearest-rank
//      p95, within-target, tier boundaries)
//   2. Stamp pins (both writers, COALESCE, CASE-gated)
//   3. Reader + insights wiring pins
//   4. Migration + TS + card pins

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sla = require('../lib/intelligence/sla');
const ledger = require('../lib/intelligence/accuracy-ledger');

const ROOT = path.resolve(__dirname, '..');
const SLA_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'intelligence', 'sla.js'), 'utf8');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const MIGRATION_SQL = fs.readFileSync(
  path.join(ROOT, 'lib', 'db', 'schema-023-import-request-quoted-at.sql'),
  'utf8',
);
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// Row with an exact turnaround in hours.
function rowWithHours(h) {
  const created = Date.parse('2026-07-01T00:00:00Z');
  return {
    createdAt: new Date(created).toISOString(),
    quotedAt: new Date(created + h * 3_600_000).toISOString(),
  };
}

// ── Layer 1: calculator runtime ──────────────────────────────────

test('turnaroundHours scores chronological stamps and drops garbage + clock skew', () => {
  assert.equal(sla.turnaroundHours(rowWithHours(36)), 36);
  assert.equal(sla.turnaroundHours(null), null);
  assert.equal(sla.turnaroundHours({ createdAt: 'garbage', quotedAt: '2026-07-01T00:00:00Z' }), null);
  assert.equal(sla.turnaroundHours({ createdAt: '2026-07-01T00:00:00Z' }), null);
  // Negative duration (clock skew) is DROPPED, never "instant".
  assert.equal(
    sla.turnaroundHours({ createdAt: '2026-07-02T00:00:00Z', quotedAt: '2026-07-01T00:00:00Z' }),
    null,
  );
});

test('computeSlaAttainment over a hand-computed 10-row corpus (exact numbers)', () => {
  // Hours: 6,12,24,30,36,42,50,60,72,120 → within 48h: 6 of 10.
  const hours = [6, 12, 24, 30, 36, 42, 50, 60, 72, 120];
  const out = sla.computeSlaAttainment(hours.map(rowWithHours));
  assert.equal(out.sampleSize, 10);
  assert.equal(out.tier, 'indicative');
  assert.equal(out.targetHours, 48);
  assert.equal(out.withinTargetPct, 60);
  // median = (36+42)/2 = 39; nearest-rank p95 over 10 = ceil(9.5)=10th value = 120.
  assert.equal(out.medianHours, 39);
  assert.equal(out.p95Hours, 120);
});

test('HONESTY GATE shared with the accuracy ledger: below 10 rows the figures are withheld', () => {
  const out = sla.computeSlaAttainment([rowWithHours(2), rowWithHours(4)]);
  assert.equal(out.sampleSize, 2);
  assert.equal(out.tier, 'insufficient');
  assert.equal(out.withinTargetPct, null);
  assert.equal(out.medianHours, null);
  assert.equal(out.p95Hours, null);
  // Single-source pin: the SLA module IMPORTS the ledger's gates.
  assert.match(SLA_SRC, /const \{ INDICATIVE_MIN, MEASURED_MIN \} = require\('\.\/accuracy-ledger'\);/);
  // And the boundaries behave identically.
  const mk = (n) => sla.computeSlaAttainment(Array.from({ length: n }, () => rowWithHours(10)));
  assert.equal(mk(ledger.INDICATIVE_MIN - 1).tier, 'insufficient');
  assert.equal(mk(ledger.INDICATIVE_MIN).tier, 'indicative');
  assert.equal(mk(ledger.MEASURED_MIN).tier, 'measured');
});

test('zero-corpus attainment is the truthful accruing state', () => {
  const out = sla.computeSlaAttainment([]);
  assert.equal(out.sampleSize, 0);
  assert.equal(out.tier, 'insufficient');
  assert.equal(out.withinTargetPct, null);
});

test('SLA constants pinned: 48h target, 90-day rolling window; module stays LLM-free', () => {
  assert.equal(sla.SLA_QUOTE_TURNAROUND_TARGET_HOURS, 48);
  assert.equal(sla.SLA_WINDOW_DAYS, 90);
  assert.ok(!/@anthropic|anthropic-ai/.test(SLA_SRC));
});

// ── Layer 2: stamp discipline ────────────────────────────────────

test('BOTH quoted-landing writers stamp quoted_at first-write-only (CASE + COALESCE, two occurrences)', () => {
  const stamps = DB_SRC.match(
    /quoted_at = CASE WHEN \$1 = 'quoted' THEN COALESCE\(quoted_at, now\(\)\) ELSE quoted_at END,/g,
  ) || [];
  assert.equal(stamps.length, 2, 'team-review AND generic-transition writers must both stamp');
  // Placement: one inside attachTeamReview's UPDATE, one inside the
  // generic transition's non-failure UPDATE.
  const reviewBlock = DB_SRC.match(/SET status = \$1,\s*\n\s*team_review_state = \$2::jsonb,[\s\S]*?RETURNING \*/);
  assert.ok(reviewBlock && /quoted_at = CASE/.test(reviewBlock[0]), 'team-review path must stamp');
  const genericBlock = DB_SRC.match(/metadata = COALESCE\(metadata, '\{\}'::jsonb\) \|\| \$2::jsonb,[\s\S]*?RETURNING \*/);
  assert.ok(genericBlock && /quoted_at = CASE/.test(genericBlock[0]), 'generic transition path must stamp');
});

test('rowToImportRequest projects quotedAt', () => {
  assert.match(DB_SRC, /quotedAt: r\.quoted_at instanceof Date \? r\.quoted_at\.toISOString\(\) : \(r\.quoted_at \|\| null\),/);
});

// ── Layer 3: reader + insights wiring ────────────────────────────

test('SLA cut: quoted_at bounds the window; archived rows stay IN (no archived_at filter)', () => {
  const block = DB_SRC.match(/async function listQuoteTurnaroundsForSla\([\s\S]*?\n\}/);
  assert.ok(block, 'SLA reader not found');
  const body = block[0];
  // Sprint 85 generalised the bind position: the reader went
  // dual-scope (platform-wide when orgId omitted), so the window
  // param may be $1 or $2.
  assert.match(body, /quoted_at IS NOT NULL/);
  assert.match(body, /AND quoted_at >= now\(\) - \(\$[12] \|\| ' days'\)::interval/);
  assert.ok(!/archived_at/.test(body), 'archiving a slow quote must not launder the SLA');
  // Fail-open.
  assert.match(body, /catch \(_\) \{[\s\S]*?return \[\];/);
});

test('aggregateOpsInsights wires the SLA calculator with its own constants (no inline numbers)', () => {
  assert.match(DB_SRC, /const slaCalc = require\('\.\.\/intelligence\/sla'\);/);
  assert.match(DB_SRC, /windowDays: slaCalc\.SLA_WINDOW_DAYS,/);
  // Sprint 89 generalised this pin (the sprint-60 alternation
  // lesson): the target is now the per-org EFFECTIVE value whose
  // defensive re-bound falls back to the calculator constant —
  // the constant must still anchor the expression.
  assert.match(DB_SRC, /targetHours: (?:slaCalc\.SLA_QUOTE_TURNAROUND_TARGET_HOURS|effectiveTurnTarget),/);
  assert.match(DB_SRC, /: slaCalc\.SLA_QUOTE_TURNAROUND_TARGET_HOURS;/);
  assert.match(DB_SRC, /\n        slaQuoteTurnaround,\n/);
});

// ── Layer 4: migration + TS + card ───────────────────────────────

test('schema-023: quoted_at column + partial (org_id, quoted_at) index; accrual honesty documented', () => {
  assert.match(MIGRATION_SQL, /ADD COLUMN IF NOT EXISTS quoted_at timestamptz;/);
  assert.match(MIGRATION_SQL, /ON import_requests \(org_id, quoted_at\)\s*\n\s*WHERE quoted_at IS NOT NULL;/);
  assert.match(MIGRATION_SQL, /measured since/);
});

test('TS mirror: OpsInsightsSlaQuoteTurnaround + OpsInsights field', () => {
  assert.match(
    API_TS,
    /export interface OpsInsightsSlaQuoteTurnaround \{[\s\S]*?targetHours: number;[\s\S]*?withinTargetPct: number \| null;[\s\S]*?\}/,
  );
  assert.match(API_TS, /slaQuoteTurnaround: OpsInsightsSlaQuoteTurnaround;/);
});

test('SLA card is ALWAYS rendered (a commitment that hides when unmeasured is not a commitment)', () => {
  // No count gate around the card — contrast with the cohort cards.
  assert.match(INSIGHTS_TSX, /<SlaQuoteTurnaroundCard data=\{data\.slaQuoteTurnaround\} \/>/);
  assert.ok(
    !/slaQuoteTurnaround\.sampleSize > 0 && \(\s*<SlaQuoteTurnaroundCard/.test(INSIGHTS_TSX),
    'the SLA card must not hide at sampleSize 0',
  );
  const card = INSIGHTS_TSX.match(/function SlaQuoteTurnaroundCard\([\s\S]*?\n\}\n/)[0];
  assert.match(card, /no figures are back-filled or guessed/);
  assert.match(card, /a rework never launders\s*\n?\s*a slow first answer/);
  assert.match(card, /data-testid="sla-quote-turnaround-card"/);
});
