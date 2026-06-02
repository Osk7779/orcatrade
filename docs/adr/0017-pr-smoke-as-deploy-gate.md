# PR-time smoke (`pr-smoke`) is the merge gate; post-deploy `smoke` is the tripwire

- **Status:** Accepted
- **Date:** 2026-05-31
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Future workflow authors; reviewers running through
  `docs/handbook/review-checklist.md`

## Context and problem statement

[`.github/workflows/smoke.yml`](../../.github/workflows/smoke.yml)
ships a script ([scripts/smoke.js](../../scripts/smoke.js)) that
performs a handful of HTTP probes against the live site to catch
deploy regressions — SCIM handler still registered, `/api/audit`
still admin-gated, app-shell route still resolving, etc. Until
2026-05-31 the workflow triggered **only on `push: main`**: it
sleeps 90 seconds for Vercel's auto-deploy to settle, then probes
production.

This had two problems for the corp-grade bar:

1. **It cannot block a merge.** By the time `smoke` fails, the bad
   bundle is already live. Customers get the regression; the
   workflow is only useful as a post-mortem signal.
2. **It was listed in
   [docs/runbooks/repo-settings-branch-protection.md](../runbooks/repo-settings-branch-protection.md)
   as a required status check** under the name `smoke`. But the
   workflow never fires against a PR head SHA, so GitHub's
   branch-protection treated the required `smoke` context as
   permanently "Expected" — silently broken merge gating, no one
   noticing because everything else still required passing checks.

[ADR 0012 §"Status check inventory"](0012-branch-protection-policy.md)
already flagged this with the parenthetical "*when wired as a
deploy gate, P0.9*" — promising the fix this ADR records.

## Decision drivers

- The merge gate must actually gate merges (rule #2 of the standing
  orders: promise = enforcement)
- The post-deploy probe still has value as a tripwire that catches
  prod-only regressions (preview-env vs prod-env config drift,
  edge-cache state, KV warmness)
- We are on Vercel Hobby/zero-dep posture: no new CI secrets, no
  third-party actions, no Vercel CLI in the workflow
- The check name reported by GitHub must equal the string listed
  in the branch-protection runbook — drift is a silent gate break

## Considered options

1. **Two-stage staged-smoke: a new `pr-smoke.yml` triggered on
   `pull_request` events that waits for the Vercel preview deploy
   and probes that URL, while `smoke.yml` stays post-deploy as a
   tripwire** (chosen)
2. Make `smoke.yml` itself fire on `pull_request` (one workflow,
   conditional logic for "is this a PR or main push?")
3. Block the Vercel deploy itself behind smoke — move off Vercel's
   auto-deploy and onto a manual `vercel deploy --prebuilt` step
   gated by smoke success
4. Use a third-party action (e.g. `patrickedqvist/wait-for-vercel-preview`)
   to resolve the preview URL
5. Keep `smoke` as-is, accept that merge gating only happens after
   the deploy is live, document the gap

## Decision outcome

**Chosen option: `pr-smoke.yml` is the merge gate; `smoke.yml` is
the post-deploy tripwire.** Two distinct workflows, two distinct
required-context names, two distinct purposes — both load-bearing.

[`.github/workflows/pr-smoke.yml`](../../.github/workflows/pr-smoke.yml):

- Triggers on `pull_request` (opened / synchronize / reopened /
  ready_for_review). Skips drafts.
- Uses `concurrency: pr-smoke-${{ pr.number }}` with
  `cancel-in-progress: true` so a new push cancels the previous
  run (the new push gets a new Vercel preview anyway).
- Polls the GitHub Deployments API for a `success` status against
  the PR head SHA's `Preview` deployment, 10-minute timeout. No
  Vercel CLI, no new secret — the built-in `GITHUB_TOKEN` is
  enough. Vercel's GitHub integration already publishes the
  deployment status; we just read it.
- On success, runs `scripts/smoke.js --base <preview-url>` —
  exactly the same probes the post-deploy `smoke.yml` runs against
  prod.
- Job key `pr-smoke` → GitHub reports the context as `pr-smoke`,
  which is the string the runbook lists.

[`.github/workflows/smoke.yml`](../../.github/workflows/smoke.yml)
stays unchanged:

- Triggers on `push: main` + `workflow_dispatch`.
- Same script, hits production.
- **Not listed** as a required context (would create permanent
  "Expected" pending on every PR). It's a tripwire — on failure it
  emails the repo owner and surfaces a rollback signal, not a merge
  gate.

The runbook's `contexts` list now reads:

```
test (20), test (22), typecheck, commitlint, evals (offline),
pr-smoke, codeql / analyse (javascript-typescript), gitleaks / scan
```

— with `smoke` removed. The runbook also gains a "Why `smoke` is
NOT in required contexts (post-P0.9)" section pointing at this ADR.

### Consequences

- **Good:** the merge gate is actually load-bearing; a PR that
  breaks `/api/health`, `/api/scim`, `/api/audit`, `/trust/`,
  `/changelog/`, or `/app/operations` on its preview cannot merge
- **Good:** the post-deploy `smoke.yml` keeps catching the things
  preview-env can't (KV cold-start, prod env drift, edge cache),
  with no behavioural change
- **Good:** zero new secrets, zero new CI dependencies — the
  GitHub-native deployments API gives us everything
- **Good:** the runbook + ADR + workflow are pinned in sync by
  [test/branch-protection-sync.test.js](../../test/branch-protection-sync.test.js)
  — drift fails the unit suite
- **Bad:** PRs without a Vercel preview (e.g. if Vercel is
  degraded) hit the 10-minute timeout and the check fails. This
  is correct fail-closed behaviour — a PR with no preview can't be
  smoke-tested — but it adds an external-availability dependency
  to merge speed. Mitigation: `workflow_dispatch` on the post-deploy
  `smoke.yml` is still a manual escape hatch (run prod smoke + use
  the ADR 0012 "admin enforce_admins" bypass dance only in real
  emergencies, document in incident report)
- **Bad:** the workflow does ~10 minutes of polling overhead for
  every PR push. Acceptable — Vercel previews typically appear
  within 60-90s; the 10-minute cap is for the long tail
- **Neutral:** the script (`scripts/smoke.js`) is shared between
  both workflows. A breaking change to the script's CLI must
  update both — neither workflow knows about the other

### Confirmation

**Enforced as of PR #28 (Phase 0 P0.9).**

- [test/branch-protection-sync.test.js](../../test/branch-protection-sync.test.js)
  — 9 tests pinning the runbook's `contexts` JSON block, the
  runbook's web-UI procedure, ADR 0012's required-checks table,
  and the shape of `.github/workflows/pr-smoke.yml` (triggers on
  `pull_request`, job key `pr-smoke`, polls the deployments API,
  invokes `scripts/smoke.js --base`). Also pins that
  `smoke.yml` still triggers on `push: main` AND does NOT fire
  on `pull_request` (which would make it compete with `pr-smoke`).
- The canonical contexts list is duplicated only in the source-pin
  test; the runbook + ADR are both validated against it.

**Operational follow-up:**

- Re-apply the branch-protection policy via the runbook so the
  `contexts` list reflects the new `pr-smoke` entry — one-off after
  this PR merges. Procedure already in
  [docs/runbooks/repo-settings-branch-protection.md](../runbooks/repo-settings-branch-protection.md).
- The very first PR after this merge will be the first one with a
  `pr-smoke` check — confirm the workflow resolves the Vercel
  preview URL successfully and the smoke probes pass before
  promoting the check from "required" if any teething issues
  surface.

**Known gaps (Phase 1+):**

- Preview env vars may diverge from prod (Vercel's Preview env can
  have different secrets); `scripts/smoke.js`'s probes are
  deliberately auth-gate / route-exists checks that work without
  any business-logic env vars, but a future probe that needs
  business-logic env (e.g. asserting `/api/quote-rebrand` returns
  the right margin) would need preview-env coverage. Track per
  added probe.
- The 10-minute Vercel-preview timeout is a hard cap; if Vercel
  cold-start times grow, this needs raising. Monitor.
- A failed `pr-smoke` run produces a log line in the action log
  but no inline annotation on the PR diff for the failing probe.
  Phase 1 can add `::error file=…` annotations from `smoke.js`.

## Pros and cons of the options

### Two-stage staged-smoke (chosen)

- **Good, because:** clean separation — one workflow gates merges,
  one watches production; either failing is an actionable signal
  in a different place
- **Good, because:** zero new secrets / dependencies
- **Bad, because:** the smoke script is shared but the workflows
  are not — risk of one being updated without the other (mitigated
  by the pinning test)

### One workflow with branch-conditional logic

- **Good, because:** single workflow to maintain
- **Bad, because:** the trigger blocks become unreadable
  (`if: github.event_name == 'pull_request' && ...`); failures in
  the PR path and the main path show up as the same check name,
  making "which run was that" ambiguous in branch-protection

### Block Vercel auto-deploy behind smoke

- **Good, because:** the most defensible deploy posture (nothing
  goes live until smoke passes against a staged build)
- **Bad, because:** moves us off Vercel's auto-deploy ergonomics
  (one of the platform's main value props); requires Vercel CLI +
  token in CI; adds significant complexity for the marginal value
  over PR-time gating + post-deploy tripwire
- **Reconsider in Phase 2** when the platform is large enough that
  a rolling-deploy posture (per Vercel's Rolling Releases GA-June-2025)
  is worth the operational overhead

### Third-party preview-URL action

- **Good, because:** less YAML to maintain in our repo
- **Bad, because:** adds an external dependency to the merge gate
  — a third-party action being unmaintained / breaking is now a
  merge-blocker for the whole repo. The GitHub Deployments API
  resolution we wrote is ~25 lines of shell against a stable
  GitHub-native API; the maintenance burden is essentially zero

### Status quo (smoke = post-deploy only)

- **Bad, because:** the merge gate doesn't exist, only the
  post-mortem signal does. Documented as broken in ADR 0012;
  P0.9 is the explicit promise to fix it

## Related decisions

- [0012 — Branch protection policy](0012-branch-protection-policy.md)
  — the policy this workflow plugs into; required-checks table
  updated by this PR to swap `smoke` → `pr-smoke`
- [0005 — Audit-log writes precede success responses](0005-audit-log-before-success.md)
  — `pr-smoke` would catch a regression where a mutation handler
  starts returning 200 with no audit row (because the probes
  exercise mutation paths)
- [0006 — Circuit breaker on external calls](0006-circuit-breaker-on-external-calls.md)
  — `pr-smoke`'s probes are best-effort timeouts; they fail fast
  rather than wedging the workflow

## More information

- [.github/workflows/pr-smoke.yml](../../.github/workflows/pr-smoke.yml)
- [.github/workflows/smoke.yml](../../.github/workflows/smoke.yml)
- [scripts/smoke.js](../../scripts/smoke.js)
- [docs/runbooks/repo-settings-branch-protection.md](../runbooks/repo-settings-branch-protection.md)
- [docs/execution-plan.md](../execution-plan.md) — Phase 0 task
  **P0.9** is the work this ADR records
- [GitHub Deployments API reference](https://docs.github.com/en/rest/deployments/deployments)
