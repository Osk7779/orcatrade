# Tier-A confidence — deterministic eligibility for liability-bearing numbers

- **Status:** Accepted · Implementation shipped 2026-06-12 (see [Implementation summary](#implementation-summary))
- **Date:** 2026-06-08 (decided) · 2026-06-12 (wedge closed)
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
*emits* a Tier-A badge and the UI surface that *displays* it
**shipped between PRs #87 and #120 (2026-06-08 to 2026-06-12)**
across all five platform calculators — see [Implementation
summary](#implementation-summary) for the PR-by-PR matrix. The
**liability-bearing accuracy guarantee** itself remains forthcoming:
it activates in Q1 2027 once the E&O insurance binds. Until then,
every customer-facing surface (email badges, wizard pills, ADR
prose) uses **forthcoming-guarantee wording** — Tier-A is described
as an auditable transparency signal, not an active financial
guarantee. A drift-guard test pins the forthcoming language across
~10 surfaces; any PR that introduces active-guarantee phrasing
(accuracy-guarantee claims, refund language, money-back wording)
without the Q1-2027-forthcoming qualifier fails CI.

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
failed if false. The failure-reason taxonomy is closed — exactly
these five strings, one per precondition:

| Precondition | `tier_a_failed_reason` value |
|---|---|
| TA-1 (stale snapshot) | `snapshot-stale-TA1` |
| TA-2 (non-primary source) | `non-primary-source-TA2` |
| TA-3 (calculator not green) | `calculator-not-green-TA3` |
| TA-4 (escalation or override present) | `escalation-or-override-TA4` |
| TA-5 (outside coverage envelope) | `outside-coverage-TA5` |

Both fields are append-only and audit-logged per ADR 0005. Adding a
new precondition (TA-6, TA-7, …) requires a successor ADR that
extends this taxonomy with the new closed value — never an ad-hoc
string. The `lib/intelligence/tier-a/eligibility.js` module exports
this taxonomy as the `REASONS` constant; a drift-guard test asserts
every `REASONS` value appears verbatim in this ADR.

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

- **Code:** [`lib/intelligence/tier-a/`](../../lib/intelligence/tier-a/)
  houses the eligibility function (`evaluate(input, opts?)` —
  the `tier-a/index.js` entrypoint) and its sub-modules:
  - [`eligibility.js`](../../lib/intelligence/tier-a/eligibility.js)
    — the five-precondition check + the closed `REASONS` constant
    (drift-guarded against this ADR's failure-reason table; see
    `test/tier-a-adr-reasons-drift.test.js`)
  - [`coverage.js`](../../lib/intelligence/tier-a/coverage.js) —
    TA-5 coverage-envelope checking
  - [`green-state.js`](../../lib/intelligence/tier-a/green-state.js)
    — TA-3 last-green stamp read/write (KV-backed)

  Each platform calculator exports a `TIER_A_COVERAGE` manifest and
  a `buildTierAInput(quoteResult)` helper. Wired in [PR #89][pr89]
  (customs), [PR #99][pr99] (sourcing), [PR #109][pr109] (finance),
  [PR #113][pr113] (routing), and [PR #118][pr118] (warehouse).

- **Tests** (all shipping today, not future-tense):
  - **Per-precondition unit tests** in `test/tier-a-eligibility.test.js`
    assert each of TA-1 through TA-5 individually causes
    `eligible: false` with the correct `failedReason` from the
    closed `REASONS` taxonomy
  - **Calculator-side tests** in `test/tier-a-{customs,sourcing,
    routing,finance,warehouse}-quote.test.js` assert each
    calculator's `buildTierAInput` emits a well-shaped
    `EligibilityInput` and that an end-to-end pass through
    `tierA.evaluate()` lands on the expected verdict
  - **Composer-side tests** in `test/start-{customs,sourcing,
    routing,finance,warehouse}-tier-a.test.js` assert every wizard
    plan carries a `tier_a` verdict on the corresponding sub-block
    (customs, sourcing, routing, finance, warehouse), with the
    correct closed-taxonomy failure reasons. A FIVE-verdict
    aggregate assertion pins all five together.
  - **Email-side tests** in `test/start-i18n-{customs,sourcing,
    routing,finance,warehouse}-tier-a.test.js` pin per-locale
    badge wording (EN / PL / DE), forthcoming-guarantee discipline,
    and no-borrowing-of-other-calculators'-subjects.
  - **Wizard-pill source-pinning tests** in `test/wizard-{customs,
    sourcing,routing,finance,warehouse}-tier-a-pill.test.js` pin
    conditional rendering, tooltip wording, aria-labels,
    `StartResponse` type shape, and pill render order.
  - **Cross-stack drift guard** (`test/tier-a-adr-reasons-drift.test.js`)
    asserts every value in `REASONS` appears verbatim in this ADR's
    failure-reason table — preventing silent drift between code and
    contract.
  - **PR-table drift guard** (`test/tier-a-adr-implementation-table.test.js`,
    added 2026-06-12) asserts the [Implementation
    summary](#implementation-summary) table in this ADR enumerates
    all five calculators × four layers (foundation, composer,
    email, pill) — so a future PR that ships another calculator's
    Tier-A surface without updating this ADR's matrix fails CI.
  - **Wording discipline drift guards** across ~10 surfaces (email
    blocks per locale + wizard pill tooltips + per-pill aria-labels)
    pin the forthcoming-guarantee language. The exact prohibited
    regex patterns live in the test files themselves — see
    `test/start-i18n-{customs,sourcing,routing,finance,warehouse}-tier-a.test.js`
    and `test/wizard-{customs,sourcing,routing,finance,warehouse}-tier-a-pill.test.js`.
    Categories: active-guarantee phrasing, refund/money-back
    wording, and active-guarantee claims without the Q1-2027
    forthcoming qualifier.
  - The floor-test pattern from ADR 0019 covers customer-facing
    docs: any doc surface using the term "Tier-A" references this
    ADR by number.

- **ADR drift:** This ADR is amended only by a successor ADR.
  Lowering eligibility (relaxing any of TA-1 through TA-5) requires
  an explicit "Supersedes 0020" header and a written justification
  that an underwriter has signed off on. **Extending** the
  implementation surface to a sixth calculator does NOT require a
  successor ADR — just an update to the [Implementation
  summary](#implementation-summary) table (the drift-guard test
  enforces).

## Implementation summary

The wedge is **complete**. Every platform calculator exposes the
full four-layer Tier-A surface — calculator foundation, `/api/start`
composer wire-up, plan-email badge (per locale), and wizard pill.
Each cell links to the PR that landed it.

| Layer | customs-quote | sourcing-quote | routing-quote | finance-quote | warehouse-quote |
|-------|---------------|----------------|---------------|---------------|-----------------|
| **Foundation** (`TIER_A_COVERAGE` + `buildTierAInput`) | [PR #89][pr89] | [PR #99][pr99] | [PR #113][pr113] | [PR #109][pr109] | [PR #118][pr118] |
| **Composer** (`/api/start` emits `plan.<calc>.tier_a`) | [PR #91][pr91] | [PR #110][pr110] | [PR #114][pr114] | [PR #116][pr116] | [PR #119][pr119] |
| **Email badge** (per-locale, EN/PL/DE) | [PR #92][pr92] | [PR #111][pr111] | [PR #115][pr115] | [PR #117][pr117] | [PR #120][pr120] |
| **Wizard pill** (`role="status"` + aria-label + tooltip) | [PR #98][pr98] | [PR #112][pr112] | [PR #115][pr115] | [PR #117][pr117] | [PR #120][pr120] |

**5 calculators × 4 layers = 20 surfaces, all shipped.**

### Operational note: which calculators light up Tier-A today

[PR #132][pr132] (2026-06-13) shipped the first primary-regulator
gate — **customs-quote** now emits `eligible: true` verdicts in
production when the wizard supplies an HS code that resolves through
the live EU TARIC API.

[PR #139][pr139] (2026-06-15) shipped the second — **sourcing-quote**
now emits `eligible: true` when backed by a UN Comtrade trade-flow
snapshot. The Comtrade client (`lib/intelligence/comtrade-client.js`)
fetches top-EU-exporter rankings per HS6 code with 30-day fresh /
90-day stale caching. The integration into `/api/start` follows in a
subsequent PR; today the path is exercised by
`sourcing.recommendCountryAsync({ hsCode })` callers.

The PR #132 + #139 fixes share the same shape: drop the rate-card
mirror snapshot when a primary-regulator snapshot is present. The
TA-2 check fails as soon as ANY snapshot is non-primary, so emitting
both blocks the verdict flip. Future per-calculator gates follow this
same pattern.

| Calculator | Primary-regulator gate | Status |
|------------|------------------------|--------|
| customs-quote | EU TARIC live API | ✅ [PR #132][pr132] |
| sourcing-quote | UN Comtrade trade-flow data | ✅ [PR #139][pr139] |
| finance-quote | ECB Statistical Data Warehouse FX reference rates | ✅ [PR #141][pr141] |
| routing-quote | Carrier-published rate indices (SCFI, WCI, FBX) | Pending integration |
| warehouse-quote | EU Eurostat warehousing producer-price indices, or direct hub-published rate cards via API | Pending integration |

Each remaining gate lands as a separate, calculator-scoped PR. The
forthcoming-guarantee wording stays in place across every surface
until E&O insurance binds in Q1 2027 — Tier-A continues to be a
transparency signal even where it now flips `eligible: true`.

[pr132]: https://github.com/Osk7779/orcatrade/pull/132
[pr139]: https://github.com/Osk7779/orcatrade/pull/139
[pr141]: https://github.com/Osk7779/orcatrade/pull/141
[pr87]: https://github.com/Osk7779/orcatrade/pull/87
[pr89]: https://github.com/Osk7779/orcatrade/pull/89
[pr91]: https://github.com/Osk7779/orcatrade/pull/91
[pr92]: https://github.com/Osk7779/orcatrade/pull/92
[pr98]: https://github.com/Osk7779/orcatrade/pull/98
[pr99]: https://github.com/Osk7779/orcatrade/pull/99
[pr109]: https://github.com/Osk7779/orcatrade/pull/109
[pr110]: https://github.com/Osk7779/orcatrade/pull/110
[pr111]: https://github.com/Osk7779/orcatrade/pull/111
[pr112]: https://github.com/Osk7779/orcatrade/pull/112
[pr113]: https://github.com/Osk7779/orcatrade/pull/113
[pr114]: https://github.com/Osk7779/orcatrade/pull/114
[pr115]: https://github.com/Osk7779/orcatrade/pull/115
[pr116]: https://github.com/Osk7779/orcatrade/pull/116
[pr117]: https://github.com/Osk7779/orcatrade/pull/117
[pr118]: https://github.com/Osk7779/orcatrade/pull/118
[pr119]: https://github.com/Osk7779/orcatrade/pull/119
[pr120]: https://github.com/Osk7779/orcatrade/pull/120
