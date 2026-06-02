# Email is stored only as a salted server-side pseudonym

- **Status:** Accepted
- **Date:** 2026-05-30
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Future handler authors; GDPR / privacy reviewers; security auditors

## Context and problem statement

OrcaTrade processes customer email addresses for authentication (magic links),
notifications (digests, alerts), and audit (linking events to a user). Raw
email is PII under GDPR + the UK DPA; storing it in audit tables, events
streams, or analytics widens the breach surface unnecessarily.

The platform's existing design (pre-2026-05-30 audit) hashed email with
**unsalted SHA-256, truncated to 16 hex chars**, as the join key in
`schema.sql` (`email_hash`). The audit confirmed the column-level discipline
(no raw email in PG, no raw email in events.payload) but flagged the hash
itself: **unsalted SHA-256 over short, predictable strings is trivially
reversible** by anyone with a list of common email addresses (every breach
corpus). The design was an *operational pseudonym*, not a *privacy-preserving*
hash. Calling it the latter in customer-facing security copy would be
incorrect.

## Decision drivers

- GDPR / UK DPA compliance — minimise PII held in derivative stores
- Honest privacy posture — don't claim more than the implementation delivers
- Joinability — same email must produce the same identifier across systems,
  for audit-log queries to work
- Reversibility resistance — an attacker with the database must not be able
  to rebuild the email column from public corpora

## Considered options

1. **HMAC-SHA-256 with a server-side secret salt; truncated to 16 hex chars**
2. Status quo: unsalted SHA-256 (operational pseudonym only)
3. Per-row random salt stored alongside the hash
4. Encryption (reversible with the key) instead of hashing

## Decision outcome

**Chosen option: HMAC-SHA-256 with a server-side secret salt (`EMAIL_PSEUDO_SALT`
env var), truncated to 16 hex chars.**

The pseudonym is computed once per request (per `lib/hash.js`); the salt
lives only in environment variables (never logged, never sent to the LLM, never
in source). Same email + same salt always produces the same pseudonym, so
audit-log joins continue to work. Different deployments (dev, staging,
production) use different salts, so a leak in one environment doesn't
compromise pseudonyms in another.

The 16-hex truncation (64 bits of entropy) preserves the existing column
width + index — no schema migration on the join column. 64 bits is more than
enough at OrcaTrade's customer scale to avoid collision.

### Consequences

- **Good:** privacy-preserving against rainbow-table attacks
- **Good:** joinability preserved — audit-log queries still work
- **Good:** rotating the salt invalidates all old pseudonyms — defensive
  posture for an environment that's been compromised
- **Bad:** loss of the salt = loss of join across historical events (mitigation:
  salt is in env vars + the Vercel project's secrets store; backed up like
  every other secret)
- **Bad:** changing the salt requires a backfill job to re-hash every row's
  pseudonym + every event payload (mitigation: salt rotation is an emergency
  procedure, not routine)
- **Neutral:** new email events written under the new salt; old events under
  the old salt remain queryable but require the old salt to join — kept in a
  retired-salts environment variable for legacy queries

### Confirmation

**Today: partially enforced.** The column-level discipline is in place
(`schema.sql` has `email_hash` not `email`; `events.js` line 253 explicitly
deletes `email` from event payloads before persisting). The salt migration
is Phase 1 task P1.3 in [docs/execution-plan.md](../execution-plan.md).

Phase 1 task P1.3 will land:

- The new `EMAIL_PSEUDO_SALT` env var + Vercel project secret + dev `.env.example`
- `lib/hash.js` switching from `crypto.createHash('sha256')` to
  `crypto.createHmac('sha256', salt)`
- A background job that re-hashes existing rows in `users`, `events`, etc.
  with the new pseudonym + writes a one-time backfill record
- A test that fails the suite if `lib/hash.js` falls back to unsalted hashing
- A docs update across `docs/security/`, `/account/privacy/` UI copy,
  marketing copy: from "SHA-256 hash" → "salted server-side pseudonym"

Until P1.3 lands, this ADR documents the *target* state; the *current* state
is operational pseudonym only. **Public-facing privacy copy must not claim
"privacy-preserving SHA-256"** during this transition.

## Pros and cons of the options

### HMAC with server-side salt (chosen)

- **Good, because:** rainbow-table resistant
- **Good, because:** join still works (deterministic per salt)
- **Good, because:** salt rotation is a defensive option
- **Bad, because:** salt loss = join loss

### Unsalted SHA-256 (status quo)

- **Bad, because:** trivially reversible against public email corpora
- **Bad, because:** can't be honestly called "privacy-preserving"
- **Acceptable only as:** an operational pseudonym, not a privacy mechanism

### Per-row random salt

- **Good, because:** even stronger — different pseudonyms for same email in
  different rows
- **Bad, because:** breaks joinability — the whole point of the pseudonym
  is to link audit rows to the user

### Encryption (reversible)

- **Good, because:** legitimate use cases (admin lookup) become possible
- **Bad, because:** the key holder can fully de-anonymise; doesn't reduce the
  breach blast radius, only changes who can de-anonymise
- **Bad, because:** GDPR data-minimisation principle prefers irreversible
  derivatives where the use case allows

## Related decisions

- [0005 — Audit-log before success](0005-audit-log-before-success.md) — the
  audit table that consumes the pseudonym as the user-identity column
- Phase 1 task P1.3 in [docs/execution-plan.md](../execution-plan.md) — the
  implementation that turns this ADR's *target* state into the *current* state

## More information

- [CLAUDE.md](../../CLAUDE.md) hard rule #4 was the original column-level
  rule (no raw PII in events / Postgres)
- [docs/security/](../security/) — the customer-facing privacy posture page;
  must be updated in lockstep with P1.3
- The 2026-05-30 audit's finding on unsalted SHA-256 was the trigger for
  this ADR
