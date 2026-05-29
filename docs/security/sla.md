# Service-level objectives, error budgets, and SLA posture

**Last reviewed:** 2026-05-28 · **Owner:** founder / on-call

This document is the answer set for the procurement question *"what reliability
do you commit to, and what happens when you miss?"* — written honestly, with
the actual production controls behind each number named. Companion documents:
[`data-flow.md`](data-flow.md), [`incident-response.md`](incident-response.md),
[`soc2-readiness.md`](soc2-readiness.md).

---

## SLOs (the targets)

| Surface | Target (90-day rolling) | Why this number |
|---|---|---|
| **`/api/health`** | **99.9% reachable** | Platform liveness; probed externally every 5 min via the GitHub Actions `uptime` workflow. |
| **`/api/v1/*` synchronous JSON endpoints** (`/plans`, `/portfolios`, `/customs`, `/routing`, `/finance-quote`, `/marketplace`, …) | **99.5% success-rate (HTTP 2xx ÷ all responses, excluding 4xx)** with **P95 latency ≤ 1.5 s** | The customer-facing read/write paths. 4xx is excluded from the success-rate because client errors aren't us. |
| **Agent endpoints** (`/api/orchestrator`, `/api/agent`, `/api/sourcing-agent`, …) | **99.0% success-rate** with **P95 stream-first-byte ≤ 5 s** | Higher tolerance because the LLM upstream is the variance driver; circuit breaker in [`lib/circuit.js`](../../lib/circuit.js) wraps Anthropic. |
| **Document drafting + approval** (`/api/documents`) | **99.5% success-rate** | Deterministic, no LLM, but the persistence path matters for the audit chain. |
| **Calculator correctness** (any quote) | **0 known regressions** between releases | Enforced by the 3,000-test regression suite + the calc-grounding eval gate (`lib/ai/evals/scorer.js`); a hallucinated number against a calculator output blocks merge. |
| **Audit log immutability** | **0 detectable chain breaks** | Verified by `GET /api/audit?format=verify-stored`. An auditor can independently verify any chain export per [`audit-trail.md`](audit-trail.md). |

These targets apply to **production** on `orcatradegroup.com`. Preview
deployments and pre-release channels do not carry SLOs.

## Error budget

A 99.5% SLO over 90 days is **0.5% downtime budget ≈ 10.8 hours** of allowed
unavailable / failing minutes per quarter for the synchronous JSON surface.
Tracking is done by counting `5xx` responses + timeouts in
[`lib/log.js`](../../lib/log.js) structured events.

**Burn-rate policy** (informed by Google SRE 2× / 14-day windows):

- **Fast burn — paging:** if **2% of the budget is consumed in any 1-hour
  window** (≈ 13 minutes of failures in an hour) the on-call is paged.
- **Slow burn — investigation:** if **10% of the budget is consumed in any 6-hour
  window**, an investigation issue is opened and the next deploy gates on a
  fix.
- **Budget exhaustion → release freeze:** when the budget is fully consumed in
  the rolling window, all non-reliability releases freeze until the budget
  rolls back into the green. Reliability-only fixes can still ship.

A monthly review checks the budget consumption, the worst incident, and the
top three "saved-by-degradation" events (where a circuit breaker absorbed an
upstream failure before the customer noticed).

## How we degrade rather than disappear

Every external dependency is wrapped in a circuit breaker
([`lib/circuit.js`](../../lib/circuit.js)) and a documented fallback. When an
upstream is slow or down, the platform answers a (clearly-marked) degraded
result rather than 5xx-ing. The matrix:

| Upstream | Circuit | Fallback when open / failing |
|---|---|---|
| **TARIC** (EU customs tariff) | open after consecutive failures | chapter-level duty estimator (`lib/intelligence/customs-quote.js`); response carries `duty.mfnSource: 'chapter-estimator'`. |
| **Anthropic API** | open on rate-limit / 5xx | sync calculator-grounded answer (no LLM prose); UI surfaces "agent unavailable, here are the deterministic figures". |
| **Voyage AI** (embeddings) | open on auth / rate-limit | RAG falls back to BM25-only (`lib/intelligence/retrieval.js` `searchHybrid`); recall slightly lower, grounding identical. |
| **Resend** (email) | best-effort | record the `*_email_failed` audit row; user can retry from the UI; no functional path blocks. |
| **Stripe** | best-effort | billing endpoints 502 with a clear message; the rest of the platform is unaffected. |
| **Sanctions lists** (OFAC / OFSI / UN / EU) | scheduled refresh | screening serves the last-known-good list with the `lastRefreshedAt` exposed; never returns "clear" if the list itself is unavailable. |

Principle #5 in the apex plan: **degrade, never disappear.** A circuit that
opens is a feature, not an incident — incidents are when the fallback itself
fails.

## What we do NOT yet commit to

Calling these out honestly so a buyer cannot be surprised:

- **Multi-region failover.** Today the platform runs single-region (Vercel
  primary + Neon primary). A region outage at Vercel or Neon is a
  full-platform outage. Active-active multi-region is on the apex plan
  (III5 / F1 with Vercel Pro + Fluid) but not in production.
- **Paid 24/7 paging rotation.** On-call rotates between the founder and (when
  hired) the head of platform — GitHub email is the paging channel. PagerDuty
  / Opsgenie integration is queued for the SOC 2 observation window.
- **A signed contractual SLA with credits.** Available on the Enterprise tier
  on request; default plans (Free / Starter / Growth / Scale) carry SLOs as
  targets, not as legal commitments. The enterprise quote includes the
  contractual SLA with credit terms.

## Status surfaces a customer can use today

- **Live operational status**: [`/status/`](https://orcatrade.pl/status/)
- **Machine-readable health**: `GET /api/health` (used by the GitHub Actions
  `uptime` workflow that probes every 5 min).
- **Post-deploy smoke**: `npm run smoke` (also runs as a GitHub Action on
  every push to `main`; see [`.github/workflows/smoke.yml`](../../.github/workflows/smoke.yml)).
- **Audit-trail verification**: `GET /api/audit?format=chain` produces a
  portable, independently-verifiable export ([`audit-trail.md`](audit-trail.md)).

If you spot drift between this document and observed behaviour, that's a bug —
email `orca@orcatrade.pl` (subject prefix: `security:`) and we will correct it
within 5 business days.
