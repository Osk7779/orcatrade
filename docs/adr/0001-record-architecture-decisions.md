# Record architecture decisions in ADRs

- **Status:** Accepted
- **Date:** 2026-05-30
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Future contributors; security/compliance reviewers; due-diligence reviewers

## Context and problem statement

OrcaTrade has accumulated a number of architectural rules — calculator-grounded
LLM, integer-cents money, audit-log-before-success, etc. — documented as prose
in [CLAUDE.md](../../CLAUDE.md) and scattered across `docs/`. The 2026-05-30
audit found a pattern of *defined-but-not-enforced* rules: claims that had
ossified into folklore with no traceability of why the rule existed or what
alternatives had been weighed.

A future engineer (or auditor, or due-diligence reviewer) asking "why does it
work like this?" today has no canonical answer. That's incompatible with the
big-corporation engineering bar set in [docs/execution-plan.md](../execution-plan.md).

## Decision drivers

- A single, discoverable source for "why" behind every architectural rule
- Make changes to architectural rules **visible** — adding/changing/superseding an ADR is itself a reviewable PR
- Cheap to write (otherwise nobody does)
- Cheap to read (otherwise nobody refers to them)
- Audit trail of *why* a decision evolved, not just what the current state is

## Considered options

1. **ADRs in `docs/adr/`, lightly-trimmed [MADR](https://adr.github.io/madr/) format**
2. Architecture documents in `docs/architecture/` (long-form designs, no decision history)
3. Decision log in a single `docs/decisions.md` (chronological, append-only)
4. Wiki / Notion / external doc tool

## Decision outcome

**Chosen option: ADRs in `docs/adr/`, lightly-trimmed MADR format.**

ADRs sit next to the code they govern, version with the code, are reviewed
through the same PR flow, and survive vendor changes. MADR is the most widely
adopted format in the industry; reducing it slightly (drop the Jekyll-frontmatter
defaults, keep status/date/decision-makers) keeps the ceremony low.

The numbering scheme (`NNNN-kebab-case-title.md`, monotonic, zero-padded)
makes ADRs trivially referenceable from PR descriptions, commit messages,
and other ADRs.

### Consequences

- **Good:** every architectural rule has a discoverable rationale + considered
  alternatives + confirmation method
- **Good:** changes to architectural rules are reviewable PRs, not silent drift
- **Good:** ADRs map cleanly onto SOC 2 control evidence ("change-management
  evidence for system design decisions")
- **Bad:** small overhead per architectural change (~20-40 min to write a tight
  ADR)
- **Neutral:** ADRs replace `CLAUDE.md`-as-rule-source over time; CLAUDE.md
  remains the orientation document for new contributors

### Confirmation

- The presence of this ADR and the eight backfilled ADRs (0002-0009) is the
  initial confirmation
- Going forward, [docs/execution-plan.md](../execution-plan.md) §2 standing order
  #12 requires an ADR for any change touching money/audit/PII/AI-tool-surface/
  public-API/data-layer/security-boundary; PR reviewers refuse merges that lack
  one
- The PR template ([.github/pull_request_template.md](../../.github/pull_request_template.md))
  has an `## ADR` section that must be filled in (with the ADR link or "N/A — reason")

## Pros and cons of the options

### ADRs in `docs/adr/` (chosen)

- **Good, because:** in-repo, version-controlled, PR-reviewed
- **Good, because:** survive vendor / tooling changes
- **Good, because:** linkable from commit messages and PR descriptions
- **Bad, because:** discoverability depends on engineers actually opening `docs/adr/`

### Architecture documents in `docs/architecture/`

- **Good, because:** can capture long-form designs
- **Bad, because:** no convention for capturing *why*, only *what*; no status lifecycle

### Single decision log

- **Good, because:** chronological ordering is natural
- **Bad, because:** one giant file becomes unreviewable; no per-decision discoverability

### Wiki / Notion

- **Bad, because:** out-of-band tools rot, drift from code, and don't survive vendor changes

## Related decisions

- This ADR's nine siblings ([0002](0002-llm-never-produces-decision-numbers.md)
  through [0009](0009-conventional-commits-release-please.md)) are the
  initial backfill
- [docs/execution-plan.md](../execution-plan.md) §2 standing order #12 codifies
  the "ADR-first" discipline

## More information

- [MADR project](https://adr.github.io/madr/) — the format this repo trimmed
- [Michael Nygard's original 2011 essay](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
  on lightweight ADRs
