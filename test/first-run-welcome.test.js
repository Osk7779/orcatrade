// Sprint first-run-welcome-v1 — first-run hero on /account/.
//
// Closes the dangling ?welcome=1 redirect from password-auth-v1
// (signup-confirm redirects there but nothing read it) and broadens it
// into a real first-run experience: the hero shows when ?welcome=1 is
// present OR onboarding reports zero completed steps (a brand-new user
// arriving by any path, e.g. first-ever magic-link sign-in).
//
// No backend change — reuses /api/account/onboarding (which already
// returns progress.completed). Tests are markup + JS-contract, the same
// pattern onboarding-v1 used for its /account/ wiring.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'account', 'index.html'), 'utf8');
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'account', 'app.js'), 'utf8');
const AUTH_HANDLER = fs.readFileSync(path.join(__dirname, '..', 'lib', 'handlers', 'auth.js'), 'utf8');

// ── Markup contract ─────────────────────────────────────

test('/account/: welcome-hero slot present + hidden by default', () => {
  assert.match(HTML, /id="welcome-hero"/);
  // Hidden by default so returning users never flash the hero.
  assert.match(HTML, /id="welcome-hero"[^>]*\shidden/);
});

test('/account/: returning-header present (the non-first-run default)', () => {
  assert.match(HTML, /id="returning-header"/);
  assert.match(HTML, /Welcome back/);
});

test('/account/: hero CTA points at /start/ (build first plan)', () => {
  // The hero's primary action is the first onboarding step.
  var heroBlock = HTML.slice(HTML.indexOf('id="welcome-hero"'), HTML.indexOf('id="returning-header"'));
  assert.match(heroBlock, /href="\/start\/"/);
  assert.match(heroBlock, /wh-cta/);
});

test('/account/: welcome-hero CSS class is defined', () => {
  assert.match(HTML, /\.welcome-hero\s*\{/);
  assert.match(HTML, /\.welcome-hero \.wh-title/);
  assert.match(HTML, /\.welcome-hero \.wh-cta/);
});

// ── JS contract ─────────────────────────────────────────

test('account/app.js: consumeWelcomeParam reads ?welcome=1 and strips it', () => {
  assert.match(APP_JS, /function consumeWelcomeParam/);
  assert.match(APP_JS, /get\('welcome'\)\s*===\s*'1'/);
  // Strips via replaceState so a refresh doesn't re-show the hero.
  assert.match(APP_JS, /replaceState/);
  assert.match(APP_JS, /params\.delete\('welcome'\)/);
});

test('account/app.js: applyFirstRun toggles hero vs returning header', () => {
  assert.match(APP_JS, /function applyFirstRun/);
  assert.match(APP_JS, /getElementById\('welcome-hero'\)/);
  assert.match(APP_JS, /getElementById\('returning-header'\)/);
});

test('account/app.js: first-run fires on ?welcome=1 immediately after sign-in', () => {
  assert.match(APP_JS, /if \(consumeWelcomeParam\(\)\) applyFirstRun\(true\)/);
});

test('account/app.js: first-run also fires on zero onboarding progress', () => {
  assert.match(APP_JS, /data\.progress\.completed\s*===\s*0.*applyFirstRun\(true\)/);
});

test('account/app.js: applyFirstRun is idempotent (guards on firstRunShown)', () => {
  assert.match(APP_JS, /firstRunShown/);
  // The "on && firstRunShown" early return prevents double-application
  // when both signals (param + zero progress) fire on the same load.
  assert.match(APP_JS, /if \(on && firstRunShown\) return/);
});

// ── Backend: signup-confirm still redirects to ?welcome=1 ──

test('signup-confirm redirects to /account/?welcome=1 when no returnTo', () => {
  // The receiving end now exists; confirm the producer is intact.
  assert.match(AUTH_HANDLER, /\/account\/\?welcome=1/);
  // returnTo (subscribe-resume) still takes precedence over welcome.
  assert.match(AUTH_HANDLER, /returnTo \|\| '\/account\/\?welcome=1'/);
});
