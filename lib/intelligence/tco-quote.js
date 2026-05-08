// Annual Total Cost of Ownership for the Import Plan Builder.
//
// Per-shipment landed cost is engineering thinking. Procurement teams need
// the *annual* number, plus the working-capital cost of inventory tied up
// between port arrival and onward sale. This module takes a plan output
// from composePlan() and produces:
//
//   - Annual scaling of customs/freight/3PL across N shipments per year
//   - Working capital carrying cost (avg inventory × WACC × days/365)
//   - Sensitivity matrix at 6/12/24/52 shipments per year
//   - Optional comparison with the bonded-warehouse alternative when the
//     plan has bonded data populated
//
// LIMITS
// VAT is included for cash-flow (it sits on the importer's balance sheet
// until the next VAT return), but real net cost is duty + freight +
// brokerage + 3PL. We surface both views so the user can pick.

const DEFAULT_SHIPMENTS_PER_YEAR = 12;
const DEFAULT_WACC_PCT = 8.0;
const DEFAULT_DAYS_IN_INVENTORY = 60;
const SENSITIVITY_FREQUENCIES = [6, 12, 24, 52];

function validateInput({ shipmentsPerYear, waccPct, daysInInventory }) {
  const errors = [];
  const n = Number(shipmentsPerYear);
  if (n != null && (!Number.isFinite(n) || n < 1 || n > 365)) {
    errors.push('shipmentsPerYear must be 1–365');
  }
  const w = Number(waccPct);
  if (w != null && (!Number.isFinite(w) || w < 0 || w > 50)) {
    errors.push('waccPct must be 0–50');
  }
  const d = Number(daysInInventory);
  if (d != null && (!Number.isFinite(d) || d < 0 || d > 365)) {
    errors.push('daysInInventory must be 0–365');
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// Scale per-shipment line items × shipmentsPerYear, then add carrying cost.
// `perShipment` should be an object with: customsValueEur, dutyEur, vatEur,
// brokerageEur, transportEur (all numbers).
function scaleAnnual(perShipment, shipmentsPerYear, waccPct, daysInInventory) {
  const annualCustomsValue = perShipment.customsValueEur * shipmentsPerYear;
  const annualDuty = perShipment.dutyEur * shipmentsPerYear;
  const annualVat = perShipment.vatEur * shipmentsPerYear;
  const annualBrokerage = perShipment.brokerageEur * shipmentsPerYear;
  const annualTransport = perShipment.transportEur * shipmentsPerYear;

  // Average inventory value: annual customs value × (days_in_inventory / 365).
  // Working capital tied up sits at this level on average across the year.
  const avgInventoryValueEur = annualCustomsValue * (daysInInventory / 365);
  // Carrying cost: capital × cost-of-capital, but only the portion of time it
  // sits there. The (days/365) is already in avgInventoryValue, so just × WACC.
  const inventoryCarryingCostEur = avgInventoryValueEur * (waccPct / 100);

  // Net annual cost (excluding VAT cash-flow, which is recoverable):
  const annualNetCost = annualDuty + annualBrokerage + annualTransport + inventoryCarryingCostEur;
  // Cash-flow annual cost (including VAT, which sits on balance sheet):
  const annualCashFlowCost = annualNetCost + annualVat;

  return {
    annualCustomsValueEur: Math.round(annualCustomsValue),
    annualDutyEur: Math.round(annualDuty),
    annualVatEur: Math.round(annualVat),
    annualBrokerageEur: Math.round(annualBrokerage),
    annualTransportEur: Math.round(annualTransport),
    avgInventoryValueEur: Math.round(avgInventoryValueEur),
    inventoryCarryingCostEur: Math.round(inventoryCarryingCostEur),
    annualNetCost: Math.round(annualNetCost),
    annualCashFlowCost: Math.round(annualCashFlowCost),
  };
}

function calculateTco({
  perShipment,
  shipmentsPerYear = DEFAULT_SHIPMENTS_PER_YEAR,
  waccPct = DEFAULT_WACC_PCT,
  daysInInventory = DEFAULT_DAYS_IN_INVENTORY,
  warehouseAnnualEur = 0,
}) {
  const validation = validateInput({ shipmentsPerYear, waccPct, daysInInventory });
  if (!validation.ok) return { ok: false, errors: validation.errors };

  if (!perShipment || typeof perShipment !== 'object') {
    return { ok: false, errors: ['perShipment object required with customsValueEur/dutyEur/vatEur/brokerageEur/transportEur'] };
  }
  for (const k of ['customsValueEur', 'dutyEur', 'vatEur', 'brokerageEur', 'transportEur']) {
    if (!Number.isFinite(Number(perShipment[k]))) {
      return { ok: false, errors: [`perShipment.${k} must be a finite number`] };
    }
  }

  const main = scaleAnnual(perShipment, shipmentsPerYear, waccPct, daysInInventory);
  // Layer in 3PL if provided (already monthly, so × 12 for annual):
  const annualWarehouse = Math.round((warehouseAnnualEur || 0));
  main.annualWarehouseEur = annualWarehouse;
  main.annualNetCostWithWarehouse = main.annualNetCost + annualWarehouse;
  main.annualCashFlowCostWithWarehouse = main.annualCashFlowCost + annualWarehouse;

  // Sensitivity: same calculation at each frequency in SENSITIVITY_FREQUENCIES.
  const sensitivity = SENSITIVITY_FREQUENCIES.map(freq => {
    const scaled = scaleAnnual(perShipment, freq, waccPct, daysInInventory);
    return {
      shipmentsPerYear: freq,
      annualCustomsValueEur: scaled.annualCustomsValueEur,
      annualDutyEur: scaled.annualDutyEur,
      annualTransportEur: scaled.annualTransportEur,
      inventoryCarryingCostEur: scaled.inventoryCarryingCostEur,
      annualNetCost: scaled.annualNetCost + annualWarehouse,
      annualCashFlowCost: scaled.annualCashFlowCost + annualWarehouse,
    };
  });

  // Verdict: at high shipment frequencies the inventory carrying cost shrinks
  // (less inventory tied up at a time but more shipments total = same goods).
  // Actually, with our model the avg inventory is annualCustomsValue ×
  // (daysInInventory/365), which scales linearly with shipmentsPerYear.
  // So the carrying cost grows with frequency too — but this matches reality:
  // more frequent shipments means more goods flowing through the year, more
  // capital invested. The decision is value × frequency = annual throughput.
  // Surface the per-€-of-throughput cost as a procurement KPI.
  const costPerEurThroughput = main.annualCustomsValueEur > 0
    ? Math.round((main.annualNetCostWithWarehouse / main.annualCustomsValueEur) * 10000)
    : 0; // basis points (1bp = 0.01%)

  // Bonded break-even hint: if duty + VAT × WACC × (days_in_inventory/365)
  // exceeds bonded warehouse fees, bonded is cheaper. We don't compute exact
  // bonded fees here — that's the customs calculator's job — but flag the
  // savings opportunity if duty + VAT is large enough that deferring it is
  // worth €1k+/year.
  const annualDeferableTaxes = main.annualDutyEur + main.annualVatEur;
  const bondedDeferralValueEur = Math.round(annualDeferableTaxes * (waccPct / 100) * (daysInInventory / 365));
  const bondedWorthExploring = bondedDeferralValueEur >= 1000;

  return {
    ok: true,
    inputs: { shipmentsPerYear, waccPct, daysInInventory },
    main,
    sensitivity,
    costPerEurThroughputBp: costPerEurThroughput,  // basis points (1bp = 0.01%)
    bonded: {
      annualDeferableTaxesEur: annualDeferableTaxes,
      potentialDeferralValueEur: bondedDeferralValueEur,
      worthExploring: bondedWorthExploring,
    },
  };
}

module.exports = {
  calculateTco,
  scaleAnnual,
  validateInput,
  DEFAULT_SHIPMENTS_PER_YEAR,
  DEFAULT_WACC_PCT,
  DEFAULT_DAYS_IN_INVENTORY,
  SENSITIVITY_FREQUENCIES,
};
