// Sprint AG — scenario-toggle tests.
// Re-run with claimed preferential is a client-side flow that calls
// /api/start with a modified claimPreferential flag. We verify the static
// artefacts (button rendering, click wiring, i18n keys) and the underlying
// composePlan behaviour that backs both states.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { composePlan } = require('../lib/handlers/start');

const ROOT = path.join(__dirname, '..');

// ── App.js wiring ─────────────────────────────────────

test('start/app.js declares rerunPlan helper', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /async function rerunPlan\(inputs\)/);
});

test('rerunPlan posts to /api/start with locale-augmented inputs', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /const payload = \{ \.\.\.inputs, locale: LOCALE \}/);
  assert.match(js, /fetch\('\/api\/start'/);
});

test('app.js exposes rerunWithPrefBtn click handler that flips claimPreferential', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /rerunWithPrefBtn/);
  assert.match(js, /claimPreferential: true/);
});

test('app.js stashes baseline inputs before re-running', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /state\.baselineInputs = \{ \.\.\.inputs \}/);
  assert.match(js, /state\.scenarioClaimed = true/);
});

test('app.js wires switchBackBtn to restore baseline inputs', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /switchBackBtn/);
  assert.match(js, /state\.scenarioClaimed = false/);
  assert.match(js, /state\.baselineInputs = null/);
});

test('preferential-available callout renders the rerun button', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  // Button only present in the prefAvailable + mfnReplaced + savings>0 branch
  assert.match(js, /id="rerunWithPrefBtn"[\s\S]*T\.btnRerunWithPref/);
});

test('scenario banner renders when scenarioClaimed && prefApplied', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /state\.scenarioClaimed && prefApplied/);
  assert.match(js, /scenario-banner/);
  assert.match(js, /id="switchBackBtn"/);
});

// ── i18n parity ───────────────────────────────────────

test('i18n has btnRerunWithPref + btnScenarioSwitchBack + scenarioBannerActive in EN/PL/DE', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'start/i18n.js'), 'utf8');
  for (const key of ['btnRerunWithPref', 'btnScenarioSwitchBack', 'scenarioBannerActive']) {
    const matches = i18n.match(new RegExp(`${key}:`, 'g'));
    assert.ok(matches && matches.length === 3, `${key}: expected 3 entries, got ${matches?.length || 0}`);
  }
});

test('PL i18n: btnRerunWithPref is "Przelicz plan z tym zadeklarowanym →"', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'start/i18n.js'), 'utf8');
  assert.match(i18n, /btnRerunWithPref: 'Przelicz plan z tym zadeklarowanym →'/);
});

test('DE i18n: btnRerunWithPref is "Plan mit diesem beanspruchen →"', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'start/i18n.js'), 'utf8');
  assert.match(i18n, /btnRerunWithPref: 'Plan mit diesem beanspruchen →'/);
});

// ── CSS ───────────────────────────────────────────────

test('wizard.css defines .scenario-banner + .pref-rerun-btn', async () => {
  const css = fs.readFileSync(path.join(ROOT, 'start/wizard.css'), 'utf8');
  assert.match(css, /\.scenario-banner \{/);
  assert.match(css, /\.btn-secondary\.pref-rerun-btn \{/);
});

// ── State shape ───────────────────────────────────────

test('app.js state object includes scenarioClaimed + baselineInputs', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /scenarioClaimed: false/);
  assert.match(js, /baselineInputs: null/);
});

// ── Underlying composePlan behaviour ──────────────────

test('composePlan: BD apparel claim=false → preferentialAvailable surfaces', async () => {
  const plan = await composePlan({
    productCategory: 'apparel',
    originCountry: 'BD',
    destinationCountry: 'PL',
    customsValueEur: 50000,
    weightKg: 1500,
    claimPreferential: false,
  });
  assert.equal(plan.ok, true);
  // The "available" callout is only shown when:
  //   prefAvailable && mfnReplaced && preferentialSavingEur > 0
  assert.ok(plan.customs.preferentialAvailable);
  assert.equal(plan.customs.preferentialAvailable.mfnReplaced, true);
  assert.ok(plan.customs.preferentialSavingEur > 0);
});

test('composePlan: BD apparel claim=true → preferentialApplied is set, duty is 0%', async () => {
  const plan = await composePlan({
    productCategory: 'apparel',
    originCountry: 'BD',
    destinationCountry: 'PL',
    customsValueEur: 50000,
    weightKg: 1500,
    claimPreferential: true,
  });
  assert.equal(plan.ok, true);
  assert.ok(plan.customs.preferentialApplied);
  assert.equal(plan.customs.preferentialApplied.code, 'EBA');
  assert.equal(plan.customs.duty.ratePercent, 0);
});

test('composePlan: scenario-toggle delta produces meaningful saving', async () => {
  const baseline = await composePlan({
    productCategory: 'apparel',
    originCountry: 'BD',
    destinationCountry: 'PL',
    customsValueEur: 50000,
    weightKg: 1500,
    claimPreferential: false,
  });
  const claimed = await composePlan({
    productCategory: 'apparel',
    originCountry: 'BD',
    destinationCountry: 'PL',
    customsValueEur: 50000,
    weightKg: 1500,
    claimPreferential: true,
  });
  // EBA on €50K apparel: 12% MFN → 0% = €6,000 saving in duty
  const deltaDuty = baseline.totals.dutyEur - claimed.totals.dutyEur;
  assert.ok(deltaDuty > 5000, `expected >€5000 saving, got €${deltaDuty}`);
  // The saving amount surfaced in baseline.customs.preferentialSavingEur
  // should match the actual delta within rounding
  assert.ok(Math.abs(baseline.customs.preferentialSavingEur - deltaDuty) < 100);
});
