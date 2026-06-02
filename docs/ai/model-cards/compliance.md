# Model card — Compliance Agent

**Version:** v1 — published 2026-06-02
**Endpoint:** `POST /api/agent`
**Source:** [`lib/handlers/agent.js`](../../../lib/handlers/agent.js)
**System prompt:** [`lib/ai/prompts/compliance/v1.txt`](../../../lib/ai/prompts/compliance/v1.txt)

---

## 1. Intended use

Evaluates whether a planned import into the EU/UK triggers a regulatory
obligation, what evidence the importer must collect, and what the
financial exposure is. The five questions the agent answers for any
covered import:

1. Which EU/UK regulations apply (CBAM, EUDR, REACH, CE marking,
   anti-dumping/countervailing duties, ADD/CVD, RoHS, GPSR, etc.)?
2. What evidence must be collected, from whom, by when?
3. What is the financial exposure — certificate cost, penalty ceiling,
   hold-risk?
4. What is the next concrete action the importer should take?
5. What is unknown — and what would change the answer?

**Audience:** European SME importers sourcing from Asia. Internal trade-
compliance team uses it for the same questions at scale.

**EU AI Act classification:** Limited Risk (Art. 50 transparency).
The system informs the user it is an AI; outputs are advisory and
human-reviewed before any irreversible action.

## 2. Out-of-scope use

Not for:

- **Binding tariff classification.** The agent suggests HS6 codes;
  binding classification requires a BTI / ATR ruling from a national
  customs authority.
- **Customs declaration filing.** The agent drafts; the importer
  reviews and files via their broker. The platform never files.
- **Legal advice.** Trade compliance is regulatory analysis, not a
  legal opinion. For litigation-risk questions, engage a customs
  lawyer.
- **Tax advice on income / corporate tax.** VAT/duty handled; income
  tax not in scope.
- **Origin-of-goods determination beyond preferential trade origin.**
  Country-of-origin substantive-transformation calls are out of scope.

## 3. Model and provider

- **Provider:** Anthropic (via `@anthropic-ai/sdk` v0.36)
- **Model class:** Claude Sonnet 4 family at time of writing; the
  handler reads `MODELS.AGENT` from `lib/ai/models.js`. The exact
  model ID is a deployment-time configuration, not encoded in the
  prompt (enforced by `test/prompt-no-model-id.test.js`).
- **Inference region:** Anthropic-hosted; current configuration uses
  the standard `api.anthropic.com` endpoint. EU residency option
  available on the customer Pro+ plan but not yet contracted.
- **Data retention with provider:** Anthropic API default — request
  contents and completions are stored for up to 30 days for abuse
  monitoring then deleted. Anthropic does not train on API traffic.
  See [Anthropic's commercial terms](https://www.anthropic.com/legal/commercial-terms).

## 4. Inputs and outputs

**Inputs:**
- A natural-language user message describing the planned import.
- Tool-call results retrieved during the agent's reasoning loop:
  TARIC duty tables, CBAM coverage mapping, EUDR commodity list,
  REACH SVHC list, sanctions / denied-party lookups, the curated
  regulation corpus.
- The signed-in user's tier (for the spend cap; not for advice
  variation).

**Outputs:**
- A natural-language response in UK English, structured around the
  five questions above.
- Citations: every regulatory claim ends with `[chunk-id]` referencing
  a retrieved corpus chunk.
- Tool-call trace: every monetary / weight / percentage figure is
  cited to the tool that produced it.
- Confidence label: *Verified* (verbatim regulation + deterministic
  tool), *Indicative* (summary + tool snapshot), or *Inferred*
  (corpus only).

**Outputs the agent never produces:**
- A monetary figure the calculator didn't compute (gate: `checkGrounding`).
- A regulatory claim without a `[chunk-id]` citation.
- An action that would be irreversible without first invoking
  `requestHumanReview`.

## 5. Calculator grounding contract

Every number that drives a decision comes from `lib/intelligence/*-quote.js`
or a deterministic data-snapshot table — never from the LLM's
generation. Enforced by:

- `lib/ai/evals/scorer.js::checkGrounding` — every numeric token in
  the response must match a calculator output within tolerance, or be
  in the always-grounded set (small counts, years, 100, 365).
- `lib/ai/evals/scorer.js::checkNumericFidelity` — every load-bearing
  calculator output must appear in the response (the *omission*
  direction; apex P1.6).
- `test/calculator-determinism.test.js` — every `*-quote.js` file is
  free of `Date.now()`, `Math.random()`, `new Date()`. Re-running
  produces the same number forever.

## 6. Evaluations

**Offline structural scoring** (`scripts/agent-eval.js --offline`,
runs in `npm test`):

- Pass rate target: **100%** of `lib/ai/evals/compliance/cases.v1.json`
- Today: see `test/ai-evals.test.js` — `coverage gate: the newly-shipped
  surfaces stay covered by a case` and `coverage gate: every case
  carries a description`.

**Live evaluations** (`scripts/agent-eval.js`, runs nightly via GHA
`evals.yml`):

- Pass rate target: **≥ 95%** per agent (CI hard-fails below 95%)
- Cost target: median ≤ €0.05 per case
- Latency target: p95 ≤ 8s end-to-end (orchestrator p95 ≤ 12s)

**Cases ship with the agent** under
`lib/ai/evals/compliance/cases.v1.json`. Adding a new behaviour
requires adding a case that exercises it; the prompt-coverage gate
(`test/eval-prompt-coverage.test.js`) ensures every prompt version
has at least one case.

## 7. Known limitations

- **No live TARIC lookups by default.** The agent uses a snapshot
  (`lib/intelligence/data/taric-warm-list.js`) refreshed quarterly.
  Specific HS subheadings beyond the snapshot can attract anti-
  dumping, safeguard, or preferential-origin rates the agent will
  call out as *Inferred* confidence.
- **CBAM applicability** uses category-keyword + HS-code matching
  against Annex I. False positives exist; CBAM apex auditing flagged
  intra-EU exclusion (fixed in PR #39).
- **Snapshot dates.** Each data table carries an `asOf` date; if the
  user's import is in a window where regulation changed since the
  snapshot, the agent surfaces that as an *unknown*.
- **English / Polish / German only.** Prompts and responses are not
  translated to other EU languages today.
- **Single-tenant prompt.** No per-customer prompt customisation
  surface yet; every importer gets the same agent.

## 8. Human oversight

- **`requestHumanReview` tool.** Every irreversible action the agent
  might recommend (customs declaration filing, CBAM certificate
  surrender, EUDR DDS submission, supplier contract above €20,000
  cargo value) routes through this tool first. The agent never
  executes these directly.
- **Audit trail.** Every agent invocation writes an `ai_call` event
  to the event log with the model, prompt version, tool calls,
  duration, and cost in EUR cents. See
  [`docs/security/audit-trail.md`](../../security/audit-trail.md).
- **Confidence labels.** Each answer is labelled *Verified / Indicative
  / Inferred*; users are instructed to escalate any *Inferred* answer
  that drives a six-figure-or-larger decision.
- **Escalation contact.** `security@orcatrade.pl` for security issues
  (per [SECURITY.md](../../../SECURITY.md)); for advice escalation, the
  founder is the current single contact.

## 9. Revision history

| Version | Date | Change |
|---|---|---|
| v1 | 2026-06-02 | Initial published card (apex P1.F) |
