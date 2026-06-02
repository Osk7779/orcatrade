<!--
OrcaTrade PR template (P0.F, Phase 0 Wave 2 of docs/execution-plan.md).

Fill in every applicable section. Sections marked (REQUIRED) gate merge.
If a section is genuinely N/A, write "N/A — <one-line reason>" so reviewers
can see the deliberate choice. Do NOT delete sections.

The bar: would this withstand a procurement security questionnaire?
(Standing order 15 of docs/execution-plan.md §2.)
-->

## Summary (REQUIRED)

<!-- One paragraph. What changes, why now, and what user-visible effect (if any). -->
<!-- If this PR is from the execution plan, cite the task ID: "Phase X task PX.Y of docs/execution-plan.md". -->



## Problem & options considered

<!-- What problem does this solve? What alternatives did you weigh, and why this one? -->
<!-- Short is fine. Skip if the change is obviously correct (e.g. dead-code removal). -->



## What changed

<!-- A table of files/areas touched + the nature of the change. Forces you to surface anything sneaky. -->

| Area | Change |
|---|---|
| | |

## Acceptance criteria (REQUIRED)

<!-- Checkboxes that explicitly define "done" for this PR. Tick as you complete them. Reviewer ticks the last one. -->

- [ ]
- [ ]
- [ ] Reviewed by Oskar

## Test plan (REQUIRED)

<!-- How you verified the change locally + what CI must pass. Mutation tests count double. -->

- [ ] Local: `ORCATRADE_DISABLE_LIVE_TARIC=1 node --test` → exit 0
- [ ] New / changed tests are mutation-tested where applicable (planting a regression makes them fail)
- [ ] CI green on the PR preview

## Rollback (REQUIRED)

<!-- One sentence: how do we undo this if it goes wrong? "Revert this commit." is acceptable only when truly safe. -->
<!-- For anything stateful (DB migration, KV writes, external side-effects), describe the data + cleanup steps. -->



## Threat model (REQUIRED)

<!--
STRIDE table for any change touching: auth, authz, money, PII, AI tool surface,
public API contract, data layer, security boundary, secrets, third-party calls.

For tests / pure docs / pure file-layout: "N/A — <one-line reason>" is fine.

STRIDE = Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege.
-->

| Vector | Considered? | Mitigation |
|---|---|---|
| Spoofing | | |
| Tampering | | |
| Repudiation | | |
| Information Disclosure | | |
| Denial of Service | | |
| Elevation of Privilege | | |

## ADR

<!--
If this PR touches money, audit, PII, AI tool surface, public API contract,
data layer, or any security boundary, link the ADR in docs/adr/ that records
the decision. (Standing order 12 of docs/execution-plan.md §2.)

If no ADR is needed, write "N/A — <one-line reason>".
-->



## Docs updated

<!--
Every claim that changes must update its docs IN THE SAME PR (promise = enforcement,
standing order 4). Tick what was updated:
-->

- [ ] CLAUDE.md
- [ ] docs/execution-plan.md (only if changing the plan itself)
- [ ] docs/security/*
- [ ] Marketing copy (*.html, /docs/* customer-facing)
- [ ] Memory (`.claude/projects/.../memory/`) — for convention/architectural changes
- [ ] N/A — no claim affected

## Linked issues / PRs / discoveries

<!-- "Closes #N", "Stacked on #M", "Discovered while doing #L", etc. Make the graph readable. -->


---

<!--
By submitting this PR you confirm:
  * Conventional commit message (feat/fix/chore/docs/refactor/test/perf/sec).
  * No claim ships without its enforcement test/monitor/process.
  * No fabricated metrics (per memory: pre-revenue stage).
  * If this introduces a public API contract change, it lands under /api/v2/ (or new).
-->
