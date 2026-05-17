// Tests for lib/ai/prompts/registry.js — Sprint BG-6.1.
//
// The registry is the foundation for Track 6 (AI quality moat). These tests
// pin its hard contract: immutable versions, deterministic hashing, path-
// traversal guards, and an end-to-end check that the orchestrator handler
// reads its prompt through the registry (no inline drift).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const registry = require('../lib/ai/prompts/registry');

// ── Listing + path safety ────────────────────────────────────

test('listVersions: empty for unknown agent', () => {
  assert.deepEqual(registry.listVersions('nonexistent'), []);
});

test('listVersions: returns sorted v1, v2, … for orchestrator', () => {
  const versions = registry.listVersions('orchestrator');
  assert.ok(versions.length >= 1, 'at least v1 should be shipped');
  assert.equal(versions[0], 'v1');
  // Strictly ascending.
  for (let i = 1; i < versions.length; i++) {
    assert.ok(parseInt(versions[i].slice(1), 10) > parseInt(versions[i - 1].slice(1), 10));
  }
});

test('latestVersion returns the highest-numbered version', () => {
  const v = registry.latestVersion('orchestrator');
  assert.match(v, /^v\d+$/);
  const all = registry.listVersions('orchestrator');
  assert.equal(v, all[all.length - 1]);
});

test('latestVersion throws on unknown agent', () => {
  assert.throws(() => registry.latestVersion('nope'), /no prompt versions/);
});

test('promptPath rejects invalid agent name (path traversal guard)', () => {
  assert.throws(() => registry._promptPath('../etc', 'v1'), /invalid agent/);
  assert.throws(() => registry._promptPath('Orchestrator', 'v1'), /invalid agent/); // uppercase
  assert.throws(() => registry._promptPath('orch/estrator', 'v1'), /invalid agent/);
});

test('promptPath rejects invalid version format', () => {
  assert.throws(() => registry._promptPath('orchestrator', '1'), /invalid version/);
  assert.throws(() => registry._promptPath('orchestrator', 'v1.txt'), /invalid version/);
  assert.throws(() => registry._promptPath('orchestrator', 'latest'), /invalid version/);
  assert.throws(() => registry._promptPath('orchestrator', '../v1'), /invalid version/);
});

// ── Content + cache ──────────────────────────────────────────

test('getPrompt: returns non-empty content with normalised line endings', () => {
  const content = registry.getPrompt('orchestrator', 'v1');
  assert.ok(content.length > 500);
  assert.doesNotMatch(content, /\r\n/, 'line endings must be normalised to \\n');
});

test('getPrompt: caches the read (second call returns identical reference)', () => {
  const a = registry.getPrompt('orchestrator', 'v1');
  const b = registry.getPrompt('orchestrator', 'v1');
  // Same string identity proves cache hit.
  assert.equal(a === b, true, 'cached read should return the same string instance');
});

test('getPrompt: throws on missing version (deploy-bug detection)', () => {
  assert.throws(() => registry.getPrompt('orchestrator', 'v99'), /cannot read/);
});

test('getLatest convenience returns the highest version content', () => {
  const latest = registry.getLatest('orchestrator');
  const explicit = registry.getPrompt('orchestrator', registry.latestVersion('orchestrator'));
  assert.equal(latest, explicit);
});

// ── Hashing ─────────────────────────────────────────────────

test('hashPrompt: deterministic + 12 hex chars', () => {
  const h1 = registry.hashPrompt('hello');
  const h2 = registry.hashPrompt('hello');
  assert.equal(h1, h2);
  assert.match(h1, /^[a-f0-9]{12}$/);
});

test('hashPrompt: different content → different hash', () => {
  assert.notEqual(registry.hashPrompt('hello'), registry.hashPrompt('world'));
});

// ── Orchestrator handler integration ────────────────────────

test('orchestrator handler reads SYSTEM_PROMPT via the registry, not inline', () => {
  const handler = require('../lib/handlers/orchestrator');
  // The handler must export the registry-loaded prompt + its version + hash.
  assert.ok(typeof handler.SYSTEM_PROMPT === 'string', 'SYSTEM_PROMPT exported');
  assert.equal(handler.ORCHESTRATOR_PROMPT_VERSION, 'v1');
  assert.match(handler.SYSTEM_PROMPT_HASH, /^[a-f0-9]{12}$/);
  // The exported prompt must exactly match what the registry returns for that version.
  const fromRegistry = registry.getPrompt('orchestrator', handler.ORCHESTRATOR_PROMPT_VERSION);
  assert.equal(handler.SYSTEM_PROMPT, fromRegistry,
    'handler must not have a drifted inline copy of the prompt');
  assert.equal(handler.SYSTEM_PROMPT_HASH, registry.hashPrompt(fromRegistry));
});

test('orchestrator v1 prompt content carries the agent-specific contract', () => {
  // Light tripwire: if a future commit silently empties the file or
  // replaces the orchestrator behaviour, this catches it.
  const content = registry.getPrompt('orchestrator', 'v1');
  assert.match(content, /Operations Orchestrator/);
  assert.match(content, /ABSOLUTE RULES/);
  assert.match(content, /VERDICT/);
  assert.match(content, /requestHumanReview/);
});

// ── Prompt-file directory layout (catches forgotten-file commits) ─

// ── All-agent migration integration ─────────────────────────

test('every shipped agent handler reads its prompt via the registry', () => {
  // BG-6.1 closeout: every agent must be on the registry, no inline drift.
  // Each handler exports SYSTEM_PROMPT (from registry) + a versioned const
  // + SYSTEM_PROMPT_HASH for eval-log correlation.
  const handlers = [
    { mod: '../lib/handlers/orchestrator', agent: 'orchestrator', versionConst: 'ORCHESTRATOR_PROMPT_VERSION' },
    { mod: '../lib/handlers/agent',        agent: 'compliance',   versionConst: 'COMPLIANCE_PROMPT_VERSION' },
    { mod: '../lib/handlers/sourcing-agent',  agent: 'sourcing',  versionConst: 'SOURCING_PROMPT_VERSION' },
    { mod: '../lib/handlers/logistics-agent', agent: 'logistics', versionConst: 'LOGISTICS_PROMPT_VERSION' },
    { mod: '../lib/handlers/finance-agent',   agent: 'finance',   versionConst: 'FINANCE_PROMPT_VERSION' },
  ];
  for (const { mod, agent, versionConst } of handlers) {
    const h = require(mod);
    assert.ok(typeof h.SYSTEM_PROMPT === 'string', `${agent}: handler exports SYSTEM_PROMPT`);
    assert.ok(h.SYSTEM_PROMPT.length > 500, `${agent}: SYSTEM_PROMPT is substantial`);
    assert.equal(h[versionConst], 'v1', `${agent}: ${versionConst} pinned to v1`);
    assert.match(h.SYSTEM_PROMPT_HASH, /^[a-f0-9]{12}$/, `${agent}: SYSTEM_PROMPT_HASH is 12 hex chars`);
    // Hard-pin: the handler's prompt must match exactly what the registry serves.
    const fromRegistry = registry.getPrompt(agent, h[versionConst]);
    assert.equal(h.SYSTEM_PROMPT, fromRegistry,
      `${agent}: handler has drifted inline copy of the prompt`);
    assert.equal(h.SYSTEM_PROMPT_HASH, registry.hashPrompt(fromRegistry),
      `${agent}: SYSTEM_PROMPT_HASH does not match registry content`);
  }
});

test('every prompts/<agent>/ folder contains at least one v<n>.txt file', () => {
  const root = registry.PROMPTS_DIR;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  let foundAtLeastOneAgent = false;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    foundAtLeastOneAgent = true;
    const versions = fs.readdirSync(path.join(root, e.name)).filter(f => /^v\d+\.txt$/.test(f));
    assert.ok(versions.length >= 1, `agent dir ${e.name} has no v<n>.txt files`);
  }
  assert.ok(foundAtLeastOneAgent, 'expected at least one agent folder (orchestrator)');
});
