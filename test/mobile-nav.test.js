// Mobile-nav regression — pins the rule that ONLY js/site-nav.js may
// attach a click handler to .nav-toggle.
//
// Backstory: an older main.js shipped its own initMobileNav() that
// attached a SECOND click listener to the same hamburger button. The
// two handlers fired in source order and cancelled each other (open →
// close), so the mobile menu silently refused to open. js/site-nav.js
// is the only canonical handler today (it's locale-aware + manages
// the Tools dropdown). This test fails if main.js (or any other JS
// file) regrows its own copy.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function readJs(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ── Sole-owner contract ───────────────────────────────

test('only js/site-nav.js attaches a click handler to .nav-toggle', () => {
  // Walk every JS file under /js and assert .nav-toggle is referenced
  // only inside site-nav.js.
  const jsDir = path.join(ROOT, 'js');
  const files = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
  const offenders = [];
  for (const f of files) {
    if (f === 'site-nav.js') continue;
    const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
    if (src.indexOf('nav-toggle') !== -1) offenders.push(f);
  }
  assert.deepEqual(offenders, [],
    'These JS files mention .nav-toggle and risk a duplicate click handler: ' + offenders.join(', '));
});

test('js/main.js does not define a mobile-nav initialiser (handler moved to site-nav.js)', () => {
  const main = readJs('js/main.js');
  // Specifically forbid the function DEFINITION and any call site —
  // a comment that mentions the name (explaining the move) is fine.
  assert.doesNotMatch(main, /function\s+initMobileNav\s*\(/,
    'main.js must not define initMobileNav() — it conflicts with site-nav.js');
  assert.doesNotMatch(main, /initMobileNav\(\s*\)\s*;/,
    'main.js must not call initMobileNav() — it conflicts with site-nav.js');
});

// ── site-nav.js still owns the contract ───────────────

test('site-nav.js renders <button class="nav-toggle">', () => {
  const src = readJs('js/site-nav.js');
  assert.match(src, /class=["']nav-toggle["']/);
  assert.match(src, /aria-expanded=["']false["']/);
});

test('site-nav.js bindMobileNav attaches a click listener that toggles .is-open', () => {
  const src = readJs('js/site-nav.js');
  assert.match(src, /toggle\.addEventListener\(['"]click['"]/);
  // The handler must add .is-open to .nav-links.
  assert.match(src, /links\.classList\.add\(['"]is-open['"]\)/);
});

test('CSS shows .nav-links.is-open as display: flex inside the 840px breakpoint', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8');
  // Pin both halves of the contract: the fullscreen overlay rule AND
  // the is-open visibility rule, both inside the mobile breakpoint.
  assert.match(css, /@media\s*\(max-width:\s*840px\)/);
  assert.match(css, /\.nav-links\.is-open\s*\{\s*display:\s*flex;?\s*\}/);
});
