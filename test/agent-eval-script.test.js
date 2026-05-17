// Tests for the refactored scripts/agent-eval.js — Sprint BG-6.2 phase 2.
//
// The script can run in offline (no API key) mode for parseArgs, loadCases,
// normalisation, and assertion-composition. We exercise the runner with a
// stubbed handler that emits a fake SSE event stream — proving the full
// pipeline (case normalisation → handler invocation → SSE parse → assertions)
// works without requiring an Anthropic key.

const test = require('node:test');
const assert = require('node:assert/strict');

const runner = require('../scripts/agent-eval');

// ── parseArgs ────────────────────────────────────────────────

test('parseArgs defaults to compliance agent', () => {
  const o = runner.parseArgs([]);
  assert.equal(o.agent, 'compliance');
  assert.equal(o.bail, false);
  assert.equal(o.listCases, false);
  assert.equal(o.requireGrounding, false);
  assert.equal(o.onlyId, null);
});

test('parseArgs --agent <name> picks an agent', () => {
  const o = runner.parseArgs(['--agent', 'orchestrator']);
  assert.equal(o.agent, 'orchestrator');
});

test('parseArgs --agent=<name> picks an agent (equals form)', () => {
  const o = runner.parseArgs(['--agent=sourcing']);
  assert.equal(o.agent, 'sourcing');
});

test('parseArgs --bail + positional case id + --require-grounding', () => {
  const o = runner.parseArgs(['--agent', 'orchestrator', '--bail', 'cn-bicycles-anti-dumping', '--require-grounding']);
  assert.equal(o.agent, 'orchestrator');
  assert.equal(o.bail, true);
  assert.equal(o.onlyId, 'cn-bicycles-anti-dumping');
  assert.equal(o.requireGrounding, true);
});

test('parseArgs --list-cases works without API key', () => {
  const o = runner.parseArgs(['--list-cases', '--agent', 'finance']);
  assert.equal(o.listCases, true);
});

test('AGENT_HANDLERS map covers all 5 agents', () => {
  for (const agent of ['compliance', 'orchestrator', 'sourcing', 'logistics', 'finance']) {
    assert.ok(runner.AGENT_HANDLERS[agent], `${agent} handler registered`);
  }
});

// ── loadCases ────────────────────────────────────────────────

test('loadCases(compliance) falls back to legacy test/agent-eval-cases.json', () => {
  // We expect either the new tree OR the legacy file to exist for compliance.
  // Today: legacy file exists with 15 cases.
  const { source, cases } = runner.loadCases('compliance');
  assert.ok(source, 'source path returned');
  assert.ok(cases.length > 0, `compliance should have cases; got 0 from ${source}`);
  // Every case must have id + messages (normalised) + an expectations object.
  for (const c of cases) {
    assert.ok(c.id, 'case has id');
    assert.ok(Array.isArray(c.messages), `case ${c.id} has messages array`);
    assert.ok(c.expectations && typeof c.expectations === 'object', `case ${c.id} has expectations object`);
  }
});

test('loadCases(orchestrator) reads from lib/ai/evals/orchestrator/cases.v1.json', () => {
  const { source, cases } = runner.loadCases('orchestrator');
  assert.match(source, /lib\/ai\/evals\/orchestrator\/cases\.v1\.json/);
  assert.ok(cases.length >= 5);
  // New-shape normalisation: input → messages
  for (const c of cases) {
    assert.ok(c.id);
    assert.ok(c.messages.length > 0, `case ${c.id} has at least 1 message`);
    assert.equal(c.messages[0].role, 'user');
    assert.equal(c.promptVersion, 'v1');
  }
});

test('loadCases(sourcing/logistics/finance) all return non-empty arrays', () => {
  for (const agent of ['sourcing', 'logistics', 'finance']) {
    const { cases } = runner.loadCases(agent);
    assert.ok(cases.length > 0, `${agent}: should have cases`);
  }
});

// ── Case normalisation ──────────────────────────────────────

test('normaliseLegacyCase extracts mustCallTools into expectedTools', () => {
  const c = runner.normaliseLegacyCase({
    id: 'x', name: 'X',
    messages: [{ role: 'user', content: 'hi' }],
    expectations: { mustCallTools: ['searchRegulations'], mustCite: true },
  });
  assert.equal(c.expectedTools.length, 1);
  assert.equal(c.expectedTools[0], 'searchRegulations');
  assert.deepEqual(c.mustContain, []);
  assert.deepEqual(c.mustNotContain, []);
});

test('normaliseNewShapeCase converts input → messages', () => {
  const c = runner.normaliseNewShapeCase({
    id: 'x', promptVersion: 'v1', input: 'How much duty on bikes?',
    mustContain: ['VERDICT'], mustNotContain: ['/^I cannot help/i'],
  });
  assert.equal(c.messages.length, 1);
  assert.equal(c.messages[0].role, 'user');
  assert.equal(c.messages[0].content, 'How much duty on bikes?');
  assert.deepEqual(c.mustContain, ['VERDICT']);
});

// ── End-to-end with a stubbed handler ───────────────────────

function makeStubHandler(scriptedEvents) {
  // Returns a handler(req, res) that writes the scripted SSE events to res.write.
  return async (_req, res) => {
    for (const evt of scriptedEvents) {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    }
    res.end();
  };
}

test('runCase: stubbed handler emitting a clean final event → no failures', async () => {
  const testCase = runner.normaliseNewShapeCase({
    id: 'stub', input: 'tell me about CN bikes',
    mustContain: ['VERDICT', '/Anti-dumping/i'],
    mustNotContain: ['/^I cannot help/i'],
  });
  const handler = makeStubHandler([
    { type: 'thinking' },
    { type: 'final', text: 'VERDICT: Anti-dumping duty applies. Total €25,000.', stopReason: 'end_turn' },
    { type: 'done' },
  ]);
  const result = await runner.runCase(testCase, handler);
  assert.equal(result.failures.length, 0, `expected no failures; got: ${result.failures.join(' | ')}`);
});

test('runCase: missing mustContain pattern → failure recorded', async () => {
  const testCase = runner.normaliseNewShapeCase({
    id: 'stub', input: 'tell me about bikes',
    mustContain: ['VERDICT', '/Anti-dumping/i'],
  });
  const handler = makeStubHandler([
    { type: 'final', text: 'I will tell you about bikes.', stopReason: 'end_turn' },
  ]);
  const result = await runner.runCase(testCase, handler);
  assert.equal(result.failures.length, 2, 'both mustContain patterns missing');
});

test('runCase: legacy mustCallTools expectation fails when tool not invoked', async () => {
  const testCase = runner.normaliseLegacyCase({
    id: 'leg', name: 'legacy',
    messages: [{ role: 'user', content: 'CBAM?' }],
    expectations: { mustCallTools: ['searchRegulations'] },
  });
  const handler = makeStubHandler([
    { type: 'final', text: 'CBAM applies broadly to chapters 25/27/28/72-76.', stopReason: 'end_turn' },
  ]);
  const result = await runner.runCase(testCase, handler);
  assert.ok(result.failures.length >= 1);
  assert.match(result.failures.join(' '), /searchRegulations.*never called/);
});

test('runCase: legacy + new assertions compose — both kinds of failures surface', async () => {
  // A hybrid case with BOTH expectation shapes. Handler fails both.
  const testCase = {
    id: 'hybrid', name: 'hybrid',
    messages: [{ role: 'user', content: 'hi' }],
    promptVersion: null,
    expectations: { mustCallTools: ['searchRegulations'] },
    mustContain: ['VERDICT'],
    mustNotContain: ['/^I cannot help/i'],
    expectedTools: ['searchRegulations'],
  };
  const handler = makeStubHandler([
    { type: 'final', text: 'I cannot help with that.', stopReason: 'end_turn' },
  ]);
  const result = await runner.runCase(testCase, handler);
  // We expect: legacy "tool never called" + scorer "VERDICT missing" + scorer "forbidden phrase"
  assert.ok(result.failures.length >= 3, `expected ≥3 failures; got ${result.failures.length}: ${result.failures.join(' | ')}`);
  assert.ok(result.failures.some(f => /never called/.test(f)));
  assert.ok(result.failures.some(f => /VERDICT/.test(f)));
  assert.ok(result.failures.some(f => /forbidden|cannot help/i.test(f)));
});

test('runCase: --require-grounding catches a hallucinated percentage', async () => {
  const testCase = runner.normaliseNewShapeCase({
    id: 'g', input: 'duty rate?',
    mustContain: ['rate'],
  });
  // Calculator returned 12%, model claims 14.2% — must fail when grounding is on.
  const handler = makeStubHandler([
    { type: 'final', text: 'The rate is 14.2%.', stopReason: 'end_turn' },
  ]);
  const result = await runner.runCase(testCase, handler, {
    groundedNumbers: [{ value: 12, kind: 'percent' }],
  });
  assert.ok(result.failures.some(f => /ungrounded percent/.test(f)),
    `expected ungrounded-percent failure; got: ${result.failures.join(' | ')}`);
});

// ── summariseEvents covers the SSE shape ────────────────────

test('summariseEvents collects tool calls + final text + stop reason', () => {
  const events = [
    { type: 'thinking' },
    { type: 'tool-call', name: 'searchRegulations' },
    { type: 'tool-result', ok: true },
    { type: 'tool-call', name: 'computeLandedCost' },
    { type: 'tool-result', ok: true },
    { type: 'final', text: 'Done.', stopReason: 'end_turn' },
    { type: 'done' },
  ];
  const s = runner.summariseEvents(events);
  assert.deepEqual(s.toolsCalled, ['searchRegulations', 'computeLandedCost']);
  assert.equal(s.toolsSucceeded, 2);
  assert.equal(s.toolsFailed, 0);
  assert.equal(s.finalText, 'Done.');
  assert.equal(s.stopReason, 'end_turn');
  assert.equal(s.errors.length, 0);
});

test('summariseEvents reports agent errors when emitted', () => {
  const events = [
    { type: 'error', message: 'upstream timeout' },
    { type: 'final', text: '', stopReason: 'error' },
  ];
  const s = runner.summariseEvents(events);
  assert.equal(s.errors.length, 1);
  assert.equal(s.errors[0].message, 'upstream timeout');
});
