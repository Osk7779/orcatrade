'use strict';

// Sprint 95 — getMyOrgServiceLevels: the agents learn the trust era.
//
// The orchestrator-personal toolset could reason over the user's
// saved plans and portfolios but was blind to everything sprints
// 80-92 built — it couldn't answer "how are we doing against our
// SLA" or "how accurate are your quotes for us". One read-only
// tool closes that: org membership derived from the CLOSURED
// session email, the SAME aggregation as the cockpit + digest
// (ADR-0021 single source), full knob threading, and honesty-tier
// discipline carried INTO THE TOOL DESCRIPTION so the model is
// instructed — not trusted — to report accruing states honestly.
//
// Test layers:
//   1. Schema: registered, auto-classified 'account', description
//      carries the honesty + citation discipline
//   2. Impl: closured-email membership, numeric-id resolution,
//      knob-derived full threading, trimmed at-risk (counts only),
//      error paths runtime
//   3. Eval case present (LLM-touching change → eval, not unit)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const personal = require('../lib/handlers/orchestrator-personal');
const orchestrator = require('../lib/handlers/orchestrator');
const operatorConfig = require('../lib/operator-config');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'orchestrator-personal.js'), 'utf8');
const CASES = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'lib', 'ai', 'evals', 'orchestrator', 'cases.v1.json'), 'utf8',
));

// ── Layer 1: schema ──────────────────────────────────────────────

test('the tool is registered and auto-classified into the account family', () => {
  const tool = personal.personalTools.find((t) => t.name === 'getMyOrgServiceLevels');
  assert.ok(tool, 'tool schema missing');
  assert.deepEqual(tool.input_schema, { type: 'object', properties: {}, additionalProperties: false });
  assert.ok(personal.PERSONAL_TOOL_NAMES.includes('getMyOrgServiceLevels'));
  assert.equal(orchestrator.classifyTool('getMyOrgServiceLevels'), 'account');
});

test('the description carries the honesty-tier + citation discipline (the model is instructed, not trusted)', () => {
  const tool = personal.personalTools.find((t) => t.name === 'getMyOrgServiceLevels');
  assert.match(tool.description, /cite this tool for every number/i);
  assert.match(tool.description, /NEVER invent or estimate a percentage/);
  assert.match(tool.description, /'still accruing'/);
  assert.match(tool.description, /'indicative' means an early sample/);
  // Multi-org honesty: first org, named in the answer.
  assert.match(tool.description, /multiple organisations this reports the first/);
  assert.match(tool.description, /Read-only\./);
});

// ── Layer 2: impl ────────────────────────────────────────────────

test('membership derives from the CLOSURED email; the model cannot aim it at another org', () => {
  const block = SRC.match(/getMyOrgServiceLevels: async \(\) => \{[\s\S]*?\n    \},/);
  assert.ok(block, 'impl not found');
  const body = block[0];
  assert.match(body, /orgs\.listOrgsForEmail\(e\)/);
  // No input-derived identifier anywhere in the impl.
  assert.ok(!/input\./.test(body), 'the impl must take nothing from the model');
});

test('the impl threads EVERY knob into the shared aggregation (knob-derived — an 8th knob fails this)', () => {
  const block = SRC.match(/getMyOrgServiceLevels: async \(\) => \{[\s\S]*?\n    \},/)[0];
  assert.match(block, /operatorConfig\.getOperatorConfig\(orgIdNumeric\)/);
  assert.match(block, /aggregateOpsInsights\(\{/);
  for (const knob of operatorConfig.KNOB_KEYS) {
    assert.match(
      block,
      new RegExp(`${knob}: orgConfig\\.${knob},`),
      `the agent's view must never disagree with the cockpit — thread ${knob}`,
    );
  }
});

test('at-risk is trimmed to counts + thresholds (the worklist lives on the cockpit, not in the chat)', () => {
  const block = SRC.match(/getMyOrgServiceLevels: async \(\) => \{[\s\S]*?\n    \},/)[0];
  assert.match(block, /atRiskCount: atRisk\.atRiskCount,/);
  assert.match(block, /breachedCount: atRisk\.breachedCount,/);
  assert.ok(!/atRisk\.items/.test(block), 'per-row items must not travel into the chat context');
  // The tiers legend travels with the data.
  assert.match(block, /tiers: /);
});

test('error paths are honest (runtime): signed out, and no org on the account', async () => {
  const signedOut = personal.buildPersonalImpls('');
  assert.deepEqual(await signedOut.getMyOrgServiceLevels(), { error: 'not signed in' });
  // In-memory KV (test env): no org membership for this email.
  const noOrg = personal.buildPersonalImpls('nobody@example.com');
  const r = await noOrg.getMyOrgServiceLevels();
  assert.equal(r.error, 'no organisation on this account yet');
});

// ── Layer 3: eval coverage ───────────────────────────────────────

test('an orchestrator eval case covers the tool (LLM-touching change → eval case, per repo discipline)', () => {
  const arr = Array.isArray(CASES) ? CASES : CASES.cases;
  const c = arr.find((x) => (x.expectedTools || []).includes('getMyOrgServiceLevels'));
  assert.ok(c, 'eval case missing');
  assert.match(c.description, /honestly/);
  assert.ok(Array.isArray(c.mustNotContain) && c.mustNotContain.length > 0,
    'the case must ban the cannot-see-your-data failure mode');
});
