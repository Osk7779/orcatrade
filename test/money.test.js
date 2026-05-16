// Tests for lib/intelligence/money.js — the integer-cents money primitives
// underlying Track 1 of the backend grade plan.
//
// Every assertion in this file is a guarantee BG-1 calculator migrations
// will rely on. If something here drifts, calculator outputs drift.

const test = require('node:test');
const assert = require('node:assert/strict');

const M = require('../lib/intelligence/money');

// ── Conversion ────────────────────────────────────────────────────────

test('fromEuro / toEuro round-trip for typical values', () => {
  for (const eur of [0, 1, 99.99, 100, 1234.56, 100000, 9999999.99]) {
    const cents = M.fromEuro(eur);
    assert.equal(M.toEuro(cents), eur, `${eur} round-trips through fromEuro/toEuro`);
  }
});

test('fromEuro handles strings, null, undefined, empty', () => {
  assert.equal(M.fromEuro(null), 0);
  assert.equal(M.fromEuro(undefined), 0);
  assert.equal(M.fromEuro(''), 0);
  assert.equal(M.fromEuro('123.45'), 12345);
  assert.equal(M.fromEuro('123'), 12300);
});

test('fromEuro avoids the 0.1 * 100 float trap', () => {
  // Naive multiplication: 0.1 * 100 === 10.000000000000002 → wrong cents.
  assert.equal(M.fromEuro(0.1), 10);
  assert.equal(M.fromEuro(0.2), 20);
  assert.equal(M.fromEuro(0.3), 30);
  assert.equal(M.fromEuro(0.7), 70);
  // The classic JS float disaster: 0.1 + 0.2 = 0.30000000000000004
  assert.equal(M.fromEuro(0.1 + 0.2), 30);
});

test('fromEuro handles negative values', () => {
  assert.equal(M.fromEuro(-99.99), -9999);
  assert.equal(M.fromEuro(-0.5), -50);
  assert.equal(M.toEuro(M.fromEuro(-1234.56)), -1234.56);
});

test('fromEuro rejects non-finite inputs', () => {
  assert.throws(() => M.fromEuro(NaN), /not finite/);
  assert.throws(() => M.fromEuro(Infinity), /not finite/);
  assert.throws(() => M.fromEuro(-Infinity), /not finite/);
});

// ── Arithmetic ────────────────────────────────────────────────────────

test('add and sub are exact at the cent level', () => {
  // The case where JS floats fail: 0.1 + 0.2 !== 0.3.
  const a = M.fromEuro(0.1);
  const b = M.fromEuro(0.2);
  assert.equal(M.add(a, b), 30);
  assert.equal(M.toEuro(M.add(a, b)), 0.3);
});

test('sum aggregates a list with no drift', () => {
  const inputs = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  const cents = inputs.map(M.fromEuro);
  const total = M.sum(cents);
  assert.equal(total, 450);
  assert.equal(M.toEuro(total), 4.5);
});

test('mulRate applies a percentage with half-even rounding', () => {
  // €1234.56 × 12% = €148.1472 → rounds to €148.15 (half is .47 → up).
  // 123456 cents × 0.12 = 14814.72 → half-even round → 14815
  const cents = M.fromEuro(1234.56);
  assert.equal(M.mulRate(cents, 0.12), 14815);
  assert.equal(M.toEuro(M.mulRate(cents, 0.12)), 148.15);
});

test('mulInt scales by integer count exactly', () => {
  const oneShipment = M.fromEuro(12500.99);
  assert.equal(M.mulInt(oneShipment, 12), 12 * 1250099);
  assert.equal(M.toEuro(M.mulInt(oneShipment, 12)), 150011.88);
});

test('divInt averages with half-even rounding', () => {
  // €10.00 / 3 = €3.333... → half-even rounds to 333 cents (€3.33)
  // 1000 / 3 = 333.333..., floor=333, diff=0.333 → return 333.
  assert.equal(M.divInt(1000, 3), 333);
  // €1.00 / 2 = €0.50 — exact
  assert.equal(M.divInt(100, 2), 50);
  // Edge: 5 / 2 = 2.5 (half) → even side is 2.
  assert.equal(M.divInt(5, 2), 2);
});

test('pct is sugar over mulRate / 100', () => {
  const cents = M.fromEuro(10000);
  // 12.5% of €10k = €1250
  assert.equal(M.pct(cents, 12.5), 125000);
  assert.equal(M.toEuro(M.pct(cents, 12.5)), 1250);
});

// ── Half-even rounding ───────────────────────────────────────────────

test('halfEvenRound vs Math.round: 0.5 rounds DOWN to 0 not UP to 1', () => {
  assert.equal(M.halfEvenRound(0.5), 0);
  assert.equal(Math.round(0.5), 1); // sanity check: JS's built-in differs
});

test('halfEvenRound: 1.5 rounds UP to 2 (nearest even)', () => {
  assert.equal(M.halfEvenRound(1.5), 2);
});

test('halfEvenRound: 2.5 rounds DOWN to 2 (nearest even)', () => {
  assert.equal(M.halfEvenRound(2.5), 2);
});

test('halfEvenRound symmetric for negatives', () => {
  assert.equal(M.halfEvenRound(-0.5), 0);
  assert.equal(M.halfEvenRound(-1.5), -2);
  assert.equal(M.halfEvenRound(-2.5), -2);
});

test('halfEvenRound passes non-half values through normally', () => {
  assert.equal(M.halfEvenRound(0.49), 0);
  assert.equal(M.halfEvenRound(0.51), 1);
  assert.equal(M.halfEvenRound(-0.49), 0);
  assert.equal(M.halfEvenRound(-0.51), -1);
  assert.equal(M.halfEvenRound(100), 100);
});

// ── Scale: realistic compounded calculations ─────────────────────────

test('typical customs compounding: customs + duty + VAT exact at €100k scale', () => {
  // €100,000.00 customs value, 12% duty, 19% German VAT.
  // Hand-computation: duty = 12000.00; VAT base = 112000.00; VAT = 21280.00; total landed = 133280.00.
  const customs = M.fromEuro(100000);
  const duty = M.mulRate(customs, 0.12);
  const vatBase = M.add(customs, duty);
  const vat = M.mulRate(vatBase, 0.19);
  const total = M.sum([customs, duty, vat]);
  assert.equal(M.toEuro(customs), 100000);
  assert.equal(M.toEuro(duty), 12000);
  assert.equal(M.toEuro(vatBase), 112000);
  assert.equal(M.toEuro(vat), 21280);
  assert.equal(M.toEuro(total), 133280);
});

test('customs compounding at €5M scale: zero drift', () => {
  // €5,000,000.00 customs value, 8.5% duty, 22% Italian VAT.
  // Hand-computation: duty = 425000.00; VAT base = 5425000.00; VAT = 1193500.00; total = 6618500.00.
  const customs = M.fromEuro(5000000);
  const duty = M.mulRate(customs, 0.085);
  const vatBase = M.add(customs, duty);
  const vat = M.mulRate(vatBase, 0.22);
  const total = M.sum([customs, duty, vat]);
  assert.equal(M.toEuro(duty), 425000);
  assert.equal(M.toEuro(vatBase), 5425000);
  assert.equal(M.toEuro(vat), 1193500);
  assert.equal(M.toEuro(total), 6618500);
});

test('odd VAT (Finland 25.5%) on an irregular base produces exact cents', () => {
  // €4,567.89 customs, 6.5% duty = €296.91 (with rounding); base = €4864.80; VAT 25.5% = €1240.524 → 1240.52.
  // 456789 × 0.065 = 29691.285 → half-even → 29691 (because .285 not half)
  // base = 456789 + 29691 = 486480
  // 486480 × 0.255 = 124052.4 → half-even → 124052
  const customs = M.fromEuro(4567.89);
  const duty = M.mulRate(customs, 0.065);
  assert.equal(duty, 29691);
  const vatBase = M.add(customs, duty);
  assert.equal(vatBase, 486480);
  const vat = M.mulRate(vatBase, 0.255);
  assert.equal(vat, 124052);
  assert.equal(M.toEuro(vat), 1240.52);
});

// ── Safety rails ──────────────────────────────────────────────────────

test('arithmetic throws on non-integer inputs', () => {
  assert.throws(() => M.add(1.5, 1), /integer cents/);
  assert.throws(() => M.sub(100, 1.5), /integer cents/);
  assert.throws(() => M.mulRate(1.5, 0.12), /integer cents/);
});

test('mulInt rejects non-integer multipliers', () => {
  assert.throws(() => M.mulInt(100, 1.5), /must be integer/);
});

test('divInt rejects zero divisor', () => {
  assert.throws(() => M.divInt(100, 0), /nonzero integer/);
});

test('mulRate rejects non-finite rates', () => {
  assert.throws(() => M.mulRate(100, NaN), /not finite/);
  assert.throws(() => M.mulRate(100, Infinity), /not finite/);
});

test('cmp returns -1 / 0 / +1', () => {
  assert.equal(M.cmp(1, 2), -1);
  assert.equal(M.cmp(2, 2), 0);
  assert.equal(M.cmp(3, 2), 1);
});

test('MAX_SAFE_CENTS exposes ceiling for sanity', () => {
  assert.ok(M.MAX_SAFE_CENTS > 1e15);
  // 10M EUR = 1B cents which is ~10^9, comfortably below the safe ceiling.
  assert.ok(M.fromEuro(10_000_000) < M.MAX_SAFE_CENTS);
});
