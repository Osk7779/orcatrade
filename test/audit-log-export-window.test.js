'use strict';

// Sprint 37 — time-window filter (?days=N) on both audit CSV exports.
//
// Auditors typically want a window — Q1 2026, last 90 days, fiscal
// year — not "everything since the dawn of time." Sprint 37 adds a
// shared ?days=N query parameter to:
//   - GET /api/imports/<ir_xxx>/audit.csv (sprint 35 per-request)
//   - GET /api/imports/audit.csv          (sprint 36 org-wide)
//
// Tests cover three layers:
//   1. parseAuditDaysFilter pure helper — strict validation rejects
//      anything that isn't a plain integer in [1, 3650]; computes
//      sinceMs as Date.now() - N days
//   2. Handler wiring — both audit handlers call parseAuditDaysFilter
//      and apply the post-type-filter time predicate; filename gets
//      a "-last-Nd" infix when set; per-request validation runs
//      BEFORE the row-fetch (cheap-fail-first); org-wide validation
//      runs AFTER the requireOpsRole gate (no role-leak via 400)
//   3. UI — both export sections render a paired "all-time" +
//      "Last 90d" link with the days=90 query param + a title that
//      explains the windowed scope

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');
const DETAIL_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', '[externalId]', 'page.tsx'),
  'utf8',
);
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// Extract the parseAuditDaysFilter implementation from the handler
// source so we can exercise it in isolation. Same pattern the sprint-
// 34 csvEscape tests use for the pure helpers in this module.
function loadParser() {
  const block = HANDLER_SRC.match(/function parseAuditDaysFilter\(req\)[\s\S]*?\n\}/);
  if (!block) throw new Error('parseAuditDaysFilter body not located');
  // eslint-disable-next-line no-new-func
  return new Function('URL', `${block[0]}; return parseAuditDaysFilter;`)(URL);
}

function fakeReq(query) {
  return { url: query ? `/api/imports/audit.csv?${query}` : '/api/imports/audit.csv' };
}

// ── parseAuditDaysFilter pure function ────────────────────────────

test('parseAuditDaysFilter returns days=null + sinceMs=null when ?days is absent', () => {
  // Back-compat with sprint 35/36 callers that hit the endpoint
  // without the filter — same behaviour as before, full ceiling.
  const fn = loadParser();
  const r = fn(fakeReq(''));
  assert.deepEqual(r, { ok: true, days: null, sinceMs: null });
});

test('parseAuditDaysFilter accepts a plain integer in [1, 3650] and computes sinceMs', () => {
  // sinceMs = Date.now() - n * 86400_000. Test bounds + a typical
  // value so a future regression in the multiplier surfaces.
  const fn = loadParser();
  const before = Date.now();
  const r = fn(fakeReq('days=90'));
  const after = Date.now();
  assert.equal(r.ok, true);
  assert.equal(r.days, 90);
  // sinceMs is 90 days before "now". Bracket against the wall clock
  // (the test ran between `before` and `after`).
  assert.ok(r.sinceMs >= before - 90 * 86400000);
  assert.ok(r.sinceMs <= after - 90 * 86400000);
});

test('parseAuditDaysFilter accepts the boundary values 1 and 3650', () => {
  // 1 day = "yesterday only", 3650 days = "10 years" — both should
  // pass. The validator rejects 0 and 3651.
  const fn = loadParser();
  assert.equal(fn(fakeReq('days=1')).ok, true);
  assert.equal(fn(fakeReq('days=3650')).ok, true);
});

test('parseAuditDaysFilter rejects 0, negative, and out-of-range with a 400-shaped error', () => {
  // Zero is meaningless (no window). Negative would compute a future
  // sinceMs (every event matches). 3651 is the cap — fat-fingered
  // "days=99999" would blow up the multiplier silently otherwise.
  const fn = loadParser();
  for (const v of ['0', '-1', '3651', '999999']) {
    const r = fn(fakeReq(`days=${v}`));
    assert.equal(r.ok, false, `expected ${v} to fail`);
    assert.match(r.error, /days must be/i);
  }
});

test('parseAuditDaysFilter rejects non-integer forms (floats, leading-zero, NaN, whitespace)', () => {
  // String(n) === String(raw) eliminates the leading-zero ("007") +
  // decimal-point ("30.5") cases without a regex. Pure number check
  // also rejects "abc", " ", and "30.0" (which parses to 30 but
  // String(30) !== String("30.0")).
  const fn = loadParser();
  for (const v of ['007', '30.5', '30.0', 'abc', '1e2']) {
    const r = fn(fakeReq(`days=${v}`));
    assert.equal(r.ok, false, `expected ${v} to fail`);
  }
});

// ── Per-request handler wiring (sprint 35 + sprint 37) ────────────

test('handleAuditCsv calls parseAuditDaysFilter and applies the time predicate', () => {
  const block = HANDLER_SRC.match(/async function handleAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block, 'handleAuditCsv body not located');
  const body = block[0];
  // Parser invocation + 400 on invalid.
  assert.match(body, /const window = parseAuditDaysFilter\(req\)/);
  assert.match(body, /if \(!window\.ok\) return jsonResponse\(res, 400, \{ error: window\.error \}\)/);
  // Time predicate post-type-filter (event passes when sinceMs is
  // null OR Date.parse(e.at) >= sinceMs).
  assert.match(body, /window\.sinceMs == null \|\| Date\.parse\(e\.at \|\| ['"]['"]\) >= window\.sinceMs/);
});

test('handleAuditCsv validates the window BEFORE the row-fetch (cheap-fail-first)', () => {
  // An invalid ?days= should 400 without spending the DB round-trip.
  // Drift-guard: parseAuditDaysFilter must appear before
  // getImportRequestByExternalId.
  const block = HANDLER_SRC.match(/async function handleAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  const parseIdx = body.indexOf('parseAuditDaysFilter');
  const fetchIdx = body.indexOf('getImportRequestByExternalId');
  assert.ok(parseIdx >= 0 && fetchIdx > parseIdx, 'parseAuditDaysFilter must precede getImportRequestByExternalId');
});

test('handleAuditCsv filename gets a "-last-Nd" infix when window.days is set', () => {
  // Filename pattern: orcatrade-audit-<externalId>-last-90d-YYYY-MM-DD.csv
  // The infix is empty (back-compat) when no window.
  const block = HANDLER_SRC.match(/async function handleAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /const windowSuffix = window\.days \? `-last-\$\{window\.days\}d` : ['"]['"]/);
  assert.match(body, /orcatrade-audit-\$\{externalId\}\$\{windowSuffix\}-/);
});

// ── Org-wide handler wiring (sprint 36 + sprint 37) ───────────────

test('handleOrgAuditCsv calls parseAuditDaysFilter and applies the time predicate', () => {
  const block = HANDLER_SRC.match(/async function handleOrgAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block, 'handleOrgAuditCsv body not located');
  const body = block[0];
  assert.match(body, /const window = parseAuditDaysFilter\(req\)/);
  assert.match(body, /if \(!window\.ok\) return jsonResponse\(res, 400, \{ error: window\.error \}\)/);
  assert.match(body, /window\.sinceMs == null \|\| Date\.parse\(e\.at \|\| ['"]['"]\) >= window\.sinceMs/);
});

test('handleOrgAuditCsv validates the window AFTER the requireOpsRole gate (no role-leak via 400)', () => {
  // The org-wide endpoint is ops-only. An invalid ?days= sent by a
  // non-ops member should hit the 403 first, not the 400 — otherwise
  // the 400 vs 403 status difference would leak the role check.
  const block = HANDLER_SRC.match(/async function handleOrgAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  const guardIdx = body.indexOf('requireOpsRole');
  const parseIdx = body.indexOf('parseAuditDaysFilter');
  assert.ok(guardIdx >= 0 && parseIdx > guardIdx, 'requireOpsRole must precede parseAuditDaysFilter');
});

test('handleOrgAuditCsv filename gets a "-last-Nd" infix when window.days is set', () => {
  // Filename pattern: orcatrade-audit-org-last-90d-YYYY-MM-DD.csv
  // Empty infix for the back-compat all-time export.
  const block = HANDLER_SRC.match(/async function handleOrgAuditCsv\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /const windowSuffix = window\.days \? `-last-\$\{window\.days\}d` : ['"]['"]/);
  assert.match(body, /orcatrade-audit-org\$\{windowSuffix\}-/);
});

// ── UI: paired all-time + last 90d links ──────────────────────────

test('Detail page renders a paired "Export audit (CSV)" + "Last 90d" link', () => {
  // The default link stays "Export audit (CSV)" (all-time) so a
  // full handover is one click. The "Last 90d" partner targets the
  // ?days=90 path for quarterly compliance reviews.
  assert.match(DETAIL_TSX, /Export audit \(CSV\)/);
  assert.match(DETAIL_TSX, /href=\{`\/api\/imports\/\$\{request\.externalId\}\/audit\.csv`\}/);
  // Sprint 37 — windowed link.
  assert.match(DETAIL_TSX, /href=\{`\/api\/imports\/\$\{request\.externalId\}\/audit\.csv\?days=90`\}/);
  assert.match(DETAIL_TSX, /Last 90d/);
});

test('Detail page Last-90d link surfaces a title naming the windowed scope', () => {
  assert.match(
    DETAIL_TSX,
    /title="Download last 90 days of audit log as CSV \(windowed for quarterly reviews, UTF-8, RFC-4180\)"/,
  );
});

test('Insights page renders a paired "Export org audit (CSV)" + "Last 90d" link', () => {
  // Same pairing as the detail page, scoped to the org-wide
  // endpoint. The "Last 90d" partner uses the ?days=90 query param.
  assert.match(INSIGHTS_TSX, /href="\/api\/imports\/audit\.csv"/);
  assert.match(INSIGHTS_TSX, /href="\/api\/imports\/audit\.csv\?days=90"/);
  assert.match(INSIGHTS_TSX, /Last 90d/);
});

test('Insights page Last-90d link surfaces a title naming the windowed scope', () => {
  assert.match(
    INSIGHTS_TSX,
    /title="Download the org's last 90 days of audit log as CSV \(windowed for quarterly reviews, UTF-8, RFC-4180\)"/,
  );
});
