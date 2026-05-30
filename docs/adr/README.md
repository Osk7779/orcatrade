# Architecture Decision Records

This directory contains OrcaTrade's **Architecture Decision Records** (ADRs):
one short markdown file per significant architectural decision. They form
the project's institutional memory — the answer to "why does it work like
this?" and "what alternatives did we consider?"

## When to write an ADR

Per [docs/execution-plan.md](../execution-plan.md) §2 standing order #12,
any change touching one of these must be accompanied by an ADR (new file
under `docs/adr/NNNN-title.md`) **before** the code change ships:

- Money arithmetic
- Audit trail
- PII handling
- AI tool surface or LLM-call boundary
- Public API contract (`/api/v1/*`, `/api/v2/*`, …)
- Data layer (KV ↔ Postgres, schema, retention)
- Security boundary (auth, authz, secrets, sub-processors)

For routine changes (a bug fix, a copy tweak, a new test), no ADR is
needed — the conventional commit message + PR description is enough.

## Format

ADRs use a lightly trimmed [MADR](https://adr.github.io/madr/) template
(see [0000-template.md](0000-template.md)). Sections:

- **Status** + decision-makers + date
- **Context and problem statement**
- **Decision drivers**
- **Considered options**
- **Decision outcome** (the choice + reasoning)
- **Consequences** (good / bad / neutral)
- **Confirmation** — how the ADR is enforced (test, monitor, runbook)
- **Related decisions** — links to other ADRs

## Numbering

Filenames: `NNNN-kebab-case-title.md`, zero-padded to four digits,
monotonic, never re-used. The number is assigned by the author when
opening the PR; if two PRs race for the same number, the second rebases.

## Status lifecycle

```
Proposed  →  Accepted  →  Deprecated
                       ↘   Superseded by NNNN
```

An accepted ADR is never edited substantively. If the decision changes,
write a **new** ADR that supersedes the old one and update the old one's
status field to `Superseded by NNNN-new-title.md`. This preserves the
audit trail of why the decision evolved.

## Current ADRs

| # | Title | Status |
|---|---|---|
| [0000](0000-template.md) | Template | — |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions in ADRs | Accepted |
| [0002](0002-llm-never-produces-decision-numbers.md) | The LLM never produces a number that drives a business decision | Accepted |
| [0003](0003-anthropic-sdk-boundary.md) | Anthropic SDK and LLM-API calls are bounded to `lib/handlers/` and `lib/ai/` | Accepted |
| [0004](0004-integer-cents-money.md) | Money arithmetic is integer cents through `lib/intelligence/money.js` | Accepted |
| [0005](0005-audit-log-before-success.md) | Audit-log writes precede success responses on every mutation | Accepted |
| [0006](0006-circuit-breaker-on-external-calls.md) | Every external HTTP call is wrapped in `lib/circuit.js` | Accepted |
| [0007](0007-api-v1-stable-contracts.md) | Public API contracts under `/api/vN/` are stable per version | Accepted |
| [0008](0008-email-pseudonymisation.md) | Email is stored only as a salted server-side pseudonym | Accepted |
| [0009](0009-conventional-commits-release-please.md) | Conventional commits + release-please + SemVer for `CHANGELOG.md` | Accepted |
| [0010](0010-typescript-incremental-adoption.md) | Incremental TypeScript adoption: opt-in `@ts-check` per file, new files `.ts` | Accepted |
| [0011](0011-security-scanning-stack.md) | Security scanning stack: CodeQL + gitleaks + Dependabot + Snyk + CycloneDX SBOM | Accepted |
| [0012](0012-branch-protection-policy.md) | Branch protection on `main`: required checks + Code Owner review + linear history | Accepted |
| [0013](0013-c4-diagrams-via-mermaid.md) | C4 architecture diagrams via Mermaid C4 syntax in markdown (deviates from plan's Structurizr suggestion) | Accepted |
| [0014](0014-openapi-generated-from-contracts.md) | OpenAPI 3.1 specification generated from `lib/contracts/v1/`, not hand-authored | Accepted |
| [0015](0015-human-review-queue.md) | Human-review escalation is a real KV-backed queue, not a stubbed tool | Accepted |
| [0016](0016-hs-code-lookup-calculator-grounded.md) | `lookupHsCode` is calculator-grounded — curated HS6 map + opt-in TARIC enrichment, never an LLM guess | Accepted |

## Background

ADRs were introduced on 2026-05-30 as Phase 0 task P0.A of the execution
plan, alongside a backfill of nine ADRs covering hard rules and
conventions that had been informal until then. The audit on 2026-05-30
exposed a pattern of defined-but-not-enforced rules; recording them as
ADRs + linking each to an enforcement test (where one exists) makes
intentional drift visible and unintentional drift impossible.
