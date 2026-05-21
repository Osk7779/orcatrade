// Sprint hs-refine-v1 — in-result "get a precise rate" lookup.
//
// When the wizard result shows a chapter-estimator duty and the user
// didn't supply a usable HS code, an inline lookup lets them pick a code
// and re-run in place (rerunPlan) → live-TARIC heading rate. This closes
// the hs-suggest loop end-to-end. Tests are JS/CSS/i18n contracts (the
// behaviour is browser DOM wiring, same approach as hs-suggest-v1's
// wizard-wiring test).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'start', 'app.js'), 'utf8');
const I18N = fs.readFileSync(path.join(__dirname, '..', 'start', 'i18n.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'start', 'wizard.css'), 'utf8');

// ── Reusable builder ────────────────────────────────────

test('createHsLookup is a reusable builder returning { toggle, panel }', () => {
  assert.match(APP_JS, /function createHsLookup\(onPick, opts\)/);
  assert.match(APP_JS, /return \{ toggle, panel \}/);
  // Fires the caller's onPick with the chosen HS6 code.
  assert.match(APP_JS, /if \(typeof onPick === 'function'\) onPick\(hs\)/);
  // Debounced search against the suggest endpoint lives in the builder.
  assert.match(APP_JS, /debounceTimer/);
  assert.match(APP_JS, /\/api\/hs-suggest\?q=/);
});

test('mountHsLookup is built on createHsLookup and fills #hsCode', () => {
  assert.match(APP_JS, /function mountHsLookup/);
  assert.match(APP_JS, /createHsLookup\(function \(hs\) \{\s*hsInput\.value = hs/);
  // Idempotent guard so it isn't mounted twice.
  assert.match(APP_JS, /_hsLookupMounted/);
});

// ── Result-side refine ──────────────────────────────────

test('renderPlan stashes the inputs behind the rendered plan', () => {
  assert.match(APP_JS, /state\.lastInputs = \{ \.\.\.inputs \}/);
});

test('refine is gated: chapter-estimator AND user gave no 6+ digit code', () => {
  assert.match(APP_JS, /providedHsDigits = String\(inputs\.hsCode \|\| ''\)\.replace\(\/\\D\/g, ''\)/);
  assert.match(APP_JS, /canRefineDuty = mfnSource === 'chapter-estimator' && providedHsDigits\.length < 6/);
  // A mount point is only emitted when refinement is possible.
  assert.match(APP_JS, /dutyRefineMount = canRefineDuty \? '<div id="dutyRefineMount"/);
});

test('picking a code in the result re-runs the same inputs with that HS code', () => {
  // The in-result lookup's onPick re-runs via rerunPlan, merging the
  // chosen code into the remembered inputs.
  assert.match(APP_JS, /rerunPlan\(\{ \.\.\.state\.lastInputs, hsCode: hs \}\)/);
  // Mounted into the placeholder only when canRefineDuty.
  assert.match(APP_JS, /if \(canRefineDuty\) \{[\s\S]*getElementById\('dutyRefineMount'\)/);
});

test('the refine mount is placed in the customs section markup', () => {
  // dutyRefineMount must be interpolated into the result template right
  // after the duty-source badge.
  assert.match(APP_JS, /\$\{dutySourceBadge\}\s*\n\s*\$\{dutyRefineMount\}/);
});

// ── i18n across EN/PL/DE ────────────────────────────────

test('hsRefineIntro + hsRefineCta exist in all 3 locales', () => {
  for (const key of ['hsRefineIntro', 'hsRefineCta']) {
    const count = (I18N.match(new RegExp(key + ':', 'g')) || []).length;
    assert.ok(count >= 3, `${key} should appear in all 3 locales, found ${count}`);
  }
});

// ── CSS ─────────────────────────────────────────────────

test('refine block has CSS + is hidden in print', () => {
  assert.match(CSS, /\.duty-refine\s*\{/);
  assert.match(CSS, /\.duty-refine-intro/);
  assert.match(CSS, /@media print \{ \.duty-refine \{ display: none/);
});

test('hs-lookup query is now class-based (reusable, no duplicate IDs)', () => {
  // The builder uses a class so two instances (form + result) don't
  // collide on a fixed element id.
  assert.match(APP_JS, /queryInput\.className = 'hs-lookup-query'/);
  assert.match(CSS, /\.hs-lookup \.hs-lookup-query/);
});
