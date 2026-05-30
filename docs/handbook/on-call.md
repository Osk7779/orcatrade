# On-call

Honest version: today on-call is a rotation of one (Oskar). This document
describes what that means in practice, what response targets we hold
ourselves to even at N=1, and what changes when a real rotation lands
(Phase 3 task P3.1 in [docs/execution-plan.md](../execution-plan.md)).

## What "on-call" means today

- **Pager owner:** Oskar
- **Hours:** business hours (London), responses outside hours are best-effort
- **Channels:** Resend email to `oskar@orcatrade.…` (uptime workflow);
  Slack webhook (configured); GitHub issue mentions
- **Backup:** none. If Oskar is unavailable, the service is unavailable
  to humans for the duration. The platform's auto-healing (circuit
  breaker, retries, fallback responses) is the only mitigation.

## Response targets (informal, until P3.1 makes them contractual)

| Severity | Target acknowledgement | Target mitigation |
|---|---|---|
| SEV1 (customer-facing outage, data loss, security breach) | 30 min, 24/7 best-effort | 4 hours |
| SEV2 (degradation, partial outage) | 4 hours business | 24 hours |
| SEV3 (single-customer issue, non-critical regression) | 1 business day | 1 week |

These are aspirations until P3.1 ships PagerDuty/Opsgenie + a real
rotation. They will become contractual (with SLA credits) for enterprise
customers in Phase 2 (P2.E, P2.13).

## What triggers a page

Currently three sources:

1. **`/api/health` probe** ([lib/handlers/health.js](../../lib/handlers/health.js))
   from the [uptime workflow](../../.github/workflows/uptime.yml) every
   5 minutes. Two consecutive failures → Resend email + Slack webhook.
2. **Sentry capture** of an unhandled error (per [ADR 0006](../adr/0006-circuit-breaker-on-external-calls.md)
   — Sentry wiring is wired but underutilised; coverage expansion is
   Phase 0 P0.7).
3. **Customer email** to support / `intelligence@orcatrade.pl`.

Manual reports from Oskar's own usage of the product also count — if
you find a bug while using the app, file it as an issue + assess severity.

## What to do when paged (SEV1)

The runbook (Phase 0 Wave 3 P0.H ships the full set) is short for now:

1. **Acknowledge** within the target window — even just "investigating" in
   Slack or as a GitHub issue comment.
2. **Capture state** — copy relevant `/api/health` JSON, recent
   `vercel logs` output, the Sentry event ID if any.
3. **Open a SEV1 GitHub issue** with the captured state + your initial
   hypothesis. Label `sev1`. (Issue templates ship in P0.H.)
4. **Mitigate** — prioritise getting traffic back to working, even if
   ugly. Roll back the latest deploy if there's a clear correlation.
   Use the [Vercel dashboard](https://vercel.com/dashboard) to promote
   the previous deployment as the production alias.
5. **Communicate** — once mitigated, post status to the `/status/` page
   + (Phase 2 P2.12) the trust centre.
6. **Post-mortem** within 7 business days. See
   [incident-response.md](incident-response.md).

## What to do when paged (SEV2/SEV3)

Open a GitHub issue with the `sev2` or `sev3` label. Triage during normal
work cycle. Mitigation timeframe per the table above. Post-mortem
optional for SEV3, required for SEV2.

## Tools on-call uses today

- [`vercel logs`](https://vercel.com/docs/cli/logs) — function logs for
  the dispatcher + cron
- [Vercel deployments dashboard](https://vercel.com/dashboard) —
  promote / rollback
- [Neon Postgres dashboard](https://console.neon.tech/) — query logs,
  slow-query analysis (Phase 1 P1.4 cutover makes this primary)
- [Upstash KV dashboard](https://console.upstash.com/) — key stats,
  command rate, evictions
- [Sentry](https://sentry.io/) — error capture (coverage growing in
  P0.7)
- `/api/health` JSON — first thing to check
- `/status/` page — public health summary

## What changes when P3.1 lands

- **PagerDuty or Opsgenie** with a real rotation (requires hire #2 at
  minimum)
- **Defined SLOs + error budgets** per critical user journey (Phase 1
  P1.A) feed the page-decision matrix
- **Sev1 = wakes someone up** — until a second engineer joins, no one
  can be woken up sustainably; we acknowledge the gap
- **Post-mortem public by default** within 7 business days (Phase 3
  P3.4 codifies the template)
- **Quarterly game days** (Phase 3 P3.12) — deliberate failure injection

## Things on-call must NOT do

- **Don't run destructive operations** under time pressure without a
  written runbook step. `git reset --hard`, `DROP TABLE`, `vercel rm`,
  etc. — these are how an incident becomes a post-mortem about the
  incident response.
- **Don't skip the audit trail** to "ship the fix faster". Every
  mitigation is itself a code change that goes through the normal PR
  flow (preview + CI + review). The exception is the Vercel promote /
  rollback, which is the documented escape hatch.
- **Don't commit secrets** while debugging. `vercel logs` redacts most
  things; double-check before pasting log excerpts into a public PR.
