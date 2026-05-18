// Sprint weekly-digest-v1 — pure aggregator + EN/PL/DE email formatters.
//
// Calendar-triggered weekly email summarising a single user's saved-plan
// portfolio:
//
//   - planCount             total plans saved
//   - planCountSignificant  plans whose current landed cost has moved
//                           >= 5% vs the snapshot at save time
//   - planCountWithActuals  plans where the user logged a real landed cost
//   - topMover              the plan with the largest |deltaPct| (if any)
//   - calibration           value-weighted estimate-vs-actual roll-up
//                           (same shape as actuals.summariseActuals)
//
// Caller responsibility:
//   - Loads the user's saved-plan records (with snapshots + actuals).
//   - Recomputes each plan's CURRENT snapshot via composePlan + plan-diff
//     and attaches it to the record as `currentSnapshot` BEFORE calling
//     buildDigestPayload. We deliberately keep composePlan side-effects
//     out of this module so digest.js stays pure + offline-testable.
//
// Email-shape rationale: the per-plan revision email (BG-J era) is
// event-triggered + emits only when a plan moves >= 5%. The weekly
// digest is calendar-triggered + always fires (subject to opt-out)
// when the user has any plans. The digest body deliberately does NOT
// re-narrate each moved plan — the revision email already does that.
// The digest answers "where are you across your whole portfolio?"
// The revision email answers "this plan changed."

'use strict';

const planDiff = require('./plan-diff');
const actuals = require('./actuals');

// Minimum |deltaPct| to call a plan "significant" — matches plan-diff's
// own threshold (5%) so the count surfaced in the digest agrees with
// what the user would see in /account/plans/.
const SIGNIFICANT_PCT = 5;

function safeNumber(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function roundEur(n) {
  return Math.round(safeNumber(n, 0));
}

// pure: takes plain records with snapshot + currentSnapshot + actualVariance
// (caller pre-computes), returns the digest payload.
function buildDigestPayload(plans, opts = {}) {
  const safe = Array.isArray(plans) ? plans : [];
  let countSignificant = 0;
  let countWithActuals = 0;
  let topMover = null; // largest |deltaPct|

  for (const p of safe) {
    if (!p) continue;
    if (p.snapshot && p.currentSnapshot) {
      const delta = planDiff.diffSnapshots(p.snapshot, p.currentSnapshot, p.savedAt);
      if (delta) {
        const absPct = Math.abs(safeNumber(delta.landedDeltaPct));
        if (absPct >= SIGNIFICANT_PCT) {
          countSignificant++;
        }
        if (!topMover || absPct > Math.abs(safeNumber(topMover.landedDeltaPct))) {
          topMover = {
            planId: p.id || null,
            label: p.label || null,
            landedDeltaEur: roundEur(delta.landedDeltaEur),
            landedDeltaPct: safeNumber(delta.landedDeltaPct),
            direction: safeNumber(delta.landedDeltaEur) >= 0 ? 'up' : 'down',
            primaryDriver: delta.primaryDriver || null,
          };
        }
      }
    }
    if (p.actual && p.actualVariance) countWithActuals++;
  }

  // Reuse the per-user calibration aggregator we already ship for
  // /account/plans/. Same value-weighted math, same output shape.
  const calibration = actuals.summariseActuals(safe);

  return {
    asOf: opts.asOf || new Date().toISOString(),
    planCount: safe.length,
    planCountSignificant: countSignificant,
    planCountWithActuals: countWithActuals,
    topMover, // may be null if no plan has a current snapshot
    calibration,
  };
}

// ── EN / PL / DE plain-text bodies ────────────────────

const LOCALES = ['en', 'pl', 'de'];
const ALLOWED_LOCALES = new Set(LOCALES);

function fmtEur(n) {
  const v = roundEur(n);
  const abs = Math.abs(v).toLocaleString('en-IE');
  return (v < 0 ? '-' : '') + '€' + abs;
}

function fmtPctSigned(n) {
  const v = safeNumber(n, 0);
  const sign = v > 0 ? '+' : (v < 0 ? '' : '');
  return sign + (Math.round(v * 10) / 10) + '%';
}

const COPY = {
  en: {
    subject: (n) => 'OrcaTrade weekly · ' + n + ' plan' + (n === 1 ? '' : 's') + ' saved',
    headline: (n) => 'Here\'s where your saved plans stand this week (' + n + ' total).',
    movedNone: 'No plan has moved more than 5% vs the snapshot you saved.',
    movedOne: 'One plan has moved ≥5% vs your saved snapshot.',
    movedMany: (n) => n + ' plans have moved ≥5% vs your saved snapshots.',
    topMoverLine: (m) => 'Top mover: "' + (m.label || m.planId) + '" — landed cost ' + (m.direction === 'up' ? 'up' : 'down') + ' ' + fmtEur(m.landedDeltaEur) + ' (' + fmtPctSigned(m.landedDeltaPct) + ').',
    actualsNone: 'You haven\'t logged a real outcome on any plan yet — once you do, this digest reports value-weighted variance.',
    actualsLine: (c) => 'Calibration: ' + c.withActuals + ' outcome' + (c.withActuals === 1 ? '' : 's') + ' logged · estimate ran ' + (c.avgVariancePct >= 0 ? '+' : '') + (Math.round(c.avgVariancePct * 10) / 10) + '% vs reality (value-weighted).',
    cta: 'See full breakdown:',
    foot: '— OrcaTrade · weekly digest',
    unsub: 'Not interested? One-click unsubscribe: ',
    prefs: 'Manage all your email preferences at ',
  },
  pl: {
    subject: (n) => 'OrcaTrade tygodniowo · ' + n + ' plan' + (n === 1 ? '' : 'y/-ów') + ' zapisan' + (n === 1 ? 'y' : 'ych'),
    headline: (n) => 'Oto stan Twoich zapisanych planów w tym tygodniu (' + n + ' w sumie).',
    movedNone: 'Żaden plan nie przesunął się o więcej niż 5% w stosunku do zapisanego snapshotu.',
    movedOne: 'Jeden plan przesunął się o ≥5% w stosunku do Twojego snapshotu.',
    movedMany: (n) => n + ' planów przesunęło się o ≥5% w stosunku do Twoich snapshotów.',
    topMoverLine: (m) => 'Największa zmiana: „' + (m.label || m.planId) + '" — koszt landed ' + (m.direction === 'up' ? 'wzrósł o' : 'spadł o') + ' ' + fmtEur(Math.abs(m.landedDeltaEur)) + ' (' + fmtPctSigned(m.landedDeltaPct) + ').',
    actualsNone: 'Nie zalogowałeś jeszcze rzeczywistego wyniku dla żadnego planu — kiedy to zrobisz, digest pokaże wariancję ważoną wartością.',
    actualsLine: (c) => 'Kalibracja: ' + c.withActuals + ' wynik' + (c.withActuals === 1 ? '' : 'i') + ' zalogowan' + (c.withActuals === 1 ? 'y' : 'e') + ' · estymata była o ' + (c.avgVariancePct >= 0 ? '+' : '') + (Math.round(c.avgVariancePct * 10) / 10) + '% vs rzeczywistość (ważone wartością).',
    cta: 'Pełna analiza:',
    foot: '— OrcaTrade · digest tygodniowy',
    unsub: 'Nie interesuje Cię? Wypisz się jednym kliknięciem: ',
    prefs: 'Zarządzaj preferencjami e-mail na ',
  },
  de: {
    subject: (n) => 'OrcaTrade Wochen-Digest · ' + n + ' Plan' + (n === 1 ? '' : 'e') + ' gespeichert',
    headline: (n) => 'So stehen Ihre gespeicherten Pläne diese Woche (' + n + ' insgesamt).',
    movedNone: 'Kein Plan hat sich um mehr als 5% gegenüber dem gespeicherten Snapshot bewegt.',
    movedOne: 'Ein Plan hat sich um ≥5% gegenüber Ihrem gespeicherten Snapshot bewegt.',
    movedMany: (n) => n + ' Pläne haben sich um ≥5% gegenüber Ihren gespeicherten Snapshots bewegt.',
    topMoverLine: (m) => 'Größte Bewegung: „' + (m.label || m.planId) + '" — Landed Cost ' + (m.direction === 'up' ? 'gestiegen um' : 'gesunken um') + ' ' + fmtEur(Math.abs(m.landedDeltaEur)) + ' (' + fmtPctSigned(m.landedDeltaPct) + ').',
    actualsNone: 'Sie haben noch kein tatsächliches Ergebnis für einen Plan erfasst — sobald Sie das tun, zeigt der Digest die wertgewichtete Varianz.',
    actualsLine: (c) => 'Kalibrierung: ' + c.withActuals + ' Ergebnis' + (c.withActuals === 1 ? '' : 'se') + ' erfasst · Schätzung lag bei ' + (c.avgVariancePct >= 0 ? '+' : '') + (Math.round(c.avgVariancePct * 10) / 10) + '% vs. Realität (wertgewichtet).',
    cta: 'Vollständige Aufschlüsselung:',
    foot: '— OrcaTrade · Wochen-Digest',
    unsub: 'Nicht interessiert? Mit einem Klick abmelden: ',
    prefs: 'E-Mail-Einstellungen verwalten unter ',
  },
};

function normaliseLocale(locale) {
  const l = String(locale || '').toLowerCase();
  return ALLOWED_LOCALES.has(l) ? l : 'en';
}

function formatDigestText(payload, opts = {}) {
  if (!payload) throw new Error('formatDigestText: payload required');
  const locale = normaliseLocale(opts.locale);
  const t = COPY[locale];
  const planUrl = opts.planUrl || 'https://orcatrade.pl/account/plans/';
  const unsubUrl = opts.unsubUrl || null;
  const prefsUrl = opts.prefsUrl || 'https://orcatrade.pl/account/preferences/';

  const lines = [t.headline(payload.planCount), ''];
  if (payload.planCountSignificant === 0) {
    lines.push(t.movedNone);
  } else if (payload.planCountSignificant === 1) {
    lines.push(t.movedOne);
  } else {
    lines.push(t.movedMany(payload.planCountSignificant));
  }
  if (payload.topMover && payload.planCountSignificant > 0) {
    lines.push('');
    lines.push(t.topMoverLine(payload.topMover));
  }
  lines.push('');
  if (!payload.calibration || payload.calibration.withActuals === 0) {
    lines.push(t.actualsNone);
  } else {
    lines.push(t.actualsLine(payload.calibration));
  }
  lines.push('');
  lines.push(t.cta);
  lines.push(planUrl);
  lines.push('');
  lines.push(t.foot);
  if (unsubUrl) {
    lines.push('');
    lines.push(t.unsub + unsubUrl);
  }
  lines.push(t.prefs + prefsUrl);
  return lines.join('\n');
}

function formatDigestSubject(payload, opts = {}) {
  if (!payload) throw new Error('formatDigestSubject: payload required');
  const t = COPY[normaliseLocale(opts.locale)];
  return t.subject(payload.planCount);
}

module.exports = {
  SIGNIFICANT_PCT,
  LOCALES,
  ALLOWED_LOCALES,
  buildDigestPayload,
  formatDigestText,
  formatDigestSubject,
  normaliseLocale,
};
