'use strict';

// Central model registry (Sprint opus-first-v1).
//
// The agent layer leads with the strongest reasoning model — quality of the
// agents IS the product, so we don't under-power them to save pennies. Cheaper
// tiers are reserved strictly for work that never reaches a customer decision
// (intent triage, high-volume mechanical extraction). See
// docs/billion-dollar-plan.md §Pillar I, I1.
//
// Use these constants instead of inlining model-ID strings so a model bump is a
// one-line change and the registry is the single source of truth.
const MODELS = {
  // Customer-facing reasoning, drafts, cross-domain synthesis. The agents +
  // orchestrator + main one-shot analyses run here.
  AGENT: 'claude-opus-4-7',
  // Intent classification / routing — output never reaches a decision.
  TRIAGE: 'claude-haiku-4-5',
  // High-volume mechanical sub-tasks (bulk extraction) where quality is not
  // on the line.
  BULK: 'claude-sonnet-4-6',
};

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

const EPHEMERAL = { type: 'ephemeral' };

// Build an Anthropic `system` field as cacheable blocks: a stable prefix
// (cached) plus an optional small volatile suffix (uncached). Pass the volatile
// text only when non-empty.
function cachedSystem(stableText, volatileText) {
  const blocks = [{ type: 'text', text: String(stableText || ''), cache_control: EPHEMERAL }];
  const tail = String(volatileText || '');
  if (tail) blocks.push({ type: 'text', text: tail });
  return blocks;
}

module.exports = { MODELS, cachedSystem };
