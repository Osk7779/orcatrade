# Model card — Logistics Agent

**Version:** v1 — published 2026-06-02
**Endpoint:** `POST /api/logistics-agent`
**Source:** [`lib/handlers/logistics-agent.js`](../../../lib/handlers/logistics-agent.js)
**System prompt:** [`lib/ai/prompts/logistics/v1.txt`](../../../lib/ai/prompts/logistics/v1.txt)

---

## 1. Intended use

Recommends a routing + lane + warehouse + insurance combination for a
planned import, with a deterministic landed-cost quote that the user
can act on. Typical prompts:

- *"Cheapest reliable route for 18 m³ of homeware from Shenzhen to
  Łódź — must arrive within 8 weeks."*
- *"Should I use bonded warehousing for this seasonal SKU? What's the
  cash-flow trade-off?"*
- *"What insurance level matches a €120k FOB-value shipment, and
  what's covered vs. excluded under that level?"*

**EU AI Act classification:** Limited Risk (Art. 50 transparency).

## 2. Out-of-scope use

Not for:

- **Freight booking.** The platform never books. The agent recommends;
  the user contacts a forwarder.
- **Customs declaration filing** (see compliance card).
- **Cargo-insurance claims handling.** Advisory only.

## 3. Model and provider

- **Provider:** Anthropic (via `@anthropic-ai/sdk` v0.36)
- **Model class:** Claude Sonnet 4 family; handler reads
  `MODELS.LOGISTICS` from `lib/ai/models.js`.

## 4. Inputs and outputs

**Inputs:**
- Shipment description: commodity, FOB value, weight / volume, origin
  port / inland point, destination country, target delivery window.
- Tool calls: `routingQuote` (lane prices from `lib/intelligence/routing-quote.js`),
  `warehouseQuote` (3PL or bonded), `insuranceQuote`, `customsQuote`
  (duty + VAT at clearance), `tcoQuote` (full landed-cost aggregation).

**Outputs:**
- A landed-cost quote in EUR with every line traceable to a calculator:
  freight + brokerage + duty + VAT + storage + insurance + working
  capital.
- Recommended Incoterm + insurance level + warehouse strategy.
- Cash-flow trade-off analysis where bonded vs. clearance is a
  decision point.

## 5. Calculator grounding contract

Per the platform standard: every euro and percentage cites a tool.
The `tcoQuote` is the aggregate; the user sees the line-item breakdown.

## 6. Evaluations

Cases: `lib/ai/evals/logistics/cases.v1.json`.

## 7. Known limitations

- **Lane prices are snapshots, not live spot quotes.** Refreshed
  quarterly via `lib/intelligence/data/routing-snapshot.js`. Real
  spot-FAK rates drift weekly during Chinese New Year / peak season;
  the agent flags this.
- **Warehouse rates are partner-network indicative.** Final price
  requires a direct quote from the 3PL.
- **Insurance scope is generic.** The agent describes typical ICC
  (Institute Cargo Clauses) coverage; a specific policy's exclusions
  must be read against that policy's wording.

## 8. Human oversight

- `requestHumanReview` for any recommendation that would commit > 4
  weeks of inventory or > €50k of forwarder spend.
- `ai_call` audit row per invocation.

## 9. Revision history

| Version | Date | Change |
|---|---|---|
| v1 | 2026-06-02 | Initial published card (apex P1.F) |
