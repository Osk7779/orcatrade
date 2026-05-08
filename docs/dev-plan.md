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

### Horizon 1 — Conversion-side polish (next 2-3 sprints)

These close known gaps in the funnel that currently exists. High
confidence, immediate impact, no new infrastructure.

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

#### Sprint 35 — Plan-revision diff + email follow-ups

**Why now:** Permalinks already let users return to a plan. But pricing
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

#### Sprint 36 — Conversion analytics dashboard

**Why now:** Every plan submission already logs a structured
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

When you complete a sprint, append here.
