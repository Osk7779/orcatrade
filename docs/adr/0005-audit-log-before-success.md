# Audit-log writes precede success responses on every mutation

- **Status:** Accepted
- **Date:** 2026-05-30
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Future handler authors; security / compliance reviewers

## Context and problem statement

Every state change on OrcaTrade — plan save, portfolio save, account delete,
org / membership change, SCIM provisioning, document approval — produces an
auditable side effect. The audit trail serves three audiences:

1. **The customer**, who needs to see what happened to their data
2. **The platform operator**, debugging "why did X change?"
3. **External auditors** (SOC 2, ISO 27001) doing change-management evidence
   review

For the audit trail to be load-bearing, **the audit record must exist on disk
before the user sees a success response.** If the audit write is best-effort
("fire and forget"), a KV outage means a mutation can succeed without any
trace — making the audit log useless for forensic queries.

The 2026-05-30 audit found that audit writes across `lib/handlers/plans.js`,
`account.js`, and others were wrapped in `try { … } catch (_) {}` — exactly
this best-effort pattern. The rule existed in [CLAUDE.md](../../CLAUDE.md)
but was silently violated everywhere.

## Decision drivers

- The audit trail must be load-bearing, not aspirational
- A mutation that returns 200 must have a corresponding audit row
- Failure of the audit subsystem must surface as a 5xx, not be hidden
- Recoverable from transient failures (audit write timeout should retry, not
  fail the mutation immediately)

## Considered options

1. **Mutation handlers write audit synchronously; return 5xx if audit write fails**
2. Mutation handlers write audit synchronously but tolerate failure (status quo
   that the audit revealed as broken)
3. Mutation handlers write to a synchronous outbox table; a worker drains
   it to the audit log
4. Two-phase commit between the mutation and the audit write

## Decision outcome

**Chosen option: mutation handlers write the audit row synchronously and
return a 5xx if the audit write fails after retry. No swallowed failures.**

The implementation pattern, applied to every mutation handler in
`lib/handlers/`:

```js
try {
  await events.record(eventName, payload);   // throws on persistent failure
} catch (err) {
  log.error('audit write failed', { eventName, err });
  return res.status(503).json({ error: 'Audit subsystem unavailable; mutation not committed.' });
}
// mutation business logic only proceeds here
return res.status(200).json(result);
```

For dual-write paths (KV + Postgres), KV is the load-bearing write; the
Postgres mirror remains best-effort with structured logging on failure (the
PG mirror is for analytics + cross-region durability, not for the user-facing
audit promise).

### Consequences

- **Good:** every 200 response corresponds to an audit row; forensic queries
  give complete answers
- **Good:** an audit-subsystem incident surfaces as customer-visible 5xxs,
  which is correctly alerting — not silently degrading
- **Good:** procurement reviewers asking "show me your change-management
  evidence" can be answered with a query, not a story
- **Bad:** an audit-subsystem outage now degrades the customer-facing
  product. Mitigation: the audit subsystem is KV (Upstash), which has very
  high availability; the circuit breaker (ADR 0006) provides graceful
  retry + fallback; an alerts on `audit-write-failed` event from `lib/log.js`
  must page on-call (Phase 3 P3.1)
- **Neutral:** Postgres mirror write may still fail silently — this is by
  design; PG is for analytics, KV is for user-facing audit

### Confirmation

**Enforced as of PR #21 (Phase 0 P0.4).**

- [test/audit-log-non-swallow.test.js](../../test/audit-log-non-swallow.test.js)
  scans the five named mutation-handler files for three swallow patterns:
  single-line `try { await events.record(...) } catch (_) {}`, multi-line
  variants, and `.catch(() => {})` promise-chain swallows. Mutation-tested.
- All 21 swallow sites across `plans.js` (2), `portfolio.js` (3),
  `account.js` (3), `orgs.js` (9), `scim.js` (4) migrated. Audit-write
  failures now propagate to the dispatcher's outer try/catch at
  `api/[...path].js:197` and return 5xx to the caller — the *visible
  failure* corp-grade posture replacing the prior silent swallow.

**Known gap (Phase 1):** the canonical ADR-0005 shape is "audit FIRST,
mutation SECOND" — the handler should refuse with 503 *before* mutating
state if audit cannot persist. Today's PR #21 fix is the smaller form:
mutation runs first, audit runs after, audit failure is no longer
swallowed but the state has already changed. The reorder-to-audit-first
refactor is a Phase 1 follow-up; the enforcement test stays load-bearing
either way.

Auth + billing handlers have their own swallow patterns that are
deliberately out of P0.4's scope — auth_signin failure tolerance is a
judgement call (a KV outage shouldn't lock everyone out), not the same
class of bug. Separate triage if/when needed.

## Pros and cons of the options

### Synchronous audit + 5xx on failure (chosen)

- **Good, because:** load-bearing audit trail
- **Good, because:** outages are visible, not hidden
- **Bad, because:** audit-subsystem availability becomes a hard product
  dependency

### Tolerant audit (status quo)

- **Bad, because:** the audit trail can have gaps; forensic queries return
  partial answers; auditors cannot rely on it
- **Bad, because:** silent degradation; outages don't trigger alerts

### Outbox pattern

- **Good, because:** mutation can succeed even if audit subsystem is
  briefly unavailable
- **Bad, because:** introduces an eventually-consistent gap between mutation
  and audit row — not what auditors want to see
- **Bad, because:** requires building + monitoring a worker queue, which
  doesn't exist today
- Reconsider in Phase 2 when [Vercel Queues](https://vercel.com/docs/queues)
  lands as part of the background-job system (P4.7)

### Two-phase commit

- **Bad, because:** OrcaTrade's data layer (KV + dual-write PG) doesn't
  support distributed transactions

## Related decisions

- [0006 — Circuit breaker on external calls](0006-circuit-breaker-on-external-calls.md) —
  the retry + fallback primitive that the synchronous audit write uses
- [0008 — Email pseudonymisation](0008-email-pseudonymisation.md) — audit
  payloads carry pseudonyms only, never raw email

## More information

- [CLAUDE.md](../../CLAUDE.md) hard rule #5 was the original statement
- Phase 3 task P3.1 in [docs/execution-plan.md](../execution-plan.md) — the
  on-call rota that consumes the audit-write-failed alert this ADR creates
