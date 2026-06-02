# Conventional commits + release-please + SemVer for `CHANGELOG.md`

- **Status:** Accepted
- **Date:** 2026-05-30
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Future PR authors; procurement / due-diligence reviewers

## Context and problem statement

Wave 1 of the execution plan (PRs #5–#10) used Conventional Commits 1.0.0
syntax by hand: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
The discipline was visible but unenforced — a wrongly-shaped commit message
would still merge, and the project had no canonical `CHANGELOG.md`, no
versioning, no release tags. For a procurement reviewer asking "show me your
release history," the answer would have been "look at the GitHub commits."
That's not a release record; that's an activity log.

For the platform to support enterprise integrations + a public API in Phase 2,
versioning + a public changelog are prerequisites. Customers integrating
against `/api/v1/*` (per [ADR 0007](0007-api-v1-stable-contracts.md)) need
to be able to see what changed in each version, when it shipped, what
deprecated, what fixed a security issue, what was a breaking change.

## Decision drivers

- Procurement-readable release history (Features / Bug Fixes / Security /
  Performance / Refactoring sections — at-a-glance)
- Automated, no manual changelog curation
- Conventional Commits as the input — already in use by hand
- SemVer as the versioning grammar — standard for Node packages, integrates
  with `package.json`
- Enforceable at PR time, not just discoverable at release time

## Considered options

1. **release-please + commitlint + Conventional Commits 1.0.0**
2. [Changesets](https://github.com/changesets/changesets) (Vercel-popular; one
   markdown file per change describes the bump)
3. Hand-maintained `CHANGELOG.md` with a PR-template requirement to add an
   entry per PR
4. No formal changelog; rely on GitHub release notes per tag

## Decision outcome

**Chosen option: release-please for the output side; commitlint for the input
side; Conventional Commits 1.0.0 as the grammar; SemVer in `package.json`
and `.release-please-manifest.json`.**

### Pipeline

1. PR commit messages must conform to Conventional Commits, validated by
   [.github/workflows/commitlint.yml](../../.github/workflows/commitlint.yml)
   on every PR open/sync/edit. Wrong-shaped messages block merge.
2. On push to `main`, [.github/workflows/release-please.yml](../../.github/workflows/release-please.yml)
   runs the release-please action. It scans conventional commits since the
   last release.
3. If there are user-impacting commits (`feat`, `fix`, `perf`, `sec`,
   `refactor`, `revert`, `BREAKING CHANGE:`), release-please opens or
   updates a **Release PR** that bumps SemVer in `package.json` +
   `.release-please-manifest.json`, appends a new section to `CHANGELOG.md`
   grouped by type.
4. When the Release PR merges, release-please tags a GitHub Release and
   publishes the version.

### `sec` as a first-class type

Standard Conventional Commits doesn't define `sec`. OrcaTrade adds it so
security fixes appear under a dedicated `## Security` section in
`CHANGELOG.md` — a procurement / compliance reviewer reading the changelog
sees the security history at a glance instead of having to grep `fix:`
entries for security-shaped subjects. Matters for SOC 2 Type II observation
evidence in Phase 5; cheap to add today.

### Consequences

- **Good:** every shipped change traces to a conventional-commit SHA
- **Good:** `CHANGELOG.md` is machine-generated, tamper-evident (against the
  git-history baseline), procurement-readable
- **Good:** SemVer in `package.json` gives a stable version identifier for
  `/api/v1/*` consumers
- **Good:** `BREAKING CHANGE:` footer trips a major bump — visible to
  integrators
- **Bad:** every PR author must learn (or be reminded of) Conventional Commits
  syntax — mitigated by commitlint's blocking PR check + the PR template
  ([.github/pull_request_template.md](../../.github/pull_request_template.md))
  carrying the reminder in its footer
- **Bad:** release-please's PR clutter (one "chore: release X.Y.Z" PR per
  release cycle) — usually low-noise; the PR auto-updates rather than
  creating new ones
- **Neutral:** the styled human-facing [`/changelog/`](../../changelog/index.html)
  page stays hand-curated for editorial quality; `CHANGELOG.md` is the
  canonical machine record. A future polish PR can auto-render highlights
  between them if useful.

### Confirmation

- [.github/workflows/commitlint.yml](../../.github/workflows/commitlint.yml) —
  blocks merge on non-conventional commits
- [.github/workflows/release-please.yml](../../.github/workflows/release-please.yml) —
  generates `CHANGELOG.md` + version bumps + GitHub Releases
- [commitlint.config.js](../../commitlint.config.js) — enumerates allowed
  types (standard + `sec`); enforces `header-max-length: 100`
- [release-please-config.json](../../release-please-config.json) — section
  mapping; `sec` mapped to a dedicated `Security` section
- The first Release PR opens within minutes of the next `feat:` / `fix:` /
  `perf:` / `sec:` commit landing on main after PR #11 merges

### Repo settings prerequisite (one-off)

> Settings → Actions → General → Workflow permissions
> → **Read and write permissions** + **Allow GitHub Actions to create and
> approve pull requests**

Without those, release-please runs but cannot open the Release PR (silent
fail). Documented in the workflow file header.

## Pros and cons of the options

### release-please + commitlint (chosen)

- **Good, because:** Google's canonical Node release tooling — well-maintained,
  widely-used
- **Good, because:** dual-end enforcement (PR + release)
- **Good, because:** zero local npm install needed (uses `wagoid/commitlint-github-action`)
- **Bad, because:** one Release-PR overhead per release cycle

### Changesets

- **Good, because:** explicit per-PR change description
- **Bad, because:** designed for monorepos with multiple packages —
  over-spec'd for OrcaTrade's single-package shape
- **Bad, because:** adds `.changeset/*.md` per PR — more author work, not
  less

### Hand-maintained `CHANGELOG.md`

- **Good, because:** zero tooling overhead
- **Bad, because:** drifts immediately; "did anyone update the changelog?"
  every release
- **Bad, because:** manual curation is incompatible with the corp-grade
  promise=enforcement standing order

### No formal changelog

- **Bad, because:** procurement reviewers ask for one
- **Bad, because:** customers integrating against `/api/v1/*` need it

## Related decisions

- [0001 — Record architecture decisions](0001-record-architecture-decisions.md) —
  the meta-ADR; this ADR is the first one written *after* the backfill of
  hard rules, capturing a live decision rather than retrospectively
- [0007 — API v1 stable contracts](0007-api-v1-stable-contracts.md) —
  SemVer in `CHANGELOG.md` is what `/api/v1/*` integrators read to see
  what changed between releases

## More information

- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/)
- [release-please documentation](https://github.com/googleapis/release-please)
- [SemVer 2.0.0](https://semver.org/)
- This ADR was opened as part of PR #12 (P0.A), backfilled from the live
  decisions in PR #11 (P0.B)
