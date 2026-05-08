# OrcaTrade Marketing Operations Manual

> Seven specialised employees, daily and weekly cadences, single source of brand truth. The structure below is what we operate from — whether the seat is filled by a human, an AI agent, or a contractor.

- **Author / Founder:** Oskar Klepuszewski, Co-Founder & CFO, OrcaTrade Holding
- **Document version:** 1.0
- **Last updated:** 2026-05-08

---

## How to use this document

This manual exists so anyone (or any agent) running marketing work for OrcaTrade can pick up where the last person left off without context loss.

- **Each role has one charter sentence.** If a task doesn't ladder up to the charter, it doesn't belong in that role.
- **Daily ops are non-negotiable.** They keep the engine warm.
- **Weekly ops are the value-creating ones.** They ship product.
- **Brand & Creative Director (#6) is the only writer to `docs/brand-kit/`.** Every other employee reads from it.
- **Growth Analyst (#7) is the source of numerical truth.** Other employees do not run their own attribution math.

The cadence is async-first. Meetings are listed at the bottom; everything else happens through the standup thread, the brand kit, and the dashboard.

---

## The seven employees

| # | Role | Charter |
|---|------|---------|
| 1 | Content Strategist | Long-form content across EN/PL/DE — blog, guides, case studies, agent demo write-ups. |
| 2 | SEO Engineer | Organic traffic — programmatic factory/sourcing pages, technical SEO, internal linking. |
| 3 | Performance Marketer | Paid acquisition — Meta, LinkedIn, Google. Creative testing, audience builds, landing-page CRO. |
| 4 | Email & Lifecycle Manager | Email database — onboarding, nurture, transactional, newsletter, re-engagement. |
| 5 | Social & Community Lead | LinkedIn-first founder voice + community presence. |
| 6 | Brand & Creative Director | Visual identity, voice, messaging — owns the brand kit. |
| 7 | Growth Analyst | Measurement — attribution, dashboards, funnel reports, experiment infrastructure. |

---

## 1. Content Strategist

**Charter** — turn OrcaTrade's domain depth (CBAM, EUDR, supplier intel, agent demos) into multilingual content that ranks and converts.

### Daily

- Draft or edit one piece in the editorial pipeline.
- Sweep agent conversations (`/agent/orchestrator/`, `/agent/sourcing/`, etc.) for unanswered or recurring questions → blog ideas.
- 30-minute review of competitor content (Flexport blog, Forto, Allianz Trade, DSV).
- Source one quote / data point from the HK office or a partner forwarder.

### Weekly

- Ship 2 long-form pieces (rotation: 1 EN + 1 PL or DE).
- Update editorial calendar; lock the next 2 weeks of topics.
- Repurpose 1 long-form into 5 social atoms (handed to #5).
- Editorial standup with #2 (SEO) + #6 (Brand).

### Outputs

Blog posts, guides ("CBAM for Polish importers" type), agent-demo write-ups, customer case studies, gated whitepapers.

### KPIs

Organic sessions to blog, dwell time, MQLs from blog, content-assisted pipeline value.

### Brand-kit dependencies

`04-voice.md` · `05-messaging.md` · `08-templates.md` (blog hero, hero quote block) · `09-localisation.md`.

---

## 2. SEO Engineer

**Charter** — programmatic SEO is OrcaTrade's unfair advantage. Factory × country × category combinations are a long tail nobody in this space owns.

### Daily

- Monitor rankings for the top 50 target keywords.
- Triage Search Console crawl errors.
- Refresh 1–2 stale pages with new data (CBAM rates, lead-time updates, hub pricing).
- Review competitor SERP shifts.

### Weekly

- Generate 50–100 new programmatic pages (factory directory, sourcing-route pages).
- Internal-link audit + fix broken links.
- Keyword research sprint for next quarter's topics.
- Sync with #1 (Content) on long-form keyword targets.

### Outputs

Programmatic page templates (CN factory directory, sourcing comparison by country×category), schema markup, sitemaps, hreflang structure, technical fixes.

### KPIs

Indexed pages, ranking keywords (top-10 share), organic traffic to programmatic pages, click-through rate from SERP.

### Brand-kit dependencies

`07-components.md` (page templates) · `08-templates.md` (meta-tag patterns) · `09-localisation.md` (hreflang rules).

### Special opportunity

The existing `lib/intelligence/sourcing-quote.js` exposes 5 countries × 8 product categories = 40 combinations. Each combination is a long-tail keyword cluster ("source apparel from Vietnam", "source furniture from Bangladesh"). Programmatic generation × 3 languages = **120 SEO landing pages from existing data with no new content gathering**.

Same logic on `routing-quote.js` (sea/rail/air × major Asia-Europe corridors), `customs-quote.js` (HS chapter × destination country), `warehouse-quote.js` (6 hubs × destination region) yields several hundred more candidate pages.

---

## 3. Performance Marketer

**Charter** — paid is the predictable growth lever. Polish e-commerce on Meta, German Mittelstand on LinkedIn, intent-buyer queries on Google.

### Daily

- Review yesterday's spend, CTR, CPL, CPA per channel.
- Pause underperformers (>2σ from mean CPL on >€50 spend).
- Spot-check landing-page funnel for the top campaign of the day.
- Approve next day's budget allocation.

### Weekly

- Launch 2–3 new ad creative variants (rotate weekly).
- Refresh audiences (lookalikes, retargeting tiers, ICP segments).
- A/B test one landing-page element.
- Channel review meeting with #7 (Growth Analyst).

### Outputs

Ad creatives, landing-page variants, audience builds, weekly spend reports, channel-mix recommendations.

### KPIs

CAC by ICP segment, MQL volume, CPL by channel, ROAS for transactional services (insurance, samples, returns).

### Brand-kit dependencies

`08-templates.md` (ad creative formats: 1080×1080, 1200×628, 9×16 vertical, 320×50 banner) · `02-colour.md` · `05-messaging.md` (per-ICP value props).

### Channel allocation defaults

| Channel | ICP fit | Notes |
|---------|---------|-------|
| **LinkedIn** | German Mittelstand · DACH B2B | Highest CAC, highest LTV. Use for Tier 2 + 3 service launches. |
| **Meta** | Polish e-commerce founders · Allegro / FBA | Best for top-of-funnel awareness on Compliance Agent + Routing tools. |
| **Google Search** | Intent buyers ("CBAM consultant", "China factory audit") | Lowest CAC, lowest volume. Cap budget; let SEO carry the residual. |
| **Google Display** | Retargeting only | Brand-defensive only. Don't expand. |

---

## 4. Email & Lifecycle Manager

**Charter** — email is the highest-leverage channel for B2B SME with infrequent purchase cycles. Build a database, segment ruthlessly, automate.

### Daily

- Monitor deliverability, bounce rate, unsubscribe rate.
- Resolve any failed transactional sends (via Resend dashboard).
- Sync new sign-ups into segments.
- Triage replies (route to ops or sales).

### Weekly

- Ship one newsletter (EN, with PL/DE summary blocks).
- Review onboarding flow drop-off; A/B test one step.
- Build / refine one nurture sequence (e.g. "first-time CBAM importer", "Asia-sourcing newcomer").
- Database hygiene report: re-engagement / suppression / list-growth metrics.

### Outputs

Newsletter, onboarding sequence, nurture flows by segment, re-engagement campaigns, transactional template upgrades (Resend already integrated via `lib/handlers/contact.js`).

### KPIs

List growth rate, open rate, click rate, MQL→SQL conversion from email, churn-prevention saves, reply rate (proxy for genuine engagement).

### Brand-kit dependencies

`08-templates.md` (email header/footer, signature, unsubscribe block) · `04-voice.md` (transactional vs nurture register) · `09-localisation.md` (greeting/sign-off conventions).

### Segmentation defaults

| Segment | Trigger | Sequence |
|---------|---------|----------|
| New signup, no tool used | Account created | Welcome → tour the agent suite → "your first compliance check" |
| Used Compliance Agent only | First compliance assessment | Cross-sell logistics calculators |
| Quote calculator user, no follow-through | Quote generated, no further activity 7d | Re-engage with a partner intro offer |
| High-value lead | Manual flag from #5 or #7 | Hand-off to founder for direct contact |

---

## 5. Social & Community Lead

**Charter** — LinkedIn-first. The founder's voice is the brand. Cadence > polish. Engagement > broadcast.

### Daily

- Post 1 LinkedIn update (founder voice or company).
- Engage with 20 target accounts (genuine comments, not likes).
- Monitor brand mentions across LinkedIn / X / Reddit.
- DM 5 ideal-customer connections with a non-pitch.

### Weekly

- Ship 1 carousel post (10-slide explainer of an agent demo, sourcing insight, or regulation primer).
- Ship 1 long-form LinkedIn article (2,000–3,000 words, repurposed from #1's blog).
- Run 1 LinkedIn poll or AMA.
- Community-engagement report to #7.

### Outputs

LinkedIn posts, carousels, articles, polls, partner co-posts, founder ghost-content.

### KPIs

Follower growth (Oskar's profile + company page), post engagement rate, profile visits, inbound DMs from ideal customers, share of voice vs Flexport / Forto / Allianz Trade / DSV.

### Brand-kit dependencies

`08-templates.md` (carousel slide format, header banner, profile assets) · `04-voice.md` (founder voice guide) · `06-photography.md` (image-treatment rules).

### Voice baseline

OrcaTrade founder voice = a senior trade operator who's run Asia-Europe shipments for a decade. Speaks plainly. Cites numbers. Names specific factories, specific HS codes, specific routes. Never generic. Never breathless.

---

## 6. Brand & Creative Director

**Charter** — own the brand kit. Every other employee pulls from it. The brand kit is the product.

### Daily

- Review one piece of work from each team for brand fit.
- Approve / reject deviations from the kit (with a reason if rejected).
- Sync with #1 and #5 on hero visuals.
- Maintain the messaging matrix as ICPs evolve.

### Weekly

- Ship 1 new template / asset to the brand kit.
- Photo / illustration commission review (HK office, factory floors, EU warehouses).
- Brand-fit audit of last week's published work.
- Quarterly: refresh one major template family (ads, email, blog hero).

### Outputs

`docs/brand-kit/` — every section, kept current. Templates, photography direction, voice-guide updates, messaging matrix.

### KPIs

Brand-kit usage rate (% of published work using approved templates rather than improvised ones), brand-fit pass rate on weekly audit, brand recall in user surveys.

### Owns

The brand kit. No one else writes to `docs/brand-kit/` without #6 review.

---

## 7. Growth Analyst

**Charter** — instrument everything, kill what doesn't work, double down on what does. Single source of numerical truth.

### Daily

- Refresh main funnel dashboard (visit → MQL → SQL → close).
- Watch for anomalies (>2σ daily metric shifts).
- Validate tracking on any new page from #1 / #2.
- Triage attribution gaps.

### Weekly

- Ship 1 weekly funnel report (Monday morning, visible to all).
- Run 1 cohort analysis (acquisition channel × LTV, ICP × retention).
- A/B test setup + readout for #3's CRO experiment.
- Recommend 1 channel reallocation to #3 based on data.

### Outputs

Weekly funnel report, cohort dashboards, A/B test infrastructure, attribution model, monthly board metric pack.

### KPIs

Speed-to-insight (hours from data → recommendation), test velocity (tests run per month), share of decisions backed by data.

### Brand-kit dependencies

`08-templates.md` (report templates, dashboard styling for shareable outputs).

### Stack expectations

- Vercel Analytics for top-of-funnel
- Plausible or Fathom for privacy-friendly product analytics (when added)
- Stripe for revenue (when wired)
- A small dashboard at `/dashboard/internal/` (gated, future) for the team to read

---

## Operating cadence

How the seven stay in sync without drowning in meetings.

| Cadence | What | Who | Format |
|---------|------|-----|--------|
| Daily async standup | "Did yesterday · doing today · blockers" | All 7 | One thread, one message per role |
| Tuesday content sync | Editorial calendar + topic alignment | #1, #2, #5, #6 | 30-min |
| Wednesday performance review | Spend, CAC, ROAS, CRO experiments | #3, #7 | 30-min |
| Friday retro + next-week plan | What shipped, what didn't, next 7 days | All 7 | 45-min |
| Monthly brand audit | Brand-fit score on everything published | #6 leads | Async + 30-min discussion |
| Quarterly strategy review | OKRs, channel-mix, ICP recalibration | All 7 + leadership | 2 hours |

### Standup template

```
Role: [#3 Performance Marketer]
Did yesterday: [3 lines max]
Doing today: [3 lines max]
Blockers: [or "none"]
Asks: [or "none"]
```

---

## Permissions matrix

| Resource | Read | Write |
|----------|------|-------|
| `docs/brand-kit/` | All 7 | #6 only |
| `docs/marketing-ops.md` | All 7 | Founder + #6 |
| Editorial calendar | All 7 | #1, #6 |
| Ad accounts (Meta, LinkedIn, Google) | #3, #7 | #3 |
| Email send (Resend) | #4, #7 | #4 |
| Funnel dashboard | All 7 | #7 |
| Analytics raw data | #7 | #7 |

---

## Onboarding a new employee (or AI agent)

1. Read this manual end-to-end.
2. Read the brand kit (`docs/brand-kit/README.md` first, then your role's dependencies).
3. Read `docs/strategic-platform-plan.md` for product context.
4. Read the past 4 weeks of standup threads.
5. Shadow #6 for 2 days on a brand-fit audit.
6. Ship one piece of work end-to-end with #6 review before going live.
7. Hit your role's daily cadence by week 2.

---

> **The principle behind all of this:** seven roles, one brand kit, one source of numerical truth. If a piece of work can't trace back to a role's charter and pull from the brand kit, it shouldn't ship.
