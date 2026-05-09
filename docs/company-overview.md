# OrcaTrade — Company Overview

> The operating system for European SMEs importing from Asia.

| | |
|---|---|
| **Legal entity** | OrcaTrade Holding |
| **Headquarters** | Warsaw, Poland |
| **Operating presence** | Warsaw · London · Hong Kong |
| **Founders** | Jay Xie (CEO) · Oskar Klepuszewski (CFO) · Arman Sirin · Yiu Cheung |
| **Stage** | Pre-revenue · platform feature-complete · GTM commencing 2026 |
| **Document** | v1.0 · 2026-05-09 · Authored by Oskar Klepuszewski |

---

## 1. Executive summary

OrcaTrade is the operating system for European SMEs importing from Asia. The product replaces the patchwork of Alibaba searches, freight-broker email threads, customs-broker WhatsApp messages, and quarterly compliance scrambles that defines how a typical €100k–€2M-a-year importer operates today. In its place, one workspace combines five calculator-grounded planning engines, five specialised AI agents, an EU-compliance overlay covering CBAM/EUDR/REACH/CE/AD-CVD, and a curated execution layer reaching back through partners into Hong Kong.

The thesis is simple. The European SME importer cannot afford a 50-person trade-operations team. They can afford €99–€999 per month for the AI version of one. OrcaTrade is the layer between Alibaba and the EU shelf — calculator-grounded, regulation-cited, and built by people who actually ship goods into Europe.

The platform is feature-complete as of May 2026. 1,200 automated tests gate every change. Trilingual product surface in English, Polish, and German. Five Stripe-billed tiers wired end-to-end from pricing page through subscription gating. A 180-page calculator-grounded SEO content library that doubles as a moat. The binding constraint going forward is no longer engineering — it is go-to-market.

---

## 2. The problem

### 2.1 The status quo for an EU SME importing from Asia

A representative customer — a Polish e-commerce founder bringing €25,000 of woven apparel from Vietnam to Warsaw — operates today as follows:

- **Sourcing** lives in Alibaba browser tabs and WhatsApp threads with three different supplier-side sales agents. No single record of who quoted what, when, or against which spec.
- **Freight** is priced ad-hoc through a forwarder's Excel quote that arrives 36 hours after the request. The customer has no independent benchmark and no way to compare sea, air, and rail on the same goods.
- **Customs** clearance happens through a broker the customer has never met. MFN duty appears on the invoice with no way to verify whether a preferential-origin certificate (EUR.1, GSP+, EBA) would have eliminated it.
- **Compliance** is a fog. CBAM applies to some of these goods. EUDR will apply from December. REACH SVHC limits are real. None of this is surfaced until the customs broker raises it at the wrong moment.
- **Working capital** is sized by feel. The customer does not know that paying their supplier on T-30 instead of T-0 frees up two weeks of cargo value as cash. Nor that the FX leg of the deal — quoted in USD, paid in EUR — is silently costing them 2–4% per shipment.

Net effect: the customer routinely overpays 15–30% of total landed cost relative to what an experienced trade-operations team would deliver, and bears compliance risk they cannot price.

### 2.2 Why incumbents do not solve this

- **Alibaba** is breadth without calibration. A search for "apparel manufacturer Vietnam" returns 50,000 results with no signal on which is auditable, which has EVFTA-eligible documentation, which has produced for an EU buyer before.
- **Maersk, Flexport, Forto, DSV, K+N, Schenker** are forwarder-first. Their commercial teams ignore SMEs at this volume tier — they cannot afford to staff against a €25k shipment with full coverage. Sourcing, supplier vetting, and compliance are out of scope.
- **SAP GTS, Oracle GTM, customs-broker software** is enterprise-grade and enterprise-priced. Six-figure annual licences and twelve-month implementations. The Polish e-commerce founder sees these and bounces.
- **Spreadsheets and email** is the actual default. It works at volume zero. It breaks somewhere between shipment 5 and shipment 50, usually after a CBAM-eligible cargo arrives uncalculated.

The gap between "free + chaotic" and "enterprise + €200k/year" is precisely the gap OrcaTrade fills.

---

## 3. Our position

### 3.1 Master positioning sentence

> **OrcaTrade is the operating system for European SMEs importing from Asia: AI agents and verified supplier infrastructure that take a buyer from "I don't know how to do this" to goods on the warehouse floor.**

Every line of marketing copy traces back to this sentence.

### 3.2 Brand line

> **Find it · Verify it · Ship it · Finance it — one platform, Asia to Europe.**

### 3.3 The five-stage import journey

OrcaTrade reframes four pre-existing OrcaTrade Holding business units plus one new pillar as stages of a single integrated journey:

| Stage | Question the customer is asking |
|---|---|
| 1. Search | Which countries and factories should I even consider? |
| 2. Sourcing | Which specific supplier wins this RFQ? |
| 3. Intelligence | Is this supplier safe? Am I compliant? |
| 4. Logistics | How do I actually move and clear the goods? |
| 5. Finance | How do I pay, hedge, and finance the deal? |

The platform is the answer to all five inside one workspace, in one shared customer record, with one consolidated bill.

### 3.4 The moat

Four sources of defensibility, in descending order of durability:

1. **Calculator-grounded recommendations.** Every number in the platform — duty rates, freight cost, FX risk, working-capital impact, landed cost — is computed from a deterministic model the customer can audit. No black-box AI estimates. This is invisible against a flashy demo and decisive once a customer has been burned by an LLM hallucination.
2. **EU-specific compliance knowledge.** CBAM, EUDR, REACH, CE, RoHS, AD/CVD, preferential-origin pathways. American AI platforms in this space don't have this. European compliance software is enterprise-tier. The middle is empty.
3. **Hong Kong physical presence.** In-person supplier verification, sample consolidation, dispute resolution. Pure-digital forwarders cannot match this at the SME price point. Co-founder Yiu Cheung runs HK operations.
4. **AI-native architecture.** Five specialised agents plus an orchestrator, every claim cited against EUR-Lex chunks or a deterministic calculator output. Built day-one with full tool-use plumbing — not a chatbot grafted onto a legacy stack.

---

## 4. The product

### 4.1 Architecture in one sentence

A trilingual workspace combining real-time calculator engines, five specialised AI agents, an EU-compliance overlay, an asset-light execution layer reaching to Hong Kong through partners, and a 180-page SEO content library that funnels prospects in.

### 4.2 Calculator engines

Seven deterministic engines power the wizard, the agents, and the saved-plan history. Every output traces to inputs the customer can audit.

| Engine | What it answers |
|---|---|
| `sourcing-quote` | Which of 5 candidate origins (CN/VN/IN/BD/TR) wins on FOB price × MOQ × lead time × IP risk for this category? |
| `routing-quote` | What are sea, air, and rail prices and transits for this lane, and which is recommended? |
| `customs-quote` | What is duty + VAT + brokerage on this HS code into this destination, and is bonded warehousing better? |
| `warehouse-quote` | Which of six EU 3PL hubs (Poznań, Frankfurt, Hamburg, Rotterdam, Barcelona, Prague) is cheapest for this volume profile? |
| `fx-quote` | What is the FX exposure on a non-EUR-quoted purchase, and is hedging economic at this size? |
| `tco-quote` | What is annual total-cost-of-ownership including inventory carrying cost at the customer's WACC? |
| `working-capital` | What is cash tied up in inventory + receivables - payables, and which lever (DPO+30, ship-frequency, etc.) frees the most? |

The calculators ship as pure JavaScript modules with full unit-test coverage. They run identically in the browser, the agent tool layer, and the saved-plan diff engine.

### 4.3 AI agent suite

Five agents plus an orchestrator. Each agent has a defined system prompt, a defined toolset, and a defined tier-gate. All run on Anthropic Claude (Sonnet 4.6 production, with the orchestrator surfacing Opus on demand).

| Agent | Tier | Scope |
|---|---|---|
| **Compliance Agent** | Free | EU regulatory landscape — HS classification, duty + VAT calculation, applicable regimes (CBAM, EUDR, REACH, CE, RoHS, food contact, toy safety, textile labelling). Cites every claim against EUR-Lex chunks. |
| **Sourcing Agent** | Starter+ | Category × origin recommendation, RFQ drafting, MOQ + lead-time clarification. |
| **Logistics Agent** | Growth+ | Sea/rail/air mode comparison, Incoterm advisor, customs clearance route comparison, document checklist. |
| **Finance Agent** | Growth+ | Payment-instrument comparison (LC vs TT vs DA/DP), FX hedge sizing, working-capital optimisation, trade-finance referrals. |
| **Operations Orchestrator** | Growth+ | Meta-agent that routes across the four specialists. 14 unique tools after deduplication. Customer dashboard surface. |

Every agent ships with a `request_human_review` tool. Agents do not commit to bookings or sign contracts autonomously. Tier-quota gating enforces 20 queries/month free, 200 starter, 1,000 growth, unlimited at scale and enterprise.

### 4.4 EU-compliance overlay

A structured catalogue of every EU regulation an importer needs to surface against, with per-product applicability rules and citation-grounded summaries:

- **Trade-defence dossiers** — anti-dumping, countervailing, and safeguard measures across 32 active product-origin pairs (Chinese e-bikes 87% combined, Chinese cold-rolled steel, Egyptian fibreglass fabric, Indonesian stainless, Indian stainless, Turkish cold-rolled steel, etc.).
- **Preferential-origin pathways** — 15 active regimes (EVFTA, EUKFTA, EUJEPA, A.TR, EBA, GSP+, GSP standard, plus per-origin guides for VN/IN/BD/PK/TR/KR/JP).
- **Compliance regime overlays** — 14 regimes (CBAM, EUDR, REACH, RoHS, WEEE, GPSR, PPWR, Battery, Cosmetics, Toy Safety, CE Machinery, CE LVD/EMC/RED, Footwear Labelling).
- **Per-route customs guides** — 36 origin-destination combinations (CN/HK/IN/TR/VN × 6 EU destinations).
- **Per-category sourcing guides** — 40 category-origin combinations (8 categories × 5 origins).
- **Worked examples** — 8 anonymised end-to-end import plans with calculator-grounded numbers (Bangladesh apparel under EBA, Korean machinery under EUKFTA, Turkish steel with A.TR + AD layered, Chinese e-bike under 87% combined AD+CVD, etc.).

Total: **180+ trilingual content pages**, each generated from the same `composePlan()` engine that powers the live wizard. Every page links into the wizard with pre-filled inputs via a base64-encoded permalink. SEO content and product-led growth are the same surface.

### 4.5 Workspace

- **Magic-link authentication** — no passwords, HMAC-signed session cookies, 30-day TTL. Run on Vercel KV (Upstash Redis), durable across cold starts.
- **Saved plans + history** — each user can save up to 50 plans (1-year TTL). Every saved plan stores a 6-field landed-cost snapshot at save time; on revisit the platform recomputes against current pricing and surfaces a "what's changed" delta with significance threshold ≥5%.
- **Implementation roadmap per plan** — a 5-phase, 15–25-task week-by-week sequence (pre-departure, production+QC, logistics+customs, arrival+inland, post-arrival) with conditional branches that fire when the plan triggers them: preferential-origin certs, trade-defence TARIC checks, CBAM quarterly cadence, FX forward execution, payment-terms negotiation.
- **Currency display toggle** — every monetary value re-renders on demand in EUR, USD, CNY, VND, or PLN at snapshot rates. Preference persists in localStorage.
- **Conversion analytics dashboard** — `/dashboard/leads/`, token-gated, surfaces durable event log for category mix, route mix, locale mix, email-capture rate, mean landed total.
- **Founder outbound composer** — `/agent/outbound/`, brand-voice-pinned cold-email drafter routed through the orchestrator agent.

### 4.6 Distribution surface

- **`/start/`** — six-question wizard, full landed-cost analysis, shareable permalink, save-to-account button when signed in. Trilingual.
- **`/agents/`** — five public agent surfaces plus the orchestrator.
- **`/guides/`** — 180-page calculator-grounded content library.
- **`/examples/`** — eight worked end-to-end scenarios.
- **`/marketplace/`** — anonymised supplier-directory shell (15 composite cards across 8 verticals × 8 countries).
- **`/pricing/`** — five-tier comparison with monthly/annual toggle, current-plan badge for signed-in users.
- **`/account/`** — sign-in, saved plans, billing portal, current-tier surface.
- **`/press/`** — press kit, founder bio, brand assets, quotable lines.
- **`/partners/`** — three-mode partner ecosystem (Recommended/Referral/Commercial) across freight, finance, FX, insurance, inspection, compliance.
- **`/feed.xml` + `/atom.xml`** — RSS + Atom syndication of all 185 newsworthy pages.

---

## 5. Operating principles

These are not aspirational. They are how the platform is actually built.

### 5.1 Calculator-grounded over generative

Every monetary number in the product traces back to a deterministic calculator. Agents reference calculator outputs by tool call; they do not estimate. When an LLM is asked "what's the duty on Chinese cold-rolled steel into Poland," it does not guess — it calls `customs-quote`, which reads from a structured TARIC + AD/CVD database. If we cannot calculate it, we say so.

### 5.2 Calibrated trust over breadth

We do not index the whole of Alibaba. We curate. The future supplier directory will ship with 50 vetted suppliers, not 500,000. The agent suite is 5 specialists, not 20. Editorial restraint is the product.

### 5.3 Citation discipline

Regulatory claims cite EUR-Lex. AD/CVD figures cite the relevant Implementing Regulation by celex number. Worked examples link to the specific regulation that drives the duty rate. If we cannot cite it, we don't claim it.

### 5.4 Human-in-the-loop on irreversible actions

Agents do not autonomously sign contracts, commit to bookings, or transmit payments. Every agent has a `request_human_review` tool. Customer trust is fragile; abdicating control of a €50k cargo to a chatbot would destroy it.

### 5.5 Trilingual by default

Every product surface ships in English, Polish, and German. Polish customers see Polish copy. German customers see German copy. There is no "international English" fallback for the Polish ICP — we built in their language because we are operators in their language.

### 5.6 Asset-light execution

We do not own warehouses, ships, or customs licences. We coordinate execution through partners (DSV, K+N, Röhlig Suus, Raben for forwarding; QIMA, AsiaInspection for QC; Wise, Convera for FX; Atradius, Coface for credit). The value lives in the layer above — supplier intelligence, AI tooling, Hong Kong presence — not in capital-heavy infrastructure.

---

## 6. Target customers

Three Ideal Customer Profiles, listed in order of GTM priority.

### ICP 1 — Polish e-commerce founders

Allegro sellers, Amazon FBA operators, multi-channel D2C brands. €50k–€500k annual import volume from Asia. The patchwork-process pain is most acute here — supplier on Alibaba, freight broker by email, customs broker on WhatsApp, no single view. CBAM/EUDR/REACH compliance is a black box.

The lead artefact is the free Compliance Agent and the Routing calculator. The hook is "stop running imports out of email threads."

### ICP 2 — German Mittelstand

Manufacturing SMEs sourcing components from China and Vietnam. €500k–€2M annual import volume. Often family-owned, conservative, allergic to AI marketing copy. Compliance risk is existential — CBAM penalties under Article 26 are real, EUDR scope from December 2025 onwards is real, REACH SVHC drift is real. Big forwarders (DSV, K+N, DB Schenker) ignore them at this volume tier.

The lead artefact is the Compliance Agent demo plus a sample analysis report (PDF). The hook is "regulatory precision at SME pricing."

### ICP 3 — Specialty retailers and brand owners

Premium DTC brands, niche product specialists, slow-fashion and heritage brands. 5–50 shipments per year, low frequency / high consideration. Quality is everything; one bad shipment kills brand trust.

The lead artefact is the Sourcing Agent paired with a sample-management quote (paid trial). The hook is "from sample to shelf with one partner."

---

## 7. Business model

Two revenue streams, one bill.

### 7.1 Subscriptions for access

Five tiers. Customers pay whether or not they ship in any given month — they pay for access to the platform.

| Tier | Monthly | Annual | Customer profile |
|---|---|---|---|
| Free | €0 | €0 | Lead-gen, evaluators, single-shipment users |
| Starter | €99 | €990 (save €198) | Solo importers, FBA sellers |
| Growth | €399 | €3,990 (save €798) | Established SMEs, 5–50 shipments/year |
| Scale | €999 | €9,990 (save €1,998) | Mid-market, 50+ shipments/year |
| Enterprise | Custom (from €2,500/mo) | Custom | Manufacturers, distributors, retail chains |

Every tier above Free includes a 14-day trial. EU VAT handled via Stripe Tax. Annual is two months free, framed honestly as "pay 10, get 12."

Tier entitlements are encoded in `lib/tiers.js` as the single source of truth. Feature flags + monthly quotas (agent queries, supplier monitors, saved plans, seats, API calls) gate behaviour at the handler layer. Free tier gets the Compliance Agent and 20 queries/month; orchestrator unlocks at Growth; API access at Scale; white-label and ERP integration at Enterprise.

### 7.2 Transactional revenue

Per-shipment execution fees, paid as the customer ships:

- **Service fee per shipment** — €150–€2,500 depending on tier and complexity.
- **Freight markup** — 8–15% on freight cost, resold from forwarder partners.
- **Customs clearance** — per-declaration fee through licensed broker partner (Polish *agencja celna*).
- **Inspection services** — pass-through to QIMA or AsiaInspection with a small coordination fee.
- **Trade-finance origination** — % per deal, referred to Tradeshift / Stenn / FreshFi.
- **Cargo insurance** — per-shipment commission, panel placement.

Higher subscription tiers receive transactional discounts: 5% off shipment fees on Starter, 10% on Growth, 15% on Scale.

### 7.3 Add-on modules

Stackable on any tier:

- **Sustainability Reporting Pro** — €199/mo. Automated CBAM, EUDR, Scope 3 reporting per shipment, per supplier, aggregated annually.
- **Industry Compliance Pack** — €149/mo per industry. Vertical-specific deep-dives across Electronics, Textiles, Food, Toys, Cosmetics.
- **Buyer Verification** — €99/mo. Score European buyers using public registries (KRS, Handelsregister, Companies House) plus credit data. The inverse use-case to import.
- **Multi-currency Wallet** — €49/mo or FX margin. Hold EUR, USD, CNY, HKD, PLN balances, hedge exposure, settle suppliers.
- **Premium Agent Pack** — €299/mo. Early access to new agents, custom system-prompt training on customer's historical shipments and supplier interactions.
- **Dedicated Account Manager** — included in Scale and Enterprise.

---

## 8. Competitive landscape

| Category | Examples | What they do well | Why they don't fit our ICP |
|---|---|---|---|
| **Marketplaces** | Alibaba, Made-in-China, Global Sources | Breadth of supplier listings | No vetting layer, no compliance, no execution, no curation |
| **Pure-digital forwarders** | Flexport, Forto, Beacon | Slick freight booking UX | Forwarder-first; no sourcing or compliance; SME-tier coverage thin in Europe |
| **Traditional global forwarders** | DSV, Kuehne+Nagel, DB Schenker, Maersk | Capacity, scale, reliability | Ignore SMEs at our volume tier; no AI, no compliance overlay, no integrated intelligence |
| **Enterprise GTM software** | SAP GTS, Oracle GTM, Thomson Reuters ONESOURCE | Comprehensive enterprise compliance | Six-figure annual licences, twelve-month implementations; SME never qualifies |
| **Customs-broker software** | Descartes, AKL, ASYCUDA-aligned tools | Filing automation for licensed brokers | Sold to brokers, not importers; opaque to the actual buyer |
| **AI trade copilots** | Various US-based startups | AI fluency | American-centric data, no EU regulatory depth, no Asia presence, no calculators |
| **DIY / status quo** | Spreadsheets + email | Free, infinitely flexible | Breaks somewhere between shipment 5 and shipment 50, usually after a CBAM-eligible cargo arrives uncalculated |

OrcaTrade sits in a deliberately empty quadrant: SME-priced, EU-regulation-deep, AI-native, calculator-grounded, with physical Asia presence. The combination is the moat.

---

## 9. Go-to-market

### 9.1 The SEO content moat

180+ calculator-grounded pages ranking for long-tail queries that traditional ad-buyers cannot defend:

- "duty on Chinese e-bikes into Poland" → trade-defence dossier showing 87% combined AD+CVD with calculator link.
- "EUR.1 form Vietnam apparel EU" → preferential-origin pathway page with EVFTA walkthrough.
- "CBAM steel imports calculator" → compliance overlay with HS-coverage table.
- "Bangladesh apparel EBA zero duty" → worked example with full landed-cost breakdown.

Every page funnels into the wizard via pre-filled permalink. Every wizard run captures an event into the conversion-analytics dashboard. SEO traffic, product-led growth, and the lead-gen surface are the same artefact.

The library compounds. New trade-defence measures, new preferential-origin updates, new compliance regimes — each addition is a page that ranks, a wizard surface, an agent tool, and a saved-plan branch simultaneously.

### 9.2 Free tier as wedge

The free Compliance Agent runs on a question every EU SME importer needs answered: "what regulations apply to my product, and what would they cost me?" This is a question competitors charge €1,000+ for and answer in two weeks. We answer it in 90 seconds, cited against EUR-Lex.

Every Compliance Agent run captures the customer into the durable event log. Email-capture rates are surfaced on the leads dashboard.

### 9.3 Founder-led outbound

The `/agent/outbound/` tool drafts brand-voice-pinned cold emails from a brief (recipient, hook, goal, tone). Routed through the orchestrator agent. Built to scale founder-led GTM through the Polish-LinkedIn → discovery-call → discovery-call-to-Starter funnel.

### 9.4 Partner referrals (inbound)

Forwarders, FX brokers, insurers, inspection agencies, compliance consultancies — listed at `/partners/` across three relationship modes (Recommended / Referral / Commercial). Inbound leads from partners who recognise OrcaTrade fits a customer they cannot serve at this volume.

### 9.5 Channel mix by ICP

| ICP | Primary channels |
|---|---|
| Polish e-commerce | Polish-language LinkedIn, Allegro seller communities (Facebook groups), Polish e-commerce Slack, founder-led outbound |
| German Mittelstand | German LinkedIn, trade-publication advertorials (Logistik Heute, DVZ), curated webinars with HK partners |
| Specialty retail | Founder-led LinkedIn, niche industry publications, partner-network referrals |

---

## 10. Technology

### 10.1 Stack

- **Frontend**: Vanilla HTML + zero-build JS. No React, no TypeScript, no Tailwind, no shadcn. The site is fast by construction; every page is statically deliverable.
- **Backend**: Node.js serverless on Vercel. Single consolidated dispatcher (`api/[...path].js`) routes 33 endpoints through one function — chosen specifically to stay under the Vercel Hobby 12-function limit.
- **AI substrate**: Anthropic Claude (Sonnet 4.6 production, Opus on demand) with full tool-use plumbing.
- **Persistence**: Vercel KV (Upstash Redis REST). In-memory fallback for local development.
- **Auth**: Custom magic-link auth with HMAC-signed session cookies. No third-party identity provider.
- **Email**: Resend transactional, with verified `orcatrade.pl` sender.
- **Billing**: Stripe Checkout + Stripe Billing Portal + idempotent webhook handler.
- **Observability**: Structured event log written to KV, surfaced through `/dashboard/leads/`. Vercel function logs for short-term diagnostics.
- **CI**: GitHub Actions running `node --test` against Node 20 + 22 LTS on every push and PR.

### 10.2 Architecture decisions worth surfacing

- **Single Vercel function**: Consolidating all 33 endpoints into one dispatcher trades a small startup cost for staying on Hobby pricing through GTM. Re-fanning out to per-endpoint functions is a one-day refactor when revenue justifies the Pro tier.
- **KV-only persistence**: Postgres is deferred until volume justifies relational queries. Saved plans, tiers, auth tokens, and event logs all fit comfortably in key-value access patterns. The migration is a one-week engineering effort post-funding.
- **Calculator engines as pure modules**: Every engine in `lib/intelligence/*-quote.js` is a pure function with no I/O. This makes them trivially testable, callable from agents as tools, and renderable identically in the browser and the server.
- **Trilingual at the source**: EN/PL/DE content is generated from the same `composePlan()` invocations with locale-aware string templates in `lib/start-i18n.js`. Adding a fourth language is a string-table addition, not a content rewrite.

### 10.3 Test discipline

1,200 automated tests across 27 test files. Coverage includes every calculator engine, the agent tool layer, the auth flow, the saved-plan diff engine, the tier gating system, the Stripe webhook idempotency path, the conversion-analytics aggregation, the RSS feed builder, and the implementation-roadmap conditional logic. Every test runs on every push via GitHub Actions.

---

## 11. Team

### 11.1 Founders

- **Jay Xie** — CEO. Asia-side leadership, supplier-network architecture, commercial relationships into China and Vietnam.
- **Oskar Klepuszewski** — Co-Founder & CFO. Polish-side commercial, financial modelling, product strategy. Information Management for Business at UCL School of Management. Author of this document.
- **Arman Sirin** — Co-founder. Operational leadership across the Europe-Asia corridor.
- **Yiu Cheung** — Co-founder. Hong Kong feet on the ground — supplier verification, sample consolidation, on-the-ground dispute resolution.

### 11.2 Operating presence

- **Warsaw** — primary commercial and engineering base, EU customer-facing operations.
- **London** — strategic and capital-markets presence.
- **Hong Kong** — Asia-side execution: supplier verification, sample handling, factory visits, dispute mediation.

The HK presence is the single hardest competitive moat to replicate. Pure-digital competitors (Flexport, Forto) cannot match it at our price point. Traditional forwarders with HK offices do not serve our customer.

---

## 12. Status and roadmap

### 12.1 Shipped (as of 2026-05-09)

| Milestone | Description |
|---|---|
| Calculator engines | 7 engines with full unit test coverage |
| Wizard | 6-question flow with permalink, share, save-to-account |
| AI agent suite | 5 specialists + orchestrator, all live |
| Compliance overlay | 14 regimes, 32 trade-defence dossiers, 15 preferential-origin pathways |
| Content library | 180+ trilingual pages, all calculator-grounded |
| Authentication | Magic-link via Resend, HMAC-signed cookies, KV-backed |
| Saved plans | Per-user history with snapshot-at-save and "what's changed" diff |
| Subscription tiers | 5 tiers encoded in `lib/tiers.js` with feature flags + quotas |
| Stripe billing | Checkout + portal + idempotent webhook + `/account/billing/` |
| Tier gating | Wired across all 5 agents + saved-plan POSTs |
| Conversion analytics | KV event log + token-gated `/dashboard/leads/` |
| Plan-revision diff | Snapshot at save, "what's changed since" callout on revisit |
| Implementation roadmap | 5-phase, conditional task generator per plan |
| Currency display toggle | EUR/USD/CNY/VND/PLN at snapshot rates |
| RSS + Atom feeds | `/feed.xml` and `/atom.xml`, 185 items |
| Marketplace shell | 15 anonymised supplier exemplars |
| Press + Partners pages | `/press/` indexable, `/partners/` ecosystem |
| Outbound composer | Founder-grade cold-email tool routed through orchestrator |
| Test discipline | 1,200 automated tests, GHA CI on every push |
| Operational hardening | `.env.example`, sitemap registration, daily content rotation |

### 12.2 Next 90 days

| Workstream | Status |
|---|---|
| Production env-var setup on Vercel | Operational, runbook complete (`.env.example`) |
| Stripe price seeding (6 prices) | Operational, dashboard configuration |
| Resend domain verification | Operational, DNS-side |
| First 10 paying customers | Founder-led outbound + Polish e-commerce community seeding |
| Sentry / production error tracking | 30-min integration once first customer signs |
| Lighthouse / accessibility audit | Pre-scale-up hardening |

### 12.3 Deliberately deferred

Not because they are unimportant — because they are premature without traction:

- **Live supplier directory** — until 50 vetted suppliers have given consent and a vetting pipeline is operational.
- **Lead enrichment from LinkedIn URL** — until inbound lead volume justifies a paid enrichment API (Clearbit, Apollo).
- **Postgres migration** — KV holds until 50+ paying users.
- **Mobile native app** — browser-first SaaS; nothing in the product demands native.
- **Multi-tenant white-label** — premature; no customer asking.
- **Languages beyond EN/PL/DE** — until customer demand in another market.

---

## 13. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| **AI hallucination on a regulatory claim** | Medium | Every regulatory claim cites EUR-Lex; HS-code lookups verified against structured TARIC; agent confidence indicators surfaced; `request_human_review` always available |
| **CBAM / EUDR landscape shifts** | High (regulatory) | Compliance overlay is structured data, not hard-coded copy; one update propagates across all 14 regime pages |
| **Customer trusts agent for irreversible action** | Medium | Hard rule: agents do not autonomously commit to bookings or sign contracts; confirmation gate on every transactional flow |
| **Anthropic API outage** | Low | Calculator engines run independently; agent unavailability degrades to "AI features temporarily unavailable" without breaking pricing/checkout/saved plans |
| **Stripe webhook retry double-charge** | Low | Webhook handler is idempotent via `stripe:event:<id>` KV dedupe; same event ID processed twice is a no-op |
| **KV data loss** | Low (cloud-hosted) | Backup strategy deferred until paying users; monitor Upstash SLA |
| **Resend deliverability** | Medium | Verified sender (`orcatrade.pl`), SPF/DKIM/DMARC configured pre-launch |
| **Vercel Hobby function limit** | Low | Already consolidated to 1 function via dispatcher pattern |
| **Customer asks for live supplier directory we don't yet have** | Medium | Marketplace shell sets honest expectations: anonymised exemplars + "request introduction" CTA, not false marketplace claims |
| **Competitor builds calculator-grounded EU compliance overlay** | Low | Three-year head start of accumulated regulatory data + 180-page SEO library + HK presence; replicating this is years of capital-O Operations |

---

## 14. Closing thesis

Every European SME that imports from Asia operates today inside a process so broken that 15–30% of landed cost is silently lost to FX margin, sub-optimal routing, missed preferential-origin pathways, uncalculated compliance exposure, and patchwork freight pricing. The market response so far has been Alibaba on one end (breadth, no calibration), enterprise GTM software on the other (€200k+ annual contracts), and a 50-strong gap of forwarders that ignore SMEs at this volume tier.

OrcaTrade fills that gap with a calculator-grounded, regulation-cited, AI-native workspace priced for the customer who cannot afford a 50-person trade-operations team but can afford the AI version of one for €99–€999 a month. The platform is feature-complete. The technology is shipped. The 1,200-test CI gate ensures regressions cannot ship silently.

What remains is go-to-market. The product can serve customers; it does not yet have any. The next 90 days are about converting that asymmetry — calculator-grounded numbers, citation-grounded recommendations, trilingual surface, Hong Kong presence — into the first ten paying logos.

---

*OrcaTrade Holding · Warsaw · London · Hong Kong*
*Document version 1.0 · 2026-05-09 · Authored by Oskar Klepuszewski, Co-Founder & CFO*
*Press inquiries: press@orcatrade.pl · Partner inquiries: /partners/*
