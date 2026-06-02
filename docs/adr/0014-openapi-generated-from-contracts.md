# OpenAPI 3.1 specification generated from `lib/contracts/v1/`, not hand-authored

- **Status:** Accepted
- **Date:** 2026-05-30
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Future API authors; future SDK consumers; procurement reviewers

## Context and problem statement

Phase 2 of [docs/execution-plan.md](../execution-plan.md) introduces a
public-customer API consumed by enterprise integrations (ERPs, custom
dashboards, sales-engineering tools). Those consumers need a machine-
readable spec to generate clients against + a human-readable spec to
browse. The industry standard is OpenAPI 3.x.

[ADR 0007](0007-api-v1-stable-contracts.md) already established that
`/api/v1/*` is the stable public surface + that the response shapes
are frozen in [lib/contracts/v1/index.js](../../lib/contracts/v1/index.js)
+ enforced by [test/api-v1-contract.test.js](../../test/api-v1-contract.test.js).
Phase 0 task P0.J extends that: a machine-readable OpenAPI artefact that
external tools (Swagger UI, Scalar, Mintlify, SDK generators) can
consume.

The question is **how to produce that artefact** without it drifting
from the source contracts.

## Decision drivers

- Single source of truth — contracts are authoritative; OpenAPI is a
  projection
- Drift impossible by construction (or at least caught loudly in CI)
- Zero / minimal new dependency surface
- Procurement-recognised artefact (OpenAPI 3.x, JSON or YAML)
- Generation is fast + deterministic (CI-cheap)
- Adding a new endpoint = one place to edit + one command to run

## Considered options

1. **Generate `docs/api/openapi.json` from contracts + a small metadata
   file; commit the artefact; drift test enforces sync** ✓
2. Hand-author `docs/api/openapi.yaml`; let it drift; treat it as a
   parallel doc that gets manually reconciled occasionally
3. Generate at request-time at `/api/v1/openapi` (no committed artefact)
4. Adopt a code-first OpenAPI framework (`zod-to-openapi`, `@hono/zod-openapi`,
   `tsoa`, `nestjs/swagger`) — generate from JSDoc / decorators / Zod schemas
5. Adopt a spec-first OpenAPI tooling (`openapi-typescript`, `openapi-generator`)
   — author OpenAPI first, generate validators

## Decision outcome

**Chosen option: generate from contracts + metadata file; commit the
artefact; drift test in the suite.**

### Architecture

Three files form the system:

1. **[lib/contracts/v1/index.js](../../lib/contracts/v1/index.js)** —
   the authoritative response schemas. Existing file from ADR 0007. The
   tiny JSON-Schema subset format is preserved (no migration).
2. **[lib/contracts/v1/openapi-metadata.js](../../lib/contracts/v1/openapi-metadata.js)** —
   complements the contracts with path + method + summary + description +
   tags + parameters + requestBody for each endpoint. Hand-authored;
   one entry per `SCHEMAS` key.
3. **[scripts/generate-openapi.js](../../scripts/generate-openapi.js)** —
   the generator. Combines `SCHEMAS` + `ENDPOINTS` + a small JSON-Schema
   dialect converter (our `nullable: true` → OpenAPI 3.1's `type: [..., 'null']`)
   into a complete OpenAPI 3.1 JSON document.

The committed artefact lives at
[docs/api/openapi.json](../api/openapi.json). It is generated, not hand-
edited. The drift test
([test/openapi-drift.test.js](../../test/openapi-drift.test.js))
regenerates on every `npm test` + byte-compares against the committed
file; mismatch fails CI with the exact differing line + the regeneration
command.

### Adding a new endpoint

Five steps (documented in [docs/api/README.md](../api/README.md)):

1. Add to `SCHEMAS` in `lib/contracts/v1/index.js`
2. Add the test fixture to `test/api-v1-contract.test.js`
3. Add the metadata in `lib/contracts/v1/openapi-metadata.js`
4. Run `node scripts/generate-openapi.js`
5. Commit the regenerated `openapi.json` in the same PR

The drift test enforces step 4. A second test in
`test/openapi-drift.test.js` enforces step 3 (every `SCHEMAS` entry
must have matching `ENDPOINTS` metadata + vice versa).

### Why JSON not YAML

- Node has `JSON.stringify` + `JSON.parse` built in; YAML needs a
  dependency
- The drift test's byte-comparison is unambiguous on JSON; YAML has
  multiple equivalent serialisations for the same document
- Every OpenAPI viewer + tool accepts JSON without conversion
- Customers wanting YAML can convert on demand
  (`npx js-yaml docs/api/openapi.json > openapi.yaml`)

### Consequences

- **Good:** single source of truth; impossible to silently drift; the
  contract test (ADR 0007) + the drift test (this ADR) together pin
  both behaviour + documentation
- **Good:** no new runtime or build-time dependencies — zero `npm install`
  impact beyond the existing TypeScript devDep
- **Good:** OpenAPI 3.1 is the current industry standard + the version
  consumed by Scalar, Mintlify, and `openapi-generator`
- **Good:** generator is ~140 lines; reviewer can read it in 5 minutes
- **Bad:** when a new endpoint is added, the author must run the
  generator + commit the artefact. The drift test catches the omission
  but it's still one extra step.  Mitigation: add `node scripts/generate-openapi.js`
  to a future pre-commit hook (deferred — `husky` would be a new dep
  and pre-commit is an opinion call beyond this PR)
- **Bad:** parameters + requestBody are hand-authored in metadata. They
  could drift from real handler behaviour without the contract test
  catching it (the contract test only validates responses). Mitigation:
  Phase 2 P2.A's "request validation against the spec" closes this —
  a follow-up PR can add request-body assertions to
  `test/api-v1-contract.test.js`
- **Neutral:** the spec covers 4 endpoints today; OrcaTrade's full
  `/api/*` surface is ~50. Coverage grows as endpoints stabilise into v1

### Confirmation

- `node scripts/generate-openapi.js` produces `docs/api/openapi.json`;
  re-running is a no-op (deterministic)
- `npm test` includes the drift test — failed regeneration shows the
  exact differing line + the regen command
- A second test in the same file enforces metadata + schema name parity
  (each `SCHEMAS` entry has matching `ENDPOINTS`, and vice versa)

**Mutation tests** (documented in this PR's body):

1. Edit a contract field type in `lib/contracts/v1/index.js` → drift
   test fails at the exact line in `openapi.json`. Restore → green.
2. Add a `SCHEMAS` entry without adding `ENDPOINTS` metadata → parity
   test fails. Add the metadata → green.

## Pros and cons of the options

### Generate from contracts + metadata (chosen)

- **Good, because:** drift impossible by construction; single source of truth
- **Good, because:** zero new runtime dependency
- **Bad, because:** one manual regen step per contract change (caught by
  drift test)

### Hand-author OpenAPI YAML

- **Good, because:** simplest; no generator code
- **Bad, because:** drifts the moment a contract changes; defined-but-not-enforced
  anti-pattern that the execution plan rejects
- **Bad, because:** two sources of truth for response shapes — guaranteed
  to disagree eventually

### Generate at request time (`/api/v1/openapi`)

- **Good, because:** always reflects current state by definition
- **Bad, because:** consumers can't pin a version; CI can't gate on
  schema changes; OpenAPI viewers want a stable file URL
- **Bad, because:** complicates audit trail (the "spec at the time of
  contract" becomes ambiguous)

### Code-first OpenAPI framework (`zod-to-openapi`, `tsoa`, etc.)

- **Good, because:** the framework owns the schema-to-OpenAPI conversion
- **Bad, because:** adds a heavy runtime dep + sometimes a build step
- **Bad, because:** would require replacing the existing JSON-Schema-subset
  contracts with Zod / decorator-based schemas — much bigger refactor
- **Worth revisiting** in Phase 2+ when we adopt Zod globally; for now
  the simpler approach matches the existing code shape

### Spec-first OpenAPI tooling

- **Bad, because:** inverts the source of truth (spec first, code derived);
  current code-first posture (contracts + validator + handlers) is well-
  understood and tested

## Related decisions

- [0007 — Public API contracts under /api/vN/ are stable per version](0007-api-v1-stable-contracts.md) —
  the contract-stability promise this ADR makes machine-readable
- [Phase 2 task P2.A — Public API governance](../execution-plan.md) —
  generated client SDKs + ≥12-month deprecation
- [Phase 2 task P2.3 — Hosted OpenAPI docs](../execution-plan.md) —
  Scalar or Mintlify integration; this ADR's artefact is the input

## More information

- [OpenAPI 3.1 specification](https://spec.openapis.org/oas/v3.1.0)
- [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/release-notes.html) —
  the schema dialect OpenAPI 3.1 adopts
- [Swagger Editor](https://editor.swagger.io/) — paste the spec to
  validate + preview
