# Subprocessors

**Last reviewed:** 2026-06-01
**Owner:** Oskar Klepuszewski

Every third party that processes OrcaTrade customer data on our behalf. Required for the [DPA](dpa-template.md) and for security questionnaires.

We update this file when we add or remove a subprocessor. Customers under a signed DPA receive notice via email at least 30 days before a new subprocessor goes live (unless the new subprocessor replaces an existing one for security or reliability reasons, in which case notice may be shorter).

---

## Active subprocessors

The **EU residency** column states whether the data this subprocessor processes is held in the EU. ✅ = EU-only; ⚠️ = EU primary, US fallback documented; ❌ = data leaves the EU (mechanism in §"Why each non-EU subprocessor" below).

| # | Subprocessor | Purpose | Region | EU residency | Data categories | DPA |
|---|---|---|---|---|---|---|
| 1 | **Vercel** (Vercel Inc., USA) | Web hosting, serverless functions, CDN, build pipeline, analytics | Functions: Frankfurt (fra1); CDN: global; control plane: USA | ⚠️ (functions in EU; control plane US) | All request/response data passes through; identity (email, IP), behavioural (wizard inputs), operational (request-id) | https://vercel.com/legal/dpa |
| 2 | **Upstash** (Upstash, Inc., USA) | KV / Redis store via Vercel Marketplace | Frankfurt (eu-central-1) | ✅ | Sessions, saved plans, events log, TARIC cache, circuit state | https://upstash.com/trust/dpa |
| 3 | **Neon** (Neon, Inc., USA) | Postgres source-of-truth for events, saved plans (dual-write mirror), portfolios, data snapshots, RBAC roles. **Live** (was listed as "Future" until 2026-06-01; corrected in this review). | eu-central-1 (verify on the Neon project dashboard) | ✅ (verify Neon project region) | Identity (email_hash, never raw email per [ADR 0008](../adr/0008-email-pseudonymisation.md)), behavioural (wizard inputs + agent prompts in audit payload), operational (snapshot ids) | https://neon.tech/legal/dpa |
| 4 | **Resend** (Resend, Inc., USA) | Transactional email — magic links, plan summaries, Founding 10 confirmations | US-region SMTP/HTTP API; email delivery routed via Resend infra | ❌ (DPF + SCCs) | Email address, user-provided name/company, plan permalink, locale | https://resend.com/legal/dpa |
| 5 | **Stripe** (Stripe Payments Europe Ltd., Ireland) | Subscription billing, payment processing | Ireland (EU); US fallback per Stripe topology | ⚠️ (EU primary, US fallback) | Email, billing address, payment method (we never see PAN/CVV) | https://stripe.com/legal/dpa |
| 6 | **Anthropic** (Anthropic, PBC, USA) | AI inference for agent endpoints (Orchestrator, Sourcing, Logistics, Finance, Compliance) | US-region inference | ❌ (DPF + SCCs; training disabled per API contract) | User prompts to the agents + agent responses. We disable training on customer data. | https://www.anthropic.com/legal/data-processing-addendum |
| 7 | **Sentry** (Functional Software, Inc., USA) | Error tracking + release health. **Live** (was listed as "Future" until 2026-06-01; corrected in this review). | EU SaaS (sentry.io EU region — verify on the Sentry organisation settings) | ✅ (verify Sentry org region) | Stack traces + structured-log payloads; PII redacted by [lib/log.js](../../lib/log.js) before send (no raw email, no plan inputs) | https://sentry.io/legal/dpa/ |
| 8 | **GitHub** (GitHub, Inc., USA, Microsoft subsidiary) | Source control, GitHub Actions for cron + uptime + tests | USA | ❌ (no customer data; only code + ephemeral Actions logs) | Repository contents (code, no customer data) + Actions logs (may include ephemeral data from cron runs) | https://docs.github.com/en/site-policy/privacy-policies/github-data-protection-agreement |
| 9 | **UK Trade Tariff API** (HM Revenue & Customs, UK) | Read-only TARIC rate lookups for the customs calculator | UK | ⚠️ (UK; no personal data sent) | HS code + origin country (no personal data) | Public government service — no DPA required, no personal data sent |
| 10 | **Cloudflare Fonts CDN** | Geist + Cormorant Garant font hosting | Global edge | ⚠️ (global edge; IP only) | IP at request time only | https://www.cloudflare.com/cloudflare-customer-dpa/ |
| 11 | **Google Fonts** | Backup font CDN | Global edge | ⚠️ (global edge; IP only) | IP at request time only | https://policies.google.com/privacy |

---

## Future / planned (not yet live)

These appear in [`backend-grade-plan.md`](../backend-grade-plan.md). They'll move into the active table above when provisioned.

| Subprocessor | Purpose | Plan track |
|---|---|---|
| **Axiom** (Axiom Industries Ltd., UK) | Long-term structured log retention + analytics | Track 4.2 |
| **QStash** (Upstash, Inc., USA) | Retryable async job queue (HTTP-based, no SDK) | Track 4.5 |
| **WorkOS** (or equivalent) | SSO/SAML for enterprise customers | Track 3.3 |

---

## What about cookies set by these providers?

| Provider | Cookie / tracker | Purpose | Set on first visit? |
|---|---|---|---|
| Vercel | `_vercel_jwt`, `__vercel_*` | Edge security, build identification | First visit |
| Vercel Analytics | None (server-side only, no cookies) | Page-view counts, anonymous | First visit |
| OrcaTrade | `orcatrade_session` (HMAC-signed, HttpOnly, SameSite=Lax) | Sign-in session | Only after successful magic-link verification |
| Stripe | `__stripe_mid`, `__stripe_sid` | Fraud prevention on the Checkout / Customer Portal | Only when the user lands on a Stripe-hosted page |
| Cloudflare | `__cf_bm` | Font CDN bot management | First visit (set by Cloudflare, not us) |

We do **not** use Google Analytics, Facebook Pixel, LinkedIn Insight Tag, HubSpot tracking pixels, or any other ad-tech / behavioural-tracking pixel.

Cookie banner v2 (Track 5.2 — shipped 2026-05-17 via [`../../js/cookie-consent.js`](../../js/cookie-consent.js)) gives users a granular opt-out: essential is forced on; analytics defaults to off and the Vercel Analytics script is only injected into the page after consent is granted. The banner is re-openable from any element with `data-cookie-preferences`.

---

## EU data residency at a glance (apex III6)

**Persisted customer data — plans, audit log, sessions, organisational
data — stays in the EU.** The hot-path primary (Upstash KV) is in
Frankfurt (`eu-central-1`); the durable mirror (Neon Postgres) is in
the EU region per the Neon project config; serverless functions
(Vercel) run in `fra1` (Frankfurt).

**Outbound data leaves the EU only for specific, time-bounded
purposes**, each with a documented transfer mechanism:

| Outbound flow | Subprocessor | Region | Mechanism | When it happens |
|---|---|---|---|---|
| AI inference (agent prompts + responses) | Anthropic | US | DPF + SCCs + training disabled per API contract | Synchronously, per agent request; no persistence on Anthropic side beyond the inference window |
| Transactional email | Resend | US | DPF + SCCs | One-shot per email (magic link, plan summary, founding-10 confirmation) |
| Billing (when EU fallback to US) | Stripe | EU primary, US fallback | DPF + SCCs (Stripe's own topology) | Stripe Checkout / Portal sessions |
| Error tracing (PII-redacted) | Sentry | EU (verify on Sentry settings) | SaaS contract; `lib/log.js` redaction strips PII before send | On unhandled exception |
| CDN / fonts (IP only) | Cloudflare + Google Fonts | Global edge | Each provider's own DPA + SCC chain | Page load |
| Source-control + CI logs (no customer data) | GitHub Actions | US | DPF + SCCs | Build / cron / smoke runs only |

**What this means for procurement:** if a customer asks "where is
our data stored?", the honest answer is **"identity + behavioural +
operational data lives in EU Frankfurt; specific outbound flows for
inference / email / billing are documented above with their transfer
mechanisms."** No persisted customer-data category leaves the EU
silently.

## Why each non-EU subprocessor (transfer mechanism)

For data flowing from EU customers to US-region subprocessors, we rely on:

1. **EU-US Data Privacy Framework** where the subprocessor is certified (Vercel, Stripe, Resend — verify on https://www.dataprivacyframework.gov/list )
2. **Standard Contractual Clauses (SCCs)** as a fallback, embedded in each subprocessor's DPA linked above
3. **Supplementary technical measures**: HMAC-signed sessions (no plain emails in URLs), TLS 1.2+ in transit, PII redaction in logs before they leave our process

For Anthropic specifically, we explicitly **disable model training on customer data** via the API contract — every API call OrcaTrade makes sets the relevant headers / parameters that flag inputs and outputs as not-for-training. See `lib/handlers/orchestrator.js` and the agent handlers for the implementation.

---

## How to ask about a subprocessor

If you're a prospect or customer evaluating OrcaTrade and need more detail on any of these — DPA signing, sub-DPA passthrough, data residency assertions, audit reports — email `orca@orcatrade.pl` with "subprocessor question: <provider>" in the subject. Response SLA: 5 business days.
