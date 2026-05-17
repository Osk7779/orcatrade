// GDPR cookie consent banner — Sprint BG-5.2.
//
// Single source of truth for what tracking the site is allowed to do.
// Loads on every page. Shows the banner on first visit. Persists the
// user's choice in localStorage. Re-openable via a footer link by
// dispatching a custom event.
//
// Categories (today):
//   - essential : session cookie, magic-link tokens, cache-preferences.
//                 ALWAYS ON. Required for the platform to work at all.
//   - analytics : Vercel Analytics page-view counts. Opt-in by default
//                 in the strict EU interpretation; we mirror that.
//
// The site does not use marketing / advertising / retargeting cookies.
// If that ever changes, add a third toggle here and explicitly NOT
// fire the marketing script until consent.
//
// Storage shape: localStorage['orcatrade.consent.v1'] = JSON with:
//   { version: 1, decidedAt: ISO, categories: { essential: true, analytics: bool } }
//
// We expose window.orcatradeConsent so other scripts can check before
// firing analytics / pixels — and so a future test can assert the
// consent state without polling the DOM.

(function () {
  'use strict';

  // Bail on non-browser environments (test runner imports the file).
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var STORAGE_KEY = 'orcatrade.consent.v1';
  var DEFAULT_DECISION = { version: 1, decidedAt: null, categories: { essential: true, analytics: false } };

  // ── i18n ─────────────────────────────────────────────────────
  var LANG = (document.documentElement.lang || 'en').slice(0, 2);
  if (LANG !== 'en' && LANG !== 'pl' && LANG !== 'de') LANG = 'en';
  var COPY = {
    en: {
      title: 'Cookies & analytics',
      body: 'OrcaTrade uses essential cookies for sign-in and to remember your preferences. With your consent, we also use Vercel Analytics to measure which pages people read — anonymous page-view counts only, no behavioural tracking.',
      essential: 'Essential',
      essentialDesc: 'Required for sign-in, sessions, and cache preferences. Always on.',
      analytics: 'Analytics',
      analyticsDesc: 'Anonymous page-view counts via Vercel Analytics.',
      accept: 'Accept all',
      reject: 'Reject optional',
      save: 'Save my choice',
      manage: 'Cookie preferences',
      more: 'Read our privacy policy →',
      privacyHref: '/regulations/privacy.html',
    },
    pl: {
      title: 'Pliki cookies i analityka',
      body: 'OrcaTrade używa niezbędnych plików cookies do logowania i zapamiętywania preferencji. Za Twoją zgodą używamy też Vercel Analytics do pomiaru, które strony są czytane — wyłącznie anonimowe liczniki, bez śledzenia zachowań.',
      essential: 'Niezbędne',
      essentialDesc: 'Wymagane do logowania, sesji i preferencji pamięci podręcznej. Zawsze włączone.',
      analytics: 'Analityka',
      analyticsDesc: 'Anonimowe liczniki odsłon przez Vercel Analytics.',
      accept: 'Akceptuj wszystko',
      reject: 'Odrzuć opcjonalne',
      save: 'Zapisz wybór',
      manage: 'Preferencje cookies',
      more: 'Przeczytaj naszą politykę prywatności →',
      privacyHref: '/pl/regulations/privacy.html',
    },
    de: {
      title: 'Cookies & Analyse',
      body: 'OrcaTrade verwendet essenzielle Cookies für Anmeldung und Voreinstellungen. Mit Ihrer Einwilligung nutzen wir auch Vercel Analytics, um zu messen, welche Seiten gelesen werden — nur anonyme Seitenaufruf-Zähler, kein Verhaltens-Tracking.',
      essential: 'Essenziell',
      essentialDesc: 'Erforderlich für Anmeldung, Sitzungen und Cache-Einstellungen. Immer aktiv.',
      analytics: 'Analyse',
      analyticsDesc: 'Anonyme Seitenaufruf-Zähler über Vercel Analytics.',
      accept: 'Alle akzeptieren',
      reject: 'Optionale ablehnen',
      save: 'Auswahl speichern',
      manage: 'Cookie-Einstellungen',
      more: 'Datenschutzerklärung lesen →',
      privacyHref: '/de/regulations/privacy.html',
    },
  };
  var T = COPY[LANG];

  // ── Storage ─────────────────────────────────────────────────
  function readDecision() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1) return null;
      // Always force essential = true (defence against tampering).
      parsed.categories = parsed.categories || {};
      parsed.categories.essential = true;
      return parsed;
    } catch (_) { return null; }
  }

  function writeDecision(decision) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(decision));
    } catch (_) { /* private mode / quota — banner shows again next visit, oh well */ }
  }

  // ── Public API on window ───────────────────────────────────
  window.orcatradeConsent = {
    get: readDecision,
    has: function (category) {
      var d = readDecision();
      if (!d) return false;
      return !!(d.categories && d.categories[category]);
    },
    set: function (categories) {
      writeDecision({
        version: 1,
        decidedAt: new Date().toISOString(),
        categories: Object.assign({ essential: true }, categories || {}),
      });
      applyConsent();
    },
    open: function () { renderBanner(true); },
    STORAGE_KEY: STORAGE_KEY,
  };

  // ── Apply consent → toggle analytics ────────────────────────
  function applyConsent() {
    var d = readDecision();
    var analytics = d && d.categories && d.categories.analytics;
    // Vercel Analytics: we install the script ONLY after consent. Once
    // installed, the va() queue stub keeps the pre-consent calls (there
    // shouldn't be any, but defence in depth).
    if (analytics && !window.__vaInstalled) {
      window.__vaInstalled = true;
      var s = document.createElement('script');
      s.defer = true;
      s.src = '/_vercel/insights/script.js';
      document.head.appendChild(s);
    }
  }

  // ── DOM ─────────────────────────────────────────────────────
  function renderBanner(forceOpen) {
    if (document.getElementById('orcaConsentBanner')) return; // already showing
    var current = readDecision();
    if (current && !forceOpen) {
      // Decision already taken — apply it and don't show the banner.
      applyConsent();
      return;
    }

    var wrap = document.createElement('div');
    wrap.id = 'orcaConsentBanner';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'false');
    wrap.setAttribute('aria-label', T.title);
    wrap.style.cssText = [
      'position:fixed', 'left:1rem', 'right:1rem', 'bottom:1rem',
      'max-width:680px', 'margin:0 auto', 'background:#0a0c12',
      'color:rgba(255,255,255,0.92)', 'border:1px solid rgba(255,255,255,0.12)',
      'padding:1.4rem 1.5rem', 'z-index:10000', 'font-family:Geist,system-ui,sans-serif',
      'box-shadow:0 8px 32px rgba(0,0,0,0.4)', 'line-height:1.5',
    ].join(';');

    var headingId = 'orcaConsentTitle';
    var initAnalytics = current && current.categories && current.categories.analytics;
    wrap.innerHTML = (
      '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:1rem;margin-bottom:0.4rem">'
      + '<h2 id="' + headingId + '" style="font-family:\'Cormorant Garant\',serif;font-size:1.2rem;font-weight:600;margin:0">' + T.title + '</h2>'
      + '<button id="orcaConsentClose" aria-label="Close" style="background:none;border:none;color:rgba(255,255,255,0.5);font-size:1.3rem;cursor:pointer;line-height:1;padding:0">×</button>'
      + '</div>'
      + '<p style="font-size:0.9rem;color:rgba(255,255,255,0.72);margin:0 0 1rem">' + T.body + '</p>'
      + '<div style="display:grid;grid-template-columns:1fr auto;gap:0.6rem 1rem;align-items:start;font-size:0.86rem;margin-bottom:1rem">'
      + '<div><strong style="color:rgba(255,255,255,0.92)">' + T.essential + '</strong><div style="color:rgba(255,255,255,0.55);font-size:0.78rem">' + T.essentialDesc + '</div></div>'
      + '<label style="font-family:\'Geist Mono\',monospace;font-size:0.74rem;color:rgba(255,255,255,0.45);letter-spacing:0.08em;text-transform:uppercase;display:inline-flex;align-items:center;gap:0.4rem"><input type="checkbox" checked disabled style="accent-color:rgba(184,190,200,0.6)" />ON</label>'
      + '<div><strong style="color:rgba(255,255,255,0.92)">' + T.analytics + '</strong><div style="color:rgba(255,255,255,0.55);font-size:0.78rem">' + T.analyticsDesc + '</div></div>'
      + '<label style="display:inline-flex;align-items:center;gap:0.4rem;cursor:pointer"><input id="orcaConsentAnalytics" type="checkbox" ' + (initAnalytics ? 'checked' : '') + ' style="accent-color:rgba(126,210,138,0.9)" /></label>'
      + '</div>'
      + '<div style="display:flex;gap:0.6rem;flex-wrap:wrap;justify-content:flex-end">'
      + '<button id="orcaConsentReject" style="padding:0.55rem 1rem;font:inherit;font-size:0.74rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;background:transparent;color:rgba(255,255,255,0.8);border:1px solid rgba(255,255,255,0.2);cursor:pointer">' + T.reject + '</button>'
      + '<button id="orcaConsentSave" style="padding:0.55rem 1rem;font:inherit;font-size:0.74rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;background:transparent;color:rgba(255,255,255,0.92);border:1px solid rgba(184,190,200,0.4);cursor:pointer">' + T.save + '</button>'
      + '<button id="orcaConsentAccept" style="padding:0.55rem 1rem;font:inherit;font-size:0.74rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;background:rgba(184,190,200,0.92);color:#0a0912;border:1px solid rgba(184,190,200,0.92);cursor:pointer">' + T.accept + '</button>'
      + '</div>'
      + '<div style="margin-top:0.9rem;font-size:0.74rem;color:rgba(255,255,255,0.4)"><a href="' + T.privacyHref + '" style="color:rgba(220,188,110,0.85);text-decoration:none">' + T.more + '</a></div>'
    );

    document.body.appendChild(wrap);

    function close() {
      wrap.parentNode && wrap.parentNode.removeChild(wrap);
    }
    function save(analytics) {
      window.orcatradeConsent.set({ essential: true, analytics: !!analytics });
      close();
    }

    document.getElementById('orcaConsentClose').addEventListener('click', close);
    document.getElementById('orcaConsentReject').addEventListener('click', function () { save(false); });
    document.getElementById('orcaConsentAccept').addEventListener('click', function () { save(true); });
    document.getElementById('orcaConsentSave').addEventListener('click', function () {
      var cb = document.getElementById('orcaConsentAnalytics');
      save(cb && cb.checked);
    });
  }

  // ── Wire up the public "Cookie preferences" link ────────────
  function wireFooterLink() {
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t) return;
      if (t.matches && t.matches('[data-cookie-preferences]')) {
        ev.preventDefault();
        renderBanner(true);
      }
    });
  }

  // ── Bootstrap ───────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { renderBanner(false); wireFooterLink(); });
  } else {
    renderBanner(false);
    wireFooterLink();
  }
})();
