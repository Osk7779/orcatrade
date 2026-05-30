# Branch protection on `main`: required checks + Code Owner review + linear history

- **Status:** Accepted
- **Date:** 2026-05-30
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Future contributors; future engineer #2; security / compliance reviewers

## Context and problem statement

After Wave 1 + Wave 2 + Wave 3 P0.D, OrcaTrade has eight CI gates
configured (`test`, `typecheck`, `commitlint`, `evals`, `smoke`,
`codeql`, `gitleaks`, `snyk`). Without branch protection, these gates
**report** results but don't **block** anything — a PR with a failing
typecheck or a planted secret can still be merged by clicking "Merge"
in the GitHub UI. The discipline lives in human review; the machine
verification is advisory.

That's exactly the *defined-but-not-enforced* anti-pattern the execution
plan exists to eliminate. For the corp-grade bar — and for SOC 2
change-management evidence in Phase 3+ — the rule "all CI gates pass
before merge" must be machine-enforced, not policy-enforced.

Branch protection is GitHub's native mechanism. The question is which
checks to require, what review policy, what other guardrails.

## Decision drivers

- Every CI gate built across PRs #5-#15 must actually block merge when
  it fails
- Linear history (no merge commits) — keeps `git bisect` honest and
  `git log --oneline` readable
- Stale-PR protection — a PR that passed CI 3 days ago against an
  outdated `main` doesn't get to merge without re-verification
- Two-eyes discipline ([standing order #11](../execution-plan.md)) —
  even when the team is one engineer + AI, the human gate is
  load-bearing
- Admin-bypassable settings defeat the purpose; the protection must
  apply to admins too
- Recoverable in genuine emergency (the runbook documents the
  removal command)

## Considered options

1. **Branch protection on `main` with all CI checks required, 1 review,
   Code Owners, linear history, no admin bypass** ✓
2. Branch protection with only "soft" required checks (`test`, `typecheck`);
   leave security checks (`codeql`, `gitleaks`, `snyk`) as advisory
3. No branch protection; rely on PR template + reviewer discipline
4. Use Rulesets (the newer GitHub feature) instead of classic Branch
   Protection rules

## Decision outcome

**Chosen option: branch protection on `main` with all CI checks
required, 1 review, Code Owners, linear history, no admin bypass.**

### Required status checks

The full list, ordered by where in the dev loop they catch issues:

| Check (GitHub context name) | Source workflow | Catches |
|---|---|---|
| `commitlint` | [.github/workflows/commitlint.yml](../../.github/workflows/commitlint.yml) | Non-conventional commit messages |
| `typecheck` | [.github/workflows/typecheck.yml](../../.github/workflows/typecheck.yml) | TypeScript type holes in `@ts-check` files + `.ts` files |
| `test (20)` + `test (22)` | [.github/workflows/test.yml](../../.github/workflows/test.yml) | Unit + contract test failures on both supported Node versions |
| `evals (offline)` | [.github/workflows/evals.yml](../../.github/workflows/evals.yml) | Agent eval regressions on the offline scorer (the live eval is nightly, advisory) |
| `pr-smoke` | [.github/workflows/pr-smoke.yml](../../.github/workflows/pr-smoke.yml) | PR-time gate: waits for Vercel preview, probes the preview URL via [scripts/smoke.js](../../scripts/smoke.js). The merge-gating sibling of `smoke` (which fires post-deploy). Per [ADR 0017](0017-pr-smoke-as-deploy-gate.md). |
| `codeql / analyse (javascript-typescript)` | [.github/workflows/codeql.yml](../../.github/workflows/codeql.yml) | SAST findings in our own source |
| `gitleaks / scan` | [.github/workflows/gitleaks.yml](../../.github/workflows/gitleaks.yml) | Secrets in commits / diffs |

**Snyk is deliberately NOT required yet.** Until the `SNYK_TOKEN`
repo secret is added (one-off post-merge step from PR #15), the Snyk
job skips. Requiring it now would block every PR until the token is
added. After the token is added, this ADR + the runbook are updated
to add `snyk / scan` to the required list — separate PR for that
change so the policy change is visible.

### Pull request requirements

- **1 approval required.** With only Oskar today, this is the
  "Reviewed by Oskar" gate codified. When engineer #2 joins, the
  rule already supports two-person review (no policy change needed).
- **Dismiss stale reviews on new push** — an approval doesn't carry
  forward after the author pushes new commits, so a "looks-good-to-me"
  doesn't approve unseen changes.
- **Require review from Code Owners** — combined with
  [.github/CODEOWNERS](../../.github/CODEOWNERS) which lists Oskar as
  the default owner. When ownership delegates (post-hire #2), the
  CODEOWNERS file is the single source of truth.
- **Require approval of the most recent reviewable push** — closes the
  classic "approve-then-sneak-in-a-bad-change" attack.

### Other guardrails

- **Require branches to be up to date before merging** (`strict: true`) —
  PR must be rebased / merged with the latest `main` before merge,
  guards against the "passes CI in isolation, breaks against latest
  main" pattern
- **Require linear history** — squash-merge or rebase-merge only,
  no merge commits. Keeps `git bisect` clean.
- **Require conversation resolution before merging** — every review
  comment must be marked resolved before merge
- **Disallow force pushes** — preserves history
- **Disallow deletions** — `main` can't be accidentally `git push --delete`-d
- **Enforce on admins** — Oskar (the admin) gets the same protection
  as everyone else. **Critical for the corp-grade bar:** an
  admin-bypassable rule is no rule
- **Do NOT restrict push access** — the PR flow is the only path to
  `main` regardless; push restriction would only block emergency
  recovery

### Application path

This ADR + a runbook ([docs/runbooks/repo-settings-branch-protection.md](../runbooks/repo-settings-branch-protection.md))
ship together in PR #16. After merge, Oskar applies the policy in
one `gh api` command (or via the UI). The runbook also includes the
removal command for emergency recovery.

### Consequences

- **Good:** every CI gate built across Phase 0 actually blocks merge
- **Good:** SOC 2 + ISO 27001 evidence: "we have change-management
  controls + they're machine-enforced + admin-non-bypassable"
- **Good:** the "passes locally, breaks on main" failure mode is
  caught before merge, not after
- **Good:** stale-review attack closed
- **Bad:** when a CI gate is flaky, the entire flow stalls until it's
  fixed. Mitigation: tests are deterministic + offline; flakiness is
  a SEV2 to fix, not a workaround
- **Bad:** adding a new workflow requires updating the protection
  policy too; if forgotten, the new check runs but doesn't gate. The
  runbook + the ADR §"Status check inventory" table are the
  reminder; a future Phase 1 follow-up could auto-sync the required
  contexts from the workflow files
- **Neutral:** Snyk is excluded from required-checks until the
  `SNYK_TOKEN` is added — documented gap, closed by a small follow-up
  PR

### Confirmation

Three verifications, documented in
[docs/runbooks/repo-settings-branch-protection.md](../runbooks/repo-settings-branch-protection.md):

1. **Open a test PR** and try to merge with failing CI → GitHub refuses
2. **Open a test PR** and try to merge without an approval → GitHub
   refuses
3. **Try to push directly to `main`** → GitHub refuses

Anyone with admin access can re-verify any time via the runbook.

### Maintenance: adding a new required check

When a future PR adds a CI workflow (e.g. P0.J OpenAPI validation,
P0.4 audit-write-non-swallow test), the same PR must:

1. Update [docs/runbooks/repo-settings-branch-protection.md](../runbooks/repo-settings-branch-protection.md)
   `contexts` array
2. Update this ADR's §"Status check inventory" table
3. Note in the PR body: "After merge: re-run the `gh api` command in
   the runbook to add `<new check name>` to required contexts"

Forgetting one of these means the check runs but doesn't gate — not
a security issue, but a gap in the discipline. The PR template's
"Docs updated" checklist + the review-checklist help catch it.

## Pros and cons of the options

### Full branch protection (chosen)

- **Good, because:** every Phase 0 CI gate becomes load-bearing
- **Good, because:** admin-non-bypassable + linear history + stale-review
  protection are all corp-grade defaults
- **Bad, because:** flaky tests block the whole flow (mitigation: keep
  tests deterministic)

### Soft required checks (test + typecheck only)

- **Bad, because:** the security gates (CodeQL, gitleaks) and the
  discipline gates (commitlint) become optional; soft enforcement is
  the *defined-but-not-enforced* anti-pattern

### No branch protection at all

- **Bad, because:** human discipline alone is fragile; the whole
  Phase 0 investment in CI gates is wasted

### GitHub Rulesets

- **Good, because:** newer feature, more granular targeting, can apply
  same ruleset to multiple branches
- **Bad, because:** classic Branch Protection still works fine for a
  single-repo / single-branch use case; the migration cost isn't
  justified yet
- **Worth revisiting** in Phase 2 if we need ruleset-style overlapping
  policies (e.g. release branches with different rules)

## Related decisions

- [0001 — Record architecture decisions](0001-record-architecture-decisions.md) —
  the discipline framework this ADR enforces
- [0009 — Conventional commits + release-please](0009-conventional-commits-release-please.md) —
  `commitlint` is a required check; ADR 0009 introduced it
- [0010 — Incremental TypeScript adoption](0010-typescript-incremental-adoption.md) —
  `typecheck` is a required check; ADR 0010 introduced it
- [0011 — Security scanning stack](0011-security-scanning-stack.md) —
  `codeql`, `gitleaks` are required checks; ADR 0011 introduced them.
  `snyk` will be added once `SNYK_TOKEN` lands

## More information

- [GitHub branch protection documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [.github/CODEOWNERS](../../.github/CODEOWNERS) — the code-ownership
  delegation file this ADR's "Require review from Code Owners" setting
  enforces
- The 2026-05-30 audit's standing-order #4 ("promise = enforcement") is
  the broader principle this ADR operationalises
