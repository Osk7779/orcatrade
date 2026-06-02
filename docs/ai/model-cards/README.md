# OrcaTrade AI model cards

This folder is the per-agent technical documentation required by:

- **EU AI Act Art. 11 + Annex IV** (technical documentation for
  AI systems before placing on the market — Limited Risk + General
  Purpose AI obligations)
- **EU AI Act Art. 50** (transparency obligation — users informed they
  interact with an AI system)
- Procurement security questionnaires (CAIQ v4 §EOS, SIG Lite §AI)
- SOC 2 CC2.1 ("information about objectives is communicated")

Each card answers the same eight sections for one agent: intended use,
out-of-scope use, model + provider, inputs/outputs, calculator
grounding, evaluations, known limitations, human oversight.

Last updated: 2026-06-02.

---

## Index

| Agent | URL | Purpose |
|---|---|---|
| [Compliance](compliance.md) | `/api/agent` | Regulatory evaluation (CBAM, EUDR, REACH, CE, ADD/CVD) for a planned import |
| [Sourcing](sourcing.md) | `/api/sourcing-agent` | Supplier triage + factory-score interpretation |
| [Logistics](logistics.md) | `/api/logistics-agent` | Routing, lane, warehouse, insurance recommendation |
| [Finance](finance.md) | `/api/finance-agent` | FX exposure, working-capital, TCO summary |
| [Orchestrator](orchestrator.md) | `/api/orchestrator` | Cross-domain question routing — merges all four specialists' tool surfaces |

## How to read a model card

Each card is structured for three audiences:

1. **The user** — what the agent is for and what it won't do.
2. **The procurement reviewer** — provider, model, escalation path,
   known limitations.
3. **The auditor** — calculator-grounding contract, eval coverage, the
   exact failure modes we monitor for.

If a section says *"not yet applicable"* or *"queued"*, that is the
honest state — we don't claim what we haven't shipped.

## Hard rules every agent obeys

These are repeated on every card because they're the AI-safety
contract of the whole platform:

1. **No decision-driving numbers from the LLM.** Every monetary,
   percentage, weight, or duty-rate figure in the response comes from
   a calculator output, not the model. The eval harness enforces this
   via `checkGrounding` (catches fabrication) and `checkNumericFidelity`
   (catches omission).
2. **Citations on every regulatory claim.** Format: `[chunk-id]` to a
   retrieved regulation chunk. A claim without a citation is a model
   failure and fails its case.
3. **Human review before irreversible action.** Any tool call that
   would file, sign, or commit something irreversible (customs entry,
   CBAM surrender, supplier contract above a threshold, EUDR DDS)
   invokes `requestHumanReview` first. The agent never executes those
   directly.
4. **Calculator-grounded math.** All money is integer cents via
   `lib/intelligence/money.js` (banker's rounding). No JS-float
   arithmetic on money in any calculator.

## Updating a card

Cards are immutable once published for an agent version. To document
a model change or prompt-version bump:

1. Open a PR that ships the change + an updated card.
2. Bump the *Version* line at the top of the card.
3. Add an entry to the *Revision history* at the bottom.
4. The PR description states what changed, what it affects, and
   which eval cases were re-run.

## See also

- [`docs/security/data-flow.md`](../../security/data-flow.md) — where
  AI inputs / outputs sit in the data-flow diagram.
- [`docs/security/audit-trail.md`](../../security/audit-trail.md) —
  every agent invocation produces an `ai_call` audit row.
- [`CLAUDE.md`](../../../CLAUDE.md) — non-negotiable engineering rules
  governing the AI layer.
