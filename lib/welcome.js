// Sprint first-plan-welcome-v1 — one-shot welcome email when a user
// saves their first plan ever.
//
// Closes the activation loop. Before this sprint a new user's journey
// was: magic-link → /account/ → build a plan → save it → silence until
// something drifts ≥5% (the plan-revision cron, days or weeks later).
// The first-plan moment is the highest-intent slice we'll ever get
// from them; we should mark it.
//
// Transactional, not marketing — no opt-out toggle. Single send per
// email, ever, guarded by a KV idempotency key (`welcome:sent:<email>`).
// Subsequent saves are no-ops. A user who deleted their only plan and
// saved a new one does NOT re-receive (we don't know they're "new
// again"; the idempotency key persists ~2 years).
//
// EN/PL/DE templates — the wizard already passes its locale (Sprint 33).
// We honour what the request gave us; fall back to EN for unknowns.
// No HTML body — plain text reads the same in every mail client and
// matches the rest of OrcaTrade's transactional email surface.
//
// Failure handling: a Resend error or KV write failure does NOT break
// the underlying plan save. The caller wraps in try/catch + ignores —
// the welcome is a nice-to-have on top of the durable save.

'use strict';

const kv = require('./intelligence/kv-store');
const email = require('./email');
const circuit = require('./circuit');

const WELCOME_KEY_PREFIX = 'welcome:sent:';
const FIRST_ACTUAL_KEY_PREFIX = 'welcome:first-actual:';
const WELCOME_TTL_DAYS = 2 * 365; // 2 years — long enough that a re-save
                                  // years later is not treated as "new"
const LOCALES = ['en', 'pl', 'de'];
const ALLOWED_LOCALES = new Set(LOCALES);

function normaliseEmail(e) {
  return String(e || '').toLowerCase().trim();
}

function normaliseLocale(locale) {
  const l = String(locale || '').toLowerCase();
  return ALLOWED_LOCALES.has(l) ? l : 'en';
}

function welcomeKey(emailAddr) {
  return WELCOME_KEY_PREFIX + normaliseEmail(emailAddr);
}

function firstActualKey(emailAddr) {
  return FIRST_ACTUAL_KEY_PREFIX + normaliseEmail(emailAddr);
}

// Format a number with Euro grouping (en-IE). Locale-agnostic;
// the surrounding sentence is what carries the language.
function fmtEur(n) {
  if (n == null || !Number.isFinite(Number(n))) return '€0';
  return '€' + Math.round(Number(n)).toLocaleString('en-IE');
}

function fmtPctSigned(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return '0%';
  const v = Number(pct);
  const rounded = Math.round(v * 10) / 10; // 1dp
  const sign = rounded > 0 ? '+' : '';
  return sign + rounded + '%';
}

// Direction word per locale.
function directionWord(direction, locale) {
  const norm = String(direction || '').toLowerCase();
  const map = {
    en: { over: 'over', under: 'under', onTarget: 'on target' },
    pl: { over: 'powyżej', under: 'poniżej', onTarget: 'na celu' },
    de: { over: 'über',   under: 'unter',   onTarget: 'auf Ziel' },
  };
  const t = map[normaliseLocale(locale)] || map.en;
  if (norm === 'over') return t.over;
  if (norm === 'under') return t.under;
  return t.onTarget;
}

// ── Templates ─────────────────────────────────────────

const TEMPLATES = {
  en: {
    subject: 'Your first plan is saved · what to do next on OrcaTrade',
    body: (ctx) => [
      `Hi${ctx.firstName ? ' ' + ctx.firstName : ''},`,
      ``,
      `Your first import plan is saved. From here, three things compound the value you get out of OrcaTrade:`,
      ``,
      `1. Log a real outcome on this plan once the shipment lands.`,
      `   We compare it to the saved estimate and tell you where the calculator drifted — the calibration is yours, not an industry average.`,
      ``,
      `2. Save more plans across origins or categories.`,
      `   The wizard's alternative-origin matrix runs against every saved plan, so cheaper routes surface automatically as TARIC rates move.`,
      ``,
      `3. Share a plan with a teammate or supplier.`,
      `   The share link is public-read-only and shows them the same landed-cost breakdown without an account.`,
      ``,
      `Your plans: ${ctx.planUrl}`,
      `Build another: ${ctx.wizardUrl}`,
      ``,
      `One email per week from here on if any of your plans moves materially. The Monday digest summarises your whole portfolio. Both are togglable at ${ctx.prefsUrl}.`,
      ``,
      `— Oskar, OrcaTrade`,
    ].join('\n'),
  },
  pl: {
    subject: 'Twój pierwszy plan został zapisany · co dalej w OrcaTrade',
    body: (ctx) => [
      `Cześć${ctx.firstName ? ' ' + ctx.firstName : ''},`,
      ``,
      `Twój pierwszy plan importu jest zapisany. Stąd trzy rzeczy zwielokrotnią wartość, którą wyciągniesz z OrcaTrade:`,
      ``,
      `1. Zaloguj rzeczywisty wynik, gdy przesyłka dotrze.`,
      `   Porównujemy go z zapisaną estymatą i pokazujemy, gdzie kalkulator się rozjechał — kalibracja jest Twoja, nie branżowa średnia.`,
      ``,
      `2. Zapisz więcej planów dla różnych pochodzeń lub kategorii.`,
      `   Macierz alternatywnych pochodzeń kreatora przelicza każdy zapisany plan, więc tańsze trasy pojawiają się automatycznie, gdy stawki TARIC się zmieniają.`,
      ``,
      `3. Udostępnij plan członkowi zespołu lub dostawcy.`,
      `   Link do udostępnienia jest publiczny tylko do odczytu i pokazuje im to samo rozbicie kosztów landed bez konta.`,
      ``,
      `Twoje plany: ${ctx.planUrl}`,
      `Zbuduj kolejny: ${ctx.wizardUrl}`,
      ``,
      `Od teraz jeden e-mail tygodniowo, gdy któryś z Twoich planów istotnie się zmieni. Poniedziałkowy digest podsumowuje całe portfolio. Oba można wyłączyć pod ${ctx.prefsUrl}.`,
      ``,
      `— Oskar, OrcaTrade`,
    ].join('\n'),
  },
  de: {
    subject: 'Ihr erster Plan ist gespeichert · so geht es weiter bei OrcaTrade',
    body: (ctx) => [
      `Hallo${ctx.firstName ? ' ' + ctx.firstName : ''},`,
      ``,
      `Ihr erster Importplan ist gespeichert. Von hier aus vervielfachen drei Dinge den Wert, den Sie aus OrcaTrade ziehen:`,
      ``,
      `1. Erfassen Sie ein tatsächliches Ergebnis, sobald die Sendung eingetroffen ist.`,
      `   Wir vergleichen es mit der gespeicherten Schätzung und zeigen Ihnen, wo der Kalkulator abwich — die Kalibrierung gehört Ihnen, kein Branchen-Durchschnitt.`,
      ``,
      `2. Speichern Sie weitere Pläne für andere Ursprünge oder Kategorien.`,
      `   Die Alternativ-Ursprung-Matrix des Wizards läuft gegen jeden gespeicherten Plan, sodass günstigere Routen automatisch auftauchen, wenn TARIC-Sätze sich bewegen.`,
      ``,
      `3. Teilen Sie einen Plan mit einem Teamkollegen oder Lieferanten.`,
      `   Der Share-Link ist öffentlich nur-lesen und zeigt ihnen dieselbe Landed-Cost-Aufschlüsselung ohne Konto.`,
      ``,
      `Ihre Pläne: ${ctx.planUrl}`,
      `Weiteren Plan bauen: ${ctx.wizardUrl}`,
      ``,
      `Ab jetzt eine E-Mail pro Woche, wenn einer Ihrer Pläne sich wesentlich bewegt. Der Montags-Digest fasst Ihr gesamtes Portfolio zusammen. Beide sind unter ${ctx.prefsUrl} abschaltbar.`,
      ``,
      `— Oskar, OrcaTrade`,
    ].join('\n'),
  },
};

// Pure: returns { subject, text } for the given locale + context.
function buildWelcomeEmail({ locale, firstName, planUrl, wizardUrl, prefsUrl }) {
  const t = TEMPLATES[normaliseLocale(locale)];
  return {
    subject: t.subject,
    text: t.body({
      firstName: firstName || '',
      planUrl: planUrl || 'https://orcatrade.pl/account/plans/',
      wizardUrl: wizardUrl || 'https://orcatrade.pl/start/',
      prefsUrl: prefsUrl || 'https://orcatrade.pl/account/preferences/',
    }),
  };
}

// Returns true if the welcome was sent on this call. Returns false on:
// already-sent (idempotency), unconfigured Resend, send failure, or
// missing email. Never throws — the caller can fire-and-forget.
async function sendWelcomeIfFirst(emailAddr, opts = {}) {
  const e = normaliseEmail(emailAddr);
  if (!e) return { sent: false, reason: 'no-email' };
  if (!email.isConfigured()) return { sent: false, reason: 'not-configured' };

  // Idempotency check FIRST — a second save in the same second must
  // not re-fire. KV get returns null when no key, anything truthy when
  // already present.
  let prior;
  try { prior = await kv.get(welcomeKey(e)); }
  catch (_) { prior = null; }
  if (prior) return { sent: false, reason: 'already-sent' };

  const { subject, text } = buildWelcomeEmail({
    locale: opts.locale,
    firstName: opts.firstName,
    planUrl: opts.planUrl,
    wizardUrl: opts.wizardUrl,
    prefsUrl: opts.prefsUrl,
  });

  // Reuse the existing Resend circuit breaker so a Resend outage
  // doesn't block the save path. fallback returns ok:false; caller
  // skips the dedupe write so a future run can retry. circuit.run
  // requires `fallback` to be a FUNCTION (so it can pass state info).
  const result = await circuit.run('resend', async () => {
    return email.send({ to: e, subject, text });
  }, {
    fallback: ({ state }) => ({ ok: false, reason: state === 'open' ? 'circuit-open' : 'send-failed' }),
  });

  if (!result || !result.ok) {
    return { sent: false, reason: (result && result.reason) || 'send-failed' };
  }

  // Persist idempotency AFTER a successful send. A KV write failure
  // here means the next run may re-send (rare; the alternative — write
  // first then send and risk silent drop — is worse).
  try {
    await kv.set(welcomeKey(e), {
      sentAt: new Date().toISOString(),
      locale: normaliseLocale(opts.locale),
    }, { ttlSeconds: WELCOME_TTL_DAYS * 24 * 60 * 60 });
  } catch (_) { /* tolerable — see above */ }

  return { sent: true, locale: normaliseLocale(opts.locale) };
}

// ── Sprint first-actual-welcome-v1 — second milestone email ────
//
// Parallel to sendWelcomeIfFirst — fires once-ever when a user logs
// their first actual outcome on any plan. The body interpolates the
// variance the system just observed (deltaPct + direction + EUR
// figures) so the most emotionally-resonant moment of the calibration
// loop gets a tangible response, not silence.
//
// Idempotency key is separate from the first-plan welcome — a user
// can receive both lifecycle emails, one per milestone.

const FIRST_ACTUAL_TEMPLATES = {
  en: {
    subject: (ctx) => 'Calibration data point logged · ' + ctx.deltaPctSigned + ' vs estimate',
    body: (ctx) => [
      'Hi' + (ctx.firstName ? ' ' + ctx.firstName : '') + ',',
      '',
      'You just logged your first actual outcome on OrcaTrade. This is the data point the calculator does NOT have unless customers like you put it in. Here\'s what the system saw:',
      '',
      '  Estimate: ' + ctx.estimateEur,
      '  Actual:   ' + ctx.actualEur,
      '  Variance: ' + ctx.deltaPctSigned + ' (' + ctx.directionWord + ' budget)',
      '',
      'One data point compounds into your personal calibration. Once you have outcomes on three or more plans, /account/plans/ shows a value-weighted roll-up: "across your portfolio, OrcaTrade\'s estimates have come in X% off reality." That number is yours — not an industry average, not our marketing claim.',
      '',
      'Next: log outcomes on more plans → ' + ctx.planUrl,
      'Or build another plan → ' + ctx.wizardUrl,
      '',
      'A note on what this number means: ' + ctx.deltaPctSigned + ' is the delta between the perShipmentLandedTotal we computed at save time and the real total you just reported. It captures duty + VAT + freight + brokerage drift collectively. The plan-revision email you may have received separately decomposes which line moved the most.',
      '',
      '— Oskar, OrcaTrade',
      '',
      'Manage what OrcaTrade emails you about at ' + ctx.prefsUrl,
    ].join('\n'),
  },
  pl: {
    subject: (ctx) => 'Punkt kalibracji zalogowany · ' + ctx.deltaPctSigned + ' vs estymata',
    body: (ctx) => [
      'Cześć' + (ctx.firstName ? ' ' + ctx.firstName : '') + ',',
      '',
      'Właśnie zalogowałeś pierwszy rzeczywisty wynik w OrcaTrade. To dane, których kalkulator NIE ma, dopóki klienci tacy jak Ty ich nie wprowadzą. Oto co zobaczył system:',
      '',
      '  Estymata: ' + ctx.estimateEur,
      '  Rzeczywiste: ' + ctx.actualEur,
      '  Wariancja: ' + ctx.deltaPctSigned + ' (' + ctx.directionWord + ' budżetu)',
      '',
      'Jeden punkt danych łączy się w Twoją osobistą kalibrację. Gdy masz wyniki dla trzech lub więcej planów, /account/plans/ pokazuje sumaryczne ujęcie ważone wartością: "w Twoim portfelu estymaty OrcaTrade odbiegały od rzeczywistości o X%". Ta liczba jest Twoja — nie branżowa średnia, nie nasze marketingowe twierdzenie.',
      '',
      'Następny krok: zaloguj wyniki dla kolejnych planów → ' + ctx.planUrl,
      'Lub zbuduj kolejny plan → ' + ctx.wizardUrl,
      '',
      'Co oznacza ta liczba: ' + ctx.deltaPctSigned + ' to różnica między perShipmentLandedTotal obliczonym w momencie zapisu a rzeczywistą sumą, którą właśnie podałeś. Obejmuje łącznie dryft cła + VAT + frachtu + odprawy. Osobny e-mail z rewizją planu (jeśli go otrzymałeś) pokazuje, która pozycja przesunęła się najbardziej.',
      '',
      '— Oskar, OrcaTrade',
      '',
      'Zarządzaj tym, o czym OrcaTrade Cię informuje, pod ' + ctx.prefsUrl,
    ].join('\n'),
  },
  de: {
    subject: (ctx) => 'Kalibrierungs-Datenpunkt erfasst · ' + ctx.deltaPctSigned + ' vs. Schätzung',
    body: (ctx) => [
      'Hallo' + (ctx.firstName ? ' ' + ctx.firstName : '') + ',',
      '',
      'Sie haben gerade Ihr erstes tatsächliches Ergebnis in OrcaTrade erfasst. Das sind die Daten, die der Kalkulator NICHT hat, solange Kunden wie Sie sie nicht eingeben. Folgendes hat das System gesehen:',
      '',
      '  Schätzung: ' + ctx.estimateEur,
      '  Ist: ' + ctx.actualEur,
      '  Abweichung: ' + ctx.deltaPctSigned + ' (' + ctx.directionWord + ' Budget)',
      '',
      'Ein Datenpunkt summiert sich zu Ihrer persönlichen Kalibrierung. Sobald Sie Ergebnisse für drei oder mehr Pläne haben, zeigt /account/plans/ einen wertgewichteten Aggregator: "in Ihrem Portfolio lagen die OrcaTrade-Schätzungen um X% von der Realität entfernt". Diese Zahl gehört Ihnen — kein Branchen-Durchschnitt, keine Marketingbehauptung.',
      '',
      'Nächster Schritt: Ergebnisse für weitere Pläne erfassen → ' + ctx.planUrl,
      'Oder einen weiteren Plan bauen → ' + ctx.wizardUrl,
      '',
      'Was diese Zahl bedeutet: ' + ctx.deltaPctSigned + ' ist die Abweichung zwischen dem zum Speicherzeitpunkt berechneten perShipmentLandedTotal und der tatsächlichen Summe, die Sie soeben gemeldet haben. Sie erfasst kollektiv Zoll- + EUSt- + Fracht- + Verzollungs-Drift. Die separate Plan-Revisions-E-Mail (falls erhalten) zeigt, welche Position sich am stärksten bewegte.',
      '',
      '— Oskar, OrcaTrade',
      '',
      'Verwalten Sie, worüber OrcaTrade Sie per E-Mail informiert, unter ' + ctx.prefsUrl,
    ].join('\n'),
  },
};

// Pure: returns { subject, text } for the given locale + variance.
function buildFirstActualEmail({ locale, firstName, planUrl, wizardUrl, prefsUrl, variance }) {
  const t = FIRST_ACTUAL_TEMPLATES[normaliseLocale(locale)];
  const v = variance || {};
  const ctx = {
    firstName: firstName || '',
    planUrl: planUrl || 'https://orcatrade.pl/account/plans/',
    wizardUrl: wizardUrl || 'https://orcatrade.pl/start/',
    prefsUrl: prefsUrl || 'https://orcatrade.pl/account/preferences/',
    estimateEur: fmtEur(v.estimateEur),
    actualEur: fmtEur(v.actualEur),
    deltaPctSigned: fmtPctSigned(v.deltaPct),
    directionWord: directionWord(v.direction, locale),
  };
  return {
    subject: t.subject(ctx),
    text: t.body(ctx),
  };
}

// Returns { sent: bool, reason?: string, locale?: string }. Never
// throws — caller fires it via .catch(() => {}) inside handleSetActual
// so a Resend outage or KV write failure can't break the user's action.
async function sendFirstActualWelcomeIfFirst(emailAddr, opts = {}) {
  const e = normaliseEmail(emailAddr);
  if (!e) return { sent: false, reason: 'no-email' };
  if (!email.isConfigured()) return { sent: false, reason: 'not-configured' };

  let prior;
  try { prior = await kv.get(firstActualKey(e)); }
  catch (_) { prior = null; }
  if (prior) return { sent: false, reason: 'already-sent' };

  const { subject, text } = buildFirstActualEmail({
    locale: opts.locale,
    firstName: opts.firstName,
    planUrl: opts.planUrl,
    wizardUrl: opts.wizardUrl,
    prefsUrl: opts.prefsUrl,
    variance: opts.variance,
  });

  const result = await circuit.run('resend', async () => {
    return email.send({ to: e, subject, text });
  }, {
    fallback: ({ state }) => ({ ok: false, reason: state === 'open' ? 'circuit-open' : 'send-failed' }),
  });

  if (!result || !result.ok) {
    return { sent: false, reason: (result && result.reason) || 'send-failed' };
  }

  try {
    await kv.set(firstActualKey(e), {
      sentAt: new Date().toISOString(),
      locale: normaliseLocale(opts.locale),
    }, { ttlSeconds: WELCOME_TTL_DAYS * 24 * 60 * 60 });
  } catch (_) { /* tolerable */ }

  return { sent: true, locale: normaliseLocale(opts.locale) };
}

module.exports = {
  WELCOME_KEY_PREFIX,
  FIRST_ACTUAL_KEY_PREFIX,
  WELCOME_TTL_DAYS,
  LOCALES,
  ALLOWED_LOCALES,
  welcomeKey,
  firstActualKey,
  normaliseLocale,
  buildWelcomeEmail,
  sendWelcomeIfFirst,
  buildFirstActualEmail,
  sendFirstActualWelcomeIfFirst,
};
