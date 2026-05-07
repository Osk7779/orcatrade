const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SNAPSHOT,
  KNOWN_BUYERS,
  COUNTRY_REGISTRIES,
  normaliseName,
  findKnownBuyer,
  lookupCountryRegistry,
  validateInput,
  checkBuyer,
  listSampleBuyers,
} = require('../lib/intelligence/buyer-verification');

// ── Registry integrity ───────────────────────────────────

test('KNOWN_BUYERS includes major European tier-1 buyers', () => {
  const legalNames = Object.values(KNOWN_BUYERS).map(b => b.legalName.toLowerCase());
  for (const expected of ['ceconomy', 'allegro', 'ingka', 'inditex', 'kaufland']) {
    assert.ok(legalNames.some(n => n.includes(expected)), `expected to find ${expected}`);
  }
});

test('every KNOWN_BUYERS entry has the required fields', () => {
  for (const [key, b] of Object.entries(KNOWN_BUYERS)) {
    assert.ok(Array.isArray(b.matchKeys) && b.matchKeys.length, `${key} matchKeys`);
    assert.ok(b.legalName, `${key} legalName`);
    assert.ok(b.country, `${key} country`);
    assert.ok(b.creditBand, `${key} creditBand`);
    assert.ok(b.recommendation, `${key} recommendation`);
    assert.ok(Number.isFinite(b.tradeCreditCapEur), `${key} tradeCreditCapEur`);
  }
});

test('COUNTRY_REGISTRIES covers EU + UK + EEA', () => {
  for (const code of ['PL', 'DE', 'NL', 'FR', 'IT', 'ES', 'GB', 'IE', 'SE', 'DK', 'FI']) {
    assert.ok(COUNTRY_REGISTRIES[code], `missing registry for ${code}`);
    assert.ok(COUNTRY_REGISTRIES[code].name);
    assert.ok(COUNTRY_REGISTRIES[code].publicUrl.startsWith('https://'));
  }
});

test('SNAPSHOT exposes asOf date and source', () => {
  assert.match(SNAPSHOT.asOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(SNAPSHOT.source);
});

// ── normaliseName ────────────────────────────────────────

test('normaliseName strips legal-entity suffixes and lowercases', () => {
  assert.equal(normaliseName('IKEA Ingka Group'), 'ikea ingka group');
  assert.equal(normaliseName('MediaMarkt Saturn GmbH'), 'mediamarkt saturn');
  assert.equal(normaliseName('Random Sp. z o.o.'), 'random');
  assert.equal(normaliseName('  Ceconomy AG  '), 'ceconomy');
});

test('normaliseName handles empty/null gracefully', () => {
  assert.equal(normaliseName(null), '');
  assert.equal(normaliseName(''), '');
});

// ── findKnownBuyer ──────────────────────────────────────

test('findKnownBuyer matches across name variants', () => {
  assert.ok(findKnownBuyer('MediaMarkt'));
  assert.ok(findKnownBuyer('mediamarkt saturn'));
  assert.ok(findKnownBuyer('Ceconomy AG'));
  assert.ok(findKnownBuyer('Allegro.eu'));
  assert.ok(findKnownBuyer('IKEA Ingka'));
  assert.ok(findKnownBuyer('Inditex'));
  assert.ok(findKnownBuyer('Zara'));
});

test('findKnownBuyer returns null for unknown buyers', () => {
  assert.equal(findKnownBuyer('Some Random Company GmbH'), null);
  assert.equal(findKnownBuyer(''), null);
});

// ── lookupCountryRegistry ────────────────────────────────

test('lookupCountryRegistry returns the right registry for known countries', () => {
  assert.match(lookupCountryRegistry('PL').name, /KRS/);
  assert.match(lookupCountryRegistry('DE').name, /Handelsregister/);
  assert.match(lookupCountryRegistry('GB').name, /Companies House/);
});

test('lookupCountryRegistry falls back to BRIS for unknown countries', () => {
  const result = lookupCountryRegistry('ZZ');
  assert.match(result.name, /BRIS/);
});

// ── validateInput ────────────────────────────────────────

test('validateInput rejects missing companyName', () => {
  const result = validateInput({ country: 'DE' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('companyName')));
});

test('validateInput rejects 1-character name', () => {
  const result = validateInput({ companyName: 'X' });
  assert.equal(result.ok, false);
});

test('validateInput rejects non-2-letter country code', () => {
  const result = validateInput({ companyName: 'Acme Co', country: 'GERM' });
  assert.equal(result.ok, false);
});

test('validateInput accepts complete request', () => {
  const result = validateInput({ companyName: 'Acme Co', country: 'DE', registryId: 'HRB 12345' });
  assert.equal(result.ok, true);
});

// ── checkBuyer — known buyers ────────────────────────────

test('checkBuyer returns "known" matchType for tier-1 buyers', () => {
  const result = checkBuyer({ companyName: 'MediaMarkt Saturn', country: 'DE' });
  assert.equal(result.ok, true);
  assert.equal(result.profile.matchType, 'known');
  assert.equal(result.profile.creditBand, 'low');
  assert.equal(result.verdict.recommendation, 'acceptable');
  assert.ok(result.profile.tradeCreditCapEur > 0);
});

test('checkBuyer returns expected fields for Allegro', () => {
  const result = checkBuyer({ companyName: 'Allegro.eu', country: 'PL' });
  assert.equal(result.profile.country, 'PL');
  assert.match(result.profile.registry, /KRS/);
  assert.ok(result.profile.registryId);
});

test('checkBuyer attaches registry public URL', () => {
  const result = checkBuyer({ companyName: 'IKEA Ingka', country: 'NL' });
  assert.match(result.profile.registryPublicUrl, /https:\/\//);
});

// ── checkBuyer — unknown buyers ──────────────────────────

test('checkBuyer returns "unknown" matchType for non-snapshot buyers', () => {
  const result = checkBuyer({ companyName: 'Random Trading Company GmbH', country: 'DE' });
  assert.equal(result.profile.matchType, 'unknown');
  assert.equal(result.profile.creditBand, 'unknown');
  assert.equal(result.profile.recommendation, 'verify_required');
  assert.equal(result.profile.tradeCreditCapEur, 0);
});

test('checkBuyer flags missing registry ID for unknown buyers', () => {
  const result = checkBuyer({ companyName: 'Acme Trading Sp. z o.o.', country: 'PL' });
  assert.ok(Array.isArray(result.profile.flags));
  assert.ok(result.profile.flags.some(f => f.toLowerCase().includes('no registry')));
});

test('checkBuyer security suggestion changes when registry ID is supplied', () => {
  const without = checkBuyer({ companyName: 'X Co Ltd', country: 'GB' });
  const withId = checkBuyer({ companyName: 'X Co Ltd', country: 'GB', registryId: '12345678' });
  assert.notEqual(without.profile.securitySuggestion, withId.profile.securitySuggestion);
});

test('checkBuyer recommends LC at sight or advance for unknown buyers', () => {
  const result = checkBuyer({ companyName: 'Unknown GmbH', country: 'DE' });
  assert.match(result.profile.securitySuggestion, /LC|advance/i);
});

// ── verdict & nextSteps ──────────────────────────────────

test('checkBuyer verdict carries headline and band', () => {
  const result = checkBuyer({ companyName: 'IKEA', country: 'NL' });
  assert.ok(result.verdict.headline);
  assert.ok(result.verdict.creditBand);
  assert.ok(result.verdict.recommendation);
});

test('checkBuyer nextSteps is a non-empty array', () => {
  const result = checkBuyer({ companyName: 'MediaMarkt', country: 'DE' });
  assert.ok(Array.isArray(result.nextSteps));
  assert.ok(result.nextSteps.length >= 3);
});

test('checkBuyer nextSteps for unknown buyer includes credit-pull suggestion', () => {
  const result = checkBuyer({ companyName: 'Acme XYZ Sp.', country: 'PL' });
  const joined = result.nextSteps.join(' ').toLowerCase();
  assert.match(joined, /creditreform|d&b|atradius/);
});

test('checkBuyer disclaimer is non-empty', () => {
  const result = checkBuyer({ companyName: 'Acme', country: 'DE' });
  assert.ok(result.disclaimer);
  assert.match(result.disclaimer, /pre-check|indicative/i);
});

// ── error path ────────────────────────────────────────────

test('checkBuyer returns errors for invalid input', () => {
  const result = checkBuyer({});
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.errors));
  assert.ok(result.errors.length > 0);
});

// ── helpers ──────────────────────────────────────────────

test('listSampleBuyers returns one entry per known buyer with name/country/band', () => {
  const list = listSampleBuyers();
  assert.equal(list.length, Object.keys(KNOWN_BUYERS).length);
  for (const item of list) {
    assert.ok(item.name);
    assert.ok(item.country);
    assert.ok(item.creditBand);
  }
});
