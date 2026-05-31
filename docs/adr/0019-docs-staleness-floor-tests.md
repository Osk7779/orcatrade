# Customer-facing doc claims are floor-tested in CI

- **Status:** Accepted
- **Date:** 2026-05-31
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Future doc authors; procurement-facing reviewers;
  anyone editing CLAUDE.md, the ADR catalogue, or docs/security/

## Context and problem statement

The 2026-05-30 audit and the Phase 0 docs sweep (this PR) surfaced a
pattern: load-bearing documentation goes stale silently. Three
concrete instances caught in P0.14:

1. **[`docs/security/soc2-readiness.md`](../security/soc2-readiness.md)**
   and **[`docs/security/dpa-template.md`](../security/dpa-template.md)**
   both cited "**1,464 automated tests**" months after the suite hit
   3,000+ — a third less coverage than we actually have, in a doc
   that goes to enterprise procurement reviewers.
2. **[`docs/billion-dollar-plan.md`](../billion-dollar-plan.md)** and
   **[`docs/architecture/03-component-ai-layer.md`](../architecture/03-component-ai-layer.md)**
   both said "orchestrator merges **14 tools**" when the real number
   is 33 — load-bearing claims in the apex strategy doc and the C4
   architecture diagram.
3. **[`CLAUDE.md`](../../CLAUDE.md)** — the file every contributor
   reads first — cited the 14-tool number, "~3,100+ tests," referenced
   `docs/backend-grade-plan.md` as the binding policy source instead
   of `docs/adr/`, and pointed at `claude-sonnet-4-6` as the agent
   model when `lib/ai/models.js` actually pins Opus 4.7 for
   customer-facing reasoning.

None of these were malicious; they happened because **no test cared**.
The fixes are in the same commit as this ADR; this ADR captures the
*pattern* — what classes of doc claim should be floor-tested going
forward, and what shouldn't.

## Decision drivers

- The promise-vs-enforcement gap that Phase 0 has been closing on the
  *code* side (every ADR ships an enforcement test) was open on the
  *docs* side — defensible facts in customer-facing docs had no
  guardrail
- Procurement is a literal-reading exercise. A stale "1,464 tests"
  claim is read as "the platform has not grown in 6 months" — a
  credibility hit no marketing copy recovers
- We don't want to turn doc edits into a CI battleground —
  free-form prose should stay free-form. Only **numeric** and
  **structural** claims that have a single source of truth in the
  repo are candidates for floor-testing
- The test must catch real drift without producing false positives
  on normal doc work — a floor (≥ N) is friendlier than an exact
  match (= N exactly)

## Considered options

1. **Floor tests on a small set of high-stakes numeric / structural
   claims in customer-facing docs** (chosen)
2. Exact-match tests (e.g. "soc2-readiness.md must say exactly
   '3,212 tests'")
3. LLM-based doc reviewer in CI
4. Manual quarterly sweep, no CI
5. Generate the numbers from code (e.g. `{{TEST_COUNT}}` template
   replaced at build time)

## Decision outcome

**Chosen option: floor tests in
[`test/docs-staleness.test.js`](../../test/docs-staleness.test.js)
that enforce monotonic-growth claims on the docs whose drift
costs the most credibility.**

The current floor set:

| Claim type | Docs in scope | Rule |
|---|---|---|
| Test-count claims | `CLAUDE.md`, `docs/security/soc2-readiness.md`, `docs/security/dpa-template.md` | Any "N tests" / "N cases" claim must satisfy `N ≥ 3000` |
| Orchestrator tool count | `docs/billion-dollar-plan.md`, `docs/architecture/03-component-ai-layer.md` | Any "merges N tools" claim must satisfy `N ≥ 25` (sanity-checked against the real count at module load) |
| ADR cross-reference | `CLAUDE.md`, `docs/security/soc2-readiness.md` | Must reference `docs/adr/` somewhere — the ADR catalogue is the binding policy surface |
| Security-doc freshness | `docs/security/{soc2-readiness, dpa-template, data-flow, subprocessors, audit-trail, incident-response}.md` | The "Last reviewed: YYYY-MM-DD" header must be ≤ 365 days old |

**Floors, not exact values.** Numeric claims are allowed to drift
upward (the suite grows; the orchestrator gains tools). They are
**not** allowed to drift downward — a "1,464 tests" claim in a doc
when the suite is at 3,200+ is a stale-claim bug, no matter how
fresh the prose around it looks.

**Reasonable allowance for no-claim docs.** A doc that simply
doesn't make a numeric claim (e.g. "the suite is green" without
a number) passes the floor test trivially — we're not forcing
every doc to cite a count, only ensuring claims that do appear
are honest.

### Consequences

- **Good:** the three specific instances P0.14 fixed cannot
  silently re-regress; a future PR that touches CLAUDE.md / the
  security docs / billion-dollar-plan with a stale number fails
  CI with a clear "below floor" message
- **Good:** the test file is the natural place to add new floor
  rules as new high-stakes claims appear in docs (e.g. "≥ N
  agents," "≥ N regulations covered," "≥ N tests for the
  calculator surface specifically")
- **Good:** the security-doc freshness check (365 days) is a
  procurement-grade signal — quarterly review cadence is the
  intent; the test makes "no one is looking after this folder"
  visible at PR time
- **Bad:** no enforcement against *new* drift outside the named
  doc list. A new doc that quotes a stale number won't be
  caught until someone remembers to add it to the test. Tolerated
  — over-broad regex matching across all `.md` files would
  produce too many false positives
- **Bad:** the floor cadence has to be updated by hand when a
  claim genuinely warrants raising. A future enhancement could
  derive the floor from the actual suite size, but coupling the
  floor to live state is the opposite of what a floor test is for
  (a floor is the *minimum credible claim*, not the current
  number)
- **Neutral:** the freshness check is calendar-based, not
  content-based — a doc reviewer who bumps only the date without
  reading the content passes the test. Acceptable: the test is
  about *catching neglect*, not validating thoroughness; the
  human review is the thoroughness step

### Confirmation

**Enforced as of PR #30 (Phase 0 P0.14).**

- [test/docs-staleness.test.js](../../test/docs-staleness.test.js)
  — 9 tests across 4 rule classes (test-count floor on 3 docs;
  tool-count floor on 2 docs + sanity-check against real
  orchestrator at module load; ADR catalogue cross-reference
  required from 2 docs; 365-day Last-reviewed freshness on 6
  security docs).

**Known gaps (Phase 1+):**

- Coverage is the named doc list, not "every `.md` in the repo."
  As new high-stakes docs land (e.g. a public trust centre, a
  pricing page with cited capability stats), add them to the
  rule sets in `docs/staleness.test.js`
- The 365-day freshness threshold is calendar-only. A Phase 1
  enhancement could pair it with git-blame age on the file
  contents (so a "only-date-bumped" review fails the test)
- A "ADR catalogue must cover at least N records" floor isn't
  enforced. As ADR counts grow, this becomes worth pinning so a
  rogue revert that deletes ADRs is visible at PR time

## Pros and cons of the options

### Floor tests on named docs (chosen)

- **Good, because:** catches the specific drift class observed
  (numeric claims) without over-policing prose
- **Good, because:** runs in <250 ms; no new CI infrastructure
- **Bad, because:** scope is hand-maintained — a new high-stakes
  doc could slip through until someone adds it to the list

### Exact-match tests

- **Good, because:** catches drift in both directions
- **Bad, because:** every test-count growth would require a
  matching doc edit + test edit — turns doc updates into a
  three-place coordination dance
- **Bad, because:** false-positive heavy on prose rewording

### LLM-based doc reviewer in CI

- **Good, because:** in principle catches any claim drift, not
  just numeric
- **Bad, because:** non-deterministic; cost per run; would
  require the same eval-gate infrastructure to keep the reviewer
  itself honest (reviewer regresses → who reviews the reviewer?)
- **Reconsider in Phase 2** if doc surface grows past what
  hand-maintained floor rules can cover

### Manual quarterly sweep, no CI

- **Bad, because:** this is what we had pre-P0.14. The "1,464
  tests" claim sat for months because the quarterly sweep didn't
  happen on time

### Generated numbers via build-time template substitution

- **Good, because:** eliminates the drift class entirely (the
  number is always live)
- **Bad, because:** introduces a build step on a repo that
  deliberately has none (the docs are checked-in markdown, no
  generator). Adding a build step *just for doc numerics* is
  scope creep
- **Bad, because:** generated content reads as marketing; a
  human-written "3,200+ tests" carries more credibility than a
  generated "3,212 tests" exact figure that drifts every commit
- **Reconsider in Phase 1** if we move the docs into a real
  static-site generator (e.g. as part of the marketing-shell
  Next.js migration), where templating is already in play

## Related decisions

- [0001 — Record architecture decisions in ADRs](0001-record-architecture-decisions.md)
  — the ADR catalogue this test protects the cross-reference to
- [0012 — Branch protection policy](0012-branch-protection-policy.md)
  — adding `test/docs-staleness.test.js` to the suite means a
  doc-only PR with a stale number now fails the same `test (20)` /
  `test (22)` required check that gates code changes
- [0017 — PR-time smoke gate](0017-pr-smoke-as-deploy-gate.md) and
  [0018 — Eval gate](0018-eval-gate-post-merge-95pct.md) — the
  pattern of "load-bearing claim + enforcement test + ADR" applied
  to deploys + agent reasoning; this ADR extends it to docs

## More information

- [test/docs-staleness.test.js](../../test/docs-staleness.test.js)
  — the test itself
- [docs/execution-plan.md](../execution-plan.md) — Phase 0 task
  **P0.14** is the work this ADR records
