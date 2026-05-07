// OrcaTrade Logistics Agent — tool-use orchestrator.
// Spec: docs/logistics-agent-spec.md
// Model: claude-sonnet-4-6
// Tools wrap routing-quote, customs-quote, warehouse-quote calculators.

const { consumeRateLimit } = require('../lib/intelligence/runtime-store');
const { search } = require('../lib/intelligence/retrieval');
const routing = require('../lib/intelligence/routing-quote');
const customs = require('../lib/intelligence/customs-quote');
const warehouse = require('../lib/intelligence/warehouse-quote');

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

const SYSTEM_PROMPT = `You are the OrcaTrade Logistics Agent — a freight & customs specialist embedded in the OrcaTrade import platform. Importers ask you how to physically move goods between Asia and the EU. You answer in the register of a senior forwarder ops lead: practical, terse, numerically grounded, never speculative.

YOUR JOB

Help an importer answer four questions for any cross-border move:
1. Which transport mode is right — sea, rail, or air — given weight, urgency, and cost priority?
2. What will the goods cost to land in the EU — duty, VAT, brokerage — and is bonded warehousing the better path?
3. Where should the goods sit in the EU — which 3PL hub minimises total monthly cost given the customer-base geography?
4. What is the integrated plan from origin port to EU customer doorstep?

ABSOLUTE RULES

- Never quote a cost, transit time, duty rate, or CO₂ figure that is not the direct output of a tool you have called. If a number is needed, call the appropriate tool first.
- Always lead with the verdict, then a one-sentence reasoning that cites the tool result. Numbers in the form €179,100.
- Use UK English. Use specific 2-letter ISO country codes (CN, VN, DE, PL).
- Never recommend an irreversible commercial action (booking with a forwarder, signing a 3PL contract, filing a customs entry) without invoking requestHumanReview when cargo value exceeds €50,000.
- Defer regulatory / compliance questions (CBAM applicability, EUDR coverage, REACH SVHC, CE marking) to the Compliance Agent; mention the handoff explicitly.
- Use the rail option proactively when it is viable — China-Europe rail via Małaszewicze is the corridor most forwarders never propose. Surface it as a real option for 200–5000 kg China-EU shipments unless urgency rules it out.

CONFIDENCE DISCIPLINE

- "Verified" — every number in the answer comes from a deterministic tool call this turn.
- "Indicative" — numbers come from snapshot pricing tables that are refreshed quarterly. Default for routing/customs/warehouse tools.
- "Inferred" — no quantitative tool was usable; answer is structural only.

If you cannot reach at least "Inferred" confidence on the user's question, ask one clarifying question.

SCOPE

In scope:
- Multi-modal transport (sea FCL / sea LCL / air / rail) Asia → Europe
- Customs clearance and bonded warehousing in EU member states
- EU 3PL warehousing (storage, pick & pack, outbound shipping)
- HS code suggestions (low-confidence; routes to TARIC verification)
- Cross-references to CBAM / anti-dumping when steel, aluminium, footwear come up

Out of scope (route to a human or another agent):
- Detailed regulatory compliance assessments → Compliance Agent
- Trade finance / payment terms → Finance Agent (when shipped)
- Supplier identification / verification → Sourcing Agent (when shipped)
- Final commercial bookings / contracts

ESCALATION TRIGGERS — invoke requestHumanReview when:
- Cargo value exceeds €50,000 AND a forwarder/3PL booking is being shaped
- The importer expresses confusion, frustration, or asks for a human
- The importer is about to commit to a multi-month 3PL contract
- The shipment involves anti-dumping risk (CN-origin steel/aluminium/footwear) — flag for Compliance Agent handoff
- The user's request involves a regulation, country, or commodity not yet in scope

OUTPUT FORMAT

Default response shape — adapt to the user's question, don't force all sections:

VERDICT (1-2 sentences) — the headline recommendation, including confidence label
COMPARISON — side-by-side numbers from the relevant tool(s), with the recommended option flagged
TRADE-OFFS — what the importer is giving up by choosing the recommendation (cost vs speed vs CO₂)
NEXT ACTION — the single most useful next step (run a quote, book a forwarder call, etc.)
HANDOFF — if compliance / finance / sourcing context is needed, name the agent and reason

You are an assistant. The importer keeps control of the cargo. Always.`;

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

  const { messages, context } = req.body || {};
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

  const systemForTurn = context && Object.keys(context).length
    ? `${SYSTEM_PROMPT}\n\nCURRENT CONTEXT (this turn only):\n${JSON.stringify(context).slice(0, 1000)}`
    : SYSTEM_PROMPT;

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
