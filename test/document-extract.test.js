// Sprint document-intel-v2 (Pillar I4+) — pasted-text field extraction.

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractFields, parseNumber, toIso2, detectCurrency } = require('../lib/intelligence/document-extract');

test('parseNumber handles EU and US separators', () => {
  assert.equal(parseNumber('1,234.56'), 1234.56);
  assert.equal(parseNumber('1.234,56'), 1234.56);
  assert.equal(parseNumber('120,000'), 120000);
  assert.equal(parseNumber('€40,000'), 40000);
  assert.equal(parseNumber('40'), 40);
});

test('toIso2 maps names + passes through ISO codes', () => {
  assert.equal(toIso2('China'), 'CN');
  assert.equal(toIso2('VN'), 'VN');
  assert.equal(toIso2('Viet Nam'), 'VN');
  assert.equal(toIso2(''), '');
});

test('detectCurrency reads symbols and codes', () => {
  assert.equal(detectCurrency('Total: €40,000'), 'EUR');
  assert.equal(detectCurrency('Amount: USD 5000'), 'USD');
  assert.equal(detectCurrency('RMB 120000'), 'CNY');
});

const INVOICE_TEXT = `
COMMERCIAL INVOICE
Exporter: Tianjin Bikes Co Ltd
Consignee: Berlin Imports GmbH
Country of origin: China
Country of destination: Germany
Incoterm: FOB Tianjin
HS code: 8712 00 30
Currency: EUR

1000 x Bicycles @ 40.00

Invoice total: €40,000.00
`;

test('extractFields pulls the core fields from a pasted invoice', () => {
  const r = extractFields(INVOICE_TEXT, 'commercial_invoice');
  assert.equal(r.ok, true);
  assert.equal(r.fields.currency, 'EUR');
  assert.equal(r.fields.incoterm, 'FOB');
  assert.equal(r.fields.hsCode, '87120030');
  assert.equal(r.fields.countryOfOrigin, 'CN');
  assert.equal(r.fields.countryOfDestination, 'DE');
  assert.equal(r.fields.invoiceTotal, 40000);
  assert.ok(r.fields.exporter.companyName.includes('Tianjin'));
  assert.ok(r.fields.lineItems.length >= 1);
  assert.equal(r.fields.lineItems[0].quantity, 1000);
  assert.equal(r.fields.lineItems[0].unitPrice, 40);
  assert.equal(r.confidence, 'high');
});

test('extractFields reports what it could not find', () => {
  const r = extractFields('Just some random text with no invoice fields.', 'commercial_invoice');
  assert.ok(r.missingFields.includes('hsCode'));
  assert.ok(r.missingFields.includes('invoiceTotal'));
  assert.equal(r.confidence, 'low');
});

test('extracted fields flow into a real undervaluation finding', () => {
  const { auditDocument } = require('../lib/intelligence/document-audit');
  const r = extractFields(INVOICE_TEXT, 'commercial_invoice');
  const audit = auditDocument({ documentType: 'commercial_invoice', fields: r.fields, plan: { originCountry: 'CN', hsCode: '871200', customsValueEur: 120000 } });
  assert.ok(audit.findings.some((f) => f.code === 'undervaluation_risk'));
});

test('packing-list weights extract', () => {
  const r = extractFields('PACKING LIST\nTotal gross weight: 8,500 kg\nTotal net weight: 8,000 kg\nTotal cartons: 250', 'packing_list');
  assert.equal(r.fields.totalGrossWeightKg, 8500);
  assert.equal(r.fields.totalNetWeightKg, 8000);
  assert.equal(r.fields.totalCartons, 250);
});

test('REX / origin statement detection', () => {
  const r = extractFields('Origin: VN\nStatement on origin: The exporter declares...\nREX number: VN1234567', 'certificate_of_origin');
  assert.equal(r.fields.rexNumber, 'VN1234567');
  assert.equal(r.fields.originStatement, 'present');
});
