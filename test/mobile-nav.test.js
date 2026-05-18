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

// ── Mobile lang switcher layout (BG-5.6 follow-up fix) ─

test('CSS hides the lang switcher in the mobile header by default', () => {
  // Inside the 840px breakpoint there must be a rule that hides the
  // top-bar lang switcher — otherwise it crowds the hamburger + clips
  // the brand at narrow widths.
  const css = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8');
  const mobileBlock = css.match(/@media\s*\(max-width:\s*840px\)\s*\{[\s\S]*?\n\}/g);
  assert.ok(mobileBlock && mobileBlock.length, 'expected a max-width:840px block');
  // At least one of the 840px blocks must declare .lang-switcher { display: none }.
  const hasHide = mobileBlock.some(b => /\.lang-switcher\s*\{\s*display:\s*none;?\s*\}/.test(b));
  assert.ok(hasHide, '.lang-switcher must be display:none inside the mobile breakpoint');
});

test('CSS surfaces the lang switcher inside the OPEN mobile menu overlay', () => {
  // When .nav-links.is-open is present, the sibling .lang-switcher must
  // be repositioned (display:flex + position:fixed) so it lands at the
  // bottom of the open menu, not in the cramped header bar.
  const css = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8');
  assert.match(css, /\.nav-links\.is-open\s*~\s*\.lang-switcher\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.nav-links\.is-open\s*~\s*\.lang-switcher\s*\{[^}]*position:\s*fixed/);
});

// ── Header must not trap the position:fixed menu overlay ────────
//
// CSS properties that create a containing block on an ancestor will
// re-anchor `position: fixed` descendants to that ancestor instead of
// the viewport. For the mobile menu (.nav-links { position: fixed;
// inset: 0 }) this means the "fullscreen" overlay collapses to the
// header's bounds and page content shows below it — exactly the bug
// the user saw on their phone. Pin every offending property OFF the
// <header> element. The same visual effects (blur, gradient) live on
// header::before, which has no descendants and so traps nothing.

test('CSS: <header> must NOT have backdrop-filter (it traps the mobile menu overlay)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8');
  // Find the bare `header { ... }` blocks (NOT header::before or header.scrolled).
  const headerBlocks = [...css.matchAll(/(?:^|\n)header\s*\{([\s\S]*?)\n\}/g)].map(m => m[1]);
  assert.ok(headerBlocks.length, 'expected at least one bare `header { ... }` block');
  for (const block of headerBlocks) {
    assert.doesNotMatch(block, /backdrop-filter\s*:/,
      'backdrop-filter on <header> creates a containing block that breaks the mobile menu');
  }
});

test('CSS: header::before owns the backdrop-filter (preserves blur without containing-block trap)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8');
  assert.match(css, /header::before\s*\{[^}]*backdrop-filter\s*:\s*blur/);
});

test('CSS: <header> must NOT carry transform/filter/perspective either (containing-block traps)', () => {
  // The same trap applies to transform, filter, perspective. We never
  // want them on the bare <header> element for the same reason.
  const css = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8');
  const headerBlocks = [...css.matchAll(/(?:^|\n)header\s*\{([\s\S]*?)\n\}/g)].map(m => m[1]);
  for (const block of headerBlocks) {
    assert.doesNotMatch(block, /(?:^|\s|;)transform\s*:/,
      'transform on <header> would create a containing block');
    assert.doesNotMatch(block, /(?:^|\s|;)filter\s*:/,
      'filter on <header> would create a containing block');
    assert.doesNotMatch(block, /(?:^|\s|;)perspective\s*:/,
      'perspective on <header> would create a containing block');
  }
});
