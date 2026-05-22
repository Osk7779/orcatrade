// Trade-finance calculator: payment instruments, LC pricing, FX hedging, working capital cycle.
//
// The numeric tables here are SME-trade benchmarks gathered from Polish + DACH banking
// partner rate cards (2026 Q1) and Anthropic-style trade-finance reference material.
// Not a binding quote — the Finance Agent always offers human-review escalation above
// €100k or before any commercial commitment.
//
// Money: cost lines are computed in integer cents (lib/intelligence/money.js,
// half-even rounding, no float drift) — this matters here because amounts run
// up to €50M, where float compounding and Math.round's half-up bias would both
// show. Displayed at whole-euro granularity; multi-line totals sum their lines.

const M = require('./money');

const PRICING_SNAPSHOT = {
  asOf: '2026-05-07',
  source: 'OrcaTrade trade-finance benchmark — composite of Polish (Pekao, Santander PL, mBank Korporacyjny) and DACH (Deutsche Bank, Commerzbank, UniCredit) SME rate cards (2026 Q1), supplemented by typical Hong Kong export-finance terms. Refresh quarterly.',
  confidence: 'snapshot',
  notes: 'LC fees are quarterly on outstanding amount; FX forward premium is annual-rate-differential plus a credit-spread + volatility margin. Single-day rates would require a live FX feed (not yet wired).',
};

// ── Payment instruments ────────────────────────────────────
// costPercent is the importer's all-in cost as a fraction of trade amount (banking + handling).
// daysToCollection is the typical interval between contract sign and supplier receiving funds.
// importerRisk = chance importer pays for goods that don't arrive or arrive defective.
// supplierRisk = chance supplier ships and doesn't get paid.
const PAYMENT_INSTRUMENTS = {
  tt_advance: {
    key: 'tt_advance',
    label: 'TT 100% advance',
    family: 'wire transfer',
    costPercent: 0.0008,                 // wire fees only
    fixedFeeEur: 60,
    daysToSupplierFunds: 0,
    daysToCollection: 0,
    importerRisk: 'high',
    supplierRisk: 'lowest',
    description: '100% paid by TT before production — supplier sees zero risk; importer carries full performance risk.',
    bestFor: 'Trusted suppliers (5+ POs of clean delivery), small orders below €5k.',
    cautions: ['No bank intermediation — you have no recourse if goods are non-conforming.', 'Anti-fraud: verify supplier bank account separately from supplier email.'],
  },
  tt_split_30_70: {
    key: 'tt_split_30_70',
    label: 'TT 30% advance / 70% before shipment',
    family: 'wire transfer',
    costPercent: 0.0012,
    fixedFeeEur: 90,
    daysToSupplierFunds: 30,
    daysToCollection: 35,
    importerRisk: 'medium',
    supplierRisk: 'low',
    description: 'Industry-standard split — supplier funds tooling/materials with 30%, balance after pre-shipment inspection.',
    bestFor: 'Repeat suppliers with at least 2 prior clean deliveries; orders €5k–€50k.',
    cautions: ['Always insist on third-party pre-shipment inspection (AQL) BEFORE the 70% balance.', 'Do not release the 70% on a forwarded BL copy — only the original or telex release.'],
  },
  documentary_collection_dp: {
    key: 'documentary_collection_dp',
    label: 'Documentary Collection (D/P)',
    family: 'banking intermediation',
    costPercent: 0.0025,
    fixedFeeEur: 220,
    daysToSupplierFunds: 30,
    daysToCollection: 45,
    importerRisk: 'medium',
    supplierRisk: 'medium',
    description: 'Bank handles documents-against-payment release. Cheaper than LC but no payment guarantee.',
    bestFor: 'Established trade lanes where supplier-importer trust is medium and amounts are €25k–€150k.',
    cautions: ['Importer can refuse documents if market shifts — supplier carries inventory risk.', 'Slower release if documents have discrepancies; bank charges per discrepancy.'],
  },
  letter_of_credit_unconfirmed: {
    key: 'letter_of_credit_unconfirmed',
    label: 'LC unconfirmed',
    family: 'banking guarantee',
    costPercent: 0.0035,
    fixedFeeEur: 320,
    daysToSupplierFunds: 60,
    daysToCollection: 60,
    importerRisk: 'low',
    supplierRisk: 'low',
    description: 'Issuing bank (importer-side) guarantees payment on document compliance. Standard for €25k+ first-time deals.',
    bestFor: 'New supplier relationships, orders above €25k, when supplier needs bank-guaranteed payment.',
    cautions: ['Supplier accepts risk on importer\'s issuing bank — for emerging-market issuing banks, supplier may demand confirmation.', 'Discrepancy management: ~15-25% of LCs have at least one discrepancy. Doc-team discipline matters.'],
  },
  letter_of_credit_confirmed: {
    key: 'letter_of_credit_confirmed',
    label: 'LC confirmed (export bank guarantee)',
    family: 'banking guarantee',
    costPercent: 0.0055,
    fixedFeeEur: 420,
    daysToSupplierFunds: 60,
    daysToCollection: 60,
    importerRisk: 'low',
    supplierRisk: 'lowest',
    description: 'Confirmed by a bank in supplier\'s country — supplier collects from a local bank regardless of issuing bank performance.',
    bestFor: 'Supplier requires confirmation, importer\'s issuing bank is in a country supplier views as risky, or supplier has factoring needs.',
    cautions: ['~+0.20% premium vs unconfirmed; usually borne by the importer per UCP 600 default.', 'Both banks must issue compliant documents; double the discrepancy surface.'],
  },
  open_account_60: {
    key: 'open_account_60',
    label: 'Open Account 60 days',
    family: 'open trade',
    costPercent: 0.0008,
    fixedFeeEur: 30,
    daysToSupplierFunds: 60,
    daysToCollection: 60,
    importerRisk: 'lowest',
    supplierRisk: 'high',
    description: 'No bank intermediation. Goods ship on supplier credit terms. Supplier needs trade-credit insurance to make this work at scale.',
    bestFor: 'Long-running supplier-importer relationships (3+ years, multiple POs/year), or when supplier insures via Atradius/Coface.',
    cautions: ['Supplier carries 100% credit risk — pricing usually reflects this.', 'Available almost only after extended trust history.'],
  },
};

const INSTRUMENT_KEYS = Object.keys(PAYMENT_INSTRUMENTS);

// ── LC cost components ─────────────────────────────────────
const LC_COST_TABLE = {
  issuanceQuarterPercent: 0.0015,       // 0.15% per quarter on amount (typical PL/DE bank rate)
  confirmationQuarterPercent: 0.0010,   // +0.10% per quarter
  documentHandlingEur: 220,             // per LC, importer side
  amendmentEur: 80,                     // per amendment
  discrepancyEur: 110,                  // per discrepancy if rejected
  wireFeesEur: 60,                      // outgoing wires
  swiftMessagesEur: 25,                 // SWIFT charges
};

// ── FX volatility / forward-premium table ─────────────────
// annualisedVolatilityPercent: rough EWMA on EOD spot 2024-2026 (illustrative).
// annualForwardPremiumPercent: CIP-implied premium importer pays for forward EUR-vs-currency cover.
//   Negative numbers mean importer GAINS from buying forward (interest-rate differential).
const FX_TABLE = {
  EUR_USD: { pair: 'EUR/USD', name: 'Euro vs US Dollar', annualisedVolatilityPercent: 7,  annualForwardPremiumPercent: 1.2,  liquidity: 'highest' },
  EUR_CNY: { pair: 'EUR/CNY', name: 'Euro vs Chinese Yuan', annualisedVolatilityPercent: 5,  annualForwardPremiumPercent: 0.8,  liquidity: 'medium', notes: ['China has capital controls; offshore (CNH) and onshore (CNY) rates can diverge.'] },
  EUR_INR: { pair: 'EUR/INR', name: 'Euro vs Indian Rupee', annualisedVolatilityPercent: 9,  annualForwardPremiumPercent: 3.4,  liquidity: 'medium', notes: ['INR has implicit-band management; sharp moves are possible during BoP stress.'] },
  EUR_VND: { pair: 'EUR/VND', name: 'Euro vs Vietnamese Dong', annualisedVolatilityPercent: 6,  annualForwardPremiumPercent: 4.1,  liquidity: 'low',    notes: ['Managed peg vs USD; structural devaluation drift of ~2% per year.'] },
  EUR_BDT: { pair: 'EUR/BDT', name: 'Euro vs Bangladeshi Taka', annualisedVolatilityPercent: 11, annualForwardPremiumPercent: 6.0,  liquidity: 'low',    notes: ['Tightly managed; periodic devaluation steps. Forward market thin.'] },
  EUR_TRY: { pair: 'EUR/TRY', name: 'Euro vs Turkish Lira', annualisedVolatilityPercent: 24, annualForwardPremiumPercent: 18.5, liquidity: 'medium', notes: ['Crisis-prone; forward premium reflects local interest rates plus credit spread.'] },
  EUR_GBP: { pair: 'EUR/GBP', name: 'Euro vs British Pound', annualisedVolatilityPercent: 6,  annualForwardPremiumPercent: 0.6,  liquidity: 'highest' },
};

// ── Working capital reference benchmarks ────────────────────
const WORKING_CAPITAL_BENCHMARKS = {
  // Typical cash-conversion-cycle building blocks for SME importers, in days.
  benchmarkDio: { fast_b2c: 35, mid_b2c: 60, b2b: 90, slow_seasonal: 150 },
  benchmarkDso: { dtc_card: 0, b2c_marketplace: 14, b2b_invoice_30: 30, b2b_invoice_60: 60, b2b_invoice_90: 90, retail_chain: 75 },
  benchmarkDpo: { tt_advance: -30, tt_split_30_70: -20, dp_dc: 5, lc: 30, oa_60: 60, oa_90: 90 },
  costOfCapitalAnnual: 0.06,             // typical SME working-capital cost
};

// ── Trade-credit cover (links to insurance baseline) ────────
const TRADE_CREDIT_COVER = {
  baseRatePercent: 0.0028,               // 0.28% of insured exposure / year
  countryLoadings: { CN: 1.2, VN: 1.3, IN: 1.4, BD: 1.7, TR: 1.8, US: 1.0, DE: 1.0, FR: 1.0, GB: 1.05, PL: 1.0 },
  buyerSizeFactors: { tier1: 0.7, mid: 1.0, sme: 1.6, unknown: 2.4 },
  minPremiumEur: 350,
};

// ── Public helpers ─────────────────────────────────────────

function listInstruments() {
  return Object.values(PAYMENT_INSTRUMENTS).map(i => ({
    key: i.key, label: i.label, family: i.family,
    importerRisk: i.importerRisk, supplierRisk: i.supplierRisk,
    description: i.description,
  }));
}

function listFxPairs() {
  return Object.entries(FX_TABLE).map(([key, v]) => ({
    key, pair: v.pair, name: v.name, annualisedVolatilityPercent: v.annualisedVolatilityPercent, liquidity: v.liquidity,
  }));
}

// ── Validation ─────────────────────────────────────────────

function validateInput(input, requiredFields) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    errors.push('input must be an object');
    return { ok: false, errors };
  }
  for (const f of requiredFields || []) {
    if (input[f] == null) errors.push(`${f} required`);
  }
  if (input.amountEur != null) {
    const v = Number(input.amountEur);
    if (!Number.isFinite(v) || v <= 0) errors.push('amountEur must be > 0');
    if (v > 50_000_000) errors.push('amountEur exceeds €50M (please contact us for very large transactions)');
  }
  if (input.durationMonths != null) {
    const v = Number(input.durationMonths);
    if (!Number.isFinite(v) || v <= 0 || v > 36) errors.push('durationMonths must be between 0 and 36');
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// ── Compare payment instruments ────────────────────────────

function comparePaymentInstruments({ amountEur, supplierCountry, supplierRelationshipMonths, importerRiskAppetite }) {
  const v = validateInput({ amountEur }, ['amountEur']);
  if (!v.ok) return { ok: false, errors: v.errors };

  const relMonths = Number(supplierRelationshipMonths) || 0;
  const appetite = importerRiskAppetite === 'low' ? 'low' : importerRiskAppetite === 'high' ? 'high' : 'balanced';

  const instruments = INSTRUMENT_KEYS.map(key => {
    const inst = PAYMENT_INSTRUMENTS[key];
    const totalCostCents = M.add(M.mulRate(M.fromEuro(amountEur), inst.costPercent), M.fromEuro(inst.fixedFeeEur));
    const totalCostEur = Math.round(M.toEuro(totalCostCents));
    return {
      key,
      label: inst.label,
      family: inst.family,
      totalCostEur,
      costPercentOfAmount: round((totalCostEur / amountEur) * 100, 3),
      daysToSupplierFunds: inst.daysToSupplierFunds,
      daysToCollection: inst.daysToCollection,
      importerRisk: inst.importerRisk,
      supplierRisk: inst.supplierRisk,
      description: inst.description,
      bestFor: inst.bestFor,
      cautions: inst.cautions,
    };
  });

  const recommendation = recommendInstrument({ instruments, amountEur, relMonths, appetite });

  return {
    ok: true,
    asOf: PRICING_SNAPSHOT.asOf,
    inputs: { amountEur, supplierCountry: supplierCountry || null, supplierRelationshipMonths: relMonths, importerRiskAppetite: appetite },
    instruments,
    recommendation,
    paymentEducation: {
      thresholdGuidance: 'Below €5k with a trusted supplier, TT advance is fine. €5k–€50k → TT split. €25k–€150k → D/P or unconfirmed LC. Above €150k or first-time relationships → confirmed LC. Open account requires real trust history (2+ years, 5+ clean POs).',
      lcDiscipline: 'Letters of credit fail when documents have errors — about 1 in 5 LCs first-pass-rejects on a discrepancy. Allocate doc-team time accordingly. Any UCP 600-savvy customs broker can run an LC doc check before submission.',
      fxOverlay: 'Long payment cycles (LC at 60+ days, OA at 90 days) bake in FX risk. Consider a forward contract for amounts above €50k EUR-equivalent.',
    },
    pricingSnapshot: PRICING_SNAPSHOT,
  };
}

function recommendInstrument({ instruments, amountEur, relMonths, appetite }) {
  // Heuristic: pick by amount × relationship × appetite
  let preferredKey;
  let reason;

  // Relationship maturity wins first — 36+ months of clean trade unlocks open account
  // regardless of amount tier (within reason).
  if (relMonths >= 36 && amountEur < 250000) {
    preferredKey = 'open_account_60';
    reason = `${relMonths} months of supplier history: open account 60 days is achievable; supplier may need trade-credit insurance to extend it.`;
  } else if (amountEur < 5000 && relMonths >= 12) {
    preferredKey = 'tt_advance';
    reason = `Below €5,000 with ${relMonths} months of supplier history: TT advance is fastest and cheapest.`;
  } else if (amountEur < 50000 && relMonths >= 6) {
    preferredKey = 'tt_split_30_70';
    reason = `€${formatThousands(amountEur)} with ${relMonths} months of supplier history: TT 30/70 is the SME default.`;
  } else if (amountEur >= 150000 && relMonths < 24) {
    preferredKey = 'letter_of_credit_confirmed';
    reason = `€${formatThousands(amountEur)} above €150k with under 24 months supplier history: confirmed LC removes both sides\' counterparty risk.`;
  } else if (amountEur < 150000 && appetite !== 'low') {
    preferredKey = 'documentary_collection_dp';
    reason = `€${formatThousands(amountEur)} mid-tier amount with balanced/high risk appetite: D/P balances cost (~0.25%) and bank intermediation.`;
  } else {
    preferredKey = 'letter_of_credit_unconfirmed';
    reason = 'Default for new relationships above €25k where supplier accepts importer\'s issuing bank.';
  }

  const instrument = instruments.find(i => i.key === preferredKey);
  return { preferredKey, instrument, reason };
}

// ── Estimate LC cost ───────────────────────────────────────

function estimateLcCost({ amountEur, durationMonths, confirmed, expectedDiscrepancies }) {
  const v = validateInput({ amountEur, durationMonths }, ['amountEur', 'durationMonths']);
  if (!v.ok) return { ok: false, errors: v.errors };

  const months = Math.max(1, Number(durationMonths));
  const quarters = Math.max(1, Math.ceil(months / 3));
  const amountCents = M.fromEuro(amountEur);
  const issuanceFee = Math.round(M.toEuro(M.mulRate(amountCents, LC_COST_TABLE.issuanceQuarterPercent * quarters)));
  const confirmationFee = confirmed ? Math.round(M.toEuro(M.mulRate(amountCents, LC_COST_TABLE.confirmationQuarterPercent * quarters))) : 0;
  const documentFee = LC_COST_TABLE.documentHandlingEur;
  const wireFees = LC_COST_TABLE.wireFeesEur;
  const swiftFees = LC_COST_TABLE.swiftMessagesEur;
  const discrepancyCharges = (expectedDiscrepancies || 0) * LC_COST_TABLE.discrepancyEur;

  // Total is the sum of the displayed whole-euro lines, so the breakdown reconciles.
  const totalEur = issuanceFee + confirmationFee + documentFee + wireFees + swiftFees + discrepancyCharges;
  const allInPercent = round((totalEur / amountEur) * 100, 3);

  return {
    ok: true,
    asOf: PRICING_SNAPSHOT.asOf,
    inputs: { amountEur, durationMonths: months, confirmed: !!confirmed, expectedDiscrepancies: Number(expectedDiscrepancies) || 0 },
    breakdown: [
      { label: `Issuance fee (${(LC_COST_TABLE.issuanceQuarterPercent * 100).toFixed(2)}% × ${quarters} quarters × €${formatThousands(amountEur)})`, eur: issuanceFee },
      { label: confirmed ? `Confirmation fee (${(LC_COST_TABLE.confirmationQuarterPercent * 100).toFixed(2)}% × ${quarters} quarters)` : 'Confirmation fee — not applied (unconfirmed LC)', eur: confirmationFee },
      { label: 'Document handling fee', eur: documentFee },
      { label: 'Outgoing wires', eur: wireFees },
      { label: 'SWIFT message charges', eur: swiftFees },
      ...(expectedDiscrepancies > 0 ? [{ label: `Anticipated discrepancy charges (${expectedDiscrepancies} × €${LC_COST_TABLE.discrepancyEur})`, eur: discrepancyCharges }] : []),
    ],
    totalEur,
    allInPercent,
    note: allInPercent > 1.0
      ? 'All-in cost exceeds 1% of amount — likely worth comparing against a confirmed-LC alternative or breaking into smaller LCs.'
      : 'All-in cost is reasonable for the duration. Doc-team discipline (no first-pass discrepancies) saves €100+ per LC.',
    pricingSnapshot: PRICING_SNAPSHOT,
  };
}

// ── Estimate FX hedging cost ───────────────────────────────

function estimateFxHedgingCost({ amountEur, currencyPair, durationDays }) {
  const v = validateInput({ amountEur, currencyPair, durationDays }, ['amountEur', 'durationDays', 'currencyPair']);
  if (!v.ok) return { ok: false, errors: v.errors };

  const key = String(currencyPair || '').toUpperCase().replace('-', '_').replace('/', '_');
  const fx = FX_TABLE[key];
  if (!fx) return { ok: false, errors: [`Unknown currency pair "${currencyPair}". Supported: ${Object.keys(FX_TABLE).join(', ')}`] };

  const days = Math.max(1, Math.min(720, Number(durationDays)));
  const proRated = (fx.annualForwardPremiumPercent / 100) * (days / 365);
  const amountCents = M.fromEuro(amountEur);
  const hedgingCostEur = Math.round(M.toEuro(M.mulRate(amountCents, proRated)));
  const unhedgedRiskOneSigmaEur = Math.round(M.toEuro(M.mulRate(amountCents, (fx.annualisedVolatilityPercent / 100) * Math.sqrt(days / 365))));

  return {
    ok: true,
    asOf: PRICING_SNAPSHOT.asOf,
    inputs: { amountEur, currencyPair: fx.pair, durationDays: days },
    pair: fx.pair,
    name: fx.name,
    annualisedVolatilityPercent: fx.annualisedVolatilityPercent,
    annualForwardPremiumPercent: fx.annualForwardPremiumPercent,
    liquidity: fx.liquidity,
    notes: fx.notes || [],
    forwardPremiumPercent: round(proRated * 100, 3),
    hedgingCostEur,
    unhedgedRiskOneSigmaEur,
    note: hedgingCostEur > unhedgedRiskOneSigmaEur
      ? 'Hedging cost exceeds 1-sigma unhedged risk. Consider partial hedge (50–70% of exposure) or a short tenor.'
      : 'Hedging cost is below 1-sigma unhedged risk. Forward cover is usually worth it for amounts above €50,000 over 60+ days.',
    pricingSnapshot: PRICING_SNAPSHOT,
  };
}

// ── Working capital cycle ──────────────────────────────────

function calculateWorkingCapitalCycle({ dioDays, dsoDays, dpoDays, costOfCapitalAnnual }) {
  const dio = Number(dioDays);
  const dso = Number(dsoDays);
  const dpo = Number(dpoDays);
  if (![dio, dso, dpo].every(Number.isFinite)) {
    return { ok: false, errors: ['dioDays, dsoDays, and dpoDays must all be finite numbers (use 0 for no delay)'] };
  }
  const cycleDays = dio + dso - dpo;
  const cocAnnual = Number(costOfCapitalAnnual) || WORKING_CAPITAL_BENCHMARKS.costOfCapitalAnnual;

  // Implied financing cost on €100k of trade volume
  const sample = 100000;
  const cycleCostOnSampleEur = Math.round(M.toEuro(M.mulRate(M.fromEuro(sample), cocAnnual * (cycleDays / 365))));

  return {
    ok: true,
    asOf: PRICING_SNAPSHOT.asOf,
    inputs: { dioDays: dio, dsoDays: dso, dpoDays: dpo, costOfCapitalAnnual: cocAnnual },
    cycleDays,
    components: { dioDays: dio, dsoDays: dso, dpoDays: dpo },
    sampleVolumeEur: sample,
    sampleAnnualCarryCostEur: cycleCostOnSampleEur,
    interpretation: cycleDays > 90
      ? `Cash-conversion cycle of ${cycleDays} days is long for SME trade. Each €100k of revenue ties up €${cycleCostOnSampleEur} per year in working-capital interest. Levers: shorten DIO via 3PL (faster pick-pack), shorten DSO via faster invoicing, lengthen DPO via LC at sight at 30 days vs TT advance.`
      : cycleDays > 30
        ? `Cycle of ${cycleDays} days is normal for SME trade. Annual carry cost on €100k = €${cycleCostOnSampleEur}.`
        : `Short cycle (${cycleDays} days). Either fast-moving DTC or you\'re paying suppliers via TT advance — verify the latter is sustainable.`,
    benchmarks: WORKING_CAPITAL_BENCHMARKS,
    pricingSnapshot: PRICING_SNAPSHOT,
  };
}

// ── Trade-credit cover assessment ──────────────────────────

function assessTradeCreditCover({ buyerCountry, buyerSizeBracket, exposureEur }) {
  const v = validateInput({ exposureEur, amountEur: exposureEur }, ['exposureEur']);
  if (!v.ok) return { ok: false, errors: v.errors.map(e => e.replace('amountEur', 'exposureEur')) };

  const country = String(buyerCountry || '').toUpperCase();
  const countryLoading = TRADE_CREDIT_COVER.countryLoadings[country] || 1.5;
  const sizeBracket = ['tier1', 'mid', 'sme', 'unknown'].includes(buyerSizeBracket) ? buyerSizeBracket : 'unknown';
  const sizeFactor = TRADE_CREDIT_COVER.buyerSizeFactors[sizeBracket];
  const baseRate = TRADE_CREDIT_COVER.baseRatePercent;

  const annualPremiumEur = Math.max(
    TRADE_CREDIT_COVER.minPremiumEur,
    Math.round(M.toEuro(M.mulRate(M.fromEuro(exposureEur), baseRate * countryLoading * sizeFactor))),
  );
  const ratePercent = round((annualPremiumEur / exposureEur) * 100, 3);

  return {
    ok: true,
    asOf: PRICING_SNAPSHOT.asOf,
    inputs: { buyerCountry: country, buyerSizeBracket: sizeBracket, exposureEur },
    annualPremiumEur,
    ratePercent,
    countryLoading,
    sizeFactor,
    minPremiumApplied: annualPremiumEur === TRADE_CREDIT_COVER.minPremiumEur,
    breakdown: [
      { label: `Base rate (${(baseRate * 100).toFixed(3)}% per €1)`, value: Math.round(M.toEuro(M.mulRate(M.fromEuro(exposureEur), baseRate))) },
      { label: `Country loading (${country}: ×${countryLoading})`, value: countryLoading },
      { label: `Buyer size factor (${sizeBracket}: ×${sizeFactor})`, value: sizeFactor },
      ...(annualPremiumEur === TRADE_CREDIT_COVER.minPremiumEur ? [{ label: `Minimum premium floor (€${TRADE_CREDIT_COVER.minPremiumEur})`, value: TRADE_CREDIT_COVER.minPremiumEur }] : []),
    ],
    note: 'Trade-credit insurance turns supplier-side AR risk into a fixed cost. Above 5% of revenue at risk in a single buyer, almost always worth it.',
    handoff: 'For binding cover, OrcaTrade routes via Atradius / Coface / Allianz Trade. For information-only buyer scoring, use the Buyer Verification module.',
    pricingSnapshot: PRICING_SNAPSHOT,
  };
}

// ── Helpers ────────────────────────────────────────────────

function round(value, decimals = 2) {
  if (!Number.isFinite(value)) return 0;
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

function formatThousands(n) {
  return Math.round(n).toLocaleString('en-IE');
}

module.exports = {
  PRICING_SNAPSHOT,
  PAYMENT_INSTRUMENTS,
  INSTRUMENT_KEYS,
  LC_COST_TABLE,
  FX_TABLE,
  WORKING_CAPITAL_BENCHMARKS,
  TRADE_CREDIT_COVER,
  listInstruments,
  listFxPairs,
  validateInput,
  comparePaymentInstruments,
  estimateLcCost,
  estimateFxHedgingCost,
  calculateWorkingCapitalCycle,
  assessTradeCreditCover,
};
