# Human-review escalation is a real KV-backed queue, not a stubbed tool

- **Status:** Accepted
- **Date:** 2026-05-31
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Future agent authors; on-call ops; security / compliance
  reviewers

## Context and problem statement

Every OrcaTrade agent (compliance, sourcing, logistics, finance, and the
orchestrator that inherits from all four) declares a `requestHumanReview`
tool. The agent system prompts in
[lib/handlers/finance-agent.js](../../lib/handlers/finance-agent.js) and
siblings make it **mandatory** to invoke this tool before:

- recommending a commercial action above thresholds (LC > €100k; cargo
  > €50k; first PO > €20k from an unaudited supplier),
- interpreting a regulation in a grey area (anti-dumping risk, CBAM edge
  cases, REACH SVHC borderline),
- or whenever the user explicitly asks for a human.

Until 2026-05-31 the tool implementation was a Potemkin escalation: the
handler minted a fake string `tkt_${agent}_${random}`, returned it to
the agent, and **did nothing else**. No KV write, no email, no audit
trail, no UI. The agent reassured the user with prose like *"I've routed
this to our human ops team — ticket tkt\_fin\_abc123"* and the platform
silently forgot the request. From a regulatory and customer-trust
standpoint this is the worst-case failure mode: the AI promised an
action that the platform could not deliver, with no observable signal
that the promise was broken.

The Phase 0 audit (2026-05-30) flagged this as a load-bearing-rule
violation: agents commit to actions the system doesn't fulfil. P0.10
exists to make the tool real.

## Decision drivers

- The tool's contract to the agent (and through the agent, to the
  customer) must be honoured: every `requestHumanReview` call **must**
  reach a human via a durable channel
- Ops needs to enumerate, claim, and resolve tickets — and prove later
  that they did so
- The platform is pre-seed and pre-revenue; "build a Linear-grade
  ticketing UI" is out of scope. The escalation surface must work
  through `curl` today and stay viable until app-shell ships in
  Phase 1 / 2
- Whatever ships must be testable: source-pin that all 5 agents actually
  route through one implementation (the prior fake-ticket pattern
  drifted independently across files)
- Per [ADR 0003](0003-anthropic-sdk-boundary.md), the queue lives outside
  `lib/ai/`; no LLM is in this loop

## Considered options

1. **KV-backed queue + admin-gated read/mutate API + best-effort email
   alert** (chosen)
2. Postgres table with full ticketing schema (assignee, due-by, SLA
   timers, attachments)
3. Third-party ticketing system (Linear / GitHub Issues / Zendesk)
   integration via webhook
4. Email-only: agent triggers an email to ops, no platform-side record
5. Keep stubbing — log the call and "do better later"

## Decision outcome

**Chosen option: a 500-entry KV-backed queue at the key
`human-review:queue`, written by [lib/human-review.js](../../lib/human-review.js),
exposed via the admin-gated `/api/human-review` handler, with a
best-effort Resend email to `ORCATRADE_OPS_EMAIL` on every append.**

Concretely:

- `appendTicket(input)` validates + normalises the agent input
  (whitelist on `agent`, severity-vocabulary map, reason capped at 1,000
  chars, context coerced to plain object), generates an id of shape
  `tkt_<base36-time>_<8hex>`, prepends it to the queue, writes
  `events.record('human_review_requested', …)` per
  [ADR 0005](0005-audit-log-before-success.md) (non-swallowing), and
  fires `notifyOps(ticket)` best-effort.
- `listTickets({ status?, limit? })` returns newest-first with optional
  status filter; default limit 100, hard cap 500.
- `claimTicket(id, claimedBy)` / `resolveTicket(id, resolvedBy,
  resolution?)` mutate ticket status and write a matching audit event.
- `GET / POST /api/human-review` are gated by `lib/admin-auth.verifyAdmin`
  — the same gate `/api/audit` and `/api/leads` use (session cookie with
  `ORCATRADE_ADMIN_EMAILS` allow-list **or** `x-admin-token` header
  matching `ORCATRADE_LEADS_TOKEN`).
- The four specialist agent handlers (`agent.js`, `finance-agent.js`,
  `logistics-agent.js`, `sourcing-agent.js`) call
  `humanReview.appendTicket` instead of minting a fake string. The
  orchestrator inherits the tool from one of the specialists via
  `Object.assign` and is therefore covered transitively — a source-pin
  test asserts the wiring of all four files.

The **severity vocabulary** is intentionally translated:

| Agent tool schema vocab | Queue vocab |
|---|---|
| `info`, `minor`         | `low`       |
| `moderate`              | `medium`    |
| `major`                 | `high`      |
| `critical`              | `critical`  |

The agent prompts inherited a 5-level vocab; the queue uses a leaner
4-level vocab so the on-call dashboard stays simple. The map is
lossless against the agent's intent (the only collapse is
`info`+`minor` → `low`, neither of which is high-stakes).

### Consequences

- **Good:** the tool now honours its contract — every escalation lands
  in a durable place and an alert fires
- **Good:** the audit trail (`human_review_requested` /
  `human_review_claimed` / `human_review_resolved` events) makes drain
  metrics queryable; we can publish a "% of tickets acknowledged
  within 4 h" figure in due-diligence packs
- **Good:** the admin gate reuses an existing primitive — no new auth
  surface
- **Good:** when ops scales beyond two people, the queue read API is
  ready for a UI consumer (Phase 1 app-shell)
- **Bad:** KV is the durable store; an Upstash outage degrades the
  queue. Mitigated by the parallel `events.record` write (Postgres
  dual-write per existing pattern) — the audit stream is the
  source-of-truth for forensic queries
- **Bad:** the queue caps at 500 entries; older tickets are pruned on
  write. At expected volume (low single digits per day) this is a
  ~6-month buffer; if we approach the cap a Phase 1 PR promotes the
  queue to Postgres. The `events` stream's 365-day retention is the
  historical record either way
- **Neutral:** no UI in P0.10 — `curl` + runbook
  ([docs/runbooks/human-review-queue.md](../runbooks/human-review-queue.md))
  is the surface. Acceptable while the founders are the on-call team

### Confirmation

**Enforced as of PR #26 (Phase 0 P0.10).**

- [test/human-review.test.js](../../test/human-review.test.js) covers
  `appendTicket` shape + input-normalisation + truncation,
  `listTickets` newest-first + filter + cap, `claimTicket` /
  `resolveTicket` mutation + not-found handling, `generateTicketId`
  uniqueness under tight spacing (1,000 IDs, no collisions), and a
  **source-pin block** that scans the four specialist agent files for
  (a) the `require('../human-review')` import, (b) the
  `humanReview.appendTicket(` call, and (c) the *absence* of the prior
  `const ticketId = \`tkt_…\`` fake pattern.
- A separate source-pin asserts `api/[...path].js` registers the
  `'human-review'` dispatcher entry pointing at
  `lib/handlers/human-review.js`.
- The four agent-suite tests
  (`finance-agent.test.js`, `sourcing-agent.test.js`,
  `logistics-agent.test.js`, `orchestrator-agent.test.js`) now `await`
  the tool and assert the new id shape plus the severity-vocab mapping.

**Known gaps (Phase 1 / 2):**

- No retry / dead-letter on a KV write failure (logged + audit-event
  still fires). At current volume this is acceptable; revisit if drain
  metrics show drops.
- No SLA timer: the 4 h / 24 h drain targets in the runbook are humans
  watching email, not an alerting rule. Phase 3 P3.1 wires this into
  the on-call rotation.
- No customer-visible status surface: a customer cannot today check
  "where is my ticket?" through the product. Phase 1 ties tickets back
  to the originating user session so the dashboard can show
  "1 question with our team."
- Migration to Postgres (lifting the 500-entry cap) is deferred until
  app-shell ships and the queue starts driving in-app UI.

## Pros and cons of the options

### KV queue + admin API + email alert (chosen)

- **Good, because:** delivers a functioning escalation today with the
  primitives already wired (KV, Resend, admin-auth, audit events)
- **Good, because:** the storage shape is JSON-array under one key —
  easy to back up, easy to migrate, easy to reason about
- **Bad, because:** read-modify-write is single-threaded under
  Upstash REST; theoretical race window on concurrent
  claim/resolve. At current volume this is invisible

### Full Postgres ticketing schema

- **Good, because:** would scale to a real ops product without
  re-architecture
- **Bad, because:** out of proportion for P0 scope; would require
  designing assignment / SLA / attachment tables when the immediate
  need is *any* honourable response to escalation. Re-evaluated when
  Phase 1 lifts the queue alongside the app-shell

### Third-party ticketing (Linear / GitHub Issues / Zendesk)

- **Good, because:** off-the-shelf UI, search, assignment, SLAs
- **Bad, because:** adds an external dependency to a load-bearing
  internal control surface; adds a sub-processor for GDPR
  (`docs/security/sub-processors.md`); puts customer-context-bearing
  ticket bodies outside our own GDPR boundary
- Reconsider after pricing-tier signal: if a SOC 2 customer wants
  full audit through their existing ticketing, this becomes attractive

### Email-only

- **Bad, because:** no enumerable queue, no claim semantics, no
  resolution audit — the same forgetting-by-default failure mode this
  ADR exists to fix, in a slightly different costume

### Status quo (stub the tool)

- **Bad, because:** the tool's contract to the customer is broken by
  design; agents promise a human action that never happens. Unacceptable
  for a trade-compliance product

## Related decisions

- [0002 — The LLM never produces a number that drives a business
  decision](0002-llm-never-produces-decision-numbers.md) — the
  human-review queue is the deterministic escape hatch when the agent
  hits a guardrail
- [0003 — Anthropic SDK boundary](0003-anthropic-sdk-boundary.md) —
  the queue itself is LLM-free
- [0005 — Audit-log writes precede success responses](0005-audit-log-before-success.md)
  — every ticket lands as `events.record('human_review_requested')`
- [0006 — Circuit breaker on external calls](0006-circuit-breaker-on-external-calls.md)
  — the email-notification path is breaker-wrapped
- [0008 — Email pseudonymisation](0008-email-pseudonymisation.md) —
  agent context arrives free of raw email (today by agent-prompt
  discipline; a Phase 1 PR adds redaction at the boundary)

## More information

- [lib/human-review.js](../../lib/human-review.js) — implementation
- [lib/handlers/human-review.js](../../lib/handlers/human-review.js) —
  admin API surface
- [docs/runbooks/human-review-queue.md](../runbooks/human-review-queue.md)
  — on-call drain procedure
- [docs/execution-plan.md](../execution-plan.md) — Phase 0 task **P0.10**
  is the work this ADR records
