// OrcaTrade Sourcing Agent — supplier discovery + country comparison.
// Spec: docs/sourcing-agent-spec.md
// Tools wrap lib/intelligence/sourcing-quote calculators.

const { consumeRateLimit } = require('../intelligence/runtime-store');
const { search } = require('../intelligence/retrieval');
const sourcing = require('../intelligence/sourcing-quote');

const AGENT_MODEL = 'claude-sonnet-4-6';
const AGENT_MAX_TOKENS = 1800;
const AGENT_TURN_TIMEOUT_MS = 30000;
const AGENT_MAX_TOOL_TURNS = 8;

// ── Tool schemas ────────────────────────────────────────

const TOOLS = [
  {
    name: 'compareSourcingCountries',
    description: 'Compare CN, VN, IN, BD, TR for a given product category. Returns ranked options with FOB index (relative to CN baseline), lead time (production + sea freight), MOQ bands, quality and IP risk levels, plus a recommendation. Always use this when the user asks where to source from.',
    input_schema: {
      type: 'object',
      properties: {
        productCategory: {
          type: 'string',
          enum: ['apparel', 'electronics', 'furniture', 'toys', 'cosmetics', 'homeware', 'footwear', 'machinery'],
          description: 'Product category. Must match one of the supported categories.',
        },
        targetFobUnitEur: { type: 'number', minimum: 0.1, description: 'Target FOB unit price in EUR — used as the CN baseline for the FOB index multiplication.' },
        moq: { type: 'integer', minimum: 1, description: 'Minimum order quantity per shipment.' },
        urgencyWeeks: { type: 'integer', minimum: 1, description: 'Maximum acceptable total lead time in weeks (production + sea freight). Used to filter viable countries.' },
        costPriority: { type: 'string', enum: ['cost', 'balanced'], description: 'Default balanced.' },
      },
      required: ['productCategory'],
    },
  },
  {
    name: 'assessSourcingRisk',
    description: 'Risk profile for a single country × category combination. Returns quality risk, IP risk, country-specific notes, specialty, caution, and an audit recommendation tier (light AQL vs full third-party audit). Use after compareSourcingCountries narrows the choice.',
    input_schema: {
      type: 'object',
      properties: {
        productCategory: { type: 'string', enum: ['apparel', 'electronics', 'furniture', 'toys', 'cosmetics', 'homeware', 'footwear', 'machinery'] },
        country: { type: 'string', description: 'ISO-2 country code (CN, VN, IN, BD, TR).' },
      },
      required: ['productCategory', 'country'],
    },
  },
  {
    name: 'estimateSourcingLeadTime',
    description: 'Estimate total lead time (production + sea freight) for a given MOQ. MOQ-sensitive — large orders take longer, very small orders may get deprioritised.',
    input_schema: {
      type: 'object',
      properties: {
        productCategory: { type: 'string', enum: ['apparel', 'electronics', 'furniture', 'toys', 'cosmetics', 'homeware', 'footwear', 'machinery'] },
        country: { type: 'string', description: 'ISO-2 country code.' },
        moq: { type: 'integer', minimum: 1 },
        urgencyWeeks: { type: 'integer', minimum: 1, description: 'Optional. If set, the result will flag whether the lead time meets the deadline.' },
      },
      required: ['productCategory', 'country'],
    },
  },
  {
    name: 'listSupplierShortlist',
    description: 'Curated sample suppliers (anonymised portfolio examples) for a country × category. Returns city, specialty, sample lead time, MOQ. Coverage is partial — when no shortlist exists, the response invites the user to request a custom OrcaTrade HK supplier-discovery sprint.',
    input_schema: {
      type: 'object',
      properties: {
        productCategory: { type: 'string', enum: ['apparel', 'electronics', 'furniture', 'toys', 'cosmetics', 'homeware', 'footwear', 'machinery'] },
        country: { type: 'string', description: 'ISO-2 country code.' },
      },
      required: ['productCategory', 'country'],
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
    description: 'BM25 search across the regulation corpus when sourcing decisions touch a regulation (EUDR for wood/soy/palm/coffee/cocoa/rubber/cattle, REACH for cosmetics or chemicals, CE for electronics/machinery, CBAM for steel/aluminium). Returns ranked chunks with citations. Use sparingly — defer detailed compliance to the Compliance Agent.',
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
    description: 'Mandatory escalation. Invoke when the importer is about to commit to a first PO above €20,000, when the user asks for real supplier introductions, when IP risk is high AND a unique design is in scope, when the user is confused or frustrated, or when a high-quality-risk × no-audit-experience combination needs human guidance.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
        severity: { type: 'string', enum: ['info', 'minor', 'moderate', 'major', 'critical'] },
        handoffTo: { type: 'string', enum: ['compliance_agent', 'finance_agent', 'logistics_agent', 'human_ops'] },
        context: { type: 'object' },
      },
      required: ['reason', 'severity'],
    },
  },
];

// ── Tool implementations ────────────────────────────────

function summariseRecommendation(result) {
  if (!result.ok) return { ok: false, errors: result.errors };
  return {
    ok: true,
    recommendation: result.recommendation,
    comparison: result.comparison,
    inputs: result.inputs,
    sourcingEducation: result.sourcingEducation,
    asOf: result.asOf,
  };
}

const toolImpls = {
  compareSourcingCountries(args) {
    return summariseRecommendation(sourcing.recommendCountry(args));
  },

  assessSourcingRisk({ productCategory, country }) {
    return sourcing.assessRisk({ productCategory, country });
  },

  estimateSourcingLeadTime({ productCategory, country, moq, urgencyWeeks }) {
    return sourcing.estimateLeadTime({ productCategory, country, moq, urgencyWeeks });
  },

  listSupplierShortlist({ productCategory, country }) {
    return sourcing.shortlistSuppliers({ productCategory, country });
  },

  lookupHsCode({ productDescription, intendedUse }) {
    return {
      suggestion: null,
      confidence: 0.0,
      message: 'HS code lookup requires EU TARIC database access, not yet wired into the agent. Recommend using access2markets.ec.europa.eu or verifying with the importer\'s customs broker.',
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
    const ticketId = `tkt_src_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
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

const SYSTEM_PROMPT = `You are the OrcaTrade Sourcing Agent — a supplier-discovery and country-sourcing specialist embedded in the OrcaTrade import platform. Importers ask you where to source goods from and which suppliers to approach. You answer in the register of a senior sourcing director who has run audits across CN, VN, IN, BD, and TR factories: candid, numerically grounded, never speculative.

YOUR JOB

Help an importer answer four questions for any new sourcing decision:
1. Which country (or countries) is the right starting point — given product category, target unit cost, MOQ, and urgency?
2. Who are sample suppliers I could approach? What's the typical MOQ and sample lead time?
3. What's the realistic total lead time (production + sea freight) for my MOQ size?
4. What audit discipline does this country × category combination demand before I commit?

ABSOLUTE RULES

- Never quote a unit FOB cost, lead time, MOQ figure, or risk classification that is not the direct output of a tool you have called. If a number is needed, call the appropriate tool first.
- Always lead with the verdict: which country (or countries), and why.
- Never recommend signing a first purchase order above €20,000 without invoking requestHumanReview — these need a factory audit and OrcaTrade HK office support.
- Use UK English. EUR figures in the form €179,100. ISO-2 country codes (CN, VN, IN, BD, TR).
- Defer regulatory questions to the Compliance Agent: CBAM applicability for steel/aluminium, EUDR for wood/soy/palm/cocoa/coffee/rubber/cattle, REACH for chemicals, CE marking for electronics/machinery/PPE/RED.
- Defer transport / customs / warehousing to the Logistics Agent.
- Surface IP risk explicitly when high — recommend NNN agreements, tooling partition, or moving to a lower-IP-risk country.
- Recommend dual-sourcing above 5,000 units per month (e.g., 70% CN + 30% VN backup).

CONFIDENCE DISCIPLINE

- "Verified" — every claim in the answer is backed by a deterministic tool result.
- "Indicative" — backed by snapshot pricing/lead-time data refreshed quarterly. Default for sourcing tools.
- "Inferred" — corpus or general knowledge only; no quantitative tool was usable.

If you cannot reach at least "Inferred" confidence on the user's question, ask one clarifying question.

SCOPE

In scope:
- Country sourcing comparison (CN / VN / IN / BD / TR)
- 8 product categories: apparel, electronics, furniture, toys, cosmetics, homeware, footwear, machinery
- Supplier shortlist examples (curated, anonymised)
- Lead-time estimation (production + sea freight)
- Country × category risk assessment

Out of scope (route elsewhere):
- Detailed compliance assessments → Compliance Agent
- Transport mode / landed cost / 3PL hub → Logistics Agent
- Trade finance / payment terms → Finance Agent (when shipped)
- Final supplier introductions or factory audits → human ops via requestHumanReview

ESCALATION TRIGGERS — invoke requestHumanReview when:
- The importer is about to commit to a first PO above €20,000
- The importer asks for a real supplier introduction
- IP risk is high AND the user is shipping a unique design
- The user expresses confusion, frustration, or asks for a human
- The country × category combination scores high quality risk AND the user has no audit experience

OUTPUT FORMAT

Default response shape — adapt to the question:

VERDICT (1-2 sentences) — which country to start with, with confidence label
COMPARISON — cost / lead time / risk side-by-side
RISK NOTES — quality + IP risk with audit recommendation
SHORTLIST (when applicable) — sample suppliers
NEXT ACTION — single most useful next step
HANDOFF — name the agent (Compliance / Logistics) when the question opens into another domain

You are an assistant. The importer keeps control of the supplier relationship. Always.`;

// ── HTTP / SSE plumbing (mirrors logistics-agent) ───────

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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('sourcing-agent', ip, 12, 60000);
  if (rate.limited) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });

  const { messages, context } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  if (!(process.env.ANTHROPIC_API_KEY || process.env.ORCATRADE_OS_API)) {
    return res.status(503).json({ error: 'Sourcing Agent requires ANTHROPIC_API_KEY to be configured.' });
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
module.exports.SYSTEM_PROMPT = SYSTEM_PROMPT;
