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
    asOfDate: '2026-04-08',
  });

  assert.equal(applicability.EUDR.applicable, false);
  assert.equal(applicability.CBAM.applicable, false);
  assert.equal(applicability.CSDDD.applicable, false);
  assert.equal(applicability.EUDR.applicabilityStatus, 'not_applicable');
  assert.equal(applicability.CSDDD.applicabilityStatus, 'not_applicable');
});

test('compliance enforcer overrides bad applicability and recalculates status and score', () => {
  const report = enforceComplianceLogic({
    checkedRegulations: [
      {
        regulation: 'CBAM',
        applicable: true,
        status: 'compliant',
        findings: [{ finding: 'Missing emissions methodology data', severity: 'critical', article: 'Annex I', legalImplication: 'Import blocked' }],
        requiredActions: [{ step: 1, action: 'Collect verified emissions data' }],
        financialRisk: { minimumFineEur: 10000, maximumFineEur: 50000 },
      },
      {
        regulation: 'EUDR',
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
    productCategory: 'Steel & Metal',
    productDescription: 'Steel fasteners for industrial assemblies',
    importValue: 'Over €5M',
    companySize: 'Under 250 employees',
    asOfDate: '2026-04-08',
  });

  const cbam = report.checkedRegulations.find(item => item.regulation === 'CBAM');
  const eudr = report.checkedRegulations.find(item => item.regulation === 'EUDR');
  const csddd = report.checkedRegulations.find(item => item.regulation === 'CSDDD');

  assert.equal(cbam.status, 'non_compliant');
  assert.equal(eudr.status, 'not_applicable');
  assert.equal(csddd.status, 'not_applicable');
  assert.equal(report.overallStatus, 'non_compliant');
  assert.equal(report.overallScore, 65);
  assert.equal(report.totalFinancialExposure.minimumEur, 10000);
});

test('eudr goods are treated as future scope before the application date', () => {
  const applicability = determineRegulationApplicability({
    productCategory: 'Furniture & Wood',
    productDescription: 'Wooden shelving unit',
    companySize: '250–1000 employees',
    asOfDate: '2026-04-08',
  });

  assert.equal(applicability.EUDR.applicabilityStatus, 'future_scope');
  assert.equal(applicability.EUDR.applicable, false);
  assert.equal(applicability.EUDR.futureApplicabilityDate, '2026-12-30');
});

test('missing CSDDD threshold facts force manual review instead of false clearance', () => {
  const report = enforceComplianceLogic({
    checkedRegulations: [
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
    productCategory: 'Electronics',
    productDescription: 'Industrial control board',
    companySize: 'Over 1000 employees',
    asOfDate: '2026-04-08',
  });

  const csddd = report.checkedRegulations.find(item => item.regulation === 'CSDDD');
  assert.equal(csddd.applicabilityStatus, 'insufficient_data');
  assert.equal(csddd.status, 'at_risk');
  assert.ok(csddd.missingFacts.includes('global turnover'));
  assert.equal(report.requiresManualReview, true);
  assert.equal(report.blockedByMissingData[0].regulation, 'CSDDD');
});
