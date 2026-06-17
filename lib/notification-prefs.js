// User notification preferences — Sprint prefs-v1.
//
// Today the only outbound user-comm is plan-revision-emails (driven
// from lib/handlers/cron.js). The cron has been sending without an
// explicit opt-in surface — defensible as "service-related" since
// the user actively saved the plan we're emailing them about, but
// a real compliance / UX gap.
//
// This module is the prefs storage + opt-out layer:
//   - getPrefs(email)                    → { planRevisionEmails }
//   - setPrefs(email, partial)           → merged record
//   - isEnabled(email, key)              → boolean (default true)
//   - generateUnsubscribeToken(email)    → HMAC-signed token
//   - verifyUnsubscribeToken(token)      → email | null
//
// Default for every pref is `true` (backwards-compatible — users
// who created their account before this sprint keep getting their
// plan-revision emails until they explicitly opt out).
//
// Unsubscribe-token shape: `<email-base64url>.<hmac-hex>`. HMAC is
// SHA-256 of the email using ORCATRADE_AUTH_SECRET. No expiry —
// the token is per-email-forever; revocation is not a use case
// (the user always has the option to re-opt-in via /account/preferences/).

'use strict';

const crypto = require('node:crypto');
const kv = require('./intelligence/kv-store');

const PREFS_KEY_PREFIX = 'prefs:';
const PREFS_TTL_DAYS = 2 * 365; // 2 years — refresh on every change

// Keys here have to match the booleans we read in lib/handlers/cron.js
// and surface in /account/preferences/. Adding a new key is a 3-line
// change: add to PREF_KEYS, ALLOWED_PREFS, and the UI.
//
// Sprint 24 — operator-wedge notification preferences. Across 23
// sprints we built 6 customer/ops email touchpoints and shipped them
// all "always on." Enterprise customers with many users get buffeted
// by every state change. Each new key below mutes one sender path;
// the sender code consults isEnabled(email, key) before calling
// email.send. Default behaviour stays opt-out (everything ON until
// the user actively opts out), so backwards-compatibility is
// preserved for every existing user.
const PREF_KEYS = [
  // Legacy (pre-sprint-24).
  'planRevisionEmails',
  'weeklyDigestEmails',
  'complianceDeadlineEmails',
  'monitoringAlerts',
  // Sprint 24 — customer-side operator-wedge emails.
  'importQuoteReadyEmails',      // ops approved my request → customer email
  'importDeclineEmails',         // ops declined my request with reason → customer email
  'importShipmentStatusEmails',  // shipment status flipped → customer email
  'importMessageEmails',         // someone posted on my thread → email (both sides)
  // Sprint 24 — ops-side operator-wedge emails.
  'importQueueIntakeEmails',     // new request landed in queue → ops admin email
  'importCustomerDecisionEmails',// customer approved/rejected → ops admin email
  // Sprint 26 — weekly Ops Insights digest. Distinct from the
  // transactional ops emails above: this is a Monday-morning summary
  // of last week's funnel + decline cohort + revision recovery
  // (sprint 17 aggregation). Opt-in semantically — defaults to true
  // (opt-out) to match the rest of PREF_KEYS but the cron handler
  // skips an org entirely if zero admins are subscribed.
  'importInsightsDigestEmails',  // weekly Monday Ops Insights summary → ops admin email
  // Sprint 33 — immediate 1-2★ rating alert. The transactional
  // complement to sprint 26's weekly digest: a customer rating
  // dropped to 1 or 2 stars deserves outreach within hours, not
  // by Monday. Pref-gated per-admin so a vacation muter doesn't
  // get woken up; the cohort signal still surfaces on
  // /imports/insights for whoever DOES check.
  'importLowRatingAlertEmails',  // 1-2★ rating posted → ops admin alert
  // Sprint 39 — daily stalled-queue alert. The transactional
  // complement to sprint 26's weekly digest, matching the sprint-38
  // proactive cohort. Stalls (awaiting_review with no activity for
  // > 7 days) deserve daily attention, not weekly; the cron fan-out
  // runs morning UK time so ops can act before customers escalate.
  // Pref-gated per-admin (same vacation-mute posture as low-rating
  // alerts); the dashboard cohort card on /imports/insights still
  // surfaces the stall list for anyone who checks live.
  'importStalledQueueAlertEmails',// daily stalled-queue alert → ops admin email
  // Sprint 41 — daily decline-spike alert. Matching the sprint-40
  // second proactive cohort: decline reasons whose 7-day pace is
  // >= 2x the 30-day baseline (or first-time appearance) with
  // count >= 3. A spike is a TREND, but a trend that catches a
  // genuine supplier-compliance / regulatory-shift issue deserves
  // ops attention within a day, not a week. Cron staggers 30 min
  // after the stall alert. Healthy days (spikes.length === 0)
  // skip silently — same posture as sprint 39's stall alert.
  'importDeclineSpikeAlertEmails',// daily decline-reason spike alert → ops admin email
];

// Sprint email-locale-v1 — per-user locale for transactional emails.
// Separate from PREF_KEYS because it's a string, not a boolean. Default
// 'en' for backwards compat (pre-sprint users keep getting EN emails).
const ALLOWED_LOCALES = Object.freeze(['en', 'pl', 'de']);
const DEFAULT_LOCALE = 'en';

function normaliseEmail(email) {
  return String(email || '').toLowerCase().trim();
}

function normaliseLocale(locale) {
  const l = String(locale || '').toLowerCase().trim();
  return ALLOWED_LOCALES.includes(l) ? l : DEFAULT_LOCALE;
}

function prefsKey(email) {
  return PREFS_KEY_PREFIX + normaliseEmail(email);
}

function defaultPrefs() {
  // Every shipping pref defaults to TRUE — opt-out semantics. A user
  // who has never visited /account/preferences/ keeps receiving the
  // emails they've been receiving since BG-J.
  const out = {};
  for (const k of PREF_KEYS) out[k] = true;
  out.locale = DEFAULT_LOCALE;
  return out;
}

async function getPrefs(email) {
  const e = normaliseEmail(email);
  if (!e) return defaultPrefs();
  const rec = await kv.get(prefsKey(e));
  if (!rec || typeof rec !== 'object') return defaultPrefs();
  // Merge over defaults so a new pref key added in a later sprint
  // returns its default rather than undefined.
  const out = defaultPrefs();
  for (const k of PREF_KEYS) {
    if (typeof rec[k] === 'boolean') out[k] = rec[k];
  }
  if (typeof rec.locale === 'string' && ALLOWED_LOCALES.includes(rec.locale)) {
    out.locale = rec.locale;
  }
  return out;
}

async function setPrefs(email, partial) {
  const e = normaliseEmail(email);
  if (!e) throw new Error('setPrefs: email required');
  const safe = (partial && typeof partial === 'object') ? partial : {};
  const current = await getPrefs(e);
  // Only accept known pref keys — silently drop anything else.
  for (const k of PREF_KEYS) {
    if (typeof safe[k] === 'boolean') current[k] = safe[k];
  }
  // Locale uses normaliseLocale so an unknown value falls back to EN
  // rather than throwing — surface-area discipline matches the email
  // formatters which all accept any string and fall back to EN.
  if (safe.locale !== undefined) {
    current.locale = normaliseLocale(safe.locale);
  }
  const stored = {
    ...current,
    updatedAt: new Date().toISOString(),
  };
  await kv.set(prefsKey(e), stored, { ttlSeconds: PREFS_TTL_DAYS * 24 * 60 * 60 });
  return stored;
}

// Locale-only setter — used by the welcome trigger to write-through
// the wizard's locale on first plan save WITHOUT touching the boolean
// prefs (a setPrefs({locale}) call without booleans would otherwise
// look like a no-op POST in the audit log).
async function setLocaleIfMissing(email, locale) {
  const e = normaliseEmail(email);
  if (!e) return null;
  const l = normaliseLocale(locale);
  const current = await getPrefs(e);
  // Don't overwrite an existing non-default locale — the user may have
  // explicitly chosen one on /account/preferences/.
  if (current.locale && current.locale !== DEFAULT_LOCALE) return current;
  // No-op if the wizard's locale matches what we'd default to anyway —
  // avoids writing a KV record with no information value.
  if (l === DEFAULT_LOCALE && !(await kv.get(prefsKey(e)))) return current;
  const stored = {
    ...current,
    locale: l,
    updatedAt: new Date().toISOString(),
  };
  await kv.set(prefsKey(e), stored, { ttlSeconds: PREFS_TTL_DAYS * 24 * 60 * 60 });
  return stored;
}

async function getLocale(email) {
  const prefs = await getPrefs(email);
  return prefs.locale || DEFAULT_LOCALE;
}

async function isEnabled(email, key) {
  if (!PREF_KEYS.includes(key)) return false;
  const prefs = await getPrefs(email);
  return prefs[key] === true;
}

// ── Unsubscribe-token signing / verification ─────────────

function authSecret() {
  // Reuse the auth-cookie secret. It's already in production for
  // session signing; we lean on the same KMS posture.
  return process.env.ORCATRADE_AUTH_SECRET || 'dev-fallback-orcatrade-prefs';
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function generateUnsubscribeToken(email) {
  const e = normaliseEmail(email);
  if (!e) throw new Error('generateUnsubscribeToken: email required');
  const encoded = base64url(e);
  const sig = crypto.createHmac('sha256', authSecret()).update(encoded).digest('hex');
  return encoded + '.' + sig;
}

// Returns the email if the token is valid, null otherwise. Constant-
// time comparison so a guessing attack can't time-side-channel a
// valid signature.
function verifyUnsubscribeToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;
  const expected = crypto.createHmac('sha256', authSecret()).update(encoded).digest('hex');
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch (_) {
    return null;
  }
  let email;
  try { email = base64urlDecode(encoded); }
  catch (_) { return null; }
  return normaliseEmail(email) || null;
}

module.exports = {
  PREFS_KEY_PREFIX,
  PREFS_TTL_DAYS,
  PREF_KEYS,
  ALLOWED_LOCALES,
  DEFAULT_LOCALE,
  prefsKey,
  normaliseLocale,
  defaultPrefs,
  getPrefs,
  setPrefs,
  setLocaleIfMissing,
  getLocale,
  isEnabled,
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
};
