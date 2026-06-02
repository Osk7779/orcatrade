# Security scanning stack: CodeQL + gitleaks + Dependabot + Snyk + CycloneDX SBOM

- **Status:** Accepted
- **Date:** 2026-05-30
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Future contributors; security / compliance reviewers; procurement reviewers

## Context and problem statement

The 2026-05-30 audit found OrcaTrade had no static analysis (SAST), no
secrets scanning, no automated dependency management, no SCA, and no
SBOM. For a platform processing customer data + filing into customs +
banking workflows, that's incompatible with the corp-grade bar set in
[docs/execution-plan.md](../execution-plan.md) and the SOC 2 Type II /
ISO 27001 path in Phases 3-5.

Procurement reviewers ask for these gates by name in standard security
questionnaires (SIG Lite, CAIQ). Not having them is a vendor-fitness
signal. Having them but choosing badly (e.g. one heavyweight tool that
overlaps with three others) is wasteful. Phase 0 task P0.D needed an
explicit stack choice.

## Decision drivers

- Cover SAST + secrets + dep updates + SCA + SBOM with minimum tool
  sprawl
- Free or near-free for OrcaTrade's current scale (pre-funding,
  pre-revenue)
- Run in CI on every PR + push, results visible to author + reviewer
- Block merge on high-severity findings (vs warn-only)
- Compatible with the existing single-Vercel-function architecture
  (CI runs in GitHub Actions, doesn't impact runtime)
- Outputs procurement reviewers recognise (CycloneDX, SARIF, etc.)

## Considered options

1. **CodeQL + gitleaks + Dependabot + Snyk + CycloneDX SBOM** ✓
2. Snyk-only (Snyk Code for SAST, Snyk Open Source for SCA, Snyk
   Container, Snyk IaC) — one vendor, full stack
3. Semgrep (SAST) + Trufflehog (secrets) + Renovate (deps) + Trivy (SCA)
   + Syft (SBOM) — every layer "best-of-breed"
4. Endor Labs / Aikido / Wiz / Apiiro — modern unified ASPM platforms
5. Do nothing for Phase 0; add later when a paying customer asks

## Decision outcome

**Chosen option: CodeQL + gitleaks + Dependabot + Snyk + CycloneDX SBOM.**

Each tool covers one layer well; no two overlap meaningfully on a small
JS/TS Node project:

| Tool | Layer | Cost today | Cost at scale |
|---|---|---|---|
| **CodeQL** | SAST (our source) | Free (private repos via GitHub) | Free |
| **gitleaks** | Secrets in git history + diffs | Free (OSS action) | Free |
| **Dependabot** | Automated dep update PRs | Free (GitHub native) | Free |
| **Snyk** | SCA (CVEs in deps, including transitives) | Free tier (200 tests/month, OSS unlimited) | $98/mo for the Team tier when we cross the threshold |
| **@cyclonedx/cyclonedx-npm** | SBOM per release | Free (npm package) | Free |

### Why not Snyk-only

Snyk's full suite (Code + Open Source + Container + IaC) would cover
SAST + SCA + SBOM in one vendor. We get a coherent dashboard.
**But:**

- Snyk Code (SAST) is paid above small-org tier; CodeQL is free for
  GitHub-hosted repos forever — significant differential
- Snyk doesn't ship a secrets scanner; we'd still add gitleaks or
  similar
- Single-vendor lock-in is a meaningful risk for a security tool; a
  Snyk pricing change would force a stack-wide migration
- Dependabot is GitHub-native — no reason to use Snyk's equivalent
  (`snyk fix`) for the *update* flow when Snyk's value is the *detect*
  flow

### Why not "best-of-breed" (Semgrep + Trufflehog + Renovate + Trivy + Syft)

Each one is excellent. **But:**

- Five tools = five sets of CI configs, five sets of secret rotations,
  five sets of triage queues. Maintenance cost compounds.
- CodeQL ≈ Semgrep for our size; Trufflehog ≈ gitleaks; Renovate ≈
  Dependabot; Trivy adds container scanning we don't need yet; Syft ≈
  CycloneDX-npm but more general
- We'd be paying maintenance cost in exchange for marginal coverage
  improvement. Defer to Phase 4+ when scale justifies the swap.

### Why not unified ASPM (Endor/Aikido/Wiz/Apiiro)

These are excellent modern platforms. But:

- All commercial-only. Even the cheapest is well above the Snyk Team
  tier we'd otherwise pay for.
- Procurement reviewers ask "do you use CodeQL?" — answering "no, we
  use Endor" requires education even though Endor is more capable
- Mature OrcaTrade past Phase 2 before reconsidering — by then we may
  have a CISO consultant who has an opinion

### Why "do something" at Phase 0 instead of deferring

- The audit named the gap; documenting "we'll add it later" is exactly
  the *defined-but-not-enforced* anti-pattern the execution plan
  rejects
- Every PR from Wave 1 onwards has been measured against the corp-grade
  bar in docs/execution-plan.md §3, which lists SAST + dep review +
  secrets scanning + SBOM by name
- First paying enterprise (Phase 2 P2.F, security questionnaire
  library) needs answers in the affirmative

### Consequences

- **Good:** four new CI gates running on every PR (CodeQL, gitleaks,
  Snyk, plus Dependabot opening PRs on its own schedule) and SBOM
  generation per release
- **Good:** SOC 2 + ISO 27001 evidence trail starts accruing
  immediately
- **Good:** procurement questionnaires answerable affirmatively for
  SAST / secrets / SCA / dependency management / SBOM
- **Bad:** five new tools = five new triage queues. Most early findings
  will be in transitive deps or low-severity smell; we'll need a
  habit of "Monday morning: skim Dependabot + Snyk PR queue"
- **Bad:** Snyk requires SNYK_TOKEN; if the secret isn't added, that
  job skips. Acceptable interim posture (the workflow's `if:` condition
  + `continue-on-error` make this graceful) but a real gap until the
  token is added
- **Neutral:** Dependabot will open a flurry of PRs in week 1 as it
  catches up to current dep status. Bundle minor/patch updates per
  the config; review majors individually

### Confirmation

After this PR merges, the following are observable:

1. **CodeQL** results in the repo's Security → Code scanning tab,
   refreshed on every PR + push + weekly cron
2. **gitleaks** runs on every PR; planted secrets fail the check
   (manual mutation test documented in the PR body)
3. **Dependabot** opens its first round of PRs the Monday after merge
   (or immediately for any open security advisories)
4. **Snyk** scan in the PR's checks tab (skipped until SNYK_TOKEN is
   added; documented in the workflow file header)
5. **SBOM** auto-generated and uploaded as a release asset on the
   next release-please publish (chain dependency: release-please from
   PR #11, also pending merge)

Branch protection (Phase 0 Wave 3 P0.C) will make these required
checks, blocking merge if any fails. Until P0.C lands, the workflows
run + report but don't yet gate merge.

## Pros and cons of the options

### CodeQL + gitleaks + Dependabot + Snyk + CycloneDX (chosen)

- **Good, because:** each layer covered by the best free/cheap option
- **Good, because:** procurement-recognised tool names
- **Good, because:** zero coupling — any one tool can be swapped later
  without breaking the others
- **Bad, because:** five separate workflows to maintain

### Snyk-only

- **Good, because:** single vendor, single triage queue
- **Bad, because:** Snyk Code (SAST) is paid; we'd still need gitleaks
- **Bad, because:** vendor lock-in

### Best-of-breed

- **Good, because:** each layer is genuinely best
- **Bad, because:** maintenance cost compounds for marginal benefit

### Unified ASPM

- **Bad, because:** all paid; not procurement-recognised by default

### Do nothing

- **Bad, because:** defined-but-not-enforced anti-pattern

## Related decisions

- [0001 — Record architecture decisions](0001-record-architecture-decisions.md) —
  this ADR is the 11th written; per standing order #12, security-stack
  selection qualifies
- Phase 0 Wave 3 task P0.C ([docs/execution-plan.md](../execution-plan.md)) —
  branch protection that makes the new workflows required-checks
- Phase 3 task P3.5 — annual external pen test (complements SAST/SCA
  with adversarial testing)
- Phase 3 task P3.6 — private bug bounty (complements automated tools
  with human researcher economics)

## More information

- [CodeQL documentation](https://codeql.github.com/)
- [gitleaks-action](https://github.com/gitleaks/gitleaks-action)
- [Dependabot configuration reference](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot-yml-file)
- [Snyk Actions](https://github.com/snyk/actions)
- [CycloneDX npm](https://github.com/CycloneDX/cyclonedx-node-npm)
- [OWASP CycloneDX overview](https://cyclonedx.org/)
- The 2026-05-30 audit findings on "no SAST / no secrets scan / no SCA"
  were the trigger for this ADR
