# SOC 2 readiness — gap analysis

**Last reviewed:** 2026-05-31
**Owner:** Oskar Klepuszewski

Honest assessment of OrcaTrade's posture against the AICPA Trust Services Criteria (Security, Availability, Processing Integrity, Confidentiality, Privacy). Sized for SOC 2 Type I in 2026-Q4 — Type II in 2027-Q2 once we have 6+ months of operating evidence.

Each control is rated: ✅ **in place**, 🟡 **partial / queued**, ❌ **gap — no current control**.

This isn't an attestation. It's a working document we share with prospects under NDA. The truth is more useful than a marketing claim.

For the pre-funding posture we lean heavily on "controls demonstrated by automation + git history" rather than written policies that don't bind anyone. As we hire, each 🟡 / ❌ row gets a written policy + a dated quarterly review.

---

## Trust Services Criteria

### CC1 — Control environment

| # | Criterion | Status | Evidence / Gap |
|---|---|---|---|
| CC1.1 | Integrity and ethical values | ✅ | Confidentiality clause in every contractor agreement; founder signs Resend / Stripe / Vercel AUPs |
| CC1.2 | Board / governance oversight | 🟡 | Pre-seed: founder + advisor reviews quarterly. Formal board on funding. |
| CC1.3 | Org structure, reporting lines | 🟡 | Single founder + 1–2 contractors. Org chart trivial; documented as needed for enterprise procurement. |
| CC1.4 | Hiring, training, retention | 🟡 | No hires yet. Hiring runbook drafted on funding. |
| CC1.5 | Accountability for performance | ✅ | Every commit references a sprint; every sprint references an outcome in `backend-grade-plan.md` |

### CC2 — Communication and information

| # | Criterion | Status | Evidence / Gap |
|---|---|---|---|
| CC2.1 | Internal info quality | ✅ | Architectural decisions captured as numbered ADRs in [`docs/adr/`](../adr/) (18 records, each with a binding enforcement test in its `## Confirmation` section). Roadmap + sprint history in [`docs/backend-grade-plan.md`](../backend-grade-plan.md), [`docs/dev-plan.md`](../dev-plan.md), [`docs/billion-dollar-plan.md`](../billion-dollar-plan.md). |
| CC2.2 | Internal communication | ✅ | Single founder + contractors via async; no team Slack needed yet |
| CC2.3 | External communication | ✅ | `/regulations/privacy.html`, `/status/`, `orca@orcatrade.pl` for customer/regulator comms |

### CC3 — Risk assessment

| # | Criterion | Status | Evidence / Gap |
|---|---|---|---|
| CC3.1 | Risk identification + assessment | 🟡 | This folder + `backend-grade-plan.md` list the known risks. Formal annual review not yet scheduled. |
| CC3.2 | Fraud risk assessment | ✅ | Stripe handles all card-fraud surface; we never see PAN/CVV. Magic-link auth resists credential stuffing (no passwords to steal). |
| CC3.3 | Significant change identification | ✅ | Every architectural change goes through `backend-grade-plan.md` + a reviewable commit. |

### CC4 — Monitoring activities

| # | Criterion | Status | Evidence / Gap |
|---|---|---|---|
| CC4.1 | Ongoing + separate evaluations | ✅ | Test suite (3,200+ cases) runs on every push. Nightly comprehensive live-AI eval ([`.github/workflows/evals.yml`](../../.github/workflows/evals.yml)) + post-merge eval gate at ≥95% pass-rate ([`.github/workflows/eval-gate.yml`](../../.github/workflows/eval-gate.yml), [ADR 0018](../adr/0018-eval-gate-post-merge-95pct.md)). PR-time smoke against the Vercel preview ([ADR 0017](../adr/0017-pr-smoke-as-deploy-gate.md)) + post-deploy production smoke. Annual external pen test queued for 2026-Q4. |
| CC4.2 | Deficiency communication | ✅ | Every test failure blocks deploy via branch protection ([ADR 0012](../adr/0012-branch-protection-policy.md)). Failed GHA workflows email the founder; an agent reasoning regression on `main` opens an SEV2 the same day. |

### CC5 — Control activities

| # | Criterion | Status | Evidence / Gap |
|---|---|---|---|
| CC5.1 | Control selection + development | ✅ | Architectural rules captured in [`docs/adr/`](../adr/) as numbered, dated ADRs — calculator-grounding ([0002](../adr/0002-llm-never-produces-decision-numbers.md)), SDK boundary ([0003](../adr/0003-anthropic-sdk-boundary.md)), integer-cents money ([0004](../adr/0004-integer-cents-money.md)), audit-log-before-success ([0005](../adr/0005-audit-log-before-success.md)), circuit breakers ([0006](../adr/0006-circuit-breaker-on-external-calls.md)), API-version stability ([0007](../adr/0007-api-v1-stable-contracts.md)), email pseudonymisation ([0008](../adr/0008-email-pseudonymisation.md)). Each ADR names the test that enforces it. |
| CC5.2 | Tech controls implementation | ✅ | 3,200+ automated tests covering auth, GDPR, calculator, circuit, logging, health, human-review queue, hs-code lookup, branch-protection sync, eval-gate workflow shape. |
| CC5.3 | Policies + procedures | 🟡 | This folder + [`docs/adr/`](../adr/) + [`docs/runbooks/`](../runbooks/) + [`docs/handbook/`](../handbook/) form the policy set. Annual review cadence not yet scheduled. |

---

### CC6 — Logical and physical access

| # | Criterion | Status | Evidence / Gap |
|---|---|---|---|
| CC6.1 | Logical access controls | ✅ | HMAC-signed session cookies, magic-link auth with 15-min TTL, rate limiting (5/5min/IP on `/api/auth/request`) |
| CC6.2 | Account provisioning | ✅ | No multi-user accounts in v1 (one user per email); seats + role-per-org queued in Track 3.1 |
| CC6.3 | Authorization for system functions | 🟡 | Tier-gating via `lib/gating.js` for paid features. Admin-only routes (`/dashboard/leads/`) gated by `ORCATRADE_LEADS_TOKEN` env. No multi-role RBAC yet. |
| CC6.4 | Physical access | n/a | Fully serverless. No physical infrastructure under OrcaTrade's control. Inherits from Vercel + Upstash + Stripe. |
| CC6.5 | Removal of access | 🟡 | Session revocation list: queued for Track 3.2. Today: session cookies expire at 30 days, force-rotation requires bumping `ORCATRADE_AUTH_SECRET`. |
| CC6.6 | External boundary controls | ✅ | All public endpoints behind Vercel's edge (DDoS + TLS termination). Rate limits per IP on cost-sensitive endpoints. |
| CC6.7 | Restriction of data transmission | ✅ | TLS 1.2+ enforced; HSTS via Vercel default; HMAC-signed sessions (not plain emails in URLs); PII redaction in logs |
| CC6.8 | Malicious software prevention | ✅ | No file uploads in v1 (zero malware vector). Dependency surface is `@anthropic-ai/sdk` only — minimal supply-chain exposure. `npm audit` clean. |

### CC7 — System operations

| # | Criterion | Status | Evidence / Gap |
|---|---|---|---|
| CC7.1 | Detection of security events | ✅ | Structured logs ([`lib/log.js`](../../lib/log.js)) + Sentry capture ([ADR 0011](../adr/0011-security-scanning-stack.md)) + `/api/health` per-subsystem probes + uptime workflow + circuit breakers ([ADR 0006](../adr/0006-circuit-breaker-on-external-calls.md)). |
| CC7.2 | Monitoring of system components | ✅ | `/api/health` covers all five subsystems with per-subsystem state. Public `/status/` page polls every 30 s. Per-probe 2 s timeouts + SLO budget per [ADR 0006](../adr/0006-circuit-breaker-on-external-calls.md). |
| CC7.3 | Evaluation of security events | ✅ | [`incident-response.md`](incident-response.md) defines severities + comms SLAs. AI-agent escalations land in the real KV-backed human-review queue ([ADR 0015](../adr/0015-human-review-queue.md)) with 4 h ack / 24 h resolve SLA per [`docs/runbooks/human-review-queue.md`](../runbooks/human-review-queue.md). |
| CC7.4 | Response to security incidents | ✅ | [`docs/runbooks/`](../runbooks/) covers auth-subsystem-failure, billing-pipeline-failure, ai-agent-failure (with eval-gate drain procedure), KV/Postgres outage, branch-protection re-apply, and the human-review queue drain. Each runbook is reviewable through the standard PR flow. |
| CC7.5 | Recovery from security incidents | 🟡 | Code recovery via GitHub is trivial. Tabletop disaster-recovery drill not yet held. |

### CC8 — Change management

| # | Criterion | Status | Evidence / Gap |
|---|---|---|---|
| CC8.1 | Change auth + tracking | ✅ | Every production change lands via PR with required status checks ([ADR 0012](../adr/0012-branch-protection-policy.md)): test (Node 20 + 22), typecheck, commitlint, offline evals, pr-smoke against the Vercel preview, CodeQL SAST, gitleaks secret-scan. Code Owners review required; linear history enforced. Post-merge: eval-gate (≥95% pass-rate per agent, [ADR 0018](../adr/0018-eval-gate-post-merge-95pct.md)) + post-deploy smoke tripwire. Conventional commits + release-please ([ADR 0009](../adr/0009-conventional-commits-release-please.md)) drive a tamper-evident CHANGELOG. |

### CC9 — Risk mitigation

| # | Criterion | Status | Evidence / Gap |
|---|---|---|---|
| CC9.1 | Identify, select, develop risk-mitigation activities | ✅ | [`backend-grade-plan.md`](../backend-grade-plan.md) Phase α tracks |
| CC9.2 | Vendor / business-partner risk | ✅ | [`subprocessors.md`](subprocessors.md) covers each subprocessor's DPA, region, scope |

---

## Availability (A1)

| # | Criterion | Status | Evidence / Gap |
|---|---|---|---|
| A1.1 | Availability commitments | 🟡 | No published SLA today. Best-effort 99.5% inherited from Vercel + Upstash. Enterprise SLA negotiable. |
| A1.2 | Capacity + environmental monitoring | ✅ | `/api/health` + uptime workflow; Vercel function-level metrics in the dashboard |
| A1.3 | Backup + recovery | 🟡 | KV: Upstash automated backups (provider-managed). Source: GitHub. No quarterly restore drill yet. |

---

## Processing Integrity (PI1)

| # | Criterion | Status | Evidence / Gap |
|---|---|---|---|
| PI1.1 | Processing definitions | ✅ | Every calculator has a docstring + tests defining inputs/outputs |
| PI1.2 | System inputs are complete + accurate | ✅ | Zod-style validation in every handler (manual; library-free) + structured 400 responses |
| PI1.3 | System processing is complete + accurate | ✅ | 3,200+ tests including precision tests on €4.5M shipment compounds. Integer-cents arithmetic eliminates float drift per [ADR 0004](../adr/0004-integer-cents-money.md). |
| PI1.4 | System outputs are delivered | ✅ | Resend wrapped in circuit breaker; failed sends logged; users see degraded behaviour, not silent loss |
| PI1.5 | Processing is timely | ✅ | TARIC cache warmer keeps p99 under 300 ms for hot HS codes; aggressive timeouts on upstream fetches (4 s default) |

---

## Confidentiality (C1)

| # | Criterion | Status | Evidence / Gap |
|---|---|---|---|
| C1.1 | Identify + maintain confidential information | ✅ | [`data-flow.md`](data-flow.md) §"What counts as personal data here" |
| C1.2 | Disposal of confidential information | ✅ | GDPR `/api/account/delete` + retention TTLs documented |

---

## Privacy (P1–P8)

| # | Criterion | Status | Evidence / Gap |
|---|---|---|---|
| P1 — Notice + communication | ✅ | `/regulations/privacy.html` + this folder + cookie banner v2 ([`js/cookie-consent.js`](../../js/cookie-consent.js)) |
| P2 — Choice + consent | ✅ | Cookie banner v2 ships granular consent: essential (forced on) + analytics (opt-in, default off). Vercel Analytics script is loaded dynamically only after analytics consent is granted. Re-openable via any `[data-cookie-preferences]` link. Tri-locale (EN/PL/DE). |
| P3 — Collection | ✅ | Wizard collects only what each calculator requires; email is opt-in (`emailProvided:bool`, not the address, in events) |
| P4 — Use, retention, disposal | ✅ | [`data-flow.md`](data-flow.md) §"Retention summary" + Article 17 endpoint |
| P5 — Access | ✅ | `GET /api/account/export` covers Article 15 + 20 |
| P6 — Disclosure + notification | ✅ | [`incident-response.md`](incident-response.md) sets SEV-0 breach SLA at 48 h (faster than GDPR's 72 h) |
| P7 — Quality | ✅ | Calculator outputs are reproducible + tested; AI agent prompts are versioned (planned Track 6.1) |
| P8 — Monitoring + enforcement | 🟡 | DPO function carried by founder; formal review cadence pending hiring |

---

## Headline gaps to close before Type I (2026-Q4 target)

1. **CC4.1** — schedule annual external penetration test
2. **CC5.3** — set annual policy-review cadence with a recurring calendar item
3. **CC6.5** — implement session revocation list (Track 3.2)
4. **A1.1** — publish a default availability SLA
5. **A1.3** — quarterly disaster-recovery tabletop drill
6. ~~**P2** — ship cookie banner v2 with granular consent~~ ✅ **Done 2026-05-17** (Track 5.2)

We don't need every 🟡 to close before Type I, but the five above are the audit's likely findings if we went today. Type II will require 6 months of evidence accumulation after each of these is in place — that's the 2027-Q2 path.

---

## What to share with a prospect

- **Tier 1 (early-stage prospect, pre-NDA):** point at this file's `Trust Services Criteria` summary
- **Tier 2 (signed NDA, pre-contract):** share the full folder including [`dpa-template.md`](dpa-template.md) + [`incident-response.md`](incident-response.md)
- **Tier 3 (enterprise contract):** answer specific questionnaire items in writing; offer a quarterly security review meeting

For everything else: `orca@orcatrade.pl`.
