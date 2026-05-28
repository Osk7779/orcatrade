// Drafted-document persistence — apex Pillar I5 ("act, with approval").
//
// Every artifact a user drafts (commercial invoice, packing list, CBAM report,
// EUDR DDS, customs entry, supplier RFQ, LC application…) is recorded here in
// `pending_approval` state. Approve / reject is the explicit human click that
// principle #6 demands — the platform never sends, files, or wire-transfers
// anything on a user's behalf. Each transition is audit-logged.
//
// Storage layout (KV is the synchronous primary; mirrors saved-plans /
// alert-store / agent-memory):
//   draft:<id>           → { id, email, type, data, label, status,
//                            createdAt, updatedAt, decisionNotes?, decidedAt? }
//   user:<email>:drafts  → array of draft ids (most recent first, capped)
//
// We persist the post-merge `data` we rendered from (not the rendered HTML),
// because the renderer is deterministic — same data ⇒ same HTML — so storing
// the inputs keeps KV lean and lets us re-render on read against the same
// template the user approved. Postgres dual-write is best-effort, email_hash
// only — exactly the saved-plans / alert-store pattern.

'use strict';

const crypto = require('node:crypto');
const kv = require('./intelligence/kv-store');
const hash = require('./hash');

const DRAFT_KEY_PREFIX = 'draft:';
const USER_DRAFTS_PREFIX = 'user:';
const USER_DRAFTS_SUFFIX = ':drafts';
const MAX_DRAFTS_PER_USER = 200;
const DRAFT_TTL_DAYS = 730; // long-lived: audit-relevant for years

const STATUSES = ['pending_approval', 'approved', 'rejected'];

function generateDraftId() {
  return 'dr_' + crypto.randomBytes(8).toString('hex'); // dr_ + 16 hex chars
}

function draftKey(id) { return DRAFT_KEY_PREFIX + id; }
function userDraftsKey(email) { return USER_DRAFTS_PREFIX + normaliseEmail(email) + USER_DRAFTS_SUFFIX; }

function normaliseEmail(email) {
  return String(email || '').toLowerCase().trim();
}

function ttlSeconds() {
  return DRAFT_TTL_DAYS * 24 * 60 * 60;
}

// Create a new draft. Returns the persisted record.
async function createDraft({ email, type, data, label }) {
  const e = normaliseEmail(email);
  if (!e) throw new Error('createDraft: email required');
  if (!type) throw new Error('createDraft: type required');
  if (!data || typeof data !== 'object') throw new Error('createDraft: data object required');
  const id = generateDraftId();
  const now = new Date().toISOString();
  const record = {
    id,
    email: e,
    type,
    data,
    label: typeof label === 'string' ? label.trim().slice(0, 120) : '',
    status: 'pending_approval',
    createdAt: now,
    updatedAt: now,
  };
  await kv.set(draftKey(id), record, { ttlSeconds: ttlSeconds() });
  const ids = (await kv.get(userDraftsKey(e))) || [];
  const updatedIds = [id, ...ids.filter((x) => x !== id)].slice(0, MAX_DRAFTS_PER_USER);
  await kv.set(userDraftsKey(e), updatedIds, { ttlSeconds: ttlSeconds() });
  recordPg(record).catch(() => { /* never propagate */ });
  return record;
}

// Read one (ownership-checked).
async function getDraft(id, requestingEmail) {
  const record = await kv.get(draftKey(id));
  if (!record) return null;
  if (record.email !== normaliseEmail(requestingEmail)) return null;
  return record;
}

async function listDrafts(email, { status, limit = MAX_DRAFTS_PER_USER } = {}) {
  const e = normaliseEmail(email);
  if (!e) return [];
  const ids = (await kv.get(userDraftsKey(e))) || [];
  if (!Array.isArray(ids) || !ids.length) return [];
  const out = [];
  for (const id of ids) {
    const r = await kv.get(draftKey(id));
    if (r && r.email === e) out.push(r);
  }
  const filtered = status ? out.filter((r) => r.status === status) : out;
  return filtered.slice(0, Math.max(1, Math.min(MAX_DRAFTS_PER_USER, limit)));
}

// Transition a draft to approved/rejected. Returns { ok, record, reason? }.
// Idempotent against a no-op (re-approve an approved draft returns the same).
async function decide(id, requestingEmail, decision, notes) {
  if (decision !== 'approved' && decision !== 'rejected') {
    return { ok: false, reason: 'invalid-decision' };
  }
  const record = await getDraft(id, requestingEmail);
  if (!record) return { ok: false, reason: 'not-found' };
  if (record.status === decision) {
    return { ok: true, record, idempotent: true };
  }
  if (record.status !== 'pending_approval') {
    // A decided draft is terminal — you can't move from approved → rejected
    // (or vice versa). Create a fresh draft instead.
    return { ok: false, reason: 'already-decided', currentStatus: record.status };
  }
  const updated = {
    ...record,
    status: decision,
    decisionNotes: typeof notes === 'string' ? notes.trim().slice(0, 600) : '',
    decidedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await kv.set(draftKey(id), updated, { ttlSeconds: ttlSeconds() });
  recordPg(updated).catch(() => {});
  return { ok: true, record: updated };
}

// GDPR — hard-delete every draft for a user (called by account deletion).
async function deleteAllForUser(email) {
  const e = normaliseEmail(email);
  if (!e) return 0;
  const ids = (await kv.get(userDraftsKey(e))) || [];
  let removed = 0;
  for (const id of ids) {
    await kv.del(draftKey(id));
    removed++;
  }
  await kv.del(userDraftsKey(e));
  purgePg(e).catch(() => {});
  return removed;
}

// ── Postgres dual-write (best-effort) ───────────────────

function emailHashFor(email) {
  return hash.isAlreadyPseudonym(email) ? String(email) : hash.emailHash(email);
}

async function recordPg(record) {
  let db;
  try { db = require('./db/client'); } catch (_) { return; }
  if (!db.isConfigured()) return;
  try {
    await db.query(
      `INSERT INTO drafts
         (external_id, email_hash, doc_type, label, data_json, status, created_at, updated_at, decision_notes, decided_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, now(), $8, $9)
       ON CONFLICT (external_id) DO UPDATE
         SET status = EXCLUDED.status,
             decision_notes = EXCLUDED.decision_notes,
             decided_at = EXCLUDED.decided_at,
             updated_at = now()`,
      [
        record.id,
        emailHashFor(record.email),
        record.type,
        record.label || null,
        JSON.stringify(record.data || {}),
        record.status,
        record.createdAt,
        record.decisionNotes || null,
        record.decidedAt || null,
      ],
    );
  } catch (_) { /* never propagate */ }
}

async function purgePg(email) {
  let db;
  try { db = require('./db/client'); } catch (_) { return; }
  if (!db.isConfigured()) return;
  try {
    await db.query('DELETE FROM drafts WHERE email_hash = $1', [emailHashFor(email)]);
  } catch (_) { /* never propagate */ }
}

module.exports = {
  DRAFT_KEY_PREFIX,
  USER_DRAFTS_PREFIX,
  USER_DRAFTS_SUFFIX,
  MAX_DRAFTS_PER_USER,
  DRAFT_TTL_DAYS,
  STATUSES,
  generateDraftId,
  draftKey,
  userDraftsKey,
  normaliseEmail,
  createDraft,
  getDraft,
  listDrafts,
  decide,
  deleteAllForUser,
};
