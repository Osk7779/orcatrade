# Apply branch-protection policy on `main`

## When to use this runbook

- One-off, after PR #16 (P0.C, this PR) merges
- Re-apply if branch protection is ever disabled / drift detected
- Update + re-apply if [ADR 0012](../adr/0012-branch-protection-policy.md)
  changes (e.g. new required check added when a future workflow lands)

## Prerequisites

- Admin access to `Osk7779/orcatrade` on GitHub
- One of:
  - [GitHub CLI (`gh`)](https://cli.github.com/) authenticated as an
    admin — preferred path
  - Or the GitHub web UI (Settings → Branches)

## Procedure — gh CLI (preferred, one command)

The policy from [ADR 0012](../adr/0012-branch-protection-policy.md) as a
JSON payload. Copy + run:

```bash
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  /repos/Osk7779/orcatrade/branches/main/protection \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "test (20)",
      "test (22)",
      "typecheck",
      "commitlint",
      "evals (offline)",
      "pr-smoke",
      "codeql / analyse (javascript-typescript)",
      "gitleaks / scan"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1,
    "require_last_push_approval": true
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": true
}
EOF
```

> `"strict": true` means PRs must be **up-to-date** with `main` before
> merge — guards against merging stale code that passes CI in isolation
> but breaks against the latest `main`.

> `"contexts"` lists check names exactly as GitHub reports them. If a
> check is renamed in its workflow, this list must be updated in the
> same PR or the gate breaks silently.

## Procedure — GitHub web UI (fallback)

1. **Settings → Branches → Branch protection rules → Add rule**
2. **Branch name pattern:** `main`
3. Check **Require a pull request before merging**
   - **Required approvals:** 1
   - Check **Dismiss stale pull request approvals when new commits are pushed**
   - Check **Require review from Code Owners**
   - Check **Require approval of the most recent reviewable push**
4. Check **Require status checks to pass before merging**
   - Check **Require branches to be up to date before merging**
   - Search + add each of: `test (20)`, `test (22)`, `typecheck`,
     `commitlint`, `evals (offline)`, `pr-smoke`, `codeql / analyse (javascript-typescript)`,
     `gitleaks / scan`
5. Check **Require conversation resolution before merging**
6. Check **Require linear history**
7. Check **Do not allow bypassing the above settings** (so admins
   can't bypass — important for the corp-grade bar)
8. **Do not** check "Restrict who can push to matching branches" —
   the PR flow is the only path to `main`, so push restrictions
   would only block administrative recovery (which we still want
   available in emergencies)
9. **Create**

## Verification

After applying:

1. Open a tiny test PR against a fresh branch
2. Try to merge it **without** the required checks complete → GitHub
   should refuse with "Required statuses must pass before merging"
3. Try to merge it **without** an approval → GitHub should refuse with
   "At least 1 approving review is required by reviewers with write
   access"
4. Try to push directly to `main` → GitHub should refuse with
   "protected branch"
5. Close the test PR + delete the branch (don't merge)

If any step (2-4) doesn't refuse, the policy isn't applied correctly —
re-run the `gh api` command + verify the response is `200`.

## Re-applying when a new required check lands

When a new workflow ships (e.g. P0.J's OpenAPI validation), update the
`contexts` array in this runbook + re-run the `gh api` command. The
ADR 0012 §"Status check inventory" table should also be updated in the
same PR.

## Rollback

If the policy breaks emergency recovery (very unlikely):

```bash
gh api \
  --method DELETE \
  -H "Accept: application/vnd.github+json" \
  /repos/Osk7779/orcatrade/branches/main/protection
```

This removes **all** branch protection on `main`. Use only as a
last-resort recovery step + re-apply the policy immediately after
the underlying issue is resolved.

## Related

- [ADR 0012 — Branch protection policy](../adr/0012-branch-protection-policy.md)
- [.github/CODEOWNERS](../../.github/CODEOWNERS)
- [docs/handbook/review-checklist.md](../handbook/review-checklist.md) —
  the human-side review discipline that complements the machine-side
  gates
- [GitHub branch protection API reference](https://docs.github.com/en/rest/branches/branch-protection)
