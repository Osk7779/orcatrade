// Sprint leads-csv-export-v1 — tests.
//
// Covers:
//   - escapeCsvField: nulls, simple strings, fields with commas /
//     quotes / newlines (RFC 4180 escaping with doubled quotes)
//   - eventsToCsv: header row, projection columns, hashes raw email
//     to 12-hex emailHash (NEVER leaks the raw address), passes
//     through pre-hashed PG rows unchanged, deleted-pseudonym addresses
//     are NOT hashed (already-anonymised)
//   - csvFilename: ISO-stamped, .csv extension
//   - GET /api/leads?format=csv: response shape (Content-Type +
//     Content-Disposition + CSV body), 401/503 still gate the CSV
//     path, ?type filter narrows the export, no raw email in the
//     response body even when KV rows had one
//   - /dashboard/leads/ UI: Export CSV button present + JS wires
//     it to /api/leads?format=csv

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const leadsHandler = require('../lib/handlers/leads');
const kv = require('../lib/intelligence/kv-store');
const events = require('../lib/events');

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}

function withEnv(overrides, fn) {
  const prev = {};
  for (const k of Object.keys(overrides)) prev[k] = process.env[k];
  for (const k of Object.keys(overrides)) {
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  return Promise.resolve(fn()).finally(() => {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });
}

// ── escapeCsvField ──────────────────────────────────

test('escapeCsvField: null / undefined → empty string', () => {
  assert.equal(leadsHandler.escapeCsvField(null), '');
  assert.equal(leadsHandler.escapeCsvField(undefined), '');
});

test('escapeCsvField: simple strings pass through', () => {
  assert.equal(leadsHandler.escapeCsvField('apparel'), 'apparel');
  assert.equal(leadsHandler.escapeCsvField('CN'), 'CN');
  assert.equal(leadsHandler.escapeCsvField(12345), '12345');
});

test('escapeCsvField: fields with commas get wrapped in double-quotes', () => {
  assert.equal(leadsHandler.escapeCsvField('a,b,c'), '"a,b,c"');
});

test('escapeCsvField: embedded quotes are doubled (RFC 4180)', () => {
  assert.equal(leadsHandler.escapeCsvField('she said "hi"'), '"she said ""hi"""');
});

test('escapeCsvField: newlines force quoting', () => {
  assert.equal(leadsHandler.escapeCsvField('line1\nline2'), '"line1\nline2"');
});

// ── eventsToCsv ────────────────────────────────────

test('eventsToCsv: header row matches CSV_COLUMNS order', () => {
  const csv = leadsHandler.eventsToCsv([]);
  const firstLine = csv.split('\r\n')[0];
  assert.equal(firstLine, leadsHandler.CSV_COLUMNS.join(','));
});

test('eventsToCsv: empty events → just the header + trailing CRLF', () => {
  const csv = leadsHandler.eventsToCsv([]);
  const lines = csv.split('\r\n');
  // First line is header, last is empty (trailing CRLF), so length = 2.
  assert.equal(lines.length, 2);
  assert.equal(lines[1], '');
});

test('eventsToCsv: projects standard fields from import_plan_generated event', () => {
  const csv = leadsHandler.eventsToCsv([{
    at: '2026-05-19T12:00:00.000Z',
    type: 'import_plan_generated',
    locale: 'pl',
    inputs: { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL' },
    landedTotal: 39867.12,
    hsCodeProvided: true,
    hsCodeLength: 8,
    dutyMfnSource: 'chapter-estimator',
    emailProvided: true,
  }]);
  const lines = csv.split('\r\n');
  const dataRow = lines[1].split(',');
  // Indexes derived from CSV_COLUMNS order.
  const idx = (name) => leadsHandler.CSV_COLUMNS.indexOf(name);
  assert.equal(dataRow[idx('at')], '2026-05-19T12:00:00.000Z');
  assert.equal(dataRow[idx('type')], 'import_plan_generated');
  assert.equal(dataRow[idx('locale')], 'pl');
  assert.equal(dataRow[idx('productCategory')], 'apparel');
  assert.equal(dataRow[idx('originCountry')], 'CN');
  assert.equal(dataRow[idx('destinationCountry')], 'PL');
  // Route was wrapped in quotes because the "→" doesn't trigger
  // escaping but is preserved as-is.
  assert.match(lines[1], /CN→PL/);
  assert.equal(dataRow[idx('landedTotalEur')], '39867');  // rounded
  assert.equal(dataRow[idx('hsCodeProvided')], 'true');
  assert.equal(dataRow[idx('hsCodeLength')], '8');
  assert.equal(dataRow[idx('dutyMfnSource')], 'chapter-estimator');
  assert.equal(dataRow[idx('emailCaptured')], 'true');
});

test('eventsToCsv: hashes raw email (KV-shape rows) — raw email NEVER appears in output', () => {
  const csv = leadsHandler.eventsToCsv([{
    at: '2026-05-19T12:00:00Z', type: 'plan_saved', email: 'secret@example.com',
  }]);
  assert.doesNotMatch(csv, /secret@example\.com/, 'raw email must NEVER leak');
  // The emailHash column should carry a 12-hex prefix instead.
  const lines = csv.split('\r\n');
  const idx = leadsHandler.CSV_COLUMNS.indexOf('emailHash');
  const hash = lines[1].split(',')[idx];
  assert.match(hash, /^[a-f0-9]{12}$/);
});

test('eventsToCsv: pre-hashed emailHash (PG-shape rows) passes through unchanged', () => {
  const csv = leadsHandler.eventsToCsv([{
    at: '2026-05-19T12:00:00Z', type: 'plan_saved', emailHash: 'abc123def456',
  }]);
  const lines = csv.split('\r\n');
  const idx = leadsHandler.CSV_COLUMNS.indexOf('emailHash');
  assert.equal(lines[1].split(',')[idx], 'abc123def456');
});

test('eventsToCsv: deleted-pseudonym addresses NOT re-hashed (already anonymised)', () => {
  const csv = leadsHandler.eventsToCsv([{
    at: '2026-05-19T12:00:00Z', type: 'plan_saved',
    email: 'deleted-abc123@anonymised.local',
  }]);
  const lines = csv.split('\r\n');
  const idx = leadsHandler.CSV_COLUMNS.indexOf('emailHash');
  // Pre-hashed deleted-* addresses come through as no emailHash —
  // they're already an opaque identity, no need to re-anonymise.
  assert.equal(lines[1].split(',')[idx], '');
  // Raw deleted-* string also never leaks.
  assert.doesNotMatch(csv, /deleted-abc123@anonymised\.local/);
});

test('eventsToCsv: properly escapes a field that contains a comma', () => {
  const csv = leadsHandler.eventsToCsv([{
    at: '2026-05-19T12:00:00Z', type: 'plan_saved',
    inputs: { productCategory: 'a,b,c' },
  }]);
  // The "a,b,c" value must be wrapped in quotes so the comma doesn't
  // break the column count.
  assert.match(csv, /"a,b,c"/);
});

// ── csvFilename ────────────────────────────────────

test('csvFilename: ISO-stamped with .csv extension', () => {
  const name = leadsHandler.csvFilename();
  assert.match(name, /^orcatrade-leads-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/);
});

// ── End-to-end via /api/leads?format=csv ───────────

test('GET /api/leads?format=csv: returns CSV with correct Content-Type + Content-Disposition', () =>
  withEnv({ ORCATRADE_LEADS_TOKEN: 'sekret' }, async () => {
    kv._resetMemoryStore();
    await events.record('plan_saved', { email: 'someone@example.com', planId: 'p1' });
    const req = {
      method: 'GET',
      url: '/api/leads?token=sekret&format=csv',
      headers: {},
    };
    const res = mockRes();
    await leadsHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.match(res.headers['content-disposition'], /attachment;\s*filename="orcatrade-leads-/);
    assert.match(res.headers['cache-control'], /no-store/);
    // Body starts with the header row.
    assert.ok(res.body.startsWith(leadsHandler.CSV_COLUMNS.join(',')));
  })
);

test('GET /api/leads?format=csv: 401 still gates the CSV path', () =>
  withEnv({ ORCATRADE_LEADS_TOKEN: 'sekret' }, async () => {
    const req = { method: 'GET', url: '/api/leads?format=csv', headers: {} };
    const res = mockRes();
    await leadsHandler(req, res);
    assert.equal(res.statusCode, 401);
  })
);

test('GET /api/leads?format=csv: 503 when no admin auth configured', () =>
  withEnv({ ORCATRADE_LEADS_TOKEN: undefined, ORCATRADE_ADMIN_EMAILS: undefined }, async () => {
    const req = { method: 'GET', url: '/api/leads?format=csv', headers: {} };
    const res = mockRes();
    await leadsHandler(req, res);
    assert.equal(res.statusCode, 503);
  })
);

test('GET /api/leads?format=csv: no raw email in the response body', () =>
  withEnv({ ORCATRADE_LEADS_TOKEN: 'sekret' }, async () => {
    kv._resetMemoryStore();
    await events.record('plan_saved', { email: 'PII@example.com', planId: 'pX' });
    await events.record('founding_applied', { email: 'apply@example.com', name: 'A', company: 'AC' });
    const req = { method: 'GET', url: '/api/leads?token=sekret&format=csv', headers: {} };
    const res = mockRes();
    await leadsHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.doesNotMatch(res.body, /pii@example\.com/i);
    assert.doesNotMatch(res.body, /apply@example\.com/i);
  })
);

test('GET /api/leads?format=csv: ?type filter narrows the export', () =>
  withEnv({ ORCATRADE_LEADS_TOKEN: 'sekret' }, async () => {
    kv._resetMemoryStore();
    await events.record('plan_saved', { planId: 'p1' });
    await events.record('founding_applied', { name: 'a', company: 'c' });
    const req = { method: 'GET', url: '/api/leads?token=sekret&format=csv&type=plan_saved', headers: {} };
    const res = mockRes();
    await leadsHandler(req, res);
    assert.equal(res.statusCode, 200);
    // Body has the header + one row + trailing CRLF — 3 lines.
    const lines = res.body.split('\r\n');
    assert.equal(lines.length, 3);
    // Data row carries 'plan_saved'.
    assert.match(lines[1], /plan_saved/);
    assert.doesNotMatch(lines[1], /founding_applied/);
  })
);

// ── /dashboard/leads/ contract ─────────────────────

test('/dashboard/leads/index.html: Export CSV button present', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'leads', 'index.html'), 'utf8');
  assert.match(html, /id=["']export-csv-btn["']/);
  assert.match(html, /Export CSV/);
});

test('/dashboard/leads/app.js: Export CSV wires to /api/leads?format=csv', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'leads', 'app.js'), 'utf8');
  assert.match(js, /\/api\/leads\?format=csv/);
  assert.match(js, /exportCsv\b/);
  assert.match(js, /URL\.createObjectURL/);
});

// ── Module surface ─────────────────────────────────

test('leads handler exposes CSV surface for tests', () => {
  for (const name of ['CSV_COLUMNS', 'escapeCsvField', 'eventsToCsv', 'csvFilename']) {
    assert.ok(leadsHandler[name] !== undefined, name + ' exported');
  }
});
