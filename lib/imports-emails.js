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
const notificationPrefs = require('./notification-prefs');

// Sprint 24 — per-recipient preference gate. Returns true if the
// notification key is muted for this recipient, false otherwise.
// FAIL-SOFT: any error in the prefs lookup (KV down, malformed
// stored record, missing key) returns false so the email still
// goes out. Better to send one extra email than to silently swallow
// a quote-ready notification because KV had a hiccup.
/**
 * @param {string} recipient
 * @param {string} prefKey
 * @returns {Promise<boolean>}
 */
async function isMuted(recipient, prefKey) {
  if (!recipient || !prefKey) return false;
  try {
    const enabled = await notificationPrefs.isEnabled(recipient, prefKey);
    return enabled === false;
  } catch (err) {
    log.warn('isMuted check failed; defaulting to send', {
      prefKey, err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// Sprint 24 — bulk fan-out filter. Used by ops-side senders that
// resolve N recipients via resolveOpsRecipients; we drop those who
// muted the category before calling sendMany. Same fail-soft posture
// — any per-recipient error keeps that recipient on the send list.
/**
 * @param {string[]} recipients
 * @param {string} prefKey
 * @returns {Promise<string[]>}
 */
async function filterMutedRecipients(recipients, prefKey) {
  if (!Array.isArray(recipients) || recipients.length === 0) return [];
  if (!prefKey) return recipients;
  const out = [];
  for (const r of recipients) {
    if (!(await isMuted(r, prefKey))) out.push(r);
  }
  return out;
}

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

// Sprint 26 — Ops Insights surface URL. The digest email links here
// so a click takes ops straight to the live cohort drill-down.
function opsInsightsUrl() {
  return `${siteOrigin()}/app/imports/insights`;
}

function opsQueueUrl() {
  return `${siteOrigin()}/app/imports/queue`;
}

/** @param {string} externalId */
function opsRequestUrl(externalId) {
  return `${siteOrigin()}/app/imports/${externalId}`;
}

// Sprint 16 — revise-request URL. /imports/new pre-fills the form from
// the prior request's intent fields when ?revise=<externalId> is set,
// and the submission carries revisedFromExternalId so we have lineage
// for the ops cohort analytics. The flow is parallel to ?duplicate
// (sprint 13) but with stronger semantics: revise = "I'm responding to
// a structured decline reason", duplicate = "I want another like that".
/** @param {string} externalId */
function customerReviseUrl(externalId) {
  return `${siteOrigin()}/app/imports/new?revise=${encodeURIComponent(externalId)}`;
}

// Human-readable headline + nudge for each DECLINE_REASONS enum value.
// Single source of truth for the customer email; the same labels render
// on the detail page lineage panel + the activity feed. Kept here so a
// future copy tweak lands in one place.
//
// The drift-guard test asserts every enum value has a label here.
const DECLINE_REASON_COPY = Object.freeze({
  price_target_unrealistic: {
    headline: 'Your landed target is below what the market currently supports.',
    nudge: 'You can revise upward, accept a smaller MOQ, or request a different origin where the unit economics work.',
  },
  compliance_blocker: {
    headline: 'A regulatory regime applies that the supplied evidence cannot clear.',
    nudge: 'Common fixes: switch HS classification with a Binding Tariff Information ruling, add EUDR DDS evidence, or substitute a compliant material.',
  },
  origin_restriction: {
    headline: 'The origin country carries an anti-dumping or sanctions restriction.',
    nudge: 'Revise with an alternative origin (Vietnam, India, Bangladesh, Türkiye are usually the substitutes) and we will re-quote.',
  },
  out_of_scope: {
    headline: 'This product category is outside what OrcaTrade currently services.',
    nudge: 'We will let you know when our supplier corpus covers it. You do not need to revise.',
  },
  documentation_missing: {
    headline: 'The certifications you requested cannot be evidenced from the shortlist.',
    nudge: 'Either narrow the certification requirements or expand the origin set; both unlock more supplier evidence.',
  },
  other: {
    headline: 'The team flagged this request for revision.',
    nudge: 'See the note below for the specific guidance.',
  },
});

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
 * Sprint 16 — customer rejection email with structured reason + revise CTA.
 * Fires when team-side review.decision='rejected'. The reason copy is
 * deterministic from DECLINE_REASON_COPY; the ops free-text note is
 * folded in below the reason headline. For revisable reasons, the
 * customer sees an aqua CTA to /imports/new?revise=<externalId>; for
 * out_of_scope, no CTA (the request is genuinely terminal).
 *
 * @param {{ externalId: string, label: string, productDescription: string, teamReviewState?: { declineReason?: string, notes?: string, revisable?: boolean } | null }} request
 * @returns {{ subject: string, text: string, html: string }}
 */
function composeCustomerRejected(request) {
  const trs = (request.teamReviewState && typeof request.teamReviewState === 'object') ? request.teamReviewState : {};
  const reason = typeof trs.declineReason === 'string' ? trs.declineReason : 'other';
  const copy = /** @type {{ headline: string, nudge: string } | undefined} */ (
    /** @type {any} */ (DECLINE_REASON_COPY)[reason]
  ) || DECLINE_REASON_COPY.other;
  const opsNote = typeof trs.notes === 'string' ? trs.notes.trim() : '';
  const revisable = trs.revisable === true;
  const reviseUrl = customerReviseUrl(request.externalId);
  const dashboardUrl = customerRequestUrl(request.externalId);

  const subject = revisable
    ? `Your import request needs a revision — ${request.label}`
    : `We can't take ${request.label} forward — but here's what's next`;

  // ── Text body ────────────────────────────────────────────────
  const textParts = [
    `Hi,`,
    ``,
    `Your OrcaTrade team has reviewed your import request and we need to flag something before we move forward.`,
    ``,
    `Request: ${request.label}  (${request.externalId})`,
    ``,
    `Why: ${copy.headline}`,
    ``,
    `What this means: ${copy.nudge}`,
  ];
  if (opsNote) {
    textParts.push('', `Team note: ${opsNote}`);
  }
  textParts.push('');
  if (revisable) {
    textParts.push(`Revise your request here:`);
    textParts.push(`  ${reviseUrl}`);
    textParts.push('');
    textParts.push(`Your intent will be pre-filled — just adjust the line that needs to change.`);
  } else {
    textParts.push(`See your request in your dashboard:`);
    textParts.push(`  ${dashboardUrl}`);
  }
  textParts.push('', `— OrcaTrade Operations`);
  const text = textParts.join('\n');

  // ── HTML body ────────────────────────────────────────────────
  const reasonRowHtml = htmlDl([
    { label: 'Request', value: `${request.label} · ${request.externalId}` },
    { label: 'Reason', value: copy.headline },
  ]);
  const noteHtml = opsNote
    ? `<div style="${HTML_WARN_BOX}"><strong>Team note</strong><br>${esc(opsNote)}</div>`
    : '';
  const ctaHtml = revisable
    ? htmlCta(reviseUrl, 'Revise this request')
    : `<p style="font-size:13px;color:${EMAIL_MUTE};margin:20px 0 0;">You can see this request in your dashboard: <a href="${esc(dashboardUrl)}" style="color:${EMAIL_BRAND_AQUA};text-decoration:none;font-weight:500;">${esc(dashboardUrl)}</a></p>`;
  const explainerHtml = revisable
    ? `<p style="font-size:12.5px;color:${EMAIL_MUTE};margin:14px 0 0;line-height:1.5;">Your intent will be pre-filled on the revision form — just adjust the line that needs to change.</p>`
    : '';

  const html = htmlEmailChrome({
    eyebrow: revisable ? 'Your request needs a revision' : "We can't take this forward",
    bodyHtml: [
      `<h1 style="${HTML_H1}">${esc(revisable ? "We'd like you to revise this request." : "We can't take this request forward.")}</h1>`,
      `<p style="${HTML_P}">${esc(copy.nudge)}</p>`,
      reasonRowHtml,
      noteHtml,
      ctaHtml,
      explainerHtml,
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
  // Sprint 24 — respect the customer's preferences. If they muted
  // 'importQuoteReadyEmails' they don't get this email. Fail-soft on
  // the prefs lookup so a KV blip doesn't silently drop the email.
  if (await isMuted(to, 'importQuoteReadyEmails')) {
    log.info('sendQuoteReadyEmail muted by recipient preference', { externalId: request.externalId });
    return { ok: false, reason: 'muted' };
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
/**
 * Sprint 16 — sends the structured-decline customer email. Fires when
 * team-side review.decision='rejected' (the orchestrator hookup in
 * lib/handlers/imports.js handleReview). Fail-soft like every other
 * customer touchpoint: a Resend outage does not block the data-layer
 * status transition.
 *
 * @param {{ request: any }} args
 */
async function sendCustomerRejectedEmail({ request }) {
  if (!request || !request.externalId) return { ok: false, reason: 'request required' };
  const to = await getCustomerContact(request.externalId);
  if (!to) {
    log.info('sendCustomerRejectedEmail skipped — no customer contact on file', { externalId: request.externalId });
    return { ok: false, reason: 'no-contact' };
  }
  if (await isMuted(to, 'importDeclineEmails')) {
    log.info('sendCustomerRejectedEmail muted by recipient preference', { externalId: request.externalId });
    return { ok: false, reason: 'muted' };
  }
  const { subject, text, html } = composeCustomerRejected(request);
  const result = await email.send({ to, subject, text, html });
  if (!result.ok) {
    log.warn('sendCustomerRejectedEmail failed', { externalId: request.externalId, reason: result.reason });
  }
  return result;
}

/**
 * Sprint 18 — composer for the cross-side message notification.
 * Heads-up email when the other party posts a message on a request.
 * Tight, no-frills shape: who posted, the body excerpt (capped at 800
 * chars to keep the email render compact), and a CTA to open the
 * thread in-app.
 *
 * Both sides use the same composer — we just swap the audience copy
 * based on the message role. Customer-posted → ops sees "Your customer
 * just posted on ir_xxx"; ops-posted → customer sees "Update from the
 * OrcaTrade team".
 *
 * The body excerpt is HTML-escaped (esc) and rendered inside a soft
 * quote block so it reads as a quoted message, not as part of the
 * email's own copy.
 *
 * @param {{ externalId: string, label: string }} request
 * @param {{ id: string, role: string, body: string }} message
 * @param {{ audience: 'ops' | 'customer' }} ctx
 * @returns {{ subject: string, text: string, html: string }}
 */
function composeImportRequestMessage(request, message, ctx) {
  const audience = ctx && ctx.audience === 'ops' ? 'ops' : 'customer';
  const url = audience === 'ops'
    ? opsRequestUrl(request.externalId)
    : customerRequestUrl(request.externalId);
  const excerpt = String(message.body || '').slice(0, 800);
  const isTruncated = String(message.body || '').length > 800;

  // Subject + lead copy.
  const subject = audience === 'ops'
    ? `[OPS] New message on ${request.label || request.externalId}`
    : `Update from the OrcaTrade team — ${request.label || request.externalId}`;
  const opening = audience === 'ops'
    ? `Your customer just posted a message on this request.`
    : `The OrcaTrade team has posted an update on your request.`;

  // ── Text body ────────────────────────────────────────────────
  const text = [
    `${opening}`,
    ``,
    `Request: ${request.label}  (${request.externalId})`,
    ``,
    `Message:`,
    excerpt.split('\n').map((line) => '  ' + line).join('\n'),
    isTruncated ? '  …' : '',
    ``,
    `Reply in-app:`,
    `  ${url}`,
    ``,
    `— OrcaTrade Operations`,
  ].filter(Boolean).join('\n');

  // ── HTML body ────────────────────────────────────────────────
  const quoteHtml =
    `<div style="margin:14px 0;padding:14px 16px;background:#f5fbfd;border-left:3px solid ${EMAIL_BRAND_AQUA};font-size:14px;color:${EMAIL_INK};line-height:1.55;white-space:pre-wrap;border-radius:8px;">` +
    esc(excerpt) +
    (isTruncated ? `<span style="color:${EMAIL_MUTE};font-style:italic;"> …</span>` : '') +
    `</div>`;
  const html = htmlEmailChrome({
    eyebrow: audience === 'ops' ? 'New customer message' : 'Update from your team',
    bodyHtml: [
      `<h1 style="${HTML_H1}">${esc(opening)}</h1>`,
      htmlDl([
        { label: 'Request', value: `${request.label} · ${request.externalId}` },
      ]),
      quoteHtml,
      htmlCta(url, 'Open the thread'),
    ].join(''),
  });
  return { subject, text, html };
}

/**
 * Sprint 18 — fan out the cross-side notification. When the customer
 * posts a message, ops admins get notified; when ops posts, the
 * customer gets notified. Fail-soft like every other customer
 * touchpoint — a Resend outage does not break the message append.
 *
 * @param {{ request: any, message: any, orgIdNumeric?: number | null }} args
 */
async function sendImportRequestMessageEmail({ request, message, orgIdNumeric }) {
  if (!request || !request.externalId) return { ok: false, reason: 'request required' };
  if (!message || !message.role) return { ok: false, reason: 'message required' };

  if (message.role === 'customer') {
    // Customer posted → notify the org's ops admins. Reuse the per-
    // org resolver from the new-in-queue path so multi-tenant orgs
    // route to the right inbox.
    const resolution = await resolveOpsRecipients(orgIdNumeric);
    if (resolution.recipients.length === 0) {
      log.info('sendImportRequestMessageEmail (→ops) skipped — no recipients', {
        externalId: request.externalId, fallbackReason: resolution.fallbackReason,
      });
      return { ok: false, reason: 'no-inbox' };
    }
    // Sprint 24 — per-recipient pref filter. Each ops admin can mute
    // 'importMessageEmails' independently. The filter is fail-soft;
    // a KV blip keeps everyone on the send list.
    const filtered = await filterMutedRecipients(resolution.recipients, 'importMessageEmails');
    if (filtered.length === 0) {
      log.info('sendImportRequestMessageEmail (→ops) muted by recipient preferences', {
        externalId: request.externalId, total: resolution.recipients.length,
      });
      return { ok: false, reason: 'all-muted' };
    }
    const composed = composeImportRequestMessage(request, message, { audience: 'ops' });
    const results = await email.sendMany(filtered, /** @type {any} */ (composed));
    const sent = results.filter((r) => r.result && r.result.ok).length;
    const failed = results.filter((r) => r.result && !r.result.ok).length;
    if (failed > 0) log.warn('sendImportRequestMessageEmail (→ops) partial failure', { sent, failed });
    return { ok: sent > 0, sent, failed };
  }

  if (message.role === 'ops') {
    // Ops posted → notify the customer who owns the request.
    const to = await getCustomerContact(request.externalId);
    if (!to) {
      log.info('sendImportRequestMessageEmail (→customer) skipped — no customer contact on file', {
        externalId: request.externalId,
      });
      return { ok: false, reason: 'no-contact' };
    }
    if (await isMuted(to, 'importMessageEmails')) {
      log.info('sendImportRequestMessageEmail (→customer) muted by recipient preference', {
        externalId: request.externalId,
      });
      return { ok: false, reason: 'muted' };
    }
    const composed = composeImportRequestMessage(request, message, { audience: 'customer' });
    const result = await email.send({ to, ...composed });
    if (!result.ok) {
      log.warn('sendImportRequestMessageEmail (→customer) failed', {
        externalId: request.externalId, reason: result.reason,
      });
    }
    return result;
  }

  // 'system' role is platform-emitted; no email fan-out. Silently no-op.
  return { ok: false, reason: 'system-role-no-email' };
}

// ── Sprint 26: weekly Ops Insights digest ──────────────────────────
//
// Pushes the sprint-17 cohort signal to the inbox each Monday so ops
// sees how the queue is performing without having to actively visit
// /imports/insights. Reuses the same aggregateOpsInsights data layer
// so the digest is calculator-grounded (ADR 0002) — no LLM in this
// path. The Monday cron handler computes the insights per-org and
// passes the result here.

/**
 * Format the headline copy for the digest body. Returns three lines
 * that summarise the funnel + cohort + recovery at a glance, before
 * the more detailed breakdown blocks.
 *
 * @param {any} insights
 * @param {number} windowDays
 */
function digestHeadline(insights, windowDays) {
  const total = Number(insights.totalInWindow || 0);
  const approved = Number((insights.funnelByStatus || {}).customer_approved || 0);
  const cohort = insights.revisionCohort || {};
  const recovery = cohort.revisionRate;
  if (total === 0) {
    return `No new import requests in the last ${windowDays} days.`;
  }
  const approvedPart = approved > 0
    ? ` · ${approved} reached customer-approved`
    : '';
  const recoveryPart = (typeof recovery === 'number')
    ? ` · ${recovery}% of recoverable declines came back as revisions`
    : '';
  return `${total} new request${total === 1 ? '' : 's'}${approvedPart}${recoveryPart}.`;
}

/**
 * Render the insights structure as { subject, text, html } for Resend.
 *
 * @param {{ orgName?: string, windowDays: number, insights: any }} args
 * @returns {{ subject: string, text: string, html: string }}
 */
function composeOpsInsightsDigest({ orgName, windowDays, insights }) {
  const wd = Number(windowDays) || 7;
  const headline = digestHeadline(insights, wd);
  const url = opsInsightsUrl();
  const queueUrl = opsQueueUrl();
  const cohort = (insights && insights.revisionCohort) || {};
  const funnel = (insights && insights.funnelByStatus) || {};
  const declines = (insights && insights.declineReasons) || {};
  const totalDeclined = Number(insights && insights.totalDeclined || 0);

  // Pick the top-2 decline reasons by count for the email block. A
  // full taxonomy would clutter the digest — the deep view lives at
  // /imports/insights via the CTA below.
  /** @type {Array<[string, number]>} */
  const topDeclines = Object.entries(declines)
    .map(([k, v]) => /** @type {[string, number]} */ ([k, Number(v || 0)]))
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);

  const subject = orgName
    ? `[${orgName}] Ops insights · ${wd}-day digest`
    : `Ops insights · ${wd}-day digest`;

  // ── Text body ────────────────────────────────────────────────
  const textLines = [
    `Last ${wd} days at OrcaTrade Ops`,
    ``,
    headline,
    ``,
    `Funnel`,
    `  Inbound:           ${Number(funnel.submitted || 0) + Number(funnel.processing || 0)}`,
    `  Team review:       ${Number(funnel.awaiting_review || 0)}`,
    `  Quoted:            ${Number(funnel.quoted || 0)}`,
    `  Customer-approved: ${Number(funnel.customer_approved || 0)}`,
    `  Closed (other):    ${[
      'customer_rejected', 'expired', 'cancelled', 'failed',
    ].reduce((acc, k) => acc + Number(funnel[k] || 0), 0)}`,
    ``,
    `Revision recovery`,
    `  Recoverable declines:  ${Number(cohort.recoverableDeclined || 0)}`,
    `  Revisions submitted:   ${Number(cohort.revisions || 0)}${typeof cohort.revisionRate === 'number' ? `  (${cohort.revisionRate}%)` : ''}`,
    `  Made it past intake:   ${Number(cohort.revisionsProgressed || 0)}${typeof cohort.progressionRate === 'number' ? `  (${cohort.progressionRate}%)` : ''}`,
  ];
  if (totalDeclined > 0) {
    textLines.push('', `Top decline reasons (${totalDeclined} total)`);
    for (const [reason, n] of topDeclines) {
      textLines.push(`  ${reason}: ${n}`);
    }
  }
  textLines.push(
    '',
    `Open the live cockpit:`,
    `  ${url}`,
    ``,
    `Or jump into the queue:`,
    `  ${queueUrl}`,
    ``,
    `— OrcaTrade Operations`,
  );
  const text = textLines.join('\n');

  // ── HTML body ────────────────────────────────────────────────
  const funnelHtml = htmlDl([
    { label: 'Inbound', value: String(Number(funnel.submitted || 0) + Number(funnel.processing || 0)) },
    { label: 'Team review', value: String(Number(funnel.awaiting_review || 0)) },
    { label: 'Quoted', value: String(Number(funnel.quoted || 0)) },
    { label: 'Customer-approved', value: String(Number(funnel.customer_approved || 0)) },
    {
      label: 'Closed (other)',
      value: String(
        ['customer_rejected', 'expired', 'cancelled', 'failed']
          .reduce((acc, k) => acc + Number(funnel[k] || 0), 0),
      ),
    },
  ]);
  const cohortHtml = htmlDl([
    { label: 'Recoverable declines', value: String(Number(cohort.recoverableDeclined || 0)) },
    {
      label: 'Revisions submitted',
      value: `${Number(cohort.revisions || 0)}${typeof cohort.revisionRate === 'number' ? ` (${cohort.revisionRate}%)` : ''}`,
    },
    {
      label: 'Made it past intake',
      value: `${Number(cohort.revisionsProgressed || 0)}${typeof cohort.progressionRate === 'number' ? ` (${cohort.progressionRate}%)` : ''}`,
    },
  ]);
  const declineHtml = totalDeclined > 0
    ? htmlDl(topDeclines.map(([reason, n]) => ({
        label: esc(reason),
        value: String(n),
      })))
    : '';
  const html = htmlEmailChrome({
    eyebrow: `Ops · ${wd}-day digest`,
    bodyHtml: [
      `<h1 style="${HTML_H1}">Last ${wd} days at OrcaTrade Ops.</h1>`,
      `<p style="${HTML_P}">${esc(headline)}</p>`,
      `<h2 style="font-size:14px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${EMAIL_MUTE};margin:18px 0 4px;">Funnel</h2>`,
      funnelHtml,
      `<h2 style="font-size:14px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${EMAIL_MUTE};margin:22px 0 4px;">Revision recovery</h2>`,
      cohortHtml,
      totalDeclined > 0
        ? `<h2 style="font-size:14px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${EMAIL_MUTE};margin:22px 0 4px;">Top decline reasons (${totalDeclined} total)</h2>` + declineHtml
        : '',
      htmlCta(url, 'Open the live cockpit'),
      `<p style="font-size:12.5px;color:${EMAIL_MUTE};margin:16px 0 0;">Or jump into the queue: <a href="${esc(queueUrl)}" style="color:${EMAIL_BRAND_AQUA};text-decoration:none;font-weight:500;">${esc(queueUrl)}</a></p>`,
    ].join(''),
  });
  return { subject, text, html };
}

/**
 * Sprint 26 — send the weekly digest to the org's ops admins.
 * Per-recipient pref-gated via importInsightsDigestEmails: an admin
 * who opts out doesn't get the email, but the digest still goes to
 * the rest of the team. If EVERY admin opted out, the function
 * silently no-ops (returns reason='all-muted'). Fail-soft posture
 * matches the other senders.
 *
 * @param {{ orgIdNumeric: number, orgName?: string, windowDays?: number, insights: any }} args
 */
async function sendOpsInsightsDigest({ orgIdNumeric, orgName, windowDays = 7, insights }) {
  if (!Number.isFinite(orgIdNumeric)) return { ok: false, reason: 'orgIdNumeric required' };
  if (!insights) return { ok: false, reason: 'insights required' };
  const resolution = await resolveOpsRecipients(orgIdNumeric);
  if (resolution.recipients.length === 0) {
    log.info('sendOpsInsightsDigest skipped — no recipients', {
      orgIdNumeric, fallbackReason: resolution.fallbackReason,
    });
    return { ok: false, reason: 'no-inbox' };
  }
  const filtered = await filterMutedRecipients(resolution.recipients, 'importInsightsDigestEmails');
  if (filtered.length === 0) {
    log.info('sendOpsInsightsDigest muted by all recipient preferences', {
      orgIdNumeric, total: resolution.recipients.length,
    });
    return { ok: false, reason: 'all-muted' };
  }
  const composed = composeOpsInsightsDigest({ orgName, windowDays, insights });
  const results = await email.sendMany(filtered, /** @type {any} */ (composed));
  const sent = results.filter((r) => r.result && r.result.ok).length;
  const failed = results.filter((r) => r.result && !r.result.ok).length;
  if (failed > 0) log.warn('sendOpsInsightsDigest partial failure', { orgIdNumeric, sent, failed });
  return { ok: sent > 0, sent, failed };
}

// ── Sprint 33: immediate low-rating alert ──────────────────────────
//
// Transactional complement to sprint 26's weekly digest: a customer
// rating ≤ 2 deserves outreach within hours, not by Monday. The
// recordCustomerRating data-layer path (sprint 30) fires this async
// after a successful insert so a Resend hiccup never blocks the
// rating write. Per-recipient pref-gated via
// importLowRatingAlertEmails so a vacation-muting admin doesn't
// get woken up; the cohort still surfaces on /imports/insights.

/**
 * Render the low-rating alert as { subject, text, html }. The
 * subject + body are intentionally direct — this is a
 * follow-up-now alert, not a digest, and ops needs the score +
 * the request id + the comment context immediately.
 *
 * @param {{
 *   request: { externalId: string, label: string, productDescription?: string },
 *   rating: { score: number, comment?: string, ratedAt: string },
 *   isSupersession?: boolean
 * }} args
 * @returns {{ subject: string, text: string, html: string }}
 */
function composeLowRatingAlert({ request, rating, isSupersession }) {
  const url = opsRequestUrl(request.externalId);
  const stars = '★'.repeat(rating.score) + '☆'.repeat(Math.max(0, 5 - rating.score));
  // Subject: load-bearing for ops triage. Include the star glyph +
  // the score + the request label so the inbox preview tells the
  // whole story.
  const subject = isSupersession
    ? `[OPS] Rating REVISED DOWN to ${stars} (${rating.score}★) — ${request.label || request.externalId}`
    : `[OPS] ${stars} (${rating.score}★) rating on ${request.label || request.externalId} — follow up`;

  const comment = (rating.comment || '').trim();
  const opening = isSupersession
    ? `A customer revised their rating DOWN to ${rating.score} stars. The earlier rating is in the audit log.`
    : `A customer just rated their experience ${rating.score} stars. Reach out within 24 hours — a 1-2★ rating left unanswered is the strongest churn signal we have.`;

  // ── Text body ───────────────────────────────────────────────
  const textParts = [
    opening,
    ``,
    `Rating: ${stars}  (${rating.score}/5)`,
    `Request:  ${request.label || '-'}  (${request.externalId})`,
    request.productDescription ? `Product:  ${request.productDescription}` : null,
  ].filter(Boolean);
  if (comment) {
    textParts.push('', `Comment:`);
    textParts.push(comment.split('\n').map((line) => '  ' + line).join('\n'));
  }
  textParts.push('', `Open the request:`, `  ${url}`, '', `— OrcaTrade Operations`);
  const text = textParts.join('\n');

  // ── HTML body ───────────────────────────────────────────────
  const commentHtml = comment
    ? `<div style="${HTML_WARN_BOX}"><strong>Customer comment</strong><br>${esc(comment)}</div>`
    : `<p style="font-size:12.5px;color:${EMAIL_MUTE};margin:0 0 14px;">The customer did not leave a comment. Reach out anyway — the score is enough signal.</p>`;
  const eyebrow = isSupersession ? 'Rating revised DOWN' : 'Low rating — follow up';
  const headline = isSupersession
    ? `Rating revised down to ${rating.score} stars.`
    : `${rating.score}-star rating — outreach matters here.`;

  const html = htmlEmailChrome({
    eyebrow,
    bodyHtml: [
      `<h1 style="${HTML_H1}">${esc(headline)}</h1>`,
      `<p style="${HTML_P}">${esc(opening)}</p>`,
      `<div style="${HTML_BIG_NUMBER};color:${EMAIL_BRAND_AQUA};">${esc(stars)}</div>`,
      `<div style="font-size:12px;color:${EMAIL_MUTE};margin-bottom:12px;">${rating.score} of 5</div>`,
      htmlDl([
        { label: 'Request', value: `${request.label || '-'} · ${request.externalId}` },
        request.productDescription
          ? { label: 'Product', value: request.productDescription }
          : null,
      ].filter(/** @returns {x is { label: string, value: string }} */ (x) => x !== null)),
      commentHtml,
      htmlCta(url, 'Open the request'),
    ].join(''),
  });
  return { subject, text, html };
}

/**
 * Fire the low-rating alert to ops admins. Pref-gated via
 * importLowRatingAlertEmails (per-recipient — one admin muting
 * doesn't drop the email for the others). Fail-soft posture
 * matches every other sender. Returns reason 'not-low-rating'
 * when score > 2 so the caller can wrap it unconditionally.
 *
 * @param {{
 *   request: any,
 *   rating: { score: number, comment?: string, ratedAt: string },
 *   isSupersession?: boolean,
 *   orgIdNumeric?: number | null,
 * }} args
 */
async function sendLowRatingAlert({ request, rating, isSupersession, orgIdNumeric }) {
  if (!request || !request.externalId) return { ok: false, reason: 'request required' };
  if (!rating || !Number.isInteger(rating.score)) return { ok: false, reason: 'rating required' };
  if (rating.score > 2) return { ok: false, reason: 'not-low-rating' };

  const resolution = await resolveOpsRecipients(orgIdNumeric);
  if (resolution.recipients.length === 0) {
    log.info('sendLowRatingAlert skipped — no recipients', {
      externalId: request.externalId, fallbackReason: resolution.fallbackReason,
    });
    return { ok: false, reason: 'no-inbox' };
  }
  // Sprint 33 — per-recipient mute via importLowRatingAlertEmails.
  // Fail-soft: KV blip on the prefs lookup defaults to send.
  const filtered = await filterMutedRecipients(resolution.recipients, 'importLowRatingAlertEmails');
  if (filtered.length === 0) {
    log.info('sendLowRatingAlert muted by all recipient preferences', {
      externalId: request.externalId, total: resolution.recipients.length,
    });
    return { ok: false, reason: 'all-muted' };
  }
  const composed = composeLowRatingAlert({ request, rating, isSupersession });
  const results = await email.sendMany(filtered, /** @type {any} */ (composed));
  const sent = results.filter((r) => r.result && r.result.ok).length;
  const failed = results.filter((r) => r.result && !r.result.ok).length;
  if (failed > 0) log.warn('sendLowRatingAlert partial failure', {
    externalId: request.externalId, sent, failed,
  });
  return { ok: sent > 0, sent, failed };
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
  // Sprint 24 — per-ops-admin mute via 'importQueueIntakeEmails'.
  const filtered = await filterMutedRecipients(resolution.recipients, 'importQueueIntakeEmails');
  if (filtered.length === 0) {
    log.info('sendNewInQueueEmail muted by recipient preferences', {
      externalId: request.externalId, total: resolution.recipients.length,
    });
    return { ok: false, reason: 'all-muted' };
  }
  const { subject, text, html } = composeNewInQueue(request);
  const results = await email.sendMany(filtered, /** @type {any} */ ({ subject, text, html }));
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
  // Sprint 24 — customer can mute shipment-status email category.
  if (await isMuted(to, 'importShipmentStatusEmails')) {
    log.info('sendShipmentStatusUpdateEmail muted by recipient preference', {
      shipmentExternalId: shipment.externalId, sourceRequestExternalId,
    });
    return { ok: false, reason: 'muted' };
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
  // Sprint 24 — per-ops-admin mute via 'importCustomerDecisionEmails'.
  const filtered = await filterMutedRecipients(resolution.recipients, 'importCustomerDecisionEmails');
  if (filtered.length === 0) {
    log.info('sendCustomerApprovedEmail muted by recipient preferences', {
      externalId: request.externalId, total: resolution.recipients.length,
    });
    return { ok: false, reason: 'all-muted' };
  }
  const { subject, text, html } = composeCustomerApproved(request, shipment || null);
  const results = await email.sendMany(filtered, /** @type {any} */ ({ subject, text, html }));
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
  composeCustomerRejected,
  composeImportRequestMessage,
  composeOpsInsightsDigest,
  composeLowRatingAlert,
  composeShipmentStatusUpdate,
  customerReviseUrl,
  opsInsightsUrl,
  DECLINE_REASON_COPY,
  customerShipmentReturnUrl,
  CONTACT_TTL_SECONDS,
  OPS_NOTIFICATION_ROLES,
  SHIPMENT_NOTIFIABLE_STATUSES,
  // Send entry points
  sendQuoteReadyEmail,
  sendNewInQueueEmail,
  sendCustomerApprovedEmail,
  sendCustomerRejectedEmail,
  sendImportRequestMessageEmail,
  sendOpsInsightsDigest,
  sendLowRatingAlert,
  sendShipmentStatusUpdateEmail,
};
