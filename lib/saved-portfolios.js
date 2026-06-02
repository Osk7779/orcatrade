// Saved-portfolios persistence — Sprint portfolio-v1 (phase 3).
//
// Mirrors lib/saved-plans.js but for a multi-SKU portfolio: a labelled
// set of product lines plus a snapshot of the aggregate (total landed,
// blended duty rate, consolidation saving) so the list view can render
// without recomputing. Revisiting re-runs the stored lines through
// /api/portfolio for fresh numbers.
//
// Storage layout (KV):
//   portfolio:<id>              → { id, email, label, lines[], snapshot, savedAt }
//   user:<email>:portfolios     → array of ids (most recent first, capped)
//
// Ownership: every read/write checks the requesting email against the
// record's email. IDs are short random hex slugs, not enumerable.

'use strict';

const crypto = require('node:crypto');
const kv = require('./intelligence/kv-store');
const hash = require('./hash');
const readShadow = require('./db/read-shadow');

const PORTFOLIO_KEY_PREFIX = 'portfolio:';
const USER_PORTFOLIOS_PREFIX = 'user:';
const USER_PORTFOLIOS_SUFFIX = ':portfolios';
const MAX_PORTFOLIOS_PER_USER = 30;
const MAX_LINES = 20;
const TTL_DAYS = 365;
const TTL_SECONDS = TTL_DAYS * 24 * 60 * 60;

// Per-line input keys we persist — same shape composePlan validates.
const LINE_KEYS = [
  'productCategory', 'originCountry', 'destinationCountry',
  'customsValueEur', 'weightKg', 'linesCount', 'hsCode',
  'claimPreferential', 'quoteCurrency', 'paymentTermsDays',
  'monthlyOrders', 'urgencyWeeks', 'moq', 'targetFobUnitEur',
];

function generatePortfolioId() {
  return 'pf_' + crypto.randomBytes(8).toString('hex'); // pf_ + 16 hex
}
function portfolioKey(id) { return PORTFOLIO_KEY_PREFIX + id; }
function userPortfoliosKey(email) { return USER_PORTFOLIOS_PREFIX + email + USER_PORTFOLIOS_SUFFIX; }
function normaliseEmail(email) { return String(email || '').toLowerCase().trim(); }

function sanitiseLine(line) {
  const out = {};
  if (!line || typeof line !== 'object') return out;
  for (const k of LINE_KEYS) {
    if (line[k] !== undefined && line[k] !== null && line[k] !== '') out[k] = line[k];
  }
  return out;
}

function sanitiseLabel(label) {
  if (!label || typeof label !== 'string') return '';
  return label.trim().slice(0, 100);
}

// Keep only the aggregate fields we render in the list — never persist
// anything email-bearing in the snapshot.
function sanitiseSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const t = snapshot.totals || {};
  return {
    lineCount: Number(snapshot.lineCount) || 0,
    blendedDutyRatePct: Number(snapshot.blendedDutyRatePct) || 0,
    consolidationSavingEur: Number(snapshot.consolidationSavingEur) || 0,
    totals: {
      customsValueEur: Number(t.customsValueEur) || 0,
      dutyEur: Number(t.dutyEur) || 0,
      vatEur: Number(t.vatEur) || 0,
      brokerageEur: Number(t.brokerageEur) || 0,
      transportEur: Number(t.transportEur) || 0,
      perShipmentLandedTotal: Number(t.perShipmentLandedTotal) || 0,
    },
  };
}

function autoLabel(lines) {
  const n = Array.isArray(lines) ? lines.length : 0;
  const lanes = new Set((lines || []).map((l) => `${l.originCountry}→${l.destinationCountry}`));
  return `${n} SKU${n === 1 ? '' : 's'} · ${lanes.size} lane${lanes.size === 1 ? '' : 's'}`;
}

async function savePortfolio({ email, lines, label = '', snapshot = null }) {
  const e = normaliseEmail(email);
  if (!e) throw new Error('savePortfolio: email required');
  const cleanLines = (Array.isArray(lines) ? lines : []).map(sanitiseLine)
    .filter((l) => l.productCategory && l.originCountry && l.destinationCountry)
    .slice(0, MAX_LINES);
  if (cleanLines.length === 0) throw new Error('savePortfolio: at least one valid line required');

  const id = generatePortfolioId();
  const record = {
    id,
    email: e,
    label: sanitiseLabel(label) || autoLabel(cleanLines),
    lines: cleanLines,
    snapshot: sanitiseSnapshot(snapshot),
    savedAt: new Date().toISOString(),
  };
  await kv.set(portfolioKey(id), record, { ttlSeconds: TTL_SECONDS });

  const existing = (await kv.get(userPortfoliosKey(e))) || [];
  const arr = Array.isArray(existing) ? existing : [];
  const updated = [id, ...arr.filter((x) => x !== id)].slice(0, MAX_PORTFOLIOS_PER_USER);
  await kv.set(userPortfoliosKey(e), updated, { ttlSeconds: TTL_SECONDS });

  // Postgres dual-write (mirrors saved-plans BG-2.4): KV is the synchronous
  // primary; PG is the durable corpus surviving KV's 1-year TTL. Fire-and-
  // forget so a PG outage can't break a save that already succeeded in KV.
  // KV-only mode (no DATABASE_URL) is a no-op.
  recordPg(record).catch(() => { /* never propagate */ });

  return record;
}

async function getPortfolio(id, requestingEmail) {
  const record = await kv.get(portfolioKey(id));
  if (!record) return null;
  const requester = normaliseEmail(requestingEmail);
  if (record.email !== requester) return null;

  // Apex A2 step 3 — read-shadow against the PG mirror. Same pattern
  // as saved-plans (PRs #33 + #34). KV authoritative; PG fetch is
  // best-effort + observability-only. No-op unless ORCATRADE_SHADOW_PG
  // is set.
  readShadow.shadowCompare({
    name: 'saved-portfolios.getPortfolio',
    kvValue: record,
    pgFetcher: () => fetchPortfolioFromPg(id, hash.emailHash(requester)),
    projector: projectPortfolioForShadow,
  }).catch(() => { /* shadow must never affect hot path */ });

  return record;
}

async function listPortfolios(email) {
  const e = normaliseEmail(email);
  if (!e) return [];
  const ids = (await kv.get(userPortfoliosKey(e))) || [];
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const out = [];
  for (const id of ids) {
    const r = await kv.get(portfolioKey(id));
    if (r && r.email === e) out.push(r);
  }

  // Apex A2 step 3 — multi-row shadow companion to getPortfolio.
  readShadow.shadowCompare({
    name: 'saved-portfolios.listPortfolios',
    kvValue: out,
    pgFetcher: () => fetchPortfoliosFromPgByEmailHash(hash.emailHash(e)),
    projector: projectPortfolioListForShadow,
  }).catch(() => { /* shadow must never affect hot path */ });

  return out;
}

// ── PG read helpers (apex A2 read-shadow) ───────────────

async function fetchPortfolioFromPg(portfolioId, emailHashValue) {
  if (!portfolioId || !emailHashValue) return null;
  let db;
  try { db = require('./db/client'); }
  catch (_) { return null; }
  if (!db.isConfigured()) return null;
  try {
    const row = await db.queryOne(
      `SELECT external_id, email_hash, label, lines_json, snapshot_json, created_at
         FROM saved_portfolios
        WHERE external_id = $1 AND email_hash = $2 AND archived_at IS NULL`,
      [portfolioId, emailHashValue],
    );
    if (!row) return null;
    return {
      id: row.external_id,
      emailHash: row.email_hash,
      label: row.label || '',
      lines: row.lines_json || [],
      snapshot: row.snapshot_json || null,
      savedAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    };
  } catch (_) {
    return null;
  }
}

async function fetchPortfoliosFromPgByEmailHash(emailHashValue) {
  if (!emailHashValue) return null;
  let db;
  try { db = require('./db/client'); }
  catch (_) { return null; }
  if (!db.isConfigured()) return null;
  try {
    const rows = await db.query(
      `SELECT external_id, email_hash, label, lines_json, snapshot_json, created_at
         FROM saved_portfolios
        WHERE email_hash = $1 AND archived_at IS NULL
        ORDER BY created_at DESC
        LIMIT $2`,
      [emailHashValue, MAX_PORTFOLIOS_PER_USER],
    );
    return (rows || []).map((r) => ({
      id: r.external_id,
      label: r.label || '',
      lines: r.lines_json || [],
      snapshot: r.snapshot_json || null,
      savedAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    }));
  } catch (_) {
    return null;
  }
}

// Project a single portfolio to its durable-truth fields. Strips
// KV-only noise (raw email, share block, view counts) so the
// shadow comparison answers "do the durable fields agree?" rather
// than "are the records byte-identical?".
function projectPortfolioForShadow(record) {
  if (!record || typeof record !== 'object') return record;
  return {
    id: record.id,
    label: record.label || '',
    lines: record.lines || [],
    snapshot: record.snapshot || null,
  };
}

// Multi-row projector: { length, rows } with rows sorted by id so
// the comparison is order-insensitive at the row level (KV is
// newest-first via index array; PG is ORDER BY created_at DESC).
// Length sensitivity is preserved.
function projectPortfolioListForShadow(records) {
  if (!Array.isArray(records)) return records;
  return {
    length: records.length,
    rows: records
      .map((r) => r && projectPortfolioForShadow(r))
      .filter(Boolean)
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  };
}

async function deletePortfolio(id, requestingEmail) {
  const e = normaliseEmail(requestingEmail);
  const record = await kv.get(portfolioKey(id));
  if (!record || record.email !== e) return false;
  await kv.del(portfolioKey(id));
  const existing = (await kv.get(userPortfoliosKey(e))) || [];
  const updated = (Array.isArray(existing) ? existing : []).filter((x) => x !== id);
  await kv.set(userPortfoliosKey(e), updated, { ttlSeconds: TTL_SECONDS });

  // Soft-delete on the PG side (archived_at) so the durable corpus + audit
  // trail survive; never propagate a PG error.
  softDeletePg(id).catch(() => { /* never propagate */ });
  return true;
}

// ── Postgres dual-write (Sprint portfolio-pg-dual-write-v1) ─────
//
// Mirrors lib/saved-plans.js BG-2.4 exactly. KV is the authoritative
// synchronous primary that every UI reads; PG is the durable corpus that
// outlives KV's 1-year TTL and supports cross-user analytics. Privacy:
// raw email NEVER lands in PG — email_hash carries the SHA-256-first-16
// identity, and lines/snapshot are stripped of any email field.

// Pure function: KV portfolio record → INSERT INTO saved_portfolios param
// tuple. Exported for the test surface (verifiable with no live DB).
function buildPgInsertParams(record) {
  if (!record || !record.id || !record.email) {
    throw new Error('buildPgInsertParams: record.id + record.email required');
  }
  const safeLines = Array.isArray(record.lines)
    ? record.lines.map((l) => { const c = { ...l }; delete c.email; return c; })
    : [];
  const safeSnapshot = (record.snapshot && typeof record.snapshot === 'object') ? { ...record.snapshot } : null;
  if (safeSnapshot) delete safeSnapshot.email;
  return {
    externalId: record.id,                       // 'pf_<…>'
    emailHash: hash.isAlreadyPseudonym(record.email)
      ? String(record.email)                      // post-Article-17 identity, pass through
      : hash.emailHash(record.email),
    label: (typeof record.label === 'string' && record.label.trim()) ? record.label.slice(0, 100) : null,
    linesJson: JSON.stringify(safeLines),
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
    await db.query(
      `INSERT INTO saved_portfolios (external_id, email_hash, label, lines_json, snapshot_json)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       ON CONFLICT (external_id) DO UPDATE
         SET label = EXCLUDED.label,
             lines_json = EXCLUDED.lines_json,
             snapshot_json = EXCLUDED.snapshot_json,
             archived_at = NULL`,
      [params.externalId, params.emailHash, params.label, params.linesJson, params.snapshotJson],
    );
    return { written: true };
  } catch (err) {
    return { written: false, err: err.message };
  }
}

async function softDeletePg(portfolioExternalId) {
  let db;
  try { db = require('./db/client'); }
  catch (_) { return { written: false, reason: 'db-module-unavailable' }; }
  if (!db.isConfigured()) return { written: false, reason: 'not-configured' };
  if (!portfolioExternalId || typeof portfolioExternalId !== 'string') {
    return { written: false, err: 'portfolioExternalId required' };
  }
  try {
    await db.query(
      'UPDATE saved_portfolios SET archived_at = now() WHERE external_id = $1 AND archived_at IS NULL',
      [portfolioExternalId],
    );
    return { written: true };
  } catch (err) {
    return { written: false, err: err.message };
  }
}

// Optional cross-user read path (ops/admin analytics). KV stays the UI's
// source of truth; this returns a KV-compatible shape (email_hash, no raw
// email) so aggregators can consume either source.
async function listFromPg({ limit = 500, includeArchived = false } = {}) {
  let db;
  try { db = require('./db/client'); }
  catch (_) { return []; }
  if (!db.isConfigured()) return [];

  const safeLimit = Math.max(1, Math.min(MAX_PORTFOLIOS_PER_USER * 20, Number(limit) || 500));
  const whereClause = includeArchived ? '' : 'WHERE archived_at IS NULL';
  try {
    const rows = await db.query(
      `SELECT external_id, email_hash, label, lines_json, snapshot_json, created_at, archived_at
         FROM saved_portfolios
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $1`,
      [safeLimit],
    );
    return (rows || []).map((r) => ({
      id: r.external_id,
      emailHash: r.email_hash,            // NO raw email — PG never had it
      label: r.label || '',
      lines: r.lines_json || [],
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

// ── Public sharing (Sprint portfolio-v1 phase 4) ────────
//
// Mirrors lib/saved-plans.js shares: mint a code, reverse-index it, and
// resolve it publicly with the OWNER EMAIL STRIPPED. A shared portfolio
// is recomputed live by the recipient (their browser re-runs the stored
// lines through /api/portfolio) — they see today's tariff/freight
// numbers, not a frozen snapshot, same philosophy as single-plan shares.

const SHARE_INDEX_PREFIX = 'portfolio:share:';

function generateShareCode() {
  return crypto.randomBytes(5).toString('hex'); // 10 hex chars
}
function shareCodeKey(code) {
  return SHARE_INDEX_PREFIX + String(code || '').toLowerCase().trim();
}

async function createShare(id, requestingEmail) {
  const e = normaliseEmail(requestingEmail);
  const record = await kv.get(portfolioKey(id));
  if (!record || record.email !== e) return null;
  if (record.share && record.share.code) {
    return { code: record.share.code, createdAt: record.share.createdAt, viewCount: record.share.viewCount || 0 };
  }
  const code = generateShareCode();
  const share = { code, createdAt: new Date().toISOString(), viewCount: 0 };
  await kv.set(portfolioKey(id), { ...record, share }, { ttlSeconds: TTL_SECONDS });
  await kv.set(shareCodeKey(code), id, { ttlSeconds: TTL_SECONDS });
  return share;
}

async function revokeShare(id, requestingEmail) {
  const e = normaliseEmail(requestingEmail);
  const record = await kv.get(portfolioKey(id));
  if (!record || record.email !== e) return false;
  if (!record.share || !record.share.code) return false;
  const oldCode = record.share.code;
  // eslint-disable-next-line no-unused-vars
  const { share, ...rest } = record;
  await kv.set(portfolioKey(id), rest, { ttlSeconds: TTL_SECONDS });
  await kv.del(shareCodeKey(oldCode));
  return true;
}

// Public read: returns the portfolio with OWNER EMAIL STRIPPED (and the
// share metadata trimmed). null on unknown/revoked code or deleted record.
async function getByShareCode(code) {
  const c = String(code || '').toLowerCase().trim();
  if (!c) return null;
  const id = await kv.get(shareCodeKey(c));
  if (!id) return null;
  const record = await kv.get(portfolioKey(id));
  if (!record || !record.share || record.share.code !== c) return null;
  // eslint-disable-next-line no-unused-vars
  const { email, share, ...rest } = record;
  return { id: rest.id, label: rest.label, lines: rest.lines, snapshot: rest.snapshot, savedAt: rest.savedAt };
}

async function incrementShareViews(code) {
  const c = String(code || '').toLowerCase().trim();
  if (!c) return 0;
  const id = await kv.get(shareCodeKey(c));
  if (!id) return 0;
  const record = await kv.get(portfolioKey(id));
  if (!record || !record.share || record.share.code !== c) return 0;
  const newCount = (Number(record.share.viewCount) || 0) + 1;
  await kv.set(portfolioKey(id), { ...record, share: { ...record.share, viewCount: newCount, lastViewedAt: new Date().toISOString() } }, { ttlSeconds: TTL_SECONDS });
  return newCount;
}

module.exports = {
  PORTFOLIO_KEY_PREFIX,
  USER_PORTFOLIOS_PREFIX,
  USER_PORTFOLIOS_SUFFIX,
  SHARE_INDEX_PREFIX,
  MAX_PORTFOLIOS_PER_USER,
  MAX_LINES,
  LINE_KEYS,
  generatePortfolioId,
  portfolioKey,
  userPortfoliosKey,
  shareCodeKey,
  generateShareCode,
  sanitiseLine,
  sanitiseLabel,
  sanitiseSnapshot,
  autoLabel,
  savePortfolio,
  getPortfolio,
  listPortfolios,
  deletePortfolio,
  createShare,
  revokeShare,
  getByShareCode,
  incrementShareViews,
  // Postgres dual-write surface
  buildPgInsertParams,
  recordPg,
  softDeletePg,
  listFromPg,
};
