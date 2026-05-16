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

When a backend sprint completes, append a row here.
