# Subprocessors

**Last reviewed:** 2026-05-17
**Owner:** Oskar Klepuszewski

Every third party that processes OrcaTrade customer data on our behalf. Required for the [DPA](dpa-template.md) and for security questionnaires.

We update this file when we add or remove a subprocessor. Customers under a signed DPA receive notice via email at least 30 days before a new subprocessor goes live (unless the new subprocessor replaces an existing one for security or reliability reasons, in which case notice may be shorter).

---

## Active subprocessors

| # | Subprocessor | Purpose | Region | Data categories | DPA |
|---|---|---|---|---|---|
| 1 | **Vercel** (Vercel Inc., USA) | Web hosting, serverless functions, CDN, build pipeline, analytics | Functions: Frankfurt (fra1); CDN: global; control plane: USA | All request/response data passes through; identity (email, IP), behavioural (wizard inputs), operational (request-id) | https://vercel.com/legal/dpa |
| 2 | **Upstash** (Upstash, Inc., USA) | KV / Redis store via Vercel Marketplace | Frankfurt (eu-central-1) | Sessions, saved plans, events log, TARIC cache, circuit state | https://upstash.com/trust/dpa |
| 3 | **Resend** (Resend, Inc., USA) | Transactional email — magic links, plan summaries, Founding 10 confirmations | US-region SMTP/HTTP API; email delivery routed via Resend infra | Email address, user-provided name/company, plan permalink, locale | https://resend.com/legal/dpa |
| 4 | **Stripe** (Stripe Payments Europe Ltd., Ireland) | Subscription billing, payment processing | Ireland (EU); US fallback per Stripe topology | Email, billing address, payment method (we never see PAN/CVV) | https://stripe.com/legal/dpa |
| 5 | **Anthropic** (Anthropic, PBC, USA) | AI inference for agent endpoints (Orchestrator, Sourcing, Logistics, Finance, Compliance) | US-region inference | User prompts to the agents + agent responses. We disable training on customer data. | https://www.anthropic.com/legal/data-processing-addendum |
| 6 | **GitHub** (GitHub, Inc., USA, Microsoft subsidiary) | Source control, GitHub Actions for cron + uptime + tests | USA | Repository contents (code, no customer data) + Actions logs (may include ephemeral data from cron runs) | https://docs.github.com/en/site-policy/privacy-policies/github-data-protection-agreement |
| 7 | **UK Trade Tariff API** (HM Revenue & Customs, UK) | Read-only TARIC rate lookups for the customs calculator | UK | HS code + origin country (no personal data) | Public government service — no DPA required, no personal data sent |
| 8 | **Cloudflare Fonts CDN** | Geist + Cormorant Garant font hosting | Global edge | IP at request time only | https://www.cloudflare.com/cloudflare-customer-dpa/ |
| 9 | **Google Fonts** | Backup font CDN | Global edge | IP at request time only | https://policies.google.com/privacy |

---

## Future / planned (not yet live)

These appear in [`backend-grade-plan.md`](../backend-grade-plan.md). They'll move into the active table above when provisioned.

| Subprocessor | Purpose | Plan track |
|---|---|---|
| **Neon** (Neon, Inc., USA) | Postgres source-of-truth for orgs / audit log / events / actuals | Track 2.1 |
| **Sentry** (Functional Software, Inc., USA) | Error tracking + release health | Track 4.2 |
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

## Why each US-region subprocessor (transfer mechanism)

For data flowing from EU customers to US-region subprocessors, we rely on:

1. **EU-US Data Privacy Framework** where the subprocessor is certified (Vercel, Stripe, Resend — verify on https://www.dataprivacyframework.gov/list )
2. **Standard Contractual Clauses (SCCs)** as a fallback, embedded in each subprocessor's DPA linked above
3. **Supplementary technical measures**: HMAC-signed sessions (no plain emails in URLs), TLS 1.2+ in transit, PII redaction in logs before they leave our process

For Anthropic specifically, we explicitly **disable model training on customer data** via the API contract — every API call OrcaTrade makes sets the relevant headers / parameters that flag inputs and outputs as not-for-training. See `lib/handlers/orchestrator.js` and the agent handlers for the implementation.

---

## How to ask about a subprocessor

If you're a prospect or customer evaluating OrcaTrade and need more detail on any of these — DPA signing, sub-DPA passthrough, data residency assertions, audit reports — email `orca@orcatrade.pl` with "subprocessor question: <provider>" in the subject. Response SLA: 5 business days.
