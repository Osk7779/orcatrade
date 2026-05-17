// OrcaTrade Logistics Agent — tool-use orchestrator.
// Spec: docs/logistics-agent-spec.md
// Model: claude-sonnet-4-6
// Tools wrap routing-quote, customs-quote, warehouse-quote calculators.

const { consumeRateLimit } = require('../intelligence/runtime-store');
const gating = require('../gating');
const { search } = require('../intelligence/retrieval');
const routing = require('../intelligence/routing-quote');
const customs = require('../intelligence/customs-quote');
const warehouse = require('../intelligence/warehouse-quote');

const AGENT_MODEL = 'claude-sonnet-4-6';
const AGENT_MAX_TOKENS = 1800;
const AGENT_TURN_TIMEOUT_MS = 30000;
const AGENT_MAX_TOOL_TURNS = 8;

// ── Tool schemas ────────────────────────────────────────

const TOOLS = [
  {
    name: 'compareTransportModes',
    description: 'Compare sea FCL / sea LCL / air / rail for an Asia → Europe shipment. Returns 4 modes with cost (EUR), transit days, chargeable weight, distance, and CO₂ kg per mode plus a recommendation. Rail is only viable for {CN, KZ, KG} → {17 EU/CEE codes via Małaszewicze}. Use whenever the user asks how to physically move goods.',
    input_schema: {
      type: 'object',
      properties: {
        weightKg: { type: 'number', minimum: 1 },
        volumeCbm: { type: 'number', minimum: 0 },
        originCountry: { type: 'string', description: 'ISO-2 country code, e.g. CN, VN, IN.' },
        destinationCountry: { type: 'string', description: 'ISO-2 country code of EU destination.' },
        urgencyDays: { type: 'integer', minimum: 1, description: 'Optional. If <14 days, recommendation forces air.' },
        costPriority: { type: 'string', enum: ['balanced', 'cost'], description: 'Default balanced.' },
      },
      required: ['weightKg', 'originCountry', 'destinationCountry'],
    },
  },
  {
    name: 'estimateLandedCost',
    description: 'Estimate EU import landed cost. Returns two scenarios — standard clearance (duty + import VAT + brokerage + ENS) and bonded warehouse (storage + bond fee + cash-flow benefit if deferring; or full duty/VAT avoidance if re-exporting). Includes origin overlay (CN anti-dumping for steel/aluminium/footwear; preferential FTAs for VN, BD, KH, PK, TR). Always use this when the user asks about duty, VAT, or landed cost.',
    input_schema: {
      type: 'object',
      properties: {
        customsValueEur: { type: 'number', minimum: 1 },
        hsCode: { type: 'string', description: 'HS code (chapter level e.g. "62" or full 8-10 digit).' },
        destinationCountry: { type: 'string', description: 'EU member-state ISO-2 code.' },
        originCountry: { type: 'string', description: 'ISO-2 origin country.' },
        linesCount: { type: 'integer', minimum: 1, default: 1 },
        bondedDays: { type: 'integer', minimum: 0, description: 'Days in bonded warehouse for the bonded scenario; 0 means no bonded comparison.' },
        bondedVolumeCbm: { type: 'number', minimum: 0 },
        releaseStrategy: { type: 'string', enum: ['free_circulation', 're_export'], description: 'Bonded exit path.' },
        claimPreferential: { type: 'boolean', description: 'Set true if importer can prove preferential origin (REX/Form A/A.TR).' },
      },
      required: ['customsValueEur', 'hsCode', 'destinationCountry'],
    },
  },
  {
    name: 'compareWarehouseHubs',
    description: 'Benchmark six EU 3PL hubs (Rotterdam, Hamburg, Frankfurt, Poznań, Prague, Barcelona) for the importer\'s monthly profile. Returns full breakdown per hub (storage + inbound + pick & pack + outbound + setup amortisation) and a recommendation that balances cost vs delivery time to primary destination.',
    input_schema: {
      type: 'object',
      properties: {
        monthlyOrders: { type: 'integer', minimum: 1 },
        avgUnitsPerOrder: { type: 'number', minimum: 1 },
        avgLinesPerOrder: { type: 'number', minimum: 1 },
        avgPalletsHeld: { type: 'integer', minimum: 1 },
        avgOrderWeightKg: { type: 'number', minimum: 0.1 },
        primaryDestination: { type: 'string', description: 'ISO-2 country code where most orders ship.' },
        valueAddedServices: {
          type: 'array',
          items: { type: 'string', enum: ['qc_inspection', 'labelling', 'kitting', 'photography', 'returns', 'gift_wrapping'] },
        },
        returnsRate: { type: 'number', minimum: 0, maximum: 0.5, description: '0.0–0.5 decimal returns rate.' },
        skuCount: { type: 'integer', minimum: 0 },
      },
      required: ['monthlyOrders', 'avgUnitsPerOrder', 'avgLinesPerOrder', 'avgPalletsHeld', 'avgOrderWeightKg', 'primaryDestination'],
    },
  },
  {
    name: 'recommendShipmentPlan',
    description: 'Compose a unified shipment plan from origin port to EU customer doorstep. Internally calls compareTransportModes, estimateLandedCost, and (when monthlyOrders is provided) compareWarehouseHubs. Use when the importer asks an open-ended "how do I ship X" question rather than a specific cost question. Returns the recommended mode, clearance route, and warehousing hub with totals.',
    input_schema: {
      type: 'object',
      properties: {
        weightKg: { type: 'number', minimum: 1 },
        volumeCbm: { type: 'number', minimum: 0 },
        originCountry: { type: 'string' },
        destinationCountry: { type: 'string' },
        customsValueEur: { type: 'number', minimum: 1 },
        hsCode: { type: 'string' },
        linesCount: { type: 'integer', minimum: 1 },
        urgencyDays: { type: 'integer', minimum: 1 },
        monthlyOrders: { type: 'integer', minimum: 1, description: 'Optional. If set, the plan includes a 3PL hub recommendation.' },
        avgUnitsPerOrder: { type: 'number', minimum: 1 },
        avgLinesPerOrder: { type: 'number', minimum: 1 },
        avgPalletsHeld: { type: 'integer', minimum: 1 },
        avgOrderWeightKg: { type: 'number', minimum: 0.1 },
        claimPreferential: { type: 'boolean' },
      },
      required: ['weightKg', 'originCountry', 'destinationCountry', 'customsValueEur', 'hsCode'],
    },
  },
  {
    name: 'getDestinationVatRate',
    description: 'Quick VAT-rate lookup for an EU member state, no full quote required. Returns rate and country name.',
    input_schema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'EU member-state ISO-2 code.' },
      },
      required: ['country'],
    },
  },
  {
    name: 'lookupHsCode',
    description: 'Suggest a CN/HS code for a product description. Returns suggestion with confidence — never use for a customs declaration without human verification against EU TARIC.',
    input_schema: {
      type: 'object',
      properties: {
        productDescription: { type: 'string' },
        intendedUse: { type: 'string' },
      },
      required: ['productDescription'],
    },
  },
  {
    name: 'searchRegulations',
    description: 'BM25 search across the regulation corpus when a logistics question touches a regulatory issue (CBAM for steel/aluminium, anti-dumping, WEEE for returns of EEE). Returns ranked chunks with citations. Use sparingly — defer detailed compliance to the Compliance Agent.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        regulationIds: {
          type: 'array',
          items: { type: 'string', enum: ['cbam', 'eudr', 'reach', 'ce'] },
        },
        topK: { type: 'integer', default: 3, minimum: 1, maximum: 8 },
      },
      required: ['query'],
    },
  },
  {
    name: 'requestHumanReview',
    description: 'Mandatory escalation. Invoke when cargo value exceeds €50,000 AND a forwarder/3PL booking is being shaped, when the user asks for a human, when a multi-month 3PL contract is being recommended, or when the question involves anti-dumping risk requiring a Compliance Agent handoff.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
        severity: { type: 'string', enum: ['info', 'minor', 'moderate', 'major', 'critical'] },
        handoffTo: { type: 'string', enum: ['compliance_agent', 'finance_agent', 'sourcing_agent', 'human_ops'] },
        context: { type: 'object' },
      },
      required: ['reason', 'severity'],
    },
  },
];

// ── Tool implementations ────────────────────────────────

function summariseRouting(quote) {
  if (!quote.ok) return { ok: false, errors: quote.errors };
  return {
    ok: true,
    recommendation: quote.recommendation,
    modes: quote.quotes.map(q => ({
      mode: q.mode,
      label: q.label,
      viable: q.viable,
      viabilityReason: q.viabilityReason,
      totalEur: q.totalEur,
      transitDaysLabel: q.transitDaysLabel,
      chargeableWeightKg: q.chargeableWeightKg,
      co2kg: q.co2kg,
      formula: q.formula,
    })),
    railEducation: quote.railEducation,
    asOf: quote.pricingSnapshot?.asOf || quote.asOf,
  };
}

function summariseCustoms(quote) {
  if (!quote.ok) return { ok: false, errors: quote.errors };
  return {
    ok: true,
    duty: { rate: quote.duty.rate, ratePercent: quote.duty.ratePercent, breakdown: quote.duty.breakdown, originNotes: quote.duty.originNotes },
    vat: quote.vat,
    standard: quote.quotes.find(q => q.routeKey === 'standard_clearance'),
    bonded: quote.quotes.find(q => q.routeKey === 'bonded_warehouse'),
    recommendation: quote.recommendation,
    hsChapter: quote.inputs.hsChapter,
    hsChapterLabel: quote.inputs.hsChapterLabel,
    asOf: quote.asOf,
  };
}

function summariseWarehouse(quote) {
  if (!quote.ok) return { ok: false, errors: quote.errors };
  return {
    ok: true,
    recommendation: quote.recommendation,
    hubs: quote.quotes.map(h => ({
      hubKey: h.hubKey,
      hubName: h.hubName,
      hubCountry: h.hubCountry,
      hubRegion: h.hubRegion,
      totalMonthlyEur: h.totalMonthlyEur,
      costPerOrderEur: h.costPerOrderEur,
      transitToDestination: h.transitToDestination,
    })).sort((a, b) => a.totalMonthlyEur - b.totalMonthlyEur),
    valueAddedServices: quote.valueAddedServices,
    asOf: quote.asOf,
  };
}

const toolImpls = {
  compareTransportModes(args) {
    return summariseRouting(routing.calculateQuote(args));
  },

  estimateLandedCost(args) {
    return summariseCustoms(customs.calculateQuote(args));
  },

  compareWarehouseHubs(args) {
    return summariseWarehouse(warehouse.calculateQuote(args));
  },

  recommendShipmentPlan(args) {
    const routingArgs = {
      weightKg: args.weightKg,
      volumeCbm: args.volumeCbm,
      originCountry: args.originCountry,
      destinationCountry: args.destinationCountry,
      urgencyDays: args.urgencyDays,
    };
    const customsArgs = {
      customsValueEur: args.customsValueEur,
      hsCode: args.hsCode,
      destinationCountry: args.destinationCountry,
      originCountry: args.originCountry,
      linesCount: args.linesCount || 1,
      claimPreferential: args.claimPreferential === true,
    };

    const routingResult = summariseRouting(routing.calculateQuote(routingArgs));
    const customsResult = summariseCustoms(customs.calculateQuote(customsArgs));

    let warehouseResult = null;
    if (args.monthlyOrders && args.avgUnitsPerOrder && args.avgLinesPerOrder && args.avgPalletsHeld && args.avgOrderWeightKg) {
      warehouseResult = summariseWarehouse(warehouse.calculateQuote({
        monthlyOrders: args.monthlyOrders,
        avgUnitsPerOrder: args.avgUnitsPerOrder,
        avgLinesPerOrder: args.avgLinesPerOrder,
        avgPalletsHeld: args.avgPalletsHeld,
        avgOrderWeightKg: args.avgOrderWeightKg,
        primaryDestination: args.destinationCountry,
      }));
    }

    // Compose a single plan summary
    const recommendedMode = routingResult.ok
      ? routingResult.modes.find(m => m.mode === routingResult.recommendation.primary)
      : null;
    const recommendedClearance = customsResult.ok
      ? (customsResult.recommendation.primary === 'standard_clearance' ? customsResult.standard : customsResult.bonded)
      : null;
    const recommendedHub = (warehouseResult && warehouseResult.ok)
      ? warehouseResult.hubs.find(h => h.hubKey === warehouseResult.recommendation.primary)
      : null;

    const transportEur = recommendedMode?.totalEur || 0;
    const dutyEur = customsResult.ok ? customsResult.standard.dutyEur : 0;
    const vatEur = customsResult.ok ? customsResult.standard.vatEur : 0;
    const brokerageEur = customsResult.ok ? customsResult.standard.brokerageEur : 0;
    const perShipmentLandedTotal = transportEur + args.customsValueEur + dutyEur + vatEur + brokerageEur;

    return {
      ok: routingResult.ok && customsResult.ok,
      shipment: {
        mode: routingResult.recommendation,
        modeQuote: recommendedMode,
        modeReasoningSource: 'compareTransportModes',
      },
      clearance: {
        recommendation: customsResult.recommendation,
        recommendedRoute: recommendedClearance,
        dutyRate: customsResult.duty?.ratePercent,
        originNotes: customsResult.duty?.originNotes,
        clearanceReasoningSource: 'estimateLandedCost',
      },
      warehouse: warehouseResult ? {
        recommendation: warehouseResult.recommendation,
        recommendedHub,
        warehouseReasoningSource: 'compareWarehouseHubs',
      } : { skipped: true, reason: 'Monthly order profile not provided — warehouse leg omitted from plan.' },
      totals: {
        transportEur,
        customsValueEur: args.customsValueEur,
        dutyEur,
        vatEur,
        brokerageEur,
        perShipmentLandedTotal,
        warehouseMonthlyEur: recommendedHub?.totalMonthlyEur || null,
      },
      routing: routingResult,
      customs: customsResult,
      warehouseSummary: warehouseResult,
    };
  },

  getDestinationVatRate({ country }) {
    const result = customs.vatForCountry(country);
    if (!result) return { error: `No VAT rate for "${country}" — must be a 27-EU member state code.` };
    return { country: country.toUpperCase(), name: result.name, rate: result.rate, ratePercent: Math.round(result.rate * 1000) / 10 };
  },

  lookupHsCode({ productDescription, intendedUse }) {
    return {
      suggestion: null,
      confidence: 0.0,
      message: 'HS code lookup requires EU TARIC database access, not yet wired into the agent. Recommend using access2markets.ec.europa.eu or verifying with the importer\'s customs broker. For chapter-level estimates, the customs calculator (estimateLandedCost) accepts 2-digit chapter codes.',
      productDescription,
      intendedUse,
    };
  },

  searchRegulations({ query, regulationIds, topK }) {
    const hits = search(query, { regulationIds: regulationIds || ['cbam', 'eudr', 'reach', 'ce'], topK: topK || 3 });
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

  requestHumanReview({ reason, severity, handoffTo, context }) {
    const ticketId = `tkt_log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    return {
      ticketId,
      reason,
      severity,
      handoffTo: handoffTo || 'human_ops',
      receivedAt: new Date().toISOString(),
      message: `Routed to ${handoffTo || 'human ops'}. Ticket ${ticketId}. Severity: ${severity}.`,
    };
  },
};

// ── System prompt ───────────────────────────────────────

// Sprint BG-6.1 extension: SYSTEM_PROMPT loaded from versioned registry.
// Once shipped, a version is immutable — tuning means bumping the number.
const prompts = require("../ai/prompts/registry");
const LOGISTICS_PROMPT_VERSION = "v1";
const SYSTEM_PROMPT = prompts.getPrompt("logistics", LOGISTICS_PROMPT_VERSION);
const SYSTEM_PROMPT_HASH = prompts.hashPrompt(SYSTEM_PROMPT);

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
      body: JSON.stringify({ model: AGENT_MODEL, max_tokens: AGENT_MAX_TOKENS, system, tools, messages }),
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
  const rate = await consumeRateLimit('logistics-agent', ip, 12, 60000);
  if (rate.limited) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });

  // Sprint 42: feature gate (Growth+) + monthly quota.
  const featureGate = await gating.checkFeature(req, 'logisticsAgent');
  if (!featureGate.allowed) return gating.gate(res, featureGate);
  const quotaGate = await gating.checkQuota(req, 'agentQueriesPerMonth', 1);
  if (!quotaGate.allowed) return gating.gate(res, quotaGate);

  const { messages, context, locale } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  if (!(process.env.ANTHROPIC_API_KEY || process.env.ORCATRADE_OS_API)) {
    return res.status(503).json({ error: 'Logistics Agent requires ANTHROPIC_API_KEY to be configured.' });
  }

  const trimmedMessages = messages.slice(-12).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: typeof m.content === 'string' ? m.content.slice(0, 4000) : (Array.isArray(m.content) ? m.content : ''),
  }));

  const baseSystem = context && Object.keys(context).length
    ? `${SYSTEM_PROMPT}\n\nCURRENT CONTEXT (this turn only):\n${JSON.stringify(context).slice(0, 1000)}`
    : SYSTEM_PROMPT;
  const systemForTurn = require('../agent-i18n').applyLocaleDirective(baseSystem, locale);

  openStream(res);
  emit(res, { type: 'thinking' });

  let workingMessages = [...trimmedMessages];
  let toolTurns = 0;
  let finalText = '';

  try {
    while (toolTurns < AGENT_MAX_TOOL_TURNS) {
      const response = await callAnthropic({
        apiKey: (process.env.ANTHROPIC_API_KEY || process.env.ORCATRADE_OS_API),
        system: systemForTurn,
        tools: TOOLS,
        messages: workingMessages,
      });

      const assistantContent = Array.isArray(response.content) ? response.content : [];
      workingMessages.push({ role: 'assistant', content: assistantContent });

      const textBlocks = assistantContent.filter(b => b.type === 'text');
      const toolBlocks = assistantContent.filter(b => b.type === 'tool_use');

      for (const block of textBlocks) {
        if (block.text) {
          emit(res, { type: 'text-delta', text: block.text });
          finalText += block.text;
        }
      }

      if (response.stop_reason === 'end_turn' || !toolBlocks.length) {
        emit(res, { type: 'final', text: finalText, stopReason: response.stop_reason });
        return emitDone(res);
      }

      const toolResults = [];
      for (const toolUse of toolBlocks) {
        const impl = toolImpls[toolUse.name];
        emit(res, { type: 'tool-call', name: toolUse.name, args: toolUse.input, callId: toolUse.id });

        let toolResult;
        if (!impl) {
          toolResult = { error: `Unknown tool: ${toolUse.name}` };
        } else {
          try {
            toolResult = await impl(toolUse.input || {});
          } catch (err) {
            toolResult = { error: err.message || 'tool execution failed' };
          }
        }
        emit(res, { type: 'tool-result', name: toolUse.name, callId: toolUse.id, result: toolResult });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(toolResult).slice(0, 8000),
        });
      }

      workingMessages.push({ role: 'user', content: toolResults });
      toolTurns += 1;
    }

    emit(res, { type: 'final', text: finalText, stopReason: 'max_tool_turns' });
    emitDone(res);
  } catch (err) {
    emit(res, { type: 'error', message: err.message || 'unknown error' });
    emitDone(res);
  }
};

module.exports.TOOLS = TOOLS;
module.exports.toolImpls = toolImpls;
module.exports.SYSTEM_PROMPT = SYSTEM_PROMPT;

module.exports.LOGISTICS_PROMPT_VERSION = LOGISTICS_PROMPT_VERSION;
module.exports.SYSTEM_PROMPT_HASH = SYSTEM_PROMPT_HASH;
