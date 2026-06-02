# Live AI-eval gate: post-merge, ≥95% pass-rate per agent, hard fail

- **Status:** Accepted
- **Date:** 2026-05-31
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Future agent / prompt / tool-schema authors; on-call;
  reviewers running through `docs/handbook/review-checklist.md`

## Context and problem statement

OrcaTrade has three distinct eval signals on the AI surface:

1. **Offline scorer + coverage tests** (`npm test` →
   [test/ai-evals.test.js](../../test/ai-evals.test.js) +
   [lib/ai/evals/scorer.js](../../lib/ai/evals/scorer.js)) — runs on
   every push, free, no Anthropic API. Catches structural mistakes:
   missing tool wiring, missing prompt-registry entries, eval cases
   that don't conform to the schema. Required check today
   (`evals (offline)`).
2. **Nightly comprehensive live eval** (`.github/workflows/evals.yml`)
   — runs at 02:00 UTC against the real Anthropic API, 100%-strict
   ("any failure fails the workflow"). Email-on-failure. Detects
   slow drift (e.g. a model version change quietly degraded a tool
   call pattern overnight).
3. **(missing until P0.15)** — a **post-merge** live-eval gate that
   answers "did the merge that just landed regress the agents?"
   The nightly catches it eventually, but in the worst case a
   regression sits on `main` for up to 24 hours, customer-facing,
   before anyone hears about it. The offline scorer is too coarse
   to catch reasoning regressions (e.g. agent stops calling the
   compliance tool when CBAM is mentioned).

The 2026-05-30 audit flagged this as a gap; P0.15 ships it.

## Decision drivers

- The signal must trigger on the **specific merge** that broke
  things, so the revert target is unambiguous (nightly aggregates
  ~24h of merges)
- Cost must stay bounded — live evals are not free (Opus + tool-use
  loops); per-PR is wasteful, post-merge is targeted
- Failure must be **hard** — workflow goes red, repo owner gets
  emailed, ops opens a revert
- The threshold must allow a small tolerance for case-level
  flakiness (one borderline case shouldn't roll back the whole
  merge) — but be high enough that real regressions are caught
- Must coexist with the existing nightly without confusion
  (different jobs, different SLAs, different on-call response)

## Considered options

1. **Post-merge gate on `push: main`, AI-path-scoped, matrix per
   agent, `--threshold 0.95`, hard fail** (chosen)
2. PR-time live-eval gate on `pull_request`
3. Promote the nightly to fire on every push to `main` with
   100%-strict semantics
4. Lower the threshold to "first eval failure exits 1" but bypass
   on `[skip-eval]` commit-message tag
5. Status quo — nightly only

## Decision outcome

**Chosen option: a new workflow
[`.github/workflows/eval-gate.yml`](../../.github/workflows/eval-gate.yml)
that fires on `push: main` (path-scoped to AI-relevant code),
runs all 5 agents in a `fail-fast: false` matrix, and invokes
`scripts/agent-eval.js --threshold 0.95` per agent. A
below-threshold result fails the workflow → GitHub emails the
repo owner → on-call follows the runbook to revert + investigate.**

Concretely:

### Trigger
- `push: branches: [main]`
- `paths:` filter restricts to agent handlers
  (`lib/handlers/{agent,orchestrator,*-agent}.js`), the AI library
  tree (`lib/ai/**`), the calculator tree (`lib/intelligence/**`),
  the runner script (`scripts/agent-eval.js`), and the workflow
  file itself (so CI-only edits that change gate behaviour also
  trigger a verification run)
- `workflow_dispatch` for manual re-runs / single-agent runs / a
  custom threshold

### Concurrency
- Group `eval-gate-${{ github.sha }}` with **no** `cancel-in-progress`.
  If two consecutive commits both land on `main` while a gate run
  is in flight, we want BOTH gate results — otherwise a regression
  spanning two commits has an ambiguous revert target.

### Matrix + threshold
- 5 agents in parallel (`orchestrator`, `compliance`, `finance`,
  `logistics`, `sourcing`)
- `fail-fast: false` so one agent failure doesn't mask another
- Each agent's job invokes
  `node scripts/agent-eval.js --agent <agent> --threshold 0.95`
- The runner exits 0 when (passes / total) ≥ threshold, else 1
- The threshold is per-agent. The aggregate gate is implicit:
  *all 5 jobs must succeed* for the workflow to succeed

### Secret handling
- If `ANTHROPIC_API_KEY` is unset (e.g. forks, staging
  environments), the eval step emits a `::warning::` annotation
  and exits 0 rather than failing the gate. Documented in the
  ai-agent-failure runbook so on-call knows "missing key →
  advisory pass, investigate immediately"

### `scripts/agent-eval.js` changes
- New `--threshold <0-1 fraction OR 1-100 percent>` flag
- Default threshold = `1.0` (strict; preserves the legacy
  semantics that the nightly + manual runs depend on)
- `parseThreshold` rejects out-of-range values so a fat-fingered
  `--threshold 95.5` doesn't silently pass everything

### Consequences

- **Good:** the merge that broke the agent reasoning is the one
  that fails CI; the revert target is unambiguous; the customer-
  exposure window shrinks from "up to 24h" to "the duration of
  one eval run" (≈3-5 min)
- **Good:** path-scoped triggering means doc-only / SEO-rotation
  pushes don't spend Anthropic budget on no-op evals
- **Good:** the nightly comprehensive workflow keeps its
  100%-strict semantics and its 24h cadence — distinct signal,
  distinct meaning ("nothing has drifted overnight" vs "the last
  merge didn't regress")
- **Good:** the threshold default in the runner stays strict
  (1.0), so the only thing the CI gate softens is its own per-run
  posture — every other invocation (nightly, manual) is unchanged
- **Bad:** the gate fails *after* the merge is live, not before.
  A regression is customer-facing for ~3-5 min before the gate
  surfaces it (vs ~hours of preview-deploy testing for a hard
  pre-merge gate). Mitigation: per-PR live eval is too expensive
  to mandate (see "cost" in §"Pros and cons"); the
  [pr-smoke](../../.github/workflows/pr-smoke.yml) gate already
  catches crash-class regressions on the preview deploy. The
  ≤5min window for reasoning regressions is the accepted residual
- **Bad:** the threshold is per-agent rather than aggregate. With
  current corpora (5-10 cases per agent), 95% is effectively
  "all must pass" except for the orchestrator. As corpora grow
  the threshold becomes more meaningful; a Phase 1 follow-up may
  add an aggregate gate as a second-stage check
- **Bad:** any Anthropic outage during a `main` push fails the
  gate — an external-availability dependency the team can't
  control. Mitigation: re-run on `workflow_dispatch` is one
  click; the `concurrency: no-cancel` design ensures the re-run
  produces a clean signal

### Confirmation

**Enforced as of PR #29 (Phase 0 P0.15).**

- [test/eval-gate-workflow.test.js](../../test/eval-gate-workflow.test.js)
  — 9 tests pinning the workflow shape: triggers on `push: main`,
  does NOT fire on `pull_request`, has the required `paths:`
  scope (named handler list + `lib/ai/**` + `lib/intelligence/**`
  + runner script + workflow self-reference), matrix covers all
  5 agents, `fail-fast: false`, runner invocation includes
  `--threshold`, default threshold is `0.95` in **both** the
  `workflow_dispatch` input AND the push-trigger env fallback
  (drift between the two would let manual + automatic runs
  apply different gates to the same commit), graceful skip on
  missing `ANTHROPIC_API_KEY`.
- [test/agent-eval-script.test.js](../../test/agent-eval-script.test.js)
  — 5 added tests covering the new `--threshold` flag: default
  `1.0`, fraction form (`--threshold 0.95`), percent form
  (`--threshold=95`), full-strict in both forms (`1` and `100`),
  combines with `--agent`.

**Known gaps (Phase 1+):**

- Per-agent thresholds vs aggregate threshold — see "Bad"
  above. Phase 1 P1.x can add an aggregate gate job that depends
  on the matrix
- No automatic revert on gate failure — by design, but a Phase 2
  enhancement could open a draft PR reverting the offending
  commit + linking the failing eval run
- No per-case retry on a single transient failure — currently
  each case runs once; flakes that resolve on retry still count
  against the threshold. Acceptable for now given the 0.95
  tolerance band; revisit if observed flake rate exceeds 5%
- The "missing key → advisory pass" path is a soft gate that
  could be exploited by a malicious actor who deletes the
  secret. Phase 1 can add a separate enforcement test that
  fails CI if `ANTHROPIC_API_KEY` is not set in the
  `repository_secrets` listing (the GitHub API exposes secret
  *names* even though values stay opaque)

## Pros and cons of the options

### Post-merge gate (chosen)

- **Good, because:** the failing commit is the failing-gate
  signal; revert target unambiguous
- **Good, because:** cost bounded by `paths:` filter; ~$5-7 per
  AI-touching merge, not per push
- **Good, because:** preserves the nightly's 100%-strict
  semantics for a separate signal class
- **Bad, because:** post-merge means ~5min of customer exposure
  on a regression. Acceptable given the cost tradeoff and the
  pre-merge crash protection from `pr-smoke`

### PR-time live-eval gate

- **Good, because:** regression caught before merge — zero
  customer exposure
- **Bad, because:** cost. 29 cases × ~10k tokens × Opus rate
  × N pushes/day = ~$50-100/day at current branch activity,
  more if branches see iterative pushes
- **Bad, because:** flaky cases would block merges; the 95%
  tolerance band still permits 1-2 failures per agent which is
  fine for "did the merge regress?" signal but feels
  unprincipled as a pre-merge gate
- **Reconsider in Phase 2** when revenue justifies the spend

### Promote nightly to per-push, 100%-strict

- **Good, because:** simplest one-workflow design
- **Bad, because:** breaks the existing "nightly is the
  comprehensive run" mental model — operators currently treat
  a nightly failure as "thorough investigation needed" and a
  per-push failure as "revert + investigate." Conflating them
  loses signal
- **Bad, because:** 100%-strict on every push is hostile to
  case-level flakes — see "PR-time" above

### Skip-eval commit-message tag

- **Good, because:** lets emergency fixes bypass the gate
- **Bad, because:** the tag is the failure mode — every
  emergency fix turns into "did the gate run or not?" and the
  log becomes ambiguous; the workflow_dispatch escape hatch
  is cleaner

### Status quo (nightly only)

- **Bad, because:** the 24h customer-exposure window for
  reasoning regressions is the gap P0.15 exists to close.
  Unacceptable for a trade-compliance product

## Related decisions

- [0002 — The LLM never produces a number that drives a business
  decision](0002-llm-never-produces-decision-numbers.md) — the
  eval scorer's calc-grounding mode (`--require-grounding`)
  enforces this rule on the LLM's text output; the gate is the
  CI enforcement of the eval signal
- [0003 — Anthropic SDK boundary](0003-anthropic-sdk-boundary.md)
  — the gate runs the real agent handlers; any drift in the
  SDK-boundary discipline shows up as a tool-call regression
- [0012 — Branch protection policy](0012-branch-protection-policy.md)
  — `eval-gate` is **not** in the required-contexts list (it
  fires post-merge; same posture as `smoke` per
  [ADR 0017](0017-pr-smoke-as-deploy-gate.md))
- [0016 — `lookupHsCode` calculator-grounded](0016-hs-code-lookup-calculator-grounded.md)
  — the kind of agent surface this gate protects: a regression
  that makes `lookupHsCode` start returning placeholder shapes
  again would be caught by the orchestrator/compliance eval cases

## More information

- [.github/workflows/eval-gate.yml](../../.github/workflows/eval-gate.yml)
- [.github/workflows/evals.yml](../../.github/workflows/evals.yml) —
  the nightly comprehensive runner
- [scripts/agent-eval.js](../../scripts/agent-eval.js) — the
  per-agent runner with the new `--threshold` flag
- [lib/ai/evals/](../../lib/ai/evals/) — case files + scorer
- [docs/runbooks/ai-agent-failure.md](../runbooks/ai-agent-failure.md)
  — drain procedure for an eval-gate red signal
- [docs/execution-plan.md](../execution-plan.md) — Phase 0 task
  **P0.15** is the work this ADR records
