// Prompts must not hardcode model identifiers.
//
// The agent handler picks the model (lib/handlers/<agent>.js declares
// AGENT_MODEL, COMPLIANCE_MODEL, etc., and lib/ai/models.js owns the
// registry). The prompt should describe the AGENT's role, not the
// MODEL's identity.
//
// Why it matters:
//   - If a prompt says "I am Claude Opus 4.7" and the handler later
//     promotes to a newer model, the prompt LIES. The user is told
//     they're talking to Opus 4.7 when they're not. Confidence-tier
//     reporting becomes inaccurate.
//   - Eval drift: a "claude-sonnet-4-6" string in a prompt scopes the
//     case to that model implicitly. Bumping models silently weakens
//     coverage without anyone noticing.
//   - Vendor lock-in: a prompt that names "Claude" makes a future
//     "consider routing through a different provider for a niche tool
//     use" call impossible without rewriting the prompt.
//
// Allowed exceptions (none today): if a prompt genuinely MUST name a
// model (e.g. an eval case for a model-specific behaviour), add an
// allowlist entry with a justification.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PROMPTS_DIR = path.join(ROOT, 'lib', 'ai', 'prompts');

function listPromptFiles() {
  const out = [];
  for (const agent of fs.readdirSync(PROMPTS_DIR, { withFileTypes: true })) {
    if (!agent.isDirectory()) continue;
    const dir = path.join(PROMPTS_DIR, agent.name);
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.txt')) out.push(path.join(dir, f));
    }
  }
  return out.sort();
}

// Patterns that smell like a model identifier. Detected case-insensitively.
// Each is calibrated to a real production model name pattern.
const MODEL_ID_PATTERNS = Object.freeze([
  { name: 'Anthropic model id',
    re: /\bclaude[-_](?:opus|sonnet|haiku|instant)[-_]?\d+(?:[-_]\d+)?/i },
  { name: 'Anthropic family + version',
    re: /\bClaude\s+(?:Opus|Sonnet|Haiku)\s+\d+(?:\.\d+)?/i },
  { name: 'OpenAI model id',
    re: /\bgpt-[0-9][a-z0-9.-]*\b/i },
  { name: 'Gemini / PaLM',
    re: /\b(?:gemini|palm)-[0-9][a-z0-9.-]*\b/i },
  // Generic "model: <id>" pattern.
  { name: 'Model:<id> declaration',
    re: /\bmodel\s*[:=]\s*['"]?(?:claude|gpt|gemini)[-_]\S+/i },
]);

const PER_FILE_ALLOWLIST = Object.freeze({
  // 'lib/ai/prompts/compliance/v1.txt': ['Anthropic family + version'],
});

test('every prompt file is scanned (discovery sanity)', () => {
  const files = listPromptFiles();
  assert.ok(files.length >= 5,
    `Expected ≥5 prompt files, found ${files.length}. ` +
    'If you renamed the layout, update listPromptFiles().');
});

test('no prompt hardcodes a model identifier', () => {
  const offenders = [];
  for (const file of listPromptFiles()) {
    const rel = path.relative(ROOT, file);
    const allowed = new Set(PER_FILE_ALLOWLIST[rel] || []);
    const src = fs.readFileSync(file, 'utf8');
    for (const pat of MODEL_ID_PATTERNS) {
      if (allowed.has(pat.name)) continue;
      const m = src.match(pat.re);
      if (m) {
        // Find the line number for actionable error.
        const upTo = src.slice(0, m.index);
        const line = upTo.split('\n').length;
        offenders.push(`${rel}:${line}: ${pat.name} → ${JSON.stringify(m[0])}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `Prompts that hardcode a model identifier:\n  ${offenders.join('\n  ')}\n\n` +
    'The prompt should describe the AGENT (compliance, sourcing, finance) without naming the MODEL. ' +
    'The model is the handler\'s choice (lib/ai/models.js) and changes over time. ' +
    'A prompt that says "I am Claude Opus 4.7" lies the moment we upgrade. ' +
    'If you genuinely need a model name in a prompt, add to PER_FILE_ALLOWLIST with a justification.');
});

test('the model-id patterns actually match real model identifiers', () => {
  // Defensive: a future regex "simplification" could break the matcher.
  // Pin against synthetic fakes for each model family.
  const cases = [
    { input: 'I am claude-opus-4-7 reporting', expect: 'Anthropic model id' },
    { input: 'powered by Claude Sonnet 4.6 today', expect: 'Anthropic family + version' },
    { input: 'using gpt-4o for this task', expect: 'OpenAI model id' },
    { input: 'gemini-1.5-pro context window', expect: 'Gemini / PaLM' },
  ];
  for (const c of cases) {
    const pat = MODEL_ID_PATTERNS.find(p => p.name === c.expect);
    assert.ok(pat, `Pattern "${c.expect}" missing from MODEL_ID_PATTERNS`);
    assert.match(c.input, pat.re,
      `Pattern "${c.expect}" must match its synthetic fake: ${c.input}`);
  }
});

test('"Claude" alone (no version) is allowed', () => {
  // The prompt CAN say "Claude" as the brand — what's forbidden is the
  // version-bearing identifier. Pin this so the regex doesn't become
  // over-aggressive in a future refactor.
  const examples = [
    'You are powered by Claude.',
    'Claude is helpful.',
    'I am the OrcaTrade Compliance Agent built on Claude.',
  ];
  for (const ex of examples) {
    for (const pat of MODEL_ID_PATTERNS) {
      assert.doesNotMatch(ex, pat.re,
        `Pattern "${pat.name}" must NOT match brand-only mention: ${JSON.stringify(ex)}`);
    }
  }
});
