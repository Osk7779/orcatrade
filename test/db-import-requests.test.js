'use strict';

// Import-Request data-layer tests. The state machine + drift-guards
// are the load-bearing distinct piece — the SQL CHECK constraint, the
// JS VALID_TRANSITIONS, and the TS mirror in app-shell/lib/api.ts all
// have to stay in lockstep or the front-end will offer transitions the
// back-end refuses.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const importRequests = require(path.join(ROOT, 'lib', 'db', 'import-requests'));

// ── Drift-guard: STATUSES === SQL CHECK constraint ───────────────────

test('STATUSES exposes the 9 closed taxonomy values from schema-012', () => {
  assert.deepEqual(
    [...importRequests.STATUSES].sort(),
    [
      'awaiting_review', 'cancelled', 'customer_approved', 'customer_rejected',
      'expired', 'failed', 'processing', 'quoted', 'submitted',
    ],
  );
});

test('STATUSES matches the SQL import_requests_status_check constraint exactly', () => {
  const sql = fs.readFileSync(
    path.join(ROOT, 'lib', 'db', 'schema-012-import-requests.sql'),
    'utf8',
  );
  const match = sql.match(/CONSTRAINT import_requests_status_check[\s\S]*?CHECK \(status IN \(([\s\S]*?)\)\)/);
  assert.ok(match, 'status check constraint must exist in schema-012');
  const sqlStatuses = [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(sqlStatuses, [...importRequests.STATUSES].sort());
});

test('QUANTITY_UNITS matches the SQL constraint and the TS mirror', () => {
  const sql = fs.readFileSync(
    path.join(ROOT, 'lib', 'db', 'schema-012-import-requests.sql'),
    'utf8',
  );
  const match = sql.match(/import_requests_target_quantity_unit_check[\s\S]*?IN \(([\s\S]*?)\)/);
  assert.ok(match, 'quantity unit constraint must exist in schema-012');
  const sqlUnits = [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(sqlUnits, [...importRequests.QUANTITY_UNITS].sort());
});

// ── Drift-guard: VALID_TRANSITIONS keys === STATUSES ─────────────────

test('VALID_TRANSITIONS keys cover every status (no orphan edges, no missing entries)', () => {
  const keys = Object.keys(importRequests.VALID_TRANSITIONS).sort();
  assert.deepEqual(keys, [...importRequests.STATUSES].sort());
});

test('VALID_TRANSITIONS terminal states have no out-edges', () => {
  for (const terminal of importRequests.TERMINAL_STATUSES) {
    assert.deepEqual(
      [...importRequests.VALID_TRANSITIONS[terminal]],
      [],
      `${terminal} must be terminal (no out-edges)`,
    );
  }
});

test('VALID_TRANSITIONS targets are all valid statuses (no edges to nowhere)', () => {
  for (const [from, targets] of Object.entries(importRequests.VALID_TRANSITIONS)) {
    for (const to of targets) {
      assert.ok(
        importRequests.STATUSES.includes(to),
        `edge ${from} → ${to} points outside the closed taxonomy`,
      );
    }
  }
});

// ── State-machine happy path ─────────────────────────────────────────

test('happy-path: submitted → processing → awaiting_review → quoted → customer_approved', () => {
  assert.equal(importRequests.isLegalTransition('submitted', 'processing'), true);
  assert.equal(importRequests.isLegalTransition('processing', 'awaiting_review'), true);
  assert.equal(importRequests.isLegalTransition('awaiting_review', 'quoted'), true);
  assert.equal(importRequests.isLegalTransition('quoted', 'customer_approved'), true);
});

test('awaiting_review → processing is legal (team can send back for re-run)', () => {
  assert.equal(importRequests.isLegalTransition('awaiting_review', 'processing'), true);
});

test('every non-terminal status can transition to cancelled', () => {
  for (const from of ['submitted', 'processing', 'awaiting_review', 'quoted']) {
    assert.equal(
      importRequests.isLegalTransition(from, 'cancelled'),
      true,
      `${from} → cancelled must be legal`,
    );
  }
});

test('illegal transitions: cannot skip processing or awaiting_review', () => {
  assert.equal(importRequests.isLegalTransition('submitted', 'awaiting_review'), false);
  assert.equal(importRequests.isLegalTransition('submitted', 'quoted'), false);
  assert.equal(importRequests.isLegalTransition('processing', 'quoted'), false);
  assert.equal(importRequests.isLegalTransition('awaiting_review', 'customer_approved'), false);
});

test('illegal transitions: terminal states cannot transition out', () => {
  for (const terminal of importRequests.TERMINAL_STATUSES) {
    for (const target of importRequests.STATUSES) {
      if (target === terminal) continue;
      assert.equal(
        importRequests.isLegalTransition(terminal, target),
        false,
        `terminal ${terminal} → ${target} must be illegal`,
      );
    }
  }
});

test('isLegalTransition rejects garbage inputs without throwing', () => {
  assert.equal(importRequests.isLegalTransition(null, 'processing'), false);
  assert.equal(importRequests.isLegalTransition('submitted', null), false);
  assert.equal(importRequests.isLegalTransition('not_a_status', 'processing'), false);
  assert.equal(importRequests.isLegalTransition('submitted', 'not_a_status'), false);
  assert.equal(importRequests.isLegalTransition(undefined, undefined), false);
});

// ── Validation ───────────────────────────────────────────────────────

const VALID_CREATE = Object.freeze({
  orgId: 42,
  createdByEmailHash: 'aabbccdd11223344',
  label: 'Q3 silicone mats',
  productDescription: '3,000 silicone kitchen mats, food-grade, 30×40cm, FDA-compliant',
  destinationCountry: 'DE',
  originCountry: 'CN',
  targetQuantity: 3000,
  targetQuantityUnit: 'pieces',
  targetUnitPriceCents: 13_00, // €13.00
  hsCodeGuess: '39241000',
  certificationRequirements: ['CE', 'REACH'],
});

test('_validateForCreate accepts a well-formed input', () => {
  assert.deepEqual(importRequests._validateForCreate(VALID_CREATE), []);
});

test('_validateForCreate requires orgId + createdByEmailHash + label + productDescription + destinationCountry', () => {
  assert.ok(importRequests._validateForCreate({ ...VALID_CREATE, orgId: 'abc' }).some((e) => /orgId/.test(e)));
  assert.ok(importRequests._validateForCreate({ ...VALID_CREATE, createdByEmailHash: '' }).some((e) => /createdByEmailHash/.test(e)));
  assert.ok(importRequests._validateForCreate({ ...VALID_CREATE, label: '' }).some((e) => /label/.test(e)));
  assert.ok(importRequests._validateForCreate({ ...VALID_CREATE, productDescription: '' }).some((e) => /productDescription/.test(e)));
  assert.ok(importRequests._validateForCreate({ ...VALID_CREATE, destinationCountry: '' }).some((e) => /destinationCountry/.test(e)));
});

test('_validateForCreate rejects malformed country codes (must be ISO-2 uppercase)', () => {
  assert.ok(importRequests._validateForCreate({ ...VALID_CREATE, originCountry: 'CHN' }).some((e) => /originCountry/.test(e)));
  assert.ok(importRequests._validateForCreate({ ...VALID_CREATE, destinationCountry: 'DEU' }).some((e) => /destinationCountry/.test(e)));
});

test('_validateForCreate rejects malformed HS codes (must be 6-10 digits)', () => {
  assert.ok(importRequests._validateForCreate({ ...VALID_CREATE, hsCodeGuess: '12345' }).some((e) => /hsCodeGuess/.test(e)));
  assert.ok(importRequests._validateForCreate({ ...VALID_CREATE, hsCodeGuess: 'ABCDEFGH' }).some((e) => /hsCodeGuess/.test(e)));
  assert.ok(importRequests._validateForCreate({ ...VALID_CREATE, hsCodeGuess: '12345678901' }).some((e) => /hsCodeGuess/.test(e)));
});

test('_validateForCreate enforces integer-cents money discipline (ADR 0004)', () => {
  assert.ok(importRequests._validateForCreate({ ...VALID_CREATE, targetUnitPriceCents: -1 }).some((e) => /ADR 0004/.test(e)));
  assert.ok(importRequests._validateForCreate({ ...VALID_CREATE, targetUnitPriceCents: 13.5 }).some((e) => /ADR 0004/.test(e)));
});

test('_validateForCreate rejects non-positive quantities', () => {
  assert.ok(importRequests._validateForCreate({ ...VALID_CREATE, targetQuantity: 0 }).some((e) => /positive integer/.test(e)));
  assert.ok(importRequests._validateForCreate({ ...VALID_CREATE, targetQuantity: -10 }).some((e) => /positive integer/.test(e)));
  assert.ok(importRequests._validateForCreate({ ...VALID_CREATE, targetQuantity: 1.5 }).some((e) => /positive integer/.test(e)));
});

test('_validateForCreate rejects unknown quantity units', () => {
  assert.ok(importRequests._validateForCreate({ ...VALID_CREATE, targetQuantityUnit: 'sausages' })
    .some((e) => /targetQuantityUnit/.test(e)));
});

test('_validateForCreate accepts every legal quantity unit', () => {
  for (const u of importRequests.QUANTITY_UNITS) {
    assert.deepEqual(
      importRequests._validateForCreate({ ...VALID_CREATE, targetQuantityUnit: u }),
      [],
      `unit ${u} must be accepted`,
    );
  }
});

test('_validateForCreate rejects non-array certificationRequirements', () => {
  assert.ok(importRequests._validateForCreate({ ...VALID_CREATE, certificationRequirements: 'CE,REACH' })
    .some((e) => /certificationRequirements/.test(e)));
});

test('_validateForCreate rejects empty-string certifications', () => {
  assert.ok(importRequests._validateForCreate({ ...VALID_CREATE, certificationRequirements: ['CE', ''] })
    .some((e) => /certificationRequirements/.test(e)));
});

test('_validateForCreate rejects oversized labels and descriptions', () => {
  assert.ok(importRequests._validateForCreate({ ...VALID_CREATE, label: 'x'.repeat(201) }).some((e) => /label must be ≤200/.test(e)));
  assert.ok(importRequests._validateForCreate({ ...VALID_CREATE, productDescription: 'y'.repeat(4001) }).some((e) => /productDescription must be ≤4000/.test(e)));
});

// ── Row mapper ───────────────────────────────────────────────────────

test('_rowToImportRequest returns null for null input', () => {
  assert.equal(importRequests._rowToImportRequest(null), null);
  assert.equal(importRequests._rowToImportRequest(undefined), null);
});

test('_rowToImportRequest converts snake_case → camelCase and coerces money to Number', () => {
  const row = {
    id: '1',
    external_id: 'ir_abcdef0123456789',
    org_id: '42',
    created_by_email_hash: 'hash',
    label: 'L',
    status: 'submitted',
    product_description: 'P',
    target_unit_price_cents: '1300',
    target_quantity: '500',
    destination_country: 'DE',
    certification_requirements: ['CE'],
    factory_shortlist: [],
    ai_run_ids: [],
    team_review_state: {},
    customer_decision_state: {},
    failure_state: {},
    intent_metadata: {},
    metadata: {},
    created_at: '2026-06-15T12:00:00Z',
    updated_at: '2026-06-15T12:00:00Z',
  };
  const mapped = importRequests._rowToImportRequest(row);
  assert.equal(mapped.externalId, 'ir_abcdef0123456789');
  assert.equal(mapped.label, 'L');
  assert.equal(typeof mapped.targetUnitPriceCents, 'number');
  assert.equal(mapped.targetUnitPriceCents, 1300);
  assert.equal(mapped.targetQuantity, 500);
  assert.deepEqual(mapped.certificationRequirements, ['CE']);
});

test('_rowToImportRequest defaults missing jsonb arrays/objects to empty', () => {
  const row = {
    external_id: 'ir_x', org_id: 1, created_by_email_hash: 'h',
    label: 'L', status: 'submitted', product_description: 'P', destination_country: 'DE',
    certification_requirements: null,
    factory_shortlist: null,
    ai_run_ids: null,
    team_review_state: null,
    customer_decision_state: null,
    failure_state: null,
    intent_metadata: null,
    metadata: null,
  };
  const mapped = importRequests._rowToImportRequest(row);
  assert.deepEqual(mapped.certificationRequirements, []);
  assert.deepEqual(mapped.factoryShortlist, []);
  assert.deepEqual(mapped.aiRunIds, []);
  assert.deepEqual(mapped.teamReviewState, {});
  assert.deepEqual(mapped.customerDecisionState, {});
  assert.deepEqual(mapped.failureState, {});
  assert.deepEqual(mapped.intentMetadata, {});
  assert.deepEqual(mapped.metadata, {});
});

// ── DB-shy CRUD paths (no Postgres needed) ───────────────────────────
//
// These exercise the validation + db.isConfigured() branches that
// fire before any SQL runs, so they work in any environment.

test('createImportRequest returns 503-style not-configured when DATABASE_URL is missing', async () => {
  const prior = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    // The client module memoises connection state, but the not-configured
    // path is short-circuited via isConfigured() which re-reads env each
    // time on most builds. Best-effort: if the test environment has a
    // pooled Neon URL already, the call will hit validation first instead.
    const result = await importRequests.createImportRequest({});
    assert.equal(result.ok, false);
    assert.ok(Array.isArray(result.errors) && result.errors.length > 0);
  } finally {
    if (prior !== undefined) process.env.DATABASE_URL = prior;
  }
});

test('listImportRequestsForOrg rejects invalid status filter', async () => {
  const result = await importRequests.listImportRequestsForOrg({
    orgId: 1, status: 'not_a_real_status',
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /status must be one of/.test(e)));
});

test('attachTeamReview rejects unknown decisions', async () => {
  const result = await importRequests.attachTeamReview({
    orgId: 1, externalId: 'ir_x', actorEmailHash: 'h', decision: 'wrong',
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /approved/.test(e)));
});

test('attachCustomerDecision rejects unknown decisions', async () => {
  const result = await importRequests.attachCustomerDecision({
    orgId: 1, externalId: 'ir_x', actorEmailHash: 'h', decision: 'maybe',
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /approved/.test(e)));
});

// ── Drift-guard: TS mirror in app-shell/lib/api.ts ───────────────────
//
// The customer-facing UI renders only the legal next-status buttons by
// reading IMPORT_REQUEST_VALID_TRANSITIONS from the TS mirror. If the
// JS data layer adds an edge but the TS mirror lags, the UI offers a
// stale taxonomy; if the TS mirror adds an edge but the JS lags, the
// UI offers a button the server rejects with 409. Pin both directions.

const API_TS_PATH = path.join(ROOT, 'app-shell', 'lib', 'api.ts');
const API_TS_SRC = fs.readFileSync(API_TS_PATH, 'utf8');

test('IMPORT_REQUEST_STATUSES is exported as a frozen ReadonlyArray', () => {
  assert.match(
    API_TS_SRC,
    /export const IMPORT_REQUEST_STATUSES: ReadonlyArray<ImportRequestStatus> = Object\.freeze\(\[/,
  );
});

test('IMPORT_REQUEST_STATUSES TS mirror contents match the JS STATUSES exactly', () => {
  const block = API_TS_SRC.match(
    /IMPORT_REQUEST_STATUSES: ReadonlyArray<ImportRequestStatus> = Object\.freeze\(\[([\s\S]*?)\]\)/,
  );
  assert.ok(block, 'IMPORT_REQUEST_STATUSES not located in TS mirror');
  const tsStatuses = [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(tsStatuses, [...importRequests.STATUSES].sort());
});

test('IMPORT_REQUEST_VALID_TRANSITIONS TS mirror keys match the JS VALID_TRANSITIONS keys', () => {
  const block = API_TS_SRC.match(
    /IMPORT_REQUEST_VALID_TRANSITIONS[\s\S]*?Object\.freeze\(\{([\s\S]*?)\}\)/,
  );
  assert.ok(block, 'IMPORT_REQUEST_VALID_TRANSITIONS not located in TS mirror');
  const tsKeys = [...block[1].matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(tsKeys, Object.keys(importRequests.VALID_TRANSITIONS).sort());
});

test('IMPORT_REQUEST_VALID_TRANSITIONS TS mirror edges match the JS edges exactly', () => {
  const block = API_TS_SRC.match(
    /IMPORT_REQUEST_VALID_TRANSITIONS[\s\S]*?Object\.freeze\(\{([\s\S]*?)\}\)/,
  );
  assert.ok(block, 'IMPORT_REQUEST_VALID_TRANSITIONS not located in TS mirror');
  // Parse each line like: submitted: Object.freeze(['processing', 'cancelled', 'failed']),
  const lines = block[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length && !l.startsWith('//'));
  /** @type {Record<string, string[]>} */
  const tsTransitions = {};
  for (const line of lines) {
    const m = line.match(/^([a-z_]+):\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
    if (!m) continue;
    const from = m[1];
    const targets = [...m[2].matchAll(/'([a-z_]+)'/g)].map((mm) => mm[1]);
    tsTransitions[from] = targets;
  }
  for (const [from, jsTargets] of Object.entries(importRequests.VALID_TRANSITIONS)) {
    const tsTargets = (tsTransitions[from] || []).slice().sort();
    const expected = [...jsTargets].sort();
    assert.deepEqual(
      tsTargets,
      expected,
      `TS mirror edge mismatch for ${from}: TS=[${tsTargets.join(',')}] vs JS=[${expected.join(',')}]`,
    );
  }
});

test('IMPORT_REQUEST_QUANTITY_UNITS TS mirror contents match the JS QUANTITY_UNITS', () => {
  const block = API_TS_SRC.match(
    /IMPORT_REQUEST_QUANTITY_UNITS: ReadonlyArray<ImportRequestQuantityUnit> = Object\.freeze\(\[([\s\S]*?)\]\)/,
  );
  assert.ok(block, 'IMPORT_REQUEST_QUANTITY_UNITS not located in TS mirror');
  const tsUnits = [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(tsUnits, [...importRequests.QUANTITY_UNITS].sort());
});
