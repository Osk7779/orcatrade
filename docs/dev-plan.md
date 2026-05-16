# OrcaTrade — Continued Development Plan

**Author:** Claude (working with Oskar Klepuszewski)
**Last updated:** 2026-05-13 (Sprint D — TARIC live integration complete)
**Status:** Living document — update each sprint completion.

---

## North star

OrcaTrade is the **import operations team available 24/7** for European
SMEs sourcing from Asia. Five domains (search, sourcing, intelligence,
logistics, finance), one platform, calculator-grounded recommendations
the user can trust.

The platform should always be **further ahead than the business needs it
to be** — but not by so much that we waste sprints on features no real
customer has asked for.

## Operating principles

1. **Ship per sprint.** Every sprint ends with a `git push` and Vercel
   auto-deploy. No long-lived branches.
2. **Tests are the contract.** New code ships with tests; suite stays green.
   Current baseline: 562/562.
3. **Calculator-grounded.** Never expose to the user a number that didn't
   come out of `lib/intelligence/*-quote.js` or a documented data source.
4. **Pure-JS, zero npm.** Stay deployable on Vercel Hobby. Single
   `api/[...path].js` dispatcher; no build pipeline; no React.
5. **Match scope to evidence.** Don't add features for hypothetical users.
   When in doubt, build the smallest thing that lets a real founder feel
   the difference and stop there.
6. **Picking next moves.** When the user says "continue the development"
   without specifics: check this plan, pick the topmost open sprint,
   confirm in 1–2 sentences, then execute.

## What's done (cumulative state at Sprint 33)

| Sprint | Outcome |
|---|---|
| ≤22 | Pre-context-summary baseline: site, agents, calculators |
| 23–28 | Programmatic SEO sprint — 351 guide pages in EN/PL/DE |
| 29–30 | Polish + German full localisation of routing/customs/warehouse guides |
| 31 | Import Plan Builder at `/start/` — 6-step wizard, 4-calculator orchestration |
| 32 | Shareable plan permalinks (`?p=<base64>`) + homepage hero promotes wizard |
| 33 | Localised wizard: `/pl/start/` and `/de/start/` + locale-aware emails |

**Live surfaces:** homepage, platform overview, 351 SEO guide pages,
3-locale wizard, 5 AI agents, contact form, dashboards, free analysis.

## Open frontier — ranked by leverage

### Horizon 0 — Intelligence depth (current focus)

**Why this is now the priority:** the platform looks smart on the
surface but has thin internals. Customs = duty + VAT + brokerage; an
accountant builds that in Excel. Sourcing = country averages; an
importer needs supplier-level signals. Without depth, paywalling the
product (H3) is charging Pro fees for what a free Excel template
replicates.

H0 sprints are pure code/data — no auth, no KV, no infra. They could
ship next week and double the perceived intelligence of every plan.

#### Sprint A — EU trade defence: anti-dumping + countervailing duties

**Why now:** Currently we compute MFN duty and stop. A user importing
bicycles ex-CN sees 14% MFN — the actual landed duty is 62.5% (14% MFN
+ 48.5% ADD). We're under-quoting by 5-figures on the most common
high-volume importable goods.

**Scope:**
- `lib/intelligence/data/eu-trade-defence.js` — curated dataset of ~50
  active EU AD/CVD measures by HS chapter + origin. Fields: HS prefix,
  origin, type (AD/CVD), rate range, regulation citation, notes.
- Customs calculator looks up applicable measures, adds to duty line.
- Result UI surfaces measure as a separate cost component.
- Email summary includes the warning.
- Tests for known cases: bicycles CN (AD 48.5%), e-bikes CN (AD+CVD),
  aluminum extrusions CN, ceramic tiles CN, fiberglass fabric CN.

**Deliverables:** dataset file, calculator extension, UI, 10+ tests.
Disclaimer surfaced: "Curator data, not legally authoritative — verify
on TARIC before commercial decisions."

**Estimate:** 1 session.

---

#### Sprint B — Preferential origin pathways

**Why now:** Bangladesh apparel ships at *zero duty* with valid EUR.1
under EBA. Vietnam under EU-Vietnam FTA. Türkiye under the Customs
Union with ATR. We currently apply flat MFN. A user with an LDC
supplier sees 12% duty when they should see 0%.

**Scope:**
- Origin-pathway data: which (origin × HS chapter) pairs unlock which
  preferential regime (GSP+, EBA, EU-VN FTA, EU-KR FTA, ATR, REX).
- Wizard already asks `claimPreferential` boolean → extend to ask
  *which regime* if user says yes, OR auto-detect best regime.
- Customs calc applies preferential rate (often 0%) when valid claim.
- Result explains what document the user needs (EUR.1 / Form A / REX
  registration) to actually claim it.

**Estimate:** 1 session.

---

#### Sprint C — Compliance overlay in the plan

**Why now:** CBAM/EUDR/REACH/CE pages exist as standalone UI; the
import-plan generator never surfaces them. A user importing aluminum
windows from VN should see "CBAM applies — quarterly reporting from
your importer-of-record." They don't.

**Scope:**
- HS-chapter → applicable regimes mapping (CBAM: chapters 25, 27, 28, 31,
  72-76; EUDR: 09, 18, 40, 44, 47-49; REACH: substantively all chemicals;
  CE: most electronics, machinery, toys, PPE).
- Result section in wizard: "Compliance check" with applicable regimes,
  next steps, and links to OrcaTrade's deeper guides.
- Email body includes the same.

**Estimate:** 1 session.

---

#### Sprint D — Live TARIC integration (shipped 2026-05-13)

**Status:** Done. See the update log entry for the full ship summary.
The key design decision worth remembering: EU TARIC does NOT have a
clean public REST API. We use the UK Trade Tariff API as a free
sub-chapter sanity-check source (disclosed in every result), with KV
caching at 7-day fresh / 30-day stale, and a hard env-var kill-switch
for tests + CI. The architecture is pluggable — `fetchUpstreamRate` is
the one place to swap in a paid EU-direct provider or a bulk-XML
ingestion pipeline if the UK divergence becomes a real customer
complaint.

---

### Horizon 1 — Conversion-side polish (after H0)

#### Sprint 34 — Localised AI agents

**Why now:** Wizards are now PL/DE but the orchestrator/sourcing/logistics
agents only respond in English. A Polish founder who hits "Pogłęb plan"
gets an English reply — broken UX.

**Scope:**
- Read locale from `?lang=` query string OR Accept-Language fallback
- Inject locale into the agent's system prompt: "Reply in Polish unless
  the user writes to you in another language."
- Localise the agent landing page chrome (`/agent/orchestrator/`,
  `/agent/sourcing/`, `/agent/logistics/`, `/agent/finance/`, `/agent/`)
- Translate the seed-prompt suggestions visible on the agent page
- Frontend localStorage key already includes locale — don't bleed
  Polish history into the English experience

**Deliverables:**
- `/pl/agent/orchestrator/`, `/de/agent/orchestrator/` (and 4 more × 2)
- `lib/agents/i18n.js` parallel to `lib/start-i18n.js`
- 10–15 new tests covering locale routing in agent handlers
- Cross-link wizard CTAs to locale-correct agent pages

**Estimate:** 1 long session.

---

#### Sprint 35 — Plan-revision diff + email follow-ups (deferred)

**Why deferred:** Premature without recurring users (H2). Permalinks
already exist; "what changed since you built this" is a *retention*
feature, but we don't have repeat visitors to retain yet. Park until
post-H2 when we have signed-in users and saved plans with history.

**Original scope preserved for later:**
- Permalinks already let users return to a plan. But pricing
shifts (duty rates change quarterly, freight rates monthly). When a user
revisits, they should see *what changed since they built it* — turning
the permalink into a recurring-engagement mechanism.

**Scope:**
- Encode plan generation date inside the share URL alongside inputs
- On permalink load, recompute and diff the new totals vs. the snapshot
  embedded in the URL → render a "What's changed" callout if delta > 5%
- Resend email at T+30 days: "Your plan from <date> — pricing has
  shifted by €X. Open updated plan."
- Cron-style: not actually a cron (Vercel Hobby has no scheduled fns);
  use Resend's scheduled-send if available, OR ship as a manual founder
  tool the user can trigger weekly

**Deliverables:**
- Plan codec extended to embed `generatedAt` + landed-cost snapshot
- New "What changed" UI block in the result renderer
- New backend handler `/api/plan/refresh` that produces a re-engagement
  email body for a given share URL

**Estimate:** 1 session. Defer the cron piece if Vercel constraints bite.

---

#### Sprint 36 — Conversion analytics dashboard (deferred)

**Why deferred:** Need KV (Sprint 37) to store events durably across
function instances. Build alongside H2 once persistent storage exists.

**Why later:** Every plan submission already logs a structured
`import_plan_generated` JSON event. Vercel captures stdout — it's just
not surfaced. Without visibility, we can't tell which categories
convert, which origin/destination pairs perform, or where users drop off.

**Scope:**
- Append-only file store of structured events (Vercel /tmp is
  per-instance — won't work; better: write to GitHub Gist via API,
  or use Vercel KV when we add it in Sprint 37)
- Simplest viable: ship a `/dashboard/leads/` page that fetches recent
  events and renders summary tiles (count by locale, by category, by
  destination, top routes, mean landed total)
- Auth-gate via a single `?token=<secret>` query param read from env

**Deliverables:**
- `lib/handlers/leads-summary.js` reading from event store
- `dashboard/leads/index.html` with charts (no chart library — pure CSS
  bars and number stats)
- 5 tests covering aggregation correctness

**Estimate:** 1 session, pending Sprint 37 if we want persistent storage.

### Horizon 2 — Foundational retention layer (next 4-6 sprints after H1)

These unlock everything beyond the current stateless conversion model.
Required for: paying customers, returning users, team accounts,
saved plans, billing.

#### Sprint 37 — Vercel KV persistence

**Why:** Everything currently stateless. To save plans, attach them to
users, build a dashboard with history, or send delayed follow-ups, we
need real storage. Vercel KV (Upstash Redis) is the path of least
resistance — pure REST API, free tier sufficient for early traction.

**Scope:**
- Provision Vercel KV (manual, requires user on Vercel dashboard)
- New `lib/intelligence/kv-store.js` wrapping the REST API
- Migrate `runtime-store.js` rate-limit + cache from in-memory to KV
- Persist `import_plan_generated` events to KV with 90-day TTL
- Plan-by-ID storage so share URLs can be short canonical IDs
  (`/start/p/<8-char-id>`) instead of base64 inputs

**Caveat:** Keep base64 share URLs working as a fallback — they're
zero-storage and serve as backup if KV is misconfigured.

**Estimate:** 1–2 sessions.

---

#### Sprint 38 — Magic-link auth (no passwords)

**Why:** Returning users + saved-plan history requires identity. Magic
links via Resend = simplest possible onboarding, no password-reset hell.

**Scope:**
- `/api/auth/request` — accept email, generate signed token, email link
- `/api/auth/verify` — verify token, set httpOnly cookie
- `lib/auth.js` — request-context user resolution from cookie
- Session = signed JWT, no server session store
- `/account/` page showing identity + sign-out
- Existing wizard pre-fills email from cookie if logged in

**Estimate:** 2 sessions.

---

#### Sprint 39 — Saved plans + history

**Why:** With auth + KV in place, plans can persist per-user.

**Scope:**
- On wizard submit, if logged in → save plan to user
- `/account/plans/` lists user's plans with stats summary
- "Open in wizard" button reloads the plan into the wizard for editing
- Sharing a plan with a colleague creates a permission grant (read)
- Comments thread per plan? (Defer until customer asks.)

**Estimate:** 1–2 sessions.

### Horizon 3 — Pricing + payments (after H2)

#### Sprint 40 — Pricing page + tier definition

**Why:** Without a published price, every conversation is "what does
it cost." Lock down the offer.

**Scope:**
- Decide tiers WITH user (not for them) — current best guess:
  - Free: 1 plan/month, public guides, 1 agent query/day
  - Pro (€49/mo): unlimited plans, all agents, history, sharing
  - Team (€199/mo): 5 seats, shared plans, priority support
  - Enterprise: custom — contact us
- `/pricing/` page (already exists in nav — currently a stub)
- Feature flags table in `lib/auth.js` keyed off subscription tier

**Estimate:** 1 session of design conversation + 1 session of build.

---

#### Sprint 41 — Stripe integration

**Why:** Move the conversation from "this is great" to "here's my card."

**Scope:**
- Stripe Checkout for subscriptions (hosted, no PCI)
- Webhook handler in `lib/handlers/stripe-webhook.js`
- Sub → user.tier in KV
- `/account/billing/` linking to Stripe customer portal

**Estimate:** 1–2 sessions, hard part is webhook idempotency.

---

#### Sprint 42 — Tier gating

**Why:** Free → Pro friction must exist or no-one upgrades.

**Scope:**
- Wire feature flags through the API handlers
  (rate-limit free tier harder, gate orchestrator behind Pro)
- "Upgrade to Pro" upsell at gate points

**Estimate:** 1 session.

### Horizon 4 — Tier 2 (Marketplace) — only if validated

This was scoped early but defer until we have ≥10 paying customers
asking for it. Building a marketplace before having sustained traffic
is a graveyard pattern.

When we get there:
- Vetted supplier directory (start: ~50 suppliers, manual vetting)
- Quote-request workflow with anonymised buyer profile
- Trade-finance partner referral (we don't underwrite — Tradeshift,
  Stenn, FreshFi referrals)
- Insurance partner referral (we don't underwrite — Cargo + trade-credit)
- Take rate or fixed referral fee — model undecided

### Horizon 5 — Always-on: GTM enablement tools

Code OrcaTrade can ship that helps the founder do GTM faster.
Don't treat as a sprint sequence — interleave with H1-H4 when the
specific need arises.

| Tool | When to build |
|---|---|
| Outbound email composer in agent UI | When founder is sending >10 cold emails/week |
| Lead enrichment from LinkedIn URL | When >50 inbound leads/month |
| Demo recorder / screen-share replay | When closing >2 demos/week |
| LinkedIn post drafter (uses brand voice from `docs/brand-kit/`) | If founder wants to post weekly |
| Press kit page (`/press/`) | When PR opportunities arrive |
| Partner page (`/partners/`) | When ≥3 partners signed |

### Horizon 6 — Things to NOT build

Items the user (or a future me) might be tempted to build that should
be explicitly resisted:

- **Mobile app.** Browser-first SaaS; nothing here demands native.
- **Multi-tenant white-label.** Premature; no customer asking.
- **Custom CRM.** Use HubSpot free / Pipedrive when needed.
- **Custom analytics.** Plausible / PostHog handle this; don't reinvent.
- **AI-generated supplier matching at scale.** We have a curated 5-country
  comparison; do not pivot to "any supplier on Alibaba" — destroys our
  moat (calibrated trust over breadth).
- **Crypto / blockchain payments.** Out of scope.
- **More languages beyond EN/PL/DE.** Until we have customers in another
  market driving demand, three is enough.

## Capacity reality check

A "session" in this plan is one continuous Claude Code conversation,
typically 1–2 hours of focused execution.

- Horizon 1 (3 sprints) = ~3 sessions = ~1 week of intermittent work
- Horizon 2 (3 sprints) = ~5 sessions = ~2 weeks
- Horizon 3 (3 sprints) = ~4 sessions = ~1.5 weeks

Total to fully-featured, paid-tier product: ~12 sessions = ~5 weeks of
work spread across however long the founder takes.

## How future-me should use this document

When user says "continue the development" or similar without specifics:

1. **Read this file.** Read `MEMORY.md` and `git log --oneline -10`.
2. **Check git status** for uncommitted work — finish that first.
3. **Pick the topmost open sprint** in the highest-priority horizon that
   isn't blocked.
4. **Confirm in 1–2 sentences** with the user: "Picking up Sprint 34 —
   localised AI agents. About 1 session of work, ends with a deploy.
   Sound good?"
5. **Execute.** Follow the sprint's scope + deliverables. Tests, commit,
   push. Update this file with a new row in the Done table.
6. **Update the open-sprint section** if scope shifted during execution
   (don't pretend a sprint was as scoped if it wasn't — write what
   actually shipped).

If the user pushes back on the topmost sprint ("no, I'd rather work on
X"), defer to them — but log a note here so future-me knows the user
prefers a different ordering than I would naively pick.

## Things this plan deliberately leaves out

- **Feature wishlist from old conversations.** I'd rather under-promise
  here and over-deliver in execution than ship a 100-item backlog that
  ages badly. If a feature came up in a past sprint and isn't here, it
  was deprioritised on purpose.
- **Marketing strategy.** The 7-employee marketing manual in
  `docs/marketing-ops.md` covers that. This plan is for code.
- **Hiring / team.** Out of scope for me to plan.
- **Fundraising milestones.** Out of scope.

## Update log

| Date | Sprint completed | Notes |
|---|---|---|
| 2026-05-08 | 33 — Localised wizard | EN/PL/DE end-to-end. 562/562 tests. |
| 2026-05-08 | H0 Sprint A — Trade defence DB | 30+ AD/CVD measures wired into customs calc. Bicycles ex-CN: 10% → 58.5% duty. 581/581 tests. |
| 2026-05-08 | H0 Sprint B — Preferential origin | EBA/GSP/FTAs/ATR proper regime DB. BD apparel: 0% with REX. AD stacks on top of preferential (TR steel). 605/605 tests. |
| 2026-05-08 | H0 Sprint C — Compliance overlay | 12 regimes (CBAM/EUDR/REACH/CE/RoHS/WEEE/Battery/Toys/Cosmetics/PPWR/GPSR/Footwear). Severity-sorted in plan output. 634/634 tests. |
| 2026-05-08 | Sprint 34 — Localised AI agents | 5 agents × 3 locales. EN/PL/DE landing pages, locale directive injected into system prompts, wizard CTAs route locale-correct. 648/648 tests. |
| 2026-05-08 | Sprint G — Origin sensitivity matrix | Re-runs customs+freight for CN/VN/IN/BD/TR + user origin. Surfaces cheapest alternative + €/% saving. Annual estimate when monthly volume given. 660/660 tests. |
| 2026-05-08 | Sprint I — Currency / FX risk overlay | 13-currency snapshot table, fx-quote calculator with vol-90d + hedge cost + recommendation logic. Wizard step 4 has currency + payment-terms fields. 681/681 tests. |
| 2026-05-08 | Sprint M — Trade defence SEO pages | 1 page per AD/CVD measure × 3 locales = 96 new pages. Each cites EU regulation, includes worked landed-cost example, CTAs into wizard with HS pre-filled. Total guides: 351 → 447. 699/699 tests. |
| 2026-05-08 | Sprint N — Preferential origin SEO pages | 7 regime guides (EBA/GSP+/GSP/EVFTA/EUKFTA/EUJEPA/ATR) + 7 country pivots × 3 locales = 45 new pages. Total guides: 447 → 492. 719/719 tests. |
| 2026-05-08 | Sprint O — Compliance overlay SEO pages | 13 regimes (CBAM/EUDR/REACH/CE×2/RoHS/WEEE/Battery/Toy/Cosmetics/GPSR/PPWR/Footwear) × 3 locales = 42 new pages. Total guides: 492 → 534. Completes the H0→SEO trilogy. 737/737 tests. |
| 2026-05-08 | Sprint H — Annual TCO calculator | Procurement-grade view: annual scaling, inventory carrying cost (avg inventory × WACC × days/365), 3PL roll-up, bonded deferral hint, sensitivity at 6/12/24/52 shipments/year. New wizard fields shipmentsPerYear / waccPct / daysInInventory in step 5. 757/757 tests. |
| 2026-05-08 | Sprint Q — Working capital cycle | CCC = DIO + DSO − DPO. Reuses paymentTermsDays as DPO + daysInInventory as DIO from prior sprints; adds daysReceivable. Surfaces working capital tied up + annual capital cost + verdict (tight/standard/capital-intensive/severe/supplier-funded) + 3 levers (DPO+30, DIO−20, DSO−15) with €/year savings each. 775/775 tests. |
| 2026-05-08 | Sprint P — H0 cross-linking on legacy guides | findRelatedH0 helper + pageShell linkContext parameter wired into all 12 sourcing/routing/customs/warehouse generators × 3 locales. Each of the 351 legacy guides now surfaces 2-5 contextual links into trade-defence / preferential / compliance H0 pages (or index fallback). 796/796 tests. |
| 2026-05-08 | Sprint S — Wizard PDF export | @media print CSS rules (A4, light theme, hide chrome, page breaks, URLs after links). Print-only header with brand/route summary/date. "Save as PDF" + "Print" buttons calling window.print(). i18n EN/PL/DE. 811/811 tests. |
| 2026-05-08 | Sprint Y — Worked example gallery | 8 curated import scenarios (CN apparel, BD-EBA, VN-EVFTA, CN e-bikes 87% AD+CVD, CN aluminium+CBAM, TR steel A.TR+AD, IN cosmetics, KR machinery EUKFTA) × 3 locales = 27 pages. Each runs composePlan, surfaces real numbers, links to wizard with permalink. Total guides: 534 → 561. 828/828 tests. |
| 2026-05-08 | Sprint AA — Homepage examples feature | New "Worked examples" section between hero and mission on EN/PL/DE homepages. 3 featured cards (e-bike 87% AD+CVD, BD EBA, TR A.TR+AD) + "See all 8 examples" link. PL/DE homepages also gained a primary `/start/` CTA replacing the old `#group` anchor. 846/846 tests. |
| 2026-05-08 | Sprint R — Sitemap hreflang | xhtml:link rel="alternate" hreflang=en/pl/de/x-default emitted in sitemap.xml + sitemap-guides.xml for all 210+ H0 + example URLs. Sub-generators now expose hreflangAlternates on return; sitemap builder consumes it. 840 xhtml:link entries total. 857/857 tests. |
| 2026-05-08 | Sprint AD — Legacy generator hreflang pass-through | All 12 legacy sourcing/routing/customs/warehouse generators (×3 locales) now expose hreflangAlternates on return — sitemap entries gained locale-specific slug alternates (e.g. apparel-from-cn ↔ apparel-z-cn ↔ apparel-cn). Total xhtml:link entries: 840 → 2,114. 862/862 tests. |
| 2026-05-08 | Sprint AC — Wizard origin-comparison mode | Each non-user row in the origin-sensitivity matrix gets a "Compare" button. Clicking renders an inline side-by-side panel: duty %, transport, landed cost, annual cost, preferential, AD/CVD with delta badges (green saving, red penalty). Uses matrix data already on the plan — no extra fetch. Verdict line summarises €/year impact. EN/PL/DE. 877/877 tests. |
| 2026-05-08 | Sprint AF — Comparison-mode share permalink | `?p=<base64>&c=<origin>` URL form auto-renders the share-plan AND opens the comparison panel for the named alternative. New "Copy comparison URL" button in the comparison header copies the exact view via clipboard API (with execCommand fallback). EN/PL/DE. 890/890 tests. |
| 2026-05-08 | Sprint AG — Scenario toggle (claim preferential) | "Re-run plan with this claimed" button in the preferential-available callout flips claimPreferential and re-fetches /api/start to show the alternate scenario end-to-end (duty drops to 0% via EBA/EVFTA/etc., downstream TCO + working capital recompute). State tracks baseline inputs; sticky banner with "Switch back" returns to original. EN/PL/DE. 905/905 tests. |
| 2026-05-08 | Sprint AB — Featured example shuffler | Homepage example cards expanded from 3 hardcoded to 6-in-pool; inline Fisher-Yates shuffler hides 3 per page load. All 6 stay in source HTML for SEO. EN/PL/DE. 918/918 tests. |
| 2026-05-08 | Sprint 37 — KV-store primitives | New lib/intelligence/kv-store.js exposes set/get/del/incr/listKeys/setJson/getJson with isConfigured + getMode. Durable backend (Upstash REST) when KV_REST_API_URL+TOKEN set; in-memory fallback otherwise. Foundation for upcoming auth (Sprint 38), saved plans (Sprint 39), event log (Sprint 36), plan-revision diff (Sprint 35). 943/943 tests. |
| 2026-05-08 | Sprint 38 — Magic-link auth | lib/auth.js (token gen, HMAC-signed session cookie, getCurrentUser). lib/handlers/auth.js dispatches /api/auth/{request,verify,me,logout} via second URL segment. /account/ page with 4 states (loading/signin/sent/signedin) + 3-tier fallback flow. Resend email send. Rate-limited 5 req / 5 min / IP. KV stores 15-min magic tokens; 30-day session cookies. 978/978 tests. |
| 2026-05-08 | Sprint 39 — Saved plans + per-user history | lib/saved-plans.js with CRUD keyed by email; ownership-checked. lib/handlers/plans.js dispatches POST/GET /api/plans + GET/DELETE /api/plans/<id>. Wizard result gets a "Save plan to my account" button (visible only when signed in). New /account/plans/ page lists user plans with Open/Delete actions. Plans capped at 50/user, 1-year TTL. 1,004/1,004 tests. |
| 2026-05-08 | Sprint 35 — Plan-revision diff | New lib/plan-diff.js (extractSnapshot, sanitiseSnapshot, diffSnapshots, enrichRecord). savePlan persists a 6-field snapshot {asOf, perShipmentLandedTotal, dutyEur, vatEur, transportEur, brokerageEur, dutyRatePct} computed via composePlan at save time. /api/plans (list + single GET) recomputes current and attaches {current, delta} per record; primaryDriver picks the component that moved most in absolute EUR; significance threshold ≥5%. /account/plans/ renders a "what's changed" badge on each card (red ▲ up / green ▼ down / flat). 1,024/1,024 tests. |
| 2026-05-08 | Sprint 36 — Conversion analytics dashboard | New lib/events.js (record/list/aggregate, KV-backed, 5,000-event cap). start handler records `import_plan_generated`; plans handler records `plan_saved`. lib/handlers/leads.js exposes GET /api/leads token-gated by ORCATRADE_LEADS_TOKEN (constant-time compare). New /dashboard/leads/ page renders summary tiles (total, email captured, mean landed cost, distinct routes) + 6 CSS-bar panels (categories, routes, origins, destinations, locales, types) + recent-events table. Token caches in sessionStorage so the dashboard stays open across reloads but clears on tab close. 1,041/1,041 tests. |
| 2026-05-08 | Sprint 40 — Pricing page + tier definition | New lib/tiers.js: canonical 5-tier catalogue (free/starter/growth/scale/enterprise) with quotas, features, hasFeature/getQuota lookups, and toCatalog() for JSON-safe export. New lib/user-tier.js: KV-backed tier:<email> persistence with default-to-free fallback. New lib/handlers/tiers.js dispatching GET /api/tiers (public catalogue) + GET /api/tiers/me (auth-only). Existing /pricing/ CTAs now carry data-tier="<id>" hooks for Sprint 41 + a /api/tiers/me bootstrap that flags the user's current plan. 1,067/1,067 tests. |
| 2026-05-08 | Sprint 41 — Stripe Checkout + webhook + billing page | New lib/stripe.js: zero-dep REST client, x-www-form-urlencoded encoder with PHP bracket-notation, HMAC-SHA256 webhook signature verify with constant-time compare + 5-min timestamp tolerance. New lib/handlers/billing.js dispatching POST /api/billing/{checkout,portal,webhook} + GET /api/billing/me; webhook is idempotent via stripe:event:<id> KV dedupe; reverse map stripe:email-by-customer:<id> lets subscription.deleted downgrade to free. Pricing page CTAs now POST to /api/billing/checkout (falls back to sign-in or contact). New /account/billing/ page surfaces tier + opens Stripe customer portal. Test-mode by default — env vars STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_<TIER>_<CYCLE>. 1,093/1,093 tests. |
| 2026-05-08 | Sprint 42 — Tier gating across handlers | New lib/gating.js with checkFeature/checkQuota/gate primitives; signed-in users keyed by email, anonymous keyed by IP. Quota counters in KV at quota:<id>:<name>:YYYY-MM with 62-day TTL. Wired feature + monthly-query gates into orchestrator (Growth+), compliance-agent (Free entry), sourcing-agent (Starter+), logistics-agent (Growth+), finance-agent (Growth+). Plans handler enforces savedPlans quota at POST. Gate verdicts return 402 tier_gate (feature) or 429 tier_quota (counter), both with currentTier/minimumTier/upgradeUrl in body. gate(res, verdict) writes either Vercel-Express or raw-Node responses. 1,113/1,113 tests. |
| 2026-05-08 | Sprint AE — RSS / Atom feed | New lib/feed-builder.js scans guides/* + examples/* (recursive) and extracts title/description/canonical from each index.html. New lib/handlers/feed.js serves either RSS 2.0 or Atom 1.0 (?format=rss|atom, default rss) with Cache-Control max-age=3600 + stale-while-revalidate=21600. vercel.json rewrites /feed.xml + /atom.xml. Home page <link rel="alternate"> advertises both. 185 items in feed (178 guides + 7 examples). 1,132/1,132 tests. |
| 2026-05-08 | Sprint AH — Currency display toggle (EUR/USD/CNY/VND/PLN) | fmtEur in start/app.js now emits `<span class="amt" data-eur="N">€X,XXX</span>` so a post-render walker can re-format every amount on demand. Inline FX_DISPLAY snapshot mirrors lib/intelligence/data/fx-snapshot.js (EUR=1, USD=1.08, CNY=7.85, VND=26300, PLN=4.30). Pill-style currency-toggle in result section, asOf banner shows snapshot date when in non-EUR mode. Preference persists in localStorage. EN/PL/DE labels added to start/i18n.js. 1,144/1,144 tests. |
| 2026-05-08 | Sprint AI — Implementation roadmap per plan | New lib/intelligence/implementation-roadmap.js: 5-phase backbone (pre-departure, production+QC, logistics+customs, arrival+inland, post-arrival) with conditional tasks driven by plan content (bonded warehouse adds bonded-entry sub-tasks; preferential origin adds EUR.1/origin-cert prep; trade-defence adds TARIC + surveillance; CBAM/EUDR/REACH add reporting cadences; FX hedge rec adds forward-execution; matrix-cheaper origin flags re-source memo; high working-capital triggers payment-terms negotiation). composePlanWithRoadmap wraps composePlan so saved-plan snapshots stay cheap. Wizard renders phase cards + 3-col task tables (when/action/owner) with deliverable + evidence chips. EN/PL/DE i18n parity. 1,160/1,160 tests. |
| 2026-05-09 | Sprint H4 — Supplier directory shell | New lib/intelligence/data/supplier-exemplars.js: 15 anonymised composite cards (8 verticals × 8 countries) — ASEAN, South Asia, East Asia, Türkiye, EU. Each entry carries category, region, years operating, MOQ range, lead time, certifications, capabilities, preferential-origin eligibility flag, notes. New /marketplace/ page renders cards with country-filter pills + two CTAs (Request introduction + Apply to be vetted). Anonymisation banner explains the shell — no live marketplace until curated network + consent + vetting pipeline are real. 1,173/1,173 tests. |
| 2026-05-09 | Sprint H5 — GTM tooling (press + partners + outbound composer) | New /press/ page: positioning sentence, founder bio (Oskar Klepuszewski), key facts grid (HQ, AI agents, 180+ guides), brand assets (logo, brand-kit, RSS), quotable lines, press contact. New /partners/ page: three relationship modes (Recommended/Referral/Commercial) + 6 categories (freight, finance, FX, insurance, inspection, compliance). New /agent/outbound/ tool: founder-grade cold-email composer that POSTs to /api/orchestrator with a brand-voice-pinned prompt; handles 402 tier_gate gracefully (Growth+); recipient + company + hook + goal + tone inputs; copy/regenerate actions. 1,188/1,188 tests. |
| 2026-05-10 → 2026-05-12 | i18n marketing-layer parity (retro-logged) | Tri-lingual coverage of every marketing/marketing-adjacent page: PL+DE pages for /press/, /partners/, /marketplace/, /pricing→cennik/preise/, /search/, /returns/, /customs/, /routing/, /documents/, /warehouse/, /buyer-verification/, /samples/, /insurance/, /agents/, /logistics→logistyka/logistik/, /platform→platforma/plattform/, /analysis→analiza/analyse/, /supply-chain→lancuch-dostaw/lieferkette/. Localised slug overrides applied where appropriate. hreflang tags added to all EN originals; sitemap registers every PL+DE entry with xhtml:link alternates. PL+DE homepage overhaul to mirror EN exactly: Aurora background + right-edge Page TOC + globe-canvas hero (replacing video-bg) + "Find · Verify · Ship · Finance" framing + Five Stages section with new Logistics card + Pinned Story scrolling section + d3 + globe.js loaders. Tools mega-dropdown made locale-aware in js/site-nav.js with I18N table + SLUG_OVERRIDES; six pages (PL+DE index/finance/sourcing) swapped from hand-rolled inline headers to `<header data-site-header>`. CBAM compliance brief feature card added to pl/intelligence.html + de/intelligence.html linking to /pl/analiza/ and /de/analyse/. Pure content + nav work; no test changes — baseline still 1,188/1,188. |
| 2026-05-12 | Mobile-nav z-index + tap-target fix (retro-logged) | Open mobile menu was at z-100, sitting BELOW the sticky header (1000), the first-visit cache modal (990), and the page-toc dots (40). Bumped open `.nav-links` to z-1500 with `.nav-toggle` and `.lang-switcher` pinned at z-1600 so the close button stays reachable. Every nav link + Tools mega-dropdown item now has a 44×44 px tap area (WCAG 2.5.5). Pure CSS change. |
| 2026-05-12 → 2026-05-13 | Favicon v3 → v7 + Google Search Console verification | v3 added 192/512 PNGs that Google's crawler prefers and reordered link tags so 192 is first. v4 added `?v=` cache-busters. v5 moved icons to a fresh `/icons/orca-*` namespace plus a defensive inline JS script that re-injects link elements at runtime so browsers can't honour pre-decided "no favicon for this URL" cache state. v6 cropped the wordmark out of orcatrade_logo.png with PIL — `orcatrade-mark.png` (800×800) became the master, regenerated every size from it. v7 inlined the 32×32 + 48×48 PNGs as base64 `data:` URIs in the FIRST `<link rel="icon">` tags so the favicon is materially present in HTML bytes regardless of cache state. Google Search Console verified via DNS, indexing requested for /, /pl/, /de/. |
| 2026-05-13 | Sprint D — Live TARIC integration | New lib/intelligence/taric-client.js — async `lookupHsRate(hsCode, originIso)` with 7-day fresh + 30-day stale KV cache, 4 s upstream timeout, hard kill-switch via `ORCATRADE_DISABLE_LIVE_TARIC` env (set in `npm test`). Upstream: UK Trade Tariff API v2 as the initial free public source (sanity-check; EU may differ — disclosed in every result). Customs calculator gained `calculateQuoteAsync` wrapper that engages live lookup when hsCode is 8+ digits AND origin is set; trade-defence and preferential-origin still stack on top of the live MFN exactly as before. `resolveDutyRate` gained `mfnRateOverride` + `mfnRateOverrideSource` params; result exposes `duty.mfnSource`, `duty.chapterRate*`, and `duty.liveRateMeta`. composePlan and composePlanWithRoadmap migrated to async — call sites in start/cron/plans handlers + the example-plans script + every test updated (codemod over 15 files, +59 async openers, +65 awaits). New wizard duty-source badge ("live · cached" green vs muted "chapter estimator" tag, with chapter-vs-live divergence note when ≥0.5pp apart). Public EU TARIC verify deep-link surfaced in next-steps when live rate applied. Test count: 1,188 → 1,268 (+17 new TARIC tests; +63 from the post-2026-05-09 work that hadn't been logged). |
| 2026-05-16 | Sprint D.1 — TARIC parser validation + heading fallback | Hands-on smoke test against the real UK Trade Tariff API revealed the first-pass parser walked the wrong JSON:API shape — the production version would have always returned null. Split `fetchUpstreamRate` (network) and `parseUpstreamResponse` (pure parse, now exported) so we can fixture-test the response handling without monkey-patching `global.fetch`. Real shape: `measure` entries carry `relationships.measure_type.data.id` (type "103" = third-country MFN), which points at a `duty_expression` whose `attributes.base` is "12.00 %"-style; strips HTML from `formatted_base` as fallback. Added effective-window check so expired/future-dated measures are skipped. Added heading-level fallback (`/headings/<4-digit>`) because aluminium structures + furniture and a handful of other commodities only carry MFN measures at the 4-digit parent, not the 10-digit leaf. Live smoke test: 5/5 real HS codes (men's cotton trousers, aluminium structures, smartphones, e-bikes, metal furniture) resolve in <300 ms with rates within 1.5 pp of expectations. +8 fixture-based parser tests pinning the JSON:API contract. 1,268 → 1,276 tests. |
| 2026-05-16 | Sprint E — Wizard exposes optional HS code input | Sprint D made the customs calc reach for live TARIC data when an 8+ digit HS code was supplied; Sprint E lets users actually supply one. New optional field at the bottom of wizard step 1 ("HS code (optional, 8–10 digits)") with a `pattern="[0-9 .]{6,14}"` mask that accepts spaces and dots (the TARIC client's `normaliseHs` strips them). Helper text frames the trade-off: "drop in a precise code for a sub-chapter duty rate from live tariff data, otherwise leave blank — we'll use the chapter average." `readForm()` picks it up automatically via `FormData` since `hsCode` was already in `SHARE_KEYS`. EN/PL/DE wizards all carry the new field. New end-to-end test seeds a synthetic live rate in KV and asserts `composePlan` with a spaces-included HS code (`'6203 42 35'`) routes through `calculateQuoteAsync`, applies the live MFN, surfaces `mfnSource` as the upstream label, and preserves `chapterRatePercent` for the divergence badge. 1,276 → 1,277 tests. |
| 2026-05-16 | Sprint F — TARIC cache warmer + nightly GHA schedule | Sprint D + D.1 + E built the live-rate path end-to-end, but cold KV meant the first user with each new HS code paid the 200–300 ms upstream cost. Sprint F pre-warms the cache nightly. New `lib/intelligence/data/taric-warm-list.js` curates 30 HS×origin combos covering all eight wizard categories plus the AD/CVD hot-spots (bicycles ex-CN, aluminium extrusions, steel fittings). New `runTaricWarm({dryRun, max})` job inside `lib/handlers/cron.js` walks the list, calls `lookupHsRate` with `skipUpstream` first to count already-fresh entries, then refreshes the rest via the normal lookup (which writes to KV). Returns a structured summary `{attempted, hit, miss, cached, unchanged, written, durationMs, details[]}` so a failed upstream surfaces in the log instead of dying silently. Wired into the GHA cron workflow with daily 04:15 UTC schedule + manual `workflow_dispatch` option. New `test/taric-warm.test.js` covers WARM_LIST shape contract, dry-run never writes, fresh-cache counts as `unchanged`, upstream-dead path returns `miss`. 1,277 → 1,287 tests. |
| 2026-05-16 | Sprint F (ops) — first prod warm | Fired `taric-warm` via GHA `workflow_dispatch`. Result: 31/31 fetched from UK Trade Tariff in 14 s end-to-end, 0 misses. Per-entry latencies 295–681 ms (most ~400 ms). Confirmed rates: cotton t-shirts 12%, bicycles ex-CN 14% MFN (AD layered separately), aluminium structures 6%, smartphones 0%, leather sports footwear 8%, glassware 10%, taps + cocks + valves 2%. Sprint D → F now has real production data behind it; future users hitting the warm-list HS codes get a cache HIT on first request. |
| 2026-05-16 | Sprint G — HS-code engagement analytics | Closes the loop on Sprints D → F by measuring whether users actually fill in the new HS code field. `lib/handlers/start.js` now records `hsCodeProvided` (boolean), `hsCodeLength` (0/6/8/10), and `dutyMfnSource` (the actual MFN source used in the calculation — `chapter-estimator` vs the live upstream label) on every `import_plan_generated` event. `lib/events.js` aggregator gains `hsCodeProvided`, `hsCodeProvidedRate` (% of plan events, not all events — so plan_saved doesn't dilute the denominator), and `byDutyMfnSource` top-N. `/dashboard/leads/` renders a fifth tile: "HS code provided · N · X% of plans · drives live TARIC lookup." +3 aggregator tests cover the plan-events-only denominator, missing-field treated as false, and empty-input zeros. 1,287 → 1,290 tests. |
| 2026-05-16 | Sprint H — Open Graph + Twitter Card site-wide | Favicon work (v3 → v7) covered browser tabs + SERP; OG + Twitter cards cover link previews in LinkedIn, WhatsApp, iMessage, Slack, email. Before: sharing any orcatrade.pl URL rendered as a bare link with no image. New `og-1200x630.png` (cropped orca mark on navy background + wordmark + tagline + url, generated from `orcatrade-mark.png` via PIL). Favicon injector v9 now also emits `og:image`, `og:image:width/height/alt`, `og:type`, `og:site_name`, `og:locale`, `twitter:card`, `twitter:image`, `twitter:site`. Per-page `og:title` and `og:description` are preserved unchanged. `og:type` is detected pre-strip and preserved — SEO guides + worked examples keep `og:type="article"` (Google's Article rich-result eligibility); hand-rolled pages default to `og:type="website"`. All five SEO generators (sourcing/routing/customs/warehouse, trade-defence, preferential, compliance, example-plans) updated to point `og:image` at the new file, and `generate-seo-pages.js#run()` now invokes the injector at the end of every regen so re-runs leave the repo in a state that satisfies the OG meta tests. New `test/og-meta.test.js`: OG image file exists in the right size range; 12 hand-rolled landing-surface pages all carry the canonical block; idempotence test (no duplicate og:image on re-inject); marker version contract. 1,290 → 1,305 tests. |
| 2026-05-16 | Sprint J — Founding 10 pilot + homepage scarcity strip | Pricing + Stripe were already wired; what was missing was a concrete asset for founder-led outbound and a way to convert the absence-of-testimonials into a story instead of a gap. New `/founding/` page offers the first ten paying importers lifetime 50% off Growth (€199/mo instead of €399), a founder Slack channel, and homepage placement — in exchange for six months of usage on three real shipments + a 30-min bi-monthly founder call. New `lib/handlers/founding.js`: `GET /api/founding` returns the spots-remaining counter (computed from the KV event log on every request — no separate counter key, no race), `POST /api/founding` validates name + email, records a `founding_applied` event (new ALLOWED_TYPES entry in `lib/events.js`), and emails orca@ via Resend with structured fields. Past the 10th application the handler still accepts submissions but flips `waitlist: true` so the email subject + UI reflect that. New homepage Founding 10 strip sits between hero and worked-examples, gold-accent linear-gradient card, live `spots remaining` number refreshed from `/api/founding` on load, single CTA → `/founding/`. New `test/founding.test.js`: 8 tests covering GET counter shape, POST happy-path with event-log assertion, missing-name 400, invalid-email 400, waitlist flip past 10 (with 10 seeded events), OPTIONS preflight, PUT 405, ALLOWED_TYPES contract. `test/og-meta.test.js` SAMPLE_PAGES gains `founding/index.html` so the canonical OG block is enforced there too. The favicon injector ran post-write so the new page carries the v9 block. 1,305 → 1,314 tests. Path A → B in motion: this is the asset that makes the H1 outbound campaign (next sprint) measurable. |
| 2026-05-16 | Sprint J.1 — Vercel analytics in SEO generator | Commit b004cd97 added `window.va` + `/_vercel/insights/script.js` to hand-rolled pages but never patched the five SEO generators. Every `npm test` run regenerated 561 SEO pages without analytics, silently undoing the analytics rollout — uncommitted drift first surfaced during Sprint J's test run. Rather than patch each generator template separately, extended `scripts/inject-favicon-tags.js` with a second injection phase: `injectAnalytics()` inserts the analytics block before `</body>`, idempotent via a fresh `ANALYTICS_MARKER` comment, strips prior un-markered analytics tags so the b004cd97-era pages get normalised on first re-inject. Refactored `inject()` into `injectHead()` + `injectAnalytics()` for separable idempotence — a page can have one block already and gain the other on the next run. `generate-seo-pages.js#run()` already calls the injector post-regen, so the analytics now survives every future test cycle. `test/og-meta.test.js` gains a parallel "carries the Vercel analytics block" assertion per sample page, including a single-instance check to catch double-injection. Final state: 681 pages re-injected once (with marker added + b004cd97 tags stripped to single canonical form), then 0 changes on second run. 1,314 → 1,327 tests. |
| 2026-05-16 | Sprint J.2 — PL/DE Founding 10 localisation | Sprint J shipped EN-only; PL and DE homepages (which carry the localised wizard from Sprint 33) sent non-English visitors past the offer with no awareness it existed. Added the gold-accent Founding 10 strip section + matching CSS + spots-remaining counter JS to `pl/index.html` and `de/index.html` between hero and worked-examples, in lock-step with the EN homepage. Built `/pl/zalozyciele-10/` and `/de/gruender-10/` as full localised landing pages — translated offer cards, ask list, six-field application form, FAQ — talking to the same locale-agnostic `/api/founding` handler (no backend changes; the offer is identified by email, not locale). Hreflang alternates wired tri-laterally between the three pages plus an `x-default` pointing at EN. `js/site-nav.js` SLUG_OVERRIDES gains `/founding/ → /pl/zalozyciele-10/` and `/founding/ → /de/gruender-10/` so any nav link to `/founding/` on a PL/DE page auto-routes to the localised slug. Favicon injector ran post-write to give both new pages the v9 head block + analytics. `test/og-meta.test.js` SAMPLE_PAGES extended with both new pages — OG canonical block + analytics presence enforced. 1,327 → 1,331 tests. H1 conversion surface now covers all three locales. |
| 2026-05-16 | Sprint J.3 — Founding 10 funnel on leads dashboard | Without a tile on `/dashboard/leads/`, every Founding 10 application would silently hit KV with the user blind to the funnel they're about to drive outbound traffic into. `lib/events.js` `aggregate()` gained `foundingApplied` (total count), `foundingWaitlist` (count past the tenth spot), and `foundingRecent` (newest-first list of 10 with name/company/email/role/monthlyValueEur/waitlist) — pulled off the same event stream the dashboard already reads, no new endpoint needed. Empty-input case returns explicit zeros + empty list so the dashboard doesn't NaN. `/dashboard/leads/app.js` renders a sixth tile ("Founding 10 applied · N / 10 · M spots remaining" with waitlist roll-in past 10) and a new "Recent Founding 10 applications" panel below the events table — hidden until at least one application lands so the dashboard stays clean pre-traffic. Status badge in the table flips green/Founding ↔ amber/Waitlist. +3 events tests: founding aggregation with mixed event types, empty-input zeros, 10-cap on recent. 1,331 → 1,334 tests. |
| 2026-05-16 | Sprint J.4 — Homepage honesty pass | The "60+ vetted manufacturers" line at the top of each homepage mission section was flagged in the original site audit as the weakest claim — asserted without backing, contradicted by the openly-anonymised marketplace shell, and tonally at odds with the "built in public" Founding 10 narrative just shipped in J/J.2. Replaced the claim across all three locales (`index.html`, `pl/index.html`, `de/index.html`) with a single line that's both honest and a CTA: "Built in public with the Founding 10 · 18 calculators · Live TARIC integration · 561 guides across EN, PL, DE · Orders €50k–€500k", with the "Founding 10" phrase linking gold-accent to `/founding/` (or locale-correct slug per Sprint J.2 SLUG_OVERRIDES). The expanded "read more" mission paragraphs were left untouched — they refer to OrcaTrade's *intent* to vet factories per shipment, not to a count claim. Pure HTML/copy change; no test changes, baseline holds at 1,334. The mission section is now a conversion driver into Founding 10 from the most visited piece of homepage real estate. |
| 2026-05-16 | Sprint J.5 — Applicant confirmation email (locale-correct) | Before J.5 the apply flow ended with a UI toast — applicants got no email and Oskar's next-day reply landed cold instead of as the second touch. Two-half sprint: (1) three founding-page frontends now POST `locale: 'en'/'pl'/'de'` alongside the form payload; (2) handler accepts the locale (validates against ALLOWED_LOCALES, defaults to `en` for missing/invalid), stamps it onto the `founding_applied` event, and fires two Resend emails in parallel — the existing internal notification to `orca@orcatrade.pl` (now annotated with locale + waitlist status), plus a new locale-correct confirmation to the applicant with `reply_to: orca@orcatrade.pl` so any reply continues the founder conversation. `APPLICANT_TEMPLATES` per locale: subject + plain-text body, first-name personalisation, waitlist branch when spots 1–10 are filled. Both emails soft-fail independently (no `RESEND_API_KEY` returns 200 with `emailed: false / applicantEmailed: false`; transient Resend errors don't break the user flow or the event log). Refactored `sendEmail` into a single `resendSend()` core + `sendInternalEmail` + `sendApplicantEmail` so the two paths share transport but diverge on content. +4 tests: locale recorded on event, EN-fallback on missing/garbage locale, EN/PL/DE template render shape with first-name + waitlist switch, locale preserved on waitlist flip past spot 10. 1,334 → 1,338 tests. |

When you complete a sprint, append here.
