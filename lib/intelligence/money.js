// Integer-cents money primitives.
//
// Why: JS floats lose precision for monetary arithmetic at scale. A €4.5M
// customs value going through customs × duty × VAT compounding drifts a
// few cents per shipment, which is invisible at €25k but humiliating at
// €5M and forbidden at billion-EUR-company scale. EU customs practice
// expects half-even rounding ("banker's rounding") at the final
// declaration, which Math.round does NOT do (it rounds half toward
// positive infinity).
//
// Contract: everything internally is integer cents. Convert at the
// boundary via fromEuro / toEuro. Rates stay as floats (0.12 = 12%) and
// only intermediate "rate × cents" steps use mulRate, which rounds
// half-even back to cents.
//
// Safe integer range: cents fits in JS Number as long as amount ≤ 90
// trillion EUR. We're comfortable up to €10M per shipment (validateInput
// caps it) which is 9 orders of magnitude below the limit — overflow is
// not a concern for any realistic OrcaTrade workflow.

const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER - 1; // 9_007_199_254_740_990

function assertSafeCents(c, op) {
  if (!Number.isInteger(c)) {
    throw new TypeError(`money.${op}: expected integer cents, got ${c}`);
  }
  if (Math.abs(c) > MAX_SAFE_CENTS) {
    throw new RangeError(`money.${op}: cents value ${c} exceeds MAX_SAFE_CENTS`);
  }
  return c;
}

// ── Conversion ────────────────────────────────────────────────────────

function fromEuro(eur) {
  if (eur == null || eur === '') return 0;
  const n = Number(eur);
  if (!Number.isFinite(n)) {
    throw new TypeError(`money.fromEuro: not finite (${eur})`);
  }
  // Multiply by 100 then half-even round to integer.
  // (n * 100) can introduce float artefacts for values like 0.1 — go via
  // string when possible to avoid 0.1 * 100 === 10.000000000000002.
  // toFixed(2) gives a deterministic 2-dp string; then split + parse.
  const fixed = n.toFixed(2);
  const negative = fixed.startsWith('-');
  const body = negative ? fixed.slice(1) : fixed;
  const [whole, frac = '00'] = body.split('.');
  const cents = (parseInt(whole, 10) || 0) * 100 + (parseInt(frac.padEnd(2, '0').slice(0, 2), 10) || 0);
  return assertSafeCents(negative ? -cents : cents, 'fromEuro');
}

function toEuro(cents) {
  assertSafeCents(cents, 'toEuro');
  return cents / 100;
}

// ── Arithmetic ────────────────────────────────────────────────────────

function add(a, b) {
  return assertSafeCents(a + b, 'add');
}

function sub(a, b) {
  return assertSafeCents(a - b, 'sub');
}

function sum(arr) {
  let total = 0;
  for (const c of arr) total = add(total, c);
  return total;
}

// Multiply cents by a rate (float, e.g. 0.12 for 12%). Returns cents
// half-even rounded. This is the workhorse for duty/VAT lines.
function mulRate(cents, rate) {
  assertSafeCents(cents, 'mulRate');
  if (!Number.isFinite(rate)) {
    throw new TypeError(`money.mulRate: rate not finite (${rate})`);
  }
  return halfEvenRound(cents * rate);
}

// Multiply cents by an integer. Pure multiplication, no rounding needed
// when the multiplier is an integer (e.g. shipmentsPerYear scaling).
function mulInt(cents, n) {
  assertSafeCents(cents, 'mulInt');
  if (!Number.isInteger(n)) {
    throw new TypeError(`money.mulInt: multiplier must be integer, got ${n}`);
  }
  return assertSafeCents(cents * n, 'mulInt');
}

// Divide cents by an integer, half-even rounded.
function divInt(cents, n) {
  assertSafeCents(cents, 'divInt');
  if (!Number.isInteger(n) || n === 0) {
    throw new TypeError(`money.divInt: divisor must be nonzero integer, got ${n}`);
  }
  return halfEvenRound(cents / n);
}

// Percentage as percentage-points (e.g. pct(10000, 12.5) → 10000 * 0.125).
// Convenience over mulRate for human-readable code.
function pct(cents, percentPoints) {
  return mulRate(cents, percentPoints / 100);
}

// ── Rounding ──────────────────────────────────────────────────────────

// Half-even (banker's) rounding. For x.5, rounds to the nearest even
// integer. Differs from Math.round which always rounds half toward +∞:
//   Math.round(0.5) === 1,  halfEvenRound(0.5) === 0
//   Math.round(1.5) === 2,  halfEvenRound(1.5) === 2
//   Math.round(2.5) === 3,  halfEvenRound(2.5) === 2
//   Math.round(-0.5) === 0, halfEvenRound(-0.5) === 0
//   Math.round(-1.5) === -1, halfEvenRound(-1.5) === -2
//
// Float input is permitted (this is the boundary between rate-math and
// integer-cents) — output is always an integer.
function halfEvenRound(x) {
  if (!Number.isFinite(x)) {
    throw new TypeError(`money.halfEvenRound: not finite (${x})`);
  }
  if (Number.isInteger(x)) return x;
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  // Exactly half — pick the even side.
  return floor % 2 === 0 ? floor : floor + 1;
}

// Comparison primitive. Returns -1, 0, +1.
function cmp(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

module.exports = {
  MAX_SAFE_CENTS,
  fromEuro,
  toEuro,
  add,
  sub,
  sum,
  mulRate,
  mulInt,
  divInt,
  pct,
  halfEvenRound,
  cmp,
};
