// OrcaTrade Finance Agent — payment instruments, LC, FX, working capital, trade credit.
// Spec: docs/finance-agent-spec.md
// Tools wrap lib/intelligence/finance-quote.js calculators.

const { consumeRateLimit } = require('../intelligence/runtime-store');
const gating = require('../gating');
const { searchHybrid } = require('../intelligence/retrieval');
const finance = require('../intelligence/finance-quote');

const { MODELS, cachedSystem } = require('../ai/models');
const AGENT_MODEL = MODELS.AGENT;
const AGENT_MAX_TOKENS = 1800;
const AGENT_TURN_TIMEOUT_MS = 30000;
const AGENT_MAX_TOOL_TURNS = 8;

// ── Tool schemas ────────────────────────────────────────

const TOOLS = [
  {
    name: 'comparePaymentInstruments',
    description: 'Compare 6 payment instruments (TT advance, TT split 30/70, D/P documentary collection, LC unconfirmed, LC confirmed, Open Account 60) for a given amount + supplier relationship history. Returns all-in cost (banking fees) and risk profile per instrument plus a recommendation tuned to amount × relationship × risk appetite. Always use this when the user asks how to pay a supplier.',
    input_schema: {
      type: 'object',
      properties: {
        amountEur: { type: 'number', minimum: 1 },
        supplierCountry: { type: 'string', description: 'ISO-2 supplier country.' },
        supplierRelationshipMonths: { type: 'integer', minimum: 0, description: 'How long the importer has worked with this supplier.' },
        importerRiskAppetite: { type: 'string', enum: ['low', 'balanced', 'high'], description: 'Default balanced.' },
      },
      required: ['amountEur'],
    },
  },
  {
    name: 'estimateLcCost',
    description: 'Estimate the all-in cost of a Letter of Credit. Returns issuance fee (per quarter on amount), optional confirmation fee, document handling, wires, SWIFT charges, and anticipated discrepancy charges. Total expressed in EUR and as a percentage of the LC amount.',
    input_schema: {
      type: 'object',
      properties: {
        amountEur: { type: 'number', minimum: 1 },
        durationMonths: { type: 'number', minimum: 0.5, maximum: 36, description: 'Number of months between LC issuance and final payment / drawdown.' },
        confirmed: { type: 'boolean', description: 'Whether the LC is confirmed by an export-side bank.' },
        expectedDiscrepancies: { type: 'integer', minimum: 0, description: 'Anticipated number of doc discrepancies (typical: 0–2 with disciplined doc team).' },
      },
      required: ['amountEur', 'durationMonths'],
    },
  },
  {
    name: 'estimateFxHedgingCost',
    description: 'Estimate the cost of a forward contract (FX hedge) versus the unhedged 1-sigma risk for the holding period. Supports 7 currency pairs against EUR (USD, CNY, INR, VND, BDT, TRY, GBP). Returns hedging cost in EUR, forward-premium percentage, 1-sigma unhedged risk, and a recommendation note (typically: hedge if cost < unhedged 1σ).',
    input_schema: {
      type: 'object',
      properties: {
        amountEur: { type: 'number', minimum: 1 },
        currencyPair: { type: 'string', enum: ['EUR_USD', 'EUR_CNY', 'EUR_INR', 'EUR_VND', 'EUR_BDT', 'EUR_TRY', 'EUR_GBP'], description: 'Currency pair vs EUR.' },
        durationDays: { type: 'integer', minimum: 1, maximum: 720, description: 'Number of days until settlement.' },
      },
      required: ['amountEur', 'currencyPair', 'durationDays'],
    },
  },
  {
    name: 'calculateWorkingCapitalCycle',
    description: 'Calculate the cash-conversion cycle: DIO (days inventory) + DSO (days sales outstanding) - DPO (days payables outstanding). Returns total cycle in days plus implied annual carry cost on €100k sample volume at 6% cost-of-capital. Use to diagnose cash-flow pressure and surface levers (longer DPO via LC, faster DSO via better invoicing terms, shorter DIO via 3PL pick-pack).',
    input_schema: {
      type: 'object',
      properties: {
        dioDays: { type: 'number', description: 'Days inventory outstanding (e.g., 60 for typical SME 2-month inventory turn).' },
        dsoDays: { type: 'number', description: 'Days sales outstanding (e.g., 0 for DTC card, 30/60/90 for B2B invoicing).' },
        dpoDays: { type: 'number', description: 'Days payables outstanding (negative if paying upfront via TT advance, positive if paying on terms).' },
        costOfCapitalAnnual: { type: 'number', minimum: 0, maximum: 0.5, description: 'Optional, default 6%. Annual cost of working capital.' },
      },
      required: ['dioDays', 'dsoDays', 'dpoDays'],
    },
  },
  {
    name: 'assessTradeCreditCover',
    description: 'Estimate the annual premium for trade-credit insurance covering buyer-side AR exposure. Inputs: buyer country (loading factor), buyer size bracket (tier1 / mid / sme / unknown), exposure amount. Returns annual premium, rate as % of exposure, and breakdown of country × size factors. Use when the user has €30k+ AR exposure to a single buyer.',
    input_schema: {
      type: 'object',
      properties: {
        buyerCountry: { type: 'string', description: 'ISO-2 buyer country.' },
        buyerSizeBracket: { type: 'string', enum: ['tier1', 'mid', 'sme', 'unknown'], description: 'Buyer size segment.' },
        exposureEur: { type: 'number', minimum: 1, description: 'Maximum AR exposure to be covered.' },
      },
      required: ['exposureEur'],
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
    description: 'BM25 search across the regulation corpus when finance decisions touch a regulation (CBAM cost overlay, EUDR DDS timing, REACH cosmetic notification timeline, FX/capital-controls country notes). Use sparingly — defer detailed compliance to the Compliance Agent.',
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
    description: 'Mandatory escalation. Invoke when amount > €100,000 AND a commercial commitment is being recommended (LC issuance, forward contract, trade-credit binder), when the user asks for a real banking-partner introduction, when capital-controls / sanctions are involved, or when the user is confused.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
        severity: { type: 'string', enum: ['info', 'minor', 'moderate', 'major', 'critical'] },
        handoffTo: { type: 'string', enum: ['compliance_agent', 'logistics_agent', 'sourcing_agent', 'human_ops', 'banking_partner'] },
        context: { type: 'object' },
      },
      required: ['reason', 'severity'],
    },
  },
];

// ── Tool implementations ────────────────────────────────

const toolImpls = {
  comparePaymentInstruments(args) {
    return finance.comparePaymentInstruments(args);
  },
  estimateLcCost(args) {
    return finance.estimateLcCost(args);
  },
  estimateFxHedgingCost(args) {
    return finance.estimateFxHedgingCost(args);
  },
  calculateWorkingCapitalCycle(args) {
    return finance.calculateWorkingCapitalCycle(args);
  },
  assessTradeCreditCover(args) {
    return finance.assessTradeCreditCover(args);
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
  async searchRegulations({ query, regulationIds, topK }) {
    const hits = await searchHybrid(query, { regulationIds: regulationIds || ['cbam', 'eudr', 'reach', 'ce'], topK: topK || 3 });
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
    const ticketId = `tkt_fin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
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
const FINANCE_PROMPT_VERSION = "v1";
const SYSTEM_PROMPT = prompts.getPrompt("finance", FINANCE_PROMPT_VERSION);
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
function emit(res, payload) { res.write(`data: ${JSON.stringify(payload)}\n\n`); }
function emitDone(res) { emit(res, { type: 'done' }); res.end(); }

// Wrapped in lib/circuit.js per ADR 0006. Shared 'anthropic-messages'
// circuit across all 6 agent handlers — one sustained Anthropic outage
// trips one circuit, not six.
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
        body: JSON.stringify({ model: AGENT_MODEL, max_tokens: AGENT_MAX_TOKENS, system, tools, messages }),
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
  } finally { clearTimeout(timeoutId); }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('finance-agent', ip, 12, 60000);
  if (rate.limited) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });

  // Sprint 42: feature gate (Growth+) + monthly quota.
  const featureGate = await gating.checkFeature(req, 'financeAgent');
  if (!featureGate.allowed) return gating.gate(res, featureGate);
  const quotaGate = await gating.checkQuota(req, 'agentQueriesPerMonth', 1);
  if (!quotaGate.allowed) return gating.gate(res, quotaGate);

  const { messages, context, locale } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages array is required' });
  }
  if (!(process.env.ANTHROPIC_API_KEY || process.env.ORCATRADE_OS_API)) {
    return res.status(503).json({ error: 'Finance Agent requires ANTHROPIC_API_KEY to be configured.' });
  }

  const trimmedMessages = messages.slice(-12).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: typeof m.content === 'string' ? m.content.slice(0, 4000) : (Array.isArray(m.content) ? m.content : ''),
  }));
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
          agent: "finance",
          promptVersion: FINANCE_PROMPT_VERSION,
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
        if (!impl) toolResult = { error: `Unknown tool: ${toolUse.name}` };
        else {
          try { toolResult = await impl(toolUse.input || {}); }
          catch (err) { toolResult = { error: err.message || 'tool execution failed' }; }
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

module.exports.FINANCE_PROMPT_VERSION = FINANCE_PROMPT_VERSION;
module.exports.SYSTEM_PROMPT_HASH = SYSTEM_PROMPT_HASH;
