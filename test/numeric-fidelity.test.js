// Numeric fidelity — apex plan P1.6.
//
// The COUNTERPART to checkGrounding (Sprint BG-6.3). Where checkGrounding
// catches FABRICATION (number in prose that isn't in calc output),
// checkNumericFidelity catches OMISSION (calc output that the LLM
// failed to surface in prose).
//
// Why omission matters: a customs declaration form asks for "duty
// payable". If the LLM summarises "the duty applies and you should
// budget for it" instead of "duty = €1,234.50", the user never sees
// the number they need to enter. The calc was right; the LLM ate it.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const scorer = require('../lib/ai/evals/scorer');

// ── checkNumericFidelity ─────────────────────────────────────

test('checkNumericFidelity: empty required list → present/missing both empty', () => {
  const r = scorer.checkNumericFidelity('any response text', []);
  assert.equal(r.present.length, 0);
  assert.equal(r.missing.length, 0);
  assert.equal(r.totalRequired, 0);
});

test('checkNumericFidelity: every required money number present → no misses', () => {
  const response = 'The duty payable is €1,234.50 and VAT comes to €265.20.';
  const r = scorer.checkNumericFidelity(response, [
    { value: 1234.50, kind: 'money' },
    { value: 265.20, kind: 'money' },
  ]);
  assert.equal(r.missing.length, 0);
  assert.equal(r.present.length, 2);
});

test('checkNumericFidelity: missing number surfaces in misses', () => {
  const response = 'The duty is €1,234.50.';
  const r = scorer.checkNumericFidelity(response, [
    { value: 1234.50, kind: 'money' },
    { value: 9999.00, kind: 'money' },
  ]);
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].value, 9999.00);
  assert.equal(r.present.length, 1);
});

test('checkNumericFidelity: percent kind matches percent token', () => {
  const r = scorer.checkNumericFidelity(
    'The MFN duty rate is 14% on this chapter.',
    [{ value: 14, kind: 'percent' }],
  );
  assert.equal(r.missing.length, 0);
});

test('checkNumericFidelity: kind mismatch counts as missing', () => {
  // If we required a money value but only a percent is present, the
  // money is genuinely missing. Caller might intend either; the kind
  // discriminator catches mis-classified outputs.
  const r = scorer.checkNumericFidelity(
    'The rate is 14%.',
    [{ value: 14, kind: 'money' }],
  );
  assert.equal(r.missing.length, 1);
});

test('checkNumericFidelity: tolerance band accepts rounded prose', () => {
  // Calc returns 1234.56, LLM prints €1,234.55 (banker's rounding
  // mid-sentence). DEFAULT_TOLERANCE.money allows ≤€0.01 difference.
  const r = scorer.checkNumericFidelity(
    'Total: €1,234.55.',
    [{ value: 1234.56, kind: 'money' }],
  );
  assert.equal(r.missing.length, 0, 'within 1 cent — should match');
});

test('checkNumericFidelity: bare number entry treated as wildcard kind', () => {
  // Shorthand: `42` rather than `{ value: 42, kind: '…' }`. Should
  // match any extractable token with value 42 regardless of kind.
  // extractNumbers is calibrated to money/percent/weight (the kinds
  // that drive trade-compliance decisions), so the test exercises a
  // money-shaped string.
  const r = scorer.checkNumericFidelity(
    'The supplementary unit fee is €42.',
    [42],
  );
  assert.equal(r.missing.length, 0);
});

// ── score() integration via mustContainNumbers ───────────────

test('score: mustContainNumbers — all present → pass', () => {
  const result = scorer.score(
    {
      id: 'test', promptVersion: 'v1',
      input: 'minimal case for the fidelity check',
      mustContainNumbers: [{ value: 100, kind: 'money' }],
    },
    'The fee is €100.',
  );
  assert.equal(result.pass, true);
});

test('score: mustContainNumbers — one missing → fail with missing-number failure', () => {
  const result = scorer.score(
    {
      id: 'test', promptVersion: 'v1',
      input: 'minimal case for the fidelity check',
      mustContainNumbers: [
        { value: 100, kind: 'money' },
        { value: 200, kind: 'money' },
      ],
    },
    'The fee is €100.',  // 200 omitted
  );
  assert.equal(result.pass, false);
  const miss = result.failures.find(f => f.kind === 'missing-number');
  assert.ok(miss, 'a missing-number failure recorded');
  assert.equal(miss.value, 200);
});

test('score: opts.requiredNumbers overrides caseSpec.mustContainNumbers', () => {
  // The CLI runner (scripts/agent-eval.js) may compute required numbers
  // dynamically from tool outputs and pass them in via opts. The case
  // file's static list is overridden when opts is supplied.
  const result = scorer.score(
    {
      id: 'test', promptVersion: 'v1',
      input: 'minimal',
      mustContainNumbers: [{ value: 9999, kind: 'money' }],   // would fail
    },
    'Total: €100.',
    { requiredNumbers: [{ value: 100, kind: 'money' }] },     // passes
  );
  assert.equal(result.pass, true);
});

// ── validateCase: mustContainNumbers shape ───────────────────

test('validateCase: accepts a number or { value, kind? }', () => {
  const errs = scorer.validateCase({
    id: 'ok', promptVersion: 'v1', input: 'enough chars here',
    mustContainNumbers: [100, { value: 14, kind: 'percent' }, { value: 1.5 }],
  }, 'compliance', 0);
  assert.deepEqual(errs, []);
});

test('validateCase: rejects non-array mustContainNumbers', () => {
  const errs = scorer.validateCase({
    id: 'bad', promptVersion: 'v1', input: 'enough chars here',
    mustContainNumbers: { value: 100 },  // object, not array
  }, 'compliance', 0);
  assert.ok(errs.some(e => /must be an array/.test(e)));
});

test('validateCase: rejects invalid kind value', () => {
  const errs = scorer.validateCase({
    id: 'bad', promptVersion: 'v1', input: 'enough chars here',
    mustContainNumbers: [{ value: 100, kind: 'gold-bars' }],
  }, 'compliance', 0);
  assert.ok(errs.some(e => /kind must be money\/percent\/weight/.test(e)));
});

test('validateCase: rejects non-finite numbers', () => {
  const errs = scorer.validateCase({
    id: 'bad', promptVersion: 'v1', input: 'enough chars here',
    mustContainNumbers: [Number.POSITIVE_INFINITY],
  }, 'compliance', 0);
  assert.ok(errs.some(e => /non-finite/.test(e)));
});

// ── Defensive: complementary direction with checkGrounding ───

test('numeric fidelity + grounding catch opposite errors on the same response', () => {
  // Same response; the FIDELITY check fails (LLM omitted 200) while
  // the GROUNDING check passes (every printed number IS in the allow
  // list). Demonstrates that both checks are independently necessary.
  const response = 'The duty is €100.';
  const allowList = [{ value: 100, kind: 'money' }, { value: 200, kind: 'money' }];

  const grounding = scorer.checkGrounding(response, allowList);
  assert.equal(grounding.ungrounded.length, 0, 'every printed number is grounded');

  const fidelity = scorer.checkNumericFidelity(response, allowList);
  assert.equal(fidelity.missing.length, 1, '€200 was omitted from prose');
  assert.equal(fidelity.missing[0].value, 200);
});
