# Vendor TPRM — Third-Party Risk Management

This document is OrcaTrade's Third-Party Risk Management (TPRM)
register. For every subprocessor that handles customer data, we hold
a completed security questionnaire answered against the **shared
template** in this file. The shared questions are derived from CAIQ
v4 (Cloud Security Alliance) and SIG Lite (Shared Assessments) — the
two questionnaires customers will ask us to fill in about ourselves
and that we ask our subprocessors to fill in about themselves.

Last updated: 2026-06-02. Owner: Founder (Vendor Risk lead).

> **Cross-references:**
> - [`subprocessors.md`](subprocessors.md) — the canonical data-processing
>   register (purpose, region, data categories, DPA link). That doc
>   is the WHO; this doc is the HOW-WE-EVALUATED.
> - [`pentest-scope.md`](pentest-scope.md) — sub-processors explicitly
>   out-of-scope for our pen-test (their security is on their vendor).

---

## 1. The 12-question shared template

Every subprocessor's row below answers the same 12 questions. Procurement
reviewers can compare apples-to-apples across vendors:

| # | Question |
|---|---|
| Q1 | What customer data does the vendor process for OrcaTrade? |
| Q2 | What is the data-processing region (where does the data physically reside)? |
| Q3 | Is there a current DPA (Data Processing Agreement) in place? |
| Q4 | What is the vendor's published security certification / attestation status? |
| Q5 | How does the vendor handle data subject rights (Art. 15–22 GDPR) on data they process on our behalf? |
| Q6 | What is the vendor's breach notification SLA to us? |
| Q7 | What is the vendor's data retention + deletion policy when our contract ends? |
| Q8 | Does the vendor use our data for training models, advertising, or analytics products beyond service delivery? |
| Q9 | What is the encryption posture (at rest, in transit, key management)? |
| Q10 | What is the vendor's incident-response history (known material breaches in last 24 months)? |
| Q11 | Is the vendor on any sanctions list (OFAC, EU, UK)? |
| Q12 | Who is the vendor's named security contact + escalation path? |

## 2. Onboarding process for a new subprocessor

Before adding a new subprocessor:

1. **Scope confirmation** — the founder writes a one-paragraph
   summary of why the vendor is needed + what data they'd process.
2. **Questionnaire request** — vendor's security/trust page or
   directly-requested response to the 12 questions above.
3. **Risk rating** — Low / Medium / High based on:
   - Data sensitivity (Q1) — PII, prompts, payment data, source code
   - Region (Q2) — EU residency reduces friction; US/global needs Art. 46 transfer mechanism
   - Certification (Q4) — SOC 2 Type II / ISO 27001 reduce risk
   - Training/advertising use (Q8) — non-zero use is a Medium minimum
4. **Decision + record** — the answers + risk rating are added below.
   High-risk vendors require explicit founder sign-off documented in
   commit history.
5. **Customer notice** — when a new subprocessor goes live, customers
   under a signed DPA receive 30 days' notice (per
   [`subprocessors.md`](subprocessors.md)).
6. **Annual re-review** — every entry in this file is re-walked at
   least once per year, or sooner on a material vendor change (new
   region, new product, ownership change, breach disclosure).

## 3. Subprocessor answers

> **Notes on the answers below:**
> - Public vendor security pages are cited as the primary source.
> - If a question is unanswered (vendor hasn't published / hasn't
>   responded), the row says "**Pending vendor response**" rather
>   than fabricating an answer (honesty discipline).
> - Last verified date per row.

### 3.1 Vercel (web hosting, serverless functions, CDN)

**Risk rating:** Medium (data-in-transit + serverless function memory; certified).
**Last verified:** 2026-06-02 against <https://vercel.com/security>.

| # | Answer |
|---|---|
| Q1 | Every request/response passing through OrcaTrade's web edge: marketing-page requests, /start/ wizard inputs (incl. user-typed company / SKU / supplier names), /api/* request bodies and responses, session cookies in flight |
| Q2 | Functions: `fra1` (Frankfurt, Germany). CDN: global edge. Control plane: USA (per Vercel terms). |
| Q3 | Yes — https://vercel.com/legal/dpa |
| Q4 | SOC 2 Type II + ISO 27001 + PCI DSS — published at <https://trust.vercel.com> |
| Q5 | Vercel-side: data-subject requests proxy to us; we are the controller. Vercel acts on instructions. |
| Q6 | Per DPA: notification "without undue delay" after becoming aware. Vercel SLA portal publishes incident timelines. |
| Q7 | On contract termination: function code + logs deleted within 30 days; deployment artefacts retained per Vercel's retention policy |
| Q8 | **No.** Vercel does not use customer data for training or advertising (confirmed in DPA + public terms). |
| Q9 | At rest: AES-256 across managed services. In transit: TLS 1.3 by default; HSTS at our domain. Key management: AWS KMS (Vercel's underlying infra) |
| Q10 | No publicly disclosed material breach affecting Vercel customers in the last 24 months (as of last verified date). Vercel publishes incident reports at trust.vercel.com. |
| Q11 | Not on OFAC / EU / UK sanctions lists |
| Q12 | `security@vercel.com` — also their published security.txt at https://vercel.com/.well-known/security.txt |

### 3.2 Upstash (KV / Redis via Vercel Marketplace)

**Risk rating:** Medium (sessions + tokens + saved plans).
**Last verified:** 2026-06-02 against <https://upstash.com/trust>.

| # | Answer |
|---|---|
| Q1 | Sessions, magic-link tokens, saved plans (KV write-through), event log, TARIC warm cache, circuit-breaker state, rate-limit counters |
| Q2 | `eu-central-1` (Frankfurt). Confirmed in Upstash dashboard. |
| Q3 | Yes — https://upstash.com/trust/dpa |
| Q4 | SOC 2 Type II — published at https://upstash.com/trust |
| Q5 | Acts on our instructions; data-subject requests proxy through OrcaTrade |
| Q6 | Per DPA: notification within 72 hours of becoming aware |
| Q7 | Data deletion within 30 days of subscription end; can be expedited on request |
| Q8 | **No.** No training, no advertising use. |
| Q9 | At rest: AES-256. In transit: TLS. Key management: per-region KMS. |
| Q10 | No publicly disclosed material breach in last 24 months |
| Q11 | Not on sanctions lists |
| Q12 | `security@upstash.com` |

### 3.3 Resend (transactional email)

**Risk rating:** Medium (email addresses + magic-link tokens in email body).
**Last verified:** 2026-06-02 against <https://resend.com/legal>.

| # | Answer |
|---|---|
| Q1 | Recipient email addresses, user-provided name/company, plan permalink (signed URL with no PII in path), locale |
| Q2 | US-region SMTP/HTTP API; email delivery routed via Resend infra (multi-region for delivery, US for storage) |
| Q3 | Yes — https://resend.com/legal/dpa |
| Q4 | SOC 2 Type II — published at https://resend.com/security |
| Q5 | Acts on instructions; Resend's UI provides per-recipient unsubscribe + bounce handling |
| Q6 | Per DPA: notification within 72 hours of becoming aware |
| Q7 | Email logs retained 30 days then deleted; on contract termination, all data deleted within 30 days |
| Q8 | **No.** No training, no advertising. |
| Q9 | At rest: AES-256. In transit: TLS 1.2+. |
| Q10 | No publicly disclosed material breach in last 24 months |
| Q11 | Not on sanctions lists |
| Q12 | `security@resend.com` |

### 3.4 Anthropic (LLM inference)

**Risk rating:** Medium-High (user prompts can contain typed customer data; mitigated by no-training policy).
**Last verified:** 2026-06-02 against <https://www.anthropic.com/legal/commercial-terms> + <https://trust.anthropic.com>.

| # | Answer |
|---|---|
| Q1 | User prompts sent to the agents (compliance, sourcing, logistics, finance, orchestrator) + agent responses. We attach the user's `emailHash` (pseudonym) to API metadata for cost tracking; raw email never sent. |
| Q2 | US-region inference (api.anthropic.com). EU residency option available on Pro+ plans — not yet contracted. |
| Q3 | Yes — https://www.anthropic.com/legal/data-processing-addendum |
| Q4 | SOC 2 Type II — published at https://trust.anthropic.com. ISO 27001 certification in progress (per Anthropic Trust Centre). |
| Q5 | Acts on instructions; data-subject requests proxy through OrcaTrade |
| Q6 | Per DPA: notification within 72 hours of becoming aware |
| Q7 | Request contents and completions retained ≤ 30 days for abuse monitoring then deleted (commercial terms) |
| Q8 | **No training on API traffic.** Confirmed in commercial terms. No advertising use. |
| Q9 | At rest: encrypted. In transit: TLS 1.3. Key management: AWS KMS. |
| Q10 | No publicly disclosed material breach affecting API customers in last 24 months |
| Q11 | Not on sanctions lists |
| Q12 | `security@anthropic.com`; also via Anthropic Trust Centre |

### 3.5 Neon (Postgres)

**Risk rating:** Medium-High (durable mirror of plans + portfolios + events; `email_hash` only, no raw email).
**Last verified:** 2026-06-02 against <https://neon.tech/trust>.

| # | Answer |
|---|---|
| Q1 | Saved plans, portfolios, events log, actuals (reality-check reports), audit-chain rows. Identity column is `email_hash` (16-hex SHA-256), NOT raw email. |
| Q2 | EU region (Frankfurt-equivalent) per OrcaTrade's Neon project config. Confirmed in dashboard. |
| Q3 | Yes — https://neon.tech/dpa |
| Q4 | SOC 2 Type II — published at https://neon.tech/trust. ISO 27001 in progress. |
| Q5 | Acts on instructions; data-subject requests proxy through OrcaTrade. We hold the deletion key (cascade on `email_hash`). |
| Q6 | Per DPA: notification within 72 hours of becoming aware |
| Q7 | On project deletion: branches + WAL + snapshots deleted within 14 days |
| Q8 | **No.** No training, no advertising. |
| Q9 | At rest: AES-256 (Postgres + page-server). In transit: TLS 1.2+. Branch-isolated WAL. |
| Q10 | No publicly disclosed material breach in last 24 months |
| Q11 | Not on sanctions lists |
| Q12 | `security@neon.tech` |

### 3.6 Stripe (subscription billing)

**Risk rating:** Low (no card data ever reaches OrcaTrade; Stripe is the PCI-scope holder).
**Last verified:** 2026-06-02 against <https://stripe.com/security>.

| # | Answer |
|---|---|
| Q1 | Email, billing address, payment method (we never see PAN / CVV) |
| Q2 | Ireland (EU primary) + US fallback per Stripe's topology |
| Q3 | Yes — https://stripe.com/legal/dpa |
| Q4 | PCI DSS Level 1, SOC 1/SOC 2 Type II, ISO 27001 — published at https://stripe.com/security |
| Q5 | Customer-side rights via the Stripe Customer Portal; OrcaTrade-side via our /account/billing flow |
| Q6 | Stripe publishes incident reports at status.stripe.com; DPA SLA "without undue delay" |
| Q7 | On contract termination: PII deleted within retention period (subject to regulatory holds, e.g. tax records 7 yr) |
| Q8 | **No training on customer data.** Limited analytics for fraud detection (in DPA scope). |
| Q9 | PCI-grade encryption; key management via Stripe's HSM stack |
| Q10 | No PCI-scope breach in last 24 months. Public incident timeline at status.stripe.com. |
| Q11 | Not on sanctions lists |
| Q12 | `security@stripe.com` |

### 3.7 GitHub (source control + CI)

**Risk rating:** Low (source code + ephemeral CI runs; no production customer data in repo).
**Last verified:** 2026-06-02 against <https://github.com/security>.

| # | Answer |
|---|---|
| Q1 | Repository contents (code, no customer data). GitHub Actions logs (may contain ephemeral data from cron runs — sanitised via lib/log.js redact pipeline before logging). |
| Q2 | USA (GitHub.com infra). |
| Q3 | Yes — https://docs.github.com/en/site-policy/privacy-policies/github-data-protection-agreement |
| Q4 | SOC 1/2/3, ISO 27001/27017/27018, FedRAMP — published at https://github.com/security |
| Q5 | Acts on instructions; data-subject requests via GitHub's Privacy portal |
| Q6 | Per DPA; GitHub publishes incidents at githubstatus.com |
| Q7 | On account deletion: per GitHub's standard policy (90 days for recovery; permanent thereafter) |
| Q8 | **No training of products on private repository contents** (per terms). Public repos may be indexed. OrcaTrade repo is private. |
| Q9 | At rest: AES-256. In transit: TLS 1.2+. SSH for git access. |
| Q10 | No material breach affecting private repos in last 24 months |
| Q11 | Not on sanctions lists |
| Q12 | `security@github.com` |

### 3.8 Voyage AI (planned — embeddings for RAG corpus)

**Risk rating:** Medium (corpus chunks sent for embedding; no PII).
**Last verified:** Vendor not yet contracted.

Per apex plan P1.11 (real RAG corpus). When contracted, this row is
completed against Voyage's trust page and the embeddings API
contract. Until then:

| # | Status |
|---|---|
| Q1 — Q12 | **Pending vendor onboarding** — see §2 onboarding process |

### 3.9 Sentry (observability)

**Risk rating:** Low-Medium (error context; redacted by lib/log.js).
**Last verified:** 2026-06-02 against <https://sentry.io/trust>.

| # | Answer |
|---|---|
| Q1 | Error stack traces + context (lib/log.js redact pipeline strips email/token/secret/apiKey/cookie/authorization/sessionId BEFORE forwarding to Sentry — see test/log-redact-contract.test.js) |
| Q2 | EU region selected in OrcaTrade's Sentry project |
| Q3 | Yes — https://sentry.io/legal/dpa |
| Q4 | SOC 2 Type II, ISO 27001 — published at https://sentry.io/trust |
| Q5 | Acts on instructions; data-subject requests via Sentry support |
| Q6 | Per DPA: 72 hours |
| Q7 | Default 90-day event retention; on contract termination, full deletion within 30 days |
| Q8 | **No.** No training; no advertising. |
| Q9 | At rest: AES-256. In transit: TLS 1.2+. |
| Q10 | No publicly disclosed material breach in last 24 months |
| Q11 | Not on sanctions lists |
| Q12 | `security@sentry.io` |

## 4. Risk-rating distribution (current state)

| Risk rating | Vendors |
|---|---|
| **Low** | Stripe, GitHub |
| **Medium** | Vercel, Upstash, Resend, Sentry |
| **Medium-High** | Anthropic, Neon |
| **High** | (none) |
| **Pending onboarding** | Voyage |

No vendor at High risk today. If a future onboarding lands at High,
this file is updated with the founder's explicit sign-off in commit
history.

## 5. Customer evidence pack

Customers under DPA can request a TPRM evidence pack containing:

- This document (versioned with a `Last verified` date per vendor)
- The current `subprocessors.md` snapshot
- Vendor DPAs (links above; we can mirror locally on request)
- Risk-rating rationale per vendor
- Notice history of subprocessor changes (commit history of this file)

Pack assembly: ~30 minutes manual today; automate when customer count
warrants.

## 6. Limitations of this document

- **Not a substitute for vendor-issued SOC 2 reports.** A customer
  procurement team that requires the actual SOC 2 report walks
  through the vendor's trust portal directly.
- **`Pending vendor response`** entries are real gaps — we surface
  them honestly rather than fabricating answers.
- **Last verified dates are per-row.** A row's `Last verified: …` is
  the only timestamp that applies; the document-level `Last updated`
  is the latest of those.
- **No automated re-verification yet.** Today verification is manual
  on a yearly cadence. Automated periodic re-checks of vendor trust
  pages is queued (Phase 2 deliverable).

## 7. Revision history

| Version | Date | Change |
|---|---|---|
| v1 | 2026-06-02 | Initial vendor TPRM register (apex P1.L) with 9 vendors |
