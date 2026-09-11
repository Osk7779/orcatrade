// @ts-check
'use strict';

// Import-Request Orchestrator — the Operator wedge's load-bearing flow.
//
// L1.0 of docs/strategic-plan-2026-2031.md §4.1.2. Reads a customer's
// submitted import_request, runs the calculator stack to produce a
// factory shortlist + a landed-cost quote, and atomically attaches
// both to the row (transitioning submitted → processing →
// awaiting_review).
//
// Calculator-grounding contract (ADR 0002):
//   The orchestrator NEVER lets an LLM produce a number that drives a
//   decision. Every monetary value in `landedQuote.components` traces
//   to a `lib/intelligence/*-quote.js` calculator. The natural-language
//   layer (sprint 2) will write prose on TOP of these numbers with
//   [chunk-id] citations — but v1 ships the structured numbers without
//   LLM prose because (a) the structured surface is enough for the
//   customer to make a decision, (b) adding Opus prose now adds latency
//   and cost without changing the decision payload, (c) the team review
//   step is where ambiguity gets resolved in v1 anyway.
//
// Tool-stub posture (ADR 0015):
//   This file does real work. It calls the production calculators with
//   real inputs derived from the customer's intent and reports honest
//   confidence signals (Tier B in v1 because the supplier shortlist is
//   anonymised samples from sourcing-quote.shortlistSuppliers, not a
//   verified factory graph — Layer 2 of the billion-dollar direction
//   replaces that). No placeholder `confidence: 0.0` returns.
//
// Failure mode: any unrecoverable error transitions the row to 'failed'
// with the reason in failure_state, surfaced to the team console.
//
// Anthropic SDK boundary (ADR 0003): this file lives in lib/ai/ and is
// the only allowed home for any future Claude calls in this flow.

const importRequestsDb = require('../db/import-requests');
const shipmentsDb = require('../db/shipments');
const goodsDb = require('../db/goods');
const suppliersDb = require('../db/suppliers');
const sourcingQuote = require('../intelligence/sourcing-quote');
const customsQuote = require('../intelligence/customs-quote');
const routingQuote = require('../intelligence/routing-quote');
const financeQuote = require('../intelligence/finance-quote');
const hsCodeLookup = require('../intelligence/hs-code-lookup');
const { determineCbamApplicability } = require('../intelligence/cbam-analysis');
const { determineEudrApplicability } = require('../intelligence/eudr-analysis');
const { determineReachApplicability } = require('../intelligence/reach-analysis');
const categoryClassifier = require('./category-classifier');
const quoteProse = require('./quote-prose');
const log = require('../log').withContext({ module: 'ai-import-request-orchestrator' });

// ── Product → category classification ────────────────────────────────
//
// The sourcing/customs/routing calculators want one of 8 closed-taxonomy
// categories. The customer's product_description is free text. v1 uses
// a deterministic keyword classifier; v2 swaps in Claude Haiku
// (MODELS.TRIAGE) for fuzzy matching with a fallback to this table.
//
// Order matters — earlier entries win on tie. 'homeware' is the
// fallback because it has the broadest applicability and the lowest
// risk of misclassifying a high-stakes category (e.g. cosmetics, toys).

const CATEGORY_KEYWORDS = Object.freeze({
  apparel: ['apparel', 'clothing', 'clothes', 'garment', 'shirt', 't-shirt', 'jacket', 'coat', 'dress', 'trousers', 'jeans', 'hoodie', 'textile', 'fabric', 'knit', 'woven', 'sock'],
  electronics: ['electronic', 'electronics', 'usb', 'charger', 'cable', 'adapter', 'pcb', 'circuit', 'speaker', 'headphone', 'earbud', 'led', 'sensor', 'arduino', 'raspberry', 'battery', 'powerbank', 'router', 'modem'],
  furniture: ['furniture', 'sofa', 'couch', 'chair', 'table', 'desk', 'cabinet', 'wardrobe', 'shelf', 'shelving', 'bed', 'mattress', 'bookcase', 'dresser', 'stool'],
  toys: ['toy', 'toys', 'doll', 'figurine', 'plush', 'stuffed', 'puzzle', 'lego', 'board game', 'children', 'kids'],
  cosmetics: ['cosmetic', 'cosmetics', 'cream', 'lotion', 'serum', 'makeup', 'lipstick', 'mascara', 'foundation', 'shampoo', 'conditioner', 'soap', 'fragrance', 'perfume', 'skincare', 'beauty'],
  footwear: ['shoe', 'shoes', 'boot', 'boots', 'sandal', 'sneaker', 'trainer', 'footwear', 'slipper', 'heel'],
  machinery: ['machine', 'machinery', 'equipment', 'tool', 'tools', 'drill', 'motor', 'pump', 'compressor', 'generator', 'industrial', 'workshop', 'cnc', 'lathe'],
  homeware: ['homeware', 'kitchen', 'utensil', 'mat', 'pot', 'pan', 'cookware', 'tableware', 'cutlery', 'storage', 'organiser', 'organizer', 'container', 'home', 'decor', 'candle', 'vase'],
});

const CATEGORIES = Object.freeze(/** @type {const} */ ([
  'apparel', 'electronics', 'furniture', 'toys', 'cosmetics', 'footwear', 'machinery', 'homeware',
]));

/**
 * Classify a free-text product description into the closed taxonomy.
 * Returns the category plus a hit-score so we can be honest about
 * confidence (a zero-hit classification falls back to 'homeware' and
 * gets flagged in the quote's confidenceNotes).
 *
 * @param {string} text
 * @returns {{ category: typeof CATEGORIES[number], hits: number, matched: string[] }}
 */
function classifyProductCategory(text) {
  const lower = String(text || '').toLowerCase();
  /** @type {{ category: typeof CATEGORIES[number], hits: number, matched: string[] }} */
  let best = { category: 'homeware', hits: 0, matched: [] };
  for (const cat of CATEGORIES) {
    const keywords = CATEGORY_KEYWORDS[cat];
    const matched = keywords.filter((k) => lower.includes(k));
    if (matched.length > best.hits) {
      best = { category: cat, hits: matched.length, matched };
    }
  }
  return best;
}

// ── Heuristics for deriving calculator inputs from customer intent ───
//
// The customer states a TARGET LANDED unit price. The sourcing
// calculator wants FOB. Industry rule-of-thumb: FOB ≈ 55% of landed
// for SME-scale EU-from-Asia. The team review step is where this gets
// corrected — for v1 it's a credible starting point.
//
// All approximations are explicit and audit-trail-friendly so the team
// console can show the team "we estimated FOB at X% of landed because…"

const FOB_TO_LANDED_RATIO = 0.55;

/**
 * Typical kg/unit ratios per category — used to estimate shipment weight
 * for the routing calculator when the customer didn't supply it. These
 * are order-of-magnitude. Override via metadata.weightKgPerUnit.
 */
const KG_PER_UNIT_BY_CATEGORY = Object.freeze({
  apparel: 0.25,
  electronics: 0.4,
  furniture: 15,
  toys: 0.3,
  cosmetics: 0.2,
  footwear: 0.8,
  machinery: 12,
  homeware: 0.6,
});

/**
 * Default urgency in weeks when the customer didn't supply a target
 * delivery date. 8 weeks ≈ typical sea-freight EU-from-Asia lead time
 * including production. We round up to be conservative.
 */
const DEFAULT_URGENCY_WEEKS = 8;

/**
 * OrcaTrade managed-import take-rate. v1 is a single flat percentage
 * applied to the cargo customs value. Layer 2 of the billion-dollar
 * direction breaks this into broker + IOR + FX + finance lines; v1
 * keeps it as one transparent line so the customer sees what they're
 * paying for.
 *
 * Override via env var ORCATRADE_OPERATOR_FEE_PCT (string of percent).
 * Sourced from env at call time so a deploy can adjust without a code
 * change.
 */
function orcatradeFeePct() {
  const raw = process.env.ORCATRADE_OPERATOR_FEE_PCT;
  // Distinguish "unset / empty" from explicit '0' — Number('') is 0,
  // which would silently swallow an empty env var and bill the customer
  // €0 instead of the default 8%. Reject empty before parsing.
  if (raw === undefined || raw === null || String(raw).trim() === '') return 8;
  const parsed = Number(String(raw).trim());
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 30) return parsed;
  return 8;
}

// ── Numerics — integer cents discipline at the boundary (ADR 0004) ──

/** @param {number} eur */
function toCents(eur) {
  if (!Number.isFinite(eur)) return 0;
  return Math.round(eur * 100);
}

/** @param {number} cents */
function fromCents(cents) {
  return Number(cents) / 100;
}

// ── Failure transition helper ────────────────────────────────────────

/**
 * Transition the request to 'failed' with a structured reason. Returns
 * the failed-state result so the orchestrator can propagate.
 *
 * @param {{ orgId: number, externalId: string, actorEmailHash: string, code: string, reason: string, recoverable?: boolean }} args
 */
async function transitionToFailed({ orgId, externalId, actorEmailHash, code, reason, recoverable = false }) {
  const result = await importRequestsDb.transitionImportRequestStatus({
    orgId,
    externalId,
    actorEmailHash,
    toStatus: 'failed',
    details: {
      code,
      reason,
      occurredAt: new Date().toISOString(),
      recoverable,
    },
  });
  if (!result.ok) {
    // Best-effort — if even the failure transition fails we still want
    // to log the original cause so it surfaces in the audit trail.
    log.error('failed-state transition itself failed', {
      externalId, code, reason, transitionError: result.errors,
    });
  }
  return { ok: false, errors: [reason], code };
}

// ── Calculator orchestration ─────────────────────────────────────────

/**
 * Build the factory_shortlist payload by combining the recommended
 * country with sample suppliers from the sourcing calculator. For each
 * top-3 country in the comparison, attach the (anonymised) sample
 * supplier list. The honesty flag is explicit: v1 surfaces these as
 * 'unverified_ai_sample', NOT verified factory profiles.
 *
 * @param {object} args
 * @param {any} args.recommendation - sourcing-quote.recommendCountry result
 * @param {typeof CATEGORIES[number]} args.productCategory
 * @param {number} args.classifierHits
 * @param {'haiku' | 'keyword'} [args.classifierSource]
 * @param {Record<string, { count: number, lastPickedAt: string, rationaleCategoryMix: Record<string, number> }> | null | undefined} [args.pastPicksByCountry]
 *   Sprint 28 — per-country pick history from aggregateSupplierPicks. Surfaces
 *   on each shortlist entry as a learning signal badge.
 */
function buildFactoryShortlist({ recommendation, productCategory, classifierHits, classifierSource, pastPicksByCountry }) {
  /** @type {any[]} */
  const comparison = Array.isArray(recommendation && recommendation.comparison)
    ? recommendation.comparison
    : [];
  // Top 3 countries by the recommendation's own ranking.
  const topCountries = comparison.slice(0, 3);
  // Sprint 28 — the learning signal. pastPicksByCountry is a map
  // country → { count, lastPickedAt, rationaleCategoryMix } produced
  // by aggregateSupplierPicks. Each shortlist entry attaches the
  // matching record if any, surfacing as a badge on the UI. The
  // shortlist is still ranked by the sourcing-quote's own scoring;
  // we don't RE-RANK based on history because picks could be
  // coincidental (one customer with weird preferences), but we DO
  // surface the signal so ops sees it.
  const picks = (pastPicksByCountry && typeof pastPicksByCountry === 'object') ? pastPicksByCountry : {};
  const shortlist = topCountries.map((/** @type {any} */ c, /** @type {number} */ idx) => {
    const sampleResult = /** @type {any} */ (sourcingQuote.shortlistSuppliers({
      productCategory,
      country: c.country,
    }));
    /** @type {any[]} */
    const samples = Array.isArray(sampleResult && sampleResult.suppliers) ? sampleResult.suppliers : [];
    const countryUpper = String(c.country || '').toUpperCase();
    const past = picks[countryUpper] || null;
    return {
      rank: idx + 1,
      country: c.country,
      countryRationale: c.rationale || null,
      fobIndex: typeof c.fobIndex === 'number' ? c.fobIndex : null,
      leadTimeWeeks: typeof c.leadTimeWeeks === 'number' ? c.leadTimeWeeks : null,
      qualityRisk: c.qualityRisk || null,
      ipRisk: c.ipRisk || null,
      // The candidates themselves. Each carries an explicit
      // verification_status so the UI can render "Awaiting team
      // verification" rather than "Verified supplier".
      candidates: samples.map((/** @type {any} */ s) => ({
        ...s,
        verificationStatus: 'unverified_ai_sample',
        verificationNote: sampleResult.note,
        recommendation: idx === 0 ? 'top_pick' : 'alternative',
      })),
      candidateCount: samples.length,
      // Sprint 28 — historical signal. null when the team has never
      // picked this country for this HS prefix in the window.
      pastPickSignal: past ? {
        count: past.count,
        lastPickedAt: past.lastPickedAt,
        rationaleCategoryMix: past.rationaleCategoryMix || {},
      } : null,
    };
  });
  return {
    shortlist,
    methodology: {
      version: 'v1.2',
      classifier: 'category-classifier-v1',
      classifierSource: classifierSource || 'keyword',
      classifierHits,
      countriesEvaluated: comparison.map((/** @type {any} */ c) => c.country),
      sampleSource: 'sourcing-quote.shortlistSuppliers (anonymised)',
      pastPickSource: pastPicksByCountry ? 'aggregateSupplierPicks (90d window)' : null,
    },
  };
}

/**
 * Build the landed-cost quote by stacking the customs + routing +
 * finance calculator outputs and adding the OrcaTrade take-rate as a
 * separate transparent line. Every value is integer cents at this
 * boundary (ADR 0004); the calculator outputs are EUR floats and we
 * convert here.
 *
 * @param {object} args
 * @param {string} args.hsCode
 * @param {string} args.originCountry
 * @param {string} args.destinationCountry
 * @param {number} args.customsValueEur
 * @param {number} args.targetQuantity
 * @param {typeof CATEGORIES[number]} args.productCategory
 * @param {number} args.urgencyWeeks
 * @param {object} [args.hsClassification] - hs-code-lookup output for the methodology block + live MFN rate
 */
function buildLandedQuote({
  hsCode, originCountry, destinationCountry,
  customsValueEur, targetQuantity, productCategory, urgencyWeeks,
  hsClassification,
}) {
  /** @type {{ component: string, label: string, eur: number, source: string, note?: string }[]} */
  const lines = [];
  /** @type {string[]} */
  const warnings = [];

  // Live MFN-rate override from the HS lookup, when available. Passes
  // through to customs-quote so the chapter estimator is bypassed and
  // the duty number traces to a UK Trade Tariff fetch + 7d KV cache.
  /** @type {{ mfnRateOverride?: number, mfnRateOverrideSource?: string }} */
  const customsOpts = {};
  const hsLive = /** @type {any} */ (hsClassification);
  if (hsLive && hsLive.dutyEstimate && Number.isFinite(hsLive.dutyEstimate.rate)) {
    customsOpts.mfnRateOverride = hsLive.dutyEstimate.rate;
    customsOpts.mfnRateOverrideSource = hsLive.dutyEstimate.source || 'hs-code-lookup-mfn';
  }

  // 1) Customs duty + VAT.
  const customsResult = /** @type {any} */ (customsQuote.calculateQuote({
    hsCode,
    originCountry,
    destinationCountry,
    customsValueEur,
    linesCount: 1,
  }, customsOpts));
  if (!customsResult.ok) {
    warnings.push(`customs-quote: ${(customsResult.errors || ['unknown'])[0]}`);
  } else {
    // customs-quote returns the per-route breakdown under quotes[];
    // we pick the standard-clearance route (the v1 take-rate model
    // does not own bonded storage logic). Sprint 10 fix: reading
    // customsResult.totals returned undefined since sprint 1, so
    // duty/VAT/brokerage were silently 0 on every customer quote
    // until now.
    const quotes = Array.isArray(customsResult.quotes) ? customsResult.quotes : [];
    const standard = quotes.find((/** @type {any} */ q) => q && q.routeKey === 'standard_clearance' && q.unavailable !== true)
      || quotes.find((/** @type {any} */ q) => q && q.unavailable !== true)
      || {};
    const dutyEur = Number(standard.dutyEur) || 0;
    const vatEur = Number(standard.vatEur) || 0;
    const brokerageEur = Number(standard.brokerageEur) || 0;
    const ensEur = Number(standard.entrySummaryDeclarationEur) || 0;
    lines.push({ component: 'duty', label: 'EU import duty', eur: dutyEur, source: 'customs-quote', note: `HS ${hsCode}, origin ${originCountry}` });
    lines.push({ component: 'vat', label: `${destinationCountry} import VAT`, eur: vatEur, source: 'customs-quote' });
    lines.push({ component: 'brokerage', label: 'Customs broker fee', eur: brokerageEur + ensEur, source: 'customs-quote', note: ensEur > 0 ? `Includes €${ensEur.toFixed(0)} entry summary declaration` : undefined });
  }

  // 2) Freight.
  const weightKg = Math.max(50, Math.round((KG_PER_UNIT_BY_CATEGORY[productCategory] || 0.5) * targetQuantity));
  // Sea freight CBM volume estimate: ~6 m³ per metric tonne is a rough
  // industry mean for SME mixed cargo (lighter than this for clothing,
  // denser for machinery — close enough for the routing calc).
  const volumeCbm = Math.max(0.5, (weightKg / 1000) * 6);
  const urgencyDays = Math.max(7, urgencyWeeks * 7);
  const routingResult = /** @type {any} */ (routingQuote.calculateQuote({
    weightKg, volumeCbm, originCountry, destinationCountry, urgencyDays,
  }));
  if (!routingResult.ok) {
    warnings.push(`routing-quote: ${(routingResult.errors || ['unknown'])[0]}`);
  } else {
    // routing-quote nests its recommended mode under
    // recommendation.primaryQuote — sprint 10 fix: sprint 1 read
    // rec.totalEur directly which always returned undefined.
    const rec = (routingResult.recommendation && routingResult.recommendation.primaryQuote) || {};
    const freightEur = Number(rec.totalEur) || 0;
    lines.push({
      component: 'freight',
      label: `Freight (${rec.mode || 'sea_lcl'}, ${originCountry}→${destinationCountry})`,
      eur: freightEur,
      source: 'routing-quote',
      note: `~${weightKg} kg, ~${volumeCbm.toFixed(1)} CBM, ${urgencyDays}-day target`,
    });
  }

  // 3) Trade-finance cost (LC or comparable instrument).
  const financeResult = /** @type {any} */ (financeQuote.comparePaymentInstruments({
    amountEur: customsValueEur,
    supplierCountry: originCountry,
    supplierRelationshipMonths: 0,
    importerRiskAppetite: 'balanced',
  }));
  if (!financeResult.ok) {
    warnings.push(`finance-quote: ${(financeResult.errors || ['unknown'])[0]}`);
  } else {
    // finance-quote nests under recommendation.instrument with a
    // totalCostEur field — sprint 10 fix: sprint 1 read
    // rec.estimatedCostEur which never existed.
    const instr = (financeResult.recommendation && financeResult.recommendation.instrument) || {};
    const financeEur = Number(instr.totalCostEur) || 0;
    if (financeEur > 0) {
      lines.push({
        component: 'finance',
        label: `Trade finance (${instr.label || instr.key || 'lc'})`,
        eur: financeEur,
        source: 'finance-quote',
        note: instr.description || undefined,
      });
    }
  }

  // 4) OrcaTrade managed-import take-rate.
  const feePct = orcatradeFeePct();
  const orcatradeFeeEur = customsValueEur * (feePct / 100);
  lines.push({
    component: 'orcatrade_managed_import_fee',
    label: `OrcaTrade managed-import service (${feePct}%)`,
    eur: orcatradeFeeEur,
    source: 'orcatrade-take-rate-v1',
    note: 'Sourcing + RFQ + factory comms + customs broker handoff + freight booking + landed-cost guarantee. One invoice, one accountable party.',
  });

  // Totals.
  const goodsEur = customsValueEur;
  const totalLandedEur = goodsEur + lines.reduce((acc, l) => acc + l.eur, 0);

  // Confidence tier (ADR 0020).
  //   Tier A = liability-bearing
  //   Tier B = calculator-grounded but with v1 caveats (supplier shortlist
  //          is anonymised samples, FOB derived from landed estimate)
  //   Tier C = mostly heuristic
  // Drop a tier if the HS classification is low/none — the duty number
  // depends on the HS, so weak HS confidence taints the whole quote.
  const hsTier = hsLive && typeof hsLive.confidenceTier === 'string' ? hsLive.confidenceTier : 'unknown';
  if (hsTier === 'low') warnings.push('HS classification confidence is LOW — team review must verify before this quote ships to the customer.');
  if (hsTier === 'none') warnings.push('HS classification could not be determined from the product description — team review must set it manually.');
  const tier = warnings.length === 0 ? 'B' : 'C';

  return {
    components: lines.map((l) => ({
      component: l.component,
      label: l.label,
      eurCents: toCents(l.eur),
      source: l.source,
      note: l.note || null,
    })),
    cargoValueCents: toCents(goodsEur),
    totalLandedCents: toCents(totalLandedEur),
    orcatradeFeeCents: toCents(orcatradeFeeEur),
    orcatradeFeePct: feePct,
    currency: 'EUR',
    confidenceTier: tier,
    confidenceNotes: warnings,
    methodology: {
      version: 'v1.1',
      fobToLandedRatio: FOB_TO_LANDED_RATIO,
      weightKgEstimated: weightKg,
      volumeCbmEstimated: Number(volumeCbm.toFixed(2)),
      urgencyDays,
      customsCalculatorOk: customsResult.ok === true,
      routingCalculatorOk: routingResult.ok === true,
      financeCalculatorOk: financeResult.ok === true,
      hsClassification: hsLive ? {
        hs6: hsLive.suggestion ? hsLive.suggestion.hs6 : null,
        label: hsLive.suggestion ? hsLive.suggestion.label : null,
        chapter: hsLive.suggestion ? hsLive.suggestion.chapter : null,
        confidenceTier: hsLive.confidenceTier || 'unknown',
        confidence: typeof hsLive.confidence === 'number' ? hsLive.confidence : null,
        verifyUrl: hsLive.verifyUrl || null,
        dutyEstimate: hsLive.dutyEstimate || null,
        source: 'lib/intelligence/hs-code-lookup.js (ADR 0016)',
      } : null,
    },
    customsCalculatorRaw: customsResult.ok ? { totals: customsResult.totals, duty: customsResult.duty, vat: customsResult.vat } : null,
    routingCalculatorRaw: routingResult.ok ? { recommendation: routingResult.recommendation, quotes: routingResult.quotes } : null,
    financeCalculatorRaw: financeResult.ok ? { recommendation: financeResult.recommendation } : null,
  };
}

// ── Public entry point ───────────────────────────────────────────────

/**
 * Run the orchestrator for a single import request.
 *
 * Returns:
 *   { ok: true, importRequest } on success — row is now in
 *     'awaiting_review' with shortlist + quote attached.
 *   { ok: false, errors, code } on failure — row is in 'failed'
 *     state with the reason in failure_state.
 *
 * Concurrency note: this function reads-then-writes the row; the
 * conditional UPDATEs in the data layer reject concurrent transitions
 * with conflict:true so two orchestrator runs racing on the same row
 * end with one success and one no-op conflict.
 *
 * @param {{ orgId: number, externalId: string, actorEmailHash: string }} input
 */
// ── Sprint 10: standalone "what-if" calculator path ─────────────────
//
// Reuses the same HS-lookup + compliance-probe + buildLandedQuote
// pipeline as runOrchestrator, but takes the inputs DIRECTLY (no
// import_request read, no orchestrator state machine, no persistence,
// no LLM prose). The handler at POST /api/imports/<id>/whatif builds
// the inputs by overlaying override fields onto the persisted intent,
// then calls this function. Always async-safe + fail-soft on HS
// lookup (falls back to '999999' sentinel).
//
// Calculator-grounding contract (ADR 0002) preserved: nothing here
// invokes a model, every monetary value traces to a calculator.

/**
 * @param {{
 *   productCategory: string,
 *   productDescription: string,
 *   originCountry: string,
 *   destinationCountry: string,
 *   targetQuantity: number,
 *   targetUnitPriceCents?: number | null,
 *   hsCodeGuess?: string | null,
 *   urgencyWeeks?: number,
 * }} input
 */
async function computeWhatIfQuote({
  productCategory,
  productDescription,
  originCountry,
  destinationCountry,
  targetQuantity,
  targetUnitPriceCents,
  hsCodeGuess,
  urgencyWeeks,
}) {
  const effectiveUrgencyWeeks = Number.isFinite(urgencyWeeks) && /** @type {number} */ (urgencyWeeks) > 0
    ? /** @type {number} */ (urgencyWeeks)
    : DEFAULT_URGENCY_WEEKS;
  const safeQuantity = Number.isInteger(targetQuantity) && targetQuantity > 0 ? targetQuantity : 1000;
  const targetLandedUnitEur = Number.isFinite(Number(targetUnitPriceCents))
    ? fromCents(Number(targetUnitPriceCents))
    : 10;
  const targetFobUnitEur = targetLandedUnitEur * FOB_TO_LANDED_RATIO;
  const customsValueEur = safeQuantity * targetFobUnitEur;
  const safeOrigin = String(originCountry || 'CN').toUpperCase();
  const safeDestination = String(destinationCountry || 'DE').toUpperCase();

  // HS resolution — same fallback chain as runOrchestrator: customer
  // guess wins; otherwise we try the curated lookup; otherwise we drop
  // to the '999999' sentinel and mark the quote Tier C via the lookup
  // confidence path inside buildLandedQuote.
  /** @type {any} */
  let hsClassification = null;
  let hsCode = hsCodeGuess || '';
  try {
    hsClassification = /** @type {any} */ (await hsCodeLookup.lookupHsCode({
      productDescription, originCountry: safeOrigin,
    }));
    if (!hsCode && hsClassification && hsClassification.suggestion && hsClassification.suggestion.hs6) {
      hsCode = hsClassification.suggestion.hs6;
    }
  } catch (err) {
    log.warn('what-if HS lookup failed; falling back to sentinel', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  if (!hsCode) hsCode = '999999';

  const landedQuote = /** @type {any} */ (buildLandedQuote({
    hsCode,
    originCountry: safeOrigin,
    destinationCountry: safeDestination,
    customsValueEur,
    targetQuantity: safeQuantity,
    productCategory: /** @type {any} */ (productCategory),
    urgencyWeeks: effectiveUrgencyWeeks,
    hsClassification,
  }));

  const probes = runComplianceProbes({
    productCategory,
    productDescription,
    originCountry: safeOrigin,
    hsCode,
  });
  landedQuote.complianceProbes = buildLandedQuoteComplianceBlock({
    probes,
    productCategory,
  });

  return {
    landedQuote,
    hsClassification,
    complianceProbes: landedQuote.complianceProbes,
    appliedInputs: {
      productCategory,
      originCountry: safeOrigin,
      destinationCountry: safeDestination,
      targetQuantity: safeQuantity,
      targetUnitPriceCents: targetUnitPriceCents == null ? null : Number(targetUnitPriceCents),
      hsCode,
      hsSource: hsCodeGuess ? 'customer_override' : (hsClassification && hsClassification.suggestion ? 'ai_lookup' : 'sentinel'),
      urgencyWeeks: effectiveUrgencyWeeks,
    },
  };
}

/**
 * Run the orchestrator for a single import request.
 *
 * Returns:
 *   { ok: true, importRequest } on success — row is now in
 *     'awaiting_review' with shortlist + quote attached.
 *   { ok: false, errors, code } on failure — row is in 'failed'
 *     state with the reason in failure_state.
 *
 * @param {{ orgId: number, externalId: string, actorEmailHash: string }} input
 */
async function runOrchestrator({ orgId, externalId, actorEmailHash }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'], code: 'bad_input' };
  }

  // 1) Read the request.
  const readResult = /** @type {any} */ (await importRequestsDb.getImportRequestByExternalId({ orgId, externalId }));
  if (!readResult.ok) {
    if (readResult.notFound) return { ok: false, errors: ['not_found'], code: 'not_found' };
    return { ok: false, errors: readResult.errors || ['read failed'], code: 'read_failed' };
  }
  const request = readResult.importRequest;

  // Only act on requests in 'submitted' state. Anything else is a no-op
  // (or, for 'processing', a likely concurrent run we should not duplicate).
  if (request.status !== 'submitted') {
    return {
      ok: false,
      errors: [`request status is '${request.status}', orchestrator only runs on 'submitted'`],
      code: 'wrong_state',
    };
  }

  // 2) Transition submitted → processing. Reserves the row so a parallel
  //    run sees status='processing' and bails on the wrong_state check.
  const proc = /** @type {any} */ (await importRequestsDb.transitionImportRequestStatus({
    orgId,
    externalId,
    actorEmailHash,
    toStatus: 'processing',
    details: { startedAt: new Date().toISOString(), orchestratorVersion: 'v1.0' },
  }));
  if (!proc.ok) {
    return { ok: false, errors: proc.errors || ['process transition failed'], code: 'process_transition_failed' };
  }

  // 3) Derive calculator inputs from intent.
  //    Sprint 4 ch 2: try Haiku-backed classifier first (sub-second,
  //    fuzzy semantic match). Falls back to the deterministic keyword
  //    classifier on any failure path (no API key, kill-switch,
  //    network, parse error). The `source` discriminator on the result
  //    flows into the shortlist methodology so the team console can
  //    show which path won.
  const aiClassification = /** @type {any} */ (await categoryClassifier.classifyCategoryAsync({
    productDescription: request.productDescription,
    actorEmailHash,
    fallbackClassify: classifyProductCategory,
  }));
  const classification = {
    category: aiClassification.category,
    hits: Number.isFinite(aiClassification.fallbackKeywordHits) ? aiClassification.fallbackKeywordHits : 0,
    matched: [],
    source: aiClassification.source, // 'haiku' | 'keyword'
    fallbackReason: aiClassification.reason || null,
  };
  const targetQuantity = Number.isInteger(request.targetQuantity) && request.targetQuantity > 0
    ? request.targetQuantity
    : 1000; // v1 fallback for "I don't know the quantity yet" — explicit so team review can correct
  const targetLandedUnitEur = Number.isFinite(Number(request.targetUnitPriceCents))
    ? fromCents(Number(request.targetUnitPriceCents))
    : 10; // v1 fallback when no target price given
  const targetFobUnitEur = targetLandedUnitEur * FOB_TO_LANDED_RATIO;
  const customsValueEur = targetQuantity * targetFobUnitEur;
  const originCountry = (request.originCountry || 'CN').toUpperCase();
  const destinationCountry = String(request.destinationCountry || 'DE').toUpperCase();
  let urgencyWeeks = DEFAULT_URGENCY_WEEKS;
  if (request.targetDeliveryDate) {
    const target = new Date(String(request.targetDeliveryDate));
    if (!Number.isNaN(target.getTime())) {
      const now = new Date();
      const days = Math.max(7, Math.round((target.getTime() - now.getTime()) / 86400000));
      urgencyWeeks = Math.max(1, Math.round(days / 7));
    }
  }

  // 4a) HS-code classification (ADR 0016) — deterministic suggestion from
  //     the curated 120-entry HS6 map + opt-in live MFN-rate enrichment
  //     from the UK Trade Tariff feed when an origin is set. Customer's
  //     own guess (when supplied) WINS so they can override.
  //
  //     Failure modes are benign: a 'none'-tier lookup falls through to
  //     a sentinel HS that the team must replace at review time. The
  //     warning rides on landed_quote.confidenceNotes so the team UI
  //     surfaces it as a blocker before the customer sees the quote.
  /** @type {any} */
  let hsClassification = null;
  let hsCode = request.hsCodeGuess || '';
  try {
    hsClassification = /** @type {any} */ (await hsCodeLookup.lookupHsCode({
      productDescription: request.productDescription,
      originCountry,
    }));
    if (!hsCode && hsClassification && hsClassification.suggestion && hsClassification.suggestion.hs6) {
      hsCode = hsClassification.suggestion.hs6;
    }
  } catch (err) {
    log.warn('hs-code-lookup failed; falling back to sentinel HS', {
      externalId, err: err instanceof Error ? err.message : String(err),
    });
  }
  if (!hsCode) {
    hsCode = '999999'; // sentinel; team must replace in review
  }

  // 4b) Run the sourcing recommendation to get country comparison.
  const sourcing = /** @type {any} */ (sourcingQuote.recommendCountry({
    productCategory: classification.category,
    targetFobUnitEur,
    moq: targetQuantity,
    urgencyWeeks,
    costPriority: 'balanced',
  }));
  if (!sourcing.ok) {
    const reasons = Array.isArray(sourcing.errors) ? sourcing.errors : ['unknown'];
    log.warn('sourcing-quote failed in orchestrator', { externalId, errors: reasons });
    return transitionToFailed({
      orgId, externalId, actorEmailHash,
      code: 'sourcing_calculator_failed',
      reason: `Sourcing calculator rejected the inferred inputs: ${reasons.join('; ')}. Likely cause: free-text product description does not map cleanly to a category. Team can re-run after editing in the ops console.`,
      recoverable: true,
    });
  }

  // 5) Build factory shortlist (uses the recommended country and its alternates).
  //    Sprint 28 — pull this org's past supplier picks for the same HS
  //    prefix in the last 90 days so the shortlist surfaces a "your team
  //    picked Vietnam 4 times" badge. Fail-soft: aggregation failure
  //    just means no badge surfaces (the shortlist still ranks by the
  //    deterministic sourcing-quote scoring).
  let pastPicksByCountry = null;
  try {
    const hsPrefix6 = (typeof hsCode === 'string' && /^[0-9]{6,}/.test(hsCode))
      ? hsCode.slice(0, 6)
      : null;
    const agg = /** @type {any} */ (await importRequestsDb.aggregateSupplierPicks({
      orgId,
      hsPrefix6,
      windowDays: 90,
    }));
    if (agg && agg.ok) pastPicksByCountry = agg.byCountry || {};
  } catch (err) {
    log.warn('aggregateSupplierPicks failed in orchestrator', {
      externalId, err: err instanceof Error ? err.message : String(err),
    });
  }
  const { shortlist, methodology: shortlistMethodology } = buildFactoryShortlist({
    recommendation: sourcing,
    productCategory: classification.category,
    classifierHits: classification.hits,
    classifierSource: classification.source,
    pastPicksByCountry,
  });

  // 6) Build landed-cost quote (stacks customs + routing + finance + take-rate).
  const landedQuote = /** @type {any} */ (buildLandedQuote({
    hsCode,
    originCountry,
    destinationCountry,
    customsValueEur,
    targetQuantity,
    productCategory: classification.category,
    urgencyWeeks,
    hsClassification,
  }));

  // 6a) Sprint 5 ch 1: run the EU compliance probes at QUOTE time so
  //     the customer sees CBAM / EUDR / REACH applicability BEFORE
  //     they hit Approve. Probes are deterministic + cheap so embed
  //     directly in landed_quote.complianceProbes. The materialiser
  //     still re-runs them on goods spawn (sprint 4 ch 1) to keep the
  //     goods.metadata audit trail self-contained.
  {
    const probes = runComplianceProbes({
      productCategory: classification.category,
      productDescription: request.productDescription,
      originCountry,
      hsCode,
    });
    landedQuote.complianceProbes = buildLandedQuoteComplianceBlock({
      probes,
      productCategory: classification.category,
    });
  }

  // 6b) Generate the calculator-grounded prose summary (Opus). Fail-soft:
  //     if ANTHROPIC_API_KEY is missing, the kill-switch is set, or the
  //     call throws, the quote ships without prose and the UI hides the
  //     panel. The prose is embedded INTO landed_quote.prose so it
  //     attaches atomically alongside the structured numbers.
  const proseResult = /** @type {any} */ (await quoteProse.generateQuoteProse({
    request,
    landedQuote,
    factoryShortlist: shortlist,
    actorEmailHash,
  }));
  if (proseResult.ok && proseResult.prose) {
    landedQuote.prose = proseResult.prose;
  }

  // 7) Attach atomically. Transitions processing → awaiting_review.
  const aiRunId = `orch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const attach = /** @type {any} */ (await importRequestsDb.attachShortlistAndQuote({
    orgId,
    externalId,
    actorEmailHash,
    shortlist: [
      ...shortlist,
      // Trailing block carries methodology so the ops console can
      // render "how this was generated" without spelunking JSONB.
      { _meta: shortlistMethodology },
    ],
    landedQuote,
    aiRunIds: [aiRunId],
    quoteValidForDays: 14,
  }));
  if (!attach.ok) {
    const attachErrors = Array.isArray(attach.errors) ? attach.errors : ['attach failed'];
    log.error('attachShortlistAndQuote failed', { externalId, errors: attachErrors, conflict: attach.conflict });
    return transitionToFailed({
      orgId, externalId, actorEmailHash,
      code: attach.conflict ? 'concurrent_modification' : 'attach_failed',
      reason: attachErrors.join('; '),
      recoverable: !!attach.conflict,
    });
  }

  return { ok: true, importRequest: attach.importRequest, aiRunId };
}

// ── Materialisation — request → downstream {Goods, Supplier, Shipment} ──
//
// When the customer hits Approve, this collapses the L1.0 request
// into the full L1.1 (Goods) + L1.2 (Supplier) + L1.3 (Shipment)
// triad. The customer's intent + the calculator-grounded quote both
// snapshot onto the shipment for reproducibility (apex III3 /
// ADR 0006-style intent capture). The request is updated with
// linked_{shipment,goods,supplier}_external_id so the dashboards can
// deep-link to all three.
//
// Failure posture (sprint 3): we materialise sequentially —
// Goods → Supplier → Shipment → linkMaterialisedShipment. The
// Shipment is the load-bearing entity; Goods + Supplier are
// best-effort. If either ancillary create fails the Shipment still
// spawns (with the FK column left null), and the response carries a
// 'partial_materialisation' note so the team console can manually fill
// the gap. We NEVER roll the customer_approved transition back — the
// customer already said yes.

/**
 * Pick the rank-1 country from a request's shortlist, skipping _meta
 * trailers and falling back to customer-stated origin then to 'CN'.
 *
 * @param {any} request
 */
function pickChosenCountry(request) {
  const shortlist = Array.isArray(request && request.factoryShortlist) ? request.factoryShortlist : [];
  const rankOne = shortlist.find((/** @type {any} */ b) => b && !b._meta && b.rank === 1);
  return String((rankOne && rankOne.country) || (request && request.originCountry) || 'CN').toUpperCase();
}

/**
 * Pick the top supplier candidate from the rank-1 country block, if any.
 *
 * @param {any} request
 */
function pickTopCandidate(request) {
  const shortlist = Array.isArray(request && request.factoryShortlist) ? request.factoryShortlist : [];
  const rankOne = shortlist.find((/** @type {any} */ b) => b && !b._meta && b.rank === 1);
  if (!rankOne || !Array.isArray(rankOne.candidates) || rankOne.candidates.length === 0) return null;
  return rankOne.candidates[0];
}

/**
 * Run the three EU compliance probes (CBAM / EUDR / REACH) against the
 * customer's intent + the resolved HS code. Pure-function — every probe
 * is a calculator-grounded determinator in lib/intelligence/, no LLM.
 *
 * Sprint 4 chunk 1: this replaces the sprint 3 placeholder where every
 * materialised goods row had cbamInScope=false regardless of HS. The
 * probe results land both on the structured goods_master.cbam_in_scope
 * boolean and as forensic detail in goods_master.metadata.complianceProbes
 * so the team console can show "why" CBAM did / didn't apply.
 *
 * @param {{ productCategory: string, productDescription: string, originCountry: string, hsCode: string }} args
 */
function runComplianceProbes({ productCategory, productDescription, originCountry, hsCode }) {
  /** @type {any} */
  let cbam = null;
  /** @type {any} */
  let eudr = null;
  /** @type {any} */
  let reach = null;
  try {
    cbam = determineCbamApplicability({ productCategory, productDescription, originCountry, hsCode });
  } catch (err) {
    log.warn('CBAM probe threw', { err: err instanceof Error ? err.message : String(err) });
  }
  try {
    // importerEntity is optional in practice (downstream branches treat
    // undefined as "not provided") but the JSDoc destructure surfaces
    // it as required. Pass undefined explicitly to satisfy TS.
    eudr = determineEudrApplicability({ productCategory, productDescription, originCountry, importerEntity: undefined });
  } catch (err) {
    log.warn('EUDR probe threw', { err: err instanceof Error ? err.message : String(err) });
  }
  try {
    reach = determineReachApplicability({ productCategory, productDescription, originCountry });
  } catch (err) {
    log.warn('REACH probe threw', { err: err instanceof Error ? err.message : String(err) });
  }
  return { cbam, eudr, reach };
}

/**
 * Build the compliance-probe block to embed in landed_quote at quote
 * time. Sprint 5 ch 1 — surfaces CBAM / EUDR / REACH applicability to
 * the customer BEFORE approval so they see compliance exposure on
 * the same screen as the take-rate. Probes themselves run via
 * runComplianceProbes.
 *
 * Exposed as a named helper so the embedding shape is directly testable
 * against the ComplianceProbes TS interface in app-shell/lib/api.ts.
 *
 * @param {{ probes: any, productCategory: string }} args
 */
function buildLandedQuoteComplianceBlock({ probes, productCategory }) {
  const safeProbes = probes && typeof probes === 'object' ? probes : {};
  return {
    version: 'v1.0',
    productCategory,
    cbam: safeProbes.cbam ? {
      applies: safeProbes.cbam.applies,
      reason: safeProbes.cbam.reason,
      categoryKey: safeProbes.cbam.categoryKey,
      citation: safeProbes.cbam.citation,
      confidence: safeProbes.cbam.confidence,
    } : null,
    eudr: safeProbes.eudr ? {
      applies: safeProbes.eudr.applies,
      reason: safeProbes.eudr.reason,
      commodityKey: safeProbes.eudr.commodityKey || safeProbes.eudr.categoryKey || null,
      citation: safeProbes.eudr.citation,
      confidence: safeProbes.eudr.confidence,
    } : null,
    reach: safeProbes.reach ? {
      applies: safeProbes.reach.applies, // tri-state: 'maybe' | true | false
      reason: safeProbes.reach.reason,
      categoryKey: safeProbes.reach.categoryKey,
      citation: safeProbes.reach.citation,
      confidence: safeProbes.reach.confidence,
    } : null,
  };
}

/**
 * Build a goods-master input from a customer-approved request. The
 * sku is derived from the request external_id so the row is traceable
 * back to its source intent. HS code defaults to the customer's guess,
 * then to the AI classification, then to the '999999' sentinel — same
 * fallback chain the orchestrator uses for the duty calculator.
 *
 * Sprint 4: cbamInScope is now populated from determineCbamApplicability
 * (lib/intelligence/cbam-analysis.js) rather than hardcoded to false.
 * EUDR + REACH applicability ride in metadata.complianceProbes.
 *
 * @param {{ request: any, actorEmailHash: string, orgId: number }} args
 */
function buildGoodsSeedFromRequest({ request, actorEmailHash, orgId }) {
  const landedQuote = (request && request.landedQuote && typeof request.landedQuote === 'object') ? request.landedQuote : {};
  const methodology = (landedQuote.methodology && typeof landedQuote.methodology === 'object') ? landedQuote.methodology : {};
  const hsClassification = (methodology.hsClassification && typeof methodology.hsClassification === 'object') ? methodology.hsClassification : null;
  const hsCandidate = (hsClassification && hsClassification.hs6) ? String(hsClassification.hs6) : null;

  const hsCode = request.hsCodeGuess || hsCandidate || '999999';
  const productDescription = String(request.productDescription || '').trim();
  const displayName = productDescription
    ? (productDescription.split('\n')[0] || productDescription).slice(0, 100)
    : (request.label || 'Imported goods');
  // SKU: stable, deterministic, traceable. 'IR-' + uppercased + suffix-stripped.
  const skuSuffix = String(request.externalId || 'unknown')
    .replace(/^ir_/i, '')
    .toUpperCase()
    .slice(0, 16);
  const sku = `IR-${skuSuffix}`;
  const chosenCountry = pickChosenCountry(request);

  // Sprint 4: derive productCategory at materialise time so the
  // compliance probes get a category string they understand even
  // when the orchestrator's classifier output isn't preserved on
  // the request. classifyProductCategory is deterministic so the
  // category here matches what the orchestrator used.
  const categoryClassification = classifyProductCategory(productDescription);
  const probes = runComplianceProbes({
    productCategory: categoryClassification.category,
    productDescription,
    originCountry: chosenCountry,
    hsCode,
  });

  /** @type {Record<string, any>} */
  const seed = {
    orgId,
    createdByEmailHash: actorEmailHash,
    sku,
    displayName,
    hsCode,
    originCountry: chosenCountry,
    cbamInScope: !!(probes.cbam && probes.cbam.applies === true),
    reachSvhcFlags: [],
    restrictedSubstances: {},
    metadata: {
      materialisedFromImportRequest: request.externalId,
      materialisedAt: new Date().toISOString(),
      materialiserVersion: 'v1.2',
      hsSource: request.hsCodeGuess ? 'customer_guess' : (hsCandidate ? 'ai_lookup' : 'sentinel'),
      hsConfidenceTier: hsClassification ? hsClassification.confidenceTier : null,
      certificationRequirements: Array.isArray(request.certificationRequirements) ? request.certificationRequirements : [],
      complianceProbes: {
        version: 'v1.0',
        productCategory: categoryClassification.category,
        cbam: probes.cbam ? {
          applies: probes.cbam.applies,
          reason: probes.cbam.reason,
          categoryKey: probes.cbam.categoryKey,
          citation: probes.cbam.citation,
          confidence: probes.cbam.confidence,
        } : null,
        eudr: probes.eudr ? {
          applies: probes.eudr.applies,
          reason: probes.eudr.reason,
          commodityKey: probes.eudr.commodityKey || probes.eudr.categoryKey || null,
          citation: probes.eudr.citation,
          confidence: probes.eudr.confidence,
        } : null,
        reach: probes.reach ? {
          applies: probes.reach.applies, // 'maybe' | true | false (tri-state per the calculator)
          reason: probes.reach.reason,
          categoryKey: probes.reach.categoryKey,
          citation: probes.reach.citation,
          confidence: probes.reach.confidence,
        } : null,
      },
    },
  };
  if (Number.isInteger(request.targetUnitPriceCents)) {
    seed.typicalUnitValueCents = request.targetUnitPriceCents;
  }
  return seed;
}

/**
 * Build a supplier-master input from a customer-approved request. The
 * entityName comes from the top shortlist candidate; when no candidate
 * exists, we fall back to a placeholder ("Vendor TBD · {COUNTRY}")
 * with a metadata flag so the team console can prompt for resolution.
 *
 * @param {{ request: any, actorEmailHash: string, orgId: number }} args
 */
function buildSupplierSeedFromRequest({ request, actorEmailHash, orgId }) {
  const hqCountry = pickChosenCountry(request);
  const candidate = pickTopCandidate(request);
  const entityName = (candidate && (candidate.name || candidate.entityName))
    ? String(candidate.name || candidate.entityName).slice(0, 200)
    : `Vendor TBD · ${hqCountry}`;
  const placeholder = !(candidate && (candidate.name || candidate.entityName));

  /** @type {any[]} */
  const factoryLocations = (candidate && candidate.city)
    ? [{
        countryCode: hqCountry,
        city: String(candidate.city).slice(0, 100),
        role: 'manufacturer',
      }]
    : [];

  /** @type {Record<string, any>} */
  const seed = {
    orgId,
    createdByEmailHash: actorEmailHash,
    entityName,
    hqCountry,
    factoryLocations,
    auditCerts: [],
    metadata: {
      materialisedFromImportRequest: request.externalId,
      materialisedAt: new Date().toISOString(),
      materialiserVersion: 'v1.2',
      placeholder,
      verificationStatus: candidate ? (candidate.verificationStatus || 'unverified_ai_sample') : 'no_candidate',
      sourceCandidate: candidate ? { name: candidate.name, city: candidate.city, specialty: candidate.specialty } : null,
    },
  };
  return seed;
}

/**
 * Build the shipment-master input from a customer-approved request.
 * Exposed pure-function so tests can pin the intent→shipment mapping
 * without a Postgres dependency.
 *
 * @param {{
 *   request: any,
 *   actorEmailHash: string,
 *   orgId: number,
 *   goodsExternalId?: string | null,
 *   supplierExternalId?: string | null,
 * }} args
 */
function buildShipmentSeedFromRequest({ request, actorEmailHash, orgId, goodsExternalId, supplierExternalId }) {
  const landedQuote = (request && request.landedQuote && typeof request.landedQuote === 'object') ? request.landedQuote : {};
  const methodology = (landedQuote.methodology && typeof landedQuote.methodology === 'object') ? landedQuote.methodology : {};
  // Top-pick country comes from the rank-1 shortlist block, when present;
  // falls back to the customer's stated origin, then 'CN' as the supplier-side
  // default for our v1 corridor.
  const chosenCountry = pickChosenCountry(request);

  const cargoValueCents = Number.isInteger(landedQuote.cargoValueCents) ? landedQuote.cargoValueCents : null;
  const weightKgEstimated = Number.isInteger(methodology.weightKgEstimated) ? methodology.weightKgEstimated : null;
  const volumeCbmEstimated = Number.isFinite(Number(methodology.volumeCbmEstimated)) ? Number(methodology.volumeCbmEstimated) : null;

  /** @type {Record<string, any>} */
  const seed = {
    orgId,
    createdByEmailHash: actorEmailHash,
    label: (request.label || 'Import request')
      + (request.externalId ? ` (from ${request.externalId})` : ''),
    originCountry: chosenCountry,
    destinationCountry: String(request.destinationCountry || 'DE').toUpperCase(),
    customsValueCents: cargoValueCents,
    weightKg: weightKgEstimated,
    goodsExternalId: goodsExternalId || null,
    supplierExternalId: supplierExternalId || null,
    inputsSnapshot: {
      sourceRequestExternalId: request.externalId,
      productDescription: request.productDescription,
      hsCodeGuess: request.hsCodeGuess,
      targetQuantity: request.targetQuantity,
      targetQuantityUnit: request.targetQuantityUnit,
      targetUnitPriceCents: request.targetUnitPriceCents,
      originCountry: request.originCountry,
      destinationCountry: request.destinationCountry,
      targetDeliveryDate: request.targetDeliveryDate,
      certificationRequirements: request.certificationRequirements,
    },
    quoteSnapshot: landedQuote,
    metadata: {
      materialisedFromImportRequest: request.externalId,
      materialisedAt: new Date().toISOString(),
      materialiserVersion: 'v1.2',
      orcatradeFeePct: typeof landedQuote.orcatradeFeePct === 'number' ? landedQuote.orcatradeFeePct : null,
      orcatradeFeeCents: typeof landedQuote.orcatradeFeeCents === 'number' ? landedQuote.orcatradeFeeCents : null,
      volumeCbmEstimated,
      linkedGoodsExternalId: goodsExternalId || null,
      linkedSupplierExternalId: supplierExternalId || null,
    },
  };
  if (request.targetDeliveryDate) {
    seed.plannedArrivalDate = request.targetDeliveryDate;
  }
  return seed;
}

/**
 * Materialise the downstream Shipment for a customer-approved request.
 * Runs after attachCustomerDecision has already flipped the row to
 * 'customer_approved'.
 *
 * Returns:
 *   { ok: true, shipment, importRequest } — both newly-linked rows
 *   { ok: false, errors, code } — failure; request stays approved without
 *      a linked shipment. Caller should surface so the team can retry.
 *
 * @param {{ orgId: number, externalId: string, actorEmailHash: string }} input
 */
async function materialiseApprovedRequest({ orgId, externalId, actorEmailHash }) {
  if (!Number.isInteger(orgId) || !externalId || !actorEmailHash) {
    return { ok: false, errors: ['orgId, externalId, actorEmailHash required'], code: 'bad_input' };
  }

  // 1) Read the request.
  const readResult = /** @type {any} */ (await importRequestsDb.getImportRequestByExternalId({ orgId, externalId }));
  if (!readResult.ok) {
    if (readResult.notFound) return { ok: false, errors: ['not_found'], code: 'not_found' };
    return { ok: false, errors: readResult.errors || ['read failed'], code: 'read_failed' };
  }
  const request = readResult.importRequest;

  // 2) Guard: only materialise approved requests, and only if they
  //    haven't already been materialised.
  if (request.status !== 'customer_approved') {
    return {
      ok: false,
      errors: [`materialise requires status='customer_approved', got '${request.status}'`],
      code: 'wrong_state',
    };
  }
  if (request.linkedShipmentExternalId) {
    return {
      ok: true,
      alreadyMaterialised: true,
      importRequest: request,
      shipment: null,
    };
  }

  // 3) Spawn Goods + Supplier in parallel (best-effort). Either failing
  //    is non-fatal — the Shipment still spawns with the corresponding
  //    FK left null and the response surfaces the gap so the team can
  //    backfill from the ops console. This keeps the customer-approved
  //    transition honoured even when the data layer is partially down.
  const goodsSeed = buildGoodsSeedFromRequest({ request, actorEmailHash, orgId });
  const supplierSeed = buildSupplierSeedFromRequest({ request, actorEmailHash, orgId });

  /** @type {string[]} */
  const partialErrors = [];
  /** @type {any} */
  let goods = null;
  /** @type {any} */
  let supplier = null;

  const [goodsResult, supplierResult] = await Promise.all([
    /** @type {Promise<any>} */ (goodsDb.createGoods(goodsSeed)),
    /** @type {Promise<any>} */ (suppliersDb.createSupplier(supplierSeed)),
  ]);
  if (goodsResult && goodsResult.ok) {
    goods = goodsResult.goods;
  } else {
    log.warn('materialiseApprovedRequest: goods create failed (continuing)', {
      externalId, errors: goodsResult && goodsResult.errors,
    });
    partialErrors.push(`goods: ${(goodsResult && goodsResult.errors && goodsResult.errors[0]) || 'unknown'}`);
  }
  if (supplierResult && supplierResult.ok) {
    supplier = supplierResult.supplier;
  } else {
    log.warn('materialiseApprovedRequest: supplier create failed (continuing)', {
      externalId, errors: supplierResult && supplierResult.errors,
    });
    partialErrors.push(`supplier: ${(supplierResult && supplierResult.errors && supplierResult.errors[0]) || 'unknown'}`);
  }

  // 4) Build the shipment seed with whatever ancillary IDs we got.
  const shipmentSeed = buildShipmentSeedFromRequest({
    request,
    actorEmailHash,
    orgId,
    goodsExternalId: goods ? goods.externalId : null,
    supplierExternalId: supplier ? supplier.externalId : null,
  });

  // 5) Spawn the shipment (the load-bearing entity — failure here is fatal).
  const created = /** @type {any} */ (await shipmentsDb.createShipment(shipmentSeed));
  if (!created.ok) {
    log.error('materialiseApprovedRequest: shipment create failed', {
      externalId, errors: created.errors,
    });
    return {
      ok: false,
      errors: created.errors || ['shipment create failed'],
      code: 'shipment_create_failed',
      goods, // expose for manual cleanup / re-use
      supplier,
    };
  }
  const shipment = created.shipment;

  // 6) Link all materialised IDs back onto the request. linkMaterialisedShipment
  //    emits its own audit event ('import_request_updated') so the customer +
  //    team timelines stay coherent.
  const linkResult = /** @type {any} */ (await importRequestsDb.linkMaterialisedShipment({
    orgId,
    externalId,
    actorEmailHash,
    linkedShipmentExternalId: shipment.externalId,
    linkedGoodsExternalId: goods ? goods.externalId : undefined,
    linkedSupplierExternalId: supplier ? supplier.externalId : undefined,
  }));
  if (!linkResult.ok) {
    log.error('materialiseApprovedRequest: link failed but downstream rows exist', {
      externalId,
      shipmentExternalId: shipment.externalId,
      goodsExternalId: goods ? goods.externalId : null,
      supplierExternalId: supplier ? supplier.externalId : null,
      errors: linkResult.errors,
    });
    return {
      ok: false,
      errors: linkResult.errors || ['link failed'],
      code: 'link_failed',
      shipment,
      goods,
      supplier,
    };
  }
  // Sprint 28 — record the supplier-country pick at materialisation
  // time. The pick is derived from the rank-1 country in the
  // shortlist (= what the orchestrator recommended + the team accepted
  // by clicking Approve). v1 categorises rationale as 'past_relationship'
  // when there was already a past pick for this corridor, otherwise
  // 'cost' (the sourcing-quote's default ranking dimension). Future
  // sprints can let ops override this at approval time via a UI
  // affordance — the data layer already accepts arbitrary categories.
  //
  // Fail-soft: a recording failure does NOT roll back materialisation.
  // The pick signal is feedback for FUTURE quotes; a one-row miss
  // is acceptable.
  try {
    const pickedCountry = pickChosenCountry(linkResult.importRequest);
    const hsForPick = (linkResult.importRequest
      && linkResult.importRequest.landedQuote
      && linkResult.importRequest.landedQuote.methodology
      && linkResult.importRequest.landedQuote.methodology.hsCode)
      || (request.hsCodeGuess || null);
    // Heuristic: if THIS country has a past-pick signal already, we
    // mark the rationale as 'past_relationship'; otherwise default
    // to 'cost'. The orchestrator's enrichment (chunk 3 above)
    // already computed the past picks, but at materialise time we
    // don't have that array cached. Re-query is cheap.
    let rationaleCategory = 'cost';
    try {
      const hsPrefix6 = (typeof hsForPick === 'string' && /^[0-9]{6,}/.test(hsForPick))
        ? hsForPick.slice(0, 6)
        : null;
      const agg = /** @type {any} */ (await importRequestsDb.aggregateSupplierPicks({
        orgId, hsPrefix6, windowDays: 90,
      }));
      if (agg && agg.ok && agg.byCountry && agg.byCountry[pickedCountry]) {
        rationaleCategory = 'past_relationship';
      }
    } catch (_) { /* heuristic only — fall through to 'cost' */ }
    await importRequestsDb.recordSupplierPick({
      orgId,
      externalId,
      actorEmailHash,
      country: pickedCountry,
      hsCode: hsForPick,
      rationaleCategory,
      rationale: 'Recorded automatically at materialisation. Ops can supersede via a future override.',
    });
  } catch (err) {
    log.warn('materialiseApprovedRequest: recordSupplierPick failed (continuing)', {
      externalId, err: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    ok: true,
    importRequest: linkResult.importRequest,
    shipment,
    goods,
    supplier,
    partial: partialErrors.length > 0
      ? { ok: false, errors: partialErrors, code: 'partial_materialisation' }
      : null,
  };
}

module.exports = {
  // Internal helpers exposed for tests + the team console.
  classifyProductCategory,
  buildFactoryShortlist,
  buildLandedQuote,
  buildGoodsSeedFromRequest,
  buildSupplierSeedFromRequest,
  buildShipmentSeedFromRequest,
  pickChosenCountry,
  pickTopCandidate,
  runComplianceProbes,
  buildLandedQuoteComplianceBlock,
  CATEGORIES,
  CATEGORY_KEYWORDS,
  FOB_TO_LANDED_RATIO,
  DEFAULT_URGENCY_WEEKS,
  // Public entry points.
  runOrchestrator,
  materialiseApprovedRequest,
  computeWhatIfQuote,
};
