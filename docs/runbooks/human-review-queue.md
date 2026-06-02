# Human-review queue (drain + acknowledge + resolve)

## When to use this runbook

- The `ORCATRADE_OPS_EMAIL` inbox receives a `[OrcaTrade human-review]`
  alert from one of the agents (compliance, sourcing, logistics, finance,
  orchestrator) — every alert means an agent has invoked
  `requestHumanReview` before an irreversible action and is **blocking on
  a human decision**
- You are starting an on-call shift and need to confirm the queue is empty
- An on-call hand-off includes "open tickets in the human-review queue"
- A customer reports that the agent told them "I've routed this to a
  human" and asks for status

The queue is the **only** way the platform tells the founders / ops team
that an agent has hit a guardrail. It is NOT a marketing inbox; every
ticket is a high-trust escalation. Drain expectation: **acknowledge
within 4 business hours, resolve within 24 business hours.**

## Prerequisites

- An admin email on `ORCATRADE_ADMIN_EMAILS` (session cookie path) **or**
  a copy of `ORCATRADE_LEADS_TOKEN` (header / query-param path) — both
  pass `lib/admin-auth.verifyAdmin`
- `curl` + `jq` locally; `gh` if you need to file a follow-up issue
- For deep KV inspection only: Vercel access to the Upstash Redis
  integration

## Procedure

### 1. List open tickets

```bash
# Session-cookie path (logged-in admin browser):
curl -s -b "$ORCATRADE_SESSION_COOKIE" \
  https://orcatrade.pl/api/human-review?status=new | jq .

# Or with the admin token header:
curl -s -H "x-admin-token: $ORCATRADE_LEADS_TOKEN" \
  https://orcatrade.pl/api/human-review?status=new | jq .
```

Expected shape:

```json
{
  "ok": true,
  "count": 2,
  "tickets": [
    {
      "id": "tkt_lkt23x_3a9f0e21",
      "agent": "finance",
      "reason": "LC issuance above €100k for STEEL-001 (50t, CN→DE)",
      "severity": "high",
      "context": { "handoffTo": "banking_partner", "sku": "STEEL-001" },
      "requestedAt": "2026-05-30T08:14:22.117Z",
      "status": "new"
    }
  ]
}
```

Tickets come back **newest first**. If `count` is 0 the queue is clean —
stop here.

### 2. Read the ticket end-to-end

Pull a single ticket plus the audit-stream record that mirrors it:

```bash
TICKET_ID="tkt_lkt23x_3a9f0e21"

# Full context from the queue:
curl -s -H "x-admin-token: $ORCATRADE_LEADS_TOKEN" \
  "https://orcatrade.pl/api/human-review?status=new" \
  | jq ".tickets[] | select(.id == \"$TICKET_ID\")"

# Cross-reference the audit stream (events.record writes
# `human_review_requested` per ADR 0005):
curl -s -H "x-admin-token: $ORCATRADE_LEADS_TOKEN" \
  "https://orcatrade.pl/api/audit?type=human_review_requested&limit=20" \
  | jq ".events[] | select(.payload.ticketId == \"$TICKET_ID\")"
```

The agent has been told (by its system prompt, see
[lib/handlers/finance-agent.js](../../lib/handlers/finance-agent.js) etc.)
to put **all** load-bearing context in `reason` + `context`. Read both.
If the reason is `"no reason provided"` the agent invoked the tool
without arguments — open a Sentry / log query for that turn and treat as
an agent-prompt bug (Phase 1 follow-up).

### 3. Claim the ticket (acknowledge)

A claim marks the ticket `status: 'acknowledged'` and records who is
working it. **Do this before you start investigating** so a second
on-call doesn't double-handle:

```bash
curl -s -X POST \
  -H "x-admin-token: $ORCATRADE_LEADS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"$TICKET_ID\",\"action\":\"claim\",\"claimedBy\":\"$USER@orcatradegroup.com\"}" \
  https://orcatrade.pl/api/human-review | jq .
```

Expected: `{ "ok": true, "ticket": { …, "status": "acknowledged",
"claimedBy": "…", "claimedAt": "…" } }`.

### 4. Take the business action outside the platform

The platform **does not** execute the action the agent escalated. It
collected enough context for a human to. Typical actions:

| Agent     | Common escalations                | Where the action happens     |
|-----------|-----------------------------------|------------------------------|
| finance   | LC > €100k, FX hedge sign-off     | Banking partner / CFO        |
| compliance | Anti-dumping / CBAM grey-area    | External counsel / customs   |
| sourcing  | First PO > €20k from new supplier | Supplier-management workflow |
| logistics | Cargo > €50k forwarder booking    | 3PL / forwarder              |
| orchestrator | Cross-domain hand-off          | Whichever specialist is named in `context.handoffTo` |

If the ticket has `context.handoffTo`, that string is the agent's
recommendation for who the work should land on. Treat it as a hint, not
a binding routing decision.

### 5. Resolve the ticket

When the action is taken (or explicitly declined), close the ticket with
a one-line resolution that future-you can search for:

```bash
curl -s -X POST \
  -H "x-admin-token: $ORCATRADE_LEADS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
        \"id\":\"$TICKET_ID\",
        \"action\":\"resolve\",
        \"resolvedBy\":\"$USER@orcatradegroup.com\",
        \"resolution\":\"Approved by treasury; bank confirmed wire 2026-05-30.\"
      }" \
  https://orcatrade.pl/api/human-review | jq .
```

Resolution string is capped at 2,000 characters. Keep it factual — the
text lives in the audit log indefinitely.

## Verification

A drained queue passes all of:

1. `GET /api/human-review?status=new` returns `count: 0`
2. `GET /api/human-review?status=acknowledged` returns only tickets that
   are genuinely mid-work (no abandoned claims older than 24 h)
3. Sampling 5 `resolved` tickets shows each has a non-empty `resolution`
   field — empty resolutions defeat the audit purpose

## Rollback

The procedure is mutating but **not destructive** — there is no
"unresolve" or "unclaim" action by design (the audit log records every
state transition). If you claim or resolve the wrong ticket:

1. Append a corrective audit event manually via the audit stream
   (`POST /api/audit` is admin-only)
2. Note the correction in the ops `#oncall` channel so the next shift
   sees it

The KV queue caps at 500 entries; older entries are pruned on write but
remain in the `events` audit stream for 365 days. Pruned tickets cannot
be re-acknowledged — if a ticket has been pruned, treat the audit-stream
record as the source of truth.

## Failure modes you might see

| Symptom | Likely cause | Action |
|---|---|---|
| Email alerts firing but `GET /api/human-review` returns 0 | KV write failed but events.record succeeded | Read `?type=human_review_requested` on `/api/audit` directly |
| `GET` returns `{error: 'list failed'}` | Upstash KV degraded | Open [kv-outage.md](kv-outage.md) |
| `POST claim` returns `{error: 'not found'}` | Ticket pruned (>500 newer entries) or wrong id | Use audit stream as canonical record |
| Email alerts NOT firing despite `count > 0` | `ORCATRADE_OPS_EMAIL` unset or Resend down | Check `/api/health` + Resend dashboard |

## Related

- [ADR 0015 — Human-review queue](../adr/0015-human-review-queue.md) —
  why this queue exists, what it is and isn't, and what gets it promoted
  from KV to Postgres in Phase 1
- [ADR 0005 — Audit-log writes precede success responses](../adr/0005-audit-log-before-success.md)
  — every ticket also lands as `events.record('human_review_requested')`
- [ADR 0006 — Circuit breaker on external calls](../adr/0006-circuit-breaker-on-external-calls.md)
  — the email-notification path uses the breaker
- [kv-outage.md](kv-outage.md) — what to do if the queue read fails
- [ai-agent-failure.md](ai-agent-failure.md) — for the reverse symptom
  (agents misbehaving rather than the queue mis-behaving)
- [docs/handbook/on-call.md](../handbook/on-call.md) — drain SLAs for the
  4 h / 24 h acknowledge / resolve targets

## More information

- [lib/human-review.js](../../lib/human-review.js) — queue implementation
- [lib/handlers/human-review.js](../../lib/handlers/human-review.js) —
  admin-gated `/api/human-review` handler
- [test/human-review.test.js](../../test/human-review.test.js) — contract
  tests + source-pin tests that prove all 4 specialist agents (and the
  orchestrator-by-inheritance) route through this queue
