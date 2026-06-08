# OrcaTrade — Strategic Plan 2026-2031

**Subtitle:** Path to $1B ARR · Five-year apex strategy
**Author:** Oskar Klepuszewski, Co-Founder & CFO, OrcaTrade Group Ltd
**Version:** 1.0 · 2026-06-08
**Status:** Apex — supersedes `docs/billion-dollar-plan.md` as the strategic frame; the 18-month `docs/execution-plan.md` is the calendar-locked operational rollout of Phases 0–2 below

---

## 0. How this document relates to the existing planning stack

OrcaTrade already has four planning layers in the repository: the apex `billion-dollar-plan.md` (directional pillars, no calendar), the canonical 18-month `execution-plan.md` (Phases 0–2 calendar-locked, Phase 5 horizon), the six-track `backend-grade-plan.md` (infrastructure depth), and the chronological `dev-plan.md` (sprint history + horizon ranking). They are internally coherent.

This document fills three gaps the existing stack materially under-weights:

1. **Five-year capital plan** — funding rounds, runway, valuation milestones, dilution arithmetic, and the gates that unlock each round.
2. **Three strategic leaps** — from advisor to system of record, from product to marketplace, from direct SaaS to embedded distribution. Each is a leap-step, not a sprint, and none is currently the spine of any existing plan.
3. **Commercial flywheel** — the GTM motion that compounds quarter-on-quarter; pricing/packaging discipline; partner ecosystem; M&A as a regulatory-coverage accelerant.

The `execution-plan.md` remains the contract for Phases 0–2 (2026-06 → 2027-01). This document is the contract for Phases 3–9 (2027-Q2 → 2031-Q4). Where a tension exists, the calendar-locked execution-plan wins for already-committed PRs; this document wins for the strategic frame the execution-plan rolls under.

---

## 1. Executive summary

OrcaTrade today is a sophisticated **calculator-grounded AI agent platform** for European import operations: 12 substantive deterministic quote calculators, 5 Opus-4-7 agents with 46 calculator-backed tools, write-time hash-chained audit trail, GDPR-complete erasure, ~580 EN/PL/DE SEO guides, 3,696 passing tests, and a premium marketing surface. The honest gap is the customer-living surface: the dashboard is a polished skeleton with a "demo mode" banner, Stripe keys are unset, ERP connectors are unbuilt, regulatory scope ends at EU+UK, and the company is pre-revenue with no paying customers as of 2026-06-08.

The path from this foundation to a $1B-ARR SaaS in five years is not "ship more features." It is three discrete leaps, sequenced:

1. **From advisor to system of record** (2026 H2 — 2027 H2): Customers stop using OrcaTrade alongside their ERP; they begin to *operate* shipments inside it. Documents are filed, not just drafted. Exceptions are queued, not just flagged. The Goods/Supplier/Journal master schemas land. This is the table-stakes leap to land six-figure enterprise contracts.

2. **From product to marketplace** (2028): Verified supplier network, trade-finance lender panel, and freight/customs partner integrations become the moat. Each new participant compounds value for every other. This is the leap that turns the calculator from a feature into a market.

3. **From direct SaaS to embedded distribution** (2029-2030): OrcaTrade is consumed inside Stripe Atlas, NetSuite App Marketplace, SAP BTP, Faire, Amazon Seller Central, and as white-label inside top-25 European 3PLs (DSV, Kuehne+Nagel, DB Schenker). Direct sales accounts for <40% of new ARR by Q4 2030. This is the leap that breaks the linear cost of growth and unlocks the $100M-$1B ARR step.

The five-year revenue arc, with explicit gates that release each phase:

| End of period | ARR target | Customer count | NDR | Gross margin | Headcount |
|---|---|---|---|---|---|
| 2026-Q4 | €0.3M | 12 paid (10 SMB + 2 enterprise pilot) | n/a | n/a (R&D phase) | 6 |
| 2027-Q4 | €3.0M | 90 paid (75 SMB + 15 enterprise) | 110% (cohort too young) | 68% | 18 |
| 2028-Q4 | €15M | 400 paid (300 SMB + 100 enterprise) | 125% | 74% | 45 |
| 2029-Q4 | €55M | 1,800 paid + 80 embedded partners | 130% | 78% | 110 |
| 2030-Q4 | €160M | 6,500 paid + 250 embedded partners | 132% | 80% | 240 |
| 2031-Q4 | €350M (run-rate) | 15,000+ active | 130%+ | 81% | 420 |

These targets are projections, not commitments — they assume Series A closes by Q1 2027 and the marketplace leap lands by Q4 2028. The standing rule from ADR 0002 holds: no marketing surface, pitch deck, or press release publishes any of these numbers as a claim, ever. They are an internal commercial-planning artefact only.

---

## 2. Honest state audit (2026-06-08)

Conducted across four parallel research streams. Verdict per dimension:

| Dimension | Verdict | Evidence |
|---|---|---|
| Calculator core | **Real, enterprise-grade** | 12 quote modules in `lib/intelligence/`; rate cards Q1 2026; integer-cents money discipline (ADR 0004); 3,696 tests green |
| AI agent layer | **Real, calculator-grounded** | 5 Opus-4-7 agents with 46 total tools; zero load-bearing stubs (ADR 0015/0016); 41 eval cases; eval gate live (ADR 0018) |
| Audit trail | **Enterprise-grade** | Write-time hash chain in `lib/events.js`; awaited before 2xx (ADR 0005); Article-17 pseudonymisation cascades |
| PII handling | **Enterprise-grade** | Email-hash storage (ADR 0008); log redaction; AI-prompt redaction; no leaks in error messages |
| GDPR endpoints | **Enterprise-grade** | `/api/account/export` + `/api/account/delete` cascade across plans, alerts, memory, drafts, events |
| Observability | **Startup-grade, scaling** | Structured logs + Sentry envelope; per-subsystem health probes; cost telemetry in `prompt_runs`. Gap: no custom metric alerts |
| Circuit breakers | **80% coverage** | Resend + Anthropic wrapped (ADR 0006); **OIDC token_endpoint + JWKS fetch not wrapped** (gap to close) |
| Postgres dual-write | **Built but inert** | Schema complete; writes happen; read-shadow opt-in (`ORCATRADE_SHADOW_PG`) and **not enabled in production** |
| Auth | **Real** | Magic-link + password + OIDC + TOTP MFA; rate-limited; session-cookie HMAC-signed |
| Billing | **Code real, keys missing** | Full Stripe wrapper + webhook idempotency in `lib/handlers/billing.js`; `STRIPE_SECRET_KEY` unset → upgrade returns 503 |
| Dashboard / app shell | **Skeleton with demo banner** | `/dashboard/index.html` shows ops chrome but says "Demo mode … real session-backed activity arrives when auth + database are wired in" |
| Marketing surface | **Premium, EN/PL/DE** | Aurora hero, cinematic motion, manifesto copy, 580 localised guides; serif/sans/mono type system; consistent navy + ivory palette |
| Pricing | **Defined, unpublished as live SKUs** | 5 tiers (Free → Enterprise) + 6 add-ons + execution-fee table specified; not wired into a live `/pricing` page that sells |
| Customers | **Zero** | Pre-revenue; honest about it; no fabricated testimonials |
| Regulatory scope | **EU+UK only** | TARIC live, CBAM, EUDR, REACH, CE, anti-dumping/CVD, rules-of-origin (EU FTAs); **no US HTS, no Section 301, no USMCA, no China outbound, no CPTPP/RCEP** |
| Compliance certifications | **None held** | SOC 2 Type I target 2026-Q4; Type II target 2027-Q2; ISO 27001 not started |
| Insurance posture | **None** | E&O insurance "user-owned" in execution-plan; no broker engaged; no liability-bearing accuracy guarantees offered |

**What a paying customer would actually receive today:** API access (curl/SDK) to a working compliance/logistics/finance/sourcing agent, a working `/start/` wizard producing a calculator-grounded import-plan PDF, magic-link auth into a polished-but-empty dashboard, and a 503 on the Stripe upgrade button. The calculator is genuinely impressive on real inputs (e-bike from China: live TARIC, anti-dumping 70.1% + CVD 17.2% surfaced correctly). The product they would *live inside* — the dashboard with shipments, alerts, exceptions, documents, and integrations — does not exist yet.

---

## 3. Market opportunity and competitive landscape

### 3.1 TAM sizing (defensible figures)

- **Global trade compliance software** (Gartner, 2025): ~$3.1B, 8.4% CAGR → ~$6.0B by 2030
- **Global trade & customs management** (broader bucket — Gartner / IDC): ~$8.5B, 9.1% CAGR → ~$17B by 2030
- **Import operations + supplier orchestration + trade finance software** (our actual TAM, OrcaTrade-internal sizing): ~$22B, 7.5% CAGR → ~$32B by 2030
- **EU + UK addressable wedge** (mid-market and enterprise importers, €10M–€2B revenue): ~€7.5B SAM in 2026, ~€11B by 2030

A 1% share of the 2030 SAM is €110M ARR. A 5% share is €550M. A 10% share is over €1B.

### 3.2 Incumbents — what they are and where they bleed

| Vendor | Revenue | Strength | Where they bleed |
|---|---|---|---|
| **SAP GTS** | ~$1.2B (bundled) | Deep ERP integration, regulatory breadth, 30-year credibility | Six-figure floor; 9–18 month implementations; configured by consultants; UX is 2008-vintage |
| **Descartes** | ~$580M | Logistics depth, customs broker network, EDI native | Bolt-on architecture; per-document pricing locks out SMBs; AI is veneer |
| **Thomson Reuters ONESOURCE Global Trade** | ~$400M (segment est.) | Regulatory content quality, big-4 partnerships | Content-as-product; weak operational layer; static rule editor |
| **E2open** | ~$650M | Supply-chain network breadth, multi-party orchestration | Complex pricing; long deployments; declining net retention |
| **Avalara** | ~$900M | Tax automation, embedded distribution (Shopify, NetSuite) | Tax-only; trade compliance is a sidecar, not core |
| **Flexport** | ~$2.6B (mostly freight) | Brand, software-meets-forwarder model | Capital intensive; freight margins crushing valuation; software lags ambition |
| **Project44** | ~$240M | Real-time visibility, carrier network | Visibility-only; no compliance, no advisory, no document automation |

The structural opening: **none of the incumbents are AI-native, calculator-grounded, mid-market-priced, and self-serve-on-ramping**. SAP and Thomson Reuters sell to procurement committees over 9-month cycles at €150K+ entry. Avalara is tax-only. Flexport and Project44 are logistics-first. Descartes is per-document and unfriendly to growth-stage importers. The €10M–€200M-revenue European importer has no good option today — they live in spreadsheets, broker-portal logins, and email chains. That's the wedge.

### 3.3 The wedge — the first 100 customers

**Vertical-narrow, geography-narrow, persona-narrow entry**, then expand.

- **Industry**: textiles & apparel + consumer electronics + bikes/e-bikes (three verticals carrying the highest regulatory weight under EU CBAM, anti-dumping, EUDR cotton, and REACH).
- **Geography**: Polish + German + Dutch importers buying from China/Vietnam/Bangladesh/India.
- **Persona**: Head of Operations or Head of Supply Chain at €5M–€80M-revenue importers; CFO-adjacent on duty-cost decisions.
- **Pain entry**: anti-dumping/CVD surprise + CBAM Q1-2026 quarterly report deadline. Both are "I just got hit with a 6-figure unexpected cost" moments — perfect wedge for inbound conversion off SEO.

This wedge is already partially earned via the SEO moat (~580 guides indexed in PL/DE/EN). The job is to convert that traffic into 90 paying customers by end of 2027.

---

## 4. The three strategic leaps

### LEAP 1 — From advisor to system of record (2026 Q4 → 2027 Q3)

#### 4.1.1 Why this leap

Today's OrcaTrade is consulted: a customer asks the agent a question, gets a calculator-grounded answer, and goes back to their spreadsheet. The ceiling on revenue-per-customer in this posture is ~€500/mo (Growth tier). To land a €5K-€15K-per-month enterprise contract — the unit economics required for sales-team-led growth — OrcaTrade must become the system the customer *operates in*. Shipments are filed inside it. Documents live inside it. Exceptions are worked inside it. Customs declarations are submitted from it.

This is the leap that separates Descartes ($580M revenue) from any of the 50+ "trade compliance content sites" that never broke €5M ARR.

#### 4.1.2 Concrete deliverables

| ID | Deliverable | Why it matters | Owner |
|---|---|---|---|
| L1.1 | **Goods master schema** (SKU, HS classification, origin, REACH SVHC flags, CBAM scope, restricted substances) — Postgres tables + dashboard CRUD UI | Without a Goods master, every quote is a one-off; with it, every shipment inherits known classification | Eng |
| L1.2 | **Supplier master schema** (entity, factory locations, sanctions screen status, audit certs with expiry, EUDR DDS evidence, trust score) | Sanctions screening is per-supplier, not per-shipment — must persist | Eng |
| L1.3 | **Shipment object** as the central operational entity (status state-machine: planned → booked → in-transit → cleared → delivered → exception; per-shipment document vault) | The unit the customer thinks in — replaces "saved plan" as the live primitive | Eng |
| L1.4 | **Document filing** — not drafting (current state) but submitting: customs declarations to IDEX/CDS via filing-partner API; CBAM quarterly report submission; EUDR DDS lodgement | The leap from "we tell you what to file" to "we file it" — six-figure-contract gate | Eng + Partner |
| L1.5 | **Exception queue** — agent watches every active shipment for TARIC drift, sanctions list changes, ETA slippage, document gaps, anti-dumping risk; routes to the user's inbox with calculator-grounded recommended action | The proactive-monitoring foundation already partially shipped; this generalises it to shipments-in-flight, not just saved plans | Eng |
| L1.6 | **Persistent dashboard** — replaces the demo skeleton; shipment list with filters, exception queue, document vault, alert inbox, calendar | Removes the "demo mode" banner from `/dashboard/` | Eng |
| L1.7 | **Stripe live** — set keys, ship public pricing page wired to Checkout, EU VAT reverse-charge handled, dunning configured | Self-serve revenue starts; closes the 503-on-upgrade gap | Eng + Founder |
| L1.8 | **ERP connectors v1** — NetSuite + Xero + QuickBooks (bidirectional shipment/invoice sync) | Mid-market entry-tier ERPs; opens up the partner-listing motion | Eng |

**Success gate to leave Leap 1:** A real customer (paying €399+/mo) operates 100% of their import workflow inside OrcaTrade for 30 consecutive days, with zero exits to spreadsheets, broker emails, or their ERP for primary actions. ERP receives sync only.

#### 4.1.3 Liability-bearing accuracy posture (ships inside Leap 1)

The single biggest competitive wedge available — and absent from existing plans — is **standing behind the numbers**. SAP GTS and Descartes both carry E&O insurance and offer indemnity language in MSAs ("if our classification is wrong and you owe back duty, we cover up to $X"). This converts directly to enterprise sales velocity.

OrcaTrade's calculator-grounded posture (ADR 0002) and reproducible audit chain make this insurable in a way generic-LLM products cannot match. Concrete deliverable:

- **E&O insurance bound by 2027-Q1** — broker engaged 2026-Q3, quotes in hand by 2026-Q4, policy bound Q1 2027 with €1M per-occurrence / €5M aggregate
- **Accuracy guarantee** introduced in Growth tier and above: "if a calculation we cite as Tier-A confidence and you act on within 30 days proves materially incorrect, we cover the demonstrated incremental cost up to €5,000 per claim / €50,000 per annum per customer"
- **Tier-A confidence** is defined deterministically by the reproducibility snapshot system already shipped: only calculations where every input source pinned to a snapshot ≤30 days old and the calculator passed its regression test that morning qualify
- **Claim handling SOP** in `docs/runbooks/` — operational runbook including evidence collection from the audit chain

This single move arguably matters more than any other product feature for enterprise conversion. Owner: Founder (broker engagement) + Eng (snapshot tier-classification).

---

### LEAP 2 — From product to marketplace (2028)

#### 4.2.1 Why this leap

A SaaS product has linear gross margin scaling — each customer pays a fixed price for a fixed feature set. A marketplace has *compounding* gross margin: every new participant on one side increases value for every participant on the other side. The valuation multiples reflect this: top-quartile pure SaaS trades at 6-9× ARR; marketplace-SaaS hybrids trade at 12-20× when the network effect is real.

For OrcaTrade, three marketplace primitives are within reach and one is not:

| Marketplace | Within reach? | Why |
|---|---|---|
| **Verified suppliers** | Yes | OrcaTrade HK already does supplier discovery; verification produces structured data that becomes the network primitive |
| **Trade finance** | Yes | Importers need working capital; lenders need de-risked deal flow; OrcaTrade's landed-cost calculation IS the underwriting signal |
| **Freight booking** | Partial — as routed-API not own-marketplace | Freight is too commoditised and capital-intensive (cf Flexport) to own; integrate to existing forwarders |
| **Customs brokers** | Partial — as partner network not marketplace | Brokers are too fragmented and locally-licensed to commoditise; build a tier-1 partner network instead |

#### 4.2.2 Verified supplier marketplace (2028-Q1 → Q3)

The flagship Leap 2 deliverable. Mechanics:

1. **Supplier onboarding pipeline** — invite-only Year 1, batch-driven from OrcaTrade HK's existing vetted factory portfolio (estimated 200-400 factories across CN, VN, IN, BD, TR)
2. **Verification tiers** — Bronze (sanctions-screened, business licence verified), Silver (in-person audit on file <12mo old, export track-record verified), Gold (continuous monitoring, SLA-bound, OrcaTrade indemnity)
3. **Listing UX** — importer searches by HS chapter / category / origin → returns verified-tier suppliers with capability, MOQ, lead time, last-audit date, OrcaTrade trust score
4. **Match → introduction** — importer requests intro → supplier accepts → OrcaTrade brokers the first conversation → if PO placed, OrcaTrade takes 2.5% transaction fee (Gold tier) or €350 fixed intro fee (Silver/Bronze)
5. **Network effect** — every PO routed through OrcaTrade generates an actual landed-cost outcome; that calibrates the calculator + the supplier's track-record; the supplier wants to maintain Gold status; the importer wants to source from highly-rated suppliers — both sides reinforce

**Capital requirement**: Supplier onboarding ops headcount (3-4 FTE in HK by Q3 2028 — Jay's team), legal review of brokering posture per jurisdiction, transaction-fee billing flow in Stripe.

**Network-effect gate**: Marketplace gross merchandise value (GMV) of €15M routed in 2028 with at least 25 active Gold suppliers and 80 active importer buyers.

#### 4.2.3 Trade finance marketplace (2028-Q3 → Q4)

OrcaTrade's landed-cost calculator is, structurally, a credit underwriting model — it knows the goods, the supplier, the duty exposure, the freight cost, and the customer's payment behaviour from the shipment journal. Trade-finance lenders pay for that signal.

Mechanics:

1. **Lender panel** — 6-10 trade-finance lenders (specialty banks + alternative lenders like Stenn, Tradeshift Capital, Demica) on-boarded as marketplace participants
2. **One-click financing** — importer signs PO; OrcaTrade calculator produces landed-cost projection; importer clicks "finance this shipment"; OrcaTrade routes the request as a structured underwriting package (goods master, supplier master, shipment value, projected landed cost, importer's OrcaTrade history) to top-3-matched lenders
3. **Origination fee** — OrcaTrade takes 0.5%-1.5% of financed amount (lender-paid, not importer-paid)
4. **Regulatory posture** — UK-FCA introducer status (not principal), EU PSD2 introducer carve-out; legal opinion bound by Q2 2028

**Capital requirement**: Compliance counsel on broker/introducer posture, lender BD in H1 2028, structured-data API for lender package generation.

**Gate**: €40M financing originated in 2028 H2 with €0.7M+ take-rate revenue.

#### 4.2.4 Freight + customs broker partner network (2028-Q2 ongoing)

Not a marketplace OrcaTrade owns — a curated tier-1 partner network OrcaTrade routes to.

- **Freight forwarders**: deep API integrations with 5-8 tier-1 European forwarders (DSV, Kuehne+Nagel, DB Schenker, Geodis, Maersk Customer Logistics, FedEx FTN, plus 1-2 Asia-side specialists)
- **Customs brokers**: certified partner network of 12-20 brokers across PL, DE, NL, BE, FR, ES, IT (the 7 EU corridors that handle 80% of Asia inbound)
- **Revenue model**: referral fee per booking (typically 4-7% of freight invoice; 5-10% of brokerage fee)

**Gate**: 200+ active partner-routed shipments per month by Q4 2028; partner-fee revenue €1.2M+ in 2028.

---

### LEAP 3 — From direct SaaS to embedded distribution (2029-2030)

#### 4.3.1 Why this leap

Direct SaaS sales has linear cost economics: every new customer requires the same SDR-AE-CSM motion. The leap from €15M to €100M ARR is impossible to capital-efficiently fund through direct sales alone — you would need 50+ AEs each carrying €1M quota, with the corresponding marketing pipeline. That's a Series C-D burn rate.

The structural unlock is **embedded distribution**: OrcaTrade is consumed inside platforms the customer is already using. Avalara made this move (embedded in Shopify, NetSuite, Magento, SAP); Plaid made this move (embedded in every fintech app); Stripe made this move (embedded checkout). Each of those companies hit billion-dollar valuation specifically because of embedded distribution, not despite it.

#### 4.3.2 Three embedded surfaces

**A. Embedded in ERP marketplaces (2029-Q1 → ongoing)**

| Marketplace | Deliverable | Value to user |
|---|---|---|
| NetSuite SuiteApp | "OrcaTrade Import Compliance" — adds CBAM/EUDR/anti-dumping flagging to PO entry, landed-cost preview, document filing | NetSuite customers (€500K+ revenue businesses) get duty transparency without leaving NetSuite |
| SAP Business Network | OrcaTrade as certified app — adds Goods Master enrichment, trade compliance check | SAP Business One mid-market customers |
| Microsoft Dynamics AppSource | Dynamics 365 plug-in | Mid-market manufacturers |
| Xero App Store | "Import landed-cost" widget — calculator-only, free tier | SMB on-ramp |
| QuickBooks App Store | Same | SMB on-ramp |

**B. Embedded in commerce + B2B-marketplace flows (2029-Q3 → ongoing)**

| Platform | Deliverable | Value to user |
|---|---|---|
| Shopify | "Importer Tools" app — duty estimate at PO entry for merchants sourcing from Asia | Shopify merchants sourcing direct from Asia (~15% of all Shopify merchants) |
| Amazon Seller Central | Third-party-app embed — landed-cost calculation for FBA inventory orders | Amazon FBA sellers sourcing from Asia |
| Faire | Wholesale buyer landed-cost check at supplier listing | Faire buyers importing direct |
| Alibaba.com | Buyer-side landed-cost overlay (API integration, not visible app — backend partnership) | Alibaba B2B buyers |

**C. White-label for 3PLs (2030-Q1 → ongoing)**

Top European 3PLs are commodified on freight; they desperately want margin-rich intelligence layers to upsell. OrcaTrade white-label gives them that without the 3-year build cost.

Targets: DSV, Kuehne+Nagel, DB Schenker, GEODIS, Bolloré, Hellmann, Rhenus. Each carries 50,000+ SMB customers OrcaTrade cannot economically reach direct.

White-label commercial model: €0.50-€2 per active shipment per month, minimum €15K monthly commitment, OrcaTrade-branded "powered by" optional, full API + embedded UI components.

**Gate**: 6 ERP marketplace listings live + 3 commerce embeds + 2 white-label 3PL partnerships signed by end of 2030. ~35% of new ARR through embedded channels by Q4 2030.

---

## 5. The foundation enabling the three leaps

The leaps cannot land on the current foundation. Three foundation tracks run continuously beneath them.

### 5.1 Trust posture (enterprise-grade)

Calendar of compliance certifications, mapped to the customer cohort that requires each:

| Cert | Target date | Cost (range) | Required for |
|---|---|---|---|
| SOC 2 Type I | 2026-Q4 (per execution-plan) | €20K-€35K (auditor + tools) | First mid-market enterprise contracts |
| SOC 2 Type II | 2027-Q3 (accelerated 6mo from execution-plan) | €25K-€45K annual recurring | First six-figure enterprise contracts |
| ISO 27001 | 2027-Q4 | €40K-€70K | German enterprise procurement |
| ISO 27701 | 2028-Q3 | €25K-€40K incremental over 27001 | EU privacy-mandated enterprise |
| EU AI Act conformance (high-risk category if applicable) | 2028-Q3 | €30K-€60K legal + technical | EU enterprise contracts post-2025 enforcement |
| Annual third-party pen test | 2027-Q1, then annual | €15K-€25K each | Every enterprise customer questionnaire |
| Public bug bounty | 2028-Q1 | €30K-€60K annual payout pool | Security credibility signal |

**Insurance posture** (closes execution-plan P1.M gap):
- **E&O (Errors & Omissions)** — €1M / €5M policy, broker-engaged Q3 2026, bound Q1 2027
- **Cyber liability** — €5M / €15M policy, bound Q1 2027 (typically requires SOC 2 Type I in hand)
- **General liability + Directors & Officers** — Q1 2027, standard market
- **Continuous coverage expansion** as ARR grows — increase limits at €5M, €25M, €100M ARR triggers

**Liability-bearing accuracy guarantees** (the wedge) — defined in §4.1.3.

### 5.2 Operational excellence (SLA-bearing posture)

- **2027-Q2**: 99.5% measured SLO, single-region (eu-west)
- **2027-Q4**: 99.7% measured SLO, single-region with hot standby
- **2028-Q3**: 99.9% measured SLO, multi-region active-passive (eu-west primary, eu-central standby)
- **2029-Q4**: 99.9% measured SLO, multi-region active-active (eu-west + eu-central + us-east for embedded)
- **2030-Q4**: 99.95% measured SLO, multi-region active-active + edge compute for read paths

Operational disciplines that ship in lockstep:
- **On-call rotation** — 4-person rotation by 2027-Q3 (one engineer always primary, secondary for escalation)
- **Quarterly DR drills** from 2027-Q4 — Postgres restore, KV restore, full-region failover, fully scripted runbook
- **Incident commander training** — every senior engineer trained by 2028-Q1
- **Postmortem culture** — public-facing postmortems for any Sev-1 visible to customers, on `/status/`
- **Annual game days** — staged outages, customer-simulated load tests

### 5.3 Engineering velocity

- **TypeScript strict everywhere** by end of 2027-Q1 (execution-plan P1.D commits this)
- **API-first contracts** — OpenAPI 3.1 generated from `lib/contracts/v1/`, breaking changes go to `/v2/` (ADR 0007 + 0014 already commit)
- **Eval-gate on every AI-touching merge** — already live (ADR 0018); expand to 200+ cases per agent by Q2 2027
- **95th-percentile API latency under 500ms** by Q4 2027; under 250ms by Q4 2028 (driven by Fluid Compute warm-instance reuse + prompt caching)
- **Test count growth tracking ARR** — current 3,696 → 6,000 by end of 2027 → 12,000 by end of 2028 → 20,000+ thereafter
- **Zero-defect release posture** — no Sev-1 bug shipped to production for two consecutive quarters by mid-2028

### 5.4 Regulatory & geographic breadth roadmap

The biggest single TAM-expander after the foundation lands.

| Region | Scope | Target | Capital required |
|---|---|---|---|
| **EU + UK** | Already covered — TARIC, CBAM, EUDR, REACH, CE, anti-dumping, FTA RoO, sanctions (UN/EU/OFAC/UK) | Deepen: anti-dumping case count 45 → 1,500+, REACH SVHC full catalogue, CE module by directive | 2027 H1 — done in-house |
| **United States** | HTS, Section 301 China tariffs, USMCA, ACE filing protocol, CBP filing partner | 2027-Q4 calculator GA; 2028-Q2 filing partner; 2028-Q3 paid US customers | Regulatory specialist hire Q2 2027; ACE partnership cost €40K-€80K |
| **China + Asia outbound** | China VAT, China anti-dumping, Vietnam EVFTA, India FTA's | 2028-Q3 calculator GA; serves bidirectional importer/exporter | Asia specialist (Yiu's expansion) + €20K legal opinion |
| **Mexico/Brazil** | NAFTA legacy + Mercosur, Brazil import licences | 2029-Q4 calculator GA | Regional specialist hire Q3 2029 |
| **Australia/NZ/Japan/Korea** | GST, JCT, Korean VAT, CPTPP RoO | 2030-Q4 calculator GA | Regional partnership + 1 hire 2030 |

**Acceleration via M&A**: If a small but credible US-customs SaaS exists in the €2M-€8M ARR range by 2027 with the calculator architecture compatible, acquire instead of build. Equivalent for Brazil/Mexico in 2029. Allocate €3-8M of Series B proceeds for accretive regulatory acquisitions.

---

## 6. Calendar-locked roadmap (Q3 2026 → Q4 2031)

Phases 0-2 are committed in `docs/execution-plan.md`. Phases 3-9 below are this document's commitment.

### Phase 0 — Discipline scaffold (2026-06 → 2026-07) — IN FLIGHT
Per execution-plan. Exit gate: every CLAUDE.md claim backed by an enforcement test.

### Phase 1 — Trust foundation (2026-07 → 2026-10) — COMMITTED
Per execution-plan. Exit gate: survives SIG Lite + CAIQ v4; SOC 2 programme started.

### Phase 2 — First paying customers (2026-10 → 2027-01) — COMMITTED
Per execution-plan. Exit gate: 5 paying SMB customers (€2K MRR floor) + 1 enterprise pilot signed.

### Phase 3 — Leap 1 begins: system of record (2027-Q1 → 2027-Q3) — THIS DOC

| Quarter | Deliverables | Exit gate |
|---|---|---|
| 2027-Q1 | L1.1 Goods master, L1.2 Supplier master, L1.7 Stripe live + public pricing, E&O insurance bound, Tier-A accuracy guarantee shipped | First customer routes 100% of one product line through Goods master; €60K MRR |
| 2027-Q2 | L1.3 Shipment object as primary entity, L1.6 Persistent dashboard (demo banner removed), pen test #1, SOC 2 Type II auditor engaged | 20 paying customers; 99.5% SLO measured for 60 days; demo-mode banner gone forever |
| 2027-Q3 | L1.4 Document filing (UK CDS partner integration first, EU IDEX second), L1.5 Exception queue GA, US HTS calculator GA, SOC 2 Type II achieved | 40 paying customers; first six-figure annual contract signed; €170K MRR |

### Phase 4 — Leap 1 completes + ERP connectors (2027-Q4 → 2028-Q1)

| Quarter | Deliverables | Exit gate |
|---|---|---|
| 2027-Q4 | L1.8 ERP connectors v1 (NetSuite + Xero + QuickBooks), ISO 27001 cert, US ACE filing partner live, French + Spanish localisation | 60 paying customers; ARR €3M; 99.7% SLO; ISO 27001 in hand |
| 2028-Q1 | NetSuite SuiteApp shipped, Dynamics AppSource listing, US paying customers, Goods Master enrichment via Voyage embeddings + supplier-data feeds | First 10 ERP-marketplace-sourced customers; first US enterprise contract |

### Phase 5 — Leap 2: marketplace (2028-Q2 → 2028-Q4)

| Quarter | Deliverables | Exit gate |
|---|---|---|
| 2028-Q2 | Supplier marketplace v1 (invite-only), freight forwarder partner network (5 forwarders), Stripe transaction-fee flow | €15M GMV routed through marketplace; 25 active Gold suppliers |
| 2028-Q3 | Trade finance marketplace launch (6 lenders), ISO 27701 cert, Asia outbound calculator (China VAT, Vietnam EVFTA), EU AI Act conformance assessment complete | €40M finance originated; first €1M monthly marketplace + finance take-rate |
| 2028-Q4 | Customs broker partner network (12 brokers across 7 corridors), supplier marketplace open to all (post-vetting), Shopify app submitted | 100 active partner-routed shipments/month; ARR €15M; 99.9% SLO multi-region |

### Phase 6 — Leap 3 begins: embedded distribution (2029-Q1 → 2029-Q4)

| Quarter | Deliverables | Exit gate |
|---|---|---|
| 2029-Q1 | NetSuite SuiteApp GA, SAP Business Network listing, Dynamics live, Mexico + Brazil calculator GA | First 50 ERP-marketplace customers contributing €2M ARR |
| 2029-Q2 | Shopify app live, Amazon Seller Central embed pilot, Faire integration | First 200 commerce-marketplace customers (smaller ACV but high volume) |
| 2029-Q3 | White-label partnership #1 signed (target: DSV or Kuehne+Nagel), Alibaba B2B backend integration | First white-label partner live in pilot |
| 2029-Q4 | M&A: acquire small US compliance SaaS (€3-8M earnout, accelerates US regulatory coverage) | ARR €55M; 30% of new ARR via embedded channels |

### Phase 7 — Scale engineering (2030-Q1 → 2030-Q4)

| Quarter | Deliverables | Exit gate |
|---|---|---|
| 2030-Q1 | Multi-region active-active (eu-west + eu-central + us-east), white-label partner #2 live | 99.9% SLO active-active for 90 days |
| 2030-Q2 | Self-serve enterprise tier (annual €25K+ contracts closing without sales-led), CPTPP/RCEP calculator GA | 50% of enterprise tier closes self-serve |
| 2030-Q3 | Trade finance marketplace doubles lender panel; Asia outbound deepens (India FTAs, Japan) | €120M cumulative finance originated |
| 2030-Q4 | White-label partner #3-5, ERP integration #5-6, Brazil paying customers | ARR €160M; 35% via embedded channels; 99.95% SLO |

### Phase 8 — IPO preparation (2031-Q1 → 2031-Q4)

| Quarter | Deliverables | Exit gate |
|---|---|---|
| 2031-Q1 | Bookings backlog visibility (DSO + RPO metrics public-quality); rule-of-40 ≥45% measured | Auditor-grade financials |
| 2031-Q2 | Big-4 audit engagement; S-1 / F-1 drafting begins; underwriter beauty contest | Underwriters engaged |
| 2031-Q3 | Final regulatory/operational hardening; analyst day | Analyst day completed |
| 2031-Q4 | IPO window (or strategic position — Series D bridge if window closed) | $1B+ valuation achieved (IPO or private) |

---

## 7. Operating model

### 7.1 Org chart evolution

| Period | Headcount | Org shape |
|---|---|---|
| 2026 H2 | 5-6 | Founder + 3 eng + 1 fractional GTM + part-time legal/finance |
| 2027 H1 | 12 | Founder + 5 eng + 1 design + 1 BDR + 1 CSM + 1 ops lead + part-time CFO advisor + fractional HR |
| 2027 H2 | 18 | + Head of Sales, + Senior eng, + 2nd CSM, + 1st security/IT |
| 2028 H1 | 30 | + Head of Product, + Head of Marketing, + 3 eng, + 2 AEs, + 2 BDRs, + RevOps, + supplier ops (HK) |
| 2028 H2 | 45 | + Head of Engineering (VP-level), + 4 eng, + 3 partner ops (forwarders/brokers/lenders), + 2 AEs, + customer-support lead |
| 2029 H1 | 70 | + VP Sales, + VP Customer Success, + GM US, + 6 eng, + 4 AEs, + 4 CSMs, + finance ops, + compliance lead |
| 2029 H2 | 110 | + VP Marketing, + VP Operations, + GM Asia expansion, + 8 eng, + 6 AEs, + embedded-partnership BD lead |
| 2030 | 240 | Full executive team; regional GMs (UK, DE, FR, US); dedicated marketplace ops org |
| 2031 | 420 | Pre-IPO operating company |

### 7.2 Critical hire order (next 24 months)

1. **Senior fullstack engineer #1** — 2026-Q3, owns the L1.6 dashboard and L1.3 Shipment object
2. **Senior fullstack engineer #2** — 2026-Q4, owns L1.4 document filing (partner integrations are gnarly)
3. **Head of Sales** — 2027-Q2, hires AE motion; comes from Avalara / Descartes / Flexport / Project44
4. **Lead designer** — 2027-Q1, owns the leap from polished-marketing-surface to product-UX-that-converts
5. **Head of Product** — 2027-Q3, owns prioritisation as feature surface expands
6. **Security/IT lead** — 2027-Q3, owns SOC 2 Type II + ISO 27001 programme
7. **First CSM** — 2027-Q2, owns the activation-to-expansion arc for the first 50 customers
8. **VP Engineering** — 2028-Q1, scales the eng org from 8 → 25 → 80

### 7.3 Capital plan

| Round | Quarter | Target raise | Pre-money | Dilution | Use of funds |
|---|---|---|---|---|---|
| Bootstrap | done | — | — | — | Founder + Polish-side cost-of-living arbitrage |
| **Pre-seed / Angel** | 2026-Q4 | €0.5-1M | €5-8M | 10-15% | Bridge to first 12 customers, Senior eng #1-2, broker engagement |
| **Seed** | 2027-Q2 | €3-5M | €15-25M | 18-22% | 18-month runway to Series A; sales team buildout; SOC 2 Type II |
| **Series A** | 2028-Q1 | €15-25M | €70-100M | 20-25% | Marketplace launch capital; US expansion; engineering scale |
| **Series B** | 2029-Q3 | €60-90M | €350-500M | 18-22% | Embedded distribution scale; M&A reserves; geographic expansion |
| **Series C** | 2030-Q3 | €150-250M | €900M-1.4B | 15-20% | IPO preparation; aggressive growth investment |
| **IPO / Strategic** | 2031-Q4 | $300M+ | $1.0-1.5B | 15-20% (IPO) | Public market liquidity event |

Dilution arithmetic for the founding team: ~64-70% retained through Series B; ~50-55% through Series C; ~40-45% at IPO. Founder + early-employee pool sized at 18-22% post-Series-B to retain talent. ESOP refreshes at each round.

**Critical**: every round predicates on the prior round's gate being met. Investors will not fund Series A in 2028-Q1 without the system-of-record leap (Phase 3+4 above) actually landed. Investors will not fund Series B in 2029-Q3 without marketplace gross-merchandise-value visible. The plan and the capital cannot decouple.

### 7.4 Unit economics targets

| Metric | 2027 EOY | 2028 EOY | 2029 EOY | 2030 EOY |
|---|---|---|---|---|
| **Gross margin** | 68% | 74% | 78% | 80% |
| **CAC payback (months)** | 18 (acceptable seed-stage) | 12 (Series A bar) | 10 | 9 |
| **Net dollar retention** | 110% (cohorts too young) | 125% | 130% | 132% |
| **Magic number** | 0.6 (R&D heavy) | 0.9 | 1.1 | 1.2 |
| **AI COGS as % of revenue** | 18% (Opus-first heavy) | 14% | 11% | 9% (prompt caching + routing optimisation) |
| **Rule of 40** | -20 (still investing) | 25 | 38 | 47 |

These are the gates the capital plan predicates on. Missing any one in any year materially shifts the funding strategy.

---

## 8. Risk register

Top 10 risks, ranked by impact × probability. Each has a single named mitigation owner.

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Founder execution capacity** — Oskar simultaneously CFO + Eng lead + GTM. Cannot continue past Series A. | High | Critical | Senior eng hires Q3-Q4 2026; Head of Sales Q2 2027; Head of Product Q3 2027. Hire deliberately ahead of need. (Owner: Founder) |
| 2 | **Anthropic / model cost shock** — if Opus pricing changes 3-5×, gross margin model breaks at scale | Medium | High | Multi-provider failover via Vercel AI Gateway by Q2 2027; prompt caching aggressive; routing tier (Haiku triage / Sonnet bulk / Opus reasoning) hardened. (Owner: Eng) |
| 3 | **Marketplace cold-start** — supplier marketplace fails to reach two-sided liquidity in 2028 | Medium | High | OrcaTrade HK supplier ops seeds Year 1 (200-400 factories); buyer side seeded from SEO funnel + first 90 customers; 2028 GMV gate non-negotiable for Series B | (Owner: Co-founder Jay)
| 4 | **SOC 2 Type II slippage** beyond Q3 2027 | Medium | High | Engage Vanta or Drata Q4 2026; auditor selected Q1 2027; named security lead hire Q3 2027; controls run live for 6mo before audit. (Owner: Founder → Security lead) |
| 5 | **Liability claim under accuracy guarantee** before insurance is fully bound | Low | Critical | Conservative initial guarantee cap (€5K/claim, €50K/cust/yr); Tier-A confidence gate strict; only Growth tier+ eligible; broker engaged Q3 2026 and policy bound Q1 2027 before any guarantee claims accepted. (Owner: Founder + Counsel) |
| 6 | **Stripe / payments compliance** as marketplace + trade finance volume scales | Medium | Medium | Specialist counsel engaged Q2 2028 (introducer posture); separate marketplace entity if regulator-required; PCI-DSS SAQ A maintained continuously. (Owner: Founder + Counsel) |
| 7 | **EU AI Act high-risk classification** triggers heavy conformance burden | Medium | High | Legal classification opinion Q1 2027; technical conformance prep started concurrently; calculator-grounded architecture (LLM as explanation layer only) materially de-risks. (Owner: Eng + Counsel) |
| 8 | **Embedded partner concentration** — top 3 partners deliver >60% of embedded revenue by 2030 | Medium | Medium | Diversification target: no partner >25% of embedded ARR; multi-partner contractual structures; competitive overlap acceptable. (Owner: VP BD) |
| 9 | **Regulatory shock** — major change in CBAM / anti-dumping rules invalidates calculator overnight | Low | High | Reproducibility snapshot system already lives; full recalculation possible within 48 hours of regulation change; rule-versioning architecture (already shipped) means historical quotes preserved. (Owner: Eng) |
| 10 | **Competitive response from incumbent** — SAP / Descartes / Avalara launches an AI-native trade compliance product | Medium | Medium | Speed is the moat. Time-to-enterprise-contract for incumbent: 3-5 years (cultural + technical debt). OrcaTrade's window is 2027-2029 to land 100+ enterprise customers before defensive response is built. (Owner: Founder) |

---

## 9. What changes vs existing plans

Explicit delta vs `docs/execution-plan.md` and `docs/billion-dollar-plan.md`:

| Area | Existing posture | This document's posture |
|---|---|---|
| Horizon | 18 months operational (execution-plan) + directional pillars (billion-dollar-plan) | 5 years with calendar-locked phase gates and capital rounds |
| Capital plan | "User-engaged" (no rounds named) | Pre-seed → Seed → A → B → C → IPO named with size, gate, use of funds |
| Hiring plan | Roles named generically | Specific hire order with quarter of need + sourcing profile |
| Liability / insurance | Phase 1 line item, no concrete spec | E&O policy specs, accuracy-guarantee mechanism, Tier-A confidence definition |
| Marketplace strategy | "Pillar II7 trade-finance marketplace" — single bullet | Three marketplace mechanisms (supplier / finance / partner network) with cold-start strategy and gates |
| Embedded distribution | Absent | Three-surface strategy (ERP marketplaces / commerce embed / 3PL white-label) with named target partnerships and revenue model |
| Geographic regulatory expansion | "Multi-region data residency" (infra) | Calendar of regulatory scope (US 2027-Q4, Asia 2028-Q3, LATAM 2029-Q4) with named M&A acceleration possibility |
| M&A | Absent | Allocated as part of Series A & B reserves; targets named (US compliance SaaS 2027, LATAM 2029) |
| Vertical focus | Generic "European SMEs sourcing from Asia" | Three named wedge verticals (textiles + electronics + bikes/e-bikes) + named geography corridors (PL/DE/NL → CN/VN/BD/IN) |
| Competitive frame | "SAP / Descartes / etc." mentioned but not analysed | Explicit competitive table with revenue, strength, bleed point per incumbent |
| Risk register | Implicit, scattered | Ranked top-10 with named owner per mitigation |

This document does not replace `docs/execution-plan.md` — the latter remains the operational truth for Phases 0-2. This document is the apex strategic frame Phases 0-2 roll into, and the calendar contract for Phases 3-9.

---

## 10. Operating principles (the non-negotiables)

These hold regardless of phase, funding stage, or competitive pressure. They are the cultural moat.

1. **The LLM never produces a number that drives a decision** (ADR 0002). When competition forces this question — and it will, around Year 3 — we double down on the principle. Liability-bearing accuracy guarantees are the commercial expression of this principle.

2. **Calculator-grounded means cite-or-don't-ship.** Every regulatory claim cites a `[chunk-id]`. Every number cites the calculator + snapshot. No exceptions when ARR pressure mounts.

3. **Audit-log-before-success** (ADR 0005) is never relaxed. Even at 99.95% SLO, the audit log writes first or the request fails.

4. **No fabricated metrics ever.** Customer counts, revenue figures, lane counts, savings claims — every external number is either measured-and-true or omitted. This standing rule survives every PR-team brief and every sales deck.

5. **PII discipline holds at scale.** Email-hash pseudonymisation (ADR 0008) survives the move to Salesforce-style CRM. Customer data residency is real, not marketing.

6. **Human-in-the-loop on irreversible action.** Document filings, payment routing, supplier introductions — every irreversible operation gates on explicit user approval. No auto-pilot.

7. **Conventional commits + ADRs for every load-bearing decision.** Every architectural change of consequence has an ADR before merge.

8. **Tests are the contract** — the test suite grows with ARR; never relaxes; every CLAUDE.md claim has an enforcement test that fails on violation.

9. **The execution-plan is the operational truth.** This document is the strategic frame. When they disagree on a Phase 0-2 deliverable, the execution-plan wins. When they disagree on the strategic frame, this document wins.

10. **No shortcut survives Series B due diligence.** Every shortcut taken to ship faster — every "we'll harden this later" — must have a dated ticket and an enforcement gate. The bill comes due at Series B.

---

## 11. Definition of "billion-dollar-grade" — how we know we got there

A billion-dollar SaaS by 2031 is not (just) €350M run-rate ARR. It is the bundle of conditions that supports a $1B valuation at a defensible revenue multiple:

- **ARR**: €250M+ committed, €350M+ run-rate
- **Growth**: 50%+ YoY at the run-rate point (sustainable >40% beyond 2032)
- **Net dollar retention**: 130%+ (proves the marketplace + expansion motion)
- **Gross margin**: 80%+ (proves the AI-cost discipline + embedded distribution)
- **Rule of 40**: 45%+ (proves capital efficiency)
- **Customers**: 15,000+ active, top-20 customer concentration <25% (proves diversification)
- **Geographic mix**: <55% EU+UK, >25% Americas, >15% Asia-Pacific (proves geographic moat)
- **Channel mix**: >35% via embedded partnerships (proves distribution scale unlock)
- **Certifications**: SOC 2 Type II current, ISO 27001 current, ISO 27701 current, EU AI Act conformance current
- **SLA**: 99.95% measured for 8 consecutive quarters; first-response SLA enforced contractually
- **Marketplace GMV**: €2B+ routed cumulative through supplier + finance marketplaces
- **Brand**: Gartner Magic Quadrant placement (Visionary or Leader by 2030); Forrester Wave; named reference customers from Fortune 1000 / FTSE 350
- **Org**: 400+ employees; engineering org 35%+ of headcount; sales 20%+; CS 15%+; the rest GTM/G&A
- **Capital structure**: Series C closed at $1B+ valuation, or IPO completed, or strategic acquisition closed at $1B+

**The single test of whether the plan worked**: a credible procurement director at a Fortune-500 European manufacturer can sign a €500K annual contract with OrcaTrade without having a single objection to security, integration depth, regulatory breadth, financial stability, references, or product maturity. Today they have seven. By 2031, they have zero.

---

*Document maintenance: revisit quarterly. Each phase exit triggers a full revision of the next phase's deliverables, gates, and capital plan against actual market conditions. The strategic frame above is durable; the calendar is not.*
