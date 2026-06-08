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

// ── Tier-A coverage manifest (ADR 0020) ───────────────────────────────
//
// The envelope this calculator stands behind for the liability-bearing
// accuracy guarantee. Axis values derive from EU_VAT and HS_CHAPTER_DUTY
// — parity-tested so a country or chapter added without updating
// COVERAGE fails the test suite loudly.
//
// declaredValueCents range: €1 floor rejects zero/negative; €100M ceiling
// is the Q1 2026 underwriter-friendly initial cap. Larger shipments are
// quoted via human-in-loop (requestHumanReview at €20k+) and therefore
// fail TA-4 anyway.
const TIER_A_COVERAGE = Object.freeze({
  calculatorName: 'customs-quote',
  version: 1,
  axes: Object.freeze({
    hsChapter: { type: 'set', values: Object.freeze(Object.keys(HS_CHAPTER_DUTY)) },
    destinationCountry: { type: 'set', values: Object.freeze(Object.keys(EU_VAT)) },
    declaredValueCents: { type: 'integer-range', min: 100, max: 100_000_000_00 },
  }),
});

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
const preferential = require('./data/preferential-origin');
const M = require('./money');

function resolveDutyRate({ hsCode, originCountry, claimPreferential, mfnRateOverride, mfnRateOverrideSource, pinnedTradeDefence = null }) {
  const chapter = detectChapter(hsCode);
  if (!chapter || !HS_CHAPTER_DUTY[chapter]) {
    return {
      ok: false,
      error: `Unable to determine duty rate — provide a valid HS code (chapter must be one of: ${Object.keys(HS_CHAPTER_DUTY).join(', ')}).`,
    };
  }
  const baseEntry = HS_CHAPTER_DUTY[chapter];
  // mfnRateOverride lets the caller (typically calculateQuoteAsync after a
  // TARIC live lookup) replace the chapter-level estimate with a sub-chapter
  // rate. We keep `chapterRate` around for transparency so the result can
  // surface both numbers if they differ.
  const chapterRate = baseEntry.rate;
  const hasOverride = Number.isFinite(mfnRateOverride) && mfnRateOverride >= 0 && mfnRateOverride <= 2;
  const mfnRate = hasOverride ? mfnRateOverride : chapterRate;
  let rate = mfnRate;
  const breakdown = [{
    label: hasOverride
      ? `MFN rate for HS ${hsCode} (${mfnRateOverrideSource || 'live lookup'}; chapter estimator was ${(chapterRate * 100).toFixed(1)}%)`
      : `MFN base rate for HS chapter ${chapter} (${baseEntry.label})`,
    value: mfnRate,
  }];

  const overlay = originCountry ? ORIGIN_OVERLAYS[String(originCountry).toUpperCase()] : null;

  // Trade-defence measures (anti-dumping + countervailing) — measure-level
  // database takes precedence over the chapter-level overlay nudge.
  // Reproducibility-v2 slice 3b: when recomputing a historical plan, filter the
  // pinned AD/CVD measures from its stored snapshot instead of the live table —
  // same shared logic, so the duty (and landed total) reproduce exactly.
  const tdMatches = tradeDefence.findMeasures(
    pinnedTradeDefence ? { hsCode, originCountry, measures: pinnedTradeDefence } : { hsCode, originCountry },
  );
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

  // Preferential origin lookup — measure-level regime database.
  // When the user claims preferential AND a regime is available, the MFN
  // portion of the rate is replaced by the preferential rate. AD/CVD still
  // apply on top regardless (they are not waived by preferential origin).
  const regime = preferential.findBestRegime({
    origin: originCountry,
    hsCode,
    mfnRatePct: mfnRate * 100,
  });

  let preferentialApplied = null;
  let preferentialAvailable = null;
  if (regime && regime.mfnReplaced) {
    if (claimPreferential) {
      // Replace the MFN portion with the regime rate
      const reduction = -1 * (mfnRate - regime.rate);
      rate += reduction;
      if (rate < 0) rate = 0;
      breakdown.push({
        label: `Preferential origin claim (${regime.name}) — MFN ${(mfnRate * 100).toFixed(1)}% replaced by ${regime.ratePct.toFixed(1)}% (requires ${regime.document})`,
        value: reduction,
      });
      preferentialApplied = regime;
    } else {
      // User did not claim — surface the savings opportunity
      preferentialAvailable = regime;
    }
  } else if (regime && !regime.mfnReplaced) {
    // E.g. TR_AGRI_EXCLUDED — surface the warning regardless of claim status
    preferentialAvailable = regime;
  } else if (claimPreferential && overlay && overlay.preferential && !regime) {
    // Legacy path: overlay-flagged preferential country with no specific regime.
    // Apply the legacy discount as a safety net.
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
    mfnRate,
    chapterRate,                          // chapter-level baseline kept for transparency
    mfnSource: hasOverride ? (mfnRateOverrideSource || 'override') : 'chapter-estimator',
    breakdown,
    originName: overlay?.name || (originCountry ? `Origin ${originCountry}` : 'Unknown origin'),
    originNotes: baseNotes,
    tradeDefenceMeasures,
    preferentialApplied,
    preferentialAvailable,
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
  // Sprint BG-1 phase 2: arithmetic moves to integer cents. The public
  // shape stays in EUR floats — conversion happens at the result boundary.
  // This removes float drift on multi-step compounding (customs × duty → VAT
  // base × VAT rate) which mattered at >€1M shipment scale.
  const customsCents = M.fromEuro(customsValueEur);
  const dutyCents = M.mulRate(customsCents, dutyRate);
  const vatBaseCents = M.add(customsCents, dutyCents);
  const vatCents = M.mulRate(vatBaseCents, vat.rate);
  const brokerageCents = M.fromEuro(brokerageFee(linesCount));
  const ensCents = M.fromEuro(ENTRY_SUMMARY_DECLARATION_EUR);
  const totalCents = M.sum([customsCents, dutyCents, vatCents, brokerageCents, ensCents]);
  const landedCostCents = M.sum([customsCents, dutyCents, vatCents]);
  // effectiveLandedCostEur excludes VAT — the true P&L cost for a
  // VAT-registered importer (VAT recovered on the next return).
  const effectiveLandedCents = M.sum([customsCents, dutyCents, brokerageCents, ensCents]);

  // EUR floats at the boundary — display layer + downstream consumers.
  const dutyEur = M.toEuro(dutyCents);
  const vatEur = M.toEuro(vatCents);
  const brokerageEur = M.toEuro(brokerageCents);
  return {
    routeKey: 'standard_clearance',
    label: 'Standard import clearance',
    customsValueEur: M.toEuro(customsCents),
    dutyEur,
    dutyRate,
    vatEur,
    vatRate: vat.rate,
    vatBaseEur: M.toEuro(vatBaseCents),
    brokerageEur,
    entrySummaryDeclarationEur: ENTRY_SUMMARY_DECLARATION_EUR,
    totalEur: M.toEuro(totalCents),
    landedCostEur: M.toEuro(landedCostCents),
    effectiveLandedCostEur: M.toEuro(effectiveLandedCents),
    vatRecoverableEur: vatEur,
    breakdown: [
      { label: 'Customs value (CIF at first EU entry)', eur: M.toEuro(customsCents) },
      { label: `Import duty (${(dutyRate * 100).toFixed(2)}% × customs value)`, eur: dutyEur },
      { label: `Import VAT (${(vat.rate * 100).toFixed(1)}% × (customs value + duty), payable in ${vat.name})`, eur: vatEur },
      { label: `Customs brokerage (€${BROKERAGE_BASE_EUR} base + €${BROKERAGE_PER_LINE_EUR}/line × ${linesCount} lines, capped €${BROKERAGE_CAP_EUR})`, eur: brokerageEur },
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

  // Sprint BG-1 phase 2: bonded scenario also migrates to integer cents.
  // The conditional re-export / free-circulation branch operates on cents
  // throughout; floats only re-appear at the result boundary.
  const cbm = Math.max(0.5, Number(bondedVolumeCbm) || 1);
  const customsCents = M.fromEuro(customsValueEur);
  const setupCents = M.fromEuro(BONDED.setupFeeEur);
  // Storage = €/cbm/day × cbm × days. Float multiplication, then convert.
  const storageCents = M.fromEuro(BONDED.storagePerCbmPerDayEur * cbm * bondedDays);
  const bondCents = M.mulRate(customsCents, BONDED.bondPercentOfCustomsValue);
  const exitClearanceCents = M.fromEuro(
    releaseStrategy === 're_export' ? BONDED.reExportClearanceEur : BONDED.exitClearanceEur
  );
  const brokerageCents = M.fromEuro(brokerageFee(linesCount));
  const ensCents = M.fromEuro(ENTRY_SUMMARY_DECLARATION_EUR);

  // Cash-flow benefit: if released to free circulation, duty + VAT are paid at exit instead of on day 1.
  // For re-export, duty + VAT are NEVER paid — full saving.
  const dutyCents = M.mulRate(customsCents, dutyRate);
  const vatBaseCents = M.add(customsCents, dutyCents);
  const vatCents = M.mulRate(vatBaseCents, vat.rate);

  let dutyDueCents, vatDueCents, cashflowBenefitCents, releaseLabel;
  if (releaseStrategy === 're_export') {
    dutyDueCents = 0;
    vatDueCents = 0;
    cashflowBenefitCents = M.add(dutyCents, vatCents);
    releaseLabel = 'Re-export outside EU — duty and VAT NEVER paid (the strongest bonded use case).';
  } else {
    dutyDueCents = dutyCents;
    vatDueCents = vatCents;
    // Cost-of-capital benefit on deferred duty + VAT, prorated by storage days
    cashflowBenefitCents = M.mulRate(M.add(dutyCents, vatCents), COST_OF_CAPITAL_ANNUAL * (bondedDays / 365));
    releaseLabel = `Release into free circulation after ${bondedDays} days — duty and VAT paid at exit instead of day-1, freeing working capital.`;
  }

  const bondedOpsCostCents = M.sum([setupCents, storageCents, bondCents, exitClearanceCents, brokerageCents, ensCents]);
  const totalCashOutCents = M.sum([bondedOpsCostCents, dutyDueCents, vatDueCents]);
  const landedCostCents = M.sum([customsCents, dutyDueCents, vatDueCents]);
  // VAT recovered later when released to free circulation. For re-export
  // it's never paid in the first place, so vatRecoverableEur is 0.
  const effectiveLandedCents = M.sum([customsCents, dutyDueCents, bondedOpsCostCents]);
  // Net comparison vs standard = bonded ops cost – cashflow benefit
  const netVsStandardCents = M.sub(bondedOpsCostCents, cashflowBenefitCents);

  // EUR floats at the boundary.
  const customsValueRoundedEur = M.toEuro(customsCents);
  const setupEur = M.toEuro(setupCents);
  const storageEur = M.toEuro(storageCents);
  const bondEur = M.toEuro(bondCents);
  const exitClearance = M.toEuro(exitClearanceCents);
  const brokerageEur = M.toEuro(brokerageCents);
  const dutyDueEur = M.toEuro(dutyDueCents);
  const vatDueEur = M.toEuro(vatDueCents);
  const cashflowBenefitEur = M.toEuro(cashflowBenefitCents);
  const dutyEur = M.toEuro(dutyCents);
  const vatEur = M.toEuro(vatCents);

  const breakdown = [
    { label: 'Customs value (CIF at first EU entry, retained under bonded regime)', eur: customsValueRoundedEur },
    { label: 'Bonded entry / setup (T1 transit + warehouse intake)', eur: setupEur },
    { label: `Storage (€${BONDED.storagePerCbmPerDayEur}/cbm/day × ${cbm.toFixed(1)}cbm × ${bondedDays} days)`, eur: storageEur },
    { label: `Bond / financial guarantee (${(BONDED.bondPercentOfCustomsValue * 100).toFixed(2)}% × customs value)`, eur: bondEur },
    { label: releaseStrategy === 're_export' ? 'Re-export clearance (T2 / export declaration)' : 'Exit clearance into free circulation (release)', eur: exitClearance },
    { label: `Customs brokerage (€${BROKERAGE_BASE_EUR} base + €${BROKERAGE_PER_LINE_EUR}/line × ${linesCount} lines, capped €${BROKERAGE_CAP_EUR})`, eur: brokerageEur },
    { label: 'Entry Summary Declaration (ENS pre-arrival filing)', eur: ENTRY_SUMMARY_DECLARATION_EUR },
  ];
  if (releaseStrategy === 're_export') {
    breakdown.push({ label: 'Import duty AVOIDED (goods leave EU customs territory unreleased)', eur: -1 * dutyEur });
    breakdown.push({ label: 'Import VAT AVOIDED (goods leave EU customs territory unreleased)', eur: -1 * vatEur });
  } else {
    breakdown.push({ label: `Import duty (${(dutyRate * 100).toFixed(2)}%, paid at exit into free circulation)`, eur: dutyDueEur });
    breakdown.push({ label: `Import VAT (${(vat.rate * 100).toFixed(1)}%, paid at exit into free circulation)`, eur: vatDueEur });
    breakdown.push({ label: `Cash-flow benefit from deferral (${(COST_OF_CAPITAL_ANNUAL * 100).toFixed(0)}% annual cost-of-capital × ${bondedDays} days)`, eur: -1 * cashflowBenefitEur });
  }

  return {
    routeKey: 'bonded_warehouse',
    label: releaseStrategy === 're_export' ? 'Bonded — re-export (duty/VAT avoided)' : 'Bonded warehouse — release later',
    bondedDays,
    bondedVolumeCbm: round(cbm),
    customsValueEur: customsValueRoundedEur,
    setupFeeEur: setupEur,
    storageEur,
    bondEur,
    exitClearanceEur: exitClearance,
    brokerageEur,
    entrySummaryDeclarationEur: ENTRY_SUMMARY_DECLARATION_EUR,
    bondedOpsCostEur: M.toEuro(bondedOpsCostCents),
    dutyDueEur,
    vatDueEur,
    cashflowBenefitEur,
    totalCashOutEur: M.toEuro(totalCashOutCents),
    landedCostEur: M.toEuro(landedCostCents),
    effectiveLandedCostEur: M.toEuro(effectiveLandedCents),
    vatRecoverableEur: vatDueEur,
    netVsStandardEur: M.toEuro(netVsStandardCents),
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

// Educational + next-step blocks are shared between the sync and async paths.
// Pulled out as constants so the two entrypoints can't drift.
const BONDED_EDUCATION = {
  whatItIs: 'A bonded warehouse is a customs-supervised facility where goods can be stored without the duty + VAT being paid. The customs liability is suspended while the goods are inside.',
  whenItHelps: 'Re-export likely (duty/VAT never paid), slow-moving stock (defer cash outflow), seasonal goods (delay payment until close to sale), distribution hubs (consolidate onward shipping under one duty event).',
  whenItDoesntHelp: 'Goods you will sell within 30 days inside the EU — bonded fees usually exceed the cash-flow benefit. Or low-value, high-velocity SKUs where the bond + storage cost is a higher % of margin.',
  typicalMix: 'Many SME importers run a hybrid: fast-movers go through standard clearance, seasonal / inventory-heavy SKUs go through bonded. The split is a margin lever most never optimise.',
};

const NEXT_STEPS_STATIC = [
  'Book a free 15-min call to validate your HS classification and confirm the duty rate against the full 8-digit TARIC code (the chapter rate here is an estimator).',
  'Request a Binding Tariff Information (BTI) ruling from your national customs authority for high-volume SKUs — locks in the classification for 3 years across the EU.',
  'If re-export is on the table, ask about T1 transit + bonded chain — we operate this through partner warehouses in Hamburg, Rotterdam, and Gdańsk.',
];

function nextStepsForLiveRate(liveRateMeta) {
  const sourceLabel = liveRateMeta.sourceLabel || 'TARIC sanity-check';
  const ratePct = (liveRateMeta.rate * 100).toFixed(1);
  const cacheNote = liveRateMeta.fromCache ? ' (from cache)' : '';
  return [
    `Live ${sourceLabel} rate applied: ${ratePct}%${cacheNote}. Cross-check on the official EU TARIC portal: ${liveRateMeta.verifyUrl}`,
    NEXT_STEPS_STATIC[1],
    NEXT_STEPS_STATIC[2],
  ];
}

// Internal: orchestrates a full quote from a resolved duty + vat. Shared between
// the sync entrypoint and the TARIC-aware async one so the result shape can't
// drift between paths. Behaviour is identical to the pre-refactor inline copies.
function composeQuoteResult({
  input,
  duty,
  vat,
  customsValueEur,
  linesCount,
  bondedDays,
  bondedVolumeCbm,
  releaseStrategy,
  claimPreferential,
  liveRateMeta,
}) {
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

  // Re-derive duty + VAT in integer cents for the recommendation engine —
  // these match what calculateStandardClearance / calculateBondedWarehouse
  // computed internally (Sprint BG-1 phase 2). Float multiplication here
  // would re-introduce the drift the per-scenario migration eliminated.
  const customsCents = M.fromEuro(customsValueEur);
  const dutyEur = M.toEuro(M.mulRate(customsCents, duty.rate));
  const vatEur = M.toEuro(M.mulRate(M.add(customsCents, M.mulRate(customsCents, duty.rate)), vat.rate));

  const recommendation = recommendRoute({
    standard,
    bonded,
    releaseStrategy,
    dutyEur,
    vatEur,
    customsValueEur,
  });

  const dutyBlock = {
    rate: duty.rate,
    ratePercent: round(duty.rate * 100, 4),
    mfnRate: duty.mfnRate,
    mfnRatePercent: round((duty.mfnRate || 0) * 100, 4),
    mfnSource: duty.mfnSource || 'chapter-estimator',
    chapterRate: duty.chapterRate,
    chapterRatePercent: duty.chapterRate != null ? round(duty.chapterRate * 100, 4) : null,
    breakdown: duty.breakdown,
    originNotes: duty.originNotes,
    tradeDefenceMeasures: duty.tradeDefenceMeasures || [],
    preferentialApplied: duty.preferentialApplied || null,
    preferentialAvailable: duty.preferentialAvailable || null,
  };
  if (liveRateMeta) {
    dutyBlock.liveRateMeta = {
      source: liveRateMeta.source,
      sourceLabel: liveRateMeta.sourceLabel,
      asOf: liveRateMeta.asOf,
      fromCache: liveRateMeta.fromCache === true,
      stale: liveRateMeta.stale === true,
    };
  }

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
    duty: dutyBlock,
    vat: {
      rate: vat.rate,
      ratePercent: round(vat.rate * 100, 2),
      country: vat.name,
    },
    quotes: [standard, bonded],
    recommendation,
    bondedEducation: BONDED_EDUCATION,
    nextSteps: liveRateMeta ? nextStepsForLiveRate(liveRateMeta) : NEXT_STEPS_STATIC,
    pricingSnapshot: PRICING_SNAPSHOT,
  };
}

// Parses + validates the wizard input into the normalised numeric form both
// entrypoints use. Returns { ok: true, parsed } or { ok: false, errors }.
function parseInput(input) {
  const validation = validateInput(input);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  return {
    ok: true,
    parsed: {
      customsValueEur: Number(input.customsValueEur),
      linesCount: Math.max(1, Math.floor(Number(input.linesCount) || 1)),
      bondedDays: Number(input.bondedDays) || 0,
      bondedVolumeCbm: Number(input.bondedVolumeCbm) || 1,
      releaseStrategy: input.releaseStrategy === 're_export' ? 're_export' : 'free_circulation',
      claimPreferential: input.claimPreferential === true,
    },
  };
}

// ── Main entry point (sync) ────────────────────────────────────────────
function calculateQuote(input, opts = {}) {
  const parsed = parseInput(input);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const duty = resolveDutyRate({
    hsCode: input.hsCode,
    originCountry: input.originCountry,
    claimPreferential: parsed.parsed.claimPreferential,
    pinnedTradeDefence: opts.pinnedTradeDefence || null,
    // Reproducibility-v2 3c: a recompute can pin the original resolved MFN rate
    // (e.g. a live-TARIC HS10 rate) so the deterministic path reproduces it
    // exactly rather than falling back to the chapter estimator.
    mfnRateOverride: Number.isFinite(opts.mfnRateOverride) ? opts.mfnRateOverride : undefined,
    mfnRateOverrideSource: opts.mfnRateOverrideSource || undefined,
  });
  if (!duty.ok) return { ok: false, errors: [duty.error] };

  const vat = vatForCountry(input.destinationCountry);
  if (!vat) return { ok: false, errors: [`VAT rate not found for ${input.destinationCountry}`] };

  return composeQuoteResult({ input, duty, vat, ...parsed.parsed, liveRateMeta: null });
}

function round(value, decimals = 2) {
  if (!Number.isFinite(value)) return 0;
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

// ── TARIC-aware async wrapper ─────────────────────────────────────────
//
// Same contract as calculateQuote but runs the optional TARIC live lookup
// first. If a sub-chapter MFN rate is found, it overrides the chapter
// estimator while trade-defence + preferential-origin layers continue to
// stack on top exactly as before.
//
// Failure modes are all benign: invalid HS, upstream timeout, malformed
// response, cache miss with no network → all fall back to the synchronous
// calculateQuote behaviour. The result always tells you which path was
// taken via duty.mfnSource.
//
// Opt-in via opts.useLiveTaric (defaults true when input.hsCode looks like
// 8+ digits and originCountry is set). Callers that want the deterministic
// sync path can pass opts.useLiveTaric=false.

async function calculateQuoteAsync(input, opts = {}) {
  const taric = require('./taric-client');
  const normHs = taric.normaliseHs(input && input.hsCode);
  const normOrigin = taric.normaliseOrigin(input && input.originCountry);
  // Sprint hs-suggest-v1 — accept 6-digit (HS6) codes too, not just 8+.
  // normaliseHs already validates 6/8/10; the TARIC client resolves an
  // HS6 to its heading MFN rate via the /headings/<4-digit> fallback, so
  // a 6-digit code still beats the chapter estimate. This lets the new
  // HS-code lookup helper (which suggests globally-stable HS6 codes)
  // push wizard users onto the live-refined duty path.
  const wantLive = opts.useLiveTaric !== false && normHs && normOrigin && normHs.length >= 6;

  if (!wantLive) return calculateQuote(input, opts);

  let liveRate = null;
  try {
    liveRate = await taric.lookupHsRate(normHs, normOrigin, { skipUpstream: opts.skipUpstream === true });
  } catch (_err) {
    liveRate = null;
  }

  if (!liveRate || !Number.isFinite(liveRate.rate)) {
    // Live lookup yielded nothing — fall through to the deterministic path.
    return calculateQuote(input, opts);
  }

  const parsed = parseInput(input);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const duty = resolveDutyRate({
    hsCode: input.hsCode,
    originCountry: input.originCountry,
    claimPreferential: parsed.parsed.claimPreferential,
    mfnRateOverride: liveRate.rate,
    mfnRateOverrideSource: liveRate.sourceLabel || liveRate.source || 'live lookup',
    pinnedTradeDefence: opts.pinnedTradeDefence || null,
  });
  if (!duty.ok) return { ok: false, errors: [duty.error] };

  const vat = vatForCountry(input.destinationCountry);
  if (!vat) return { ok: false, errors: [`VAT rate not found for ${input.destinationCountry}`] };

  return composeQuoteResult({
    input,
    duty,
    vat,
    ...parsed.parsed,
    liveRateMeta: {
      source: liveRate.source,
      sourceLabel: liveRate.sourceLabel,
      asOf: liveRate.asOf,
      fromCache: liveRate.fromCache === true,
      stale: liveRate.stale === true,
      rate: liveRate.rate,
      verifyUrl: taric.taricVerifyUrl(normHs, normOrigin),
    },
  });
}

// ── Tier-A: build an EligibilityInput from a quote result ─────────────
//
// Caller pattern (handler/API layer):
//   const quote = calculateQuote(input);                 // or calculateQuoteAsync
//   const tierAInput = customs.buildTierAInput(quote);   // sync
//   const verdict = await tierA.evaluate(tierAInput);    // async
//   quote.tier_a = verdict;
//
// Why this shape: keeps calculateQuote sync (no behaviour change for
// any existing caller), and confines the async KV read (TA-3 green
// stamp lookup) to handler-layer code that already lives in async
// contexts. The TA-2 source_kind semantics:
//   - PRICING_SNAPSHOT rows (our chapter-rate + VAT card)  → 'mirror'
//   - liveRateMeta from TARIC API (when calculateQuoteAsync ran)
//                                                         → 'primary_regulator'
// Only quotes that ran calculateQuoteAsync with a successful live
// TARIC lookup will satisfy TA-2. This is intentional per ADR 0020:
// Tier-A only applies when we've called the primary regulator and
// pinned its answer. The chapter-rate card is a fast estimator, not
// a primary source.

/**
 * @param {object} quoteResult — output of calculateQuote / calculateQuoteAsync
 * @returns {object} EligibilityInput shape for tierA.evaluate()
 */
function buildTierAInput(quoteResult) {
  if (!quoteResult || quoteResult.ok !== true) {
    // Caller passed a failed quote — Tier-A cannot apply, but we still
    // return a well-shaped input so evaluate() reports a coherent failure
    // (OUTSIDE_COVERAGE) rather than throwing.
    return {
      calculatorName: TIER_A_COVERAGE.calculatorName,
      snapshots: [],
      escalations: [],
      overrides: [],
      coverageInput: {},
      calculatorCoverage: TIER_A_COVERAGE,
    };
  }

  const snapshots = [];

  // PRICING_SNAPSHOT — our internal rate-card view. Honest source_kind:
  // 'mirror'. Even if every other precondition passed, TA-2 fails here
  // unless a primary-regulator snapshot is also present.
  snapshots.push({
    id: `customs-quote:pricing@${PRICING_SNAPSHOT.asOf}`,
    source_kind: 'mirror',
    as_of_iso: toIsoStartOfDay(PRICING_SNAPSHOT.asOf),
  });

  // liveRateMeta — if the async path ran and TARIC returned a rate, the
  // duty number on this quote came from the primary regulator. This is
  // the only path to TA-2 passing today.
  const live = quoteResult.duty && quoteResult.duty.liveRateMeta;
  if (live && live.asOf) {
    snapshots.push({
      id: `taric-live:${quoteResult.inputs && quoteResult.inputs.hsCode}@${live.asOf}`,
      source_kind: 'primary_regulator',
      as_of_iso: toIsoSafe(live.asOf),
    });
  }

  // Coverage axis inputs — read straight off the quote's inputs block.
  const hsChapter = (quoteResult.inputs && quoteResult.inputs.hsChapter) || null;
  const destinationCountry = (quoteResult.inputs && quoteResult.inputs.destinationCountry) || null;
  const valueEur = (quoteResult.inputs && quoteResult.inputs.customsValueEur) || 0;
  const declaredValueCents = Math.round(Number(valueEur) * 100);

  return {
    calculatorName: TIER_A_COVERAGE.calculatorName,
    snapshots,
    escalations: [],
    overrides: [],
    coverageInput: {
      hsChapter,
      destinationCountry,
      declaredValueCents,
    },
    calculatorCoverage: TIER_A_COVERAGE,
  };
}

// Both helpers tolerate the two PRICING_SNAPSHOT.asOf shapes used in
// this codebase: 'YYYY-MM-DD' (most calculators) and full ISO strings
// (TARIC live responses). The output is always ISO-8601 with a Z suffix.

/** @param {string} ymd */
function toIsoStartOfDay(ymd) {
  if (typeof ymd !== 'string') return new Date(0).toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return `${ymd}T00:00:00.000Z`;
  return toIsoSafe(ymd);
}

/** @param {string} maybeIso */
function toIsoSafe(maybeIso) {
  if (typeof maybeIso !== 'string') return new Date(0).toISOString();
  const t = Date.parse(maybeIso);
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date(0).toISOString();
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
  TIER_A_COVERAGE,
  buildTierAInput,
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
  calculateQuoteAsync,
};
