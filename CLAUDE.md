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

## The three planning docs (read in this order for direction)

1. [docs/billion-dollar-plan.md](docs/billion-dollar-plan.md) — **apex plan.**
   Where the company is going (foundation re-platform + four pillars: agent
   autonomy, platform breadth, enterprise trust, product/GTM). Start here for
   "big picture" / "billion-dollar grade" asks.
2. [docs/dev-plan.md](docs/dev-plan.md) — week-to-week **product/SEO sprint
   tracker.** When the user says **"continue the development"** with no
   specifics: pick the topmost open sprint here, confirm in 1–2 sentences,
   then execute — **unless** we're explicitly mid-foundation/pillar push, in
   which case use the current Phase in the apex plan.
3. [docs/backend-grade-plan.md](docs/backend-grade-plan.md) — backend / infra
   / scale / enterprise / GDPR / observability / AI-eval vision (six tracks).

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

## Hard rules (some CI-enforced — see backend-grade-plan §"Non-negotiables")

1. **Calculator-grounded, always.** The LLM **never** produces a number that
   drives a decision. All money/quote math lives in
   `lib/intelligence/*-quote.js`. The AI layer only writes prose on top of
   deterministic results, with `[chunk-id]` citations and confidence tiers.
2. **Anthropic SDK imports only in `lib/handlers/` or `lib/ai/`.** Calculators
   stay LLM-free. (Import-graph test enforces this.)
3. **Integer-cents money.** No JS-float arithmetic on money in calculators.
   Use [lib/intelligence/money.js](lib/intelligence/money.js) (banker's
   rounding). Convert at boundaries via `fromEuro`/`toEuro`.
4. **No raw PII in Postgres or events.** Email is stored only as `email_hash`
   (SHA-256 first-16-hex). KV magic-token row + session cookie + Resend hold
   the raw address. Update `lib/handlers/account.js` delete pseudonymisation
   when adding events that carry email.
5. **Every mutation writes the audit log before returning success.**
6. **Every external HTTP call has timeout + fallback + retries.** Wrap
   upstreams in [lib/circuit.js](lib/circuit.js); log via [lib/log.js](lib/log.js).
7. **Stable `/api/v1/` contracts.** Breaking changes go to a new version.
8. **No secrets in logs, errors, or AI prompts.**

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
  [lib/handlers/orchestrator.js](lib/handlers/orchestrator.js) (merges 14 tools),
  `orchestrator-personal.js` (reasons over the signed-in user's own data).
- Prompts + evals + cost telemetry under [lib/ai/](lib/ai/). Prompt registry:
  `lib/ai/prompts/registry.js`. Eval scorer: `lib/ai/evals/scorer.js`.
- Discipline: cite `[chunk-id]` for every regulatory claim; cite the tool for
  every number; invoke `requestHumanReview` before anything irreversible.
- **Model:** legacy code is on `claude-sonnet-4-6`. The apex plan (Pillar I,
  I1) makes **Opus 4.7 the default** for customer-facing agent reasoning, with
  cheaper tiers only for work that never reaches a customer decision. Use the
  latest model IDs when touching agent model config.

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

Static HTML (744 pages), including **658 localised SEO guides (EN/PL/DE)** —
a real acquisition moat; don't break it. The flagship interactive surface is
the `/start/` Import Plan Builder wizard (also at `/pl/start/`, `/de/start/`).
Client JS in `js/`. SEO pages are generated by `scripts/generate-*.js`.
