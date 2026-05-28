'use strict';

// Supplier-quote → OrcaTrade-quote margin calculator (Sprint quote-rebrand-v1).
//
// The team drops in a supplier's quotation, an LLM extracts the raw line items
// (description / quantity / unit price), and THIS file turns those raw numbers
// into the customer-facing OrcaTrade quote. Per the calculator-grounded hard
// rule, the LLM never produces a number that reaches the customer: it only
// reads the supplier PDF. Every price on the generated quote is computed here,
// deterministically, in integer cents via money.js.
//
// Margin model (confirmed with the founder): a FIXED markup tier — 8 / 10 / 12%
// — applied to each unit price and FOLDED INTO the per-unit price. The customer
// sees only OrcaTrade's marked-up prices; the supplier subtotal and the margin
// amount are returned under `internal` for the audit trail, never rendered on
// the PDF.
//
// Currency note (v1): we preserve the supplier's currency and apply the margin
// in that same currency. No FX conversion — that would inject a sourced rate
// that materially changes the customer's number and belongs in the finance
// calculator, not here.

const money = require('./money');

// The only markup tiers the tool offers. A value outside this set is a
// validation error, not a silent clamp — the margin is a deliberate choice.
const ALLOWED_MARGINS = Object.freeze([8, 10, 12]);

// Currencies we know how to format with a symbol. Anything else still works —
// it just renders as the ISO code + amount (e.g. "AED 1,200.00").
const CURRENCY_SYMBOLS = Object.freeze({
  EUR: '€', USD: '$', GBP: '£', CNY: '¥', JPY: '¥', CHF: 'CHF ',
  PLN: 'zł', SEK: 'kr', NOK: 'kr', DKK: 'kr', HKD: 'HK$', SGD: 'S$',
});

function normaliseCurrency(currency) {
  const c = String(currency || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : 'EUR';
}

// Two-dp display with thousands separators, currency-aware. We format the
// integer-cents value ourselves rather than via toEuro→toLocaleString so the
// cents are exact (toLocaleString on a float can re-introduce drift).
function formatMoney(cents, currency) {
  const code = normaliseCurrency(currency);
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const groupedWhole = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sym = CURRENCY_SYMBOLS[code];
  const body = `${groupedWhole}.${frac}`;
  const rendered = sym ? `${sym}${body}` : `${code} ${body}`;
  return neg ? `-${rendered}` : rendered;
}

function parseQuantity(q) {
  const n = Number(q);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// Accepts a number or a human-typed string ("1,234.50", "€1 200,00" is NOT
// handled — we expect dot-decimal from the extractor / review form). Returns
// integer cents or null on garbage.
function parsePriceToCents(value) {
  if (value == null || value === '') return null;
  let n;
  if (typeof value === 'number') {
    n = value;
  } else {
    // Strip currency symbols / spaces / thousands commas; keep digits, dot, minus.
    const cleaned = String(value).replace(/[^0-9.\-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
    n = Number(cleaned);
  }
  if (!Number.isFinite(n) || n < 0) return null;
  return money.fromEuro(n); // currency-agnostic: "euro" here just means major units
}

// Pure margin calculation.
//
// input: {
//   currency: 'USD',
//   marginPct: 10,
//   lineItems: [{ description, quantity, unit?, unitPrice }]
// }
//
// Returns either { ok:false, errors:[...] } or a fully-priced quote where each
// line's unitPrice already includes the margin and line totals reconcile to the
// grand total to the cent.
function calculateRebrandedQuote(input) {
  const errors = [];
  const raw = input && typeof input === 'object' ? input : {};

  const marginPct = Number(raw.marginPct);
  if (!ALLOWED_MARGINS.includes(marginPct)) {
    errors.push(`marginPct must be one of ${ALLOWED_MARGINS.join(', ')} (got ${raw.marginPct})`);
  }

  const currency = normaliseCurrency(raw.currency);

  const items = Array.isArray(raw.lineItems) ? raw.lineItems : [];
  if (items.length === 0) {
    errors.push('At least one line item is required');
  }

  const parsedLines = [];
  items.forEach((item, i) => {
    const it = item && typeof item === 'object' ? item : {};
    const description = String(it.description || '').trim();
    const quantity = parseQuantity(it.quantity);
    const unitCents = parsePriceToCents(it.unitPrice);
    if (!description) errors.push(`Line ${i + 1}: description is required`);
    if (quantity == null) errors.push(`Line ${i + 1}: quantity must be a positive number`);
    if (unitCents == null) errors.push(`Line ${i + 1}: unit price must be a non-negative number`);
    if (description && quantity != null && unitCents != null) {
      parsedLines.push({
        description,
        quantity,
        unit: String(it.unit || '').trim() || null,
        supplierUnitCents: unitCents,
      });
    }
  });

  if (errors.length > 0) return { ok: false, errors };

  const rate = 1 + marginPct / 100;
  const lines = parsedLines.map((l) => {
    // Mark up the UNIT price first, round to the cent, THEN multiply by
    // quantity — so the per-unit price shown to the customer and the line
    // total always reconcile exactly (no "qty × shown price ≠ line total").
    const unitPriceCents = money.mulRate(l.supplierUnitCents, rate);
    const lineTotalCents = money.mulRate(unitPriceCents, l.quantity);
    const supplierLineTotalCents = money.mulRate(l.supplierUnitCents, l.quantity);
    return {
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPriceCents,
      unitPriceDisplay: formatMoney(unitPriceCents, currency),
      lineTotalCents,
      lineTotalDisplay: formatMoney(lineTotalCents, currency),
      // internal-only — never rendered on the customer PDF
      supplierUnitCents: l.supplierUnitCents,
      supplierLineTotalCents,
    };
  });

  const totalCents = money.sum(lines.map((l) => l.lineTotalCents));
  const supplierSubtotalCents = money.sum(lines.map((l) => l.supplierLineTotalCents));
  const marginAmountCents = money.sub(totalCents, supplierSubtotalCents);

  return {
    ok: true,
    currency,
    marginPct,
    lines: lines.map(({ supplierUnitCents, supplierLineTotalCents, ...customerFacing }) => customerFacing),
    totalCents,
    totalDisplay: formatMoney(totalCents, currency),
    // Audit-only view of what the markup actually was. The handler logs the
    // shape of this; it is NOT serialised onto the PDF.
    internal: {
      supplierSubtotalCents,
      supplierSubtotalDisplay: formatMoney(supplierSubtotalCents, currency),
      marginAmountCents,
      marginAmountDisplay: formatMoney(marginAmountCents, currency),
    },
  };
}

module.exports = {
  ALLOWED_MARGINS,
  calculateRebrandedQuote,
  formatMoney,
  // exported for the unit tests
  parsePriceToCents,
  normaliseCurrency,
};
