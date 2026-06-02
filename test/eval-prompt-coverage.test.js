// Eval-case coverage gate: every prompt version in the registry must
// have at least one eval case. The reverse direction of validateAll's
// referenced-version check — catches "developer added prompts/<agent>/v2.txt
// but forgot to write cases."
//
// This is the test-side enforcement of the prompt-registry contract: a
// version that ships without cases is invisible to the offline scorer
// and the nightly live-eval harness, which silently weakens the AI-eval
// gate. Better to fail CI here than discover the gap during a regression.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const scorer = require('../lib/ai/evals/scorer');
const prompts = require('../lib/ai/prompts/registry');

test('coverageMatrix: every registered prompt version has at least one case', () => {
  const matrix = scorer.coverageMatrix(prompts);
  const gaps = [];
  for (const agent of Object.keys(matrix)) {
    const agentEntry = matrix[agent];
    if (agentEntry.error) {
      gaps.push(`${agent}: ${agentEntry.error}`);
      continue;
    }
    for (const v of agentEntry.untestedVersions) {
      gaps.push(`${agent}@${v}: prompt version is in the registry but has 0 eval cases — add a case in lib/ai/evals/${agent}/cases.v1.json`);
    }
  }
  assert.deepEqual(gaps, [], `eval coverage gaps:\n  - ${gaps.join('\n  - ')}`);
});

test('coverageMatrix: returns a per-version casesCount per agent', () => {
  const matrix = scorer.coverageMatrix(prompts);
  for (const agent of Object.keys(matrix)) {
    const agentEntry = matrix[agent];
    if (agentEntry.error) continue;
    assert.ok(agentEntry.versions, `${agent} has a versions map`);
    for (const v of Object.keys(agentEntry.versions)) {
      assert.equal(typeof agentEntry.versions[v].casesCount, 'number', `${agent}@${v}.casesCount is a number`);
      assert.ok(agentEntry.versions[v].casesCount >= 0, `${agent}@${v}.casesCount is non-negative`);
    }
  }
});

test('coverageMatrix: throws without a registry argument', () => {
  assert.throws(() => scorer.coverageMatrix(), /prompts registry argument required/);
  assert.throws(() => scorer.coverageMatrix(null), /prompts registry argument required/);
  assert.throws(() => scorer.coverageMatrix({}), /prompts registry argument required/);
});

test('coverageMatrix: untested version surfaces in untestedVersions', () => {
  // Simulate a registry that has v1 + v99 for compliance — v99 has no
  // matching cases in the real on-disk file, so it should appear as
  // untested. We do not mutate the real registry; we build a fake.
  const fakeRegistry = {
    listVersions(agent) {
      const real = prompts.listVersions(agent);
      if (agent === 'compliance') return [...real, 'v99-pretend'];
      return real;
    },
  };
  const matrix = scorer.coverageMatrix(fakeRegistry);
  assert.ok(matrix.compliance.untestedVersions.includes('v99-pretend'),
    'simulated v99-pretend appears as untested');
  assert.equal(matrix.compliance.versions['v99-pretend'].casesCount, 0,
    'simulated v99-pretend has casesCount 0');
});
