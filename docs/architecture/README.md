# Architecture

Visual entry point to OrcaTrade's architecture, using the
[C4 model](https://c4model.com/) (Simon Brown). Four levels of zoom;
this directory covers three of them.

| Level | What it shows | This directory |
|---|---|---|
| **L1 — System Context** | OrcaTrade as one box, surrounded by its users + external systems | [01-system-context.md](01-system-context.md) |
| **L2 — Container** | The major technical building blocks (Vercel function, Next.js shells, KV, PG, etc.) | [02-container.md](02-container.md) |
| **L3 — Component** | Components within a container | [03-component-ai-layer.md](03-component-ai-layer.md) (AI/agent layer) · [03-component-data-layer.md](03-component-data-layer.md) (KV+PG dual-write) |
| L4 — Code | Class-level detail | Not maintained; the code is the source of truth at this level |

## Why C4 + why these diagrams

Text-only documentation (CLAUDE.md, the handbook, ADRs, runbooks) doesn't
answer the question "what talks to what?" at a glance. Reviewers,
auditors, future hires, and AI pairs all need a 30-second visual entry
point. C4 is the most widely adopted lightweight model for the job.

These five diagrams cover the architectural shapes that are unique to
OrcaTrade and would be hard to reconstruct from reading code:

- **L1** — how OrcaTrade fits in its ecosystem (customer + 8 third
  parties)
- **L2** — how the single-Vercel-function dispatcher + the two Next.js
  shells + the KV-primary/PG-mirror data layer + the external dependencies
  fit together
- **L3 AI** — the model registry / prompt registry / runtime / cost
  telemetry / eval layout, plus how the agent loop calls calculators
  without violating ADR 0002 or ADR 0003
- **L3 data** — the KV-primary / PG-mirror / `schema_versions` runner /
  audit chain layout, plus the open gap (7 PG tables written to but
  not yet defined in `schema.sql`, per the 2026-05-30 audit)

L3 for the handler dispatcher is **not** in this directory — the
text in CLAUDE.md + the runbooks + [api/[...path].js](../../api/[...path].js)
itself cover that shape adequately.

## Why Mermaid (not Structurizr / PlantUML)

See [ADR 0013](../adr/0013-c4-diagrams-via-mermaid.md). Headline: GitHub
natively renders Mermaid C4 syntax in markdown — no build step, no
binary artefacts, no CI workflow needed. The diagrams version with
the code as plain text.

## Updating the diagrams

1. Edit the relevant `0?-*.md` file
2. Verify the Mermaid syntax via [GitHub's preview](https://github.com/Osk7779/orcatrade/blob/main/docs/architecture/01-system-context.md)
   or the [Mermaid Live Editor](https://mermaid.live/)
3. If the change reflects an architectural decision (touching money,
   audit, PII, AI tool surface, public API contract, data layer, or
   security boundary), update or open an ADR alongside per
   [standing order #12](../execution-plan.md)
4. Open a PR through the standard flow

## When to add a new diagram

- **New L3 view** when a container's component layout becomes
  non-obvious (a third or fourth agent specialism would justify a
  diagram; a single new handler would not)
- **L1 update** when a new external dependency is added (sub-processor
  added to [docs/handbook/security.md](../handbook/security.md))
- **L2 update** when a major technical building block is added (new
  storage system, new shell, etc.)

Resist the urge to diagram every change — diagrams that need updating
on every PR rot and stop being trusted.

## Out of scope

- **Deployment diagram** — Vercel's dashboard is the canonical source
  for what's deployed where; duplicating it as a diagram would drift
- **Sequence diagrams** for specific flows — the runbooks +
  [api/[...path].js](../../api/[...path].js) cover individual flows
  better than a static diagram
- **L4 / code diagrams** — too low-level; the TypeScript types + JSDoc
  cover this layer (per [ADR 0010](../adr/0010-typescript-incremental-adoption.md))
