// OrcaTrade Compliance Agent — tool-use orchestrator.
// Spec: docs/compliance-agent-spec.md
// Model: claude-opus-4-7 (Opus-first — Sprint opus-first-v1)
// Tools wired to lib/intelligence/{cbam-analysis,eudr-analysis,retrieval}.js

const { consumeRateLimit } = require('../intelligence/runtime-store');
const gating = require('../gating');
const { searchHybrid, getChunkById } = require('../intelligence/retrieval');
const {
  determineCbamApplicability,
  calculateCertificateExposure,
  ETS_PRICE_SNAPSHOT,
} = require('../intelligence/cbam-analysis');
const {
  determineEudrApplicability,
  buildEudrEvidenceGaps,
  buildEudrPenaltyExposure,
  getCountryRiskIndicative,
  getEudrSizeImplication,
} = require('../intelligence/eudr-analysis');
const {
  determineReachApplicability,
  buildReachEvidenceGaps,
  buildReachPenaltyNote,
} = require('../intelligence/reach-analysis');
const {
  determineCeApplicability,
  buildCeEvidenceGaps,
  buildCePenaltyNote,
} = require('../intelligence/ce-analysis');

const { obligationsForShipment } = require('../intelligence/compliance-calendar');
const sanctions = require('../intelligence/sanctions-screening');
const { MODELS, cachedSystem } = require('../ai/models');
const AGENT_MODEL = MODELS.AGENT;
const AGENT_MAX_TOKENS = 1600;
const AGENT_TURN_TIMEOUT_MS = 30000;
const AGENT_MAX_TOOL_TURNS = 8;

// ── Tool schemas ────────────────────────────────────────

const TOOLS = [
  {
    name: 'getComplianceCalendar',
    description: "Return the importer's upcoming statutory compliance deadlines (CBAM, EUDR) for a given product + origin, soonest first. Deterministically decides which regimes apply (same logic as checkCbamApplicability / checkEudrApplicability), then lists each obligation due within the horizon with its due date, days remaining, urgency severity, and the regulation citation. Use whenever the user asks what is due, about reporting windows, application dates, deadlines, or what they must file and by when. Cite the returned citation for each deadline.",
    input_schema: {
      type: 'object',
      properties: {
        productCategory: { type: 'string', description: 'Product category, e.g. "steel", "cattle", "coffee".' },
        productDescription: { type: 'string', description: 'Free-text product description, used to refine category detection.' },
        originCountry: { type: 'string', description: 'ISO-2 country of origin, e.g. CN, BR.' },
        hsCode: { type: 'string', description: 'Optional HS/CN code to sharpen CBAM applicability.' },
        importerEntity: { type: 'string', description: 'Optional importer entity descriptor for EUDR.' },
        globalTurnoverEur: { type: 'number', description: 'Optional importer global annual turnover in EUR — determines EUDR SME vs non-SME application date.' },
        horizonDays: { type: 'integer', description: 'Only return obligations due within this many days. Default 365.' },
        asOf: { type: 'string', description: 'Optional ISO date (YYYY-MM-DD) to evaluate deadlines as-of. Defaults to today; pass a value for reproducible / as-of-date answers.' },
      },
      required: ['productCategory'],
    },
  },
  {
    name: 'screenCounterparty',
    description: "Run an INDICATIVE denied-party / sanctions pre-screen on a counterparty name (supplier, buyer, or vessel). Returns potential matches with a similarity score + the sanctions programme, or no_sample_match. CRITICAL: this checks an illustrative sample only and NEVER returns an all-clear — you MUST tell the user that a non-match is not a clearance and that they have to screen the party against the official EU, UK (OFSI), US (OFAC SDN) and UN consolidated lists before transacting. Use when the user names a supplier/buyer/vessel or asks about sanctions or denied-party exposure.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The counterparty name to screen (company, individual, or vessel).' },
        threshold: { type: 'number', description: 'Optional similarity cut-off 0–1 for a potential match. Default 0.85.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'searchRegulations',
    description: 'BM25 retrieval over the regulation corpus. Returns ranked chunks with chunk-id, citation, summary, and source URL. Always call this first when the user asks about a regulation; cite the returned chunk-ids in your answer. Topics covered: CBAM (cbam-*), EUDR (eudr-*), REACH (reach-*), CE marking framework (ce-*).',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        regulationIds: {
          type: 'array',
          items: { type: 'string', enum: ['cbam', 'eudr', 'reach', 'ce'] },
        },
        topK: { type: 'integer', default: 5, minimum: 1, maximum: 12 },
      },
      required: ['query'],
    },
  },
  {
    name: 'checkCbamApplicability',
    description: 'Determine whether CBAM (Reg (EU) 2023/956) applies to a product+origin combination. Categories: cement, iron_and_steel, aluminium, fertilisers, hydrogen, electricity. Use before quoting CBAM exposure.',
    input_schema: {
      type: 'object',
      properties: {
        productCategory: { type: 'string' },
        productDescription: { type: 'string' },
        originCountry: { type: 'string' },
        hsCode: { type: 'string' },
      },
      required: ['productCategory', 'originCountry'],
    },
  },
  {
    name: 'estimateCbamExposure',
    description: 'Calculate indicative CBAM certificate cost: tonnes × default emissions intensity × snapshot ETS price. Returns central + low/high scenarios. Confidence is "indicative" — do not use for final commercial pricing.',
    input_schema: {
      type: 'object',
      properties: {
        categoryKey: {
          type: 'string',
          enum: ['cement', 'iron_and_steel', 'aluminium', 'fertilisers', 'hydrogen', 'electricity'],
        },
        tonnesGoods: { type: 'number', minimum: 0 },
        etsPriceEur: { type: 'number' },
      },
      required: ['categoryKey', 'tonnesGoods'],
    },
  },
  {
    name: 'checkEudrApplicability',
    description: 'Determine whether EUDR (Reg (EU) 2023/1115) applies. Commodities: cattle, cocoa, coffee, oil_palm, rubber, soya, wood.',
    input_schema: {
      type: 'object',
      properties: {
        productCategory: { type: 'string' },
        productDescription: { type: 'string' },
        originCountry: { type: 'string' },
        importerEntity: { type: 'string' },
      },
      required: ['productCategory'],
    },
  },
  {
    name: 'assessEudrCompliance',
    description: 'Run a full EUDR compliance assessment: country risk indicator, operator size class, 4%-of-turnover penalty ceiling, evidence-gap list. Call after checkEudrApplicability returns applies=true.',
    input_schema: {
      type: 'object',
      properties: {
        commodityKey: {
          type: 'string',
          enum: ['cattle', 'cocoa', 'coffee', 'oil_palm', 'rubber', 'soya', 'wood'],
        },
        originCountry: { type: 'string' },
        supplier: { type: 'string' },
        importerEntity: { type: 'string' },
        globalTurnoverEur: { type: 'number' },
      },
      required: ['commodityKey', 'originCountry'],
    },
  },
  {
    name: 'lookupHsCode',
    description: 'Suggest a CN/HS code for a product description. Returns suggestion with confidence — never use for a customs declaration without human verification against EU TARIC.',
    input_schema: {
      type: 'object',
      properties: {
        productDescription: { type: 'string' },
        originCountry: { type: 'string' },
        intendedUse: { type: 'string' },
      },
      required: ['productDescription'],
    },
  },
  {
    name: 'checkReachApplicability',
    description: 'Determine REACH (Reg (EC) 1907/2006) relevance for a product+origin combination. REACH applies broadly to any imported article containing chemical substances; this tool returns "applies: true" for high-relevance categories (electronics, textiles, toys, cosmetics, furniture, packaging, construction, jewellery) and "applies: maybe" otherwise. Origin does not gate REACH applicability.',
    input_schema: {
      type: 'object',
      properties: {
        productCategory: { type: 'string' },
        productDescription: { type: 'string' },
        originCountry: { type: 'string' },
      },
      required: ['productCategory'],
    },
  },
  {
    name: 'assessReachCompliance',
    description: 'Run a REACH compliance assessment: evidence-gap list (SDS, SVHC declaration, Annex XVII, Annex XIV, tonnage, OR), member-state-specific penalty notes. Call after checkReachApplicability returns applies=true or applies=maybe.',
    input_schema: {
      type: 'object',
      properties: {
        categoryKey: {
          type: 'string',
          description: 'High-relevance category from checkReachApplicability (electronics, textiles, toys, cosmetics, furniture, packaging, construction, jewellery), or omit if none matched.',
        },
        importerEntity: { type: 'string' },
        supplier: { type: 'string' },
        originCountry: { type: 'string' },
        destinationCountry: { type: 'string', description: 'EU Member State code (PL, DE, FR, NL, IT, etc.) for jurisdiction-specific penalty note.' },
      },
    },
  },
  {
    name: 'checkCeApplicability',
    description: 'Determine which CE-marking directives apply to a product (CE is a framework, not a single regulation). Returns a list of applicable directives (LVD, EMC, Machinery, Toy Safety, PPE, RED, RoHS) for the detected product class. Returns "applies: maybe" if no class matched.',
    input_schema: {
      type: 'object',
      properties: {
        productCategory: { type: 'string' },
        productDescription: { type: 'string' },
        originCountry: { type: 'string' },
      },
      required: ['productCategory'],
    },
  },
  {
    name: 'assessCeCompliance',
    description: 'Run a CE compliance assessment given the product class and applicable directives: evidence-gap list (DoC, Technical File, CE marking, AR for non-EU manufacturers, Notified Body certificate where required, language-of-instructions, RoHS substance evidence) plus operational-consequence note. Call after checkCeApplicability returns applies=true.',
    input_schema: {
      type: 'object',
      properties: {
        productClassKey: { type: 'string' },
        directives: {
          type: 'array',
          description: 'The directives array returned by checkCeApplicability.',
          items: { type: 'object' },
        },
        importerEntity: { type: 'string' },
        supplier: { type: 'string' },
        originCountry: { type: 'string' },
      },
      required: ['directives'],
    },
  },
  {
    name: 'determineRulesOfOrigin',
    description: "Determine the RULE OF ORIGIN for a product under a preferential trade agreement, and (when value inputs are given) assess whether it likely qualifies. Use when the user asks 'do my goods qualify for the preferential/zero rate', 'what rule of origin applies', or 'what do I need to claim preference'. Returns the rule archetype (wholly obtained / change of tariff heading / max non-originating value / specific process), the required evidence, a confidence tier, and a mandatory caveat (the binding rule is the agreement's product-specific-rules annex). If exFactoryPriceEur + nonOriginatingValueEur (or nonOriginatingValuePct) are supplied, returns a deterministic likely_qualifies / likely_fails / needs_evidence verdict. Never state qualification as fact — relay the verdict + caveat.",
    input_schema: {
      type: 'object',
      properties: {
        hsCode: { type: 'string', description: 'HS / CN / TARIC code (6, 8 or 10 digits).' },
        regimeCode: { type: 'string', description: 'Optional preferential regime for context (e.g. EVFTA, EBA, TCA).' },
        exFactoryPriceEur: { type: 'number', description: 'Ex-works price in EUR (for value-rule assessment).' },
        nonOriginatingValueEur: { type: 'number', description: 'Customs value of non-originating materials in EUR.' },
        nonOriginatingValuePct: { type: 'number', description: 'Or the non-originating share directly, as a %.' },
        processDone: { type: 'boolean', description: 'For textile/specific-process rules: whether the required transformation occurred in the origin country.' },
      },
      required: ['hsCode'],
    },
  },
  {
    name: 'extractDocumentFields',
    description: "Extract the structured fields from the PASTED RAW TEXT of a trade document (commercial invoice, packing list, certificate of origin). Use this first when the user pastes a whole document rather than giving you tidy fields — it returns { fields, extractedFields, missingFields, confidence } you can then pass to auditDocument. Deterministic best-effort parser; if confidence is low or key fields are missing, ask the user to confirm them rather than guessing.",
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The pasted document text.' },
        documentType: { type: 'string', enum: ['commercial_invoice', 'proforma_invoice', 'packing_list', 'certificate_of_origin'] },
      },
      required: ['text'],
    },
  },
  {
    name: 'auditDocument',
    description: "Audit a customer's own trade document (commercial invoice, packing list, or certificate of origin) against their import plan. Use when the user pastes/describes an invoice or packing list and asks 'is this right', 'will this clear customs', or 'check this against my plan'. Read the document into the `fields` object, then call this — it returns deterministic findings (HS/origin/value/currency mismatches, arithmetic errors, undervaluation risk, missing preference evidence, missing CBAM/EUDR docs) with severities and an overall verdict. Relay the findings; do not invent issues the tool didn't return.",
    input_schema: {
      type: 'object',
      properties: {
        documentType: { type: 'string', enum: ['commercial_invoice', 'proforma_invoice', 'packing_list', 'certificate_of_origin'], description: 'The kind of document being audited.' },
        fields: { type: 'object', description: "Extracted document fields, e.g. { hsCode, countryOfOrigin, countryOfDestination, currency, incoterm, invoiceTotal, originStatement, rexNumber, lineItems:[{description,quantity,unitPrice,hsCode,countryOfOrigin,grossWeightKg,netWeightKg}], exporter:{companyName}, consignee:{companyName} }." },
        plan: { type: 'object', description: "The plan/expected values to audit against: { productCategory, hsCode, originCountry, destinationCountry, customsValueEur, weightKg, quoteCurrency, claimPreferential, incoterm }. Omit if the user hasn't given expectations." },
      },
      required: ['documentType', 'fields'],
    },
  },
  {
    name: 'draftDocument',
    description: "Produce a DRAFT trade document (commercial invoice, proforma invoice, packing list, or certificate of origin) from a plan's inputs, for the user to review and complete. Use when the user asks you to 'draft', 'generate', or 'prepare' a document. The draft has placeholder parties and a DRAFT marker and is NEVER a fileable document — it MUST be reviewed, completed, and approved by the user (and their broker) before use. Always return the draft together with that explicit instruction; for any high-value or binding filing also call requestHumanReview.",
    input_schema: {
      type: 'object',
      properties: {
        documentType: { type: 'string', enum: ['commercial_invoice', 'proforma_invoice', 'packing_list', 'certificate_of_origin'], description: 'Which document to draft.' },
        plan: { type: 'object', description: 'Plan inputs to pre-fill from: { productCategory, productDescription, hsCode, originCountry, destinationCountry, customsValueEur, weightKg, incoterm, quoteCurrency, moq }.' },
      },
      required: ['documentType', 'plan'],
    },
  },
  {
    name: 'requestHumanReview',
    description: 'Mandatory escalation tool. Invoke when an irreversible commercial action is being recommended, when cargo value exceeds €20k AND a quote is being shaped, when the user asks for a human, when confidence is too low, or when the question depends on a regulation not yet in scope.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
        severity: { type: 'string', enum: ['info', 'minor', 'moderate', 'major', 'critical'] },
        context: { type: 'object' },
      },
      required: ['reason', 'severity'],
    },
  },
];

// ── Tool implementations ────────────────────────────────

const toolImpls = {
  getComplianceCalendar({ productCategory, productDescription, originCountry, hsCode, importerEntity, globalTurnoverEur, horizonDays, asOf }) {
    const { regimesInScope, isSME, obligations } = obligationsForShipment({
      productCategory, productDescription, originCountry, hsCode, importerEntity, globalTurnoverEur,
      horizonDays: horizonDays || undefined,
      asOf,
    });
    return {
      regimesInScope,
      isSME,
      horizonDays: horizonDays || 365,
      obligationCount: obligations.length,
      obligations,
      note: regimesInScope.length
        ? null
        : 'Neither CBAM nor EUDR applies to this product/origin on the snapshot mapping, so the calendar has no statutory deadlines in scope. Other regimes (REACH, CE marking, etc.) are not yet covered by the calendar.',
    };
  },

  async screenCounterparty({ name, threshold }) {
    return sanctions.screen({ name, threshold, list: await sanctions.getActiveList() });
  },

  async searchRegulations({ query, regulationIds, topK }) {
    const hits = await searchHybrid(query, { regulationIds: regulationIds || ['cbam', 'eudr'], topK: topK || 5 });
    return {
      hits: hits.map(h => ({
        chunkId: h.chunk.id,
        article: h.chunk.article,
        title: h.chunk.title,
        summary: h.chunk.summary,
        citation: h.chunk.citation,
        sourceUrl: h.chunk.source_url,
        regulation: h.regulation.shortName,
        score: Number(h.score.toFixed(2)),
      })),
    };
  },

  checkCbamApplicability(args) {
    const result = determineCbamApplicability({
      productCategory: args.productCategory,
      productDescription: args.productDescription,
      originCountry: args.originCountry,
      hsCode: args.hsCode,
    });
    return result;
  },

  estimateCbamExposure({ categoryKey, tonnesGoods, etsPriceEur }) {
    const result = calculateCertificateExposure({
      tonnesGoods,
      categoryKey,
      etsPriceEur: etsPriceEur || ETS_PRICE_SNAPSHOT.priceEurPerTonne,
    });
    if (!result) return { error: 'No default intensity found for this category, or invalid tonnage.' };
    return {
      tonnesGoods: result.tonnesGoods,
      tonnesEmissions: result.tonnesEmissions,
      certificateCostEur: result.certificateCostEur,
      etsPrice: result.etsPrice,
      intensity: result.intensity,
      calc: result.calc,
    };
  },

  checkEudrApplicability(args) {
    return determineEudrApplicability({
      productCategory: args.productCategory,
      productDescription: args.productDescription,
      originCountry: args.originCountry,
      importerEntity: args.importerEntity,
    });
  },

  assessEudrCompliance({ commodityKey, originCountry, supplier, importerEntity, globalTurnoverEur }) {
    const sizeImplication = getEudrSizeImplication(globalTurnoverEur);
    const isSME = sizeImplication ? ['micro', 'small'].includes(sizeImplication.size) : false;
    const evidenceGaps = buildEudrEvidenceGaps({ commodityKey, importerEntity, supplier, originCountry, isSME });
    const countryRisk = getCountryRiskIndicative(originCountry);
    const penalty = buildEudrPenaltyExposure({ globalTurnoverEur });
    return { sizeImplication, isSME, evidenceGaps, countryRisk, penalty };
  },

  lookupHsCode({ productDescription, originCountry, intendedUse }) {
    // Note: real implementation would query EU TARIC. This is a structured placeholder
    // that returns a low-confidence indicator and routes the user to verification.
    return {
      suggestion: null,
      confidence: 0.0,
      message: 'HS code lookup requires EU TARIC database access, not yet wired into the agent. For now, suggest the user use access2markets.ec.europa.eu or verify with their customs broker.',
      productDescription,
      originCountry,
      intendedUse,
    };
  },

  checkReachApplicability(args) {
    return determineReachApplicability({
      productCategory: args.productCategory,
      productDescription: args.productDescription,
      originCountry: args.originCountry,
    });
  },

  assessReachCompliance({ categoryKey, importerEntity, supplier, originCountry, destinationCountry }) {
    const evidenceGaps = buildReachEvidenceGaps({ categoryKey, importerEntity, supplier, originCountry });
    const penaltyNote = buildReachPenaltyNote({ destinationCountry });
    return { evidenceGaps, penaltyNote };
  },

  checkCeApplicability(args) {
    return determineCeApplicability({
      productCategory: args.productCategory,
      productDescription: args.productDescription,
      originCountry: args.originCountry,
    });
  },

  assessCeCompliance({ productClassKey, directives, importerEntity, supplier, originCountry }) {
    const evidenceGaps = buildCeEvidenceGaps({ productClassKey, directives, importerEntity, supplier, originCountry });
    const penaltyNote = buildCePenaltyNote();
    return { evidenceGaps, penaltyNote };
  },

  // Pillar II2 — rules-of-origin determination + qualification (calculator-grounded).
  determineRulesOfOrigin({ hsCode, regimeCode, exFactoryPriceEur, nonOriginatingValueEur, nonOriginatingValuePct, processDone }) {
    const roo = require('../intelligence/rules-of-origin');
    const hasValueInputs = Number.isFinite(exFactoryPriceEur) || Number.isFinite(nonOriginatingValueEur) || Number.isFinite(nonOriginatingValuePct) || typeof processDone === 'boolean';
    if (hasValueInputs) {
      return roo.assessOriginQualification({ hsCode, regimeCode, exFactoryPriceEur, nonOriginatingValueEur, nonOriginatingValuePct, processDone });
    }
    return roo.determineOriginRule({ hsCode, regimeCode });
  },

  // Pillar I4+ — extract document fields from pasted raw text (deterministic).
  extractDocumentFields({ text, documentType }) {
    const { extractFields } = require('../intelligence/document-extract');
    return extractFields(text, documentType);
  },

  // Pillar I4 — audit a customer's own document against their plan (deterministic).
  // Accepts either structured `fields` or raw `text` (extracted first).
  auditDocument({ documentType, fields, plan, text }) {
    const { auditDocument: audit } = require('../intelligence/document-audit');
    let extraction = null;
    if ((!fields || typeof fields !== 'object') && typeof text === 'string' && text.trim()) {
      const { extractFields } = require('../intelligence/document-extract');
      extraction = extractFields(text, documentType);
      fields = extraction.fields;
    }
    const result = audit({ documentType, fields, plan });
    if (extraction && result.ok) result.extraction = { extractedFields: extraction.extractedFields, missingFields: extraction.missingFields, confidence: extraction.confidence };
    return result;
  },

  // Pillar I5 — produce a DRAFT document, explicitly approval-gated.
  draftDocument({ documentType, plan }) {
    const { draftFromPlan } = require('../intelligence/document-generator');
    const draft = draftFromPlan(documentType, plan || {});
    if (!draft.ok) return draft;
    return {
      ...draft,
      status: 'draft',
      needsHumanApproval: true,
      approvalNotice: 'This is a DRAFT only. Placeholder parties and figures must be completed, and the document reviewed and approved by you (and your customs broker) before it is filed or sent. OrcaTrade does not file documents on your behalf.',
    };
  },

  async requestHumanReview({ reason, severity, context }) {
    // P0.10: this used to return a fake ticketId with no downstream — the
    // "Potemkin escalation" the audit flagged. lib/human-review.js now
    // persists the ticket to KV + writes an audit-event + best-effort
    // emails ORCATRADE_OPS_EMAIL.
    const humanReview = require('../human-review');
    const ticket = await humanReview.appendTicket({
      agent: 'compliance',
      reason,
      severity,
      context,
    });
    return {
      ticketId: ticket.id,
      reason: ticket.reason,
      severity: ticket.severity,
      receivedAt: ticket.requestedAt,
      message: `Routed to human review. Ticket ${ticket.id}. Severity: ${ticket.severity}. Status: ${ticket.status}.`,
    };
  },
};

// ── System prompt (from docs/compliance-agent-spec.md) ──

// Sprint BG-6.1 extension: SYSTEM_PROMPT loaded from versioned registry.
// Once shipped, a version is immutable — tuning means bumping the number.
const prompts = require("../ai/prompts/registry");
const COMPLIANCE_PROMPT_VERSION = "v1";
const SYSTEM_PROMPT = prompts.getPrompt("compliance", COMPLIANCE_PROMPT_VERSION);
const SYSTEM_PROMPT_HASH = prompts.hashPrompt(SYSTEM_PROMPT);
// Sprint BG-6.4: every Anthropic call logs cost + tokens + latency.
const { withCostTelemetry } = require("../ai/cost-telemetry");

// ── HTTP / SSE plumbing ─────────────────────────────────

function openStream(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

function emit(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function emitDone(res) {
  emit(res, { type: 'done' });
  res.end();
}

// ── Anthropic call (non-streaming for tool use) ─────────
//
// Wrapped in lib/circuit.js per ADR 0006 (every external HTTP call has
// timeout + retries + fallback). Circuit name 'anthropic-messages' is
// shared across all 6 agent handlers so a sustained Anthropic outage
// trips one circuit, not six. Fallback throws — preserving the existing
// callAnthropic throw semantics; the handler's outer try/catch around
// callAnthropic continues to do its work.

const circuit = require('../circuit');

async function callAnthropic({ apiKey, messages, system, tools }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AGENT_TURN_TIMEOUT_MS);
  try {
    return await circuit.run('anthropic-messages', async () => {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: AGENT_MODEL,
          max_tokens: AGENT_MAX_TOKENS,
          system,
          tools,
          messages,
        }),
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Anthropic ${response.status}: ${errText.slice(0, 400)}`);
      }
      return await response.json();
    }, {
      fallback: ({ shortCircuited, err }) => {
        const reason = shortCircuited ? 'open' : 'failure';
        const msg = err && err.message ? `: ${err.message}` : '';
        throw new Error(`Anthropic circuit ${reason}${msg}`);
      },
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Main handler ────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('agent', ip, 12, 60000);
  if (rate.limited) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  // Sprint 42: tier-quota gating. Compliance Agent is the entry-level
  // (free tier gets 20/month). Per-tier quota lives in lib/tiers.js.
  const featureGate = await gating.checkFeature(req, 'complianceAgent');
  if (!featureGate.allowed) return gating.gate(res, featureGate);
  const quotaGate = await gating.checkQuota(req, 'agentQueriesPerMonth', 1);
  if (!quotaGate.allowed) return gating.gate(res, quotaGate);

  const { messages, context, locale } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  if (!(process.env.ANTHROPIC_API_KEY || process.env.ORCATRADE_OS_API)) {
    return res.status(503).json({ error: 'Compliance Agent requires ANTHROPIC_API_KEY to be configured.' });
  }

  // Trim and shape messages for the Anthropic API
  const trimmedMessages = messages
    .slice(-12)
    .map(m => {
      const content = typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content : '');
      return {
        role: m.role === 'user' ? 'user' : 'assistant',
        content: typeof content === 'string' ? content.slice(0, 4000) : content,
      };
    });

  // Inject context (importer profile, active shipment) as a system suffix for this turn
  // Cache the large static SYSTEM_PROMPT (+ tools) as a shared prefix; the
  // small per-turn context + locale directive ride in an uncached trailing
  // block so the cache survives across turns, locales, and users.
  const contextSuffix = context && Object.keys(context).length
    ? `\n\nCURRENT CONTEXT (this turn only):\n${JSON.stringify(context).slice(0, 1000)}`
    : '';
  const systemForTurn = cachedSystem(
    SYSTEM_PROMPT,
    require('../agent-i18n').applyLocaleDirective(contextSuffix, locale),
  );

  openStream(res);
  emit(res, { type: 'thinking' });

  let workingMessages = [...trimmedMessages];
  let toolTurns = 0;
  let finalText = '';

  try {
    while (toolTurns < AGENT_MAX_TOOL_TURNS) {
      const response = await withCostTelemetry(
        {
          agent: "compliance",
          promptVersion: COMPLIANCE_PROMPT_VERSION,
          promptHash: SYSTEM_PROMPT_HASH,
          model: AGENT_MODEL,
          requestId: req.requestId,
        },
        () => callAnthropic({
          apiKey: (process.env.ANTHROPIC_API_KEY || process.env.ORCATRADE_OS_API),
        system: systemForTurn,
        tools: TOOLS,
        messages: workingMessages,
        }),
      );

      const assistantContent = Array.isArray(response.content) ? response.content : [];

      // Append assistant turn (with tool_use blocks if present) to message history
      workingMessages.push({ role: 'assistant', content: assistantContent });

      // Extract text and tool_use blocks
      const textBlocks = assistantContent.filter(b => b.type === 'text');
      const toolBlocks = assistantContent.filter(b => b.type === 'tool_use');

      // Stream any text fragments produced this turn
      for (const block of textBlocks) {
        if (block.text) {
          emit(res, { type: 'text-delta', text: block.text });
          finalText += block.text;
        }
      }

      if (response.stop_reason === 'end_turn' || !toolBlocks.length) {
        // Final assistant reply
        emit(res, { type: 'final', text: finalText, stopReason: response.stop_reason });
        return emitDone(res);
      }

      // Execute each tool call, collect tool_result blocks
      const toolResults = [];
      for (const toolUse of toolBlocks) {
        const impl = toolImpls[toolUse.name];
        emit(res, { type: 'tool-call', name: toolUse.name, args: toolUse.input, callId: toolUse.id });

        let toolResult;
        if (!impl) {
          toolResult = { error: `Unknown tool: ${toolUse.name}` };
          emit(res, { type: 'tool-result', name: toolUse.name, ok: false, callId: toolUse.id });
        } else {
          try {
            // await covers both sync impls (identity) and async ones
            // (e.g. screenCounterparty loads the live sanctions list).
            toolResult = await impl(toolUse.input || {});
            emit(res, { type: 'tool-result', name: toolUse.name, ok: true, callId: toolUse.id });
          } catch (err) {
            toolResult = { error: err.message };
            emit(res, { type: 'tool-result', name: toolUse.name, ok: false, error: err.message, callId: toolUse.id });
          }
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(toolResult).slice(0, 8000),
        });
      }

      workingMessages.push({ role: 'user', content: toolResults });
      toolTurns += 1;
    }

    // Hit the tool-turn cap
    emit(res, { type: 'text-delta', text: '\n\n[Agent reached the tool-call cap. Surfacing partial answer.]' });
    emit(res, { type: 'final', text: finalText, stopReason: 'tool_cap' });
    return emitDone(res);
  } catch (error) {
    console.error('Agent error:', error);
    emit(res, { type: 'error', message: error.message || 'Agent error' });
    return emitDone(res);
  }
};

// Re-export tool definitions and implementations so the Operations Orchestrator
// (api/orchestrator.js) can compose them with the Logistics Agent's tools.
module.exports.TOOLS = TOOLS;
module.exports.toolImpls = toolImpls;
module.exports.SYSTEM_PROMPT = SYSTEM_PROMPT;

module.exports.COMPLIANCE_PROMPT_VERSION = COMPLIANCE_PROMPT_VERSION;
module.exports.SYSTEM_PROMPT_HASH = SYSTEM_PROMPT_HASH;
