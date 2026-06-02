# Every external HTTP call is wrapped in `lib/circuit.js`

- **Status:** Accepted
- **Date:** 2026-05-30
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Future handler authors

## Context and problem statement

OrcaTrade depends on a handful of third-party HTTP services: Anthropic API
(LLM calls), Resend (email), Stripe (billing), the UK Trade Tariff API
(TARIC duty rates), Voyage AI (embeddings, when configured), and the Neon
Postgres HTTP driver. Each is occasionally slow or down. Without protection,
a 5-second Anthropic hang holds the request open until the upstream times
out; a chain of repeated failures saturates the Vercel function instance
pool; the customer sees their browser spinner climb past 30s before failing.

The 2026-05-30 audit found `lib/circuit.js` (a state-machine circuit breaker
with KV-backed state) existed and was *only* used to wrap Resend. The five
agent handlers calling Anthropic via raw `fetch` had per-request `AbortController`
timeouts but no circuit state — so a sustained Anthropic outage would
re-hammer the upstream from every cold function instance instead of
short-circuiting to a fallback.

## Decision drivers

- Bound failure latency — never wait longer than necessary for a known-bad
  upstream
- Bound failure blast radius — don't hammer a recovering upstream
- Graceful degradation — fallback to cached or computed alternative where
  possible
- Observability — circuit state changes are loggable events; on-call can see
  when a circuit opens

## Considered options

1. **Wrap every external HTTP call in `lib/circuit.js` (timeout + retries +
   open/half-open/closed state)**
2. Per-request timeout only (status quo for Anthropic calls)
3. Third-party library (`opossum`, `cockatiel`)
4. Move circuit logic into a shared HTTP client wrapper that every external
   call must use

## Decision outcome

**Chosen option: every external HTTP call wraps in `lib/circuit.js`.**

The circuit primitive is a three-state machine per upstream:

- **Closed** — calls go through; failures increment a counter
- **Open** — after N failures in a window, calls fail fast with the last
  cached response (or a structured error); a cooldown timer runs
- **Half-open** — after cooldown, one probe call decides whether to close
  again (success) or re-open (failure)

State is keyed on the upstream name + stored in KV with a short TTL so it
persists across Vercel function cold starts. Each handler registers its
upstream once (e.g. `'anthropic-messages'`) and wraps each call with
`circuit.run('anthropic-messages', () => fetch(...))`.

### Consequences

- **Good:** sustained upstream outages fail fast, not slow
- **Good:** circuit state visible in `/api/health` (Phase 0 task P0.8)
- **Good:** logs of state transitions feed on-call dashboards (Phase 1 task
  P1.8 OTEL traces)
- **Bad:** every external call site needs the same wrapper pattern — code
  duplication mitigated by `lib/circuit.js`'s tight API
- **Bad:** the half-open probe consumes a real request to a possibly-down
  upstream — small cost; the alternative is permanent open state
- **Neutral:** when the circuit is open, the user sees a fallback response
  (cached, computed, or error) rather than a timeout — almost always better
  UX, but breaks the assumption "the response is fresh"

### Confirmation

**Enforced for Anthropic as of PR #22 (Phase 0 P0.3).** Resend was wrapped
in Wave 1; Anthropic is the second upstream brought under the rule.

- All 6 plan-named handlers (agent.js, finance-agent.js, logistics-agent.js,
  orchestrator.js, sourcing-agent.js, supply-chain.js) now wrap their
  Anthropic call in `circuit.run('anthropic-messages', ...)` with a
  fallback that throws (preserving the existing handler error path).
  Shared circuit name across all 6 — one sustained Anthropic outage
  trips one circuit, not six.
- [test/anthropic-circuit-wrap.test.js](../../test/anthropic-circuit-wrap.test.js)
  is the enforcement gate. Three assertions: (1) every file containing
  a raw `'https://api.anthropic.com'` reference must also contain
  `circuit.run('anthropic-...')`; (2) the 6 named handlers specifically
  must use the wrap + import the circuit module; (3) `EXEMPT_FILES`
  entries must still exist (catches accidental deletion of an exempted
  file without cleaning up the exemption). Mutation-tested.

**Known gaps (each tracked):**

- **`lib/handlers/factory-score.js`** — temporarily in `EXEMPT_FILES`.
  Wrapped in the follow-up PR after PR #10 (factory-score ESM→CJS
  conversion) merges. The file's current ESM-under-CJS-dispatcher state
  makes a clean wrap dependent on PR #10's restructure.
- **`lib/intelligence/model-runtime.js`** (will become `lib/ai/model-runtime.js`
  after PR #8 lands) — temporarily in `EXEMPT_FILES`. Wrapping at the
  wrong path would create a merge conflict with PR #8; the follow-up
  lands once PR #8 merges and the path is canonical.
- **TARIC client, Stripe, Voyage AI** — out of scope for P0.3 (whose
  plan-listed scope was Anthropic only). Phase 1 hardening tranche will
  extend the same pattern.

The ADR is no longer "documented but not enforced" for Anthropic.

## Pros and cons of the options

### Circuit breaker via `lib/circuit.js` (chosen)

- **Good, because:** standard pattern, well-understood operationally
- **Good, because:** KV-backed state survives cold starts
- **Good, because:** in-house code, no dependency drift

### Per-request timeout only

- **Good, because:** simplest possible primitive
- **Bad, because:** doesn't bound the blast radius of sustained failure;
  every cold function instance re-tries the bad upstream

### Third-party library (`opossum`, `cockatiel`)

- **Good, because:** battle-tested, more features (bulkhead, fallback chains)
- **Bad, because:** adds a runtime npm dep; OrcaTrade keeps its runtime
  surface tiny
- **Bad, because:** library's storage abstraction would need to bridge to KV
  anyway

### Shared HTTP client wrapper

- **Good, because:** structurally impossible to skip the circuit
- **Bad, because:** every distinct upstream's request shape (headers, body,
  auth) makes a single client awkward
- **Worth revisiting** in Phase 2 if the upstream count grows; today's six
  is manageable with per-call wrapping

## Related decisions

- [0005 — Audit-log before success](0005-audit-log-before-success.md) — uses
  the circuit primitive for audit-write retries
- Phase 0 task P0.3 + Phase 0 task P0.8 (`/api/health` per-probe timeouts)
  in [docs/execution-plan.md](../execution-plan.md)

## More information

- [Martin Fowler — Circuit Breaker](https://martinfowler.com/bliki/CircuitBreaker.html) —
  the canonical reference
- [CLAUDE.md](../../CLAUDE.md) hard rule #6 was the original statement
