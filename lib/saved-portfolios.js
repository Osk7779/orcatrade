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

  return record;
}

async function getPortfolio(id, requestingEmail) {
  const record = await kv.get(portfolioKey(id));
  if (!record) return null;
  if (record.email !== normaliseEmail(requestingEmail)) return null;
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
  return out;
}

async function deletePortfolio(id, requestingEmail) {
  const e = normaliseEmail(requestingEmail);
  const record = await kv.get(portfolioKey(id));
  if (!record || record.email !== e) return false;
  await kv.del(portfolioKey(id));
  const existing = (await kv.get(userPortfoliosKey(e))) || [];
  const updated = (Array.isArray(existing) ? existing : []).filter((x) => x !== id);
  await kv.set(userPortfoliosKey(e), updated, { ttlSeconds: TTL_SECONDS });
  return true;
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
};
