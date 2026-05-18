// /api/unsubscribe?token=... — public one-click unsubscribe handler.
//
// The plan-revision-emails cron embeds a signed token in every email
// it sends (lib/notification-prefs.js#generateUnsubscribeToken).
// Anyone with the link can flip planRevisionEmails:false for the
// signed email without an auth session — that's the whole point of
// one-click unsubscribe (CAN-SPAM + GDPR best practice).
//
// HMAC verification + constant-time compare prevents a bad actor from
// guessing tokens for other users' emails. The token never expires
// (a user might keep a 6-month-old email and click unsubscribe);
// revocation is not a use case here — re-opting in via
// /account/preferences/ is the inverse path.
//
// Renders a small static HTML confirmation page rather than a JSON
// response — most users hit this from their mail client and expect
// a human-readable page.

'use strict';

const notificationPrefs = require('../notification-prefs');
const events = require('../events');
const log = require('../log').withContext({ handler: 'unsubscribe' });

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://orcatrade.pl';

function readToken(req) {
  if (req.query && req.query.token) return String(req.query.token);
  const qs = (req.url || '').split('?')[1] || '';
  return new URLSearchParams(qs).get('token') || '';
}

function renderPage({ status, title, message, ctaHref, ctaLabel }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title} · OrcaTrade</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
           background: #050507; color: rgba(255,255,255,0.92); min-height: 100vh;
           display: flex; align-items: center; justify-content: center; padding: 2rem; margin: 0; }
    main { max-width: 520px; text-align: center; }
    h1 { font-family: Georgia, serif; font-size: 1.6rem; font-weight: 600; margin: 0 0 0.6rem; letter-spacing: -0.01em; }
    p { font-size: 0.96rem; line-height: 1.65; color: rgba(255,255,255,0.75); margin: 0 0 1.6rem; }
    a.btn { display: inline-block; padding: 0.7rem 1.3rem; background: transparent;
            color: rgba(255,255,255,0.92); border: 1px solid rgba(184,190,200,0.4);
            text-decoration: none; font-size: 0.78rem; font-weight: 700;
            letter-spacing: 0.12em; text-transform: uppercase; }
    a.btn:hover { background: rgba(184,190,200,0.06); }
    .status { font-family: ui-monospace, 'Geist Mono', monospace; font-size: 0.7rem;
              letter-spacing: 0.16em; text-transform: uppercase;
              color: ${status === 'ok' ? 'rgba(126, 210, 138, 0.85)' : 'rgba(232, 128, 128, 0.85)'};
              margin-bottom: 0.6rem; }
  </style>
</head>
<body>
  <main>
    <div class="status">${status === 'ok' ? 'Unsubscribed' : 'Could not unsubscribe'}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    ${ctaHref ? `<a class="btn" href="${ctaHref}">${ctaLabel}</a>` : ''}
  </main>
</body>
</html>`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const token = readToken(req);
  const email = notificationPrefs.verifyUnsubscribeToken(token);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!email) {
    log.warn('unsubscribe invalid token', { requestId: req.requestId });
    res.statusCode = 400;
    return res.end(renderPage({
      status: 'error',
      title: 'Link is invalid or has been tampered with',
      message: 'This unsubscribe link could not be verified. If you want to opt out of plan-revision emails, sign in to your account and toggle the preference manually.',
      ctaHref: SITE_ORIGIN + '/account/preferences/',
      ctaLabel: 'Open preferences',
    }));
  }

  try {
    await notificationPrefs.setPrefs(email, { planRevisionEmails: false });
  } catch (err) {
    log.error('unsubscribe write failed', { err: err.message });
    res.statusCode = 500;
    return res.end(renderPage({
      status: 'error',
      title: 'Something went wrong',
      message: 'We could not record your preference. Please try again in a minute, or open your preferences page directly.',
      ctaHref: SITE_ORIGIN + '/account/preferences/',
      ctaLabel: 'Open preferences',
    }));
  }

  try {
    await events.record('plan_revision_emails_unsubscribed', { email });
  } catch (_) {}

  log.info('unsubscribe success', { requestId: req.requestId });
  res.statusCode = 200;
  return res.end(renderPage({
    status: 'ok',
    title: 'You\'re unsubscribed from plan-revision emails',
    message: 'We won\'t email you about pricing drift on saved plans any more. Your account, plans, and other features are unchanged. You can re-enable this any time from your preferences page.',
    ctaHref: SITE_ORIGIN + '/account/preferences/',
    ctaLabel: 'Manage preferences',
  }));
};

module.exports.readToken = readToken;
module.exports.renderPage = renderPage;
