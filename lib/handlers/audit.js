// /api/audit — admin event-by-event feed (Sprint BG-5.3).
//
// Whereas /api/leads aggregates the event log into summary tiles for
// conversion analytics, /api/audit returns the raw rows for an admin
// reviewing who-did-what. Used by /dashboard/audit/ which shows a
// filterable table of recent mutations.
//
//   GET /api/audit?token=…&type=plan_saved&since=YYYY-MM-DD&limit=200
//
// Output: { ok, asOf, mode, total, returned, events: [...] }
// 401 if token missing/wrong; 503 if ORCATRADE_LEADS_TOKEN env unset.
//
// PII redaction: every row is passed through the same lib/log.js redact()
// pipeline that masks email/token/secret/apiKey/cookie/authorization
// fields. An admin reviewing the audit dashboard still sees the row but
// not the raw email address — the dashboard surfaces a deterministic
// hash if needed for cross-event correlation.

'use strict';

const crypto = require('node:crypto');
const events = require('../events');
const kv = require('../intelligence/kv-store');
const log = require('../log').withContext({ handler: 'audit' });
const adminAuth = require('../admin-auth');
const auth = require('../auth');
const orgs = require('../orgs');
const rbac = require('../rbac');
const hashLib = require('../hash');

// Apex III1 — org-scoped audit filter. An event "belongs to" an org
// when its actor's email_hash is in the org's member set. KV events
// carry raw `email`; PG events carry `emailHash`. Normalise both
// sides to email_hash for comparison so PG-served reads (post-cutover)
// agree with KV-served reads (today).
//
// Events with no email field (a few system events have no actor —
// e.g. cron snapshots) are NOT visible in an org-scoped read; only
// the global admin gate sees them. This is intentional: an event
// without an actor cannot be attributed to an org's member set.
function filterByOrgMembership(event, memberHashSet) {
  if (!event || !memberHashSet) return false;
  // Prefer the pre-computed emailHash if present (PG path).
  let h = typeof event.emailHash === 'string' && event.emailHash
    ? event.emailHash
    : null;
  if (!h && event.email) {
    if (hashLib.isAlreadyPseudonym(event.email)) {
      // Post-Article-17 pseudonymised email — already a hash.
      h = String(event.email);
    } else {
      h = hashLib.emailHash(event.email);
    }
  }
  if (!h) return false;
  return memberHashSet.has(h);
}
const auditChain = require('../audit-chain');

function jsonResponse(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

function readQueryParam(req, name) {
  if (req.query && req.query[name] != null) return String(req.query[name]);
  const qs = (req.url || '').split('?')[1] || '';
  return new URLSearchParams(qs).get(name) || '';
}

// SHA-256 first-12-hex of an email. Deterministic across calls so admins
// can correlate "this hash appears in 3 different events" without seeing
// the raw address.
function hashEmail(email) {
  return crypto.createHash('sha256').update(String(email).toLowerCase().trim()).digest('hex').slice(0, 12);
}

// Per-row redaction: mirrors log.js's redact() for the stored event but
// keeps cross-event correlation via the email hash. The redact() helper
// turns email into "ab***" which is fine for one-off reads but loses the
// "same user touched these 3 events" linkability. So we redact via a
// hash here while still surfacing the type/at/locale/category etc.
function redactRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  if (out.email && !String(out.email).startsWith('deleted-')) {
    out.emailHash = hashEmail(out.email);
    delete out.email;
  }
  // Free-text fields can leak PII too — keep first 80 chars or hash.
  if (typeof out.message === 'string') {
    out.message = out.message.length > 80 ? out.message.slice(0, 80) + '…' : out.message;
  }
  return out;
}

// ── Sprint audit-csv-export-v1 — CSV serialiser ──────
//
// Procurement question "send me the audit log of who did what" gets a
// CSV answer instead of "let me build that." Reuses the redactRow
// output (already hashed + truncated) so no extra PII discipline is
// needed at the serialiser — the data is already safe before it
// reaches this layer.
//
// Columns chosen for compliance / DPA-review use cases:
//   at      — ISO timestamp
//   type    — event type (auth_signin, plan_saved, etc.)
//   emailHash — 12-hex pseudonym (NEVER raw email)
//   planId  — when present (plan_saved / actual_reported etc.)
//   orgId   — when present (org_* events)
//   ip      — when present (auth_signin only)
//   payload — JSON-serialised remainder of the row, for fields the
//             above five columns don't cover. JSON-stringified +
//             wrapped in CSV-escaped quotes so a comma in the JSON
//             body doesn't break the column count.

const CSV_COLUMNS = ['at', 'type', 'emailHash', 'planId', 'orgId', 'ip', 'payload'];

function escapeCsvField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s === '') return '';
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Pure: given an array of REDACTED rows (output of redactRow), produce
// an RFC 4180 CSV string with CSV_COLUMNS header. Caller must redact
// FIRST — the serialiser does not introduce any new redaction logic;
// it would be a security regression if it did (because that would
// duplicate / drift from the redactRow contract).
function rowsToCsv(redactedRows) {
  const out = [CSV_COLUMNS.join(',')];
  const safe = Array.isArray(redactedRows) ? redactedRows : [];
  for (const r of safe) {
    if (!r || typeof r !== 'object') continue;
    // Build the payload field from anything not already mapped to a
    // dedicated column. Keep the JSON deterministic-ish by sorting keys.
    const reserved = new Set(['at', 'type', 'emailHash', 'email', 'planId', 'orgId', 'ip']);
    const extras = {};
    for (const k of Object.keys(r).sort()) {
      if (!reserved.has(k)) extras[k] = r[k];
    }
    const payload = Object.keys(extras).length > 0 ? JSON.stringify(extras) : '';
    const row = [
      r.at || '',
      r.type || '',
      r.emailHash || '',
      r.planId || '',
      r.orgId || '',
      r.ip || '',
      payload,
    ];
    out.push(row.map(escapeCsvField).join(','));
  }
  // RFC 4180 says CRLF line endings.
  return out.join('\r\n') + '\r\n';
}

function csvFilename() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return 'orcatrade-audit-' + stamp + '.csv';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }
  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  // Apex III1 — org-scoped audit. When `?org=<orgId>` is present:
  //   * the actor authenticates via session cookie (not the global
  //     admin gate)
  //   * the actor must be a member of <orgId> with rbac AUDIT_READ
  //     (admin / compliance_officer / owner roles by default)
  //   * results are filtered to events whose email_hash is in the
  //     org's member set — never global, never cross-org
  // Without `?org`, the existing global founder gate applies.
  const orgIdParam = readQueryParam(req, 'org') || null;
  let orgMemberHashes = null;   // Set<emailHash> | null (null = global mode)

  if (orgIdParam) {
    const user = auth.getCurrentUser(req);
    if (!user) {
      return jsonResponse(res, 401, { error: 'Sign in required to read org-scoped audit' });
    }
    const role = await orgs.getMemberRole(orgIdParam, user.email);
    if (!role) {
      log.warn('audit org-scope: non-member', { requestId: req.requestId, orgId: orgIdParam });
      return jsonResponse(res, 403, { error: 'Not a member of this org' });
    }
    if (!rbac.can(role, rbac.PERMISSIONS.AUDIT_READ)) {
      log.warn('audit org-scope: role lacks AUDIT_READ', { requestId: req.requestId, orgId: orgIdParam, role });
      return jsonResponse(res, 403, {
        error: 'Your role in this org does not allow audit access',
        requiredPermission: rbac.PERMISSIONS.AUDIT_READ,
      });
    }
    // Build the filter set: every member's email_hash. Raw email
    // never enters the filter — comparison is hash-only, matching
    // the same projection PG stores.
    const members = await orgs.listMembers(orgIdParam);
    orgMemberHashes = new Set(
      (Array.isArray(members) ? members : [])
        .map((m) => m && m.email && hashLib.emailHash(m.email))
        .filter(Boolean),
    );
    log.info('audit org-scope', { requestId: req.requestId, orgId: orgIdParam, role, memberCount: orgMemberHashes.size });
  } else {
    // Global mode: existing admin gate.
    const verdict = await adminAuth.verifyAdmin(req);
    if (!verdict.ok) {
      if (verdict.statusCode === 401) {
        log.warn('audit unauthorized', { requestId: req.requestId, ip: req.headers['x-forwarded-for'] });
      }
      return jsonResponse(res, verdict.statusCode, { error: verdict.error });
    }
  }

  const since = readQueryParam(req, 'since') || null;
  const type = readQueryParam(req, 'type') || null;
  // Limit handling: empty/missing/NaN defaults to 200; any provided number
  // (including 0) is clamped to [1, 1000]. The earlier `|| 200` form
  // silently turned a 0 query into the default — the explicit form
  // here keeps the clamp predictable.
  const rawLimit = readQueryParam(req, 'limit');
  const parsedLimit = Number(rawLimit);
  // Sprint audit-csv-export-v1 — CSV exports get a higher cap (5000)
  // because the use case is "send me the data" rather than "render the
  // dashboard table". JSON path keeps its 1000-row ceiling unchanged.
  const format = String(readQueryParam(req, 'format') || '').toLowerCase();
  const csvMode = format === 'csv';
  const chainMode = format === 'chain';
  const maxLimit = csvMode ? 5000 : 1000;
  const limit = rawLimit === '' || !Number.isFinite(parsedLimit)
    ? (csvMode ? 5000 : 200)
    : Math.min(maxLimit, Math.max(1, parsedLimit));

  // Sprint BG-2.3: read via listUnified() — Postgres when DATABASE_URL
  // is set, KV fallback when empty/unconfigured. Dashboards now escape
  // the 5000-event KV cap automatically once events have accumulated.
  //
  // When `?org=<orgId>` is in play, we read more than `limit` rows
  // (up to MAX_EVENTS) and filter down — without the over-read,
  // a 200-row limit applied before the org filter would return 0
  // rows for any org whose newest events lie deeper than 200 in the
  // global stream. The post-filter slice keeps the response cap honest.
  const readLimit = orgMemberHashes ? events.MAX_EVENTS : limit;
  const allEvents = await events.listUnified({ type, since, limit: readLimit });
  const scopedEvents = orgMemberHashes
    ? allEvents.filter((e) => filterByOrgMembership(e, orgMemberHashes)).slice(0, limit)
    : allEvents;
  const redacted = scopedEvents.map(redactRow);

  log.info('audit accessed', {
    requestId: req.requestId,
    type, since, limit, returned: redacted.length, format: csvMode ? 'csv' : 'json',
  });

  if (csvMode) {
    const csv = rowsToCsv(redacted);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + csvFilename() + '"');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(csv);
  }

  // Sprint audit-chain-v1 — tamper-evident export. Each row carries a hash
  // linking it to the previous; verifyChain() (or any sha256 walk) detects any
  // post-export alteration. Chain is over the PII-free redacted projection.
  if (chainMode) {
    const chained = auditChain.buildChain(redacted);
    return jsonResponse(res, 200, {
      ok: true,
      asOf: new Date().toISOString(),
      mode: kv.getMode(),
      genesis: auditChain.GENESIS,
      headHash: chained.length ? chained[chained.length - 1]._hash : auditChain.GENESIS,
      returned: chained.length,
      verification: 'Each row _hash = sha256(_prevHash + canonical(row)); recompute to verify the export is unaltered.',
      events: chained,
    });
  }

  // Sprint audit-chain-v2 (Pillar III2) — verify the WRITE-TIME stored chain.
  // Unlike the export chain above (computed over redacted rows at request time),
  // this verifies the hashes stamped on each event when it was written, so an
  // in-place edit of a stored row is detectable. Reads from KV (the stamped
  // store); reports the first break, if any.
  if (format === 'verify-stored') {
    const stored = await events.list({ limit: events.MAX_EVENTS });
    const result = events.verifyStoredChain(stored);
    return jsonResponse(res, 200, {
      ok: true,
      asOf: new Date().toISOString(),
      mode: kv.getMode(),
      genesis: events.CHAIN_GENESIS,
      storedChain: result,
      note: 'Verifies the tamper-evidence stamped at write time. The chain covers a non-PII projection, so lawful GDPR erasure does not register as tampering.',
    });
  }

  return jsonResponse(res, 200, {
    ok: true,
    asOf: new Date().toISOString(),
    mode: kv.getMode(),
    scope: orgIdParam ? { orgId: orgIdParam, memberCount: orgMemberHashes ? orgMemberHashes.size : 0 } : 'global',
    type,
    since,
    limit,
    returned: redacted.length,
    events: redacted,
    allowedTypes: [...events.ALLOWED_TYPES].sort(),
  });
};

// Test surface
module.exports.redactRow = redactRow;
module.exports.filterByOrgMembership = filterByOrgMembership;
module.exports.hashEmail = hashEmail;
module.exports.CSV_COLUMNS = CSV_COLUMNS;
module.exports.escapeCsvField = escapeCsvField;
module.exports.rowsToCsv = rowsToCsv;
module.exports.csvFilename = csvFilename;
