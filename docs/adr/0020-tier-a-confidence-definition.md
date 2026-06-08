# Tier-A confidence — deterministic eligibility for liability-bearing numbers

- **Status:** Accepted
- **Date:** 2026-06-08
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Anyone wiring an accuracy-guarantee claim flow; anyone
  building a UI surface that displays a confidence badge; anyone writing
  a calculator that emits a `confidence` field

## Context and problem statement

The 5-year strategic plan ([`docs/strategic-plan-2026-2031.md`](../strategic-plan-2026-2031.md)
§4.1.3 and §5.1) commits OrcaTrade to a **liability-bearing accuracy
guarantee** as the single biggest competitive wedge for enterprise
sales: *"if a calculation we cite as Tier-A confidence and you act on
within 30 days proves materially incorrect, we cover the demonstrated
incremental cost up to €5,000 per claim / €50,000 per annum per
customer."*

The guarantee is insurable specifically because the platform is
calculator-grounded (ADR 0002) and reproducible (the FX + AD/CVD +
TARIC pinning + as-of recompute system already shipped). But "Tier-A"
must mean exactly one thing in code, or the guarantee becomes
unenforceable: marketing teams will drift "Tier-A" toward "any answer
we're confident in," underwriters will refuse to renew the E&O
policy, and the first contested claim will collapse the wedge.

This ADR pins the deterministic definition. The mechanism that
*emits* a Tier-A badge and the UI surface that *displays* it ship in
later PRs (Phase 3, Q1 2027 per the strategic plan); this ADR is the
contract those PRs implement against.

## Decision drivers

- The guarantee mechanism must be **enforceable in court**: a Tier-A
  badge must reduce to a finite set of code-verifiable preconditions
  that an underwriter, a customer's compliance officer, and a judge
  can all read and agree on
- The definition must be **conservative on launch** (low false-positive
  rate of Tier-A → low claim rate → underwriter-friendly) and
  **expandable over time** (as calculator coverage matures, more
  outputs qualify)
- Customer-facing language must match the binding code definition
  exactly — no "Tier-A means we're really sure" marketing creep
- The eligibility check must be **deterministic and offline** — a
  Tier-A claim must not depend on an LLM, a heuristic, or any
  non-reproducible signal
- The implementation must not double-classify the existing
  `confidence` field on calculator outputs (which is a 0.0-1.0
  Bayesian-style number used for ranking) — Tier-A is a separate
  yes/no eligibility, not a continuous score

## Considered options

1. **Deterministic eligibility check with five conjunctive
   preconditions, evaluated at quote-emit time and persisted as part
   of the quote artefact** (chosen)
2. **Tier-A as a function of `confidence ≥ 0.95`** — uses the existing
   continuous score
3. **Tier-A as an LLM-judged classification** with a calibration
   harness
4. **Defer the definition** to when the first claim is filed

## Decision

**Adopt option 1.** A calculator output qualifies for **Tier-A
confidence** if and only if ALL of the following are true at the
moment the quote is generated:

| # | Precondition | Code-verifiable via |
|---|---|---|
| **TA-1** | Every numeric input has a pinned snapshot reference (TARIC chapter rate, AD/CVD case, FX rate, ETS price, etc.) with `snapshot_age_days ≤ 30` | The reproducibility-snapshot system (`lib/intelligence/snapshots/` and the as-of recompute endpoint); each pinned source records its `as_of` date |
| **TA-2** | Every input snapshot was captured from its **primary regulator source** (TARIC live API, ECB FX, EU ETS auction price, etc.) — not a mirror, not a manual override, not a customer-supplied estimate | Snapshot rows carry `source_kind ∈ { 'primary_regulator', 'mirror', 'manual', 'customer_supplied' }`; only `primary_regulator` qualifies |
| **TA-3** | The originating calculator passed its full regression test suite within the last 24 hours (build green on `main` since the last calculator-touching commit) | CI publishes a green-state stamp per calculator to a known KV key (`calculator:<name>:last_green_at`); the eligibility check reads it |
| **TA-4** | No `requestHumanReview` escalation was triggered on this quote, and no manual override was applied to any input or output value | The quote object records `escalations: []` and `overrides: []` — both arrays must be empty |
| **TA-5** | The product / shipment falls within a calculator's **declared coverage envelope** (HS chapter, origin country, destination country, value bands, regime applicability) — outputs from edge-case extrapolation never qualify | Each calculator declares a `coverage` manifest (HS chapter set, country set, value band); the input must fall fully inside it |

A quote artefact persists its Tier-A determination as a separate
boolean field (`tier_a_eligible: true | false`) plus the reason it
failed if false (`tier_a_failed_reason: 'snapshot-stale-TA1' |
'manual-override-TA4' | ...`). Both fields are append-only and
audit-logged per ADR 0005.

The accuracy guarantee only applies to outputs where
`tier_a_eligible === true` AND the customer subscribed to a tier
eligible for the guarantee (Growth and above per the strategic plan
pricing table) AND the customer's claim is filed within 30 days of
the quote's `generated_at` timestamp. All three conditions are
code-verifiable on claim review.

### What this ADR does NOT decide

- The UI surface (badge, tooltip, modal copy) — Phase 3 PR
- The claim-submission flow (how a customer reports a Tier-A error)
  — Phase 3 PR, after E&O insurance is bound (target Q1 2027)
- The exact `coverage` manifest format per calculator — each
  calculator owner authors theirs in its calculator module
- The relationship to the existing `confidence: 0.0-1.0` field on
  agent tool outputs — Tier-A is orthogonal; both can coexist on
  the same quote (confidence ranks options; Tier-A determines
  guarantee eligibility on the chosen option)

## Consequences

### Good

- **Underwriter-defensible:** Every Tier-A claim resolves to a set
  of code preconditions an E&O underwriter can audit and price
- **Customer-credible:** No vague "we're really sure" — Tier-A is a
  badge with a definition the customer can read and verify
- **Drift-resistant:** Marketing copy that claims Tier-A on
  non-eligible outputs fails the floor-test (enforced per ADR 0019);
  the badge can only appear where the code says it can
- **Liability-bounded:** Failure modes (stale snapshot, manual
  override, edge-case input) all degrade *away* from Tier-A, never
  silently into it
- **Accountable:** Every Tier-A determination is audit-logged with
  the precise reason at quote-emit time — a customer claim 28 days
  later can be evidenced from the audit trail without recomputation
  uncertainty

### Bad

- **Initial coverage is narrow.** TA-3 (calculator regression green
  in last 24h) is straightforward; TA-1, TA-2, TA-5 require each
  calculator to maintain primary-source provenance and a coverage
  manifest. Some calculators will need refactoring before any of
  their outputs qualify for Tier-A. Acceptable: narrow-but-real
  Tier-A is the underwriter-friendly launch posture
- **Conservatism cost.** Customers will see "Tier-A unavailable —
  this input falls outside the calculator's declared coverage
  envelope" on edge cases that the calculator probably handles
  correctly. The right answer is to **expand the declared coverage
  envelope** with regression-test backing, not to relax the
  eligibility rules

### Neutral

- The five-precondition rule will likely add 1-3 ADRs over the next
  18 months as we learn from real claim attempts. Each refinement
  ships as a new ADR that supersedes or amends this one — never as
  a silent change in the eligibility function

## Confirmation

- **Code:** `lib/intelligence/tier-a/` will house the eligibility
  function (`isTierAEligible(quote, snapshots, calculatorState)`)
  and the persistence helpers. Shipped in the Phase 3 Q1 2027 PR
  that depends on this ADR
- **Tests:**
  - A unit test asserts each of TA-1 through TA-5 individually
    causes `tier_a_eligible: false` with the correct failure reason
  - An integration test asserts a passing quote earns `true` and
    persists the determination to the audit log
  - A test asserts the `tier_a_eligible` field on every persisted
    quote matches a recomputation against the snapshot pins (so a
    later quote-rewrite cannot silently elevate a false to a true)
  - The floor-test pattern from ADR 0019 covers customer-facing
    docs: any doc surface using the term "Tier-A" must reference
    this ADR by number
- **ADR drift:** This ADR is amended only by a successor ADR.
  Lowering eligibility (relaxing any of TA-1 through TA-5) requires
  an explicit "Supersedes 0020" header and a written justification
  that an underwriter has signed off on
