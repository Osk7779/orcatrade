# OrcaTrade — Continued Development Plan

**Author:** Claude (working with Oskar Klepuszewski)
**Last updated:** 2026-05-08 (Sprint 33 complete)
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

#### Sprint D — Live TARIC integration (deferred until Sprint 37 KV exists)

**Why deferred:** EU TARIC has a free API but our customs snapshots
become stale and need caching. Without KV, every API request hits
TARIC, gets rate-limited, and breaks under load. Build after Sprint 37.

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

When you complete a sprint, append here.
