// OrcaTrade Operations Orchestrator — unified meta-agent.
// Spec: docs/orchestrator-agent-spec.md
// Combines the Compliance Agent's tools and the Logistics Agent's tools into
// a single Anthropic tool-use loop. Shared tools (lookupHsCode, searchRegulations,
// requestHumanReview) appear once. Total: 14 unique tools.

const { consumeRateLimit } = require('../intelligence/runtime-store');
const compliance = require('./agent');
const logistics = require('./logistics-agent');
const sourcing = require('./sourcing-agent');
const finance = require('./finance-agent');

const ORCHESTRATOR_MODEL = 'claude-sonnet-4-6';
const ORCHESTRATOR_MAX_TOKENS = 2200;
const ORCHESTRATOR_TURN_TIMEOUT_MS = 30000;
const ORCHESTRATOR_MAX_TOOL_TURNS = 10;

// ── Merge tool sets, dedupe by name ─────────────────────

function mergeTools(...toolSets) {
  const seen = new Set();
  const merged = [];
  for (const set of toolSets) {
    for (const t of set) {
      if (seen.has(t.name)) continue;
      seen.add(t.name);
      merged.push(t);
    }
  }
  return merged;
}

function mergeImpls(...implSets) {
  // Shared tools (searchRegulations, lookupHsCode, requestHumanReview) have equivalent
  // semantics across agents — later sets override earlier; pick the most recent one.
  return Object.assign({}, ...implSets);
}

const TOOLS = mergeTools(compliance.TOOLS, logistics.TOOLS, sourcing.TOOLS, finance.TOOLS);
const toolImpls = mergeImpls(compliance.toolImpls, logistics.toolImpls, sourcing.toolImpls, finance.toolImpls);

// ── System prompt ────────────────────────────────────────

const SYSTEM_PROMPT = `You are the OrcaTrade Operations Orchestrator — the platform's senior trade adviser embedded in every importer's workflow. You combine the deep regulatory knowledge of the Compliance Agent and the freight & customs expertise of the Logistics Agent. Your job is to answer the importer's question fully in a single conversation, regardless of how many domains it touches.

YOUR JOB

When the importer asks a question, you decide which specialty (or specialties) it touches and you call the relevant tools. Most useful questions cross domains — you should not artificially route them out.

DOMAIN CHEAT SHEET

- Sourcing question: where to source, country comparison (CN/VN/IN/BD/TR), supplier shortlist, lead time, factory audit discipline — use the sourcing tools.
- Regulation / compliance question: CBAM, EUDR, REACH, CE marking, anti-dumping, RoHS — use the compliance tools.
- Transport / customs / warehousing: mode comparison, landed cost, bonded warehouse, 3PL hub selection, full shipment plan — use the logistics tools.
- Finance question: payment instruments (TT/LC/OA), LC pricing, FX hedging, working capital cycle, trade-credit insurance — use the finance tools (comparePaymentInstruments, estimateLcCost, estimateFxHedgingCost, calculateWorkingCapitalCycle, assessTradeCreditCover).
- Cross-domain: a brand-new sourcing decision often crosses ALL FOUR — sourcing (which country?) + compliance (does CBAM/EUDR/CE apply?) + logistics (what's the landed cost?) + finance (how do I pay, hedge, finance the cycle?). Use tools across all four columns when the user is launching a new product line.

ABSOLUTE RULES

- Never assert a regulatory obligation, date, citation, cost, transit time, duty rate, or CO₂ figure that is not the direct output of a tool you have called this turn. If a fact is not in scope, say so explicitly.
- Every regulatory claim ends with a citation in the form [chunk-id], referencing one of the chunks returned by searchRegulations.
- Every quantitative claim about money, transit time, or hub cost cites the tool that produced it.
- Never recommend an irreversible commercial action (DDS submission, CBAM declaration, customs filing, forwarder booking, multi-month 3PL contract) without invoking requestHumanReview.
- Use UK English. EUR figures in the form €179,100. ISO-2 country codes (CN, VN, DE, PL).
- Speak directly to the importer. Lead with the verdict.

CONFIDENCE DISCIPLINE

- "Verified" — every claim in the answer is backed by retrieved verbatim regulation text or a deterministic tool result.
- "Indicative" — backed by retrieved summaries plus snapshot pricing data (refreshed quarterly).
- "Inferred" — corpus-backed but no quantitative tool was usable; structural answer only.

If you cannot reach at least "Inferred" confidence on the user's question, ask one clarifying question.

ESCALATION TRIGGERS — invoke requestHumanReview when:
- Cargo value > €50,000 AND any commercial commitment is being recommended
- The importer expresses confusion, frustration, or asks for a human
- The shipment involves anti-dumping risk (CN-origin steel/aluminium/footwear) — flag both for human review and for cross-checking
- The importer's question depends on a regulation, country, or commodity not yet in scope (food contact, MDR, IVDR, EU AI Act, textile labelling)

OUT OF SCOPE — route to a human:
- Trade finance, payment terms, letters of credit, hedging
- Supplier identification or supplier-side due diligence
- Final commercial bookings or contract negotiation

OUTPUT FORMAT

Default response shape — adapt to the user's question:

VERDICT (1-2 sentences) — the headline answer with confidence label
APPLICABLE DOMAINS — which specialties this question touches and why
COMPLIANCE — regulation findings with citations (only if compliance tools were called)
LOGISTICS — transport/customs/warehouse findings with numbers (only if logistics tools were called)
NEXT ACTION — the single most useful next step
UNKNOWNS / HANDOFF — what would change the answer; whether to escalate to human ops

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
  const timeoutId = setTimeout(() => controller.abort(), ORCHESTRATOR_TURN_TIMEOUT_MS);
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
        model: ORCHESTRATOR_MODEL,
        max_tokens: ORCHESTRATOR_MAX_TOKENS,
        system, tools, messages,
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
  const rate = await consumeRateLimit('orchestrator', ip, 12, 60000);
  if (rate.limited) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });

  const { messages, context } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  if (!(process.env.ANTHROPIC_API_KEY || process.env.ORCATRADE_OS_API)) {
    return res.status(503).json({ error: 'Operations Orchestrator requires ANTHROPIC_API_KEY to be configured.' });
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
  const domainsTouched = new Set();

  try {
    while (toolTurns < ORCHESTRATOR_MAX_TOOL_TURNS) {
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
        emit(res, {
          type: 'final',
          text: finalText,
          stopReason: response.stop_reason,
          domainsTouched: Array.from(domainsTouched),
        });
        return emitDone(res);
      }

      const toolResults = [];
      for (const toolUse of toolBlocks) {
        const impl = toolImpls[toolUse.name];
        const domain = classifyTool(toolUse.name);
        if (domain) domainsTouched.add(domain);

        emit(res, {
          type: 'tool-call',
          name: toolUse.name,
          domain,
          args: toolUse.input,
          callId: toolUse.id,
        });

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

    emit(res, {
      type: 'final',
      text: finalText,
      stopReason: 'max_tool_turns',
      domainsTouched: Array.from(domainsTouched),
    });
    emitDone(res);
  } catch (err) {
    emit(res, { type: 'error', message: err.message || 'unknown error' });
    emitDone(res);
  }
};

function classifyTool(name) {
  const compliance = new Set([
    'searchRegulations', 'checkCbamApplicability', 'estimateCbamExposure',
    'checkEudrApplicability', 'assessEudrCompliance',
    'checkReachApplicability', 'assessReachCompliance',
    'checkCeApplicability', 'assessCeCompliance',
  ]);
  const logistics = new Set([
    'compareTransportModes', 'estimateLandedCost', 'compareWarehouseHubs',
    'recommendShipmentPlan', 'getDestinationVatRate',
  ]);
  const sourcing = new Set([
    'compareSourcingCountries', 'assessSourcingRisk',
    'estimateSourcingLeadTime', 'listSupplierShortlist',
  ]);
  const finance = new Set([
    'comparePaymentInstruments', 'estimateLcCost',
    'estimateFxHedgingCost', 'calculateWorkingCapitalCycle',
    'assessTradeCreditCover',
  ]);
  if (compliance.has(name)) return 'compliance';
  if (logistics.has(name)) return 'logistics';
  if (sourcing.has(name)) return 'sourcing';
  if (finance.has(name)) return 'finance';
  if (name === 'lookupHsCode' || name === 'requestHumanReview') return 'shared';
  return null;
}

module.exports.TOOLS = TOOLS;
module.exports.toolImpls = toolImpls;
module.exports.classifyTool = classifyTool;
module.exports.SYSTEM_PROMPT = SYSTEM_PROMPT;
