// Working capital cycle calculator for the Import Plan Builder.
//
// Procurement teams need to know not just *what* a year of imports costs
// but *how much cash is tied up* at any given moment — the working capital
// trapped in the cash-conversion cycle (CCC) between paying the supplier
// and getting paid by the end customer.
//
// Cash Conversion Cycle (CCC) = DIO + DSO − DPO
//   DIO — Days Inventory Outstanding: how long goods sit in inventory before sale
//   DSO — Days Sales Outstanding: how long after sale until payment is collected
//   DPO — Days Payable Outstanding: how long we delay paying the supplier
//
// Positive CCC = cash trapped in the cycle (typical for importers).
// Negative CCC = the importer is funded by their supplier (rare, only B2C
// with prepayment and very long supplier terms).
//
// Working capital tied up = (annual COGS / 365) × CCC
// Annual cost of working capital = working capital × WACC
//
// LIMITS
// - COGS is approximated as annual customs value (CIF). Real COGS includes
//   manufacturing margin and other landed costs; we surface a more
//   conservative estimate using the annual *net* cost from TCO if available.
// - Negative CCC is allowed and surfaced as a financing benefit.
// - Working capital cost is in addition to inventory carrying cost from TCO
//   for the *full* CCC duration (not just inventory days).

const DEFAULT_DAYS_RECEIVABLE = 0;          // B2C ecommerce default (paid at checkout)
const DEFAULT_DAYS_PAYABLE = 60;            // typical Asia-supplier 60-day terms
const DEFAULT_DAYS_INVENTORY = 60;
const DEFAULT_WACC_PCT = 8.0;

function validateInput({ annualThroughputEur, daysInventory, daysReceivable, daysPayable, waccPct }) {
  const errors = [];
  const t = Number(annualThroughputEur);
  if (!Number.isFinite(t) || t <= 0) errors.push('annualThroughputEur must be > 0');
  for (const [name, v] of [['daysInventory', daysInventory], ['daysReceivable', daysReceivable], ['daysPayable', daysPayable]]) {
    if (v != null && (!Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 365)) {
      errors.push(`${name} must be 0–365`);
    }
  }
  if (waccPct != null && (!Number.isFinite(Number(waccPct)) || Number(waccPct) < 0 || Number(waccPct) > 50)) {
    errors.push('waccPct must be 0–50');
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

function calculateWorkingCapital({
  annualThroughputEur,
  daysInventory = DEFAULT_DAYS_INVENTORY,
  daysReceivable = DEFAULT_DAYS_RECEIVABLE,
  daysPayable = DEFAULT_DAYS_PAYABLE,
  waccPct = DEFAULT_WACC_PCT,
}) {
  const validation = validateInput({ annualThroughputEur, daysInventory, daysReceivable, daysPayable, waccPct });
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const dio = Number(daysInventory);
  const dso = Number(daysReceivable);
  const dpo = Number(daysPayable);
  const ccc = dio + dso - dpo;
  const dailyCogs = Number(annualThroughputEur) / 365;
  const workingCapitalEur = dailyCogs * ccc;
  const annualCapitalCostEur = Math.round(Math.abs(workingCapitalEur) * (Number(waccPct) / 100)) * Math.sign(workingCapitalEur);

  // Verdict
  let verdict;
  if (ccc < 0) {
    verdict = 'supplier_funded';
  } else if (ccc <= 30) {
    verdict = 'tight';
  } else if (ccc <= 90) {
    verdict = 'standard';
  } else if (ccc <= 150) {
    verdict = 'capital_intensive';
  } else {
    verdict = 'severe';
  }

  // Levers — show how each day saved/added moves the working capital
  // (linear: 1 day ≈ dailyCogs euros).
  const dayValueEur = Math.round(dailyCogs);

  // Sensitivity: what happens if the user can negotiate payable terms
  // up by 30 days, or push DSO down by 15 days, or compress DIO by 20 days?
  const levers = [
    {
      key: 'dpo+30',
      label: 'Negotiate +30 days payable terms with supplier',
      cccDelta: -30,
      workingCapitalDelta: -30 * dailyCogs,
      annualCostDelta: -Math.round(30 * dailyCogs * (waccPct / 100)),
    },
    {
      key: 'dio-20',
      label: 'Compress inventory by 20 days (faster turn)',
      cccDelta: -20,
      workingCapitalDelta: -20 * dailyCogs,
      annualCostDelta: -Math.round(20 * dailyCogs * (waccPct / 100)),
    },
    {
      key: 'dso-15',
      label: 'Pull receivables in 15 days (early-pay discount, factoring)',
      cccDelta: -15,
      workingCapitalDelta: -15 * dailyCogs,
      annualCostDelta: -Math.round(15 * dailyCogs * (waccPct / 100)),
    },
  ];

  return {
    ok: true,
    inputs: { annualThroughputEur: Number(annualThroughputEur), daysInventory: dio, daysReceivable: dso, daysPayable: dpo, waccPct: Number(waccPct) },
    dio,
    dso,
    dpo,
    ccc,
    dailyCogsEur: Math.round(dailyCogs),
    workingCapitalEur: Math.round(workingCapitalEur),
    annualCapitalCostEur,
    verdict,
    dayValueEur,
    levers,
  };
}

module.exports = {
  calculateWorkingCapital,
  validateInput,
  DEFAULT_DAYS_RECEIVABLE,
  DEFAULT_DAYS_PAYABLE,
  DEFAULT_DAYS_INVENTORY,
  DEFAULT_WACC_PCT,
};
