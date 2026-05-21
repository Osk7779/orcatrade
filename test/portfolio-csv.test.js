// Sprint portfolio-csv-v1 — portfolio CSV export (serialiser + endpoint + UI).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.ORCATRADE_DISABLE_LIVE_TARIC = '1';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const csv = require('../lib/portfolio-csv');
const portfolioHandler = require('../lib/handlers/portfolio');

function mockRes() {
  const res = {
    statusCode: 200, headers: {}, body: '', _json: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this._json = obj; this.body = JSON.stringify(obj); return this; },
    end(body) { this.body = body || ''; return this; },
  };
  return res;
}

// ── escapeCsvField (RFC 4180) ───────────────────────────

test('escapeCsvField: null/empty → empty, plain passes through', () => {
  assert.equal(csv.escapeCsvField(null), '');
  assert.equal(csv.escapeCsvField(undefined), '');
  assert.equal(csv.escapeCsvField(''), '');
  assert.equal(csv.escapeCsvField('apparel'), 'apparel');
});

test('escapeCsvField: quotes a field with comma / quote / newline', () => {
  assert.equal(csv.escapeCsvField('a,b'), '"a,b"');
  assert.equal(csv.escapeCsvField('say "hi"'), '"say ""hi"""');
  assert.equal(csv.escapeCsvField('line1\nline2'), '"line1\nline2"');
});

// ── portfolioToCsv ──────────────────────────────────────

const aggregate = {
  lineCount: 2,
  blendedDutyRatePct: 7.5,
  consolidationSavingEur: 45,
  totals: { customsValueEur: 80000, dutyEur: 6000, vatEur: 18000, brokerageEur: 110, transportEur: 1300, perShipmentLandedTotal: 105410 },
};
const lines = [
  { inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', hsCode: '610910', customsValueEur: 50000 }, totals: { dutyEur: 6000, vatEur: 13000, brokerageEur: 53, transportEur: 800, perShipmentLandedTotal: 69853 }, duty: { ratePercent: 12 } },
  { inputs: { productCategory: 'electronics', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 30000 }, totals: { dutyEur: 0, vatEur: 5000, brokerageEur: 57, transportEur: 500, perShipmentLandedTotal: 35557 }, duty: { ratePercent: 0 } },
];

test('portfolioToCsv: header + one row per SKU + TOTAL + summary rows', () => {
  const out = csv.portfolioToCsv(aggregate, lines);
  const rows = out.split('\r\n');
  assert.equal(rows[0], csv.COLUMNS.join(','));
  assert.match(rows[1], /^apparel,CN,PL,610910,50000,6000,12,/);
  assert.match(rows[2], /^electronics,CN,PL,,30000,0,0,/);
  // TOTAL row carries the blended rate in the duty_pct column.
  const total = rows.find((r) => r.startsWith('TOTAL'));
  assert.ok(total);
  assert.match(total, /TOTAL,,,,80000,6000,7.5,/);
  assert.ok(out.includes('blended_duty_rate_pct,7.5'));
  assert.ok(out.includes('consolidation_saving_eur,45'));
  assert.ok(out.includes('sku_count,2'));
});

test('portfolioToCsv: escapes a comma-bearing category', () => {
  const out = csv.portfolioToCsv(aggregate, [
    { inputs: { productCategory: 'apparel, knitted', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 1 }, totals: { perShipmentLandedTotal: 1 }, duty: {} },
  ]);
  assert.match(out, /"apparel, knitted"/);
});

test('csvFilename is ISO-dated with .csv extension', () => {
  assert.match(csv.csvFilename(new Date('2026-05-21T10:00:00Z')), /^orcatrade-portfolio-2026-05-21\.csv$/);
});

// ── Endpoint ────────────────────────────────────────────

const realLines = [
  { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 50000, weightKg: 2000 },
  { productCategory: 'electronics', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 30000, weightKg: 800 },
];

test('POST /api/portfolio/csv: 200 text/csv with attachment disposition', async () => {
  const res = mockRes();
  await portfolioHandler({ method: 'POST', headers: { 'x-forwarded-for': '1.1.1.1' }, query: { path: 'portfolio/csv' }, body: { lines: realLines } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.headers['content-disposition'], /attachment; filename="orcatrade-portfolio-.*\.csv"/);
  // Body starts with the header row + has a TOTAL row.
  assert.match(res.body, /^product_category,origin,destination/);
  assert.ok(res.body.includes('\r\nTOTAL,'));
});

test('POST /api/portfolio/csv: 400 when lines missing/empty', async () => {
  const r1 = mockRes();
  await portfolioHandler({ method: 'POST', headers: { 'x-forwarded-for': '2.2.2.2' }, query: { path: 'portfolio/csv' }, body: {} }, r1);
  assert.equal(r1.statusCode, 400);
});

test('POST /api/portfolio/csv: 405 on non-POST', async () => {
  const res = mockRes();
  await portfolioHandler({ method: 'GET', headers: {}, query: { path: 'portfolio/csv' } }, res);
  assert.equal(res.statusCode, 405);
});

// ── UI contract ─────────────────────────────────────────

test('/portfolio/ result has a Download CSV button wired to /api/portfolio/csv', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'portfolio', 'app.js'), 'utf8');
  assert.match(js, /pfCsvBtn/);
  assert.match(js, /\/api\/portfolio\/csv/);
  assert.match(js, /function downloadCsv/);
  assert.match(js, /URL\.createObjectURL/);
});
