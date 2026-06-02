# Public API documentation

OpenAPI 3.1 specification for the **/api/v1/*** public surface of OrcaTrade.

| File | Purpose |
|---|---|
| [openapi.json](openapi.json) | Generated OpenAPI 3.1 spec |

## What's covered (Phase 0 baseline)

The four contracts in [lib/contracts/v1/](../../lib/contracts/v1/) that
have schema pinning + the contract test
([test/api-v1-contract.test.js](../../test/api-v1-contract.test.js)):

| Path | Method | Tags |
|---|---|---|
| `/api/v1/tiers` | GET | catalogue |
| `/api/v1/hs-suggest` | GET | compliance |
| `/api/v1/customs` | POST | compliance, finance |
| `/api/v1/health` | GET | operations |

This is **less than the full live API surface** today — OrcaTrade has
~50 endpoints under `/api/*`, but only these four have frozen v1
contracts so far. Adding an endpoint to the OpenAPI spec means:

1. Adding it to `SCHEMAS` in [lib/contracts/v1/index.js](../../lib/contracts/v1/index.js)
2. Adding the test fixture to [test/api-v1-contract.test.js](../../test/api-v1-contract.test.js)
3. Adding the metadata (path, method, summary, parameters,
   requestBody) to [lib/contracts/v1/openapi-metadata.js](../../lib/contracts/v1/openapi-metadata.js)
4. Running `node scripts/generate-openapi.js` to regenerate `openapi.json`
5. Committing the regenerated artefact in the same PR

The drift test ([test/openapi-drift.test.js](../../test/openapi-drift.test.js))
will fail loudly if step 4 is skipped.

## How to view the spec

The committed `openapi.json` is machine-readable. To read it as a
human-friendly UI, point any OpenAPI viewer at the raw GitHub URL or
the local file:

- [Swagger UI](https://petstore.swagger.io/?url=https://raw.githubusercontent.com/Osk7779/orcatrade/main/docs/api/openapi.json) (paste the raw URL)
- [Redocly](https://redocly.com/redoc/) (`npx @redocly/cli preview-docs docs/api/openapi.json`)
- [Scalar](https://scalar.com/) (similar)
- [Mintlify](https://mintlify.com/) for hosted docs (Phase 2 P2.3 target)

A Phase 2 deliverable (P2.3 in the execution plan) hosts the spec on a
proper docs site (Scalar or Mintlify) for customers integrating against
the public API. For now this directory is the canonical source.

## How to regenerate

```bash
node scripts/generate-openapi.js
```

That's it. The generator is deterministic — same inputs, byte-identical
output. The drift test runs on every PR and fails if the committed
artefact differs from the generator's output.

## Why JSON not YAML

OpenAPI tooling supports both. JSON wins for us because:
- Node has JSON.stringify built in; YAML would need a dependency
- The drift test's byte-comparison is unambiguous on JSON (YAML has multiple
  equivalent serialisations for the same document)
- Every OpenAPI viewer + tool accepts JSON without conversion

Convert to YAML on demand:

```bash
npx --yes js-yaml docs/api/openapi.json > /tmp/openapi.yaml
```

## Related

- [ADR 0007 — Public API contracts under /api/vN/ are stable per version](../adr/0007-api-v1-stable-contracts.md)
- [ADR 0014 — OpenAPI generated from contracts, not hand-authored](../adr/0014-openapi-generated-from-contracts.md)
- [Phase 2 task P2.A — Public API governance + client SDKs](../execution-plan.md) —
  generated TS + Python SDKs from this spec
- [Phase 2 task P2.3 — Hosted OpenAPI docs](../execution-plan.md) —
  Scalar / Mintlify integration
