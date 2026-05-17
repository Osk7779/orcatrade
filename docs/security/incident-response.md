# Incident response

**Last reviewed:** 2026-05-17
**Owner:** Oskar Klepuszewski (founder + DPO equivalent)
**On-call:** Oskar Klepuszewski (sole responder; rotation pending hiring)

What we do when something goes wrong. Sized for OrcaTrade's current stage — one-founder operation, low-six-figure-EUR pipeline — but written so that each section maps cleanly to the equivalent SOC 2 / ISO 27001 control as we scale.

For who-sees-what see [`subprocessors.md`](subprocessors.md). For the underlying technical posture see [`dpa-template.md`](dpa-template.md) Annex A.

---

## Severity classes

| Severity | Definition | Examples | Detection target | Customer comms SLA |
|---|---|---|---|---|
| **SEV-0** | Confirmed Personal Data Breach OR full platform outage > 5 min | Database leak, KV exposed publicly, customer data emailed to wrong recipient, /api/health returns 503 for >5 min | 5 minutes | < 24 h to all affected customers + < 72 h to supervisory authority (UODO for the Polish entity) |
| **SEV-1** | Major degradation affecting a billable feature OR potential breach under investigation | Wizard returns 5xx for >5% of requests, Stripe webhook failing > 30 min, suspected (not confirmed) credential exposure, AD/CVD calculator returning a stale rate that affects active customer quotes | 15 minutes | < 4 h to affected customers, no regulator notification unless confirmed breach |
| **SEV-2** | Minor degradation, no billing impact | Resend circuit open (silent fallback), TARIC cache stale > 25 h, a single agent endpoint failing | 1 hour | < 24 h status page update, no per-customer comms |
| **SEV-3** | Informational / no user impact | Vercel deploy warning, GHA workflow flaking but recovering, deprecated dependency advisory | 1 day | None |

---

## Detection

Today (single-founder phase):

1. **GHA uptime workflow** ([`.github/workflows/uptime.yml`](../../.github/workflows/uptime.yml)) hits `/api/health` every 5 minutes. HTTP 503 fails the run; GitHub emails Oskar.
2. **GHA cron workflow** failures (nightly TARIC warm, Monday founder digest, etc.) also email Oskar.
3. **Public status page** at `/status/` polls health every 30 s and visibly degrades — customers see issues sometimes before we do, and contact `orca@orcatrade.pl`.
4. **Vercel deploy emails** for any failed deploy or surge in 5xx.

Planned escalations (Track 4.2 of [`backend-grade-plan.md`](../backend-grade-plan.md)):
- Sentry for application errors with per-release health
- Axiom log drain for retrospective grep beyond Vercel's 30-day window
- PagerDuty / Better Uptime to convert email alerts into real pages when we hire a second responder

---

## Communication channels

| Audience | Channel | Triggered by |
|---|---|---|
| **Customers — public** | `/status/` page (auto from `/api/health`) | Any non-ok health probe |
| **Customers — direct** | Email from `orca@orcatrade.pl` (manual) | SEV-0 or SEV-1, scoped to affected accounts |
| **Founder** | GitHub Actions email + Vercel emails | All severities |
| **Supervisory authority** (UODO) | Email + the UODO web form | SEV-0 (confirmed breach), within 72 h per GDPR Art 33 |
| **Subprocessors** | Their published incident channels (Vercel status, Upstash status, Stripe status, Anthropic status) | When the root cause is upstream |

---

## Lifecycle of an incident

### 1. Detect → Acknowledge (target: < 15 min for SEV-0/1)

- Confirm the alert isn't a transient flap (re-hit `/api/health`, check Vercel dashboard).
- Open a `INCIDENT-YYYY-MM-DD-<slug>.md` file in `docs/incidents/` (folder created on first incident) with severity, start time, hypothesis.
- Update the status page (today: manual edit; future: automated banner from a KV flag).

### 2. Contain (target: < 1 h for SEV-0/1)

- For a data exposure: revoke the affected key/secret immediately (KV: rotate the Upstash REST token; Resend: rotate the API key; Stripe: roll the restricted key).
- For an outage: identify the smallest change that restores service. Roll back via `git revert` + push; Vercel auto-deploys in < 2 min.
- For a circuit-trigger storm: manually `circuit.reset(<name>)` only after the upstream is confirmed healthy.

### 3. Investigate

- Pull logs for the request-id range from Vercel + Axiom (when available).
- For a data-access question: who could have seen what, when. Cross-reference the audit log (KV `circuit:*` + log entries with the suspected email hash).

### 4. Resolve

- Apply the fix. Push a hotfix commit referencing the incident file.
- Update `/status/` back to ok.
- Customer comms: send the SEV-0/1 follow-up email within the SLA above.

### 5. Post-mortem (within 5 business days)

- Blameless write-up appended to `INCIDENT-…md`: timeline, root cause, contributing factors, what worked, what didn't, action items.
- Action items get tickets / sprint entries in [`backend-grade-plan.md`](../backend-grade-plan.md). Each action item has an owner + a deadline. No "we should…" — only "X will Y by Z."

---

## Specific runbooks

### "KV is down" (SEV-0)

Symptoms: `/api/health` returns 503, every handler errors on its first KV read.

1. Check Upstash status page (https://status.upstash.com).
2. If Upstash-side: post to `/status/`, email affected customers if down > 15 min.
3. If our-side (wrong creds, accidentally rotated, etc.): roll back the last commit that touched env vars; re-deploy.
4. While down: most read-only endpoints (calculator quotes via `calculateQuote` sync path) still work because the chapter estimator doesn't need KV. Most write paths (save plan, founding apply, magic-link) will fail; that's acceptable degradation.

### "Resend is rate-limiting us" (SEV-1)

Symptoms: emails not arriving, `lib/handlers/start.js` + `lib/handlers/auth.js` logging `resend send failed status: 429`, circuit `resend` opens after 5 failures.

1. Check Resend dashboard for sending volume + bounce rate.
2. If a single customer is causing it (spam-like signup pattern): manually block by adding their email/IP to a denylist (KV key `denylist:emails` — planned, Track 4.5).
3. If platform-wide: contact Resend support, raise the rate limit cap. Circuit will auto-recover when sends start succeeding.

### "Anthropic returned content that should not be shown to a user" (SEV-1)

Symptoms: a customer reports an agent response that leaked PII, made a numerical claim not grounded in a calculator, or returned harmful content.

1. Pull the request-id from the report. Find the log line with the full agent input + output hash.
2. Add the specific scenario to `lib/ai/evals/<agent>/cases.json` as a must-not-contain regression test (Track 6 of [`backend-grade-plan.md`](../backend-grade-plan.md)).
3. If the issue is calc-grounding (an LLM-produced number not traced to a calculator output): tighten the prompt, ship via the prompt registry, re-run evals.
4. If the issue is PII leak: scrub via the redaction layer in `lib/log.js` AND add the field to PII_KEYS so future logs are clean.

### "Suspected credential leak" (SEV-0 until proven otherwise)

Symptoms: an internal env var appears in a logged stack trace, a screenshot, or a customer report.

1. **Rotate immediately**, before investigating root cause. Order: most-blast-radius first — `ORCATRADE_AUTH_SECRET` (sessions), `KV_REST_API_TOKEN` (data), `STRIPE_SECRET_KEY` (money), `RESEND_API_KEY` (impersonation), `ANTHROPIC_API_KEY` (cost), `ORCATRADE_CRON_TOKEN` (cron forgery).
2. After rotation, force re-deploy on Vercel so the in-memory function cache picks up the new env.
3. Audit log: when was the value last printed, was it in a public artifact (GitHub, screenshot), was anyone exposed?
4. Inform customers per the SEV-0 SLA above.

---

## What we have **not** done yet (be honest about the gaps)

This is a one-founder operation. The following SOC 2-grade controls are queued but not yet in place. See [`soc2-readiness.md`](soc2-readiness.md) for the full gap analysis.

- **No 24/7 on-call rotation**. Outages outside European working hours rely on the founder noticing the email. Customers needing higher coverage should ask about a paid SLA.
- **No automatic page → phone escalation**. GHA emails Oskar; no SMS / Slack / PagerDuty bridge yet.
- **No tabletop incident drills** scheduled. Tabletop quarterly is queued for 2026-Q3.
- **No tabletop disaster-recovery drill** of "what if Vercel goes away". Restoring from source-of-truth (GitHub) takes ~30 min to a new Vercel project, ~2 h to add custom domain DNS, ~1 h to provision a new Upstash KV. Total RTO: ~3 h. RPO: < 24 h of KV state in the worst case.

We tell customers about these gaps proactively rather than discovering them mid-incident. Track 5.4 (this doc set), Track 4.2 (Sentry / Axiom), and Track 4.5 (queue + retry) close most of them.
