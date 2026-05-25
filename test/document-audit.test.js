// Sprint document-intel-v1 (Pillar I4) — deterministic document auditor.

const test = require('node:test');
const assert = require('node:assert/strict');

const { auditDocument } = require('../lib/intelligence/document-audit');

const PLAN = {
  productCategory: 'bicycles',
  hsCode: '871200',
  originCountry: 'CN',
  destinationCountry: 'DE',
  customsValueEur: 120000,
  weightKg: 8000,
  quoteCurrency: 'EUR',
  claimPreferential: false,
};

function codes(result) {
  return result.findings.map((f) => f.code);
}

test('a clean invoice matching the plan → consistent', () => {
  const r = auditDocument({
    documentType: 'commercial_invoice',
    fields: {
      exporter: { companyName: 'Tianjin Bikes Co' },
      consignee: { companyName: 'Berlin Imports GmbH' },
      currency: 'EUR', incoterm: 'FOB', countryOfOrigin: 'CN', countryOfDestination: 'DE',
      invoiceTotal: 120000,
      lineItems: [{ description: 'Bicycles', quantity: 1000, unitPrice: 120, hsCode: '871200', countryOfOrigin: 'CN' }],
    },
    plan: PLAN,
  });
  assert.equal(r.ok, true);
  assert.equal(r.verdict, 'consistent');
  assert.equal(r.counts.critical, 0);
  assert.equal(r.counts.high, 0);
});

test('HS + origin mismatch are flagged high', () => {
  const r = auditDocument({
    documentType: 'commercial_invoice',
    fields: {
      exporter: { companyName: 'X' }, consignee: { companyName: 'Y' },
      currency: 'EUR', incoterm: 'FOB',
      countryOfOrigin: 'VN', // plan says CN
      hsCode: '950300',       // plan says 871200
      invoiceTotal: 120000,
      lineItems: [{ description: 'g', quantity: 1, unitPrice: 120000 }],
    },
    plan: PLAN,
  });
  assert.ok(codes(r).includes('hs_mismatch'));
  assert.ok(codes(r).includes('origin_mismatch'));
  assert.equal(r.verdict, 'review_needed');
});

test('undervaluation (declared << planned) is critical → blocking', () => {
  const r = auditDocument({
    documentType: 'commercial_invoice',
    fields: {
      exporter: { companyName: 'X' }, consignee: { companyName: 'Y' },
      currency: 'EUR', incoterm: 'FOB', countryOfOrigin: 'CN', hsCode: '871200',
      invoiceTotal: 40000, // vs €120k plan
      lineItems: [{ description: 'g', quantity: 1000, unitPrice: 40 }],
    },
    plan: PLAN,
  });
  assert.ok(codes(r).includes('undervaluation_risk'));
  assert.equal(r.counts.critical >= 1, true);
  assert.equal(r.verdict, 'blocking_issues');
});

test('line-item arithmetic that does not sum to the stated total is flagged', () => {
  const r = auditDocument({
    documentType: 'commercial_invoice',
    fields: {
      exporter: { companyName: 'X' }, consignee: { companyName: 'Y' },
      currency: 'EUR', incoterm: 'FOB', countryOfOrigin: 'CN', hsCode: '871200',
      invoiceTotal: 120000,
      lineItems: [{ description: 'g', quantity: 1000, unitPrice: 100 }], // sums to 100k, not 120k
    },
    plan: PLAN,
  });
  assert.ok(codes(r).includes('total_arithmetic'));
});

test('preferential claim without an origin statement is flagged high', () => {
  const r = auditDocument({
    documentType: 'commercial_invoice',
    fields: {
      exporter: { companyName: 'X' }, consignee: { companyName: 'Y' },
      currency: 'EUR', incoterm: 'FOB', countryOfOrigin: 'VN', hsCode: '610910',
      invoiceTotal: 50000,
      lineItems: [{ description: 'shirts', quantity: 5000, unitPrice: 10 }],
    },
    plan: { ...PLAN, originCountry: 'VN', hsCode: '610910', customsValueEur: 50000, claimPreferential: true },
  });
  assert.ok(codes(r).includes('missing_preference_evidence'));
});

test('missing currency + placeholder parties are caught even without a plan', () => {
  const r = auditDocument({
    documentType: 'commercial_invoice',
    fields: {
      exporter: { companyName: '[Exporter / Seller — complete before use]' },
      consignee: { companyName: '' },
      lineItems: [{ description: 'g', quantity: 1, unitPrice: 10 }],
    },
  });
  assert.equal(r.checkedAgainstPlan, false);
  assert.ok(codes(r).includes('missing_currency'));
  assert.ok(codes(r).includes('missing_exporter'));
  assert.ok(codes(r).includes('missing_consignee'));
});

test('packing list: net > gross is impossible → high', () => {
  const r = auditDocument({
    documentType: 'packing_list',
    fields: { totalGrossWeightKg: 100, totalNetWeightKg: 120, totalCartons: 10 },
    plan: PLAN,
  });
  assert.ok(codes(r).includes('weight_inconsistent'));
});

test('certificate of origin: preferential claim needs a reference', () => {
  const r = auditDocument({
    documentType: 'certificate_of_origin',
    fields: { countryOfOrigin: 'VN' },
    plan: { ...PLAN, originCountry: 'VN', claimPreferential: true },
  });
  assert.ok(codes(r).includes('missing_reference'));
});

test('CBAM goods surface a documentation flag', () => {
  const r = auditDocument({
    documentType: 'commercial_invoice',
    fields: { exporter: { companyName: 'X' }, consignee: { companyName: 'Y' }, currency: 'EUR', incoterm: 'FOB', countryOfOrigin: 'CN', hsCode: '720851', invoiceTotal: 200000, lineItems: [{ description: 'steel', quantity: 1, unitPrice: 200000 }] },
    plan: { ...PLAN, hsCode: '720851', productCategory: 'steel', customsValueEur: 200000 },
  });
  // CBAM applies to steel ex-CN; expect a cbam_docs flag among findings.
  assert.ok(codes(r).includes('cbam_docs'));
});

test('unsupported document type → not ok', () => {
  const r = auditDocument({ documentType: 'mystery', fields: {} });
  assert.equal(r.ok, false);
});

test('findings are severity-sorted (critical first)', () => {
  const r = auditDocument({
    documentType: 'commercial_invoice',
    fields: { exporter: { companyName: '' }, consignee: { companyName: '' }, countryOfOrigin: 'VN', hsCode: '950300', invoiceTotal: 10000, lineItems: [{ description: 'g', quantity: 1, unitPrice: 10000 }] },
    plan: PLAN,
  });
  const order = ['critical', 'high', 'medium', 'low', 'info'];
  const idxs = r.findings.map((f) => order.indexOf(f.severity));
  for (let i = 1; i < idxs.length; i++) assert.ok(idxs[i] >= idxs[i - 1], 'findings must be severity-sorted');
});
