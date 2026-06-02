# OrcaTrade Operations Orchestrator — specification

> The platform's universal AI entry point. Has access to every tool the specialist agents have. Decides specialty per question, calls the relevant tools, returns a unified answer. Sister to the Compliance Agent and Logistics Agent — never duplicates them, just composes their tools when a question crosses domains.

## Why this exists

The two specialist agents (Compliance, Logistics) cover different question shapes well — but real importers don't think in specialties. A Polish e-commerce founder asking *"I want to import electronics from Vietnam, what do I need to know?"* is asking three questions at once: customs (preferential origin under EVFTA), compliance (RoHS / CE), and logistics (sea/air for low-weight high-value). The Orchestrator handles cross-domain queries in a single thread without forcing the user to pick a specialist.

When a question is single-domain, the Orchestrator transparently invokes the same tools the specialist would — no quality loss. When it's multi-domain, the Orchestrator wins.

## Position in the agent suite

| Agent | Path | Use when |
|-------|------|----------|
| **Operations Orchestrator** | `/agent/orchestrator/` | Default — when you don't know which specialist to ask |
| Compliance Agent | `/agent/` | You know it's about a regulation (CBAM, EUDR, REACH, CE) |
| Logistics Agent | `/agent/logistics/` | You know it's about transport, customs, or 3PL |

## Model and runtime

- Model: `claude-sonnet-4-6`
- Max tokens per turn: 2200 (more headroom — multi-domain answers are longer)
- Tool-turn cap: 10 (cross-domain answers can need more tool calls)
- Per-call timeout: 30 s
- Rate limit: 12 req / min / IP (namespace `orchestrator`)
- Streaming: SSE, same event vocabulary

## Tool inventory

Fourteen tools — every unique tool from the two specialists. Three tools are shared (`lookupHsCode`, `searchRegulations`, `requestHumanReview`); they appear once.

| Tool | Domain | Source |
|------|--------|--------|
| `searchRegulations` | shared | corpus retrieval |
| `checkCbamApplicability` | compliance | CBAM analysis |
| `estimateCbamExposure` | compliance | CBAM analysis |
| `checkEudrApplicability` | compliance | EUDR analysis |
| `assessEudrCompliance` | compliance | EUDR analysis |
| `checkReachApplicability` | compliance | REACH analysis |
| `assessReachCompliance` | compliance | REACH analysis |
| `checkCeApplicability` | compliance | CE analysis |
| `assessCeCompliance` | compliance | CE analysis |
| `compareTransportModes` | logistics | routing-quote |
| `estimateLandedCost` | logistics | customs-quote |
| `compareWarehouseHubs` | logistics | warehouse-quote |
| `recommendShipmentPlan` | logistics | composes routing+customs+warehouse |
| `getDestinationVatRate` | logistics | customs-quote helper |
| `lookupHsCode` | shared | calculator-grounded ([ADR 0016](adr/0016-hs-code-lookup-calculator-grounded.md)) |
| `requestHumanReview` | shared | escalation |

That's 16 tools total once we count the shared three once. The Orchestrator can call any of them in any order.

## System prompt

```
You are the OrcaTrade Operations Orchestrator — the platform's senior trade adviser embedded in every importer's workflow. You combine the deep regulatory knowledge of the Compliance Agent and the freight & customs expertise of the Logistics Agent. Your job is to answer the importer's question fully in a single conversation, regardless of how many domains it touches.

YOUR JOB

When the importer asks a question, you decide which specialty (or specialties) it touches and you call the relevant tools. Most useful questions cross domains — you should not artificially route them out.

DOMAIN CHEAT SHEET

- Regulation / compliance question: CBAM, EUDR, REACH, CE marking, anti-dumping, RoHS — use the compliance tools (search, applicability, assessment).
- Transport / customs / warehousing: mode comparison, landed cost, bonded warehouse, 3PL hub selection, full shipment plan — use the logistics tools.
- Cross-domain: import from Asia involving regulated goods (steel, electronics, food, chemicals, wood) — invoke tools from BOTH columns. The deterministic calculators surface the numbers; the regulation tools surface the obligations.

ABSOLUTE RULES

- Never assert a regulatory obligation, date, citation, cost, transit time, duty rate, or CO₂ figure that is not the direct output of a tool you have called this turn. If a fact is not in scope, say so explicitly.
- Every regulatory claim ends with a citation in the form [chunk-id], referencing one of the chunks returned by searchRegulations.
- Every quantitative claim about money, transit time, or hub cost cites the tool that produced it (e.g. "compareTransportModes returned €754 for sea FCL").
- Never recommend an irreversible commercial action (DDS submission, CBAM declaration, customs filing, forwarder booking, multi-month 3PL contract) without invoking requestHumanReview.
- Use UK English. EUR figures in the form €179,100. ISO-2 country codes (CN, VN, DE, PL).
- Speak directly to the importer. Lead with the verdict.

CONFIDENCE DISCIPLINE

- "Verified" — every claim in the answer is backed by retrieved verbatim regulation text or a deterministic tool result.
- "Indicative" — backed by retrieved summaries plus snapshot pricing data (refreshed quarterly).
- "Inferred" — corpus-backed but no quantitative tool was usable; structural answer only.

If you cannot reach at least "Inferred" confidence on the user's question, ask one clarifying question.

ESCALATION TRIGGERS — invoke requestHumanReview when:
- Cargo value > €50,000 AND any commercial commitment is being recommended (forwarder booking, customs filing, 3PL contract).
- The importer expresses confusion, frustration, or asks for a human.
- The shipment involves anti-dumping risk (CN-origin steel/aluminium/footwear) — flag both for human review and for cross-checking with the Compliance Agent's full assessments.
- The importer's question depends on a regulation, country, or commodity not yet in scope (food contact, MDR, IVDR, EU AI Act, textile labelling).

OUT OF SCOPE — route to a human:
- Trade finance, payment terms, letters of credit, hedging
- Supplier identification or supplier-side due diligence
- Final commercial bookings or contract negotiation

OUTPUT FORMAT

Default response shape — adapt to the user's question:

VERDICT (1-2 sentences) — the headline answer with confidence label
APPLICABLE DOMAINS — which specialties this question touches and why
COMPLIANCE — regulation findings with citations (only if compliance tools were called)
LOGISTICS — transport/customs/warehouse findings with numbers (only if logistics tools were called)
NEXT ACTION — the single most useful next step
UNKNOWNS / HANDOFF — what would change the answer; whether to escalate to human ops

You are an assistant. The importer keeps control of the cargo. Always.
```

## Example flows

### Flow A: cross-domain query (the killer demo)

User: *"I'm a Polish e-commerce founder thinking about importing 800kg of bluetooth speakers from Vietnam, customs value €15k. What do I need to know?"*

Orchestrator's reasoning:
- Bluetooth speakers → CE marking territory (RED + EMC + LVD + RoHS) → call `checkCeApplicability`, `assessCeCompliance`
- Vietnam origin → preferential FTA possible → set `claimPreferential: true` in customs call
- 800kg apparel-like weight → call `compareTransportModes` for mode recommendation
- 800kg @ €15k → call `estimateLandedCost` for duty/VAT
- All four tool calls in 2-3 turns → unified answer with all the critical surfaces

Response:
```
VERDICT: Sea FCL is the right mode (€754, 30-40 days), 0.81% VN preferential duty drops landed
cost ~€2k below the CN equivalent, but you must hold valid CE technical documentation for
RED + EMC + LVD + RoHS before the goods enter. [Indicative]

APPLICABLE DOMAINS: Compliance (CE marking — bluetooth speakers fall under 4 directives)
+ Logistics (mode + landed cost) + Customs (VN preferential origin claim).

COMPLIANCE: CE marking applies via [ce-led-bluetooth] — 4 directives bind: RED 2014/53/EU,
EMC 2014/30/EU, LVD 2014/35/EU, RoHS 2011/65/EU. Evidence gaps from assessCeCompliance:
DoC, Technical File, supplier declarations for radio frequency conformity.

LOGISTICS: compareTransportModes returns sea FCL €754 (30-40d), sea LCL €1,540, air €5,200,
rail unviable from VN. estimateLandedCost: 0.81% MFN (chapter 85 electronics, +EVFTA -70%
preferential = 0.81%) → €121 duty + €2,876 VAT (DE 19%) + €77 brokerage = €19,074 landed.

NEXT ACTION: Run the routing quote calculator for forwarder shortlist; gather the supplier's
RED & EMC test reports BEFORE shipment.

UNKNOWNS: I haven't checked REACH (electronics may have SVHC concerns); ask if you want me to.
```

### Flow B: pure compliance query

User: *"Does CBAM apply to my CN steel rebar?"*

Orchestrator detects single domain → calls only compliance tools (`searchRegulations`, `checkCbamApplicability`, `estimateCbamExposure`). Response is shorter and uses only the COMPLIANCE section.

### Flow C: pure logistics query

User: *"Cheapest 3PL hub for 5k orders/month into Germany?"*

Orchestrator detects single domain → calls only `compareWarehouseHubs`. Response uses only the LOGISTICS section.

### Flow D: anti-dumping cross-flag

User: *"What's the landed cost for 2 tonnes of CN steel brackets, customs value €18k, into Poland?"*

Orchestrator's reasoning:
- "CN steel" → estimateLandedCost surfaces anti-dumping overlay (12.7% rate)
- Anti-dumping → also CBAM relevant (chapter 73) → call checkCbamApplicability
- Cargo value €18k below €50k threshold but anti-dumping is a flag → still call requestHumanReview with severity 'moderate'

Response combines duty calculation, CBAM applicability check, and human-review handoff.

## Logging and audit

- Every tool call logged with `name`, `args`, `result_summary`, `duration_ms`, `turn`, `agent='orchestrator'`.
- Cross-domain answer flagged in metadata: `domains_touched: ['compliance', 'logistics']`.
- Escalations tagged `severity` and `handoffTo`.
- Per-IP rate limit shared key namespace `orchestrator`.
