# OrcaTrade — Project Instructions

Read this at the start of every session. It is the source of truth for what
this codebase is and how to work in it.

> **Note:** A `CLAUDE.md` for an unrelated project ("Smoof UK") lives in the
> parent folder (`~/Desktop/CLAUDE.md`). It does **not** apply here. This
> file is the authoritative one for OrcaTrade.

---

## What this is

**OrcaTrade** is an AI-native **trade-compliance & import-operations platform
for European SMEs sourcing from Asia**. Five domains, one platform: **search,
sourcing, intelligence (compliance), logistics, finance** — all delivering
**calculator-grounded** recommendations the user can trust. Coverage today:
EU/UK customs & duty, CBAM, EUDR, REACH, CE marking, anti-dumping /
countervailing duties, FX, routing, warehousing, working capital, TCO.

The product is the import operations team available 24/7 — see the apex
strategy in [docs/billion-dollar-plan.md](docs/billion-dollar-plan.md).

## The planning docs (read in this order for direction)

1. [docs/billion-dollar-plan.md](docs/billion-dollar-plan.md) — **apex plan.**
   Where the company is going (foundation re-platform + four pillars: agent
   autonomy, platform breadth, enterprise trust, product/GTM). Start here for
   "big picture" / "billion-dollar grade" asks.
2. [docs/dev-plan.md](docs/dev-plan.md) — week-to-week **product/SEO sprint
   tracker** + chronological history of shipped sprints. Useful as an audit
   log; do **not** rewrite past entries.
3. [docs/backend-grade-plan.md](docs/backend-grade-plan.md) — backend / infra
   / scale / enterprise / GDPR / observability / AI-eval vision (six tracks).

**For policy**, not direction, the binding source is
[docs/adr/](docs/adr/) — the Architecture Decision Records catalogue.
ADRs 0001-0019 cover every load-bearing rule (calculator-grounding,
SDK boundary, money discipline, audit-log-before-success, circuit
breakers, API-version stability, email pseudonymisation, conventional
commits, incremental TypeScript, security scanning, branch protection,
C4 diagrams, OpenAPI generation, the human-review queue, the
calculator-grounded HS-code lookup, the staged-smoke deploy gate, the
post-merge eval gate, and the docs-staleness floor tests). Each ADR
has a `## Confirmation` section naming the enforcement test that
prevents drift.

`CODEX.md` at the root is a **stale** old task spec — ignore it for direction.

## Architecture & current constraints

The codebase today is shaped by a lean, pre-funding posture. **The
billion-dollar-plan deliberately lifts these constraints going forward**
("invest now") — when building new foundation work, follow the apex plan, not
these legacy limits. But the *existing* code obeys:

- **Pure-JS, CommonJS** (`module.exports` / `require`). No build pipeline, no
  React (yet — a Next.js app shell is planned in the apex plan, Pillar IV/F5).
- **Zero npm deps in API routes.** The only runtime deps are
  `@anthropic-ai/sdk` and `@neondatabase/serverless` (see `package.json`).
  Don't add deps without a reason that maps to the apex plan.
- **Single Vercel function:** [api/[...path].js](api/[...path].js) dispatches
  ~50 logical endpoints to [lib/handlers/](lib/handlers/). This existed to
  stay under the Hobby 12-function cap. URL semantics are preserved
  (`/api/customs` → customs handler, etc.).
- **Deploy:** Vercel, auto-deploy on push to `main`. No long-lived branches —
  ship per sprint.

## Hard rules (CI-enforced — each rule cites its binding ADR)

1. **Calculator-grounded, always.** The LLM **never** produces a number that
   drives a decision. All money/quote math lives in
   `lib/intelligence/*-quote.js`. The AI layer only writes prose on top of
   deterministic results, with `[chunk-id]` citations and confidence tiers.
   ([ADR 0002](docs/adr/0002-llm-never-produces-decision-numbers.md))
2. **Anthropic SDK imports only in `lib/handlers/` or `lib/ai/`.** Calculators
   stay LLM-free. ([ADR 0003](docs/adr/0003-anthropic-sdk-boundary.md) —
   import-graph test enforces.)
3. **Integer-cents money.** No JS-float arithmetic on money in calculators.
   Use [lib/intelligence/money.js](lib/intelligence/money.js) (banker's
   rounding). Convert at boundaries via `fromEuro`/`toEuro`.
   ([ADR 0004](docs/adr/0004-integer-cents-money.md))
4. **No raw PII in Postgres or events.** Email is stored only as `email_hash`
   (SHA-256 first-16-hex). KV magic-token row + session cookie + Resend hold
   the raw address. Update `lib/handlers/account.js` delete pseudonymisation
   when adding events that carry email.
   ([ADR 0008](docs/adr/0008-email-pseudonymisation.md))
5. **Every mutation writes the audit log before returning success.** Failure of
   the audit subsystem surfaces as a 5xx, never silent.
   ([ADR 0005](docs/adr/0005-audit-log-before-success.md) — source-pin test
   asserts no `try { await events.record(...) } catch (_) {}` swallowing.)
6. **Every external HTTP call has timeout + fallback + retries.** Wrap
   upstreams in [lib/circuit.js](lib/circuit.js); log via [lib/log.js](lib/log.js).
   ([ADR 0006](docs/adr/0006-circuit-breaker-on-external-calls.md))
7. **Stable `/api/v1/` contracts.** Breaking changes go to a new version.
   ([ADR 0007](docs/adr/0007-api-v1-stable-contracts.md))
8. **No secrets in logs, errors, or AI prompts.**
9. **Tool-stub posture is banned for load-bearing agent tools.** Every tool the
   agent prompt instructs the model to call must do real work, with honest
   confidence signals — no `{ confidence: 0.0, message: "not yet wired" }`
   placeholders. ([ADR 0015](docs/adr/0015-human-review-queue.md) +
   [ADR 0016](docs/adr/0016-hs-code-lookup-calculator-grounded.md))
10. **Merge gating is staged.** PR-time `pr-smoke` probes the Vercel preview
    deployment before merge; post-deploy `smoke` is the prod tripwire;
    post-merge `eval-gate` catches reasoning regressions within ~5 min.
    ([ADR 0017](docs/adr/0017-pr-smoke-as-deploy-gate.md) +
    [ADR 0018](docs/adr/0018-eval-gate-post-merge-95pct.md))

## Data layer

- **KV (Upstash Redis)** is primary for ephemeral/high-frequency state:
  sessions, magic tokens, rate-limit counters, TARIC warm cache, circuit
  state. Store helpers in `lib/intelligence/kv-store.js` / `runtime-store.js`.
- **Neon Postgres** is landing as the durable corpus via **dual-write**
  (events, actuals, saved portfolios already write to both). Schema:
  [lib/db/schema.sql](lib/db/schema.sql), client: [lib/db/client.js](lib/db/client.js).
  Migrations run via `npm run db:migrate` (`scripts/db-migrate.js`), tracked
  in `schema_versions`. The apex plan promotes Postgres to primary.

## AI agents

Five agents + an orchestrator meta-agent, all tool-use loops grounded in the
calculators:
- [lib/handlers/agent.js](lib/handlers/agent.js) (compliance),
  `logistics-agent.js`, `sourcing-agent.js`, `finance-agent.js`,
  [lib/handlers/orchestrator.js](lib/handlers/orchestrator.js) (merges the
  full tool surface — 33 tools across the 4 specialists + delegation tools),
  `orchestrator-personal.js` (reasons over the signed-in user's own data).
- Prompts + evals + cost telemetry under [lib/ai/](lib/ai/). Prompt registry:
  `lib/ai/prompts/registry.js`. Eval scorer: `lib/ai/evals/scorer.js`. Live
  eval gate ([ADR 0018](docs/adr/0018-eval-gate-post-merge-95pct.md)) fires
  on `push: main` for AI-touching merges at ≥95% pass-rate per agent.
- Discipline: cite `[chunk-id]` for every regulatory claim; cite the tool for
  every number; invoke `requestHumanReview` (real KV-backed queue per
  [ADR 0015](docs/adr/0015-human-review-queue.md)) before anything
  irreversible.
- **Model registry:** the source of truth is [lib/ai/models.js](lib/ai/models.js).
  `MODELS.AGENT = claude-opus-4-7` (customer-facing reasoning),
  `MODELS.TRIAGE = claude-haiku-4-5` (intent routing — never reaches a
  decision), `MODELS.BULK = claude-sonnet-4-6` (high-volume mechanical
  sub-tasks). Use these constants; do not inline model-ID strings.

## How to work

- **Tests are the contract.** Run `npm test`
  (`ORCATRADE_DISABLE_LIVE_TARIC=1 node --test`). Suite is currently ~3,100+
  tests, all green — keep it green. New deterministic logic ships with unit
  tests; LLM-touching code gets eval cases, not brittle unit tests.
- **TypeScript: new code lands as `.ts`.** Strict `tsconfig.json` + `tsc --noEmit`
  via `npm run typecheck` runs in CI on every PR. Existing `.js` files are
  migrated incrementally: opt in with `// @ts-check` at the top + add JSDoc
  annotations. See [docs/adr/0010-typescript-incremental-adoption.md](docs/adr/0010-typescript-incremental-adoption.md).
- **Naming:** files kebab-case, functions/vars camelCase, DB columns snake_case.
- **User-facing copy is UK English.** EUR figures like `€179,100`; ISO-2
  country codes (CN, VN, DE, PL).
- **Commit per coherent change**, clear message. Push to `main` deploys.
  Commit/push only when the user asks.
- **Surface architectural decisions** rather than guessing — especially
  anything that touches the constraints above or the apex-plan phasing.

## Environment

Secrets in `.env.local` (gitignored); `.env.example` lists every variable.
Key ones: `ANTHROPIC_API_KEY` / `ORCATRADE_OS_API` (AI), `DATABASE_URL` (+
`DATABASE_URL_UNPOOLED`) for Neon, `KV_REST_API_*` / `UPSTASH_REDIS_REST_*`
for KV, `RESEND_API_KEY` (email), `STRIPE_*` (billing), `SENTRY_DSN`
(observability), `ORCATRADE_AUTH_SECRET`, `ORCATRADE_CRON_TOKEN`,
`ORCATRADE_LEADS_TOKEN`. Never log secrets or send them to the AI layer.

## Front-end surface (current, pre-app-shell)

Static HTML (~730 pages) including **~580 localised SEO guides (EN/PL/DE)** —
a real acquisition moat; don't break it. (Numbers shift as the daily content
rotation lands; treat as "in the high-700s / high-500s" rather than precise
when reasoning about scale.) The flagship interactive surface is the
`/start/` Import Plan Builder wizard (also at `/pl/start/`, `/de/start/`).
Client JS in `js/`. SEO pages are generated by `scripts/generate-*.js`.
