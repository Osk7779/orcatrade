const test = require('node:test');
const assert = require('node:assert/strict');

const { validateCompliancePayload } = require('../lib/intelligence/compliance-validator');
const { extractEvidenceBundle } = require('../lib/intelligence/evidence-ingestion');

test('evidence ingestion extracts compliance facts from document text', () => {
  const bundle = extractEvidenceBundle([
    {
      name: 'CBAM supplier pack',
      type: 'text/plain',
      text: 'CN code: 7208.37. Authorised CBAM declarant status: yes. Supplier emissions data: available.',
    },
    {
      name: 'Due diligence note',
      type: 'text/plain',
      text: 'Country of origin: Brazil. Geolocation evidence: no. Due-diligence statement: submitted. Employee count: 3200. Global turnover: €900m.',
    },
  ], {
    company: 'Northline Imports',
    email: 'ops@northline.test',
  });

  assert.equal(bundle.documentCount, 2);
  assert.equal(bundle.extractedFacts.cnCode, '7208.37');
  assert.equal(bundle.extractedFacts.authorisedDeclarant, true);
  assert.equal(bundle.extractedFacts.supplierEmissionsData, true);
  assert.equal(bundle.extractedFacts.geolocationAvailable, false);
  assert.equal(bundle.extractedFacts.dueDiligenceStatement, true);
  assert.equal(bundle.extractedFacts.employeeCount, '3200');
  assert.equal(bundle.extractedFacts.globalTurnover, '€900m');
  assert.equal(bundle.extractedFacts.origin, 'Brazil');
  assert.match(bundle.bundleId, /^[a-f0-9]{64}$/);
  assert.match(bundle.evidenceSummary, /CN \/ HS code: 7208\.37/i);
});

test('compliance validator merges extracted evidence into the normalized order data', () => {
  const validation = validateCompliancePayload({
    productCategory: 'Steel & Metal',
    productDescription: 'Industrial steel fasteners',
    origin: 'China',
    importValue: 'Over €5M',
    companySize: '250–1000 employees',
    evidenceDocuments: [
      {
        name: 'Importer dossier',
        type: 'text/plain',
        text: 'HS code: 7318.15. Authorised CBAM declarant status: confirmed. Supplier emissions data: available.',
      },
    ],
  }, { mode: 'report' });

  assert.equal(validation.ok, true);
  assert.equal(validation.normalizedOrderData.cnCode, '7318.15');
  assert.equal(validation.normalizedOrderData.authorisedDeclarant, true);
  assert.equal(validation.normalizedOrderData.supplierEmissionsData, true);
  assert.equal(validation.normalizedOrderData.evidenceDocumentCount, 1);
  assert.equal(validation.evidenceBundle.documentCount, 1);
  assert.equal(validation.normalizedOrderData.evidenceBundleId, validation.evidenceBundle.bundleId);
});
