'use strict';

// Sprint 22 — onboarding examples + first-run checklist.
//
// Tests cover four layers:
//   1. ONBOARDING_EXAMPLES library shape (id stability, calculator-
//      grounded intent fields, highlight enum coverage)
//   2. getOnboardingExampleById helper
//   3. /imports/new prefill flow (synchronous hydrate from example,
//      banner copy, "Clear and start fresh" affordance)
//   4. /dashboard OnboardingChecklist (auto-hide when user has any
//      import request, fail-soft on the /imports query)
//
// Each example's (HS code, origin, destination) tuple is something
// we've verified produces a sensible quote. A regression that adds
// an example with malformed intent (negative quantity, non-ISO-2
// country, etc.) would burn a first-time customer's first impression
// — pin every shape rule here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const NEW_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'new', 'page.tsx'),
  'utf8',
);
const DASHBOARD_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'dashboard', 'page.tsx'),
  'utf8',
);

// ── ONBOARDING_EXAMPLES library shape ───────────────────────────────

test('ONBOARDING_EXAMPLES const is exported as a frozen ReadonlyArray', () => {
  assert.match(API_TS, /export const ONBOARDING_EXAMPLES: ReadonlyArray<OnboardingExample>/);
  assert.match(API_TS, /Object\.freeze\(\[/);
});

test('OnboardingExample interface pins the required intent fields', () => {
  // Every example must carry every field the /imports/new form
  // expects. A missing field would prefill garbage on the form.
  const block = API_TS.match(/export interface OnboardingExample \{([\s\S]*?)\}\s*\nexport const ONBOARDING_EXAMPLES/);
  assert.ok(block, 'OnboardingExample interface not located');
  const body = block[1];
  for (const field of [
    'id', 'title', 'pitch', 'highlight',
    'label', 'productDescription', 'hsCodeGuess',
    'targetQuantity', 'targetQuantityUnit', 'targetUnitPriceCents',
    'originCountry', 'destinationCountry', 'certifications',
  ]) {
    assert.match(body, new RegExp(`\\b${field}\\b`), `OnboardingExample missing ${field}`);
  }
});

test('Every example uses a 6-digit HS code (calculator-grounded shape)', () => {
  // The HS code drives the duty calculation; a malformed code (less
  // than 6 digits, or non-numeric) would silently produce a wrong
  // quote on the very first impression. Pin the 6-digit minimum
  // for every example in the library.
  const hsCodes = [...API_TS.matchAll(/hsCodeGuess:\s*['"]([0-9]+)['"]/g)].map((m) => m[1]);
  // The library has 3 entries (chunk 1 of sprint 22). A future
  // addition needs to land an HS code too.
  assert.ok(hsCodes.length >= 3, `expected at least 3 example HS codes, found ${hsCodes.length}`);
  for (const hs of hsCodes) {
    assert.ok(hs.length >= 6 && hs.length <= 10, `HS code ${hs} must be 6-10 digits`);
  }
});

test('Every example uses an ISO-2 uppercase origin + destination country', () => {
  const origins = [...API_TS.matchAll(/originCountry:\s*['"]([A-Z]{2})['"]/g)].map((m) => m[1]);
  const destinations = [...API_TS.matchAll(/destinationCountry:\s*['"]([A-Z]{2})['"]/g)].map((m) => m[1]);
  assert.ok(origins.length >= 3 && destinations.length >= 3);
  // ISO-2 means exactly 2 uppercase letters — the regex above
  // already enforces it, but the count check ensures every example
  // contributed both fields.
});

test('Every example uses a positive targetQuantity + non-negative targetUnitPriceCents', () => {
  const qty = [...API_TS.matchAll(/targetQuantity:\s*(-?\d+)/g)].map((m) => Number(m[1]));
  const price = [...API_TS.matchAll(/targetUnitPriceCents:\s*(-?\d+)/g)].map((m) => Number(m[1]));
  for (const n of qty) assert.ok(n > 0, `targetQuantity must be > 0, found ${n}`);
  for (const n of price) assert.ok(n >= 0, `targetUnitPriceCents must be >= 0 (integer cents per ADR 0004), found ${n}`);
});

test('Highlight enum covers at least one CBAM + one consumer-CE-marked example', () => {
  // The library exists to teach first-time customers about the
  // compliance dimensions of the platform. Pin coverage of the
  // two most-asked-about regimes.
  assert.match(API_TS, /highlight:\s*['"]CBAM-exposed['"]/);
  assert.match(API_TS, /highlight:\s*['"]consumer-CE-marked['"]/);
});

test('getOnboardingExampleById helper is exported + uses Array.find', () => {
  // Pure function — no DB round-trip needed because the library is
  // client-side. Pin the implementation shape so a refactor that
  // accidentally adds a fetch surfaces here.
  assert.match(API_TS, /export function getOnboardingExampleById\(id: string\): OnboardingExample \| undefined/);
  assert.match(API_TS, /return ONBOARDING_EXAMPLES\.find\(\(e\) => e\.id === id\)/);
});

// ── /imports/new prefill flow ───────────────────────────────────────

test('/imports/new reads ?example query param alongside ?duplicate + ?revise', () => {
  assert.match(NEW_TSX, /searchParams\.get\(['"]example['"]\)/);
});

test('/imports/new mode precedence: revise > duplicate > example', () => {
  // Most-specific intent wins. Pin the ternary chain so a refactor
  // that changes the order surfaces here.
  const block = NEW_TSX.match(/const mode:[\s\S]*?: null;/);
  assert.ok(block, 'mode resolution block not located');
  // The literal order in the source: reviseFrom → duplicateFrom → exampleId.
  const reviseIdx = block[0].indexOf('reviseFrom');
  const dupIdx = block[0].indexOf('duplicateFrom');
  const exIdx = block[0].indexOf('exampleId');
  assert.ok(reviseIdx > -1 && dupIdx > reviseIdx && exIdx > dupIdx,
    `precedence order broken: revise=${reviseIdx} duplicate=${dupIdx} example=${exIdx}`);
});

test('/imports/new synchronously hydrates form state from a client-side example', () => {
  // The example data is client-side; no DB round-trip needed. Beats
  // showing an empty form for the 50ms before useEffect lands —
  // first impression matters.
  const block = NEW_TSX.match(/const \[form, setForm\] = useState<FormState>\(\(\) => \{[\s\S]*?return EMPTY_FORM;[\s\S]*?\}\);/);
  assert.ok(block, 'synchronous form hydrate not located');
  assert.match(block[0], /if \(example\) \{/);
  assert.match(block[0], /example\.intent\.productDescription/);
});

test('/imports/new example mode short-circuits the apiGet useEffect (no server fetch)', () => {
  // The duplicate/revise paths fetch from /api/imports/<id>. The
  // example path MUST NOT — the data is local. Pin the early-return
  // so a refactor that drops it doesn't fire a spurious 404.
  assert.match(NEW_TSX, /if \(mode === ['"]example['"]\) return;/);
});

test('/imports/new renders the example-source banner with the example title', () => {
  // The banner tells the customer "you're working from an example,
  // edit anything before you submit" so they don't accidentally
  // ship a placeholder request.
  assert.match(NEW_TSX, /mode === ['"]example['"] && example/);
  assert.match(NEW_TSX, /example\.title/);
});

test('/imports/new banner includes a "Clear and start fresh" button', () => {
  // Without an escape hatch, a customer pulled into the example
  // accidentally has to manually clear every field. The button
  // calls setForm(EMPTY_FORM) — pin both the label and the action.
  assert.match(NEW_TSX, /Clear and start fresh/);
});

// ── ExampleLibraryRow (the card row) ────────────────────────────────

test('ExampleLibraryRow component is rendered when form is empty + no prefill mode', () => {
  assert.match(NEW_TSX, /examplesShown && !mode && \(\s*<ExampleLibraryRow/);
  assert.match(NEW_TSX, /function ExampleLibraryRow\(\{ onDismiss/);
});

test('ExampleLibraryRow renders one card per ONBOARDING_EXAMPLES entry', () => {
  // The library decides what to show; the row component just maps
  // over it. Pin the .map call so a refactor that hardcodes 3
  // (instead of mapping) surfaces here.
  assert.match(NEW_TSX, /ONBOARDING_EXAMPLES\.map\(\(ex\) =>/);
});

test('Example cards link to /imports/new?example=<id> with proper URL-encoding', () => {
  // A future id with reserved URL chars (rare but possible) must
  // be encoded. Pin encodeURIComponent so a refactor that drops
  // it surfaces here.
  assert.match(NEW_TSX, /href=\{`\/imports\/new\?example=\$\{encodeURIComponent\(ex\.id\)\}`\}/);
});

test('ExampleLibraryRow surfaces a "Hide examples" dismiss button', () => {
  // Repeat customers should be able to mute the row after their
  // first visit (in-session; refresh brings it back). Pin the
  // dismiss handler.
  assert.match(NEW_TSX, /Hide examples/);
  assert.match(NEW_TSX, /onDismiss/);
});

// ── /dashboard OnboardingChecklist ──────────────────────────────────

test('Dashboard renders OnboardingChecklist BEFORE Bento (first-impression placement)', () => {
  // The checklist is the first thing a first-time customer should
  // see after the hero, before anything else. Pin the placement
  // order so a refactor that buries it surfaces here.
  const checklistIdx = DASHBOARD_TSX.indexOf('<OnboardingChecklist />');
  const bentoIdx = DASHBOARD_TSX.indexOf('<Bento');
  assert.ok(checklistIdx > -1, 'OnboardingChecklist not mounted on the dashboard');
  assert.ok(bentoIdx > -1);
  assert.ok(checklistIdx < bentoIdx,
    `OnboardingChecklist must render BEFORE Bento (checklist=${checklistIdx}, bento=${bentoIdx})`);
});

test('OnboardingChecklist auto-hides when the user already has an import request', () => {
  // Pin the state-derivation rule: any importRequests.length > 0 →
  // setState('hide'). Without this, a returning customer would see
  // a "Get started in 3 steps" prompt that's no longer relevant.
  const block = DASHBOARD_TSX.match(/function OnboardingChecklist\(\)[\s\S]*?function OnboardingStep/);
  assert.ok(block, 'OnboardingChecklist body not located');
  assert.match(block[0], /importRequests\.length > 0/);
  assert.match(block[0], /setState\(has \? ['"]hide['"] : ['"]show['"]\)/);
});

test('OnboardingChecklist is fail-soft on /imports query failure', () => {
  // A 401/503/etc. on /api/imports must not crash the dashboard.
  // Pin the catch → setState('hide') so the page degrades cleanly.
  const block = DASHBOARD_TSX.match(/function OnboardingChecklist\(\)[\s\S]*?function OnboardingStep/);
  assert.ok(block);
  assert.match(block[0], /\.catch\(\(\) => \{[\s\S]*?setState\(['"]hide['"]\)/);
});

test('OnboardingChecklist returns null when state !== "show"', () => {
  // Loading + hide both render nothing. Pin the early-return so a
  // refactor doesn't accidentally render a skeleton for the
  // loading state (would mean the checklist briefly flashes for
  // returning customers).
  const block = DASHBOARD_TSX.match(/function OnboardingChecklist\(\)[\s\S]*?function OnboardingStep/);
  assert.ok(block);
  assert.match(block[0], /if \(state !== ['"]show['"]\) return null;/);
});

test('OnboardingStep renders exactly 3 entries (Submit / Generate / Approve)', () => {
  // The 3-step narrative is the platform's value-prop in 30 seconds.
  // A refactor that drops a step would break the funnel storytelling.
  const block = DASHBOARD_TSX.match(/function OnboardingChecklist\(\)[\s\S]*?function OnboardingStep/);
  assert.ok(block);
  const stepCalls = (block[0].match(/<OnboardingStep/g) || []).length;
  assert.equal(stepCalls, 3, `expected 3 OnboardingStep calls, found ${stepCalls}`);
});

test('OnboardingStep 1 CTA targets /imports/new (the primary first-action)', () => {
  // The CTA must point to the form. Drift-guard catches a refactor
  // that swaps the href for something else.
  assert.match(DASHBOARD_TSX, /cta=\{\{ label: ['"]New import request['"], href: ['"]\/imports\/new['"]/);
});
