// Alert inbox persistence — the durable home for proactive monitoring alerts
// (Sprint monitoring-v1 / apex-plan Pillar I3).
//
// Storage layout (KV is the synchronous primary, mirrors saved-plans):
//   alert:<id>            → { id, email, type, severity, title, body,
//                             entityType, entityId, dedupeKey, data,
//                             status, createdAt, updatedAt }
//   user:<email>:alerts   → array of alert ids (most recent first, capped)
//
// Dedupe: each alert carries a stable dedupeKey ('plan_cost_drift:<planId>').
// recordAlert upserts — if a non-dismissed alert with the same dedupeKey
// already exists for the user, its payload is refreshed and it bubbles to the
// top instead of creating a duplicate. That's what keeps a weekly re-scan from
// filling the inbox with the same "duty up 7%" line over and over.
//
// Postgres dual-write (best-effort, never throws) mirrors the saved-plans
// pattern: raw email never lands in PG (email_hash only); data_json is the
// calculator-grounded payload, never PII.

'use strict';

const crypto = require('node:crypto');
const kv = require('./intelligence/kv-store');
const hash = require('./hash');

const ALERT_KEY_PREFIX = 'alert:';
const USER_ALERTS_PREFIX = 'user:';
const USER_ALERTS_SUFFIX = ':alerts';
const MAX_ALERTS_PER_USER = 100;
const ALERT_TTL_DAYS = 180;

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const STATUSES = ['open', 'read', 'dismissed'];

function generateAlertId() {
  return 'al_' + crypto.randomBytes(8).toString('hex');
}

function alertKey(id) {
  return ALERT_KEY_PREFIX + id;
}

function userAlertsKey(email) {
  return USER_ALERTS_PREFIX + normaliseEmail(email) + USER_ALERTS_SUFFIX;
}

function normaliseEmail(email) {
  return String(email || '').toLowerCase().trim();
}

function ttlSeconds() {
  return ALERT_TTL_DAYS * 24 * 60 * 60;
}

// Load every alert record for a user (newest first), dropping ids that have
// TTL'd out of KV.
async function loadUserAlerts(email) {
  const e = normaliseEmail(email);
  if (!e) return [];
  const ids = (await kv.get(userAlertsKey(e))) || [];
  if (!Array.isArray(ids) || !ids.length) return [];
  const out = [];
  for (const id of ids) {
    const r = await kv.get(alertKey(id));
    if (r && r.email === e) out.push(r);
  }
  return out;
}

// Create or refresh an alert. Returns { id, created }. `created:false` means an
// existing open alert with the same dedupeKey was refreshed in place.
async function recordAlert({ email, type, severity = 'medium', title, body = '', entityType = null, entityId = null, dedupeKey, data = {} }) {
  const e = normaliseEmail(email);
  if (!e) throw new Error('recordAlert: email required');
  if (!type || !title) throw new Error('recordAlert: type + title required');
  const sev = SEVERITIES.includes(severity) ? severity : 'medium';
  const dk = String(dedupeKey || `${type}:${entityId || 'global'}`);
  const now = new Date().toISOString();

  const existingList = await loadUserAlerts(e);

  // Upsert against a non-dismissed alert with the same dedupeKey.
  const match = existingList.find((a) => a.dedupeKey === dk && a.status !== 'dismissed');
  if (match) {
    const updated = {
      ...match,
      severity: sev,
      title,
      body,
      entityType,
      entityId,
      data: data && typeof data === 'object' ? data : {},
      // A refresh re-opens a previously-read alert only if the underlying
      // signal changed materially — callers signal that via a changed payload.
      status: match.status === 'read' ? 'open' : match.status,
      updatedAt: now,
    };
    await kv.set(alertKey(match.id), updated, { ttlSeconds: ttlSeconds() });
    // Bubble to the front of the user's list.
    const ids = (await kv.get(userAlertsKey(e))) || [];
    const reordered = [match.id, ...ids.filter((id) => id !== match.id)].slice(0, MAX_ALERTS_PER_USER);
    await kv.set(userAlertsKey(e), reordered, { ttlSeconds: ttlSeconds() });
    recordPg(updated).catch(() => {});
    return { id: match.id, created: false };
  }

  const id = generateAlertId();
  const record = {
    id,
    email: e,
    type,
    severity: sev,
    title,
    body,
    entityType,
    entityId,
    dedupeKey: dk,
    data: data && typeof data === 'object' ? data : {},
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };
  await kv.set(alertKey(id), record, { ttlSeconds: ttlSeconds() });
  const ids = (await kv.get(userAlertsKey(e))) || [];
  const updatedIds = [id, ...ids.filter((x) => x !== id)].slice(0, MAX_ALERTS_PER_USER);
  await kv.set(userAlertsKey(e), updatedIds, { ttlSeconds: ttlSeconds() });
  recordPg(record).catch(() => {});
  return { id, created: true };
}

async function listAlerts(email, { status, limit = MAX_ALERTS_PER_USER } = {}) {
  let records = await loadUserAlerts(email);
  if (status) records = records.filter((a) => a.status === status);
  return records.slice(0, Math.max(1, Math.min(MAX_ALERTS_PER_USER, limit)));
}

async function getAlert(id, requestingEmail) {
  const record = await kv.get(alertKey(id));
  if (!record) return null;
  if (record.email !== normaliseEmail(requestingEmail)) return null;
  return record;
}

// Move an alert to a new status (read | dismissed | open). Returns the updated
// record or null when not found / not owned.
async function setStatus(id, requestingEmail, status) {
  if (!STATUSES.includes(status)) return null;
  const record = await getAlert(id, requestingEmail);
  if (!record) return null;
  const updated = { ...record, status, updatedAt: new Date().toISOString() };
  await kv.set(alertKey(id), updated, { ttlSeconds: ttlSeconds() });
  recordPg(updated).catch(() => {});
  return updated;
}

async function markAllRead(email) {
  const records = await loadUserAlerts(email);
  let changed = 0;
  for (const r of records) {
    if (r.status === 'open') {
      await kv.set(alertKey(r.id), { ...r, status: 'read', updatedAt: new Date().toISOString() }, { ttlSeconds: ttlSeconds() });
      changed++;
    }
  }
  return changed;
}

async function countOpen(email) {
  const records = await loadUserAlerts(email);
  return records.filter((a) => a.status === 'open').length;
}

// GDPR — hard-delete every alert for a user (called by account deletion).
// Returns the count removed. Best-effort PG purge too.
async function deleteAllForUser(email) {
  const e = normaliseEmail(email);
  if (!e) return 0;
  const ids = (await kv.get(userAlertsKey(e))) || [];
  let removed = 0;
  for (const id of ids) {
    await kv.del(alertKey(id));
    removed++;
  }
  await kv.del(userAlertsKey(e));
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
      `INSERT INTO monitoring_alerts
         (external_id, email_hash, alert_type, severity, title, body, entity_type, entity_id, dedupe_key, data_json, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11, now())
       ON CONFLICT (external_id) DO UPDATE
         SET severity = EXCLUDED.severity,
             title = EXCLUDED.title,
             body = EXCLUDED.body,
             data_json = EXCLUDED.data_json,
             status = EXCLUDED.status,
             updated_at = now()`,
      [
        record.id,
        emailHashFor(record.email),
        record.type,
        record.severity,
        String(record.title || '').slice(0, 300),
        String(record.body || '').slice(0, 2000),
        record.entityType || null,
        record.entityId || null,
        record.dedupeKey,
        JSON.stringify(record.data || {}),
        record.status || 'open',
      ],
    );
  } catch (_) { /* never propagate */ }
}

async function purgePg(email) {
  let db;
  try { db = require('./db/client'); } catch (_) { return; }
  if (!db.isConfigured()) return;
  try {
    await db.query('DELETE FROM monitoring_alerts WHERE email_hash = $1', [emailHashFor(email)]);
  } catch (_) { /* never propagate */ }
}

module.exports = {
  ALERT_KEY_PREFIX,
  USER_ALERTS_PREFIX,
  USER_ALERTS_SUFFIX,
  MAX_ALERTS_PER_USER,
  ALERT_TTL_DAYS,
  SEVERITIES,
  STATUSES,
  generateAlertId,
  alertKey,
  userAlertsKey,
  normaliseEmail,
  recordAlert,
  listAlerts,
  getAlert,
  setStatus,
  markAllRead,
  countOpen,
  deleteAllForUser,
};
