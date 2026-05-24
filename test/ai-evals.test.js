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

// ── Sprint BG-6.3 — calc-grounding ───────────────────────────

test('extractNumbers parses €amounts (US/UK + EU separators)', () => {
  const tokens = scorer.extractNumbers('Total landed cost €1,234.56 — duty €119,000 on €100,000 customs value.');
  const moneyValues = tokens.filter(t => t.kind === 'money').map(t => t.value).sort((a, b) => a - b);
  assert.ok(moneyValues.includes(1234.56), `expected 1234.56 in ${moneyValues}`);
  assert.ok(moneyValues.includes(100000), `expected 100000 in ${moneyValues}`);
  assert.ok(moneyValues.includes(119000), `expected 119000 in ${moneyValues}`);
});

test('extractNumbers parses trailing-EUR notation', () => {
  const tokens = scorer.extractNumbers('That breaks down to 12,345 EUR after rebates.');
  const moneyValues = tokens.filter(t => t.kind === 'money').map(t => t.value);
  assert.ok(moneyValues.includes(12345));
});

test('extractNumbers parses percentages', () => {
  const tokens = scorer.extractNumbers('Duty rate 12.5% plus VAT 19%.');
  const pct = tokens.filter(t => t.kind === 'percent').map(t => t.value).sort((a, b) => a - b);
  assert.deepEqual(pct, [12.5, 19]);
});

test('extractNumbers parses tonnes/kg', () => {
  const tokens = scorer.extractNumbers('We need 1,200 tonnes annually. Each cargo is 480 kg.');
  const weights = tokens.filter(t => t.kind === 'weight').map(t => t.value).sort((a, b) => a - b);
  assert.deepEqual(weights, [480, 1200]);
});

test('parseEuropeanNumber handles both separator styles', () => {
  assert.equal(scorer.parseEuropeanNumber('1,234.56'), 1234.56);  // US style
  assert.equal(scorer.parseEuropeanNumber('1.234,56'), 1234.56);  // EU style
  assert.equal(scorer.parseEuropeanNumber('1,234'),    1234);     // thousands sep
  assert.equal(scorer.parseEuropeanNumber('1,5'),      1.5);      // EU decimal
  assert.equal(scorer.parseEuropeanNumber('12.34'),    12.34);    // US decimal
  assert.equal(scorer.parseEuropeanNumber('1 234,56'), 1234.56);  // with spaces
});

test('checkGrounding: every token in allow-list → all grounded', () => {
  const text = 'Duty €12,000 on €100,000 customs value at 12% MFN.';
  const result = scorer.checkGrounding(text, [
    { value: 12000, kind: 'money' },
    { value: 100000, kind: 'money' },
    { value: 12, kind: 'percent' },
  ]);
  assert.equal(result.ungrounded.length, 0);
  assert.equal(result.grounded.length, 3);
});

test('checkGrounding: hallucinated number → ungrounded', () => {
  // Calculator returned 12% duty, model claims 14.2% — the moat must catch this.
  const text = 'Duty rate is 14.2% on the shipment.';
  const result = scorer.checkGrounding(text, [{ value: 12, kind: 'percent' }]);
  assert.equal(result.ungrounded.length, 1);
  assert.equal(result.ungrounded[0].value, 14.2);
  assert.equal(result.ungrounded[0].kind, 'percent');
});

test('checkGrounding: small numbers + years auto-grounded (citation language)', () => {
  // The "100% of X" rhetoric, "[chunk-3]" reference, "2026 schedule" are NOT calculator outputs
  // but are legitimate citation/list language.
  const text = '100% of the chapter applies. See [chunk-3]. The 2026 schedule confirms.';
  const result = scorer.checkGrounding(text, []);
  assert.equal(result.ungrounded.length, 0, `expected zero ungrounded, got: ${JSON.stringify(result.ungrounded)}`);
});

test('checkGrounding: tolerance — €1,234 matches €1,234.56 within 1% money tolerance', () => {
  const text = 'Total €1,234.';
  const result = scorer.checkGrounding(text, [{ value: 1234.56, kind: 'money' }]);
  assert.equal(result.ungrounded.length, 0);
});

test('checkGrounding: tolerance — 12.4% matches 12.0% within 0.5pp percent tolerance', () => {
  const text = 'Rate of 12.4% applies.';
  const result = scorer.checkGrounding(text, [{ value: 12, kind: 'percent' }]);
  assert.equal(result.ungrounded.length, 0);
});

test('checkGrounding: tolerance — 13% does NOT match 12% (out of percent tolerance)', () => {
  const text = 'Rate of 13% applies.';
  const result = scorer.checkGrounding(text, [{ value: 12, kind: 'percent' }]);
  assert.equal(result.ungrounded.length, 1);
});

test('checkGrounding: typed allow-list — money entry does not satisfy percent token', () => {
  // A money value of 12 in the allow-list should NOT satisfy a "12%" token.
  // Kind-coercion is one of the easiest ways to silently let hallucinations through.
  const text = 'Duty rate 12%.';
  const result = scorer.checkGrounding(text, [{ value: 12, kind: 'money' }]);
  assert.equal(result.ungrounded.length, 1, 'money 12 must not satisfy 12 percent');
});

test('score: opt-in grounding via opts.groundedNumbers — pass when all grounded', () => {
  const c = { id: 'x', mustContain: ['VERDICT'] };
  const response = 'VERDICT: total landed cost €119,000 at 12% duty.';
  const result = scorer.score(c, response, {
    groundedNumbers: [{ value: 119000, kind: 'money' }, { value: 12, kind: 'percent' }],
  });
  assert.equal(result.pass, true);
});

test('score: opt-in grounding — fail when a number is ungrounded', () => {
  const c = { id: 'x', mustContain: ['VERDICT'] };
  // Calculator never produced 14.2 — model hallucinated it.
  const response = 'VERDICT: duty rate is 14.2%.';
  const result = scorer.score(c, response, {
    groundedNumbers: [{ value: 12, kind: 'percent' }],
  });
  assert.equal(result.pass, false);
  const ungrounded = result.failures.filter(f => f.kind === 'ungrounded');
  assert.equal(ungrounded.length, 1);
  assert.equal(ungrounded[0].value, 14.2);
});

test('score: caseSpec.requireGrounding=true triggers the check even without opts.groundedNumbers', () => {
  // With requireGrounding but no allow-list, ANY money/percent token that isn't always-grounded fails.
  const c = { id: 'x', requireGrounding: true };
  const result = scorer.score(c, 'Total €5,000');
  assert.equal(result.pass, false);
  assert.ok(result.failures.some(f => f.kind === 'ungrounded' && f.value === 5000));
});

test('end-to-end synthetic: full orchestrator response with grounded numbers passes', () => {
  // Mimics what a future LLM-runner harness would do: take the calculator
  // outputs for the request and pass them as groundedNumbers.
  const cases = scorer.load('orchestrator');
  const c = cases.find(x => x.id === 'cn-bicycles-anti-dumping');
  const response = `VERDICT: Importing 1,000 bicycles ex-CN attracts the full Anti-dumping duty of 48.5% on top of the 14% MFN rate. On a customs value of €120,000 the duty alone is €75,000.

LOGISTICS: Total landed cost approximately €310,500 including freight, brokerage, and the Anti-dumping (AD) measure stack.

NEXT ACTION: Re-quote the order with the AD stack visible to your CFO before committing.`;
  const result = scorer.score(c, response, {
    groundedNumbers: [
      { value: 1000, kind: 'weight' },        // 1,000 bicycles — counts as weight token here
      { value: 48.5, kind: 'percent' },
      { value: 14, kind: 'percent' },
      { value: 120000, kind: 'money' },
      { value: 75000, kind: 'money' },
      { value: 310500, kind: 'money' },
    ],
  });
  assert.equal(result.pass, true, `expected pass; failures: ${JSON.stringify(result.failures)}`);
});

test('end-to-end synthetic: same response with the WRONG calculator outputs fails grounding', () => {
  const cases = scorer.load('orchestrator');
  const c = cases.find(x => x.id === 'cn-bicycles-anti-dumping');
  const response = `VERDICT: AD duty 48.5%, total landed €310,500.`;
  // Suppose the calculator actually returned 18.5% AD and €290,000 landed.
  // The response is then ungrounded — fail.
  const result = scorer.score(c, response, {
    groundedNumbers: [
      { value: 18.5, kind: 'percent' },
      { value: 290000, kind: 'money' },
    ],
  });
  assert.equal(result.pass, false);
  const ungrounded = result.failures.filter(f => f.kind === 'ungrounded');
  assert.ok(ungrounded.length >= 2, `expected ≥2 ungrounded numbers; got ${ungrounded.length}`);
});

// ── Coverage gate (Sprint eval-moat-v1) ──────────────────────
//
// The continuous quality gate: these run free on every push and fail CI if
// the eval suite thins out or a shipped agent loses its cases. Live scoring
// (cost + API key) runs nightly via .github/workflows/evals.yml.

test('coverage gate: every agent in the registry has a cases file with ≥2 cases', () => {
  const agents = scorer.listAgents();
  // All five prompt agents must carry offline cases.
  for (const a of ['compliance', 'finance', 'logistics', 'orchestrator', 'sourcing']) {
    assert.ok(agents.includes(a), `agent "${a}" must ship lib/ai/evals/${a}/cases.v1.json`);
    const cases = scorer.load(a);
    assert.ok(cases.length >= 2, `agent "${a}" must have ≥2 eval cases, has ${cases.length}`);
  }
});

test('coverage gate: total offline case count meets the floor', () => {
  let total = 0;
  for (const a of scorer.listAgents()) total += scorer.load(a).length;
  // Floor is intentionally below the current count so adding cases never
  // breaks the gate, but deleting a chunk of them does.
  assert.ok(total >= 18, `expected ≥18 offline eval cases across all agents, found ${total}`);
});

test('coverage gate: the newly-shipped surfaces stay covered by a case', () => {
  const byId = (agent) => new Set(scorer.load(agent).map(c => c.id));
  const orch = byId('orchestrator');
  const comp = byId('compliance');
  // Sanctions screening (Pillar II1) — must be exercised somewhere.
  assert.ok(orch.has('screen-counterparty-before-payment') || comp.has('sanctions-screen-counterparty'),
    'sanctions screening must have an eval case');
  // Agent memory (Pillar I2).
  assert.ok(orch.has('agent-memory-recall-preference'), 'agent memory must have an eval case');
  // Compliance calendar (Pillar II6).
  assert.ok(comp.has('compliance-deadlines-portfolio'), 'compliance calendar must have an eval case');
});

test('coverage gate: every case carries a description (eval cases self-document)', () => {
  for (const agent of scorer.listAgents()) {
    for (const c of scorer.load(agent)) {
      assert.ok(typeof c.description === 'string' && c.description.length >= 10,
        `${agent}/${c.id} must carry a description explaining why the case exists`);
    }
  }
});
