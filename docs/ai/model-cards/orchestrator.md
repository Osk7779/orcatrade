# Model card — Orchestrator (meta-agent)

**Version:** v1 — published 2026-06-02
**Endpoint:** `POST /api/orchestrator`
**Source:** [`lib/handlers/orchestrator.js`](../../../lib/handlers/orchestrator.js)
**System prompt:** [`lib/ai/prompts/orchestrator/v1.txt`](../../../lib/ai/prompts/orchestrator/v1.txt)

---

## 1. Intended use

The orchestrator is OrcaTrade's cross-domain entry point. It merges
the 14 tools from the four specialist agents (compliance, sourcing,
logistics, finance) into one tool surface so a user can ask a question
that spans domains and get a single answer.

Typical prompts:

- *"Plan my full import of 5,000 LED lamps from Vietnam to Germany —
  give me classification, duty, route, total landed cost, and the
  compliance checks I'll need to pass."*
- *"I'm comparing two suppliers — one in CN with anti-dumping
  exposure, one in IN with longer lead time. Which is cheaper end-to-end
  and what regulatory work does each require?"*

A signed-in user gets the **personal orchestrator**
(`lib/handlers/orchestrator-personal.js` helper) which can also reason
over the user's own saved plans + portfolios + actuals — *"how does
this new lane compare to my last six bookings on the same route?"*

**EU AI Act classification:** Limited Risk (Art. 50 transparency). The
broader tool surface raises stakes versus a specialist; oversight
discipline is the same plus per-tenant spend cap.

## 2. Out-of-scope use

Same exclusions as the specialists. Plus:

- **Not a chat-everything assistant.** Out-of-domain questions ("write
  me an email", "what's the weather") are politely redirected.
- **Not a "decide for me" agent.** It compiles options + numbers + the
  unknowns — the user still chooses.

## 3. Model and provider

- **Provider:** Anthropic (via `@anthropic-ai/sdk` v0.36)
- **Model class:** Claude Opus 4 family at time of writing — the
  orchestrator is the highest-stakes surface, gets the strongest
  model. Handler reads `MODELS.ORCHESTRATOR` from `lib/ai/models.js`.
- **Inference region + retention:** see compliance card § 3.
- **Tool surface:** 14 tools merged from the four specialists, plus
  `requestHumanReview` and the personal-context tools when signed in.

## 4. Inputs and outputs

**Inputs:**
- A natural-language message describing the cross-domain question.
- Optional: the user's session (drives the personal-context tools).
- Tool-call results: the full merged tool surface.

**Outputs:**
- A multi-section response that names which domain each finding came
  from, with citations to the producing tool.
- A landed-cost or scenario aggregate where applicable.
- A clear list of *unknowns* — what the orchestrator chose not to
  decide and why.

## 5. Calculator grounding contract

Identical to the specialists' contract. Because the orchestrator
spans more tools, the surface area for fabrication is larger; the
eval cases under `lib/ai/evals/orchestrator/cases.v1.json` are
designed to exercise cross-domain numeric coherence (e.g. the duty
quoted in the compliance section must match the duty in the TCO
aggregate within tolerance).

## 6. Evaluations

Cases: `lib/ai/evals/orchestrator/cases.v1.json`.

The orchestrator has stricter latency targets because it usually
makes multiple tool calls in sequence:

- p95 ≤ 12s end-to-end (vs. 8s for specialists)
- Token budget: per-tenant Anthropic spend cap enforced via
  `gating.checkAgentSpend` (apex P1.7); free tier €1 / month,
  scale tier €500 / month.

## 7. Known limitations

- **Tool-loop depth.** Capped at `ORCHESTRATOR_MAX_TOOL_TURNS` to
  avoid runaway loops. Hitting the cap surfaces a truncation flag in
  the response; the user is told the answer is partial.
- **No cross-tenant memory.** The personal orchestrator reads only the
  signed-in user's plans/portfolios/actuals. No "users like you also
  did X" — by design.
- **Spend cap is hard-cliff at €1/€15/€100/€500.** A user at the cap
  gets the gate's failure mode (fail-OPEN with a degraded-mode
  message) rather than a soft reduction.

## 8. Human oversight

- All four specialists' `requestHumanReview` triggers are inherited.
- The per-tenant spend cap is itself an oversight layer — if the
  orchestrator is running away, the budget surfaces it.
- The `/dashboard/ai/` per-tenant rollup (apex P1.7 visibility) shows
  ops who is approaching their cap.
- `ai_call` audit row per invocation, including the personal-context
  tools used if any.

## 9. Revision history

| Version | Date | Change |
|---|---|---|
| v1 | 2026-06-02 | Initial published card (apex P1.F) |
