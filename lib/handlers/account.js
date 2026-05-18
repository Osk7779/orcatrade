// /api/account/* — GDPR data subject endpoints.
//
//   GET  /api/account/export   → application/json download of everything we hold
//   POST /api/account/delete   → soft-delete + pseudonymise + clear session
//
// Both endpoints require a valid session cookie (getCurrentUser). 401
// otherwise. The dispatcher reads the second URL segment to pick the
// action (mirrors lib/handlers/auth.js pattern).
//
// What "everything we hold" covers (Track 5.1 of backend-grade-plan.md):
//   - User identity from the session cookie (email + issuedAt + expiresAt)
//   - Saved plans + their snapshots
//   - Event-log entries whose payload.email matches (founding_applied is
//     the only event type that carries the email today; import_plan_generated
//     intentionally stores emailProvided:boolean rather than the address)
//
// Deletion semantics:
//   - Saved plans → hard-deleted by id, ownership-checked
//   - Events → pseudonymised: email replaced with "deleted-<sha256-prefix>"
//     so historical analytics still work without tying back to the user
//   - Session cookie cleared on the response so the user is signed out
//   - A gdpr_account_deleted audit log line is written (no PII; just the
//     hash) so we have evidence the request was honoured

'use strict';

const crypto = require('node:crypto');

const auth = require('../auth');
const kv = require('../intelligence/kv-store');
const savedPlans = require('../saved-plans');
const events = require('../events');
const log = require('../log').withContext({ handler: 'account' });

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://orcatrade.pl';

function emailHash(email) {
  return crypto.createHash('sha256').update(String(email).toLowerCase().trim()).digest('hex').slice(0, 16);
}

function pseudonymForDeletedUser(email) {
  return `deleted-${emailHash(email)}@anonymised.local`;
}

function jsonResponse(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  return res.end(JSON.stringify(body));
}

function actionFromUrl(req) {
  if (req.query && req.query.path) {
    const parts = Array.isArray(req.query.path) ? req.query.path : String(req.query.path).split('/');
    return parts[1] || '';
  }
  const url = (req.url || '').split('?')[0];
  const segments = url.replace(/^\/api\/account\/?/, '').split('/').filter(Boolean);
  return segments[0] || '';
}

// ── GET /api/account/export ───────────────────────────────────

async function handleExport(req, res, user) {
  const reqLog = log.withContext({ requestId: req.requestId, action: 'export' });

  // 1. Saved plans — listPlans returns full records (with snapshot + inputs).
  const fullPlans = await savedPlans.listPlans(user.email);

  // 2. Events — scan the global log for entries that reference this email.
  // import_plan_generated stores emailProvided:boolean (no address), so the
  // hits are mostly founding_applied + future event types that carry email.
  const allEvents = await events.list({ limit: 5000 });
  const myEvents = allEvents.filter((e) => {
    if (!e) return false;
    if (e.email && String(e.email).toLowerCase() === user.email) return true;
    return false;
  });

  reqLog.info('gdpr export prepared', {
    savedPlanCount: fullPlans.length,
    eventCount: myEvents.length,
  });

  // Sprint BG-5.5 — audit trail. GDPR exports are themselves a data event
  // — the auditor must see when an export happened so a compromised
  // account can be traced back to "did they download everything before
  // the change?"
  try {
    await events.record('account_exported', {
      email: user.email,
      savedPlanCount: fullPlans.length,
      eventCount: myEvents.length,
    });
  } catch (_) {}

  const payload = {
    format: 'orcatrade-gdpr-export-v1',
    exportedAt: new Date().toISOString(),
    user: {
      email: user.email,
      sessionIssuedAt: user.iat ? new Date(user.iat * 1000).toISOString() : null,
      sessionExpiresAt: user.exp ? new Date(user.exp * 1000).toISOString() : null,
    },
    savedPlans: fullPlans,
    events: myEvents,
    notes: [
      'This file is a complete copy of the personal data OrcaTrade stores about you, as required by GDPR Article 20 (right to data portability).',
      'Saved plans include the wizard inputs you supplied and the calculator outputs we generated.',
      'Event entries listed here are the ones where the email field directly matched yours. Aggregate analytics (e.g. plan generations) are anonymised at write time and are not tied to your identity.',
      'To delete the data shown here, POST { confirm: true } to /api/account/delete.',
    ],
  };

  const filename = `orcatrade-export-${user.email.replace(/[^a-z0-9]/gi, '_')}.json`;
  return jsonResponse(res, 200, payload, {
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
}

// ── POST /api/account/delete ──────────────────────────────────

async function handleDelete(req, res, user) {
  const reqLog = log.withContext({ requestId: req.requestId, action: 'delete' });

  // Body must explicitly carry { confirm: true } to avoid accidental deletes
  // from misbehaving clients. The frontend modal sets this after a typed-email
  // confirmation step.
  const body = req.body || {};
  if (body.confirm !== true) {
    return jsonResponse(res, 400, {
      error: 'Account deletion requires explicit confirmation. POST { "confirm": true }.',
    });
  }

  // 1. Delete every saved plan owned by this user.
  const ownedPlans = await savedPlans.listPlans(user.email);
  let plansDeleted = 0;
  for (const p of ownedPlans) {
    const ok = await savedPlans.deletePlan(p.id, user.email);
    if (ok) plansDeleted++;
  }

  // 2. Pseudonymise events. Re-write the global event log with my email
  // replaced by the pseudonym + every other PII field on those events cleared.
  // Aggregations still work (counts/dates/categories) — but the data can no
  // longer be linked back to me.
  const pseudonym = pseudonymForDeletedUser(user.email);
  let eventsScrubbed = 0;
  try {
    const allEvents = await kv.get('events:log');
    if (Array.isArray(allEvents)) {
      const updated = allEvents.map((e) => {
        if (!e || !e.email || String(e.email).toLowerCase() !== user.email) return e;
        eventsScrubbed++;
        return {
          ...e,
          email: pseudonym,
          name: e.name ? 'deleted' : e.name,
          company: e.company ? 'deleted' : e.company,
          role: e.role ? 'deleted' : e.role,
          message: e.message ? 'deleted' : e.message,
          pseudonymised: true,
          pseudonymisedAt: new Date().toISOString(),
        };
      });
      await kv.set('events:log', updated, { ttlSeconds: 365 * 24 * 60 * 60 });
    }
  } catch (err) {
    reqLog.error('event scrub failed', { err: err.message });
  }

  // 3. Audit log — no PII, just the hash so we have evidence the request was honoured.
  reqLog.info('gdpr_account_deleted', {
    emailHash: emailHash(user.email),
    plansDeleted,
    eventsScrubbed,
  });

  // Sprint BG-5.5 — durable audit-event entry. Use the pseudonym (NOT the
  // raw email) as the identity so this row survives without re-PII'ing
  // the very account the user just asked us to forget. Note: this event
  // is written AFTER the pseudonymisation pass above, so it will not be
  // scrubbed by the same pass — that's intentional, it's the evidence.
  try {
    await events.record('account_deleted', {
      email: pseudonym,            // already-pseudonymised identity
      plansDeleted,
      eventsScrubbed,
    });
  } catch (_) {}

  // 4. Clear the session cookie so the user is signed out immediately.
  res.setHeader('Set-Cookie', auth.buildClearCookieHeader());

  return jsonResponse(res, 200, {
    ok: true,
    deleted: {
      plans: plansDeleted,
      eventsScrubbed,
    },
    pseudonym,
    notes: [
      'Your saved plans have been permanently deleted.',
      'Event-log entries that referenced your email have been pseudonymised — aggregate analytics still function but the data can no longer be linked back to you.',
      'Your session has been signed out.',
      'OrcaTrade has no other personal data on you. If you previously paid via Stripe, Stripe retains its own customer record under its own retention policy — contact Stripe directly to delete that.',
    ],
  });
}

// ── Dispatcher ────────────────────────────────────────────────

module.exports = async (req, res) => {
  // CORS preflight + sane defaults.
  res.setHeader('Access-Control-Allow-Origin', SITE_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const action = actionFromUrl(req);

  // Auth gate for all sub-actions. Strict variant honours the per-email
  // revocation list (Sprint BG-3.2 phase 1) — "Sign out everywhere" kicks
  // the user out of these flows on the next request, on every device.
  const user = await auth.getCurrentUserStrict(req);
  if (!user) {
    return jsonResponse(res, 401, { error: 'Not signed in. Use /api/auth/request to receive a magic link.' });
  }

  if (action === 'export' && req.method === 'GET') {
    return handleExport(req, res, user);
  }
  if (action === 'delete' && req.method === 'POST') {
    return handleDelete(req, res, user);
  }

  return jsonResponse(res, 404, {
    error: `Unknown /api/account/${action}. Available: GET /api/account/export, POST /api/account/delete.`,
  });
};

// Test surface
module.exports.emailHash = emailHash;
module.exports.pseudonymForDeletedUser = pseudonymForDeletedUser;
module.exports.handleExport = handleExport;
module.exports.handleDelete = handleDelete;
