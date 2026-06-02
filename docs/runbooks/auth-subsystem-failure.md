# Auth subsystem failure (magic-link login)

## When to use this runbook

- Customers report they cannot log in
- `/api/auth/*` returning 5xx for >2 min
- Magic-link emails not arriving (or arriving past their TTL)
- Sessions disappearing unexpectedly mid-flow

## Prerequisites

- Admin access to: Vercel project, Upstash KV dashboard, Resend dashboard, Sentry
- `vercel` CLI authenticated as project member
- Knowledge of `lib/handlers/auth.js` + `lib/auth.js` + `lib/intelligence/kv-store.js`

## Procedure

1. **Check `/api/health`** first — it probes KV + Resend + auth state:

   ```bash
   curl -s https://orcatrade.pl/api/health | jq .
   ```

   Look at `kvProbe.ok`, `resendCircuit.state`, `authSubsystem.ok`. A single
   `false` narrows the search instantly.

2. **Categorise by failure mode:**

   | Symptom in `/api/health` | Likely cause | Jump to step |
   |---|---|---|
   | `kvProbe.ok: false` | Upstash KV outage | [kv-outage.md](kv-outage.md) |
   | `resendCircuit.state: open` | Resend down or rate-limited | step 3 |
   | All probes OK but customers still failing | Token TTL / cookie / session | step 5 |

3. **Resend down or rate-limited.** Check
   [Resend status](https://status.resend.com/) + the project dashboard's
   send queue. If rate-limited (>3 emails/sec sustained), reduce the
   magic-link emit rate or pause non-essential email (digests) via the
   `DIGEST_PAUSED=true` env var.

4. **Resend recovering.** The `lib/circuit.js` half-open probe will
   close the circuit automatically once a probe succeeds. Watch for
   `circuit.state: closed` in `/api/health`. If the circuit stays open
   >15 min after Resend recovers, force-close via deploying any commit
   to `main` (cold-start re-reads circuit state).

5. **Token TTL / cookie / session.** Magic tokens are stored in KV with
   a 10-min TTL ([lib/handlers/auth.js](../../lib/handlers/auth.js)).
   Common cookie issues:

   - **`ORCATRADE_AUTH_SECRET` rotation drift** — sessions signed under
     the old secret stop validating. Check the deployed env vs the
     current production secret in Vercel. If they differ, all sessions
     were invalidated by the rotation — communicate via `/status/`, no
     code fix, customers re-authenticate.
   - **Cookie domain mismatch** — if the production cookie is set on
     `.orcatrade.pl` but the magic link points to `orcatradegroup.com`,
     the redirect strips the cookie. Check
     [lib/auth.js](../../lib/auth.js) `cookie.domain` and the magic-
     link `Host` derivation.
   - **TTL expired** — user clicked the link >10 min after request.
     Re-issue from the login page.

## Verification

After mitigation:

1. `/api/health` returns all probes `true`
2. Manually request a magic link with a known-good test account; receive
   email within 30s; click; land on the post-login page without error
3. Session persists across a hard refresh

## Rollback

If your mitigation was a config or env-var change:

```bash
vercel env rm <VARIABLE> production    # remove
vercel env add <VARIABLE> production   # re-add with previous value
vercel deploy --prod                   # re-deploy to pick up the change
```

If your mitigation was a code change shipped via PR, the standard
revert applies — open a revert PR through the normal flow, or use
"Revert" in the Vercel deployments dashboard to roll back the
production deployment.

## Related

- [ADR 0005 — Audit-log before success](../adr/0005-audit-log-before-success.md) —
  successful auth events are audited via `events.record('login_success', ...)`
- [ADR 0006 — Circuit breaker on external calls](../adr/0006-circuit-breaker-on-external-calls.md) —
  the Resend circuit referenced above
- [ADR 0008 — Email pseudonymisation](../adr/0008-email-pseudonymisation.md) —
  the join key for auth-related event queries
- [kv-outage.md](kv-outage.md) — KV is the magic-token store; a KV
  outage cascades into auth failure
- [docs/handbook/security.md](../handbook/security.md) — secrets rotation
  procedure for `ORCATRADE_AUTH_SECRET`

## More information

- [Resend status page](https://status.resend.com/)
- [Upstash status page](https://status.upstash.com/)
- The auth design (magic link + KV-backed session + cookie) is described in
  [docs/billion-dollar-plan.md](../billion-dollar-plan.md) and in
  [lib/handlers/auth.js](../../lib/handlers/auth.js) header comments
