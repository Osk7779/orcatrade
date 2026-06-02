# Model card — Finance Agent

**Version:** v1 — published 2026-06-02
**Endpoint:** `POST /api/finance-agent`
**Source:** [`lib/handlers/finance-agent.js`](../../../lib/handlers/finance-agent.js)
**System prompt:** [`lib/ai/prompts/finance/v1.txt`](../../../lib/ai/prompts/finance/v1.txt)

---

## 1. Intended use

Summarises FX exposure, working-capital impact, and total cost of
ownership (TCO) for a planned import. Typical prompts:

- *"How much FX risk am I taking by paying this CN supplier in USD
  versus CNY?"*
- *"What's my cash conversion cycle on a €60k shipment with 30%
  upfront + 70% on B/L?"*
- *"Run a TCO comparison: this product ex-VN at €4.20 unit vs. ex-CN
  at €3.80 with anti-dumping."*

**EU AI Act classification:** Limited Risk (Art. 50 transparency).

## 2. Out-of-scope use

Not for:

- **Investment advice.** No "should you take this trade" verdict.
- **FX hedging product recommendations** to specific banks/brokers.
  Surfaces the exposure; doesn't sell a product.
- **Tax planning beyond import VAT/duty.** Income tax, corporate tax
  not in scope.
- **Credit decisions.** Working-capital analysis is descriptive, not
  a creditworthiness model.

## 3. Model and provider

- **Provider:** Anthropic (via `@anthropic-ai/sdk` v0.36)
- **Model class:** Claude Sonnet 4 family; handler reads
  `MODELS.FINANCE` from `lib/ai/models.js`.

## 4. Inputs and outputs

**Inputs:**
- Commercial parameters: supplier price + currency, payment terms,
  expected sale price, channel.
- Tool calls: `fxQuote` (mid-market + spread from
  `lib/intelligence/fx-quote.js`), `financeQuote` (working-capital
  cost from `lib/intelligence/finance-quote.js`), `tcoQuote` (full
  landed + WC aggregation), `customsQuote` for the duty/VAT leg.

**Outputs:**
- EUR-denominated TCO with FX leg surfaced separately so the user can
  see "what changes if the rate moves 3%".
- Working-capital cost expressed as days of cash tied up + EUR.
- A summary of the FX scenarios (mid / -3% / +3%) with the corresponding
  per-unit margin impact.

## 5. Calculator grounding contract

The FX snapshot lives at `lib/intelligence/data/fx-snapshot.js`
(refreshed quarterly; refresh date visible). All money math through
integer-cents (`lib/intelligence/money.js`). No JS-float arithmetic
on currency at any point.

## 6. Evaluations

Cases: `lib/ai/evals/finance/cases.v1.json`.

## 7. Known limitations

- **FX rates are snapshots.** A real treasury team locks rates via a
  forward or option; the agent's output is an indicative scenario
  analysis, not a price quote.
- **Working-capital model is rule-based.** 6% annual cost of capital
  assumption (`COST_OF_CAPITAL_ANNUAL` in `customs-quote.js`); the
  user can override but no per-customer credit-curve modelling.
- **Margins are computed against the user's declared sale price.**
  If the user enters a placeholder, the margin output is informational
  only.

## 8. Human oversight

- `requestHumanReview` for any recommendation that would lock FX
  positions or commit > €100k working capital.
- `ai_call` audit row per invocation.

## 9. Revision history

| Version | Date | Change |
|---|---|---|
| v1 | 2026-06-02 | Initial published card (apex P1.F) |
