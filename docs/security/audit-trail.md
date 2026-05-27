# Audit trail — tamper-evidence & verification

**Last reviewed:** 2026-05-27 · **Owner:** founder / DPO

OrcaTrade records every material state change (sign-ins, plan saves, actuals,
org membership + role changes, SCIM provisioning, tier changes, SSO config,
GDPR erasures) to an append-only audit log. This document is the answer set for
the procurement/auditor question: *"can you prove your audit log hasn't been
altered after the fact?"*

For where audit data lives, how long, and how each GDPR right maps to an
endpoint, see [`data-flow.md`](data-flow.md). For the controls overview, see
[`soc2-readiness.md`](soc2-readiness.md) (CC7 / monitoring).

---

## The guarantee

The audit log is **append-only and tamper-evident via a hash chain stamped at
write time.** When an event is recorded, the platform stamps it with:

- `_seq` — a strictly increasing sequence number,
- `_prevHash` — the hash of the previous event,
- `_hash` — `sha256(_prevHash + canonical(event))`.

Because each row's hash commits to the row before it, **any in-place edit,
deletion, or reordering of a stored row breaks the chain** at that point and is
detectable — you cannot rewrite history without invalidating every hash after
the edit.

The chain is computed over a **PII-free projection** of each event (email,
name, company, free-text and the hash fields themselves are excluded). This is
deliberate: it means a lawful **GDPR Article 17 erasure** (which pseudonymises
the actor) does **not** register as tampering — the integrity guarantee and the
right-to-erasure coexist.

## How to verify (independently)

Two endpoints, both admin-authenticated:

| Endpoint | What it proves |
|---|---|
| `GET /api/audit?format=verify-stored` | Re-walks the **write-time** stamped chain in storage and reports `ok` + the first break (`brokenAt` seq) if any. Detects an in-place edit of a stored row. |
| `GET /api/audit?format=chain` | Returns a **portable, self-verifying export**: every row carries `_prevHash`/`_hash`, plus the `genesis`, `headHash`, and the recompute formula. An auditor can recompute `sha256(_prevHash + canonical(row))` offline with no access to our systems and confirm the export is unaltered. |

The export is the artifact to hand an auditor: it is independently verifiable
without trusting OrcaTrade's own verification code.

## Retention

Audit retention follows the schedule in [`data-flow.md`](data-flow.md). Events
are retained for the operational + compliance window there; the store is
capacity-bounded and time-bounded, and retention is enforced rather than
aspirational. Erasure requests pseudonymise the actor while preserving chain
integrity (see "The guarantee" above), so retention and Article 17 do not
conflict.

## Tested

The tamper-evidence is covered by the test suite, not just asserted here:
`test/audit-writetime-chain.test.js` and `test/audit-chain.test.js` verify that
a clean chain validates and that mutating a substantive field of a stored row
is detected as a break.
