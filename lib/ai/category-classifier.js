// @ts-check
'use strict';

// Haiku-backed product → category classifier (sprint 4 chunk 2).
//
// Replaces the brittle keyword classifier in import-request-orchestrator
// for the customer-facing path. Why Haiku specifically:
//
//   • MODELS.TRIAGE per lib/ai/models.js — intent classification, never
//     reaches a decision number (ADR 0002 satisfied)
//   • Sub-second latency, ~$0.0005 per call — adds negligible cost to
//     the orchestrator run
//   • Robust to phrasings the keyword classifier misses ("food storage
//     container" vs "homeware", "powerbank" vs "electronics")
//
// Fail-soft posture (same as quote-prose)
// ───────────────────────────────────────
//   • Env kill-switch ORCATRADE_DISABLE_AI_CLASSIFIER=1
//   • Missing ANTHROPIC_API_KEY → falls back to keyword classifier
//   • Anthropic error / timeout → falls back to keyword classifier
//   • Returns the same shape as the keyword classifier so the orchestrator
//     can swap them transparently. Adds a `source` discriminator
//     ('haiku' | 'keyword') so the caller can record which path won.
//
// Calculator-grounding (ADR 0002)
// ────────────────────────────────
// The classifier output is used as the category enum passed to
// sourcing-quote, customs-quote, etc. The category influences which
// calculator parameters fire, but the model NEVER produces the
// resulting duty / freight / finance numbers — those come from the
// deterministic calculator outputs. The classification is reasoning
// about which bucket the product falls in, not about which number to
// quote.

const { MODELS, cachedSystem } = require('./models');
const { withCostTelemetry } = require('./cost-telemetry');
const circuit = require('../circuit');
const log = require('../log').withContext({ module: 'ai-category-classifier' });

const CLASSIFIER_MODEL = MODELS.TRIAGE; // Haiku
const CLASSIFIER_MAX_TOKENS = 80;       // structured output is ~30 tokens; budget for retries
const CLASSIFIER_PROMPT_VERSION = 'category-classifier-haiku-v1';
const CLASSIFIER_TURN_TIMEOUT_MS = 8_000;

// The closed taxonomy the downstream calculators understand. Must stay
// in lockstep with CATEGORIES in lib/ai/import-request-orchestrator.js;
// the test suite pins both.
const CATEGORIES = Object.freeze(
  /** @type {const} */ (['apparel', 'electronics', 'furniture', 'toys', 'cosmetics', 'footwear', 'machinery', 'homeware']),
);

const SYSTEM_PROMPT_STABLE = `You classify free-text product descriptions into a closed taxonomy of EIGHT product categories for an EU customs / sourcing calculator.

THE TAXONOMY (return EXACTLY ONE of these strings, lowercase, no quotes, no surrounding text)
  • apparel      — clothes, garments, textiles, footwear of fabric only
  • electronics  — electronics, electricals, cables, devices, batteries, sensors
  • furniture    — sofas, tables, desks, chairs, cabinets, beds
  • toys         — toys, dolls, puzzles, plush, games for children
  • cosmetics    — cosmetics, skincare, makeup, soap, fragrance, shampoo
  • footwear     — shoes, boots, sandals, sneakers, slippers (leather / rubber / synthetic)
  • machinery    — industrial equipment, machine tools, motors, pumps, compressors
  • homeware     — kitchenware, cookware, mats, containers, candles, vases, generic home goods

OUTPUT FORMAT (CRITICAL)
Reply with ONE WORD — the category enum value. Nothing else. No JSON, no
markdown, no explanation, no period.

DECISION RULES
  • If a product is ambiguous, choose the category whose calculator
    parameters (duty rate band, typical lead time, MOQ profile) will be
    LEAST WRONG. When in doubt between two candidates, prefer the more
    common one for SME imports.
  • If you genuinely cannot decide, return "homeware" — it is the
    safest broad-applicability fallback (matches the keyword classifier's
    default).

EXAMPLES
  "3,000 silicone kitchen mats food-grade" → homeware
  "USB-C 100W charger 2m braided"          → electronics
  "leather Oxford brogue size 41"          → footwear
  "wooden dining table seats 6"            → furniture
  "rose water facial toner 200ml"          → cosmetics
  "industrial benchtop CNC mill"           → machinery
  "stuffed teddy bear EU CE marked"        → toys
  "men's cotton oxford shirt blue"         → apparel`;

/**
 * Parse the Haiku response. The prompt asks for a single bare word; we
 * trim, lowercase, and reject anything that isn't one of the eight enum
 * values. Mismatch → null (caller falls back).
 *
 * @param {any} response
 */
function parseCategoryFromResponse(response) {
  if (!response || !Array.isArray(response.content)) return null;
  const textBlock = response.content.find((/** @type {any} */ c) => c && c.type === 'text');
  if (!textBlock || typeof textBlock.text !== 'string') return null;
  // Strip whitespace, surrounding punctuation, JSON wrapping artefacts.
  const cleaned = textBlock.text.trim().replace(/^["'`]+|["'`.,]+$/g, '').toLowerCase();
  const firstWord = cleaned.split(/[\s,]+/)[0] || '';
  if (CATEGORIES.includes(/** @type {any} */ (firstWord))) {
    return /** @type {string} */ (firstWord);
  }
  return null;
}

/**
 * Make the Anthropic /v1/messages call. Circuit-wrapped + cost-telemetry-wrapped.
 *
 * @param {{ apiKey: string, system: any, productDescription: string, actorEmailHash?: string }} args
 */
async function callAnthropicForClassification({ apiKey, system, productDescription, actorEmailHash }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLASSIFIER_TURN_TIMEOUT_MS);
  try {
    /** @type {any} */
    const response = await withCostTelemetry(
      {
        agent: 'category-classifier',
        promptVersion: CLASSIFIER_PROMPT_VERSION,
        promptHash: null,
        model: CLASSIFIER_MODEL,
        requestId: null,
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
            model: CLASSIFIER_MODEL,
            max_tokens: CLASSIFIER_MAX_TOKENS,
            system,
            messages: [{ role: 'user', content: productDescription }],
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
 * Async classifier. ALWAYS returns a category (falls back to the
 * keyword classifier on any AI failure path), plus the source signal
 * so the caller can record which path won.
 *
 * Result shape:
 *   { category: typeof CATEGORIES[number], source: 'haiku' | 'keyword',
 *     reason?: string, fallbackKeywordHits?: number }
 *
 * @param {{
 *   productDescription: string,
 *   actorEmailHash?: string,
 *   fallbackClassify: (text: string) => { category: string, hits: number, matched: string[] }
 * }} args
 */
async function classifyCategoryAsync({ productDescription, actorEmailHash, fallbackClassify }) {
  /** @type {(text: string) => { category: any, hits: number, matched: string[] }} */
  const fallback = typeof fallbackClassify === 'function'
    ? fallbackClassify
    : (() => ({ category: 'homeware', hits: 0, matched: [] }));

  function fallbackResult(/** @type {string} */ reason) {
    const k = fallback(productDescription || '');
    return {
      category: k.category,
      source: /** @type {'keyword'} */ ('keyword'),
      reason,
      fallbackKeywordHits: k.hits,
    };
  }

  if (String(process.env.ORCATRADE_DISABLE_AI_CLASSIFIER || '') === '1') {
    return fallbackResult('disabled-via-env');
  }
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ORCATRADE_OS_API;
  if (!apiKey) {
    return fallbackResult('unconfigured');
  }
  if (typeof productDescription !== 'string' || !productDescription.trim()) {
    return fallbackResult('no-product-description');
  }

  const system = cachedSystem(SYSTEM_PROMPT_STABLE);
  try {
    const response = await callAnthropicForClassification({
      apiKey,
      system,
      productDescription,
      actorEmailHash,
    });
    const parsed = parseCategoryFromResponse(response);
    if (!parsed) {
      log.warn('classifier: Haiku returned an unparseable category, falling back to keyword', {
        text: String(productDescription).slice(0, 80),
      });
      return fallbackResult('unparseable-response');
    }
    return {
      category: parsed,
      source: /** @type {'haiku'} */ ('haiku'),
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.warn('classifier: Haiku call failed, falling back to keyword', { reason });
    return fallbackResult(`anthropic-error: ${reason.slice(0, 120)}`);
  }
}

module.exports = {
  // Internal helpers exposed for tests.
  CATEGORIES,
  SYSTEM_PROMPT_STABLE,
  CLASSIFIER_MODEL,
  CLASSIFIER_PROMPT_VERSION,
  CLASSIFIER_MAX_TOKENS,
  parseCategoryFromResponse,
  // Public entry point.
  classifyCategoryAsync,
};
