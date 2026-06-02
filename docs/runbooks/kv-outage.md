# KV (Upstash Redis) outage

## When to use this runbook

- `/api/health` shows `kvProbe.ok: false`
- Sessions vanishing for live users (logged-in users get redirected
  to login mid-session)
- Magic-link emails sent but tokens missing on click
- Rate-limit counters resetting unexpectedly (a customer reports they're
  hitting the same rate-limit message repeatedly)
- TARIC duty lookups taking >5s consistently (KV cache miss + slow
  upstream)
- (Post-P0.4) Mutations returning 5xx because audit-log writes are
  failing — per [ADR 0005](../adr/0005-audit-log-before-success.md),
  a KV outage cascades into mutation refusal

## Prerequisites

- Admin access to: Upstash console for the OrcaTrade project, Vercel
  project, Sentry
- Knowledge of: [lib/intelligence/kv-store.js](../../lib/intelligence/kv-store.js)
  + [lib/intelligence/runtime-store.js](../../lib/intelligence/runtime-store.js)

## Impact assessment

KV is **primary** for ephemeral / high-frequency state today. A KV
outage affects:

| Surface | Impact | Severity |
|---|---|---|
| Sessions + magic tokens | Users can't log in or stay logged in | **SEV1** |
| Rate-limit counters | All requests pass without limit (security hole during outage) | **SEV2** |
| TARIC duty cache | Cold-path TARIC API calls — slow but functional | SEV3 |
| Audit-log mirror (per ADR 0005) | Mutations refuse (5xx) once P0.4 lands | **SEV1** after P0.4 |
| Saved plans / portfolios (primary today) | Reads/writes fail; Postgres mirror exists but is read-only via opt-in | **SEV1** |

After [Phase 1 P1.4](../execution-plan.md) cuts saved-plans / portfolios
to Postgres-primary, the third row downgrades to "KV becomes a write-
through cache" and KV outage severity reduces materially.

## Procedure

1. **Confirm the outage is real, not local.** Check
   [Upstash status](https://status.upstash.com/) and the project's
   regional health in the Upstash console.

2. **Check `/api/health`** for the specific symptom:

   ```bash
   curl -s https://orcatrade.pl/api/health | jq '{ kvProbe, kvLatencyMs }'
   ```

   - `ok: false` → connectivity issue. Skip to step 4.
   - `ok: true` but `kvLatencyMs > 1000` → KV degraded, not down. Skip
     to step 5.

3. **If Upstash dashboard shows degraded** → post to `/status/` page
   immediately (SEV1 customer-visible). Communication template in
   [docs/handbook/incident-response.md](../handbook/incident-response.md).

4. **KV unreachable.** Possible causes + checks:

   - **`KV_REST_API_URL` / `KV_REST_API_TOKEN` rotation drift.** Check
     Vercel env vars match the active Upstash credential. Rotate if
     mismatched (same procedure as auth-secret rotation in
     [auth-subsystem-failure.md](auth-subsystem-failure.md) step 5).
   - **Upstash region outage.** Single-region KV cannot recover until
     Upstash recovers. Multi-region is on the Phase 4 roadmap (P4.6).
     During the outage, the platform's read-side fallback to bundled
     defaults (e.g. sanctions list bundled sample) keeps core flows
     working in degraded mode for some endpoints; mutations should
     refuse rather than silently dropping (per ADR 0005).
   - **Network egress from Vercel blocked.** Rare. Check the Vercel
     status page.

5. **KV degraded but reachable.** The circuit-breaker pattern from
   [ADR 0006](../adr/0006-circuit-breaker-on-external-calls.md) should
   apply, but KV calls today are not yet circuit-wrapped (Phase 0 P0.3
   migrates Anthropic first; KV is a future tranche). Until then, slow
   KV manifests as slow user-facing responses + Vercel function
   timeouts. Mitigation: reduce KV-dependent traffic by pausing
   non-essential crons (set `CRON_PAUSED=true` in env vars and
   redeploy).

## Verification

After mitigation:

1. `/api/health` returns `kvProbe.ok: true` and `kvLatencyMs < 200`
2. Test a known-good user flow: login → save a plan → reload → plan
   visible
3. Rate-limit counter behaves as expected (multiple rapid requests
   trigger 429)
4. (Post-P0.4) Mutations succeed and audit-log queries find the entries

## Rollback

- Env-var rotation: standard `vercel env rm` + `add` + `deploy`
- Cron pause: `vercel env rm CRON_PAUSED production` + `vercel deploy --prod`
- Code change: standard PR revert

## Related

- [ADR 0005 — Audit-log before success](../adr/0005-audit-log-before-success.md) —
  the rule that makes KV outage a hard product impact for mutations
- [ADR 0006 — Circuit breaker on external calls](../adr/0006-circuit-breaker-on-external-calls.md) —
  KV calls are a future tranche of this migration
- [Phase 1 P1.4 — Postgres-primary cutover](../execution-plan.md) —
  the structural fix that reduces this runbook's blast radius
- [Phase 4 P4.6 — multi-region data residency](../execution-plan.md) —
  the longer-term mitigation for regional KV outages
- [auth-subsystem-failure.md](auth-subsystem-failure.md) — auth cascades
  off KV
- [pg-outage.md](pg-outage.md) — Postgres is the dual-write target;
  its independence from KV is part of the mitigation story

## More information

- [Upstash status page](https://status.upstash.com/)
- [Upstash Redis REST API documentation](https://upstash.com/docs/redis/features/restapi)
- [docs/billion-dollar-plan.md](../billion-dollar-plan.md) describes the
  KV-primary / PG-mirror architecture
