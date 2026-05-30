# Runbooks

Operational procedures for OrcaTrade. Each runbook covers one well-
defined situation: how to apply a setting, how to respond to an alert,
how to recover from a failure mode.

Seeded by Phase 0 task **P0.C** (branch-protection runbook); expanded
to the full first-wave set under Phase 0 task **P0.H** (auth failure,
billing failure, AI agent failure, KV outage, PG outage). Future
runbooks added as live incidents reveal gaps + as new subsystems ship.

## Format

Each runbook follows the same shape (defined in [_template.md](_template.md)):

1. **When to use this runbook** — the specific trigger
2. **Prerequisites** — access, credentials, tools needed
3. **Procedure** — numbered steps that work even at 3 AM under pressure
4. **Verification** — how you know it worked
5. **Rollback** — how to undo if it didn't
6. **Related** — links to ADRs, other runbooks, past post-mortems

Runbooks live here in markdown so they version with the code they cover
and are reviewable through the standard PR flow.

## Index

| Runbook | When to use |
|---|---|
| [_template.md](_template.md) | Copy this when adding a new runbook |
| [auth-subsystem-failure.md](auth-subsystem-failure.md) | Magic-link login broken; customers can't sign in; sessions vanishing |
| [billing-pipeline-failure.md](billing-pipeline-failure.md) | Stripe checkout/portal failing; webhook receiver 5xx; (Phase 2+) metering events lost |
| [ai-agent-failure.md](ai-agent-failure.md) | Agent endpoints 5xx/hanging; empty content; cost spike; eval regression |
| [kv-outage.md](kv-outage.md) | Upstash Redis down or degraded; sessions vanishing; rate-limit counters resetting; mutations refusing (post-P0.4) |
| [pg-outage.md](pg-outage.md) | Neon Postgres down or slow; dual-write arm failing; (post-P1.4) customer reads broken; lock contention; migration partial-apply |
| [repo-settings-branch-protection.md](repo-settings-branch-protection.md) | Apply (or re-apply) the branch-protection policy on `main` per ADR 0012 |

## Adding a new runbook

1. Copy [_template.md](_template.md) to `docs/runbooks/<slug>.md`
2. Fill in the (REQUIRED) sections
3. Add a row to the index above (alphabetical, or by topic group)
4. If the runbook covers a procedure with security implications, cite
   the relevant ADR or [docs/handbook/security.md](../handbook/security.md)
5. Open a PR through the standard flow

## What's still missing

The first wave covers the load-bearing subsystems. Gaps to fill as live
incidents or new features reveal them:

- Vercel deployment failures (build broken, function timeout)
- Cron job failures ([.github/workflows/cron.yml](../../.github/workflows/cron.yml)
  + the in-app cron handlers)
- TARIC API upstream failure (separate from KV — the cache is in KV
  but the source is the UK Trade Tariff API)
- Sanctions list refresh failure
- Secret rotation procedures per provider (one runbook per upstream:
  Anthropic, Resend, Stripe, Neon, Upstash, Voyage, Sentry)
- Customer-data export (GDPR Article 20) / erasure (GDPR Article 17)
  procedures
- Incident comms templates (already partially covered in
  [docs/handbook/incident-response.md](../handbook/incident-response.md))
