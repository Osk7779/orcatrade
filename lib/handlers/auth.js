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

// Sprint password-auth-v1 — sign-in failure throttling. Stricter than
// the magic-link rate limit because /api/auth/login takes a password
// guess: 10 attempts / 15 min / per (IP+email) bucket. Brute-forcing
// across emails is harder than across passwords for a known target, so
// keyed on email AND IP rather than IP alone.
const PASSWORD_LOGIN_RATE_LIMIT = 10;
const PASSWORD_LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
// Sprint mfa-totp-v1 — per-challenge brute-force window for the 6-digit
// code. 5 attempts inside this window then the challenge is burned.
const MFA_VERIFY_WINDOW_MS = 5 * 60 * 1000;

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

async function sendPasswordResetEmail({ email, resetLink }, reqLog = log) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    reqLog.warn('RESEND_API_KEY not set; cannot send password reset', { action: 'send_password_reset' });
    return { sent: false, reason: 'RESEND_API_KEY not set' };
  }
  const from = process.env.RESEND_FROM || 'OrcaTrade <onboarding@resend.dev>';
  const subject = 'Reset your OrcaTrade password';
  const text = `Hello,

A password reset was requested for your OrcaTrade account. Click the link below to choose a new password:

${resetLink}

This link expires in 1 hour and can only be used once. If you did not request this reset, you can safely ignore this email — your password will not change.

— OrcaTrade Group
  Warsaw · London · Hong Kong`;
  return circuit.run('resend', async () => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: email, subject, text }),
    });
    if (!response.ok) {
      const errText = await response.text();
      reqLog.warn('resend send failed', { action: 'send_password_reset', status: response.status, upstreamErr: errText.slice(0, 200) });
      throw new Error(`resend ${response.status}: ${errText.slice(0, 100)}`);
    }
    return { sent: true };
  }, {
    fallback: ({ shortCircuited, err }) => {
      if (shortCircuited) { reqLog.warn('resend send skipped (circuit open)', { action: 'send_password_reset' }); return { sent: false, status: 503, circuit: 'open' }; }
      reqLog.warn('resend send threw', { action: 'send_password_reset', err: err && err.message });
      return { sent: false, error: err && err.message };
    },
  });
}

async function sendSignupConfirmEmail({ email, confirmLink }, reqLog = log) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    reqLog.warn('RESEND_API_KEY not set; cannot send signup confirm', { action: 'send_signup_confirm' });
    return { sent: false, reason: 'RESEND_API_KEY not set' };
  }
  const from = process.env.RESEND_FROM || 'OrcaTrade <onboarding@resend.dev>';
  const subject = 'Confirm your OrcaTrade account';
  const text = `Welcome to OrcaTrade.

Click the link below to confirm your email address and activate your account:

${confirmLink}

This link expires in 1 hour. If you did not request an OrcaTrade account, you can safely ignore this email — nothing will be created.

— OrcaTrade Group
  Warsaw · London · Hong Kong`;
  return circuit.run('resend', async () => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: email, subject, text }),
    });
    if (!response.ok) {
      const errText = await response.text();
      reqLog.warn('resend send failed', { action: 'send_signup_confirm', status: response.status, upstreamErr: errText.slice(0, 200) });
      throw new Error(`resend ${response.status}: ${errText.slice(0, 100)}`);
    }
    return { sent: true };
  }, {
    fallback: ({ shortCircuited, err }) => {
      if (shortCircuited) { reqLog.warn('resend send skipped (circuit open)', { action: 'send_signup_confirm' }); return { sent: false, status: 503, circuit: 'open' }; }
      reqLog.warn('resend send threw', { action: 'send_signup_confirm', err: err && err.message });
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
  // Sprint returnto-resume-v1 — accept a same-site relative URL so the
  // user lands back where they came from after clicking the link. KV
  // record carries an object now; pre-sprint records were a plain
  // string. handleVerify accepts both shapes.
  const returnTo = auth.isSafeReturnTo(body.returnTo) || null;
  const kvValue = returnTo ? { email, returnTo } : email;
  await kv.set(auth.magicKvKey(token), kvValue, { ttlSeconds: auth.MAGIC_TOKEN_TTL_SECONDS });
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

  // KV record is either:
  //   - legacy: a plain email string (pre-Sprint returnto-resume-v1)
  //   - new:    { email, returnTo } (returnTo may be absent)
  const record = await kv.get(auth.magicKvKey(token));
  if (!record) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(`<!doctype html><meta charset="utf-8"><title>Link expired</title><body style="font-family:system-ui;padding:40px;max-width:600px;margin:0 auto"><h1>Sign-in link expired</h1><p>Magic links are valid for 15 minutes. <a href="/account/">Request a new one</a>.</p></body>`);
  }
  let email, returnTo = null;
  if (typeof record === 'string') {
    email = record;
  } else {
    email = record.email;
    returnTo = auth.isSafeReturnTo(record.returnTo) || null;
  }

  // One-time use — delete the token immediately
  await kv.del(auth.magicKvKey(token));

  // Sprint mfa-totp-v1 — the magic link is the FIRST factor. If MFA is
  // enabled, don't mint the session; redirect to an MFA challenge on
  // /account/ (carrying any returnTo through the &return= param so the
  // post-MFA mint can honour it). Without this, magic-link would bypass
  // the second factor entirely.
  if (await auth.isMfaEnabled(email)) {
    const challengeId = await auth.createMfaChallenge(email);
    if (challengeId) {
      let loc = `/account/?mfa=${challengeId}`;
      if (returnTo) loc += `&return=${encodeURIComponent(returnTo)}`;
      res.statusCode = 302;
      res.setHeader('Location', loc);
      return res.end();
    }
    // If we couldn't create a challenge, fail closed — don't silently
    // bypass MFA by falling through to a session mint.
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(`<!doctype html><meta charset="utf-8"><title>Sign-in error</title><body style="font-family:system-ui;padding:40px;max-width:600px;margin:0 auto"><h1>Sign-in could not complete</h1><p>We couldn't start the two-factor step. <a href="/account/">Try again</a>.</p></body>`);
  }

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
  res.setHeader('Location', returnTo || '/account/');
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
  // Sprint password-auth-v1 — surface hasPassword so /account/security/
  // can render "Set password" vs "Change password" without a second call.
  // Failure here MUST NOT break /api/auth/me; treat as false on error.
  let hasPassword = false;
  try { hasPassword = await auth.hasPassword(user.email); } catch (_) {}
  // Sprint mfa-totp-v1 — surface mfaEnabled so /account/security/ renders
  // the right MFA card variant. Failure must not break /api/auth/me.
  let mfaEnabled = false;
  try { mfaEnabled = await auth.isMfaEnabled(user.email); } catch (_) {}
  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: true, user, isAdmin, hasPassword, mfaEnabled }));
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

// ── Sprint password-auth-v1 — password sign-in + change ──
//
// POST /api/auth/login                 — sign in with email + password
// POST /api/auth/password/set          — set or change password (authed)
// POST /api/auth/password/clear        — remove password, revert to magic-link
// POST /api/auth/password/reset/request — forgot-password email
// POST /api/auth/password/reset/confirm — accept reset token + new password
// POST /api/auth/signup                — start sign-up (email-only or email+password)
// GET  /api/auth/signup/confirm        — finalise sign-up from email link

function mintSessionResponse(req, res, email, { source }) {
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
  }).catch(() => { /* silent */ });
  return { sid, signinIp };
}

async function handleLogin(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  const body = req.body || {};
  const email = String(body.email || '').toLowerCase().trim();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!auth.isValidEmail(email) || !password) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Email and password required' }));
  }
  // Bucket on IP+email so an attacker can't burn another email's quota
  // from a single attacker IP, and can't pivot across IPs to brute-force
  // one target email at one-attempt-per-IP. Both attack shapes hit the
  // same per-bucket counter.
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('auth-login', `${ip}:${email}`, PASSWORD_LOGIN_RATE_LIMIT, PASSWORD_LOGIN_RATE_WINDOW_MS);
  if (rate.limited) {
    res.statusCode = 429;
    return res.end(JSON.stringify({ error: 'Too many sign-in attempts. Please wait and try again, or request a magic link.' }));
  }
  const reqLog = log.withContext({ requestId: req.requestId, action: 'password_login' });
  const result = await auth.verifyPassword(email, password);
  if (!result.ok) {
    // 401 with a deliberately-vague message — never disclose whether
    // the email exists or whether it was the password that mismatched.
    // Both no-record and mismatch paths return the same shape.
    reqLog.info('password login failed', { email, reason: result.reason });
    try { await events.record('auth_signin_failed_password', { email, reason: result.reason, ip }); } catch (_) {}
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Invalid email or password' }));
  }
  // Sprint mfa-totp-v1 — password is the FIRST factor. If MFA is
  // enabled, do NOT mint a session yet; issue a short-lived challenge
  // and require a TOTP/backup code via /api/auth/mfa/verify.
  const returnTo = auth.isSafeReturnTo(body.returnTo) || null;
  if (await auth.isMfaEnabled(email)) {
    const challengeId = await auth.createMfaChallenge(email);
    if (!challengeId) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: 'Could not start MFA challenge. Try again.' }));
    }
    reqLog.info('password login ok — mfa required', { email });
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, mfaRequired: true, challengeId, returnTo }));
  }
  // No MFA — mint a session.
  const { sid, signinIp } = mintSessionResponse(req, res, email, { source: 'password' });
  try { await events.record('auth_signin_password', { email, ip: signinIp, sid }); } catch (_) {}
  reqLog.info('password login ok', { email });
  // Sprint returnto-resume-v1 — surface the safe returnTo back to the
  // client. Caller passes it as a body field; we validate before
  // echoing so an attacker who pokes the API directly can't get us to
  // hand back an open-redirect URL the page JS might naively follow.
  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: true, email, returnTo }));
}

async function handlePasswordSet(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  const user = await auth.getCurrentUserStrict(req);
  if (!user) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Not signed in' }));
  }
  const body = req.body || {};
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const strength = auth.validatePasswordStrength(newPassword);
  if (!strength.ok) {
    res.statusCode = 400;
    return res.end(JSON.stringify({
      error: strengthErrorMessage(strength.reason),
      reason: strength.reason,
    }));
  }
  // If a password already exists, the caller MUST verify the current
  // password before rotating. Stops a stolen session cookie from being
  // a path to permanent account takeover via password change. (The
  // forgot-password flow is the escape hatch for a forgotten current.)
  const alreadyHadPassword = await auth.hasPassword(user.email);
  if (alreadyHadPassword) {
    if (!currentPassword) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'Current password required to change password' }));
    }
    const verify = await auth.verifyPassword(user.email, currentPassword);
    if (!verify.ok) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: 'Current password is incorrect' }));
    }
  }
  const setResult = await auth.setPassword(user.email, newPassword);
  if (!setResult.ok) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'Could not save password', reason: setResult.reason }));
  }
  try {
    await events.record(alreadyHadPassword ? 'auth_password_changed' : 'auth_password_set', { email: user.email });
  } catch (_) {}
  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: true, hasPassword: true }));
}

async function handlePasswordClear(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  const user = await auth.getCurrentUserStrict(req);
  if (!user) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Not signed in' }));
  }
  const body = req.body || {};
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const had = await auth.hasPassword(user.email);
  if (!had) {
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, hasPassword: false }));
  }
  if (!currentPassword) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Current password required' }));
  }
  const verify = await auth.verifyPassword(user.email, currentPassword);
  if (!verify.ok) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Current password is incorrect' }));
  }
  await auth.deletePasswordRecord(user.email);
  try { await events.record('auth_password_cleared', { email: user.email }); } catch (_) {}
  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: true, hasPassword: false }));
}

async function handlePasswordResetRequest(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('auth-pwreset', ip, 5, 15 * 60 * 1000);
  if (rate.limited) {
    res.statusCode = 429;
    return res.end(JSON.stringify({ error: 'Too many reset requests. Please wait 15 minutes.' }));
  }
  const body = req.body || {};
  const email = String(body.email || '').toLowerCase().trim();
  if (!auth.isValidEmail(email)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Valid email required' }));
  }
  const reqLog = log.withContext({ requestId: req.requestId, action: 'password_reset_request' });
  // Mint + send ONLY when a password actually exists on the account.
  // We still return 202 universally so callers can't probe which emails
  // have passwords — the response shape gives nothing away.
  const has = await auth.hasPassword(email);
  if (has) {
    const minted = await auth.createPasswordResetToken(email);
    if (minted) {
      const resetLink = `${SITE_ORIGIN}/account/reset/?token=${minted.token}`;
      sendPasswordResetEmail({ email, resetLink }, reqLog).catch(() => {});
      try { await events.record('auth_password_reset_requested', { email, ip }); } catch (_) {}
    }
  } else {
    reqLog.info('password reset for email without password', { email });
  }
  res.statusCode = 202;
  return res.end(JSON.stringify({
    ok: true,
    message: 'If that email has a password set, a reset link is on its way. Check your inbox.',
  }));
}

async function handlePasswordResetConfirm(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  const body = req.body || {};
  const token = typeof body.token === 'string' ? body.token : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (!token) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Reset token required' }));
  }
  const strength = auth.validatePasswordStrength(newPassword);
  if (!strength.ok) {
    res.statusCode = 400;
    return res.end(JSON.stringify({
      error: strengthErrorMessage(strength.reason),
      reason: strength.reason,
    }));
  }
  const email = await auth.consumePasswordResetToken(token);
  if (!email) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Reset link is invalid or has expired. Request a fresh one.' }));
  }
  const setResult = await auth.setPassword(email, newPassword);
  if (!setResult.ok) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'Could not save password', reason: setResult.reason }));
  }
  // After a password reset, every other active session for this email
  // is suspect — kill them all. The fresh sign-in from this browser
  // gets its own cookie below, so the user lands signed in.
  try { await auth.revokeAllSessionsForEmail(email); } catch (_) {}
  const reqLog = log.withContext({ requestId: req.requestId, action: 'password_reset_confirm' });
  const { sid, signinIp } = mintSessionResponse(req, res, email, { source: 'password-reset' });
  try {
    await events.record('auth_password_reset_confirmed', { email });
    await events.record('auth_signin_password', { email, ip: signinIp, sid, source: 'reset' });
  } catch (_) {}
  reqLog.info('password reset ok', { email });
  // Sprint returnto-resume-v1 — same as handleLogin: validated echo of
  // the caller-supplied returnTo so the page JS can navigate after the
  // password change without an extra round-trip.
  const returnTo = auth.isSafeReturnTo(body.returnTo) || null;
  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: true, email, returnTo }));
}

async function handleSignup(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('auth-signup', ip, 5, 15 * 60 * 1000);
  if (rate.limited) {
    res.statusCode = 429;
    return res.end(JSON.stringify({ error: 'Too many signup attempts. Please wait 15 minutes.' }));
  }
  const body = req.body || {};
  const email = String(body.email || '').toLowerCase().trim();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!auth.isValidEmail(email)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Valid email required' }));
  }
  const reqLog = log.withContext({ requestId: req.requestId, action: 'signup_request' });
  // Two paths converge here:
  //   - email only → behaves identically to /api/auth/request (magic
  //     link). We let /signup be a single page that handles both.
  //   - email + password → we hash the password NOW (so the
  //     unhashed form never persists) and stash both in a pending
  //     signup record. The confirmation link minted below carries an
  //     opaque 64-hex token; only on click do we promote the password
  //     record into the canonical `password:<email>` slot.
  // Sprint returnto-resume-v1 — optional same-site relative URL the
  // user lands on after the email-confirmation click. Threaded through
  // both branches (password + magic-link).
  const returnTo = auth.isSafeReturnTo(body.returnTo) || null;
  if (password) {
    const strength = auth.validatePasswordStrength(password);
    if (!strength.ok) {
      res.statusCode = 400;
      return res.end(JSON.stringify({
        error: strengthErrorMessage(strength.reason),
        reason: strength.reason,
      }));
    }
    const passwordRecord = await auth.hashPasswordRecord(password);
    const pending = await auth.createPendingSignup(email, passwordRecord, { returnTo });
    if (!pending) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: 'Could not start signup. Try again in a moment.' }));
    }
    const confirmLink = `${SITE_ORIGIN}/api/auth/signup/confirm?token=${pending.token}`;
    sendSignupConfirmEmail({ email, confirmLink }, reqLog).catch(() => {});
    try { await events.record('auth_signup_requested', { email, withPassword: true, ip }); } catch (_) {}
    res.statusCode = 202;
    return res.end(JSON.stringify({
      ok: true,
      message: 'Check your inbox to confirm your email and finish creating your account.',
      withPassword: true,
    }));
  }
  // Email-only — fall through to the existing magic-link mechanic so
  // /signup AND /account/ share the same code path for that case.
  const token = auth.generateMagicToken();
  const magicValue = returnTo ? { email, returnTo } : email;
  await kv.set(auth.magicKvKey(token), magicValue, { ttlSeconds: auth.MAGIC_TOKEN_TTL_SECONDS });
  const magicLink = `${SITE_ORIGIN}/api/auth/verify?token=${token}`;
  sendMagicLinkEmail({ email, magicLink }, reqLog).catch(() => {});
  try { await events.record('auth_signup_requested', { email, withPassword: false, ip }); } catch (_) {}
  res.statusCode = 202;
  return res.end(JSON.stringify({
    ok: true,
    message: 'Check your inbox for your sign-in link.',
    withPassword: false,
  }));
}

async function handleSignupConfirm(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
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
    return res.end(`<!doctype html><meta charset="utf-8"><title>Invalid link</title><body style="font-family:system-ui;padding:40px;max-width:600px;margin:0 auto"><h1>Invalid confirmation link</h1><p>This link is malformed. <a href="/signup/">Try signing up again</a>.</p></body>`);
  }
  const pending = await auth.consumePendingSignup(token);
  if (!pending || !pending.email) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(`<!doctype html><meta charset="utf-8"><title>Link expired</title><body style="font-family:system-ui;padding:40px;max-width:600px;margin:0 auto"><h1>Confirmation link expired</h1><p>Signup confirmation links are valid for 1 hour. <a href="/signup/">Try signing up again</a>.</p></body>`);
  }
  const email = pending.email;
  if (pending.passwordRecord) {
    const kvStore = require('../intelligence/kv-store');
    try { await kvStore.set(auth.passwordKvKey(email), pending.passwordRecord); } catch (_) { /* best effort */ }
  }
  // Mint a fresh session for the just-confirmed account so the user
  // lands signed in.
  const { sid, signinIp } = mintSessionResponse(req, res, email, { source: 'signup' });
  try {
    await events.record('auth_signup_confirmed', { email, withPassword: !!pending.passwordRecord });
    await events.record('auth_signin', { email, source: 'signup', ip: signinIp, sid });
  } catch (_) {}
  // Sprint returnto-resume-v1 — if the original signup carried a safe
  // returnTo, land the user there instead of /account/?welcome=1. The
  // pre-storage validation already happened in handleSignup; re-check
  // on read as defence-in-depth.
  const returnTo = auth.isSafeReturnTo(pending.returnTo) || null;
  res.statusCode = 302;
  res.setHeader('Location', returnTo || '/account/?welcome=1');
  return res.end();
}

// ── Sprint mfa-totp-v1 — TOTP two-factor ────────────────
//
// POST /api/auth/mfa/begin    — authed: start enrollment, return otpauth URI
// POST /api/auth/mfa/enable   — authed: confirm a code, enable + backup codes
// POST /api/auth/mfa/disable  — authed: verify a code, then disable
// POST /api/auth/mfa/verify   — UNauthed: complete a login challenge
//
// Enrollment is two-step (begin → enable) so a misconfigured app can't
// lock the user out: MFA only gates login once a valid code has been
// confirmed. The login challenge (verify) is the only unauthenticated
// endpoint here — it's rate-limited per challenge to stop brute-forcing
// the 6-digit code.

async function handleMfaBegin(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  const user = await auth.getCurrentUserStrict(req);
  if (!user) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Not signed in' }));
  }
  // Refuse to clobber an already-enabled secret — re-enrolling would
  // momentarily disable MFA (begin sets enabled=false), which a stolen
  // session could abuse as a downgrade. Require explicit disable first.
  if (await auth.isMfaEnabled(user.email)) {
    res.statusCode = 409;
    return res.end(JSON.stringify({ error: 'MFA is already enabled. Disable it first to re-enroll.' }));
  }
  const enrollment = await auth.beginMfaEnrollment(user.email);
  if (!enrollment) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'Could not start MFA enrollment' }));
  }
  // Return the otpauth URI (for QR libraries / deep links) + the base32
  // secret (for manual entry into any authenticator app). We never send
  // the raw hex secret to the client.
  res.statusCode = 200;
  return res.end(JSON.stringify({
    ok: true,
    otpauthUri: enrollment.otpauthUri,
    secret: enrollment.secretB32,
  }));
}

async function handleMfaEnable(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  const user = await auth.getCurrentUserStrict(req);
  if (!user) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Not signed in' }));
  }
  const body = req.body || {};
  const code = typeof body.code === 'string' ? body.code : '';
  if (!code) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Verification code required' }));
  }
  const result = await auth.enableMfa(user.email, code);
  if (!result.ok) {
    const status = result.reason === 'bad-code' ? 400 : (result.reason === 'no-pending-secret' ? 409 : 500);
    const msg = result.reason === 'bad-code'
      ? 'That code didn\'t match. Check your authenticator app and try again.'
      : (result.reason === 'no-pending-secret'
        ? 'No enrollment in progress. Start again.'
        : 'Could not enable MFA');
    res.statusCode = status;
    return res.end(JSON.stringify({ error: msg, reason: result.reason }));
  }
  try { await events.record('auth_mfa_enabled', { email: user.email }); } catch (_) {}
  // Return the plaintext backup codes ONCE — the client must show them
  // now; we only persist hashes.
  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: true, backupCodes: result.backupCodes }));
}

async function handleMfaDisable(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  const user = await auth.getCurrentUserStrict(req);
  if (!user) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Not signed in' }));
  }
  if (!(await auth.isMfaEnabled(user.email))) {
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, mfaEnabled: false }));
  }
  const body = req.body || {};
  const code = typeof body.code === 'string' ? body.code : '';
  // Require a current code (TOTP or backup) before disabling, so a
  // stolen session cookie can't silently strip the second factor.
  const verify = await auth.verifyMfaCode(user.email, code);
  if (!verify.ok) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Enter a current code from your authenticator (or a backup code) to disable MFA.' }));
  }
  await auth.disableMfa(user.email);
  try { await events.record('auth_mfa_disabled', { email: user.email }); } catch (_) {}
  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: true, mfaEnabled: false }));
}

async function handleMfaVerify(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  const body = req.body || {};
  const challengeId = typeof body.challengeId === 'string' ? body.challengeId : '';
  const code = typeof body.code === 'string' ? body.code : '';
  if (!challengeId || !code) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Challenge and code required' }));
  }
  // Rate-limit per challenge — 5 attempts then the challenge is dead.
  // Stops brute-forcing the 6-digit code (10^6 space) within the 5-min
  // window. Keyed on challengeId so each sign-in attempt gets its own
  // budget and one user can't exhaust another's.
  const rate = await consumeRateLimit('mfa-verify', challengeId, 5, MFA_VERIFY_WINDOW_MS);
  if (rate.limited) {
    await auth.deleteMfaChallenge(challengeId);
    res.statusCode = 429;
    return res.end(JSON.stringify({ error: 'Too many attempts. Please sign in again.' }));
  }
  const email = await auth.peekMfaChallenge(challengeId);
  if (!email) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'This sign-in challenge has expired. Please sign in again.' }));
  }
  const verify = await auth.verifyMfaCode(email, code);
  if (!verify.ok) {
    const reqLog = log.withContext({ requestId: req.requestId, action: 'mfa_verify' });
    reqLog.info('mfa challenge failed', { email });
    try { await events.record('auth_mfa_challenge_failed', { email }); } catch (_) {}
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Invalid code' }));
  }
  // Success — burn the challenge and mint the real session.
  await auth.deleteMfaChallenge(challengeId);
  const { sid, signinIp } = mintSessionResponse(req, res, email, { source: 'mfa' });
  try { await events.record('auth_signin', { email, source: 'mfa', method: verify.method, ip: signinIp, sid, mfa: true }); } catch (_) {}
  const returnTo = auth.isSafeReturnTo(body.returnTo) || null;
  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: true, email, returnTo }));
}

function strengthErrorMessage(reason) {
  switch (reason) {
    case 'too-short': return 'Password must be at least 12 characters';
    case 'too-long': return 'Password is too long (max 1024 characters)';
    case 'too-uniform': return 'Password cannot be a single repeated character';
    case 'sequential': return 'Password cannot be a long run of sequential characters';
    case 'not-a-string': return 'Password must be a string';
    default: return 'Password does not meet strength requirements';
  }
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
    case 'login':       return handleLogin(req, res);
    case 'signup':
      // /api/auth/signup           → POST: start sign-up
      // /api/auth/signup/confirm   → GET:  finalise sign-up from email link
      if (!sid) return handleSignup(req, res);
      if (sid === 'confirm') return handleSignupConfirm(req, res);
      res.statusCode = 404;
      return res.end(JSON.stringify({
        error: 'Unknown /api/auth/signup sub-action',
        available: ['POST /api/auth/signup', 'GET /api/auth/signup/confirm?token=…'],
      }));
    case 'password':
      // /api/auth/password/set                 → POST: set/change password
      // /api/auth/password/clear               → POST: remove password
      // /api/auth/password/reset/request       → POST: forgot password
      // /api/auth/password/reset/confirm       → POST: confirm new password
      if (sid === 'set') return handlePasswordSet(req, res);
      if (sid === 'clear') return handlePasswordClear(req, res);
      if (sid === 'reset' && subSubAction === 'request') return handlePasswordResetRequest(req, res);
      if (sid === 'reset' && subSubAction === 'confirm') return handlePasswordResetConfirm(req, res);
      res.statusCode = 404;
      return res.end(JSON.stringify({
        error: 'Unknown /api/auth/password sub-action',
        available: [
          'POST /api/auth/password/set',
          'POST /api/auth/password/clear',
          'POST /api/auth/password/reset/request',
          'POST /api/auth/password/reset/confirm',
        ],
      }));
    case 'mfa':
      // /api/auth/mfa/begin     → POST: start enrollment
      // /api/auth/mfa/enable    → POST: confirm + enable
      // /api/auth/mfa/disable   → POST: verify + disable
      // /api/auth/mfa/verify    → POST: complete a login challenge
      if (sid === 'begin') return handleMfaBegin(req, res);
      if (sid === 'enable') return handleMfaEnable(req, res);
      if (sid === 'disable') return handleMfaDisable(req, res);
      if (sid === 'verify') return handleMfaVerify(req, res);
      res.statusCode = 404;
      return res.end(JSON.stringify({
        error: 'Unknown /api/auth/mfa sub-action',
        available: [
          'POST /api/auth/mfa/begin',
          'POST /api/auth/mfa/enable',
          'POST /api/auth/mfa/disable',
          'POST /api/auth/mfa/verify',
        ],
      }));
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
        available: ['request', 'verify', 'me', 'logout', 'login', 'signup', 'password', 'mfa', 'revoke-all', 'sessions'],
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
module.exports.handleLogin = handleLogin;
module.exports.handlePasswordSet = handlePasswordSet;
module.exports.handlePasswordClear = handlePasswordClear;
module.exports.handlePasswordResetRequest = handlePasswordResetRequest;
module.exports.handlePasswordResetConfirm = handlePasswordResetConfirm;
module.exports.handleSignup = handleSignup;
module.exports.handleSignupConfirm = handleSignupConfirm;
module.exports.handleMfaBegin = handleMfaBegin;
module.exports.handleMfaEnable = handleMfaEnable;
module.exports.handleMfaDisable = handleMfaDisable;
module.exports.handleMfaVerify = handleMfaVerify;
module.exports.strengthErrorMessage = strengthErrorMessage;
module.exports.sendMagicLinkEmail = sendMagicLinkEmail;
module.exports.sendPasswordResetEmail = sendPasswordResetEmail;
module.exports.sendSignupConfirmEmail = sendSignupConfirmEmail;
