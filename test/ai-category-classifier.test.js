'use strict';

// Haiku-backed category classifier — composition + fail-soft tests.
// The Anthropic API call itself is not exercised in unit tests (live
// network + cost). Integration coverage rides on the post-merge eval
// gate in CI.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const classifier = require(path.join(ROOT, 'lib', 'ai', 'category-classifier'));
const orchestrator = require(path.join(ROOT, 'lib', 'ai', 'import-request-orchestrator'));

// ── Closed taxonomy + drift-guard against the orchestrator ──────────

test('CATEGORIES matches the orchestrator CATEGORIES in lockstep (drift-guard)', () => {
  assert.deepEqual(
    [...classifier.CATEGORIES].sort(),
    [...orchestrator.CATEGORIES].sort(),
  );
});

test('CATEGORIES exposes the 8 closed taxonomy values', () => {
  assert.deepEqual(
    [...classifier.CATEGORIES].sort(),
    ['apparel', 'cosmetics', 'electronics', 'footwear', 'furniture', 'homeware', 'machinery', 'toys'],
  );
});

// ── System prompt invariants ────────────────────────────────────────

test('SYSTEM_PROMPT_STABLE enumerates every closed-taxonomy value', () => {
  for (const cat of classifier.CATEGORIES) {
    assert.ok(
      classifier.SYSTEM_PROMPT_STABLE.includes(cat),
      `system prompt must mention "${cat}" so the model knows it's an option`,
    );
  }
});

test('SYSTEM_PROMPT_STABLE pins the homeware-as-fallback rule', () => {
  assert.match(classifier.SYSTEM_PROMPT_STABLE, /homeware/);
  assert.match(classifier.SYSTEM_PROMPT_STABLE, /OUTPUT FORMAT/);
  assert.match(classifier.SYSTEM_PROMPT_STABLE, /ONE WORD/);
});

test('CLASSIFIER_MODEL is the TRIAGE tier (Haiku per the registry)', () => {
  assert.match(classifier.CLASSIFIER_MODEL, /^claude-haiku-/);
});

test('CLASSIFIER_PROMPT_VERSION is set for cost-telemetry attribution', () => {
  assert.equal(typeof classifier.CLASSIFIER_PROMPT_VERSION, 'string');
  assert.ok(classifier.CLASSIFIER_PROMPT_VERSION.length > 0);
});

// ── parseCategoryFromResponse ───────────────────────────────────────

test('parseCategoryFromResponse accepts a clean one-word response', () => {
  for (const cat of classifier.CATEGORIES) {
    assert.equal(
      classifier.parseCategoryFromResponse({ content: [{ type: 'text', text: cat }] }),
      cat,
    );
  }
});

test('parseCategoryFromResponse tolerates surrounding whitespace + punctuation', () => {
  const samples = [
    { in: '  homeware  ', out: 'homeware' },
    { in: 'homeware.', out: 'homeware' },
    { in: '"electronics"', out: 'electronics' },
    { in: "'apparel'", out: 'apparel' },
    { in: '`furniture`', out: 'furniture' },
  ];
  for (const { in: text, out } of samples) {
    assert.equal(
      classifier.parseCategoryFromResponse({ content: [{ type: 'text', text }] }),
      out,
    );
  }
});

test('parseCategoryFromResponse takes the FIRST word even if the model rambles', () => {
  // The system prompt says one word; if the model deviates, we still
  // try to recover by reading the first token.
  assert.equal(
    classifier.parseCategoryFromResponse({ content: [{ type: 'text', text: 'electronics — USB-C accessory' }] }),
    'electronics',
  );
});

test('parseCategoryFromResponse uppercases robust to lowercases the model output', () => {
  assert.equal(
    classifier.parseCategoryFromResponse({ content: [{ type: 'text', text: 'HOMEWARE' }] }),
    'homeware',
  );
});

test('parseCategoryFromResponse returns null when output is not in the taxonomy', () => {
  assert.equal(classifier.parseCategoryFromResponse({ content: [{ type: 'text', text: 'agriculture' }] }), null);
  assert.equal(classifier.parseCategoryFromResponse({ content: [{ type: 'text', text: 'I cannot decide' }] }), null);
});

test('parseCategoryFromResponse returns null on a malformed response', () => {
  assert.equal(classifier.parseCategoryFromResponse(null), null);
  assert.equal(classifier.parseCategoryFromResponse({}), null);
  assert.equal(classifier.parseCategoryFromResponse({ content: [{ type: 'tool_use' }] }), null);
  assert.equal(classifier.parseCategoryFromResponse({ content: 'not-an-array' }), null);
});

// ── Fail-soft entry-point: env-gated fallback paths ─────────────────

test('classifyCategoryAsync falls back to keyword when ORCATRADE_DISABLE_AI_CLASSIFIER=1', async () => {
  const prior = process.env.ORCATRADE_DISABLE_AI_CLASSIFIER;
  process.env.ORCATRADE_DISABLE_AI_CLASSIFIER = '1';
  try {
    const result = await classifier.classifyCategoryAsync({
      productDescription: '3,000 silicone kitchen mats food-grade',
      fallbackClassify: orchestrator.classifyProductCategory,
    });
    assert.equal(result.source, 'keyword');
    assert.equal(result.category, 'homeware');
    assert.equal(result.reason, 'disabled-via-env');
    assert.ok(result.fallbackKeywordHits >= 1);
  } finally {
    if (prior !== undefined) process.env.ORCATRADE_DISABLE_AI_CLASSIFIER = prior;
    else delete process.env.ORCATRADE_DISABLE_AI_CLASSIFIER;
  }
});

test('classifyCategoryAsync falls back to keyword when ANTHROPIC_API_KEY is missing', async () => {
  const priorKey = process.env.ANTHROPIC_API_KEY;
  const priorOs = process.env.ORCATRADE_OS_API;
  const priorKill = process.env.ORCATRADE_DISABLE_AI_CLASSIFIER;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ORCATRADE_OS_API;
  delete process.env.ORCATRADE_DISABLE_AI_CLASSIFIER;
  try {
    const result = await classifier.classifyCategoryAsync({
      productDescription: 'leather Oxford shoes size 41',
      fallbackClassify: orchestrator.classifyProductCategory,
    });
    assert.equal(result.source, 'keyword');
    assert.equal(result.category, 'footwear');
    assert.equal(result.reason, 'unconfigured');
  } finally {
    if (priorKey !== undefined) process.env.ANTHROPIC_API_KEY = priorKey;
    if (priorOs !== undefined) process.env.ORCATRADE_OS_API = priorOs;
    if (priorKill !== undefined) process.env.ORCATRADE_DISABLE_AI_CLASSIFIER = priorKill;
  }
});

test('classifyCategoryAsync falls back to keyword when productDescription is empty', async () => {
  const prior = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  try {
    const result = await classifier.classifyCategoryAsync({
      productDescription: '',
      fallbackClassify: orchestrator.classifyProductCategory,
    });
    assert.equal(result.source, 'keyword');
    assert.equal(result.category, 'homeware'); // safe default
    assert.equal(result.reason, 'no-product-description');
  } finally {
    if (prior !== undefined) process.env.ANTHROPIC_API_KEY = prior;
    else delete process.env.ANTHROPIC_API_KEY;
  }
});

test('classifyCategoryAsync uses a default fallback (homeware) when no fallbackClassify is supplied', async () => {
  const prior = process.env.ORCATRADE_DISABLE_AI_CLASSIFIER;
  process.env.ORCATRADE_DISABLE_AI_CLASSIFIER = '1';
  try {
    // @ts-ignore — deliberately omit fallbackClassify
    const result = await classifier.classifyCategoryAsync({
      productDescription: 'cotton t-shirts',
    });
    assert.equal(result.source, 'keyword');
    // Without the real keyword classifier wired, the safe-default
    // fallback returns 'homeware'. Real callers pass orchestrator.classifyProductCategory.
    assert.equal(result.category, 'homeware');
  } finally {
    if (prior !== undefined) process.env.ORCATRADE_DISABLE_AI_CLASSIFIER = prior;
    else delete process.env.ORCATRADE_DISABLE_AI_CLASSIFIER;
  }
});

test('classifyCategoryAsync never throws regardless of bad inputs (fail-soft)', async () => {
  const prior = process.env.ORCATRADE_DISABLE_AI_CLASSIFIER;
  process.env.ORCATRADE_DISABLE_AI_CLASSIFIER = '1';
  try {
    // Each call should resolve to an object, never reject.
    const calls = [
      classifier.classifyCategoryAsync({}),
      classifier.classifyCategoryAsync({ productDescription: null }),
      classifier.classifyCategoryAsync({ productDescription: undefined }),
      classifier.classifyCategoryAsync({ productDescription: 0 }),
    ];
    for (const p of calls) {
      const r = await p;
      assert.equal(typeof r, 'object');
      assert.equal(r.source, 'keyword');
      assert.ok(classifier.CATEGORIES.includes(r.category));
    }
  } finally {
    if (prior !== undefined) process.env.ORCATRADE_DISABLE_AI_CLASSIFIER = prior;
    else delete process.env.ORCATRADE_DISABLE_AI_CLASSIFIER;
  }
});
