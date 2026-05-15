// Sprint AC — wizard origin-comparison tests.
// The comparison feature is client-side: the renderComparison() function
// reads from plan.originSensitivity.matrix (already computed server-side
// by composePlan in start.js) and produces side-by-side HTML. These tests
// verify static artefacts (CSS, i18n, app.js wiring) and exercise the
// underlying matrix data via composePlan.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { composePlan } = require('../lib/handlers/start');

const ROOT = path.join(__dirname, '..');

// ── App.js wiring ─────────────────────────────────────

test('start/app.js declares renderComparison function', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /function renderComparison\(plan, altOriginCode, panelEl\)/);
});

test('start/app.js wires .compare-btn click handlers', async () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /document\.querySelectorAll\('\.compare-btn\[data-compare-origin\]'\)/);
  assert.match(js, /addEventListener\('click', \(\) => \{[\s\S]*?renderComparison\(plan, targetOrigin, comparisonPanel\)/);
});

test('start/app.js renders Compare button per non-user-pick row', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /class="compare-btn"[\s\S]*?data-compare-origin/);
  assert.match(js, /e\.isUserChoice[\s\S]*?\?[\s\S]*?''/); // skip user pick
});

test('start/app.js emits comparison-panel placeholder', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /class="comparison-panel" id="comparisonPanel" hidden/);
});

test('renderComparison closes panel via #closeComparisonBtn', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /id="closeComparisonBtn"/);
  assert.match(js, /closeBtn\.addEventListener\('click'/);
});

// ── i18n parity ───────────────────────────────────────

test('i18n has btnCompare in EN/PL/DE', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'start/i18n.js'), 'utf8');
  const matches = i18n.match(/btnCompare:/g);
  assert.ok(matches && matches.length === 3, `expected 3 btnCompare entries, got ${matches?.length || 0}`);
});

test('i18n has compareTitle in EN/PL/DE', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'start/i18n.js'), 'utf8');
  const matches = i18n.match(/compareTitle:/g);
  assert.ok(matches && matches.length === 3);
});

test('i18n has compareIntro / compareYourPick / compareAlt / compareDelta / compareClose / compareVerdict per locale', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'start/i18n.js'), 'utf8');
  for (const key of ['compareIntro', 'compareYourPick', 'compareAlt', 'compareDelta', 'compareClose', 'compareVerdict']) {
    const matches = i18n.match(new RegExp(`${key}:`, 'g'));
    assert.ok(matches && matches.length === 3, `${key} should appear in 3 locales`);
  }
});

test('PL i18n: btnCompare is "Porównaj"', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'start/i18n.js'), 'utf8');
  assert.match(i18n, /btnCompare: 'Porównaj'/);
});

test('DE i18n: btnCompare is "Vergleichen"', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'start/i18n.js'), 'utf8');
  assert.match(i18n, /btnCompare: 'Vergleichen'/);
});

// ── CSS ───────────────────────────────────────────────

test('wizard.css defines .comparison-panel + .compare-btn styles', async () => {
  const css = fs.readFileSync(path.join(ROOT, 'start/wizard.css'), 'utf8');
  assert.match(css, /\.comparison-panel \{/);
  assert.match(css, /\.compare-btn \{/);
});

test('wizard.css defines delta-saving (green) and delta-penalty (red) styles', () => {
  const css = fs.readFileSync(path.join(ROOT, 'start/wizard.css'), 'utf8');
  assert.match(css, /\.delta-saving \{[^}]*color: #7ed28a/);
  assert.match(css, /\.delta-penalty \{[^}]*color: #e88080/);
});

// ── Underlying matrix data (composePlan) ──────────────

test('composePlan: matrix has both user pick and at least one alternative for comparison', async () => {
  const plan = await composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
  });
  assert.equal(plan.ok, true);
  const user = plan.originSensitivity.matrix.find(e => e.isUserChoice);
  const alts = plan.originSensitivity.matrix.filter(e => !e.isUserChoice);
  assert.ok(user, 'user pick present');
  assert.ok(alts.length >= 4, `expected ≥4 alternatives, got ${alts.length}`);
});

test('composePlan: VN alternative is cheaper than CN for apparel (EVFTA 0%)', async () => {
  const plan = await composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 50000,
    weightKg: 1500,
  });
  const user = plan.originSensitivity.matrix.find(e => e.origin === 'CN');
  const vn = plan.originSensitivity.matrix.find(e => e.origin === 'VN');
  assert.ok(vn.perShipmentLandedTotal < user.perShipmentLandedTotal,
    `VN landed (€${vn.perShipmentLandedTotal}) should be cheaper than CN (€${user.perShipmentLandedTotal})`);
  assert.equal(vn.preferentialApplied, 'EVFTA');
  assert.equal(user.preferentialApplied, null);
});

test('composePlan: comparison delta is meaningful for typical scenarios', async () => {
  const plan = await composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 50000,
    weightKg: 1500,
    monthlyOrders: 500,
  });
  const user = plan.originSensitivity.matrix.find(e => e.origin === 'CN');
  const cheapest = plan.originSensitivity.matrix[0];
  const dutyDelta = cheapest.dutyRatePct - user.dutyRatePct;
  const landedDelta = cheapest.perShipmentLandedTotal - user.perShipmentLandedTotal;
  // Cheapest alternative should have a meaningful saving (>5%)
  assert.ok(landedDelta < 0, 'cheapest alternative is cheaper');
  assert.ok(Math.abs(landedDelta / user.perShipmentLandedTotal) > 0.05,
    `expected >5% saving, got ${(landedDelta / user.perShipmentLandedTotal * 100).toFixed(1)}%`);
  // Annual data also available
  assert.ok(user.annualLandedTotal > 0);
  assert.ok(cheapest.annualLandedTotal > 0);
});
