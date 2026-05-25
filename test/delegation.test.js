// Sprint delegation-v1 (Pillar I6) — multi-agent delegation planner + merger.

const test = require('node:test');
const assert = require('node:assert/strict');

const d = require('../lib/intelligence/delegation');

test('classifyDomains detects the domains a task touches', () => {
  const r = d.classifyDomains('What duty and anti-dumping apply to bicycles from China, and what sea freight to Hamburg?');
  assert.ok(r.domains.includes('compliance'));
  assert.ok(r.domains.includes('logistics'));
  assert.ok(!r.domains.includes('finance'));
});

test('classifyDomains returns domains in import-workflow order', () => {
  const r = d.classifyDomains('Find a supplier, check the duty, arrange freight, and sort payment terms.');
  assert.deepEqual(r.domains, ['sourcing', 'compliance', 'logistics', 'finance']);
});

test('planDelegation builds an ordered multi-domain plan', () => {
  const plan = d.planDelegation('Compare the import duty and the FX hedging cost for paying in USD.');
  assert.equal(plan.multiDomain, true);
  assert.deepEqual(plan.order, ['compliance', 'finance']);
  assert.equal(plan.steps[0].specialist, 'compliance');
  assert.equal(plan.steps[1].specialist, 'finance');
  for (const s of plan.steps) assert.ok(s.focus && s.rationale);
});

test('planDelegation: a single-domain task is not multiDomain', () => {
  const plan = d.planDelegation('What is the anti-dumping duty on Chinese e-bikes?');
  assert.equal(plan.multiDomain, false);
  assert.deepEqual(plan.order, ['compliance']);
});

test('planDelegation: no domain match → single orchestrator step', () => {
  const plan = d.planDelegation('hello there');
  assert.equal(plan.multiDomain, false);
  assert.equal(plan.steps[0].specialist, 'orchestrator');
});

test('mergeSpecialistFindings orders by domain, dedupes citations, propagates escalation', () => {
  const merged = d.mergeSpecialistFindings([
    { specialist: 'finance', summary: 'Hedge the USD exposure.', citations: ['fx-1'], numbers: [{ label: 'hedge cost', value: 1200, tool: 'estimateFxHedgingCost' }] },
    { specialist: 'compliance', summary: 'AD duty 48.5% applies.', citations: ['reg-9', 'fx-1'], escalate: true },
  ]);
  // compliance comes before finance in the import order.
  assert.deepEqual(merged.specialistsConsulted, ['compliance', 'finance']);
  // 'fx-1' appears once despite being cited twice.
  assert.deepEqual(merged.citations.sort(), ['fx-1', 'reg-9']);
  assert.equal(merged.numbers.length, 1);
  assert.equal(merged.numbers[0].specialist, 'finance');
  assert.equal(merged.needsHumanReview, true);
});

test('mergeSpecialistFindings handles empty / junk input', () => {
  const merged = d.mergeSpecialistFindings(null);
  assert.deepEqual(merged.specialistsConsulted, []);
  assert.equal(merged.needsHumanReview, false);
});

// ── wired into the orchestrator ─────────────────────────

test('orchestrator exposes planDelegation + mergeSpecialistFindings tools', () => {
  const orch = require('../lib/handlers/orchestrator');
  for (const name of ['planDelegation', 'mergeSpecialistFindings']) {
    assert.ok(orch.TOOLS.find((t) => t.name === name), `${name} schema`);
    assert.equal(typeof orch.toolImpls[name], 'function', `${name} impl`);
  }
  assert.equal(orch.classifyTool('planDelegation'), 'orchestration');
  const plan = orch.toolImpls.planDelegation({ task: 'duty and freight for bikes from CN to DE' });
  assert.ok(plan.order.includes('compliance') && plan.order.includes('logistics'));
});
