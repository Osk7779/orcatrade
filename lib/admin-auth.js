// Sprint admin-session-auth — unified admin auth.
//
// Until this sprint, every admin handler (/api/leads, /api/audit,
// /api/calibration, /api/orgs/admin, /api/orgs/<id>/tier) gated on a
// single shared secret in env ORCATRADE_LEADS_TOKEN — the same value
// pasted into the dashboard's sessionStorage input on every tab. Useful
// for headless ops + curl, but the founder has to do the token dance
// every time and there's no nav from /account/ into the dashboards.
//
// verifyAdmin(req) now accepts EITHER path:
//
//   1. A valid session cookie whose email is on ORCATRADE_ADMIN_EMAILS
//      (comma-separated allowlist) — the everyday founder path. Uses
//      getCurrentUserStrict so a "sign out everywhere" kicks admins out
//      of the dashboards too.
//
//   2. The legacy X-Admin-Token header OR ?token=… query param matching
//      ORCATRADE_LEADS_TOKEN. Kept for curl, CI, and ops tools that
//      can't carry a session cookie.
//
// Both env vars are independent — operations can use either, both, or
// neither (the latter degrades to 503 "admin not configured").
//
// Return shape:
//   { ok: true,  mode: 'session', email }
//   { ok: true,  mode: 'token' }
//   { ok: false, statusCode: 401|503, error }
//
// Callers should jsonResponse(res, verdict.statusCode, { error: verdict.error })
// when ok is false. The 503 path means BOTH allowlist + token are unset
// — no admin can ever auth — which is a config bug worth a distinct code.

'use strict';

const crypto = require('node:crypto');
const auth = require('./auth');

const ADMIN_EMAILS_ENV = 'ORCATRADE_ADMIN_EMAILS';
const ADMIN_TOKEN_ENV = 'ORCATRADE_LEADS_TOKEN';

function adminEmailList() {
  const raw = process.env[ADMIN_EMAILS_ENV];
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => String(s).trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function adminToken() {
  return process.env[ADMIN_TOKEN_ENV] || '';
}

function isAdminEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const normalised = email.trim().toLowerCase();
  if (!normalised) return false;
  return adminEmailList().includes(normalised);
}

// Constant-time compare so a slow attacker can't time out the right token.
function tokensMatch(a, b) {
  if (!a || !b) return false;
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function readQueryParam(req, name) {
  if (req && req.query && req.query[name] != null) return String(req.query[name]);
  const url = (req && req.url) || '';
  const qs = url.split('?')[1] || '';
  const params = new URLSearchParams(qs);
  return params.get(name) || '';
}

function readHeaderToken(req) {
  if (!req || !req.headers) return '';
  return String(
    req.headers['x-admin-token'] ||
    req.headers['X-Admin-Token'] ||
    ''
  );
}

function isConfigured() {
  return adminEmailList().length > 0 || adminToken().length > 0;
}

// Two-path admin gate. Order: try the session cookie first (the founder
// path — no per-tab token paste), then fall back to the legacy token.
// Both paths fully verified before returning; no short-circuit on the
// presence of one credential.
async function verifyAdmin(req) {
  // 503 — neither auth path is wired. Distinguishable from 401 so the
  // dashboard can tell the operator "set an env var" vs "wrong creds".
  if (!isConfigured()) {
    return { ok: false, statusCode: 503, error: 'Admin auth not configured (set ORCATRADE_ADMIN_EMAILS and/or ORCATRADE_LEADS_TOKEN)' };
  }

  // Session-cookie path. getCurrentUserStrict honours the revocation
  // list so "Sign out everywhere" kicks an admin out of the dashboards
  // on the next request.
  try {
    const user = await auth.getCurrentUserStrict(req);
    if (user && isAdminEmail(user.email)) {
      return { ok: true, mode: 'session', email: user.email };
    }
  } catch (_) {
    // fall through to token path
  }

  // Legacy token path — header preferred, query as fallback (URLs leak
  // into logs more than headers, but headless tooling sometimes only
  // has the URL).
  const expected = adminToken();
  if (expected) {
    const provided = readHeaderToken(req) || readQueryParam(req, 'token');
    if (provided && tokensMatch(provided, expected)) {
      return { ok: true, mode: 'token' };
    }
  }

  return { ok: false, statusCode: 401, error: 'Unauthorized' };
}

module.exports = {
  ADMIN_EMAILS_ENV,
  ADMIN_TOKEN_ENV,
  adminEmailList,
  isAdminEmail,
  isConfigured,
  verifyAdmin,
};
