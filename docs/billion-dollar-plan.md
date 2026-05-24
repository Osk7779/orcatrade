# OrcaTrade — Billion-Dollar Platform Plan

**Author:** Claude (with Oskar Klepuszewski)
**Created:** 2026-05-22
**Status:** Living strategic document — the apex plan.
**Companion docs:**
- [dev-plan.md](dev-plan.md) — week-to-week product/SEO sprint tracker.
- [backend-grade-plan.md](backend-grade-plan.md) — the six-track backend vision (correctness, persistence, tenancy, observability, compliance, AI moat).

This document sits **above** both. They answer "what ships next week" and
"what has to be true for the backend not to break under load." This one
answers a bigger question: **what does OrcaTrade have to become to be a
billion-euro company, and in what order do we build it?**

When the three plans disagree, this one wins on direction; the other two
win on detail.

---

## 0. The decision that frames everything

Until now every architectural choice has bent around three self-imposed
constraints: **pure-JS, zero npm dependencies, one Vercel-Hobby function.**
Those were the right constraints for a pre-funding solo build — they kept
us deployable, cheap, and honest. They also capped the ceiling.

**As of this plan, the constraint is lifted.** We are building to a
big-corporation standard, which means we are now *allowed to spend* on
infrastructure where it compounds into capability or trust. The discipline
does not disappear — it moves. The new rule is:

> **Spend where it buys a moat or removes a trust objection. Stay lean
> everywhere else.** Every new dependency, paid service, or piece of infra
> must map to a flagship capability, an enterprise gate, or a reproducibility
> guarantee — never to convenience.

This is not licence to sprawl. It is licence to stop pretending a billion-
euro trade-compliance platform can run on BM25 over four JSON files and a
single serverless function.

---

## 1. North star

OrcaTrade is the **autonomous trade-operations team for every business
that moves goods across a border** — not a calculator you visit, but an
always-on operation that watches your shipments, your tariffs, your
suppliers, and your regulatory deadlines, tells you before something costs
you money, and produces the filings, documents, and decisions to fix it —
with a human in the loop only where the law or the money demands one.

The two-sentence test for billion-dollar grade:

1. **A FTSE-100 procurement director can sign a contract on our numbers**
   because every euro we show is reproducible, versioned, and auditable.
2. **A solo importer in Gdańsk gets the same brain** an enterprise gets,
   because the intelligence is software, not headcount — and that asymmetry
   is the business.

---

## 2. What "billion-dollar grade" actually means (the bars)

These are the measurable standards every pillar is held to. They are
aspirational today and become CI/SLO gates as each track matures.

| Dimension | Today (honest) | Billion-dollar bar |
|---|---|---|
| **Reproducibility** | Money is integer-cents (`money.js`); calc versions partially recorded | 100% of customer-facing numbers reproducible from `(inputs, calc_version, data_snapshot_id)` forever; "recompute as-of date X" works |
| **Agent grounding** | Calculator-grounded, `[chunk-id]` citations, confidence tiers | ≥99% of quantitative claims cite a tool result; hallucination rate measured + gated in CI; eval pass ≥95% before any prompt ships |
| **Corpus** | BM25 over 4 JSON corpora (CBAM/EUDR/REACH/CE) | Hybrid semantic+lexical RAG over a continuously-refreshed corpus: full TARIC, EU/UK regulation, sanctions lists, guidance — freshness SLA in days, not quarters |
| **Autonomy** | Advice on request, 8–10 turn tool loops | Agents monitor 24/7, alert proactively on *your* exposure, and draft the artifact (filing/doc/email) for human approval |
| **Reliability** | Circuit breakers, `/status/`, Sentry, uptime workflow | 99.9% uptime SLA, multi-region, error budgets, paging, graceful degradation on every upstream |
| **Trust** | GDPR export/delete, audit feed, SSO/OIDC, `docs/security/` | SOC 2 Type II, ISO 27001 path, SCIM, immutable hash-chained audit, EU data residency, trust center |
| **Surface** | 744 static HTML pages + a 6-step wizard | Authenticated app shell (dashboards, agent chat, alerts inbox, doc vault, compliance calendar) + the SEO moat preserved |
| **Economics** | Anthropic per-call, no caching at scale | Prompt caching + tiered model routing keep AI COGS <15% of revenue at the margin; gross margin >80% |

---

## 3. Where we are honestly (the launch pad)

Not starting from zero — starting from a genuinely strong, green-suite base.

**Strengths to build on:**
- **5 calculator-grounded AI agents** (compliance, logistics, sourcing,
  finance) + an **orchestrator meta-agent** merging 14 tools, with
  `[chunk-id]` citations, confidence discipline, and `requestHumanReview`
  escalation gates — see [lib/handlers/orchestrator.js](lib/handlers/orchestrator.js)
  and [lib/ai/prompts/orchestrator/v1.txt](lib/ai/prompts/orchestrator/v1.txt).
- **Personal agent tools** that reason over the signed-in user's own saved
  plans/portfolios with no way to address another user's data —
  [lib/handlers/orchestrator-personal.js](lib/handlers/orchestrator-personal.js).
- **Deep deterministic intelligence core**: customs/duty, CBAM, EUDR, REACH,
  CE, anti-dumping/countervailing, FX, sourcing, routing, warehouse, TCO,
  working capital — all in [lib/intelligence/](lib/intelligence/), all
  migrated to integer-cents money math ([money.js](lib/intelligence/money.js)).
- **2,751 passing tests** (was 562 a few sprints ago) — tests-as-contract
  is real, not aspirational.
- **Live TARIC client**, prompt registry + eval scorer
  ([lib/ai/evals/scorer.js](lib/ai/evals/scorer.js)), cost telemetry,
  circuit breakers, structured logging, GDPR endpoints, SSO/OIDC, Stripe
  scaffolding, audit feed, 658 localised SEO guides (EN/PL/DE).
- **Postgres (Neon) landing via dual-write** — events, actuals, and saved
  portfolios already write to both KV and Postgres ([lib/db/schema.sql](lib/db/schema.sql)).

**Honest gaps (what this plan closes):**
- Retrieval is lexical-only over four corpora; agents can't reason over the
  full regulatory universe or fresh tariff/sanctions data.
- Agents are reactive — they answer when asked; they don't watch or act.
- No semantic memory: each conversation starts cold.
- No document understanding: a user can't upload their invoice and have it
  audited.
- KV is still primary for plans/orgs/sessions; two sources of truth coexist.
- The product is a static site + a wizard — there is no authenticated app.
- Enterprise gates (SOC2, SCIM, RBAC depth, immutable audit, data residency)
  are partial.
- Single function on Hobby caps concurrency, async work, and timeouts.

---

## 4. Operating principles (evolved)

Carry forward from the existing plans, with three additions for the
investment era.

1. **Calculator-grounded, always.** The LLM never invents a number that
   drives a decision. Unchanged, non-negotiable, CI-enforced.
2. **Reproducible by construction.** Every customer-facing figure carries
   its calculator version and data-snapshot id. Numbers are permanent
   artifacts, not transient outputs.
3. **Tests are the contract.** New code ships green. The suite is the spec.
4. **Spend where it compounds.** *(new)* New infra/deps must map to a moat,
   an enterprise gate, or a reproducibility guarantee. Justify in the PR.
5. **Degrade, never disappear.** *(new)* Every upstream (TARIC, Anthropic,
   Stripe, Resend, vector store, freight APIs) has a timeout, a fallback,
   and a documented degraded mode. The platform always answers.
6. **Human-in-the-loop on irreversibility.** *(new)* The more autonomous the
   agents get, the harder this rule holds: nothing irreversible — a filing,
   a booking, a payment instruction — happens without explicit human approval.
7. **Preserve the SEO moat.** 658 ranking guide pages are an asset. The
   re-platform migrates the *app* first and leaves marketing/SEO HTML for
   last, behind a measured plan.

---

## 5. The foundation track (re-platforming) — enables every pillar

This is the prerequisite layer. Most of it ships in Phase 1 because the four
pillars depend on it. We keep the consolidated-router *pattern* internally
where it's clean, but we stop letting the Hobby cap dictate architecture.

### F1 — Compute: Vercel Pro + Fluid Compute
**Why:** The 12-function cap forced the single-dispatcher design; longer
timeouts (300s) and Fluid Compute's instance reuse + graceful shutdown
unlock async agent work, document pipelines, and lower cold-start latency.
**Scope:** Move to Vercel Pro; enable Fluid Compute; split the monolith
router into logical function groups *only where it reduces cold-start or
isolates heavy work* (agents, document generation, screening) — keep cheap
read endpoints consolidated. Raise `maxDuration` per function class.
**Deliverable:** `vercel.ts` config (typed), function-group map, latency
benchmark before/after.

### F2 — Data: Postgres-primary
**Why:** Two sources of truth (KV + Pg) is a transition state, not a
destination. Enterprise queries (audit by org+date, calibration aggregates,
reproducibility lookups) need relational truth.
**Scope:** Finish the dual-write migration started in
[backend-grade-plan.md](backend-grade-plan.md) Track 2 — promote saved
**plans, orgs/seats/tiers** to Postgres-primary; demote KV to cache for those.
Keep KV primary only for genuinely ephemeral state (sessions, magic tokens,
rate-limit counters, TARIC warm cache, circuit state). Add connection
pooling and a read-replica posture for analytics.
**Deliverable:** numbered migrations (`schema-00N-*.sql`), cutover runbook,
dual-read→single-read flip behind a flag, backfill verification tests.

### F3 — Retrieval: hybrid semantic RAG on pgvector
**Why:** The single biggest lever on agent quality. BM25 over four JSON
files can't carry a platform that claims to know EU+UK trade law.
**Scope:** Add `pgvector` to Neon (stays in the Postgres-primary DB — no new
vendor). Build an ingestion pipeline that chunks + embeds the regulatory
corpus: full TARIC nomenclature, EU regulations/implementing acts, UK Global
Tariff, sanctions consolidated lists, official guidance. Hybrid retrieval
(BM25 ∪ vector, reranked). Freshness SLA enforced by a scheduled re-ingest.
Citations remain chunk-id-based — the grounding contract is unchanged, the
recall improves dramatically.
**Deliverable:** `lib/intelligence/retrieval.js` v2 (hybrid), ingestion
workers, embeddings cost budget, recall/precision eval set.

### F4 — Async: durable workflows + queues
**Why:** Proactive monitoring, document pipelines, batch screening, and
multi-agent delegation are long-running and must be crash-safe.
**Scope:** Adopt Vercel Queues / Workflow DevKit for step-based, resumable
agent runs and scheduled fan-out (e.g. "nightly, recompute every saved plan
against today's TARIC and queue an alert if drift ≥5%"). At-least-once
semantics; idempotent handlers.
**Deliverable:** workflow runtime wired, one reference durable workflow
(portfolio drift scan) in production, dead-letter + retry policy.

### F5 — App shell: Next.js App Router
**Why:** A billion-dollar SaaS needs a real authenticated product, not a
static site. Aligns with the already-recorded architecture direction
(migrate app routes first, marketing/SEO last).
**Scope:** Stand up a Next.js App Router app behind auth that hosts the
product surface (Pillar IV). Marketing + 658 SEO guides stay as-is initially,
proxied/rewritten, and migrate last. AI Gateway-ready, Server Components for
data-heavy dashboards.
**Deliverable:** app skeleton deployed, auth bridged to existing magic-link
+ SSO, one real screen (the dashboard) live.

### F6 — Observability at scale
**Why:** Boring-under-pressure (the backend-grade north star) requires
seeing agent runs, costs, and SLOs.
**Scope:** Distributed tracing across the router → agents → tools → upstreams;
agent-run tracing (every tool call, token count, latency, citation coverage);
SLO dashboards + error budgets; extend [lib/ai/cost-telemetry.js](lib/ai/cost-telemetry.js)
into a per-tenant cost ledger.
**Deliverable:** trace view, agent-run inspector, SLO dashboard, cost ledger.

---

## 6. Pillar I — Agent depth & autonomy

The differentiator. This is what makes OrcaTrade an *operations team*, not a
tool. Everything here sits on F3 (RAG), F4 (queues), and F6 (tracing).

### I1 — Model strategy & cost discipline
**Why:** We're on `claude-sonnet-4-6` everywhere; we have no caching at scale
and no tiered routing. A billion-dollar platform leads with the strongest
brain available — the quality of the agents *is* the product, so we don't
under-power them to save pennies.
**Scope:** **Opus 4.7 is the default reasoning model for the agents and
orchestrator** — every customer-facing analysis, draft, and cross-domain
synthesis runs on Opus. Cheaper tiers are reserved strictly for work where
quality is not on the line: Haiku 4.5 for intent triage/classification and
Sonnet 4.7 only for high-volume mechanical steps (e.g. bulk extraction
sub-tasks). The principle is *Opus-first, downgrade only when the output
never reaches the customer's decision.* Route through Vercel AI Gateway for
provider failover + observability. Add **prompt caching** on the large,
stable system prompts + retrieved corpus chunks — this is what makes
Opus-everywhere economically sane (the cache absorbs the bulk of the cost,
so the strong model stays affordable per run).
**Deliverable:** model registry with Opus as the agent default, caching
wired (target high cache-hit rate on system prompt + corpus), measured
COGS-per-run before/after, failover tested.

### I2 — Agent memory & continuity
**Why:** Every conversation starts cold. An ops team remembers your
suppliers, your routes, your risk appetite, last quarter's CBAM filing.
**Scope:** Per-user/org durable agent memory in Postgres (preferences,
ongoing shipments, supplier relationships, prior decisions), recalled as
tools in the loop — extending the proven `orchestrator-personal` pattern.
Memory is scoped, auditable, and user-editable/deletable (GDPR-clean).
**Deliverable:** memory store + tools, "the agent remembered X" eval cases,
privacy controls in the account UI.

### I3 — Proactive monitoring agents *(flagship)*
**Why:** This converts OrcaTrade from "a thing you open" into "a thing that
messages you" — the single feature most likely to drive retention and word
of mouth. We already have the seeds: `getMySavedPlanDrift`, plan-revision
emails, calibration analytics.
**Scope:** A monitoring engine (on F4 queues/cron) that watches, per saved
plan/portfolio: TARIC tariff changes, **new AD/CVD measures**, sanctions-list
updates, FX moves, freight-rate spikes, and regulatory **deadlines** (CBAM
quarterly windows, EUDR application dates). On a material change, it
recomputes the user's actual exposure deterministically and sends a
plain-language, agent-written alert grounded in the recomputed numbers:
*"Your bicycle import from CN is now €11,200/shipment more expensive — a new
anti-dumping measure took effect on …"*
**Deliverable:** monitoring rules engine, alert inbox (Pillar IV) + email,
per-user subscription controls, "alert fired correctly" eval set.

### I4 — Document intelligence (ingest + audit)
**Why:** Big-corp standard is "upload your documents and we check them."
We have `evidence-ingestion.js` as a seed and Claude's document/vision
capability available.
**Scope:** Users upload real trade documents — commercial invoice, packing
list, bill of lading, certificate of origin, supplier contract, test reports,
CBAM data. The pipeline (F4) extracts structured data, validates it against
the compliance rule engine, and flags gaps/risks ("HS code on the invoice
doesn't match the declared category; missing EUDR geolocation data").
**Deliverable:** secure document vault (encrypted at rest, EU residency),
extraction+validation pipeline, gap report, audit trail of every access.

### I5 — Agents that produce the artifact (act, with approval)
**Why:** The value ceiling of "advice" is low; the value of "here's your
drafted CBAM declaration, approve to file" is enormous. `requestHumanReview`
already exists as the safety gate.
**Scope:** Move from advising to drafting: CBAM declaration drafts, EUDR DDS
drafts, customs-entry data pre-fill, supplier RFQ/negotiation emails, LC
application drafts. Every draft is reproducible, cites its inputs, and
**requires explicit human approval before anything leaves the platform.**
No irreversible action without a human click — principle #6.
**Deliverable:** draft-generation tools per domain, approval workflow UI,
immutable record of what was drafted/approved/sent.

### I6 — Multi-agent delegation
**Why:** Real cross-domain questions ("I'm launching a new product line from
Vietnam") touch all four domains; today the orchestrator serialises tools.
**Scope:** A planner that decomposes a complex request, delegates specialist
sub-runs in parallel (on F4), and synthesises — with the same grounding and
citation discipline. Durable, traceable, cost-bounded per run.
**Deliverable:** planner agent, parallel sub-run orchestration, end-to-end
"new product line" golden eval.

### I7 — The eval moat (continuous quality gate)
**Why:** As autonomy grows, quality regressions become customer-trust
incidents. This is the backend-grade Track 6, leveled up.
**Scope:** Expand [lib/ai/evals](lib/ai/evals/) into a continuous harness:
golden datasets per domain, citation-coverage + hallucination scoring,
prompt A/B via the registry, and a **CI gate** — no prompt or model change
ships if eval pass drops below threshold. Track scores over time in Postgres.
**Deliverable:** eval-gate in CI, scored dashboards, regression alerts,
per-domain golden sets ≥50 cases each.

---

## 7. Pillar II — Platform breadth (new service domains)

A full trade-operations corp offers more than landed-cost. Each of these is
a new revenue surface and a new reason to be the system of record.

### II1 — Sanctions & denied-party screening
**Why:** Table-stakes for enterprise trade compliance, and a clean,
high-value, self-contained new domain. Nobody signs an enterprise contract
without it.
**Scope:** Screen suppliers, buyers, vessels, and counterparties against the
EU/UK/OFAC/UN consolidated lists (daily-refreshed). Fuzzy matching, hit
adjudication workflow, full audit trail, batch screening of a portfolio.
**Deliverable:** screening engine + lists ingestion (F4), screening API +
UI, audit, "known hit / known clear" test set.

### II2 — Live tariff & rules-of-origin depth
**Why:** Curated datasets and chapter-level duty under-serve enterprise; the
H0 concern in [dev-plan.md](dev-plan.md) ("an accountant builds duty+VAT in
Excel") is solved by going deeper than Excel can.
**Scope:** Full HS10 TARIC coverage, UK Global Tariff for GB, binding tariff
information (BTI) references, and a **rules-of-origin calculator** for FTAs
(does this product qualify for the VN/preferential rate?). All RAG-grounded.
**Deliverable:** HS10 duty path, RoO calculator, FTA qualification eval cases.

### II3 — Document automation suite
**Why:** Pairs with I4 (ingest) — the corp standard is generate *and* check.
`document-generator.js` is the seed.
**Scope:** Generate compliant commercial invoice, packing list, certificate
of origin, proforma, CBAM report, EUDR DDS — pre-filled from the user's plans
and validated before export. Versioned, reproducible, audit-logged.
**Deliverable:** templated, validated generators per document type, export
to PDF/structured data, version history.

### II4 — Supplier intelligence & verification
**Why:** Sourcing today is country-averages; enterprise needs supplier-level
signal. We have `buyer-verification.js` and `supplier-exemplars.js` seeds.
**Scope:** Verified supplier profiles, factory-audit records, sanctions/risk
overlay (II1), and trade-data-derived signals — moving from "source from VN"
to "this specific supplier, here's the risk profile."
**Deliverable:** supplier profile model, verification workflow, risk overlay.

### II5 — Real-time freight & schedules
**Why:** Routing uses snapshot indices; enterprise procurement needs live
rates + sailing schedules to act.
**Scope:** Integrate live ocean/air rate + schedule feeds (degradable to
snapshot on outage — principle #5). Carrier/forwarder benchmarking.
**Deliverable:** freight rate client with fallback, schedule lookup, rate
benchmark in the routing calculator.

### II6 — Compliance calendar & obligations tracker
**Why:** Recurring obligations (CBAM quarterly reports, EUDR deadlines,
licence renewals) are exactly what an ops team manages — and ties directly
to the monitoring agents (I3).
**Scope:** Per-user/org obligation tracking with deadline reminders, status,
and one-click jump to the relevant draft (I5).
**Deliverable:** calendar model, reminder workflow (F4), app surface (IV).

### II7 — Trade-finance & insurance marketplace *(monetization)*
**Why:** A clear billion-dollar revenue line — connect importers to LC,
financing, and trade-credit-insurance providers via referral/take-rate. We
already model finance + insurance and have a `marketplace/` surface.
**Scope:** Curated provider network, quote-to-intro flow grounded in the
finance/insurance calculators, take-rate accounting. Regulatory care
(introducer, not adviser) baked in.
**Deliverable:** provider network model, intro flow, revenue accounting,
compliance review of the introducer posture.

---

## 8. Pillar III — Enterprise trust & scale

What a big corporation's security, legal, and procurement teams require
before signing. Much is seeded; this hardens it to audit standard.

### III1 — RBAC depth + SCIM
**Why:** Owner/member is not enough for an enterprise org chart.
**Scope:** Roles (owner, admin, analyst, finance, compliance-officer, viewer),
per-resource permissions, approval workflows, and SCIM provisioning on top of
the shipped SSO/OIDC. Enforced-SSO per org.
**Deliverable:** RBAC model + checks in every handler, SCIM endpoint, role
admin UI.

### III2 — Immutable, tamper-evident audit
**Why:** The audit log is a feature for FSA/ICO/DD/customer review. Today
it's a feed; enterprise wants it provably untampered.
**Scope:** Append-only, hash-chained audit (each row hashes the prior),
verifiable export, retention policy enforced in code. Builds on
[lib/handlers/audit.js](lib/handlers/audit.js) + audit-csv-export.
**Deliverable:** hash-chain audit, verification tool, immutability test.

### III3 — Reproducibility & as-of recompute
**Why:** The headline trust promise — "every euro reproducible forever."
**Scope:** Pin a `data_snapshot_id` to every quote (TARIC version, FX
snapshot, calc version). Store enough to recompute any historical result
exactly, and support "recompute this plan as of date X." Extends the
integer-cents correctness work already done.
**Deliverable:** snapshot store, quote provenance record, as-of recompute
endpoint, reproducibility test (same inputs+snapshot → identical output).

### III4 — SOC 2 Type II + ISO 27001 path
**Why:** No enterprise procurement passes without it.
**Scope:** Map existing controls (`docs/security/`, audit, GDPR, circuit
breakers) to SOC 2 criteria; close gaps (formal policies, vendor management,
access reviews, pen-test cadence, incident process); enter a Type II
observation window. ISO 27001 as the follow-on.
**Deliverable:** control matrix, policy set, evidence collection, auditor
engaged, trust center page.

### III5 — Reliability & SLA
**Why:** 99.9% uptime is a contractual line item at enterprise scale.
**Scope:** Formal SLOs + error budgets (F6), multi-region posture, paging,
incident runbooks, status-page maturity (we have `/status/`), chaos drills
on every degraded mode (principle #5).
**Deliverable:** SLA doc, error-budget policy, on-call runbooks, degraded-
mode drill results.

### III6 — Data residency & privacy maturity
**Why:** EU customers require EU data residency + a DPA; we already ship
GDPR export/delete.
**Scope:** Pin Neon + document storage to EU regions, publish sub-processor
list + DPA + retention schedule, enforce retention in code, expand the
privacy controls in the account area.
**Deliverable:** residency config, DPA + sub-processor list, retention jobs,
privacy center.

---

## 9. Pillar IV — Product surface & GTM

The visible product. Built on F5 (Next.js app shell). The marketing/SEO moat
is preserved and migrated last.

### IV1 — Authenticated app shell (the product)
**Why:** Today there is no app — only a static site and a wizard. This is
where every other pillar becomes visible.
**Scope:** Dashboard (shipments in flight, exposure heatmap, savings
captured), agent chat (orchestrator + memory), saved plans/portfolios,
**alerts inbox** (I3), **document vault** (I4), **compliance calendar** (II6),
team management (III1). Server Components for data density.
**Deliverable:** app shell GA with the screens above, bridged to existing
auth.

### IV2 — Onboarding & activation
**Why:** Powerful platforms die at first-run. We have `onboarding.js` +
welcome flows to build on.
**Scope:** Guided first-run ("import your first shipment / connect your
data"), aha-moment instrumentation, role-aware setup.
**Deliverable:** onboarding flow, activation funnel metrics.

### IV3 — Pricing & packaging for the new value
**Why:** Tiers (free/starter/growth/scale/enterprise) + Stripe are scaffolded
but predate agents/monitoring/screening.
**Scope:** Re-package around the new flagship value — gate monitoring,
document intelligence, screening, and seats by tier; usage-based metering for
AI; an enterprise sales motion (quote, MSA, security pack).
**Deliverable:** packaging matrix, metering, enterprise quote flow.

### IV4 — Operational dashboards & data viz
**Why:** An ops team lives in a dashboard, not a chat box.
**Scope:** Exposure heatmaps, savings-captured ledger, alert timeline,
portfolio-level scenario views — all grounded in deterministic calculators.
**Deliverable:** dashboard component library, key operational views.

### IV5 — Marketing site evolution (preserve the moat)
**Why:** 658 ranking guides are an acquisition asset; the homepage must now
sell a platform vision and enterprise credibility, not a calculator.
**Scope:** Elevate homepage/product pages (logos, case studies, ROI proof,
trust center link), keep the wizard as the top-of-funnel lead magnet, migrate
SEO HTML into the new stack **last**, behind a no-ranking-loss plan.
**Deliverable:** refreshed product marketing, trust center, preserved SEO
metrics through migration.

---

## 10. Phasing — what runs when

Sequenced by dependency, not wishlist. Foundation first because the pillars
sit on it; the flagship monitoring agent ships early because it's the
clearest billion-dollar signal.

### Phase 1 — Foundation + flagship (≈ Q3 2026)
**Theme: "Re-platform, and make the agents watch."**
- **Foundation:** F1 (Pro/Fluid), F2 (Postgres-primary cutover), F3 (pgvector
  hybrid RAG), F4 (queues), F5 (app skeleton + dashboard), F6 (tracing).
- **Pillar I:** I1 (model strategy + caching), **I3 (proactive monitoring —
  the flagship)**, I7 (eval-gate in CI).
- **Pillar II:** II1 (sanctions screening v1 — high value, self-contained).
- **Gate to Phase 2:** Postgres is primary; RAG live with measured recall
  lift; monitoring alerts firing in production; eval-gate blocking CI.

### Phase 2 — Depth + trust (≈ Q4 2026)
**Theme: "Ingest, act, and pass procurement."**
- **Pillar I:** I2 (memory), I4 (document intelligence), I5 (agents that
  draft), I6 (multi-agent delegation).
- **Pillar II:** II2 (HS10 + RoO), II3 (document automation), II6 (compliance
  calendar).
- **Pillar III:** III1 (RBAC + SCIM), III2 (immutable audit), III4 (SOC 2
  kickoff), III6 (data residency).
- **Pillar IV:** IV1 (app shell GA), IV2 (onboarding).
- **Gate to Phase 3:** document upload→audit live; first drafted filing
  approved by a human; SOC 2 observation window open; app shell GA.

### Phase 3 — Scale + moat + monetization (≈ Q1 2027)
**Theme: "Reproducible, sellable, and a marketplace."**
- **Pillar II:** II4 (supplier intelligence), II5 (real-time freight),
  II7 (finance/insurance marketplace).
- **Pillar III:** III3 (reproducibility + as-of recompute), III5 (SLA +
  multi-region), III4 (SOC 2 Type II completion).
- **Pillar IV:** IV3 (pricing/packaging GA), IV4 (dashboards), IV5 (marketing
  + SEO migration).
- **Gate:** SOC 2 Type II achieved; SLA contractually offerable; marketplace
  generating take-rate; reproducibility provable.

### Phase δ — always-on
Eval moat upkeep (I7), corpus freshness (F3 re-ingest), content/SEO date
rotation (existing workflow), cost discipline (I1), security drills (III5).

---

## 11. Cost envelope (the investment, eyes open)

Since we're investing, we name the spend and hold it to gross-margin
discipline. Rough monthly ranges at early-scale (low-thousands of active orgs):

| Line | Driver | Indicative range |
|---|---|---|
| Vercel Pro + Fluid + functions | Compute, bandwidth, queues | low–mid hundreds €/mo, scaling with traffic |
| Neon Postgres (scale tier) + pgvector | Primary DB, embeddings storage, read replica | mid hundreds €/mo |
| Anthropic API | Agent runs — **dominated by caching efficiency (I1)** | the swing factor; target <15% of revenue |
| Embeddings (ingest + query) | Corpus size + refresh cadence | low hundreds €/mo |
| Document storage (encrypted, EU) | Vault size | usage-based, low |
| Resend / Stripe / monitoring / freight & sanctions data | Per-service | per-vendor, mostly usage-based |
| SOC 2 audit + pen test | Annual | one-off + annual, budget separately |

**Discipline:** AI COGS per agent run is tracked per-tenant (F6 cost ledger);
prompt caching + tiered routing (I1) are not optimisations, they're the
margin. Target blended gross margin >80% at scale. Any feature whose AI cost
can't be capped doesn't ship without a metering/gate plan.

---

## 12. Risks & what we deliberately do NOT do

**Risks to manage:**
- **AI cost runaway** — mitigated by I1 caching/tiering + F6 per-tenant ledger
  + tier gating.
- **SEO regression during F5/IV5 migration** — migrate app first, SEO last,
  with rank monitoring; hard rollback plan.
- **Dual-source-of-truth window (F2)** — time-boxed, flag-gated cutover with
  backfill verification; don't let it linger.
- **Regulatory liability as autonomy grows** — principle #6 (human-in-loop on
  irreversibility) + "introducer not adviser" posture on II7 + curator
  disclaimers retained.
- **Over-building ahead of demand** — every pillar item still earns its
  sprint; "match scope to evidence" survives from the dev-plan.

**Deliberately out of scope (for now):**
- Becoming a freight forwarder / customs broker of record (we orchestrate
  and draft; we don't take the regulated principal role).
- A consumer product — OrcaTrade is B2B.
- Geographies beyond EU+UK trade lanes until the core is enterprise-proven.
- Replacing the deterministic calculators with ML/LLM numerics — the
  grounding contract is permanent.

---

## 13. Definition of done — "billion-dollar grade"

We are there (for the platform, not the valuation) when, simultaneously:

1. A new enterprise customer can complete a security review from our **trust
   center** without a custom questionnaire, because SOC 2 Type II + DPA +
   sub-processor list + audit export are published.
2. Any customer-facing number from 18 months ago **recomputes identically**
   from its stored snapshot.
3. The platform **proactively alerted** a real customer to a real cost change
   on their own shipment before they noticed — and the alert's numbers were
   reproducible.
4. A customer **uploaded a document, the agent audited it, drafted the
   filing, and a human approved it** — end to end, audit-logged.
5. **99.9% uptime** held for two consecutive quarters with every upstream
   degrading gracefully.
6. The **eval-gate** has blocked at least one regression from reaching
   production.
7. AI COGS sits **<15% of revenue** at the margin with blended gross margin
   **>80%**.

---

## 14. How future-me should use this document

- This is the **apex plan**. When the user says "let's make OrcaTrade
  billion-dollar grade" or "what's the big picture," start here.
- For "continue the development" with no specifics, the **dev-plan.md** rule
  still applies (topmost open product sprint) **unless** we're explicitly in
  a foundation/pillar push — then pick the topmost open item in the current
  Phase here and confirm in 1–2 sentences.
- Keep the three plans coherent: when a pillar item here becomes a concrete
  sprint, log it in dev-plan.md or backend-grade-plan.md and reference back.
- Update the log below each time a Foundation/Pillar item ships or a Phase
  gate is crossed.

---

## 15. Update log

- **2026-05-22** — Document created. Posture decision: *invest now (break the
  pure-JS/zero-dep/Hobby constraints)*. All four pillars in scope. Phase 1
  spearhead = re-platform foundation + proactive monitoring agent (flagship)
  + sanctions screening v1. Grounded against current state: 5 calculator-
  grounded agents + orchestrator, 2,751 green tests, integer-cents money core,
  KV→Postgres dual-write in flight, BM25 retrieval to be upgraded to hybrid
  pgvector RAG.
- **2026-05-22** — Shipped (Pillar I, I1): **opus-first-v1**. Agent layer +
  main customer-facing AI (compliance/logistics/sourcing/finance agents,
  orchestrator, check/analysis/chat) migrated to `claude-opus-4-7`; prompt
  caching on the stable tools+system prefix; central `lib/ai/models.js`
  registry. Suite 2,751→2,751.
- **2026-05-22** — Shipped (Pillar II, II6): **compliance obligations
  tracker**, complete across every surface. `lib/intelligence/compliance-calendar.js`
  engine (calculator-grounded, reuses CBAM/EUDR timelines) →
  `getComplianceCalendar` agent tool → proactive weekly cron deadline
  reminders (EN/PL/DE, opt-out via prefs + one-click `&stream=`) →
  `getMyComplianceDeadlines` orchestrator-personal tool (aggregates across all
  the user's saved plans). REACH/CE deadlines noted out-of-scope (no dated
  statutory deadlines). Suite →2,803.
- **2026-05-22** — Shipped (Pillar II, II1): **sanctions-screen-v1**.
  Deterministic denied-party name-matching engine
  (`lib/intelligence/sanctions-screening.js`), safe-by-design (never returns
  "clear"), injectable list, `screenCounterparty` agent tool. Ships an
  illustrative SYNTHETIC sample; real EU/UK/OFAC/UN consolidated-list
  ingestion is the follow-up (needs a list/data-source decision). Suite →2,818.
- **2026-05-25** — Shipped + ACTIVATED (Pillar II, II1): **UN consolidated
  list as the 4th screening source**. Defensive no-dep `parseUnXml`
  (`<INDIVIDUAL>`/`<ENTITY>` blocks → joined FIRST..FOURTH_NAME, `<ALIAS_NAME>`
  aliases, DATAID id, UN_LIST_TYPE programme; XML-entity decode; nameless
  blocks skipped). Wired `format==='un'` into `ingestSanctions`; UN added to
  `defaultSanctionsSources()` (`SANCTIONS_UN_URL`, default
  scsanctions.un.org/resources/xml/en/consolidated.xml). **LIVE**: refresh
  imported **1,002** UN entries → total **39,813** across OFAC-SDN (19,050) +
  UK-OFSI (19,761) + UN; `/api/health` sanctions authoritative, benign live
  screen returns `no_match` against the loaded CONSOLIDATED list. Completes the
  OFAC/OFSI/UN coverage the screen advisory already names (EU still needs a
  token/endpoint). Suite →2,901.
- **2026-05-25** — Shipped (Pillar I3, **the flagship**): **proactive
  monitoring agent**. Calculator-grounded, LLM-free rules engine
  (`lib/intelligence/monitoring.js`): plan/portfolio cost-drift (tariff/freight
  moves via plan-diff), FX exposure (fx-quote), CBAM/EUDR deadlines, and
  sanctions-list deltas. Feeds a durable alert inbox (`lib/alert-store.js`, KV
  primary + Postgres dual-write, dedupe by (user,signal); schema-004) surfaced
  at **GET/POST /api/account/alerts** + the **/account/alerts/** UI (mark-read /
  dismiss). New **`monitoring-scan`** cron (Thu 09:00) upserts alerts + sends a
  weekly digest gated on the new `monitoringAlerts` pref (one-click unsub).
  Recompute is dependency-injected so the engine never imports a handler.
- **2026-05-25** — Shipped (Pillar I2): **agent memory & continuity**.
  `lib/agent-memory.js` (KV primary + Postgres dual-write, schema-005, per-user
  caps + email_hash-only in PG) + four personal-orchestrator tools
  (`recallMemory` / `rememberForUser` / `forgetForUser`, merged per authed
  request). The agent can now carry a user's stated preferences/facts across
  sessions. GDPR: alerts + memory wired into account export + Article-17 delete.
- **2026-05-25** — Shipped (Pillar I7): **eval moat expansion + CI gate**. New
  `lib/ai/evals/compliance/cases.v1.json` (CBAM/EUDR/sanctions/calendar) + new
  orchestrator (screening, personal plans, memory), finance (FX hedge) and
  logistics (routing) cases — 18→27 offline cases. Offline coverage gate in
  `test/ai-evals.test.js` (≥2 cases/agent, floor on total, new surfaces stay
  covered, every case self-documents) runs free on every push; new nightly
  **`ai-evals.yml`** runs the live harness per-agent against the API.
  Suite 2,901 → **2,949**, all green.
- **Next, blocked on a decision:** the three unblocked agent-pillar items (I3
  flagship, I2 memory, I7 evals) are now DONE. Remaining Phase-1 items need
  decisions/infra/spend: **EU** consolidated sanctions endpoint (token/format),
  real-time freight feeds (paid), SOC 2 (process), the Next.js app shell,
  tier-gating/packaging (business call). Risk-bearing, needs greenlight:
  write-time hash-chain audit storage, reproducibility/as-of vs the
  calculator-regression snapshots.
