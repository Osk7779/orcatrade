const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TYPES,
  validateInput,
  generateDocument,
  listDocumentTypes,
  draftFromPlan,
  formatNumber,
  formatCurrency,
  escapeHtml,
} = require('../lib/intelligence/document-generator');

// ── draftFromPlan (pre-fill from an Import Plan) ─────────

const SAMPLE_PLAN = {
  productCategory: 'apparel',
  originCountry: 'cn',
  destinationCountry: 'de',
  customsValueEur: 50000,
  hsCode: '610910',
  weightKg: 800,
  moq: 1000,
};

test('draftFromPlan: every type produces data that passes generateDocument', () => {
  for (const type of ['commercial_invoice', 'packing_list', 'proforma_invoice', 'certificate_of_origin']) {
    const draft = draftFromPlan(type, SAMPLE_PLAN, { today: '2026-05-22' });
    assert.equal(draft.ok, true, `draft ${type} ok`);
    const out = generateDocument(type, draft.data);
    assert.equal(out.ok, true, `${type} renders: ${JSON.stringify(out.errors)}`);
    assert.ok(out.html);
  }
});

test('draftFromPlan: maps the plan fields (value→unit price, origin, HS code)', () => {
  const draft = draftFromPlan('commercial_invoice', SAMPLE_PLAN, { today: '2026-05-22' });
  assert.equal(draft.data.currency, 'EUR');
  assert.equal(draft.data.countryOfOrigin, 'CN'); // upper-cased
  assert.equal(draft.data.countryOfDestination, 'DE');
  const li = draft.data.lineItems[0];
  assert.equal(li.hsCode, '610910');
  assert.equal(li.quantity, 1000);
  assert.equal(li.unitPrice, 50); // 50000 / 1000
});

test('draftFromPlan: parties are obvious placeholders (never a finished doc)', () => {
  const draft = draftFromPlan('commercial_invoice', SAMPLE_PLAN);
  assert.match(draft.data.exporter.companyName, /complete before use/);
  assert.match(draft.data.consignee.companyName, /complete before use/);
  assert.equal(draft.data._draft, true);
});

test('draftFromPlan: unknown type → ok:false', () => {
  assert.equal(draftFromPlan('bogus', SAMPLE_PLAN).ok, false);
});

test('draftFromPlan: a sparse plan still yields a valid (placeholder-heavy) draft', () => {
  const draft = draftFromPlan('commercial_invoice', { productCategory: 'toys' });
  assert.equal(draft.ok, true);
  assert.equal(generateDocument('commercial_invoice', draft.data).ok, true);
  assert.equal(draft.data.lineItems[0].quantity, 1); // defaults
});

// ── TYPES registry ───────────────────────────────────────

test('TYPES exposes all four planned document types with required fields', () => {
  for (const id of ['commercial_invoice', 'packing_list', 'proforma_invoice', 'certificate_of_origin']) {
    assert.ok(TYPES[id], `missing type ${id}`);
    assert.ok(TYPES[id].label);
    assert.ok(Array.isArray(TYPES[id].requiredFields));
    assert.ok(Array.isArray(TYPES[id].requiredLineItemFields));
  }
});

test('listDocumentTypes returns id + label + description for every type', () => {
  const list = listDocumentTypes();
  assert.equal(list.length, Object.keys(TYPES).length);
  for (const item of list) {
    assert.ok(item.id);
    assert.ok(item.label);
    assert.ok(item.description);
  }
});

// ── validateInput ────────────────────────────────────────

test('validateInput rejects unknown type', () => {
  const result = validateInput('unknown_type', {});
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown/);
});

test('validateInput rejects empty commercial invoice', () => {
  const result = validateInput('commercial_invoice', {});
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
  assert.ok(result.errors.some(e => e.includes('exporter')));
  assert.ok(result.errors.some(e => e.includes('At least one line item')));
});

test('validateInput rejects line items missing required fields', () => {
  const result = validateInput('commercial_invoice', {
    exporter: 'X',
    consignee: 'Y',
    invoiceNumber: 'INV-001',
    invoiceDate: '2026-05-07',
    incoterm: 'FOB',
    currency: 'EUR',
    lineItems: [{ description: 'Widget' }], // missing quantity, unit, unitPrice
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('quantity')));
  assert.ok(result.errors.some(e => e.includes('unitPrice')));
});

test('validateInput accepts a complete commercial invoice', () => {
  const result = validateInput('commercial_invoice', {
    exporter: { companyName: 'X' },
    consignee: { companyName: 'Y' },
    invoiceNumber: 'INV-001',
    invoiceDate: '2026-05-07',
    incoterm: 'FOB',
    currency: 'EUR',
    lineItems: [{ description: 'Widget', quantity: 100, unit: 'pcs', unitPrice: 10 }],
  });
  assert.equal(result.ok, true);
});

test('validateInput for certificate of origin requires HS code per line', () => {
  const result = validateInput('certificate_of_origin', {
    exporter: { companyName: 'X' },
    consignee: { companyName: 'Y' },
    countryOfOrigin: 'China',
    invoiceNumber: 'INV-001',
    lineItems: [{ description: 'Widget', quantity: 100 }], // missing hsCode
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('hsCode')));
});

// ── generateDocument — Commercial Invoice ────────────────

test('generateDocument renders a commercial invoice with proper totals', () => {
  const result = generateDocument('commercial_invoice', {
    exporter: { companyName: 'Shenzhen Audio' },
    consignee: { companyName: 'AudioCraft GmbH' },
    invoiceNumber: 'INV-2026-042',
    invoiceDate: '2026-05-07',
    incoterm: 'FOB',
    currency: 'EUR',
    lineItems: [
      { description: 'Smart speaker', quantity: 500, unit: 'pcs', unitPrice: 32.50 },
      { description: 'Adaptor', quantity: 500, unit: 'pcs', unitPrice: 4.20 },
    ],
    freightCost: 1000,
    insuranceCost: 100,
  });
  assert.equal(result.ok, true);
  assert.match(result.html, /Commercial Invoice/);
  // Subtotal should be 500*32.50 + 500*4.20 = 16,250 + 2,100 = 18,350
  // Total with freight + insurance: 19,450
  assert.match(result.html, /€18,350\.00/);
  assert.match(result.html, /€19,450\.00/);
  assert.match(result.html, /Shenzhen Audio/);
  assert.match(result.html, /AudioCraft GmbH/);
});

test('generateDocument renders a proforma invoice with the same line schema', () => {
  const result = generateDocument('proforma_invoice', {
    exporter: { companyName: 'X' },
    consignee: { companyName: 'Y' },
    invoiceNumber: 'PRO-001',
    invoiceDate: '2026-05-07',
    currency: 'EUR',
    validUntil: '2026-06-07',
    lineItems: [{ description: 'Widget', quantity: 10, unit: 'pcs', unitPrice: 100 }],
  });
  assert.equal(result.ok, true);
  assert.match(result.html, /Proforma Invoice/);
  assert.match(result.html, /€1,000\.00/);
});

test('generateDocument renders a packing list with weight totals', () => {
  const result = generateDocument('packing_list', {
    exporter: { companyName: 'X' },
    consignee: { companyName: 'Y' },
    invoiceNumber: 'INV-001',
    shipmentDate: '2026-05-07',
    lineItems: [
      { description: 'Box A', quantity: 10, grossWeightKg: 100, netWeightKg: 90, cartons: 5 },
      { description: 'Box B', quantity: 20, grossWeightKg: 200, netWeightKg: 180, cartons: 10 },
    ],
  });
  assert.equal(result.ok, true);
  assert.match(result.html, /Packing List/);
  assert.match(result.html, /15/); // total cartons
  assert.match(result.html, /300\.00 kg/); // total gross
});

test('generateDocument renders a certificate of origin with declaration', () => {
  const result = generateDocument('certificate_of_origin', {
    exporter: { companyName: 'X' },
    consignee: { companyName: 'Y' },
    countryOfOrigin: 'Vietnam',
    invoiceNumber: 'INV-001',
    lineItems: [{ description: 'Plywood', quantity: 100, hsCode: '4412 10' }],
  });
  assert.equal(result.ok, true);
  assert.match(result.html, /Certificate of Origin/);
  assert.match(result.html, /Vietnam/);
  assert.match(result.html, /4412 10/);
});

// ── helpers ──────────────────────────────────────────────

test('escapeHtml escapes special characters', () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(escapeHtml("O'Brien & Co."), 'O&#39;Brien &amp; Co.');
});

test('formatCurrency uses ISO code and 2 decimals', () => {
  const eur = formatCurrency(1234.5, 'EUR');
  assert.match(eur, /1,234\.50/);
  // Currency formatter returns a string for any 3-letter ISO code (incl. XXX = "no currency")
  const xxx = formatCurrency(99, 'XXX');
  assert.equal(typeof xxx, 'string');
  assert.match(xxx, /99\.00/);
});

test('formatNumber preserves decimals when value is finite', () => {
  assert.equal(formatNumber(1234.567), '1,234.57');
  assert.equal(formatNumber('not a number'), '—');
});

// ── HTML safety in renderer ──────────────────────────────

test('renderer escapes HTML in user-supplied fields', () => {
  const result = generateDocument('commercial_invoice', {
    exporter: { companyName: '<script>alert(1)</script>' },
    consignee: { companyName: 'Buyer' },
    invoiceNumber: 'INV-001',
    invoiceDate: '2026-05-07',
    incoterm: 'FOB',
    currency: 'EUR',
    lineItems: [{ description: 'Widget', quantity: 1, unit: 'pcs', unitPrice: 1 }],
  });
  assert.equal(result.ok, true);
  // Raw <script> must NOT appear
  assert.equal(result.html.includes('<script>alert(1)</script>'), false);
  // Escaped form must appear
  assert.match(result.html, /&lt;script&gt;/);
});

// ── CBAM report + EUDR DDS generators (II3) ─────────────

test('generateDocument: cbam_report renders a CBAM quarterly report draft', () => {
  const draft = draftFromPlan('cbam_report', { productCategory: 'Steel screws', originCountry: 'CN', hsCode: '7318', customsValueEur: 50000 });
  assert.equal(draft.ok, true);
  const out = generateDocument('cbam_report', draft.data);
  assert.equal(out.ok, true, JSON.stringify(out.errors));
  assert.match(out.html, /CBAM Quarterly Report/);
  assert.match(out.html, /Reporting period/);
  assert.match(out.html, /supplier data required/); // emissions placeholder flagged
});

test('generateDocument: eudr_dds renders a Due Diligence Statement draft', () => {
  const draft = draftFromPlan('eudr_dds', { productCategory: 'Coffee', originCountry: 'VN', hsCode: '0901', customsValueEur: 30000 });
  assert.equal(draft.ok, true);
  const out = generateDocument('eudr_dds', draft.data);
  assert.equal(out.ok, true, JSON.stringify(out.errors));
  assert.match(out.html, /Due Diligence Statement/);
  assert.match(out.html, /geolocation of plots required/); // geolocation placeholder flagged
  assert.match(out.html, /2023\/1115/);
});
