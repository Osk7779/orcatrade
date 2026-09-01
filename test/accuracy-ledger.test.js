'use strict';

// Sprint 80 — Quote Accuracy Ledger (Track B of the billion-dollar
// program: the commercial weapon).
//
// The measured version of the accuracy guarantee: median absolute
// error, ±5/±10/±20% bands, value-weighted bias — recomputed
// statelessly from the actuals corpus. The load-bearing invariants:
//
//   - HONESTY GATES. Below INDICATIVE_MIN (10) scoreable actuals
//     the headline metrics are WITHHELD (null) — only the count
//     ships. The instrument can never flatter itself; with the
//     pre-revenue zero-corpus it truthfully reports sampleSize 0.
//   - ADR 0004. Sums run in integer cents; the EUR-float estimate
//     converts at the boundary. Percentages are display analytics.
//   - ADR 0003. lib/intelligence/accuracy-ledger.js is LLM-free.
//   - PII-FREE BY CONSTRUCTION. The public response carries the
//     aggregate + methodology only — row-level fields (emailHash,
//     planId, notes) never reach it.
//   - Reads fail OPEN: cache trouble → recompute; corpus trouble
//     → the truthful empty ledger, never a 5xx on a trust page.
//
// Test layers:
//   1. Calculator runtime with exact hand-computed numbers
//   2. Tier boundaries (9/10/49/50)
//   3. Handler discipline (GET-only, cache posture, degrade path,
//      PII absence, router registration)
//   4. Surface pins (vercel.json rewrites ×4, marketing page +
//      live component honesty copy)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ledger = require('../lib/intelligence/accuracy-ledger');

const ROOT = path.resolve(__dirname, '..');
const CALC_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'intelligence', 'accuracy-ledger.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'accuracy.js'), 'utf8');
const ROUTER_SRC = fs.readFileSync(path.join(ROOT, 'api', '[...path].js'), 'utf8');
const VERCEL_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const LIVE_TSX = fs.readFileSync(
  path.join(ROOT, 'marketing-shell', 'components', 'marketing', 'accuracy-ledger-live.tsx'),
  'utf8',
);
const PAGE_TSX = fs.readFileSync(
  path.join(ROOT, 'marketing-shell', 'app', 'trust', 'accuracy', 'page.tsx'),
  'utf8',
);

// Build a row whose absolute error is exactly `errPct` (integer %)
// against a €100.00 estimate. 1% of 10000 cents = 100 cents, so
// every constructed actual is a whole-cent value.
function rowWithError(errPct, extra = {}) {
  return {
    landedCents: 10000 + errPct * 100,
    snapshot: { perShipmentLandedTotal: 100 },
    ...extra,
  };
}

// ── Layer 1: calculator runtime ──────────────────────────────────

test('scoreRow converts the EUR-float estimate at the boundary and scores in integer cents', () => {
  const s = ledger.scoreRow({ landedCents: 10750, snapshot: { perShipmentLandedTotal: 100 } });
  assert.equal(s.estimateCents, 10000);
  assert.equal(s.actualCents, 10750);
  assert.equal(s.deltaCents, 750);
  assert.equal(s.absErrorPct, 7.5);
});

test('scoreRow refuses unscoreable rows (missing/zero estimate or actual) — they never bias the ledger', () => {
  for (const bad of [
    null,
    {},
    { landedCents: 10000 },                                      // no snapshot
    { landedCents: 10000, snapshot: {} },                        // no estimate
    { landedCents: 10000, snapshot: { perShipmentLandedTotal: 0 } },
    { landedCents: 0, snapshot: { perShipmentLandedTotal: 100 } },
    { landedCents: -5, snapshot: { perShipmentLandedTotal: 100 } },
  ]) {
    assert.equal(ledger.scoreRow(bad), null);
  }
});

test('median: odd, even, empty', () => {
  assert.equal(ledger.median([3, 1, 2]), 2);
  assert.equal(ledger.median([4, 6, 1, 2]), 3);
  assert.equal(ledger.median([]), null);
});

test('computeAccuracyLedger over a hand-computed 10-row corpus (exact numbers)', () => {
  const errors = [0, 1, 2, 3, 4, 6, 8, 12, 15, 25];
  const rows = errors.map((e, i) => rowWithError(e, { reportedAt: `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00Z` }));
  const out = ledger.computeAccuracyLedger(rows);
  assert.equal(out.sampleSize, 10);
  assert.equal(out.tier, 'indicative');
  // errors ≤5: {0,1,2,3,4} = 5/10; ≤10: +{6,8} = 7/10; ≤20: +{12,15} = 9/10.
  assert.equal(out.within5Pct, 50);
  assert.equal(out.within10Pct, 70);
  assert.equal(out.within20Pct, 90);
  // median of sorted errors = (4+6)/2 = 5.0
  assert.equal(out.medianAbsErrorPct, 5);
  // Integer-cent totals: 10 × 10000 = 100000; actuals add Σerr×100 = 7600.
  assert.equal(out.totalEstimateCents, 100000);
  assert.equal(out.totalActualCents, 107600);
  assert.equal(out.valueWeightedBiasPct, 7.6);
  assert.equal(out.oldestReportedAt, '2026-06-01T00:00:00Z');
  assert.equal(out.newestReportedAt, '2026-06-10T00:00:00Z');
});

test('HONESTY GATE: below 10 scoreable rows the headline metrics are WITHHELD, count still ships', () => {
  const out = ledger.computeAccuracyLedger([rowWithError(1), rowWithError(2), rowWithError(3)]);
  assert.equal(out.sampleSize, 3);
  assert.equal(out.tier, 'insufficient');
  assert.equal(out.within5Pct, null);
  assert.equal(out.within10Pct, null);
  assert.equal(out.within20Pct, null);
  assert.equal(out.medianAbsErrorPct, null);
  assert.equal(out.valueWeightedBiasPct, null);
});

test('the pre-revenue zero-corpus ledger is truthful: sampleSize 0, everything withheld, totals 0', () => {
  const out = ledger.computeAccuracyLedger([]);
  assert.equal(out.sampleSize, 0);
  assert.equal(out.tier, 'insufficient');
  assert.equal(out.medianAbsErrorPct, null);
  assert.equal(out.totalEstimateCents, 0);
  assert.equal(out.totalActualCents, 0);
  assert.equal(out.oldestReportedAt, null);
});

test('unscoreable rows are skipped, not counted — garbage cannot inflate the sample into a tier', () => {
  const rows = [rowWithError(1), rowWithError(2), { landedCents: 500 }, { snapshot: null }, null];
  const out = ledger.computeAccuracyLedger(rows);
  assert.equal(out.sampleSize, 2, 'only scoreable rows count');
  assert.equal(out.tier, 'insufficient');
});

// ── Layer 2: tier boundaries ─────────────────────────────────────

test('tier boundaries pin the gates: 9→insufficient, 10→indicative, 49→indicative, 50→measured', () => {
  assert.equal(ledger.INDICATIVE_MIN, 10);
  assert.equal(ledger.MEASURED_MIN, 50);
  const mk = (n) => ledger.computeAccuracyLedger(Array.from({ length: n }, () => rowWithError(2)));
  assert.equal(mk(9).tier, 'insufficient');
  assert.equal(mk(10).tier, 'indicative');
  assert.equal(mk(49).tier, 'indicative');
  assert.equal(mk(50).tier, 'measured');
});

// ── Layer 3: handler + boundaries ────────────────────────────────

test('accuracy-ledger calculator stays LLM-free (ADR 0003)', () => {
  assert.ok(!/@anthropic|anthropic-ai/.test(CALC_SRC));
});

test('handler is GET-only, KV-cached with TTL, and fail-open on cache trouble', () => {
  assert.match(HANDLER_SRC, /if \(req\.method !== 'GET'\)/);
  assert.match(HANDLER_SRC, /const CACHE_KEY = 'accuracy:ledger:v1';/);
  assert.match(HANDLER_SRC, /const CACHE_TTL_SECONDS = 5 \* 60;/);
  assert.match(HANDLER_SRC, /catch \(_\) \{ \/\* cache read is best-effort \*\/ \}/);
  assert.match(HANDLER_SRC, /catch \(_\) \{ \/\* cache write is best-effort \*\/ \}/);
});

test('handler degrades to the truthful EMPTY ledger on corpus failure — a trust page never 5xxs', () => {
  assert.match(HANDLER_SRC, /ledger: ledgerCalc\.computeAccuracyLedger\(\[\]\)/);
  assert.ok(!/jsonResponse\(res, 5\d\d|res, 500/.test(HANDLER_SRC));
});

test('response is PII-free by construction — row-level fields never appear in handler CODE', () => {
  // Comments may NAME the forbidden fields (that's documentation of
  // the invariant); the code must never TOUCH them. Strip // lines
  // before matching.
  const codeOnly = HANDLER_SRC
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  for (const forbidden of ['emailHash', 'planId', 'notes', 'inputs']) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`).test(codeOnly),
      `handler code must never touch row-level field: ${forbidden}`,
    );
  }
});

test('router registers the public accuracy endpoint', () => {
  assert.match(ROUTER_SRC, /accuracy: require\('\.\.\/lib\/handlers\/accuracy'\),/);
});

// ── Layer 4: surfaces ────────────────────────────────────────────

test('vercel.json rewrites /trust/accuracy (bare + trailing + pl + de) to the marketing shell', () => {
  const sources = VERCEL_JSON.rewrites.map((r) => r.source);
  for (const s of ['/trust/accuracy', '/trust/accuracy/', '/pl/trust/accuracy', '/de/trust/accuracy']) {
    assert.ok(sources.includes(s), `missing rewrite: ${s}`);
  }
  const dest = VERCEL_JSON.rewrites.find((r) => r.source === '/trust/accuracy');
  assert.equal(dest.destination, 'https://orcatrade-marketing.vercel.app/trust/accuracy');
});

test('live component fetches the public endpoint and renders the insufficient tier HONESTLY', () => {
  assert.match(LIVE_TSX, /fetch\('\/api\/accuracy', \{ credentials: 'omit' \}\)/);
  // The insufficient branch shows the running count + the withhold
  // rationale — and no placeholder percentage.
  assert.match(LIVE_TSX, /ledger\.tier === 'insufficient'/);
  assert.match(LIVE_TSX, /a median is\s*\n?\s*marketing, not measurement/);
  assert.match(LIVE_TSX, /\{ledger\.sampleSize\}/);
});

test('trust page mounts the live ledger and documents stateless recomputation + the raw endpoint', () => {
  assert.match(PAGE_TSX, /<AccuracyLedgerLive \/>/);
  assert.match(PAGE_TSX, /Stateless recomputation\./);
  assert.match(PAGE_TSX, /GET \/api\/accuracy/);
  assert.match(PAGE_TSX, /withheld/);
});
