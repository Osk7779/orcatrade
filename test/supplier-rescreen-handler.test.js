'use strict';

// Tests for the supplier sanctions re-screen flow:
//   - lib/db/suppliers.js recordScreeningResult (validation surface)
//   - lib/handlers/suppliers.js POST /api/suppliers/<id>/screen
//     (routing, auth, archived-409, ownership-first)
//   - lib/handlers/suppliers.js SCREEN_STATUS_MAP (closed taxonomy)
//   - lib/events.js ALLOWED_TYPES includes supplier_master_rescreened
//   - lib/handlers/suppliers.js SUPPLIER_TIMELINE_EVENT_TYPES
//     includes the rescreened type
//   - app-shell/lib/api.ts SupplierTimelineEventType union matches
//     the backend whitelist (cross-stack drift guard)
//
// Without DATABASE_URL we exercise routing + validation. End-to-end
// (create → screen → verify) runs in the integration suite once
// DATABASE_URL is wired.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const suppliersDb = require(path.join(ROOT, 'lib', 'db', 'suppliers'));
const suppliersHandler = require(path.join(ROOT, 'lib', 'handlers', 'suppliers'));
const events = require(path.join(ROOT, 'lib', 'events'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    end(payload) {
      if (payload !== undefined) {
        try { this.body = JSON.parse(payload); } catch (_) { this.body = payload; }
      }
      return this;
    },
  };
}

function call({ method = 'GET', headers = {}, body, query }) {
  const res = mockRes();
  return suppliersHandler(
    { method, headers, body, query, url: query?.path ? `/api/${query.path}` : '/api/suppliers' },
    res,
  ).then(() => res);
}

// ── ALLOWED_TYPES gate (ADR 0005 audit-log-before-success) ───────────

test('lib/events.js ALLOWED_TYPES includes supplier_master_rescreened', () => {
  // events.record returns false for any type not in the whitelist,
  // silently dropping the audit row. recordScreeningResult would
  // pretend success — a quiet violation of ADR 0005. Pin the set.
  assert.equal(events.ALLOWED_TYPES.has('supplier_master_rescreened'), true);
});

// ── Validation surface on recordScreeningResult ──────────────────────

test('recordScreeningResult rejects missing required identifiers', async () => {
  const r = await suppliersDb.recordScreeningResult({});
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /orgId, externalId, actorEmailHash required/);
});

test('recordScreeningResult rejects an unknown status (must be in SANCTIONS_STATUSES)', async () => {
  const r = await suppliersDb.recordScreeningResult({
    orgId: 1,
    externalId: 'sp_test',
    actorEmailHash: 'deadbeef00000000',
    status: 'definitely_not_a_status',
    matchSummary: {},
  });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /status must be one of/);
  // Lists the closed taxonomy verbatim — gives the operator a hint.
  for (const s of suppliersDb.SANCTIONS_STATUSES) {
    assert.match(r.errors[0], new RegExp(s));
  }
});

test('recordScreeningResult rejects a non-object matchSummary', async () => {
  const r = await suppliersDb.recordScreeningResult({
    orgId: 1,
    externalId: 'sp_test',
    actorEmailHash: 'deadbeef00000000',
    status: 'clear',
    matchSummary: null,
  });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /matchSummary must be an object/);
});

test('recordScreeningResult rejects an array matchSummary (objects only)', async () => {
  const r = await suppliersDb.recordScreeningResult({
    orgId: 1,
    externalId: 'sp_test',
    actorEmailHash: 'deadbeef00000000',
    status: 'clear',
    matchSummary: [{ a: 1 }],
  });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /matchSummary must be an object/);
});

test('recordScreeningResult is exported from the suppliers data layer', () => {
  assert.equal(typeof suppliersDb.recordScreeningResult, 'function');
});

// ── SCREEN_STATUS_MAP closed taxonomy ────────────────────────────────

test('SCREEN_STATUS_MAP covers every status from sanctions-screening.screen() output', () => {
  // Drift guard: if sanctions-screening starts emitting a new status,
  // the handler's mapping would silently default to 'pending'. Pin
  // every status the screen() function ever returns.
  const handlerSrc = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'suppliers.js'), 'utf8');
  const mapBlock = handlerSrc.match(/SCREEN_STATUS_MAP = Object\.freeze\(\{([\s\S]*?)\}\)/);
  assert.ok(mapBlock, 'SCREEN_STATUS_MAP not located');
  const mapKeys = (mapBlock[1].match(/(\w+):/g) || []).map((s) => s.replace(':', '')).sort();
  // Every status the screening module can emit (see
  // lib/intelligence/sanctions-screening.js:122,151).
  assert.deepEqual(mapKeys, [
    'invalid',
    'no_match',
    'no_sample_match',
    'potential_match',
  ]);
  // Every mapped value must be in the supplier SANCTIONS_STATUSES enum.
  const targetValues = (mapBlock[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, ''));
  for (const v of targetValues) {
    assert.ok(suppliersDb.SANCTIONS_STATUSES.includes(v), `mapped value "${v}" not in SANCTIONS_STATUSES`);
  }
});

// ── Timeline filter includes the new event type ──────────────────────

test('SUPPLIER_TIMELINE_EVENT_TYPES includes supplier_master_rescreened', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'suppliers.js'), 'utf8');
  const block = src.match(/SUPPLIER_TIMELINE_EVENT_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block);
  const types = (block[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();
  assert.deepEqual(types, [
    'supplier_master_archived',
    'supplier_master_created',
    'supplier_master_rescreened',
    'supplier_master_updated',
  ]);
});

// ── Handler routing ──────────────────────────────────────────────────

test('POST /api/suppliers/<id>/screen without session → 401 (auth gate)', async () => {
  kv._resetMemoryStore();
  const res = await call({
    method: 'POST',
    body: {},
    query: { path: 'suppliers/sp_abc/screen' },
  });
  assert.equal(res.statusCode, 401);
});

test('GET /api/suppliers/<id>/screen → 401 or 405 (screen is POST-only, never 404 unknown-action)', async () => {
  // Auth gate fires first → 401. Either 401 or 405 proves /screen
  // was recognised as a sub-action (not falling through to 404
  // "Unknown action").
  kv._resetMemoryStore();
  const res = await call({
    method: 'GET',
    query: { path: 'suppliers/sp_abc/screen' },
  });
  assert.ok([401, 405].includes(res.statusCode), `expected 401 or 405, got ${res.statusCode}`);
});

test('handler recognises /screen as a sub-action (source-pinning, not just URL probing)', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'suppliers.js'), 'utf8');
  assert.match(src, /action === 'screen'/);
  assert.match(src, /return handleScreen\(req, res, ctx, externalId\)/);
});

test('handleScreen runs sanctions-screening via getActiveList + screen', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'suppliers.js'), 'utf8');
  assert.match(src, /require\('\.\.\/intelligence\/sanctions-screening'\)/);
  assert.match(src, /sanctionsScreening\.getActiveList\(\)/);
  assert.match(src, /sanctionsScreening\.screen\(\{/);
  assert.match(src, /name: supplier\.entityName/);
});

test('handleScreen calls recordScreeningResult with the actor + entityId from context', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'suppliers.js'), 'utf8');
  // Pin the recordScreeningResult call — it's the audit-log-before-
  // success site for the re-screen flow.
  assert.match(src, /suppliers\.recordScreeningResult\(\{/);
  assert.match(src, /orgId: ctx\.orgIdNumeric/);
  assert.match(src, /actorEmailHash: ctx\.emailHash/);
  assert.match(src, /status: mappedStatus/);
});

test('handleScreen refuses to re-screen an archived supplier (409)', () => {
  // Symmetric with the edit form's "no Edit button when archived"
  // rule. Drift guard reads the source.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'suppliers.js'), 'utf8');
  assert.match(src, /if \(supplier\.archivedAt\)/);
  assert.match(src, /Cannot re-screen an archived supplier/);
});

test('handleScreen is ownership-first (404 from getSupplierByExternalId before screening runs)', () => {
  // Critical: a non-owner with a guessed externalId must see 404,
  // NOT a 500 because screen() ran on a foreign org's supplier name.
  // The fetch + ownership check appears BEFORE getActiveList.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'suppliers.js'), 'utf8');
  const fnBlock = src.match(/async function handleScreen[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  const fetchIdx = block.indexOf('getSupplierByExternalId');
  const screenIdx = block.indexOf('sanctionsScreening.screen(');
  assert.ok(fetchIdx >= 0 && screenIdx >= 0 && fetchIdx < screenIdx,
    `ownership fetch must precede screening — fetchIdx=${fetchIdx} screenIdx=${screenIdx}`);
});

test('handleScreen returns the persisted supplier + screening payload', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'suppliers.js'), 'utf8');
  assert.match(src, /jsonResponse\(res, 200, \{[\s\S]*?ok: true[\s\S]*?supplier: persisted\.supplier[\s\S]*?screening: matchSummary[\s\S]*?\}\)/);
});

test('handleScreen does NOT accept the screening name from the request body (forge-proof)', () => {
  // The supplier identity is the URL; the entityName comes from the
  // persisted record. A client cannot screen against an attacker-
  // supplied name to confuse the audit log.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'suppliers.js'), 'utf8');
  const fnBlock = src.match(/async function handleScreen[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  // Name only appears as supplier.entityName, never as req.body.something
  assert.doesNotMatch(block, /req\.body\.name|req\.body\.entityName|body\.name/);
  assert.match(block, /name: supplier\.entityName/);
});

// ── Audit-log diff is tight (3 fields only) ──────────────────────────

test('recordScreeningResult builds a tight audit diff (only the three sanctions fields)', () => {
  // Drift guard reads the data-layer source. A wider diff would
  // bloat the audit payload AND make the operator's timeline read
  // worse.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'suppliers.js'), 'utf8');
  const fnBlock = src.match(/async function recordScreeningResult[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  const beforeBlock = block.match(/const beforeSlice = \{([\s\S]*?)\};/);
  assert.ok(beforeBlock);
  const fields = (beforeBlock[1].match(/sanctions\w+:/g) || []).sort();
  assert.deepEqual(fields, [
    'sanctionsLastMatchSummary:',
    'sanctionsLastScreenedAt:',
    'sanctionsLastStatus:',
  ]);
});

// ── Existing routes still work (no regression) ───────────────────────

test('GET /api/suppliers/<id> still hits the detail route (no regression from /screen wiring)', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'GET', query: { path: 'suppliers/sp_abc' } });
  assert.equal(res.statusCode, 401);
});

test('GET /api/suppliers/<id>/history still hits the history route (PR #121 regression)', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'GET', query: { path: 'suppliers/sp_abc/history' } });
  assert.equal(res.statusCode, 401);
});

// ── Cross-stack drift: SupplierTimelineEventType union ───────────────

test('SupplierTimelineEventType union (api.ts) matches SUPPLIER_TIMELINE_EVENT_TYPES (handler)', () => {
  const handlerSrc = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'suppliers.js'), 'utf8');
  const apiSrc = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
  const handlerBlock = handlerSrc.match(/SUPPLIER_TIMELINE_EVENT_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(handlerBlock);
  const backend = (handlerBlock[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();

  const tsUnion = apiSrc.match(/export type SupplierTimelineEventType =([^;]+);/);
  assert.ok(tsUnion, 'TS union not located');
  const ts = (tsUnion[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();

  assert.deepEqual(ts, backend,
    `Cross-stack drift: TS=${JSON.stringify(ts)} vs backend=${JSON.stringify(backend)}`);
});
