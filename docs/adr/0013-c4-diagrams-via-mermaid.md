# C4 architecture diagrams via Mermaid C4 syntax in markdown

- **Status:** Accepted
- **Date:** 2026-05-30
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Future contributors + reviewers + auditors who need a visual entry point to the architecture

## Context and problem statement

OrcaTrade has grown to the point where text-only documentation (CLAUDE.md,
the handbook, ADRs, runbooks) doesn't answer the question "what talks
to what?" at a glance. Reviewers, auditors, and future hires need a
30-second visual entry. Phase 0 task P0.I in
[docs/execution-plan.md](../execution-plan.md) named this gap.

The plan suggested **Structurizr Lite** + a CI workflow to auto-render
diagrams. The choice of diagramming tool is the question this ADR
records — Structurizr was a reasonable default, but Mermaid (rendered
natively by GitHub) is a meaningfully better fit for OrcaTrade at this
scale.

## Decision drivers

- Reviewers + auditors + future hires read the diagrams on GitHub —
  no separate tool to learn
- Diagrams version with the code as plain text
- Zero build step + zero binary artefacts committed (binary diff bloat,
  CI flakiness, "did anyone regenerate the PNGs?" drift)
- Editable in a normal text editor; no Docker / Java / Graphviz install
- Substantive C4 model support — proper boxes, relationships, boundaries
- Acceptable layout quality — auto-layout is fine; doesn't have to be
  pixel-perfect
- Future-proof: the project might genuinely outgrow this choice in
  Phase 4+; keep the migration cost low

## Considered options

1. **Mermaid C4 syntax in markdown files** ✓
2. Structurizr DSL + Structurizr Lite Docker (the execution plan's
   suggestion)
3. PlantUML with the C4-PlantUML library, rendered via CI to SVG
4. Hand-drawn diagrams in Figma / draw.io / Excalidraw, exported as PNG
5. No diagrams — text-only documentation continues to suffice

## Decision outcome

**Chosen option: Mermaid C4 syntax in markdown files.** GitHub renders
Mermaid C4 diagrams natively in any markdown file. The diagrams live
in `docs/architecture/` as plain markdown alongside other docs. No CI
workflow, no Docker, no committed images.

Five diagrams in the initial set:

- **L1 — System Context** ([01-system-context.md](../architecture/01-system-context.md))
- **L2 — Container** ([02-container.md](../architecture/02-container.md))
- **L3 — AI layer** ([03-component-ai-layer.md](../architecture/03-component-ai-layer.md))
- **L3 — Data layer** ([03-component-data-layer.md](../architecture/03-component-data-layer.md))

A README at [docs/architecture/README.md](../architecture/README.md)
indexes the set + documents when to add new diagrams.

### Why not Structurizr (the plan's original suggestion)

- Reviewers + auditors don't have Structurizr Lite running locally;
  they'd need to either trust a generated PNG/SVG in the repo or run
  Docker
- Structurizr's DSL is more powerful than Mermaid C4 at the cost of
  more learning curve for every reader + author
- Auto-render in CI is doable but adds another workflow + artefact
  management
- The advantages (rich workspaces, deep-link navigation between views,
  proper layout engine) matter at ~30+ diagrams across multiple systems;
  at our 5-diagram scale they're overhead

### Why not PlantUML + C4-PlantUML

- Java dependency in CI
- Output is PNG/SVG committed to the repo (drift risk + diff bloat)
- Reviewers don't see the diagram on GitHub without clicking through
  to the rendered file
- Mermaid does the same job natively

### Why not hand-drawn (Figma / draw.io)

- Drifts from reality immediately; no enforcement loop
- Editable only by the original author
- Doesn't fit the "docs version with code" principle from the handbook

### Why not "no diagrams"

- The 2026-05-30 audit named the gap; per standing order #4 (promise =
  enforcement) and #15 (corp-grade bar = "would this withstand a
  procurement security questionnaire") a competent reviewer asks for
  architecture diagrams

### Consequences

- **Good:** zero build step, zero CI workflow, zero binary artefacts
- **Good:** every diagram is a plain markdown file editable by anyone
  with `vim` or VS Code
- **Good:** GitHub renders the diagrams in PR previews, in the file
  view, in markdown READMEs
- **Good:** Mermaid Live Editor (https://mermaid.live/) is the universal
  "preview before commit" tool
- **Bad:** Mermaid C4 is less feature-rich than Structurizr; complex
  layouts (e.g. a 30-element diagram with deliberate grouping) become
  awkward. Mitigation: if we ever need that scale, the migration is
  straightforward — Mermaid is human-readable, can be translated to
  Structurizr DSL by hand if needed
- **Bad:** no auto-validation that the diagram matches the code (e.g.
  a renamed module won't trip a diagram update). Mitigation: the L3
  diagrams' "diagram refresh schedule" sections enumerate the planned
  changes that will require updates, tied to specific Phase 1+ task
  IDs

### Confirmation

- The five diagrams in [docs/architecture/](../architecture/) are the
  initial set
- A reviewer can open any of them on GitHub and see the rendered C4
  diagram inline without leaving the browser
- The [README index](../architecture/README.md) documents the diagram
  set + the update policy ("update when an architectural change ships;
  no diagram-only PRs")

## Pros and cons of the options

### Mermaid C4 in markdown (chosen)

- **Good, because:** GitHub-native rendering; zero build step; readable
  source
- **Good, because:** every reader sees the same diagram without setup
- **Bad, because:** less feature-rich than Structurizr at scale

### Structurizr Lite + CI auto-render

- **Good, because:** powerful DSL; multiple views per workspace; rich
  layout
- **Bad, because:** another tool to learn; Docker dependency; committed
  binary artefacts or fetch-from-CI complexity

### PlantUML + C4-PlantUML

- **Good, because:** mature C4 support
- **Bad, because:** Java dependency; binary outputs; GitHub doesn't
  render natively

### Hand-drawn (Figma / draw.io)

- **Good, because:** maximum aesthetic control
- **Bad, because:** rots immediately; not under source control in a
  reviewable way

### No diagrams

- **Bad, because:** the 2026-05-30 audit's gap; fails the corp-grade
  bar; reviewers / auditors ask for them

## Related decisions

- [0001 — Record architecture decisions](0001-record-architecture-decisions.md) —
  ADRs are the "why"; C4 diagrams are the "what talks to what"; they
  complement each other
- [docs/execution-plan.md](../execution-plan.md) Phase 0 task P0.I —
  the task this ADR + the diagrams close. The plan's original
  Structurizr suggestion is superseded here.

## More information

- [c4model.com](https://c4model.com/) — Simon Brown's original C4
  model documentation
- [Mermaid C4 syntax](https://mermaid.js.org/syntax/c4.html) — the
  official spec for the diagram syntax used in this directory
- [Mermaid Live Editor](https://mermaid.live/) — preview tool for
  before-commit diagram editing
- The 2026-05-30 audit identified "no architecture diagram, no C4"
  as a corp-grade gap; this ADR + the diagrams close that finding
