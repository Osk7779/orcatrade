'use strict';

// Sprint 16 — structured decline reasons + revision lineage drift-guard.
//
// The DECLINE_REASONS enum lives in 4 places:
//   1. lib/db/import-requests.js — DECLINE_REASONS (single source of truth)
//   2. lib/imports-emails.js     — DECLINE_REASON_COPY (per-reason email copy)
//   3. app-shell/lib/api.ts      — DeclineReason type + DECLINE_REASONS const
//                                  + DECLINE_REASON_LABELS map
//   4. SQL schema-013            — no direct mention (validation happens at
//                                  the JS layer, since CHECK constraints on
//                                  JSONB sub-paths are clunky)
//
// Adding a reason in one place without the others would either silently
// drop emails (missing copy), render the raw enum string in the UI
// (missing label), or — worst — let an unknown enum value into the
// data-layer (missing constant). This test pins parity across all 4
// places.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequestsDb = require('../lib/db/import-requests');
const importsEmails = require('../lib/imports-emails');

const ROOT = path.resolve(__dirname, '..');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const DETAIL_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', '[externalId]', 'page.tsx'),
  'utf8',
);
const NEW_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'new', 'page.tsx'),
  'utf8',
);

// ── Single source of truth: lib/db/import-requests.js ────────────────

test('DECLINE_REASONS is exported as a frozen array of strings', () => {
  assert.ok(Array.isArray(importRequestsDb.DECLINE_REASONS));
  assert.ok(Object.isFrozen(importRequestsDb.DECLINE_REASONS));
  for (const r of importRequestsDb.DECLINE_REASONS) {
    assert.equal(typeof r, 'string');
    assert.ok(r.length > 0);
  }
});

test('REVISABLE_DECLINE_REASONS is a strict subset of DECLINE_REASONS', () => {
  // A revisable reason is one where the customer email surfaces a
  // "Revise this request" CTA. All revisable reasons MUST be in the
  // base enum (a reason that's revisable but not in the enum would
  // crash the email composer).
  for (const r of importRequestsDb.REVISABLE_DECLINE_REASONS) {
    assert.ok(
      importRequestsDb.DECLINE_REASONS.includes(r),
      `${r} is in REVISABLE_DECLINE_REASONS but not in DECLINE_REASONS`,
    );
  }
});

test('out_of_scope is NOT revisable (it is genuinely terminal)', () => {
  // A request the customer can't revise their way out of —
  // re-confirming the explicit non-CTA path.
  assert.ok(
    !importRequestsDb.REVISABLE_DECLINE_REASONS.includes('out_of_scope'),
    'out_of_scope must stay non-revisable so the customer email shows the no-CTA path',
  );
});

// ── Email composer copy parity ───────────────────────────────────────

test('DECLINE_REASON_COPY has a templated headline + nudge for every enum value', () => {
  // A future enum addition that ships without an email copy entry
  // would crash the composer (or render `undefined`). Pin every
  // reason has both fields.
  for (const r of importRequestsDb.DECLINE_REASONS) {
    const copy = importsEmails.DECLINE_REASON_COPY[r];
    assert.ok(copy, `DECLINE_REASON_COPY is missing an entry for "${r}"`);
    assert.equal(typeof copy.headline, 'string', `${r}.headline must be a string`);
    assert.equal(typeof copy.nudge, 'string', `${r}.nudge must be a string`);
    assert.ok(copy.headline.length > 10);
    assert.ok(copy.nudge.length > 10);
  }
});

test('DECLINE_REASON_COPY has NO entries beyond the enum (no orphan copy)', () => {
  const enumSet = new Set(importRequestsDb.DECLINE_REASONS);
  for (const key of Object.keys(importsEmails.DECLINE_REASON_COPY)) {
    assert.ok(
      enumSet.has(key),
      `DECLINE_REASON_COPY has an entry for "${key}" that is NOT in DECLINE_REASONS`,
    );
  }
});

// ── TS mirror parity ────────────────────────────────────────────────

test('TS DECLINE_REASONS type union covers every JS enum value', () => {
  const tsBlock = API_TS.match(/export type DeclineReason =\s*([\s\S]*?);/);
  assert.ok(tsBlock, 'DeclineReason type union not found');
  const tsTypes = new Set(
    [...tsBlock[1].matchAll(/['"]([a-z_]+)['"]/g)].map((m) => m[1]),
  );
  for (const r of importRequestsDb.DECLINE_REASONS) {
    assert.ok(
      tsTypes.has(r),
      `DeclineReason type union is missing "${r}" — JS enum has it but TS doesn't`,
    );
  }
  for (const t of tsTypes) {
    assert.ok(
      importRequestsDb.DECLINE_REASONS.includes(t),
      `DeclineReason type union has "${t}" but JS enum doesn't`,
    );
  }
});

test('TS DECLINE_REASONS const array matches the JS enum exactly', () => {
  const tsConst = API_TS.match(/export const DECLINE_REASONS: ReadonlyArray<DeclineReason> = Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert.ok(tsConst, 'TS DECLINE_REASONS const not found');
  const tsReasons = [...tsConst[1].matchAll(/['"]([a-z_]+)['"]/g)].map((m) => m[1]);
  assert.deepEqual(tsReasons, [...importRequestsDb.DECLINE_REASONS]);
});

test('TS REVISABLE_DECLINE_REASONS matches the JS subset exactly', () => {
  const tsConst = API_TS.match(/export const REVISABLE_DECLINE_REASONS: ReadonlyArray<DeclineReason> = Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert.ok(tsConst, 'TS REVISABLE_DECLINE_REASONS const not found');
  const tsReasons = [...tsConst[1].matchAll(/['"]([a-z_]+)['"]/g)].map((m) => m[1]);
  assert.deepEqual(tsReasons, [...importRequestsDb.REVISABLE_DECLINE_REASONS]);
});

test('TS DECLINE_REASON_LABELS has a label for every enum value', () => {
  const labelsBlock = API_TS.match(/export const DECLINE_REASON_LABELS:[\s\S]*?\}\)/);
  assert.ok(labelsBlock, 'DECLINE_REASON_LABELS not found in api.ts');
  const body = labelsBlock[0];
  for (const r of importRequestsDb.DECLINE_REASONS) {
    assert.match(
      body,
      new RegExp(`${r}:\\s*['"]`),
      `DECLINE_REASON_LABELS is missing a label for "${r}"`,
    );
  }
});

// ── attachTeamReview enforces the gate ──────────────────────────────

test('attachTeamReview rejects "rejected" without a declineReason', async () => {
  // Without the data-layer gate, ops could decline without a reason
  // and the customer email would render "undefined". Pin the gate.
  const result = await importRequestsDb.attachTeamReview({
    orgId: 1,
    externalId: 'ir_zzzz_no_such_request',
    actorEmailHash: 'hash_zzz',
    decision: 'rejected',
    // declineReason omitted on purpose
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((/** @type {string} */ e) => /declineReason required/.test(e)));
});

test('attachTeamReview rejects an unknown declineReason value', async () => {
  const result = await importRequestsDb.attachTeamReview({
    orgId: 1,
    externalId: 'ir_zzzz_no_such_request',
    actorEmailHash: 'hash_zzz',
    decision: 'rejected',
    declineReason: 'made_up_reason_that_is_not_in_the_enum',
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((/** @type {string} */ e) => /declineReason required.*one of/.test(e)));
});

// ── Customer rejected email ─────────────────────────────────────────

test('composeCustomerRejected renders the reason headline + nudge from copy', () => {
  const out = importsEmails.composeCustomerRejected({
    externalId: 'ir_test',
    label: 'Test request',
    productDescription: 'Test product',
    teamReviewState: { declineReason: 'price_target_unrealistic', notes: 'try EUR 14', revisable: true },
  });
  const copy = importsEmails.DECLINE_REASON_COPY.price_target_unrealistic;
  assert.ok(out.text.includes(copy.headline), 'text body must include the reason headline');
  assert.ok(out.text.includes(copy.nudge), 'text body must include the reason nudge');
  assert.ok(out.text.includes('try EUR 14'), 'text body must include the ops note');
});

test('composeCustomerRejected renders the Revise CTA for revisable reasons', () => {
  const out = importsEmails.composeCustomerRejected({
    externalId: 'ir_revisable',
    label: 'Test',
    productDescription: 'Test',
    teamReviewState: { declineReason: 'price_target_unrealistic', revisable: true, notes: '' },
  });
  assert.match(out.text, /Revise your request here/);
  assert.match(out.text, /\/imports\/new\?revise=ir_revisable/);
  assert.match(out.html, /Revise this request/);
});

test('composeCustomerRejected suppresses the Revise CTA for non-revisable reasons (out_of_scope)', () => {
  // out_of_scope is terminal — the customer can't fix this with a
  // revision. The email links to the dashboard instead of the CTA.
  const out = importsEmails.composeCustomerRejected({
    externalId: 'ir_terminal',
    label: 'Test',
    productDescription: 'Test',
    teamReviewState: { declineReason: 'out_of_scope', revisable: false, notes: '' },
  });
  assert.doesNotMatch(out.text, /Revise your request here/);
  assert.doesNotMatch(out.html, /Revise this request/);
  // Dashboard link IS present.
  assert.match(out.text, /\/imports\/ir_terminal/);
});

test('composeCustomerRejected subject is reason-aware (revisable vs terminal)', () => {
  const revisable = importsEmails.composeCustomerRejected({
    externalId: 'ir_a', label: 'My order', productDescription: 'x',
    teamReviewState: { declineReason: 'price_target_unrealistic', revisable: true, notes: '' },
  });
  const terminal = importsEmails.composeCustomerRejected({
    externalId: 'ir_b', label: 'My order', productDescription: 'x',
    teamReviewState: { declineReason: 'out_of_scope', revisable: false, notes: '' },
  });
  assert.match(revisable.subject, /needs a revision/);
  assert.match(terminal.subject, /can't take.*forward/);
});

// ── Schema-013 migration content ─────────────────────────────────────

test('schema-013 adds revised_from_external_id with IF NOT EXISTS (idempotent)', () => {
  const sql = fs.readFileSync(
    path.join(ROOT, 'lib', 'db', 'schema-013-import-request-revisions.sql'),
    'utf8',
  );
  assert.match(sql, /ADD COLUMN IF NOT EXISTS revised_from_external_id text/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS import_requests_revised_from_idx/);
});

// ── Detail page UI drift-guard ──────────────────────────────────────

test('Detail page surfaces the lineage back-pointer in the footer', () => {
  assert.match(DETAIL_TSX, /revisedFromExternalId/);
  assert.match(DETAIL_TSX, /revised from/);
  assert.match(DETAIL_TSX, /\/imports\/\$\{request\.revisedFromExternalId\}/);
});

test('Detail page renders DeclinedReasonPanel when cancelled with a structured reason', () => {
  // Pin the conditional render so a refactor that drops the panel
  // for "simpler" code paths leaves the customer in the dark again.
  assert.match(DETAIL_TSX, /request\.status === 'cancelled' && request\.teamReviewState\?\.declineReason/);
  assert.match(DETAIL_TSX, /function DeclinedReasonPanel/);
});

test('Detail page ActionZone exposes a "Decline with reason" button on awaiting_review', () => {
  // Without this button, ops has no way to reject from the UI. Pin
  // the button so a UI cleanup that drops it surfaces here.
  assert.match(DETAIL_TSX, /Decline with reason/);
  assert.match(DETAIL_TSX, /onTeamDecline/);
  assert.match(DETAIL_TSX, /declineReason: reason/);
});

// ── New-form revise flow ────────────────────────────────────────────

test('NewImportRequestForm reads BOTH ?revise and ?duplicate query params', () => {
  assert.match(NEW_TSX, /searchParams\.get\(['"]revise['"]\)/);
  assert.match(NEW_TSX, /searchParams\.get\(['"]duplicate['"]\)/);
});

test('NewImportRequestForm carries revisedFromExternalId on submit (revise mode only)', () => {
  // The submit path must set the linkage field, but ONLY when in
  // revise mode — ?duplicate intentionally creates an unlinked row.
  assert.match(NEW_TSX, /mode === 'revise' && reviseFrom/);
  assert.match(NEW_TSX, /createPayload\.revisedFromExternalId = reviseFrom/);
});

test('buildFormFromRequest uses "(revised)" suffix in revise mode, "(copy)" in duplicate mode', () => {
  // The label suffix is how customers distinguish their revision from
  // an unrelated duplicate. Pin both branches.
  const block = NEW_TSX.match(/export function buildFormFromRequest\([\s\S]*?\): FormState \{([\s\S]*?)\n\}/);
  assert.ok(block);
  assert.match(block[1], /'revise' \?\s*'\(revised\)'\s*:\s*'\(copy\)'/);
});
