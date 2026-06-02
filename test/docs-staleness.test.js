'use strict';

// Phase 0 task P0.14 of docs/execution-plan.md.
//
// Cheap floor-tests on docs that carry numeric or structural claims
// that are easy to drift. The point isn't to validate every prose
// fact (impossible without a giant LLM check); it's to catch the
// few "looks fine, drifts silently, misleads procurement"
// regressions the audit found in 2026-05-30:
//
//   - soc2-readiness.md + dpa-template.md cited "1,464 tests" months
//     after the suite hit 3,000+ (a third less coverage than we
//     actually have)
//   - billion-dollar-plan.md + the C4 component diagram both said
//     "orchestrator merges 14 tools" when the real number is 33
//   - CLAUDE.md cited 14 tools too
//
// These mistakes were not malicious — the docs went stale because
// no test cared. This file makes the test care.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ── test-count floor on customer-facing docs ────────────────────────

// Floor is "the most we can claim and still be honest." Pick a
// conservative number rounded down — the actual suite is 3,200+ at
// time of writing, so 3,000 leaves headroom for churn while still
// catching a stale "1,464" claim.
const TEST_COUNT_FLOOR = 3000;

// Match either "3,000+ tests" / "3,200+ automated tests" / "3,200 cases"
// style claims. The number can have an optional comma + optional `+`.
const TEST_COUNT_RE = /([0-9](?:,?[0-9]{3})+)(\+)?\s*(?:automated\s+)?(?:tests?|cases?)/gi;

function extractTestCountClaims(src) {
  const claims = [];
  let m;
  TEST_COUNT_RE.lastIndex = 0;
  while ((m = TEST_COUNT_RE.exec(src)) !== null) {
    const numeric = parseInt(m[1].replace(/,/g, ''), 10);
    if (Number.isFinite(numeric)) claims.push({ raw: m[0], numeric });
  }
  return claims;
}

const TEST_COUNT_DOCS = [
  'docs/security/soc2-readiness.md',
  'docs/security/dpa-template.md',
  'CLAUDE.md',
];

for (const doc of TEST_COUNT_DOCS) {
  test(`${doc} does not under-claim test coverage below ${TEST_COUNT_FLOOR}`, () => {
    const claims = extractTestCountClaims(read(doc));
    // We allow a doc to make zero numeric claims (defensible — "the
    // suite is green" without a number). But any claim it does make
    // must be ≥ the floor; a "1,464 tests" line is a stale-claim bug.
    for (const c of claims) {
      assert.ok(
        c.numeric >= TEST_COUNT_FLOOR,
        `${doc} claims "${c.raw}" — below floor ${TEST_COUNT_FLOOR}. Update to a current value (the suite has grown).`,
      );
    }
  });
}

// ── orchestrator tool-count floor ───────────────────────────────────

// The orchestrator merges the 4 specialists' tool sets + delegation
// tools. Today that's 33 (verified at module load — see assertion
// below). A doc claiming "merges 14 tools" is a years-old stale
// number. Floor 25 leaves headroom for tool consolidation while
// still catching the pre-2026 "14" claim.
const TOOL_COUNT_FLOOR = 25;

function actualOrchestratorToolCount() {
  // Load lazily so the test file stays cheap to require.
  const orch = require(path.join(ROOT, 'lib', 'handlers', 'orchestrator'));
  if (Array.isArray(orch.TOOLS)) return orch.TOOLS.length;
  if (orch.toolImpls && typeof orch.toolImpls === 'object') return Object.keys(orch.toolImpls).length;
  throw new Error('orchestrator does not expose TOOLS or toolImpls');
}

test('orchestrator actually merges at least the floor tool count (sanity-check the floor)', () => {
  const actual = actualOrchestratorToolCount();
  assert.ok(
    actual >= TOOL_COUNT_FLOOR,
    `orchestrator now merges ${actual} tools — below the docs-staleness floor ${TOOL_COUNT_FLOOR}. Either the orchestrator shrank (intentional? update floor + docs) or the test is wrong.`,
  );
});

const TOOL_COUNT_DOCS = [
  'docs/billion-dollar-plan.md',
  'docs/architecture/03-component-ai-layer.md',
];

const TOOL_COUNT_RE = /merg(?:es|ing)\s+(?:the\s+\w+\s+)?([0-9]+)\s+tools?/gi;

for (const doc of TOOL_COUNT_DOCS) {
  test(`${doc} does not under-claim orchestrator tool count below ${TOOL_COUNT_FLOOR}`, () => {
    const src = read(doc);
    TOOL_COUNT_RE.lastIndex = 0;
    let m;
    let found = false;
    while ((m = TOOL_COUNT_RE.exec(src)) !== null) {
      found = true;
      const n = parseInt(m[1], 10);
      assert.ok(
        n >= TOOL_COUNT_FLOOR,
        `${doc} claims "${m[0]}" — below floor ${TOOL_COUNT_FLOOR}. The orchestrator now merges ${actualOrchestratorToolCount()} tools.`,
      );
    }
    // It's fine to have no tool-count claim at all. We only enforce
    // the floor when a number is given.
    if (!found) assert.ok(true, 'no tool-count claim — nothing to enforce');
  });
}

// ── ADR catalogue is referenced from the docs that bind to it ──────

// CLAUDE.md is the single doc every contributor reads first. If it
// stops pointing at docs/adr/ the policy surface goes silent — new
// rules land without ADRs, old rules drift without enforcement.

test('CLAUDE.md references the ADR catalogue', () => {
  const src = read('CLAUDE.md');
  assert.match(
    src,
    /docs\/adr\//,
    'CLAUDE.md must point at docs/adr/ — the ADR catalogue is the binding policy surface',
  );
});

test('docs/security/soc2-readiness.md references the ADR catalogue', () => {
  // soc2-readiness.md is the procurement-facing controls doc; the
  // ADRs are what binds many of those controls in code. Drift means
  // the doc points at "Track 5 of backend-grade-plan" (a plan, not
  // a binding policy) while the actual enforcement lives in ADR-named
  // tests. Catch the regression at the source.
  const src = read('docs/security/soc2-readiness.md');
  assert.match(src, /docs\/adr\/|\.\.\/adr\//, 'soc2-readiness.md must cite docs/adr/');
});

// ── last-reviewed dates on customer-facing security docs ───────────

// These dates aren't load-bearing in themselves, but a 6+ month gap
// between the last-reviewed date and today is a credible
// "no one is looking after this folder" signal that procurement
// reviewers spot fast.

const SECURITY_DOCS_WITH_DATES = [
  'docs/security/soc2-readiness.md',
  'docs/security/dpa-template.md',
  'docs/security/data-flow.md',
  'docs/security/subprocessors.md',
  'docs/security/audit-trail.md',
  'docs/security/incident-response.md',
];

const STALE_DATE_THRESHOLD_DAYS = 365;

test(`security docs have a Last reviewed date within ${STALE_DATE_THRESHOLD_DAYS} days`, () => {
  const now = Date.now();
  const stale = [];
  for (const doc of SECURITY_DOCS_WITH_DATES) {
    const src = read(doc);
    const m = src.match(/Last reviewed[:\s\*]+(\d{4}-\d{2}-\d{2})/i);
    if (!m) {
      stale.push(`${doc}: no Last reviewed date found`);
      continue;
    }
    const ageDays = (now - Date.parse(m[1])) / (1000 * 60 * 60 * 24);
    if (ageDays > STALE_DATE_THRESHOLD_DAYS) {
      stale.push(`${doc}: last reviewed ${m[1]} (${Math.floor(ageDays)} days ago)`);
    }
  }
  assert.equal(stale.length, 0, `Stale security docs:\n  - ${stale.join('\n  - ')}`);
});
