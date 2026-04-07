const test = require('node:test');
const assert = require('node:assert/strict');

const { isCategoryCompatible } = require('../lib/intelligence/catalog');
const {
  calculateRiskScore,
  sanitizeFactoryResults,
} = require('../lib/intelligence/factory-risk');

test('factory search sanitiser keeps results inside the requested country, category, and risk band', () => {
  const result = sanitizeFactoryResults(null, {
    query: 'pcb assembly',
    category: 'Electronics & Components',
    country: 'Vietnam',
    riskTolerance: 'Low risk only (Score 70+)',
  });

  assert.equal(result.factories.length, 6);

  result.factories.forEach(factory => {
    assert.equal(factory.country, 'Vietnam');
    assert.equal(calculateRiskScore(factory), factory.riskScore);
    assert.ok(factory.riskScore >= 70);
    assert.equal(isCategoryCompatible(factory.speciality, 'Electronics & Components'), true);
  });
});

test('factory search sanitiser repairs off-filter AI output', () => {
  const result = sanitizeFactoryResults({
    factories: [
      {
        id: 'broken',
        name: 'Wrong Country Factory',
        city: 'Shenzhen',
        country: 'China',
        speciality: 'steel forgings',
        financialScore: 20,
        complianceScore: 20,
        capacityScore: 20,
        auditScore: 20,
      },
    ],
  }, {
    query: 'wood furniture',
    category: 'Furniture & Wood',
    country: 'Malaysia',
    riskTolerance: 'Medium risk (Score 50-70)',
  });

  assert.equal(result.factories.length, 6);
  assert.equal(result.factories[0].country, 'Malaysia');
  assert.ok(result.factories[0].riskScore >= 50 && result.factories[0].riskScore <= 70);
  assert.equal(isCategoryCompatible(result.factories[0].speciality, 'Furniture & Wood'), true);
});
