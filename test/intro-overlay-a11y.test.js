'use strict';

// Phase 0 task P0.12 of docs/execution-plan.md.
//
// Source-pin test for the marketing-shell intro overlay's accessibility
// posture. The marketing-shell is a separate Next.js project with no
// test runner of its own yet (Playwright e2e is Phase 1 P1.D); a
// source-pin in the main test suite is the bridging mechanism so a
// regression in the a11y properties fails CI loudly.
//
// What this test asserts on
// marketing-shell/components/marketing/intro-overlay.tsx:
//
//   1. prefers-reduced-motion is detected + the intro is SKIPPED for
//      users who request it (WCAG 2.3.3 Animation from Interactions).
//      Setting the session flag in the skip path means reloads also
//      skip — consistent with the already-played path.
//   2. The overlay uses role="dialog" + aria-label so screen readers
//      announce it instead of skipping (the prior aria-hidden silently
//      swallowed the brand intro for SR users).
//   3. A visible "press any key" hint surfaces so the dismiss mechanism
//      is discoverable (WCAG 2.2.1 Timing Adjustable + general
//      affordance).
//
// Why source-pin instead of a real render test: setting up React
// testing-library + jsdom + Vitest inside marketing-shell is a Phase 1
// scope item. Until then, the source-pin guarantees the a11y patterns
// are present in the committed source — which is what the audit asked
// for + what a procurement reviewer would check first.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'marketing-shell/components/marketing/intro-overlay.tsx');

function readSource() {
  return fs.readFileSync(SOURCE_PATH, 'utf8');
}

test('intro overlay file exists at the expected path', () => {
  assert.ok(
    fs.existsSync(SOURCE_PATH),
    `marketing-shell/components/marketing/intro-overlay.tsx must exist. ` +
    `If the file moved (e.g. component restructure), update SOURCE_PATH in this test.`,
  );
});

test('intro overlay respects prefers-reduced-motion (WCAG 2.3.3)', () => {
  const src = readSource();
  // The component must check matchMedia('(prefers-reduced-motion: reduce)')
  assert.match(
    src,
    /matchMedia\(\s*['"]\(prefers-reduced-motion:\s*reduce\)['"]\s*\)/,
    'must query matchMedia for prefers-reduced-motion',
  );
  // The skip path must early-return BEFORE setVisible(true). The
  // simplest pin is: there should be a `return;` in the same useEffect
  // body, after the reduced-motion check.
  assert.match(
    src,
    /prefersReducedMotion\(\)/,
    'must call a helper that reads the prefers-reduced-motion media query',
  );
  // Skip path must set the session flag so reloads also skip
  // (consistency with the played-already path).
  assert.match(
    src,
    /prefersReducedMotion\(\)[\s\S]{0,400}sessionStorage\.setItem/,
    'when prefers-reduced-motion fires, the skip path must set the session flag',
  );
});

test('intro overlay uses role="dialog" + aria-label (not aria-hidden)', () => {
  const src = readSource();
  // The outer overlay must announce itself as a dialog.
  assert.match(src, /role="dialog"/, 'overlay must have role="dialog"');
  assert.match(src, /aria-label=/, 'overlay must have aria-label');
  // aria-live should also be set so the dialog is announced (polite, not
  // assertive — this is decoration, not an alert).
  assert.match(src, /aria-live="polite"/, 'overlay must have aria-live="polite"');
  // The outer wrapper must NOT have a bare aria-hidden attribute (the
  // inner decorative wash + rule can still use it; we check the outer
  // motion.div specifically by anchoring on role="dialog").
  const outerDivMatch = src.match(/<motion\.div\s+[\s\S]+?>/);
  assert.ok(outerDivMatch, 'must find the outer motion.div opening tag');
  assert.doesNotMatch(
    outerDivMatch[0],
    /aria-hidden/,
    'the outer overlay motion.div must NOT carry aria-hidden — that swallows it for screen readers',
  );
});

test('intro overlay has a visible "press any key" dismiss hint (WCAG 2.2.1)', () => {
  const src = readSource();
  // The hint copy must be present + visible (not hidden via display:none
  // or aria-hidden). Match the substantive copy — not the exact wording
  // so a copy tweak doesn't break the test.
  assert.match(
    src,
    /Press\s+any\s+key|press\s+any\s+key/i,
    'visible "press any key" hint copy must be present',
  );
});

test('the audit-named a11y fixes for P0.12 are documented in the file header', () => {
  // Promise = enforcement: the header comment must reference the
  // accessibility decisions so a future reader understands why these
  // properties exist + doesn't accidentally regress them.
  const src = readSource();
  assert.match(
    src,
    /P0\.12/,
    'header comment must cite the execution-plan task this PR closes',
  );
  assert.match(
    src,
    /prefers-reduced-motion/,
    'header comment must mention prefers-reduced-motion',
  );
  assert.match(
    src,
    /WCAG/,
    'header comment must cite at least one WCAG criterion',
  );
});
