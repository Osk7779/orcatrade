// EU Customs & Bonded Solutions calculator.
//
// Two side-by-side scenarios for any incoming Asia → EU shipment:
//   1. Standard import clearance — duty + VAT + brokerage paid at first EU entry
//   2. Bonded warehouse storage — duty/VAT deferred until release; goods can be
//      re-exported duty-free, or released into free circulation later.
//
// SME importers rarely think about bonded storage. For seasonal goods, slow-moving
// SKUs, or anything with re-export probability, bonded can be a real cash-flow win.

const PRICING_SNAPSHOT = {
  asOf: '2026-05-07',
  source: 'OrcaTrade duty rates from TARIC by HS chapter (2026 schedule); VAT rates from EU national tax authorities; brokerage and bonded warehouse rates negotiated with EU partner network. Refresh quarterly.',
  confidence: 'snapshot',
  notes: 'Duty rates here are the typical Most-Favoured-Nation (MFN) rate for the chapter. Specific HS subheadings may attract anti-dumping, safeguard, or preferential-origin rates that override the MFN baseline. For binding tariff information request a BTI ruling from your national customs authority.',
};

// ── Brokerage and assessment fees ─────────────────────────────────────
const BROKERAGE_BASE_EUR = 45;
const BROKERAGE_PER_LINE_EUR = 8;
const BROKERAGE_CAP_EUR = 250;
const ENTRY_SUMMARY_DECLARATION_EUR = 25; // ENS / safety & security pre-arrival

// ── Bonded warehouse rates ────────────────────────────────────────────
const BONDED = {
  setupFeeEur: 95,                      // one-off entry into the bonded regime (T1 transit + warehouse intake)
  storagePerCbmPerDayEur: 0.30,         // typical EU public bonded warehouse, customer-pallet basis
  bondPercentOfCustomsValue: 0.012,     // 1.2% bond / financial guarantee fee on retained customs value
  exitClearanceEur: 65,                 // clearance into free circulation when released
  reExportClearanceEur: 35,             // export clearance if shipped onward outside EU (duty/VAT never paid)
  minStorageDays: 1,
  maxStorageDays: 365 * 3,              // EU customs warehousing has no hard limit, but we cap UI input
};

// Cost-of-capital benchmark used to calculate cash-flow benefit from deferring duty + VAT.
// 6% annual is a defensible mid-2026 SME working-capital cost (ECB base + spread).
const COST_OF_CAPITAL_ANNUAL = 0.06;

// ── EU VAT rates by destination country ───────────────────────────────
// Standard rate at point of import (reduced rates rarely apply at customs).
const EU_VAT = {
  AT: { rate: 0.20, name: 'Austria' },
  BE: { rate: 0.21, name: 'Belgium' },
  BG: { rate: 0.20, name: 'Bulgaria' },
  CY: { rate: 0.19, name: 'Cyprus' },
  CZ: { rate: 0.21, name: 'Czechia' },
  DE: { rate: 0.19, name: 'Germany' },
  DK: { rate: 0.25, name: 'Denmark' },
  EE: { rate: 0.22, name: 'Estonia' },
  ES: { rate: 0.21, name: 'Spain' },
  FI: { rate: 0.255, name: 'Finland' },
  FR: { rate: 0.20, name: 'France' },
  GR: { rate: 0.24, name: 'Greece' },
  HR: { rate: 0.25, name: 'Croatia' },
  HU: { rate: 0.27, name: 'Hungary' },
  IE: { rate: 0.23, name: 'Ireland' },
  IT: { rate: 0.22, name: 'Italy' },
  LT: { rate: 0.21, name: 'Lithuania' },
  LU: { rate: 0.17, name: 'Luxembourg' },
  LV: { rate: 0.21, name: 'Latvia' },
  MT: { rate: 0.18, name: 'Malta' },
  NL: { rate: 0.21, name: 'Netherlands' },
  PL: { rate: 0.23, name: 'Poland' },
  PT: { rate: 0.23, name: 'Portugal' },
  RO: { rate: 0.21, name: 'Romania' },
  SE: { rate: 0.25, name: 'Sweden' },
  SI: { rate: 0.22, name: 'Slovenia' },
  SK: { rate: 0.23, name: 'Slovakia' },
};

// ── Duty rates by HS chapter (2-digit) — MFN baseline ─────────────────
// Source: EU TARIC schedule, simplified to chapter-level typical rates for SME import categories.
// Real classifications go to the 8-10 digit level; this is a fast estimator, not a binding ruling.
const HS_CHAPTER_DUTY = {
  // Live animals & food (low duty for raw, higher for processed)
  '01': { rate: 0.00, label: 'Live animals' },
  '02': { rate: 0.10, label: 'Meat and edible meat offal' },
  '03': { rate: 0.08, label: 'Fish and crustaceans' },
  '04': { rate: 0.10, label: 'Dairy, eggs, honey' },
  // Vegetable products
  '08': { rate: 0.06, label: 'Edible fruit and nuts' },
  '09': { rate: 0.05, label: 'Coffee, tea, spices' },
  '10': { rate: 0.04, label: 'Cereals' },
  // Prepared foodstuffs
  '15': { rate: 0.05, label: 'Animal or vegetable fats and oils' },
  '16': { rate: 0.13, label: 'Preparations of meat, fish' },
  '17': { rate: 0.10, label: 'Sugars and sugar confectionery' },
  '18': { rate: 0.08, label: 'Cocoa and cocoa preparations' },
  '19': { rate: 0.08, label: 'Cereal-based preparations' },
  '20': { rate: 0.14, label: 'Vegetable, fruit and nut preparations' },
  '21': { rate: 0.07, label: 'Miscellaneous edible preparations' },
  '22': { rate: 0.09, label: 'Beverages, spirits and vinegar' },
  // Mineral products
  '25': { rate: 0.00, label: 'Salt, sulphur, stone, plastering' },
  '27': { rate: 0.02, label: 'Mineral fuels and oils' },
  // Chemicals
  '28': { rate: 0.045, label: 'Inorganic chemicals' },
  '29': { rate: 0.055, label: 'Organic chemicals' },
  '30': { rate: 0.00, label: 'Pharmaceutical products (Annex listings: zero-duty)' },
  '32': { rate: 0.06, label: 'Tanning, dyeing extracts; pigments' },
  '33': { rate: 0.00, label: 'Essential oils, cosmetics, perfumery' },
  '34': { rate: 0.04, label: 'Soap, washing preparations, candles' },
  '38': { rate: 0.055, label: 'Miscellaneous chemical products' },
  '39': { rate: 0.065, label: 'Plastics and articles thereof' },
  '40': { rate: 0.04, label: 'Rubber and articles thereof' },
  // Leather, fur, wood, paper
  '42': { rate: 0.03, label: 'Articles of leather; handbags' },
  '44': { rate: 0.03, label: 'Wood and articles of wood' },
  '48': { rate: 0.00, label: 'Paper and paperboard' },
  '49': { rate: 0.00, label: 'Printed books, newspapers' },
  // Textiles & apparel — typically 12% across the cluster
  '50': { rate: 0.07, label: 'Silk' },
  '51': { rate: 0.08, label: 'Wool, animal hair' },
  '52': { rate: 0.08, label: 'Cotton (yarns and fabrics)' },
  '54': { rate: 0.08, label: 'Man-made filaments' },
  '55': { rate: 0.08, label: 'Man-made staple fibres' },
  '57': { rate: 0.08, label: 'Carpets and floor coverings' },
  '58': { rate: 0.08, label: 'Special woven fabrics' },
  '59': { rate: 0.075, label: 'Impregnated, coated textile fabrics' },
  '60': { rate: 0.08, label: 'Knitted or crocheted fabrics' },
  '61': { rate: 0.12, label: 'Apparel — knitted/crocheted' },
  '62': { rate: 0.12, label: 'Apparel — not knitted (woven)' },
  '63': { rate: 0.12, label: 'Made-up textile articles, home textiles' },
  '64': { rate: 0.11, label: 'Footwear' },
  '65': { rate: 0.027, label: 'Headgear' },
  // Stone, ceramics, glass
  '69': { rate: 0.05, label: 'Ceramic products' },
  '70': { rate: 0.05, label: 'Glass and glassware' },
  // Base metals
  '72': { rate: 0.00, label: 'Iron and steel (subject to anti-dumping for many origins)' },
  '73': { rate: 0.027, label: 'Articles of iron or steel' },
  '74': { rate: 0.02, label: 'Copper and articles thereof' },
  '76': { rate: 0.06, label: 'Aluminium and articles thereof (subject to safeguards)' },
  // Machinery & electricals — overall low MFN, exceptions exist
  '82': { rate: 0.03, label: 'Tools, cutlery of base metal' },
  '83': { rate: 0.027, label: 'Miscellaneous articles of base metal' },
  '84': { rate: 0.025, label: 'Machinery, mechanical appliances' },
  '85': { rate: 0.035, label: 'Electrical machinery and equipment' },
  // Vehicles & transport
  '87': { rate: 0.10, label: 'Vehicles, parts and accessories' },
  '88': { rate: 0.025, label: 'Aircraft, spacecraft' },
  // Optical, medical, watches
  '90': { rate: 0.025, label: 'Optical, photographic, medical instruments' },
  '91': { rate: 0.045, label: 'Clocks and watches' },
  // Misc manufactured goods
  '94': { rate: 0.027, label: 'Furniture, bedding, lighting' },
  '95': { rate: 0.034, label: 'Toys, games, sports equipment' },
  '96': { rate: 0.032, label: 'Miscellaneous manufactured articles' },
};

// ── Origin-specific anti-dumping / preferential flags ──────────────────
// Lightweight overlay: when the origin has a known issue or preference for the chapter,
// nudge the MFN rate. Real calculations require the full TARIC origin/chapter matrix.
const ORIGIN_OVERLAYS = {
  CN: {
    name: 'China',
    notes: [
      'Anti-dumping duties apply to many CN-origin goods in chapters 72/73 (steel), 76 (aluminium), 39 (some plastics), and 64 (footwear).',
      'Always verify TARIC for the specific 8-digit code before commitments.',
    ],
    chapterAdjustments: {
      '72': 0.18,  // typical anti-dumping addition on Chinese steel
      '73': 0.10,
      '76': 0.10,
      '64': 0.04,  // remaining anti-dumping on certain CN footwear
    },
    preferential: false,
  },
  VN: {
    name: 'Vietnam',
    notes: ['EU-Vietnam FTA (EVFTA) gives preferential or zero duty for many chapters with valid origin proof (REX or invoice declaration).'],
    chapterAdjustments: {},
    preferential: true,
    preferentialDiscount: 0.7,  // typical 70% reduction on MFN with valid origin proof
  },
  IN: { name: 'India', notes: ['GSP+ no longer applies; full MFN rates.'], chapterAdjustments: {}, preferential: false },
  ID: { name: 'Indonesia', notes: ['EU-Indonesia FTA negotiations ongoing; currently full MFN.'], chapterAdjustments: {}, preferential: false },
  TH: { name: 'Thailand', notes: ['Full MFN; no current preferential agreement.'], chapterAdjustments: {}, preferential: false },
  BD: { name: 'Bangladesh', notes: ['Everything But Arms (EBA) — Least Developed Country zero-duty access for most products until LDC graduation.'], chapterAdjustments: {}, preferential: true, preferentialDiscount: 1.0 },
  PK: { name: 'Pakistan', notes: ['GSP+ beneficiary — preferential reduction on many tariff lines (textiles especially).'], chapterAdjustments: {}, preferential: true, preferentialDiscount: 0.5 },
  KH: { name: 'Cambodia', notes: ['Everything But Arms (EBA) — LDC zero-duty for most products.'], chapterAdjustments: {}, preferential: true, preferentialDiscount: 1.0 },
  MY: { name: 'Malaysia', notes: ['Full MFN.'], chapterAdjustments: {}, preferential: false },
  TR: { name: 'Türkiye', notes: ['EU-Turkey customs union — most industrial goods are duty-free with A.TR certificate.'], chapterAdjustments: {}, preferential: true, preferentialDiscount: 0.95 },
};

// ── Public helpers ────────────────────────────────────────────────────

function listCountries() {
  return Object.entries(EU_VAT).map(([code, v]) => ({ code, name: v.name, vatRate: v.rate }));
}

function listOrigins() {
  return Object.entries(ORIGIN_OVERLAYS).map(([code, v]) => ({
    code,
    name: v.name,
    preferential: v.preferential,
    notes: v.notes,
  }));
}

function listHsChapters() {
  return Object.entries(HS_CHAPTER_DUTY).map(([code, v]) => ({ chapter: code, dutyRate: v.rate, label: v.label }));
}

function detectChapter(hsCode) {
  if (!hsCode) return null;
  const digits = String(hsCode).replace(/[^0-9]/g, '').slice(0, 2);
  return digits.length === 2 ? digits : null;
}

const tradeDefence = require('./data/eu-trade-defence');

function resolveDutyRate({ hsCode, originCountry, claimPreferential }) {
  const chapter = detectChapter(hsCode);
  if (!chapter || !HS_CHAPTER_DUTY[chapter]) {
    return {
      ok: false,
      error: `Unable to determine duty rate — provide a valid HS code (chapter must be one of: ${Object.keys(HS_CHAPTER_DUTY).join(', ')}).`,
    };
  }
  const baseEntry = HS_CHAPTER_DUTY[chapter];
  let rate = baseEntry.rate;
  const breakdown = [{ label: `MFN base rate for HS chapter ${chapter} (${baseEntry.label})`, value: baseEntry.rate }];

  const overlay = originCountry ? ORIGIN_OVERLAYS[String(originCountry).toUpperCase()] : null;

  // Trade-defence measures (anti-dumping + countervailing) — measure-level
  // database takes precedence over the chapter-level overlay nudge.
  const tdMatches = tradeDefence.findMeasures({ hsCode, originCountry });
  const tdAggregate = tradeDefence.aggregateRate(tdMatches);
  const tradeDefenceMeasures = tdMatches.map(m => ({
    id: m.id,
    description: m.description,
    type: m.type,
    rateTypicalPct: m.rateTypicalPct,
    rateMinPct: m.rateMinPct,
    rateMaxPct: m.rateMaxPct,
    citation: m.citation,
    notes: m.notes,
  }));

  if (tdAggregate.totalPct > 0) {
    const tdRate = tdAggregate.totalPct / 100;
    rate += tdRate;
    for (const c of tdAggregate.components) {
      breakdown.push({
        label: `${c.type === 'CVD' ? 'Countervailing duty' : 'Anti-dumping duty'} — ${c.description} (${c.citation})`,
        value: c.ratePct / 100,
      });
    }
  } else if (overlay) {
    // Fallback: if no specific measure matches, the lightweight chapter
    // overlay still nudges the rate. This is the legacy behaviour and only
    // fires when the trade-defence database returns nothing for this combo.
    const adj = overlay.chapterAdjustments[chapter];
    if (typeof adj === 'number') {
      rate += adj;
      breakdown.push({ label: `Origin overlay (${overlay.name}, chapter ${chapter}) — chapter-level safeguard estimate`, value: adj });
    }
  }

  if (claimPreferential && overlay && overlay.preferential) {
    const discount = overlay.preferentialDiscount || 0;
    const reduction = -1 * rate * discount;
    rate += reduction;
    if (rate < 0) rate = 0;
    breakdown.push({ label: `Preferential origin claim (${overlay.name}) — ${Math.round(discount * 100)}% reduction; valid origin proof required`, value: reduction });
  }

  // Build origin notes: AD/CVD warnings stack with the legacy overlay notes.
  const baseNotes = overlay?.notes ? [...overlay.notes] : [];
  if (tradeDefenceMeasures.length) {
    baseNotes.unshift(
      `Active trade-defence measure${tradeDefenceMeasures.length > 1 ? 's' : ''} apply: ${tradeDefenceMeasures.map(m => `${m.type} ${m.rateTypicalPct}% on ${m.description}`).join('; ')}. Verify exporter eligibility on TARIC before commitment.`
    );
  }

  return {
    ok: true,
    chapter,
    chapterLabel: baseEntry.label,
    rate: Math.round(rate * 10000) / 10000,
    breakdown,
    originName: overlay?.name || (originCountry ? `Origin ${originCountry}` : 'Unknown origin'),
    originNotes: baseNotes,
    tradeDefenceMeasures,
  };
}

function vatForCountry(countryCode) {
  const entry = EU_VAT[String(countryCode || '').toUpperCase()];
  if (!entry) return null;
  return { rate: entry.rate, name: entry.name };
}

function brokerageFee(linesCount) {
  const lines = Math.max(1, Math.floor(Number(linesCount) || 1));
  const fee = BROKERAGE_BASE_EUR + BROKERAGE_PER_LINE_EUR * lines;
  return Math.min(fee, BROKERAGE_CAP_EUR);
}

function validateInput(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    errors.push('input must be an object');
    return { ok: false, errors };
  }
  const customsValue = Number(input.customsValueEur);
  if (!Number.isFinite(customsValue) || customsValue <= 0) errors.push('customsValueEur must be greater than 0');
  if (customsValue > 10000000) errors.push('customsValueEur exceeds €10M (please contact us for very large consignments)');

  if (!input.hsCode) errors.push('hsCode required (use chapter level if specifics are unknown — first 2 digits)');
  else if (!detectChapter(input.hsCode) || !HS_CHAPTER_DUTY[detectChapter(input.hsCode)]) {
    errors.push(`hsCode chapter not recognised — chapter must be one of: ${Object.keys(HS_CHAPTER_DUTY).join(', ')}`);
  }

  if (!input.destinationCountry) errors.push('destinationCountry required (2-letter EU ISO code)');
  else if (!EU_VAT[String(input.destinationCountry).toUpperCase()]) {
    errors.push(`destinationCountry must be an EU member state (got "${input.destinationCountry}")`);
  }

  if (input.originCountry && String(input.originCountry).length !== 2) {
    errors.push('originCountry must be a 2-letter ISO code');
  }

  if (input.linesCount != null && (!Number.isFinite(Number(input.linesCount)) || Number(input.linesCount) < 1)) {
    errors.push('linesCount must be 1 or higher');
  }
  if (input.bondedDays != null && (!Number.isFinite(Number(input.bondedDays)) || Number(input.bondedDays) < 0 || Number(input.bondedDays) > BONDED.maxStorageDays)) {
    errors.push(`bondedDays must be between 0 and ${BONDED.maxStorageDays}`);
  }
  if (input.bondedVolumeCbm != null && (!Number.isFinite(Number(input.bondedVolumeCbm)) || Number(input.bondedVolumeCbm) < 0)) {
    errors.push('bondedVolumeCbm must be 0 or higher');
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// ── Scenario 1: Standard import clearance ─────────────────────────────
function calculateStandardClearance({ customsValueEur, dutyRate, vat, linesCount }) {
  const dutyEur = customsValueEur * dutyRate;
  const vatBaseEur = customsValueEur + dutyEur;
  const vatEur = vatBaseEur * vat.rate;
  const brokerageEur = brokerageFee(linesCount);
  const totalEur = customsValueEur + dutyEur + vatEur + brokerageEur + ENTRY_SUMMARY_DECLARATION_EUR;
  const landedCostEur = customsValueEur + dutyEur + vatEur;
  return {
    routeKey: 'standard_clearance',
    label: 'Standard import clearance',
    customsValueEur: round(customsValueEur),
    dutyEur: round(dutyEur),
    dutyRate,
    vatEur: round(vatEur),
    vatRate: vat.rate,
    vatBaseEur: round(vatBaseEur),
    brokerageEur: round(brokerageEur),
    entrySummaryDeclarationEur: ENTRY_SUMMARY_DECLARATION_EUR,
    totalEur: round(totalEur),
    landedCostEur: round(landedCostEur),
    breakdown: [
      { label: 'Customs value (CIF at first EU entry)', eur: round(customsValueEur) },
      { label: `Import duty (${(dutyRate * 100).toFixed(2)}% × customs value)`, eur: round(dutyEur) },
      { label: `Import VAT (${(vat.rate * 100).toFixed(1)}% × (customs value + duty), payable in ${vat.name})`, eur: round(vatEur) },
      { label: `Customs brokerage (€${BROKERAGE_BASE_EUR} base + €${BROKERAGE_PER_LINE_EUR}/line × ${linesCount} lines, capped €${BROKERAGE_CAP_EUR})`, eur: round(brokerageEur) },
      { label: 'Entry Summary Declaration (ENS / safety & security pre-arrival filing)', eur: ENTRY_SUMMARY_DECLARATION_EUR },
    ],
    bestFor: 'Goods sold quickly into the EU domestic market — where there is no benefit to deferring duty/VAT and storage is not required.',
    cautions: [
      'VAT is recoverable on the next return for VAT-registered importers (effectively cash-flow only, not net cost).',
      'Duty is non-recoverable — it is the true tariff cost.',
      'Anti-dumping or safeguard measures may apply on top of MFN; verify TARIC for the 8-10 digit code before commitment.',
    ],
  };
}

// ── Scenario 2: Bonded warehouse ──────────────────────────────────────
function calculateBondedWarehouse({ customsValueEur, dutyRate, vat, linesCount, bondedDays, bondedVolumeCbm, releaseStrategy }) {
  if (!bondedDays || bondedDays <= 0) {
    return {
      routeKey: 'bonded_warehouse',
      label: 'Bonded warehouse storage',
      unavailable: true,
      reason: 'Bonded storage requires a minimum of 1 storage day. Set bondedDays to compare bonded vs standard clearance.',
      breakdown: [],
    };
  }

  const cbm = Math.max(0.5, Number(bondedVolumeCbm) || 1); // assume at least 0.5 cbm if user did not provide
  const setup = BONDED.setupFeeEur;
  const storageEur = BONDED.storagePerCbmPerDayEur * cbm * bondedDays;
  const bondEur = BONDED.bondPercentOfCustomsValue * customsValueEur;
  const exitClearance = releaseStrategy === 're_export'
    ? BONDED.reExportClearanceEur
    : BONDED.exitClearanceEur;
  const brokerageEur = brokerageFee(linesCount);

  // Cash-flow benefit: if released to free circulation, duty + VAT are paid at exit instead of on day 1.
  // For re-export, duty + VAT are NEVER paid — full saving.
  const dutyEur = customsValueEur * dutyRate;
  const vatBaseEur = customsValueEur + dutyEur;
  const vatEur = vatBaseEur * vat.rate;

  let dutyDueEur, vatDueEur, cashflowBenefitEur, releaseLabel;
  if (releaseStrategy === 're_export') {
    dutyDueEur = 0;
    vatDueEur = 0;
    cashflowBenefitEur = dutyEur + vatEur;
    releaseLabel = 'Re-export outside EU — duty and VAT NEVER paid (the strongest bonded use case).';
  } else {
    dutyDueEur = dutyEur;
    vatDueEur = vatEur;
    // Cost-of-capital benefit on deferred duty + VAT, prorated by storage days
    cashflowBenefitEur = (dutyEur + vatEur) * COST_OF_CAPITAL_ANNUAL * (bondedDays / 365);
    releaseLabel = `Release into free circulation after ${bondedDays} days — duty and VAT paid at exit instead of day-1, freeing working capital.`;
  }

  const bondedOpsCostEur = setup + storageEur + bondEur + exitClearance + brokerageEur + ENTRY_SUMMARY_DECLARATION_EUR;
  const totalCashOutEur = bondedOpsCostEur + dutyDueEur + vatDueEur;
  const landedCostEur = customsValueEur + dutyDueEur + vatDueEur;
  // Net comparison vs standard = bonded ops cost – cashflow benefit
  const netVsStandardEur = bondedOpsCostEur - cashflowBenefitEur;

  const breakdown = [
    { label: 'Customs value (CIF at first EU entry, retained under bonded regime)', eur: round(customsValueEur) },
    { label: 'Bonded entry / setup (T1 transit + warehouse intake)', eur: setup },
    { label: `Storage (€${BONDED.storagePerCbmPerDayEur}/cbm/day × ${cbm.toFixed(1)}cbm × ${bondedDays} days)`, eur: round(storageEur) },
    { label: `Bond / financial guarantee (${(BONDED.bondPercentOfCustomsValue * 100).toFixed(2)}% × customs value)`, eur: round(bondEur) },
    { label: releaseStrategy === 're_export' ? 'Re-export clearance (T2 / export declaration)' : 'Exit clearance into free circulation (release)', eur: exitClearance },
    { label: `Customs brokerage (€${BROKERAGE_BASE_EUR} base + €${BROKERAGE_PER_LINE_EUR}/line × ${linesCount} lines, capped €${BROKERAGE_CAP_EUR})`, eur: round(brokerageEur) },
    { label: 'Entry Summary Declaration (ENS pre-arrival filing)', eur: ENTRY_SUMMARY_DECLARATION_EUR },
  ];
  if (releaseStrategy === 're_export') {
    breakdown.push({ label: 'Import duty AVOIDED (goods leave EU customs territory unreleased)', eur: -1 * round(dutyEur) });
    breakdown.push({ label: 'Import VAT AVOIDED (goods leave EU customs territory unreleased)', eur: -1 * round(vatEur) });
  } else {
    breakdown.push({ label: `Import duty (${(dutyRate * 100).toFixed(2)}%, paid at exit into free circulation)`, eur: round(dutyDueEur) });
    breakdown.push({ label: `Import VAT (${(vat.rate * 100).toFixed(1)}%, paid at exit into free circulation)`, eur: round(vatDueEur) });
    breakdown.push({ label: `Cash-flow benefit from deferral (${(COST_OF_CAPITAL_ANNUAL * 100).toFixed(0)}% annual cost-of-capital × ${bondedDays} days)`, eur: -1 * round(cashflowBenefitEur) });
  }

  return {
    routeKey: 'bonded_warehouse',
    label: releaseStrategy === 're_export' ? 'Bonded — re-export (duty/VAT avoided)' : 'Bonded warehouse — release later',
    bondedDays,
    bondedVolumeCbm: round(cbm),
    customsValueEur: round(customsValueEur),
    setupFeeEur: setup,
    storageEur: round(storageEur),
    bondEur: round(bondEur),
    exitClearanceEur: exitClearance,
    brokerageEur: round(brokerageEur),
    entrySummaryDeclarationEur: ENTRY_SUMMARY_DECLARATION_EUR,
    bondedOpsCostEur: round(bondedOpsCostEur),
    dutyDueEur: round(dutyDueEur),
    vatDueEur: round(vatDueEur),
    cashflowBenefitEur: round(cashflowBenefitEur),
    totalCashOutEur: round(totalCashOutEur),
    landedCostEur: round(landedCostEur),
    netVsStandardEur: round(netVsStandardEur),
    releaseLabel,
    breakdown,
    bestFor: releaseStrategy === 're_export'
      ? 'Goods that may be re-exported (samples, returns, reworked goods, transit hubs). Bonded re-export skips duty + VAT entirely.'
      : 'Slow-moving stock, seasonal goods, or large consignments where deferring duty + VAT for 30+ days yields more cash-flow benefit than bonded fees.',
    cautions: [
      'Bonded regime requires AEO-authorised warehouse (the partner network) and a financial guarantee with customs.',
      'Goods cannot be modified or sold in bonded regime — only stored, repackaged in limited ways, or moved between bonded sites.',
      'If goods are released into free circulation, duty + VAT must be paid at the rate in force on the day of release (not day of arrival).',
    ],
  };
}

// ── Recommendation ─────────────────────────────────────────────────────
function recommendRoute({ standard, bonded, releaseStrategy, dutyEur, vatEur, customsValueEur }) {
  if (bonded.unavailable) {
    return {
      primary: 'standard_clearance',
      reasoning: 'No bonded scenario was provided. Standard clearance is the default for goods entering EU free circulation immediately.',
    };
  }
  if (releaseStrategy === 're_export') {
    return {
      primary: 'bonded_warehouse',
      reasoning: `Re-export bonded skips duty (€${round(dutyEur)}) + VAT (€${round(vatEur)}) entirely. Bonded operating cost €${round(bonded.bondedOpsCostEur)} is far below standard clearance €${round(standard.totalEur)}.`,
    };
  }
  // Release into free circulation case — compare cash-flow benefit vs bonded ops cost
  const bondedOpsExtra = bonded.bondedOpsCostEur - (standard.brokerageEur + standard.entrySummaryDeclarationEur);
  if (bonded.cashflowBenefitEur > bondedOpsExtra) {
    return {
      primary: 'bonded_warehouse',
      reasoning: `Cash-flow benefit (€${round(bonded.cashflowBenefitEur)}) exceeds bonded operating cost premium (€${round(bondedOpsExtra)}) for this storage duration. Bonded is the cheaper net path here.`,
    };
  }
  return {
    primary: 'standard_clearance',
    reasoning: `Bonded operating cost premium (€${round(bondedOpsExtra)}) exceeds the cash-flow benefit from deferral (€${round(bonded.cashflowBenefitEur)}) at ${bonded.bondedDays} days. Standard clearance is cheaper unless storage extends or re-export is likely.`,
  };
}

// ── Main entry point ───────────────────────────────────────────────────
function calculateQuote(input) {
  const validation = validateInput(input);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const customsValueEur = Number(input.customsValueEur);
  const linesCount = Math.max(1, Math.floor(Number(input.linesCount) || 1));
  const bondedDays = Number(input.bondedDays) || 0;
  const bondedVolumeCbm = Number(input.bondedVolumeCbm) || 1;
  const releaseStrategy = input.releaseStrategy === 're_export' ? 're_export' : 'free_circulation';
  const claimPreferential = input.claimPreferential === true;

  const duty = resolveDutyRate({
    hsCode: input.hsCode,
    originCountry: input.originCountry,
    claimPreferential,
  });
  if (!duty.ok) return { ok: false, errors: [duty.error] };

  const vat = vatForCountry(input.destinationCountry);
  if (!vat) return { ok: false, errors: [`VAT rate not found for ${input.destinationCountry}`] };

  const standard = calculateStandardClearance({
    customsValueEur,
    dutyRate: duty.rate,
    vat,
    linesCount,
  });

  const bonded = calculateBondedWarehouse({
    customsValueEur,
    dutyRate: duty.rate,
    vat,
    linesCount,
    bondedDays,
    bondedVolumeCbm,
    releaseStrategy,
  });

  const dutyEur = customsValueEur * duty.rate;
  const vatEur = (customsValueEur + dutyEur) * vat.rate;

  const recommendation = recommendRoute({
    standard,
    bonded,
    releaseStrategy,
    dutyEur,
    vatEur,
    customsValueEur,
  });

  return {
    ok: true,
    asOf: PRICING_SNAPSHOT.asOf,
    inputs: {
      customsValueEur: round(customsValueEur),
      hsCode: String(input.hsCode),
      hsChapter: duty.chapter,
      hsChapterLabel: duty.chapterLabel,
      destinationCountry: String(input.destinationCountry).toUpperCase(),
      destinationCountryName: vat.name,
      originCountry: input.originCountry ? String(input.originCountry).toUpperCase() : null,
      originName: duty.originName,
      linesCount,
      bondedDays,
      bondedVolumeCbm,
      releaseStrategy,
      claimPreferential,
    },
    duty: {
      rate: duty.rate,
      ratePercent: round(duty.rate * 100, 4),
      breakdown: duty.breakdown,
      originNotes: duty.originNotes,
      tradeDefenceMeasures: duty.tradeDefenceMeasures || [],
    },
    vat: {
      rate: vat.rate,
      ratePercent: round(vat.rate * 100, 2),
      country: vat.name,
    },
    quotes: [standard, bonded],
    recommendation,
    bondedEducation: {
      whatItIs: 'A bonded warehouse is a customs-supervised facility where goods can be stored without the duty + VAT being paid. The customs liability is suspended while the goods are inside.',
      whenItHelps: 'Re-export likely (duty/VAT never paid), slow-moving stock (defer cash outflow), seasonal goods (delay payment until close to sale), distribution hubs (consolidate onward shipping under one duty event).',
      whenItDoesntHelp: 'Goods you will sell within 30 days inside the EU — bonded fees usually exceed the cash-flow benefit. Or low-value, high-velocity SKUs where the bond + storage cost is a higher % of margin.',
      typicalMix: 'Many SME importers run a hybrid: fast-movers go through standard clearance, seasonal / inventory-heavy SKUs go through bonded. The split is a margin lever most never optimise.',
    },
    nextSteps: [
      'Book a free 15-min call to validate your HS classification and confirm the duty rate against the full 8-digit TARIC code (the chapter rate here is an estimator).',
      'Request a Binding Tariff Information (BTI) ruling from your national customs authority for high-volume SKUs — locks in the classification for 3 years across the EU.',
      'If re-export is on the table, ask about T1 transit + bonded chain — we operate this through partner warehouses in Hamburg, Rotterdam, and Gdańsk.',
    ],
    pricingSnapshot: PRICING_SNAPSHOT,
  };
}

function round(value, decimals = 2) {
  if (!Number.isFinite(value)) return 0;
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

module.exports = {
  PRICING_SNAPSHOT,
  EU_VAT,
  HS_CHAPTER_DUTY,
  ORIGIN_OVERLAYS,
  BROKERAGE_BASE_EUR,
  BROKERAGE_PER_LINE_EUR,
  BROKERAGE_CAP_EUR,
  BONDED,
  COST_OF_CAPITAL_ANNUAL,
  listCountries,
  listOrigins,
  listHsChapters,
  detectChapter,
  resolveDutyRate,
  vatForCountry,
  brokerageFee,
  validateInput,
  calculateStandardClearance,
  calculateBondedWarehouse,
  calculateQuote,
};
