// Saved-plans persistence — CRUD over KV keyed by user email.
//
// Storage layout:
//   plan:<planId>          → { id, email, inputs, label, savedAt }
//   user:<email>:plans     → array of planIds (most recent first, max 50)
//
// Ownership: every read/write checks that the requesting user (from
// auth cookie) matches the plan's email field. Plan IDs are short
// random hex slugs, not enumerable.

'use strict';

const crypto = require('node:crypto');
const kv = require('./intelligence/kv-store');
const planDiff = require('./plan-diff');
const hash = require('./hash');

const PLAN_KEY_PREFIX = 'plan:';
const USER_PLANS_PREFIX = 'user:';
const USER_PLANS_SUFFIX = ':plans';
const MAX_PLANS_PER_USER = 50;
const PLAN_TTL_DAYS = 365;

function generatePlanId() {
  return 'pl_' + crypto.randomBytes(8).toString('hex'); // pl_ + 16 hex chars
}

function planKey(planId) {
  return PLAN_KEY_PREFIX + planId;
}

function userPlansKey(email) {
  return USER_PLANS_PREFIX + email + USER_PLANS_SUFFIX;
}

function normaliseEmail(email) {
  return String(email || '').toLowerCase().trim();
}

// ── Inputs sanitiser ──────────────────────────────────
// We only persist the wizard's share-codec keys + an optional label so
// stale or malicious fields can't pollute the saved record.

const ALLOWED_KEYS = [
  'productCategory', 'originCountry', 'destinationCountry',
  'customsValueEur', 'weightKg', 'linesCount', 'urgencyWeeks',
  'monthlyOrders', 'avgUnitsPerOrder', 'avgPalletsHeld', 'avgOrderWeightKg',
  'claimPreferential', 'hsCode', 'moq', 'targetFobUnitEur',
  'quoteCurrency', 'paymentTermsDays',
  'shipmentsPerYear', 'waccPct', 'daysInInventory', 'daysReceivable',
];

function sanitiseInputs(inputs) {
  const out = {};
  if (!inputs || typeof inputs !== 'object') return out;
  for (const k of ALLOWED_KEYS) {
    if (inputs[k] !== undefined && inputs[k] !== null && inputs[k] !== '') {
      out[k] = inputs[k];
    }
  }
  return out;
}

function sanitiseLabel(label) {
  if (!label || typeof label !== 'string') return '';
  return label.trim().slice(0, 100);
}

// ── CRUD operations ──────────────────────────────────

async function savePlan({ email, inputs, label = '', snapshot = null }) {
  const e = normaliseEmail(email);
  if (!e) throw new Error('savePlan: email required');
  const sanitised = sanitiseInputs(inputs);
  if (!sanitised.productCategory || !sanitised.originCountry || !sanitised.destinationCountry) {
    throw new Error('savePlan: minimum required inputs missing (productCategory, originCountry, destinationCountry)');
  }

  const planId = generatePlanId();
  const record = {
    id: planId,
    email: e,
    inputs: sanitised,
    label: sanitiseLabel(label) || autoLabel(sanitised),
    savedAt: new Date().toISOString(),
    snapshot: planDiff.sanitiseSnapshot(snapshot),
  };

  // Write the plan record (1-year TTL)
  await kv.set(planKey(planId), record, { ttlSeconds: PLAN_TTL_DAYS * 24 * 60 * 60 });

  // Prepend planId to user's list, cap at MAX_PLANS_PER_USER
  const existing = (await kv.get(userPlansKey(e))) || [];
  const updated = [planId, ...existing.filter(id => id !== planId)].slice(0, MAX_PLANS_PER_USER);
  await kv.set(userPlansKey(e), updated, { ttlSeconds: PLAN_TTL_DAYS * 24 * 60 * 60 });

  // Sprint BG-2.4 — Postgres dual-write. KV is the primary (hot path,
  // returned synchronously, used by /account/plans/). PG is the durable
  // corpus for the future calibration analytics + actuals FK target.
  // Fire-and-forget so a PG outage can't break a save flow that already
  // succeeded in KV. KV-only mode (no DATABASE_URL) is a no-op.
  recordPg(record).catch(() => { /* never propagate */ });

  return record;
}

async function getPlan(planId, requestingEmail) {
  const record = await kv.get(planKey(planId));
  if (!record) return null;
  // Ownership check
  const requester = normaliseEmail(requestingEmail);
  if (record.email !== requester) return null;
  return record;
}

async function listPlans(email) {
  const e = normaliseEmail(email);
  if (!e) return [];
  const ids = (await kv.get(userPlansKey(e))) || [];
  if (!Array.isArray(ids) || ids.length === 0) return [];

  // Fetch each plan record, drop any missing (TTL'd out)
  const records = [];
  for (const id of ids) {
    const r = await kv.get(planKey(id));
    if (r && r.email === e) records.push(r);
  }
  return records;
}

async function deletePlan(planId, requestingEmail) {
  const e = normaliseEmail(requestingEmail);
  const record = await kv.get(planKey(planId));
  // Ownership check before delete
  if (!record || record.email !== e) return false;

  await kv.del(planKey(planId));

  const existing = (await kv.get(userPlansKey(e))) || [];
  const updated = existing.filter(id => id !== planId);
  await kv.set(userPlansKey(e), updated, { ttlSeconds: PLAN_TTL_DAYS * 24 * 60 * 60 });

  // Sprint BG-2.4 — mirror the delete on the PG side. Soft-delete via
  // archived_at so the audit trail survives (matches the schema's
  // archived_at column). The actuals table FKs via ON DELETE CASCADE,
  // so a future hard-delete from PG would also remove the actuals row;
  // soft-delete keeps both for analytics until we hard-purge.
  softDeletePg(planId).catch(() => { /* never propagate */ });

  return true;
}

// ── Postgres dual-write (Sprint BG-2.4) ─────────────────
//
// Mirrors the lib/events.js BG-2.2 pattern: KV is the synchronous,
// authoritative primary (every dashboard and the /account/plans/ UI
// read from it); PG is the durable corpus that survives KV's 1-year
// TTL and can be queried across all users for calibration analytics.
//
// Privacy discipline matches BG-2.2: raw email NEVER lands in PG.
// The email_hash column carries the SHA-256-first-16-hex identity;
// the inputs_json + snapshot_json are stripped of any email field
// before serialisation. (Today neither carries an email — but the
// guard is here in case a future sanitiser allows it through.)

// Pure function: takes a KV plan record and returns the parameter
// tuple for INSERT INTO saved_plans. Exported for test surface.
function buildPgInsertParams(record) {
  if (!record || !record.id || !record.email) {
    throw new Error('buildPgInsertParams: record.id + record.email required');
  }
  const safeInputs = (record.inputs && typeof record.inputs === 'object') ? { ...record.inputs } : {};
  const safeSnapshot = (record.snapshot && typeof record.snapshot === 'object') ? { ...record.snapshot } : null;
  // Defensive: strip email-like fields from inputs + snapshot if any
  // crept in via a future sanitiser change.
  delete safeInputs.email;
  if (safeSnapshot) delete safeSnapshot.email;
  return {
    externalId: record.id,                      // 'pl_<…>'
    emailHash: hash.isAlreadyPseudonym(record.email)
      ? String(record.email)                     // post-Article-17 identity, pass through
      : hash.emailHash(record.email),
    label: (typeof record.label === 'string' && record.label.trim()) ? record.label.slice(0, 100) : null,
    inputsJson: JSON.stringify(safeInputs),
    snapshotJson: safeSnapshot ? JSON.stringify(safeSnapshot) : null,
  };
}

async function recordPg(record) {
  let db;
  try { db = require('./db/client'); }
  catch (_) { return { written: false, reason: 'db-module-unavailable' }; }
  if (!db.isConfigured()) return { written: false, reason: 'not-configured' };

  let params;
  try { params = buildPgInsertParams(record); }
  catch (err) { return { written: false, err: err.message }; }

  try {
    // ON CONFLICT (external_id) DO UPDATE is the right shape for the
    // future re-save use case (today savePlan generates a fresh id, so
    // a conflict never happens — but a future "edit existing plan"
    // sprint will want upsert semantics here).
    await db.query(
      `INSERT INTO saved_plans (external_id, email_hash, label, inputs_json, snapshot_json)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       ON CONFLICT (external_id) DO UPDATE
         SET label = EXCLUDED.label,
             inputs_json = EXCLUDED.inputs_json,
             snapshot_json = EXCLUDED.snapshot_json,
             archived_at = NULL`,
      [params.externalId, params.emailHash, params.label, params.inputsJson, params.snapshotJson],
    );
    return { written: true };
  } catch (err) {
    return { written: false, err: err.message };
  }
}

async function softDeletePg(planExternalId) {
  let db;
  try { db = require('./db/client'); }
  catch (_) { return { written: false, reason: 'db-module-unavailable' }; }
  if (!db.isConfigured()) return { written: false, reason: 'not-configured' };
  if (!planExternalId || typeof planExternalId !== 'string') {
    return { written: false, err: 'planExternalId required' };
  }
  try {
    await db.query(
      'UPDATE saved_plans SET archived_at = now() WHERE external_id = $1 AND archived_at IS NULL',
      [planExternalId],
    );
    return { written: true };
  } catch (err) {
    return { written: false, err: err.message };
  }
}

// Optional read path for future cross-user calibration analytics. KV
// stays the source of truth for the UI; this is for ops/admin queries.
// Returns rows in a KV-compatible shape so existing aggregators can
// consume either source with no code change.
async function listFromPg({ limit = 500, includeArchived = false } = {}) {
  let db;
  try { db = require('./db/client'); }
  catch (_) { return []; }
  if (!db.isConfigured()) return [];

  const safeLimit = Math.max(1, Math.min(MAX_PLANS_PER_USER * 20, Number(limit) || 500));
  const whereClause = includeArchived ? '' : 'WHERE archived_at IS NULL';
  try {
    const rows = await db.query(
      `SELECT external_id, email_hash, label, inputs_json, snapshot_json, created_at, archived_at
         FROM saved_plans
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $1`,
      [safeLimit],
    );
    return (rows || []).map((r) => ({
      id: r.external_id,
      emailHash: r.email_hash,            // NO raw email — PG never had it
      label: r.label || '',
      inputs: r.inputs_json || {},
      snapshot: r.snapshot_json || null,
      savedAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      archivedAt: r.archived_at
        ? (r.archived_at instanceof Date ? r.archived_at.toISOString() : r.archived_at)
        : null,
    }));
  } catch (_err) {
    return [];
  }
}

// ── Shareable plans (Sprint BG-J/shares-v1) ─────────────
//
// A user clicks "Share" on /account/plans/. We generate a short
// share_code (10 hex chars) and attach { code, createdAt, viewCount }
// to the plan record. Lookup index: `plan:share:<code>` → planId
// (separate key so /share/<code> doesn't have to scan).
//
// The /share/<code> public route resolves the code → plan → redirects
// to /start/?p=<base64-inputs>, incrementing the view counter on the
// way through. Revocation deletes BOTH keys; future /share/<code>
// requests return 404. Caveat: anyone who already bookmarked the
// resolved /start/?p=… URL can still see the plan — true revocation
// would require server-rendering the plan page from the inputs,
// scope-cut to a future sprint.
//
// Privacy: getByShareCode strips the owner's email from the returned
// record. The public route never reveals the owner identity.

const SHARE_INDEX_PREFIX = 'plan:share:';

function generateShareCode() {
  return crypto.randomBytes(5).toString('hex'); // 10 hex chars
}

function shareCodeKey(code) {
  return SHARE_INDEX_PREFIX + String(code || '').toLowerCase().trim();
}

async function createShare(planId, requestingEmail) {
  const e = normaliseEmail(requestingEmail);
  const record = await kv.get(planKey(planId));
  if (!record || record.email !== e) return null;
  // Reuse the existing code if one's already minted (idempotent).
  if (record.share && record.share.code) {
    return { code: record.share.code, createdAt: record.share.createdAt, viewCount: record.share.viewCount || 0 };
  }
  const code = generateShareCode();
  const share = { code, createdAt: new Date().toISOString(), viewCount: 0 };
  const updated = { ...record, share };
  await kv.set(planKey(planId), updated, { ttlSeconds: PLAN_TTL_DAYS * 24 * 60 * 60 });
  // Reverse index for fast /share/<code> lookups.
  await kv.set(shareCodeKey(code), planId, { ttlSeconds: PLAN_TTL_DAYS * 24 * 60 * 60 });
  return share;
}

async function revokeShare(planId, requestingEmail) {
  const e = normaliseEmail(requestingEmail);
  const record = await kv.get(planKey(planId));
  if (!record || record.email !== e) return false;
  if (!record.share || !record.share.code) return false;
  const oldCode = record.share.code;
  // eslint-disable-next-line no-unused-vars
  const { share, ...rest } = record;
  await kv.set(planKey(planId), rest, { ttlSeconds: PLAN_TTL_DAYS * 24 * 60 * 60 });
  await kv.del(shareCodeKey(oldCode));
  return true;
}

// Public read path: takes a share_code, returns the plan record with
// the OWNER EMAIL STRIPPED. Returns null when the code is unknown or
// the underlying plan has been deleted. Does NOT increment the view
// counter — that's a separate call so we can mock it out in tests.
async function getByShareCode(code) {
  const c = String(code || '').toLowerCase().trim();
  if (!c) return null;
  const planId = await kv.get(shareCodeKey(c));
  if (!planId) return null;
  const record = await kv.get(planKey(planId));
  if (!record || !record.share || record.share.code !== c) return null;
  // eslint-disable-next-line no-unused-vars
  const { email, ...rest } = record;
  return rest;
}

async function incrementShareViews(code) {
  const c = String(code || '').toLowerCase().trim();
  if (!c) return 0;
  const planId = await kv.get(shareCodeKey(c));
  if (!planId) return 0;
  const record = await kv.get(planKey(planId));
  if (!record || !record.share || record.share.code !== c) return 0;
  const newCount = (Number(record.share.viewCount) || 0) + 1;
  const updated = { ...record, share: { ...record.share, viewCount: newCount, lastViewedAt: new Date().toISOString() } };
  await kv.set(planKey(planId), updated, { ttlSeconds: PLAN_TTL_DAYS * 24 * 60 * 60 });
  return newCount;
}

// ── Auto-label ────────────────────────────────────────

function autoLabel(inputs) {
  const cat = inputs.productCategory || 'plan';
  const origin = inputs.originCountry || '?';
  const dest = inputs.destinationCountry || '?';
  const value = inputs.customsValueEur ? `€${Math.round(inputs.customsValueEur).toLocaleString('en-IE')}` : '';
  return `${cat} ${origin}→${dest} ${value}`.trim();
}

module.exports = {
  PLAN_KEY_PREFIX,
  USER_PLANS_PREFIX,
  USER_PLANS_SUFFIX,
  MAX_PLANS_PER_USER,
  PLAN_TTL_DAYS,
  ALLOWED_KEYS,
  generatePlanId,
  planKey,
  userPlansKey,
  normaliseEmail,
  sanitiseInputs,
  sanitiseLabel,
  autoLabel,
  savePlan,
  getPlan,
  listPlans,
  deletePlan,
  // Sprint BG-2.4 — Postgres dual-write surface
  buildPgInsertParams,
  recordPg,
  softDeletePg,
  listFromPg,
  // Sprint shares-v1 — shareable plans
  SHARE_INDEX_PREFIX,
  generateShareCode,
  shareCodeKey,
  createShare,
  revokeShare,
  getByShareCode,
  incrementShareViews,
};
