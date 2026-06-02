# Data Processing Addendum (DPA) — Template

**Last reviewed:** 2026-05-17

This is the standard DPA OrcaTrade signs with customers who process personal data through the platform. It is drafted in line with GDPR Article 28 and is intended as a starting point — bespoke amendments are negotiable for enterprise customers, but the template covers ~95% of EU SME procurement requirements.

To execute: contact `orca@orcatrade.pl` with subject "DPA request — <company name>". Typical turnaround: 3 business days for a signed PDF.

This document is a template only. The signed version controls.

---

## 1. Parties

**Controller:** the OrcaTrade customer signing the underlying Order Form / Subscription (the "Customer").

**Processor:** OrcaTrade Group, Warsaw, Poland (the "Processor").

Where required, the Processor is also acting as a sub-processor on behalf of the Controller's own customers. The Controller represents that it has the authority to engage the Processor under that capacity.

---

## 2. Subject matter and duration

**Subject matter:** processing of Personal Data by the Processor in order to provide the OrcaTrade platform — import-plan generation, AI agent responses, saved plan storage, billing, and related features described at orcatrade.pl/platform/.

**Duration:** for the term of the underlying Subscription, plus a wind-down period of up to 30 days during which Personal Data is returned and deleted in accordance with Section 7.

---

## 3. Nature, purpose, and types of Personal Data

| Category | Purpose | Examples |
|---|---|---|
| Identity | Account creation, authentication, communication | Email, optional name, optional company name |
| Behavioural | Generation of import plans | HS codes, origin / destination countries, customs values, weights, transit preferences |
| Operational | Service operation | Session cookies, IP at request time (rate-limit only), request-id (correlation) |
| Billing | Payment processing (handled by Stripe sub-processor) | Email, billing address, payment method — card data is never seen by the Processor |

For a complete and current inventory see [`data-flow.md`](data-flow.md).

---

## 4. Categories of data subjects

- Customer's employees who use the OrcaTrade platform
- Customer's contacts entered into the platform incidentally (e.g. supplier email shown in an agent prompt — minimised wherever possible)

---

## 5. Obligations of the Processor

The Processor shall:

1. **Process Personal Data only on documented instructions** from the Controller, including with regard to transfers to a third country, unless required to do so by EU or Member State law.
2. Ensure that **persons authorised to process** Personal Data have committed themselves to confidentiality or are under an appropriate statutory obligation.
3. Implement **appropriate technical and organisational measures** as set out in Annex A.
4. **Engage sub-processors** only with the prior general written authorisation of the Controller, in accordance with Section 6.
5. **Assist the Controller** by appropriate technical and organisational measures in fulfilling the Controller's obligations under Articles 15–22 of the GDPR (data subject rights).
6. **Notify the Controller without undue delay** after becoming aware of a Personal Data Breach, and in any event within 48 hours.
7. **Make available to the Controller all information** necessary to demonstrate compliance, and allow for and contribute to audits in accordance with Section 8.

---

## 6. Sub-processors

The Controller provides general authorisation for the Processor to engage sub-processors listed at [`subprocessors.md`](subprocessors.md).

The Processor shall:
- Notify the Controller via email at least **30 days before** any new sub-processor goes live.
- Allow the Controller to **object** to the change in writing. If the Controller objects on reasonable grounds related to GDPR compliance, the Processor will work in good faith to resolve, and if no resolution is reached, the Controller may terminate the underlying Subscription with a pro-rata refund.
- Impose obligations on each sub-processor that are **no less protective** than those in this DPA.

---

## 7. Return and deletion of Personal Data

On termination of the underlying Subscription, the Processor shall:

1. **Allow the Controller to export Personal Data** via `GET /api/account/export` (programmatic) or, for larger or non-self-serve exports, via written request, within 30 days of termination.
2. **Delete or pseudonymise** Personal Data in accordance with [`data-flow.md`](data-flow.md) §"Retention summary", and in any event within 60 days of termination unless retention is required by EU or Member State law.
3. Deletion of data held by **sub-processors** is governed by each sub-processor's DPA and the sub-processor's deletion mechanisms.

The Controller acknowledges that certain logs (e.g. Vercel function logs, GHA workflow logs, Stripe ledger entries) are retained by sub-processors under their own retention policies and cannot be selectively deleted by the Processor.

---

## 8. Audits

The Controller may, no more than once per calendar year, request:

1. **A written response** to a security questionnaire covering the topics in [`soc2-readiness.md`](soc2-readiness.md). Response SLA: 10 business days.
2. **A copy of the most recent SOC 2 / ISO 27001 report** when available (Track 5 of [`backend-grade-plan.md`](../backend-grade-plan.md) flags SOC 2 Type I as a 2026-Q4 milestone; until then, attestation is via this DPA + the security docs).

On-site audits are not generally available given the Processor's headcount, but the Processor will respond in good faith to any reasonable due-diligence request from an enterprise customer with an active contract over €25,000 / year.

---

## 9. International transfers

Where Personal Data is transferred outside the EU/EEA to a sub-processor, the Processor relies on:

- The **EU–US Data Privacy Framework** for certified sub-processors, OR
- **EU Standard Contractual Clauses** (Module 3: Processor-to-Processor) incorporated by reference from each sub-processor's DPA listed at [`subprocessors.md`](subprocessors.md).

Supplementary technical measures applied to all transfers: TLS 1.2+ in transit, HMAC-signed session identifiers in lieu of plaintext PII in URLs, PII redaction in application logs before egress.

---

## 10. Liability and limitations

Liability for Personal Data Breaches is governed by the underlying Subscription's liability cap unless otherwise required by GDPR or applicable supervisory authority guidance. No part of this DPA limits the Controller's or Processor's statutory liability to data subjects under the GDPR.

---

## Annex A — Technical and Organisational Measures (TOMs)

Implementation status as of the date at the top of this file. For ongoing detail see [`soc2-readiness.md`](soc2-readiness.md) and [`backend-grade-plan.md`](../backend-grade-plan.md).

### A.1 Access controls

- HMAC-signed session cookies, no server-side session table (so a leaked DB row cannot resurrect a session)
- HttpOnly + SameSite=Lax + Secure cookies
- Magic-link auth with 15-minute token TTL
- Rate limiting on `/api/auth/request` (5 per 5 min per IP)
- TOTP MFA: **planned**, Track 3.2
- SAML SSO: **planned**, Track 3.3

### A.2 Encryption

- TLS 1.2+ enforced on all public endpoints (Vercel-managed certificates, auto-renewal)
- At-rest encryption provided by Upstash (KV) and Neon (planned)
- Application secrets in Vercel environment variables (encrypted at rest by Vercel)
- No customer-side encryption keys (BYOK) — not requested by any customer to date; available on enterprise contracts

### A.3 Logging and monitoring

- Structured JSON logs ([`lib/log.js`](../../lib/log.js)) with PII redaction at write time (email, token, secret, apiKey, cookie, authorization automatically masked)
- Per-request correlation via `x-request-id` (mint + echo + log)
- Operational health probe at `/api/health` with subsystem-level status (KV, TARIC, Resend, Stripe, Anthropic) and circuit-breaker overlay
- Public status page at `/status/` for transparency
- External uptime probe via GHA cron every 5 minutes

### A.4 Resilience

- Three-state circuit breakers around all external upstreams (Resend wired today; TARIC + Stripe + Anthropic queued)
- KV-backed breaker state survives function cold starts
- Documented fallbacks for every upstream — no upstream failure crashes a user-facing request

### A.5 Data integrity

- 3,200+ automated tests cover the calculator surface, auth, GDPR endpoints, circuit logic, structured logging, the human-review queue, the calculator-grounded HS-code lookup, branch-protection sync, and the eval-gate workflow shape
- Integer-cents arithmetic ([`lib/intelligence/money.js`](../../lib/intelligence/money.js)) for monetary calculations — no float drift at €5M+ scale ([ADR 0004](../adr/0004-integer-cents-money.md))
- Git-based change control — every production change is a reviewable commit with required status checks (test, typecheck, commitlint, offline evals, pr-smoke, CodeQL, gitleaks), Code Owner approval, and linear history ([ADR 0012](../adr/0012-branch-protection-policy.md)); post-merge eval gate at ≥95% pass-rate per agent ([ADR 0018](../adr/0018-eval-gate-post-merge-95pct.md))

### A.6 Personnel

- One full-time founder (Oskar Klepuszewski) plus contractors under written confidentiality terms
- All personnel sign a confidentiality clause covering customer data, retained beyond engagement end
- No customer Personal Data accessed by personnel outside their job duties

### A.7 Incident response

- See [`incident-response.md`](incident-response.md) for severity classes, communication SLAs, and post-mortem process
- Breach notification SLA: 48 hours from confirmed detection (faster than GDPR's 72-hour ceiling)

### A.8 Backup and recovery

- Source code: GitHub (versioned, full history)
- Application state in KV: Upstash provides automated backups with point-in-time recovery (consult Upstash DPA for retention specifics)
- Documents in this `docs/security/` folder are version-controlled and replicated across every developer machine that has cloned the repo

### A.9 Vendor management

- Each subprocessor is reviewed before onboarding for: DPA availability, EU/EEA data residency (or DPF certification), security posture, breach-notification commitments
- Subprocessors listed in [`subprocessors.md`](subprocessors.md); changes notified per Section 6
