// Currency display toggle tests (Sprint AH).
// The toggle is a pure-browser feature — these tests check the CONTRACT it
// requires of start/app.js + i18n strings + CSS, plus a small math model
// of formatInCurrency derived directly from FX_DISPLAY constants.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'start/legacy/app.js'), 'utf8');
const I18N_JS = fs.readFileSync(path.join(__dirname, '..', 'start/legacy/i18n.js'), 'utf8');
const WIZARD_CSS = fs.readFileSync(path.join(__dirname, '..', 'start/legacy/wizard.css'), 'utf8');

// ── Static contract: app.js wires the toggle correctly ────

test('start/legacy/app.js: FX_DISPLAY rates table includes EUR/USD/CNY/VND/PLN', () => {
  assert.match(APP_JS, /FX_DISPLAY\s*=\s*\{/);
  assert.match(APP_JS, /EUR:\s*1\.0/);
  assert.match(APP_JS, /USD:\s*1\.08/);
  assert.match(APP_JS, /CNY:\s*7\.85/);
  assert.match(APP_JS, /VND:\s*26300/);
  assert.match(APP_JS, /PLN:\s*4\.30/);
});

test('start/legacy/app.js: fmtEur emits .amt[data-eur] span', () => {
  assert.match(APP_JS, /class="amt" data-eur=/);
});

test('start/legacy/app.js: applyDisplayCurrency walks .amt[data-eur] nodes', () => {
  assert.match(APP_JS, /applyDisplayCurrency/);
  assert.match(APP_JS, /\.amt\[data-eur\]/);
});

test('start/legacy/app.js: currency preference persists in localStorage', () => {
  assert.match(APP_JS, /CURRENCY_PREF_KEY/);
  assert.match(APP_JS, /localStorage\.setItem\(CURRENCY_PREF_KEY/);
  assert.match(APP_JS, /localStorage\.getItem\(CURRENCY_PREF_KEY/);
});

test('start/legacy/app.js: toggle is rendered into the result block', () => {
  assert.match(APP_JS, /class="currency-toggle"/);
  assert.match(APP_JS, /data-currency=/);
  assert.match(APP_JS, /currency-asof-banner/);
});

// ── i18n parity: EN/PL/DE all carry the toggle label ───

test('i18n: displayCurrencyLabel present in EN/PL/DE', () => {
  const labels = I18N_JS.match(/displayCurrencyLabel:\s*'[^']+'/g) || [];
  assert.equal(labels.length, 3, 'expected three locale entries (en/pl/de)');
});

// ── CSS contract ─────────────────────────────────────

test('wizard.css: .currency-toggle + .currency-btn styles defined', () => {
  assert.match(WIZARD_CSS, /\.currency-toggle\s*\{/);
  assert.match(WIZARD_CSS, /\.currency-btn\s*\{/);
  assert.match(WIZARD_CSS, /\.currency-btn\.active/);
});

// ── Math model: formatInCurrency parity with the inlined snapshot ────
//
// We re-implement the same math used in start/app.js so we can test the
// numeric output without firing up a DOM. If the snapshot rates change,
// update both this constant and the FX_DISPLAY table in start/app.js.

const FX_RATES = { EUR: 1.0, USD: 1.08, CNY: 7.85, VND: 26300, PLN: 4.30 };

function formatLikeApp(eurAmount, currencyCode) {
  const rate = FX_RATES[currencyCode];
  if (rate == null) return null;
  const value = Number(eurAmount) * rate;
  if (!Number.isFinite(value)) return null;
  const symbols = { EUR: '€', USD: '$', CNY: '¥', VND: '₫', PLN: 'zł' };
  const symbol = symbols[currencyCode];
  const dp = currencyCode === 'VND' ? 0 : 0;
  const formatted = value.toLocaleString('en-IE', { maximumFractionDigits: dp, minimumFractionDigits: dp });
  if (currencyCode === 'EUR') return symbol + formatted;
  if (currencyCode === 'VND' || currencyCode === 'PLN') return formatted + ' ' + symbol;
  return symbol + formatted;
}

test('formatInCurrency math: €10,000 in USD ≈ $10,800', () => {
  // 10000 * 1.08 = 10800
  assert.match(formatLikeApp(10000, 'USD'), /\$10,800$/);
});

test('formatInCurrency math: €10,000 in CNY = ¥78,500', () => {
  assert.match(formatLikeApp(10000, 'CNY'), /¥78,500$/);
});

test('formatInCurrency math: €10,000 in VND ≈ 263,000,000 ₫', () => {
  // VND uses thousand separators (en-IE style) and trailing symbol
  assert.match(formatLikeApp(10000, 'VND'), /263,000,000 ₫$/);
});

test('formatInCurrency math: €10,000 in PLN ≈ 43,000 zł', () => {
  assert.match(formatLikeApp(10000, 'PLN'), /43,000 zł$/);
});

test('formatInCurrency math: EUR is identity', () => {
  assert.match(formatLikeApp(2500, 'EUR'), /€2,500$/);
});
