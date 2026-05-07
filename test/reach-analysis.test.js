const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REACH_THRESHOLDS,
  HIGH_RELEVANCE_CATEGORIES,
  MEMBER_STATE_PENALTY_NOTES,
  detectReachRelevance,
  determineReachApplicability,
  buildReachEvidenceGaps,
  buildReachPenaltyNote,
} = require('../lib/intelligence/reach-analysis');

// ── detectReachRelevance ─────────────────────────────────

test('detectReachRelevance matches each high-relevance category', () => {
  assert.equal(detectReachRelevance('Electronic components', 'circuit boards').categoryKey, 'electronics');
  assert.equal(detectReachRelevance('Cotton textiles', 'denim').categoryKey, 'textiles');
  assert.equal(detectReachRelevance('Plush toys', null).categoryKey, 'toys');
  assert.equal(detectReachRelevance('Cosmetics', 'shampoo').categoryKey, 'cosmetics');
  assert.equal(detectReachRelevance('Office furniture', 'sofa').categoryKey, 'furniture');
  assert.equal(detectReachRelevance('Plastic packaging', 'bottles').categoryKey, 'packaging');
  assert.equal(detectReachRelevance('Construction paints', 'coating').categoryKey, 'construction');
  assert.equal(detectReachRelevance('Silver jewellery', 'rings').categoryKey, 'jewellery');
});

test('detectReachRelevance returns null for unmatched goods', () => {
  assert.equal(detectReachRelevance('Iron and steel rebar', null), null);
  assert.equal(detectReachRelevance('Cement', null), null);
  assert.equal(detectReachRelevance('Coffee beans', null), null);
});

test('every HIGH_RELEVANCE_CATEGORIES entry has keywords and concerns', () => {
  for (const [key, def] of Object.entries(HIGH_RELEVANCE_CATEGORIES)) {
    assert.ok(def.label, `${key} should have a label`);
    assert.ok(Array.isArray(def.keywords) && def.keywords.length, `${key} should have keywords`);
    assert.ok(Array.isArray(def.commonConcerns) && def.commonConcerns.length, `${key} should have commonConcerns`);
  }
});

// ── determineReachApplicability ──────────────────────────

test('REACH applies (true) for high-relevance categories', () => {
  const result = determineReachApplicability({
    productCategory: 'electronic components',
    productDescription: 'PCBs and connectors',
    originCountry: 'CN',
  });
  assert.equal(result.applies, true);
  assert.equal(result.categoryKey, 'electronics');
  assert.match(result.citation, /1907\/2006/);
  assert.ok(Array.isArray(result.commonConcerns));
});

test('REACH applies "maybe" for unmatched products (always potentially relevant)', () => {
  const result = determineReachApplicability({
    productCategory: 'industrial machinery',
    originCountry: 'CN',
  });
  assert.equal(result.applies, 'maybe');
  assert.match(result.reason, /still applies in principle/i);
});

test('REACH applicability confidence note differentiates EU vs non-EU origin', () => {
  const eu = determineReachApplicability({
    productCategory: 'electronics',
    originCountry: 'EU',
  });
  const nonEu = determineReachApplicability({
    productCategory: 'electronics',
    originCountry: 'CN',
  });
  assert.match(eu.confidenceNote, /not a determining factor/i);
  assert.match(nonEu.confidenceNote, /Only Representative/i);
});

// ── buildReachEvidenceGaps ───────────────────────────────

test('REACH evidence gaps include SDS, SVHC declaration, and Annex XVII as high-severity', () => {
  const gaps = buildReachEvidenceGaps({
    categoryKey: 'electronics',
    importerEntity: 'Acme GmbH',
    supplier: 'Shenzhen PCB',
    originCountry: 'CN',
  });
  const sds = gaps.find(g => g.type === 'sds');
  const svhc = gaps.find(g => g.type === 'svhc_declaration');
  const annex17 = gaps.find(g => g.type === 'annex_xvii_compliance');
  assert.equal(sds.severity, 'high');
  assert.equal(svhc.severity, 'high');
  assert.equal(annex17.severity, 'high');
  assert.match(svhc.citation, /Art\. 33/);
});

test('REACH gaps include OR (Only Representative) gap only for non-EU origin', () => {
  const nonEu = buildReachEvidenceGaps({ categoryKey: 'electronics', originCountry: 'CN' });
  const eu = buildReachEvidenceGaps({ categoryKey: 'electronics', originCountry: 'EU' });
  assert.ok(nonEu.find(g => g.type === 'only_representative'));
  assert.equal(eu.find(g => g.type === 'only_representative'), undefined);
});

test('REACH Annex XVII severity drops to medium when no category matched', () => {
  const noMatch = buildReachEvidenceGaps({ categoryKey: null, originCountry: 'CN' });
  const annex17 = noMatch.find(g => g.type === 'annex_xvii_compliance');
  assert.equal(annex17.severity, 'medium');
});

test('REACH gaps include tonnage assessment for registration trigger', () => {
  const gaps = buildReachEvidenceGaps({ categoryKey: 'electronics', originCountry: 'CN' });
  const tonnage = gaps.find(g => g.type === 'tonnage_assessment');
  assert.ok(tonnage);
  assert.match(tonnage.description, /1\s?t\/yr/);
});

// ── buildReachPenaltyNote ────────────────────────────────

test('REACH penalty note returns Member-State-specific text when known', () => {
  const pl = buildReachPenaltyNote({ destinationCountry: 'PL' });
  assert.match(pl.memberStateSpecific, /Inspekcja/);
  const de = buildReachPenaltyNote({ destinationCountry: 'DE' });
  assert.match(de.memberStateSpecific, /BAuA/);
});

test('REACH penalty note falls back to null memberStateSpecific for unknown country', () => {
  const result = buildReachPenaltyNote({ destinationCountry: 'ZZ' });
  assert.equal(result.memberStateSpecific, null);
  assert.match(result.note, /Member State/);
  assert.ok(Array.isArray(result.operationalConsequences));
  assert.ok(result.operationalConsequences.length >= 3);
});

test('REACH penalty note works without a destination country', () => {
  const result = buildReachPenaltyNote({});
  assert.equal(result.memberStateSpecific, null);
  assert.match(result.citation, /Art\. 126/);
});

// ── Threshold integrity ──────────────────────────────────

test('REACH thresholds expose registration and SVHC concentrations', () => {
  assert.equal(REACH_THRESHOLDS.registrationTonnesPerYear, 1);
  assert.equal(REACH_THRESHOLDS.svhcConcentrationPercentWW, 0.1);
  assert.equal(REACH_THRESHOLDS.csrTonnesPerYear, 10);
  assert.equal(REACH_THRESHOLDS.svhcConsumerResponseDays, 45);
});

test('MEMBER_STATE_PENALTY_NOTES covers PL, DE, FR at minimum', () => {
  assert.ok(MEMBER_STATE_PENALTY_NOTES.PL);
  assert.ok(MEMBER_STATE_PENALTY_NOTES.DE);
  assert.ok(MEMBER_STATE_PENALTY_NOTES.FR);
});
