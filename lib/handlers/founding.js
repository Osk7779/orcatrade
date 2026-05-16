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

async function sendEmail({ name, email, company, role, monthlyValueEur, message }) {
  if (!process.env.RESEND_API_KEY) return { sent: false, reason: 'no-key' };

  const subject = `Founding 10 application: ${name}${company ? ` (${company})` : ''}`;
  const text = [
    'New Founding 10 application',
    '',
    `Name:    ${name}`,
    `Email:   ${email}`,
    company ? `Company: ${company}` : null,
    role ? `Role:    ${role}` : null,
    monthlyValueEur ? `Monthly import value: €${monthlyValueEur}` : null,
    '',
    message ? `Why this:\n${message}` : null,
  ].filter(Boolean).join('\n');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'OrcaTrade <onboarding@resend.dev>',
      to: [FOUNDING_RECIPIENT],
      reply_to: email,
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { sent: false, reason: 'resend-error', detail };
  }
  return { sent: true };
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
    emailProvided: true,
    waitlist: overLimit,
  });

  const emailResult = await sendEmail({ name, email, company, role, monthlyValueEur, message }).catch((err) => {
    console.error('[founding] email send threw:', err && err.message);
    return { sent: false, reason: 'exception' };
  });

  const after = await counterPayload();

  return jsonResponse(res, 200, {
    ok: true,
    waitlist: overLimit,
    emailed: !!emailResult.sent,
    ...after,
  });
};

module.exports.FOUNDING_LIMIT = FOUNDING_LIMIT;
module.exports._internal = { countApplied, counterPayload, isEmail };
