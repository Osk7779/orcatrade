// Tests for js/cookie-consent.js — Sprint BG-5.2.
//
// Strategy: load the module under a JSDOM-style stub of window/document/
// localStorage built manually (so we don't add jsdom as a dependency).
// Assert the public surface (window.orcatradeConsent) behaves correctly
// across the three lifecycle paths: first visit, decision persisted,
// decision read back.
//
// We also assert that the favicon injector's analytics block now loads
// js/cookie-consent.js instead of the Vercel script directly — the
// hard guarantee that pre-consent page-loads cannot fire analytics.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'js', 'cookie-consent.js');
const SCRIPT_TEXT = fs.readFileSync(SCRIPT_PATH, 'utf8');

// ── Module-source contract tests ─────────────────────────────────

test('cookie-consent.js is non-trivial', () => {
  assert.ok(SCRIPT_TEXT.length > 2000, 'cookie-consent should be substantial');
});

test('cookie-consent.js declares three locales (en/pl/de)', () => {
  for (const lang of ['en:', 'pl:', 'de:']) {
    assert.ok(SCRIPT_TEXT.includes(lang), `${lang} block present`);
  }
});

test('cookie-consent.js exposes the expected public API', () => {
  for (const m of ['get:', 'has:', 'set:', 'open:', 'STORAGE_KEY:']) {
    assert.ok(SCRIPT_TEXT.includes(m), `public method ${m} present`);
  }
});

test('cookie-consent.js storage key is versioned', () => {
  assert.match(SCRIPT_TEXT, /orcatrade\.consent\.v1/);
});

test('cookie-consent.js never installs Vercel Analytics without consent', () => {
  // The /_vercel/insights/script.js install must be gated by the analytics flag.
  // Specifically: it should appear inside an `if (analytics)` block, not at
  // top level. Pin by asserting the script-tag string appears AFTER an
  // `analytics &&` check in source order.
  const installIdx = SCRIPT_TEXT.indexOf('/_vercel/insights/script.js');
  assert.ok(installIdx > 0, 'Vercel insights install path present');
  const before = SCRIPT_TEXT.slice(0, installIdx);
  assert.match(before, /analytics\s*&&/, 'Vercel install must be gated on analytics consent');
});

test('cookie-consent.js force-rewrites essential=true on read (anti-tamper)', () => {
  // Defence in depth: even if a user edits localStorage to set
  // essential:false, the read path must still return true for that field.
  assert.match(SCRIPT_TEXT, /categories\.essential\s*=\s*true/);
});

test('cookie-consent.js wires a footer-link hook via [data-cookie-preferences]', () => {
  assert.match(SCRIPT_TEXT, /data-cookie-preferences/);
});

// ── Favicon-injector contract test ───────────────────────────────

test('scripts/inject-favicon-tags.js loads the consent module, not Vercel Analytics directly', () => {
  const inj = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'inject-favicon-tags.js'), 'utf8');
  // ANALYTICS_BLOCK should reference the consent module, not the raw insights script.
  // Locate the ANALYTICS_BLOCK template literal and assert it.
  const blockStart = inj.indexOf('const ANALYTICS_BLOCK');
  assert.ok(blockStart > 0, 'ANALYTICS_BLOCK declaration present');
  const blockEnd = inj.indexOf('`;', blockStart);
  const block = inj.slice(blockStart, blockEnd);
  assert.match(block, /\/js\/cookie-consent\.js/, 'ANALYTICS_BLOCK must reference the consent module');
  assert.doesNotMatch(block, /\/_vercel\/insights\/script\.js/,
    'ANALYTICS_BLOCK must NOT reference the raw Vercel script — load it dynamically from cookie-consent.js');
});

// ── Live module behaviour (minimal JS-DOM stub) ──────────────────

function makeElementStub() {
  const el = {
    style: { cssText: '' },
    attributes: {},
    children: [],
    innerHTML: '',
    defer: false,
    src: '',
    setAttribute(k, v) { this.attributes[k] = v; },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener() {},
  };
  return el;
}

test('orcatradeConsent.set + get round-trip works under a stub environment', () => {
  // Build a tiny stub of the browser globals.
  const storage = new Map();
  const stubLocalStorage = {
    getItem: (k) => storage.has(k) ? storage.get(k) : null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  const stubDoc = {
    documentElement: { lang: 'en' },
    readyState: 'loading',  // skip the auto-renderBanner path
    addEventListener: () => {},
    body: makeElementStub(),
    head: makeElementStub(),
    getElementById: () => null,
    createElement: () => makeElementStub(),
  };
  const stubWindow = {
    localStorage: stubLocalStorage,
    document: stubDoc,
  };

  // Eval the module with the stub globals in scope. (We can't require()
  // it because it's browser code with no module.exports; an isolated VM
  // context with our stubs is the cheapest way to exercise it.)
  const vm = require('node:vm');
  const ctx = { window: stubWindow, document: stubDoc };
  vm.createContext(ctx);
  vm.runInContext(SCRIPT_TEXT, ctx);

  assert.ok(stubWindow.orcatradeConsent, 'window.orcatradeConsent exposed');

  // First read: nothing saved.
  assert.equal(stubWindow.orcatradeConsent.get(), null);
  assert.equal(stubWindow.orcatradeConsent.has('analytics'), false);
  assert.equal(stubWindow.orcatradeConsent.has('essential'), false);

  // Accept analytics.
  stubWindow.orcatradeConsent.set({ analytics: true });
  const decision = stubWindow.orcatradeConsent.get();
  assert.equal(decision.version, 1);
  assert.equal(decision.categories.essential, true);
  assert.equal(decision.categories.analytics, true);
  assert.match(decision.decidedAt, /^\d{4}-\d{2}-\d{2}T/);

  // Reject analytics.
  stubWindow.orcatradeConsent.set({ analytics: false });
  assert.equal(stubWindow.orcatradeConsent.has('analytics'), false);
  assert.equal(stubWindow.orcatradeConsent.has('essential'), true);
});

test('cookie-consent.js auto-injects a Cookie preferences footer link', () => {
  // BG-5.2 closeout: GDPR requires consent be as easy to withdraw as to
  // give. Every page with a <footer> gets a Cookie preferences link
  // appended automatically — no per-page edit needed.
  assert.match(SCRIPT_TEXT, /injectFooterLink/);
  assert.match(SCRIPT_TEXT, /data-cookie-preferences/);
  // The injector must skip pages that already declare the data-attribute,
  // so the privacy page (which has its own link) doesn't duplicate.
  assert.match(SCRIPT_TEXT, /querySelector\(['"]\[data-cookie-preferences\]['"]\)/);
});

test('tampered localStorage with essential:false still reads as essential:true', () => {
  const storage = new Map();
  storage.set('orcatrade.consent.v1', JSON.stringify({
    version: 1, decidedAt: '2026-05-17T00:00:00Z',
    categories: { essential: false, analytics: false },
  }));
  const stubLocalStorage = {
    getItem: (k) => storage.has(k) ? storage.get(k) : null,
    setItem: (k, v) => storage.set(k, String(v)),
  };
  const stubDoc = {
    documentElement: { lang: 'en' },
    readyState: 'loading',
    addEventListener: () => {},
    body: makeElementStub(),
    head: makeElementStub(),
    getElementById: () => null,
    createElement: () => makeElementStub(),
  };
  const ctx = { window: { localStorage: stubLocalStorage, document: stubDoc }, document: stubDoc };
  const vm = require('node:vm');
  vm.createContext(ctx);
  vm.runInContext(SCRIPT_TEXT, ctx);

  const decision = ctx.window.orcatradeConsent.get();
  assert.equal(decision.categories.essential, true, 'tampered essential:false should be force-corrected to true');
});
