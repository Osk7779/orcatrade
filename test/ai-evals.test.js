// Tests for lib/ai/evals/scorer.js — Sprint BG-6.2 phase 1.
//
// The scorer is the offline complement to scripts/agent-eval.js. These
// tests pin its contract + walk every shipped cases file to catch drift
// from the prompt registry. Anything wrong here breaks `npm test` —
// which is exactly the point: an eval case referencing a non-existent
// prompt version is a deploy bug, and CI catches it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scorer = require('../lib/ai/evals/scorer');
const prompts = require('../lib/ai/prompts/registry');

// ── load + listAgents ────────────────────────────────────────

test('listAgents returns every <agent>/cases.v1.json directory', () => {
  const agents = scorer.listAgents();
  assert.ok(agents.length >= 1, 'at least orchestrator should ship');
  assert.ok(agents.includes('orchestrator'));
});

test('load returns the cases array for a known agent', () => {
  const cases = scorer.load('orchestrator');
  assert.ok(Array.isArray(cases));
  assert.ok(cases.length >= 5, 'orchestrator should ship at least 5 canonical cases');
});

test('load rejects path-traversal attempts via agent param', () => {
  assert.throws(() => scorer.load('../etc'), /invalid agent/);
  assert.throws(() => scorer.load('Orchestrator'), /invalid agent/);
});

test('load throws clearly on missing agent file', () => {
  assert.throws(() => scorer.load('nonexistent'), /no cases file/);
});

// ── parsePattern ────────────────────────────────────────────

test('parsePattern detects /regex/flags shorthand', () => {
  const p = scorer.parsePattern('/foo|bar/i');
  assert.equal(p.kind, 'regex');
  assert.ok(p.value instanceof RegExp);
  assert.equal(p.value.flags, 'i');
  assert.equal(p.value.source, 'foo|bar');
});

test('parsePattern treats plain strings as substrings', () => {
  const p = scorer.parsePattern('VERDICT');
  assert.equal(p.kind, 'substring');
  assert.equal(p.value, 'VERDICT');
});

test('parsePattern rejects non-strings', () => {
  assert.throws(() => scorer.parsePattern(42), /must be a string/);
});

// ── score ───────────────────────────────────────────────────

test('score: mustContain all-pass → pass:true score:1', () => {
  const c = { id: 'x', mustContain: ['VERDICT', '/€[0-9]/'] };
  const r = scorer.score(c, 'VERDICT: total landed cost is €119,000.');
  assert.equal(r.pass, true);
  assert.equal(r.score, 1);
  assert.equal(r.failures.length, 0);
});

test('score: mustContain partial miss → pass:false score:0.5', () => {
  const c = { id: 'x', mustContain: ['VERDICT', 'MISSING_TOKEN'] };
  const r = scorer.score(c, 'VERDICT: ok');
  assert.equal(r.pass, false);
  assert.equal(r.score, 0.5);
  assert.equal(r.failures.length, 1);
  assert.equal(r.failures[0].kind, 'missing');
  assert.equal(r.failures[0].pattern, 'MISSING_TOKEN');
});

test('score: mustNotContain forbidden hit → fails', () => {
  const c = { id: 'x', mustNotContain: ['/^I cannot help/i'] };
  const r = scorer.score(c, 'I cannot help with this query.');
  assert.equal(r.pass, false);
  assert.equal(r.failures[0].kind, 'forbidden');
});

test('score: mustNotContain absent → passes', () => {
  const c = { id: 'x', mustNotContain: ['/^I cannot help/i'] };
  const r = scorer.score(c, 'VERDICT: we can ship that.');
  assert.equal(r.pass, true);
});

test('score: zero checks → pass:true score:1 (vacuous)', () => {
  const r = scorer.score({ id: 'x' }, 'anything');
  assert.equal(r.pass, true);
  assert.equal(r.score, 1);
  assert.equal(r.checks, 0);
});

test('score: bad inputs throw clearly', () => {
  assert.throws(() => scorer.score(null, 'r'), /caseSpec object required/);
  assert.throws(() => scorer.score({}, 123), /response string required/);
});

test('score: regex flags work (case-insensitive match)', () => {
  const c = { id: 'x', mustContain: ['/anti-dumping/i'] };
  assert.equal(scorer.score(c, 'Anti-Dumping duty of 48.5%').pass, true);
});

// ── validateAll: walks every shipped cases file ─────────────

test('validateAll: every shipped case is well-formed against the current prompt registry', () => {
  const errors = scorer.validateAll(prompts);
  if (errors.length) {
    throw new Error('Eval cases drift from prompt registry:\n  - ' + errors.join('\n  - '));
  }
});

test('orchestrator cases.v1.json declares the expected shape', () => {
  const raw = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'ai', 'evals', 'orchestrator', 'cases.v1.json'),
    'utf8'
  ));
  assert.equal(raw.agent, 'orchestrator');
  assert.ok(raw.lastUpdated, 'lastUpdated date present');
  for (const c of raw.cases) {
    assert.ok(c.id, `case ${JSON.stringify(c).slice(0,80)} has id`);
    assert.equal(c.promptVersion, 'v1', `case "${c.id}" targets v1 (the only shipped version today)`);
    assert.ok(c.description, `case "${c.id}" has a description`);
  }
});

test('every orchestrator case references a real shipped prompt version', () => {
  const available = new Set(prompts.listVersions('orchestrator'));
  for (const c of scorer.load('orchestrator')) {
    assert.ok(available.has(c.promptVersion),
      `case "${c.id}" wants ${c.promptVersion} but registry has only ${[...available].join(', ')}`);
  }
});

// ── Synthetic golden-path: scorer produces sensible verdict on a plausible response

test('synthetic: a plausible orchestrator response on the CN bicycles case passes', () => {
  const cases = scorer.load('orchestrator');
  const c = cases.find(x => x.id === 'cn-bicycles-anti-dumping');
  assert.ok(c, 'cn-bicycles-anti-dumping case present');
  const responseText = `VERDICT: Importing 1,000 bicycles ex-CN attracts the full Anti-dumping duty of 48.5% on top of the 14% MFN rate. On a customs value of €120,000 the duty alone is €75,000.

LOGISTICS: Total landed cost approximately €310,500 including freight, brokerage, and the Anti-dumping (AD) measure stack.

NEXT ACTION: Re-quote the order with the AD stack visible to your CFO before committing.`;
  const result = scorer.score(c, responseText);
  assert.equal(result.pass, true, `expected pass; failures: ${JSON.stringify(result.failures)}`);
});

test('synthetic: a "I cannot help" stub response on the CN bicycles case FAILS', () => {
  const cases = scorer.load('orchestrator');
  const c = cases.find(x => x.id === 'cn-bicycles-anti-dumping');
  const result = scorer.score(c, 'I cannot help with that request.');
  assert.equal(result.pass, false, 'forbidden phrase should make the case fail');
  // Both missing patterns AND the forbidden phrase should be recorded.
  assert.ok(result.failures.some(f => f.kind === 'forbidden'));
  assert.ok(result.failures.some(f => f.kind === 'missing'));
});
