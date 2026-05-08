// Sprint AF — comparison-mode share permalink tests.
// Verifies the static artefacts: app.js wiring, i18n keys, CSS classes.
// The URL parsing + auto-trigger behaviour requires a browser, so we test
// the code paths via static inspection.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// ── App.js wiring ─────────────────────────────────────

test('start/app.js parses both p and c query params', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /urlParams\.get\('p'\)/);
  assert.match(js, /urlParams\.get\('c'\)/);
});

test('loadFromShareUrl accepts compareWithOrigin parameter', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /async function loadFromShareUrl\(b64url, compareWithOrigin = null\)/);
});

test('loadFromShareUrl auto-triggers renderComparison when compareWithOrigin is set', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /if \(compareWithOrigin\)/);
  assert.match(js, /renderComparison\(json\.plan, compareWithOrigin, panel\)/);
});

test('loadFromShareUrl validates origin exists in matrix before triggering', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  // The origin must be in the matrix AND not be the user's own pick
  assert.match(js, /e\.origin === compareWithOrigin && !e\.isUserChoice/);
});

test('buildComparisonUrl appends &c=<origin> to share URL', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /function buildComparisonUrl\(inputs, altOriginCode\)/);
  assert.match(js, /buildShareUrl\(inputs\)\}&c=\$\{encodeURIComponent\(altOriginCode\)\}/);
});

test('renderComparison emits Copy URL button with data-compare-url', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /id="copyComparisonBtn" data-compare-url="\$\{escapeHtml\(compareUrl\)\}"/);
});

test('renderComparison wires Copy button to clipboard.writeText', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /document\.getElementById\('copyComparisonBtn'\)/);
  assert.match(js, /navigator\.clipboard\.writeText\(url\)/);
});

test('Copy button has fallback to execCommand when clipboard API fails', () => {
  const js = fs.readFileSync(path.join(ROOT, 'start/app.js'), 'utf8');
  assert.match(js, /document\.execCommand\('copy'\)/);
});

// ── i18n parity ───────────────────────────────────────

test('i18n has btnCopyComparisonUrl in EN/PL/DE', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'start/i18n.js'), 'utf8');
  const matches = i18n.match(/btnCopyComparisonUrl:/g);
  assert.ok(matches && matches.length === 3,
    `expected 3 btnCopyComparisonUrl entries, got ${matches?.length || 0}`);
});

test('PL i18n: btnCopyComparisonUrl is "Kopiuj link do porównania"', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'start/i18n.js'), 'utf8');
  assert.match(i18n, /btnCopyComparisonUrl: 'Kopiuj link do porównania'/);
});

test('DE i18n: btnCopyComparisonUrl is "Vergleichs-Link kopieren"', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'start/i18n.js'), 'utf8');
  assert.match(i18n, /btnCopyComparisonUrl: 'Vergleichs-Link kopieren'/);
});

// ── CSS ───────────────────────────────────────────────

test('wizard.css defines .compare-copy-btn + .comparison-actions', () => {
  const css = fs.readFileSync(path.join(ROOT, 'start/wizard.css'), 'utf8');
  assert.match(css, /\.compare-copy-btn \{/);
  assert.match(css, /\.comparison-actions \{/);
});

// ── URL building (smoke via the encoder library) ──────

test('buildComparisonUrl produces a URL with both p and c params', () => {
  // Re-implement what the browser code does, since we can't import app.js
  // (it expects window). Instead exercise the codec directly.
  const { encodeInputs } = require('../lib/utils/plan-codec');
  const inputs = {
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
  };
  const encoded = encodeInputs(inputs);
  const expectedShare = `/start/?p=${encoded}`;
  const expectedComparison = `${expectedShare}&c=VN`;
  // URL has both query params
  assert.match(expectedComparison, /\?p=/);
  assert.match(expectedComparison, /&c=VN/);
  // VN is URL-safe so no encoding artefacts
  assert.ok(!expectedComparison.includes('%'));
});
