'use strict';

// Quote Studio access gate (Sprint quote-rebrand-v1).
//
// Quote Studio is an internal team tool — sales/ops drop in a supplier PDF and
// get a branded OrcaTrade quotation. That's a *less* sensitive operation than
// the admin dashboards (audit log, conversion analytics, calibration), so it
// gets its OWN allowlist rather than reusing ORCATRADE_ADMIN_EMAILS. A teammate
// you put on the quoting list can make quotes WITHOUT also being handed the
// platform's audit feed and revenue analytics.
//
// Access is granted to, in order:
//   1. A signed-in user whose email is on ORCATRADE_QUOTE_STUDIO_EMAILS
//      (comma-separated) — the everyday team path.
//   2. Anyone who already passes the admin gate (founder session email on
//      ORCATRADE_ADMIN_EMAILS, or the legacy X-Admin-Token / ?token=…). Admins
//      implicitly have access, and the token path keeps headless/curl working.
//
// Return shape mirrors admin-auth.verifyAdmin so callers handle both the same:
//   { ok: true,  mode: 'session'|'token', email? }
//   { ok: false, statusCode: 401|503, error }

const auth = require('./auth');
const adminAuth = require('./admin-auth');

const QS_EMAILS_ENV = 'ORCATRADE_QUOTE_STUDIO_EMAILS';

function teamEmailList() {
  const raw = process.env[QS_EMAILS_ENV];
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => String(s).trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function isTeamEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const normalised = email.trim().toLowerCase();
  if (!normalised) return false;
  return teamEmailList().includes(normalised);
}

// Configured if EITHER the dedicated team list OR the admin gate is wired —
// the admin path alone is enough for the founder to use the tool on day one.
function isConfigured() {
  return teamEmailList().length > 0 || adminAuth.isConfigured();
}

async function verifyQuoteStudioAccess(req) {
  if (!isConfigured()) {
    return {
      ok: false,
      statusCode: 503,
      error: `Quote Studio access not configured (set ${QS_EMAILS_ENV} and/or ${adminAuth.ADMIN_EMAILS_ENV})`,
    };
  }

  // 1. Dedicated team allowlist via session cookie. getCurrentUserStrict
  //    honours "sign out everywhere", so a revoked teammate loses access on
  //    their next request.
  try {
    const user = await auth.getCurrentUserStrict(req);
    if (user && isTeamEmail(user.email)) {
      return { ok: true, mode: 'session', email: user.email };
    }
  } catch (_) {
    // fall through to the admin gate
  }

  // 2. Admins (and the legacy token) implicitly pass. verifyAdmin re-checks the
  //    session against the admin allowlist and then the token; both are fine.
  const adminVerdict = await adminAuth.verifyAdmin(req);
  if (adminVerdict.ok) return adminVerdict;

  return { ok: false, statusCode: 401, error: 'Unauthorized' };
}

module.exports = {
  QS_EMAILS_ENV,
  teamEmailList,
  isTeamEmail,
  isConfigured,
  verifyQuoteStudioAccess,
};
