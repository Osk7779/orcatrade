// Sourcing-quote calculator tests.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PRICING_SNAPSHOT,
  COUNTRIES,
  CATEGORIES,
  SAMPLE_SUPPLIERS,
  listCategories,
  listCountries,
  validateInput,
  compareCountries,
  assessRisk,
  estimateLeadTime,
  shortlistSuppliers,
  recommendCountry,
} = require('../lib/intelligence/sourcing-quote');

// ── Snapshot & catalogue ─────────────────────────────────

test('PRICING_SNAPSHOT exposes asOf, source, notes', () => {
  assert.match(PRICING_SNAPSHOT.asOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(PRICING_SNAPSHOT.source);
  assert.ok(PRICING_SNAPSHOT.notes);
});

test('COUNTRIES catalogue includes 5 sourcing markets', () => {
  for (const c of ['CN', 'VN', 'IN', 'BD', 'TR']) {
    assert.ok(COUNTRIES[c], `${c} present`);
    assert.ok(COUNTRIES[c].name);
    assert.ok(Number.isFinite(COUNTRIES[c].seaTransitWeeks));
  }
});

test('CATEGORIES covers 8 product categories', () => {
  const expected = ['apparel', 'electronics', 'furniture', 'toys', 'cosmetics', 'homeware', 'footwear', 'machinery'];
  for (const cat of expected) {
    assert.ok(CATEGORIES[cat], `${cat} present`);
    assert.ok(CATEGORIES[cat].countryProfiles);
  }
});

test('Every category has a profile for every country', () => {
  for (const [catKey, cat] of Object.entries(CATEGORIES)) {
    for (const country of ['CN', 'VN', 'IN', 'BD', 'TR']) {
      assert.ok(cat.countryProfiles[country], `${catKey} × ${country} profile present`);
      const p = cat.countryProfiles[country];
      assert.ok(Number.isFinite(p.fobIndex), `${catKey}×${country} fobIndex`);
      assert.ok(Number.isFinite(p.leadTimeWeeks), `${catKey}×${country} leadTimeWeeks`);
      assert.ok(['low', 'medium', 'high'].includes(p.qualityRisk));
      assert.ok(['low', 'medium', 'high'].includes(p.ipRisk));
    }
  }
});

test('CN baseline FOB index is exactly 1.00 for every category', () => {
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    assert.equal(cat.countryProfiles.CN.fobIndex, 1.00, `${key} CN baseline = 1.00`);
  }
});

test('Türkiye has 1-week sea transit (advantage)', () => {
  assert.equal(COUNTRIES.TR.seaTransitWeeks, 1);
});

test('Bangladesh apparel is cheapest baseline (FOB index < 0.85)', () => {
  assert.ok(CATEGORIES.apparel.countryProfiles.BD.fobIndex < 0.85);
});

// ── validateInput ────────────────────────────────────────

test('validateInput rejects unknown product category', () => {
  const r = validateInput({ productCategory: 'spaceships' });
  assert.equal(r.ok, false);
});

test('validateInput rejects negative fob unit price', () => {
  const r = validateInput({ productCategory: 'apparel', targetFobUnitEur: -5 });
  assert.equal(r.ok, false);
});

test('validateInput accepts complete valid input', () => {
  const r = validateInput({
    productCategory: 'apparel', targetFobUnitEur: 4, moq: 2000, urgencyWeeks: 16,
  });
  assert.equal(r.ok, true);
});

// ── compareCountries ─────────────────────────────────────

test('compareCountries returns 5 entries for apparel by default', () => {
  const r = compareCountries({ productCategory: 'apparel' });
  assert.equal(r.length, 5);
});

test('compareCountries computes fobUnitEur when targetFobUnitEur given', () => {
  const r = compareCountries({ productCategory: 'apparel', targetFobUnitEur: 10, moq: 1000 });
  const cn = r.find(c => c.country === 'CN');
  assert.equal(cn.fobUnitEur, 10);  // CN baseline 1.0 × 10
  const bd = r.find(c => c.country === 'BD');
  assert.equal(bd.fobUnitEur, 7.8);  // 0.78 × 10
  // total = unit × MOQ
  assert.equal(cn.fobTotalEur, 10000);
});

test('compareCountries respects countries filter', () => {
  const r = compareCountries({ productCategory: 'apparel', countries: ['CN', 'VN'] });
  assert.equal(r.length, 2);
  assert.equal(r[0].country, 'CN');
  assert.equal(r[1].country, 'VN');
});

test('compareCountries flags meetsUrgency correctly', () => {
  const r = compareCountries({ productCategory: 'apparel', urgencyWeeks: 6 });
  // TR has 5 weeks total — should meet 6w deadline
  assert.equal(r.find(c => c.country === 'TR').meetsUrgency, true);
  // BD has 14 weeks — should not
  assert.equal(r.find(c => c.country === 'BD').meetsUrgency, false);
});

// ── assessRisk ───────────────────────────────────────────

test('assessRisk returns quality + IP + audit recommendation', () => {
  const r = assessRisk({ productCategory: 'electronics', country: 'CN' });
  assert.equal(r.country, 'CN');
  assert.equal(r.qualityRisk, 'low');
  assert.equal(r.ipRisk, 'high');
  assert.match(r.auditRecommendation, /audit|inspection/i);
});

test('assessRisk returns error for unknown country×category', () => {
  const r = assessRisk({ productCategory: 'apparel', country: 'ZZ' });
  assert.ok(r.error);
});

// ── estimateLeadTime ─────────────────────────────────────

test('estimateLeadTime adds country sea transit to production weeks', () => {
  const r = estimateLeadTime({ productCategory: 'apparel', country: 'CN' });
  assert.equal(r.totalWeeks, 6 + 5); // 6 production + 5 sea
  assert.equal(r.totalDays, 11 * 7);
});

test('estimateLeadTime adds 2 weeks for very large MOQ', () => {
  const small = estimateLeadTime({ productCategory: 'apparel', country: 'CN', moq: 2000 });
  const large = estimateLeadTime({ productCategory: 'apparel', country: 'CN', moq: 5000 }); // > 2x typicalMoq (2000)
  assert.equal(large.totalWeeks - small.totalWeeks, 2);
});

test('estimateLeadTime flags meetsUrgency', () => {
  const r = estimateLeadTime({ productCategory: 'apparel', country: 'TR', urgencyWeeks: 6 });
  // TR: 4 production + 1 transit = 5 weeks
  assert.equal(r.meetsUrgency, true);
  const r2 = estimateLeadTime({ productCategory: 'apparel', country: 'BD', urgencyWeeks: 6 });
  assert.equal(r2.meetsUrgency, false);
});

// ── shortlistSuppliers ───────────────────────────────────

test('shortlistSuppliers returns sample list when curated', () => {
  const r = shortlistSuppliers({ productCategory: 'apparel', country: 'CN' });
  assert.ok(r.suppliers.length > 0);
  for (const s of r.suppliers) {
    assert.ok(s.name);
    assert.ok(s.specialty);
  }
});

test('shortlistSuppliers returns empty list with note for uncurated combination', () => {
  const r = shortlistSuppliers({ productCategory: 'machinery', country: 'BD' });
  assert.equal(r.suppliers.length, 0);
  assert.match(r.note, /HK office|custom supplier-discovery/i);
});

// ── recommendCountry integration ─────────────────────────

test('recommendCountry returns full result with comparison + recommendation', () => {
  const r = recommendCountry({
    productCategory: 'apparel', targetFobUnitEur: 4, moq: 2000, urgencyWeeks: 16, costPriority: 'balanced',
  });
  assert.equal(r.ok, true);
  assert.equal(r.comparison.length, 5);
  assert.ok(r.recommendation.primary);
  assert.ok(r.recommendation.reasoning);
  assert.ok(r.recommendation.alternatives.cheapest);
  assert.ok(r.recommendation.alternatives.fastest);
  assert.ok(r.sourcingEducation);
  assert.ok(r.nextSteps.length >= 2);
});

test('recommendCountry: costPriority=cost prefers cheapest viable', () => {
  const r = recommendCountry({
    productCategory: 'apparel', targetFobUnitEur: 5, moq: 5000, urgencyWeeks: 16, costPriority: 'cost',
  });
  // BD is cheapest apparel; 14 weeks total fits 16-week urgency
  assert.equal(r.recommendation.primary, 'BD');
});

test('recommendCountry: tight urgency forces TR for apparel', () => {
  const r = recommendCountry({
    productCategory: 'apparel', targetFobUnitEur: 10, moq: 1000, urgencyWeeks: 6, costPriority: 'balanced',
  });
  // Only TR meets 6w deadline (5w total); should be the primary
  assert.equal(r.recommendation.primary, 'TR');
});

test('recommendCountry rejects malformed input', () => {
  const r = recommendCountry({ productCategory: 'spaceships' });
  assert.equal(r.ok, false);
});

// ── Listing helpers ──────────────────────────────────────

test('listCountries returns 5 countries with seaTransitWeeks', () => {
  const list = listCountries();
  assert.equal(list.length, 5);
  for (const c of list) {
    assert.ok(c.code);
    assert.ok(c.name);
    assert.ok(Array.isArray(c.notes));
  }
});

test('listCategories returns 8 categories with key + label', () => {
  const list = listCategories();
  assert.equal(list.length, 8);
  for (const c of list) {
    assert.ok(c.key);
    assert.ok(c.label);
  }
});
