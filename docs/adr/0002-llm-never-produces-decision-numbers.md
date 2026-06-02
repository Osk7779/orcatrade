# The LLM never produces a number that drives a business decision

- **Status:** Accepted
- **Date:** 2026-05-30
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Future agent / calculator authors; security reviewers; auditors

## Context and problem statement

OrcaTrade quotes EU customs duty, CBAM exposure, anti-dumping/countervailing
duty, FX, working capital, TCO, and routing economics for European SME
importers. Every number a customer sees is a decision input — they may file a
customs entry against it, commit shipping capital against it, or pass it to
their finance team for cash-flow planning.

LLMs (Claude included) produce plausible numeric prose. A user-facing "the duty
on this shipment is approximately €68,000" reads identically whether the
underlying calculation produced €68,470 or whether the model halluc­inated.
The platform's value proposition is that the numbers are correct, traceable,
and reproducible. That requires the numbers to come from deterministic code,
not from generative text.

## Decision drivers

- Numeric correctness is the product
- Auditability — every euro must trace to inputs + a versioned calculator
- Reproducibility — re-running the same inputs must produce the same number
- Litigation surface — a customer filing a customs entry against a wrong number
  must be able to point to a deterministic source, not "the model said so"
- Cost discipline — model tokens cost money; computing in code is free

## Considered options

1. **All numbers from `lib/intelligence/*-quote.js`; LLM only writes prose around them**
2. LLM produces numbers, calculator double-checks ("guardrails" pattern)
3. LLM produces numbers + post-processor extracts them; calculator backfills

## Decision outcome

**Chosen option: all numbers come from `lib/intelligence/*-quote.js`; the AI
layer only wraps prose around already-computed deterministic results.**

The calculators (`customs-quote.js`, `routing-quote.js`, `finance-quote.js`,
etc.) use integer-cents arithmetic (see [0004](0004-integer-cents-money.md)).
They take structured input, return structured output. The agent layer in
`lib/handlers/*-agent.js` receives those structured results as tool-call output,
then composes prose around them.

Crucially, the LLM never *invents* a number. If a calculator returned €68,470,
the prose must say €68,470 (or honestly round, e.g. "approximately €68,500" —
but not a hallucinated "€75,000").

### Consequences

- **Good:** every customer-visible euro figure traces to a calculator + version
- **Good:** reproducing a saved plan re-runs the calculator, not the model;
  cheap, deterministic, fast
- **Good:** the LLM's contribution is bounded to language — its real strength
- **Bad:** prose layer can still drift numbers down to "approximately" without
  enforcement (numeric-fidelity eval — see Confirmation below — closes this)
- **Bad:** developers may be tempted to ask the model for "just one number" in
  edge cases; need to push back

### Confirmation

Three enforcement gates, with the third still in flight:

1. **Calculators contain no LLM imports.** Enforced by
   [test/import-boundary.test.js](../../test/import-boundary.test.js) (PR #8) —
   scans `lib/intelligence/` for `@anthropic-ai/sdk` and
   `https://api.anthropic.com`. Mutation-tested.
2. **Models used by handlers come from the central registry, not hardcoded.**
   Enforced by [test/model-registry-enforcement.test.js](../../test/model-registry-enforcement.test.js)
   (PR #7). Indirectly relevant — prevents drift in *which* model handles
   prose generation.
3. **Calculator numbers must appear verbatim in the agent's prose.** Phase 1
   task P1.6 in [docs/execution-plan.md](../execution-plan.md) — numeric-
   fidelity eval assertion. **Not yet enforced.** Today's offline scorer
   (`lib/ai/evals/scorer.js`) uses regex matching only, which lets "around
   €70k" pass when the calculator returned €68,470. This is the largest
   remaining gap to close on this rule.

## Pros and cons of the options

### All numbers from calculators (chosen)

- **Good, because:** clear separation of concerns; numbers are testable
- **Good, because:** reproducibility is free
- **Bad, because:** requires a calculator for every category of number (so far,
  OrcaTrade has one per domain — sufficient)

### LLM with calculator guardrails

- **Good, because:** flexible — model can reason over numeric edge cases
- **Bad, because:** "guardrails" routinely fail silently in adversarial / edge
  cases; not a defensible posture for compliance work
- **Bad, because:** still requires the calculator, so the LLM step adds no
  value, only risk and cost

### LLM produces + post-process extracts

- **Bad, because:** post-processors are fragile string-matching; the model can
  always invent a number the matcher misses

## Related decisions

- [0003 — Anthropic SDK boundary](0003-anthropic-sdk-boundary.md) — the
  structural enforcement of "no LLM in calculators"
- [0004 — Integer-cents money](0004-integer-cents-money.md) — the arithmetic
  primitive the calculators use
- [0005 — Audit-log before success](0005-audit-log-before-success.md) — the
  traceability primitive for "which calculator version produced this number"

## More information

- [CLAUDE.md](../../CLAUDE.md) hard rule #1 was the original statement of
  this principle
- The audit on 2026-05-30 confirmed zero LLM imports in `lib/intelligence/`
  but discovered that `lib/intelligence/model-runtime.js` was making raw
  `fetch('https://api.anthropic.com/...')` from inside the calculator layer —
  closed by PR #8
