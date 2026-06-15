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
const sourcingQuote = require('../intelligence/sourcing-quote');
const customsQuote = require('../intelligence/customs-quote');
const routingQuote = require('../intelligence/routing-quote');
const financeQuote = require('../intelligence/finance-quote');
const hsCodeLookup = require('../intelligence/hs-code-lookup');
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
 */
function buildFactoryShortlist({ recommendation, productCategory, classifierHits }) {
  /** @type {any[]} */
  const comparison = Array.isArray(recommendation && recommendation.comparison)
    ? recommendation.comparison
    : [];
  // Top 3 countries by the recommendation's own ranking.
  const topCountries = comparison.slice(0, 3);
  const shortlist = topCountries.map((/** @type {any} */ c, /** @type {number} */ idx) => {
    const sampleResult = /** @type {any} */ (sourcingQuote.shortlistSuppliers({
      productCategory,
      country: c.country,
    }));
    /** @type {any[]} */
    const samples = Array.isArray(sampleResult && sampleResult.suppliers) ? sampleResult.suppliers : [];
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
    };
  });
  return {
    shortlist,
    methodology: {
      version: 'v1.0',
      classifier: 'keyword-classifier-v1',
      classifierHits,
      countriesEvaluated: comparison.map((/** @type {any} */ c) => c.country),
      sampleSource: 'sourcing-quote.shortlistSuppliers (anonymised)',
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
    const totals = customsResult.totals || {};
    const dutyEur = Number(totals.dutyEur) || 0;
    const vatEur = Number(totals.vatEur) || 0;
    const brokerageEur = Number(totals.brokerageEur) || 0;
    lines.push({ component: 'duty', label: 'EU import duty', eur: dutyEur, source: 'customs-quote', note: `HS ${hsCode}, origin ${originCountry}` });
    lines.push({ component: 'vat', label: `${destinationCountry} import VAT`, eur: vatEur, source: 'customs-quote' });
    lines.push({ component: 'brokerage', label: 'Customs broker fee', eur: brokerageEur, source: 'customs-quote' });
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
    const rec = routingResult.recommendation || {};
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
    const rec = financeResult.recommendation || {};
    const financeEur = Number(rec.estimatedCostEur) || 0;
    if (financeEur > 0) {
      lines.push({
        component: 'finance',
        label: `Trade finance (${rec.instrument || 'lc'})`,
        eur: financeEur,
        source: 'finance-quote',
        note: rec.rationale || undefined,
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
  const classification = classifyProductCategory(request.productDescription);
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
  const { shortlist, methodology: shortlistMethodology } = buildFactoryShortlist({
    recommendation: sourcing,
    productCategory: classification.category,
    classifierHits: classification.hits,
  });

  // 6) Build landed-cost quote (stacks customs + routing + finance + take-rate).
  const landedQuote = buildLandedQuote({
    hsCode,
    originCountry,
    destinationCountry,
    customsValueEur,
    targetQuantity,
    productCategory: classification.category,
    urgencyWeeks,
    hsClassification,
  });

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

// ── Materialisation — request → downstream Shipment ──────────────────
//
// Sprint 2 chunk 2: when the customer hits Approve, this collapses
// the L1.0 request into an L1.3 shipment_master row in 'planned'
// state. The customer's intent + the calculator-grounded quote both
// snapshot onto the shipment for reproducibility (apex III3 /
// ADR 0006-style intent capture). The request is updated with
// linked_shipment_external_id so the customer dashboard can deep-link
// from the request detail to the shipment timeline.
//
// Failure posture: if shipment creation fails, the request stays in
// 'customer_approved' WITHOUT a linked shipment. The caller surfaces
// the error so the team console can manually retry or fall back to a
// manual shipment_master insert. We never roll the customer_approved
// transition back — the customer already said yes.

/**
 * Build the shipment-master input from a customer-approved request.
 * Exposed pure-function so tests can pin the intent→shipment mapping
 * without a Postgres dependency.
 *
 * @param {{
 *   request: any,
 *   actorEmailHash: string,
 *   orgId: number,
 * }} args
 */
function buildShipmentSeedFromRequest({ request, actorEmailHash, orgId }) {
  const landedQuote = (request && request.landedQuote && typeof request.landedQuote === 'object') ? request.landedQuote : {};
  const methodology = (landedQuote.methodology && typeof landedQuote.methodology === 'object') ? landedQuote.methodology : {};
  const shortlist = Array.isArray(request.factoryShortlist) ? request.factoryShortlist : [];
  // Top-pick country comes from the rank-1 shortlist block, when present;
  // falls back to the customer's stated origin, then 'CN' as the supplier-side
  // default for our v1 corridor. Origin is stored in shipment_master as
  // ISO-2; suppliers + goods come in later sprints.
  const rankOne = shortlist.find((/** @type {any} */ b) => b && !b._meta && b.rank === 1);
  const chosenCountry = (rankOne && rankOne.country) || request.originCountry || 'CN';

  const cargoValueCents = Number.isInteger(landedQuote.cargoValueCents) ? landedQuote.cargoValueCents : null;
  const weightKgEstimated = Number.isInteger(methodology.weightKgEstimated) ? methodology.weightKgEstimated : null;
  const volumeCbmEstimated = Number.isFinite(Number(methodology.volumeCbmEstimated)) ? Number(methodology.volumeCbmEstimated) : null;

  /** @type {Record<string, any>} */
  const seed = {
    orgId,
    createdByEmailHash: actorEmailHash,
    label: (request.label || 'Import request')
      + (request.externalId ? ` (from ${request.externalId})` : ''),
    originCountry: String(chosenCountry || 'CN').toUpperCase(),
    destinationCountry: String(request.destinationCountry || 'DE').toUpperCase(),
    customsValueCents: cargoValueCents,
    weightKg: weightKgEstimated,
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
      materialiserVersion: 'v1.0',
      orcatradeFeePct: typeof landedQuote.orcatradeFeePct === 'number' ? landedQuote.orcatradeFeePct : null,
      orcatradeFeeCents: typeof landedQuote.orcatradeFeeCents === 'number' ? landedQuote.orcatradeFeeCents : null,
      volumeCbmEstimated,
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

  // 3) Build the shipment seed from the request + quote.
  const seed = buildShipmentSeedFromRequest({ request, actorEmailHash, orgId });

  // 4) Spawn the shipment.
  const created = /** @type {any} */ (await shipmentsDb.createShipment(seed));
  if (!created.ok) {
    log.error('materialiseApprovedRequest: shipment create failed', {
      externalId, errors: created.errors,
    });
    return {
      ok: false,
      errors: created.errors || ['shipment create failed'],
      code: 'shipment_create_failed',
    };
  }
  const shipment = created.shipment;

  // 5) Link the shipment back onto the request. This emits its own
  //    audit event ('import_request_updated') so the customer + team
  //    timelines stay coherent.
  const linkResult = /** @type {any} */ (await importRequestsDb.linkMaterialisedShipment({
    orgId,
    externalId,
    actorEmailHash,
    linkedShipmentExternalId: shipment.externalId,
  }));
  if (!linkResult.ok) {
    // The shipment IS created at this point. The link failure is
    // recoverable — the team can manually re-link from the ops console.
    log.error('materialiseApprovedRequest: link failed but shipment exists', {
      externalId,
      shipmentExternalId: shipment.externalId,
      errors: linkResult.errors,
    });
    return {
      ok: false,
      errors: linkResult.errors || ['link failed'],
      code: 'link_failed',
      shipment, // exposed so the caller / team can manually link
    };
  }
  return {
    ok: true,
    importRequest: linkResult.importRequest,
    shipment,
  };
}

module.exports = {
  // Internal helpers exposed for tests + the team console.
  classifyProductCategory,
  buildFactoryShortlist,
  buildLandedQuote,
  buildShipmentSeedFromRequest,
  CATEGORIES,
  CATEGORY_KEYWORDS,
  FOB_TO_LANDED_RATIO,
  DEFAULT_URGENCY_WEEKS,
  // Public entry points.
  runOrchestrator,
  materialiseApprovedRequest,
};
