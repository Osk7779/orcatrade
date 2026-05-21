// POST /api/portfolio — Sprint portfolio-v1.
//
// Multi-SKU import planning. Accepts { lines: [<plan-input>, …] }, runs
// the existing single-product composePlan for each line (in parallel,
// reusing the trusted per-line calculators incl. live-TARIC duty), and
// returns each per-line plan PLUS a portfolio aggregate: total landed
// cost, blended effective duty rate, and per-lane consolidation savings
// (SKUs sharing an origin+destination clear as one customs entry).
//
// Public + anonymous (the wizard is used signed-out too), rate-limited.
// No new serverless function — registered in the consolidated router.

'use strict';

const { consumeRateLimit } = require('../intelligence/runtime-store');
const startHandler = require('./start');
const customs = require('../intelligence/customs-quote');
const { aggregatePortfolio } = require('../intelligence/portfolio-aggregate');
const savedPortfolios = require('../saved-portfolios');
const auth = require('../auth');
const events = require('../events');
const baseLog = require('../log');
const log = baseLog.withContext({ handler: 'portfolio' });

const MAX_LINES = 20;
const RATE_LIMIT = 6;             // 6 portfolio runs…
const RATE_WINDOW_MS = 60 * 1000; // …per minute per IP (each fans out to N composePlan calls)

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(obj));
}

// POST /api/portfolio — anonymous compute (the primary action).
async function handleCompute(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('portfolio', ip, RATE_LIMIT, RATE_WINDOW_MS);
  if (rate.limited) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });

  const body = req.body || {};
  const rawLines = Array.isArray(body.lines) ? body.lines : null;
  if (!rawLines || rawLines.length === 0) {
    return res.status(400).json({ error: 'lines[] required (1–' + MAX_LINES + ' product lines)' });
  }
  if (rawLines.length > MAX_LINES) {
    return res.status(400).json({ error: `Too many lines (max ${MAX_LINES}). Split into multiple portfolios or contact us for larger catalogues.` });
  }

  // Compose every line in parallel. composePlan validates each input and
  // returns { ok:false, errors } on bad lines — we keep those per-line so
  // a single bad SKU doesn't sink the whole portfolio.
  const composed = await Promise.all(rawLines.map(async (line, i) => {
    try {
      const plan = await startHandler.composePlan(line || {});
      return { index: i, plan };
    } catch (err) {
      log.warn('portfolio line composePlan threw', { index: i, err: err && err.message });
      return { index: i, plan: { ok: false, errors: ['Internal error composing this line'] } };
    }
  }));

  const okPlans = composed.filter((c) => c.plan && c.plan.ok).map((c) => c.plan);
  const lineErrors = composed
    .filter((c) => !c.plan || !c.plan.ok)
    .map((c) => ({ index: c.index, errors: (c.plan && c.plan.errors) || ['Unknown error'] }));

  if (okPlans.length === 0) {
    return res.status(400).json({ error: 'No valid lines', lineErrors });
  }

  const aggregate = aggregatePortfolio(okPlans, { brokerageFee: customs.brokerageFee });

  // Analytics — no PII (line shapes only). Mirrors import_plan_generated.
  try {
    await events.record('portfolio_generated', {
      lineCount: aggregate.lineCount,
      totalLandedEur: Math.round(aggregate.totals.perShipmentLandedTotal),
      blendedDutyRatePct: aggregate.blendedDutyRatePct,
      consolidationSavingEur: Math.round(aggregate.consolidationSavingEur),
      lanes: aggregate.groups.length,
    });
  } catch (_) { /* analytics must never break the response */ }

  return res.status(200).json({
    ok: true,
    asOf: new Date().toISOString().slice(0, 10),
    aggregate,
    // Per-line plans, trimmed to what a portfolio view needs (full plans
    // would be a large payload at 20 lines). The line index lets the UI
    // align rows + surface lineErrors against the original input order.
    lines: okPlans.map((p) => ({
      inputs: p.inputs,
      totals: p.totals,
      duty: p.customs && p.customs.duty ? {
        ratePercent: p.customs.duty.ratePercent,
        mfnSource: p.customs.duty.mfnSource,
        preferentialApplied: p.customs.duty.preferentialApplied || null,
      } : null,
      tradeDefenceMeasures: (p.customs && p.customs.tradeDefenceMeasures) || [],
      hsChapterLabel: (p.customs && p.customs.hsChapterLabel) || null,
    })),
    lineErrors,
  });
}

// ── Authed persistence (Sprint portfolio-v1 phase 3) ────

async function requireUser(req, res) {
  const user = await auth.getCurrentUserStrict(req);
  if (!user) { json(res, 401, { error: 'Not signed in' }); return null; }
  return user;
}

// POST /api/portfolio/save — { lines, label, snapshot } → save to account.
async function handleSave(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const user = await requireUser(req, res);
  if (!user) return;
  const body = req.body || {};
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return json(res, 400, { error: 'lines[] required' });
  }
  try {
    const record = await savedPortfolios.savePortfolio({
      email: user.email,
      lines: body.lines,
      label: body.label || '',
      snapshot: body.snapshot || null,
    });
    try { await events.record('portfolio_saved', { lineCount: record.lines.length }); } catch (_) {}
    return json(res, 200, { ok: true, id: record.id, label: record.label, savedAt: record.savedAt });
  } catch (err) {
    return json(res, 400, { error: err.message || 'Could not save portfolio' });
  }
}

// GET /api/portfolio/list — the signed-in user's saved portfolios.
async function handleList(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  const user = await requireUser(req, res);
  if (!user) return;
  const records = await savedPortfolios.listPortfolios(user.email);
  // Trim to list-view fields (don't ship the full line inputs in the list).
  const items = records.map((r) => ({
    id: r.id,
    label: r.label,
    savedAt: r.savedAt,
    lineCount: Array.isArray(r.lines) ? r.lines.length : 0,
    snapshot: r.snapshot || null,
  }));
  return json(res, 200, { ok: true, portfolios: items });
}

// GET /api/portfolio/item/<id> — full record (lines) to revisit/recompute.
async function handleGet(req, res, id) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  const user = await requireUser(req, res);
  if (!user) return;
  const record = await savedPortfolios.getPortfolio(id, user.email);
  if (!record) return json(res, 404, { error: 'Portfolio not found' });
  return json(res, 200, { ok: true, portfolio: record });
}

// DELETE /api/portfolio/item/<id>
async function handleDelete(req, res, id) {
  if (req.method !== 'DELETE') return json(res, 405, { error: 'Method not allowed' });
  const user = await requireUser(req, res);
  if (!user) return;
  const ok = await savedPortfolios.deletePortfolio(id, user.email);
  if (!ok) return json(res, 404, { error: 'Portfolio not found' }); // 404 not 403 — don't leak existence
  return json(res, 200, { ok: true });
}

// POST|DELETE /api/portfolio/item/<id>/share — mint / revoke a public link.
async function handleShare(req, res, id) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (req.method === 'POST') {
    const share = await savedPortfolios.createShare(id, user.email);
    if (!share) return json(res, 404, { error: 'Portfolio not found' });
    try { await events.record('portfolio_share_created', { code: share.code }); } catch (_) {}
    return json(res, 200, { ok: true, code: share.code, viewCount: share.viewCount || 0 });
  }
  if (req.method === 'DELETE') {
    const ok = await savedPortfolios.revokeShare(id, user.email);
    if (!ok) return json(res, 404, { error: 'No active share to revoke' });
    return json(res, 200, { ok: true });
  }
  return json(res, 405, { error: 'Method not allowed' });
}

// GET /api/portfolio/shared/<code> — PUBLIC read of a shared portfolio.
// Returns the lines (owner email stripped) so the recipient's browser
// can recompute live. Rate-limited; increments the view counter.
async function handleSharedRead(req, res, code) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('portfolio-shared', ip, 60, 60 * 1000);
  if (rate.limited) return json(res, 429, { error: 'Too many requests. Please wait a moment.' });
  const record = await savedPortfolios.getByShareCode(code);
  if (!record) return json(res, 404, { error: 'This shared portfolio is no longer available.' });
  // Fire-and-forget view increment + audit (no PII — code only).
  savedPortfolios.incrementShareViews(code).catch(() => {});
  events.record('portfolio_share_opened', { code: String(code).toLowerCase() }).catch(() => {});
  return json(res, 200, { ok: true, label: record.label, lines: record.lines, savedAt: record.savedAt });
}

// ── Dispatcher ─────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Resolve segments after /api/portfolio/
  let segments = [];
  if (req.query && req.query.path) {
    const arr = Array.isArray(req.query.path) ? req.query.path : String(req.query.path).split('/');
    segments = arr.slice(1).filter(Boolean); // drop leading 'portfolio'
  } else {
    const pathname = (req.url || '').split('?')[0];
    segments = pathname.replace(/^\/api\/portfolio\/?/, '').split('/').filter(Boolean);
  }
  const action = segments[0] || '';

  if (!action) return handleCompute(req, res);
  if (action === 'save') return handleSave(req, res);
  if (action === 'list') return handleList(req, res);
  if (action === 'shared') {
    // /api/portfolio/shared/<code> — PUBLIC read
    const code = segments[1] || '';
    if (!code) return json(res, 404, { error: 'Share code required' });
    return handleSharedRead(req, res, code);
  }
  if (action === 'item') {
    const id = segments[1] || '';
    if (!id) return json(res, 404, { error: 'Portfolio id required' });
    const sub = segments[2] || '';
    if (sub === 'share') return handleShare(req, res, id);
    if (req.method === 'DELETE') return handleDelete(req, res, id);
    return handleGet(req, res, id);
  }
  return json(res, 404, {
    error: 'Unknown /api/portfolio sub-action',
    available: ['POST /api/portfolio', 'POST /api/portfolio/save', 'GET /api/portfolio/list', 'GET|DELETE /api/portfolio/item/<id>', 'POST|DELETE /api/portfolio/item/<id>/share', 'GET /api/portfolio/shared/<code>'],
  });
};

module.exports.MAX_LINES = MAX_LINES;
module.exports.handleCompute = handleCompute;
module.exports.handleSave = handleSave;
module.exports.handleList = handleList;
module.exports.handleGet = handleGet;
module.exports.handleDelete = handleDelete;
module.exports.handleShare = handleShare;
module.exports.handleSharedRead = handleSharedRead;
