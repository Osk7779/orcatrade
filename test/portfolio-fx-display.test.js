// Sprint portfolio-fx-display-v1 — display-currency toggle on the
// portfolio result. The behaviour is browser DOM wiring; we assert the
// JS + CSS contract (same approach as other /portfolio/ UI sprints).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'portfolio', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'portfolio', 'legacy', 'index.html'), 'utf8');

test('portfolio app.js defines a multi-currency FX display table incl. EUR/USD/GBP/PLN', () => {
  assert.match(APP_JS, /var FX = \{/);
  for (const code of ['EUR', 'USD', 'GBP', 'PLN']) {
    assert.match(APP_JS, new RegExp(code + ':\\s*\\{ rate:'));
  }
});

test('the money formatter converts from EUR using the active display currency', () => {
  // fmtEur multiplies the EUR amount by the active currency's rate.
  assert.match(APP_JS, /function fmtEur\(eur\)/);
  assert.match(APP_JS, /Number\(eur\) \* c\.rate/);
});

test('display currency persists to localStorage + restores on load', () => {
  assert.match(APP_JS, /FX_PREF_KEY/);
  assert.match(APP_JS, /localStorage\.setItem\(FX_PREF_KEY/);
  assert.match(APP_JS, /localStorage\.getItem\(FX_PREF_KEY\)/);
});

test('renderResult emits a currency toggle + re-renders the same data on switch', () => {
  assert.match(APP_JS, /id="pfCurrency"/);
  assert.match(APP_JS, /pf-cur-btn/);
  assert.match(APP_JS, /data-cur=/);
  // Toggling re-renders the stashed result (no recompute) and skips the scroll.
  assert.match(APP_JS, /lastResultData/);
  assert.match(APP_JS, /renderResult\(lastResultData, \{ skipScroll: true \}\)/);
});

test('CSV export stays canonical EUR regardless of display currency', () => {
  // The CSV endpoint serialises server-side EUR; the client never sends a
  // display currency to it. (Guards against accidentally exporting a
  // converted/indicative figure as the canonical record.)
  assert.match(APP_JS, /\/api\/portfolio\/csv/);
  assert.ok(!/portfolio\/csv[\s\S]{0,200}displayCurrency/.test(APP_JS), 'CSV request must not carry a display currency');
});

test('currency toggle CSS present (active state + indicative note)', () => {
  assert.match(HTML, /\.pf-cur-btn/);
  assert.match(HTML, /\.pf-cur-btn\.active/);
  assert.match(HTML, /\.pf-cur-note/);
});
