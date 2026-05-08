// PDF / print export tests.
// Sprint S adds @media print CSS rules to start/wizard.css, a "Save as PDF"
// button in the wizard result, and a print-only header. These tests verify
// the static artefacts (CSS rules, app.js wiring, i18n keys) are present;
// the actual PDF rendering is browser-driven and tested manually.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// ── CSS ───────────────────────────────────────────────

test('wizard.css contains @media print block', () => {
  const css = fs.readFileSync(path.join(ROOT, 'start/wizard.css'), 'utf8');
  assert.match(css, /@media print/);
});

test('wizard.css print rules use A4 page size', () => {
  const css = fs.readFileSync(path.join(ROOT, 'start/wizard.css'), 'utf8');
  assert.match(css, /size: A4/);
});

test('wizard.css print rules hide chrome (header, form, share-row, agent CTAs)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'start/wizard.css'), 'utf8');
  // The hide-list rule uses display: none !important on multiple selectors
  for (const sel of ['header\\[data-site-header\\]', '\\.wizard', '\\.share-row', '\\.agent-cta-grid', '\\.print-actions']) {
    assert.match(css, new RegExp(sel), `print CSS hides ${sel}`);
  }
});

test('wizard.css defines .print-header (visible only in print)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'start/wizard.css'), 'utf8');
  assert.match(css, /\.print-header \{ display: none; \}/);
  assert.match(css, /\.print-header[\s\S]*display: block !important/);
});

test('wizard.css print rules force light theme on body and result', () => {
  const css = fs.readFileSync(path.join(ROOT, 'start/wizard.css'), 'utf8');
  assert.match(css, /body[\s\S]*background: white/);
});

test('wizard.css print rules show URL after links', () => {
  const css = fs.readFileSync(path.join(ROOT, 'start/wizard.css'), 'utf8');
  assert.match(css, /content: " \(" attr\(href\) "\)"/);
});

// ── app.js wiring ─────────────────────────────────────

test('start/app.js renders the print-header div', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /class="print-header"/);
  assert.match(js, /printHeaderBrand/);
  assert.match(js, /printHeaderSummary/);
  assert.match(js, /printHeaderMeta/);
});

test('start/app.js renders the Save as PDF + Print buttons', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /id="savePdfBtn"/);
  assert.match(js, /id="printBtn"/);
  assert.match(js, /T\.btnSaveAsPdf/);
  assert.match(js, /T\.btnPrint/);
});

test('start/app.js wires the buttons to window.print()', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /savePdfBtn.*window\.print\(\)/s);
  assert.match(js, /printBtn.*window\.print\(\)/s);
});

// ── i18n parity ───────────────────────────────────────

test('start/i18n.js has btnSaveAsPdf in EN/PL/DE', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'start/i18n.js'), 'utf8');
  // Three occurrences (one per locale)
  const matches = i18n.match(/btnSaveAsPdf:/g);
  assert.ok(matches && matches.length === 3, `expected 3 btnSaveAsPdf entries, got ${matches?.length || 0}`);
});

test('start/i18n.js has btnPrint in EN/PL/DE', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'start/i18n.js'), 'utf8');
  const matches = i18n.match(/btnPrint:/g);
  assert.ok(matches && matches.length === 3);
});

test('start/i18n.js has printHeaderBrand in EN/PL/DE', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'start/i18n.js'), 'utf8');
  const matches = i18n.match(/printHeaderBrand:/g);
  assert.ok(matches && matches.length === 3);
});

test('PL i18n: btnSaveAsPdf is "Zapisz jako PDF"', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'start/i18n.js'), 'utf8');
  assert.match(i18n, /btnSaveAsPdf: 'Zapisz jako PDF'/);
});

test('DE i18n: btnSaveAsPdf is "Als PDF speichern"', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'start/i18n.js'), 'utf8');
  assert.match(i18n, /btnSaveAsPdf: 'Als PDF speichern'/);
});

// ── Print header summary function shape ───────────────

test('printHeaderSummary takes inputs and renders category + route + value + weight', () => {
  // We can't import the file (it sets window.START_I18N), but we can read
  // the EN block and exec the function literal.
  const i18n = fs.readFileSync(path.join(ROOT, 'start/i18n.js'), 'utf8');
  // Quick sanity: the EN function references productCategory + customsValueEur + weightKg
  const enBlock = i18n.slice(i18n.indexOf('en: {'), i18n.indexOf('pl: {'));
  assert.match(enBlock, /printHeaderSummary: \(i\)/);
  assert.match(enBlock, /i\.productCategory/);
  assert.match(enBlock, /i\.customsValueEur/);
  assert.match(enBlock, /i\.weightKg/);
});
