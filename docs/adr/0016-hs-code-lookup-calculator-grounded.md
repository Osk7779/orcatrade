# `lookupHsCode` is calculator-grounded — curated HS6 map + (opt-in) live TARIC enrichment, never an LLM guess

- **Status:** Accepted
- **Date:** 2026-05-31
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Future agent authors; customs / compliance reviewers;
  audit + due-diligence reviewers

## Context and problem statement

All five agents (compliance, sourcing, logistics, finance + the
orchestrator that inherits from them) declare a `lookupHsCode` tool.
The system prompts instruct the agent to call it whenever the
conversation needs a customs commodity code — for CBAM applicability,
for duty estimation, for trade-defence (AD/CVD) lookup, for inventory
classification, for any landed-cost question.

Until 2026-05-31 the tool implementation was, in all four specialist
handlers (`agent.js`, `finance-agent.js`, `logistics-agent.js`,
`sourcing-agent.js`), the same hardcoded stub:

```js
return {
  suggestion: null,
  confidence: 0.0,
  message: 'HS code lookup requires EU TARIC database access, not yet
    wired into the agent. Recommend using access2markets.ec.europa.eu
    or verifying with the importer\'s customs broker.',
};
```

The 2026-05-30 audit flagged this as a load-bearing failure:

1. The tool **always** returns `suggestion: null, confidence: 0.0`,
   yet the agent prompt says "use this tool to suggest an HS code."
   When the only tool that's supposed to produce an answer always
   produces null, the agent has two options: tell the user "we can't
   help" (bad UX), or **hallucinate** an HS code in prose without
   calling the tool (worse — observed in at least one eval log).
2. A "confidence: 0.0" with the tool name `lookupHsCode` is
   functionally indistinguishable from a hallucinated 0% — there is no
   provenance signal in the response shape.
3. The product already has the deterministic primitives needed —
   `lib/intelligence/data/hs-suggest.js` (a curated ~120-entry HS6
   keyword map) and `lib/intelligence/taric-client.js` (a 7-day-cached
   MFN-rate fetcher against the UK Trade Tariff) — yet none of them
   were wired into the agent.

This is the [ADR 0002](0002-llm-never-produces-decision-numbers.md)
contract being violated by omission: the agent is being made to choose
between admitting we can't help, hallucinating a number, or producing a
prose answer with no traceable provenance — none of which are
acceptable for a trade-compliance product.

## Decision drivers

- The agent must produce HS-code suggestions that are **traceable to
  deterministic logic**, not LLM inference
- The suggestion must carry enough metadata for the agent to *honestly
  describe* its confidence (rather than always-zero or always-high)
- The agent must always surface a verification path — HS classification
  is not a decision a chatbot makes for a customer, regardless of how
  confident the suggestion looks
- The fix must respect [ADR 0003](0003-anthropic-sdk-boundary.md):
  the calculator lives outside `lib/ai/` and imports nothing AI-related
- The fix must respect [ADR 0006](0006-circuit-breaker-on-external-calls.md):
  any upstream call (the TARIC MFN-rate enrichment) is best-effort,
  cached, and degrades silently rather than failing the request
- The fix must be testable — the prior stub was untested for
  correctness (the only assertions were `r.confidence === 0`)

## Considered options

1. **Curated HS6 map + (opt-in) live TARIC MFN enrichment + ranked
   candidates + tiered confidence** (chosen)
2. LLM-driven HS classification (let the agent infer the code from
   the product description in prose, optionally cross-checked against
   the suggester for sanity)
3. Open-source ML classifier (e.g. embeddings against the WCO
   harmonised-system labels)
4. Outsource to a paid HS-classification API (3Victor, Avalara
   AvaTax Classify, etc.)
5. Keep stubbing — log the call and "do better later"

## Decision outcome

**Chosen option: a new calculator
[`lib/intelligence/hs-code-lookup.js`](../../lib/intelligence/hs-code-lookup.js)
that:**

1. Calls
   [`hs-suggest.suggest(query, { limit: 5 })`](../../lib/intelligence/data/hs-suggest.js)
   to get up to 5 ranked HS6 candidates from the curated 120+-entry
   keyword map. No LLM, no I/O.
2. Normalises the raw scorer outputs to a `[0, 1]` confidence value
   and a tier label (`high` / `medium` / `low` / `none`) using a small
   deterministic rule set, calibrated against the corpus (see
   [`computeConfidence`](../../lib/intelligence/hs-code-lookup.js) for
   the cut-offs and the test file for the calibration cases).
3. When `originCountry` is supplied, opportunistically enriches the
   top candidate with a live MFN rate via
   [`taric-client.lookupHsRate`](../../lib/intelligence/taric-client.js)
   — KV-cached (7-day fresh, 30-day stale-while-revalidate),
   circuit-protected, 4-second timeout. Failure is non-fatal; the
   suggestion still returns with `dutyEstimate: null`.
4. Always returns a `verifyUrl` (TARIC consultation deep link) when
   there is a suggestion, so the agent can hand the user a one-click
   verification path. The agent prompts say "the final binding rate
   comes from a human-verified TARIC consultation, never from us" —
   this URL is the surface of that promise.

The four specialist agent handlers (`agent.js`, `finance-agent.js`,
`logistics-agent.js`, `sourcing-agent.js`) now contain a 3-line
pass-through that requires the calculator and delegates. The
orchestrator inherits from one of them via `Object.assign` and is
therefore covered transitively. All four tool schemas now accept an
optional `originCountry` so the agent can request MFN enrichment when
the conversation already has the answer to "where is it coming from?"

The tool description ("Deterministic HS6 suggestion from a curated
120+-entry product map, plus … MFN-rate enrichment … NEVER present the
suggestion as a final classification — the agent must surface the
verify URL and instruct the user to confirm with their customs broker")
puts the calculator-grounded discipline into the agent's prompt
surface, not just in a comment.

### Consequences

- **Good:** the agent now produces traceable, deterministic HS-code
  suggestions with honest confidence signals. A `medium` tier means
  "list runner-ups, push verification"; a `high` tier means "use as-is
  but still push verification"; a `none` tier means "do not guess."
- **Good:** the existing TARIC client (KV-cached, circuit-protected)
  is now used in the agent path — turning a passive cache into a
  live customer-facing surface without new infrastructure
- **Good:** `verifyUrl` makes the verification path one click rather
  than the prior prose suggestion ("try access2markets.ec.europa.eu")
- **Good:** the curated map is auditable — every suggestion is
  attributable to a specific entry in
  [`hs-suggest.js`](../../lib/intelligence/data/hs-suggest.js), which
  is reviewable like any other code
- **Bad:** coverage is bounded by the curated map (currently ~120
  HS6 entries focused on the 8 SME-importer wizard categories +
  trade-defence specials). Out-of-coverage queries return
  `confidence: 0` + a guidance message rather than a guess —
  acceptable, since the alternative (hallucinated suggestion) is
  the worse failure mode
- **Bad:** the scorer is pure-keyword, no embeddings — synonyms and
  domain-specific phrasings the map didn't anticipate get missed.
  Phase 1 P1.x considers an embeddings-based extension (within the
  same calculator boundary; the embeddings index would be a
  pre-computed artefact, not a runtime model call)
- **Neutral:** the MFN-rate enrichment sources from the UK Trade
  Tariff API rather than EU TARIC directly (no free public EU API).
  The result is labelled `"UK Trade Tariff (sanity-check; EU may
  differ)"`. The customs-quote calculator already used this source
  for the same reason — this PR just extends it into the agent path

### Confirmation

**Enforced as of PR #27 (Phase 0 P0.11).**

- [test/hs-code-lookup.test.js](../../test/hs-code-lookup.test.js) —
  21 tests covering input validation, known-good queries with
  expected tiers (calibrated against the corpus),
  unknown-query handling, confidence bounds `[0, 1]`,
  `computeConfidence` rules with all four tier paths,
  `dutyEstimate` is null when origin is missing AND under
  `skipDutyLookup`, invalid `originCountry` is ignored, candidates
  arrive best-first with scores, and **`verifyUrl` always points to
  the TARIC consultation portal when there is a suggestion**.
- **Source-pin** test asserts the calculator does NOT import the
  Anthropic SDK or anything from `lib/ai/` — i.e. ADR 0002 + ADR 0003
  hold at the file level.
- **Source-pin** test asserts all four specialist agent handlers
  `require('../intelligence/hs-code-lookup')` AND no longer contain
  the prior `confidence: 0.0` placeholder pattern.
- The 4 pre-existing agent test suites updated for the new async
  contract + the new return shape (`suggestion`, `confidenceTier`,
  `verifyUrl`).

**Known gaps (Phase 1+):**

- Out-of-corpus queries return `confidence: 0` rather than something
  smarter. Considered options for Phase 1: (a) extend the curated
  map with the next ~500 SME-relevant HS6s; (b) pre-compute a label
  embedding index so we can score against any free-text query (still
  no runtime LLM call); (c) accept the gap and use it as a "we don't
  know" signal — possibly the right answer
- MFN-rate enrichment uses UK Trade Tariff as a sanity-check feed,
  not EU TARIC directly. Phase 2 may swap to an EU-direct provider
  or our own bulk-XML ingestion (the
  [`taric-client.fetchUpstreamRate`](../../lib/intelligence/taric-client.js)
  is the only function that changes)
- The agent prompt doesn't yet teach the model the
  `dutyEstimate.stale` flag — when the cache is serving a stale
  value because upstream is down, the agent should mention it.
  Phase 1 prompt-registry update

## Pros and cons of the options

### Curated HS6 map + opt-in TARIC enrichment (chosen)

- **Good, because:** deterministic, auditable, calculator-grounded —
  the suggestion is traceable to a specific entry in a reviewable
  data file
- **Good, because:** the confidence signal is honest (calibrated
  against real corpus behaviour, tested)
- **Good, because:** reuses two primitives we already built and
  paid for (`hs-suggest`, `taric-client`)
- **Bad, because:** coverage is bounded by the curated map. We
  accept this in exchange for never hallucinating

### LLM-driven classification

- **Good, because:** could cover arbitrary product descriptions
- **Bad, because:** violates [ADR 0002](0002-llm-never-produces-decision-numbers.md)
  — an HS code drives duty, drives compliance regime selection,
  drives trade-defence applicability. It is the textbook example of
  "a number that drives a business decision."
- **Bad, because:** even sanity-checking an LLM guess against the
  suggester wouldn't fix the trust gap — the suggester is the
  load-bearing primitive either way, so adding an LLM call on top
  only adds latency, cost, and a vector for prompt injection

### Open-source ML classifier (embeddings against WCO labels)

- **Good, because:** generalises to out-of-corpus descriptions
  without LLM inference
- **Bad, because:** "embed at request time" reintroduces a runtime
  model call (currently no ML serving infrastructure)
- **Reconsider in Phase 1** as a pre-computed embeddings index
  inside the calculator boundary (no runtime ML call needed)

### Paid HS-classification API

- **Good, because:** higher accuracy than the curated map, real
  domain expertise behind it
- **Bad, because:** adds an external dependency to a load-bearing
  internal control surface, adds a sub-processor for GDPR, has
  per-call cost characteristics we'd need to model into the
  free-tier limits
- **Reconsider after pricing-tier signal:** if an enterprise
  customer wants classification-grade accuracy, the wiring on our
  side is the same — swap `lib/intelligence/hs-code-lookup.js` to
  call the paid API behind the same calculator boundary

### Status quo (stub the tool)

- **Bad, because:** the agent's tool contract to the customer is
  broken by design; agents either tell the user "we can't help" or
  hallucinate a code in prose. Unacceptable for a trade-compliance
  product

## Related decisions

- [0002 — The LLM never produces a number that drives a business
  decision](0002-llm-never-produces-decision-numbers.md) — the
  calculator-grounded HS-code path is the direct application of this
  rule to the agent's HS-suggestion surface
- [0003 — Anthropic SDK boundary](0003-anthropic-sdk-boundary.md) —
  the calculator lives outside `lib/ai/` and contains no LLM code;
  enforced by source-pin test
- [0006 — Circuit breaker on external calls](0006-circuit-breaker-on-external-calls.md)
  — the MFN-rate enrichment is breaker-wrapped via the existing
  TARIC client
- [0015 — Human-review queue](0015-human-review-queue.md) — the
  agent should invoke `requestHumanReview` whenever a high-stakes
  declaration depends on an HS-code interpretation the suggester
  isn't confident about

## More information

- [lib/intelligence/hs-code-lookup.js](../../lib/intelligence/hs-code-lookup.js)
  — the calculator
- [lib/intelligence/data/hs-suggest.js](../../lib/intelligence/data/hs-suggest.js)
  — the curated 120+-entry HS6 keyword map (the data the calculator
  scores against)
- [lib/intelligence/taric-client.js](../../lib/intelligence/taric-client.js)
  — the (existing) MFN-rate fetcher with KV cache
- [test/hs-code-lookup.test.js](../../test/hs-code-lookup.test.js) —
  contract tests + source-pin tests
- [docs/execution-plan.md](../execution-plan.md) — Phase 0 task
  **P0.11** is the work this ADR records
