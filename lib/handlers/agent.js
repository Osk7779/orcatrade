// OrcaTrade Compliance Agent — tool-use orchestrator.
// Spec: docs/compliance-agent-spec.md
// Model: claude-opus-4-7 (Opus-first — Sprint opus-first-v1)
// Tools wired to lib/intelligence/{cbam-analysis,eudr-analysis,retrieval}.js

const { consumeRateLimit } = require('../intelligence/runtime-store');
const gating = require('../gating');
const { search, getChunkById } = require('../intelligence/retrieval');
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

  searchRegulations({ query, regulationIds, topK }) {
    const hits = search(query, { regulationIds: regulationIds || ['cbam', 'eudr'], topK: topK || 5 });
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

  requestHumanReview({ reason, severity, context }) {
    const ticketId = `tkt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    return {
      ticketId,
      reason,
      severity,
      receivedAt: new Date().toISOString(),
      message: `Routed to human review. Ticket ${ticketId}. Severity: ${severity}.`,
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

async function callAnthropic({ apiKey, messages, system, tools }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AGENT_TURN_TIMEOUT_MS);
  try {
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
            toolResult = impl(toolUse.input || {});
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
