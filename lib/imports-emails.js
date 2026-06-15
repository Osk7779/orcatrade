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

// ── Sprint 11 ch 2: HTML email chrome ────────────────────────────────
//
// Transactional emails that customers/ops actually read. Inline-style
// only (Gmail / Outlook / Apple Mail all strip <style> blocks), max
// width 600px, web-safe fonts, light theme for legibility (dark theme
// emails read poorly in light Apple Mail). Aqua brand accent matches
// the app surface.
//
// Every compose* function now returns { subject, text, html }; the
// send* functions pass all three to email.send. The text track is the
// load-bearing one (universal client support) — html is the polish.

const EMAIL_BRAND_AQUA = '#22d3ee';
const EMAIL_INK = '#0a1628';
const EMAIL_BODY = '#1a2236';
const EMAIL_MUTE = '#5a6478';
const EMAIL_SOFT = '#9aa3b8';
const EMAIL_BG = '#f6f8fb';
const EMAIL_CARD_BORDER = '#e5e9f0';
const EMAIL_RULE = '#f0f2f7';

/** @param {unknown} s */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Wrap a body HTML fragment in the standard OrcaTrade email chrome —
 * aqua top stripe + brand wordmark + eyebrow + footer.
 *
 * @param {{ eyebrow: string, bodyHtml: string }} args
 */
function htmlEmailChrome({ eyebrow, bodyHtml }) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>OrcaTrade</title></head>
<body style="margin:0;padding:0;background:${EMAIL_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${EMAIL_BODY};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${EMAIL_BG};"><tr><td align="center" style="padding:40px 20px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid ${EMAIL_CARD_BORDER};border-radius:12px;overflow:hidden;">
<tr><td style="height:6px;background:${EMAIL_BRAND_AQUA};line-height:6px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 36px 12px;">
<div style="font-size:24px;font-weight:700;letter-spacing:-0.02em;color:${EMAIL_INK};">OrcaTrade <span style="color:${EMAIL_BRAND_AQUA};font-weight:500;">Operations</span></div>
<div style="margin-top:6px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${EMAIL_SOFT};">${esc(eyebrow)}</div>
</td></tr>
<tr><td style="padding:18px 36px 36px;">${bodyHtml}</td></tr>
<tr><td style="padding:18px 36px 28px;font-size:11.5px;color:${EMAIL_SOFT};border-top:1px solid ${EMAIL_RULE};">
OrcaTrade Group Ltd · London · Warsaw · Hong Kong
</td></tr>
</table>
</td></tr></table></body></html>`;
}

const HTML_H1 = `margin:0 0 14px;font-size:22px;font-weight:700;letter-spacing:-0.015em;color:${EMAIL_INK};line-height:1.25;`;
const HTML_P = `margin:0 0 16px;font-size:15px;line-height:1.55;color:${EMAIL_BODY};`;
const HTML_DL_ROW_LABEL = `padding:6px 12px 6px 0;font-size:13px;color:${EMAIL_MUTE};vertical-align:top;width:140px;`;
const HTML_DL_ROW_VALUE = `padding:6px 0;font-size:13px;color:${EMAIL_INK};font-weight:500;vertical-align:top;`;
const HTML_BIG_NUMBER = `font-size:30px;font-weight:700;letter-spacing:-0.015em;color:${EMAIL_INK};margin:6px 0 4px;`;
const HTML_CTA = `display:inline-block;padding:13px 22px;background:${EMAIL_BRAND_AQUA};color:${EMAIL_INK};font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;`;
const HTML_WARN_BOX = `margin:14px 0;padding:14px 16px;background:#fef3c7;border-left:3px solid #f59e0b;font-size:13px;color:#78350f;border-radius:8px;line-height:1.45;`;
const HTML_INFO_BOX = `margin:14px 0;padding:14px 16px;background:#ecfeff;border-left:3px solid ${EMAIL_BRAND_AQUA};font-size:13px;color:${EMAIL_BODY};border-radius:8px;line-height:1.45;`;

/**
 * Render a key/value dl as an HTML table (works across all clients).
 * @param {Array<{ label: string, value: string }>} rows
 */
function htmlDl(rows) {
  if (!rows || rows.length === 0) return '';
  const trs = rows.map((r) =>
    `<tr><td style="${HTML_DL_ROW_LABEL}">${esc(r.label)}</td><td style="${HTML_DL_ROW_VALUE}">${esc(r.value)}</td></tr>`
  ).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 18px;border-collapse:collapse;">${trs}</table>`;
}

/** @param {string} url @param {string} label */
function htmlCta(url, label) {
  return `<div style="margin:22px 0 6px;"><a href="${esc(url)}" style="${HTML_CTA}">${esc(label)} →</a></div>`;
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
  const html = htmlEmailChrome({
    eyebrow: 'Your quote is ready',
    bodyHtml: [
      `<h1 style="${HTML_H1}">Your import quote is ready.</h1>`,
      `<p style="${HTML_P}">${esc(request.label)} is approved by our team and ready for your review.</p>`,
      `<div style="${HTML_BIG_NUMBER}">${esc(total)}</div>`,
      `<div style="font-size:12px;color:${EMAIL_MUTE};margin-bottom:12px;">Landed total · confidence tier ${esc(tier)}</div>`,
      htmlDl([
        { label: 'Request', value: `${request.label} · ${request.externalId}` },
        { label: 'Product', value: request.productDescription },
      ]),
      htmlCta(url, 'Review and approve'),
      `<p style="font-size:12.5px;color:${EMAIL_MUTE};margin:24px 0 0;line-height:1.5;">The quote is valid for 14 days from team approval. If the inputs change you can submit a new request and we will re-run.</p>`,
    ].join(''),
  });
  return { subject, text, html };
}

/**
 * @param {{ externalId: string, label: string, productDescription: string, landedQuote?: any, originCountry?: string | null, destinationCountry: string }} request
 * @returns {{ subject: string, text: string, html: string }}
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
  const warningHtml = warnings.length
    ? `<div style="${HTML_WARN_BOX}"><strong>Warnings (${warnings.length})</strong><br>${(/** @type {string[]} */ (warnings)).map((w) => '· ' + esc(w)).join('<br>')}</div>`
    : `<p style="font-size:12.5px;color:${EMAIL_MUTE};margin:0 0 14px;">No calculator warnings.</p>`;
  const html = htmlEmailChrome({
    eyebrow: 'New request awaiting review',
    bodyHtml: [
      `<h1 style="${HTML_H1}">New import request needs team eyes.</h1>`,
      `<p style="${HTML_P}">A customer just submitted a request and the orchestrator has surfaced a shortlist + quote. Review it before it ships to the customer.</p>`,
      htmlDl([
        { label: 'Request', value: `${request.label} · ${request.externalId}` },
        { label: 'Route', value: route },
        { label: 'Landed', value: `${total} · tier ${tier}` },
        { label: 'Product', value: request.productDescription },
      ]),
      warningHtml,
      htmlCta(detailUrl, 'Open this request'),
      `<p style="font-size:12.5px;color:${EMAIL_MUTE};margin:16px 0 0;">Or open the full queue: <a href="${esc(queueUrl)}" style="color:${EMAIL_BRAND_AQUA};text-decoration:none;font-weight:500;">${esc(queueUrl)}</a></p>`,
    ].join(''),
  });
  return { subject, text, html };
}

/**
 * @param {{ externalId: string, label: string, productDescription: string, landedQuote?: any }} request
 * @param {{ externalId?: string, label?: string } | null} shipment
 * @returns {{ subject: string, text: string, html: string }}
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
  const shipmentHtml = shipment && shipment.externalId
    ? `<div style="${HTML_INFO_BOX}"><strong>Shipment row materialised:</strong> ${esc(shipment.externalId)} (status: planned)<br>Next step: kick off factory PO + book the carrier. The shipment entity is the system-of-record for fulfilment from this point.</div>`
    : `<div style="${HTML_WARN_BOX}"><strong>⚠ Shipment row did NOT materialise automatically — manual create required.</strong><br>Check the request's failure / metadata block for the cause.</div>`;
  const html = htmlEmailChrome({
    eyebrow: 'Customer approved · fulfilment begins',
    bodyHtml: [
      `<h1 style="${HTML_H1}">A customer just approved a managed-import quote.</h1>`,
      htmlDl([
        { label: 'Request', value: `${request.label} · ${request.externalId}` },
        { label: 'Landed', value: total },
        { label: 'Product', value: request.productDescription },
      ]),
      shipmentHtml,
      htmlCta(detailUrl, 'Open this request'),
    ].join(''),
  });
  return { subject, text: lines.join('\n'), html };
}

// ── Public send functions ───────────────────────────────────────────

/**
 * Sprint 15 — attaches the landed-cost quote PDF when one is
 * available. The customer's CFO opens the email, sees the attachment,
 * forwards it to their finance team. No second click into the
 * dashboard required. Generation is best-effort: a PDF failure must
 * not block the email — the customer still gets the prose summary
 * and can always download from the dashboard.
 *
 * @param {{ request: any }} args
 */
async function sendQuoteReadyEmail({ request }) {
  if (!request || !request.externalId) return { ok: false, reason: 'request required' };
  const to = await getCustomerContact(request.externalId);
  if (!to) {
    log.info('sendQuoteReadyEmail skipped — no customer contact on file', { externalId: request.externalId });
    return { ok: false, reason: 'no-contact' };
  }
  const { subject, text, html } = composeQuoteReady(request);

  // Best-effort PDF attachment. Generation failure (missing landed
  // quote, malformed shortlist text, pdf-lib throwing) must not block
  // the email — the customer still gets the prose summary + can
  // download from the dashboard.
  /** @type {Array<{ filename: string, content: string }> | null} */
  let attachments = null;
  if (request.landedQuote) {
    try {
      const quotePdf = require('./intelligence/landed-quote-pdf');
      const baseIso = request.lastReviewedAt || request.lastUpdatedAt || new Date().toISOString();
      const validUntilTs = Date.parse(baseIso) + 14 * 24 * 60 * 60 * 1000;
      const validUntil = Number.isFinite(validUntilTs)
        ? new Date(validUntilTs).toISOString().slice(0, 10)
        : null;
      const bytes = await quotePdf.generateLandedQuotePdf({
        request,
        generatedAt: new Date().toISOString().slice(0, 10),
        validUntil: validUntil || undefined,
      });
      attachments = [{
        filename: `orcatrade-quote-${request.externalId}.pdf`,
        content: Buffer.from(bytes).toString('base64'),
      }];
    } catch (err) {
      log.warn('sendQuoteReadyEmail PDF generation failed; sending without attachment', {
        externalId: request.externalId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result = await email.send({ to, subject, text, html, attachments });
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
  const { subject, text, html } = composeNewInQueue(request);
  const results = await email.sendMany(resolution.recipients, /** @type {any} */ ({ subject, text, html }));
  const sent = results.filter((r) => r.result && r.result.ok).length;
  const failed = results.filter((r) => r.result && !r.result.ok).length;
  if (failed > 0) log.warn('sendNewInQueueEmail partial failure', { sent, failed });
  return { ok: sent > 0, sent, failed, source: resolution.source };
}

// ── Sprint 9 ch 2: shipment status-change emails to the customer ─────
//
// Shipments transition through planned → booked → in_transit → cleared →
// delivered (+ exception/cancelled). Each non-planned destination
// status fires a templated email to the customer of the SOURCE
// import_request — the one whose materialiser spawned this shipment.
//
// Shipments created directly via POST /api/shipments (not through the
// materialiser) carry no `metadata.materialisedFromImportRequest` so
// the helper short-circuits with reason='no-source-request' and the
// existing /shipments dashboard surface stays uninterrupted.
//
// Posture: identical to the other email helpers. Fail-soft on every
// failure mode (no metadata, no contact in KV, Resend down). Caller
// is the shipments handler's transition action; it fire-and-forgets
// so no email path ever blocks an operational state transition.

/**
 * URL the customer lands on from the email — their own import-request
 * detail page, which renders the linked-shipment panel (sprint 8) +
 * timeline (sprint 7). Strictly the same surface the customer used
 * to approve, so they get a familiar return.
 *
 * @param {string} sourceRequestExternalId
 */
function customerShipmentReturnUrl(sourceRequestExternalId) {
  return `${siteOrigin()}/app/imports/${sourceRequestExternalId}`;
}

/**
 * Compose subject + text for a status-change email. Returns null when
 * the destination status is one we deliberately do NOT email about
 * (currently just 'planned' — the customer just got the
 * customer_approved email a moment ago).
 *
 * @param {any} shipment
 * @param {string} toStatus
 * @param {string} sourceRequestExternalId
 */
function composeShipmentStatusUpdate(shipment, toStatus, sourceRequestExternalId) {
  const url = customerShipmentReturnUrl(sourceRequestExternalId);
  const label = (shipment && shipment.label) || 'Your import';
  const route = `${(shipment && shipment.originCountry) || '?'} → ${(shipment && shipment.destinationCountry) || '?'}`;
  const eta = shipment && shipment.eta ? `ETA: ${shipment.eta}` : null;
  const exceptionReason = shipment && shipment.exceptionState && shipment.exceptionState.reason
    ? String(shipment.exceptionState.reason)
    : null;
  const dutyPaid = shipment && Number.isFinite(shipment.dutyPaidCents)
    ? eurFromCents(shipment.dutyPaidCents)
    : null;
  const vatPaid = shipment && Number.isFinite(shipment.vatPaidCents)
    ? eurFromCents(shipment.vatPaidCents)
    : null;

  /** @param {string} eyebrow @param {string} headline @param {string} lead @param {Array<{label: string, value: string}>} dl */
  function buildShipmentHtml(eyebrow, headline, lead, dl, extraHtml = '') {
    return htmlEmailChrome({
      eyebrow,
      bodyHtml: [
        `<h1 style="${HTML_H1}">${esc(headline)}</h1>`,
        `<p style="${HTML_P}">${esc(lead)}</p>`,
        htmlDl(dl),
        extraHtml,
        htmlCta(url, 'Track your shipment'),
      ].join(''),
    });
  }

  /** @type {Record<string, () => { subject: string, text: string, html: string }>} */
  const templates = {
    booked: () => {
      const dl = [
        { label: 'Route', value: route },
        shipment.plannedDepartureDate ? { label: 'Departs', value: String(shipment.plannedDepartureDate) } : null,
        shipment.plannedArrivalDate ? { label: 'Arrives', value: String(shipment.plannedArrivalDate) } : null,
      ].filter(Boolean);
      return {
        subject: `Your shipment has been booked · ${label}`,
        text: [
          `Hi,`,
          ``,
          `We have booked your import with the carrier.`,
          ``,
          `Route:    ${route}`,
          shipment.plannedDepartureDate ? `Departs:  ${shipment.plannedDepartureDate}` : null,
          shipment.plannedArrivalDate ? `Arrives:  ${shipment.plannedArrivalDate}` : null,
          ``,
          `Track at:`,
          `  ${url}`,
          ``,
          `— OrcaTrade Operations`,
        ].filter(Boolean).join('\n'),
        html: buildShipmentHtml('Shipment booked', 'Your shipment has been booked.', 'We have booked your import with the carrier.', /** @type {any} */ (dl)),
      };
    },
    in_transit: () => {
      const dl = [
        { label: 'Route', value: route },
        shipment.eta ? { label: 'ETA', value: String(shipment.eta) } : null,
        shipment.carrier ? { label: 'Carrier', value: String(shipment.carrier) } : null,
        shipment.blNumber ? { label: 'B/L', value: String(shipment.blNumber) } : null,
      ].filter(Boolean);
      return {
        subject: `Your shipment is on the way · ${label}`,
        text: [
          `Hi,`,
          ``,
          `Your import has left ${(shipment && shipment.originCountry) || 'origin'} and is on the way.`,
          ``,
          `Route:    ${route}`,
          eta,
          shipment.carrier ? `Carrier:  ${shipment.carrier}` : null,
          shipment.blNumber ? `B/L:      ${shipment.blNumber}` : null,
          ``,
          `Track at:`,
          `  ${url}`,
          ``,
          `— OrcaTrade Operations`,
        ].filter(Boolean).join('\n'),
        html: buildShipmentHtml('Shipment in transit', 'Your shipment is on the way.', `Your import has left ${(shipment && shipment.originCountry) || 'origin'} and is moving towards ${(shipment && shipment.destinationCountry) || 'destination'}.`, /** @type {any} */ (dl)),
      };
    },
    cleared: () => {
      const dl = [
        dutyPaid ? { label: 'Duty paid', value: String(dutyPaid) } : null,
        vatPaid ? { label: 'VAT paid', value: String(vatPaid) } : null,
        shipment.declarationRef ? { label: 'Declaration', value: String(shipment.declarationRef) } : null,
      ].filter(Boolean);
      return {
        subject: `Your shipment has cleared customs · ${label}`,
        text: [
          `Hi,`,
          ``,
          `Customs clearance is complete. Your import is now in the last-mile to ${(shipment && shipment.destinationCountry) || 'destination'}.`,
          ``,
          dutyPaid ? `Duty paid: ${dutyPaid}` : null,
          vatPaid ? `VAT paid:  ${vatPaid}` : null,
          shipment.declarationRef ? `Declaration: ${shipment.declarationRef}` : null,
          ``,
          `Track at:`,
          `  ${url}`,
          ``,
          `— OrcaTrade Operations`,
        ].filter(Boolean).join('\n'),
        html: buildShipmentHtml('Cleared customs', 'Your shipment has cleared customs.', `Customs clearance is complete. Your import is now in the last-mile to ${(shipment && shipment.destinationCountry) || 'destination'}.`, /** @type {any} */ (dl)),
      };
    },
    delivered: () => {
      const dl = [
        { label: 'Route', value: route },
        shipment.deliveredAt ? { label: 'Delivered', value: new Date(shipment.deliveredAt).toLocaleDateString('en-IE') } : null,
      ].filter(Boolean);
      return {
        subject: `Your shipment has been delivered · ${label}`,
        text: [
          `Hi,`,
          ``,
          `Your import has been delivered. Final paperwork lives on your dashboard.`,
          ``,
          `Route:    ${route}`,
          shipment.deliveredAt ? `Delivered: ${new Date(shipment.deliveredAt).toLocaleDateString('en-IE')}` : null,
          ``,
          `Track at:`,
          `  ${url}`,
          ``,
          `— OrcaTrade Operations`,
        ].filter(Boolean).join('\n'),
        html: buildShipmentHtml('Delivered', 'Your shipment has been delivered.', 'Final paperwork lives on your dashboard.', /** @type {any} */ (dl)),
      };
    },
    exception: () => {
      const dl = [
        { label: 'Route', value: route },
      ];
      const extra = exceptionReason
        ? `<div style="${HTML_WARN_BOX}"><strong>Reason:</strong> ${esc(exceptionReason)}</div>`
        : '';
      return {
        subject: `[Action needed] Issue with your shipment · ${label}`,
        text: [
          `Hi,`,
          ``,
          `An exception has been raised on your import. The OrcaTrade team has been notified and will reach out shortly.`,
          ``,
          exceptionReason ? `Reason: ${exceptionReason}` : null,
          `Route:  ${route}`,
          ``,
          `Track at:`,
          `  ${url}`,
          ``,
          `— OrcaTrade Operations`,
        ].filter(Boolean).join('\n'),
        html: buildShipmentHtml('Action needed', 'There is an issue with your shipment.', 'An exception has been raised on your import. The OrcaTrade team has been notified and will reach out shortly.', /** @type {any} */ (dl), extra),
      };
    },
    cancelled: () => {
      return {
        subject: `Your shipment has been cancelled · ${label}`,
        text: [
          `Hi,`,
          ``,
          `Your import has been cancelled. If this was unexpected please reply to this email and we will investigate.`,
          ``,
          `Track at:`,
          `  ${url}`,
          ``,
          `— OrcaTrade Operations`,
        ].filter(Boolean).join('\n'),
        html: buildShipmentHtml('Shipment cancelled', 'Your shipment has been cancelled.', 'If this was unexpected please reply to this email and we will investigate.', []),
      };
    },
  };

  const tmpl = templates[toStatus];
  if (!tmpl) return null;
  return tmpl();
}

// Closed taxonomy: destination statuses we WILL email the customer
// about. 'planned' is omitted (it's the materialiser-spawned initial
// state; the customer just received the customer_approved email).
const SHIPMENT_NOTIFIABLE_STATUSES = new Set([
  'booked', 'in_transit', 'cleared', 'delivered', 'exception', 'cancelled',
]);

/**
 * Send the customer a "your shipment is now <status>" email. The
 * customer is the requester of the SOURCE import_request that
 * spawned this shipment (sprint 3 ch 1 materialiser). Returns
 * { ok: false, reason } cleanly when no source request exists,
 * no contact is on file, the destination status is non-notifiable,
 * or Resend is unconfigured.
 *
 * @param {{ shipment: any, toStatus: string }} args
 */
async function sendShipmentStatusUpdateEmail({ shipment, toStatus }) {
  if (!shipment || !shipment.externalId) return { ok: false, reason: 'shipment required' };
  if (!SHIPMENT_NOTIFIABLE_STATUSES.has(String(toStatus))) {
    return { ok: false, reason: 'non-notifiable-status' };
  }
  const sourceRequestExternalId = shipment.metadata && shipment.metadata.materialisedFromImportRequest;
  if (!sourceRequestExternalId) {
    return { ok: false, reason: 'no-source-request' };
  }
  const to = await getCustomerContact(sourceRequestExternalId);
  if (!to) {
    log.info('sendShipmentStatusUpdateEmail skipped — no contact for source request', {
      shipmentExternalId: shipment.externalId,
      sourceRequestExternalId,
    });
    return { ok: false, reason: 'no-contact' };
  }
  const composed = composeShipmentStatusUpdate(shipment, toStatus, sourceRequestExternalId);
  if (!composed) {
    return { ok: false, reason: 'no-template-for-status' };
  }
  const result = await email.send({ to, subject: composed.subject, text: composed.text, html: composed.html });
  if (!result.ok) {
    log.warn('sendShipmentStatusUpdateEmail failed', {
      shipmentExternalId: shipment.externalId, reason: result.reason,
    });
  }
  return result;
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
  const { subject, text, html } = composeCustomerApproved(request, shipment || null);
  const results = await email.sendMany(resolution.recipients, /** @type {any} */ ({ subject, text, html }));
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
  composeShipmentStatusUpdate,
  customerShipmentReturnUrl,
  CONTACT_TTL_SECONDS,
  OPS_NOTIFICATION_ROLES,
  SHIPMENT_NOTIFIABLE_STATUSES,
  // Send entry points
  sendQuoteReadyEmail,
  sendNewInQueueEmail,
  sendCustomerApprovedEmail,
  sendShipmentStatusUpdateEmail,
};
