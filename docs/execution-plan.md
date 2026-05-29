# OrcaTrade — Execution Plan v1

| Field | Value |
|---|---|
| **Status** | Active — this is the canonical contract for OrcaTrade execution |
| **Version** | v1 (2026-05-30) |
| **Owner** | Oskar Klepuszewski (CEO); Claude (engineering pair) |
| **Target horizon** | 12–18 months |
| **Supersedes** | Ad-hoc weekly sprints in [docs/dev-plan.md](dev-plan.md); the four-pillar phasing in [docs/billion-dollar-plan.md](billion-dollar-plan.md) remains the strategic apex above this plan |
| **Change control** | Plan changes via PR to this file. No other source of truth. |

---

## 1. Purpose

This document is the **single contract** for how OrcaTrade is built and operated over the next 12–18 months. It exists because the audit on 2026-05-30 surfaced a pattern of *defined-but-not-enforced* rules, *built-but-inert* features, and *aspirational-but-untested* documentation claims. Continuing on that footing is incompatible with the stated commercial goal: closing a serious enterprise contract and operating at the standard a CISO at a Fortune 500 / DAX 40 would accept.

The plan is structured in **six phases** with strict entry/exit criteria. No phase begins before the prior phase's exit criteria are met. Every deliverable is held to a **big-corporation engineering and operational bar** — measured against enterprise vendors in the trade-compliance space (SAP GTS, Descartes, Thomson Reuters ONESOURCE), not against startup norms.

---

## 2. Standing orders (apply to every PR, every phase)

These supersede prior informal conventions. Violating a standing order is a blocker for merge.

1. **PR-per-coherent-change.** No direct pushes to `main`. Every change opens a PR with a preview deploy.
2. **Acceptance criteria written before work starts**, in the PR description. Negotiate AC up-front, not in review.
3. **Tests, then code, then docs.** No green tests = no merge. New behaviour = new test. New rule = new test that fails on rule violation.
4. **Promise = enforcement.** A claim ships in the same PR as the test/monitor/process that enforces it. If it can't be enforced, the claim doesn't ship.
5. **Memory hygiene.** Convention or architectural changes update the relevant memory file in the same PR.
6. **Surface, don't guess.** Anything touching money, audit, PII, AI tool surface, public API contract, data layer, or security boundary requires an ADR (see #12) and a user confirmation before coding.
7. **No fabricated metrics, no aspirational copy.** Per [pre-revenue stage](../../../../.claude/projects/-Users-oskarklepuszewski-Desktop-orcatrade-copy/memory/pre_revenue_stage.md) — only platform-capability claims; never transaction-y claims.
8. **Stop on red.** If exit criteria fail (suite red, eval regression, SLO miss), stop and fix before moving on, even if "almost done".
9. **One thing at a time.** No starting Phase N+1 work in a Phase N PR.
10. **Effort estimates are honest, not aspirational.** Wrong estimates are revised in writing, in this file.
11. **Two-eyes review without exception.** Until a second engineer joins, Claude prepares; Oskar approves. No self-merge.
12. **ADR-first for architectural decisions.** A new file under `docs/adr/NNNN-title.md` ([MADR](https://adr.github.io/madr/) template) for any change touching the hard rules.
13. **Conventional commits + automated changelog.** `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `perf:`, `sec:`. Release-please generates [CHANGELOG.md](../CHANGELOG.md) and the public [/changelog/](../changelog/) page.
14. **Threat-model header in any security-relevant PR.** STRIDE table in the PR description; no exceptions.
15. **Bar for "done" is "would this withstand a procurement security questionnaire?"** Not "does it work on my machine".

---

## 3. The big-corp quality bar

Every PR is measured against this checklist. If it cannot tick all applicable boxes, it does not merge.

| Dimension | Big-corp bar |
|---|---|
| **Code** | Strict TypeScript (all new code); pure JS only in untouched legacy files; no `any`, no `@ts-ignore` without comment + ticket; conventional commits; ADR for any hard-rule decision. |
| **Tests** | Five layers: unit · integration (real KV + PG via Neon branch) · contract (every public API has a frozen v1 contract test) · e2e (Playwright through app-shell) · load (k6 baseline per release). Coverage ≥80% on new code; mutation testing (Stryker) on money/audit. |
| **Security** | Threat model for any auth/money/PII/AI/API change. SAST (CodeQL), dependency review (Dependabot + Snyk), secrets scanning (gitleaks), SBOM (CycloneDX) per release. Every endpoint has explicit AuthN+AuthZ assertions in tests. |
| **Reliability** | SLOs per critical user journey with error budgets. Synthetic monitoring (Checkly) every 60s on revenue-bearing paths. Multi-AZ verified. Game days quarterly. |
| **Observability** | Three pillars: structured logs + metrics + distributed traces (OTEL → Sentry/Honeycomb). One dashboard per service. Alert routes to on-call with documented SLO-breach criteria. |
| **AI governance** | Model card per agent. Eval pipeline gates merges on semantic + numeric fidelity (not regex). Prompt diffs versioned + reviewed like code. Human oversight policy per agent. EU AI Act conformance posture documented. |
| **Data** | Classification (`public`/`internal`/`confidential`/`restricted`) tagged at schema level. Retention enforced in code per table. Data residency commitments per customer. Right-to-erasure SLA ≤30 days with automated verification. |
| **Documentation** | Auto-generated public API docs (OpenAPI). Runbook per production surface. C4 architecture diagrams. New-engineer onboarding doc. ADR log. Internal handbook (eng, sec, ops). Auto-generated public changelog. |
| **Design/UX** | Design system in Figma + Storybook + shadcn registry. WCAG 2.2 AA pass per release. Copy reviewed by an editor (EN) and by native speakers (PL/DE). |
| **Process** | Two-eyes review on every PR. Change calendar with freeze windows. Rollback drill quarterly. Incident commander training. Public-by-default post-mortems within 7 business days of sev1. |
| **Legal/commercial** | MSA, DPA, SLA-with-credits, AUP, MNDA, sub-processor list, security whitepaper, trust centre, pre-answered SIG Lite + CAIQ, cyber + E&O + GL insurance. |
| **Compliance** | SOC 2 Type II + ISO 27001 + ISO 27701 + GDPR/UK DPA + EU AI Act conformance. Vendor TPRM programme. Annual pen test. Continuous evidence collection (Vanta/Drata). |

---

## 4. Phase 0 — Stop lying + establish discipline scaffold

**Duration:** 4 weeks  
**Goal:** every public claim in [CLAUDE.md](../CLAUDE.md), [docs/](.), `/docs/security/`, and the marketing site is true. Test suite green. Deploy gates real. Engineering discipline scaffold in place so every subsequent PR can meet the corp-grade bar.

**Exit criteria:**
- `npm test` exits 0 on `main`
- Branch protection on `main` requires 9 status checks (lint, typecheck, test, evals, smoke, coverage-≥80%-new, codeql, gitleaks, dependency-review)
- ADRs backfilled for the 5 hard rules
- Conventional commits + release-please live; auto-generated [CHANGELOG.md](../CHANGELOG.md)
- TypeScript baseline + strict mode for new code
- PR template + engineering handbook + 5 runbooks + C4 diagrams + OpenAPI scaffold all live
- Every hard-rule claim in [CLAUDE.md](../CLAUDE.md) backed by a test that fails on violation

**Tasks (each = one PR):**

| ID | Task | Files / Notes | Effort |
|---|---|---|---|
| **Scaffold (must land first)** | | | |
| P0.A | ADR repository + template; backfill 5 ADRs for the hard rules | new `docs/adr/0001-record-architecture-decisions.md` (MADR), `0002-llm-never-produces-decision-numbers.md`, `0003-anthropic-sdk-boundary.md`, `0004-integer-cents-money.md`, `0005-audit-log-before-success.md`, `0006-circuit-breaker-on-external-calls.md`, `0007-api-v1-stable-contracts.md`, `0008-email-pseudonymisation.md` | 1 day |
| P0.B | Conventional commits + release-please workflow; auto CHANGELOG.md + `/changelog/` regeneration | new `.github/workflows/release-please.yml` + `.release-please-manifest.json` + `release-please-config.json` + commitlint config | 0.5 day |
| P0.C | Branch protection: 9 required checks + two-eyes review | GitHub repo settings + new `.github/workflows/required-checks.yml` aggregator | 0.5 day |
| P0.D | CodeQL + gitleaks + Dependabot + Snyk + SBOM | new `.github/workflows/codeql.yml`, `gitleaks.yml`, `dependabot.yml`, `sbom.yml` (CycloneDX) | 1 day |
| P0.E | TypeScript baseline; `tsconfig.json` strict; `@ts-check` on every JS file; new files `.ts` only | new `tsconfig.json`, `tsconfig.check.yml` CI step | 1 day |
| P0.F | PR template (Problem · Options · Decision · AC · Test plan · Threat model · Rollback · Docs) | new `.github/pull_request_template.md` | 0.5 hour |
| P0.G | Engineering handbook | new `docs/handbook/` — coding standards, review checklist, on-call expectations, incident response v1 | 1 day |
| P0.H | Runbook template + 5 runbooks (auth, billing, AI agent failure, KV down, PG down) | new `docs/runbooks/` | 1 day |
| P0.I | C4 architecture diagrams; auto-rendered with Structurizr Lite in CI | new `docs/architecture/` + `.github/workflows/architecture.yml` | 1 day |
| P0.J | OpenAPI spec scaffold (generated from `lib/contracts/v1/`) | new `docs/api/openapi.yaml` + render step | 1 day |
| **Fixes** | | | |
| P0.1 | Green the test suite | guard the 3 `index.html` reads in [test/og-meta.test.js](../test/og-meta.test.js) after marketing-shell rebuild | 30 min |
| P0.2 | Migration for 7 missing PG tables + writer-vs-schema parity test | new `lib/db/migrations/schema-002-missing-tables.sql` for `agent_memory`, `monitoring_alerts`, `drafts`, `corpus_chunks`, `sanctions_entries`, `sanctions_refresh`, `data_snapshots`; new `test/db/schema-parity.test.js` | 1 day |
| P0.3 | Wrap Anthropic calls in [lib/circuit.js](../lib/circuit.js); failover tests | 6 handlers: `agent.js`, `finance-agent.js`, `logistics-agent.js`, `orchestrator.js`, `sourcing-agent.js`, `supply-chain.js` | 1 day |
| P0.4 | Stop swallowing audit-log writes on hard mutations; rule-4 test | [plans.js](../lib/handlers/plans.js), [portfolio.js](../lib/handlers/portfolio.js), [account.js](../lib/handlers/account.js), [orgs.js](../lib/handlers/orgs.js), [scim.js](../lib/handlers/scim.js) | 0.5 day |
| P0.5 | Import-boundary test enforces rule 2 | new `test/import-boundary.test.js` | 30 min |
| P0.6 | Replace hardcoded model strings with `MODELS.*` constants | [supply-chain.js](../lib/handlers/supply-chain.js), [quick-check.js](../lib/handlers/quick-check.js), [factory-score.js](../lib/handlers/factory-score.js); new grep test | 20 min |
| P0.7 | Sentry captures errors via [api/[...path].js](../api/) middleware + cron error path | [lib/sentry.js](../lib/sentry.js), dispatcher | 0.5 day |
| P0.8 | `/api/health` per-probe timeouts + SLO target | [lib/handlers/health.js](../lib/handlers/health.js) `Promise.race` with 2s per probe; p50/p95 to KV | 0.5 day |
| P0.9 | Smoke workflow becomes deploy gate (block merge on red) | [.github/workflows/smoke.yml](../.github/workflows/smoke.yml) → push trigger + required status | 1 hour |
| P0.10 | **DECISION REQUIRED:** kill or queue `requestHumanReview` | If KILL: remove tool from all 5 agents + prompt updates. If QUEUE: KV list + ops endpoint + email to ops alias | 15 min / 2–3 days |
| P0.11 | **DECISION REQUIRED:** wire `lookupHsCode` to TARIC or remove | [agent.js:380-391](../lib/handlers/agent.js) | 1 day / 15 min |
| P0.12 | Intro overlay a11y — `prefers-reduced-motion`, `aria-live`, visible "press any key" hint | marketing-shell intro overlay component | 30 min |
| P0.13 | Delete orphaned `_legacy/index.html` | [_legacy/](../_legacy/) | 1 min |
| P0.14 | Update [CLAUDE.md](../CLAUDE.md), `docs/security/`, marketing copy to remove overclaims | docs sweep | 0.5 day |
| P0.15 | Live eval CI gate on push (≥95% threshold, hard fail) | [.github/workflows/evals.yml](../.github/workflows/evals.yml) | 1 day |

**Phase 0 total:** 27 PRs / ~4 weeks one engineer full-time.

---

## 5. Phase 1 — Trust foundation

**Duration:** 10–12 weeks (starts after P0 exit)  
**Goal:** survive a careful engineering due-diligence and a serious security questionnaire (SIG Lite, CAIQ v4).

**Exit criteria:**
- SLOs live with dashboards for: agent response (p95 < 8s), `/api/health` (p95 < 500ms), customs quote (p95 < 1s), audit-log write (p99 < 100ms)
- OTEL traces + metrics + logs correlated by trace ID end-to-end
- TypeScript strict in `lib/intelligence/` and `lib/ai/`
- Mutation testing ≥75% on money/audit modules
- AI model cards published; EU AI Act conformance documented
- Threat models for AI agent surface, customer API, magic-link auth
- Insurance quotes in hand; editorial + native review complete on shipped pages

**Tasks (one PR each unless noted):**

| ID | Task | Notes |
|---|---|---|
| P1.1 | TARIC duty pinning per quote | Snapshot at save; recompute reads snapshot; drift badge if upstream changed. ~3 days. |
| P1.2 | Write-time tamper-evident audit | Extend [lib/audit-chain.js](../lib/audit-chain.js); per-event `_prevHash`/`_hash`; publish daily root externally. ~3 days. |
| P1.3 | Salted email pseudonym | New `EMAIL_PSEUDO_SALT` (server-only), HMAC-SHA-256; backfill job. ~2 days. |
| P1.4 | Postgres-primary read cutover | `plans`, `portfolios`, `events`, `actuals`; KV becomes write-through cache; parity tests. ~1 week. |
| P1.5 | TypeScript adoption in `lib/intelligence/` + `lib/ai/` | `.d.ts` declarations + per-day calculator migration. ~2 weeks part-time. |
| P1.6 | Numeric-fidelity eval assertions | Calc number must appear verbatim in agent prose. ~2 days. |
| P1.7 | Per-tenant Anthropic spend cap | Daily cap + hard stop + alert; KV + PG mirror. ~2 days. |
| P1.8 | OpenTelemetry tracing | Instrument [api/[...path].js](../api/) + tool-loop spans → Sentry traces. ~2 days. |
| P1.9 | RBAC audit across all mutation endpoints | Every handler runs through [lib/rbac.js](../lib/rbac.js); new test fails if mutation lacks permission check. ~2 days. |
| P1.10 | Split the single dispatcher | Adopt `vercel.ts`; route per real endpoint; parity tests. ~3–4 days. |
| P1.11 | Real RAG corpus | Full text of CBAM/EUDR/REACH/CE + TARIC nomenclature + EU/UK sanctions consolidated; pgvector populated. ~1 week + corpus engineering. |
| P1.12 | Live status page | Render from `/api/health` history (cron every 60s to KV). ~2 days. |
| P1.13 | Design tokens + shadcn/ui in app-shell | ~3 days. Marketing site stays as-is until P2. |
| P1.14 | Rate-limit hygiene | TTL on every counter; test fails on TTL-less KV write. ~1 day. |
| P1.15 | Snapshot-store read path | Reproducibility recompute actually re-runs calculators against snapshot. ~2 days. Pair with P1.1. |
| P1.A | SLOs defined + dashboards | Per critical journey. ~2 days. |
| P1.B | OTEL end-to-end correlation | Trace ID through every Anthropic tool-use loop. (Combined with P1.8.) |
| P1.C | Mutation testing on money/audit | Stryker ≥75% on `money.js`, `audit-chain.js`, `events.js`, `saved-plans.js`. ~2 days. |
| P1.D | Integration test infrastructure | Neon branch per CI run; ephemeral KV; Playwright e2e on app-shell. ~1 week. |
| P1.E | Threat models | AI agent (prompt injection, tool poisoning), customer API (authz bypass, rate-limit bypass), magic-link auth (token reuse, enumeration). ~3 days. |
| P1.F | AI model cards | `docs/ai/model-cards/` per agent: intended use, scope, evaluations, limitations, escalation, oversight. ~1 day. |
| P1.G | EU AI Act conformance | Classify each agent (Limited Risk → Art. 50 transparency); publish AI use disclosure; interaction log. ~2 days. |
| P1.H | Data classification | Tag every PG column (`public`/`internal`/`confidential`/`restricted`); type wrapper enforces. ~2 days. |
| P1.I | Retention enforcement | Automated purge per policy per table; nightly verification job. ~2 days. |
| P1.J | Sub-processor list + page | Placeholder until domain decided. ~0.5 day. |
| P1.K | Pen-test scope document | For vendor engagement (user commissions). ~1 day. |
| P1.L | Vendor TPRM process | Questionnaire library answered for Vercel, Neon, Upstash, Anthropic, Resend, Stripe, Voyage. ~2 days. |
| P1.M | Insurance broker engagement | **User-owned.** Cyber + E&O + GL quotes. |
| P1.N | Editorial review of customer-facing EN copy | **User-owned.** Engage editor. |
| P1.O | Native review of PL + DE copy | **User-owned.** Engage native reviewers. |

---

## 6. Phase 2 — First paying enterprise

**Duration:** 14–18 weeks (starts after P1 exit)  
**Goal:** sign and onboard the enterprise contract per [enterprise-ready-direction](../../../.claude/projects/-Users-oskarklepuszewski-Desktop-orcatrade-copy/memory/enterprise_ready_direction.md).

**Exit criteria:**
- First enterprise customer live on signed MSA + DPA + SLA
- Stripe metering produces EU-VAT-compliant invoices
- Trust centre live at `trust.orcatrade.*`
- SOC 2 programme kicked off with Vanta/Drata + auditor engaged
- CSM playbook used for the first customer

**Tasks:**

| ID | Task | Notes |
|---|---|---|
| P2.1 | Stripe metering — agent runs, document drafts, monitored SKUs, seats | Pricing decisions = user. Wiring = Claude. |
| P2.2 | Customer-facing API + scoped API keys + per-key rate limits | New endpoints under `/api/v1/public/*`. |
| P2.3 | OpenAPI spec + hosted docs (Scalar or Mintlify) | Auto-generated from contracts. |
| P2.4 | Webhook delivery — HMAC-signed, retried with backoff, replay UI | ~1 week. |
| P2.5 | First 2 alert integrations: Slack + MS Teams | OAuth in app-shell. |
| P2.6 | Real human-review queue + ops dashboard | Other end of P0.10 if tool kept. |
| P2.7 | In-app notifications inbox + email digest | Replaces ad-hoc emails. |
| P2.8 | Document workflow end-to-end | Broker submission, LC application, RFQ chain. Builds on existing draft system. |
| P2.9 | Demo environment with seeded data | Separate Vercel project + seed scripts. |
| P2.10 | Support stack — Plain or HelpScout + SLA matrix | User picks vendor; I wire widget + webhooks. |
| P2.11 | Public pricing page + tier limits | User defines tiers; I build the page. |
| P2.12 | Trust centre at `trust.orcatrade.*` | Controls, sub-processors, certs, pen-test letter, status link, security@, VDP, AI use disclosure, DPA download. |
| P2.13 | Legal pack | **User engages fractional commercial counsel.** I publish + version. ToS, Privacy, Cookie, MSA, DPA, SLA, AUP, MNDA. |
| P2.14 | Admin audit-log viewer in app-shell | Reads PG `audit_log` + chain verification UI. |
| P2.15 | In-app onboarding flow + first-value funnel | I build; CSM playbook = user. |
| P2.A | API governance | SemVer, deprecation policy (≥12 months), versioned at `/api/v1/`, client SDKs in TS + Python generated from OpenAPI. |
| P2.B | Real billing infrastructure | Invoicing, dunning, tax (Stripe Tax EU VAT MOSS), proforma invoices, PO support, NET 30/60 for enterprise. |
| P2.C | Customer health scoring + churn-risk dashboard | |
| P2.D | CSM playbook + onboarding kit | User operates; I scaffold. |
| P2.E | 24×7 sev1 support pager | On-call schedule with explicit handoff (even if just one person initially). |
| P2.F | Security questionnaire library | Pre-answered SIG Lite, CAIQ v4, common enterprise questionnaires. |
| P2.G | DPA library + negotiation playbook | For common asks (sub-processor pre-approval, data residency, breach notification SLA). |
| P2.H | MSA + Order Form templates | Counsel-drafted. |
| P2.I | Trust centre v1 (live) | Honest about no certs yet — say so. |
| P2.J | Public security@ + VDP | PGP key + safe-harbour language. |
| P2.K | Sales engineering enablement | Demo environment + scripts + competitive battle cards (user writes competitive; I script demos). |

---

## 7. Phase 3 — Operate like an SLA-bearing vendor

**Duration:** ongoing from P2; formal SRE programme established by P2+6 months.  
**Goal:** 99.9% measured uptime; real on-call; first sev1 incident handled cleanly.

**Tasks:**

| ID | Task | Owner |
|---|---|---|
| P3.1 | On-call rotation in PagerDuty/Opsgenie | User picks vendor + rotation; I wire alerts. |
| P3.2 | Runbooks per common failure | I write, user signs off. |
| P3.3 | Quarterly DR drill — PG restore + smoke | I script; we run together. |
| P3.4 | Post-mortem template + public-by-default policy | I template. |
| P3.5 | Annual pen test commissioned (Bishop Fox / NCC / Cobalt) | **User-engaged.** I prep scope. |
| P3.6 | Private bug bounty launch (Intigriti) | **User-funded.** I prep policy. |
| P3.7 | Vendor security review process | I document; user operates. |
| P3.8 | PII discovery automation | Quarterly scanner. |
| P3.9 | Encryption-at-rest + KMS verification documented | Existing Neon/Upstash settings documented. |
| P3.10 | SOC 2 Type I evidence collection (Vanta/Drata/Secureframe) | **User-engaged tool + auditor.** I wire integrations. |
| P3.11 | Incident commander training | User attends (PagerDuty U or similar). |
| P3.12 | Game days quarterly | Chaos against KV, PG, Anthropic, Resend. |
| P3.13 | Risk register maintained quarterly | Reported to whatever governance structure exists. |

**Phase 3 milestone:** SOC 2 Type I report received within 6 months of P3 kickoff.

---

## 8. Phase 4 — Multiple enterprises in parallel

**Duration:** 6–9 months (parallel with P3).  
**Goal:** repeatable sales motion + repeatable onboarding; 10+ paying enterprise customers; NPS measured; churn < 5%.

**Tasks:**

| ID | Task | Notes |
|---|---|---|
| P4.1 | Activation funnel instrumented | PostHog (self-hosted option for privacy). |
| P4.2 | One ERP integration | User picks first (QuickBooks or Xero) based on pipeline. |
| P4.3 | CRM wiring (HubSpot) | Signup, usage, billing events → CRM properties. User owns CRM config. |
| P4.4 | Scheduled PDF reports | Cron + pdf-lib (already in deps). |
| P4.5 | Mobile-responsive app-shell pass | Overdue; trade ops travel. |
| P4.6 | Multi-region data residency real | EU-only Vercel + Neon + KV region. |
| P4.7 | Background-job system | Vercel Queues / Inngest for retryable durable work. |
| P4.8 | Feature flags | GrowthBook OSS for safe rollouts. |
| P4.9 | DR drill institutionalised quarterly | Recurring cron + reminder. |
| P4.10 | Partner / referral programme | Track referrals → commission. User defines economics. |
| P4.A | ISO 27001 certification complete | |
| P4.B | SOC 2 Type II observation window complete; report received | |
| P4.C | Customer Advisory Board stood up | |
| P4.D | Reseller / channel programme | Partner agreement, portal, deal-registration. |
| P4.E | Localised contracts | DE-law MSA option, PL-law MSA option (counsel-drafted). |
| P4.F | Procurement integrations | Ariba, Coupa connectors if a customer requires. |

---

## 9. Phase 5 — Compliance certifications complete

**Duration:** 12–18 months from P3 kickoff.  
**Goal:** SOC 2 Type II + ISO 27001 + ISO 27701 + EU AI Act conformance complete; annual cadence established.

**Tasks:**
- SOC 2 Type II report (annual renewal)
- ISO 27001 certificate (3-year cycle + annual surveillance)
- **ISO 27701** (privacy management) — pairs with 27001; expected by EU enterprise buyers
- **EU AI Act conformance** — full Art. 50 + transparency obligations; voluntary code-of-practice signatory if helpful
- **TISAX** if any automotive customer requires; **C5** if any German public-sector customer requires
- Annual pen test, public bug bounty by year 2

---

## 10. Team-size implication (the honest part)

The corp-grade bar **cannot be met solo**, no matter how fast Claude works. Below is the minimum org to hold the bar once Phase 1 lands.

| Role | When needed | Why |
|---|---|---|
| Oskar (CEO/founder) | Now | Sales, strategy, vendor engagement, customer relationships |
| Senior engineer #2 | By end of Phase 1 | On-call cover; two-eyes review; SPOF mitigation |
| Fractional commercial counsel | Start of Phase 2 | MSA/DPA/SLA, customer negotiation, IP, employment |
| Fractional security/compliance lead | Start of Phase 2 | SOC 2/ISO programmes, threat modelling, vendor reviews |
| Designer / brand | Mid Phase 2 | Design system, brand guidelines, marketing creative |
| CSM #1 | First paying enterprise | Onboarding, QBRs, expansion, renewal |
| Fractional CFO / ops | Phase 2 | Billing operations, tax, audit prep, board reporting |
| SRE / platform engineer #3 | Phase 3 | Real on-call rotation needs ≥3 people for sustainable cover |
| Product manager | Phase 4 | Multi-customer prioritisation, roadmap discipline |
| Editor + native PL/DE reviewers | Start of Phase 1 | Big-corp copy bar means human editorial pass |

Claude can build the platform, the discipline scaffolding, the documentation, and the integrations that make these hires productive on day one. Claude cannot be those hires.

---

## 11. Timeline (honest, calendar-based from 2026-06-01 start)

| Phase | Window | Headline outcome |
|---|---|---|
| P0 — Stop lying + scaffold | 2026-06-01 → 2026-06-28 | Every claim true; CI gate real; engineering discipline scaffold live |
| P1 — Trust foundation | 2026-06-29 → 2026-09-20 | Survives a serious eng-DD and SIG Lite questionnaire |
| P2 — First paying enterprise | 2026-09-21 → 2027-01-24 | First MSA-signed customer live; SOC 2 programme in motion |
| P3 — SLA-bearing vendor | 2027-01-25 → ~2027-07 | 99.9% uptime measured; first sev1 handled cleanly; SOC 2 Type I received |
| P4 — Multi-enterprise | ~2027-04 → 2027-12 | 10+ enterprise customers; ISO 27001 certified |
| P5 — Compliance complete | 2027-01 → ~2028-07 | SOC 2 Type II + ISO 27001 + 27701 + EU AI Act conformance |

**First paying enterprise:** realistically late January 2027 (~8 months from start).  
**Big-corp posture (Type II + 27001 + 27701):** realistically mid-2028.

---

## 12. What Oskar must own (cannot be delegated to Claude)

| Area | Why |
|---|---|
| Hiring (engineer #2, designer, CSM, fractional CFO/security/counsel) | People decisions |
| Engaging Vanta/Drata + audit firm + pen-test vendor + bug-bounty platform | Contracts, money, vendor relationships |
| Engaging native PL/DE translators or an editorial team | Money + judgement on translator quality |
| Legal pack drafting (ToS/Privacy/MSA/DPA/SLA/AUP) | Requires commercial counsel signoff |
| Pricing decisions and tier limits | Strategic / commercial |
| First customer conversations / sales motion / activation playbook | Founder territory |
| Banking, insurance, finance ops, payroll | Out of code scope |
| Vendor picks: PagerDuty vs Opsgenie, Plain vs HelpScout vs Intercom, HubSpot vs Salesforce, Mixpanel vs PostHog | Shapes ops for years |

For each: Claude drafts requirements + recommended option; Oskar decides.

---

## 13. Cadence and reporting

- **Weekly check-in PR** at the end of each working week (5-line status: shipped / blocked / next-week / risks / changes-to-this-plan).
- **Phase-exit review** before starting the next phase — no auto-rolling.
- **Memory updates** in the same PR as any convention change.
- **This document is the single source of truth.** Plan changes via PR to this file — not Slack, not memory, not a separate doc.

---

## 14. Decisions log

| Date | Decision | Owner | Notes |
|---|---|---|---|
| 2026-05-30 | Adopt this plan as the canonical 18-month contract | Oskar + Claude | Supersedes ad-hoc sprint planning |
| 2026-05-30 | Raise the engineering bar to "big-corp standard" — measured against SAP GTS / Descartes / ONESOURCE | Oskar | See [feedback-corp-standard](../../../.claude/projects/-Users-oskarklepuszewski-Desktop-orcatrade-copy/memory/feedback_corp_standard.md) |
| **PENDING** | **P0.10:** kill or queue `requestHumanReview`? | Oskar to decide | Blocks Phase 0 kickoff |
| **PENDING** | **P0.11:** wire `lookupHsCode` to TARIC or remove? | Oskar to decide | Blocks Phase 0 kickoff |
| **PENDING** | **P0 scope confirmation:** 27 PRs / 4 weeks — confirm or trim? | Oskar to decide | Blocks Phase 0 kickoff |

---

## 15. Plan revision history

| Version | Date | Change | Author |
|---|---|---|---|
| v1 | 2026-05-30 | Initial plan after full audit; supersedes ad-hoc sprint planning | Claude (paired with Oskar) |
