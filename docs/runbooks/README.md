# Runbooks

Operational procedures for OrcaTrade. Each runbook covers one well-
defined situation: how to apply a setting, how to respond to an alert,
how to recover from a failure mode.

Seeded by Phase 0 task **P0.C** (branch-protection runbook); expanded
to the full first-wave set under Phase 0 task **P0.H** (auth failure,
billing failure, AI agent failure, KV outage, PG outage).

## Format

Each runbook follows the same shape:

1. **When to use this runbook** — the specific trigger
2. **Prerequisites** — access, credentials, tools needed
3. **Procedure** — numbered steps that work even at 3 AM under pressure
4. **Verification** — how you know it worked
5. **Rollback** — how to undo if it didn't
6. **Related** — links to ADRs, other runbooks, post-mortems

Runbooks live here in markdown so they version with the code they cover
and are reviewable through the standard PR flow.

## Index

| Runbook | When to use |
|---|---|
| [repo-settings-branch-protection.md](repo-settings-branch-protection.md) | Apply (or re-apply) the branch-protection policy on `main` per ADR 0012 |

## Adding a new runbook

1. Create `docs/runbooks/<slug>.md` from the template above
2. Add a row to the index in this README
3. If the runbook covers a procedure with security implications, cite
   the relevant ADR or [docs/handbook/security.md](../handbook/security.md)
4. Open a PR through the standard flow

When P0.H ships, this directory will grow to include the first wave of
operational runbooks (auth, billing, AI agent, KV, PG).
