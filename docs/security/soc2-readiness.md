# SOC 2 readiness — gap analysis

**Last reviewed:** 2026-05-17
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
| CC2.1 | Internal info quality | ✅ | All architectural decisions captured in `docs/` (this folder, `backend-grade-plan.md`, `dev-plan.md`) |
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
| CC4.1 | Ongoing + separate evaluations | 🟡 | Test suite runs on every push + manually. Annual external pen test queued for 2026-Q4. |
| CC4.2 | Deficiency communication | ✅ | Every test failure blocks deploy. Failed GHA cron emails the founder. |

### CC5 — Control activities

| # | Criterion | Status | Evidence / Gap |
|---|---|---|---|
| CC5.1 | Control selection + development | ✅ | Documented in [`backend-grade-plan.md`](../backend-grade-plan.md) with explicit Track 1 non-negotiables (decimal money, no PII in events, audit on mutations) |
| CC5.2 | Tech controls implementation | ✅ | 1,464 automated tests covering auth, GDPR, calculator, circuit, logging, health |
| CC5.3 | Policies + procedures | 🟡 | This folder is the policy set. Annual review cadence not yet scheduled. |

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
| CC7.1 | Detection of security events | ✅ | Structured logs ([`lib/log.js`](../../lib/log.js)) + `/api/health` + uptime workflow + circuit breakers |
| CC7.2 | Monitoring of system components | ✅ | `/api/health` covers all five subsystems with per-subsystem state. Public `/status/` page polls every 30 s. |
| CC7.3 | Evaluation of security events | ✅ | [`incident-response.md`](incident-response.md) defines severities + comms SLAs |
| CC7.4 | Response to security incidents | ✅ | Incident-response runbook lives in this folder + tested informally |
| CC7.5 | Recovery from security incidents | 🟡 | Code recovery via GitHub is trivial. Tabletop disaster-recovery drill not yet held. |

### CC8 — Change management

| # | Criterion | Status | Evidence / Gap |
|---|---|---|---|
| CC8.1 | Change auth + tracking | ✅ | Every production change is a git commit with a clear message + test coverage; Vercel auto-deploys from `main` |

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
| PI1.3 | System processing is complete + accurate | ✅ | 1,464 tests including precision tests on €4.5M shipment compounds. Integer-cents arithmetic eliminates float drift. |
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
| P1 — Notice + communication | ✅ | `/regulations/privacy.html` + this folder + cookie banner v1 |
| P2 — Choice + consent | 🟡 | Cookie banner v1 is single-toggle (accept all / reject non-essential). Granular v2 queued in Track 5.2. |
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
6. **P2** — ship cookie banner v2 with granular consent (Track 5.2)

We don't need every 🟡 to close before Type I, but the six above are the audit's likely findings if we went today. Type II will require 6 months of evidence accumulation after each of these is in place — that's the 2027-Q2 path.

---

## What to share with a prospect

- **Tier 1 (early-stage prospect, pre-NDA):** point at this file's `Trust Services Criteria` summary
- **Tier 2 (signed NDA, pre-contract):** share the full folder including [`dpa-template.md`](dpa-template.md) + [`incident-response.md`](incident-response.md)
- **Tier 3 (enterprise contract):** answer specific questionnaire items in writing; offer a quarterly security review meeting

For everything else: `orca@orcatrade.pl`.
