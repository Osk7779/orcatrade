// Shared Resend send helper.
//
// lib/handlers/start.js and lib/handlers/auth.js each have a private
// `resendSend` function — kept where they are for now to avoid changing
// well-tested code paths. New senders (cron jobs, Stripe welcome flow)
// should go through this module so we have one place to add tracing,
// idempotency, and template helpers as the surface grows.
//
// Public API:
//   send({ to, subject, text, html?, from? })
//     → { ok: true, id }  on 200
//     → { ok: false, reason }  on failure or unconfigured
//   isConfigured()
//     → boolean — true when RESEND_API_KEY is set
//
// The handlers never throw on email failure — operational emails should
// fail soft (degraded UX) rather than fail-loud (broken handler chain).

'use strict';

const DEFAULT_FROM = 'OrcaTrade <onboarding@resend.dev>';

function isConfigured() {
  return !!process.env.RESEND_API_KEY;
}

function resolveFrom(explicit) {
  if (explicit) return explicit;
  return process.env.RESEND_FROM || DEFAULT_FROM;
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string | null, from?: string | null }} args
 */
async function send({ to, subject, text, html = null, from = null }) {
  if (!isConfigured()) {
    return { ok: false, reason: 'RESEND_API_KEY not set' };
  }
  if (!to || !subject || !text) {
    return { ok: false, reason: 'to + subject + text required' };
  }
  const payload = {
    from: resolveFrom(from),
    to,
    subject,
    text,
  };
  if (html) payload.html = html;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (_e) { /* keep null */ }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        reason: (parsed && parsed.message) || text.slice(0, 200) || 'Resend send failed',
      };
    }
    return { ok: true, id: parsed && parsed.id };
  } catch (err) {
    return { ok: false, reason: err.message || 'fetch failed' };
  }
}

// Convenience: send to multiple recipients sequentially. Used by the
// founder digest. Does NOT use Resend's batch API so each send is logged
// individually — at our volume this is fine.
async function sendMany(recipients, { subject, text, html = null, from = null } = {}) {
  const results = [];
  for (const to of recipients) {
    results.push({ to, result: await send({ to, subject, text, html, from }) });
  }
  return results;
}

module.exports = {
  DEFAULT_FROM,
  isConfigured,
  resolveFrom,
  send,
  sendMany,
};
