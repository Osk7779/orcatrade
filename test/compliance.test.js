const test = require('node:test');
const assert = require('node:assert/strict');

const {
  determineRegulationApplicability,
  enforceComplianceLogic,
} = require('../lib/intelligence/compliance');

test('applicability pre-check keeps irrelevant regulations out of scope', () => {
  const applicability = determineRegulationApplicability({
    productCategory: 'Electronics',
    productDescription: 'Control boards for small appliances',
    importValue: 'Under €50K',
    companySize: 'Under 250 employees',
  });

  assert.equal(applicability.EUDR.applicable, false);
  assert.equal(applicability.CBAM.applicable, false);
  assert.equal(applicability.CSDDD.applicable, false);
});

test('compliance enforcer overrides bad applicability and recalculates status and score', () => {
  const report = enforceComplianceLogic({
    checkedRegulations: [
      {
        regulation: 'EUDR',
        applicable: true,
        status: 'compliant',
        findings: [{ finding: 'Missing geolocation data', severity: 'critical', article: 'Article 9', legalImplication: 'Import blocked' }],
        requiredActions: [{ step: 1, action: 'Collect polygon data' }],
        financialRisk: { minimumFineEur: 10000, maximumFineEur: 50000 },
      },
      {
        regulation: 'CBAM',
        applicable: true,
        status: 'compliant',
        findings: [],
        requiredActions: [],
        financialRisk: { minimumFineEur: 5000, maximumFineEur: 15000 },
      },
      {
        regulation: 'CSDDD',
        applicable: true,
        status: 'compliant',
        findings: [],
        requiredActions: [],
        financialRisk: { minimumFineEur: 0, maximumFineEur: 0 },
      },
    ],
  }, {
    productCategory: 'Furniture & Wood',
    productDescription: 'Wooden shelving unit',
    importValue: 'Over €5M',
    companySize: 'Over 1000 employees',
  });

  assert.equal(report.checkedRegulations[0].status, 'non_compliant');
  assert.equal(report.checkedRegulations[1].status, 'not_applicable');
  assert.equal(report.checkedRegulations[2].status, 'compliant');
  assert.equal(report.overallStatus, 'non_compliant');
  assert.equal(report.overallScore, 65);
  assert.equal(report.totalFinancialExposure.minimumEur, 10000);
});
