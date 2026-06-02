# Model card — Sourcing Agent

**Version:** v1 — published 2026-06-02
**Endpoint:** `POST /api/sourcing-agent`
**Source:** [`lib/handlers/sourcing-agent.js`](../../../lib/handlers/sourcing-agent.js)
**System prompt:** [`lib/ai/prompts/sourcing/v1.txt`](../../../lib/ai/prompts/sourcing/v1.txt)

---

## 1. Intended use

Helps an importer evaluate a supplier or shortlist: factory legitimacy
signals, supplier-vetting questions to ask, buyer-verification step
recommendations, and an interpretation of any factory-score data the
platform has computed deterministically.

Typical user prompts the agent is designed for:

- *"Vet Shanghai Acme Industrial Co for me — order €40k of stainless
  cookware ex-CN."*
- *"What due-diligence should I do before paying this supplier 30%
  upfront?"*
- *"The factory score for this supplier is 62/100 — what does that
  actually mean and what should I do about it?"*

**EU AI Act classification:** Limited Risk (Art. 50 transparency).

## 2. Out-of-scope use

Not for:

- **A definitive "is this supplier fraudulent" verdict.** The agent
  surfaces signals (registration, banking, prior export history) and
  flags risks; it does not assert fraud.
- **Credit decisions.** No financial-product recommendations.
- **Bribery / FCPA / UK Bribery Act counsel.** Surfaces red flags;
  engage counsel for any actual finding.
- **Negotiation tactics or commercial advice.** Pricing, terms,
  Incoterm choice are not the agent's surface.

## 3. Model and provider

- **Provider:** Anthropic (via `@anthropic-ai/sdk` v0.36)
- **Model class:** Claude Sonnet 4 family at time of writing; handler
  reads `MODELS.SOURCING` from `lib/ai/models.js`.
- **Inference region + retention:** see compliance card § 3.

## 4. Inputs and outputs

**Inputs:**
- A natural-language message describing the supplier and the deal
  context (commodity, value, payment terms).
- Tool calls: `factoryScore` (deterministic scoring from
  `lib/intelligence/factory-score.js`), supplier registration
  lookups, sanctions / denied-party screening
  (`/api/screen` proxy), buyer-verification readiness check.

**Outputs:**
- A structured supplier brief: legitimacy signals (✓ / △ / ✗), open
  risks, the specific buyer-verification step recommended next, and
  the unknowns that would change the recommendation.
- Citations to the tool that produced each numeric signal.
- Confidence label per finding.

## 5. Calculator grounding contract

Same contract as the compliance agent (see compliance card § 5).
Specifically: every factory-score number, every duty-rate number,
every monetary figure in the supplier brief comes from a tool call,
not the LLM.

## 6. Evaluations

Cases: `lib/ai/evals/sourcing/cases.v1.json`.
Same targets as compliance: ≥95% pass rate live, 100% pass rate
offline, ≤€0.05 / case median cost.

## 7. Known limitations

- **Factory-score data is curated, not exhaustive.** Suppliers without
  signal in the data sources score lower not because they're worse but
  because the platform has less to evaluate. The agent surfaces this
  explicitly.
- **Sanctions screening is indicative.** OrcaTrade ingests
  consolidated EU + UK lists; a hit is a paging signal, not a
  definitive denied-party verdict. Final clearance requires a customs
  / freight forwarder check.
- **No supplier-side communication.** The agent never contacts the
  supplier directly — only the importer.

## 8. Human oversight

- `requestHumanReview` invoked for any "approve / pay / sign"
  recommendation above the platform's irreversibility threshold.
- Sanctions hits route to manual review by default — the agent never
  clears a sanction-flag silently.
- `ai_call` audit row per invocation.

## 9. Revision history

| Version | Date | Change |
|---|---|---|
| v1 | 2026-06-02 | Initial published card (apex P1.F) |
