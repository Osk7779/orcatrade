// @ts-check
'use strict';

// Quote-prose generator — sprint 3 chunk 2.
//
// First calculator-grounded LLM write in the Operator arc. Takes the
// structured landed-cost quote + the customer's intent + the rank-1
// factory block, asks Opus to write a 200-word natural-language
// summary explaining the numbers, and returns prose the customer can
// read before they hit Approve.
//
// Calculator-grounding contract (ADR 0002)
// ────────────────────────────────────────
// The prompt instructs the model to reference numbers from the JSON
// only, never invent or estimate. A surface-level guard in the
// composeUserMessage helper hands the model the EXACT cents → EUR
// amounts so it never has to do arithmetic. The model's role is prose
// composition on top of pre-computed numerics; the calculators stay
// the source of truth.
//
// Anthropic SDK boundary (ADR 0003)
// ─────────────────────────────────
// Lives in lib/ai/ — only allowed home for API calls outside the
// agent handlers.
//
// Cost / safety posture
// ─────────────────────
//   • Opus call wrapped in circuit ('anthropic-messages', shared with the agents)
//   • Cost telemetry via lib/ai/cost-telemetry.withCostTelemetry
//   • Fail-soft: any failure path returns { ok: false, reason }, never throws
//   • Env kill-switch ORCATRADE_DISABLE_QUOTE_PROSE=1 for cost-control or test runs
//   • Skipped when ANTHROPIC_API_KEY is missing
//   • 20s per-call timeout (matches AGENT_TURN_TIMEOUT in handlers/agent.js)

const { MODELS, cachedSystem } = require('./models');
const { withCostTelemetry } = require('./cost-telemetry');
const circuit = require('../circuit');
const log = require('../log').withContext({ module: 'ai-quote-prose' });

const PROSE_MODEL = MODELS.AGENT; // Opus 4.7 — customer-facing prose
const PROSE_MAX_TOKENS = 600;     // 200-word target ≈ 350 tokens; budget headroom
const PROSE_PROMPT_VERSION = 'quote-prose-v1';
const PROSE_TURN_TIMEOUT_MS = 20_000;

const SYSTEM_PROMPT_STABLE = `You are an OrcaTrade trade-operations advisor.
Your job: write a SHORT (≈180-220 word) natural-language summary explaining a
landed-cost quote to a European SME importer who is about to approve a
managed-import service.

THE NON-NEGOTIABLE RULE
Every number you mention MUST come VERBATIM from the JSON below. Do NOT
invent, estimate, calculate, round, or paraphrase any monetary or
quantitative figure. If a number is not in the JSON, do NOT state it.
Reference numbers by the component label provided in the JSON.

WHAT TO COVER (in this order, 1 short paragraph each, ≈60 words)
  1. What this quote covers — product, route (origin → EU destination),
     quantity, target unit price. Stick to the customer's own words from
     intent.productDescription.
  2. Why this landed cost — call out duty, VAT, freight, finance, and the
     OrcaTrade managed-import fee in plain English. If the HS classification
     confidence is "low" or "none", flag this explicitly as needing team
     review BEFORE the customer should rely on the duty number.
  3. What OrcaTrade does for the take-rate — concrete: factory comms,
     customs filing, freight booking, FX handling, landed-cost guarantee.
     Reference the orcatradeFeePct + the orcatradeFeeEur from the JSON
     so the customer sees what they are paying for.

VOICE
British English. Conversational but precise. No emoji. No marketing
adjectives ("amazing", "best-in-class", etc.). No hedging ("we believe",
"approximately"). State what the calculator says.

OUTPUT FORMAT
Plain prose, no headings, no bullet points, no markdown. Paragraphs
separated by a single blank line.`;

/**
 * Build a compact JSON payload for the prompt. Pre-computes the EUR
 * amounts so the model never has to convert cents → euros itself.
 *
 * @param {{ request: any, landedQuote: any, topCountryBlock: any }} args
 */
function composeUserMessage({ request, landedQuote, topCountryBlock }) {
  const components = Array.isArray(landedQuote && landedQuote.components)
    ? landedQuote.components.map((/** @type {any} */ c) => ({
        component: c.component,
        label: c.label,
        eur: Number.isFinite(c.eurCents) ? (Number(c.eurCents) / 100).toFixed(2) : null,
        source: c.source,
        note: c.note || null,
      }))
    : [];
  const cargoValueEur = Number.isFinite(landedQuote && landedQuote.cargoValueCents)
    ? (Number(landedQuote.cargoValueCents) / 100).toFixed(2)
    : null;
  const totalLandedEur = Number.isFinite(landedQuote && landedQuote.totalLandedCents)
    ? (Number(landedQuote.totalLandedCents) / 100).toFixed(2)
    : null;
  const orcatradeFeeEur = Number.isFinite(landedQuote && landedQuote.orcatradeFeeCents)
    ? (Number(landedQuote.orcatradeFeeCents) / 100).toFixed(2)
    : null;

  const payload = {
    intent: {
      label: request.label || null,
      productDescription: request.productDescription || null,
      originCountry: request.originCountry || null,
      destinationCountry: request.destinationCountry || null,
      targetQuantity: request.targetQuantity || null,
      targetQuantityUnit: request.targetQuantityUnit || null,
      targetUnitPriceEur: Number.isFinite(request.targetUnitPriceCents)
        ? (Number(request.targetUnitPriceCents) / 100).toFixed(2)
        : null,
      targetDeliveryDate: request.targetDeliveryDate || null,
      certificationRequirements: Array.isArray(request.certificationRequirements) ? request.certificationRequirements : [],
    },
    quote: {
      currency: 'EUR',
      cargoValueEur,
      totalLandedEur,
      orcatradeFeeEur,
      orcatradeFeePct: typeof landedQuote.orcatradeFeePct === 'number' ? landedQuote.orcatradeFeePct : null,
      confidenceTier: landedQuote.confidenceTier || null,
      confidenceNotes: Array.isArray(landedQuote.confidenceNotes) ? landedQuote.confidenceNotes : [],
      components,
      hsClassification: landedQuote.methodology && landedQuote.methodology.hsClassification
        ? {
            hs6: landedQuote.methodology.hsClassification.hs6,
            label: landedQuote.methodology.hsClassification.label,
            confidenceTier: landedQuote.methodology.hsClassification.confidenceTier,
          }
        : null,
    },
    topCountry: topCountryBlock
      ? {
          country: topCountryBlock.country,
          countryRationale: topCountryBlock.countryRationale || null,
          leadTimeWeeks: typeof topCountryBlock.leadTimeWeeks === 'number' ? topCountryBlock.leadTimeWeeks : null,
        }
      : null,
  };

  return [
    'Here is the structured quote payload. Write the summary as instructed.',
    '',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

/**
 * Make the Anthropic /v1/messages call. Circuit-wrapped + cost-telemetry-wrapped.
 *
 * @param {{ apiKey: string, system: any, userMessage: string, actorEmailHash?: string }} args
 */
async function callAnthropicForProse({ apiKey, system, userMessage, actorEmailHash }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROSE_TURN_TIMEOUT_MS);
  try {
    /** @type {any} */
    const response = await withCostTelemetry(
      {
        agent: 'quote-prose',
        promptVersion: PROSE_PROMPT_VERSION,
        promptHash: null,
        model: PROSE_MODEL,
        requestId: null,
        // Cost-telemetry buckets spend by email (raw) — pass the
        // actor's emailHash via the dedicated field so attribution
        // works even when raw email isn't available.
        email: null,
        emailHash: actorEmailHash || null,
      },
      () => circuit.run('anthropic-messages', async () => {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: PROSE_MODEL,
            max_tokens: PROSE_MAX_TOKENS,
            system,
            messages: [{ role: 'user', content: userMessage }],
          }),
        });
        if (!r.ok) {
          const txt = await r.text();
          throw new Error(`Anthropic ${r.status}: ${txt.slice(0, 400)}`);
        }
        return await r.json();
      }, {
        fallback: (/** @type {any} */ { shortCircuited, err }) => {
          const reason = shortCircuited ? 'open' : 'failure';
          const msg = err && err.message ? `: ${err.message}` : '';
          throw new Error(`Anthropic circuit ${reason}${msg}`);
        },
      }),
    );
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Extract the assistant's text content block from the response.
 *
 * @param {any} response
 */
function extractAssistantText(response) {
  if (!response || !Array.isArray(response.content)) return null;
  const textBlock = response.content.find((/** @type {any} */ c) => c && c.type === 'text');
  if (!textBlock || typeof textBlock.text !== 'string') return null;
  const trimmed = textBlock.text.trim();
  return trimmed || null;
}

/**
 * Public entry. Returns:
 *   { ok: true, prose: { summary, model, promptVersion, generatedAt } }
 *   { ok: false, reason: 'disabled' | 'unconfigured' | 'no-quote' | 'empty-response' | 'failed' }
 *
 * @param {{
 *   request: any,
 *   landedQuote: any,
 *   factoryShortlist?: any[],
 *   actorEmailHash?: string
 * }} args
 */
async function generateQuoteProse({ request, landedQuote, factoryShortlist, actorEmailHash }) {
  if (String(process.env.ORCATRADE_DISABLE_QUOTE_PROSE || '') === '1') {
    return { ok: false, reason: 'disabled' };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ORCATRADE_OS_API;
  if (!apiKey) {
    return { ok: false, reason: 'unconfigured' };
  }
  if (!request || !landedQuote || !Array.isArray(landedQuote.components)) {
    return { ok: false, reason: 'no-quote' };
  }

  // Pick the rank-1 block from the shortlist for the prompt context.
  // If there isn't one, the prompt simply omits the topCountry — the
  // prose still works because the duty/freight/total are all in the quote.
  const blocks = Array.isArray(factoryShortlist) ? factoryShortlist : [];
  const topCountryBlock = blocks.find((b) => b && !b._meta && b.rank === 1) || null;

  const system = cachedSystem(SYSTEM_PROMPT_STABLE);
  const userMessage = composeUserMessage({ request, landedQuote, topCountryBlock });

  try {
    const response = await callAnthropicForProse({
      apiKey,
      system,
      userMessage,
      actorEmailHash,
    });
    const summary = extractAssistantText(response);
    if (!summary) {
      log.warn('quote-prose: empty response from Anthropic', { externalId: request.externalId });
      return { ok: false, reason: 'empty-response' };
    }
    return {
      ok: true,
      prose: {
        summary,
        model: PROSE_MODEL,
        promptVersion: PROSE_PROMPT_VERSION,
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.warn('quote-prose: generation failed', { externalId: request.externalId, reason });
    return { ok: false, reason: 'failed', detail: reason };
  }
}

module.exports = {
  // Internal helpers exposed for tests.
  SYSTEM_PROMPT_STABLE,
  PROSE_PROMPT_VERSION,
  PROSE_MODEL,
  PROSE_MAX_TOKENS,
  composeUserMessage,
  extractAssistantText,
  // Public entry point.
  generateQuoteProse,
};
