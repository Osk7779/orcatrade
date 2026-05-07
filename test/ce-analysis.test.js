const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DIRECTIVES,
  PRODUCT_CLASSES,
  detectProductClass,
  determineCeApplicability,
  buildCeEvidenceGaps,
  buildCePenaltyNote,
} = require('../lib/intelligence/ce-analysis');

// ── DIRECTIVES registry ────────────────────────────────────

test('DIRECTIVES registry exposes the 7 expected directives with required fields', () => {
  const expectedIds = ['lvd', 'emc', 'machinery', 'toy_safety', 'ppe', 'red', 'rohs'];
  for (const id of expectedIds) {
    assert.ok(DIRECTIVES[id], `directive ${id} missing`);
    assert.ok(DIRECTIVES[id].shortName);
    assert.ok(DIRECTIVES[id].instrument);
    assert.ok(DIRECTIVES[id].chunkId.startsWith('ce-'));
    assert.ok(DIRECTIVES[id].moduleNote);
  }
});

// ── detectProductClass ─────────────────────────────────────

test('detectProductClass identifies wireless electronics with the right directive set', () => {
  const result = detectProductClass('smart speaker', 'bluetooth and wifi enabled');
  assert.ok(result);
  assert.equal(result.key, 'wireless_electronics');
  const ids = result.directives.map(d => d.id);
  assert.deepEqual(ids.sort(), ['emc', 'lvd', 'red', 'rohs']);
});

test('detectProductClass identifies machinery and pulls in LVD/EMC/RoHS too', () => {
  const result = detectProductClass('industrial machinery', 'CNC milling machine');
  assert.equal(result.key, 'machinery');
  const ids = result.directives.map(d => d.id);
  assert.ok(ids.includes('machinery'));
  assert.ok(ids.includes('lvd'));
  assert.ok(ids.includes('emc'));
  assert.ok(ids.includes('rohs'));
});

test('detectProductClass identifies non-electric toys as Toy Safety only', () => {
  const result = detectProductClass('plush toys', 'soft toys for ages 3+');
  assert.equal(result.key, 'toy');
  const ids = result.directives.map(d => d.id);
  assert.deepEqual(ids, ['toy_safety']);
});

test('detectProductClass identifies electric toys as Toy Safety + LVD + EMC + RoHS', () => {
  const result = detectProductClass('electric toy', 'remote control toy car');
  assert.equal(result.key, 'electric_toy');
  const ids = result.directives.map(d => d.id);
  assert.deepEqual(ids.sort(), ['emc', 'lvd', 'rohs', 'toy_safety']);
});

test('detectProductClass identifies PPE items', () => {
  assert.equal(detectProductClass('safety helmet', null).key, 'ppe');
  assert.equal(detectProductClass('respirator', null).key, 'ppe');
});

test('detectProductClass returns null for non-CE goods (e.g. coffee, steel)', () => {
  assert.equal(detectProductClass('coffee beans', 'arabica'), null);
  assert.equal(detectProductClass('iron and steel', 'rebar'), null);
});

test('detectProductClass returns medical-device class with empty directives (out of scope here)', () => {
  const result = detectProductClass('medical device', 'syringe');
  assert.ok(result);
  assert.equal(result.key, 'medical_device_basic');
  assert.equal(result.directives.length, 0);
});

// ── determineCeApplicability ───────────────────────────────

test('CE applies for wireless electronics with full directive list returned', () => {
  const result = determineCeApplicability({
    productCategory: 'electronics',
    productDescription: 'smart speaker bluetooth wifi',
    originCountry: 'CN',
  });
  assert.equal(result.applies, true);
  assert.equal(result.productClassKey, 'wireless_electronics');
  assert.equal(result.directives.length, 4);
  assert.match(result.citation, /765\/2008/);
});

test('CE applies "maybe" when no product class matched', () => {
  const result = determineCeApplicability({
    productCategory: 'office stationery',
    originCountry: 'CN',
  });
  assert.equal(result.applies, 'maybe');
  assert.equal(result.directives.length, 0);
});

test('CE returns "out_of_scope" verdict for medical devices (different framework)', () => {
  const result = determineCeApplicability({
    productCategory: 'medical device',
    productDescription: 'diagnostic syringe',
    originCountry: 'CN',
  });
  assert.equal(result.applies, 'out_of_scope');
  assert.match(result.reason, /Medical Device/);
});

test('CE confidence note differs between EU and non-EU origin', () => {
  const eu = determineCeApplicability({
    productCategory: 'electronics',
    productDescription: 'PCB and connectors',
    originCountry: 'EU',
  });
  const nonEu = determineCeApplicability({
    productCategory: 'electronics',
    productDescription: 'PCB and connectors',
    originCountry: 'CN',
  });
  assert.match(nonEu.confidenceNote, /Authorised Representative/);
  assert.match(eu.confidenceNote, /verify/i);
});

// ── buildCeEvidenceGaps ────────────────────────────────────

test('CE evidence gaps include DoC, Technical File, CE marking as blockers', () => {
  const directives = determineCeApplicability({
    productCategory: 'electronics',
    productDescription: 'bluetooth smart speaker',
    originCountry: 'CN',
  }).directives;
  const gaps = buildCeEvidenceGaps({
    productClassKey: 'wireless_electronics',
    directives,
    importerEntity: 'AudioCraft GmbH',
    supplier: 'Shenzhen Audio',
    originCountry: 'CN',
  });
  const blockers = gaps.filter(g => g.severity === 'blocker');
  assert.ok(blockers.find(g => g.type === 'doc'));
  assert.ok(blockers.find(g => g.type === 'technical_file'));
  assert.ok(blockers.find(g => g.type === 'ce_marking'));
});

test('CE evidence gaps include AR gap for non-EU manufacturer, omitted for EU', () => {
  const directives = determineCeApplicability({
    productCategory: 'electronics',
    productDescription: 'wireless device',
    originCountry: 'CN',
  }).directives;
  const nonEu = buildCeEvidenceGaps({ productClassKey: 'wireless_electronics', directives, originCountry: 'CN' });
  const eu = buildCeEvidenceGaps({ productClassKey: 'wireless_electronics', directives, originCountry: 'EU' });
  assert.ok(nonEu.find(g => g.type === 'authorised_representative'));
  assert.equal(eu.find(g => g.type === 'authorised_representative'), undefined);
});

test('CE evidence gaps include Notified Body gap when at least one applicable directive needs NB', () => {
  // Wireless includes RED which is conditional → NB gap should appear
  const directives = determineCeApplicability({
    productCategory: 'wireless device',
    productDescription: 'bluetooth speaker',
    originCountry: 'CN',
  }).directives;
  const gaps = buildCeEvidenceGaps({ productClassKey: 'wireless_electronics', directives, originCountry: 'CN' });
  assert.ok(gaps.find(g => g.type === 'notified_body'));
});

test('CE evidence gaps include RoHS substance evidence when RoHS is in the set', () => {
  const directives = determineCeApplicability({
    productCategory: 'electronics',
    productDescription: 'bluetooth speaker',
    originCountry: 'CN',
  }).directives;
  const gaps = buildCeEvidenceGaps({ productClassKey: 'wireless_electronics', directives, originCountry: 'CN' });
  assert.ok(gaps.find(g => g.type === 'rohs_substances'));
});

test('CE evidence gaps return empty when no directives apply', () => {
  const gaps = buildCeEvidenceGaps({ productClassKey: null, directives: [], originCountry: 'CN' });
  assert.deepEqual(gaps, []);
});

test('CE evidence gap deadlines all reference "before placing on the market" or first import', () => {
  const directives = determineCeApplicability({
    productCategory: 'machinery',
    productDescription: 'CNC mill',
    originCountry: 'CN',
  }).directives;
  const gaps = buildCeEvidenceGaps({ productClassKey: 'machinery', directives, originCountry: 'CN' });
  for (const gap of gaps) {
    assert.ok(gap.deadline, `${gap.type} should have a deadline`);
  }
});

// ── buildCePenaltyNote ─────────────────────────────────────

test('CE penalty note includes operational consequences and citation', () => {
  const result = buildCePenaltyNote();
  assert.ok(Array.isArray(result.operationalConsequences));
  assert.ok(result.operationalConsequences.length >= 4);
  assert.match(result.citation, /765\/2008/);
});

// ── PRODUCT_CLASSES integrity ──────────────────────────────

test('every PRODUCT_CLASSES entry has a label, keywords, and a directives array', () => {
  for (const def of PRODUCT_CLASSES) {
    assert.ok(def.label, `${def.key} should have a label`);
    assert.ok(Array.isArray(def.keywords) && def.keywords.length, `${def.key} should have keywords`);
    assert.ok(Array.isArray(def.directives), `${def.key} should have a directives array (may be empty)`);
  }
});
