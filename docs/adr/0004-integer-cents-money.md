# Money arithmetic is integer cents through `lib/intelligence/money.js`

- **Status:** Accepted
- **Date:** 2026-05-30
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Future calculator authors

## Context and problem statement

OrcaTrade calculators compose dozens of small multiplications and additions to
arrive at a customs duty, a CBAM exposure, an FX-converted landed cost, a
working-capital number. Naïve JavaScript floating-point arithmetic on money
values produces rounding drift that compounds: `0.1 + 0.2 !== 0.3` in JS,
multiplied across a quote with 30 line items, becomes visible as "the total
doesn't equal the sum of its parts" errors that customers and auditors will
notice.

Worse, the drift is non-deterministic across execution orders — refactoring
the calculator to compute the same answer in a different order can produce a
different number, breaking reproducibility (a property OrcaTrade is built on
— see [ADR 0002](0002-llm-never-produces-decision-numbers.md)).

## Decision drivers

- Numeric correctness on money is non-negotiable
- Reproducibility — same inputs, same outputs, regardless of computation order
- Auditability — every step of the calculation must be traceable
- Boundary clarity — convert at the edges (input parsing, output rendering),
  compute integers in the middle

## Considered options

1. **Integer cents through a money helper (`lib/intelligence/money.js`); convert at the boundary**
2. JS floats throughout, round at the end
3. A decimal library (e.g. `big.js`, `decimal.js`) — full arbitrary-precision arithmetic
4. BigInt throughout

## Decision outcome

**Chosen option: integer cents through `lib/intelligence/money.js`; convert
at the boundary with `fromEuro` / `toEuro`.**

The money helper exposes a small surface:

- `fromEuro(num)` / `toEuro(cents)` — boundary converters
- `mulRate(cents, rate)` — multiply by a decimal rate with banker's rounding
- `divInt(cents, divisor)` — integer division with banker's rounding
- Safe-integer guards — throw on overflow rather than silently corrupt

All `lib/intelligence/*-quote.js` calculators take input in euros, convert
immediately to integer cents, do all arithmetic in cents, convert back to
euros only at the final return.

### Consequences

- **Good:** rounding is deterministic and order-independent
- **Good:** banker's rounding matches accounting conventions (round-half-even)
- **Good:** safe-integer guards catch implausibly-large quotes early
- **Good:** zero npm dependencies — fits the "small surface area" disposition
  of [CLAUDE.md](../../CLAUDE.md)
- **Bad:** developers must remember to convert at the boundary; raw float
  arithmetic on money is currently catchable only by code review (no test
  enforces it — see Confirmation below for the planned gap closure)
- **Neutral:** `toFixed()` for percentage display is allowed because it's
  rendering, not arithmetic — already used in customs-quote.js for label
  output

### Confirmation

- The money helper itself has unit-test coverage for `fromEuro` / `toEuro` /
  `mulRate` / `divInt` / banker's rounding edge cases
- All `lib/intelligence/*-quote.js` files use the helper; manual audit on
  2026-05-30 found no float-arithmetic violations on money fields
- **Gap:** there is no grep-style enforcement test that fails on raw float
  arithmetic in calculator code (the way [test/import-boundary.test.js](../../test/import-boundary.test.js)
  catches LLM violations). Pattern would be hard to write without false
  positives (legitimate float math on rates, percentages, weights). Logged
  as a Phase 1 follow-up in [docs/execution-plan.md](../execution-plan.md)
  if it becomes valuable

## Pros and cons of the options

### Integer cents + money helper (chosen)

- **Good, because:** simple, dependency-free, fast
- **Good, because:** boundary conversion makes intent explicit
- **Bad, because:** convention-only enforcement today

### JS floats throughout

- **Bad, because:** rounding errors compound + are non-deterministic across
  computation order
- **Bad, because:** "totals don't match line items" surface in customer-visible
  quotes

### Decimal library (`big.js` / `decimal.js`)

- **Good, because:** arbitrary precision is correct for any value
- **Bad, because:** adds an npm dependency (and a dependency on the dependency's
  maintenance trajectory); OrcaTrade keeps its runtime dep surface tiny
- **Bad, because:** API is heavier than integer cents; every operation
  allocates an object instead of a primitive

### BigInt throughout

- **Good, because:** native, no dependency
- **Bad, because:** awkward for rates (rates are < 1, BigInt can't represent
  them directly) — you'd still need fixed-point conversions, ending up at
  approximately the same place as integer cents but with a clunkier API

## Related decisions

- [0002 — LLM never produces decision-driving numbers](0002-llm-never-produces-decision-numbers.md) —
  this ADR is the arithmetic foundation that ADR 0002 relies on
- Phase 1 task P1.1 in [docs/execution-plan.md](../execution-plan.md) — TARIC
  duty pinning depends on the money helper for the snapshot

## More information

- [Why "integer cents" beats decimal libraries for money](https://martinfowler.com/eaaCatalog/money.html) —
  Fowler's classic Money pattern (the integer-minor-unit variant is what this
  ADR adopts)
- The "lib/intelligence/money.js" helper was introduced before this ADR
  (commit history pre-dates the 2026-05-30 audit); this ADR formalises the
  pre-existing rule
