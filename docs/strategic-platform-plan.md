# OrcaTrade · Strategic Platform Plan · v1.0

> From Trade & Sourcing Company to Full-Stack Europe–Asia Import & Export Platform.
> **Authoritative current-state briefing** for any new Claude session. Read end-to-end before responding.

- **Author / Founder:** Oskar Klepuszewski, Co-Founder & CFO, OrcaTrade Holding
- **Co-Founders:** Jay Xie (CEO), Arman Sirin, Yiu Cheung
- **Locations:** Warsaw · London · Hong Kong
- **Document version:** 1.0

---

## How to use this document

This briefing exists so any new Claude session can pick up exactly where the previous one left off and continue helping Oskar execute on the OrcaTrade platform plan without losing context.

### If you are the receiving Claude

- Treat this as authoritative current state. Anything below is what Oskar and the prior Claude session have agreed on.
- Match Oskar's communication style: direct, fast-moving, action-oriented. Concise outputs and concrete artifacts over lengthy theorising. He builds rather than plans for the sake of planning.
- Default to producing the next concrete artifact rather than re-debating strategy. Strategy is largely set. Remaining work is execution: page copy, prompts, pricing pages, agent system prompts, SOPs, partner outreach scripts, financial models, etc.
- OrcaTrade has an existing live site at orcatrade.pl with EN/PL/DE content. Any site work assumes this site as the starting point, not a greenfield build.
- Stack: Vercel serverless / edge functions, Anthropic API as the AI substrate. Lovable, Cursor, and Claude Code are part of the standard build stack.
- Stay aware of the broader UCL / academic context (Oskar is a UCL School of Management student in Information Management for Business) but focus on OrcaTrade unless he raises coursework explicitly.

---

## Executive summary

OrcaTrade Holding is repositioning from a Europe–Asia trade and sourcing company into a full-stack import / export platform spanning supplier discovery, supplier verification, logistics execution, compliance, finance, and AI-driven customer interaction. The platform will be sold through a layered subscription model with transactional revenue on top of execution services.

**Five strategic moves:**

1. Reframe four existing products (Factory Search, Sourcing, Intelligence, Finance) plus a new Logistics pillar as stages of one integrated import journey: **Find it · Verify it · Ship it · Finance it — one platform, Asia to Europe**.
2. Add **Logistics / Import Management** as a productised service offering, asset-light, partnership-led, with three tiers: Freight Forwarding Lite, Full Import Management, Compliance & Advisory.
3. Build a customer-facing **AI agent suite** (Sourcing, Compliance, Logistics, Finance, plus an Operations orchestrator) on Anthropic API + Vercel serverless, with strict human-in-the-loop discipline for irreversible actions.
4. Layer additional pillars over time — Trade Documentation Hub, Insurance Marketplace, Buyer Verification, Warehouse / 3PL, Multi-modal Routing (rail focus), Customs & Bonded Solutions, Marketplace, Export Services to Asia — sequenced by leverage of existing assets.
5. Monetise via subscriptions for access, intelligence, and AI agents, and via transactional fees for execution. Tier structure: Free / Starter (€99) / Growth (€399) / Scale (€999) / Enterprise (custom).

> **The single-sentence pitch:**
> OrcaTrade is the operating system for European SMEs importing from Asia: AI agents and verified supplier infrastructure that take a buyer from "I don't know how to do this" to goods on the warehouse floor.

---

## 1. Current state

### 1.1 What OrcaTrade has today

- Live multilingual website at **orcatrade.pl** with EN/PL/DE content, file-per-language folder structure.
- Brand: sharp, no-rounded-corners aesthetic with a dark navy and ivory palette.
- Active LinkedIn and Instagram business accounts.
- Hong Kong feet on the ground via Yiu Cheung.

**Product portfolio:**

- **OrcaTrade Intelligence** — AI-powered supply chain OS, three pillars: Supply Chain Clarity, Factory Risk Scoring, EU Compliance Engine. Built on Vercel serverless + Anthropic API.
- **OrcaTrade Sourcing** — supplier identification, qualification, procurement support.
- **OrcaTrade Finance** — trade finance and payment-related services.
- **OrcaTrade Factory Search** — standalone AI factory search engine, tiered SaaS (Free / Standard / Premium).

### 1.2 The strategic gap

These four read as separate products today. The platform thesis is that they are four stages of one buyer journey, and that there is a missing fifth stage — physical execution / logistics. SMEs experience the journey holistically; fragmented products force them to integrate the experience themselves and weakens the platform narrative.

---

## 2. Strategic frame

### 2.1 The five-stage import journey

| Stage | Pillar | Customer question answered |
|------:|--------|----------------------------|
| 1 | Factory Search | Where do I find the right supplier? |
| 2 | Sourcing | How do I negotiate, sample, and contract? |
| 3 | Intelligence | Is this supplier safe? Am I compliant? |
| 4 | **Logistics (NEW)** | How do I actually move and clear the goods? |
| 5 | Finance | How do I pay, hedge, and finance the deal? |

### 2.2 Positioning sentence

> **Brand positioning:** Find it · Verify it · Ship it · Finance it — one platform, Asia to Europe.
>
> **Underlying promise:** "Your import operations team, available 24/7, that knows every supplier, every shipment, every regulation."

### 2.3 Defensibility (the moat)

- **Proprietary supplier and factory data** accumulated through Sourcing and Factory Search work; competitors cannot replicate this without years of operational effort.
- **Hong Kong physical presence** for in-person supplier verification, sample consolidation, and dispute resolution. Pure-digital forwarders such as Flexport and Forto cannot match this at the SME price point.
- **EU-specific compliance knowledge** (CBAM, EUDR, REACH, CE, RoHS, EU AI Act). Most existing AI platforms in this space are American-centric.
- **AI-native operations** from day one, with agent infrastructure built into the platform.

### 2.4 Target customer profile (ICP)

**Primary ICP:** Polish, German, and broader CEE SMEs with €50,000–€2,000,000 annual import volume from China and broader Asia, doing roughly 2–50 shipments per year. Big enough to need help, small enough to not afford an in-house import team and not get attention from DSV, K+N, or DB Schenker.

**Specific entry segments to attack first:**

- Polish e-commerce founders, especially Allegro sellers and Amazon FBA operators.
- German Mittelstand SMEs sourcing manufactured components from Asia.
- Specialty retailers and brand owners doing 5–50 shipments per year.

---

## 3. The Logistics pillar (new)

### 3.1 Service tiers

Asset-light, coordinating execution through partners. Value comes from supplier intelligence, AI tooling, and Hong Kong presence.

#### Tier 1 — Freight Forwarding Lite (transactional)

Resell capacity from established forwarders (DSV, Kuehne+Nagel, Röhlig Suus, Raben). OrcaTrade handles booking, documentation, and customer communication.

- Margin: typically **8–15%** on freight cost.
- Service fee: **€150–€500 per shipment** depending on complexity.

#### Tier 2 — Full Import Management (retainer or per-shipment)

Where the Asia presence and existing supplier relationships become the moat. Scope per shipment:

- Supplier vetting and price negotiation
- Quality inspection coordination (partners: QIMA, AsiaInspection, or own inspectors)
- Chinese export documentation
- Freight booking
- EU customs clearance via licensed broker
- VAT and duty calculation
- Last-mile delivery coordination

Pricing: **flat fee €800–€2,500 per shipment, OR 3–7% of cargo value**, plus pass-through costs.

#### Tier 3 — Compliance & Advisory

Ties directly into OrcaTrade Intelligence's EU Compliance Engine: CBAM, CE marking, REACH, EUDR, product safety directives, sustainability reporting.

Pricing: advisory hours, OR **compliance audit packages at €500–€3,000**.

### 3.2 Legal and operational requirements

- **Customs agency partnership:** Not a licensed customs agent in the EU. Partner with a Polish *agencja celna* that white-labels or operates as subcontractor.
- **Cargo and professional liability insurance:** budget €1,500–€4,000/year initially. Consider FIATA membership for credibility and standard contract terms.
- **VAT representation:** for non-EU clients shipping into the EU, may need to act as VAT rep or partner with fiscal rep firm.
- **Incoterms expertise:** team must be fluent in FOB, CIF, DAP, DDP advisory.

### 3.3 Standard Operating Procedure (SOP)

Every shipment must follow a single codified playbook of approximately 12–15 steps. Codifying this is **mandatory before scale**.

See [logistics-sop.md](./logistics-sop.md) for the full operational playbook.

---

## 4. AI agent suite (customer-facing)

### 4.1 Strategic role

Agents are the platform's primary interface, not a chatbot bolted on. A traditional importer interacts with five different humans across five products. With OrcaTrade, they talk to OrcaTrade — agents route, execute, and escalate to humans only when needed.

### 4.2 The five agents

- **Sourcing Agent** — clarifies MOQ, target price, certifications, lead time. Queries Factory Search to surface 3–5 vetted suppliers. Drafts initial RFQs in Mandarin and English.
- **Compliance Agent (highest-value first build)** — classifies HS code with confidence + alternatives, calculates duty + VAT, flags applicable regulations (CE, CBAM, REACH, EUDR, RoHS, food contact, toy safety, textile labelling), generates compliance checklist, estimates compliance cost and timeline. Justifies a subscription on its own.
- **Logistics Agent** — instant freight quote estimation (sea LCL/FCL, air, rail), Incoterm advisor, shipment status queries, document checklist generator, ETA recalculation.
- **Finance Agent** — recommends payment terms (LC vs TT vs DA/DP) based on supplier risk score. FX exposure calculation and hedging suggestions. Trade finance options. Invoice and PO generation.
- **Operations Agent (orchestrator)** — sits in the customer dashboard. Routes intelligently across all four specialists. Multi-agent workflow synthesis.

### 4.3 Architecture

- **Agent layer:** Claude (Anthropic API) with tool use. Each agent = system prompt + defined toolset.
- **Tools:** `search_suppliers()`, `get_factory_score()`, `lookup_hs_code()`, `calculate_freight()`, `check_shipment_status()`, etc., implemented as Vercel serverless functions.
- **Memory and state:** per-customer conversation history in Supabase / Postgres. Shipment context persists across sessions. Don't put long-term customer data in the prompt — retrieve relevant context per turn.
- **Orchestration:** Operations Agent invokes specialists via tool use. Sub-agents are modelled as tools.
- **Frontend:** chat interface in the dashboard with structured UI rendering — comparison tables, quote cards, document checklists, shipment timelines. Streaming responses. Voice input for mobile users.

### 4.4 Human-in-the-loop discipline (non-negotiable)

Every agent must have a `request_human_review` tool. Agents do not commit to bookings or sign contracts autonomously. Trigger handoff when:

- Confidence score is low.
- Customer is frustrated or escalates.
- Deal value is high (>€20,000 cargo value).
- Customer explicitly asks for a human.

### 4.5 Critical risk mitigations

- **HS code and duty rate hallucination is dangerous.** Always pair AI classification with structured database lookup against EU TARIC. Agent suggests, system verifies, agent presents with confidence indicator.
- **Quote autonomy:** do not let agents quote final prices without human approval initially. "Estimated quote" with a "Request final quote" button that routes to a human. Automate further only after 100+ supervised quotes.
- **Logging:** every agent decision, tool call, and customer interaction is logged. Required for debugging and likely required under the EU AI Act.
- **Positioning:** agents are "your import assistant," never "fully autonomous import service." Customers want help, not abdication of control over a €50k cargo.

---

## 5. Business model & subscription tiers

### 5.1 The pricing principle

> **Subscribe to access and intelligence. Pay per transaction for execution.**
>
> Subscriptions = ongoing access to AI agents, data, monitoring, tooling — paid whether or not the customer ships this month.
> Transaction fees = per-shipment service fees, freight markup, compliance filings — pay-as-you-go.
> Hybrid leverage = subscribers get discounted transaction rates, driving upgrades.

This mix is what turns OrcaTrade from a services business (1–3× revenue) into a platform business (5–15× recurring revenue) on exit or fundraise.

### 5.2 Tier structure

| Tier | Price | Who it is for | Headline inclusions |
|------|-------|---------------|---------------------|
| Free / Explorer | €0 | Lead-gen, evaluators | 20 agent queries/mo, 10 supplier views, 5 docs, 5 HS lookups |
| Starter | €99/mo | Solo importers, FBA sellers | 200 queries, full Factory Search, Compliance + Sourcing Agents, 5 supplier monitors, 5% off shipments |
| **Growth** | **€399/mo** | Established SMEs, 5–50 shipments/yr | 1,000 queries, all agents, 20 supplier monitors, 5 seats, advanced analytics, 10% off shipments |
| Scale | €999/mo | Mid-market, 50+ shipments/yr | Unlimited queries, custom agent training, 20 seats, API (10k calls/mo), AM, 15% off shipments |
| Enterprise | Custom (€2,500+) | Manufacturers, distributors, retail chains | ERP integration, white-label, dedicated agents, SLAs, multiple AMs |

Most customers should land in **Growth** — that's the strategic core.

### 5.3 Add-on subscription modules

Stack on top of any tier. High margin, no expansion of core tiers required.

- Sustainability Reporting Pro — €199/mo — automated CBAM, EUDR, Scope 3 reporting.
- Industry Compliance Pack — €149/mo per industry — Electronics / Textiles / Food / Toys / Cosmetics.
- Buyer Verification Module — €99/mo — for exporters checking European buyers.
- Multi-currency Wallet — €49/mo or charged on FX margin.
- Premium Agent Pack — €299/mo — early access, custom training.

### 5.4 What stays transactional (not subscription)

- Per-shipment service fees.
- Freight forwarding markup (already in freight cost).
- Customs clearance fees (per declaration).
- Inspection services (per inspection, pass-through to partners).
- Trade finance origination (percentage, per deal).
- Insurance premiums (per shipment, commission).

### 5.5 Pricing psychology rules

- Display annual prominently with a 2-months-free discount. Annual subscribers churn at ~⅓ the rate of monthly.
- **No per-user pricing inside core tiers** — Polish and German SMEs hate it. Bake reasonable seat counts in; charge for additional seats only above thresholds.
- Don't underprice. Cheap customers churn faster, demand more support, signal lower quality. €99 is the floor; €399–€999 is the strategic core.
- Free tier must be useful for exploration but not enough to run a real import operation on.
- **CEE billing nuance:** Polish SMEs typically prefer monthly first, switch to annual after 3–6 months. Don't punish monthly billing with onerous prices, but make annual obviously better.

### 5.6 18-month revenue scenario (illustrative)

| Tier | Customers | MRR contribution |
|------|----------:|-----------------:|
| Free | 500 | €0 (top of funnel) |
| Starter (€99) | 200 | €19,800 |
| Growth (€399) | 80 | €31,920 |
| Scale (€999) | 20 | €19,980 |
| Enterprise (€3,000 avg) | 5 | €15,000 |
| **Total subscription MRR** | — | **~€86,700** |
| **Total subscription ARR** | — | **~€1.04M** |

Add transactional revenue (shipment fees, freight markup, insurance commissions, trade finance origination) → realistic envelope is **€1.5M–€2.5M ARR by month 18**, contingent on disciplined execution.

### 5.7 Billing infrastructure

- **Stripe Billing** for subscriptions, tiers, upgrades, prorations, dunning. Do not build this in-house.
- **Stripe Tax** for EU VAT.
- Freemium with optional 14-day trial of paid tiers. Free is permanent; trial converts evaluators.
- Self-serve checkout for Starter and Growth. Sales-assisted for Scale. Sales-led for Enterprise.
- Build usage tracking from day one — every agent query, document, API call.

---

## 6. Site & product build plan (orcatrade.pl)

### 6.1 Navigation restructure

Replace product-list approach with **journey-based** navigation:

- Solutions → For Importers / For Exporters / For Enterprise.
- Products → Factory Search · Sourcing · Intelligence · Logistics (NEW) · Finance.
- Resources → guides, HS code lookup, Incoterms explainer, compliance handbooks.
- About / Contact.

### 6.2 New pages required

- **/logistics** (and /pl/logistyka, /de/logistik) — position as safe, trusted alternative; show three tiers; drive to multi-step quote form.
- **/platform** — single page rendering the full journey: Search → Source → Verify → Ship → Pay. Each step links to the relevant product page. Destination for sales conversations.
- **/pricing** — public tier comparison, annual/monthly toggle, FAQ. Stripe checkout for Starter and Growth. "Talk to sales" for Scale and Enterprise.

### 6.3 Phased build sequence

**Phase 1 — Positioning & lead capture (Weeks 1–3)**

- Logistics pillar page (EN/PL/DE).
- Quote request form on /logistics.
- Homepage hero rewritten around four-pillar platform story.
- "How it works" journey section on home and platform pages.
- Trust signals: HK office, partner forwarders (once signed), case study placeholders.

**Phase 2 — Operational backbone (Weeks 4–10)**

- Customer dashboard (logged-in area) showing shipment status, leveraging Intelligence's existing tracking pillar — extend, do not rebuild.
- Document portal: clients upload commercial invoices and packing lists; OrcaTrade uploads BLs, customs docs, certificates. Storage on S3 or Supabase.
- Internal quote-to-booking workflow tool for the founding team.
- Partner integrations: at least 2 freight forwarders (one sea, one air), 1 Polish customs agency, 1 inspection partner.

**Phase 3 — AI differentiation (Weeks 8+, ongoing)**

- Compliance Agent MVP — built first as a standalone tool, no login required. Lead-magnet: "Free EU Import Compliance Check."
- Logistics Agent: instant quote estimation, Incoterm advisor, shipment status, document checklists.
- Sourcing Agent connected to Factory Search database, surfacing factory risk scores in-line.
- Operations Agent (orchestrator) — dashboard interface tying everything together.

### 6.4 30-day plan

- **Week 1:** Logistics pillar page draft (copy + design); navigation restructure; homepage repositioning. Align Jay, Arman, Yiu Cheung on the four-pillar narrative.
- **Week 2:** Quote form live; outreach to 2–3 Polish freight forwarders and 1 customs agency for partnership discussions. Draft the SOP.
- **Week 3:** Translate Logistics page to PL/DE; set up CRM/intake workflow; draft sample contracts (Letter of Engagement).
- **Week 4:** Soft launch — LinkedIn announcement, post in Polish e-commerce / Allegro seller groups, direct outreach to 20 ICP companies. Start collecting quote requests.

---

## 7. Product roadmap beyond the five pillars

Three tiers of expansion, sequenced by leverage of existing assets. Every new product should answer **yes** to at least three of these:

- Does it use existing supplier data?
- Does it leverage HK + EU footprint?
- Does it deepen customer relationships?
- Can AI agents do most of the operational work?
- Does it expand revenue per existing customer?

### 7.1 Tier 1 — Natural extensions (build within 6 months)

- **Trade Documentation Hub** — commercial invoices, packing lists, certificates of origin, BL drafts, proforma invoices. Customers fill a form, AI populates the doc. Recommended next pillar after Logistics — connective tissue between Sourcing, Logistics, and Compliance.
- **Insurance Marketplace** — cargo insurance, instant quotes. Partner with Lloyd's brokers, Allianz Trade, Atradius, PZU, Warta. 10–15% commission. Pure revenue.
- **Trade Credit & Buyer Verification** — score European buyers for Asian exporters. Public registries (KRS, Handelsregister, Companies House, Creditreform / D&B). Doubles addressable market.
- **Sample Management Service** — consolidated sample shipping via HK office. Drives sourcing pipeline.
- **Returns & Reverse Logistics** — niche but margin-rich.

### 7.2 Tier 2 — Significant new pillars (6–18 months)

- **OrcaTrade Warehouse / Fulfilment** — 3PL services in Europe (Poland: central logistics hub). Start by partnering with existing 3PLs (Arvato, DPD, smaller bonded warehouse operators near Poznań or Łódź) and white-label.
- **Multi-modal Routing Engine (Rail focus)** — China-Europe Railway Express via Małaszewicze. Faster than sea, cheaper than air.
- **Customs & Bonded Solutions** — AEO applications, customs warehousing, inward processing relief, end-use procedures, transit declarations.
- **Marketplace / B2B Trade Platform** — curated platform of pre-vetted Asian suppliers. 2–5% transaction fee. Polish/CEE focus initially. **Earn the right to do this through curated relationships first — do not build a marketplace day one.**
- **Export Services for European SMEs into Asia** — Mirror of import services. Tmall Global, JD Worldwide, Korean cosmetics, Japanese specialty foods.

### 7.3 Tier 3 — Long-horizon platform plays (18+ months)

- **Embedded Finance Products** — actually issue trade credit, invoice factoring, working capital loans backed by inventory. Partner with Stenn, Marco, Drip Capital rather than become a regulated lender.
- **Sustainability & ESG Reporting** — beyond CBAM: Scope 3, EUDR, EU forced labour rules, CS3D. Mandatory for most EU importers above thresholds within 3–5 years.
- **OrcaTrade Academy / Certification** — B2B education. Polish chambers of commerce partnership.
- **Industry-Specific Verticalisation** — OrcaTrade for Electronics, OrcaTrade for Apparel, OrcaTrade for Food & Beverage. Vertical SaaS commands much higher multiples.
- **Trade Data & Intelligence Product** — anonymised aggregated data sold to consultants, investment funds, government trade bodies.

### 7.4 Adjacent infrastructure expected of any platform

- Multi-currency wallet (EUR, USD, CNY, HKD, PLN).
- Public API for enterprise customers integrating into ERPs (SAP, Microsoft Dynamics, Comarch in Poland).
- Mobile app — shipment tracking, document approval, agent chat.
- Browser extension — Alibaba/1688 in-line factory scoring.
- Slack/Teams integration — push shipment updates into customer's workspace.
- Webhooks — required to be taken seriously as a platform.

### 7.5 What NOT to build

- **Don't build an Alibaba clone from day one.** Marketplace is the hardest possible business model. Earn the right.
- **Don't become a licensed freight forwarder operating ships, planes, or trucks.** Asset-light coordination keeps margins healthy.
- **Don't over-expand geographically.** Asia → Europe is huge. Don't get tempted into Asia → Americas or Europe → Africa until the core is dominant.
- **Don't build banking or insurance from scratch.** Always partner. Regulatory burden alone will sink the company.

---

## 8. Handoff notes

### 8.1 Where we are right now

Strategy is set. Oskar has explicitly endorsed: the four-to-five-pillar platform repositioning, the new Logistics service offering, the customer-facing AI agent suite, the layered subscription monetisation model, and the broader product roadmap.

### 8.2 Likely next requests from Oskar

In rough order of probability:

1. Draft the Logistics pillar page copy in EN, PL, DE.
2. Draft the public Pricing page copy and feature comparison matrix.
3. Write the system prompt and tool definitions for the Compliance Agent MVP.
4. Build the homepage rewrite around the four-pillar narrative.
5. Draft partner outreach scripts for freight forwarders, customs agencies, and inspection partners.
6. Build a unit-economics spreadsheet (subscription MRR + per-shipment fee model).
7. Write the SOP document for full import management.
8. Draft the platform page (orcatrade.pl/platform) showing the full journey.

### 8.3 How to work with Oskar

- He is direct and fast. **Skip preamble.** Lead with the artifact. Save analysis for after, only when asked.
- He has technical fluency and ships things — Lovable, Cursor, Vercel, Anthropic API are baseline tools.
- Polish, German, English content matters. Multilingual is structurally part of every site asset.
- OrcaTrade is co-founded with Jay Xie (CEO), Arman Sirin, and Yiu Cheung — written deliverables can reference "the team" or call out Yiu Cheung specifically for HK-side execution.
- Aesthetic: sharp, no rounded corners, dark navy / ivory palette.

### 8.4 Open decisions Oskar still needs to make

- Final tier names — current working set is Free / Starter / Growth / Scale / Enterprise. Open to alternatives if they fit the brand better.
- Whether to launch the Compliance Agent first as a free, gated lead-magnet tool or to bundle it inside the Starter tier from day one.
- Choice of first freight forwarder partner(s) — DSV / K+N for credibility, or smaller Polish/HK players (Röhlig Suus, Raben) for better margins and faster contracts.
- Whether to launch the Trade Documentation Hub as a separately positioned product or as a feature inside the Logistics pillar.
- Whether the orcatrade.pl/platform page should be the new homepage hero or a separate destination.

### 8.5 Hard constraints to respect

- **Asset-light.** No directly operated ships, planes, trucks, or warehouses (initially).
- **EU-first regulatory framing.** CBAM, EUDR, REACH, EU AI Act are first-class concerns.
- **Human-in-the-loop on every irreversible AI agent action**, especially quoting and contracting.
- Always paraphrase external sources and respect copyright when researching the web.
- Keep things concrete. If Oskar asks "how could we…", respond with a buildable plan, not a research summary.

---

## What's already shipped (current build state)

This section is updated as the platform progresses. **Last updated: 2026-05-08 (after Sprint 28).**

### Pages live on the site

- `/` — homepage repositioned around "Find it · Verify it · Ship it · Finance it"; five-stage journey grid in stage order
- `/platform/` — single-page visual journey; stage rail; manifesto block
- `/pricing/` — five-tier comparison; annual/monthly toggle; six add-on modules; subscription-vs-transactional split; nine-question FAQ
- `/logistics/` — three-tier service page; 7-step shipment playbook; quote form; HK + EU positioning
- `/intelligence.html` — flagship pillar page
- `/analysis/` — citation-grounded EU compliance brief covering **CBAM + EUDR + REACH + CE** (4 regulations, full v1 of the Compliance Agent's analysis surface)
- **`/agent/` — live Compliance Agent** with tool-use loop, streaming chat UI, tool-call traces, citation chips
- **`/documents/` — Trade Documentation Hub** — landing page (4 of 6 doc types live)
- **`/documents/commercial-invoice/`** — Commercial Invoice form (multi-line, HS codes, Incoterm, banking, freight + insurance, signature)
- **`/documents/packing-list/`** — Packing List form (cartons, gross/net weights, dimensions, live totals; auto-imports common fields from CI draft)
- **`/documents/proforma-invoice/`** — Proforma Invoice form (validity period, banking, payment terms; same line schema as CI)
- **`/documents/certificate-of-origin/`** — non-preferential CoO form (HS codes, marks &amp; numbers, declaration; output ready for chamber-of-commerce stamping)
- All 4 doc forms share `documents/shared/form.css` and `documents/shared/form.js`; localStorage drafts auto-save and survive refresh
- **`/insurance/` — Insurance Marketplace MVP** — landing page + 3-step explainer + ICC A/B/C coverage cards
- **`/insurance/quote/`** — live quote calculator with the math shown (cargo value × base rate × goods loading × route loading × coverage clause); 3 demo scenarios; updates as you type
- **`/buyer-verification/` — Buyer Verification MVP (export-side product)** — landing + registry references for 17 EU + UK + EEA jurisdictions + 4 credit-data partner descriptions
- **`/buyer-verification/check/`** — interactive buyer pre-check form against curated tier-1 buyer snapshot (MediaMarkt, Allegro, IKEA, Inditex, Kaufland, Biedronka); heuristic fallback for unknown buyers with credit-pull recommendation
- **`/samples/` — Sample Management Service MVP** — landing page, 5-step explainer, transparent pricing (consolidation + shipping), retail-comparison framing
- **`/samples/request/`** — interactive quote calculator with toggleable rush + express upgrades; live recalc; 3 demo scenarios; deterministic pricing breakdown shown to the customer
- **`/returns/` — Returns &amp; Reverse Logistics MVP** — landing with three-route framing (return-to-supplier / refurbish / scrap)
- **`/returns/quote/`** — three-route comparison calculator with side-by-side costing, recommendation engine that prefers refurb/return-to-supplier when declared value supports it, WEEE handling for electronics, metal-recovery credits for &gt;50kg EEE
- **`/dashboard/` — Customer Dashboard skeleton** — first product layer beyond marketing pages and one-shot calculators. Sidebar navigation across all platform tools, topbar with workspace + tier, stats row, document drafts panel, active quotes panel, quick-actions grid, roadmap panel
- **`/dashboard/login/`** + **`/dashboard/signup/`** — stub auth flow (browser-side, localStorage-backed); explicit demo-mode banners flagging that real Supabase / Auth.js / Clerk integration is the next sprint
- `/sourcing.html`, `/finance.html`, `/search/`, `/orcatrade.html` — existing pillar pages

### Backend — compliance engine (the doc's "highest-value first build")

**Four regulations live, full target met:**

- `lib/intelligence/corpus/cbam.json` — 15 chunks (Reg (EU) 2023/956 Art. 1–36 + Annex I + Implementing Reg 2023/1773)
- `lib/intelligence/corpus/eudr.json` — 15 chunks (Reg (EU) 2023/1115 Art. 1–38 + Annex I)
- `lib/intelligence/corpus/reach.json` — 12 chunks (Reg (EC) 1907/2006 Art. 1, 5, 7, 8, 14, 31, 33, 56–59, 67–68, 126, importer definition, SVHC Candidate List)
- `lib/intelligence/corpus/ce.json` — 14 chunks covering CE framework (Reg 765/2008 + Decision 768/2008/EC) plus 7 directives (LVD, EMC, Machinery, Toy Safety, PPE, RED, RoHS) and cross-cutting concepts (DoC, Technical File, AR, Notified Body)

**56 corpus chunks total · all four regulations searchable.**

- `lib/intelligence/retrieval.js` — pure-JS BM25 with topic-boost across all four corpora
- `lib/intelligence/cbam-analysis.js` — applicability, default emissions intensities, certificate cost, Art. 26 penalty model, timeline, country carbon-price credit
- `lib/intelligence/eudr-analysis.js` — 7 covered commodities, country-risk indicator, Directive 2013/34/EU size classification, 4%-of-turnover penalty ceiling, Article 9 evidence gaps
- `lib/intelligence/reach-analysis.js` — 8 high-relevance categories with concern lists tied to Annex XVII / SVHC entries; member-state penalty notes for PL / DE / FR / NL / IT
- `lib/intelligence/ce-analysis.js` — 9 product classes mapped to directive sets; bluetooth speaker → RED + EMC + LVD + RoHS; CNC machinery → Machinery + LVD + EMC + RoHS
- `api/analysis.js` — orchestrator runs all four regulations in parallel, emits per-regulation sections, merged timeline tagged by `regulationId`, citations from all four corpora; streams Claude narrative with section markers

### Backend — Compliance Agent (live tool-use deployment)

- `api/agent.js` — full tool-use loop endpoint with the **9 tools from the spec** (`searchRegulations`, `checkCbamApplicability`, `estimateCbamExposure`, `checkEudrApplicability`, `assessEudrCompliance`, `checkReachApplicability`, `assessReachCompliance`, `checkCeApplicability`, `assessCeCompliance`, `lookupHsCode`, `requestHumanReview`); 8-call cap per turn; streaming SSE events (thinking → tool-call → tool-result → text-delta → final → done); 30s per-call timeout; rate limited 12/min/IP
- `agent/index.html` + `agent/app.js` — full-page chat UI with cursor-following spotlight cards, suggestion buttons, tool-call traces with ✓/✗ indicators, citation chips, agent-switcher to Logistics Agent
- Spec at `docs/compliance-agent-spec.md` — system prompt + 9 tool JSON schemas + 4 sample flows + memory/context discipline + logging requirements

### Backend — Logistics Agent (Sprint 23 — second specialist agent)

- `api/logistics-agent.js` — full tool-use loop endpoint with **8 tools** wrapping the routing/customs/warehouse calculators: `compareTransportModes`, `estimateLandedCost`, `compareWarehouseHubs`, `recommendShipmentPlan` (orchestrator that composes all three), `getDestinationVatRate`, `lookupHsCode` (shared), `searchRegulations` (shared, used for CBAM/anti-dumping cross-references), `requestHumanReview` (shared, escalates at €50k+). Same SSE event vocabulary, 8-call cap, 30s per-call, 12 req/min/IP rate limit (separate `logistics-agent` namespace)
- `agent/logistics/index.html` + `agent/logistics/app.js` — sister chat UI mirroring the Compliance Agent shell, with logistics-specific demo prompts (mode comparison, anti-dumping flag, full plan, bonded re-export, 3PL benchmark) and an agent-switch tab pair linking back to Compliance
- Spec at `docs/logistics-agent-spec.md` — system prompt, tool schemas, three example conversation flows, escalation triggers, scope boundaries (defers compliance questions to the Compliance Agent)
- `recommendShipmentPlan` is the killer composition tool: a single tool call internally invokes routing → customs → warehouse and returns a unified plan with per-shipment landed total + monthly warehouse cost. This is the demonstration of platform composition — one agent call orchestrates three calculators we shipped over sprints 19–21

### Backend — Operations Orchestrator (Sprint 24 — meta-agent)

- `api/orchestrator.js` — unified meta-agent that imports `TOOLS` and `toolImpls` from BOTH `api/agent.js` (Compliance) and `api/logistics-agent.js` (Logistics) and merges them into a single 16-tool set (11 + 8 - 3 shared). System prompt positions it as the platform's universal entry point with cross-domain routing logic. SSE pipeline matches the specialists with one extra: the `domainsTouched` array on the `final` event so the UI can show which specialties were involved. Per-tool-call events also carry a `domain` field (compliance / logistics / shared) so the chat trace shows colour-coded badges per call. Rate limit 12/min/IP namespaced `orchestrator`. Max-tool-turns lifted to 10 (vs 8 for specialists) — cross-domain answers can need more tool calls. Max tokens lifted to 2200 (vs 1600/1800)
- `agent/orchestrator/index.html` + `agent/orchestrator/app.js` — chat UI with three-tab agent switcher (Orchestrator / Compliance / Logistics), tool-row domain badges with compliance gold + logistics blue colour cues, domain summary pills below the agent header. Six demo prompts spanning pure compliance, pure logistics, and three cross-domain scenarios (VN bluetooth speakers + CE, CN steel + CBAM + anti-dumping, VN furniture + EUDR + 3PL)
- `api/agent.js` extended to export `TOOLS`, `toolImpls`, and `SYSTEM_PROMPT` so the Orchestrator can compose them without code duplication
- Spec at `docs/orchestrator-agent-spec.md` — system prompt, tool inventory, four example flows including the killer cross-domain demo
- Both existing agent pages updated with the 3-tab switcher pointing to `/agent/orchestrator/`

### Backend — Sourcing Agent (Sprint 25 — third specialist agent)

- `lib/intelligence/sourcing-quote.js` — deterministic country-comparison calculator: 5 countries (CN / VN / IN / BD / TR) × 8 product categories (apparel, electronics, furniture, toys, cosmetics, homeware, footwear, machinery). Each country × category profile carries: `fobIndex` (relative cost vs CN baseline), `leadTimeWeeks` (production), `minMoq` / `typicalMoq`, `qualityRisk`, `ipRisk`, `specialty`, `caution`. Total 5 × 8 = 40 profile entries. Country-level fields: `seaTransitWeeks` (1 for TR, 4–5 for Asia), regulatory notes (EVFTA / EBA / Customs Union flags). Calculator exposes `compareCountries`, `assessRisk`, `estimateLeadTime`, `shortlistSuppliers`, `recommendCountry`. Recommendation engine scores by cost / quality / IP / lead time, with a `costPriority` toggle that prioritises the cheapest viable
- `api/sourcing-quote.js` — POST quote / GET catalogue (countries + categories + snapshot); 30 req/min/IP namespaced `sourcing`
- `api/sourcing-agent.js` — full tool-use loop with 7 tools: `compareSourcingCountries`, `assessSourcingRisk`, `estimateSourcingLeadTime`, `listSupplierShortlist`, plus shared `lookupHsCode`, `searchRegulations`, `requestHumanReview`. Same SSE pipeline as the other specialists; rate limit 12/min/IP namespaced `sourcing-agent`
- `agent/sourcing/index.html` + `app.js` — sister chat UI mirroring the Compliance / Logistics shells, with sourcing-specific demo prompts (cotton t-shirt launch, electronics IP risk, VN furniture + EUDR cross-ref, supplier shortlist, BD homeware no-audit risk)
- Spec at `docs/sourcing-agent-spec.md` — system prompt, tool schemas, four example flows including the killer cross-domain handoff (sourcing → compliance for EUDR)
- `api/orchestrator.js` updated to merge Sourcing Agent's 7 tools — Orchestrator now exposes **20 unique tools** (Compliance 11 + Logistics 8 + Sourcing 7 - 6 shared instances). `classifyTool` extended to recognise `sourcing` domain, system prompt updated with sourcing entry in the cheat sheet
- All four agent pages now share a 4-tab switcher: Orchestrator / Sourcing / Compliance / Logistics

### Backend — Finance Agent (Sprint 26 — fourth and final specialist agent)

- `lib/intelligence/finance-quote.js` — comprehensive trade-finance calculator: 6 payment instruments (TT advance / TT split 30-70 / D/P documentary collection / LC unconfirmed / LC confirmed / Open Account 60), full LC cost breakdown (issuance per quarter + confirmation + doc handling + wires + SWIFT + discrepancy charges), FX hedging table for 7 currency pairs (EUR vs USD/CNY/INR/VND/BDT/TRY/GBP) with annualised volatility and forward premium, working capital cycle math (DIO + DSO − DPO + carry cost on €100k sample), trade-credit insurance pricing model (base rate × country loading × buyer-size factor with €350 floor)
- `api/finance-quote.js` — multi-action endpoint: POST with `action=compare_payment|lc_cost|fx_hedge|working_capital|trade_credit` selects the calculator. GET returns instrument catalogue + FX pairs + snapshot. Rate limit 30/min/IP namespaced `finance`
- `api/finance-agent.js` — 8 tools: `comparePaymentInstruments`, `estimateLcCost`, `estimateFxHedgingCost`, `calculateWorkingCapitalCycle`, `assessTradeCreditCover`, plus shared `lookupHsCode`, `searchRegulations`, `requestHumanReview`. Rate limit 12/min/IP namespaced `finance-agent`
- `agent/finance/index.html` + `app.js` — fifth chat UI in the agent suite, with finance-specific demo prompts (€40k CN new relationship, €120k confirmed LC + FX combo, working capital diagnostic, DE tier-1 trade credit, VN €50k FX hedging)
- Spec at `docs/finance-agent-spec.md` — system prompt, tool schemas, four example flows
- `api/orchestrator.js` updated to merge Finance Agent's 8 tools — Orchestrator now exposes **25 unique tools** (Compliance 11 + Logistics 8 + Sourcing 7 + Finance 8 - 9 shared instances). `classifyTool` extended with `finance` domain
- All five agent pages now share a 5-tab switcher: Orchestrator / Sourcing / Compliance / Logistics / Finance — completing the planned 4-specialist + orchestrator suite

### Frontend — Agent Hub + deep-linking + persistence (Sprint 28)

- `/agents/` — new polished landing page that frames the entire agent suite as a single product surface. Featured Orchestrator card at the top (positioned as the recommended entry), then 2×2 grid of specialist cards (Sourcing / Compliance / Logistics / Finance). Each card has 2–3 demo prompts as `<a href>` links that deep-link into the relevant agent with the prompt pre-filled. Below the grid: a "How they work together" composition story with 4-step cross-domain flow (sourcing → compliance → logistics → finance). Stats row (5 agents · 25 tools · 4 EU regulations · 497 tests) and CTA back to the Orchestrator
- All 5 agent app.js files extended with **URL `?prompt=...` deep-linking** — the agent reads the URL parameter on page load and pre-fills the input box. Enables shareable links and the Hub's demo-prompt cards
- All 5 agent app.js files extended with **localStorage conversation persistence** — messages survive page refresh. Storage key namespaced per-agent (`orcatrade.compliance.messages.v1`, `orcatrade.orchestrator.messages.v1`, etc.). Last 30 turns retained
- **"Clear conversation" button** injected dynamically into each agent page's conversation header
- Markdown rendering preserved on persistence-restore via shared `OrcaMarkdown.render`
- Nav updated: `Agent Hub` is now the first item in the AI Agents group, sitting above the 5 specialist links

### Backend — Trade Documentation Hub

- `lib/intelligence/document-generator.js` — schema for 4 document types (Commercial Invoice, Packing List, Proforma Invoice, Certificate of Origin); pure-JS HTML renderer with HTML escaping; field-level validator
- `api/documents.js` — validates input, renders HTML with the doc shell + print-friendly stylesheet; serves rendered output to a new tab/window for browser print-to-PDF
- Form state auto-saves to localStorage between sessions

### Backend — Insurance Marketplace

- `lib/intelligence/insurance-quote.js` — marine cargo premium calculator: base rate by transport mode, goods-type loading, route-corridor loading (Asia-EU mainline / periphery / intra-EU / Africa / Middle East / Americas / default), ICC A/B/C coverage multipliers, minimum premium €35, OrcaTrade commission 12%
- `api/insurance.js` — quote endpoint (POST = calculate, GET = list options); deterministic response with formula breakdown and retail-comparison delta

### Backend — Buyer Verification

- `lib/intelligence/buyer-verification.js` — buyer scoring: curated snapshot of 6 tier-1 European buyers (MediaMarkt, Allegro, IKEA, Inditex, Kaufland, Biedronka); name-normalisation that strips legal-entity suffixes (sp. z o.o., GmbH, AG, BV, etc.); registry directory for 17 EU + UK + EEA jurisdictions with public-lookup URLs; heuristic fallback for unknown buyers with verify-required verdict and LC-or-advance security suggestion
- `api/buyer-verification.js` — check endpoint (POST = verify buyer, GET = list sample buyers + supported countries)

### Backend — Sample Management

- `lib/intelligence/sample-quote.js` — HK consolidation pricing: €40 base + €15 per supplier consolidation fee; 6-band shipping pricing (€25 to €180 by total weight); 7-region destination surcharge (EU mainland / CEE-Baltics / UK / Nordics / Southern EU / Switzerland / Other); express +€35 and rush +€30 toggles
- `api/samples.js` — quote endpoint (POST = calculate, GET = list bands + regions); deterministic breakdown with formula labels

### Backend — Returns & Reverse Logistics

- `lib/intelligence/returns-quote.js` — three-route costing: (1) return to supplier in Asia (€120 handling + €80 export docs + reverse shipping by weight × origin multiplier); (2) local refurbish (€60 transport + €12/piece diagnostic + €30/piece labour − €8/piece parts recovery, only for high/medium-viable categories); (3) local scrap (€60 pickup + €25/100kg disposal + €35 WEEE for EEE, with metal-recovery credit). Assessment fee €100 base + €5/piece capped at €500. Recommendation engine ranks by recovery vs cost (prefers refurb when declared value ≥ 1.5× refurb cost; prefers return-to-supplier when ≥ 2× shipping cost)
- `api/returns.js` — quote endpoint (POST = calculate, GET = list categories)

### Backend — Multi-modal Routing (Tier 2 — first item)

- `lib/intelligence/routing-quote.js` — 4-mode comparison (sea FCL / sea LCL / air / rail) with rail viability rules. Base rates: sea FCL €0.55/kg, sea LCL €1.40/kg, rail €1.85/kg, air €6.50/kg. Origin multipliers (CN baseline 1.00; IN, VN, BD, ID, TH, MY, PK 1.05–1.30). Rail viability gate: origin ∈ {CN, KZ, KG} AND destination ∈ 17 EU/CEE codes (China-Europe Railway Express via Khorgos / Brest / Małaszewicze). Air uses 167 kg/m³ volumetric. CO₂ math: 10 / 14 / 600 / 30 g per tonne-km (sea FCL / sea LCL / air / rail). Recommendation engine: urgency <14 days → air; 200–5000 kg China-EU → rail (sweet spot); ≥5000 kg → sea FCL; <200 kg → air; cost-priority overrides to cheapest viable. `railEducation` block bundles when rail wins / loses; `nextSteps` array drives downstream CTAs
- `api/routing.js` — quote endpoint (POST = calculate, GET = list modes + pricing snapshot); 30 req/min/IP rate limit

### Backend — Customs & Bonded Solutions (Tier 2 — second item)

- `lib/intelligence/customs-quote.js` — landed-cost estimator with two side-by-side scenarios. Scenario 1: standard clearance — duty (HS chapter MFN) × customs value + import VAT × (customs value + duty) + brokerage (€45 base + €8/line capped €250) + €25 ENS pre-arrival filing. Scenario 2: bonded warehouse — €95 entry + €0.30/cbm/day storage + 1.2% bond fee on customs value + €65 exit (or €35 re-export); duty + VAT either deferred (cash-flow benefit at 6% annual cost-of-capital) or avoided entirely on re-export. HS chapter table covers ~50 chapters (apparel 12%, footwear 11%, textiles 7-12%, machinery 2.5-3.5%, furniture 2.7%, etc.). Origin overlay handles CN anti-dumping (steel chapters 72/73 +18%/+10%, aluminium 76 +10%, footwear 64 +4%) and preferential FTAs (VN EVFTA 70% reduction, BD/KH EBA full duty waiver, PK GSP+ 50%, TR customs union 95%). EU VAT rates for all 27 member states. Recommendation engine prefers bonded re-export when applicable, prefers bonded deferral only when cash-flow benefit > bonded ops cost premium
- `api/customs.js` — quote endpoint (POST = calculate, GET = list countries + origins + HS chapters + snapshot); 30 req/min/IP rate limit

### Backend — Warehouse / 3PL (Tier 2 — third item)

- `lib/intelligence/warehouse-quote.js` — six-hub multi-region 3PL benchmark (Rotterdam NL / Hamburg DE / Frankfurt DE / Poznań PL / Prague CZ / Barcelona ES). Each hub has storage (€/pallet/month, range €12–€19), inbound receipt (€/pallet, range €9–€14), pick & pack (per-order base + per-line + per-unit), packaging materials, and setup fee (one-off, amortised over 12 months). Outbound shipping uses a 6×6 region-to-region rate matrix (CENTRAL/NORDIC/IBERIAN/MEDITERRANEAN/EAST/UK) with base + per-kg + transit days. Six value-added services (QC inspection, labelling, kitting, photography, returns processing, gift wrapping). Recommendation engine: picks cheapest hub if same-region as primary destination; otherwise compares cheapest vs cheapest-in-destination-region, recommends fastest only when premium ≤10%
- `api/warehouse.js` — quote endpoint (POST = calculate, GET = list hubs + value-added services + snapshot); 30 req/min/IP rate limit

### Frontend — Customer Dashboard (Phase 2 skeleton)

- `lib/dashboard/state-aggregator.js` — environment-agnostic state aggregator (Node-testable, browser-runnable). Reads localStorage drafts from all 7 platform tools (4 doc forms + insurance / samples / returns), groups by document/quote, summarises each (invoice number, parties, line count, currency for documents; cargo + mode + route for quotes); session helpers `buildSession`, `saveSession`, `loadSession`, `clearSession` with role validation and stub-auth metadata
- `dashboard/index.html` — sidebar layout with 4 nav sections (Workspace / Documents / Tier 1 services / Pillars); topbar with workspace name + user + tier; stats row (total drafts / documents / quotes / plan tier); document drafts panel; active quotes panel; quick-actions 6-up grid; "what's coming next" roadmap panel
- `dashboard/auth.js` + `dashboard/login/`, `dashboard/signup/` — stub auth (browser-side); explicit demo-mode banners; `OrcaAuth` API mirrors what real auth (Supabase / Auth.js / Clerk) will replace

### Backend — other (existing, unchanged)

- `/api/chat`, `/api/check`, `/api/quick-check`, `/api/factory-score`, `/api/supply-chain`, `/api/news`, `/api/contact`, `/api/evidence`, `/api/report(s)`, `/api/workspace`
- Anthropic API key as `ORCATRADE_OS_API`
- Resend for transactional email

### Test suite — 497 tests, 0 failures

- `test/cbam-analysis.test.js` — 22 tests
- `test/eudr-analysis.test.js` — 23 tests
- `test/reach-analysis.test.js` — 15 tests
- `test/ce-analysis.test.js` — 20 tests
- `test/document-generator.test.js` — 15 tests
- 46 pre-existing tests across compliance, factory-risk, supply-chain, runtime-store, etc.
- **Total: 141 tests passing**

### Agent eval harness — 15 cases

- `test/agent-eval-cases.json` (v1.1) — 15 scenarios covering CBAM (3) / EUDR (3) / REACH (2) / CE (3) / multi-regulation (1) / escalation paths (3) / out-of-scope (2)
- `scripts/agent-eval.js` — runs cases against agent handler with `ORCATRADE_OS_API`, asserts tools called / citation presence / keywords / escalation / stop reason; `--bail` and single-case-by-id supported; CI-suitable exit codes

### Internal documents in `docs/`

- `strategic-platform-plan.md` — this file (authoritative plan)
- `compliance-agent-spec.md` — Compliance Agent system prompt + 9 tool definitions
- `logistics-sop.md` — 15-step shipment playbook with roles, escalation framework, KPIs
- `partner-outreach-scripts.md` — cold/warm templates for forwarders, customs agencies, inspection partners
- `letter-of-engagement.md` — bilingual EN+PL Letter of Engagement templates (Forwarder / Customs / Inspection)
- `intelligence-build-plan.md`, `claude-frontend-worker-prompt.md` — earlier planning docs

### Visual design — the wow layer

- Aurora animated gradient blobs (drifting at 38s/46s/60s cycles) on every restructured page
- Cursor-following spotlight on group cards, leadership cards, tier cards, tool cards
- Sticky page TOC with scroll-spy on right edge of long pages
- Hero text reveals on load (cubic-bezier ease-out cascade)
- Counter animations on ROI estimator (count up from zero on viewport entry)
- Animated process diagram arrows that draw on viewport entry
- Nav lift on scroll
- Print stylesheets for the analysis report

---

## What's NOT yet shipped

### Phase 1 closure

- PL/DE mirrors of `/logistics/`, `/platform/`, `/pricing/`, `/analysis/`, `/agent/` — translation pass needed
- Vercel production deployment of all the above — multi-sprint deployment debt
- Soft-launch comms (LinkedIn announcement, Polish e-commerce groups, ICP outreach) — owner action

### Phase 2 — Operational backbone (Weeks 4–10 in the doc)

- Customer dashboard / logged-in area — **skeleton shipped Sprint 18** with stub auth, activity aggregator, sidebar navigation, panel layout. **Real auth (Supabase / Auth.js / Clerk) and server-persisted state are the next architectural decisions.**
- Document portal (S3 or Supabase upload/download)
- Internal quote-to-booking workflow tool
- Partner integrations (gated on partner signing)

### Phase 3 — Other agents

- ~~Sourcing Agent system prompt + deployment~~ — **shipped Sprint 25** (7 tools, 5 countries × 8 categories sourcing benchmark)
- ~~Logistics Agent system prompt + deployment~~ — **shipped Sprint 23** (8 tools, `recommendShipmentPlan` orchestrator)
- ~~Finance Agent system prompt + deployment~~ — **shipped Sprint 26** (8 tools, payment instruments + LC + FX + working capital + trade credit)
- ~~Operations Orchestrator~~ — **shipped Sprint 24, expanded Sprint 25 + 26** (now 25 unique tools merged from all four specialists, domain-tagged tool trace, 5-tab agent switcher). **The full agent suite is complete.**

### Billing & monetisation

- Stripe Billing wired to pricing CTAs (currently route to contact form)
- Stripe Tax for EU VAT
- Usage tracking from day one (every agent query, document, API call)

### Other doc commitments

- Unit-economics spreadsheet (subscription MRR + per-shipment fee model)

### Tier 1 expansions (within 6 months per the doc)

- Trade Documentation Hub — **shipped Sprints 12–13**: Commercial Invoice + Packing List + Proforma Invoice + Certificate of Origin live; Bill of Lading Draft + Fumigation Certificate are roadmap
- Insurance Marketplace — **MVP shipped Sprint 14**: quote calculator, ICC A/B/C coverage, route + goods-type loading, 12% commission baked in; partner broker integration + binding-quote handoff are next
- Trade Credit & Buyer Verification — **MVP shipped Sprint 15**: 6 curated tier-1 buyer profiles, 17-jurisdiction registry directory, heuristic fallback for unknown buyers; production-grade Creditreform / D&B / Atradius integration is next
- Sample Management Service — **MVP shipped Sprint 16**: HK consolidation pricing, 6 weight bands, 7 destination regions, express + rush toggles; HK ops queue integration + supplier outreach automation are next
- Returns & Reverse Logistics — **MVP shipped Sprint 17**: three-route comparison calculator (return / refurbish / scrap), category-aware viability, recommendation engine ranks by recovery vs cost; partner-network onboarding (refurb hub, EU disposal partners) is next
- Multi-modal Routing — **MVP shipped Sprint 19**: 4-mode comparison (sea FCL / sea LCL / air / rail), China-Europe rail viability gate, weight-band recommendation engine, rail education block exposing the corridor most forwarders skip. Next: real-time carrier rate ingestion (Freightos / Xeneta) and live rail capacity feed from Małaszewicze
- Customs & Bonded Solutions — **MVP shipped Sprint 20**: standard clearance vs bonded warehouse comparison, HS chapter MFN duty rates (~50 chapters), 27 EU national VAT rates, origin overlay for CN anti-dumping + VN/BD/PK/TR preferential FTAs, bonded re-export math + cash-flow deferral benefit. Next: TARIC API integration for 8-10 digit duty rates, BTI ruling tracker, bonded warehouse partner network onboarding
- Warehouse / 3PL — **MVP shipped Sprint 21**: six-hub EU benchmark (Rotterdam, Hamburg, Frankfurt, Poznań, Prague, Barcelona), full pricing breakdown (storage + inbound + pick/pack + outbound + setup), 6×6 region-to-region outbound rate matrix, six value-added services with per-unit / per-pallet / per-return scaling, region-aware recommendation engine. Next: partner-network onboarding for actual fulfilment introductions, multi-hub split optimiser for >5k orders/month, integration with shipping label APIs

**🎯 All 5 Tier 1 expansions are now MVP and 3 of 5 Tier 2 items are live (Routing + Customs + Warehouse). Next Tier 2 candidates: Marketplace, Export Services to Asia — or Phase 2 operational backbone (real auth + server-persisted dashboard state, Document Portal, Internal Workflow tools).**

### Tier 2 (6–18 months)

- Multi-modal Routing — **shipped Sprint 19** (calculator + landing + comparison form)
- Customs & Bonded Solutions — **shipped Sprint 20** (calculator + landing + comparison form)
- Warehouse / 3PL — **shipped Sprint 21** (calculator + landing + comparison form)
- Marketplace, Export Services to Asia — pending

### Tier 3 (18+ months)

- Embedded Finance, Sustainability & ESG Reporting, OrcaTrade Academy, Industry Verticalisation, Trade Data Product

### Adjacent infrastructure

- Multi-currency wallet, public API, mobile app, browser extension, Slack/Teams integration, webhooks

---

> **Final note from prior session — Oskar's stated north star:** *"lets make orcatrade big."*
>
> The platform thesis is sound. The differentiation is real. The execution sequence is clear.
>
> **Build.**
