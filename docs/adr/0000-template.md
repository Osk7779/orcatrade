<!--
OrcaTrade ADR template (P0.A, Phase 0 Wave 2 of docs/execution-plan.md).

Copy this file to docs/adr/NNNN-kebab-case-title.md, where NNNN is the
next unused four-digit number. Keep ADRs concise — typically 80-150
lines. The audience is "future me, six months from now, asking why."

Sections marked (REQUIRED) gate review. Drop optional sections only if
they would be empty; do not delete the headers and write "N/A" instead.
-->

# {short title — representative of decision, max ~10 words}

- **Status:** {Proposed | Accepted | Deprecated | Superseded by NNNN}
- **Date:** {YYYY-MM-DD when last updated}
- **Decision-makers:** {names; for OrcaTrade today, typically "Oskar + Claude"}
- **Consulted:** {subject-matter experts whose input was sought; can be N/A}
- **Informed:** {who needs to know after; can be N/A}

## Context and problem statement (REQUIRED)

<!--
Two or three paragraphs. What's the situation? What forces are in play?
What problem needs to be solved? An illustrative concrete scenario helps.
-->

## Decision drivers (REQUIRED)

<!-- 2-5 bullets. The criteria that matter most for choosing between options. -->

- {driver 1}
- {driver 2}

## Considered options (REQUIRED)

<!-- 2-4 options. Include the "do nothing" option if non-trivial. -->

1. {option A}
2. {option B}
3. {option C}

## Decision outcome (REQUIRED)

**Chosen option: {option N}.**

<!-- One or two paragraphs explaining the choice + the main reasoning. -->

### Consequences

- **Good:** {1-3 bullets}
- **Bad:** {1-3 bullets}
- **Neutral:** {0-2 bullets}

### Confirmation (REQUIRED)

<!--
How do we know the decision actually holds in the running system?
Cite the test, monitor, runbook, or process. If the decision is not yet
enforced, say so explicitly + link to the follow-up that will enforce it.
"Documented but not enforced" is allowed once, recorded here as debt.
-->

## Pros and cons of the options

<!-- One subsection per considered option. Keep tight. -->

### {option A}

- **Good, because:** …
- **Bad, because:** …

### {option B}

- **Good, because:** …
- **Bad, because:** …

## Related decisions

<!-- Links to other ADRs. "Builds on", "Supersedes", "Conflicts with", etc. -->

- {link to related ADR with short note}

## More information

<!-- Optional. Background reading, design docs, PR links, post-mortems, etc. -->
