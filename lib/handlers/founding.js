// /api/founding — Founding 10 pilot application capture (Sprint J).
//
// The first ten paying importers get lifetime 50% off Growth, a founder
// Slack channel, and their company on the homepage. This handler:
//
//   GET  /api/founding              → { remaining, total, taken } counter
//   POST /api/founding              → submit an application
//
// On POST: validates input, records a `founding_applied` event, and emails
// orca@orcatrade.pl via Resend (no email sent if RESEND_API_KEY unset —
// the event still records so the leads dashboard sees it).
//
// The "spots remaining" counter is computed from KV event log on every GET.
// At this volume that's microseconds; no separate counter key needed.

'use strict';

const events = require('../events');

const FOUNDING_LIMIT = 10;
const FOUNDING_RECIPIENT = 'orca@orcatrade.pl';
const ALLOWED_LOCALES = new Set(['en', 'pl', 'de']);
const DEFAULT_LOCALE = 'en';

// Sprint J.5: applicant-side confirmation email templates. Three locales,
// matched to the founding pages. Each template returns { subject, text }
// given the application context. Plain text only (no HTML), so deliverability
// across small B2B inboxes stays high.
const APPLICANT_TEMPLATES = {
  en: ({ name, waitlist }) => ({
    subject: waitlist
      ? 'On the OrcaTrade Founding 10 waitlist'
      : 'Thanks for applying to the OrcaTrade Founding 10',
    text: [
      `Hi ${name.split(' ')[0]},`,
      '',
      waitlist
        ? 'Your Founding 10 application is in — all ten founder spots are currently taken, so you sit on the waitlist with first refusal on the next batch. We expect spots 11–20 to open in the coming weeks at a slightly less aggressive rate, but Slack access and roadmap influence stay the same.'
        : 'Your Founding 10 application is in. You\'re one of the first ten paying importers helping shape OrcaTrade — lifetime 50% off Growth (€199/month instead of €399), founder Slack channel, your company on the homepage when we go live with your logo.',
      '',
      'Oskar will reply personally within one working day with onboarding next steps. Reply directly to this email if you want to send anything ahead of that.',
      '',
      'In the meantime, you can run any landed-cost question through the wizard at https://orcatrade.pl/start/ — it uses live TARIC rates, EU AD/CVD database, and preferential-origin pathways.',
      '',
      '— Oskar Klepuszewski, OrcaTrade',
      'https://orcatrade.pl/founding/',
    ].join('\n'),
  }),
  pl: ({ name, waitlist }) => ({
    subject: waitlist
      ? 'Na liście oczekujących Założycieli 10 OrcaTrade'
      : 'Dziękujemy za zgłoszenie do Założycieli 10 OrcaTrade',
    text: [
      `Cześć ${name.split(' ')[0]},`,
      '',
      waitlist
        ? 'Twoja aplikacja do Założycieli 10 jest u nas — wszystkie dziesięć miejsc założycielskich jest obecnie zajęte, więc trafiasz na listę oczekujących z pierwszeństwem na kolejną turę. Spodziewamy się otwarcia miejsc 11–20 w najbliższych tygodniach w nieco mniej agresywnej cenie, ale dostęp do Slacka i wpływ na roadmapę pozostają takie same.'
        : 'Twoja aplikacja do Założycieli 10 jest u nas. Jesteś jednym z pierwszych dziesięciu płacących importerów współkształtujących OrcaTrade — dożywotnio 50% taniej Growth (€199/miesiąc zamiast €399), kanał Slack z założycielem, Twoja firma na stronie głównej, gdy wystartujemy z Twoim logo.',
      '',
      'Oskar odezwie się osobiście w ciągu jednego dnia roboczego z kolejnymi krokami onboardingu. Odpowiedz bezpośrednio na ten email, jeśli chcesz coś przesłać wcześniej.',
      '',
      'W międzyczasie możesz przepuścić dowolne pytanie o koszty importu przez kreator na https://orcatrade.pl/pl/start/ — używa aktualnych stawek TARIC, bazy AD/CVD UE i ścieżek preferencyjnego pochodzenia.',
      '',
      '— Oskar Klepuszewski, OrcaTrade',
      'https://orcatrade.pl/pl/zalozyciele-10/',
    ].join('\n'),
  }),
  de: ({ name, waitlist }) => ({
    subject: waitlist
      ? 'Auf der OrcaTrade Gründer-10-Warteliste'
      : 'Vielen Dank für Ihre Bewerbung bei den OrcaTrade Gründer 10',
    text: [
      `Hallo ${name.split(' ')[0]},`,
      '',
      waitlist
        ? 'Ihre Gründer-10-Bewerbung ist eingegangen — alle zehn Gründerplätze sind derzeit vergeben, daher stehen Sie auf der Warteliste mit Vorrecht auf die nächste Runde. Wir erwarten, dass Plätze 11–20 in den kommenden Wochen zu einem etwas weniger aggressiven Preis öffnen, aber Slack-Zugang und Roadmap-Einfluss bleiben gleich.'
        : 'Ihre Gründer-10-Bewerbung ist eingegangen. Sie sind einer der ersten zehn zahlenden Importeure, die OrcaTrade mitformen — lebenslang 50% Rabatt auf Growth (€199/Monat statt €399), Slack-Kanal mit dem Gründer, Ihr Logo auf der Startseite, sobald wir mit Ihnen live gehen.',
      '',
      'Oskar meldet sich persönlich innerhalb eines Arbeitstages mit den nächsten Onboarding-Schritten. Antworten Sie direkt auf diese E-Mail, wenn Sie vorab etwas senden möchten.',
      '',
      'Bis dahin können Sie jede Landed-Cost-Frage durch den Wizard unter https://orcatrade.pl/de/start/ schicken — er nutzt aktuelle TARIC-Sätze, die EU-AD/CVD-Datenbank und Pfade präferenziellen Ursprungs.',
      '',
      '— Oskar Klepuszewski, OrcaTrade',
      'https://orcatrade.pl/de/gruender-10/',
    ].join('\n'),
  }),
};

function jsonResponse(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function isEmail(value) {
  if (!value || typeof value !== 'string') return false;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

function trimStr(value, max) {
  if (value == null) return '';
  const s = String(value).trim();
  return max ? s.slice(0, max) : s;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.length) {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (_) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

async function countApplied() {
  const log = await events.list({ type: 'founding_applied', limit: events.MAX_EVENTS });
  return log.length;
}

async function counterPayload() {
  const taken = await countApplied();
  const remaining = Math.max(0, FOUNDING_LIMIT - taken);
  return { total: FOUNDING_LIMIT, taken, remaining };
}

// Single Resend POST. Caller passes from/to/subject/text/reply_to; we
// handle key-absence + non-2xx upstream as soft failures so the user
// flow never breaks on email delivery problems.
async function resendSend({ from, to, subject, text, replyTo }) {
  if (!process.env.RESEND_API_KEY) return { sent: false, reason: 'no-key' };

  const body = { from, to: [to], subject, text };
  if (replyTo) body.reply_to = replyTo;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { sent: false, reason: 'resend-error', detail };
  }
  return { sent: true };
}

// Internal notification to orca@orcatrade.pl — operator sees the
// application context in full.
async function sendInternalEmail({ name, email, company, role, monthlyValueEur, message, locale, waitlist }) {
  const subject = waitlist
    ? `Founding 10 WAITLIST: ${name}${company ? ` (${company})` : ''}`
    : `Founding 10 application: ${name}${company ? ` (${company})` : ''}`;
  const text = [
    waitlist ? 'New Founding 10 WAITLIST application' : 'New Founding 10 application',
    '',
    `Name:    ${name}`,
    `Email:   ${email}`,
    company ? `Company: ${company}` : null,
    role ? `Role:    ${role}` : null,
    monthlyValueEur ? `Monthly import value: €${monthlyValueEur}` : null,
    `Locale:  ${locale}`,
    '',
    message ? `Why this:\n${message}` : null,
  ].filter(Boolean).join('\n');

  return resendSend({
    from: process.env.RESEND_FROM || 'OrcaTrade <onboarding@resend.dev>',
    to: FOUNDING_RECIPIENT,
    subject,
    text,
    replyTo: email,
  });
}

// Sprint J.5: applicant-side confirmation. Locale-correct subject + body.
// reply_to is FOUNDING_RECIPIENT so any reply from the applicant lands in
// Oskar's inbox (i.e. an email reply continues the founder conversation).
async function sendApplicantEmail({ name, email, locale, waitlist }) {
  const tpl = APPLICANT_TEMPLATES[locale] || APPLICANT_TEMPLATES[DEFAULT_LOCALE];
  const { subject, text } = tpl({ name, waitlist });
  return resendSend({
    from: process.env.RESEND_FROM || 'OrcaTrade <onboarding@resend.dev>',
    to: email,
    subject,
    text,
    replyTo: FOUNDING_RECIPIENT,
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }

  if (req.method === 'GET') {
    const payload = await counterPayload();
    return jsonResponse(res, 200, { ok: true, ...payload });
  }

  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  const body = await readBody(req);
  const name = trimStr(body.name, 120);
  const email = trimStr(body.email, 200);
  const company = trimStr(body.company, 160);
  const role = trimStr(body.role, 80);
  const monthlyValueEur = trimStr(body.monthlyValueEur, 40);
  const message = trimStr(body.message, 1200);
  const rawLocale = trimStr(body.locale, 8).toLowerCase();
  const locale = ALLOWED_LOCALES.has(rawLocale) ? rawLocale : DEFAULT_LOCALE;

  if (!name) return jsonResponse(res, 400, { error: 'Name is required.' });
  if (!isEmail(email)) return jsonResponse(res, 400, { error: 'Valid email is required.' });

  const before = await counterPayload();

  // We still accept applications once the 10 spots are filled — the counter
  // says "waitlist" past 10 and the email subject reflects that. Better to
  // capture interest than reject it.
  const overLimit = before.remaining === 0;

  await events.record('founding_applied', {
    name,
    email,
    company: company || null,
    role: role || null,
    monthlyValueEur: monthlyValueEur || null,
    message: message || null,
    locale,
    emailProvided: true,
    waitlist: overLimit,
  });

  // Send both emails in parallel — internal notification + applicant
  // confirmation. Each is independently soft-failing, so a missing
  // RESEND_API_KEY or a transient upstream blip never blocks the 200
  // response or the event-log entry.
  const [internal, applicant] = await Promise.all([
    sendInternalEmail({ name, email, company, role, monthlyValueEur, message, locale, waitlist: overLimit })
      .catch((err) => { console.error('[founding] internal email threw:', err && err.message); return { sent: false, reason: 'exception' }; }),
    sendApplicantEmail({ name, email, locale, waitlist: overLimit })
      .catch((err) => { console.error('[founding] applicant email threw:', err && err.message); return { sent: false, reason: 'exception' }; }),
  ]);

  const after = await counterPayload();

  return jsonResponse(res, 200, {
    ok: true,
    waitlist: overLimit,
    emailed: !!internal.sent,
    applicantEmailed: !!applicant.sent,
    ...after,
  });
};

module.exports.FOUNDING_LIMIT = FOUNDING_LIMIT;
module.exports.ALLOWED_LOCALES = ALLOWED_LOCALES;
module.exports.APPLICANT_TEMPLATES = APPLICANT_TEMPLATES;
module.exports._internal = { countApplied, counterPayload, isEmail };
