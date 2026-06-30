'use strict';

// Drift-guard for the duplicate-from-request flow — sprint 13 ch 2.
//
// `buildFormFromRequest` in app-shell/app/(authed)/imports/new/page.tsx
// is the choke point that maps a persisted ImportRequest onto the
// new-request FormState. A future PR that adds an intent field to
// ImportRequest (e.g. preferred-incoterm, target-margin) without
// extending this helper would silently lose the field on duplicate —
// the customer would have to re-type it. Pin every load-bearing
// intent field here so the regression catches at PR time.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const NEW_FORM_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'new', 'page.tsx'),
  'utf8',
);
const DETAIL_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', '[externalId]', 'page.tsx'),
  'utf8',
);

// ── buildFormFromRequest helper is exported ──────────────────────────

test('buildFormFromRequest is exported so it is reachable for the form initialiser', () => {
  assert.match(NEW_FORM_TSX, /export function buildFormFromRequest\(/);
});

// ── Drift-guard: every load-bearing intent field appears in the body ──

test('buildFormFromRequest carries every load-bearing intent field from the persisted request', () => {
  const block = NEW_FORM_TSX.match(
    /export function buildFormFromRequest\([\s\S]*?\): FormState \{([\s\S]*?)\n\}/,
  );
  assert.ok(block, 'buildFormFromRequest body not located');
  const body = block[1];

  // These are the intent fields the sprint 1 schema-012 + the
  // /api/imports endpoints carry. Adding a new intent field to
  // ImportRequest WITHOUT extending buildFormFromRequest would
  // silently drop it on duplicate — pin them all here.
  const requiredFields = [
    'productDescription',
    'hsCodeGuess',
    'targetQuantity',
    'targetQuantityUnit',
    'targetUnitPriceCents',
    'originCountry',
    'destinationCountry',
    'certificationRequirements',
    'label',
  ];

  for (const field of requiredFields) {
    const re = new RegExp(`request\\.${field}`);
    assert.ok(
      re.test(body),
      `buildFormFromRequest must reference request.${field} so the duplicate carries it across`,
    );
  }
});

test('buildFormFromRequest deliberately resets targetDeliveryDate (a duplicate is for a NEW order)', () => {
  const block = NEW_FORM_TSX.match(
    /export function buildFormFromRequest\([\s\S]*?\): FormState \{([\s\S]*?)\n\}/,
  );
  assert.ok(block);
  // targetDeliveryDate should NOT carry over from the source — the
  // duplicate is for a future order, the original delivery date is
  // almost certainly stale. Pin the reset so a future refactor doesn't
  // re-add the carry-through.
  assert.match(block[1], /targetDeliveryDate:\s*['"]['"]/);
});

test('buildFormFromRequest re-derives label as "<original> (copy)"', () => {
  const block = NEW_FORM_TSX.match(
    /export function buildFormFromRequest\([\s\S]*?\): FormState \{([\s\S]*?)\n\}/,
  );
  assert.ok(block);
  // The duplicate row needs a visually distinct label so the customer
  // can tell their original apart from the duplicate at a glance on
  // the list page. Pin the " (copy)" suffix pattern.
  assert.match(block[1], /\(copy\)/);
});

test('buildFormFromRequest converts targetUnitPriceCents (integer cents, ADR 0004) back to EUR for the form', () => {
  const block = NEW_FORM_TSX.match(
    /export function buildFormFromRequest\([\s\S]*?\): FormState \{([\s\S]*?)\n\}/,
  );
  assert.ok(block);
  // The form holds EUR as a decimal string; the persisted request
  // holds integer cents. The conversion must divide by 100. Pin the
  // pattern — a future refactor that drops the divide would treat
  // €13.00 as €1,300 on duplicate, off by 100x.
  assert.match(block[1], /targetUnitPriceCents/);
  assert.match(block[1], /\/\s*100/);
});

// ── Detail page integration — "Duplicate this request" link ──────────

test('The customer detail page renders a "Duplicate this request" link with the right query shape', () => {
  // /imports/[externalId] must offer a one-click duplicate so the
  // customer doesn't have to copy-paste fields by hand. Pin both the
  // href shape (?duplicate=<externalId>) AND the CTA text so a refactor
  // that renames either side surfaces at PR time.
  assert.match(DETAIL_TSX, /Duplicate this request/);
  assert.match(DETAIL_TSX, /\/imports\/new\?duplicate=/);
});

test('The duplicate link encodes the externalId (so an exotic id never breaks the URL)', () => {
  // Internal ids are stable hex but the helper still belongs in
  // place: a hand-edited or migrated id with reserved URL chars
  // would otherwise produce a broken query string silently.
  assert.match(DETAIL_TSX, /encodeURIComponent\(request\.externalId\)/);
});

// ── New-form page wires the query param into the form ───────────────

test('NewImportRequestForm reads ?duplicate via useSearchParams', () => {
  assert.match(NEW_FORM_TSX, /searchParams\.get\(['"]duplicate['"]\)/);
});

test('NewImportRequestForm fetches the source request via apiGet on mount', () => {
  // The fetch URL must be /imports/<encoded-id> so org-scoping
  // applies. If a future PR changes the endpoint convention the
  // fetch would 404 and the duplicate flow would silently leave
  // the form empty — pin the URL pattern.
  //
  // Sprint 16 reuse: the fetch variable was renamed from duplicateFrom
  // to prefillFrom so the same hook covers both ?duplicate and
  // ?revise. Pin the abstract pattern (apiGet → /imports/<some-var>)
  // rather than the specific variable name.
  assert.match(NEW_FORM_TSX, /apiGet[\s\S]*?\/imports\/\$\{encodeURIComponent\((duplicateFrom|prefillFrom)\)\}/);
});

test('NewImportRequestForm is wrapped in Suspense (useSearchParams under Next.js 15)', () => {
  // useSearchParams requires a Suspense boundary in Next 15 to avoid
  // breaking static prerendering. The same pattern lives on /imports
  // (sprint 1) and /imports/queue (sprint 1) — pin it here too.
  assert.match(NEW_FORM_TSX, /<Suspense/);
});
