// Sprint audit-csv-export-v1 — tests.
//
// Covers:
//   - escapeCsvField + rowsToCsv (pure helpers)
//   - rowsToCsv: header row, projection columns, payload column
//     captures non-reserved fields as JSON, ignores raw email
//     (caller is expected to redact first), CRLF line endings
//   - Handler: 200 + correct Content-Type / Content-Disposition /
//     Cache-Control headers, 401 still gates, 503 when no admin auth,
//     ?type filter narrows the export, raw email never appears in the
//     body even when KV rows had one (regression on the redact-first
//     contract), default limit for CSV is higher (5000) than for JSON
//   - /dashboard/audit/ markup contract: Export CSV button present
//   - /dashboard/audit/ app.js wires Export CSV to /api/audit?format=csv

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auditHandler = require('../lib/handlers/audit');
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

// ── Pure helpers ─────────────────────────────────────

test('escapeCsvField: RFC 4180 escaping', () => {
  assert.equal(auditHandler.escapeCsvField(null), '');
  assert.equal(auditHandler.escapeCsvField(undefined), '');
  assert.equal(auditHandler.escapeCsvField('apparel'), 'apparel');
  assert.equal(auditHandler.escapeCsvField('a,b,c'), '"a,b,c"');
  assert.equal(auditHandler.escapeCsvField('she said "hi"'), '"she said ""hi"""');
  assert.equal(auditHandler.escapeCsvField('line1\nline2'), '"line1\nline2"');
});

test('CSV_COLUMNS: includes payload as last column', () => {
  assert.deepEqual(auditHandler.CSV_COLUMNS, ['at', 'type', 'emailHash', 'planId', 'orgId', 'ip', 'payload']);
});

test('rowsToCsv: header row matches CSV_COLUMNS', () => {
  const csv = auditHandler.rowsToCsv([]);
  assert.equal(csv.split('\r\n')[0], auditHandler.CSV_COLUMNS.join(','));
});

test('rowsToCsv: empty rows → just the header + trailing CRLF', () => {
  const csv = auditHandler.rowsToCsv([]);
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[1], '');
});

test('rowsToCsv: projects standard fields + JSON payload for extras', () => {
  const csv = auditHandler.rowsToCsv([{
    at: '2026-05-19T12:00:00Z',
    type: 'auth_signin',
    emailHash: 'abc123def456',
    planId: 'pl_xyz',
    ip: '1.2.3.4',
    source: 'magic-link',
    sid: 'ee01ee01ee01ee01',
  }]);
  const lines = csv.split('\r\n');
  const idx = (n) => auditHandler.CSV_COLUMNS.indexOf(n);
  const row = lines[1];
  // Split the row by comma but be careful — payload is quoted, so we
  // just assert via match for the fields that can't contain commas.
  const parts = row.split(',');
  assert.equal(parts[idx('at')], '2026-05-19T12:00:00Z');
  assert.equal(parts[idx('type')], 'auth_signin');
  assert.equal(parts[idx('emailHash')], 'abc123def456');
  assert.equal(parts[idx('planId')], 'pl_xyz');
  assert.equal(parts[idx('ip')], '1.2.3.4');
  // The payload field captures the non-reserved keys as JSON.
  // It must be wrapped in quotes because the JSON object literal
  // contains commas.
  assert.match(row, /"\{""sid"":""ee01ee01ee01ee01"",""source"":""magic-link""\}"/);
});

test('rowsToCsv: empty payload when no extras', () => {
  const csv = auditHandler.rowsToCsv([{
    at: '2026-05-19T12:00:00Z', type: 'auth_logout',
  }]);
  const parts = csv.split('\r\n')[1].split(',');
  const idx = auditHandler.CSV_COLUMNS.indexOf('payload');
  assert.equal(parts[idx], '');
});

test('rowsToCsv: raw email field, if accidentally present, is NOT in any column', () => {
  // Contract: rowsToCsv operates on ALREADY-REDACTED rows. If a caller
  // forgets to redact and passes a raw `email`, it should NOT end up
  // in the output (we don't have a column for it AND we explicitly
  // mark `email` as reserved so it can't flow into the payload bucket).
  const csv = auditHandler.rowsToCsv([{
    at: '2026-05-19T12:00:00Z', type: 'plan_saved',
    email: 'leak@example.com',
  }]);
  assert.doesNotMatch(csv, /leak@example\.com/);
});

test('csvFilename: ISO-stamped + audit prefix', () => {
  const name = auditHandler.csvFilename();
  assert.match(name, /^orcatrade-audit-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/);
});

// ── Handler end-to-end ──────────────────────────────

test('GET /api/audit?format=csv: 200 with text/csv + Content-Disposition', () =>
  withEnv({ ORCATRADE_LEADS_TOKEN: 'sekret' }, async () => {
    kv._resetMemoryStore();
    await events.record('plan_saved', { email: 'a@b.com', planId: 'p1' });
    const req = {
      method: 'GET',
      url: '/api/audit?token=sekret&format=csv',
      headers: {},
    };
    const res = mockRes();
    await auditHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.match(res.headers['content-disposition'], /filename="orcatrade-audit-/);
    assert.match(res.headers['cache-control'], /no-store/);
    assert.ok(res.body.startsWith(auditHandler.CSV_COLUMNS.join(',')));
  })
);

test('GET /api/audit?format=csv: raw email NEVER reaches the body', () =>
  withEnv({ ORCATRADE_LEADS_TOKEN: 'sekret' }, async () => {
    kv._resetMemoryStore();
    // Seed a couple of events with raw emails — exactly what KV stores.
    await events.record('auth_signin', { email: 'secret-leak@example.com', source: 'magic-link' });
    await events.record('plan_saved', { email: 'PII@example.com', planId: 'p9' });
    const req = {
      method: 'GET',
      url: '/api/audit?token=sekret&format=csv&limit=10',
      headers: {},
    };
    const res = mockRes();
    await auditHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.doesNotMatch(res.body, /secret-leak@example\.com/);
    assert.doesNotMatch(res.body, /pii@example\.com/i);
    // emailHash column should carry 12-hex pseudonyms instead.
    const lines = res.body.split('\r\n').filter(Boolean);
    const idx = auditHandler.CSV_COLUMNS.indexOf('emailHash');
    // Skip header; expect both data rows to have a hash.
    for (const dataLine of lines.slice(1)) {
      const parts = dataLine.split(',');
      assert.match(parts[idx], /^[a-f0-9]{12}$/);
    }
  })
);

test('GET /api/audit?format=csv: 401 still gates the CSV path', () =>
  withEnv({ ORCATRADE_LEADS_TOKEN: 'sekret' }, async () => {
    const req = { method: 'GET', url: '/api/audit?format=csv', headers: {} };
    const res = mockRes();
    await auditHandler(req, res);
    assert.equal(res.statusCode, 401);
    // Make sure we did NOT emit any CSV content.
    assert.doesNotMatch(res.body, /^at,type,/);
  })
);

test('GET /api/audit?format=csv: 503 when no admin auth configured', () =>
  withEnv({ ORCATRADE_LEADS_TOKEN: undefined, ORCATRADE_ADMIN_EMAILS: undefined }, async () => {
    const req = { method: 'GET', url: '/api/audit?format=csv', headers: {} };
    const res = mockRes();
    await auditHandler(req, res);
    assert.equal(res.statusCode, 503);
  })
);

test('GET /api/audit?format=csv: ?type filter narrows the export', () =>
  withEnv({ ORCATRADE_LEADS_TOKEN: 'sekret' }, async () => {
    kv._resetMemoryStore();
    await events.record('auth_signin', { email: 'a@b.com', source: 'magic-link' });
    await events.record('plan_saved', { email: 'a@b.com', planId: 'p1' });
    const req = {
      method: 'GET',
      url: '/api/audit?token=sekret&format=csv&type=plan_saved',
      headers: {},
    };
    const res = mockRes();
    await auditHandler(req, res);
    assert.equal(res.statusCode, 200);
    const lines = res.body.split('\r\n');
    assert.equal(lines.length, 3); // header + 1 data + trailing
    assert.match(lines[1], /plan_saved/);
    assert.doesNotMatch(lines[1], /auth_signin/);
  })
);

test('GET /api/audit?format=csv: CSV default limit (5000) > JSON default (200)', () =>
  withEnv({ ORCATRADE_LEADS_TOKEN: 'sekret' }, async () => {
    // We don't actually need 5000 events to verify this — just look at
    // the access log line the handler emits (via lib/log.js), which
    // records the resolved limit. Easier: inspect the events.listUnified
    // contract by stubbing.
    const orig = events.listUnified;
    let observedLimit = null;
    events.listUnified = async ({ limit }) => { observedLimit = limit; return []; };
    try {
      const req = {
        method: 'GET',
        url: '/api/audit?token=sekret&format=csv',  // no explicit limit
        headers: {},
      };
      const res = mockRes();
      await auditHandler(req, res);
      assert.equal(observedLimit, 5000);
    } finally {
      events.listUnified = orig;
    }
  })
);

test('GET /api/audit (no format): JSON path still works + default limit 200', () =>
  withEnv({ ORCATRADE_LEADS_TOKEN: 'sekret' }, async () => {
    const orig = events.listUnified;
    let observedLimit = null;
    events.listUnified = async ({ limit }) => { observedLimit = limit; return []; };
    try {
      const req = { method: 'GET', url: '/api/audit?token=sekret', headers: {} };
      const res = mockRes();
      await auditHandler(req, res);
      assert.equal(observedLimit, 200);
      assert.match(res.headers['content-type'], /application\/json/);
    } finally {
      events.listUnified = orig;
    }
  })
);

// ── /dashboard/audit/ contract ──────────────────────

test('/dashboard/audit/index.html: Export CSV button present', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'audit', 'index.html'), 'utf8');
  assert.match(html, /id=["']exportCsvBtn["']/);
  assert.match(html, /Export CSV/);
});

test('/dashboard/audit/app.js: Export CSV wires to /api/audit?format=csv', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'audit', 'app.js'), 'utf8');
  assert.match(js, /\/api\/audit/);
  assert.match(js, /format['"]?\s*[:,]\s*['"]csv/);
  assert.match(js, /exportCsv\b/);
  assert.match(js, /URL\.createObjectURL/);
});

// ── Module surface ──────────────────────────────────

test('audit handler exposes CSV surface for tests', () => {
  for (const name of ['CSV_COLUMNS', 'escapeCsvField', 'rowsToCsv', 'csvFilename']) {
    assert.ok(auditHandler[name] !== undefined, name + ' exported');
  }
});
