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

module.exports = {
  WELCOME_KEY_PREFIX,
  WELCOME_TTL_DAYS,
  LOCALES,
  ALLOWED_LOCALES,
  welcomeKey,
  normaliseLocale,
  buildWelcomeEmail,
  sendWelcomeIfFirst,
};
