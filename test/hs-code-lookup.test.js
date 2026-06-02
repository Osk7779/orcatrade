'use strict';

// Phase 0 task P0.11 of docs/execution-plan.md.
//
// Tests lib/intelligence/hs-code-lookup.js — the deterministic
// HS-code suggestion + (optional) live MFN enrichment that replaces
// the prior fake-confidence agent tool stub.
//
// Asserts:
//   - Empty / missing productDescription returns the explicit-error shape
//     (confidence 0, tier 'none', clear message)
//   - Known queries with strong single matches → high confidence
//   - Ambiguous queries (multi-word, several similar candidates) →
//     medium confidence
//   - Unknown queries → low / none with a guidance message
//   - Confidence is always bounded [0, 1]
//   - dutyEstimate is null when no origin is given AND when the
//     test-only skipDutyLookup is set (no upstream calls in unit tests)
//   - verifyUrl is generated when there's a suggestion
//   - Source-pin: lib/intelligence/hs-code-lookup.js does NOT import
//     the Anthropic SDK or anything from lib/ai/ (ADR 0002 + ADR 0003)
//   - Source-pin: all 4 agent handlers now route lookupHsCode through
//     lib/intelligence/hs-code-lookup.js (not the prior placeholder)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { lookupHsCode, computeConfidence } = require('../lib/intelligence/hs-code-lookup');

const ROOT = path.resolve(__dirname, '..');

// ── input validation ─────────────────────────────────────────────────

test('empty productDescription → confidence 0 + explicit error message', async () => {
  const r = await lookupHsCode({});
  assert.equal(r.suggestion, null);
  assert.equal(r.confidence, 0);
  assert.equal(r.confidenceTier, 'none');
  assert.match(r.message, /productDescription is required/);
});

test('whitespace-only productDescription is treated as empty', async () => {
  const r = await lookupHsCode({ productDescription: '   ' });
  assert.equal(r.suggestion, null);
  assert.equal(r.confidence, 0);
});

// ── known matches → tier expectations match the calibrated scoring ──

test('"smartphone" → 851713 with medium confidence (single exact token)', async () => {
  const r = await lookupHsCode({ productDescription: 'smartphone' }, { skipDutyLookup: true });
  assert.equal(r.suggestion.hs6, '851713');
  assert.equal(r.confidenceTier, 'medium');
});

test('"lithium battery" → 850760 with high confidence (multi-token + clear winner)', async () => {
  // top score 6 (two exact tokens) vs runner-up 1 → ≥ 2× → high.
  const r = await lookupHsCode({ productDescription: 'lithium battery' }, { skipDutyLookup: true });
  assert.equal(r.suggestion.hs6, '850760');
  assert.equal(r.confidenceTier, 'high');
  assert.equal(r.confidence, 0.9);
});

test('"cotton t-shirt" matches a T-shirt entry with at least medium confidence', async () => {
  // top 6 (cotton + t-shirt), runner-up 4 (only t-shirt) → 6 < 8 → medium.
  const r = await lookupHsCode({ productDescription: 'cotton t-shirt' }, { skipDutyLookup: true });
  assert.ok(r.suggestion, 'expected a suggestion');
  assert.match(r.suggestion.hs6, /^6109/);
  assert.equal(r.confidenceTier, 'medium');
});

test('"e-bike" → 871160 with medium confidence', async () => {
  const r = await lookupHsCode({ productDescription: 'e-bike' }, { skipDutyLookup: true });
  assert.equal(r.suggestion.hs6, '871160');
  assert.equal(r.confidenceTier, 'medium');
});

// ── unknown / vague → low or none ────────────────────────────────────

test('"qwerty zzz nonsense" → none / no suggestion', async () => {
  const r = await lookupHsCode({ productDescription: 'qwerty zzz nonsense' }, { skipDutyLookup: true });
  assert.equal(r.suggestion, null);
  assert.equal(r.confidence, 0);
  assert.match(r.message, /No HS6 candidate matched/);
  assert.match(r.message, /Do NOT guess/);
});

// ── confidence is always bounded ─────────────────────────────────────

test('confidence is always within [0, 1] across a sample of queries', async () => {
  const queries = ['smartphone', 'cotton shirt', 'sofa', 'qwerty', 'wine', '', 'random words'];
  for (const q of queries) {
    const r = await lookupHsCode({ productDescription: q }, { skipDutyLookup: true });
    assert.ok(r.confidence >= 0 && r.confidence <= 1, `confidence out of range for "${q}": ${r.confidence}`);
  }
});

// ── computeConfidence rules (the public scorer) ──────────────────────

test('computeConfidence: empty → none', () => {
  const r = computeConfidence([]);
  assert.equal(r.confidence, 0);
  assert.equal(r.tier, 'none');
});

test('computeConfidence: top ≥ 5 with no runner-up → high (0.9)', () => {
  const r = computeConfidence([{ score: 6 }]);
  assert.equal(r.tier, 'high');
  assert.equal(r.confidence, 0.9);
});

test('computeConfidence: top ≥ 5 and ≥ 2× runner-up → high (0.9)', () => {
  const r = computeConfidence([{ score: 6 }, { score: 2 }]);
  assert.equal(r.tier, 'high');
  assert.equal(r.confidence, 0.9);
});

test('computeConfidence: top ≥ 5 but runner-up < 2× away → medium (0.65)', () => {
  const r = computeConfidence([{ score: 6 }, { score: 4 }]);
  assert.equal(r.tier, 'medium');
  assert.equal(r.confidence, 0.65);
});

test('computeConfidence: top 3-4 (single exact-token match) → medium (0.5)', () => {
  const r = computeConfidence([{ score: 4 }]);
  assert.equal(r.tier, 'medium');
  assert.equal(r.confidence, 0.5);
});

test('computeConfidence: top 1-2 (partial matches only) → low (0.25)', () => {
  const r = computeConfidence([{ score: 2 }]);
  assert.equal(r.tier, 'low');
  assert.equal(r.confidence, 0.25);
});

// ── duty enrichment is opt-in + safe ─────────────────────────────────

test('no originCountry → dutyEstimate null', async () => {
  const r = await lookupHsCode({ productDescription: 'smartphone' }, { skipDutyLookup: true });
  assert.equal(r.dutyEstimate, null);
});

test('skipDutyLookup → dutyEstimate null even with origin', async () => {
  const r = await lookupHsCode(
    { productDescription: 'smartphone', originCountry: 'CN' },
    { skipDutyLookup: true },
  );
  assert.equal(r.dutyEstimate, null);
});

test('invalid originCountry (not ISO-2) → ignored, no upstream call', async () => {
  const r = await lookupHsCode(
    { productDescription: 'smartphone', originCountry: 'china' },
    { skipDutyLookup: true },
  );
  assert.equal(r.originCountry, null);
});

// ── verify URL is always generated when there's a suggestion ─────────

test('verifyUrl points to taric.ec.europa.eu when there is a suggestion', async () => {
  const r = await lookupHsCode({ productDescription: 'smartphone' }, { skipDutyLookup: true });
  assert.match(r.verifyUrl, /^https:\/\/taric\.ec\.europa\.eu/);
  assert.ok(r.verifyUrl.includes('851713'));
});

test('verifyUrl null when no suggestion', async () => {
  const r = await lookupHsCode({ productDescription: 'qwerty zzz' }, { skipDutyLookup: true });
  assert.equal(r.verifyUrl, null);
});

// ── candidates ranking ───────────────────────────────────────────────

test('candidates are returned in best-first order with score numbers', async () => {
  const r = await lookupHsCode({ productDescription: 'cotton shirt' }, { skipDutyLookup: true });
  assert.ok(r.candidates.length >= 1);
  for (let i = 1; i < r.candidates.length; i++) {
    assert.ok(r.candidates[i - 1].score >= r.candidates[i].score, 'candidates not sorted descending');
  }
});

// ── ADR 0002 + ADR 0003 boundary: no LLM in this module ─────────────

test('hs-code-lookup.js does not import the Anthropic SDK or lib/ai', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/intelligence/hs-code-lookup.js'), 'utf8');
  assert.doesNotMatch(
    src,
    /@anthropic-ai\/sdk|require\(['"]\.\.\/ai/,
    'lib/intelligence/hs-code-lookup.js must stay calculator-grounded (ADR 0002 + 0003)',
  );
});

// ── Source-pin: all 4 agent handlers route through the new module ───

test('all 4 specialist agents route lookupHsCode through lib/intelligence/hs-code-lookup.js', () => {
  const agents = [
    'lib/handlers/agent.js',
    'lib/handlers/finance-agent.js',
    'lib/handlers/logistics-agent.js',
    'lib/handlers/sourcing-agent.js',
  ];
  for (const file of agents) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(
      src,
      /require\(['"]\.\.\/intelligence\/hs-code-lookup['"]\)/,
      `${file} must require lib/intelligence/hs-code-lookup`,
    );
  }
});

test('the prior "confidence: 0.0" placeholder pattern is gone from all 4 agents', () => {
  const agents = [
    'lib/handlers/agent.js',
    'lib/handlers/finance-agent.js',
    'lib/handlers/logistics-agent.js',
    'lib/handlers/sourcing-agent.js',
  ];
  for (const file of agents) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(
      src,
      /confidence:\s*0\.0/,
      `${file} must not contain the prior \`confidence: 0.0\` placeholder pattern`,
    );
  }
});
