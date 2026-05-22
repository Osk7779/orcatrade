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
const { applyLocaleDirective } = require('../agent-i18n');
const gating = require('../gating');
const auth = require('../auth');
const orchestratorPersonal = require('./orchestrator-personal');

const { MODELS, cachedSystem } = require('../ai/models');
const ORCHESTRATOR_MODEL = MODELS.AGENT;
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

// Sprint orchestrator-personal-v1 — build the toolset for ONE request.
// When the request carries a valid session, the user's read-only
// personal tools (their saved plans + portfolios) are merged in so the
// model can reason over the caller's OWN data. Anonymous/invalid-session
// requests get the base toolset unchanged. Returns { tools, impls, user }.
async function buildToolset(req) {
  let user = null;
  try { user = await auth.getCurrentUserStrict(req); } catch (_) { user = null; }
  if (!user || !user.email) {
    return { tools: TOOLS, impls: toolImpls, user: null };
  }
  return {
    tools: mergeTools(TOOLS, orchestratorPersonal.personalTools),
    impls: mergeImpls(toolImpls, orchestratorPersonal.buildPersonalImpls(user.email)),
    user,
  };
}

// ── System prompt (Sprint BG-6.1: now loaded from versioned registry) ────
//
// The prompt content lives in lib/ai/prompts/orchestrator/v<n>.txt. Once
// shipped, a version is immutable — tuning means bumping the version
// number. ORCHESTRATOR_PROMPT_VERSION below pins which version this
// handler reads. The constant is exported so tests + the eval harness
// can assert which version is live in production.
const prompts = require('../ai/prompts/registry');
const ORCHESTRATOR_PROMPT_VERSION = 'v1';
const SYSTEM_PROMPT = prompts.getPrompt('orchestrator', ORCHESTRATOR_PROMPT_VERSION);
const SYSTEM_PROMPT_HASH = prompts.hashPrompt(SYSTEM_PROMPT);
// Sprint BG-6.4: every Anthropic call logs { agent, model, tokens, cost, latency }.
const { withCostTelemetry } = require('../ai/cost-telemetry');

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

  // Sprint 42: Orchestrator is Growth-tier and above (premium feature).
  const featureGate = await gating.checkFeature(req, 'orchestratorAgent');
  if (!featureGate.allowed) return gating.gate(res, featureGate);
  // Per-month query quota (free tier doesn't reach this code path due to
  // the feature gate, but quota tracking still applies for paid tiers).
  const quotaGate = await gating.checkQuota(req, 'agentQueriesPerMonth', 1);
  if (!quotaGate.allowed) return gating.gate(res, quotaGate);

  const { messages, context, locale } = req.body || {};
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

  // Cache the large static SYSTEM_PROMPT (+ tools) as a shared prefix; the
  // small per-turn context + locale directive ride in an uncached trailing
  // block so the cache survives across turns, locales, and users.
  const contextSuffix = context && Object.keys(context).length
    ? `\n\nCURRENT CONTEXT (this turn only):\n${JSON.stringify(context).slice(0, 1000)}`
    : '';
  const systemForTurn = cachedSystem(SYSTEM_PROMPT, applyLocaleDirective(contextSuffix, locale));

  // Sprint orchestrator-personal-v1 — per-request toolset: base tools +
  // (when signed in) the user's read-only saved-plans/portfolios tools.
  const { tools: turnTools, impls: turnImpls } = await buildToolset(req);

  openStream(res);
  emit(res, { type: 'thinking' });

  let workingMessages = [...trimmedMessages];
  let toolTurns = 0;
  let finalText = '';
  const domainsTouched = new Set();

  try {
    while (toolTurns < ORCHESTRATOR_MAX_TOOL_TURNS) {
      const response = await withCostTelemetry(
        {
          agent: 'orchestrator',
          promptVersion: ORCHESTRATOR_PROMPT_VERSION,
          promptHash: SYSTEM_PROMPT_HASH,
          model: ORCHESTRATOR_MODEL,
          requestId: req.requestId,
        },
        () => callAnthropic({
          apiKey: (process.env.ANTHROPIC_API_KEY || process.env.ORCATRADE_OS_API),
          system: systemForTurn,
          tools: turnTools,
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
        const impl = turnImpls[toolUse.name];
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
    'getComplianceCalendar',
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
  // Sprint orchestrator-personal-v1 — the user's own saved-items tools.
  if (orchestratorPersonal.PERSONAL_TOOL_NAMES.indexOf(name) !== -1) return 'account';
  return null;
}

module.exports.TOOLS = TOOLS;
module.exports.toolImpls = toolImpls;
module.exports.buildToolset = buildToolset;
module.exports.classifyTool = classifyTool;
module.exports.SYSTEM_PROMPT = SYSTEM_PROMPT;
module.exports.ORCHESTRATOR_PROMPT_VERSION = ORCHESTRATOR_PROMPT_VERSION;
module.exports.SYSTEM_PROMPT_HASH = SYSTEM_PROMPT_HASH;
