# EU AI Act conformance — OrcaTrade

This document is OrcaTrade's published position under the EU AI Act
(Regulation (EU) 2024/1689). It is the answer customers, regulators,
and procurement teams should see when they ask *"how does OrcaTrade
comply with the EU AI Act?"*.

Last updated: 2026-06-02. Owner: Oskar Klepuszewski (founder, AI
oversight lead).

---

## 1. Scope and classification

OrcaTrade deploys five AI agents (compliance, sourcing, logistics,
finance, orchestrator) covered by individual
[model cards](model-cards/README.md). Each agent is built on a
general-purpose AI model (Anthropic Claude 4 family) accessed through
the provider's API.

**All five agents are classified as Limited Risk** under the EU AI Act,
on the grounds that:

- They are **decision-support** systems, not decision-making systems.
  Every monetary, percentage, weight, or duty-rate figure in an agent
  response is the output of a deterministic calculator
  ([`lib/intelligence/*-quote.js`](../../lib/intelligence/)); the LLM
  produces prose on top of those numbers. Agents never autonomously
  execute irreversible actions (customs filing, CBAM surrender, EUDR
  DDS submission, supplier payment) — those route through
  `requestHumanReview` first.
- They do not perform **biometric identification**, **emotion
  recognition**, **social scoring**, **predictive policing**, or any
  other Annex III high-risk activity.
- They do not interact with **vulnerable groups** as a primary user
  base (audience: trade-compliance professionals at SME importers).
- They do not generate **deepfakes** or **synthetic content
  representing real people**.

Per Art. 50, Limited Risk systems carry transparency obligations only
(see §2 below).

If OrcaTrade ever ships an agent that:

- automates a decision affecting access to essential services (Annex III.5),
- evaluates a person's creditworthiness (Annex III.5b),
- operates in employment / education / migration / law-enforcement
  contexts (Annex III.4, III.3, III.7, III.6),

the agent moves to **High Risk** and this document must be updated to
reference the corresponding Annex IV technical-documentation pack
before that agent is deployed.

## 2. Transparency obligations (Art. 50)

OrcaTrade satisfies the Art. 50 transparency obligation through:

| Surface | How users are informed |
|---|---|
| Every agent's HTTP response | Includes the agent name in the response envelope; the orchestrator labels each section with the originating specialist. |
| App-shell UI (`/app/`) | Chat bubbles clearly attributed to *"OrcaTrade Operations Orchestrator"* (not "AI assistant"). System messages explain the agent is AI-driven and surface confidence labels. |
| Confidence labels | Every assertion ships with one of *Verified / Indicative / Inferred* so the user can calibrate trust. |
| Model cards | Public at [`docs/ai/model-cards/`](model-cards/README.md). |
| This document | Linked from the trust centre + DPA template + each model card. |

Users are never led to believe they are interacting with a human. The
copy on every agent-bearing surface uses *"OrcaTrade AI"* or names
the agent explicitly.

## 3. General-purpose AI (GPAI) considerations

Anthropic's Claude is a general-purpose AI model. Under the EU AI Act,
the **provider** of the GPAI model (Anthropic) bears most GPAI
obligations (Art. 53–55). OrcaTrade is a **downstream provider** /
**deployer** under Art. 25, with the following obligations:

| Obligation | OrcaTrade's evidence |
|---|---|
| Inform users that they interact with AI (Art. 50.1) | §2 above |
| Mark AI-generated content as such (Art. 50.2) | Agent responses are clearly attributed; no human impersonation |
| Cooperate with the AI Office on systemic-risk requests (Art. 56.2) | Founder is the AI oversight contact: `oskar@orcatrade.pl` |
| Maintain technical documentation if classified as a downstream provider (Art. 25.3) | Model cards + this document + audit trail |
| Pass-through GPAI documentation from Anthropic | Anthropic publishes model cards at [anthropic.com/research](https://www.anthropic.com/research); OrcaTrade does not redistribute these. |

## 4. Human oversight (Art. 14 — applied voluntarily)

Although Art. 14's mandatory human-oversight requirements bind High
Risk systems, OrcaTrade applies the same discipline to its Limited
Risk agents because of the financial and regulatory stakes of import
operations:

1. **`requestHumanReview` tool** on every agent. Any tool call that
   would file, sign, or commit an irreversible action invokes this
   tool first; the agent never executes irreversible actions
   directly. See each model card § 8.
2. **Confidence-tier escalation.** *Inferred*-confidence answers
   driving > €20,000 cargo-value decisions are explicitly flagged to
   the user as "escalate before acting".
3. **Audit trail.** Every agent invocation writes an `ai_call` event
   to the tamper-evident chain (see
   [`docs/security/audit-trail.md`](../security/audit-trail.md)). The
   provenance of every output is reconstructible.
4. **Per-tenant spend cap** (apex plan P1.7). Hard EUR/month cap per
   tier (free €1, starter €15, growth €100, scale €500). Caps
   surface runaway behaviour to operators before it surfaces as a
   billing surprise.
5. **Eval gate in CI.** Live AI evaluations run nightly via
   `.github/workflows/evals.yml`; the gate hard-fails at < 95% pass
   rate per agent (apex plan P0.15).

## 5. Data governance (Art. 10 — applied voluntarily)

Limited Risk systems are not required to publish a data-governance
statement under Art. 10, but the same questions apply for
procurement:

- **Training data:** OrcaTrade does **not** train models. We consume
  Anthropic's pre-trained Claude family via API. We do not fine-tune.
- **Prompts:** Maintained in version-controlled files under
  [`lib/ai/prompts/<agent>/v*.txt`](../../lib/ai/prompts/). Each file
  is immutable once published; changes ship as a new version.
- **Retrieval corpus (RAG):** OrcaTrade ingests EU/UK regulation text
  (CBAM, EUDR, REACH, CE marking, anti-dumping/countervailing duty
  notices, TARIC nomenclature) and curated trade-defence chunks.
  Chunks are cited by `[chunk-id]` in every regulatory claim. The
  corpus is reviewed quarterly.
- **User input:** API inputs are not sent to Anthropic for any purpose
  other than producing the immediate response. Per Anthropic's
  commercial terms, traffic is retained ≤ 30 days for abuse
  monitoring then deleted. Anthropic does not train on API traffic.

## 6. Risk management (Art. 9 — applied voluntarily)

The AI-specific risks OrcaTrade actively monitors:

| Risk | Mitigation |
|---|---|
| **Number fabrication** | `checkGrounding` eval; every printed number must match a calculator output within tolerance |
| **Number omission** | `checkNumericFidelity` eval (apex P1.6); every load-bearing calculator output must appear in prose |
| **Hallucinated citations** | Citation format enforced (`[chunk-id]`); the live-eval harness asserts every claimed chunk-id maps to a real retrieved chunk |
| **Prompt injection** | Threat model in [`docs/security/threat-models/`](../security/threat-models/) (apex P1.E, queued) |
| **Tool poisoning** | Same threat model; deterministic tool outputs not influenced by LLM input |
| **Model upgrade drift** | Eval gate re-runs full suite on every model change; cost telemetry surfaces unexpected token-budget jumps |
| **Per-tenant runaway cost** | Spend cap + dashboard (apex P1.7) |
| **Data leakage to provider** | API-only, no training; raw email never enters Anthropic prompts (only `emailHash`) |

## 7. Conformity assessment (Art. 43)

Limited Risk systems do not require third-party conformity assessment
under Art. 43. **OrcaTrade declares conformity** with the obligations
applicable to its classification (Art. 50 transparency + voluntary
Art. 14 oversight discipline) through:

- The model cards ([`docs/ai/model-cards/`](model-cards/README.md))
- This conformance document
- The audit trail referenced in §4

If a customer requires a third-party AI assessment as part of
procurement, OrcaTrade engages the customer's chosen assessor at the
customer's cost. The cost-allocation provision lives in the MSA
template (queued — apex Phase 2 deliverable).

## 8. Reporting and review

- **Annual review** of this document by the founder, or whenever a new
  agent ships, or the EU AI Act's Implementing Acts revise the
  applicable rules.
- **Incident reporting** (Art. 73 — serious-incident notification):
  although mandatory for High Risk, OrcaTrade applies a voluntary
  notification policy. Material AI-driven incidents (wrong number
  surfaced, citation hallucinated, agent acted on irreversible action
  without `requestHumanReview`) are logged in the incident-response
  flow ([`docs/security/incident-response.md`](../security/incident-response.md))
  with breach-notification SLAs.
- **Regulator contact:** the AI Office for OrcaTrade's establishment
  (Poland) is the Ministry of Digital Affairs. We will register if /
  when our classification moves to High Risk. As Limited Risk, no
  registration is required.

## 9. Limitations of this document

- **Not legal advice.** This document is OrcaTrade's good-faith
  reading of the EU AI Act as of the *Last updated* date. The Act's
  Implementing Acts continue to be published; some details below may
  be superseded.
- **Pending Implementing Acts** as of 2026-06-02: code-of-practice for
  GPAI (Art. 56); harmonised standards for Annex IV technical
  documentation; further Annex III scope guidance. We track these and
  update this document when material.
- **Customer-specific obligations not addressed here.** A customer
  using OrcaTrade in a regulated workflow (e.g. a customs broker
  passing through AI-derived advice to a third party) carries their
  own EU AI Act obligations as a deployer. Our DPA template
  (queued — Phase 2) covers the relevant allocations.

## 10. Revision history

| Version | Date | Change |
|---|---|---|
| v1 | 2026-06-02 | Initial published conformance document (apex P1.G) |
