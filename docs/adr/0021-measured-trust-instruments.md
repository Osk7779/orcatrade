# Measured trust instruments — honesty gates, stateless recomputation, single source of truth

- **Status:** Accepted · Implementation shipped 2026-07-08/09 (sprints 80–92)
- **Date:** 2026-07-09
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Anyone building a surface that publishes a measured
  claim about the platform's own performance (accuracy, SLA
  attainment, or a future instrument); anyone tempted to store,
  cache-as-truth, or reimplement one of these figures

## Context and problem statement

Between sprints 80 and 92 the platform grew a family of
**measured trust instruments** — public and per-org surfaces that
publish the platform's own performance as numbers:

- the **Quote Accuracy Ledger** (`/api/accuracy`, `/trust/accuracy`,
  the org cockpit card) — quotes vs customer-reported actual
  outcomes;
- **SLA attainment** (`/api/sla`, `/trust/sla`, the cockpit cards)
  — measured 48h quote-turnaround and 24h first-human-response
  commitments over write-once clock stamps;
- the **trust pack** (`/api/trust-pack`) — the due-diligence bundle
  aggregating both plus the audit-anchor history;
- the **SLA-at-risk cohort + alert** (cohort #13) — the preventive
  half of the SLA engine.

These instruments are the commercial core of the licensed-
counterparty thesis: they convert "trust us" into "recompute it
yourself." That only works if three rules hold everywhere, forever.
A single instrument that flatters itself, disagrees with its
sibling surface, or ships a stored hand-adjustable figure poisons
the credibility of all of them.

## Decision

1. **Honesty gates.** Every measured instrument withholds its
   headline metrics below a shared minimum sample: below
   `INDICATIVE_MIN` (10) scoreable data points, the metrics are
   `null` and only the count ships; `10–49` publishes with an
   explicit early-sample label; `50+` reads as measured. The gate
   constants live in **one place**
   ([`lib/intelligence/accuracy-ledger.js`](../../lib/intelligence/accuracy-ledger.js))
   and every other instrument **imports** them — two definitions of
   "enough data" would be a credibility bug. The zero-corpus state
   is rendered truthfully ("instrument live, accruing"), never
   back-filled or guessed.

2. **Stateless recomputation.** No stored attainment or accuracy
   figure exists anywhere in the system. Every read recomputes from
   the corpus (actuals rows, write-once clock stamps), so an
   auditor with the same rows reaches the same numbers. Short-TTL
   KV snapshots are permitted as traffic protection only — they
   cache a computation's *output*, never become an editable source.

3. **Single source of truth across surfaces.** When an instrument
   has more than one surface (public page, org cockpit, bundle),
   every surface calls the **same computation function**. The trust
   pack imports `computeLedger` / `computeAttainment` from the live
   handlers; the org accuracy card calls the same
   `computeAccuracyLedger` as `/api/accuracy`. Reimplementing a
   metric for a second surface is banned.

4. **Clock-stamp integrity.** SLA clocks are **write-once**
   (`COALESCE(stamp, now())`): reworks cannot launder a slow first
   answer. The first-response clock stops **only on human actions**
   (team review decision or ops-role message) — an automated
   transition stamping it would make the metric trivially perfect.
   Time deltas are derived server-side exactly once; downstream
   renderers (cards, emails) may only render the sign, never
   recompute.

5. **Negotiated vs platform scope.** Per-org negotiated targets
   (knobs 6–7) move only that org's own cockpit view and its
   alerts. The public pages and the cross-org triage risk line stay
   on the platform targets — a private contract never changes what
   the website promises everyone.

6. **PII-free by construction.** Public instrument responses are
   built exclusively from aggregates + methodology copy; row-level
   fields never appear in the handler code. Trust surfaces degrade
   to a truthful reduced state on failure — they never 5xx.

## Consequences

- Adding an instrument means importing the shared gates, wiring the
  computation once, and reusing it on every surface — the tests
  below fail any shortcut.
- The instruments stay individually boring and collectively
  credible: the same rules, the same gates, the same recompute
  posture, everywhere a number about ourselves is published.
- Marketing can never be handed a stored figure to "adjust" — the
  figure doesn't exist outside the computation.

## Confirmation

Each rule is enforced by source-pinned drift-guards:

- **Gates + zero-corpus truthfulness:**
  [`test/accuracy-ledger.test.js`](../../test/accuracy-ledger.test.js)
  (withhold below 10, tier boundaries 9/10/49/50, zero-corpus
  state, garbage rows can't inflate the sample);
  [`test/sla-quote-turnaround.test.js`](../../test/sla-quote-turnaround.test.js)
  (gates **imported** from the ledger — single-source pin — plus
  boundary equivalence).
- **Stateless recomputation + cache posture:**
  [`test/accuracy-ledger.test.js`](../../test/accuracy-ledger.test.js) and
  [`test/sla-public.test.js`](../../test/sla-public.test.js)
  (KV snapshot fail-open, degrade-to-truthful-state, no-5xx
  absence pins).
- **Single source across surfaces:**
  [`test/trust-pack.test.js`](../../test/trust-pack.test.js)
  (bundle imports the live handlers' computations; a
  no-second-implementation absence pin);
  [`test/org-accuracy-view.test.js`](../../test/org-accuracy-view.test.js)
  (org view calls the same calculator as the public ledger).
- **Clock-stamp integrity:**
  [`test/sla-quote-turnaround.test.js`](../../test/sla-quote-turnaround.test.js)
  (both quoted-landing writers stamp first-write-only);
  [`test/sla-first-response.test.js`](../../test/sla-first-response.test.js)
  (human-only stamps; the automated transition writer's ABSENCE
  pin; exactly-two-stamps count);
  [`test/insights-sla-at-risk.test.js`](../../test/insights-sla-at-risk.test.js) and
  [`test/sla-at-risk-alert.test.js`](../../test/sla-at-risk-alert.test.js)
  (single server-side derivation; `Date.now` absence pins on the
  card and the composer).
- **Negotiated vs platform scope:**
  [`test/operator-config-sla-knobs.test.js`](../../test/operator-config-sla-knobs.test.js)
  and
  [`test/insights-sla-at-risk.test.js`](../../test/insights-sla-at-risk.test.js)
  (two-directional contrast pins on `/api/sla` and the triage
  handler).
- **PII-free construction:**
  [`test/accuracy-ledger.test.js`](../../test/accuracy-ledger.test.js),
  [`test/sla-public.test.js`](../../test/sla-public.test.js),
  [`test/trust-pack.test.js`](../../test/trust-pack.test.js)
  (comment-stripped forbidden-token absence checks).
