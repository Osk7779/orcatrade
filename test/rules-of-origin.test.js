// Sprint roo-v1 (Pillar II2) — HS precision + rules-of-origin determination.

const test = require('node:test');
const assert = require('node:assert/strict');

const roo = require('../lib/intelligence/rules-of-origin');

// ── HS decomposition ────────────────────────────────────

test('decomposeHs breaks a TARIC10 code into its hierarchy', () => {
  const d = roo.decomposeHs('8714 91 10 00');
  assert.equal(d.normalized, '8714911000');
  assert.equal(d.length, 10);
  assert.equal(d.valid, true);
  assert.equal(d.chapter, '87');
  assert.equal(d.heading, '8714');
  assert.equal(d.subheading, '871491');
  assert.equal(d.cn8, '87149110');
  assert.equal(d.taric10, '8714911000');
  assert.equal(d.tier, 'taric10');
});

test('decomposeHs handles HS6 and flags precision tier', () => {
  const d = roo.decomposeHs('610910');
  assert.equal(d.valid, true);
  assert.equal(d.tier, 'subheading');
  assert.equal(d.cn8, null);
});

test('decomposeHs marks odd-length codes as not customs-valid but still decomposes', () => {
  const d = roo.decomposeHs('8714'); // heading only
  assert.equal(d.valid, false);     // 4 digits isn't a usable customs code
  assert.equal(d.chapter, '87');
  assert.equal(d.heading, '8714');
  assert.equal(d.tier, 'heading');
});

// ── Rule determination ──────────────────────────────────

test('apparel (ch 61/62) → double transformation rule', () => {
  const r = roo.determineOriginRule({ hsCode: '610910', regimeCode: 'EVFTA' });
  assert.equal(r.ok, true);
  assert.equal(r.primaryRule, 'specific_process');
  assert.match(r.primaryRuleLabel, /yarn|fabric|process/i);
  assert.equal(r.regimeCode, 'EVFTA');
  assert.ok(r.requiredEvidence.length >= 1);
  assert.match(r.caveat, /product-specific-rules|PSR|annex/i);
});

test('vehicles (ch 87) → max non-originating value rule with a threshold', () => {
  const r = roo.determineOriginRule({ hsCode: '8703231900' });
  assert.equal(r.primaryRule, 'max_non_originating_value');
  assert.equal(r.maxNonOriginatingPct, 45);
});

test('raw agriculture (ch 09 coffee) → wholly obtained', () => {
  const r = roo.determineOriginRule({ hsCode: '090111' });
  assert.equal(r.primaryRule, 'wholly_obtained');
});

test('machinery (ch 84) → CTH primary with a value alternative', () => {
  const r = roo.determineOriginRule({ hsCode: '847130' });
  assert.equal(r.primaryRule, 'change_of_heading');
  assert.equal(r.alternativeRule, 'max_non_originating_value');
  assert.equal(r.maxNonOriginatingPct, 50);
});

test('no HS code → not ok', () => {
  assert.equal(roo.determineOriginRule({}).ok, false);
});

// ── Qualification assessment (deterministic value maths) ──

test('value rule: under the cap → likely_qualifies', () => {
  const r = roo.assessOriginQualification({ hsCode: '8703231900', exFactoryPriceEur: 10000, nonOriginatingValueEur: 4000 });
  assert.equal(r.verdict, 'likely_qualifies');
  assert.equal(r.nonOriginatingPct, 40);
  assert.equal(r.thresholdPct, 45);
});

test('value rule: over the cap → likely_fails', () => {
  const r = roo.assessOriginQualification({ hsCode: '8703231900', exFactoryPriceEur: 10000, nonOriginatingValueEur: 6000 });
  assert.equal(r.verdict, 'likely_fails');
  assert.equal(r.nonOriginatingPct, 60);
});

test('value rule with a direct percentage works too', () => {
  const r = roo.assessOriginQualification({ hsCode: '8703231900', nonOriginatingValuePct: 30 });
  assert.equal(r.verdict, 'likely_qualifies');
});

test('value rule with no value inputs → needs_evidence', () => {
  const r = roo.assessOriginQualification({ hsCode: '8703231900' });
  assert.equal(r.verdict, 'needs_evidence');
});

test('CTH rule without a BOM → needs_evidence', () => {
  const r = roo.assessOriginQualification({ hsCode: '847130' });
  assert.equal(r.verdict, 'needs_evidence');
  assert.match(r.detail, /bill of materials|tariff/i);
});

test('textile specific-process: processDone flag drives the verdict', () => {
  assert.equal(roo.assessOriginQualification({ hsCode: '610910', processDone: true }).verdict, 'likely_qualifies');
  assert.equal(roo.assessOriginQualification({ hsCode: '610910', processDone: false }).verdict, 'likely_fails');
});

test('every verdict still carries the binding-rule caveat', () => {
  const r = roo.assessOriginQualification({ hsCode: '8703231900', nonOriginatingValuePct: 30 });
  assert.match(r.caveat, /binding|product-specific|annex/i);
});
