// Sprint quote-rebrand-v1 — supplier-quote → OrcaTrade-quote margin calculator
// and the branded PDF renderer.
//
// The calculator is the calculator-grounded heart of Quote Studio: it is the
// ONLY place a customer-facing price is produced. If its margin math or its
// line-to-total reconciliation drifts, we send a wrong quote to a customer.
// Asserted here:
//   1. Margin tiers — only 8/10/12 accepted; the rest is a validation error.
//   2. Integer-cents margin math — marked-up unit price × qty reconciles to the
//      grand total to the cent; the supplier subtotal / margin amount are
//      computed for the audit trail and never leak onto the customer view.
//   3. Currency + price parsing — symbols/separators stripped, garbage rejected.
//   4. PDF renderer smoke — produces real %PDF bytes for a multi-line quote.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateRebrandedQuote,
  formatMoney,
  parsePriceToCents,
  normaliseCurrency,
  ALLOWED_MARGINS,
} = require('../lib/intelligence/rebrand-quote');
const { buildQuotePdf } = require('../lib/intelligence/quote-pdf');

test('only 8/10/12 are valid margin tiers', () => {
  assert.deepEqual(ALLOWED_MARGINS, [8, 10, 12]);
  for (const bad of [0, 5, 9, 15, 100, '10pct', null, undefined]) {
    const r = calculateRebrandedQuote({ currency: 'USD', marginPct: bad, lineItems: [{ description: 'x', quantity: 1, unitPrice: 10 }] });
    assert.equal(r.ok, false, `margin ${bad} should be rejected`);
    assert.ok(r.errors.some((e) => /marginPct/.test(e)));
  }
  for (const good of [8, 10, 12]) {
    const r = calculateRebrandedQuote({ currency: 'USD', marginPct: good, lineItems: [{ description: 'x', quantity: 1, unitPrice: 10 }] });
    assert.equal(r.ok, true, `margin ${good} should be accepted`);
  }
});

test('10% margin folds into the unit price and reconciles to the total', () => {
  const r = calculateRebrandedQuote({
    currency: 'USD',
    marginPct: 10,
    lineItems: [
      { description: 'Widget A', quantity: 100, unit: 'pcs', unitPrice: 2.5 },
      { description: 'Widget B', quantity: 10, unitPrice: 12.34 },
    ],
  });
  assert.equal(r.ok, true);

  // 2.50 + 10% = 2.75 → ×100 = 275.00
  assert.equal(r.lines[0].unitPriceCents, 275);
  assert.equal(r.lines[0].lineTotalCents, 27500);
  // 12.34 + 10% = 13.574 → half-even → 13.57 → ×10 = 135.70
  assert.equal(r.lines[1].unitPriceCents, 1357);
  assert.equal(r.lines[1].lineTotalCents, 13570);

  // Grand total reconciles to the sum of the line totals, exactly.
  assert.equal(r.totalCents, 27500 + 13570);
  assert.equal(r.totalCents, r.lines.reduce((a, l) => a + l.lineTotalCents, 0));

  // Supplier subtotal: 250.00 + 123.40 = 373.40; margin = total - supplier.
  assert.equal(r.internal.supplierSubtotalCents, 25000 + 12340);
  assert.equal(r.internal.marginAmountCents, r.totalCents - r.internal.supplierSubtotalCents);
});

test('customer-facing lines never expose supplier cost or margin', () => {
  const r = calculateRebrandedQuote({ currency: 'EUR', marginPct: 12, lineItems: [{ description: 'x', quantity: 1, unitPrice: 100 }] });
  assert.equal(r.ok, true);
  const keys = Object.keys(r.lines[0]);
  assert.ok(!keys.includes('supplierUnitCents'), 'supplier cost must not be on the customer line');
  assert.ok(!keys.includes('supplierLineTotalCents'));
  // The supplier figures live only under `internal`.
  assert.ok(r.internal.supplierSubtotalCents > 0);
});

test('fractional quantities are priced via half-even rounding', () => {
  // 3.333 kg of something at 9.99 +8% = 10.7892 → 10.79/unit, ×3.333 = 35.96 (half-even)
  const r = calculateRebrandedQuote({ currency: 'GBP', marginPct: 8, lineItems: [{ description: 'Resin', quantity: 3.333, unit: 'kg', unitPrice: 9.99 }] });
  assert.equal(r.ok, true);
  assert.equal(r.lines[0].unitPriceCents, 1079);
  // 1079 * 3.333 = 3596.307 → 3596
  assert.equal(r.lines[0].lineTotalCents, 3596);
  assert.equal(r.totalCents, 3596);
});

test('validation collects per-line errors', () => {
  const r = calculateRebrandedQuote({
    currency: 'USD', marginPct: 10,
    lineItems: [
      { description: '', quantity: 1, unitPrice: 10 },
      { description: 'ok', quantity: -2, unitPrice: 10 },
      { description: 'ok2', quantity: 1, unitPrice: 'abc' },
    ],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /Line 1: description/.test(e)));
  assert.ok(r.errors.some((e) => /Line 2: quantity/.test(e)));
  assert.ok(r.errors.some((e) => /Line 3: unit price/.test(e)));
});

test('empty line items is a validation error', () => {
  const r = calculateRebrandedQuote({ currency: 'USD', marginPct: 10, lineItems: [] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /At least one line item/.test(e)));
});

test('price parsing strips symbols and separators, rejects garbage', () => {
  assert.equal(parsePriceToCents('1,234.50'), 123450);
  assert.equal(parsePriceToCents('$2.5'), 250);
  assert.equal(parsePriceToCents(2.5), 250);
  assert.equal(parsePriceToCents('0'), 0);
  assert.equal(parsePriceToCents(''), null);
  assert.equal(parsePriceToCents('abc'), null);
  assert.equal(parsePriceToCents(-5), null);
});

test('currency normalisation + formatting', () => {
  assert.equal(normaliseCurrency('usd'), 'USD');
  assert.equal(normaliseCurrency('nonsense'), 'EUR');
  assert.equal(formatMoney(123450, 'USD'), '$1,234.50');
  assert.equal(formatMoney(123450, 'EUR'), '€1,234.50');
  assert.equal(formatMoney(100, 'AED'), 'AED 1.00'); // unknown symbol → ISO code prefix
});

test('PDF renderer emits real PDF bytes', async () => {
  const quote = calculateRebrandedQuote({
    currency: 'USD', marginPct: 10,
    lineItems: Array.from({ length: 40 }, (_, i) => ({ description: `Component ${i + 1} — a deliberately long description to force word wrapping across the column width`, quantity: i + 1, unit: 'pcs', unitPrice: 9.99 })),
  });
  assert.equal(quote.ok, true);
  const bytes = await buildQuotePdf({
    quote,
    meta: { quoteNumber: 'OT-2026-0001', customerName: 'Acme GmbH', customerAddress: 'Hauptstrasse 1\n10115 Berlin\nGermany', validUntil: '2026-06-30', notes: 'Lead time 30 days. 30% deposit.' },
  });
  assert.ok(bytes && bytes.length > 1000, 'PDF should be non-trivial in size');
  const header = Buffer.from(bytes.slice(0, 5)).toString('latin1');
  assert.equal(header, '%PDF-', 'output must start with the PDF magic header');
});
