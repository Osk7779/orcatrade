// Event log (Sprint 36).
//
// A small, KV-backed append-only log of structured product events. Used by
// the conversion analytics dashboard at /dashboard/leads/ to surface which
// categories/origins/destinations actually convert through the wizard.
//
// Why a single capped array (not a list / stream):
//   - We don't have native list ops in our KV abstraction
//   - 5,000 events ≈ months of headroom at current volumes
//   - Aggregation over 5k items in JS is microseconds — no need for a TSDB
//   - Old events fall off the tail naturally; no cron required
//
// Race condition note: read-modify-write is not atomic. At our throughput
// (single-digit submissions per day) the loss probability is negligible;
// upgrade to Redis LPUSH + LTRIM if/when volume warrants.

'use strict';

const crypto = require('node:crypto');
const kv = require('./intelligence/kv-store');
const hash = require('./hash');
const auditChain = require('./audit-chain');

const EVENT_LOG_KEY = 'events:log';
const MAX_EVENTS = 5000;
const EVENT_TTL_DAYS = 365;

// ── Write-time tamper-evident chain (Sprint audit-chain-v2 / Pillar III2) ──
//
// Each event is stamped at WRITE time with a hash linking to the previous
// event's hash, so an in-place edit of a stored row (by a privileged actor,
// or a corrupted backup restore) is detectable without re-deriving the whole
// chain at export. This complements the export-time chain in audit-chain.js
// (which proves an exported artifact wasn't altered after generation).
//
// The hash covers a NON-PII projection only — the fields the GDPR delete path
// pseudonymises (email/name/company/role/message) are excluded, so a lawful
// erasure does NOT register as tampering, while edits to the substantive fields
// (type, timestamp, amounts, ids) still break the chain.
const CHAIN_HEAD_KEY = 'events:chainHead';
const CHAIN_SEQ_KEY = 'events:chainSeq';
const CHAIN_GENESIS = 'orcatrade-events-genesis-v1';
const CHAIN_EXCLUDE = new Set(['email', 'name', 'company', 'role', 'message', 'pseudonymised', 'pseudonymisedAt', '_hash', '_prevHash', '_seq']);

function chainProjection(event) {
  const e = {};
  for (const k of Object.keys(event || {})) {
    if (CHAIN_EXCLUDE.has(k)) continue;
    e[k] = event[k];
  }
  return auditChain.stableStringify(e);
}

function chainHashOf(prevHash, event) {
  return crypto.createHash('sha256').update(prevHash + '\n' + chainProjection(event)).digest('hex');
}

// Verify the STORED write-time chain over an events array (events:log is
// newest-first; we verify in ascending _seq order). Only rows that carry chain
// fields are checked, so legacy/un-stamped events don't fail it. Returns
// { ok, length, verified, head, brokenAt?, reason? }.
function verifyStoredChain(events) {
  const list = (Array.isArray(events) ? events : []).filter(e => e && e._hash && typeof e._seq === 'number');
  const ordered = list.slice().sort((a, b) => a._seq - b._seq);
  if (!ordered.length) return { ok: true, length: 0, verified: 0, head: null, note: 'no write-time-chained events present' };
  for (let i = 0; i < ordered.length; i += 1) {
    const row = ordered[i];
    if (chainHashOf(row._prevHash, row) !== row._hash) {
      return { ok: false, length: ordered.length, verified: i, brokenAt: row._seq, reason: 'hash mismatch (substantive content altered after write)' };
    }
    if (i > 0 && row._prevHash !== ordered[i - 1]._hash) {
      return { ok: false, length: ordered.length, verified: i, brokenAt: row._seq, reason: 'prevHash mismatch (row removed or reordered)' };
    }
  }
  return { ok: true, length: ordered.length, verified: ordered.length, head: ordered[ordered.length - 1]._hash };
}

const ALLOWED_TYPES = new Set([
  'import_plan_generated',
  // Sprint portfolio-v1 — multi-SKU portfolio plan generated. Carries
  // line shapes only (lineCount, totalLandedEur, blendedDutyRatePct,
  // consolidationSavingEur, lanes) — no PII.
  'portfolio_generated',
  'portfolio_saved',
  'portfolio_share_created',
  'portfolio_share_opened',
  'plan_saved',
  'plan_share_opened',
  'auth_signin',
  'auth_signup',
  // Sprint wizard-step-funnel-v1 — per-step funnel measurement.
  // Carries { step (1-6), action ("next"|"back"|"submit"), locale }.
  // No email/PII — the wizard fires this fire-and-forget for both
  // anonymous and signed-in users so a single event type covers the
  // entire funnel regardless of auth state.
  'wizard_step_completed',
  // Sprint J — Founding 10 pilot applications.
  'founding_applied',
  // Sprint BG-6.5 — per-Anthropic-call cost telemetry. Carries
  // { agent, promptVersion, model, costCents, latencyMs, inputTokens,
  //   outputTokens, cacheReadTokens, stopReason, requestId } — no PII.
  // Used by /dashboard/ai/ to render weekly spend + per-agent breakdown.
  'ai_call',
  // Sprint BG-5.5 — audit log for security-sensitive operations.
  // Every entry below answers a "who did what, when?" question that an
  // auditor (FSA, investor due-diligence, partner DPA review) or a user
  // disputing a session ("I never logged in from there") will ask.
  // Email field, when present, is hashed by buildPgInsertParams before
  // landing in Postgres — KV keeps the raw email for /dashboard/audit.
  'auth_logout',
  'auth_revoke_all',
  // Sprint BG-3.2 phase 2 — per-session revoke from /account/security/.
  // Distinct from auth_revoke_all so an auditor can grep "which devices
  // did this user revoke individually" vs. the all-devices flow.
  'auth_session_revoked',
  'org_created',
  'org_member_invited',
  'org_member_removed',
  'org_ownership_transferred',
  'account_exported',
  'account_deleted',
  // Sprint BG-1.4 — Track 1 reality-check loop. actual_reported is the
  // signal every customer sends back to the platform: "your estimate
  // was off by X%". actual_cleared lets them undo a mistaken entry.
  // The audit dashboard surfaces these so we can spot calibration
  // drift before customers see it as a quote problem.
  'actual_reported',
  'actual_cleared',
  // Sprint BG-3.3 phase 1 — admin manually assigns/clears a tier
  // override for an org. Carries { orgId, tierId, source } — never
  // raw email. The audit row is how we trace "who approved this
  // Team-plan upgrade" without storing it in Stripe metadata yet.
  'org_tier_assigned',
  'org_tier_cleared',
  // Sprint sso-oidc-v1 phase 3 — an org owner sets/removes their OIDC SSO
  // config. Carries { email (actor), orgId } — never the client secret.
  'org_sso_configured',
  'org_sso_removed',
  // shares-v1 — counterpart to the pre-existing plan_share_opened.
  // Emitted when an owner revokes a share so the audit log shows the
  // full lifecycle (open → revoke). plan_share_opened is public-
  // traffic by definition; plan_share_revoked is an owner action.
  'plan_share_revoked',
  // prefs-v1 — user notification preference changes. notification_prefs_updated
  // carries { email, changes:{key→bool} }; plan_revision_emails_unsubscribed
  // is the specific one-click-unsubscribe path so we can grep audit
  // rows quickly without parsing the changes object.
  'notification_prefs_updated',
  'plan_revision_emails_unsubscribed',
  // Sprint password-auth-v1 — password lifecycle. _set fires on first
  // password creation; _changed when an existing password is rotated;
  // _cleared when the user removes their password and reverts to
  // magic-link-only. auth_signin_password is distinct from auth_signin
  // (which now means magic-link only) so we can split the funnel
  // between the two methods. auth_signin_failed_password is the
  // brute-force tripwire — an auditor can grep failures-per-email to
  // catch credential-stuffing without leaving production logs.
  'auth_password_set',
  'auth_password_changed',
  'auth_password_cleared',
  'auth_signin_password',
  'auth_signin_failed_password',
  'auth_password_reset_requested',
  'auth_password_reset_confirmed',
  'auth_signup_requested',
  'auth_signup_confirmed',
  // Sprint mfa-totp-v1 — TOTP two-factor lifecycle. _enabled/_disabled
  // bracket the feature; _challenge_failed is the brute-force tripwire
  // (an auditor greps failures-per-email to spot a code-guessing attack
  // against a known account). Successful MFA completion folds into the
  // existing auth_signin / auth_signin_password rows (carry mfa:true)
  // rather than a separate type, so the sign-in funnel stays one stream.
  'auth_mfa_enabled',
  'auth_mfa_disabled',
  'auth_mfa_challenge_failed',
  // Sprint quote-rebrand-v1 — the internal Quote Studio generated a branded
  // OrcaTrade quotation from a supplier PDF. Carries shape only (currency,
  // marginPct, lineCount, totalCents, supplierSubtotalCents, marginAmountCents,
  // quoteNumber, actorMode) plus the actor email (hashed into Postgres). The
  // audit trail is how we answer "what margin did we quote on PO-xyz".
  'quote_rebrand_generated',
  // Sprint document-approval-v1 (apex Pillar I5) — every drafted artifact
  // captures the human approve/reject click so an auditor can trace who
  // signed off on the CBAM filing / customs entry / LC application before it
  // left the platform (the platform itself never sends or files anything).
  'document_drafted',
  'document_approved',
  'document_rejected',
  // L1.1-L1.3 of docs/strategic-plan-2026-2031.md §4.1.2 — system-of-record
  // mutations. ADR 0005 commits every mutation to the audit log before the
  // success response; without these allowlist entries, events.record() would
  // silently drop the calls from lib/db/{goods,suppliers,shipments}.js and
  // the promise would be broken in production.
  'goods_master_created',
  'goods_master_updated',
  'goods_master_archived',
  'supplier_master_created',
  'supplier_master_updated',
  // Sanctions re-screening result. Separate from *_updated because
  // the audit reader needs to distinguish operator-initiated edits
  // from automated screening runs (different actors, different
  // diff shapes — re-screen mutates only the three sanctions fields).
  'supplier_master_rescreened',
  'supplier_master_archived',
  'shipment_master_created',
  'shipment_master_updated',
  // The dedicated event for state-machine transitions carries the
  // before.status + after.status pair — separate from the generic
  // *_updated so the audit reader can render a per-transition timeline.
  'shipment_master_status_transition',
  // Exception acknowledgement (L1.5) — metadata-only mutation that
  // doesn't change the shipment's status.
  'shipment_master_exception_acknowledged',
  'shipment_master_archived',
  // Sprint 14 (operator wedge) — import-request lifecycle events. These
  // were being recorded by lib/db/import-requests.js since sprint 1 but
  // were missing from this allowlist, so `events.record()` silently
  // returned false and ADR 0005's "audit log before success" promise
  // was being broken for the entire operator wedge. The customer-facing
  // TransitionHistory queried listForEntity({ entityType: 'import_request' })
  // and got [] every time. Fixed in sprint 14 + paired with an auto-
  // discovering drift-guard at test/events-allowlist-coverage.test.js
  // that greps every events.record('<type>'...) call across lib/ and
  // asserts the type is present here.
  'import_request_created',
  'import_request_updated',
  'import_request_status_transition',
  'import_request_archived',
  // Sprint 18 — per-request customer ↔ ops messaging thread. One event
  // per appended message; detail carries { messageId, role, length }
  // but never the body itself (already in the row's messages jsonb).
  'import_request_message_posted',
  // Sprint 27 — compliance evidence attached to a request. Detail
  // carries { evidenceId, regime, urlHost, hasNotes } — the URL is
  // hashed down to the host so the audit reader doesn't leak the
  // full signed link.
  'import_request_evidence_attached',
  // Sprint 28 — supplier-country pick recorded at materialisation
  // time. Detail carries { country, hsPrefix6, rationaleCategory } —
  // the free-text rationale is on the row, not in the audit chain.
  'import_request_supplier_picked',
  // Sprint 14 cleanup — every other event type that was being recorded
  // but missed the allowlist, surfaced by the new drift-guard. Same
  // ADR 0005 violation pattern; same silent-drop failure mode.
  // human-review queue lifecycle (ADR 0015).
  'human_review_requested',
  'human_review_claimed',
  'human_review_resolved',
  // Duplicate-account sign-up attempt (the brute-force-on-existing-
  // account tripwire — paired with auth_signin_failed_password).
  'auth_signup_blocked_duplicate',
  // Org member's role mutated within an org.
  'org_member_role_changed',
  // SCIM token lifecycle (per-org enterprise provisioning).
  'org_scim_token_minted',
  'org_scim_token_revoked',
  // SCIM provisioning operations (per-user actions from an external IdP).
  'scim_user_provisioned',
  'scim_user_deprovisioned',
  'scim_group_role_applied',
]);

function nowIso() { return new Date().toISOString(); }

async function record(type, payload = {}) {
  if (!type || typeof type !== 'string') return false;
  if (!ALLOWED_TYPES.has(type)) return false;
  const event = {
    type,
    at: nowIso(),
    ...payload,
  };

  // Write-time chain stamping (Pillar III2). Best-effort: a stamping failure
  // never blocks the event write — the chain simply has a gap for that row.
  let newHead = null;
  try {
    const prevHash = (await kv.get(CHAIN_HEAD_KEY)) || CHAIN_GENESIS;
    let seq = null;
    try { seq = await kv.incr(CHAIN_SEQ_KEY, { ttlSeconds: EVENT_TTL_DAYS * 24 * 60 * 60 }); } catch (_) { seq = null; }
    if (typeof seq === 'number') {
      event._seq = seq;
      event._prevHash = prevHash;
      event._hash = chainHashOf(prevHash, event);
      newHead = event._hash;
    }
  } catch (_) { /* leave the event unstamped; verifyStoredChain tolerates gaps */ }

  // ── Primary: KV ──────────────────────────────────────
  // The dashboards still read from KV today; PG is the long-term home
  // (Sprint BG-2.2). If the KV write fails, the function returns false
  // and the caller knows to retry — same as before.
  try {
    const existing = (await kv.get(EVENT_LOG_KEY)) || [];
    const arr = Array.isArray(existing) ? existing : [];
    const updated = [event, ...arr].slice(0, MAX_EVENTS);
    await kv.set(EVENT_LOG_KEY, updated, { ttlSeconds: EVENT_TTL_DAYS * 24 * 60 * 60 });
    // Advance the chain head only after the event is durably in the log.
    if (newHead) { try { await kv.set(CHAIN_HEAD_KEY, newHead, { ttlSeconds: EVENT_TTL_DAYS * 24 * 60 * 60 }); } catch (_) {} }
  } catch (_err) {
    // KV failure = primary failure. Don't fire PG either; report false.
    return false;
  }

  // ── Secondary: Postgres (Sprint BG-2.2) ──────────────
  // Fire-and-forget. Once dashboards migrate to read from PG (follow-up
  // sprint), this row is what powers them past the 5000-event KV cap.
  // KV-only mode (DATABASE_URL unset) is a no-op — recordPg returns
  // { written: false, reason: 'not-configured' } without throwing.
  recordPg(type, payload).catch(() => { /* never propagate to caller */ });

  return true;
}

// Pure function: takes (type, payload) and returns the parameter tuple
// for the INSERT INTO events statement. Email is hashed via lib/hash.js
// and stripped from the jsonb payload so raw emails never land in
// Postgres. Pseudonymised "deleted-…@anonymised.local" emails pass
// through unchanged (they're the post-Article-17 identity, not PII).
// Exported for test surface — the SQL execution itself is in recordPg.
function buildPgInsertParams(type, payload) {
  const safePayload = (payload && typeof payload === 'object') ? { ...payload } : {};
  let emailHash = null;
  if (safePayload.email) {
    if (hash.isAlreadyPseudonym(safePayload.email)) {
      // Don't re-hash a pseudonym — keep it as the identity column verbatim.
      emailHash = String(safePayload.email);
    } else {
      emailHash = hash.emailHash(safePayload.email);
    }
    delete safePayload.email;  // raw email NEVER goes into pg.events.payload
  }
  return {
    type,
    emailHash,
    payloadJson: JSON.stringify(safePayload),
  };
}

async function recordPg(type, payload) {
  // Lazy-required so the events module loads cleanly in test envs that
  // don't have @neondatabase/serverless installed.
  let db;
  try { db = require('./db/client'); }
  catch (_) { return { written: false, reason: 'db-module-unavailable' }; }
  if (!db.isConfigured()) return { written: false, reason: 'not-configured' };

  const { type: t, emailHash, payloadJson } = buildPgInsertParams(type, payload);
  try {
    await db.query(
      'INSERT INTO events (type, email_hash, payload) VALUES ($1, $2, $3::jsonb)',
      [t, emailHash, payloadJson],
    );
    return { written: true };
  } catch (err) {
    return { written: false, err: err.message };
  }
}

async function list({ type = null, limit = 500, since = null } = {}) {
  const existing = (await kv.get(EVENT_LOG_KEY)) || [];
  let arr = Array.isArray(existing) ? existing : [];
  if (type) arr = arr.filter(e => e.type === type);
  if (since) {
    const cutoff = Date.parse(since);
    if (Number.isFinite(cutoff)) arr = arr.filter(e => Date.parse(e.at) >= cutoff);
  }
  const sliced = arr.slice(0, Math.max(1, Math.min(MAX_EVENTS, Number(limit) || 500)));

  // Apex A2 step 4 + III2 audit-integrity signal — read-shadow the
  // events stream against the PG mirror. The events table is the
  // highest-stakes shadow surface: a divergence here is not just a
  // cutover-readiness signal but a potential security incident
  // (someone wrote to PG without going through events.record, or
  // someone tampered with KV without writing to PG). Lazy-required
  // to keep the events module's load cost cheap. No-op unless
  // ORCATRADE_SHADOW_PG is set.
  try {
    const readShadow = require('./db/read-shadow');
    readShadow.shadowCompare({
      name: 'events.list',
      kvValue: sliced,
      pgFetcher: () => listFromPg({ type, limit, since }),
      projector: projectEventsForShadow,
    }).catch(() => { /* shadow must never affect hot path */ });
  } catch (_) { /* read-shadow module unavailable in some test envs */ }

  return sliced;
}

// Multi-row event projector. Strips the shape-divergence between
// KV-shape (raw email, chain stamps _seq/_prevHash/_hash, exact JS
// Date.toISOString timestamps) and PG-shape (email_hash, no chain
// stamps, PG's own created_at column with potentially different
// sub-millisecond precision). The shadow check answers "do the
// durable-truth event payloads agree?" not "are the records byte-
// identical?" — chain integrity is a separate III2 verification
// surface (audit-anchor + verifyStoredChain).
function projectEventForShadow(event) {
  if (!event || typeof event !== 'object') return event;
  const projected = {};
  for (const k of Object.keys(event)) {
    // Skip KV-only fields: raw email (PG has email_hash instead),
    // chain stamps (PG doesn't preserve them), and `at` (PG's
    // created_at column has different precision; key the comparison
    // on (type, payload-minus-email) instead).
    if (k === 'email' || k === '_seq' || k === '_prevHash' || k === '_hash' || k === 'at') continue;
    projected[k] = event[k];
  }
  // Derive the unified emailHash for the comparison: KV-shape has
  // raw email (hash it); PG-shape has emailHash (passes through).
  if (event.email && typeof event.email === 'string') {
    const hashLib = require('./hash');
    projected.emailHash = hashLib.isAlreadyPseudonym(event.email)
      ? String(event.email)
      : hashLib.emailHash(event.email);
  } else if (event.emailHash) {
    projected.emailHash = event.emailHash;
  }
  return projected;
}

function projectEventsForShadow(events) {
  if (!Array.isArray(events)) return events;
  return {
    length: events.length,
    rows: events
      .map((e) => e && projectEventForShadow(e))
      .filter(Boolean)
      // Sort by (type, emailHash, JSON of remaining payload) for
      // deterministic ordering since events lack a row-id. A clock-
      // tick collision (two events with the same type + actor in
      // the same millisecond) is the only known edge — vanishingly
      // rare in practice.
      .sort((a, b) => {
        const ka = (a.type || '') + (a.emailHash || '') + JSON.stringify(a);
        const kb = (b.type || '') + (b.emailHash || '') + JSON.stringify(b);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      }),
  };
}

// ── Aggregation helpers ──────────────────────────────

function topN(map, n = 5) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

function bucketByDay(events) {
  const map = new Map();
  for (const e of events) {
    const day = (e.at || '').slice(0, 10);
    if (!day) continue;
    map.set(day, (map.get(day) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function aggregate(events) {
  const total = events.length;
  if (total === 0) {
    return {
      total: 0,
      byType: [], byLocale: [], byCategory: [], byOrigin: [], byDestination: [],
      topRoutes: [], byDay: [], emailCaptured: 0, meanLandedEur: null, recent: [],
      // Sprint G: HS-code engagement on import_plan_generated events
      hsCodeProvided: 0, hsCodeProvidedRate: 0, byDutyMfnSource: [],
      // Sprint J.3: Founding 10 pipeline
      foundingApplied: 0, foundingWaitlist: 0, foundingRecent: [],
      // Sprint wizard-step-funnel-v1: per-step funnel measurement
      wizardFunnel: { byStep: [], totalNext: 0, totalBack: 0, totalSubmit: 0 },
    };
  }

  const byType = new Map();
  const byLocale = new Map();
  const byCategory = new Map();
  const byOrigin = new Map();
  const byDestination = new Map();
  const byRoute = new Map();
  const byDutyMfnSource = new Map();
  let emailCaptured = 0;
  let landedSum = 0;
  let landedCount = 0;
  // Sprint G: track HS-code engagement only on import_plan_generated
  // events (plan_saved + others don't carry the input).
  let planEvents = 0;
  let hsCodeProvided = 0;

  for (const e of events) {
    byType.set(e.type, (byType.get(e.type) || 0) + 1);
    if (e.locale) byLocale.set(e.locale, (byLocale.get(e.locale) || 0) + 1);
    const inputs = e.inputs || {};
    if (inputs.productCategory) byCategory.set(inputs.productCategory, (byCategory.get(inputs.productCategory) || 0) + 1);
    if (inputs.originCountry) byOrigin.set(inputs.originCountry, (byOrigin.get(inputs.originCountry) || 0) + 1);
    if (inputs.destinationCountry) byDestination.set(inputs.destinationCountry, (byDestination.get(inputs.destinationCountry) || 0) + 1);
    if (inputs.originCountry && inputs.destinationCountry) {
      const route = `${inputs.originCountry}→${inputs.destinationCountry}`;
      byRoute.set(route, (byRoute.get(route) || 0) + 1);
    }
    if (e.emailProvided) emailCaptured++;
    if (Number.isFinite(Number(e.landedTotal)) && Number(e.landedTotal) > 0) {
      landedSum += Number(e.landedTotal);
      landedCount++;
    }
    if (e.type === 'import_plan_generated') {
      planEvents++;
      if (e.hsCodeProvided) hsCodeProvided++;
      const src = e.dutyMfnSource || 'chapter-estimator';
      byDutyMfnSource.set(src, (byDutyMfnSource.get(src) || 0) + 1);
    }
  }

  // Sprint wizard-step-funnel-v1: count wizard_step_completed events
  // by step + action. Six step buckets, three counters each (next /
  // back / submit). Anonymous + signed-in events are pooled because
  // the funnel question is "did this session reach step N", not "did
  // a specific user". byStep is a fixed-length array (1-6) so the
  // dashboard can render 6 bars without conditionals.
  const wizardByStep = [];
  for (let i = 1; i <= 6; i++) {
    wizardByStep.push({ step: i, next: 0, back: 0, submit: 0, total: 0 });
  }
  let wizardTotalNext = 0, wizardTotalBack = 0, wizardTotalSubmit = 0;
  for (const e of events) {
    if (e.type !== 'wizard_step_completed') continue;
    const step = Number(e.step);
    if (!Number.isInteger(step) || step < 1 || step > 6) continue;
    const slot = wizardByStep[step - 1];
    slot.total++;
    if (e.action === 'next') { slot.next++; wizardTotalNext++; }
    else if (e.action === 'back') { slot.back++; wizardTotalBack++; }
    else if (e.action === 'submit') { slot.submit++; wizardTotalSubmit++; }
  }

  // Sprint J.3: pull Founding 10 stats off the same event stream so the
  // leads dashboard can surface them as a tile + recent-applications panel.
  // Events arrive newest-first per list() — preserve that order for the
  // recent panel (capped at 10).
  const foundingEvents = events.filter(e => e.type === 'founding_applied');
  const foundingApplied = foundingEvents.length;
  const foundingWaitlist = foundingEvents.filter(e => e.waitlist === true).length;
  const foundingRecent = foundingEvents.slice(0, 10).map(e => ({
    at: e.at,
    name: e.name || null,
    company: e.company || null,
    // KV rows carry raw email; PG rows (BG-2.2 dual-write) carry emailHash
    // only. Surface both so the dashboard can show whichever exists.
    email: e.email || null,
    emailHash: e.emailHash || null,
    role: e.role || null,
    monthlyValueEur: e.monthlyValueEur || null,
    waitlist: !!e.waitlist,
  }));

  return {
    total,
    byType: topN(byType, 10),
    byLocale: topN(byLocale, 5),
    byCategory: topN(byCategory, 10),
    byOrigin: topN(byOrigin, 10),
    byDestination: topN(byDestination, 10),
    topRoutes: topN(byRoute, 10),
    byDay: bucketByDay(events),
    emailCaptured,
    emailCaptureRate: total ? Math.round((emailCaptured / total) * 1000) / 10 : 0,
    meanLandedEur: landedCount ? Math.round(landedSum / landedCount) : null,
    // Sprint G — % of plan-generation events where the user supplied
    // an 8+ digit HS code (triggers the Sprint D live-rate path).
    hsCodeProvided,
    hsCodeProvidedRate: planEvents ? Math.round((hsCodeProvided / planEvents) * 1000) / 10 : 0,
    byDutyMfnSource: topN(byDutyMfnSource, 5),
    // Sprint J.3: Founding 10 pipeline
    foundingApplied,
    foundingWaitlist,
    foundingRecent,
    // Sprint wizard-step-funnel-v1: per-step funnel
    wizardFunnel: {
      byStep: wizardByStep,
      totalNext: wizardTotalNext,
      totalBack: wizardTotalBack,
      totalSubmit: wizardTotalSubmit,
    },
    recent: events.slice(0, 10).map(e => ({
      type: e.type,
      at: e.at,
      locale: e.locale || null,
      route: (e.inputs && e.inputs.originCountry && e.inputs.destinationCountry)
        ? `${e.inputs.originCountry}→${e.inputs.destinationCountry}`
        : null,
      category: (e.inputs && e.inputs.productCategory) || null,
      landedTotal: e.landedTotal || null,
      emailProvided: !!e.emailProvided,
    })),
  };
}

// Optional read path from Postgres. Returns events newest-first.
// Used by future-sprint code that wants the full unbounded corpus
// (past the 5000-event KV cap). Today's dashboards still read from
// KV via list() above; this is opt-in via events.listFromPg().
async function listFromPg({ type = null, limit = 500, since = null } = {}) {
  let db;
  try { db = require('./db/client'); }
  catch (_) { return []; }
  if (!db.isConfigured()) return [];

  const safeLimit = Math.max(1, Math.min(MAX_EVENTS, Number(limit) || 500));
  const whereClauses = [];
  const params = [];
  let i = 1;
  if (type) {
    whereClauses.push(`type = $${i++}`);
    params.push(type);
  }
  if (since) {
    const cutoff = new Date(since);
    if (!Number.isNaN(cutoff.getTime())) {
      whereClauses.push(`created_at >= $${i++}`);
      params.push(cutoff.toISOString());
    }
  }
  const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
  params.push(safeLimit);
  const sql = `
    SELECT type, email_hash, payload, created_at
    FROM events
    ${where}
    ORDER BY created_at DESC
    LIMIT $${i}
  `.trim();
  try {
    const rows = await db.query(sql, params);
    // Flatten back to the same shape KV consumers expect:
    //   { type, at, ...payload }
    return rows.map(r => ({
      type: r.type,
      at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      ...(typeof r.payload === 'string' ? JSON.parse(r.payload) : (r.payload || {})),
      // email_hash surfaces here too — useful for the audit dashboard
      // which already redacts to a hash before display.
      ...(r.email_hash ? { emailHash: r.email_hash } : {}),
    }));
  } catch (_) {
    return [];
  }
}

// Unified read path — Sprint BG-2.3.
//
// Picks the storage layer at runtime: Postgres when DATABASE_URL is set
// (durable + unbounded), KV otherwise (legacy + capped at 5000 rows).
// Dashboards (audit, leads, ai) call this instead of list() directly so
// they automatically benefit from the durable corpus without a code
// change at the call site.
//
// PII contract holds either way:
//   - KV rows carry the raw `email` field (handlers redact at display)
//   - PG rows carry `emailHash` only (stripped before INSERT — see
//     buildPgInsertParams in BG-2.2). Handlers see the hash and skip
//     the hashing pass.
async function listUnified(opts = {}) {
  let db;
  try { db = require('./db/client'); }
  catch (_) { db = null; }
  if (db && db.isConfigured()) {
    const rows = await listFromPg(opts);
    // Defensive: if PG returned [] AND we *think* there should be data,
    // fall back to KV. Today this almost always means "PG is empty
    // because the dual-write only fires for new events since BG-2.2".
    // Once historical KV events have aged out, we can drop the fallback.
    if (rows.length === 0) {
      const kvRows = await list(opts);
      if (kvRows.length > 0) return kvRows;
    }
    return rows;
  }
  return await list(opts);
}

// Per-entity timeline reader. Returns every event that names this
// (entityType, entityId) tuple, oldest-first. Used by the shipment
// detail page to render the audit timeline (created → transitions →
// exception → acknowledged → resolved → archived).
//
// Each call pulls up to MAX_EVENTS rows from the KV log and filters
// in-process — the per-entity event count is bounded (a long-lived
// shipment carries ~20 transitions max), so scan cost is acceptable
// without a dedicated entity index. PG-primary cutover will replace
// this with a SELECT WHERE entity_id = $1 ORDER BY at ASC.
//
// @param {{ entityType: string, entityId: string, limit?: number }} opts
async function listForEntity({ entityType, entityId, limit = 100 } = {}) {
  if (!entityType || !entityId) return [];
  const all = await list({ limit: MAX_EVENTS });
  const filtered = all.filter(
    (e) => e && e.entityType === entityType && e.entityId === entityId,
  );
  // Oldest-first so the UI renders a chronological timeline.
  filtered.sort((a, b) => {
    const ta = a && a.at ? Date.parse(a.at) : 0;
    const tb = b && b.at ? Date.parse(b.at) : 0;
    return ta - tb;
  });
  const cap = Math.max(1, Math.min(MAX_EVENTS, Number(limit) || 100));
  return filtered.slice(0, cap);
}

// Org-scoped activity stream (sprint 14). Powers the live activity
// widget on /dashboard. Returns events for the given org, NEWEST-FIRST
// (opposite ordering from listForEntity — the dashboard is a stream,
// not a timeline). Filters by event-type allowlist so personal/security
// events (auth_*, mfa_*) never leak into the org-wide activity view —
// those belong in the personal security audit at /account/security.
const ORG_ACTIVITY_TYPES = new Set([
  // Operator wedge — import-request lifecycle.
  'import_request_created',
  'import_request_updated',
  'import_request_status_transition',
  'import_request_archived',
  // Sprint 18 — messages on a request flow into the org-wide activity
  // feed too, so the team sees customer follow-up questions surface
  // in real time on /dashboard.
  'import_request_message_posted',
  // Sprint 27 — compliance evidence attached. Surfaces in the
  // dashboard activity feed so ops sees "customer attached EUDR DDS
  // on ir_xxx" without checking each request individually.
  'import_request_evidence_attached',
  // Sprint 28 — supplier-country pick. Surfaces in the activity
  // feed because it's the moment of platform learning: every
  // approval shapes the next quote.
  'import_request_supplier_picked',
  // Goods / suppliers / shipments lifecycle (L1.1-L1.3 + L1.5-L1.6).
  'goods_master_created',
  'goods_master_updated',
  'goods_master_archived',
  'supplier_master_created',
  'supplier_master_updated',
  'supplier_master_rescreened',
  'supplier_master_archived',
  'shipment_master_created',
  'shipment_master_updated',
  'shipment_master_status_transition',
  'shipment_master_exception_acknowledged',
  'shipment_master_archived',
  // Document drafting + approval (apex Pillar I5).
  'document_drafted',
  'document_approved',
  'document_rejected',
  // Org membership lifecycle (visible to everyone in the org — these
  // are "your teammate joined" style events, not personal auth events).
  'org_member_invited',
  'org_member_removed',
  'org_member_role_changed',
]);

async function listForOrg({ orgId, limit = 50 } = {}) {
  if (!orgId) return [];
  const all = await list({ limit: MAX_EVENTS });
  const filtered = all.filter(
    (e) => e && e.orgId === orgId && ORG_ACTIVITY_TYPES.has(e.type),
  );
  // Newest-first — the dashboard widget shows the most recent activity
  // at the top.
  filtered.sort((a, b) => {
    const ta = a && a.at ? Date.parse(a.at) : 0;
    const tb = b && b.at ? Date.parse(b.at) : 0;
    return tb - ta;
  });
  const cap = Math.max(1, Math.min(MAX_EVENTS, Number(limit) || 50));
  return filtered.slice(0, cap);
}

module.exports = {
  EVENT_LOG_KEY,
  MAX_EVENTS,
  ALLOWED_TYPES,
  record,
  recordPg,
  buildPgInsertParams,
  list,
  listForEntity,
  listForOrg,
  ORG_ACTIVITY_TYPES,
  listFromPg,
  listUnified,
  aggregate,
  topN,
  bucketByDay,
  // Write-time tamper-evident chain (Pillar III2).
  verifyStoredChain,
  chainProjection,
  chainHashOf,
  CHAIN_HEAD_KEY,
  CHAIN_SEQ_KEY,
  CHAIN_GENESIS,
};
