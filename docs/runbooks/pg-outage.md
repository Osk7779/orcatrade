# Postgres (Neon) outage

## When to use this runbook

- `/api/health` shows `pgProbe.ok: false`
- Slow query alarms or query timeouts in `vercel logs`
- Sentry errors from `lib/db/client.js`
- (Pre-P1.4) PG dual-write arm failing — KV serves users fine, but
  analytics + opt-in PG-primary reads (sanctions screening) break
- (Post-P1.4) Customer-facing reads of saved plans / portfolios /
  events fail — **SEV1**
- A long-running query is locking other queries (lock contention)

## Prerequisites

- Admin access to: Neon dashboard, Vercel project, Sentry
- Knowledge of: [lib/db/client.js](../../lib/db/client.js) +
  [lib/db/schema.sql](../../lib/db/schema.sql) +
  [scripts/db-migrate.js](../../scripts/db-migrate.js)
- For lock-contention diagnosis: read access to `pg_stat_activity`
  (via Neon SQL editor or `psql`)

## Impact assessment

PG is dual-write today (per CLAUDE.md "Data layer" + `docs/billion-
dollar-plan.md`). A PG outage affects:

| Surface | Pre-P1.4 impact | Post-P1.4 impact |
|---|---|---|
| Dual-write target | Writes lose the PG mirror; KV continues | Write fails entirely (PG is primary) |
| Sanctions screening | Falls back to bundled sample (degraded but functional) | Same |
| Audit-log analytical queries | Broken (no historical drill-down) | Same |
| Customer-facing saved-plan reads | Unaffected (KV-primary) | **SEV1** — broken |
| Schema migrations | Cannot run until PG recovers | Same |

Pre-P1.4 (today) the blast radius is **operational** — analytics
break, but customer-facing flows mostly continue. Post-P1.4 the blast
radius is **customer-facing** — this runbook's severity escalates.

## Procedure

1. **Check `/api/health`:**

   ```bash
   curl -s https://orcatrade.pl/api/health | jq '{ pgProbe, pgLatencyMs }'
   ```

   - `ok: false` → connectivity issue. Step 3.
   - `ok: true` but `pgLatencyMs > 1500` → degraded. Step 4.

2. **Confirm regional or platform-wide.** Check
   [Neon status](https://neon.tech/status) and the Neon dashboard for
   the OrcaTrade project. If platform-wide → post to `/status/`,
   monitor, no code fix.

3. **PG unreachable.** Possible causes + checks:

   - **`DATABASE_URL` / `DATABASE_URL_UNPOOLED` rotation drift.** Check
     Vercel env vars match the Neon project's connection string. Neon
     occasionally rotates the project endpoint hostname; if so, update
     the env vars + redeploy.
   - **Neon compute auto-suspended** (Neon's compute scales to zero
     after idle period). First query in 5-10 min wakes it; subsequent
     queries are fast. This shows as a single slow query, not sustained
     unavailability. Not actually an outage; document expectation in
     team comms.
   - **Neon project at storage / compute quota.** Check the dashboard's
     billing + quota tab. Upgrade plan if needed.
   - **Vercel→Neon network blocked.** Rare. Check Vercel status.

4. **PG degraded but reachable** (high latency + intermittent
   timeouts):

   - **Lock contention.** Run from Neon SQL editor:

     ```sql
     SELECT pid, now() - query_start AS duration, state, query
     FROM pg_stat_activity
     WHERE state != 'idle' AND now() - query_start > interval '30 seconds'
     ORDER BY duration DESC;
     ```

     A long-running query holding locks blocks shorter ones. If
     identifiable as a one-off script, `SELECT pg_cancel_backend(<pid>)`
     to cancel; `pg_terminate_backend(<pid>)` if it doesn't yield.
     **Do not terminate a query you don't understand.**
   - **Cold cache after compute scale-up.** Expected, recovers within
     minutes.
   - **N+1 query pattern.** Newer code paths may be doing per-row
     queries instead of batched. Check Sentry + Vercel logs for the
     hot endpoint; this is a fix-in-a-PR situation, not a runbook
     mitigation.

5. **Migration failure.** If a `npm run db:migrate` run errors midway:

   - **Check `schema_versions` table** for what landed:
     ```sql
     SELECT * FROM schema_versions ORDER BY applied_at DESC LIMIT 10;
     ```
   - **Drift detection.** `scripts/db-migrate.js` content-hashes every
     migration; a hash mismatch means a previously-applied migration
     file has been edited. Investigate which file, restore from git
     history, never edit historical migrations (per
     [docs/handbook/coding-standards.md](../handbook/coding-standards.md) §Workflow).
   - **Half-applied migration.** Migrations are NOT wrapped in
     transactions today (a Phase 1 hardening — see ADR 0011's "more
     information" backlog). If a multi-statement migration partially
     succeeded, manually inspect the schema + reconcile by running
     the missing statements in the Neon SQL editor.

## Verification

After mitigation:

1. `/api/health` returns `pgProbe.ok: true` and `pgLatencyMs < 500`
2. Run a test query via Neon SQL editor: `SELECT count(*) FROM events;` —
   returns within 200ms cold-path
3. Open the platform → saved plans / portfolios load (or, pre-P1.4,
   the KV-primary path serves them indistinguishably)
4. (After a migration recovery) Run the test suite — schema-parity
   tests pass (per ADR 0011's "writer-vs-schema parity test")

## Rollback

- Env-var rotation: standard `vercel env rm` + `add` + `deploy`
- Cancelled query: query is gone; no rollback needed
- Migration partial-apply: there is no automatic rollback. The recovery
  is documented in step 5 — manual reconciliation via Neon SQL editor.
  A Phase 1 hardening will wrap migrations in transactions to make
  rollback automatic (added as a follow-up task; not on the current
  execution-plan tables)

## Related

- [ADR 0005 — Audit-log before success](../adr/0005-audit-log-before-success.md) —
  PG mirror is best-effort today; the load-bearing write is KV
- [Phase 1 P1.4 — Postgres-primary cutover](../execution-plan.md) —
  the cutover that escalates this runbook's severity
- [Phase 1 P1.D — integration test infrastructure](../execution-plan.md) —
  Neon-branch-per-CI-run will catch many of these issues before
  production
- [kv-outage.md](kv-outage.md) — KV's independence from PG is part of
  the resilience story (today)

## More information

- [Neon status page](https://neon.tech/status)
- [Neon documentation: connection pooling + serverless driver](https://neon.tech/docs/serverless/serverless-driver)
- [Postgres `pg_stat_activity` documentation](https://www.postgresql.org/docs/current/monitoring-stats.html#MONITORING-PG-STAT-ACTIVITY-VIEW)
- [scripts/db-migrate.js](../../scripts/db-migrate.js) — migration
  runner with content-hash drift detection
