# Data retention policy

This document is OrcaTrade's published retention policy: for each
category of data we hold, the retention period, the deletion
mechanism, and how a regulator / customer / auditor can verify the
policy is being honoured.

Last updated: 2026-06-02. Owner: Founder (DPO).

> **Cross-references:**
> - [`data-flow.md`](data-flow.md) §"Data flow & retention" — the
>   narrative view: where each datum lives + why.
> - [`lib/retention.js`](../../lib/retention.js) — the enforcement
>   code: pure functions + the runtime purge / verify entry points.
> - Apex plan **P1.I** — "Automated purge per policy per table;
>   nightly verification job."

---

## 1. Retention periods at a glance

| Datum | Retention | Cap | Deletion |
|---|---|---|---|
| Magic-link token | 15 minutes | — | KV TTL on consumption or expiry |
| Session cookie | 30 days | — | HMAC `exp` enforced server-side; revoke list invalidates |
| Auth event row (`auth_signin`, etc.) | 1 year | 5,000 events total | KV cap rolls oldest off; PG retention purge nightly |
| Saved plan | 1 year | 50 newest per user | Per-user cap + age cutoff; nightly purge |
| Saved portfolio | 1 year | 50 newest per user | Per-user cap + age cutoff; nightly purge |
| Actual (reality-check report) | 1 year | — | Age cutoff; nightly purge |
| AI call audit row | 1 year | (events cap) | Same as event log |
| Monitoring alert | 6 months | — | Age cutoff; nightly purge |
| Rate-limit counter | per-counter TTL (≤ 24h) | — | Upstash TTL |
| Health probe | 60 seconds | — | Upstash TTL |
| TARIC warm cache | per-key TTL (≤ 7 days) | — | Upstash TTL |
| Stripe customer | per Stripe's policy | — | Contact Stripe directly (Article 17 limitation documented) |
| Resend delivery log | 30 days at Resend | — | Resend's retention policy applies |
| Anthropic API logs | ≤ 30 days at Anthropic | — | Anthropic's retention policy applies |
| Vercel logs | typically 30 days at Vercel | — | Vercel's retention policy applies |

## 2. Article 17 (Right to erasure) handling

When a user deletes their account via `/account/privacy/` → `POST
/api/account/delete`:

1. All `saved_plans`, `saved_portfolios`, `actuals` keyed by the
   user's `email_hash` are deleted from PG.
2. Event rows that carried the user's identity are
   **pseudonymised** in place — `email_hash` is replaced with a
   `deleted-…@anonymised.local` marker that satisfies referential
   integrity without re-identifying the deleted user.
3. KV-side sessions, MFA records, password records, signup tokens,
   and rate-limit counters for the user's email are deleted.
4. Stripe customer is NOT auto-deleted — the user is directed to
   Stripe's own deletion flow (Stripe's record exists for tax
   compliance + the user retains payment-method recovery rights).

The deletion writes an `account_deleted` audit event before
returning success (per the audit-log-before-success rule).

## 3. Enforcement (apex P1.I)

### 3.1 KV side — handled by Upstash TTLs

Every counter and ephemeral key passes `ttlSeconds` to `kv.set` /
`kv.incr` (enforced by [`test/kv-ttl-hygiene.test.js`](../../test/kv-ttl-hygiene.test.js),
PR #67). Upstash expires keys at the TTL; no purge job needed.

### 3.2 PG side — programmatic purge

[`lib/retention.js`](../../lib/retention.js) defines `RETENTION_POLICIES`
per table. The `runPurge()` entry point walks each policy and applies
either:

- A simple age cutoff (`DELETE FROM events WHERE created_at < $cutoff`)
- An age cutoff + keep-newest-N-per-user (`saved_plans` / `saved_portfolios`)

Idempotent — running the purge twice in a row deletes nothing the
second time.

### 3.3 Verification — nightly

[`lib/retention.js::runVerify()`](../../lib/retention.js) asserts NO
row exists past the policy + a 1-day grace. The grace allows the
daily purge to run before the verifier flags drift.

Verifier output:

```json
{
  "ok": true,
  "now": "2026-06-02T04:00:00.000Z",
  "results": [
    { "policy": "events", "table": "events", "cutoff": "…", "overdue": 0, "ok": true },
    …
  ]
}
```

When `ok: false`, the cron emits a `monitoring_alerts` row that
surfaces on `/dashboard/audit/` and (when configured) Sentry.

### 3.4 Cron schedule (queued)

The purge + verify entry points are scheduled via
[`.github/workflows/cron.yml`](../../.github/workflows/cron.yml) at:

- `03:00 UTC` — `runPurge`
- `04:00 UTC` — `runVerify`

(Wire-up of these jobs is a one-line addition to `cron.yml`; queued
behind the foundation chain's `cron.yml` PR to avoid conflicts.)

## 4. Customer-facing claims

A customer asking "how long do you keep my data?" gets the answer
from §1 above. The DPA template (queued Phase 2) references this
document as the authoritative source.

A customer asking "show me a row that proves you delete on time"
gets the most recent `runVerify` output from `/dashboard/audit/`.

## 5. Exceptions + holds

- **Legal hold:** if a regulator or court requires retention beyond
  policy, the founder records the hold in `docs/incidents/hold-YYYY-MM-DD.md`
  with the affected rows + the hold's expiry. The verifier learns
  about held rows via an explicit exclusion list (config, not code).
  No active holds as of the *Last updated* date.
- **Tax compliance:** invoice + customer-billing records held by
  Stripe (per § 1) are retained per Stripe's policy (typically 7
  years). OrcaTrade's local copy is the link between Stripe customer
  id ↔ user `email_hash`, which is held the same time as the user's
  account.

## 6. Limitations of this document

- **Sub-processor retention is theirs.** Stripe / Resend / Anthropic /
  Vercel each hold data under their own policy; we document those
  policies in [`vendor-tprm.md`](vendor-tprm.md) but don't enforce
  them.
- **The nightly verifier is best-effort.** A PG outage during the
  verifier window means the next-day verifier inherits the lag.
- **No real-time deletion guarantee.** Article 17 deletes are
  synchronous; everything else is "at the next nightly run, within
  a 1-day grace".

## 7. Revision history

| Version | Date | Change |
|---|---|---|
| v1 | 2026-06-02 | Initial published policy + enforcement module (apex P1.I) |
