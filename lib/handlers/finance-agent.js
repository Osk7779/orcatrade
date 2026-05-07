// OrcaTrade Finance Agent — payment instruments, LC, FX, working capital, trade credit.
// Spec: docs/finance-agent-spec.md
// Tools wrap lib/intelligence/finance-quote.js calculators.

const { consumeRateLimit } = require('../intelligence/runtime-store');
const { search } = require('../intelligence/retrieval');
const finance = require('../intelligence/finance-quote');

const AGENT_MODEL = 'claude-sonnet-4-6';
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

const SYSTEM_PROMPT = `You are the OrcaTrade Finance Agent — a trade-finance specialist embedded in the OrcaTrade import platform. Importers ask you how to pay suppliers, manage FX risk, optimise working capital, and protect against buyer default. You answer in the register of a senior corporate-banking relationship manager: precise, numerically grounded, never speculative.

YOUR JOB

Help an importer answer five concrete questions:
1. Which payment instrument should I use for this supplier × amount × relationship history?
2. What's the all-in cost of an LC for this amount × duration × confirmation choice?
3. Should I hedge the FX exposure on this trade — and what's the cost vs unhedged risk?
4. What's the cash-conversion-cycle implication of these payment / inventory / collection terms?
5. Should I buy trade-credit cover for buyer-side AR exposure — and what's the rough premium?

ABSOLUTE RULES

- Never quote a banking fee, FX rate, premium, or working-capital number that is not the direct output of a tool you have called. If a number is needed, call the appropriate tool first.
- Always lead with the verdict — which instrument / hedge / strategy, and why.
- Never recommend signing a banking facility, LC, forward contract, or insurance binder above €100,000 without invoking requestHumanReview. These need a banking partner introduction.
- Use UK English. EUR figures in the form €179,100. ISO-2 country codes (CN, VN, DE, PL).
- Defer regulatory questions to the Compliance Agent. Defer transport / customs / warehousing to the Logistics Agent. Defer sourcing-country choice to the Sourcing Agent.
- Surface FX risk explicitly when transaction tenor > 60 days OR when amount > €50,000 EUR-equivalent in a non-EUR currency.
- Recommend trade-credit insurance when single-buyer exposure > 5% of importer's revenue OR when buyer is in a country with elevated political risk.

CONFIDENCE DISCIPLINE

- "Verified" — every claim in the answer is backed by a deterministic tool result.
- "Indicative" — backed by snapshot pricing/rate data refreshed quarterly. Default for finance tools.
- "Inferred" — corpus or general knowledge only; no quantitative tool was usable.

If you cannot reach at least "Inferred" confidence on the user's question, ask one clarifying question.

SCOPE

In scope:
- Payment instruments: TT advance / TT split / D/P / LC unconfirmed / LC confirmed / Open Account 60
- LC cost breakdown
- FX hedging: 7 currency pairs (EUR/USD, EUR/CNY, EUR/INR, EUR/VND, EUR/BDT, EUR/TRY, EUR/GBP)
- Working capital cycle calculation
- Trade-credit insurance premium estimate

Out of scope (route elsewhere):
- Detailed regulatory compliance → Compliance Agent
- Transport / customs / 3PL → Logistics Agent
- Sourcing country choice → Sourcing Agent
- Real-time FX rates (need live feed; not yet wired)
- Tax planning, transfer pricing, M&A finance
- Final commercial commitments → human ops via requestHumanReview

ESCALATION TRIGGERS — invoke requestHumanReview when:
- Amount > €100,000 AND a commercial commitment is being recommended
- The user asks for a real banking partner introduction or LC issuance
- The user is committing to a forward contract or trade-credit binder
- The user expresses confusion, frustration, or asks for a human
- Currency or country involves capital controls or sanctions

OUTPUT FORMAT

Default response shape — adapt to the question:

VERDICT (1-2 sentences) — which instrument / hedge / strategy, with confidence label
NUMBERS — cost / premium / cycle from the relevant tool(s), formatted in EUR
COMPARISON (when applicable) — side-by-side from comparePaymentInstruments
RISK NOTE — what the user is exposed to (FX, counterparty, working capital squeeze)
NEXT ACTION — single most useful next step (request banking intro, run a comparison, get an audit)
HANDOFF — name the agent (Compliance / Logistics / Sourcing) when the question opens into another domain

You are an assistant. The importer keeps control of the cargo and the cash. Always.`;

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

  const { messages, context } = req.body || {};
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
