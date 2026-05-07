const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EUDR_DATES,
  COVERED_COMMODITIES,
  detectEudrCommodity,
  determineEudrApplicability,
  getCountryRiskIndicative,
  buildEudrTimeline,
  buildEudrEvidenceGaps,
  getEudrSizeImplication,
  buildEudrPenaltyExposure,
} = require('../lib/intelligence/eudr-analysis');

// ── detectEudrCommodity ──────────────────────────────────

test('detectEudrCommodity matches each of the seven covered commodities', () => {
  assert.equal(detectEudrCommodity('Cattle hides', null), 'cattle');
  assert.equal(detectEudrCommodity('Cocoa beans', null), 'cocoa');
  assert.equal(detectEudrCommodity('Roasted coffee', null), 'coffee');
  assert.equal(detectEudrCommodity('Palm oil derivative', null), 'oil_palm');
  assert.equal(detectEudrCommodity('Natural rubber', null), 'rubber');
  assert.equal(detectEudrCommodity('Soya bean meal', null), 'soya');
  assert.equal(detectEudrCommodity('Plywood furniture', null), 'wood');
});

test('detectEudrCommodity matches across product / description fields', () => {
  assert.equal(detectEudrCommodity('Furniture', 'oak plywood panels'), 'wood');
  assert.equal(detectEudrCommodity(null, 'Arabica coffee beans'), 'coffee');
});

test('detectEudrCommodity returns null for non-EUDR goods', () => {
  assert.equal(detectEudrCommodity('Iron and steel', 'rebar'), null);
  assert.equal(detectEudrCommodity('Cement', null), null);
  assert.equal(detectEudrCommodity('Cotton textiles', null), null);
});

// ── determineEudrApplicability ────────────────────────────

test('EUDR applies to a covered commodity from a non-EU origin', () => {
  const result = determineEudrApplicability({
    productCategory: 'wood furniture',
    productDescription: 'plywood',
    originCountry: 'VN',
  });
  assert.equal(result.applies, true);
  assert.equal(result.commodityKey, 'wood');
  assert.equal(result.cutOffDate, '2020-12-31');
  assert.match(result.citation, /2023\/1115/);
});

test('EUDR applicability returns amber for non-EU origin, green for EU origin', () => {
  const nonEu = determineEudrApplicability({
    productCategory: 'coffee',
    originCountry: 'ET',
  });
  assert.equal(nonEu.confidence, 'amber');

  const eu = determineEudrApplicability({
    productCategory: 'wood',
    originCountry: 'EU',
  });
  assert.equal(eu.confidence, 'green');
  assert.match(eu.confidenceNote, /simplified/i);
});

test('EUDR does not apply to non-Annex-I products', () => {
  const result = determineEudrApplicability({
    productCategory: 'Iron and steel',
    productDescription: 'rebar',
    originCountry: 'CN',
  });
  assert.equal(result.applies, false);
  assert.equal(result.commodityKey, null);
});

// ── getCountryRiskIndicative ─────────────────────────────

test('country-risk lookup returns known indicators for snapshot countries', () => {
  const cn = getCountryRiskIndicative('CN');
  assert.ok(cn);
  assert.equal(cn.likely, 'standard');

  const eu = getCountryRiskIndicative('EU');
  assert.equal(eu.likely, 'low');
  assert.match(eu.note, /simplified/i);
});

test('country-risk lookup falls back to standard-risk indicator for unknown countries', () => {
  const result = getCountryRiskIndicative('ZZ');
  assert.equal(result.likely, 'standard');
  assert.match(result.note, /standard-risk/i);
});

test('country-risk lookup returns null for empty origin', () => {
  assert.equal(getCountryRiskIndicative(null), null);
  assert.equal(getCountryRiskIndicative(''), null);
});

// ── buildEudrTimeline ────────────────────────────────────

test('EUDR timeline includes entry-into-force, cut-off, and both application dates', () => {
  const timeline = buildEudrTimeline({ asOfDate: '2026-05-07', isSME: false });
  assert.ok(timeline.length >= 4);
  assert.ok(timeline.find(e => e.date === EUDR_DATES.entryIntoForce));
  assert.ok(timeline.find(e => e.date === EUDR_DATES.cutOffDate));
  assert.ok(timeline.find(e => e.date === EUDR_DATES.applicationStandard));
  assert.ok(timeline.find(e => e.date === EUDR_DATES.applicationSME));
});

test('EUDR timeline marks SME-relevant date for small operators', () => {
  const sme = buildEudrTimeline({ asOfDate: '2026-05-07', isSME: true });
  const nonSmeDate = sme.find(e => e.date === EUDR_DATES.applicationStandard);
  const smeDate = sme.find(e => e.date === EUDR_DATES.applicationSME);
  assert.equal(nonSmeDate.relevantToImporter, false);
  assert.equal(smeDate.relevantToImporter, true);

  const nonSme = buildEudrTimeline({ asOfDate: '2026-05-07', isSME: false });
  const nonSmeDate2 = nonSme.find(e => e.date === EUDR_DATES.applicationStandard);
  const smeDate2 = nonSme.find(e => e.date === EUDR_DATES.applicationSME);
  assert.equal(nonSmeDate2.relevantToImporter, true);
  assert.equal(smeDate2.relevantToImporter, false);
});

// ── buildEudrEvidenceGaps ────────────────────────────────

test('EUDR evidence gaps include geolocation and DDS as blockers', () => {
  const gaps = buildEudrEvidenceGaps({
    commodityKey: 'coffee',
    importerEntity: 'Roastery Berlin',
    supplier: 'Sidamo',
    originCountry: 'ET',
    isSME: false,
  });
  const blockers = gaps.filter(g => g.severity === 'blocker');
  assert.ok(blockers.find(g => g.type === 'geolocation'));
  assert.ok(blockers.find(g => g.type === 'due_diligence_statement'));
});

test('EUDR evidence gaps adapt risk-assessment severity by origin', () => {
  const eu = buildEudrEvidenceGaps({
    commodityKey: 'wood',
    importerEntity: 'X',
    supplier: 'Y',
    originCountry: 'EU',
    isSME: false,
  });
  const nonEu = buildEudrEvidenceGaps({
    commodityKey: 'wood',
    importerEntity: 'X',
    supplier: 'Y',
    originCountry: 'VN',
    isSME: false,
  });
  const euRisk = eu.find(g => g.type === 'risk_assessment');
  const nonEuRisk = nonEu.find(g => g.type === 'risk_assessment');
  assert.equal(euRisk.severity, 'medium');
  assert.equal(nonEuRisk.severity, 'high');
});

test('EUDR evidence gaps return empty when no commodity matched', () => {
  const gaps = buildEudrEvidenceGaps({ commodityKey: null });
  assert.deepEqual(gaps, []);
});

test('EUDR evidence gap deadlines reflect SME vs non-SME application date', () => {
  const sme = buildEudrEvidenceGaps({ commodityKey: 'wood', originCountry: 'VN', isSME: true });
  const nonSme = buildEudrEvidenceGaps({ commodityKey: 'wood', originCountry: 'VN', isSME: false });
  assert.equal(sme[0].deadline, EUDR_DATES.applicationSME);
  assert.equal(nonSme[0].deadline, EUDR_DATES.applicationStandard);
});

// ── getEudrSizeImplication ───────────────────────────────

test('size classification: micro / small / medium / large by Directive 2013/34/EU thresholds', () => {
  assert.equal(getEudrSizeImplication(500000).size, 'micro');
  assert.equal(getEudrSizeImplication(3500000).size, 'small');
  assert.equal(getEudrSizeImplication(20000000).size, 'medium');
  assert.equal(getEudrSizeImplication(100000000).size, 'large');
});

test('SMEs (micro/small) get the deferred application date', () => {
  const small = getEudrSizeImplication(3500000);
  assert.equal(small.applicationDate, EUDR_DATES.applicationSME);
  const large = getEudrSizeImplication(100000000);
  assert.equal(large.applicationDate, EUDR_DATES.applicationStandard);
});

test('size implication returns null for missing or invalid turnover', () => {
  assert.equal(getEudrSizeImplication(null), null);
  assert.equal(getEudrSizeImplication(0), null);
  assert.equal(getEudrSizeImplication(-100), null);
});

// ── buildEudrPenaltyExposure ─────────────────────────────

test('EUDR penalty ceiling is 4% of EU turnover', () => {
  const result = buildEudrPenaltyExposure({ globalTurnoverEur: 2500000 });
  assert.equal(result.penaltyCeilingEur, 100000);
  assert.equal(result.rate, '4% of EU annual turnover');
  assert.match(result.citation, /Art\. 25/);
});

test('EUDR penalty includes non-financial consequences from Art. 25', () => {
  const result = buildEudrPenaltyExposure({ globalTurnoverEur: 5000000 });
  assert.ok(Array.isArray(result.nonFinancialConsequences));
  assert.ok(result.nonFinancialConsequences.length >= 3);
  // Confiscation and market exclusion must be present
  const joined = result.nonFinancialConsequences.join(' ').toLowerCase();
  assert.match(joined, /confiscat/);
  assert.match(joined, /market|placing/);
});

test('EUDR penalty returns null for missing turnover', () => {
  assert.equal(buildEudrPenaltyExposure({}), null);
  assert.equal(buildEudrPenaltyExposure({ globalTurnoverEur: 0 }), null);
});

// ── Covered commodity registry integrity ────────────────

test('every covered commodity has keywords and a geolocation note', () => {
  for (const [key, def] of Object.entries(COVERED_COMMODITIES)) {
    assert.ok(def.label, `${key} should have a label`);
    assert.ok(Array.isArray(def.keywords) && def.keywords.length, `${key} should have keywords`);
    assert.ok(def.geolocationNote, `${key} should have a geolocation note`);
  }
});

test('EUDR_DATES surfaces all four key dates as ISO YYYY-MM-DD strings', () => {
  for (const key of ['entryIntoForce', 'applicationStandard', 'applicationSME', 'cutOffDate']) {
    assert.match(EUDR_DATES[key], /^\d{4}-\d{2}-\d{2}$/, `${key} should be ISO date`);
  }
});
