const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDeterministicFallbackReport,
  determineRegulationApplicability,
  enforceComplianceLogic,
  normaliseComplianceInput,
} = require('../lib/intelligence/compliance');
const { validateCompliancePayload } = require('../lib/intelligence/compliance-validator');

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

test('active EUDR flow becomes non-compliant when geolocation evidence is explicitly missing', () => {
  const report = enforceComplianceLogic({
    checkedRegulations: [
      {
        regulation: 'EUDR',
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
    companySize: '250–1000 employees',
    origin: 'Brazil',
    globalTurnover: '€10m',
    asOfDate: '2027-01-15',
    geolocationAvailable: false,
    dueDiligenceStatement: true,
  });

  const eudr = report.checkedRegulations.find(item => item.regulation === 'EUDR');
  assert.equal(eudr.applicabilityStatus, 'applicable');
  assert.equal(eudr.status, 'non_compliant');
  assert.match(eudr.currentGap, /geolocation evidence/i);
  assert.ok(eudr.findings.some(item => /Article 9/.test(item.article)));
  assert.equal(report.decisionReadiness.level, 'provisional');
  assert.equal(report.decisionReadiness.finalDecisionEligible, true);
});

test('active CBAM flow stays at risk when critical evidence inputs are still missing', () => {
  const report = enforceComplianceLogic({
    checkedRegulations: [
      {
        regulation: 'CBAM',
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
    companySize: '250–1000 employees',
    origin: 'China',
    globalTurnover: '€10m',
    asOfDate: '2026-04-08',
  });

  const cbam = report.checkedRegulations.find(item => item.regulation === 'CBAM');
  assert.equal(cbam.applicabilityStatus, 'applicable');
  assert.equal(cbam.status, 'at_risk');
  assert.ok(cbam.missingFacts.includes('CN / HS classification'));
  assert.ok(cbam.requiredActions.some(item => /missing CBAM inputs/i.test(item.action)));
  assert.equal(report.decisionReadiness.level, 'provisional');
  assert.equal(report.decisionReadiness.finalDecisionEligible, true);
});

test('compliance input normaliser preserves alias fields and boolean strings', () => {
  const normalized = normaliseComplianceInput({
    productCategory: 'Steel & Metal',
    productDescription: 'Steel coils',
    hsCode: '7208.37',
    euMarket: 'false',
    authorizedDeclarant: 'yes',
    emissionsDataAvailable: 'no',
    dueDiligenceReady: 'true',
    polygonDataAvailable: 'false',
    companyTurnover: '€900m',
  });

  assert.equal(normalized.cnCode, '7208.37');
  assert.equal(normalized.hsCode, '7208.37');
  assert.equal(normalized.euMarket, false);
  assert.equal(normalized.authorisedDeclarant, true);
  assert.equal(normalized.supplierEmissionsData, false);
  assert.equal(normalized.dueDiligenceStatement, true);
  assert.equal(normalized.geolocationAvailable, false);
  assert.equal(normalized.globalTurnover, '€900m');
});

test('validator rejects incomplete report payloads and accepts quick checks', () => {
  const reportValidation = validateCompliancePayload({
    productCategory: 'Steel & Metal',
    origin: 'China',
  }, { mode: 'report' });

  const quickCheckValidation = validateCompliancePayload({
    productCategory: 'Steel & Metal',
    origin: 'China',
  }, { mode: 'quick-check' });

  assert.equal(reportValidation.ok, false);
  assert.ok(reportValidation.errors.some(item => /product description/i.test(item)));
  assert.equal(quickCheckValidation.ok, true);
});

test('deterministic fallback report returns a structured rules-based report', () => {
  const report = buildDeterministicFallbackReport({
    productCategory: 'Steel & Metal',
    productDescription: 'Steel fasteners for industrial assemblies',
    companySize: '250–1000 employees',
    origin: 'China',
    globalTurnover: '€10m',
    asOfDate: '2026-04-08',
  }, {
    reportId: 'OT-COMP-TEST-FALLBACK',
    timestamp: '2026-04-09T10:00:00.000Z',
    reason: 'Synthetic test fallback',
  });

  assert.equal(report.reportId, 'OT-COMP-TEST-FALLBACK');
  assert.equal(report.reportGeneration.mode, 'deterministic_fallback');
  assert.match(report.reportGeneration.reason, /Synthetic test fallback/);
  assert.equal(report.checkedRegulations.length, 3);
  assert.equal(report.decisionReadiness.level, 'provisional');
  assert.ok(report.disclaimer.includes('OT-COMP-TEST-FALLBACK'));
});
