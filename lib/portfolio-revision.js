// Portfolio cost-drift revision email — Sprint portfolio-revision-v1.
//
// Pure builder: given the material movers found by the portfolio
// monitoring cron (saved portfolios whose recomputed landed cost has
// drifted ≥ the significance threshold since save), compose the
// tri-locale (EN/PL/DE) alert email. No I/O — the cron does the
// recompute + send; this just formats.

'use strict';

const ALLOWED_LOCALES = ['en', 'pl', 'de'];

function normaliseLocale(locale) {
  const l = String(locale || 'en').toLowerCase();
  return ALLOWED_LOCALES.includes(l) ? l : 'en';
}

function fmtEur(n) {
  const v = Math.round(Number(n) || 0);
  return '€' + v.toLocaleString('en-IE');
}

const COPY = {
  en: {
    subject: (n) => `${n} of your saved ${n === 1 ? 'portfolio has' : 'portfolios have'} moved on cost`,
    intro: 'We recomputed your saved import portfolios against today’s tariff and freight data. These have moved materially since you saved them:',
    up: (label, eur, pct, date) => `• ${label}: up ${eur} (+${pct}%) since ${date}`,
    down: (label, eur, pct, date) => `• ${label}: down ${eur} (${pct}%) since ${date}`,
    open: (url) => `\nReopen to see the full breakdown: ${url}`,
    foot: (prefsUrl, unsubUrl) => `\n—\nManage these alerts: ${prefsUrl}\nUnsubscribe: ${unsubUrl}`,
    sign: '\n— OrcaTrade Group\n  Warsaw · London · Hong Kong',
  },
  pl: {
    subject: (n) => `${n} z Twoich zapisanych portfeli zmieniło koszt`,
    intro: 'Przeliczyliśmy Twoje zapisane portfele importowe według dzisiejszych danych celnych i frachtowych. Te zmieniły się istotnie od zapisania:',
    up: (label, eur, pct, date) => `• ${label}: wzrost o ${eur} (+${pct}%) od ${date}`,
    down: (label, eur, pct, date) => `• ${label}: spadek o ${eur} (${pct}%) od ${date}`,
    open: (url) => `\nOtwórz, aby zobaczyć pełny rozkład: ${url}`,
    foot: (prefsUrl, unsubUrl) => `\n—\nZarządzaj powiadomieniami: ${prefsUrl}\nWypisz się: ${unsubUrl}`,
    sign: '\n— OrcaTrade Group\n  Warszawa · Londyn · Hongkong',
  },
  de: {
    subject: (n) => `${n} Ihrer gespeicherten Portfolios ${n === 1 ? 'hat' : 'haben'} sich im Preis verändert`,
    intro: 'Wir haben Ihre gespeicherten Import-Portfolios mit den heutigen Zoll- und Frachtdaten neu berechnet. Diese haben sich seit dem Speichern erheblich verändert:',
    up: (label, eur, pct, date) => `• ${label}: gestiegen um ${eur} (+${pct}%) seit ${date}`,
    down: (label, eur, pct, date) => `• ${label}: gesunken um ${eur} (${pct}%) seit ${date}`,
    open: (url) => `\nÖffnen Sie es für die vollständige Aufschlüsselung: ${url}`,
    foot: (prefsUrl, unsubUrl) => `\n—\nBenachrichtigungen verwalten: ${prefsUrl}\nAbmelden: ${unsubUrl}`,
    sign: '\n— OrcaTrade Group\n  Warschau · London · Hongkong',
  },
};

// movers: [{ label, landedDeltaEur, landedDeltaPct, direction, savedAt }]
// Returns { subject, text } — or null when there are no movers.
function buildPortfolioRevisionEmail(locale, movers, opts = {}) {
  if (!Array.isArray(movers) || movers.length === 0) return null;
  const c = COPY[normaliseLocale(locale)];
  const portfolioUrl = opts.portfolioUrl || 'https://orcatrade.pl/account/portfolios/';
  const prefsUrl = opts.prefsUrl || 'https://orcatrade.pl/account/preferences/';
  const unsubUrl = opts.unsubUrl || 'https://orcatrade.pl/account/preferences/';

  const lines = movers.map((m) => {
    const date = String(m.savedAt || '').slice(0, 10);
    const eur = fmtEur(Math.abs(m.landedDeltaEur));
    const pct = Math.abs(Number(m.landedDeltaPct) || 0).toFixed(1);
    return m.direction === 'down'
      ? c.down(m.label, eur, '-' + pct, date)
      : c.up(m.label, eur, pct, date);
  });

  const text = c.intro + '\n\n' + lines.join('\n') + '\n' + c.open(portfolioUrl) + c.foot(prefsUrl, unsubUrl) + c.sign;
  return { subject: c.subject(movers.length), text };
}

module.exports = { ALLOWED_LOCALES, normaliseLocale, buildPortfolioRevisionEmail };
