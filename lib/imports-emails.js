// @ts-check
'use strict';

// Import-Request email touchpoints — sprint 2 chunk 3.
//
// Three transactional emails fire on import-request state transitions:
//
//   1. "Your import quote is ready" → customer  (transition: awaiting_review → quoted)
//   2. "New import request awaiting review" → ops team  (transition: processing → awaiting_review)
//   3. "Customer just approved a managed import" → ops team  (transition: quoted → customer_approved)
//
// Posture
// ────────
// All sends are FAIL-SOFT (consistent with lib/email.js). A missing
// RESEND_API_KEY or a 5xx from Resend logs a warning and returns
// { ok: false, reason } — never throws, never fails the calling
// transition. The customer's import request goes through regardless.
//
// Recipient resolution
// ────────────────────
// Customer side: ADR 0008 forbids raw PII in Postgres, so the
// import_requests row carries only `created_by_email_hash`. We stash
// the raw email on creation in KV (key `import_request:contact:<id>`)
// with a 90-day TTL. The customer-facing email pulls from there.
//
// Ops side: emails go to a comma-separated list configured via the
// ORCATRADE_OPS_INBOX env var. v1 is a fixed team distribution — sprint
// 3 can graduate to per-org role-based fan-out using lib/orgs.listMembers.
//
// Email content
// ─────────────
// Plain text only in v1 (consistent with the magic-link / digest emails).
// Sprint 3 can layer HTML templates if conversion data justifies it.

const email = require('./email');
const kv = require('./intelligence/kv-store');
const orgs = require('./orgs');
const dbClient = require('./db/client');
const log = require('./log').withContext({ module: 'imports-emails' });

// Roles that should receive ops notifications. Owners + admins per
// lib/rbac.js — analysts / finance / compliance_officer / viewer roles
// are read-mostly and don't need queue alerts in v1.
const OPS_NOTIFICATION_ROLES = new Set(['owner', 'admin']);

const CONTACT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days — long enough for a slow request lifecycle

/** @param {string} externalId */
function contactKey(externalId) {
  return `import_request:contact:${externalId}`;
}

function siteOrigin() {
  return process.env.SITE_ORIGIN || 'https://orcatrade.pl';
}

/** @param {string} externalId */
function customerRequestUrl(externalId) {
  return `${siteOrigin()}/app/imports/${externalId}`;
}

function opsQueueUrl() {
  return `${siteOrigin()}/app/imports/queue`;
}

/** @param {string} externalId */
function opsRequestUrl(externalId) {
  return `${siteOrigin()}/app/imports/${externalId}`;
}

/**
 * Resolve the ops-team inbox list from ORCATRADE_OPS_INBOX. Returns
 * the trimmed list, or [] when unset. Caller treats [] as "no
 * notifications" (returns { ok: false, reason: 'no-inbox' }).
 *
 * @returns {string[]}
 */
function getOpsInbox() {
  const raw = String(process.env.ORCATRADE_OPS_INBOX || '').trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0 && s.includes('@'));
}

/**
 * Sprint 5 ch 2: resolve the per-org admin/owner inboxes from the
 * org's membership record in KV. Falls back to ORCATRADE_OPS_INBOX
 * when (a) no numeric orgId supplied, (b) external_id lookup fails,
 * (c) listMembers returns empty, or (d) no member has an
 * ops-notification role.
 *
 * Returns:
 *   { ok: true, recipients: string[], source: 'org-members' | 'env-inbox' }
 *   { ok: false, recipients: [], source: 'env-inbox' }  when neither
 *      source has anything (caller short-circuits with 'no-inbox')
 *
 * @param {number | null | undefined} orgIdNumeric
 */
async function resolveOpsRecipients(orgIdNumeric) {
  const envFallback = getOpsInbox();
  /** @type {(reason: string) => { ok: boolean, recipients: string[], source: 'env-inbox' | 'org-members', fallbackReason: string }} */
  const fallback = (reason) => ({
    ok: envFallback.length > 0,
    recipients: envFallback,
    source: 'env-inbox',
    fallbackReason: reason,
  });

  if (!Number.isInteger(orgIdNumeric) || /** @type {number} */ (orgIdNumeric) <= 0) {
    return fallback('no-org-id');
  }
  if (!dbClient.isConfigured()) {
    return fallback('postgres-unconfigured');
  }
  let externalId = null;
  try {
    const row = await dbClient.queryOne(
      `SELECT external_id FROM organisations WHERE id = $1`,
      [orgIdNumeric],
    );
    externalId = row ? row.external_id : null;
  } catch (err) {
    log.warn('resolveOpsRecipients: external_id lookup failed', { err: err instanceof Error ? err.message : String(err) });
    return fallback('external-id-lookup-failed');
  }
  if (!externalId) {
    return fallback('external-id-not-found');
  }
  let members = [];
  try {
    members = await orgs.listMembers(externalId);
  } catch (err) {
    log.warn('resolveOpsRecipients: listMembers failed', { err: err instanceof Error ? err.message : String(err) });
    return fallback('list-members-failed');
  }
  const recipients = (Array.isArray(members) ? members : [])
    .filter((/** @type {any} */ m) => m && typeof m.email === 'string' && OPS_NOTIFICATION_ROLES.has(m.role))
    .map((/** @type {any} */ m) => m.email)
    // De-dupe + drop falsy.
    .filter((/** @type {string} */ e, /** @type {number} */ i, /** @type {string[]} */ arr) => e && arr.indexOf(e) === i);

  if (recipients.length === 0) {
    return fallback('no-ops-roles');
  }
  return { ok: true, recipients, source: /** @type {'org-members'} */ ('org-members'), fallbackReason: '' };
}

/**
 * @param {string} externalId
 * @param {string} customerEmail
 */
async function storeCustomerContact(externalId, customerEmail) {
  if (!externalId || !customerEmail) return { ok: false, reason: 'externalId + customerEmail required' };
  try {
    await kv.set(
      contactKey(externalId),
      { email: customerEmail, storedAt: new Date().toISOString() },
      { ttlSeconds: CONTACT_TTL_SECONDS },
    );
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'kv.set failed';
    log.warn('storeCustomerContact failed', { externalId, err: message });
    return { ok: false, reason: message };
  }
}

/**
 * @param {string} externalId
 * @returns {Promise<string | null>}
 */
async function getCustomerContact(externalId) {
  if (!externalId) return null;
  try {
    const record = /** @type {any} */ (await kv.get(contactKey(externalId)));
    if (record && typeof record === 'object' && typeof record.email === 'string') return record.email;
    return null;
  } catch (err) {
    log.warn('getCustomerContact failed', { externalId, err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────

/** @param {unknown} cents */
function eurFromCents(cents) {
  if (!Number.isFinite(Number(cents))) return '—';
  return '€' + Math.round(Number(cents) / 100).toLocaleString('en-IE');
}

// ── Composition ────────────────────────────────────────────────────
//
// Each compose* function is a pure helper exposed for tests. Subject +
// text only; HTML is sprint 3 work.

/**
 * @param {{ externalId: string, label: string, productDescription: string, landedQuote?: any }} request
 */
function composeQuoteReady(request) {
  const total = request.landedQuote ? eurFromCents(request.landedQuote.totalLandedCents) : '—';
  const tier = request.landedQuote ? request.landedQuote.confidenceTier : '?';
  const url = customerRequestUrl(request.externalId);
  const subject = `Your import quote is ready — ${request.label}`;
  const text = [
    `Hi,`,
    ``,
    `Your OrcaTrade managed-import quote is ready.`,
    ``,
    `Request: ${request.label}  (${request.externalId})`,
    `Product: ${request.productDescription}`,
    `Landed total: ${total}  (confidence tier ${tier})`,
    ``,
    `Review and approve here:`,
    `  ${url}`,
    ``,
    `The quote is valid for 14 days from when our team approved it. If`,
    `the inputs change you can submit a new request and we will re-run.`,
    ``,
    `— OrcaTrade Operations`,
  ].join('\n');
  return { subject, text };
}

/**
 * @param {{ externalId: string, label: string, productDescription: string, landedQuote?: any, originCountry?: string | null, destinationCountry: string }} request
 */
function composeNewInQueue(request) {
  const total = request.landedQuote ? eurFromCents(request.landedQuote.totalLandedCents) : '—';
  const tier = request.landedQuote ? request.landedQuote.confidenceTier : '?';
  const warnings = request.landedQuote && Array.isArray(request.landedQuote.confidenceNotes)
    ? request.landedQuote.confidenceNotes : [];
  const route = `${request.originCountry || '?'} → ${request.destinationCountry}`;
  const queueUrl = opsQueueUrl();
  const detailUrl = opsRequestUrl(request.externalId);
  const subject = `[OPS] New import request awaiting review — ${request.label} (${total})`;
  const text = [
    `New import request needs team eyes before it ships to the customer.`,
    ``,
    `Request:  ${request.label}  (${request.externalId})`,
    `Route:    ${route}`,
    `Landed:   ${total}  (tier ${tier})`,
    `Product:  ${request.productDescription}`,
    ``,
    warnings.length
      ? `Warnings (${warnings.length}):\n${warnings.map((/** @type {string} */ w) => '  · ' + w).join('\n')}\n`
      : `No calculator warnings.\n`,
    `Open this request:`,
    `  ${detailUrl}`,
    ``,
    `Or the full queue:`,
    `  ${queueUrl}`,
  ].join('\n');
  return { subject, text };
}

/**
 * @param {{ externalId: string, label: string, productDescription: string, landedQuote?: any }} request
 * @param {{ externalId?: string, label?: string } | null} shipment
 */
function composeCustomerApproved(request, shipment) {
  const total = request.landedQuote ? eurFromCents(request.landedQuote.totalLandedCents) : '—';
  const detailUrl = opsRequestUrl(request.externalId);
  const subject = `[OPS] Customer approved — ${request.label} (${total}) · fulfilment begins`;
  const lines = [
    `A customer just approved an OrcaTrade managed-import quote.`,
    ``,
    `Request:  ${request.label}  (${request.externalId})`,
    `Landed:   ${total}`,
    `Product:  ${request.productDescription}`,
    ``,
  ];
  if (shipment && shipment.externalId) {
    lines.push(
      `Shipment row materialised:`,
      `  ${shipment.externalId}  (status: planned)`,
      ``,
      `Next step: kick off factory PO + book the carrier. The shipment`,
      `entity is the system-of-record for fulfilment from this point.`,
      ``,
    );
  } else {
    lines.push(
      `⚠ Shipment row did NOT materialise automatically — manual create`,
      `required. Check the request's failure / metadata block for the`,
      `cause.`,
      ``,
    );
  }
  lines.push(
    `Open this request:`,
    `  ${detailUrl}`,
  );
  return { subject, text: lines.join('\n') };
}

// ── Public send functions ───────────────────────────────────────────

/**
 * @param {{ request: any }} args
 */
async function sendQuoteReadyEmail({ request }) {
  if (!request || !request.externalId) return { ok: false, reason: 'request required' };
  const to = await getCustomerContact(request.externalId);
  if (!to) {
    log.info('sendQuoteReadyEmail skipped — no customer contact on file', { externalId: request.externalId });
    return { ok: false, reason: 'no-contact' };
  }
  const { subject, text } = composeQuoteReady(request);
  const result = await email.send({ to, subject, text });
  if (!result.ok) {
    log.warn('sendQuoteReadyEmail failed', { externalId: request.externalId, reason: result.reason });
  }
  return result;
}

/**
 * Sprint 5 ch 2: now per-org-aware. Resolves admin/owner emails for
 * the request's org from KV; falls back to ORCATRADE_OPS_INBOX when
 * the org has no admin/owner or the lookup path is unavailable.
 *
 * @param {{ request: any, orgIdNumeric?: number | null }} args
 */
async function sendNewInQueueEmail({ request, orgIdNumeric }) {
  if (!request || !request.externalId) return { ok: false, reason: 'request required' };
  const resolution = await resolveOpsRecipients(orgIdNumeric);
  if (resolution.recipients.length === 0) {
    log.info('sendNewInQueueEmail skipped — no recipients (env + org both empty)', {
      externalId: request.externalId, fallbackReason: resolution.fallbackReason,
    });
    return { ok: false, reason: 'no-inbox' };
  }
  const { subject, text } = composeNewInQueue(request);
  const results = await email.sendMany(resolution.recipients, /** @type {any} */ ({ subject, text }));
  const sent = results.filter((r) => r.result && r.result.ok).length;
  const failed = results.filter((r) => r.result && !r.result.ok).length;
  if (failed > 0) log.warn('sendNewInQueueEmail partial failure', { sent, failed });
  return { ok: sent > 0, sent, failed, source: resolution.source };
}

/**
 * @param {{ request: any, shipment?: any, orgIdNumeric?: number | null }} args
 */
async function sendCustomerApprovedEmail({ request, shipment, orgIdNumeric }) {
  if (!request || !request.externalId) return { ok: false, reason: 'request required' };
  const resolution = await resolveOpsRecipients(orgIdNumeric);
  if (resolution.recipients.length === 0) {
    log.info('sendCustomerApprovedEmail skipped — no recipients (env + org both empty)', {
      externalId: request.externalId, fallbackReason: resolution.fallbackReason,
    });
    return { ok: false, reason: 'no-inbox' };
  }
  const { subject, text } = composeCustomerApproved(request, shipment || null);
  const results = await email.sendMany(resolution.recipients, /** @type {any} */ ({ subject, text }));
  const sent = results.filter((r) => r.result && r.result.ok).length;
  const failed = results.filter((r) => r.result && !r.result.ok).length;
  if (failed > 0) log.warn('sendCustomerApprovedEmail partial failure', { sent, failed });
  return { ok: sent > 0, sent, failed, source: resolution.source };
}

module.exports = {
  // KV-backed contact registry
  storeCustomerContact,
  getCustomerContact,
  // Internal helpers exposed for tests
  getOpsInbox,
  resolveOpsRecipients,
  customerRequestUrl,
  opsQueueUrl,
  opsRequestUrl,
  composeQuoteReady,
  composeNewInQueue,
  composeCustomerApproved,
  CONTACT_TTL_SECONDS,
  OPS_NOTIFICATION_ROLES,
  // Send entry points
  sendQuoteReadyEmail,
  sendNewInQueueEmail,
  sendCustomerApprovedEmail,
};
