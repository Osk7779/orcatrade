# Anthropic SDK and LLM-API calls are bounded to `lib/handlers/` and `lib/ai/`

- **Status:** Accepted
- **Date:** 2026-05-30
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Future agent / handler authors

## Context and problem statement

[ADR 0002](0002-llm-never-produces-decision-numbers.md) declares that the LLM
must not produce decision-driving numbers. For that to be true *structurally*
rather than by convention, the codebase needs a clear boundary: which
directories may talk to Anthropic, and which may not.

Without the boundary, any calculator module could be one `require('@anthropic-ai/sdk')`
away from violating ADR 0002 without anyone noticing. With it, the violation
becomes a failing test.

## Decision drivers

- Make ADR 0002 structurally true, not conventionally true
- Discoverable + enforceable in a single grep
- Catch both the SDK package import AND the raw-fetch pattern (the audit on
  2026-05-30 found a violation that an SDK-only check would have missed)
- Allow refactors without re-arguing the rule

## Considered options

1. **Allow Anthropic access only in `lib/handlers/` and `lib/ai/`; enforce via test**
2. Allow Anthropic access anywhere; rely on code review to catch violations
3. Move all LLM access through a single "client" file (e.g. `lib/ai/client.js`);
   ban the SDK import everywhere else

## Decision outcome

**Chosen option: Anthropic access (SDK package + raw `https://api.anthropic.com`
fetches) is allowed only in `lib/handlers/` and `lib/ai/`. Enforced by
[test/import-boundary.test.js](../../test/import-boundary.test.js).**

The two allowed zones reflect responsibility:

- `lib/handlers/*.js` — request handlers + agents (the multi-turn tool-use
  loops) call Anthropic directly because they're the "controller" layer
- `lib/ai/*.js` — model registry, prompts, eval scorer, cost telemetry, and
  the shared `model-runtime.js` helper (timeout + retry) — utilities that
  handlers use

`lib/intelligence/` (the calculator layer) and `scripts/` (cron + maintenance)
are explicitly disallowed.

### Consequences

- **Good:** ADR 0002 is now mechanically enforced
- **Good:** future refactor that accidentally drops an LLM call into a
  calculator fails CI loudly + at the exact line
- **Good:** new contributors learn the rule by reading the test
- **Bad:** scaffold cost — moving the violation that PR #8 found
  (`model-runtime.js` had been in `lib/intelligence/`) took 5 import-path
  updates + a rename
- **Neutral:** the rule allows raw `fetch` to Anthropic, not just the SDK
  package — this is realistic (OrcaTrade currently uses raw `fetch`); a
  future migration to the SDK package would not loosen this contract

### Confirmation

[test/import-boundary.test.js](../../test/import-boundary.test.js) (PR #8)
scans every `.js` under `lib/` and `scripts/` for two patterns:

1. `/['"]@anthropic-ai\/sdk['"]/` — the SDK package import
2. `/['"]https:\/\/api\.anthropic\.com/` — the raw-fetch call site

Fails on any match outside the allowed zones, reporting file + line number.
Mutation-tested: planting a `fetch('https://api.anthropic.com/...')` in
`lib/intelligence/__mutation__.js` causes the test to fail at the exact line.

Two belt-and-braces assertions also fail loudly if `lib/ai/model-runtime.js`
disappears or if a neighbouring `lib/aix/` directory is created that could
falsely match the prefix.

## Pros and cons of the options

### Allowed zones + enforcement test (chosen)

- **Good, because:** structural; impossible to drift silently
- **Good, because:** zero runtime cost
- **Good, because:** one grep tells you who can call the model

### Convention + code review

- **Bad, because:** "defined-but-not-enforced" — the exact anti-pattern the
  execution plan exists to eliminate
- **Bad, because:** the 2026-05-30 audit *did* this check by hand and missed
  the `model-runtime.js` violation

### Single shared client file

- **Good, because:** a single chokepoint for cost telemetry, tracing, retries
- **Bad, because:** doesn't *replace* the boundary; calculators could still
  require the client. Same problem, one indirection deeper.
- **Bad, because:** doesn't solve the raw-fetch path

## Related decisions

- [0002 — LLM never produces decision-driving numbers](0002-llm-never-produces-decision-numbers.md) —
  the principle this ADR enforces
- [docs/execution-plan.md](../execution-plan.md) — Phase 0 task P0.5 was the
  implementation; this ADR was backfilled in P0.A

## More information

- The 2026-05-30 audit verified zero `@anthropic-ai/sdk` imports outside the
  allowed zones (the project uses raw `fetch`), but missed the raw-fetch
  violation in `lib/intelligence/model-runtime.js`. The audit was checking
  the wrong signal; this ADR + its test check both.
- The boundary check happens at test time (Node's test runner), not at
  build / lint time, because the project has no build / lint pipeline
  (yet — see [0009](0009-conventional-commits-release-please.md) for the
  release tooling baseline)
