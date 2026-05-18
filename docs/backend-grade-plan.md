# OrcaTrade — Backend Grade Plan

**Author:** Claude (with Oskar Klepuszewski)
**Created:** 2026-05-16
**Status:** Living strategic document — separate from [dev-plan.md](dev-plan.md).
**Companion doc:** [dev-plan.md](dev-plan.md) is the sprint-level tracker
(what ships next week). This doc is the **multi-quarter backend vision**
(what has to be true for OrcaTrade to credibly carry a billion-EUR
company through Series A → Series C without a rewrite).

---

## North star

The backend has to be **boring under pressure**: invisible when things
go right, instantly diagnosable when things go wrong, and never the
reason a paying enterprise customer churns.

What that means concretely:

1. **Every euro shown to a customer is reproducible** — same inputs,
   same outputs, forever, with the exact calculator version + data
   snapshot recorded alongside the result.
2. **Every state change is observable** — who did what, when, against
   which entity, with before/after state.
3. **Every external dependency is degradable** — TARIC down, Resend
   down, Stripe down, Claude down: the platform still answers.
4. **Every customer can leave with their data in 30 seconds** — GDPR
   data export is a button, not a support ticket.
5. **Every change is reversible** — staging gate, canary deploy,
   feature flag, kill switch.

If a change makes any of those five things less true, it doesn't ship.

---

## Non-negotiables (CI-enforced from Track 1)

Hard rules. These get tests, not just principles. Violations break
`node --test` and block deploy.

| # | Rule | Enforced by |
|---|---|---|
| 1 | No JS-number arithmetic on monetary values in `lib/intelligence/*-quote.js`. All money in integer minor units (cents) or a documented Decimal helper. | grep test + linter |
| 2 | No PII in `lib/events.js` records. Email allowed only as opaque hash. | schema test on event types |
| 3 | All timestamps stored as ISO-8601 UTC with explicit `Z` suffix. | regex test on date fields |
| 4 | All `Anthropic` imports live under `lib/handlers/` or `lib/ai/`. Calculators stay LLM-free. | import-graph test |
| 5 | Every mutation handler writes to the audit log before returning success. | handler harness test |
| 6 | Every external HTTP call has timeout + fallback + retries documented. | static check on `fetch` usage |
| 7 | Every endpoint exposes a stable contract under `/api/v1/` once Track 1 ships. Breaking changes go to `/api/v2/`. | contract test |
| 8 | No secret value appears in `console.log`, error messages, or AI prompts. | redaction middleware test |

---

## The six tracks

Each track has its own gate (when it's "done enough" for the next one
to start). Tracks run in parallel where dependencies allow — the
phasing section at the bottom shows the actual calendar.

---

### Track 1 — Correctness & data integrity

**Why this is first:** Everything else builds on numerical truth. If
landed costs drift by €5 between two identical runs, no enterprise
finance team will sign a procurement contract on our numbers.

#### 1.1 Decimal money math migration
- New `lib/intelligence/money.js`: `fromEuro(n) → cents`, `toEuro(c)`,
  `add/sub/mul/div` returning cents, `round(c, mode)` for banker's
  rounding.
- Migrate `customs-quote.js`, `sourcing-quote.js`, `finance-quote.js`,
  `tco-quote.js`, `working-capital.js`, `fx-quote.js`, `insurance-quote.js`,
  `routing-quote.js`, `warehouse-quote.js`, `sample-quote.js`,
  `returns-quote.js`, `buyer-verification.js` to integer-cents internally.
- Public quote shape keeps EUR floats for backward compat — formatting
  happens at the edge only.
- Regression test: same input through old vs. new calculator must
  produce identical formatted output to 2dp. Snapshot 100 plans first,
  diff after migration.

#### 1.2 Calculator regression harness
- `test/calculator-regression.test.js`: 200+ canonical scenarios from
  `lib/intelligence/data/` and worked examples.
- Each scenario has a frozen expected output JSON.
- Git pre-commit hook blocks calculator changes without snapshot review.
- Sentinel test: every published quote on `/examples/*` must still
  evaluate to the same headline number it shipped with.

#### 1.3 Reality-check loop
- Add `actuals` table (Postgres, see Track 2): saved plan +
  customer-reported actual landed cost, freight, duty.
- Quarterly script computes calibration delta per calculator
  component; reports outliers.
- Becomes input to Track 6 (AI eval) and to data-moat narrative for
  Series A.

**Gate:** all 12 calculators migrated, regression harness green,
calibration table receiving its first 10 actuals submissions.

---

### Track 2 — Persistence & analytics

**Why now (not post-funding):** KV is wrong for three things the
business needs *before* the seed round closes: relational queries
(audit log, org/seat membership, multi-criteria analytics), durable
event storage past the 5,000-event cap, and SQL for investor diligence
("show me revenue cohort by industry by month"). Cost is €0–€25/mo on
Neon free + Supabase free tiers; risk of staying KV-only is a
forced-rewrite mid-fundraise.

**Architecture:** Postgres becomes **source of truth** for relational
data; KV stays as **cache + rate-limit + magic-link store**. No
calculator depends on Postgres at request time — calculators stay pure.

#### 2.1 Provision + schema
- Choose Neon (cheaper read-replica story for analytics) vs Supabase
  (built-in auth + RLS, but we already have magic-link). Recommendation:
  **Neon** — keep auth on our side, use Postgres as a dumb relational store.
- Schema v1 (`lib/db/schema.sql`):
  - `users` (id, email_hash, created_at, last_seen_at)
  - `organisations` (id, name, slug, plan_tier, created_at)
  - `memberships` (user_id, org_id, role, invited_at, joined_at)
  - `saved_plans` (id, org_id, user_id, share_code, plan_json, snapshot_json, created_at, archived_at)
  - `audit_log` (id, actor_user_id, org_id, entity_type, entity_id, action, before, after, created_at, request_id)
  - `events` (id, org_id, type, payload, created_at — partitioned monthly)
  - `actuals` (id, plan_id, reported_landed_eur, reported_duty_eur, reported_freight_eur, reported_at, reported_by)
  - `subscriptions` (id, org_id, stripe_customer_id, stripe_sub_id, tier, status, current_period_end)
  - `prompt_runs` (id, agent, prompt_version, input_hash, output_hash, latency_ms, cost_cents, created_at)

#### 2.2 KV → Postgres migration of high-value stores
- `saved-plans` migration: dual-write for 30 days, read-from-PG with
  KV fallback, then KV-deprecate.
- `events` migration: same dual-write pattern; the existing
  `import_plan_generated`, `plan_saved`, `founding_applied` shapes
  preserved, just additionally rowed into Postgres.
- KV stays as-is for: magic tokens, sessions, rate-limit counters,
  TARIC cache, quota counters.

#### 2.3 Analytics views
- Materialised views for the leads dashboard:
  `mv_plans_by_category_month`, `mv_routes_by_destination`,
  `mv_founding_funnel`, `mv_actuals_calibration`.
- Refresh on a 15-min schedule via cron handler.
- `/dashboard/leads/` rewritten to read views instead of scanning the
  KV event stream — unlocks the 5,000-cap.

**Gate:** Postgres provisioned, schema migrated, dual-write live,
leads dashboard reads from PG, audit log captures 100% of mutations.

---

### Track 3 — Tenancy, auth maturity & enterprise gates

**Why:** the Team tier is published on the pricing page; today it has
no seat model. Every conversation with a company larger than 5 people
hits this limit immediately. SSO is the table-stakes ask for
procurement at any company over 200 employees.

#### 3.1 Organisation + seat model
- New `lib/orgs.js`: create org, invite (email + token), accept,
  remove, transfer ownership.
- Tier moves from `tier:<email>` to `tier:<org_id>` keyed by
  Postgres `organisations.id`.
- Existing per-email users auto-create a personal org on first session
  after deploy — zero-friction migration.
- Role per membership: `owner`, `admin`, `member`. Stripe billing is
  org-level; only owners can change billing. Plans are org-visible by
  default; per-plan ACL deferred.

#### 3.2 Auth hardening
- Session rotation: new session id on tier upgrade, role change, or
  password (if added).
- Revocation list in KV: `revoked:session:<id>` with TTL = remaining
  cookie life. Every request checks.
- Login event stream: ip, ua, geo (CF header), timestamp. Anomalous
  login → email the user.
- Optional TOTP MFA (`/account/security/`): `otpauth://` URL + QR via
  a pure-JS generator. Backup codes generated, hashed-stored.

#### 3.3 SSO seam (WorkOS-compatible, build-our-own)
- `/api/auth/sso/initiate` → 302 to IdP.
- `/api/auth/sso/callback` → SAMLResponse parse via a small zero-dep
  Node XML parser (already-vetted snippet), assertion signature check
  against per-org cert.
- Per-org `sso_config` row: idp_metadata_url, cert, entity_id,
  default_role.
- v1 = SAML only; OIDC + SCIM later when a real customer asks.

**Gate:** orgs live, seats invite-able, tier moved to org-level, SSO
working end-to-end against a test IdP (e.g. samltest.id).

---

### Track 4 — Observability & reliability

**Why:** today, "is the site healthy?" is answered by visiting it.
Stripe webhooks can fail silently. TARIC outages aren't paged. Founding
10 applicants could be dropping at the email step and we wouldn't know
for a week.

#### 4.1 Structured logging
- New `lib/log.js`: `log.info|warn|error|debug({event, ...fields})`.
  Every handler swaps `console.log` for `log.*`.
- Output: JSON-per-line to stdout (Vercel captures).
- Ship to **Axiom** (better free tier than Datadog/Honeycomb for our
  volume) via their REST drain. Zero npm — POST in `lib/log.js`.
- Add `request_id` middleware: every response gets `x-request-id`
  header, every log line includes it. Audit log entries reference it.

#### 4.2 Error tracking
- **Sentry** via REST API (their `/api/<id>/envelope/` endpoint, no
  SDK needed). Wrap the router's catch-all in a `captureException`.
- Source maps not needed (pure JS, no build).
- Release tagging from `process.env.VERCEL_GIT_COMMIT_SHA`.

#### 4.3 Health + status
- New `/api/health` endpoint: 200 if KV reachable, Postgres reachable,
  Resend OK, Stripe OK, TARIC last-fetch < 24h ago.
- Public `/status/` page rendered from cached health snapshots
  (15-min cron).
- Uptime probe: GitHub Actions schedule (already in use for TARIC
  warmer) hits `/api/health` every 5 min; failure → Resend email to
  Oskar + PagerDuty-lite via Slack webhook.

#### 4.4 Circuit breakers
- New `lib/circuit.js`: per-upstream `{ state: closed|open|half-open,
  failures, openedAt }` in KV.
- Wrap TARIC, Resend, Stripe, Anthropic calls. Open → return fallback
  + log. Half-open after 60s; one probe re-closes if it succeeds.
- Each calculator that depends on TARIC live data has a tested chapter
  fallback already (Sprint D.1) — formalise as the circuit-open path.

#### 4.5 Background queue
- Vercel cron is fine for nightly TARIC warm + 15-min analytics
  refresh. For user-triggered async work (large PDF export, bulk
  plan re-evaluation, applicant email retries), introduce **QStash**
  (Upstash, REST-only, no npm). `POST /api/cron/<job>` with HMAC
  verification; retries handled by QStash.
- Move the existing applicant email send into a fire-and-forget queue
  publish so a Resend outage doesn't 500 the founding form.

**Gate:** every handler logs structured + request-id, errors go to
Sentry, `/api/health` green in production, circuit breakers wrapping
all four upstreams, QStash live for one job.

---

### Track 5 — Compliance, privacy & enterprise readiness

**Why:** OrcaTrade's target buyer is an EU SME. The first
procurement-led customer will send a security questionnaire. Without
GDPR mechanics and a basic DPA, that conversation ends.

#### 5.1 GDPR mechanics
- `GET /api/account/export` — returns a ZIP of every record tied to
  the user: profile, sessions log, saved plans, events, audit log,
  Stripe customer reference. Streamed.
- `POST /api/account/delete` — soft-delete on user + cascade
  pseudonymise on rows (replace email with `deleted-<hash>`, blank
  free-text fields). Stripe subscription cancelled at period end.
  Hard-delete after 30-day grace.
- `/account/privacy/` UI page exposes both.

#### 5.2 Consent + cookie management
- Cookie banner v2: granular toggles (essential / analytics /
  marketing). Persists in `consent:<session>` KV with timestamp.
- Vercel Analytics + any future tag only fire if analytics consent
  given.
- Server-side log redaction: incoming requests stripped of common PII
  fields before being logged.

#### 5.3 Audit log surfacing
- `/dashboard/audit/` (admin role only) — filterable view of the
  `audit_log` table for the current org.
- Export-to-CSV.
- Becomes evidence in security questionnaires.

#### 5.4 Documentation gates
- `docs/security/` directory:
  - `data-flow.md` — what data we hold, where, for how long
  - `subprocessors.md` — Vercel, Upstash, Neon, Resend, Stripe,
    Anthropic, Axiom, Sentry, QStash
  - `dpa-template.md` — drop-in for prospects to sign
  - `incident-response.md` — what we do when something goes wrong
  - `soc2-readiness.md` — gap analysis vs SOC 2 Type I

**Gate:** export + delete endpoints live and tested, banner v2 live,
audit dashboard live, security docs published under `/security/`.

---

### Track 6 — AI quality moat

**Why:** every agent today shares a hand-tuned system prompt. When
Claude 4.7 → 5 lands (or when a competitor copies our agents),
we have no quantitative way to say "ours is better." The eval harness
is the moat.

#### 6.1 Prompt registry
- `lib/ai/prompts/<agent>/v<n>.txt` — versioned, immutable once
  shipped.
- Handler reads via `getPrompt(agent, version)`; tier-gated feature
  flag selects version per request.
- Every Anthropic call logs `{ agent, prompt_version, input_hash,
  output_hash, latency_ms, cost_cents }` to `prompt_runs` table.

#### 6.2 Eval harness
- `test/agent-eval-cases.json` becomes `lib/ai/evals/<agent>/cases.json`.
- Each case: `{ id, input, must_contain, must_not_contain,
  expected_intent, expected_calc_grounding }`.
- New `scripts/run-evals.js`: runs every case against current prompt,
  scores deterministic checks (regex contains, intent match,
  calc-grounded number presence), uses Claude as judge for prose
  quality with a fixed rubric.
- Run nightly via cron; results → Postgres `prompt_runs`; trend chart
  on `/dashboard/ai/`.
- Block PR merge if eval score drops > 5% vs main.

#### 6.3 Calc-grounding enforcement
- Programmatic check: every numeric token in agent output (€-prefixed,
  %-suffixed, kg/m³) must trace to a value produced by a calculator
  in the same request. Anything else is a hallucination and the
  response is rejected → retry once → fall back to a non-numeric
  reply.
- Already partially enforced via prompt engineering; this codifies it.

#### 6.4 Cost telemetry
- `/dashboard/ai/` shows: total spend by agent, by prompt version,
  by tier, by week.
- Per-tier rate-limit on agent calls scales by tier.cost-cap so a
  single Free user can't burn a budget.

**Gate:** every agent under prompt registry, evals running nightly
with a baseline score, cost dashboard live, calc-grounding check
deployed.

---

## Phasing — what runs when

Sessions are still ~1–2 hours of focused work. Tracks are not strict
sequences; some pieces are sprint-sized, others span sprints. The
order below is what I'd commit to if no external signal redirects.

### Phase α (next 4 sprints — foundations) — May 2026

- **Sprint BG-1:** Decimal money math (Track 1.1) — biggest correctness
  unlock, biggest risk of regressions, do it first while the test
  baseline is fresh.
- **Sprint BG-2:** Neon provision + schema v1 + dual-write for events
  + audit-log middleware (Track 2.1, 2.2 partial).
- **Sprint BG-3:** Structured logging + Sentry + request-id (Track 4.1, 4.2).
- **Sprint BG-4:** GDPR export + delete + cookie banner v2 + security
  docs skeleton (Track 5.1, 5.2, 5.4).

### Phase β (4 sprints — enterprise gates) — June 2026

- **Sprint BG-5:** Org + seat model + tier-by-org migration (Track 3.1).
- **Sprint BG-6:** Saved-plans + events migration completed; KV
  deprecation list (Track 2.2).
- **Sprint BG-7:** Health endpoint + status page + circuit breakers +
  uptime probe (Track 4.3, 4.4).
- **Sprint BG-8:** Audit dashboard + materialised-view analytics
  (Tracks 2.3, 5.3).

### Phase γ (4 sprints — moat) — July 2026

- **Sprint BG-9:** Calculator regression harness + reality-check loop
  table (Track 1.2, 1.3).
- **Sprint BG-10:** Prompt registry + cost telemetry (Track 6.1, 6.4).
- **Sprint BG-11:** Eval harness + calc-grounding enforcement (Track 6.2, 6.3).
- **Sprint BG-12:** SSO seam + session rotation + TOTP MFA (Track 3.2, 3.3).

### Phase δ (ongoing — kept always)

- QStash queue extended to more jobs as the need arises (Track 4.5).
- SOC 2 readiness work runs in background — checklist completion
  becomes a quarterly review, not a sprint.
- Eval harness cases grow with every shipped agent change.

### What this does NOT include (deliberate)

- **Multi-region Postgres.** Single region (Frankfurt) until traffic
  forces otherwise.
- **GraphQL.** REST `/api/v1/*` only.
- **Microservice split.** The single-function router stays until
  Vercel Hobby → Pro and an actual cold-start problem appears.
- **Real-time / websockets.** No customer asks for it yet.
- **Kubernetes / self-hosting.** Vercel + Neon + Upstash is fine
  through Series A.
- **Custom CRM / ticketing.** Use Linear + HubSpot when needed.

---

## API contract stability

Once Track 1 ships, the public contract lives at `/api/v1/*`.

- Existing `/api/<name>` paths alias to `/api/v1/<name>` with a
  deprecation header.
- Breaking changes go to `/api/v2/<name>` with both versions live for
  90 days.
- Contract test (Track 1's non-negotiable #7): every v1 response shape
  has a frozen JSON Schema in `lib/contracts/v1/`. Schema drift breaks
  CI.
- Public partners (when they exist) consume v1 only.

---

## Cost envelope

Phase α–γ should add no more than €100/month in infra cost on top of
what's there today:

| Service | Free? | Cost at 1k MAU |
|---|---|---|
| Vercel Hobby | Yes | €0 (Pro at €20/mo if function count grows) |
| Neon Free | Yes | €0 (Scale at €19/mo when storage > 0.5GB) |
| Upstash Redis | Yes | €0 |
| QStash | Yes | €0 (500 msg/day free) |
| Resend | Yes | €0 (3k/mo free, then €20/mo) |
| Sentry | Yes | €0 (5k errors free) |
| Axiom | Yes | €0 (0.5TB ingest free) |
| Stripe | n/a | 1.5% + €0.25 EU |
| Anthropic | n/a | scales with usage |

Total fixed-cost ceiling pre-funding: ~€80/mo. Anthropic + Stripe
scale with revenue, so net cost-of-goods stays linear with usage.

---

## How future-me should use this document

When the user asks for backend work — auth, scale, data integrity,
observability, compliance — read this file before [dev-plan.md](dev-plan.md).

When the user asks "what's the next thing to build" with no scope
hint, default to **[dev-plan.md](dev-plan.md)** (product/marketing
sprints). When they explicitly mention backend, infra, scale,
enterprise, security, GDPR, audit, performance, reliability — default
to this doc and pick the topmost open phase.

Picking the next sprint:
1. Confirm in 1–2 sentences which sprint and why.
2. Execute. Ship tests + commit + push.
3. Update the log below.

If a sprint's scope shifts during execution, write what actually
shipped — never pretend a sprint was as scoped.

---

## Update log

| Date | Sprint | Notes |
|---|---|---|
| 2026-05-16 | doc created | Strategic backend plan stood up alongside dev-plan.md. Six tracks defined. Phasing α/β/γ established. No code shipped yet — first execution sprint is BG-1 (decimal money math). |
| 2026-05-16 | BG-0a — customs dedupe + effectiveLandedCostEur | calculateQuote / calculateQuoteAsync collapsed onto a shared composeQuoteResult helper (~70 lines of duplication gone). New finance-grade field effectiveLandedCostEur (customs + duty + brokerage + ENS, net of recoverable VAT) on standard + bonded scenarios. +4 tests including a sync/async shape-parity check that pins the dedupe. 1,344 → 1,348 tests. |
| 2026-05-16 | BG-0b — surface P&L cost end-to-end | totals.effectiveLandedTotal and vatRecoverableEur on every plan response; same on every originSensitivity matrix row including annualEffectiveLanded. New statLandedEffective i18n key (EN/PL/DE). Sub-stat under the "Total landed cost" tile in the wizard result. 1,348 → 1,349 tests. |
| 2026-05-16 | BG-1 phase 1 — money.js primitives | New lib/intelligence/money.js with integer-cents arithmetic, half-even rounding, fromEuro/toEuro that avoids the 0.1*100 float trap. 25 new tests covering: 0.1+0.2 = 0.3 exact, banker's vs naive rounding asymmetry, customs compounding at €100k and €5M scale (zero drift), Finland 25.5% VAT on irregular base. Type/range guard rails throw on bad inputs. No calculator migrated yet — that's phase 2. 1,349 → 1,374 tests. |
| 2026-05-17 | BG-1 phase 2 — customs-quote migrated to integer cents | First calculator now consumes money.js. calculateStandardClearance, calculateBondedWarehouse, and composeQuoteResult all do compound arithmetic in integer cents internally; floats reappear only at the result-object boundary via M.toEuro(). The legacy `round()` helper stays for the few non-money fields (bondedVolumeCbm) but every duty / VAT / brokerage / bonded-ops / cashflow-benefit value now passes through half-even rounding once at the conversion edge instead of accumulating float drift across compounding steps. +2 precision tests assert cent-level exactness on a €4.5M shipment compound and on the bonded scenario's component sum. All pre-existing tests pass unchanged — migration was behavior-preserving for every value already in the test corpus. 1,374 → 1,376 tests. |
| 2026-05-17 | BG-0c — plan-diff tracks effectiveLandedTotal | SNAPSHOT_FIELDS gains effectiveLandedTotal; extractSnapshot captures it; diffSnapshots emits effectiveLandedDeltaEur + effectiveLandedDeltaPct when both sides recorded the value (null on legacy snapshots — no false-positive deltas). +5 tests. Closes the P&L-cost feature loop opened in BG-0a/BG-0b: returning users now see how their P&L cost moved alongside the gross landed total. 1,376 → 1,381 tests. |
| 2026-05-17 | BG-4.1 phase 1 — structured logging | New lib/log.js: JSON-per-line output, four levels (debug/info/warn/error) gated by ORCATRADE_LOG_LEVEL, withContext({ handler, action }) for handler-level binding, automatic PII redaction (email/token/secret/apiKey/cookie/authorization redacted to first-2-chars + `***`), Error instance serialisation (name+message+stack), 12-hex-char generateRequestId. api/[...path].js gains a request-id middleware: honour caller's x-request-id if shaped right, else mint one; attach to req.requestId; echo on response x-request-id header; include in router-level error log. Three highest-leverage handlers migrated: auth, founding, start — every console.* gone, every log line structured. 18 log.js tests cover level filtering, JSON shape, PII redaction (incl. case-insensitive + nested + array), Error serialisation, context chaining, request-id generation, non-string msg coercion. 1,381 → 1,399 tests. |
| 2026-05-17 | BG-4.3 — /api/health operational probe | New lib/handlers/health.js: GET /api/health returns structured status for five subsystems — kv (round-trip probe with latency), taric (read kv key `taric:warm:lastRun`, degrade > 25h since nightly cron), resend / stripe / anthropic (env-var presence; anthropic accepts ANTHROPIC_API_KEY or legacy ORCATRADE_OS_API). Aggregation policy: kv-down → "down" + HTTP 503 (uptime probe pages); any subsystem degraded → "degraded" + HTTP 200; all-ok → "ok". Cache-Control: no-store. Payload carries requestId, ts, version (Vercel commit SHA). lib/handlers/cron.js taric-warm job now stamps the timestamp the probe reads, with a 7-day TTL. 17 tests cover aggregate matrix, kv round-trip, taric stale/recent/invalid timestamp branches, env-var present/missing, anthropic-OR-legacy fallback, 405 on non-GET, end-to-end 200/degraded paths, no-store header. Caught a real async/env bug in the test helper (sync `finally` restored env vars before the awaited test code ran) — now `withEnv` is properly async. 1,399 → 1,416 tests. |
| 2026-05-17 | BG-4.4 — circuit breakers around upstreams | New lib/circuit.js: per-upstream three-state circuit (closed → counting failures → open after threshold → half-open after cooldown → closed on probe success). State in KV at `circuit:<name>`, 24h TTL (auto-heals via half-open). Public API: `await circuit.run(name, fn, { fallback, threshold?, cooldownMs? })`, plus `state(name)` and `reset(name)` admin override. Fallback function is REQUIRED — no "throw the original" escape hatch. Wrapped Resend in lib/handlers/start.js and lib/handlers/auth.js with shared 'resend' name (one breaker, both consumers benefit). Health endpoint now reads circuit state and overlays it onto the resend subsystem: env var present but circuit open → degraded with `reason: "circuit open"` and `circuit: "open"` fields. 17 circuit tests cover: pure state transitions (closed/open/half-open/cooldown), threshold counting, recovery on success, half-open probe success path, half-open probe failure (reopens immediately, no slow re-counting), short-circuit skip of fn, fallback args (shortCircuited/state/err), fallback-required guard, state() public API, reset() admin override, success-clears-failure-count. Plus 2 health/circuit integration tests. 1,416 → 1,433 tests. |
| 2026-05-17 | BG-4 closeout — public /status/ + uptime workflow | Visible UX layer on top of /api/health. status/index.html polls /api/health every 30s, renders subsystem cards with status pills (ok/degraded/down) + traffic-light overall banner + circuit-state details, falls back to a "status page can't reach platform" banner if the fetch itself fails. New .github/workflows/uptime.yml: hits /api/health every 5 min, fails the run on HTTP 503 (kv-down paging condition), surfaces "::warning::" annotations on degraded subsystems. 8 markup-contract tests pin the page (noindex, /api/health target, required DOM ids, legend rows, every subsystem labelled, setInterval 30s, contact link). Closes Track 4 of backend-grade-plan.md end-to-end: structured logs (4.1) → health probe (4.3) → circuit breakers (4.4) → visible status surface + uptime monitor. 1,433 → 1,441 tests. |
| 2026-05-17 | BG-5.1 — GDPR data subject endpoints | First implementation of Track 5 of backend-grade-plan.md. New lib/handlers/account.js with two sub-actions dispatched by URL segment: GET /api/account/export (Art 20 — data portability) returns a streamed JSON dump with format:"orcatrade-gdpr-export-v1" carrying saved plans, matching events (filtered by email), session metadata, and a notes block explaining what is + isn't included; Content-Disposition: attachment forces download. POST /api/account/delete (Art 17 — right to erasure) requires { confirm: true }, hard-deletes saved plans, pseudonymises every event whose email matches (replaced with `deleted-<sha256-prefix>@anonymised.local`, free-text fields like name/company/role/message overwritten with "deleted", plus pseudonymised:true and pseudonymisedAt timestamp), clears the session cookie, and writes an audit log line carrying only the email hash (no PII). Both endpoints 401 without a valid session cookie. emailHash is deterministic + case-insensitive so the same user always pseudonymises to the same identity. 14 tests: auth gating (no cookie, malformed cookie, both endpoints), unknown sub-action 404, emailHash determinism, pseudonym format, export shape (own plans + own events only, headers, empty inbox), delete confirmation guard, delete end-to-end (plans gone, events pseudonymised, other user untouched, cookie cleared), empty-user delete still 200, OPTIONS preflight, method gating. Enterprise procurement security questionnaires can now be answered "yes — Article 20 + 17 are wired and tested." 1,441 → 1,455 tests. |
| 2026-05-17 | BG-5.1 closeout — /account/privacy/ UI | Self-service UI on top of the BG-5.1 endpoints. account/privacy/index.html: two cards (Export your data + Delete your account) wired to the GDPR endpoints. Export triggers a Blob-download with right filename. Delete enforces typed-email confirmation + browser confirm() dialog before POSTing { confirm: true }. Bootstraps from /api/auth/me (auth-needed panel for signed-out users). /account/ gets a Privacy & data quick-link. 9 markup-contract tests. 1,455 → 1,464 tests. |
| 2026-05-17 | BG-5.4 — security documentation set | New docs/security/ folder. Five enterprise-ready documents + an index README, dated and signed by the founder. data-flow.md (what data, where, retention; GDPR right → endpoint map). subprocessors.md (every third party with DPA link, region, scope; planned vs active; cookies-by-provider table). dpa-template.md (Article 28 DPA + Annex A TOMs across access/encryption/logging/resilience/data-integrity/personnel/incident-response/backup/vendor-mgmt). incident-response.md (4 severity classes with SLAs, runbooks for KV-down + Resend-429 + LLM-content + credential-leak, candid section on current gaps — no 24/7 on-call, no tabletop drills yet). soc2-readiness.md (honest TSC gap analysis with ✅/🟡/❌ legend across CC1-CC9 + Availability + Processing Integrity + Confidentiality + Privacy; headline gaps to close before Type I; share-tier guidance). README.md indexes everything + sets quarterly review cadence. 10 contract tests pin existence, non-stub content (no TODO/FIXME/lorem), Last-reviewed dates, README links, cross-doc link resolution, subprocessor coverage, Article 28 essentials, SEV severity coverage, TSC coverage, GDPR Article mapping. Tier-3 enterprise contracts can now reference real artefacts. 1,464 → 1,474 tests. |
| 2026-05-17 | BG-5.2 — cookie consent banner v2 (granular, consent-gated analytics) | New js/cookie-consent.js: granular consent banner with essential (forced on) + analytics (opt-in, default off) categories, tri-locale (EN/PL/DE), persists `orcatrade.consent.v1` in localStorage with version stamp + decidedAt ISO. Vercel Analytics now loads ONLY after analytics consent — the `/_vercel/insights/script.js` tag is injected dynamically by the consent module, never on initial page-load. Tamper-resistant: even a manually edited localStorage with `essential:false` reads back as `essential:true`. scripts/inject-favicon-tags.js bumped to analytics v2 marker and now ships the consent loader instead of the raw insights script; legacy v1-marked pages get auto-cleaned on re-inject. 685 pages re-injected. Public API: `window.orcatradeConsent.{get,has,set,open}` for other scripts; `[data-cookie-preferences]` data-attribute reopens the banner from any element. 10 new tests: module surface contract (locales, API, versioned storage, anti-tamper essential, footer hook), favicon-injector contract (loads consent module not Vercel directly), live module behaviour via node:vm with stubbed DOM (set/get round-trip, tampered-essential force-correction). test/og-meta.test.js updated to assert the new v2 marker and the absence of unconditional Vercel Analytics script. Security docs updated: data-flow.md, subprocessors.md, soc2-readiness.md all mark Track 5.2 as ✅ shipped. P2 Privacy criterion in soc2-readiness.md moves from 🟡 to ✅. 1,474 → 1,484 tests. |
| 2026-05-17 | BG-6.1 — prompt registry foundation | First implementation of Track 6 (AI quality moat). New lib/ai/prompts/registry.js with versioned + immutable-once-shipped prompts, getPrompt(agent, version) with deploy-bug-grade throw on missing, listVersions / latestVersion / getLatest convenience, hashPrompt (SHA-256 first-12-hex) for eval-log correlation, path-traversal guards on both agent and version params. One file per version (v1.txt, v2.txt, …), one folder per agent. orchestrator's SYSTEM_PROMPT extracted from inline JS to lib/ai/prompts/orchestrator/v1.txt; lib/handlers/orchestrator.js now reads it via registry.getPrompt('orchestrator', ORCHESTRATOR_PROMPT_VERSION) and exports the version + hash. 15 tests pin: empty for unknown agent, sorted versions list, latest = highest, throw on unknown agent, path-traversal guard (agent + version), invalid version format, content + LF normalisation, cache identity, throw on missing version, getLatest matches explicit, hashPrompt determinism + 12-hex format, hash differs by content, orchestrator handler reads via registry (no inline drift), v1 prompt content tripwire (Operations Orchestrator + ABSOLUTE RULES + VERDICT + requestHumanReview), every agent dir has at least one v<n>.txt. Track 6.2 (eval harness) now has a stable prompt-version key to score against. 1,484 → 1,499 tests. |
| 2026-05-17 | BG-6.2 phase 1 — offline eval harness | Track 6 second piece. New lib/ai/evals/scorer.js: pure-function scorer that runs in <50ms with no API calls and validates response text against per-case mustContain / mustNotContain pattern lists. Patterns starting+ending with `/` parse as regex with flags; everything else is a substring check. Two layers ship together: (a) score(caseSpec, response) → { pass, score, checks, passed, failures } used in tests + future inline assertions; (b) validateAll(promptsRegistry) walks every cases.v1.json and asserts case-id format, prompt-version validity (cross-checked against the registry — a case referencing an unshipped version FAILS CI), input length, regex compilation, duplicate-id detection. lib/ai/evals/orchestrator/cases.v1.json seeded with 6 canonical cases pinning the most expensive failure modes: CN bicycles AD/CVD stacking, VN apparel EVFTA preferential, BD textiles EBA zero-duty, CN aluminium CBAM applicability, large-cargo human-review escalation trigger, out-of-scope MDR/IVDR escalation. The existing scripts/agent-eval.js remains the LLM-integration runner; this offline layer runs on every push without burning API credits. 19 tests cover: load + listAgents + path-traversal guard, parsePattern (regex shorthand + substring + non-string), score (mustContain all-pass / partial / mustNotContain hit / miss / vacuous / bad inputs / regex flags), validateAll over every shipped case, orchestrator cases.v1.json shape contract, prompt-version cross-check, golden-path synthetic response, "I cannot help" failure synthetic. 1,499 → 1,518 tests. |
| 2026-05-17 | BG-6 foundation closeout — all 5 agents on the registry + eval coverage | Track 6 foundation is fully shipped. Programmatically extracted compliance/sourcing/logistics/finance SYSTEM_PROMPTs from their inline JS const declarations to lib/ai/prompts/<agent>/v1.txt; each handler now reads via registry.getPrompt() and exports its versioned const (COMPLIANCE_PROMPT_VERSION / SOURCING_PROMPT_VERSION / LOGISTICS_PROMPT_VERSION / FINANCE_PROMPT_VERSION) + SYSTEM_PROMPT_HASH. Added cases.v1.json for sourcing (country-comparison, factory-discovery-out-of-scope, VN/EVFTA preferential), logistics (urgent-air mode-selection, bonded re-export), finance (first-time CN supplier confirmed LC, working-capital CCC framing). validateAll() now walks ALL FIVE agents and cross-checks every case's promptVersion against the registry on every npm test. New handler-integration test asserts every agent (orchestrator/compliance/sourcing/logistics/finance) reads via the registry, exports its version + hash, and has zero inline-prompt drift. From "one agent on registry" (BG-6.1) to "5 of 5 on registry with eval coverage" in one focused sprint. Track 6.2 phase 2 (wire scripts/agent-eval.js to read from the new tree) becomes a mechanical follow-up. 1,519 → 1,520 tests (only +1 test because the migration is mechanical; the win is the breadth, not the test count). |
| 2026-05-18 | BG-1.5 — Per-user calibration card (the cumulative story above the plan list) | BG-1.4 captured per-plan signal; this sprint compounds it into a single-glance summary. The Track 1 thesis is "every customer who logs an actual teaches OrcaTrade where the calculator drifts" — but until the USER also sees their own cumulative drift, they have no reason to keep logging. The calibration card closes that motivational loop: a card pinned above the saved-plans list, direction-coloured by cumulative bias (green when running conservative, amber when running optimistic, gold-neutral on-target), showing the value-weighted variance + a split by outcome direction. Math is value-weighted on purpose: a single €1M plan should pull the average more than ten €500 plans. Mean-of-percents would be the wrong number to show. Implementation choices: (1) `summariseActuals(plans)` lands in lib/actuals.js as a pure function exported alongside the BG-1.4 helpers; tests live in the same file. (2) The function is also mirrored client-side in /account/plans/app.js — small enough to inline rather than ship the whole lib to the browser. A UI-contract test asserts the client function exists and matches the canonical shape, so a future refactor that re-imports the lib won't silently drop the front-end. (3) Zero new server endpoint. The card consumes /api/plans's existing actualVariance enrichment from BG-1.4 — same data, new perspective. (4) Plan-counting rule: a plan with a malformed variance (zero/negative estimate from a broken snapshot) is dropped from withActuals AND from the math. Letting it count as "logged" would be UX-misleading — a test caught this and pins the rule. Three render states: (a) planCount=0 → card hidden (existing empty-state panel handles the copy); (b) withActuals=0 → motivational card teaching the loop EXISTS ("After your next shipment lands…"); (c) live → headline + four stat tiles + directional split footer. The investor demo improvement: "Here's a user with 5 plans, 3 logged outcomes. The card tells them their estimates have been 3% conservative on average. That's the moat compounding — every logged actual feeds the next quote." 8 new tests over summariseActuals (empty, no-actuals-yet, value-weighted averaging pulls big plans more than small, on-target direction handled correctly, malformed entries dropped, mixed-direction byDirection split) + 2 UI-contract tests pinning the slot + the three-state render. Next in the loop: BG-1.5 phase 2 (cross-user aggregate calibration for an internal /dashboard/calibration/ admin page) once we have a more meaningful sample size. 1,819 → 1,837 tests. |
| 2026-05-18 | BG-1.4 — Actuals capture v1 (Track 1 reality-check loop goes live) | The `actuals` table has sat in the BG-2.1 Postgres schema since the Neon migration. This sprint finally writes to it (well, the KV-side equivalent — Postgres dual-write follows the BG-2.2 pattern in a follow-up). Strategic stakes: OrcaTrade's defensibility rests on the calculator being more accurate than competitors over time, and the LLM-never-produces-numbers rule means the calculator IS the moat. Without a feedback loop, we'd never know when the calculator drifts from reality. Every customer who logs an actual now closes that loop. v1 is deliberately tiny — one number (total landed cost EUR), one optional notes field, one actual per plan. The minute we have ~100 actuals we'll know empirically which dimension to ask about next (duty / freight / brokerage / VAT-recoverable timing) and ship v2 with the specific breakdown. New lib/actuals.js (clean module, 130 LOC): sanitiseLandedEur (positive number, ≤€1B cap — anything above is operator error), sanitiseNotes (trim + 500-char cap), buildActualRecord (integer-cents on the conversion edge via Math.round, matches BG-1.1 money convention; throws on bad input rather than coercing), computeVariance (compares actual to snapshot.perShipmentLandedTotal — the AT-SAVE-TIME estimate, NOT the current re-computed estimate; that's plan-diff's job — and returns direction/deltaEur/deltaPct/significant with a 3% deviation threshold), setActual + clearActual (KV-persistence on the plan record via savedPlans, ownership-checked through getPlan, idempotent clear). New routes under the existing /api/plans dispatcher: POST /api/plans/<id>/actual upserts; DELETE clears. Both emit audit events (`actual_reported` carrying landedCents + deltaPct so the audit dashboard shows the signal not the raw numbers; `actual_cleared` carrying just planId). events.ALLOWED_TYPES gains both types. handleList + handleGet now enrich every returned plan with actualVariance when an actual exists — keeps the client thin (no client-side variance math). /account/plans/ UI: each card grows a "Log actual outcome" toggle that expands inline to a small form (Geist-Mono EUR input + Geist-sans notes textarea + Save/Cancel + inline error); once saved, the toggle is replaced with a colour-coded variance badge — amber border + amber bg for over-budget, green for under, gold-neutral for on-target — showing headline ("Actual landed cost came in over the estimate by 8.3% (€2,500)"), estimate-vs-actual numbers in monospace, the user's notes in italic, and Edit/Clear controls. UI uses one delegated click listener on the list (not per-card) so DOM swaps after save/clear don't strand handlers. 29 new tests cover: ALLOWED_TYPES surface, sanitisers (positive/zero/negative/NaN/Infinity/null/oversize, trim + 500-char cap), buildActualRecord (cents conversion at 28450.50 → 2845050, half-even rounding at the 0.005 boundary, throws on every bad-input shape), computeVariance (over/under/on-target directions, 1% not-significant + 3% boundary IS-significant, null on every missing-input shape, div-by-zero guard), setActual (writes through + leaves other fields untouched + re-reporting overwrites + 404 unknown plan + ownership-check returns null for wrong owner), clearActual (removes the actual + idempotent on already-empty plans), POST handler (401 unauth, 404 unknown plan, 400 zero/negative EUR, happy-path response shape with actualVariance computed inline, audit-event written with deltaPct field, ownership returns 404 NOT 403 to avoid leaking plan existence), DELETE handler (clears + emits `actual_cleared`), GET list enrichment (with-actual gets actualVariance, no-actual gets undefined — clean signal-vs-empty), HTML markup contract (CSS hooks for actual-form + plan-variance.over + plan-variance.under), app.js contract (endpoint URLs + JSON body shape + render functions present). The investor demo is materially better now: "show me a saved plan, then show me how customers tell us when reality didn't match" → it's a working loop. Phase 2 candidates: duty/freight breakdown, multiple actuals per plan over time, quarterly calibration script that exports actuals → reviews calculator drift → ships a tuning PR. 1,789 → 1,819 tests. |
| 2026-05-18 | BG-5.6 — user-facing /account/activity/ (Article 15 right-of-access UX) | Track 5 user-facing layer on top of BG-5.5's audit trail. BG-5.5 wrote the events; this sprint reads them back to the very users they describe. GDPR Article 15 obliges us to disclose what personal data we hold and the activity associated with it — until now the only answer was "download the full JSON export and grep it". That's the right BACKSTOP but it's not the right UX for "did I sign in from somewhere I don't recognise?" New GET /api/account/activity sub-action (getCurrentUserStrict gated, so a "Sign out everywhere" click still kicks the session out of this endpoint on every device): scans up to 5000 events from events.list (which already routes to PG-or-KV via listUnified), runs filterUserActivity to keep only the eight BG-5.5 security event types where the signed-in email is the actor (e.email) or any of the three target fields (inviteeEmail / removedEmail / toEmail), runs redactActivityRow over every survivor to replace OTHER users' emails with the literal "(another user)" — case-insensitive own-email matching — and slices at 50 rows. Product event types (import_plan_generated, plan_saved, ai_call, founding_applied) are explicitly excluded — this page is the security/account-management view, not "everything OrcaTrade has ever recorded about me" (that's /api/account/export). New /account/activity/ page noindex, breadcrumbs back to /account/, time in UTC via Geist Mono, colour-coded pills (signin green, logout grey, revoke amber, export blue, org gold), EVENT_META table covers every BG-5.5 type, renderDetail switches on event type to surface "you invited X" vs "you were invited by X" using the signed-in email as the discriminator, escapeHtml neutralises angle brackets + quotes so a future event payload field with user-controlled text can't XSS the page, DOMContentLoaded handler browser-guarded for offline Node testing. Cross-link from /account/ quick-links + footer-note cross-link to /account/privacy/ for the "I want everything" backstop. 27 new tests cover: filterUserActivity (empty list, security-types-only, every actor + target field, case-insensitive email, empty-email zero, malformed entries skipped), redactActivityRow (own email kept, foreign emails redacted, transfer fields, non-identity fields preserved across the redaction), SECURITY_EVENT_TYPES exact-set guard (8 types in, 4 product types deliberately out), handleActivity end-to-end (401 unauth, empty-timeline payload shape, only-mine filter, foreign-email-redaction reaches the JSON body, 50-row hard cap with 70 rows seeded), dispatcher 404 advertises the new endpoint, HTML markup contract (existence, noindex, every DOM hook, breadcrumb, privacy-cross-link), app.js contract (auth-me bootstrap, activity fetch, DOMContentLoaded guard, EVENT_META coverage of all 8 types, renderDetail inviter-vs-invitee, escapeHtml XSS-safety), /account/ quick-link integration. Privacy-conscious design choice: a removed user can SEE that they were removed (preserving their right to dispute the removal) but cannot LEARN the email of the admin who removed them — test pins both directions. Combined with BG-5.5, OrcaTrade now has a complete loop: every security operation is recorded (BG-5.5), inspectable by admins via /dashboard/audit (BG-5.3), AND visible to the affected user via /account/activity (BG-5.6). The Article 15 "right of access" obligation is now answered by working UI, not just downloadable JSON. 1,762 → 1,789 tests. |
| 2026-05-18 | BG-5.5 — audit log for security-sensitive operations | Track 5 (compliance + enterprise readiness) gains its operational audit-trail. Pre-BG-5.5 the platform shipped four well-built security operations (magic-link sign-in, sign-out, sign-out-everywhere, GDPR export/delete) and six org operations (create / get / invite / remove / transfer / list) — but none of them recorded "this happened, at this time, by this actor". An auditor's first question — "show me everyone who deleted their account last quarter" — had no answer. This sprint closes that gap. Eight new ALLOWED_TYPES land in lib/events.js: auth_signin (magic-link redemption — note: Stripe checkout was already recording this since BG-5.1; the magic-link path now joins it, with `source` distinguishing them), auth_logout, auth_revoke_all, org_created, org_member_invited, org_member_removed, org_ownership_transferred, account_exported, account_deleted. Every handler records after the operation has succeeded — pseudo-events on failure are deliberately suppressed because the audit dashboard isn't a debug log, it's the user-facing trail of consequential actions. Two specific design choices: (1) handleInvite's idempotent re-add path (same email re-invited at the same role) does NOT emit a duplicate audit row — re-adding an existing member is a no-op, not a security event. Test pins this. (2) handleDelete's audit row carries the PSEUDONYM as its identity, not the raw email. This is the only way the audit trail survives an Article-17 deletion without recreating the PII the user just asked us to remove. Test pins this with an exact-pseudonym-format match AND a "raw email does not appear anywhere on the row" guard. handleRevokeAll's audit row exists specifically for the "I think someone else has my session" forensic question — the operations team needs to see when revoke-all was clicked and from which session. /dashboard/audit/ inherits every new type automatically because /api/audit returns the full unfiltered feed (filtered post-fetch by the UI). One pre-existing account.test.js regression: the old delete test used `find(e => e.email.startsWith('deleted-'))` to locate the pseudonymised event — but BG-5.5 now prepends an `account_deleted` row with the same pseudonym prefix, which `.find` returns first. Tightened to `e.type === 'founding_applied' && e.email.startsWith('deleted-')` so the test exercises pseudonymisation, not audit-row precedence. 15 new tests cover: ALLOWED_TYPES surface for all 8 new types, every success path emits exactly one row with the correct fields (signin source + ip, logout method, revoke-all email, org create with orgName + orgId, invite first-time + idempotent-suppression, remove actor + target, transfer outgoing + incoming, export with stats, delete pseudonym-identity + raw-email-leak-guard), every failure path emits zero rows (malformed token / no-cookie logout / 401 revoke / 400 org-create / 400 delete-without-confirm). Definition of done for BG-5: customer-facing privacy controls (5.1) + GDPR endpoints (5.2) + cookie consent v2 + security docs set (5.4) + admin audit dashboard (5.3) + audit log for security operations (this sprint) = compliance story shippable in an investor data room. 1,746 → 1,762 tests. |
| 2026-05-17 | BG-3.2 phase 1 — Session revocation list ("Sign out everywhere") | Track 3 second piece. Custom HMAC-signed cookies stay stateless; revocation is per-email, not per-session. New KV key `auth:rev-min-iat:<email>` (31-day TTL = SESSION_TTL_DAYS + 1) stores a "minimum iat" timestamp. Any session whose iat < the stored timestamp is rejected on the strict path. When the user clicks "Sign out everywhere" we write `Date.now()` to the key — every cookie issued before that moment, on every device, stops working on its next request. New sessions minted after the timestamp work normally. Deliberate non-choice: NOT a per-session ID. That would change the cookie contract + require server-side state for every active session. The min-iat approach delivers the same security guarantee ("kill everything in one click") with minimum-invasive surface area and natural decay (the key TTLs out once every pre-revocation session has expired naturally). lib/auth.js gains revKvKey, revokeAllSessionsForEmail (returns false on empty input, idempotent), getMinIat (returns 0 when unset), getCurrentUserStrict (async — null on missing/expired/forged/min-iat-violated). New POST /api/auth/revoke-all sub-action under the auth dispatcher: 401 if not signed in, otherwise writes the timestamp + clears the local session cookie + returns 200. Lower-stakes handlers (e.g. /api/start which serves anonymous plan generation too) keep the sync getCurrentUser; sensitive handlers (/api/account/*, /api/orgs/*) are now on getCurrentUserStrict so a "sign out everywhere" actually kicks the user out of those flows immediately on every device. /account/ gains a "Sign out everywhere" button alongside "Sign out", a confirm() safety prompt, and an inline result message; success drops the page back to the sign-in form. 16 new tests cover: revKvKey namespacing + email normalisation, getMinIat zero-default + post-revoke timestamp, revoke case-insensitivity + empty-email guard, strict-check happy path / blocked-by-revocation / fresh-cookie-after-revocation roundtrip / null on no-cookie, handleRevokeAll 405 on non-POST + 401 unauth + 200 happy path with set-cookie clear + min-iat written, dispatcher routes revoke-all + 404 'available' list contains it, UI markup contract (revoke-all-btn id + "Sign out everywhere" label + revoke-all-msg id), app.js wires the button to /api/auth/revoke-all with confirm() guard, cross-file regression guard asserting account + orgs handlers reference getCurrentUserStrict. Phase 2 (visible-sessions list with per-device revoke) is deliberate scope-cut to a follow-up — the security guarantee landed here is the one that matters most for "I think someone has my email's sessions." 1,730 → 1,746 tests. |
| 2026-05-17 | BG-3.1 closeout — /account/orgs/ UI | The org/seat API from BG-3.1 had no user-facing surface; users would have had to curl /api/orgs to create or manage teams. This sprint ships the UI. New /account/orgs/ (single page, two modes via ?id= query param): list view shows the user's orgs + an inline create form; detail view shows members in a role-coloured table + invite form (admin+ gated) + per-row remove buttons (admin+ gated, owner-protected, self-protected). Bootstraps from /api/auth/me — shows "Sign in to manage organisations" panel for signed-out users (same pattern as /account/privacy/). Role coverage: invite dropdown offers admin + member only (NOT owner — that requires transferOwnership, intentionally not exposed in v1 UI); remove button hidden for owner rows + the signed-in user's own row; member-role users see no destructive UI. After successful create, redirects to the new org's detail page. After invite success, refreshes the member list. After remove confirmation (browser confirm()), refreshes the list. Cross-link added to /account/ quick-links. 16 markup-contract + script-surface tests pin: page existence + noindex, every DOM hook, invite dropdown excludes owner, role explanation footer, security docs cross-link, breadcrumb back to /account/, bootstrap via /api/auth/me, GET /api/orgs list, POST /api/orgs with { name }, GET /api/orgs/<id> detail, POST /api/orgs/<id>/invite with { email, role }, POST /api/orgs/<id>/remove with { email } + confirm() safety, role-gating regex (owner OR admin), no-remove-self + no-remove-owner guards, browser-only DOMContentLoaded guard. The Team-plan sales conversation now has a usable UI to demo. 1,714 → 1,730 tests. |
| 2026-05-17 | BG-2.3 — flip dashboards from KV to Postgres reads | All three admin dashboards now read events via `events.listUnified()` instead of `events.list()`. Routing: DATABASE_URL set → listFromPg (durable, unbounded); empty PG with KV-has-data → fall back to KV (covers the dual-write transition window where pg.events is still filling up); DATABASE_URL unset → KV (the development path). PG read errors fall back to KV silently. lib/handlers/audit.js + lib/handlers/leads.js switched to listUnified — covers /dashboard/audit/, /dashboard/leads/, AND /dashboard/ai/ (which reads via /api/audit?type=ai_call). The aggregator's foundingRecent map now surfaces BOTH `email` (KV-shape) and `emailHash` (PG-shape) so the admin sees an identifier regardless of source. redactRow in audit handler already passed through emailHash unchanged — no change needed there. 9 new tests cover: listUnified routing (KV-only, PG-empty-fallback, PG-error-fallback, type-filter passthrough), aggregator on pure PG-shape rows (no email but emailHash, foundingRecent surfaces hash), aggregator on mixed KV+PG rows (each row surfaces whichever identity it has), handler-contract assertions (audit + leads must call listUnified), module export surface. 5000-event KV cap stops being a constraint as soon as PG has been receiving writes long enough that fallbacks aren't needed. 1,705 → 1,714 tests. |
| 2026-05-17 | BG-2.2 — dual-write events to Postgres | First consumer of the Neon database shipped in BG-2.1. lib/events.js#record() now writes to BOTH KV (primary, hot path, dashboards still read from it) AND Postgres (secondary, fire-and-forget, the corpus that grows past the 5000-event cap). KV failure still returns false; PG failure is silently swallowed (telemetry must never break a request). New lib/hash.js as the single source of truth for emailHash (16-hex SHA-256, deterministic + case-insensitive + trim-stable) — replaces the duplicated implementations in lib/handlers/account.js and lib/handlers/audit.js conceptually (those keep working; this is forward-compat). New buildPgInsertParams pure function strips raw emails from the payload before INSERT (the hash is the ONLY identity column in pg.events) and respects already-pseudonymised "deleted-…@anonymised.local" addresses (pass through verbatim — that IS the post-Article-17 identity). New listFromPg(opts) optional read path returns rows in the same shape KV consumers expect, so a future sprint can flip dashboards to PG with a one-line swap. KV-only mode (no DATABASE_URL) is a no-op for the PG path — recordPg returns { written:false, reason:"not-configured" } without throwing. 18 new tests cover: hash.emailHash determinism + case/trim normalisation + null handling, isAlreadyPseudonym detection, compatibility with audit.hashEmail (same algorithm, just truncated to 12 hex in audit), buildPgInsertParams (email hashed + stripped, no-email = null hash, pseudonym passthrough, defensive null/undefined), recordPg (not-configured + db-error paths), record() KV-only mode still returns true, record() fire-and-forget doesn't block on slow PG (<80ms total), listFromPg empty paths, ALLOWED_TYPES preserved. Once dashboards migrate to listFromPg() in a follow-up sprint, the 5000-event KV cap stops mattering. 1,686 → 1,705 tests. |
| 2026-05-17 | BG-4.2 — Sentry drain (zero-dep) | Second piece of Track 4's external-service tier. Forwards every warn + error structured-log line to Sentry's envelope HTTP endpoint. **Zero-dep:** no @sentry/node, no instrumentation library — lib/sentry.js parses the DSN, builds the three-line envelope (header / item-header / item-body per Sentry spec), POSTs with the proper `X-Sentry-Auth: Sentry sentry_version=7, sentry_key=…, sentry_client=…` header. Same pattern as lib/stripe.js. Saves ~500kB of bundle weight + avoids fighting with the SDK's instrumentation. lib/log.js's emit() now calls a `forwardToSentry()` helper for warn + error levels only (info/debug never forward — would blow Sentry quota). Fire-and-forget Promise; the structured stdout log is the primary record. PII redaction runs BEFORE the forward (the emit() pipeline already redacts via lib/log.js#redact() before either destination). Whitelist of fields promoted to Sentry tags (handler / action / agent / model / promptVersion / requestId / tier / orgId) — searchable in Sentry's UI; everything else lands in the freeform extra block (with the 200-char tag-value cap enforced + nested objects auto-routed to extra not tags). 4-second timeout on the network call. /api/health gains `sentry` as the 7th subsystem (ok=valid DSN, degraded=unset or malformed; doesn't make a real network call, just validates DSN shape). /status/ page SUBSYSTEM_LABELS includes "Error reporting (Sentry)". 34 new tests pin every layer: parseDsn (5 valid shapes including EU/US/self-hosted, 5 invalid), isConfigured (3 paths), envelopeUrl + authHeader construction, splitTagsAndExtra (whitelist + nested-not-promoted + null-dropped + 200-char truncation + numeric/bool coercion), buildEvent (warn→warning, error stays error, 32-hex event_id, payload shape), buildEnvelopeBody (3-line spec compliance), captureMessage no-DSN path, log forwarding (error + warn forward, info + debug don't, no DSN → no network attempt, PII redaction reaches the envelope body), health probe (ok / degraded-unset / degraded-malformed), status page knows about sentry. 1,652 → 1,686 tests. |
| 2026-05-17 | BG-2.1 — Neon Postgres source-of-truth provisioned | First piece of Track 2. Neon project `orcatrade-prod` in Frankfurt (`eu-central-1`); pooled + unpooled URLs set on Vercel as DATABASE_URL + DATABASE_URL_UNPOOLED. **One architectural decision documented:** added `@neondatabase/serverless` as OrcaTrade's second runtime dependency. Rationale: the dev-plan rule "pure-JS, zero npm, stay deployable on Hobby" was about function-count + no-build-pipeline, not literal zero deps; the Neon serverless driver is ~50kB, pre-compiled, no native code, designed for Vercel functions over WebSockets/HTTP; the alternative (raw fetch against an undocumented HTTP SQL endpoint) couples us to a non-public contract. New lib/db/client.js exposes query / queryOne / transaction / probe / isConfigured / poolUrl / directUrl with structured-logging integration + slow-query warning above 1s. lib/db/schema.sql declares schema v1 — 9 tables (schema_versions / users / organisations / memberships / saved_plans / audit_log / events / actuals / subscriptions / prompt_runs) with idempotent CREATE TABLE IF NOT EXISTS, proper indexes, FK CASCADE/SET NULL semantics, jsonb (not json) for payload columns, integer-cents for monetary columns (matches lib/intelligence/money.js BG-1.1), timestamptz NOT NULL DEFAULT now() everywhere, role CHECK constraint on memberships, NULL-safe partial indexes. email_hash (SHA-256 first-16-hex) is the join key — Postgres never sees raw emails. scripts/db-migrate.js applies migration files alphabetically, tracks applied versions + their content SHA-256 in schema_versions, detects content drift on re-apply, halts on first error, supports --dry-run, exits non-zero on failure. Wired into lib/handlers/cron.js as the `db-migrate` job so GHA can fire it via the existing CRON_TOKEN auth. /api/health gains `postgres` as its 6th subsystem with its own probe (returns degraded when unconfigured, down when configured-but-unreachable). Aggregator updated: postgres-down = paging condition same as kv-down. /status/ SUBSYSTEM_LABELS gains the Postgres (Neon) entry. 25 new tests cover: isConfigured + probe (both unconfigured + configured paths), schema contract (every required table, idempotent CREATE TABLE + CREATE INDEX, jsonb-not-json, timestamptz, FK targets valid, role CHECK, cents-as-integer), migration runner (sha256 determinism, alphabetical file discovery, schema*.sql filter, runMigrations missing-url path, SCHEMA_DIR location), health postgres-subsystem (down overrides ok, degraded preserves ok-degraded, unconfigured probe shape), status-page knows about postgres, cron handler exposes db-migrate. Plus 3 existing tests updated for the new subsystem. Next: `npm run db:migrate` (locally with DATABASE_URL_UNPOOLED) OR fire `POST /api/cron job=db-migrate` once Vercel redeploys; then the schema is live. Track 2.2 (dual-write events to PG) becomes a follow-up sprint. 1,625 → 1,650 tests. |
| 2026-05-17 | BG-3.1 foundation — Org & seat model | First piece of Track 3 (tenancy + auth maturity). New lib/orgs.js: createOrg + getOrg + listMembers + listOrgsForEmail + addMember + removeMember + transferOwnership + hasRole. Role hierarchy: owner > admin > member with monotonic rank checks. Owner auto-membership on createOrg. Idempotent addMember (re-add returns alreadyMember:true). Hard guard against second-owner via addMember (must use transferOwnership) and against removing the owner via removeMember. Case-insensitive email normalisation throughout. Storage: `org:<id>`, `org:members:<id>`, `org:byEmail:<email>` denormalised index. New lib/handlers/orgs.js with six sub-actions dispatched by URL segment: GET /api/orgs (list mine), POST /api/orgs (create — current user becomes owner), GET /api/orgs/<id> (fetch + members; must be a member), POST /api/orgs/<id>/invite (admin+ required, role must be admin or member), POST /api/orgs/<id>/remove (admin+ required, owner protected), POST /api/orgs/<id>/transfer (owner-only, recipient must already be a member, old owner demoted to admin). All 401 without a session. 28 tests cover createOrg validation + happy path + listOrgsForEmail integration + case-insensitive email, addMember (happy + idempotent + owner-forbidden + ALLOWED_ROLES guard + index update), removeMember (happy + cannot-remove-owner), transferOwnership (happy + non-member-recipient rejected + non-owner-from rejected), hasRole (owner-satisfies-all + member-cannot-admin + non-member-fails), HTTP handler (401 unauth, POST create + 400 missing name, GET list, invite admin-gate, owner-invites-end-to-end, GET <id> membership-gate + happy path, transfer owner-gate, OPTIONS preflight). Tier migration (tier:<email> → tier:<orgId>) intentionally NOT in this sprint — large blast radius (billing + plan ownership + gating) and the data layer here is forward-compatible. 1,597 → 1,625 tests. |
| 2026-05-17 | BG-6.5 — AI cost dashboard | Closes Track 6's visibility loop. events.ALLOWED_TYPES gains `ai_call`. lib/ai/cost-telemetry.js's recordAnthropicCall now writes to TWO destinations in parallel: (1) the structured stdout log (lib/log.js) — unchanged primary record, and (2) the durable event log (lib/events.js → KV) via fire-and-forget events.record(). KV failure cannot break the request — the structured log is the always-available fallback. New /dashboard/ai/ page reads via /api/audit?type=ai_call (inherits the audit handler's token gate + already-PII-clean ai_call payload — no email, no user identifier). Aggregates client-side: total spend, last-7-days spend, call count, mean cost per call, total tokens, spend-by-agent bar chart, spend-by-prompt-version bar chart, top-10-most-expensive-calls table with model + tokens + cost + latency. Cross-links added between all three dashboards (leads ↔ audit ↔ ai). Aggregator + fmtCents exported via module.exports so the test suite exercises them in pure-Node. Browser-only DOMContentLoaded guarded with `typeof document !== 'undefined'`. 9 new tests cover: events.ALLOWED_TYPES contains ai_call, recordAnthropicCall writes via events.record (drained microtasks then asserted on full event payload), no-PII invariant (no email/name/message fields on ai_call rows), HTML markup hooks + /api/audit?type=ai_call fetch target, pricing-source citation in the page, aggregator math (empty input zero-shape, multi-event sum across agents + prompt versions, last-7-days isolation), fmtCents formatting (<100 → "Nc", ≥100 → "€N.NN"). 1,588 → 1,597 tests. |
| 2026-05-17 | BG-6.4 — Anthropic cost telemetry | Closes Track 6's self-contained scope. New lib/ai/cost-telemetry.js: priceFor(model) returns input/output/cacheRead rates from a frozen MODEL_PRICING_CENTS_PER_MILLION_TOKENS table (Sonnet 4.6/4.7 at 278/1389/28 cents per million; Opus 4.6/4.7 at 1389/6945/139 ≈ 5× Sonnet; Haiku 4.5 at 70/348/7 ≈ 1/4 Sonnet). Unknown models fall back to Sonnet rates with a loud log entry — pricing-table drift is a reviewable commit, not a silent budget bug. computeCost(model, usage) is pure + deterministic + half-even rounded; subtracts cache reads from input to avoid double-counting. summariseTokens normalises Anthropic's usage shape. withCostTelemetry({ agent, promptVersion, promptHash, model, requestId }, fn) wraps any agent's Anthropic fetch, measures latency, and emits one structured log line per call: `{ event:"ai_call", agent, promptVersion, promptHash, model, requestId, tier, inputTokens, outputTokens, cacheReadTokens, costCents, latencyMs, stopReason }`. Wrapper re-throws on error after logging a `anthropic call failed` warn line so failed calls still count toward rate-limit budgets. lib/handlers/orchestrator.js migrated as proof-of-value: the per-turn callAnthropic now runs inside withCostTelemetry; other four agents follow the same 6-line pattern. 17 tests cover priceFor (sonnet/opus/haiku ratios + fallback), computeCost (1M input baseline, 1M output baseline, mixed scenario with cache discount, large-shipment scenario, cache-cheaper-than-input invariant, never-negative defensive), summariseTokens (happy path + null/empty), withCostTelemetry end-to-end (structured log line with all expected fields, error path re-throws + logs warn), recordAnthropicCall never-throws guarantee. The future cost dashboard (Sprint BG-6.5) reads from these log lines via the Axiom drain (BG-4.2). 1,570 → 1,587 tests. |
| 2026-05-17 | BG-6.2 phase 2 — live agent-eval runner unified with the new tree + grounding | scripts/agent-eval.js refactored from a compliance-only one-trick script into a per-agent runner that auto-detects the case source. Loads from lib/ai/evals/<agent>/cases.v1.json (new tree, all 5 agents) and falls back to test/agent-eval-cases.json (legacy compliance file, 15 rich cases) so nothing breaks. New CLI surface: --agent <name> picks which agent, --list-cases runs offline (no API key needed) and lists what would run, --require-grounding forwards an empty allow-list to the scorer (foundation for phase 3 where tool outputs from the SSE stream feed the allow-list automatically), --bail + positional case-id preserved. Two case shapes normalise to a common { id, name, messages, expectations, mustContain, mustNotContain, expectedTools } via normaliseLegacyCase + normaliseNewShapeCase. Run pipeline applies BOTH layers — legacy assertExpectations (tool calls + citations + escalation + stop reason) AND scorer.score (mustContain/Not + grounding) — so a hybrid case surfaces failures from both kinds at once. Every internal function exported so the offline test suite can exercise it without hitting Anthropic. 18 new tests cover: parseArgs (defaults + --agent + --agent= + flag combos + --list-cases without API key), AGENT_HANDLERS coverage of all 5 agents, loadCases auto-detection (new tree for orchestrator/sourcing/logistics/finance, legacy fallback for compliance), legacy + new-shape case normalisation, runCase end-to-end against a stubbed SSE handler (clean → 0 failures, missing mustContain → 2 failures, legacy tool-never-called → failure, hybrid both-layers compose into ≥3 failures, --require-grounding catches hallucinated 14.2% against calculator's 12%), summariseEvents shape (tools called list + final text + stop reason + errors). Smoke-tested: `node scripts/agent-eval.js --list-cases --agent orchestrator` runs without an API key and prints all 6 cases. 1,552 → 1,570 tests. |
| 2026-05-17 | BG-5.3 — admin audit log dashboard | Track 5 closeout. New lib/handlers/audit.js: GET /api/audit?token=… returns the raw event-by-event feed (whereas /api/leads aggregates the same source into summary tiles). Same constant-time token comparison as /api/leads (ORCATRADE_LEADS_TOKEN env). PII discipline: every row passes through redactRow() before egress — emails are replaced by a deterministic 12-hex SHA-256 prefix (`emailHash`) so the same user always pseudonymises to the same identity for cross-event correlation without leaking the raw address; free-text messages truncated to 80 chars + ellipsis; already-pseudonymised "deleted-<hash>" emails pass through unchanged. New /dashboard/audit/ page: token persists in sessionStorage, type filter (populated from response.allowedTypes), limit input (1-1000 clamped, default 200), summary tiles (events shown / last-24h / distinct types / with-email-hash), filterable table with type-coded colour pills and payload preview. /dashboard/leads/ gains a "audit log →" cross-link in the subtitle. 15 new tests cover: 503 on missing env, 401 on bad/missing token, 405 on POST, 200 + shape, redactRow (hash determinism + case + trim normalisation, pseudonymised-passthrough, long-message truncation, short-message passthrough), end-to-end email-replaced-by-hash, type filter, limit clamping (0 → 1, 99999 → 1000, missing → 200), page-contract markup hooks + fetch target + sessionStorage persistence. 1,537 → 1,552 tests. |
| 2026-05-17 | BG-6.3 — calc-grounding enforcement (the AI moat keystone) | The core CLAUDE.md guarantee — "the LLM never produces a number that drives a business decision" — becomes CODE, not just prompt discipline. New lib/ai/evals/scorer.js primitives: extractNumbers(text) parses every money/percent/weight token from agent output (handles both US/UK "1,234.56" and EU "1.234,56" separator styles via a position-and-count heuristic). checkGrounding(response, allowedNumbers, opts) walks every numeric token and asserts it matches a calculator output value within a documented per-kind tolerance (money ±1% or ±€1, percent ±0.5pp, weight ±2%). ALWAYS_GROUNDED_NUMBERS auto-allows citation language (small counts, "100%" rhetoric, calendar years, 365). score() gets an opts.groundedNumbers parameter — when provided (or when caseSpec.requireGrounding=true), every ungrounded token becomes a `kind: "ungrounded"` failure with the offending value + raw text. Kind-strict matching: a money allow-list entry cannot satisfy a percent token. 17 new tests cover: extractNumbers across all token kinds + both separator styles + trailing-EUR form, parseEuropeanNumber on 6 ambiguous inputs (1,234 = thousands; 1,5 = decimal; etc.), checkGrounding (all-grounded, hallucinated number caught, citation-language allowed, money/percent tolerance branches, kind-strict guard), score integration (opt-in via opts vs caseSpec.requireGrounding, golden-path synthetic, wrong-calculator-output failure synthetic). When a future Claude release hallucinates "duty is 14.2%" but the calculator returned 12.0%, this layer catches it BEFORE the response reaches the user. 1,520 → 1,537 tests. |

When a backend sprint completes, append a row here.
