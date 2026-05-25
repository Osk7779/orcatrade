// Sprint document-intel-v1 / roo-v1 — the new compliance-agent tools
// (determineRulesOfOrigin, auditDocument, draftDocument) + the /api/documents
// audit action.

const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const agent = require('../lib/handlers/agent');

// ── Tools registered + wired ────────────────────────────

test('the three new tools are registered with impls', () => {
  for (const name of ['determineRulesOfOrigin', 'auditDocument', 'draftDocument']) {
    assert.ok(agent.TOOLS.find((t) => t.name === name), `${name} schema present`);
    assert.equal(typeof agent.toolImpls[name], 'function', `${name} impl present`);
  }
});

test('determineRulesOfOrigin tool: rule lookup vs qualification', () => {
  const rule = agent.toolImpls.determineRulesOfOrigin({ hsCode: '610910', regimeCode: 'EVFTA' });
  assert.equal(rule.primaryRule, 'specific_process');
  const verdict = agent.toolImpls.determineRulesOfOrigin({ hsCode: '8703231900', exFactoryPriceEur: 10000, nonOriginatingValueEur: 4000 });
  assert.equal(verdict.verdict, 'likely_qualifies');
});

test('auditDocument tool runs the auditor', () => {
  const r = agent.toolImpls.auditDocument({
    documentType: 'commercial_invoice',
    fields: { exporter: { companyName: 'X' }, consignee: { companyName: 'Y' }, currency: 'EUR', incoterm: 'FOB', countryOfOrigin: 'CN', hsCode: '871200', invoiceTotal: 40000, lineItems: [{ description: 'g', quantity: 1000, unitPrice: 40 }] },
    plan: { originCountry: 'CN', hsCode: '871200', customsValueEur: 120000 },
  });
  assert.equal(r.ok, true);
  assert.ok(r.findings.some((f) => f.code === 'undervaluation_risk'));
});

test('draftDocument tool produces an approval-gated DRAFT', () => {
  const r = agent.toolImpls.draftDocument({
    documentType: 'commercial_invoice',
    plan: { productCategory: 'bicycles', originCountry: 'CN', destinationCountry: 'DE', customsValueEur: 120000, hsCode: '871200' },
  });
  assert.equal(r.ok, true);
  assert.equal(r.needsHumanApproval, true);
  assert.match(r.approvalNotice, /DRAFT|review|approv/i);
  assert.equal(r.data._draft, true);
});

// ── /api/documents audit action ─────────────────────────

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(obj) { this.body = JSON.stringify(obj); return this; },
    send(s) { this.body = s; return this; },
    end(s) { if (s) this.body = s; return this; },
  };
}

test('POST /api/documents { action:"audit" } returns audit findings', async () => {
  const handler = require('../lib/handlers/documents');
  const req = {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.9' },
    body: {
      action: 'audit',
      documentType: 'commercial_invoice',
      fields: { exporter: { companyName: '' }, consignee: { companyName: '' }, countryOfOrigin: 'CN', hsCode: '871200', invoiceTotal: 100, lineItems: [{ description: 'g', quantity: 1, unitPrice: 100 }] },
      plan: { originCountry: 'CN', hsCode: '871200', customsValueEur: 120000 },
    },
  };
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.documentType, 'commercial_invoice');
  assert.ok(Array.isArray(payload.findings));
  assert.ok(payload.findings.some((f) => f.code === 'undervaluation_risk'));
});

test('audit action rejects an unsupported document type with 400', async () => {
  const handler = require('../lib/handlers/documents');
  const res = mockRes();
  await handler({ method: 'POST', headers: {}, body: { action: 'audit', documentType: 'nope', fields: {} } }, res);
  assert.equal(res.statusCode, 400);
});
