# Public API contracts under `/api/vN/` are stable per version

- **Status:** Accepted
- **Date:** 2026-05-30
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Future API authors; customer integrations team (Phase 2)

## Context and problem statement

OrcaTrade exposes a HTTP API today for the platform's own front-end + cron
jobs. In Phase 2 (per [docs/execution-plan.md](../execution-plan.md)) it will
expose a public-customer API consumed by enterprise integrations: ERPs,
custom dashboards, sales-engineering tools.

Once a customer integrates against an endpoint, the response shape becomes a
contract. Breaking it — renaming a field, changing a type, adding a required
input — breaks the customer's integration. Enterprises commit hours of
engineering work to integration; arbitrary breaking changes are a vendor-
fitness signal they pay attention to.

The historical practice is to version APIs in the URL path: `/api/v1/foo`,
`/api/v2/foo`. Each version is frozen; breaking changes go to a new
version; deprecation timelines are explicit (≥12 months between deprecation
notice and removal).

## Decision drivers

- Stability for integrations once contracts are live
- Allow internal evolution without breaking external consumers
- Make breaking changes visible (require a new version path) rather than silent
- Deprecation timeline customers can plan against

## Considered options

1. **URL versioning (`/api/v1/foo`, `/api/v2/foo`); frozen response schemas per version**
2. Header versioning (`Accept: application/vnd.orcatrade.v2+json`)
3. Single unversioned API; never break contracts
4. GraphQL with deprecation flags per field

## Decision outcome

**Chosen option: URL versioning. Schemas frozen per version. Breaking
changes go to a new version. Deprecation notices ≥12 months ahead of
removal. Schemas live in `lib/contracts/v1/` and are asserted by
[test/api-v1-contract.test.js](../../test/api-v1-contract.test.js).**

The dispatcher at [api/[...path].js](../../api/[...path].js) accepts both
the bare `/api/<name>` and `/api/v1/<name>` paths for the same handler
(line 154-169); both must resolve to identical response shapes. The
contract test freezes the v1 response shapes and fails on any change.

When a breaking change is needed, a new `lib/contracts/v2/` is added
alongside `v1`; the handler implements both paths until v1 is sunset.

### Consequences

- **Good:** customers can integrate with confidence
- **Good:** internal evolution doesn't gate on customer migration timelines
- **Good:** contract test fails loudly on accidental breakage
- **Bad:** maintaining multiple versions of the same endpoint costs
  engineering effort
- **Bad:** v1 deprecation requires customer communication + tracking
- **Neutral:** unversioned `/api/<name>` paths remain as aliases for v1
  during the current single-version era; new endpoints land directly under
  `/api/v1/`

### Confirmation

- [test/api-v1-contract.test.js](../../test/api-v1-contract.test.js) — frozen
  schemas for current v1 endpoints; fails on drift
- [lib/contracts/v1/](../../lib/contracts/) — the per-version contract
  modules (request validation + response shapes)
- [.github/workflows/test.yml](../../.github/workflows/test.yml) — runs the
  contract test on every PR
- Phase 2 task P2.A in [docs/execution-plan.md](../execution-plan.md) will
  extend this: SemVer per public endpoint, generated client SDKs in
  TypeScript + Python, OpenAPI documentation, deprecation policy ≥12 months

## Pros and cons of the options

### URL versioning (chosen)

- **Good, because:** trivially visible — the version is in the path
- **Good, because:** routers + caches + logs see distinct paths per version
- **Good, because:** standard industry practice; every integrator understands it
- **Bad, because:** version proliferation if breaking changes are frequent
  (mitigation: don't make breaking changes frequently)

### Header versioning

- **Good, because:** doesn't pollute URL space
- **Bad, because:** invisible to most observability tools; caches don't key on it
- **Bad, because:** integrators routinely forget to set the header,
  silently consuming the default version (almost always wrong one)

### Single unversioned API; never break contracts

- **Good, because:** simplest contract
- **Bad, because:** "never break" is a promise no growing platform can keep;
  the platform either evolves (and breaks) or stagnates

### GraphQL with field-level deprecation

- **Good, because:** field-level deprecation is more granular
- **Bad, because:** adds a query-language dependency + tooling stack;
  doesn't fit OrcaTrade's small-surface, dependency-minimal posture
- **Bad, because:** breaking changes to enums + types still happen and still
  need version coordination

## Related decisions

- Phase 2 task P2.A in [docs/execution-plan.md](../execution-plan.md) — public
  API governance: SemVer, ≥12-month deprecation, client SDKs, OpenAPI
- [0009 — Conventional commits + release-please](0009-conventional-commits-release-please.md) —
  the `BREAKING CHANGE` footer + `feat!:` notation; aligns with semver-major
  bumps on the public API

## More information

- [CLAUDE.md](../../CLAUDE.md) hard rule #7 was the original statement
- The [API governance section of docs/execution-plan.md](../execution-plan.md#6-phase-2--first-paying-enterprise)
  details the Phase 2 expansion (SDK generation, OpenAPI hosting, deprecation
  process)
