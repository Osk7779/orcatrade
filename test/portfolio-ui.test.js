// Sprint portfolio-v1 (phase 2) — /portfolio/ UI markup + wiring contracts.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'portfolio', 'legacy', 'index.html'), 'utf8');
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'portfolio', 'app.js'), 'utf8');
const ACCOUNT_HTML = fs.readFileSync(path.join(__dirname, '..', 'account', 'index.html'), 'utf8');
const START_APP = fs.readFileSync(path.join(__dirname, '..', 'start', 'app.js'), 'utf8');
const START_I18N = fs.readFileSync(path.join(__dirname, '..', 'start', 'i18n.js'), 'utf8');

// ── Page markup ─────────────────────────────────────────

test('/portfolio/ has a line builder, add button, generate button, result area', () => {
  assert.match(HTML, /id="pfLines"/);
  assert.match(HTML, /id="pfAddLine"/);
  assert.match(HTML, /id="pfGenerate"/);
  assert.match(HTML, /id="pfResult"/);
  // A reusable line template with all the input fields.
  assert.match(HTML, /id="pfLineTemplate"/);
  assert.match(HTML, /class="pf-cat"/);
  assert.match(HTML, /class="pf-origin"/);
  assert.match(HTML, /class="pf-dest"/);
  assert.match(HTML, /class="pf-value"/);
  assert.match(HTML, /class="pf-weight"/);
  assert.match(HTML, /class="pf-hs"/);
});

test('/portfolio/ is noindex (app surface, not marketing/SEO)', () => {
  assert.match(HTML, /<meta name="robots" content="noindex/);
});

test('/portfolio/ loads its app.js', () => {
  assert.match(HTML, /\/portfolio\/app\.js/);
});

// ── app.js wiring ───────────────────────────────────────

test('portfolio app.js loads the catalogue from /api/start', () => {
  assert.match(APP_JS, /fetch\('\/api\/start'/);
  assert.match(APP_JS, /catalogue\.categories/);
  assert.match(APP_JS, /catalogue\.origins/);
  assert.match(APP_JS, /catalogue\.destinations/);
});

test('portfolio app.js POSTs collected lines to /api/portfolio', () => {
  assert.match(APP_JS, /fetch\('\/api\/portfolio'/);
  assert.match(APP_JS, /JSON\.stringify\(\{ lines: lines \}\)/);
  assert.match(APP_JS, /function collectLines/);
});

test('portfolio app.js renders the aggregate: total landed, blended duty, consolidation saving', () => {
  assert.match(APP_JS, /function renderResult/);
  assert.match(APP_JS, /perShipmentLandedTotal/);
  assert.match(APP_JS, /blendedDutyRatePct/);
  assert.match(APP_JS, /consolidationSavingEur/);
  // Per-lane consolidation callout + per-line errors surfaced.
  assert.match(APP_JS, /transportConsolidatable/);
  assert.match(APP_JS, /lineErrors/);
});

test('portfolio app.js keeps at least one line (remove guards on >1)', () => {
  assert.match(APP_JS, /els\.lines\.children\.length > 1/);
});

// ── Cross-links ─────────────────────────────────────────

test('/account/ links to the portfolio planner', () => {
  assert.match(ACCOUNT_HTML, /href="\/portfolio\/"/);
});

test('wizard result links to the portfolio planner (tri-locale string)', () => {
  assert.match(START_APP, /href="\/portfolio\/"/);
  assert.match(START_APP, /btnPlanCatalogue/);
  const count = (START_I18N.match(/btnPlanCatalogue:/g) || []).length;
  assert.ok(count >= 3, 'btnPlanCatalogue should be in all 3 locales, found ' + count);
});
