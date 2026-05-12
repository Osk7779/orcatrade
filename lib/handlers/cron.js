// /api/cron — token-gated job dispatcher.
//
// Vercel Hobby doesn't have Vercel Cron, so we drive scheduled work from
// GitHub Actions: GHA cron → POST /api/cron with X-Cron-Token → dispatch
// to a named job. Each job is idempotent within its expected cadence
// (the digest only runs Monday, the plan-revision loop dedupes against a
// weekly bucket key).
//
//   POST /api/cron
//   Header:   X-Cron-Token: <ORCATRADE_CRON_TOKEN>
//   Body:     { job: "founder-digest" | "plan-revision-emails" }
//
// Auth: header-only, constant-time compare against ORCATRADE_CRON_TOKEN.
// 503 if env var unset, 401 if missing/wrong, 400 if job unknown.

'use strict';

const crypto = require('node:crypto');
const events = require('../events');
const kv = require('../intelligence/kv-store');
const email = require('../email');
const savedPlans = require('../saved-plans');
const planDiff = require('../plan-diff');
const startHandler = require('./start');

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://orcatrade.pl';

function jsonResponse(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function tokensMatch(a, b) {
  if (!a || !b) return false;
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function readToken(req) {
  return (req.headers && (req.headers['x-cron-token'] || req.headers['X-Cron-Token'])) || '';
}

function founderInboxes() {
  const raw = process.env.ORCATRADE_FOUNDER_INBOXES || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function fmtEur(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return '€' + Math.round(Number(n)).toLocaleString('en-IE');
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(1) + '%';
}

function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

// ── Job 1: founder digest ─────────────────────────────
//
// Weekly summary of conversion-analytics events. Runs Mondays at 06:30 UTC
// from GHA. Body is plain-text markdown rendered by Resend.

async function runFounderDigest({ sinceDays = 7 } = {}) {
  const inboxes = founderInboxes();
  if (inboxes.length === 0) {
    return { ok: false, reason: 'ORCATRADE_FOUNDER_INBOXES not set' };
  }
  const since = isoDaysAgo(sinceDays);
  const log = await events.list({ since, limit: 5000 });
  const summary = events.aggregate(log);

  const periodLabel = `${since.slice(0, 10)} → ${new Date().toISOString().slice(0, 10)}`;
  const top = (rows, n = 5) => (rows || []).slice(0, n).map(r => `  · ${r.key} — ${r.count}`).join('\n') || '  · (none)';

  const text = [
    `OrcaTrade weekly digest — ${periodLabel}`,
    ``,
    `Total events (last ${sinceDays}d):  ${summary.total}`,
    `Email captured:                    ${summary.emailCaptured} (${fmtPct(summary.emailCaptureRate)} capture rate)`,
    `Mean landed cost / shipment:       ${fmtEur(summary.meanLandedEur)}`,
    `Distinct routes:                   ${summary.topRoutes.length}`,
    ``,
    `Top categories`,
    top(summary.byCategory),
    ``,
    `Top routes`,
    top(summary.topRoutes),
    ``,
    `Top origins`,
    top(summary.byOrigin),
    ``,
    `Top destinations`,
    top(summary.byDestination),
    ``,
    `Locales`,
    top(summary.byLocale),
    ``,
    `Recent events (newest 5)`,
    (summary.recent || []).slice(0, 5).map(e => {
      const ts = (e.at || '').replace('T', ' ').slice(0, 16);
      return `  · ${ts}  ${e.type}  ${e.route || '—'}  ${e.category || '—'}  ${fmtEur(e.landedTotal)}${e.emailProvided ? '  ✓email' : ''}`;
    }).join('\n') || '  · (none)',
    ``,
    `Full dashboard: ${SITE_ORIGIN}/dashboard/leads/`,
    ``,
    `— Sent automatically by /api/cron · job=founder-digest`,
  ].join('\n');

  const subject = `OrcaTrade digest · ${summary.total} events · ${summary.emailCaptured} captured · ${periodLabel}`;
  const results = await email.sendMany(inboxes, { subject, text });
  return {
    ok: true,
    recipients: inboxes.length,
    sent: results.filter(r => r.result && r.result.ok).length,
    failed: results.filter(r => r.result && !r.result.ok).length,
    eventsInPeriod: summary.total,
    summary: {
      total: summary.total,
      emailCaptured: summary.emailCaptured,
      meanLandedEur: summary.meanLandedEur,
      topCategory: (summary.byCategory[0] && summary.byCategory[0].key) || null,
      topRoute: (summary.topRoutes[0] && summary.topRoutes[0].key) || null,
    },
  };
}

// ── Job 2: plan-revision emails ───────────────────────
//
// Scan every saved plan, recompute against current pricing, send a
// "what's changed since you saved this" email when delta is significant
// (≥5%). Dedupe per plan per ISO-week so a customer who hasn't opened
// /account/plans/ in months gets at most one nudge per week.

const REVISION_DEDUPE_PREFIX = 'plan-revision-email:';
const REVISION_DEDUPE_TTL_DAYS = 14;

function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function computeSnapshot(inputs) {
  try {
    const result = startHandler.composePlan(inputs);
    if (!result || !result.ok) return null;
    return planDiff.extractSnapshot(result);
  } catch (_err) {
    return null;
  }
}

async function runPlanRevisionEmails({ dryRun = false, maxPlans = 500 } = {}) {
  if (!email.isConfigured()) {
    return { ok: false, reason: 'RESEND_API_KEY not set' };
  }
  // Discover every user-plans list. KV listKeys takes a prefix.
  const userListKeys = await kv.listKeys(savedPlans.USER_PLANS_PREFIX);
  let scanned = 0;
  let significant = 0;
  let sent = 0;
  let skippedDedupe = 0;
  let skippedNoEmail = 0;
  const week = isoWeek();

  outer:
  for (const userKey of userListKeys) {
    // user:<email>:plans → strip the prefix and suffix to recover the email.
    if (!userKey.startsWith(savedPlans.USER_PLANS_PREFIX) || !userKey.endsWith(savedPlans.USER_PLANS_SUFFIX)) continue;
    const userEmail = userKey.slice(savedPlans.USER_PLANS_PREFIX.length, userKey.length - savedPlans.USER_PLANS_SUFFIX.length);
    if (!userEmail) continue;
    const planIds = (await kv.get(userKey)) || [];
    if (!Array.isArray(planIds)) continue;

    for (const planId of planIds) {
      scanned++;
      if (scanned > maxPlans) break outer;
      const record = await kv.get(savedPlans.planKey(planId));
      if (!record || !record.snapshot || !record.inputs) continue;

      const current = computeSnapshot(record.inputs);
      if (!current) continue;
      const delta = planDiff.diffSnapshots(record.snapshot, current, record.savedAt);
      if (!delta || !delta.significant) continue;
      significant++;

      const dedupeKey = REVISION_DEDUPE_PREFIX + planId + ':' + week;
      const alreadySent = await kv.get(dedupeKey);
      if (alreadySent) { skippedDedupe++; continue; }

      if (!record.email) { skippedNoEmail++; continue; }
      if (dryRun) {
        sent++;
        continue;
      }

      const direction = delta.landedDeltaEur > 0 ? 'up' : 'down';
      const sign = delta.landedDeltaEur > 0 ? '+' : '';
      const pctSign = delta.landedDeltaPct > 0 ? '+' : '';
      const driver = ({ duty: 'duty rates', vat: 'VAT', transport: 'freight', brokerage: 'brokerage' }[delta.primaryDriver]) || 'pricing';
      const planUrl = `${SITE_ORIGIN}/account/plans/`;

      const text = [
        `Your saved plan has shifted.`,
        ``,
        `Plan: ${record.label || planId}`,
        `Saved: ${(record.savedAt || '').slice(0, 10)}  (${delta.daysSinceSaved} days ago)`,
        ``,
        `Landed cost is ${direction} ${sign}${fmtEur(delta.landedDeltaEur)} (${pctSign}${delta.landedDeltaPct}% vs your snapshot).`,
        `Driver: ${driver} moved the most in absolute EUR.`,
        ``,
        `Open your saved plans to see the full breakdown:`,
        planUrl,
        ``,
        `— OrcaTrade · automated revision check`,
      ].join('\n');

      const subject = `Plan revision · ${direction === 'up' ? 'cost up' : 'cost down'} ${sign}${fmtEur(delta.landedDeltaEur)} on ${record.label || planId}`;
      const result = await email.send({ to: record.email, subject, text });
      if (result.ok) {
        sent++;
        await kv.set(dedupeKey, { sentAt: new Date().toISOString() }, { ttlSeconds: REVISION_DEDUPE_TTL_DAYS * 24 * 60 * 60 });
      }
    }
  }

  return {
    ok: true,
    scanned,
    significant,
    sent,
    skippedDedupe,
    skippedNoEmail,
    week,
    dryRun,
  };
}

// ── Job 3: EUR-Lex regime change detection ────────────
//
// Fetches each tracked EU-regulation page, hashes the response body, and
// alerts founders when any hash changes vs the last snapshot stored in
// KV. Useful early-warning when CBAM rates, EUDR scope, or REACH SVHC
// listings move — the compliance overlay accuracy depends on these
// pages staying current.
//
// The HTML on eur-lex.europa.eu is verbose (cookie banners, breadcrumbs,
// translation menus). We hash a "stable subset" — the inner content
// region only — to avoid false positives from layout changes.
// If EUR-Lex is unreachable we noop rather than alerting.

const REGIME_HASH_PREFIX = 'regime-hash:';
const REGIME_HASH_TTL_DAYS = 90;

// Curated list of regulation source URLs. Each entry is a celex code +
// the human-readable name the founders will see in the alert email.
// Add to this list (not delete from it) — KV-stored hashes persist.
const REGIME_SOURCES = [
  { id: 'cbam',     name: 'CBAM (Regulation 2023/956)',          url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R0956' },
  { id: 'eudr',     name: 'EUDR — Deforestation (2023/1115)',    url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R1115' },
  { id: 'reach',    name: 'REACH — Annex XVII restrictions',     url: 'https://echa.europa.eu/substances-restricted-under-reach' },
  { id: 'gpsr',     name: 'GPSR (Regulation 2023/988)',          url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R0988' },
  { id: 'battery',  name: 'EU Battery Regulation (2023/1542)',   url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R1542' },
  { id: 'ppwr',     name: 'PPWR — Packaging Waste (2025/40)',    url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32025R0040' },
];

function hashContent(text) {
  // Strip whitespace and case so trivial reformatting doesn't fire alerts.
  return crypto
    .createHash('sha256')
    .update(String(text).replace(/\s+/g, ' ').trim().toLowerCase())
    .digest('hex');
}

function extractMainContent(html) {
  // Best-effort: pull the <article>...</article> or <main>...</main> region.
  // Falls back to the full body if neither exists. EUR-Lex pages have an
  // `<article>` wrapping the legal text; ECHA wraps in `<main>`.
  const articleMatch = html.match(/<article[\s\S]*?<\/article>/i);
  if (articleMatch) return articleMatch[0];
  const mainMatch = html.match(/<main[\s\S]*?<\/main>/i);
  if (mainMatch) return mainMatch[0];
  const bodyMatch = html.match(/<body[\s\S]*?<\/body>/i);
  return bodyMatch ? bodyMatch[0] : html;
}

async function fetchRegimeHash(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'OrcaTrade-RegimeMonitor/1.0 (https://orcatrade.pl)' },
    });
    if (!response.ok) return { ok: false, status: response.status, reason: 'http' };
    const text = await response.text();
    const content = extractMainContent(text);
    return { ok: true, hash: hashContent(content), bytes: content.length };
  } catch (err) {
    return { ok: false, reason: err.message || 'fetch failed' };
  }
}

async function runRegimeChangeCheck({ alert = true } = {}) {
  const inboxes = founderInboxes();
  const checked = [];
  const changed = [];
  const failed = [];

  for (const regime of REGIME_SOURCES) {
    const result = await fetchRegimeHash(regime.url);
    if (!result.ok) {
      failed.push({ id: regime.id, name: regime.name, reason: result.reason });
      continue;
    }
    const key = REGIME_HASH_PREFIX + regime.id;
    const stored = await kv.get(key);
    const previousHash = stored && stored.hash;
    const previousAt = stored && stored.at;
    if (previousHash && previousHash !== result.hash) {
      changed.push({
        id: regime.id,
        name: regime.name,
        url: regime.url,
        previousHash,
        currentHash: result.hash,
        previousAt,
      });
    }
    await kv.set(key, { hash: result.hash, at: new Date().toISOString(), bytes: result.bytes }, {
      ttlSeconds: REGIME_HASH_TTL_DAYS * 24 * 60 * 60,
    });
    checked.push({ id: regime.id, name: regime.name, hash: result.hash, changed: previousHash && previousHash !== result.hash });
  }

  let sent = 0;
  if (alert && changed.length > 0 && inboxes.length > 0 && email.isConfigured()) {
    const text = [
      `Regulatory regime drift detected on ${changed.length} of ${REGIME_SOURCES.length} tracked sources.`,
      ``,
      `Changed since last check:`,
      ``,
      ...changed.map(c => [
        `  · ${c.name}`,
        `      ${c.url}`,
        `      previous snapshot: ${c.previousAt || '(unknown)'}`,
        ``,
      ].join('\n')),
      `Action: open each source URL, compare against the compliance overlay`,
      `(lib/intelligence/data/eu-compliance.js) + the corresponding guide page`,
      `(/guides/compliance/<regime>/). Update both if the regime text has`,
      `moved substantively.`,
      ``,
      `${failed.length > 0 ? `Failed to fetch ${failed.length} sources — re-run after the next scheduled check.\n` : ''}`,
      `— Sent automatically by /api/cron · job=regime-change-check`,
    ].join('\n');
    const subject = `Regime drift · ${changed.length} source${changed.length === 1 ? '' : 's'} changed`;
    const results = await email.sendMany(inboxes, { subject, text });
    sent = results.filter(r => r.result && r.result.ok).length;
  }

  return {
    ok: true,
    checked: checked.length,
    changed: changed.length,
    failed: failed.length,
    alertSent: sent,
    detail: { changed, failed: failed.map(f => ({ id: f.id, reason: f.reason })) },
  };
}

// ── Dispatcher ─────────────────────────────────────────

const JOBS = {
  'founder-digest': runFounderDigest,
  'plan-revision-emails': runPlanRevisionEmails,
  'regime-change-check': runRegimeChangeCheck,
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Cron-Token');

  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  const expected = process.env.ORCATRADE_CRON_TOKEN;
  if (!expected) return jsonResponse(res, 503, { error: 'Cron not configured (ORCATRADE_CRON_TOKEN missing)' });
  if (!tokensMatch(readToken(req), expected)) return jsonResponse(res, 401, { error: 'Unauthorized' });

  const body = req.body || {};
  const jobName = String(body.job || (req.query && req.query.job) || '').toLowerCase();
  const fn = JOBS[jobName];
  if (!fn) return jsonResponse(res, 400, { error: 'Unknown job', knownJobs: Object.keys(JOBS) });

  const startedAt = new Date().toISOString();
  try {
    const result = await fn(body.params || {});
    return jsonResponse(res, 200, { ok: true, job: jobName, startedAt, completedAt: new Date().toISOString(), result });
  } catch (err) {
    return jsonResponse(res, 500, { error: err.message || 'Job failed', job: jobName });
  }
};

module.exports.runFounderDigest = runFounderDigest;
module.exports.runPlanRevisionEmails = runPlanRevisionEmails;
module.exports.runRegimeChangeCheck = runRegimeChangeCheck;
module.exports.JOBS = JOBS;
module.exports.isoWeek = isoWeek;
module.exports.REGIME_SOURCES = REGIME_SOURCES;
module.exports.REGIME_HASH_PREFIX = REGIME_HASH_PREFIX;
module.exports.hashContent = hashContent;
module.exports.extractMainContent = extractMainContent;
