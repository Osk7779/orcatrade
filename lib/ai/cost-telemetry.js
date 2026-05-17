// Anthropic API cost telemetry — Sprint BG-6.4.
//
// Every call from an agent handler to the Anthropic API logs a structured
// telemetry line with { agent, promptVersion, inputTokens, outputTokens,
// cacheReadTokens, costCents, latencyMs, requestId }. The structured log
// (via lib/log.js) is greppable in Vercel + downstream-routable to a
// proper analytics store (Track 4.2: Sentry / Axiom drain).
//
// What it enables (queued as a dashboard sprint):
//   - Total weekly spend by agent
//   - Cost per case in the eval harness (regress on cost the same way
//     we regress on correctness)
//   - Cost per tier (free / starter / growth / scale) → margin per user
//   - Per-prompt-version cost telemetry — when v2 ships, compare v1
//     baseline vs v2 cost-per-call
//
// Pricing source: Anthropic public pricing as of 2026-05-17. Stored here
// rather than fetched live because (a) it changes rarely, (b) we need
// deterministic offline cost calculations in the test suite, (c) silent
// price drift would be a budget bug — surfaced as a CODEX.md non-
// negotiable: pricing changes are reviewable commits.

'use strict';

const log = require('../log').withContext({ module: 'ai-cost' });

// Cost in EUR cents per million tokens. Source: Anthropic public pricing
// converted at the FX snapshot in lib/intelligence/data/fx-snapshot.js.
// Update this table when Anthropic ships a new model or a price change.
const MODEL_PRICING_CENTS_PER_MILLION_TOKENS = Object.freeze({
  // Claude Sonnet 4 family — most agent traffic
  'claude-sonnet-4-6': { input: 278, output: 1389, cacheRead: 28 },
  'claude-sonnet-4-7': { input: 278, output: 1389, cacheRead: 28 },
  // Claude Opus 4 family — premium agents
  'claude-opus-4-6': { input: 1389, output: 6945, cacheRead: 139 },
  'claude-opus-4-7': { input: 1389, output: 6945, cacheRead: 139 },
  // Claude Haiku 4.5 — low-cost variant
  'claude-haiku-4-5': { input: 70, output: 348, cacheRead: 7 },
});

// Fallback pricing if a model name isn't in the table — fail loud in
// logs but don't crash the request. Sonnet 4.x rates are the safest
// over-estimate for unknown Claude 4 models.
const FALLBACK_PRICING = { input: 278, output: 1389, cacheRead: 28 };

function priceFor(model) {
  return MODEL_PRICING_CENTS_PER_MILLION_TOKENS[model] || FALLBACK_PRICING;
}

// Pure function: given a model and a usage object (Anthropic's response.usage
// shape), return total cost in EUR cents (integer, rounded half-even).
//
// usage shape from the Anthropic /v1/messages response:
//   { input_tokens, output_tokens, cache_read_input_tokens?, cache_creation_input_tokens? }
function computeCost(model, usage) {
  if (!usage || typeof usage !== 'object') return 0;
  const price = priceFor(model);
  const inT = Number(usage.input_tokens) || 0;
  const outT = Number(usage.output_tokens) || 0;
  const cacheT = Number(usage.cache_read_input_tokens) || 0;
  // Cache reads are billed at the cheaper cacheRead rate. Cache creation
  // is currently billed at the input rate, so it's already in inT.
  // Subtract cacheT from input to avoid double-counting.
  const billableInput = Math.max(0, inT - cacheT);
  const totalCents =
    (billableInput * price.input) / 1_000_000 +
    (outT * price.output) / 1_000_000 +
    (cacheT * price.cacheRead) / 1_000_000;
  return Math.round(totalCents);
}

// Pure function: tokens summary from a usage object.
function summariseTokens(usage) {
  if (!usage || typeof usage !== 'object') {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  }
  return {
    inputTokens: Number(usage.input_tokens) || 0,
    outputTokens: Number(usage.output_tokens) || 0,
    cacheReadTokens: Number(usage.cache_read_input_tokens) || 0,
  };
}

// Record an Anthropic API call. Called by each agent handler immediately
// after the response is parsed. Never throws (telemetry must not break
// the request); errors during recording are themselves logged.
function recordAnthropicCall({ agent, promptVersion, promptHash, model, requestId, response, latencyMs, tier, userTier }) {
  try {
    const usage = response && response.usage;
    const tokens = summariseTokens(usage);
    const costCents = computeCost(model, usage);
    log.info('anthropic call', {
      event: 'ai_call',
      agent,
      promptVersion: promptVersion || null,
      promptHash: promptHash || null,
      model,
      requestId: requestId || null,
      tier: tier || userTier || null,
      ...tokens,
      costCents,
      latencyMs: Number(latencyMs) || 0,
      stopReason: (response && response.stop_reason) || null,
    });
  } catch (err) {
    log.warn('cost telemetry threw', { err: err.message });
  }
}

// Convenience wrapper for handlers: takes a function that returns the
// Anthropic response, measures latency, records telemetry, returns the
// response. Drop-in replacement for direct callAnthropic() use.
//
// Usage in a handler:
//   const response = await withCostTelemetry(
//     { agent: 'orchestrator', promptVersion, promptHash, model, requestId: req.requestId },
//     () => callAnthropic({ apiKey, messages, system, tools })
//   );
async function withCostTelemetry(meta, fn) {
  const start = Date.now();
  try {
    const response = await fn();
    recordAnthropicCall({ ...meta, response, latencyMs: Date.now() - start });
    return response;
  } catch (err) {
    // Even on error we record a row so the dashboard counts failed calls
    // (they still cost upstream rate-limit budget even if not money).
    log.warn('anthropic call failed', {
      event: 'ai_call',
      agent: meta.agent,
      promptVersion: meta.promptVersion || null,
      model: meta.model,
      requestId: meta.requestId || null,
      latencyMs: Date.now() - start,
      err: err.message,
    });
    throw err;
  }
}

module.exports = {
  computeCost,
  summariseTokens,
  recordAnthropicCall,
  withCostTelemetry,
  priceFor,
  MODEL_PRICING_CENTS_PER_MILLION_TOKENS,
  FALLBACK_PRICING,
};
