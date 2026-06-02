// @ts-check
'use strict';

// Central model registry (Sprint opus-first-v1).
// First file opted into TypeScript checking under the incremental
// adoption policy. See docs/adr/0010-typescript-incremental-adoption.md.
//
// The agent layer leads with the strongest reasoning model — quality of the
// agents IS the product, so we don't under-power them to save pennies. Cheaper
// tiers are reserved strictly for work that never reaches a customer decision
// (intent triage, high-volume mechanical extraction). See
// docs/billion-dollar-plan.md §Pillar I, I1.
//
// Use these constants instead of inlining model-ID strings so a model bump is a
// one-line change and the registry is the single source of truth.
/** @type {Readonly<{ AGENT: string; TRIAGE: string; BULK: string }>} */
const MODELS = Object.freeze({
  // Customer-facing reasoning, drafts, cross-domain synthesis. The agents +
  // orchestrator + main one-shot analyses run here.
  AGENT: 'claude-opus-4-7',
  // Intent classification / routing — output never reaches a decision.
  TRIAGE: 'claude-haiku-4-5',
  // High-volume mechanical sub-tasks (bulk extraction) where quality is not
  // on the line.
  BULK: 'claude-sonnet-4-6',
});

// ── Prompt caching ──────────────────────────────────────────────────────
//
// Caching is a prefix match: tools render first, then system, then messages.
// A cache_control breakpoint on a system block caches the entire (tools +
// system-up-to-that-block) prefix. We put the breakpoint on the large STATIC
// system prompt and let the small per-turn suffix (context, locale directive)
// ride in an uncached trailing block — so the cache survives across turns,
// locales, and users, and a multi-turn tool loop re-reads it on every turn
// instead of re-paying for it.
//
// Minimum cacheable prefix on Opus is ~4096 tokens; the agents' tool schemas +
// detailed prompt comfortably exceed it. Below that, the API silently skips
// caching (no error) — verify via usage.cache_read_input_tokens.

/** @type {{ type: 'ephemeral' }} */
const EPHEMERAL = { type: 'ephemeral' };

/**
 * A single cacheable block in an Anthropic `system` field.
 *
 * @typedef {object} SystemBlock
 * @property {'text'} type
 * @property {string} text
 * @property {{ type: 'ephemeral' }} [cache_control]
 *   Set on the stable prefix block to mark the boundary at which the
 *   prompt prefix is cached. Omitted on volatile trailing blocks.
 */

/**
 * Build an Anthropic `system` field as cacheable blocks: a stable prefix
 * (cached) plus an optional small volatile suffix (uncached). Pass the
 * volatile text only when non-empty.
 *
 * @param {string} stableText
 * @param {string} [volatileText]
 * @returns {SystemBlock[]}
 */
function cachedSystem(stableText, volatileText) {
  /** @type {SystemBlock[]} */
  const blocks = [{ type: 'text', text: String(stableText || ''), cache_control: EPHEMERAL }];
  const tail = String(volatileText || '');
  if (tail) blocks.push({ type: 'text', text: tail });
  return blocks;
}

module.exports = { MODELS, cachedSystem };
