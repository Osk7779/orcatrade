// Sprint auth-i18n-v1 — tri-locale (EN/PL/DE) for the pre-auth funnel.
// The module is browser code (window/document/navigator), so we exercise
// it in an isolated node:vm context with stubbed globals — same pattern
// as test/cookie-consent.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPT_PATH = path.join(__dirname, '..', 'js', 'auth-i18n.js');
const SCRIPT_TEXT = fs.readFileSync(SCRIPT_PATH, 'utf8');

// Minimal DOM element stub that records data-i18n application.
function makeElementStub(attrs) {
  return {
    _attrs: attrs || {},
    textContent: '',
    getAttribute(k) { return this._attrs[k] != null ? this._attrs[k] : null; },
    setAttribute(k, v) { this._attrs[k] = v; },
  };
}

// Run auth-i18n.js with a stubbed window/document/navigator. `search` is
// the URL query string (e.g. '?lang=pl'); `navLang` is navigator.language.
// `i18nEls` / `phEls` are the elements that carry data-i18n / data-i18n-ph.
function runModule({ search = '', navLang = 'en-US', i18nEls = [], phEls = [] } = {}) {
  const docEl = { _lang: 'en', getAttribute() { return this._lang; }, setAttribute(k, v) { if (k === 'lang') this._lang = v; } };
  const stubDoc = {
    documentElement: docEl,
    readyState: 'complete', // run applyAuthI18n immediately
    addEventListener() {},
    querySelectorAll(sel) {
      if (sel === '[data-i18n]') return i18nEls;
      if (sel === '[data-i18n-ph]') return phEls;
      return [];
    },
  };
  const stubWindow = {
    location: { search },
    document: stubDoc,
    navigator: { language: navLang },
  };
  const ctx = {
    window: stubWindow,
    document: stubDoc,
    navigator: stubWindow.navigator,
    URLSearchParams,
  };
  vm.createContext(ctx);
  vm.runInContext(SCRIPT_TEXT, ctx);
  return { ctx, stubWindow, stubDoc, docEl };
}

// ── Locale detection ────────────────────────────────────

test('detectLocale: ?lang=pl wins over navigator', () => {
  const { stubWindow } = runModule({ search: '?lang=pl', navLang: 'de-DE' });
  assert.equal(stubWindow.authLocale, 'pl');
});

test('detectLocale: ?lang=de wins over navigator', () => {
  const { stubWindow } = runModule({ search: '?lang=de', navLang: 'pl-PL' });
  assert.equal(stubWindow.authLocale, 'de');
});

test('detectLocale: falls back to navigator.language prefix', () => {
  const { stubWindow } = runModule({ search: '', navLang: 'pl-PL' });
  assert.equal(stubWindow.authLocale, 'pl');
});

test('detectLocale: navigator de-AT → de', () => {
  const { stubWindow } = runModule({ search: '', navLang: 'de-AT' });
  assert.equal(stubWindow.authLocale, 'de');
});

test('detectLocale: unknown navigator language → en', () => {
  const { stubWindow } = runModule({ search: '', navLang: 'fr-FR' });
  assert.equal(stubWindow.authLocale, 'en');
});

test('detectLocale: ?lang=fr (unsupported) ignored → falls to navigator', () => {
  const { stubWindow } = runModule({ search: '?lang=fr', navLang: 'pl-PL' });
  assert.equal(stubWindow.authLocale, 'pl');
});

// ── authT resolution ────────────────────────────────────

test('authT: returns Polish string under ?lang=pl', () => {
  const { stubWindow } = runModule({ search: '?lang=pl' });
  assert.equal(stubWindow.authT('signupTitle'), 'Załóż konto OrcaTrade');
  assert.equal(stubWindow.authT('btnSignIn'), 'Zaloguj się');
});

test('authT: returns German string under ?lang=de', () => {
  const { stubWindow } = runModule({ search: '?lang=de' });
  assert.equal(stubWindow.authT('signupTitle'), 'OrcaTrade-Konto erstellen');
  assert.equal(stubWindow.authT('forgotPassword'), 'Passwort vergessen?');
});

test('authT: falls back to EN for a key missing in a locale, then to the key itself', () => {
  const { stubWindow } = runModule({ search: '?lang=pl' });
  // Unknown key → returns the key (last-resort fallback)
  assert.equal(stubWindow.authT('totally_unknown_key'), 'totally_unknown_key');
});

// ── Dictionary completeness — every key in EN exists in PL + DE ──

test('every EN key has a PL and DE translation (no missing strings)', () => {
  const { stubWindow } = runModule({ search: '' });
  const dict = stubWindow.AUTH_I18N;
  const enKeys = Object.keys(dict.en);
  const missingPl = enKeys.filter((k) => dict.pl[k] == null);
  const missingDe = enKeys.filter((k) => dict.de[k] == null);
  assert.deepEqual(missingPl, [], 'PL missing keys: ' + missingPl.join(', '));
  assert.deepEqual(missingDe, [], 'DE missing keys: ' + missingDe.join(', '));
});

test('PL + DE carry no keys absent from EN (no orphan strings)', () => {
  const { stubWindow } = runModule({ search: '' });
  const dict = stubWindow.AUTH_I18N;
  const enKeys = new Set(Object.keys(dict.en));
  const orphanPl = Object.keys(dict.pl).filter((k) => !enKeys.has(k));
  const orphanDe = Object.keys(dict.de).filter((k) => !enKeys.has(k));
  assert.deepEqual(orphanPl, [], 'PL orphan keys: ' + orphanPl.join(', '));
  assert.deepEqual(orphanDe, [], 'DE orphan keys: ' + orphanDe.join(', '));
});

// ── applyAuthI18n: DOM application ──────────────────────

test('applyAuthI18n sets textContent on [data-i18n] elements', () => {
  const titleEl = makeElementStub({ 'data-i18n': 'signupTitle' });
  const btnEl = makeElementStub({ 'data-i18n': 'btnSignIn' });
  runModule({ search: '?lang=pl', i18nEls: [titleEl, btnEl] });
  assert.equal(titleEl.textContent, 'Załóż konto OrcaTrade');
  assert.equal(btnEl.textContent, 'Zaloguj się');
});

test('applyAuthI18n sets placeholder on [data-i18n-ph] elements', () => {
  const inputEl = makeElementStub({ 'data-i18n-ph': 'phNewPassword' });
  runModule({ search: '?lang=de', phEls: [inputEl] });
  assert.equal(inputEl.getAttribute('placeholder'), 'Mindestens 12 Zeichen');
});

test('applyAuthI18n reflects non-EN locale onto <html lang>', () => {
  const { docEl } = runModule({ search: '?lang=pl' });
  assert.equal(docEl.getAttribute('lang'), 'pl');
});

test('applyAuthI18n leaves <html lang> alone for EN', () => {
  const { docEl } = runModule({ search: '?lang=en', navLang: 'en-US' });
  assert.equal(docEl.getAttribute('lang'), 'en');
});

// ── Page wiring contracts ───────────────────────────────

test('/signup/ loads auth-i18n.js + carries data-i18n on key elements', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'signup', 'index.html'), 'utf8');
  assert.match(html, /\/js\/auth-i18n\.js/);
  assert.match(html, /data-i18n="signupTitle"/);
  assert.match(html, /data-i18n="btnSendLink"/);
  assert.match(html, /data-i18n-ph="phEmail"/);
});

test('/account/ sign-in state loads auth-i18n.js + carries data-i18n', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'index.html'), 'utf8');
  assert.match(html, /\/js\/auth-i18n\.js/);
  assert.match(html, /data-i18n="signinTitle"/);
  assert.match(html, /data-i18n="forgotPassword"/);
  assert.match(html, /data-i18n="createOne"/);
});

test('/account/reset/ loads auth-i18n.js + carries data-i18n', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'reset', 'index.html'), 'utf8');
  assert.match(html, /\/js\/auth-i18n\.js/);
  assert.match(html, /data-i18n="resetTitle"/);
  assert.match(html, /data-i18n="resetNoTokenTitle"/);
  assert.match(html, /data-i18n="resetDoneTitle"/);
});

test('app.js files resolve dynamic strings through window.authT', () => {
  const accountJs = fs.readFileSync(path.join(__dirname, '..', 'account', 'app.js'), 'utf8');
  const signupJs = fs.readFileSync(path.join(__dirname, '..', 'signup', 'app.js'), 'utf8');
  const resetJs = fs.readFileSync(path.join(__dirname, '..', 'account', 'reset', 'app.js'), 'utf8');
  for (const js of [accountJs, signupJs, resetJs]) {
    assert.match(js, /window\.authT/);
    assert.match(js, /function T\(key, fallback\)/);
  }
});
