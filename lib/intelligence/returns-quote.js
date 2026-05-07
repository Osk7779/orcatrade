// Returns & Reverse Logistics — three-route costing for B2B Asia trade returns.
// Routes:
//   1. Return to supplier in Asia (highest cost — reverse shipping + customs export docs)
//   2. Local refurbish / repair in EU (mid-cost via partner refurb network)
//   3. Local scrap / WEEE disposal (cheapest, last resort)

const PRICING_SNAPSHOT = {
  asOf: '2026-04-15',
  source: 'OrcaTrade reverse-logistics rates negotiated with HK office partners (Asia return) and EU partner-network rates (refurbishment, WEEE). Refresh quarterly.',
  confidence: 'snapshot',
};

// Initial assessment fee (always applies — covers triage, photo log, decision support)
const ASSESSMENT_FEE_BASE_EUR = 100;
const ASSESSMENT_FEE_PER_PIECE_EUR = 5;
const ASSESSMENT_FEE_CAP_EUR = 500;

// ── Route 1: Return to supplier in Asia ────────────────────────
const RETURN_TO_SUPPLIER = {
  baseHandlingEur: 120,
  exportDocsEur: 80,
  shippingPerKgEur: 1.20,
  shippingMinEur: 90,
  shippingPerKgEur_express: 3.50,
  shippingMinEur_express: 280,
  transitDaysStandard: '18–28 days',
  transitDaysExpress: '5–8 days',
};

// ── Route 2: Local refurbish / repair ────────────────────────
const LOCAL_REFURB = {
  diagnosticPerPieceEur: 12,
  refurbPerPieceEur: 30,
  partsRecoveryAllowanceEur: 8, // typical recoverable value per piece
  transportToHubEur: 60,
  transitDays: '5–10 days hub turnaround',
};

// ── Route 3: Local scrap / WEEE disposal ────────────────────
const LOCAL_SCRAP = {
  pickupEur: 60,
  disposalPerHundredKgEur: 25,
  weeeCertificateEur: 35,
  transitDays: '3–7 days',
  // For some categories scrap is revenue-positive (metal); approximate recovery:
  metalRecoveryPerHundredKgEur: 18,
};

// Categories that affect routing recommendations
const CATEGORY_HINTS = {
  electronics: { weeeApplicable: true, refurbViability: 'medium', label: 'Electronics & electrical equipment' },
  textiles: { weeeApplicable: false, refurbViability: 'low', label: 'Textiles & apparel' },
  furniture: { weeeApplicable: false, refurbViability: 'high', label: 'Furniture & wood products' },
  machinery: { weeeApplicable: true, refurbViability: 'high', label: 'Machinery & industrial equipment' },
  toys: { weeeApplicable: false, refurbViability: 'low', label: 'Toys & childcare' },
  cosmetics: { weeeApplicable: false, refurbViability: 'none', label: 'Cosmetics (often must be scrapped under EU rules)' },
  packaging: { weeeApplicable: false, refurbViability: 'none', label: 'Packaging materials' },
  general: { weeeApplicable: false, refurbViability: 'medium', label: 'General cargo' },
};

const ORIGIN_REGION = {
  CN: { name: 'China', shippingMultiplier: 1.0 },
  VN: { name: 'Vietnam', shippingMultiplier: 1.05 },
  IN: { name: 'India', shippingMultiplier: 1.15 },
  TR: { name: 'Türkiye', shippingMultiplier: 0.7 },
  default: { name: 'Other', shippingMultiplier: 1.20 },
};

function detectOriginRegion(country) {
  const code = String(country || '').toUpperCase().slice(0, 2);
  return ORIGIN_REGION[code] || ORIGIN_REGION.default;
}

function clampAssessmentFee(piecesCount) {
  const fee = ASSESSMENT_FEE_BASE_EUR + (ASSESSMENT_FEE_PER_PIECE_EUR * Math.max(0, piecesCount));
  return Math.round(Math.min(fee, ASSESSMENT_FEE_CAP_EUR) * 100) / 100;
}

function validateInput(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    errors.push('input must be an object');
    return { ok: false, errors };
  }
  const pieces = Number(input.piecesCount);
  if (!Number.isFinite(pieces) || pieces < 1) errors.push('piecesCount must be at least 1');
  if (pieces > 100000) errors.push('piecesCount exceeds 100,000 (contact us for very large batches)');

  const weight = Number(input.totalWeightKg);
  if (!Number.isFinite(weight) || weight < 0) errors.push('totalWeightKg must be 0 or higher');
  if (weight > 50000) errors.push('totalWeightKg exceeds 50,000 kg (contact us for large freight)');

  const declaredValue = Number(input.declaredValueEur);
  if (!Number.isFinite(declaredValue) || declaredValue < 0) errors.push('declaredValueEur must be 0 or higher');

  if (input.category && !CATEGORY_HINTS[input.category]) {
    errors.push(`category must be one of: ${Object.keys(CATEGORY_HINTS).join(', ')}`);
  }
  if (input.originCountry && String(input.originCountry).length !== 2) {
    errors.push('originCountry must be a 2-letter ISO code');
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

function calculateReturnToSupplier({ totalWeightKg, originCountry, express }) {
  const region = detectOriginRegion(originCountry);
  const ratePerKg = express ? RETURN_TO_SUPPLIER.shippingPerKgEur_express : RETURN_TO_SUPPLIER.shippingPerKgEur;
  const minShipping = express ? RETURN_TO_SUPPLIER.shippingMinEur_express : RETURN_TO_SUPPLIER.shippingMinEur;
  const calculatedShipping = ratePerKg * totalWeightKg * region.shippingMultiplier;
  const shippingEur = Math.max(minShipping, calculatedShipping);

  const subtotal = RETURN_TO_SUPPLIER.baseHandlingEur + RETURN_TO_SUPPLIER.exportDocsEur + shippingEur;
  return {
    routeKey: 'return_to_supplier',
    label: `Return to supplier in ${region.name}`,
    totalEur: Math.round(subtotal * 100) / 100,
    transitDays: express ? RETURN_TO_SUPPLIER.transitDaysExpress : RETURN_TO_SUPPLIER.transitDaysStandard,
    breakdown: [
      { label: 'Base handling (HK office reverse-coordination)', eur: RETURN_TO_SUPPLIER.baseHandlingEur },
      { label: 'EU export documentation (CN22 / commercial invoice for re-export)', eur: RETURN_TO_SUPPLIER.exportDocsEur },
      { label: `Reverse shipping (${express ? 'air express' : 'air freight standard'} · ${region.name} · €${ratePerKg}/kg × ${totalWeightKg}kg × ${region.shippingMultiplier})`, eur: Math.round(shippingEur * 100) / 100, minApplied: shippingEur === minShipping },
    ],
    bestFor: 'Defective batches where the supplier has agreed to credit, replace, or rework — and the unit value justifies reverse shipping cost.',
    cautions: [
      'Customs in the destination country may classify as a re-import and apply duty unless original export reference is preserved.',
      'Supplier must confirm acceptance and provide return-merchandise authorisation before dispatch.',
      'Original packaging condition affects supplier acceptance; pre-pack inspection recommended.',
    ],
  };
}

function calculateLocalRefurb({ piecesCount, declaredValueEur, category }) {
  const cat = CATEGORY_HINTS[category || 'general'];
  const isViable = ['high', 'medium'].includes(cat.refurbViability);

  if (!isViable) {
    return {
      routeKey: 'local_refurb',
      label: 'Local refurbish / repair',
      totalEur: null,
      transitDays: '—',
      unavailable: true,
      reason: `Refurbishment is not viable for category "${cat.label}" — partner refurb network does not handle this category.`,
      breakdown: [],
      bestFor: '',
      cautions: [],
    };
  }

  const diagnostic = LOCAL_REFURB.diagnosticPerPieceEur * piecesCount;
  const refurb = LOCAL_REFURB.refurbPerPieceEur * piecesCount;
  const partsRecovery = LOCAL_REFURB.partsRecoveryAllowanceEur * piecesCount;
  const totalCost = diagnostic + refurb + LOCAL_REFURB.transportToHubEur;
  const netCostAfterRecovery = Math.max(0, totalCost - partsRecovery);

  return {
    routeKey: 'local_refurb',
    label: 'Local refurbish / repair',
    totalEur: Math.round(netCostAfterRecovery * 100) / 100,
    grossCostEur: Math.round(totalCost * 100) / 100,
    partsRecoveryAllowanceEur: Math.round(partsRecovery * 100) / 100,
    transitDays: LOCAL_REFURB.transitDays,
    breakdown: [
      { label: 'Transport to refurb hub', eur: LOCAL_REFURB.transportToHubEur },
      { label: `Diagnostic (€${LOCAL_REFURB.diagnosticPerPieceEur}/piece × ${piecesCount})`, eur: Math.round(diagnostic * 100) / 100 },
      { label: `Refurbishment labour (€${LOCAL_REFURB.refurbPerPieceEur}/piece × ${piecesCount})`, eur: Math.round(refurb * 100) / 100 },
      { label: `Parts-recovery allowance (€${LOCAL_REFURB.partsRecoveryAllowanceEur}/piece credit × ${piecesCount})`, eur: -1 * Math.round(partsRecovery * 100) / 100 },
    ],
    bestFor: `Suitable for ${cat.label}. Best when refurbishment yields ≥ 60% of original value and units are recoverable to working condition. Especially viable when declared value > €${Math.round(LOCAL_REFURB.refurbPerPieceEur * 3)} per piece.`,
    cautions: [
      'Refurbished units must be re-tested against original spec; partner network issues an inspection report.',
      'Some product categories (cosmetics, food contact, certain electronics) cannot be re-sold as refurbished under EU consumer protection rules.',
      'Original CE marking and Declaration of Conformity must remain valid for resale.',
    ],
  };
}

function calculateLocalScrap({ totalWeightKg, category }) {
  const cat = CATEGORY_HINTS[category || 'general'];
  const hundredKg = totalWeightKg / 100;
  const disposal = LOCAL_SCRAP.disposalPerHundredKgEur * hundredKg;
  const weeeFee = cat.weeeApplicable ? LOCAL_SCRAP.weeeCertificateEur : 0;
  const subtotal = LOCAL_SCRAP.pickupEur + disposal + weeeFee;

  // Metal recovery (rough — for electronics / machinery only)
  const metalRecovery = (cat.weeeApplicable && totalWeightKg > 50)
    ? LOCAL_SCRAP.metalRecoveryPerHundredKgEur * hundredKg
    : 0;
  const netCost = Math.max(0, subtotal - metalRecovery);

  const breakdown = [
    { label: 'Pickup and transport to disposal partner', eur: LOCAL_SCRAP.pickupEur },
    { label: `Disposal fee (€${LOCAL_SCRAP.disposalPerHundredKgEur}/100kg × ${(hundredKg).toFixed(2)})`, eur: Math.round(disposal * 100) / 100 },
  ];
  if (weeeFee) {
    breakdown.push({ label: 'WEEE compliance certificate (Directive 2012/19/EU)', eur: weeeFee });
  }
  if (metalRecovery > 0) {
    breakdown.push({ label: `Metal-recovery credit (€${LOCAL_SCRAP.metalRecoveryPerHundredKgEur}/100kg × ${(hundredKg).toFixed(2)})`, eur: -1 * Math.round(metalRecovery * 100) / 100 });
  }

  return {
    routeKey: 'local_scrap',
    label: 'Local scrap / WEEE disposal',
    totalEur: Math.round(netCost * 100) / 100,
    grossCostEur: Math.round(subtotal * 100) / 100,
    metalRecoveryEur: Math.round(metalRecovery * 100) / 100,
    transitDays: LOCAL_SCRAP.transitDays,
    breakdown,
    bestFor: 'Last resort when goods cannot be returned, refurbished, or resold. Required for some categories (e.g. expired cosmetics, contaminated food).' + (cat.weeeApplicable ? ' WEEE certificate provided for compliant disposal of EEE.' : ''),
    cautions: [
      'EU disposal law (waste framework directive) requires manifest tracking; we provide the paperwork.',
      cat.weeeApplicable ? 'WEEE Directive 2012/19/EU certificate is mandatory for electrical / electronic equipment.' : 'Verify if goods fall under EU Waste Framework Directive — paperwork required regardless.',
      'Brand-protection: ensure scrap partner physically destroys branded items if your contract requires it.',
    ],
  };
}

function calculateQuote(input) {
  const validation = validateInput(input);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const piecesCount = Number(input.piecesCount);
  const totalWeightKg = Number(input.totalWeightKg);
  const declaredValueEur = Number(input.declaredValueEur);
  const category = input.category || 'general';
  const express = input.express === true;

  const assessmentFeeEur = clampAssessmentFee(piecesCount);

  const routes = [
    calculateReturnToSupplier({ totalWeightKg, originCountry: input.originCountry, express }),
    calculateLocalRefurb({ piecesCount, declaredValueEur, category }),
    calculateLocalScrap({ totalWeightKg, category }),
  ].map(route => {
    if (route.unavailable) return route;
    const totalIncludingAssessment = Math.round((route.totalEur + assessmentFeeEur) * 100) / 100;
    return {
      ...route,
      totalIncludingAssessmentEur: totalIncludingAssessment,
      totalNetSavingsVsValueEur: declaredValueEur > 0 ? Math.round((declaredValueEur - totalIncludingAssessment) * 100) / 100 : null,
    };
  });

  const recommendation = recommendRoute({ routes, declaredValueEur, category });

  return {
    ok: true,
    asOf: PRICING_SNAPSHOT.asOf,
    inputs: {
      piecesCount,
      totalWeightKg,
      declaredValueEur,
      category,
      categoryLabel: CATEGORY_HINTS[category].label,
      originCountry: input.originCountry || null,
      express,
    },
    assessmentFeeEur,
    routes,
    recommendation,
    snapshot: PRICING_SNAPSHOT,
    nextSteps: [
      'Submit the case — we triage and confirm route viability within 2 business days.',
      'Once you approve a route, we generate the documentation pack (return RMA, customs paperwork, WEEE if applicable).',
      'OrcaTrade coordinates the chosen partner (HK office reverse-coordination, EU refurb hub, or licensed disposal partner).',
      'Final invoice on completion. The assessment fee is charged upfront; per-route costs apply to whichever route you authorise.',
    ],
  };
}

function recommendRoute({ routes, declaredValueEur, category }) {
  const viable = routes.filter(r => !r.unavailable && Number.isFinite(r.totalIncludingAssessmentEur));
  if (!viable.length) {
    return { primaryRouteKey: null, reasoning: 'No viable route detected. Contact us directly.' };
  }

  // Sort by total cost ascending
  viable.sort((a, b) => a.totalIncludingAssessmentEur - b.totalIncludingAssessmentEur);
  const cheapest = viable[0];

  // If declaredValue > 2× the cheapest cost AND refurb is viable, prefer refurb
  const refurb = viable.find(r => r.routeKey === 'local_refurb');
  const returnSupplier = viable.find(r => r.routeKey === 'return_to_supplier');

  let primary = cheapest;
  let reasoning = `Lowest-cost route given inputs: ${cheapest.label} at €${cheapest.totalIncludingAssessmentEur}.`;

  if (refurb && declaredValueEur > 0 && declaredValueEur >= refurb.totalIncludingAssessmentEur * 1.5) {
    primary = refurb;
    reasoning = `Refurbishment recommended: declared value (€${declaredValueEur}) exceeds refurb cost (€${refurb.totalIncludingAssessmentEur}) by ≥ 1.5× — likely positive recovery vs scrap.`;
  } else if (returnSupplier && declaredValueEur > 0 && declaredValueEur >= returnSupplier.totalIncludingAssessmentEur * 2) {
    primary = returnSupplier;
    reasoning = `Return to supplier recommended: declared value (€${declaredValueEur}) is ≥ 2× the reverse-shipping cost (€${returnSupplier.totalIncludingAssessmentEur}). Supplier recovery / replacement is likely the best commercial outcome.`;
  } else if (declaredValueEur > 0 && cheapest.totalIncludingAssessmentEur > declaredValueEur) {
    reasoning = `Caution: cheapest route (€${cheapest.totalIncludingAssessmentEur}) exceeds declared value (€${declaredValueEur}). Consider whether the case is worth processing or write off.`;
  }

  return {
    primaryRouteKey: primary.routeKey,
    primaryRouteLabel: primary.label,
    primaryRouteCostEur: primary.totalIncludingAssessmentEur,
    reasoning,
  };
}

function listCategories() {
  return Object.entries(CATEGORY_HINTS).map(([key, def]) => ({
    key, label: def.label, weeeApplicable: def.weeeApplicable, refurbViability: def.refurbViability,
  }));
}

module.exports = {
  PRICING_SNAPSHOT,
  ASSESSMENT_FEE_BASE_EUR,
  ASSESSMENT_FEE_PER_PIECE_EUR,
  ASSESSMENT_FEE_CAP_EUR,
  CATEGORY_HINTS,
  ORIGIN_REGION,
  detectOriginRegion,
  clampAssessmentFee,
  validateInput,
  calculateQuote,
  listCategories,
  // exports for tests
  calculateReturnToSupplier,
  calculateLocalRefurb,
  calculateLocalScrap,
  recommendRoute,
};
