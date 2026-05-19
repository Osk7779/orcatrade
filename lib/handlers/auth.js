// /api/auth/* dispatcher — handles request, verify, me, logout sub-actions.
// Single endpoint under the catch-all dispatcher (api/[...path].js routes
// /api/auth/<action> here, where <action> is the second URL segment).

'use strict';

const auth = require('../auth');
const kv = require('../intelligence/kv-store');
const events = require('../events');
const { consumeRateLimit } = require('../intelligence/runtime-store');
const baseLog = require('../log');
const log = baseLog.withContext({ handler: 'auth' });
const circuit = require('../circuit');
const adminAuth = require('../admin-auth');

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://orcatrade.pl';

// ── Resend email helper (mirrors lib/handlers/start.js pattern) ──

async function sendMagicLinkEmail({ email, magicLink }, reqLog = log) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    reqLog.warn('RESEND_API_KEY not set; cannot send magic link', { action: 'send_magic_link' });
    return { sent: false, reason: 'RESEND_API_KEY not set' };
  }
  const from = process.env.RESEND_FROM || 'OrcaTrade <onboarding@resend.dev>';
  const subject = 'Your OrcaTrade sign-in link';
  const text = `Hello,

Click this link to sign in to your OrcaTrade account:

${magicLink}

This link expires in 15 minutes. If you did not request it, you can safely ignore this email.

— OrcaTrade Group
  Warsaw · London · Hong Kong`;

  // Sprint BG-4.4: same 'resend' circuit as start.js — both handlers share
  // the upstream, so a Resend outage trips one breaker and protects both.
  return circuit.run('resend', async () => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: email, subject, text }),
    });
    if (!response.ok) {
      const errText = await response.text();
      reqLog.warn('resend send failed', {
        action: 'send_magic_link',
        status: response.status,
        upstreamErr: errText.slice(0, 200),
      });
      throw new Error(`resend ${response.status}: ${errText.slice(0, 100)}`);
    }
    return { sent: true };
  }, {
    fallback: ({ shortCircuited, err }) => {
      if (shortCircuited) {
        reqLog.warn('resend send skipped (circuit open)', { action: 'send_magic_link' });
        return { sent: false, status: 503, circuit: 'open' };
      }
      reqLog.warn('resend send threw', { action: 'send_magic_link', err: err && err.message });
      return { sent: false, error: err && err.message };
    },
  });
}

// ── Sub-actions ────────────────────────────────────────

// POST /api/auth/request  body: { email }
//   → 202 Accepted on success (we always return 202 even for non-existent
//     emails to avoid leaking which addresses have accounts — though
//     since we don't have user accounts yet, anyone can request a link).
async function handleRequest(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  // Rate-limit magic-link requests: 5 per 5 minutes per IP
  const rate = await consumeRateLimit('auth-request', ip, 5, 300_000);
  if (rate.limited) {
    res.statusCode = 429;
    return res.end(JSON.stringify({ error: 'Too many sign-in requests. Please wait 5 minutes.' }));
  }

  const body = req.body || {};
  const email = String(body.email || '').toLowerCase().trim();
  if (!auth.isValidEmail(email)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Valid email required' }));
  }

  const token = auth.generateMagicToken();
  await kv.set(auth.magicKvKey(token), email, { ttlSeconds: auth.MAGIC_TOKEN_TTL_SECONDS });
  const magicLink = `${SITE_ORIGIN}/api/auth/verify?token=${token}`;
  const reqLog = log.withContext({ requestId: req.requestId, action: 'request_magic_link' });
  reqLog.info('magic link requested', { email });

  // Fire-and-forget the Resend send. We always return 202 anyway (to
  // avoid leaking which emails are valid), and the user's experience
  // is dominated by Gmail's filter — which we don't speed up by
  // blocking here. .catch() prevents Node from logging an unhandled
  // rejection if Resend throws; failures are already logged inside
  // sendMagicLinkEmail.
  sendMagicLinkEmail({ email, magicLink }, reqLog).catch(() => {});

  // Always return 202 with a generic message — sent before the Resend
  // round-trip completes so the UI flashes "Check your inbox" instantly.
  res.statusCode = 202;
  return res.end(JSON.stringify({
    ok: true,
    message: 'If that email is valid, a sign-in link has been sent. Check your inbox.',
  }));
}

// GET /api/auth/verify?token=<token>
//   → 302 redirect to /account/ on success with Set-Cookie session
//   → 400 if token missing/expired/invalid
async function handleVerify(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  // Pull token from query
  let token = '';
  if (req.query && req.query.token) {
    token = Array.isArray(req.query.token) ? req.query.token[0] : String(req.query.token);
  } else {
    const url = new URL(req.url || '/', SITE_ORIGIN);
    token = url.searchParams.get('token') || '';
  }
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(`<!doctype html><meta charset="utf-8"><title>Invalid link</title><body style="font-family:system-ui;padding:40px;max-width:600px;margin:0 auto"><h1>Invalid sign-in link</h1><p>This link is malformed or has been tampered with. <a href="/account/">Request a new one</a>.</p></body>`);
  }

  const email = await kv.get(auth.magicKvKey(token));
  if (!email) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(`<!doctype html><meta charset="utf-8"><title>Link expired</title><body style="font-family:system-ui;padding:40px;max-width:600px;margin:0 auto"><h1>Sign-in link expired</h1><p>Magic links are valid for 15 minutes. <a href="/account/">Request a new one</a>.</p></body>`);
  }

  // One-time use — delete the token immediately
  await kv.del(auth.magicKvKey(token));

  // Mint a session cookie and redirect to /account/.
  // Sprint BG-3.2 phase 2 — generate a sid up front so the cookie AND
  // the persisted session record carry the same value. recordSession is
  // fire-and-forget: a KV write failure can't break the user's sign-in.
  const sid = auth.generateSessionId();
  const sessionValue = auth.buildSessionCookie(email, { sid });
  const isProd = (req.headers['x-forwarded-proto'] === 'https') || process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  res.setHeader('Set-Cookie', auth.buildSetCookieHeader(sessionValue, { secure: isProd }));
  const signinIp = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || null;
  const ua = (req.headers['user-agent'] || '').toString();
  auth.recordSession({
    sid, email,
    iat: Date.now(),
    exp: Date.now() + auth.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    ua, ip: signinIp,
  }).catch(() => { /* silent — session metadata is non-load-bearing */ });
  // Sprint BG-5.5 — audit trail: every successful magic-link sign-in.
  try { await events.record('auth_signin', { email, source: 'magic-link', ip: signinIp, sid }); } catch (_) {}
  res.statusCode = 302;
  res.setHeader('Location', '/account/');
  return res.end();
}

// GET /api/auth/me
//   → { email, iat, exp } if signed in
//   → 401 { error: 'Not signed in' } otherwise
async function handleMe(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  const user = auth.getCurrentUser(req);
  if (!user) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Not signed in' }));
  }
  // Sprint admin-session-auth — surface isAdmin so /account/ can render
  // the admin-dashboards card without a second round-trip. Pure env-var
  // allowlist check; no KV call, no extra latency.
  const isAdmin = adminAuth.isAdminEmail(user.email);
  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: true, user, isAdmin }));
}

// POST /api/auth/logout
//   → clears the session cookie
async function handleLogout(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  // Sprint BG-5.5 — audit trail: log out events. Only record when we can
  // identify the user (cookie present); otherwise it's noise.
  const sessionUser = auth.getCurrentUser(req);
  res.setHeader('Set-Cookie', auth.buildClearCookieHeader());
  if (sessionUser) {
    try { await events.record('auth_logout', { email: sessionUser.email, method: req.method }); } catch (_) {}
  }
  if (req.method === 'GET') {
    res.statusCode = 302;
    res.setHeader('Location', '/account/');
    return res.end();
  }
  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: true }));
}

// POST /api/auth/revoke-all  (Sprint BG-3.2 phase 1)
//   → writes a per-email min-iat timestamp so every active session for the
//     signed-in user — across every device — stops working on the next
//     request. Also clears the local session cookie so the current device
//     is logged out immediately without waiting for the strict check.
//   → 401 if not signed in
//   → 200 { ok: true } on success
async function handleRevokeAll(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  const user = auth.getCurrentUser(req);
  if (!user) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Not signed in' }));
  }
  const reqLog = log.withContext({ requestId: req.requestId, action: 'revoke_all_sessions' });
  const ok = await auth.revokeAllSessionsForEmail(user.email);
  reqLog.info('sessions revoked', { email: user.email, ok });
  // Clear the local cookie too — strict handlers will already reject the
  // bearer on next hit, but logging out the current tab is the obvious UX.
  res.setHeader('Set-Cookie', auth.buildClearCookieHeader());
  // Sprint BG-5.5 — audit trail. The user's reason for clicking "Sign out
  // everywhere" is typically "I think someone has my session" — the
  // auditor needs to see this in the dashboard immediately.
  if (ok) {
    try { await events.record('auth_revoke_all', { email: user.email }); } catch (_) {}
  }
  res.statusCode = 200;
  return res.end(JSON.stringify({ ok }));
}

// ── Sprint BG-3.2 phase 2 — visible sessions list ────
//
// GET  /api/auth/sessions             → list the signed-in user's active
//                                       sessions (own only; ownership
//                                       enforced via the session cookie).
// POST /api/auth/sessions/<sid>/revoke → revoke ONE session. Idempotent.
//
// Both gated by getCurrentUserStrict so a per-email "Sign out everywhere"
// kicks listing/revocation flows out on the next request, on every device.

async function handleListSessions(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  const user = await auth.getCurrentUserStrict(req);
  if (!user) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Not signed in' }));
  }
  const sessions = await auth.listSessionsForEmail(user.email);
  // Redact: never return raw IP to the client (it's enough that the
  // server knows). UA stays — it's the "what device is this?" hint.
  const safe = sessions.map((s) => ({
    sid: s.sid,
    ua: s.ua || null,
    createdAt: s.createdAt || null,
    lastSeenAt: s.lastSeenAt || null,
    exp: s.exp || null,
    isCurrent: user.sid && s.sid === user.sid,
  }));
  res.statusCode = 200;
  return res.end(JSON.stringify({
    ok: true,
    sessions: safe,
    // Lets the UI render a "legacy session — re-sign-in for per-device
    // controls" banner without round-tripping again.
    currentSid: user.sid || null,
  }));
}

async function handleRevokeSession(req, res, sid) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  if (!sid || !/^[a-f0-9]{16}$/.test(sid)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'sid required (16 hex chars)' }));
  }
  const user = await auth.getCurrentUserStrict(req);
  if (!user) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Not signed in' }));
  }
  const ok = await auth.revokeSession(sid, user.email);
  if (!ok) {
    // 404 NOT 403 — don't leak whether the sid exists.
    res.statusCode = 404;
    return res.end(JSON.stringify({ error: 'Session not found' }));
  }
  // Audit row — different type from auth_revoke_all so an auditor can
  // grep per-device events distinctly from the all-devices flow.
  try { await events.record('auth_session_revoked', { email: user.email, sid }); } catch (_) {}
  // If the user revoked their CURRENT session, clear the cookie too —
  // otherwise the next request would 401 with a stale cookie still in
  // the browser. Same behaviour as POST /api/auth/logout.
  if (user.sid && user.sid === sid) {
    res.setHeader('Set-Cookie', auth.buildClearCookieHeader());
  }
  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: true, sid }));
}

// ── Dispatcher ─────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Determine the sub-action from the second URL segment.
  // Sprint BG-3.2 phase 2 — also capture a third + fourth segment for
  // /api/auth/sessions/<sid>/revoke (sid + sub-sub-action).
  let action = '';
  let sid = '';
  let subSubAction = '';
  if (req.query && req.query.path) {
    const arr = Array.isArray(req.query.path) ? req.query.path : String(req.query.path).split('/');
    action = arr[1] || '';
    sid = arr[2] || '';
    subSubAction = arr[3] || '';
  } else {
    const pathname = (req.url || '').split('?')[0];
    const segments = pathname.replace(/^\/api\/auth\/?/, '').split('/').filter(Boolean);
    action = segments[0] || '';
    sid = segments[1] || '';
    subSubAction = segments[2] || '';
  }

  switch (action) {
    case 'request':     return handleRequest(req, res);
    case 'verify':      return handleVerify(req, res);
    case 'me':          return handleMe(req, res);
    case 'logout':      return handleLogout(req, res);
    case 'revoke-all':  return handleRevokeAll(req, res);
    case 'sessions':
      // /api/auth/sessions                    → list
      // /api/auth/sessions/<sid>/revoke       → revoke one
      if (!sid) return handleListSessions(req, res);
      if (subSubAction === 'revoke') return handleRevokeSession(req, res, sid);
      res.statusCode = 404;
      return res.end(JSON.stringify({
        error: 'Unknown /api/auth/sessions sub-action',
        available: ['GET /api/auth/sessions', 'POST /api/auth/sessions/<sid>/revoke'],
      }));
    default:
      res.statusCode = 404;
      return res.end(JSON.stringify({
        error: 'Unknown auth action',
        available: ['request', 'verify', 'me', 'logout', 'revoke-all', 'sessions'],
      }));
  }
};

// Test exports
module.exports.handleRequest = handleRequest;
module.exports.handleVerify = handleVerify;
module.exports.handleMe = handleMe;
module.exports.handleLogout = handleLogout;
module.exports.handleRevokeAll = handleRevokeAll;
module.exports.handleListSessions = handleListSessions;
module.exports.handleRevokeSession = handleRevokeSession;
module.exports.sendMagicLinkEmail = sendMagicLinkEmail;
